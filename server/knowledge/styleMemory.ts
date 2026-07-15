import { store } from '../storage/index.js';
import { callLLM } from '../agents/llm.js';
import { readEnterpriseProfile, updateEnterpriseProfile, type SalesStyleProfile } from '../routes/enterprise.js';

const COLLECTION = 'style_memory';

export interface StyleMemoryRecord {
  id: string;
  tenant_id: string;
  customer_id?: string;
  trigger_message: string;
  draft_original: string;
  final_sent: string;
  edited: boolean;
  category: string;
  outcome?: string;
  created?: string;
}

interface WriteStyleMemoryInput {
  tenantId: string;
  customerId?: string;
  triggerMessage: string;
  draftOriginal: string;
  finalSent: string;
  edited: boolean;
  category: string;
}

const PHONE_RE = /(?:\+?\d[\d\s().-]{7,}\d)/g;
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const ADDRESS_RE = /\b(?:street|st\.|road|rd\.|avenue|ave\.|building|floor|room|suite|district|province|city)\b[^。.!?\n]{0,80}/gi;

function text(value: unknown): string {
  return String(value ?? '').trim();
}

export function sanitizeStyleText(value: unknown): string {
  return text(value)
    .replace(EMAIL_RE, '[邮箱]')
    .replace(PHONE_RE, '[电话]')
    .replace(ADDRESS_RE, '[地址]')
    .slice(0, 3000);
}

function tokenize(value: string): string[] {
  return Array.from(new Set(
    sanitizeStyleText(value)
      .normalize('NFKC')
      .toLowerCase()
      .split(/[^a-z0-9\u4e00-\u9fff]+/i)
      .map(item => item.trim())
      .filter(item => item.length >= 2),
  ));
}

function overlapScore(a: string, b: string): number {
  const left = tokenize(a);
  const right = new Set(tokenize(b));
  return left.reduce((sum, token) => sum + (right.has(token) ? 1 : 0), 0);
}

function memoryWeight(item: StyleMemoryRecord, message: string): number {
  const won = item.outcome === 'won';
  return (won && item.edited ? 1000 : won ? 800 : item.edited ? 500 : 0) + overlapScore(item.trigger_message, message);
}

export async function recordStyleMemory(input: WriteStyleMemoryInput): Promise<void> {
  const tenantId = text(input.tenantId);
  const draftOriginal = sanitizeStyleText(input.draftOriginal);
  const finalSent = sanitizeStyleText(input.finalSent);
  const triggerMessage = sanitizeStyleText(input.triggerMessage);
  const category = text(input.category) || 'reply';
  if (!tenantId || !draftOriginal || !finalSent || !triggerMessage) return;
  await store.create(COLLECTION, {
    tenant_id: tenantId,
    customer_id: text(input.customerId),
    trigger_message: triggerMessage,
    draft_original: draftOriginal,
    final_sent: finalSent,
    edited: Boolean(input.edited),
    category,
    outcome: '',
  });
  await updateWeeklyStyleAdoption(tenantId, Boolean(input.edited));
}

function weekKey(date = new Date()): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

async function updateWeeklyStyleAdoption(tenantId: string, edited: boolean): Promise<void> {
  const week = weekKey();
  const result = await store.list<any>('style_adoption_stats', { where: { tenant_id: tenantId, week }, perPage: 1 });
  const current = result.items[0];
  const total = Number(current?.total || 0) + 1;
  const direct = Number(current?.direct_sent || 0) + (edited ? 0 : 1);
  const payload = { tenant_id: tenantId, week, total: String(total), direct_sent: String(direct), rate: String(total ? direct / total : 0) };
  if (current?.id) await store.update('style_adoption_stats', current.id, payload);
  else await store.create('style_adoption_stats', payload);
}

export async function retrieveStyleMemories(tenantId: string, category: string, message: string): Promise<StyleMemoryRecord[]> {
  const result = await store.list<StyleMemoryRecord>(COLLECTION, {
    where: { tenant_id: tenantId, category: category || 'reply' },
    sort: '-created',
    perPage: 100,
  });
  const items = result.items.filter(item => item.trigger_message && item.final_sent);
  if (items.length < 5) return [];
  return items
    .sort((a, b) => memoryWeight(b, message) - memoryWeight(a, message))
    .slice(0, 3);
}

export function buildStyleMemoryPromptBlock(items: StyleMemoryRecord[]): string {
  if (!items.length) return '';
  return [
    'Style memory few-shot:',
    '以下是该商家过往对类似问题的实际回复风格，请学习其措辞、称呼与口径；但价格、MOQ、交期、库存、证书等事实性数字必须以当前知识库检索结果为准，历史样本中的数字一律不得复用。',
    ...items.map((item, index) => [
      `Example ${index + 1}${item.outcome === 'won' ? ' outcome=won' : ''}${item.edited ? ' edited=true' : ' edited=false'}:`,
      `Buyer trigger: ${item.trigger_message}`,
      `AI draft zh: ${item.draft_original}`,
      `Seller final zh: ${item.final_sent}`,
    ].join('\n')),
  ].join('\n');
}

export async function markStyleMemoryWonForCustomer(tenantId: string, customerId: string): Promise<number> {
  const since = Date.now() - 30 * 86_400_000;
  const result = await store.list<StyleMemoryRecord>(COLLECTION, {
    where: { tenant_id: tenantId, customer_id: customerId },
    sort: '-created',
    perPage: 200,
  });
  let changed = 0;
  for (const item of result.items) {
    const created = Date.parse(String(item.created || ''));
    if (Number.isFinite(created) && created < since) continue;
    if (item.outcome === 'won') continue;
    if (await store.update(COLLECTION, item.id, { outcome: 'won' })) changed += 1;
  }
  return changed;
}

function parseDistilledJson(raw: string): Partial<SalesStyleProfile> {
  const cleaned = raw.replace(/```json|```/gi, '').trim();
  const match = cleaned.match(/\{[\s\S]*}/);
  if (!match) return {};
  try {
    return JSON.parse(match[0]) as Partial<SalesStyleProfile>;
  } catch {
    return {};
  }
}

function mergeManualProtected(current: SalesStyleProfile, next: SalesStyleProfile): SalesStyleProfile {
  return {
    ...next,
    greeting_style: current.greeting_style?.manual ? current.greeting_style : next.greeting_style,
    quoting_stance: current.quoting_stance?.manual ? current.quoting_stance : next.quoting_stance,
    followup_rhythm: current.followup_rhythm?.manual ? current.followup_rhythm : next.followup_rhythm,
    taboo_phrases: current.taboo_phrases?.manual ? current.taboo_phrases : next.taboo_phrases,
  };
}

export async function distillSalesStyleProfile(tenantId = 'local_tenant_default', force = false): Promise<SalesStyleProfile | null> {
  const profile = readEnterpriseProfile();
  const current = profile.salesStyleProfile ?? { learnedFromCount: 0, sample_pairs: [] };
  if (!force && current.lastDistilledAt && Date.now() - Date.parse(current.lastDistilledAt) < 6 * 86_400_000) return current;
  const result = await store.list<StyleMemoryRecord>(COLLECTION, {
    where: { tenant_id: tenantId, edited: true },
    sort: '-created',
    perPage: 200,
  });
  const samples = result.items.filter(item => item.trigger_message && item.draft_original && item.final_sent);
  if (samples.length < 20) return null;
  const prompt = [
    'You distill a Yiwu seller sales style profile from real edited replies.',
    'Return strict JSON only with keys: greeting_style, quoting_stance, followup_rhythm, taboo_phrases, sample_pairs.',
    'Each of greeting_style/quoting_stance/followup_rhythm must be {"value": "...", "evidence": "one exact sample reason from provided data"}.',
    'taboo_phrases must be {"value": string[], "evidence": "one exact sample reason"}.',
    'sample_pairs must be up to 5 items: {"trigger":"buyer trigger summary","final":"seller final Chinese reply","evidence":"why representative"}.',
    'Do not infer anything without evidence. If evidence is insufficient, keep the value empty.',
    'Never copy phone numbers, emails, or addresses.',
    '',
    samples.slice(0, 80).map((item, index) => [
      `#${index + 1} category=${item.category} outcome=${item.outcome || 'none'}`,
      `trigger: ${item.trigger_message}`,
      `ai_draft: ${item.draft_original}`,
      `seller_final: ${item.final_sent}`,
    ].join('\n')).join('\n\n'),
  ].join('\n');
  const raw = await callLLM(prompt, { backend: 'qwen', model: process.env.STYLE_MEMORY_MODEL || 'qwen-plus' });
  const parsed = parseDistilledJson(raw);
  const distilled: SalesStyleProfile = {
    learnedFromCount: samples.length,
    lastDistilledAt: new Date().toISOString(),
    greeting_style: parsed.greeting_style,
    quoting_stance: parsed.quoting_stance,
    followup_rhythm: parsed.followup_rhythm,
    taboo_phrases: parsed.taboo_phrases,
    sample_pairs: Array.isArray(parsed.sample_pairs) ? parsed.sample_pairs.slice(0, 5) : [],
  };
  const merged = mergeManualProtected(current, distilled);
  updateEnterpriseProfile({ salesStyleProfile: merged } as any);
  return merged;
}

export async function listStyleAdoptionTrends(): Promise<Array<{ tenantId: string; week: string; total: number; directSent: number; rate: number }>> {
  const result = await store.list<any>('style_adoption_stats', { sort: '-week', perPage: 500 });
  return result.items.map(item => ({
    tenantId: String(item.tenant_id || ''),
    week: String(item.week || ''),
    total: Number(item.total || 0),
    directSent: Number(item.direct_sent || 0),
    rate: Number(item.rate || 0),
  })).filter(item => item.tenantId && item.week);
}
