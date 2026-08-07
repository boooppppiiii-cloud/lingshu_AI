import fs from 'node:fs';
import path from 'node:path';

const mode = process.argv[2] || 'seed';
const tenantId = String(process.env.QA_TENANT_ID || '').trim();
const marker = 'qa_module_audit_20260808';
const dataDir = process.env.QA_DATA_DIR || '/app/data';

if (!tenantId || tenantId.length < 10) throw new Error('QA_TENANT_ID is required');
if (!['seed', 'cleanup'].includes(mode)) throw new Error('mode must be seed or cleanup');

const customerFile = path.join(dataDir, 'whatsapp-customers.json');
const interactionFile = path.join(dataDir, 'whatsapp-interactions.json');

function readArray(file) {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function writeArray(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2));
  fs.renameSync(temp, file);
}

const existingCustomers = readArray(customerFile);
const existingInteractions = readArray(interactionFile);
const cleanCustomers = existingCustomers.filter(item => item?.tenantId !== tenantId || item?.qaMarker !== marker);
const cleanInteractions = existingInteractions.filter(item => item?.tenantId !== tenantId || item?.qaMarker !== marker);

if (mode === 'cleanup') {
  writeArray(customerFile, cleanCustomers);
  writeArray(interactionFile, cleanInteractions);
  console.log(JSON.stringify({ ok: true, mode, removedCustomers: existingCustomers.length - cleanCustomers.length, removedInteractions: existingInteractions.length - cleanInteractions.length }));
  process.exit(0);
}

const now = Date.now();
const day = 86_400_000;
const customers = [
  {
    id: `qa_hot_${tenantId}`,
    tenantId,
    waNumber: '+12025550111',
    name: 'QA Hot Buyer',
    language: 'English',
    languageLocked: true,
    countryName: '美国',
    timeZone: 'America/New_York',
    stage: 'inquiry',
    handlingMode: 'human_needed',
    handlingReason: '客户询问 MOQ、样品和认证，需要人工确认报价。',
    intentScore: 92,
    lastActiveAt: now - 15 * 60_000,
    createdAt: new Date(now - 3 * day).toISOString(),
    updatedAt: new Date(now - 15 * 60_000).toISOString(),
    pendingDraft: 'Thanks for your interest. I will confirm the sample and MOQ details with our sales team.',
    needCall: true,
    hasUnread: true,
    tags: ['QA-MOCK', '高意向', '询价'],
    orders: [{ id: 'qa-customer-order-1', status: 'pending', total: 'USD 2,500', createdAt: new Date(now - day).toISOString(), items: [{ name: 'Mock 玻尿酸精华液', qty: 500 }] }],
    qaMarker: marker,
  },
  {
    id: `qa_won_${tenantId}`,
    tenantId,
    waNumber: '+447700900111',
    name: 'QA Repeat Buyer',
    language: 'English',
    languageLocked: true,
    countryName: '英国',
    timeZone: 'Europe/London',
    stage: 'won',
    handlingMode: 'ai_draft',
    handlingReason: '已成交客户，等待补货跟进。',
    intentScore: 78,
    lastActiveAt: now - 8 * day,
    createdAt: new Date(now - 120 * day).toISOString(),
    updatedAt: new Date(now - 8 * day).toISOString(),
    hasUnread: false,
    tags: ['QA-MOCK', '已成交', '复购'],
    orders: [{ id: 'qa-customer-order-2', status: 'paid', total: 'USD 5,600', createdAt: new Date(now - 90 * day).toISOString(), items: [{ name: 'Mock 胶原面膜', qty: 2000 }] }],
    qaMarker: marker,
  },
  {
    id: `qa_silent_${tenantId}`,
    tenantId,
    waNumber: '+971501234567',
    name: 'QA Silent Buyer',
    language: 'English',
    languageLocked: false,
    countryName: '阿联酋',
    timeZone: 'Asia/Dubai',
    stage: 'silent60',
    handlingMode: 'ai_draft',
    handlingReason: '超过 60 天未互动，适合老客唤醒。',
    intentScore: 64,
    lastActiveAt: now - 75 * day,
    createdAt: new Date(now - 160 * day).toISOString(),
    updatedAt: new Date(now - 75 * day).toISOString(),
    hasUnread: false,
    tags: ['QA-MOCK', '沉默60天'],
    orders: [],
    qaMarker: marker,
  },
];

const interactions = [
  { id: `qa-hot-in-${now}`, tenantId, customerId: customers[0].id, waNumber: customers[0].waNumber, type: 'msg_in', body: 'Can you confirm MOQ, sample lead time and ISO 22716?', timestamp: now - 20 * 60_000, qaMarker: marker },
  { id: `qa-hot-ai-${now}`, tenantId, customerId: customers[0].id, waNumber: customers[0].waNumber, type: 'msg_out_ai', body: 'I have prepared a draft and will ask sales to confirm the commercial terms.', timestamp: now - 18 * 60_000, autoSent: false, qaMarker: marker },
  { id: `qa-won-in-${now}`, tenantId, customerId: customers[1].id, waNumber: customers[1].waNumber, type: 'msg_in', body: 'We may reorder the collagen masks next month.', timestamp: now - 8 * day, qaMarker: marker },
  { id: `qa-silent-system-${now}`, tenantId, customerId: customers[2].id, waNumber: customers[2].waNumber, type: 'system', body: 'QA mock: customer entered 60-day silent segment.', timestamp: now - 60 * day, qaMarker: marker },
];

writeArray(customerFile, [...cleanCustomers, ...customers]);
writeArray(interactionFile, [...cleanInteractions, ...interactions]);
console.log(JSON.stringify({ ok: true, mode, tenantId, customers: customers.length, interactions: interactions.length }));
