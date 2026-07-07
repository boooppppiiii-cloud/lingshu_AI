import { Router, type Request, type Response } from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import cron, { type ScheduledTask as CronJob } from 'node-cron';
import { callLLMChatStream } from '../agents/llm.js';
import { buildEnterpriseContext } from './enterprise.js';
import { isDemoMode } from '../lib/demo.js';
import { store } from '../storage/index.js';
import { crawlVideosForTenant, getVideoPipelineStats } from './videos.js';
import type { Platform } from '../types/index.js';
import { requireAuth, type AuthLocals } from '../middleware/auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, '../../data/tasks.json');
const ENTERPRISE_FILE = path.join(__dirname, '../../data/enterprise.json');
const PDF_SCRIPT = path.join(__dirname, '../../scripts/render-task-report-pdf.py');

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
  tenantId?: string;
  createdAt: string;
}

interface HolidayInfo {
  date: string;
  name: string;
  note: string;
}

interface MarketHolidayPlan {
  name: string;
  holidays: HolidayInfo[];
}

interface TaskReportAction {
  label: string;
  agentLabel: string;
}

function load(): ScheduledTask[] {
  try { return JSON.parse(fs.readFileSync(DATA, 'utf8')); } catch { return []; }
}
function save(tasks: ScheduledTask[]) {
  fs.writeFileSync(DATA, JSON.stringify(tasks, null, 2));
}

function tenantTasks(tenantId: string): ScheduledTask[] {
  return load().filter(task => task.tenantId === tenantId);
}

function findTenantTask(id: string, tenantId: string): ScheduledTask | undefined {
  return load().find(task => task.id === id && task.tenantId === tenantId);
}
function getEnterpriseCtx(): string {
  try { return buildEnterpriseContext(JSON.parse(fs.readFileSync(ENTERPRISE_FILE, 'utf8'))); } catch { return ''; }
}

function readEnterpriseProfile(): Record<string, any> {
  try { return JSON.parse(fs.readFileSync(ENTERPRISE_FILE, 'utf8')) as Record<string, any>; } catch { return {}; }
}

function taskReportActions(taskType: string): TaskReportAction[] {
  if (taskType === 'holiday_push') {
    return [
      { label: '整理节日前 7 天主推 SKU 与库存水位', agentLabel: '策略专家' },
      { label: '生成社媒预热脚本和短视频内容方向', agentLabel: '社媒流量' },
      { label: '生成私域触达话术并安排近 90 天询盘跟进', agentLabel: '转化专家' },
    ];
  }
  if (taskType === 'trend_report') {
    return [
      { label: '把高频话题转成 3 条 TikTok 脚本方向', agentLabel: '社媒流量' },
      { label: '挑选 2 个产品卖点做 A/B 内容测试', agentLabel: '社媒流量' },
      { label: '将适配市场和语言写回企业中心学习记录', agentLabel: '策略专家' },
    ];
  }
  if (taskType === 'video_keyword_crawl') {
    return [
      { label: '查看新入库视频并筛选可复用素材', agentLabel: '社媒流量' },
      { label: '选择高互动视频生成克隆脚本', agentLabel: '社媒流量' },
      { label: '复盘失败下载链接并补充关键词', agentLabel: '策略专家' },
    ];
  }
  if (taskType === 'exchange_rate') {
    return [
      { label: '生成多币种询盘报价话术', agentLabel: '转化专家' },
      { label: '更新报价风险和利润提醒', agentLabel: '策略专家' },
      { label: '整理老客补货报价提醒', agentLabel: '留存专家' },
    ];
  }
  if (taskType === 'weekly_review') {
    return [
      { label: '拆解下周社媒内容任务', agentLabel: '社媒流量' },
      { label: '生成询盘转化跟进动作', agentLabel: '转化专家' },
      { label: '生成老客复购唤醒动作', agentLabel: '留存专家' },
    ];
  }
  if (taskType === 'crm_wakeup') {
    return [
      { label: '生成老客唤醒分层和触达节奏', agentLabel: '留存专家' },
      { label: '生成 WhatsApp 跟进话术', agentLabel: '转化专家' },
      { label: '生成复购内容素材方向', agentLabel: '社媒流量' },
    ];
  }
  return [{ label: '交给策略专家拆解后续任务', agentLabel: '策略专家' }];
}

function pdfPythonPath(): string {
  const bundled = path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3');
  if (fs.existsSync(bundled)) return bundled;
  return process.env.PYTHON || 'python3';
}

function formatTaskTime(value?: string): string {
  return value ? new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '暂无';
}

function renderTaskReportPdf(payload: Record<string, unknown>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const output = path.join(os.tmpdir(), `lingshu-task-report-${Date.now()}-${Math.random().toString(16).slice(2)}.pdf`);
    const child = spawn(pdfPythonPath(), [PDF_SCRIPT, output], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', code => {
      if (code !== 0) {
        reject(new Error(stderr || `PDF render failed with code ${code}`));
        return;
      }
      try {
        const pdf = fs.readFileSync(output);
        fs.rmSync(output, { force: true });
        resolve(pdf);
      } catch (e) {
        reject(e);
      }
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

// Active cron jobs registry
const activeJobs = new Map<string, CronJob>();

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

function splitTextList(value: unknown): string[] {
  return String(value || '')
    .split(/[\n,，;；、/]+/)
    .map(item => item.trim())
    .filter(Boolean);
}

function daysUntil(date: string, from = new Date()): number {
  const start = new Date(from);
  start.setHours(0, 0, 0, 0);
  return Math.ceil((new Date(`${date}T00:00:00+08:00`).getTime() - start.getTime()) / 86400000);
}

function marketKey(market: string): string {
  const value = market.toLowerCase();
  if (/美国|usa|u\.s\.|united states/.test(value)) return 'us';
  if (/沙特|saudi|ksa/.test(value)) return 'saudi';
  if (/阿联酋|uae|emirates|dubai/.test(value)) return 'uae';
  if (/德国|germany|deutschland/.test(value)) return 'germany';
  if (/印尼|印度尼西亚|indonesia/.test(value)) return 'indonesia';
  return value;
}

function marketLanguage(key: string, enterprise: Record<string, any>): string {
  const preferred = splitTextList(enterprise.company?.primaryLanguages || enterprise.brand?.preferredLanguages);
  const map: Record<string, string> = {
    us: '英语',
    saudi: preferred.includes('阿拉伯语') ? '阿拉伯语 / 英语' : '阿拉伯语',
    uae: preferred.includes('阿拉伯语') ? '阿拉伯语 / 英语' : '阿拉伯语 / 英语',
    germany: '德语 / 英语',
    indonesia: '印尼语 / 英语',
  };
  return map[key] || preferred.join(' / ') || '英语';
}

function pickProducts(key: string, enterprise: Record<string, any>): string {
  const focus = splitTextList(enterprise.strategy?.focusProducts);
  const categories = splitTextList(enterprise.products?.categories);
  const products = focus.length ? focus : categories;
  const has = (keyword: string) => products.find(item => item.includes(keyword));
  const lip = has('唇') || '唇釉套装';
  const travel = has('旅行') || '旅行装护肤套装';
  const serum = has('精华') || has('维 C') || '维 C 亮肤精华';
  const cream = has('面霜') || '烟酰胺面霜';

  if (key === 'us') return [travel, serum, '低 MOQ 私标套装'].join('、');
  if (key === 'saudi' || key === 'uae') return [lip, travel, '英文/阿语标签版本'].join('、');
  if (key === 'germany') return [serum, cream, '纯素/无动物测试卖点组合'].join('、');
  if (key === 'indonesia') return [lip, travel, 'TikTok Shop 小批量试单组合'].join('、');
  return products.slice(0, 3).join('、') || '重点 SKU';
}

function holidayCatalog(): Record<string, MarketHolidayPlan> {
  return {
    us: {
      name: '美国',
      holidays: [
        { date: '2026-07-03', name: 'Independence Day 观察假期', note: '7/4 独立日落在周六，联邦观察假期为 7/3' },
        { date: '2026-07-04', name: 'Independence Day 独立日', note: '美国建国 250 周年，适合做纪念装、旅行装和派对妆容内容' },
        { date: '2026-09-07', name: 'Labor Day 劳动节', note: '夏末促销节点，适合清爽护肤、旅行补货和开学季前内容' },
        { date: '2026-10-12', name: 'Columbus Day / Indigenous Peoples Day', note: '部分地区放假，适合做秋季护肤切换' },
      ],
    },
    saudi: {
      name: '沙特',
      holidays: [
        { date: '2026-08-25', name: 'Prophet Muhammad’s Birthday 先知诞辰', note: '宗教节日，内容表达需稳重，避免夸张促销语' },
        { date: '2026-09-23', name: 'Saudi National Day 沙特国庆日', note: '适合绿色视觉、礼赠套装、阿语标签和批发备货提醒' },
      ],
    },
    uae: {
      name: '阿联酋',
      holidays: [
        { date: '2026-08-25', name: 'Prophet Muhammad’s Birthday 先知诞辰', note: '适合温和护肤、礼赠套装，文案保持尊重克制' },
        { date: '2026-11-30', name: 'Commemoration Day 纪念日', note: '偏纪念属性，不建议强促销，可做品牌关怀内容' },
        { date: '2026-12-02', name: 'UAE National Day 阿联酋国庆日', note: '适合礼盒、套装和阿语/英语双语上新预热' },
      ],
    },
    germany: {
      name: '德国',
      holidays: [
        { date: '2026-08-15', name: 'Assumption Day 圣母升天节（部分州）', note: '巴伐利亚、萨尔等区域假期，可做区域定向内容' },
        { date: '2026-10-03', name: 'German Unity Day 德国统一日', note: '全国假日，适合秋季护肤、成分安全和合规资料内容' },
        { date: '2026-10-31', name: 'Reformation Day 宗教改革日（部分州）', note: '区域假期，适合轻量品牌露出' },
      ],
    },
    indonesia: {
      name: '印尼',
      holidays: [
        { date: '2026-08-17', name: 'Independence Day 印尼独立日', note: '红白视觉、直播促销和 TikTok Shop 套装备货节点' },
        { date: '2026-08-25', name: 'Mawlid / Maulid Nabi 先知诞辰', note: '宗教节日，适合礼赠和温和表达，避免激进促销' },
        { date: '2026-12-25', name: 'Christmas Day 圣诞节', note: '礼盒和年末大促节点，需提前 6-8 周准备素材' },
      ],
    },
  };
}

async function executeHolidayPush(_task: ScheduledTask): Promise<string> {
  const enterprise = readEnterpriseProfile();
  const rawMarkets = splitTextList(enterprise.company?.mainMarkets || enterprise.strategy?.focusMarkets);
  const keys = Array.from(new Set(rawMarkets.map(marketKey))).filter(Boolean);
  const catalog = holidayCatalog();
  const selectedKeys = keys.filter(key => key in catalog);
  const markets = selectedKeys.length ? selectedKeys : ['us', 'saudi', 'uae', 'germany', 'indonesia'];
  const now = new Date();
  const horizonDays = 120;
  const sourceText = rawMarkets.length ? rawMarkets.join('、') : '美国、沙特、阿联酋、德国、印尼';

  const lines = [
    `【节日推品提醒】基于企业中心主要市场：${sourceText}`,
    `时间窗口：未来 ${horizonDays} 天；生成日期：${now.toLocaleDateString('zh-CN')}`,
    '',
  ];

  for (const key of markets) {
    const market = catalog[key];
    const upcoming = market.holidays
      .map(holiday => ({ ...holiday, diff: daysUntil(holiday.date, now) }))
      .filter(holiday => holiday.diff >= 0 && holiday.diff <= horizonDays);
    const holidays = upcoming.length ? upcoming : market.holidays
      .map(holiday => ({ ...holiday, diff: daysUntil(holiday.date, now) }))
      .filter(holiday => holiday.diff >= 0)
      .slice(0, 1);

    lines.push(`【${market.name}】`);
    for (const holiday of holidays) {
      lines.push(`- ${holiday.date}（${holiday.diff} 天后）${holiday.name}：${holiday.note}`);
    }
    lines.push(`  推品建议：${pickProducts(key, enterprise)}`);
    lines.push(`  文案语言：${marketLanguage(key, enterprise)}；动作：提前准备 2 条社媒预热内容、1 版询盘跟进话术、1 版老客唤醒消息。`);
    lines.push('');
  }

  lines.push('优先级建议：7 天内节日先处理库存和老客触达；30-60 天节日准备短视频素材和达人 brief；60 天以上节日先沉淀选品清单和多语言标签需求。');
  return lines.join('\n').trim();
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

function normalizeCrawlerLimit(value: unknown): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '5';
  return String(Math.max(1, Math.min(10, Math.round(numeric))));
}

function normalizeCrawlerConfig(config: Record<string, string>, fallbackPlatform = 'youtube'): Record<string, string> {
  const platform = String(config.platforms || fallbackPlatform).toLowerCase().includes('tiktok') ? 'tiktok' : 'youtube';
  const keywords = String(config.keywords || config.keyword || 'skincare').trim() || 'skincare';
  return {
    ...config,
    platforms: platform,
    keywords,
    limit: normalizeCrawlerLimit(config.limit),
  };
}

async function executeVideoKeywordCrawl(task: ScheduledTask): Promise<string> {
  const tenantId = await resolveSchedulerTenantId(task);
  const platforms = splitConfigList(task.config.platforms, ['youtube'])
    .filter((platform): platform is Platform => ['youtube', 'tiktok'].includes(platform));
  const keywords = splitConfigList(task.config.keywords || task.config.keyword, ['skincare']);
  const limit = Math.max(1, Math.min(10, Number(task.config.limit || 5) || 5));
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
  if (task.taskType === 'holiday_push') return executeHolidayPush(task);
  if (isDemoMode()) {
    switch (task.taskType) {
      case 'trend_report':
        return '【Demo 趋势简报】今日建议围绕占位行业模板补充 3 条短视频选题：痛点开场、工厂实力背书、客户案例转化。真实平台数据接入后，这里会替换为 TikTok/Instagram/Shopify 数据分析。';
      case 'weekly_review':
        return '【Demo 周报】本周模拟数据：流量增长 18%，询盘转化率 12%，老客唤醒 6 人。建议下周优先完善真实商品库与渠道授权。';
      case 'exchange_rate':
        return '【汇率日报】USD/CNY 7.20 | USD/AED 3.67 | USD/SAR 3.75。启用实时汇率源后将自动刷新。';
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
  const tasks = load().filter(t => t.enabled && t.tenantId);
  tasks.forEach(scheduleTask);
  console.log('[scheduler] initialized with', tasks.length, 'active tasks');
}

export const schedulerRouter = Router();
schedulerRouter.use(requireAuth);

schedulerRouter.get('/', (_req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  res.json(tenantTasks(tenantId));
});

schedulerRouter.get('/video-stats', async (_req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const tasks = tenantTasks(tenantId).filter(task => task.taskType === 'video_keyword_crawl');
  let stats: Record<string, unknown>;
  try {
    stats = await getVideoPipelineStats(tenantId);
  } catch (e) {
    console.warn('[scheduler] video stats unavailable:', e instanceof Error ? e.message : e);
    stats = { total: 0, byPlatform: {}, byStatus: {}, ops: { workerEnabled: false } };
  }
  res.json({
    tasks,
    stats,
  });
});

schedulerRouter.get('/:id/export-pdf', async (req: Request, res: Response) => {
  const { tenantId } = res.locals as AuthLocals;
  const task = findTenantTask(req.params.id, tenantId);
  if (!task) { res.status(404).json({ error: 'not found' }); return; }
  try {
    const resultText = task.lastResult || '暂无执行结果，请先执行任务后再导出。';
    const pdf = await renderTaskReportPdf({
      title: `${task.name}报告`,
      taskName: task.name,
      cronLabel: task.cronLabel,
      lastRunLabel: formatTaskTime(task.lastRun),
      resultText,
      actions: taskReportActions(task.taskType),
    });
    const filename = encodeURIComponent(`${task.name}-任务报告.pdf`);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${filename}`);
    res.send(pdf);
  } catch (e) {
    console.error('[scheduler] export pdf failed:', e);
    res.status(500).json({ error: e instanceof Error ? e.message : 'PDF export failed' });
  }
});

schedulerRouter.post('/', (req: Request, res: Response) => {
  const { tenantId } = res.locals as AuthLocals;
  const tasks = load();
  const isVideoCrawler = req.body.taskType === 'video_keyword_crawl';
  const crawlerPlatform = String(req.body.config?.platforms || '').toLowerCase().includes('tiktok') ? 'tiktok' : 'youtube';
  const crawlerConfig = normalizeCrawlerConfig({ ...(req.body.config ?? {}), tenantId }, crawlerPlatform);
  const task: ScheduledTask = {
    id: `task_${Date.now()}`,
    name: req.body.name,
    category: req.body.category ?? 'daily',
    taskType: req.body.taskType ?? 'custom',
    cronExpr: isVideoCrawler ? '0 1 * * *' : (req.body.cronExpr ?? '0 8 * * *'),
    cronLabel: isVideoCrawler ? '每天 01:00（北京时间）' : (req.body.cronLabel ?? '每天 08:00'),
    enabled: req.body.enabled ?? true,
    channelId: req.body.channelId,
    config: isVideoCrawler ? crawlerConfig : (req.body.config ?? {}),
    tenantId,
    createdAt: new Date().toISOString(),
  };
  tasks.push(task);
  save(tasks);
  scheduleTask(task);
  res.json(task);
});

schedulerRouter.put('/:id', (req: Request, res: Response) => {
  const { tenantId } = res.locals as AuthLocals;
  const tasks = load();
  const idx = tasks.findIndex(t => t.id === req.params.id && t.tenantId === tenantId);
  if (idx === -1) { res.status(404).json({ error: 'not found' }); return; }
  const current = tasks[idx];
  const nextTaskType = req.body.taskType ?? current.taskType;
  const nextConfig = nextTaskType === 'video_keyword_crawl'
    ? normalizeCrawlerConfig({ ...current.config, ...(req.body.config ?? {}) }, current.config.platforms || 'youtube')
    : (req.body.config ?? current.config);
  tasks[idx] = {
    ...current,
    ...req.body,
    tenantId,
    cronExpr: nextTaskType === 'video_keyword_crawl' ? '0 1 * * *' : (req.body.cronExpr ?? current.cronExpr),
    cronLabel: nextTaskType === 'video_keyword_crawl' ? '每天 01:00（北京时间）' : (req.body.cronLabel ?? current.cronLabel),
    config: nextTaskType === 'video_keyword_crawl' ? { ...nextConfig, tenantId } : nextConfig,
  };
  save(tasks);
  scheduleTask(tasks[idx]);
  res.json(tasks[idx]);
});

schedulerRouter.delete('/:id', (req: Request, res: Response) => {
  const { tenantId } = res.locals as AuthLocals;
  const task = findTenantTask(req.params.id, tenantId);
  if (!task) { res.status(404).json({ error: 'not found' }); return; }
  activeJobs.get(req.params.id)?.stop();
  activeJobs.delete(req.params.id);
  save(load().filter(t => !(t.id === req.params.id && t.tenantId === tenantId)));
  res.json({ ok: true });
});

// Run immediately
schedulerRouter.post('/:id/run', async (req: Request, res: Response) => {
  const { tenantId } = res.locals as AuthLocals;
  const task = findTenantTask(req.params.id, tenantId);
  if (!task) { res.status(404).json({ error: 'not found' }); return; }
  const result = await executeTask(task).catch(e => `执行失败: ${e.message}`);
  const tasks = load();
  const idx = tasks.findIndex(t => t.id === req.params.id && t.tenantId === tenantId);
  if (idx !== -1) { tasks[idx].lastRun = new Date().toISOString(); tasks[idx].lastResult = result; save(tasks); }
  res.json({ ok: true, result });
});

// Toggle enabled
schedulerRouter.post('/:id/toggle', (req: Request, res: Response) => {
  const { tenantId } = res.locals as AuthLocals;
  const tasks = load();
  const idx = tasks.findIndex(t => t.id === req.params.id && t.tenantId === tenantId);
  if (idx === -1) { res.status(404).json({ error: 'not found' }); return; }
  tasks[idx].enabled = !tasks[idx].enabled;
  save(tasks);
  scheduleTask(tasks[idx]);
  res.json(tasks[idx]);
});
