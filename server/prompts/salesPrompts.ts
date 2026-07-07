import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { callLLM } from '../agents/llm.js';
import { buildEnterpriseContext, type EnterpriseProfile } from '../routes/enterprise.js';
import { store } from '../storage/index.js';
import type { CustomerInsightRecord, CustomerRecord, WaMessageRecord } from '../lib/waTypes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENTERPRISE_FILE = path.join(__dirname, '../../data/enterprise.json');

export interface SalesDraft {
  reply_text: string;
  confidence: number;
  should_escalate: boolean;
  reason: string;
  skill: 'first_response' | 'catalog_push' | 'need_check' | 'quote' | 'wake_up';
}

function readEnterprise(): EnterpriseProfile {
  try {
    return JSON.parse(fs.readFileSync(ENTERPRISE_FILE, 'utf8')) as EnterpriseProfile;
  } catch {
    return {
      company: { name: '', industry: '', companyType: '', mainMarkets: '', primaryLanguages: '', founded: '', description: '' },
      products: { categories: '', priceRange: '', moq: '', certifications: '', highlights: '', items: [] },
      brand: { tone: '', style: '', taboos: '', usp: '', preferredLanguages: '' },
      strategy: {},
      customers: {},
      customerOps: {},
      operations: {},
      agentLearning: {},
      knowledge: '',
    };
  }
}

function parseJson(text: string): SalesDraft | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const value = JSON.parse(match[0]) as Partial<SalesDraft>;
    if (!value.reply_text) return null;
    return {
      reply_text: String(value.reply_text).slice(0, 500),
      confidence: Number(value.confidence ?? 0.72),
      should_escalate: Boolean(value.should_escalate),
      reason: String(value.reason ?? ''),
      skill: (value.skill as SalesDraft['skill']) || 'first_response',
    };
  } catch {
    return null;
  }
}

function preferredProduct(profile: EnterpriseProfile, insight?: CustomerInsightRecord | null): string {
  if (insight?.product) return insight.product;
  const item = profile.products.items?.find(p => p.name);
  return item?.name || profile.strategy?.focusProducts || profile.products.categories || 'our products';
}

function languageName(insight?: CustomerInsightRecord | null): string {
  const lang = String(insight?.language || '').toLowerCase();
  if (lang.includes('arab')) return 'Arabic';
  if (lang.includes('spanish')) return 'Spanish';
  if (lang.includes('chinese')) return 'Chinese';
  return 'English';
}

function fallbackDraft(profile: EnterpriseProfile, customer: CustomerRecord, insight?: CustomerInsightRecord | null): SalesDraft {
  const product = preferredProduct(profile, insight);
  const missing = insight?.missing_fields ?? [];
  const sourceHeadline = String(customer.first_source?.headline || '');
  if (insight?.call_request || insight?.complaint || customer.automation === 'manual') {
    return {
      reply_text: '',
      confidence: 0.95,
      should_escalate: true,
      reason: insight?.complaint ? 'complaint' : 'manual_takeover',
      skill: 'need_check',
    };
  }
  const question = missing.length
    ? `Could you share ${missing.slice(0, 2).join(' and ')}?`
    : 'Could you tell me your target quantity and destination country?';
  const intro = sourceHeadline ? `Thanks for reaching out from "${sourceHeadline}". ` : 'Thanks for reaching out. ';
  const reply = `${intro}We can support ${product}. ${question} Then I can send the suitable catalog and price range.`;
  return {
    reply_text: reply.slice(0, 300),
    confidence: 0.68,
    should_escalate: false,
    reason: 'fallback_rule',
    skill: customer.automation === 'auto' ? 'catalog_push' : 'first_response',
  };
}

async function recentConversation(customer: CustomerRecord): Promise<string> {
  const messages = await store.list<WaMessageRecord>('wa_messages', {
    where: { tenantId: customer.tenantId, customerId: customer.id },
    sort: '-ts',
    perPage: 10,
  });
  return messages.items
    .slice()
    .reverse()
    .map(message => `${message.direction === 'in' ? 'Buyer' : 'Seller'}: ${message.body || ''}`)
    .join('\n');
}

export async function generateSalesDraft(customer: CustomerRecord, insight?: CustomerInsightRecord | null): Promise<SalesDraft> {
  const profile = readEnterprise();
  const fallback = fallbackDraft(profile, customer, insight);
  if (fallback.should_escalate) return fallback;
  if (!process.env.GEMINI_API_KEY && !process.env.DASHSCOPE_API_KEY) return fallback;

  const systemPrompt = [
    'You are an export sales representative, not an AI assistant.',
    'Reply in the buyer language. One WhatsApp message only. Keep it under 300 characters. No Markdown.',
    'Use only enterprise facts. If price, delivery, certification, or customization is missing, ask for confirmation instead of inventing.',
    'If the buyer asks to call, complains, requests refund, or requires manager/boss, set should_escalate=true and reply_text="".',
    'Return strict JSON: {"reply_text":"...","confidence":0.0,"should_escalate":false,"reason":"...","skill":"first_response|catalog_push|need_check|quote|wake_up"}',
  ].join('\n');
  const prompt = [
    `Enterprise context:\n${buildEnterpriseContext(profile) || '(empty enterprise profile)'}`,
    `Customer: ${customer.profile_name || customer.wa_id}`,
    `Preferred output language: ${languageName(insight)}`,
    `Stage: ${customer.stage || '潜客'} / SOP: ${customer.sop_step || '首响'} / Automation: ${customer.automation || 'confirm'}`,
    `Insight: ${JSON.stringify(insight || {})}`,
    `Referral: ${JSON.stringify(customer.first_source || {})}`,
    `Recent conversation:\n${await recentConversation(customer)}`,
    'Generate the next safe sales reply JSON.',
  ].join('\n\n');
  try {
    const text = await callLLM(prompt, { systemPrompt });
    return parseJson(text) || fallback;
  } catch {
    return fallback;
  }
}

