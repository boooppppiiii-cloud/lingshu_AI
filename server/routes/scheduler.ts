import { Router, type Request, type Response } from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { randomUUID } from 'node:crypto';
import cron, { type ScheduledTask as CronJob } from 'node-cron';
import { callLLMChatStream } from '../agents/llm.js';
import { buildEnterpriseContext, readTenantEnterpriseProfile } from './enterprise.js';
import { store } from '../storage/index.js';
import { crawlImagePostsForTenant, crawlVideosForTenant, getVideoPipelineStats } from './videos.js';
import { createCrawlWorkerJob } from './crawlWorker.js';
import type { Platform } from '../types/index.js';
import { requireAuth, type AuthLocals } from '../middleware/auth.js';
import { normalizeKeywordInput, type KeywordPlatform } from '../../src/lib/keywordInput.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, '../../data/tasks.json');
const PDF_SCRIPT = path.join(__dirname, '../../scripts/render-task-report-pdf.py');

export interface ScheduledTask {
  id: string;
  name: string;
  category: 'daily' | 'monitor' | 'report' | 'automation';
  taskType: 'trend_report' | 'weekly_review' | 'crm_wakeup' | 'exchange_rate' | 'holiday_push' | 'video_keyword_crawl' | 'image_post_crawl' | 'competitor_account_crawl' | 'custom';
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
  fs.mkdirSync(path.dirname(DATA), { recursive: true });
  fs.writeFileSync(DATA, JSON.stringify(tasks, null, 2));
  void mirrorTasksToPocketBase(tasks).catch(error => {
    console.error('[scheduler] PocketBase task mirror failed:', error instanceof Error ? error.message : error);
  });
}

function taskPayload(task: ScheduledTask): Record<string, unknown> {
  return {
    task_id: task.id,
    tenant_id: task.tenantId || '',
    name: task.name,
    category: task.category,
    task_type: task.taskType,
    cron_expr: task.cronExpr,
    cron_label: task.cronLabel,
    enabled: task.enabled,
    channel_id: task.channelId || '',
    config: task.config || {},
    last_run: task.lastRun || '',
    last_result: task.lastResult || '',
    created_at: task.createdAt,
  };
}

function taskFromRecord(record: Record<string, any>): ScheduledTask | null {
  const id = String(record.task_id || '').trim();
  const tenantId = String(record.tenant_id || '').trim();
  if (!id || !tenantId) return null;
  return {
    id,
    tenantId,
    name: String(record.name || id),
    category: (record.category || 'daily') as ScheduledTask['category'],
    taskType: (record.task_type || 'custom') as ScheduledTask['taskType'],
    cronExpr: String(record.cron_expr || '0 8 * * *'),
    cronLabel: String(record.cron_label || '每天 08:00'),
    enabled: record.enabled !== false,
    channelId: String(record.channel_id || '') || undefined,
    config: record.config && typeof record.config === 'object' ? record.config : {},
    lastRun: String(record.last_run || '') || undefined,
    lastResult: String(record.last_result || '') || undefined,
    createdAt: String(record.created_at || record.created || new Date().toISOString()),
  };
}

async function allRemoteTasks(): Promise<Array<Record<string, any>>> {
  const items: Array<Record<string, any>> = [];
  let page = 1;
  while (page <= 50) {
    const result = await store.list<Record<string, any>>('scheduled_tasks', { page, perPage: 100, sort: 'created_at' });
    items.push(...result.items);
    if (page >= result.totalPages || result.items.length < 100) break;
    page += 1;
  }
  return items;
}

async function mirrorTasksToPocketBase(tasks: ScheduledTask[]): Promise<void> {
  const remote = await allRemoteTasks();
  const remoteByTaskId = new Map(remote.map(record => [String(record.task_id || ''), record]));
  const localIds = new Set(tasks.map(task => task.id));
  for (const task of tasks) {
    if (!task.tenantId) continue;
    const existing = remoteByTaskId.get(task.id);
    if (existing?.id) await store.update('scheduled_tasks', existing.id, taskPayload(task));
    else await store.create('scheduled_tasks', taskPayload(task));
  }
  for (const record of remote) {
    if (record.id && record.task_id && !localIds.has(String(record.task_id))) {
      await store.delete('scheduled_tasks', String(record.id));
    }
  }
}

async function hydrateTasksFromPocketBase(): Promise<ScheduledTask[]> {
  try {
    const remote = (await allRemoteTasks()).map(taskFromRecord).filter((task): task is ScheduledTask => Boolean(task));
    if (!remote.length) return load();
    fs.mkdirSync(path.dirname(DATA), { recursive: true });
    fs.writeFileSync(DATA, JSON.stringify(remote, null, 2));
    return remote;
  } catch (error) {
    console.warn('[scheduler] using local task snapshot:', error instanceof Error ? error.message : error);
    return load();
  }
}

function tenantTasks(tenantId: string): ScheduledTask[] {
  return load().filter(task => task.tenantId === tenantId);
}

function findTenantTask(id: string, tenantId: string): ScheduledTask | undefined {
  return load().find(task => task.id === id && task.tenantId === tenantId);
}
async function tenantEnterpriseProfile(task: ScheduledTask): Promise<Awaited<ReturnType<typeof readTenantEnterpriseProfile>> | null> {
  if (!task.tenantId) return null;
  try { return await readTenantEnterpriseProfile(task.tenantId); }
  catch { return null; }
}

async function getEnterpriseCtx(task: ScheduledTask): Promise<string> {
  try {
    const profile = await tenantEnterpriseProfile(task);
    return profile ? buildEnterpriseContext(profile) : '';
  }
  catch { return ''; }
}

function taskReportActions(taskType: string): TaskReportAction[] {
  if (taskType === 'holiday_push') {
    return [
      { label: '整理节日前 7 天主推 SKU 与库存水位', agentLabel: '首页' },
      { label: '生成社媒预热脚本和短视频内容方向', agentLabel: '我的社媒' },
      { label: '生成私域触达话术并安排近 90 天询盘跟进', agentLabel: '我的客户' },
    ];
  }
  if (taskType === 'trend_report') {
    return [
      { label: '把高频话题转成 3 条 TikTok 脚本方向', agentLabel: '我的社媒' },
      { label: '挑选 2 个产品卖点做 A/B 内容测试', agentLabel: '我的社媒' },
      { label: '将适配市场和语言写回企业中心学习记录', agentLabel: '首页' },
    ];
  }
  if (['video_keyword_crawl', 'image_post_crawl', 'competitor_account_crawl'].includes(taskType)) {
    return [
      { label: '查看新入库视频并筛选可复用素材', agentLabel: '我的社媒' },
      { label: '选择高互动视频生成克隆脚本', agentLabel: '我的社媒' },
      { label: '复盘失败下载链接并补充关键词', agentLabel: '首页' },
    ];
  }
  if (taskType === 'exchange_rate') {
    return [
      { label: '生成多币种询盘报价话术', agentLabel: '我的客户' },
      { label: '更新报价风险和利润提醒', agentLabel: '首页' },
      { label: '整理老客补货报价提醒', agentLabel: '我的客户' },
    ];
  }
  if (taskType === 'weekly_review') {
    return [
      { label: '拆解下周社媒内容任务', agentLabel: '我的社媒' },
      { label: '生成询盘转化跟进动作', agentLabel: '我的客户' },
      { label: '生成老客复购唤醒动作', agentLabel: '我的客户' },
    ];
  }
  if (taskType === 'crm_wakeup') {
    return [
      { label: '生成老客唤醒分层和触达节奏', agentLabel: '我的客户' },
      { label: '生成 WhatsApp 跟进话术', agentLabel: '我的客户' },
      { label: '生成复购内容素材方向', agentLabel: '我的社媒' },
    ];
  }
  return [{ label: '交给首页拆解后续任务', agentLabel: '首页' }];
}

function pdfPythonPath(): string {
  const bundled = path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3');
  if (fs.existsSync(bundled)) return bundled;
  return process.env.PYTHON || 'python3';
}

function formatTaskTime(value?: string): string {
  return value ? new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '暂无';
}

interface WeeklyVideoReport {
  rangeLabel: string;
  startAt: string;
  endAt: string;
  newVideos: number;
  completed: number;
  exactCompleted: number;
  analyzing: number;
  queued: number;
  basicOnly: number;
  failed: number;
  byPlatform: Array<{ platform: string; newVideos: number; completed: number; processing: number; basicOnly: number; failed: number }>;
}

export function beijingWeekWindow(nowMs = Date.now()): { startMs: number; endMs: number; rangeLabel: string } {
  const offsetMs = 8 * 60 * 60 * 1000;
  const beijingNow = new Date(nowMs + offsetMs);
  const daysSinceMonday = (beijingNow.getUTCDay() + 6) % 7;
  const startMs = Date.UTC(
    beijingNow.getUTCFullYear(),
    beijingNow.getUTCMonth(),
    beijingNow.getUTCDate() - daysSinceMonday,
  ) - offsetMs;
  const label = (value: number, withTime = false) => new Date(value).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    ...(withTime ? { hour: '2-digit', minute: '2-digit', hour12: false } : {}),
  });
  return {
    startMs,
    endMs: nowMs,
    rangeLabel: `${label(startMs)} 00:00 至 ${label(nowMs, true)}（北京时间，本周一开始）`,
  };
}

function schedulerVideoAnalysis(record: Record<string, unknown>): Record<string, unknown> {
  try {
    const value = record.aiAnalysis;
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
    const parsed = JSON.parse(String(value || '{}')) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

async function weeklyVideoReport(task: ScheduledTask, tenantId: string): Promise<WeeklyVideoReport> {
  const window = beijingWeekWindow();
  const configuredPlatforms = new Set(splitTextList(task.config.platforms).map(item => item.toLowerCase()));
  const records: Record<string, unknown>[] = [];
  let page = 1;
  let totalPages = 1;
  do {
    const result = await store.list<Record<string, unknown>>('trend_videos', {
      where: { tenantId, contentFormat: 'video' },
      sort: '-crawledAt',
      page,
      perPage: 100,
    });
    records.push(...result.items);
    totalPages = Math.max(1, result.totalPages || 1);
    page += 1;
  } while (page <= totalPages && page <= 50);

  const seen = new Set<string>();
  const weekly = records.filter(record => {
    const platform = String(record.platform || '').toLowerCase();
    if (configuredPlatforms.size && !configuredPlatforms.has(platform)) return false;
    const crawledAt = Date.parse(String(record.crawledAt || ''));
    if (!Number.isFinite(crawledAt) || crawledAt < window.startMs || crawledAt > window.endMs) return false;
    const sourceKey = String(record.sourceUrl || record.id || '').trim();
    if (sourceKey && seen.has(sourceKey)) return false;
    if (sourceKey) seen.add(sourceKey);
    return true;
  });

  const platformStats = new Map<string, { newVideos: number; completed: number; processing: number; basicOnly: number; failed: number }>();
  let completed = 0;
  let exactCompleted = 0;
  let analyzing = 0;
  let queued = 0;
  let basicOnly = 0;
  let failed = 0;

  for (const record of weekly) {
    const analysis = schedulerVideoAnalysis(record);
    const platform = String(record.platform || 'unknown').toLowerCase();
    const row = platformStats.get(platform) || { newVideos: 0, completed: 0, processing: 0, basicOnly: 0, failed: 0 };
    row.newVideos += 1;
    const recordStatus = String(record.status || '');
    const downloadStatus = String(analysis.downloadStatus || '');
    const geminiStatus = String(analysis.geminiStatus || '');
    const isFailed = recordStatus === 'failed'
      || ['failed', 'manual_required'].includes(downloadStatus)
      || ['video_failed', 'ops_failed'].includes(geminiStatus);
    const isCompleted = !isFailed
      && analysis.analysisQuality === 'video'
      && Boolean(analysis.gemini)
      && (!geminiStatus || geminiStatus === 'analyzed');
    const isAnalyzing = !isFailed && !isCompleted && ['downloading', 'analyzing'].includes(downloadStatus);
    const isQueued = !isFailed && !isCompleted && !isAnalyzing
      && ['queued', 'download_retrying', 'ops_queued'].includes(downloadStatus);

    if (isFailed) { failed += 1; row.failed += 1; }
    else if (isCompleted) {
      completed += 1;
      row.completed += 1;
      if (analysis.analysisMode === 'exact') exactCompleted += 1;
    } else if (isAnalyzing) { analyzing += 1; row.processing += 1; }
    else if (isQueued) { queued += 1; row.processing += 1; }
    else { basicOnly += 1; row.basicOnly += 1; }
    platformStats.set(platform, row);
  }

  return {
    rangeLabel: window.rangeLabel,
    startAt: new Date(window.startMs).toISOString(),
    endAt: new Date(window.endMs).toISOString(),
    newVideos: weekly.length,
    completed,
    exactCompleted,
    analyzing,
    queued,
    basicOnly,
    failed,
    byPlatform: [...platformStats.entries()].map(([platform, values]) => ({ platform, ...values })),
  };
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
const runningTaskIds = new Set<string>();

async function executeTrendReport(task: ScheduledTask): Promise<string> {
  const enterpriseCtx = await getEnterpriseCtx(task);
  const messages = [{ role: 'user' as const, content: '生成今日TikTok跨境电商爆款趋势简报，包括：热门品类、热门话题标签、建议借势策略，控制在300字以内' }];
  let result = '';
  for await (const chunk of callLLMChatStream(messages, { systemPrompt: `你是跨境电商趋势分析师。${enterpriseCtx ? '\n\n企业信息：' + enterpriseCtx : ''}` })) {
    if ('text' in chunk) result += chunk.text;
  }
  return result;
}

async function executeWeeklyReview(task: ScheduledTask): Promise<string> {
  const enterpriseCtx = await getEnterpriseCtx(task);
  const messages = [{ role: 'user' as const, content: '生成本周跨境电商经营复盘报告：流量表现、询盘转化、老客复购情况，并给出下周行动建议，控制在500字' }];
  let result = '';
  for await (const chunk of callLLMChatStream(messages, { systemPrompt: `你是跨境电商经营顾问。${enterpriseCtx ? '\n\n企业信息：' + enterpriseCtx : ''}` })) {
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

async function executeHolidayPush(task: ScheduledTask): Promise<string> {
  const enterprise: Record<string, any> = await tenantEnterpriseProfile(task) || {};
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

async function executeCrmWakeup(task: ScheduledTask): Promise<string> {
  const enterpriseCtx = await getEnterpriseCtx(task);
  const messages = [{ role: 'user' as const, content: '请生成一段针对60天未复购老客的唤醒消息，要有温度感，适合通过WhatsApp发送，不超过100字' }];
  let result = '';
  for await (const chunk of callLLMChatStream(messages, { systemPrompt: `你是跨境电商CRM专员。${enterpriseCtx ? '\n\n企业信息：' + enterpriseCtx : ''}` })) {
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

function resolveCrawlerPlatform(raw: unknown, fallback = 'youtube'): string {
  const value = String(raw || fallback).toLowerCase();
  for (const p of ['tiktok', 'facebook', 'instagram'] as const) {
    if (value.includes(p)) return p;
  }
  return 'youtube';
}

function normalizeCrawlerConfig(config: Record<string, string>, fallbackPlatform = 'youtube'): Record<string, string> {
  const platform = resolveCrawlerPlatform(config.platforms, fallbackPlatform);
  const rawKeywords = String(config.keywords || config.keyword || 'skincare').trim() || 'skincare';
  const normalized = normalizeKeywordInput(rawKeywords, platform as KeywordPlatform);
  return {
    ...config,
    platforms: platform,
    keywords: normalized.serialized || 'skincare',
    limit: normalizeCrawlerLimit(config.limit),
  };
}

function normalizedKeywordList(value: string | undefined, platform: Platform, fallback = ['skincare']): string[] {
  const normalized = normalizeKeywordInput(String(value || ''), platform as KeywordPlatform);
  return normalized.items.length > 0 ? normalized.items : fallback;
}

async function executeVideoKeywordCrawl(task: ScheduledTask): Promise<string> {
  const tenantId = await resolveSchedulerTenantId(task);
  const platforms = splitConfigList(task.config.platforms, ['youtube'])
    .filter((platform): platform is Platform => ['youtube', 'tiktok', 'facebook', 'instagram'].includes(platform));
  const displayedKeywords = new Set<string>();
  const limit = Math.max(1, Math.min(10, Number(task.config.limit || 5) || 5));
  const { dateFrom, dateTo } = beijingDateRange(task.config.dateWindowDays);
  const lines: string[] = [];
  let imported = 0;
  let returned = 0;
  let existing = 0;
  let succeeded = 0;
  let failed = 0;
  let queued = 0;
  const workerBatch = `scheduler:${task.id}:run:${randomUUID()}`;

  for (const platform of platforms) {
    const keywords = normalizedKeywordList(task.config.keywords || task.config.keyword, platform);
    for (const keyword of keywords) {
      displayedKeywords.add(keyword);
      try {
        if (platform === 'youtube' && task.config.localWorker !== '0') {
          const job = await createCrawlWorkerJob({
            tenantId,
            requestedBy: workerBatch,
            platform,
            mode: 'keyword',
            keyword,
            limit,
          });
          if (!job) throw new Error('Mac 本地采集任务创建失败');
          queued += 1;
          lines.push(`${platform} / ${keyword}: 已提交 Mac 登录态采集队列（1 个任务）`);
          continue;
        }
        const result = await crawlVideosForTenant({
          tenantId,
          platform,
          keyword,
          limit,
          dateFrom,
          dateTo,
          disableBackfill: task.config.smokeTest === '1',
        });
        if (result.items.length === 0 && result.imported === 0 && /未找到|无可用|失败|blocked|degraded/i.test(result.message)) {
          throw new Error(result.message);
        }
        imported += result.imported;
        returned += result.items.length;
        existing += result.returnedExisting;
        succeeded += 1;
        lines.push(`${platform} / ${keyword}: 当前可见 ${result.items.length} 条，新增候选 ${result.imported} 条，库内已有 ${result.returnedExisting} 条`);
      } catch (e) {
        failed += 1;
        lines.push(`${platform} / ${keyword}: 执行失败 - ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  return [
    `【视频关键词自动采集】${dateFrom} 至 ${dateTo}`,
    `执行状态：${queued > 0 ? `已排队（${queued} 组等待 Worker）` : succeeded > 0 ? '执行成功' : '执行失败'}${failed > 0 ? `（另有 ${failed} 组提交失败）` : ''}`,
    `本次结论：${queued > 0 ? '采集请求已进入队列，Worker 领取后将显示处理中，完成后自动回写最终结果' : succeeded === 0 ? '采集请求均未完成，请根据分组错误处理后重试' : returned + imported + existing > 0 ? '已完成检索并取得可入库或待处理内容' : '已完成检索，本次时间窗口内暂无符合条件的新内容'}`,
    `平台：${platforms.join(', ')}；关键词：${[...displayedKeywords].join('、')}；每组数量：${limit}`,
    `汇总：当前可见 ${returned} 条，新增候选 ${imported} 条，库内已有 ${existing} 条`,
    ...lines,
    ...(queued > 0 ? [`队列批次：${workerBatch}`] : []),
  ].join('\n');
}

async function executeImagePostCrawl(task: ScheduledTask): Promise<string> {
  const tenantId = await resolveSchedulerTenantId(task);
  const platform = resolveCrawlerPlatform(task.config.platforms, 'instagram') as Platform;
  const keywords = normalizedKeywordList(task.config.keywords || task.config.keyword, platform);
  const limit = Math.max(1, Math.min(10, Number(task.config.limit || 5) || 5));
  const lines: string[] = [];
  let imported = 0;
  let succeeded = 0;
  let failed = 0;
  for (const keyword of keywords) {
    try {
      const result = await crawlImagePostsForTenant({ tenantId, platform, keyword, limit });
      if (result.items.length === 0 && result.imported === 0 && /未找到|无可用|失败|blocked|degraded/i.test(result.message)) {
        throw new Error(result.message);
      }
      imported += result.imported;
      succeeded += 1;
      lines.push(`${platform} / ${keyword}: ${result.message}`);
    } catch (e) {
      failed += 1;
      lines.push(`${platform} / ${keyword}: 执行失败 - ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return [
    `【图文自动采集】平台：${platform}；每组数量：${limit}`,
    `执行状态：${succeeded > 0 ? '执行成功' : '执行失败'}${failed > 0 ? `（成功 ${succeeded} 组，失败 ${failed} 组）` : ''}`,
    `本次结论：${succeeded === 0 ? '采集请求均未完成，请根据分组错误处理后重试' : imported > 0 ? `已新增 ${imported} 条图文内容` : '已完成检索，本次暂无符合条件的新图文'}`,
    `汇总：新增 ${imported} 条`, ...lines,
  ].join('\n');
}

async function executeCompetitorAccountCrawl(task: ScheduledTask): Promise<string> {
  const tenantId = await resolveSchedulerTenantId(task);
  const platform = resolveCrawlerPlatform(task.config.platforms) as Platform;
  const limit = Math.max(1, Math.min(30, Number(task.config.limit || 10) || 10));
  const accounts = await store.list<Record<string, unknown>>('competitor_accounts', {
    where: { tenantId, platform }, page: 1, perPage: 200, sort: '-createdAt',
  });
  if (!accounts.items.length) return `【${platform} 对标账号自动采集】\n执行状态：等待账号配置\n本次结论：该平台尚未保存对标账号，添加账号主页后即可执行采集。`;
  const lines: string[] = [];
  let imported = 0;
  let succeeded = 0;
  let failed = 0;
  let queued = 0;
  const workerBatch = `scheduler:${task.id}:run:${randomUUID()}`;
  for (const account of accounts.items) {
    const accountUrl = String(account.accountUrl || '');
    const accountName = String(account.accountName || account.handle || accountUrl);
    try {
      if (platform === 'youtube' && task.config.localWorker !== '0') {
        const job = await createCrawlWorkerJob({
          tenantId,
          requestedBy: workerBatch,
          platform,
          mode: 'account',
          accountUrl,
          accountName,
          limit,
        });
        if (!job) throw new Error('Mac 本地采集任务创建失败');
        queued += 1;
        lines.push(`${accountName}: 已提交 Mac 登录态采集队列（1 个任务）`);
        continue;
      }
      const result = await crawlVideosForTenant({
        tenantId,
        platform,
        mode: 'account',
        accountUrl,
        accountName,
        limit,
        cloudFallback: true,
        disableBackfill: task.config.smokeTest === '1',
      });
      if (result.items.length === 0 && result.imported === 0 && /未找到|无可用|失败|blocked|degraded/i.test(result.message)) {
        throw new Error(result.message);
      }
      imported += result.imported;
      succeeded += 1;
      await store.update('competitor_accounts', String(account.id), { lastCrawledAt: new Date().toISOString(), lastCrawlCount: result.imported });
      lines.push(`${accountName}: 返回 ${result.items.length} 条，新增 ${result.imported} 条`);
    } catch (e) {
      failed += 1;
      lines.push(`${accountName}: 执行失败 - ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return [
    `【${platform} 对标账号自动采集】账号 ${accounts.items.length} 个；每账号最多 ${limit} 条`,
    `执行状态：${queued > 0 ? `已排队（${queued} 个账号等待 Worker）` : succeeded > 0 ? '执行成功' : '执行失败'}${failed > 0 ? `（另有 ${failed} 个账号提交失败）` : ''}`,
    `本次结论：${queued > 0 ? '采集请求已进入队列，Worker 完成后自动回写最终结果' : succeeded === 0 ? '账号采集请求均未完成，请根据账号错误处理后重试' : imported > 0 ? `已新增 ${imported} 条对标内容` : '已完成账号检索，本次暂无新增内容'}`,
    `汇总：新增 ${imported} 条`, ...lines, ...(queued > 0 ? [`队列批次：${workerBatch}`] : []),
  ].join('\n');
}

/** Worker 状态变化后，将同一调度批次的真实执行结果回写到任务面板。 */
export async function reconcileScheduledCrawlBatch(requestedBy: string): Promise<void> {
  const match = /^scheduler:(.+):run:[^:]+$/.exec(requestedBy);
  if (!match) return;
  const taskId = match[1];
  const jobs = await store.list<Record<string, any>>('crawl_jobs', {
    where: { requestedBy }, sort: 'createdAt', page: 1, perPage: 200,
  });
  if (!jobs.items.length) return;
  const counts = { queued: 0, running: 0, done: 0, failed: 0 };
  let imported = 0;
  const details: string[] = [];
  for (const job of jobs.items) {
    const status = String(job.status || 'queued') as keyof typeof counts;
    if (status in counts) counts[status] += 1;
    let result: Record<string, any> = {};
    try { result = job.resultJson ? JSON.parse(String(job.resultJson)) : {}; } catch { /* keep empty */ }
    imported += Number(result.imported || 0);
    const label = String(job.keyword || job.accountName || job.accountUrl || job.platform || '采集任务');
    if (status === 'done') details.push(`${label}: 已完成，新增 ${Number(result.imported || 0)} 条${result.message ? `（${result.message}）` : ''}`);
    else if (status === 'failed') details.push(`${label}: 执行失败 - ${String(job.error || 'worker_failed')}`);
  }
  const pending = counts.queued + counts.running;
  const state = pending > 0
    ? `处理中（排队 ${counts.queued}，执行中 ${counts.running}，已完成 ${counts.done}，失败 ${counts.failed}）`
    : counts.done > 0 && counts.failed === 0 ? '执行成功'
      : counts.done > 0 ? `部分成功（成功 ${counts.done}，失败 ${counts.failed}）` : '执行失败';
  const resultText = [
    '【本地 Worker 采集结果】', `执行状态：${state}`,
    `本次结论：${pending > 0 ? 'Worker 正在处理，完成后会继续自动更新' : counts.done > 0 ? `采集已结束，共新增 ${imported} 条` : '采集任务均执行失败，请检查 Worker 日志后重试'}`,
    `汇总：新增 ${imported} 条；总任务 ${jobs.items.length} 个`, ...details,
    `队列批次：${requestedBy}`,
  ].join('\n');
  const tasks = load();
  const idx = tasks.findIndex(task => task.id === taskId && task.lastResult?.includes(`队列批次：${requestedBy}`));
  if (idx === -1) return; // A newer run already owns the visible result.
  tasks[idx].lastResult = resultText;
  save(tasks);
}

async function executeTask(task: ScheduledTask): Promise<string> {
  if (task.taskType === 'video_keyword_crawl') return executeVideoKeywordCrawl(task);
  if (task.taskType === 'image_post_crawl') return executeImagePostCrawl(task);
  if (task.taskType === 'competitor_account_crawl') return executeCompetitorAccountCrawl(task);
  if (task.taskType === 'holiday_push') return executeHolidayPush(task);
  switch (task.taskType) {
    case 'trend_report':  return executeTrendReport(task);
    case 'weekly_review': return executeWeeklyReview(task);
    case 'exchange_rate': return executeExchangeRate(task);
    case 'crm_wakeup':   return executeCrmWakeup(task);
    default:              return '任务执行完成';
  }
}

async function executeAndPersistTask(task: ScheduledTask, trigger: 'cron' | 'catch-up' | 'manual'): Promise<string> {
  if (runningTaskIds.has(task.id)) return '任务正在执行，请稍后查看结果。';
  runningTaskIds.add(task.id);
  try {
    const result = await executeTask(task).catch(e => `执行失败: ${e instanceof Error ? e.message : String(e)}`);
    const tasks = load();
    const idx = tasks.findIndex(item => item.id === task.id && item.tenantId === task.tenantId);
    if (idx !== -1) {
      tasks[idx].lastRun = new Date().toISOString();
      tasks[idx].lastResult = result;
      save(tasks);
      const workerBatch = /队列批次：(scheduler:.+:run:[^:\s]+)/.exec(result)?.[1];
      if (workerBatch) await reconcileScheduledCrawlBatch(workerBatch);
    }
    console.log(`[scheduler] ${trigger} task "${task.name}" done:`, result.slice(0, 100));
    return result;
  } finally {
    runningTaskIds.delete(task.id);
  }
}

function latestMissedRun(task: ScheduledTask, now = new Date()): Date | null {
  const parts = task.cronExpr.trim().split(/\s+/);
  if (parts.length !== 5 || parts[2] !== '*' || parts[3] !== '*') return null;
  const minute = Number(parts[0]);
  const hour = Number(parts[1]);
  if (!Number.isInteger(minute) || minute < 0 || minute > 59 || !Number.isInteger(hour) || hour < 0 || hour > 23) return null;
  const weekdays = parts[4] === '*'
    ? null
    : new Set(parts[4].split(',').map(Number).filter(day => Number.isInteger(day) && day >= 0 && day <= 7).map(day => day === 7 ? 0 : day));
  if (parts[4] !== '*' && !weekdays?.size) return null;

  const beijingNow = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const year = beijingNow.getUTCFullYear();
  const month = beijingNow.getUTCMonth();
  const day = beijingNow.getUTCDate();
  for (let offset = 0; offset <= 7; offset += 1) {
    const calendarDay = new Date(Date.UTC(year, month, day - offset));
    if (weekdays && !weekdays.has(calendarDay.getUTCDay())) continue;
    const scheduledAt = new Date(Date.UTC(
      calendarDay.getUTCFullYear(), calendarDay.getUTCMonth(), calendarDay.getUTCDate(), hour - 8, minute,
    ));
    if (scheduledAt.getTime() > now.getTime()) continue;
    const previousRun = task.lastRun ? Date.parse(task.lastRun) : 0;
    const createdAt = Date.parse(task.createdAt) || 0;
    if (scheduledAt.getTime() > previousRun && scheduledAt.getTime() >= createdAt) return scheduledAt;
    return null;
  }
  return null;
}

function scheduleTask(task: ScheduledTask) {
  if (activeJobs.has(task.id)) { activeJobs.get(task.id)!.stop(); activeJobs.delete(task.id); }
  if (!task.enabled) return;
  if (!cron.validate(task.cronExpr)) return;

  const job = cron.schedule(task.cronExpr, async () => {
    await executeAndPersistTask(task, 'cron');
  }, { timezone: 'Asia/Shanghai' });
  activeJobs.set(task.id, job);
}

// Boot: restore active tasks
export async function initScheduler() {
  const tasks = (await hydrateTasksFromPocketBase()).filter(t => t.enabled && t.tenantId);
  tasks.forEach(scheduleTask);
  for (const task of tasks) {
    const missedAt = latestMissedRun(task);
    if (!missedAt) continue;
    console.log(`[scheduler] catching up "${task.name}" missed at ${missedAt.toISOString()}`);
    void executeAndPersistTask(task, 'catch-up');
  }
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
  const tasks = tenantTasks(tenantId).filter(task => ['video_keyword_crawl', 'image_post_crawl', 'competitor_account_crawl'].includes(task.taskType));
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
  if (!task.lastRun || !task.lastResult) { res.status(409).json({ error: 'task_has_no_result' }); return; }
  try {
    const isVideoReport = ['video_keyword_crawl', 'competitor_account_crawl'].includes(task.taskType);
    const weekly = isVideoReport ? await weeklyVideoReport(task, tenantId) : null;
    const resultText = weekly
      ? `【本周新增视频】\n统计范围：${weekly.rangeLabel}\n新增视频：${weekly.newVideos} 条\n【分析情况】\n已完成策略分析：${weekly.completed} 条（其中全片精确分析 ${weekly.exactCompleted} 条）\n分析中：${weekly.analyzing} 条；排队中：${weekly.queued} 条\n仅基础分析：${weekly.basicOnly} 条；分析失败：${weekly.failed} 条`
      : task.lastResult;
    const pdf = await renderTaskReportPdf({
      title: `${task.name}报告`,
      taskName: task.name,
      cronLabel: task.cronLabel,
      lastRunLabel: formatTaskTime(task.lastRun),
      weekRangeLabel: weekly?.rangeLabel,
      weeklyStats: weekly,
      resultText,
      actions: taskReportActions(task.taskType),
    });
    const filename = encodeURIComponent(`${task.name}-任务报告.pdf`);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${filename}`);
    res.send(pdf);
  } catch (e) {
    console.error('[scheduler] export pdf failed:', e);
    res.status(500).json({ error: 'pdf_render_unavailable' });
  }
});

schedulerRouter.post('/', (req: Request, res: Response) => {
  const { tenantId } = res.locals as AuthLocals;
  const tasks = load();
  const isCrawler = ['video_keyword_crawl', 'image_post_crawl', 'competitor_account_crawl'].includes(req.body.taskType);
  const requestedCronExpr = String(req.body.cronExpr ?? (isCrawler ? '0 1 * * *' : '0 8 * * *'));
  if (!cron.validate(requestedCronExpr)) { res.status(400).json({ error: '无效的任务启动时间' }); return; }
  const crawlerPlatform = resolveCrawlerPlatform(req.body.config?.platforms);
  if (['video_keyword_crawl', 'image_post_crawl'].includes(req.body.taskType)) {
    const keywordReview = normalizeKeywordInput(String(req.body.config?.keywords || req.body.config?.keyword || ''), crawlerPlatform as KeywordPlatform);
    if (!keywordReview.items.length) {
      res.status(400).json({ error: 'invalid_keywords', message: '没有识别到当前平台可用的关键词', rejected: keywordReview.rejected });
      return;
    }
  }
  const crawlerConfig = normalizeCrawlerConfig({ ...(req.body.config ?? {}), tenantId }, crawlerPlatform);
  const task: ScheduledTask = {
    id: `task_${Date.now()}`,
    name: req.body.name,
    category: req.body.category ?? 'daily',
    taskType: req.body.taskType ?? 'custom',
    cronExpr: requestedCronExpr,
    cronLabel: req.body.cronLabel ?? (isCrawler ? '每天 01:00（北京时间）' : '每天 08:00'),
    enabled: req.body.enabled ?? true,
    channelId: req.body.channelId,
    config: isCrawler ? crawlerConfig : (req.body.config ?? {}),
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
  const requestedCronExpr = String(req.body.cronExpr ?? current.cronExpr);
  if (!cron.validate(requestedCronExpr)) { res.status(400).json({ error: '无效的任务启动时间' }); return; }
  const nextIsCrawler = ['video_keyword_crawl', 'image_post_crawl', 'competitor_account_crawl'].includes(nextTaskType);
  const mergedConfig = { ...current.config, ...(req.body.config ?? {}) };
  if (['video_keyword_crawl', 'image_post_crawl'].includes(nextTaskType)) {
    const platform = resolveCrawlerPlatform(mergedConfig.platforms, current.config.platforms || 'youtube');
    const keywordReview = normalizeKeywordInput(String(mergedConfig.keywords || mergedConfig.keyword || ''), platform as KeywordPlatform);
    if (!keywordReview.items.length) {
      res.status(400).json({ error: 'invalid_keywords', message: '没有识别到当前平台可用的关键词', rejected: keywordReview.rejected });
      return;
    }
  }
  const nextConfig = nextIsCrawler
    ? normalizeCrawlerConfig(mergedConfig, current.config.platforms || 'youtube')
    : (req.body.config ?? current.config);
  tasks[idx] = {
    ...current,
    ...req.body,
    tenantId,
    cronExpr: requestedCronExpr,
    cronLabel: req.body.cronLabel ?? current.cronLabel,
    config: nextIsCrawler ? { ...nextConfig, tenantId } : nextConfig,
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
  const result = await executeAndPersistTask(task, 'manual');
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
