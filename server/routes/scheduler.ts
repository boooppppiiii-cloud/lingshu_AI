import { Router, type Request, type Response } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import cron, { type ScheduledTask as CronJob } from 'node-cron';
import { callLLMChatStream } from '../agents/llm.js';
import { buildEnterpriseContext } from './enterprise.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, '../../data/tasks.json');
const ENTERPRISE_FILE = path.join(__dirname, '../../data/enterprise.json');

export interface ScheduledTask {
  id: string;
  name: string;
  category: 'daily' | 'monitor' | 'report' | 'automation';
  taskType: 'trend_report' | 'weekly_review' | 'crm_wakeup' | 'exchange_rate' | 'holiday_push' | 'custom';
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

async function executeTask(task: ScheduledTask): Promise<string> {
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
  });
  activeJobs.set(task.id, job);
}

// Boot: restore active tasks
export function initScheduler() {
  load().filter(t => t.enabled).forEach(scheduleTask);
  console.log('[scheduler] initialized with', load().filter(t => t.enabled).length, 'active tasks');
}

export const schedulerRouter = Router();

schedulerRouter.get('/', (_req, res) => res.json(load()));

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
