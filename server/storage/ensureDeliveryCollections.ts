import { adminFetch } from './pb.js';

type FieldType = 'text' | 'select' | 'bool' | 'date' | 'json' | 'number';

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
  { name: 'platform', type: 'select', required: true, values: ['meta', 'google', 'wecom'] },
  { name: 'app_id', type: 'text' },
  { name: 'app_secret', type: 'text' },
  { name: 'wa_config_id', type: 'text' },
  { name: 'business_id', type: 'text' },
  { name: 'waba_id', type: 'text' },
  { name: 'phone_number_id', type: 'text' },
  { name: 'wa_public_number', type: 'text' },
  { name: 'page_id', type: 'text' },
  { name: 'ig_user_id', type: 'text' },
  { name: 'youtube_channel_id', type: 'text' },
  { name: 'webhook_verify_token', type: 'text' },
  { name: 'wecom_encoding_aes_key', type: 'text' },
  { name: 'token_type', type: 'select', values: ['user_60d', 'system_user_permanent'] },
  { name: 'access_token', type: 'text' },
  { name: 'token_expires_at', type: 'text' },
  { name: 'status', type: 'select', values: ['pending', 'configuring', 'waiting_customer', 'importing_history', 'verifying', 'active', 'needs_permanent_token', 'token_expired', 'error'] },
  { name: 'last_checklist', type: 'json' },
  { name: 'notes', type: 'text' },
];

const POSTS_FIELDS: FieldDef[] = [
  { name: 'tenant_id', type: 'text', required: true },
  { name: 'content_id', type: 'text' },
  { name: 'platform', type: 'text', required: true },
  { name: 'platform_post_id', type: 'text' },
  { name: 'title', type: 'text' },
  { name: 'published_at', type: 'text' },
  { name: 'track_code', type: 'text', required: true },
  { name: 'wa_link', type: 'text' },
  { name: 'stats', type: 'json' },
  { name: 'inquiries', type: 'number' },
  { name: 'deals', type: 'number' },
];

const RECYCLE_LIST_FIELDS: FieldDef[] = [
  { name: 'tenant_id', type: 'text', required: true },
  { name: 'name', type: 'text', required: true },
  { name: 'enabled', type: 'bool' },
  { name: 'items', type: 'json' },
  { name: 'slots', type: 'json' },
  { name: 'refresh_mode', type: 'text' },
  { name: 'cursor', type: 'number' },
];

const POSTING_STATS_FIELDS: FieldDef[] = [
  { name: 'tenant_id', type: 'text', required: true },
  { name: 'platform', type: 'text', required: true },
  { name: 'weekday', type: 'number' },
  { name: 'hour', type: 'number' },
  { name: 'engagement', type: 'number' },
  { name: 'post_id', type: 'text' },
  { name: 'captured_at', type: 'text' },
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
  { name: 'strategy_ids', type: 'json' },
];

const RESPONSE_STRATEGY_MEMORY_FIELDS: FieldDef[] = [
  { name: 'tenant_id', type: 'text', required: true },
  { name: 'strategy_id', type: 'text', required: true },
  { name: 'adjustment', type: 'text' },
  { name: 'evidence_count', type: 'number' },
  { name: 'status', type: 'select', values: ['active', 'paused'] },
  { name: 'source', type: 'text' },
  { name: 'scenario', type: 'text' },
  { name: 'signals', type: 'json' },
  { name: 'intent', type: 'text' },
  { name: 'strategy_steps', type: 'json' },
  { name: 'risk_link', type: 'text' },
  { name: 'escalate', type: 'text' },
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
  const collection = await res.json() as { fields?: Array<{ name?: string; type?: string; values?: string[]; options?: { values?: string[] } }>; schema?: Array<{ name?: string; type?: string; values?: string[]; options?: { values?: string[] } }> };
  const existing = collection.fields ?? collection.schema ?? [];
  const missing = fields.filter(field => !existing.some(item => item.name === field.name));
  const selectUpdates = fields
    .filter(field => field.type === 'select' && field.values?.length)
    .filter(field => {
      const current = existing.find(item => item.name === field.name);
      const values = current?.values ?? current?.options?.values ?? [];
      return field.values!.some(value => !values.includes(value));
    });
  if (!missing.length && !selectUpdates.length) return;

  const attempts = collection.fields
    ? [{
      fields: [
        ...collection.fields.map(field => {
          const update = selectUpdates.find(item => item.name === field.name);
          return update ? { ...field, values: update.values ?? [] } : field;
        }),
        ...missing.map(newField),
      ],
    }]
    : [{
      schema: (collection.schema ?? []).map(field => {
        const update = selectUpdates.find(item => item.name === field.name);
        return update ? { ...field, options: { ...(field.options ?? {}), values: update.values ?? [] } } : field;
      }).concat(missing.map(oldSchemaField)),
    }];
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
  await ensureCollection('posts', POSTS_FIELDS);
  await ensureCollection('recycle_lists', RECYCLE_LIST_FIELDS);
  await ensureCollection('posting_stats', POSTING_STATS_FIELDS);
  await ensureCollection('style_memory', STYLE_MEMORY_FIELDS);
  await ensureCollection('response_strategy_memory', RESPONSE_STRATEGY_MEMORY_FIELDS);
  await ensureCollection('style_adoption_stats', STYLE_ADOPTION_STATS_FIELDS);
  await ensureCollection('tenant_profiles', TENANT_PROFILE_FIELDS);
  await ensureCollection('tenant_orders', TENANT_ORDER_FIELDS);
  await ensureCollection('tenant_support_settings', TENANT_SUPPORT_SETTINGS_FIELDS);
}

export async function ensureTrendVideoAnalysisCapacity(): Promise<void> {
  const res = await adminFetch('/api/collections/trend_videos');
  if (!res.ok) throw new Error(`读取集合 trend_videos 失败 (${res.status})`);
  const collection = await res.json() as {
    fields?: Array<Record<string, unknown> & { name?: string; max?: number }>;
    schema?: Array<Record<string, unknown> & { name?: string; options?: Record<string, unknown> }>;
  };
  const fields = collection.fields;
  if (fields) {
    const analysis = fields.find(field => field.name === 'aiAnalysis');
    if (!analysis || Number(analysis.max || 0) === 0) return;
    const patch = await adminFetch('/api/collections/trend_videos', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: fields.map(field => field.name === 'aiAnalysis' ? { ...field, max: 0 } : field) }),
    });
    if (!patch.ok) throw new Error(`扩容 trend_videos.aiAnalysis 失败 (${patch.status})`);
    console.log('[pb-init] removed trend_videos.aiAnalysis length limit');
    return;
  }
  const schema = collection.schema ?? [];
  const analysis = schema.find(field => field.name === 'aiAnalysis');
  if (!analysis || Number(analysis.options?.max || 0) === 0) return;
  const patch = await adminFetch('/api/collections/trend_videos', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ schema: schema.map(field => field.name === 'aiAnalysis' ? { ...field, options: { ...(field.options ?? {}), max: 0 } } : field) }),
  });
  if (!patch.ok) throw new Error(`扩容 trend_videos.aiAnalysis 失败 (${patch.status})`);
  console.log('[pb-init] removed trend_videos.aiAnalysis length limit');
}
