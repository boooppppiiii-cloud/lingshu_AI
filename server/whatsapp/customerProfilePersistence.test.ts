import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { getWhatsAppCustomers, patchWhatsAppCustomer } from './historyImport.js';

const dataDir = path.join(process.cwd(), 'data');
const customersFile = path.join(dataDir, 'whatsapp-customers.json');
const interactionsFile = path.join(dataDir, 'whatsapp-interactions.json');
const originalCustomers = fs.existsSync(customersFile) ? fs.readFileSync(customersFile) : null;
const originalInteractions = fs.existsSync(interactionsFile) ? fs.readFileSync(interactionsFile) : null;

const restore = (file: string, value: Buffer | null) => {
  if (value) fs.writeFileSync(file, value);
  else if (fs.existsSync(file)) fs.unlinkSync(file);
};

try {
  fs.mkdirSync(dataDir, { recursive: true });
  const now = Date.now();
  fs.writeFileSync(customersFile, JSON.stringify([
    {
      id: 'wa_tenant_a_971500000001', tenantId: 'tenant_a', waNumber: '971500000001', name: 'Dubai Buyer', language: '英语', stage: 'inquiry', handlingMode: 'ai_draft', handlingReason: '待确认', intentScore: 80, lastActiveAt: now, createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString(), source: 'whatsapp_from_youtube', hasUnread: true,
    },
    {
      id: 'wa_tenant_b_971500000002', tenantId: 'tenant_b', waNumber: '971500000002', name: 'Other Tenant', language: '英语', stage: 'inquiry', handlingMode: 'ai_draft', handlingReason: '待确认', intentScore: 50, lastActiveAt: now, createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString(), source: 'whatsapp',
    },
    {
      id: 'wa_tenant_a_12025550123', tenantId: 'tenant_a', waNumber: '12025550123', name: 'Unknown Region', language: '英语', stage: 'inquiry', handlingMode: 'ai_draft', handlingReason: '待确认', intentScore: 40, lastActiveAt: now, createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString(), source: 'unexpected-import-label',
    },
  ], null, 2));
  fs.writeFileSync(interactionsFile, JSON.stringify([
    { id: 'msg-a', tenantId: 'tenant_a', customerId: 'wa_tenant_a_971500000001', waNumber: '971500000001', type: 'msg_in', body: 'Hello', timestamp: now },
  ], null, 2));

  const before = getWhatsAppCustomers('tenant_a');
  const dubai = before.find(item => item.id === 'wa_tenant_a_971500000001');
  assert.equal(dubai.countryName, '阿联酋');
  assert.equal(dubai.timeZone, 'Asia/Dubai');
  assert.notEqual(dubai.localTime, '未知');
  assert.equal(dubai.source, 'whatsapp_from_youtube');
  assert.equal(before.find(item => item.id === 'wa_tenant_a_12025550123')?.countryName, '未知');
  assert.equal(before.find(item => item.id === 'wa_tenant_a_12025550123')?.source, 'whatsapp');

  const updated = patchWhatsAppCustomer({
    tenantId: 'tenant_a',
    customerId: 'wa_tenant_a_971500000001',
    patch: {
      language: '西语', languageLocked: true, handlingMode: 'human_needed', hasUnread: false,
      orders: [{ id: 'QA-001', total: 'US $120.00', status: 'paid', createdAt: '2026-07-30' }],
    },
  });
  assert.ok(updated);
  const after = getWhatsAppCustomers('tenant_a').find(item => item.id === 'wa_tenant_a_971500000001');
  assert.equal(after.language, '西语');
  assert.equal(after.languageLocked, true);
  assert.equal(after.handlingMode, 'human_needed');
  assert.equal(after.hasUnread, false);
  assert.deepEqual(after.orders.map((item: any) => item.id), ['QA-001']);

  assert.equal(patchWhatsAppCustomer({ tenantId: 'tenant_a', customerId: 'wa_tenant_b_971500000002', patch: { language: '法语' } }), null);
  assert.equal(getWhatsAppCustomers('tenant_b')[0]?.language, '英语');
  console.log('WhatsApp customer profile persistence passed');
} finally {
  restore(customersFile, originalCustomers);
  restore(interactionsFile, originalInteractions);
}
