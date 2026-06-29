import { Router, type Request, type Response } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import cron, { type ScheduledTask as CronJob } from 'node-cron';
import { callLLMChatStream } from '../agents/llm.js';
import { buildEnterpriseContext } from './enterprise.js';
import { isDemoMode } from '../lib/demo.js';
import { store } from '../storage/index.js';
import { crawlVideosForTenant, getVideoPipelineStats } from './videos.js';
import type { Platform } from '../types/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, '../../data/tasks.json');
const ENTERPRISE_FILE = path.join(__dirname, '../../data/enterprise.json');

export interface ScheduledTask {
  id: string;
  name: string;
  category: 'daily' | 'monitor' | 'report' | 'automation';
  taskType: 'trend_report' | 'weekly_review' | 'crm_wakeup' | 'exchange_rate' | 'holiday_push' | 'video_keyword_crawl' | 'custom';
  cronExpr: string;      // e.g. "0 8 * * *"
  cronLabel: string;     // e.g. "每天 08:00"
  enabled: boolean;
  lastRun?: string;
  lastResult?: string;
  nextRun?: string;
  channelId?: string;    // which channel to send output to
  config: Record<string, string>;
  createdAt: string;
}

function load(): ScheduledTask[] {
  try { return JSON.parse(fs.readFileSync(DATA, 'utf8')); } catch { return []; }
}
function save(tasks: ScheduledTask[]) {
  fs.writeFileSync(DATA, JSON.stringify(tasks, null, 2));
}
function getEnterpriseCtx(): string {
  try { return buildEnterpriseContext(JSON.parse(fs.readFileSync(ENTERPRISE_FILE, 'utf8'))); } catch { return ''; }
}

// Active cron jobs registry
const activeJobs = new Map<string, CronJob>();
const DEFAULT_VIDEO_CRAWL_TASK_ID = 'system_video_keyword_crawl_daily_0100';

function ensureDefaultVideoCrawlTask(): void {
  const tasks = load();
  if (tasks.some(task => task.id === DEFAULT_VIDEO_CRAWL_TASK_ID || task.taskType === 'video_keyword_crawl')) return;
  const task: ScheduledTask = {
    id: DEFAULT_VIDEO_CRAWL_TASK_ID,
    name: 'YT/TK 关键词视频自动采集',
    category: 'daily',
    taskType: 'video_keyword_crawl',
    cronExpr: '0 1 * * *',
    cronLabel: '每天 01:00（北京时间）',
    enabled: true,
    config: {
      platforms: 'youtube,tiktok',
      keywords: process.env.SCHEDULED_VIDEO_KEYWORDS || 'skincare',
      limit: process.env.SCHEDULED_VIDEO_LIMIT || '12',
      dateWindowDays: process.env.SCHEDULED_VIDEO_DATE_WINDOW_DAYS || '7',
      tenantId: process.env.SCHEDULED_VIDEO_TENANT_ID || '',
    },
    createdAt: new Date().toISOString(),
  };
  save([task, ...tasks]);
}

async function executeTrendReport(_task: ScheduledTask): Promise<string> {
  const messages = [{ role: 'user' as const, content: '生成今日TikTok跨境电商爆款趋势简报，包括：热门品类、热门话题标签、建议借势策略，控制在300字以内' }];
  let result = '';
  for await (const chunk of callLLMChatStream(messages, { systemPrompt: `你是跨境电商趋势分析师。${getEnterpriseCtx() ? '\n\n企业信息：' + getEnterpriseCtx() : ''}` })) {
    if ('text' in chunk) result += chunk.text;
  }
  return result;
}

async function executeWeeklyReview(_task: ScheduledTask): Promise<string> {
  const messages = [{ role: 'user' as const, content: '生成本周跨境电商经营复盘报告：流量表现、询盘转化、老客复购情况，并给出下周行动建议，控制在500字' }];
  let result = '';
  for await (const chunk of callLLMChatStream(messages, { systemPrompt: `你是跨境电商经营顾问。${getEnterpriseCtx() ? '\n\n企业信息：' + getEnterpriseCtx() : ''}` })) {
    if ('text' in chunk) result += chunk.text;
  }
  return result;
}

async function executeExchangeRate(_task: ScheduledTask): Promise<string> {
  try {
    const res = await fetch('https://api.exchangerate-api.com/v4/latest/USD');
    const data = await res.json() as { rates: Record<string, number>; date: string };
    const { rates } = data;
    return `【汇率日报 ${new Date().toLocaleDateString('zh-CN')}】\n1 USD = CNY ${rates.CNY?.toFixed(4)} | SAR ${rates.SAR?.toFixed(4)} | AED ${rates.AED?.toFixed(4)} | VND ${(rates.VND ?? 0).toFixed(0)} | MYR ${rates.MYR?.toFixed(4)} | IDR ${(rates.IDR ?? 0).toFixed(0)}`;
  } catch {
    return '汇率获取失败，请检查网络';
  }
}

async function executeCrmWakeup(_task: ScheduledTask): Promise<string> {
  const messages = [{ role: 'user' as const, content: '请生成一段针对60天未复购老客的唤醒消息，要有温度感，适合通过WhatsApp发送，不超过100字' }];
  let result = '';
  for await (const chunk of callLLMChatStream(messages, { systemPrompt: `你是跨境电商CRM专员。${getEnterpriseCtx() ? '\n\n企业信息：' + getEnterpriseCtx() : ''}` })) {
    if ('text' in chunk) result += chunk.text;
  }
  return result;
}

async function resolveSchedulerTenantId(task: ScheduledTask): Promise<string> {
  const configured = task.config.tenantId || process.env.SCHEDULED_VIDEO_TENANT_ID || process.env.DEFAULT_TENANT_ID || '';
  if (configured.trim()) return configured.trim();
  const latestVideo = await store.list<Record<string, unknown>>('trend_videos', { page: 1, perPage: 1, sort: '-crawledAt' });
  const videoTenantId = String(latestVideo.items[0]?.tenantId || '').trim();
  if (videoTenantId) return videoTenantId;
  const tenants = await store.list<Record<string, unknown>>('tenants', { page: 1, perPage: 1 });
  const tenantId = String(tenants.items[0]?.id || '').trim();
  if (!tenantId) throw new Error('未找到可执行视频采集的租户，请在任务 config.tenantId 或 SCHEDULED_VIDEO_TENANT_ID 中配置');
  return tenantId;
}

function beijingDateRange(daysRaw: string | undefined): { dateFrom: string; dateTo: string } {
  const days = Math.max(1, Math.min(30, Number(daysRaw || 7) || 7));
  const dayMs = 24 * 60 * 60 * 1000;
  const bjNow = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const end = bjNow.toISOString().slice(0, 10);
  const start = new Date(bjNow.getTime() - (days - 1) * dayMs).toISOString().slice(0, 10);
  return { dateFrom: start, dateTo: end };
}

function splitConfigList(value: string | undefined, fallback: string[]): string[] {
  const items = String(value || '')
    .split(/[\n,，;；、]+/)
    .map(item => item.trim())
    .filter(Boolean);
  return items.length > 0 ? items : fallback;
}

async function executeVideoKeywordCrawl(task: ScheduledTask): Promise<string> {
  const tenantId = await resolveSchedulerTenantId(task);
  const platforms = splitConfigList(task.config.platforms, ['youtube', 'tiktok'])
    .filter((platform): platform is Platform => ['youtube', 'tiktok'].includes(platform));
  const keywords = splitConfigList(task.config.keywords || task.config.keyword, ['skincare']);
  const limit = Math.max(1, Math.min(30, Number(task.config.limit || 12) || 12));
  const { dateFrom, dateTo } = beijingDateRange(task.config.dateWindowDays);
  const lines: string[] = [];
  let imported = 0;
  let returned = 0;
  let existing = 0;

  for (const keyword of keywords) {
    for (const platform of platforms) {
      try {
        const result = await crawlVideosForTenant({ tenantId, platform, keyword, limit, dateFrom, dateTo });
        imported += result.imported;
        returned += result.items.length;
        existing += result.returnedExisting;
        lines.push(`${platform} / ${keyword}: 返回 ${result.items.length} 条，新增 ${result.imported} 条，库内已有 ${result.returnedExisting} 条`);
      } catch (e) {
        lines.push(`${platform} / ${keyword}: 执行失败 - ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  return [
    `【视频关键词自动采集】${dateFrom} 至 ${dateTo}`,
    `平台：${platforms.join(', ')}；关键词：${keywords.join('、')}；每组数量：${limit}`,
    `汇总：返回 ${returned} 条，新增 ${imported} 条，库内已有 ${existing} 条`,
    ...lines,
  ].join('\n');
}

async function executeTask(task: ScheduledTask): Promise<string> {
  if (task.taskType === 'video_keyword_crawl') return executeVideoKeywordCrawl(task);
  if (isDemoMode()) {
    switch (task.taskType) {
      case 'trend_report':
        return '【Demo 趋势简报】今日建议围绕占位行业模板补充 3 条短视频选题：痛点开场、工厂实力背书、客户案例转化。真实平台数据接入后，这里会替换为 TikTok/Instagram/Shopify 数据分析。';
      case 'weekly_review':
        return '【Demo 周报】本周模拟数据：流量增长 18%，询盘转化率 12%，老客唤醒 6 人。建议下周优先完善真实商品库与渠道授权。';
      case 'exchange_rate':
        return '【Demo 汇率日报】USD/CNY 7.20 | USD/AED 3.67 | USD/SAR 3.75。正式版将接实时汇率源。';
      case 'crm_wakeup':
        return '【Demo 老客唤醒】您好，我们根据您的历史采购偏好准备了新品方案。若您方便，我可以发一份最新目录和报价给您参考。';
      default:
        return '【Demo 任务】已模拟执行成功，真实推送由渠道集成模块接入。';
    }
  }
  switch (task.taskType) {
    case 'trend_report':  return executeTrendReport(task);
    case 'weekly_review': return executeWeeklyReview(task);
    case 'exchange_rate': return executeExchangeRate(task);
    case 'crm_wakeup':   return executeCrmWakeup(task);
    case 'holiday_push':  return `【节日提醒】${task.config.holidayName ?? '即将到来的节假日'}推品提醒：建议提前备货并触达相关老客。`;
    default:              return '任务执行完成';
  }
}

function scheduleTask(task: ScheduledTask) {
  if (activeJobs.has(task.id)) { activeJobs.get(task.id)!.stop(); activeJobs.delete(task.id); }
  if (!task.enabled) return;
  if (!cron.validate(task.cronExpr)) return;

  const job = cron.schedule(task.cronExpr, async () => {
    const tasks = load();
    const idx = tasks.findIndex(t => t.id === task.id);
    const result = await executeTask(task).catch(e => `执行失败: ${e.message}`);
    if (idx !== -1) {
      tasks[idx].lastRun = new Date().toISOString();
      tasks[idx].lastResult = result;
      save(tasks);
    }
    // TODO: send result to configured channel
    console.log(`[scheduler] task "${task.name}" done:`, result.slice(0, 100));
  }, { timezone: 'Asia/Shanghai' });
  activeJobs.set(task.id, job);
}

// Boot: restore active tasks
export function initScheduler() {
  ensureDefaultVideoCrawlTask();
  load().filter(t => t.enabled).forEach(scheduleTask);
  console.log('[scheduler] initialized with', load().filter(t => t.enabled).length, 'active tasks');
}

export const schedulerRouter = Router();

schedulerRouter.get('/', (_req, res) => res.json(load()));

schedulerRouter.get('/video-stats', async (_req, res) => {
  const tasks = load().filter(task => task.taskType === 'video_keyword_crawl');
  res.json({
    tasks,
    stats: await getVideoPipelineStats(),
  });
});

schedulerRouter.post('/', (req: Request, res: Response) => {
  const tasks = load();
  const task: ScheduledTask = {
    id: `task_${Date.now()}`,
    name: req.body.name,
    category: req.body.category ?? 'daily',
    taskType: req.body.taskType ?? 'custom',
    cronExpr: req.body.cronExpr ?? '0 8 * * *',
    cronLabel: req.body.cronLabel ?? '每天 08:00',
    enabled: req.body.enabled ?? true,
    channelId: req.body.channelId,
    config: req.body.config ?? {},
    createdAt: new Date().toISOString(),
  };
  tasks.push(task);
  save(tasks);
  scheduleTask(task);
  res.json(task);
});

schedulerRouter.put('/:id', (req: Request, res: Response) => {
  const tasks = load();
  const idx = tasks.findIndex(t => t.id === req.params.id);
  if (idx === -1) { res.status(404).json({ error: 'not found' }); return; }
  tasks[idx] = { ...tasks[idx], ...req.body };
  save(tasks);
  scheduleTask(tasks[idx]);
  res.json(tasks[idx]);
});

schedulerRouter.delete('/:id', (req: Request, res: Response) => {
  activeJobs.get(req.params.id)?.stop();
  activeJobs.delete(req.params.id);
  save(load().filter(t => t.id !== req.params.id));
  res.json({ ok: true });
});

// Run immediately
schedulerRouter.post('/:id/run', async (req: Request, res: Response) => {
  const task = load().find(t => t.id === req.params.id);
  if (!task) { res.status(404).json({ error: 'not found' }); return; }
  const result = await executeTask(task).catch(e => `执行失败: ${e.message}`);
  const tasks = load();
  const idx = tasks.findIndex(t => t.id === req.params.id);
  if (idx !== -1) { tasks[idx].lastRun = new Date().toISOString(); tasks[idx].lastResult = result; save(tasks); }
  res.json({ ok: true, result });
});

// Toggle enabled
schedulerRouter.post('/:id/toggle', (req: Request, res: Response) => {
  const tasks = load();
  const idx = tasks.findIndex(t => t.id === req.params.id);
  if (idx === -1) { res.status(404).json({ error: 'not found' }); return; }
  tasks[idx].enabled = !tasks[idx].enabled;
  save(tasks);
  scheduleTask(tasks[idx]);
  res.json(tasks[idx]);
});
