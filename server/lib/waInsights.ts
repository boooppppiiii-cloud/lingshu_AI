import { callLLM } from '../agents/llm.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { store } from '../storage/index.js';
import {
  automationFromScore,
  inboxReasonFor,
  missingFieldsFromText,
  stageFromAutomation,
  WA_DEFAULTS,
  type AutomationLevel,
  type IntentSignal,
} from './waDefaults.js';
import type { CustomerInsightRecord, CustomerRecord } from './waTypes.js';
import { generateSalesDraft } from '../prompts/salesPrompts.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENTERPRISE_FILE = path.join(__dirname, '../../data/enterprise.json');

interface ExtractedInsight {
  language?: string;
  country_guess?: string;
  product?: string;
  quantity?: string;
  budget?: string;
  urgency?: string;
  call_request?: boolean;
  complaint?: boolean;
}

function readCustomerOps(): Record<string, string> {
  try {
    const profile = JSON.parse(fs.readFileSync(ENTERPRISE_FILE, 'utf8')) as { customerOps?: Record<string, string> };
    return profile.customerOps ?? {};
  } catch {
    return {};
  }
}

function configuredBigDealAmount(): number {
  const raw = readCustomerOps().bigDealThreshold || '';
  const amount = Number(raw.match(/\$?\s*([\d,.]+)/)?.[1]?.replace(/,/g, ''));
  return Number.isFinite(amount) && amount > 0 ? amount : WA_DEFAULTS.bigDealAmountUsd;
}

function configuredExtraMissingFields(): string[] {
  return String(readCustomerOps().extraMissingFields || '')
    .split(/[、,，;\n]/)
    .map(item => item.trim())
    .filter(Boolean)
    .slice(0, 6);
}

function extractJson(text: string): ExtractedInsight | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]) as ExtractedInsight;
  } catch {
    return null;
  }
}

function ruleExtract(body: string, waId: string): ExtractedInsight {
  const lower = body.toLowerCase();
  const quantity = body.match(/\b\d{2,6}\s*(pcs|pieces|sets|units|件|套|个)\b/i)?.[0] ?? '';
  const budget = body.match(/(?:\$|usd\s*)\s?\d[\d,.]*|\d[\d,.]*\s?(?:usd|dollars|美金|美元)/i)?.[0] ?? '';
  const call_request = /(call|phone|talk|manager|boss|通话|电话|经理|老板|اتصال|مدير|llamada|gerente)/i.test(body);
  const complaint = /(refund|complaint|bad|broken|late|angry|退款|投诉|坏了|延迟|شكوى|queja)/i.test(body);
  const language = /[\u0600-\u06ff]/.test(body) ? 'Arabic'
    : /[¿¡áéíóúñ]/i.test(body) ? 'Spanish'
      : /[\u4e00-\u9fff]/.test(body) ? 'Chinese'
        : 'English';
  const country_guess = waId.startsWith('966') ? '沙特'
    : waId.startsWith('971') ? '阿联酋'
      : waId.startsWith('55') ? '巴西'
        : waId.startsWith('1') ? '美国'
          : '';
  const product = body.match(/(?:for|need|want|interested in|order|采购|需要|询价)\s+([^,.，。؟?]{2,48})/i)?.[1]?.trim() ?? '';
  const urgency = /(urgent|asap|today|this week|before|紧急|今天|本周|عاجل|urgente)/i.test(lower) ? 'urgent' : '';
  return { language, country_guess, product, quantity, budget, urgency, call_request, complaint };
}

async function llmExtract(body: string, waId: string): Promise<ExtractedInsight | null> {
  if (!process.env.GEMINI_API_KEY && !process.env.DASHSCOPE_API_KEY) return null;
  const systemPrompt = '你是 WhatsApp B2B 询盘结构化助手。只返回 JSON，不要解释。无法判断的字段返回空字符串或 false。';
  const prompt = `请从这条 WhatsApp 询盘中抽取字段：language, country_guess, product, quantity, budget, urgency, call_request, complaint。\nwa_id: ${waId}\nmessage: ${body}\nJSON:`;
  try {
    const text = await callLLM(prompt, { systemPrompt });
    return extractJson(text);
  } catch {
    return null;
  }
}

function scoreInsight(body: string, customer: CustomerRecord, insight: ExtractedInsight): { score: number; signals: IntentSignal[]; bigDeal: boolean } {
  const signals: IntentSignal[] = [];
  const add = (label: string, score: number) => signals.push({ label, score });

  if (/(\?|price|cost|quote|quotation|报价|价格|多少钱|سعر|precio)/i.test(body)) add('问价格', 2);
  if (/(moq|minimum|ship|shipping|delivery|lead time|船期|交期|最小起订|起订|موعد|envío)/i.test(body)) add('问MOQ或船期', 3);
  if (insight.quantity) add(`明确数量：${insight.quantity}`, 4);
  if (insight.call_request) add('想通电话', 6);
  if ((customer.orderHistory ?? []).length) add('历史订单', 4);
  if (/(catalog|catalogue|目录|款式|collection)/i.test(body) && signals.length <= 1) add('只问目录', 1);
  if (insight.complaint) add('投诉/风险', 8);

  const amount = Number(String(insight.budget || '').replace(/[^\d.]/g, '')) || 0;
  const quantity = Number(String(insight.quantity || '').replace(/[^\d]/g, '')) || 0;
  const bigDeal = amount >= configuredBigDealAmount() || quantity >= 500;
  if (bigDeal) add('大单预警', 10);

  const base = 35;
  const score = Math.max(0, Math.min(100, base + signals.reduce((sum, signal) => sum + signal.score * 5, 0)));
  return { score, signals, bigDeal };
}

async function upsertInsight(customerId: string, tenantId: string, data: Omit<CustomerInsightRecord, 'id'>): Promise<void> {
  const existing = await store.list<CustomerInsightRecord>('customer_insights', { where: { customer: customerId }, perPage: 1 });
  if (existing.items[0]) {
    await store.update('customer_insights', existing.items[0].id, data as unknown as Record<string, unknown>);
    return;
  }
  await store.create('customer_insights', data as unknown as Record<string, unknown>);
}

export async function refreshCustomerInsight(customer: CustomerRecord, latestBody: string): Promise<CustomerInsightRecord | null> {
  const now = new Date().toISOString();
  const extracted = { ...ruleExtract(latestBody, customer.wa_id), ...((await llmExtract(latestBody, customer.wa_id)) ?? {}) };
  const { score, signals, bigDeal } = scoreInsight(latestBody, customer, extracted);
  const forceManual = Boolean(extracted.call_request || extracted.complaint || bigDeal);
  const automation: AutomationLevel = forceManual ? 'manual' : automationFromScore(score);
  const missing = Array.from(new Set([...missingFieldsFromText(latestBody), ...configuredExtraMissingFields()])).slice(0, 7);

  const insight: Omit<CustomerInsightRecord, 'id'> = {
    tenantId: customer.tenantId,
    customer: customer.id,
    language: extracted.language || 'English',
    country_guess: extracted.country_guess || '',
    product: extracted.product || customer.next_step || '',
    quantity: extracted.quantity || '',
    budget: extracted.budget || '',
    urgency: extracted.urgency || '',
    call_request: Boolean(extracted.call_request),
    complaint: Boolean(extracted.complaint),
    intent_score: score,
    signals,
    missing_fields: missing,
    updatedAt: now,
  };
  await upsertInsight(customer.id, customer.tenantId, insight);

  const updatedCustomer: CustomerRecord = {
    ...customer,
    automation,
    stage: customer.stage === '成交' ? customer.stage : stageFromAutomation(automation),
    inboxReason: inboxReasonFor({ callRequest: extracted.call_request, complaint: extracted.complaint, bigDeal, automation }),
    priority: Math.max(score, forceManual ? 100 : score),
    estimatedValue: extracted.budget || customer.estimatedValue || (bigDeal ? '≥$1,000' : ''),
    next_step: forceManual ? '人工接管：确认通话/大单/投诉处理' : (automation === 'auto' ? '自动发送目录并追踪点击' : '生成回复草稿，等待确认发送'),
    tags: Array.from(new Set([...(customer.tags ?? []), ...(forceManual ? ['老板接管'] : []), ...(bigDeal ? ['大单预警'] : [])])),
  };

  await store.update('customers', customer.id, {
    automation: updatedCustomer.automation,
    stage: updatedCustomer.stage,
    inboxReason: updatedCustomer.inboxReason,
    priority: updatedCustomer.priority,
    estimatedValue: updatedCustomer.estimatedValue,
    next_step: updatedCustomer.next_step,
    tags: updatedCustomer.tags,
  });

  if (forceManual) {
    await store.create('timeline_events', {
      tenantId: customer.tenantId,
      customer: customer.id,
      type: 'ai',
      actor: 'ai',
      title: 'AI 熔断',
      body: extracted.call_request ? '识别到客户想通电话，已停止自动回复并切换人工接管。'
        : extracted.complaint ? '识别到投诉/风险消息，已停止自动回复并切换人工接管。'
          : '识别到大单预警，已切换人工确认。',
      ref: '',
      status: '',
      ts: now,
    });
  }

  const draft = await generateSalesDraft(updatedCustomer, { id: '', ...insight });
  if (draft.should_escalate) {
    await store.create('timeline_events', {
      tenantId: customer.tenantId,
      customer: customer.id,
      type: 'ai',
      actor: 'ai',
      title: 'AI 草稿已暂停',
      body: `原因：${draft.reason || '需要人工确认'}`,
      ref: '',
      status: 'escalated',
      ts: new Date().toISOString(),
    });
  } else if (draft.reply_text) {
    await store.create('timeline_events', {
      tenantId: customer.tenantId,
      customer: customer.id,
      type: 'ai',
      actor: 'ai',
      title: updatedCustomer.automation === 'auto' ? 'AI 自动回复草稿' : 'AI 草稿待确认',
      body: draft.reply_text,
      ref: '',
      status: 'ai_draft',
      ts: new Date().toISOString(),
    });
  }

  return { id: '', ...insight };
}
