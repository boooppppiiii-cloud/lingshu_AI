import { adminFetch } from './pb.js';

type FieldType = 'text' | 'select' | 'bool' | 'date' | 'json';

interface FieldDef {
  name: string;
  type: FieldType;
  required?: boolean;
  values?: string[];
}

const TENANTS_FIELDS: FieldDef[] = [
  { name: 'name', type: 'text', required: true },
  { name: 'companyName', type: 'text' },
  { name: 'contactName', type: 'text' },
  { name: 'contact', type: 'text' },
  { name: 'industry', type: 'text' },
  { name: 'notes', type: 'text' },
  { name: 'inviteCode', type: 'text' },
  { name: 'registrationInviteCode', type: 'text' },
  { name: 'registeredEmail', type: 'text' },
  { name: 'registeredPasswordCipher', type: 'text' },
  { name: 'registeredAt', type: 'text' },
  { name: 'subscriptionStatus', type: 'text' },
  { name: 'subscriptionPlan', type: 'text' },
  { name: 'subscriptionExpiresAt', type: 'date' },
];

const TENANT_PLATFORM_APP_FIELDS: FieldDef[] = [
  { name: 'tenant_id', type: 'text', required: true },
  { name: 'platform', type: 'select', required: true, values: ['meta', 'google'] },
  { name: 'app_id', type: 'text' },
  { name: 'app_secret', type: 'text' },
  { name: 'wa_config_id', type: 'text' },
  { name: 'business_id', type: 'text' },
  { name: 'waba_id', type: 'text' },
  { name: 'phone_number_id', type: 'text' },
  { name: 'page_id', type: 'text' },
  { name: 'ig_user_id', type: 'text' },
  { name: 'youtube_channel_id', type: 'text' },
  { name: 'webhook_verify_token', type: 'text' },
  { name: 'token_type', type: 'select', values: ['user_60d', 'system_user_permanent'] },
  { name: 'access_token', type: 'text' },
  { name: 'token_expires_at', type: 'text' },
  { name: 'status', type: 'select', values: ['pending', 'configuring', 'waiting_customer', 'importing_history', 'verifying', 'active', 'needs_permanent_token', 'token_expired', 'error'] },
  { name: 'last_checklist', type: 'json' },
  { name: 'notes', type: 'text' },
];

const STYLE_MEMORY_FIELDS: FieldDef[] = [
  { name: 'tenant_id', type: 'text', required: true },
  { name: 'customer_id', type: 'text' },
  { name: 'trigger_message', type: 'text' },
  { name: 'draft_original', type: 'text' },
  { name: 'final_sent', type: 'text' },
  { name: 'edited', type: 'bool' },
  { name: 'category', type: 'text' },
  { name: 'outcome', type: 'text' },
];

const STYLE_ADOPTION_STATS_FIELDS: FieldDef[] = [
  { name: 'tenant_id', type: 'text', required: true },
  { name: 'week', type: 'text', required: true },
  { name: 'total', type: 'text' },
  { name: 'direct_sent', type: 'text' },
  { name: 'rate', type: 'text' },
];

const TENANT_PROFILE_FIELDS: FieldDef[] = [
  { name: 'tenant_id', type: 'text', required: true },
  { name: 'profile', type: 'json', required: true },
  { name: 'updated_by', type: 'text' },
];

const TENANT_ORDER_FIELDS: FieldDef[] = [
  { name: 'tenant_id', type: 'text', required: true },
  { name: 'order_no', type: 'text', required: true },
  { name: 'order', type: 'json', required: true },
];

const TENANT_SUPPORT_SETTINGS_FIELDS: FieldDef[] = [
  { name: 'tenant_id', type: 'text', required: true },
  { name: 'default_authorized', type: 'bool', required: true },
  { name: 'updated_by', type: 'text' },
];

function oldSchemaField(field: FieldDef) {
  return {
    name: field.name,
    type: field.type,
    required: Boolean(field.required),
    options: field.type === 'select' ? { values: field.values ?? [] } : {},
  };
}

function newField(field: FieldDef) {
  return {
    name: field.name,
    type: field.type,
    required: Boolean(field.required),
    ...(field.type === 'select' ? { values: field.values ?? [] } : {}),
  };
}

async function collectionExists(name: string): Promise<boolean> {
  const res = await adminFetch(`/api/collections/${encodeURIComponent(name)}`);
  if (res.ok) return true;
  if (res.status === 404) return false;
  const detail = await res.text().catch(() => '');
  throw new Error(`检查集合 ${name} 失败 (${res.status})${detail ? `: ${detail}` : ''}`);
}

async function createCollection(name: string, fields: FieldDef[]): Promise<void> {
  const base = {
    name,
    type: 'base',
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
  };
  const attempts = [
    { ...base, fields: fields.map(newField) },
    { ...base, schema: fields.map(oldSchemaField) },
  ];

  let lastDetail = '';
  for (const body of attempts) {
    const res = await adminFetch('/api/collections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) return;
    lastDetail = `${res.status} ${await res.text().catch(() => '')}`;
  }
  throw new Error(`创建集合 ${name} 失败：${lastDetail}`);
}

async function ensureCollection(name: string, fields: FieldDef[]): Promise<void> {
  if (!await collectionExists(name)) {
    await createCollection(name, fields);
    console.log(`[pb-init] created collection ${name}`);
    return;
  }

  const res = await adminFetch(`/api/collections/${encodeURIComponent(name)}`);
  if (!res.ok) throw new Error(`读取集合 ${name} 失败 (${res.status})`);
  const collection = await res.json() as { fields?: Array<{ name?: string }>; schema?: Array<{ name?: string }> };
  const existing = collection.fields ?? collection.schema ?? [];
  const missing = fields.filter(field => !existing.some(item => item.name === field.name));
  if (!missing.length) return;

  const attempts = collection.fields
    ? [{ fields: [...collection.fields, ...missing.map(newField)] }]
    : [{ schema: [...collection.schema ?? [], ...missing.map(oldSchemaField)] }];
  let lastDetail = '';
  for (const body of attempts) {
    const patch = await adminFetch(`/api/collections/${encodeURIComponent(name)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (patch.ok) {
      console.log(`[pb-init] added ${missing.map(field => field.name).join(', ')} to ${name}`);
      return;
    }
    lastDetail = `${patch.status} ${await patch.text().catch(() => '')}`;
  }
  throw new Error(`更新集合 ${name} 失败：${lastDetail}`);
}

export async function ensureDeliveryCollections(): Promise<void> {
  await ensureCollection('tenants', TENANTS_FIELDS);
  await ensureCollection('tenant_platform_apps', TENANT_PLATFORM_APP_FIELDS);
  await ensureCollection('style_memory', STYLE_MEMORY_FIELDS);
  await ensureCollection('style_adoption_stats', STYLE_ADOPTION_STATS_FIELDS);
  await ensureCollection('tenant_profiles', TENANT_PROFILE_FIELDS);
  await ensureCollection('tenant_orders', TENANT_ORDER_FIELDS);
  await ensureCollection('tenant_support_settings', TENANT_SUPPORT_SETTINGS_FIELDS);
}
