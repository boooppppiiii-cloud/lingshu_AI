import { useEffect, useState } from 'react';
import { CheckCircle2, Clipboard, Loader2, RefreshCcw, Save, ShieldCheck } from 'lucide-react';
import { authHeader } from '../lib/auth';

type Platform = 'meta' | 'google';
type Status = 'pending' | 'active' | 'token_expired' | 'error';

interface DeliveryApp {
  id: string;
  tenantId: string;
  platform: Platform;
  appId: string;
  appSecretSet: boolean;
  waConfigId: string;
  webhookVerifyToken: string;
  webhookUrl: string;
  tokenType: 'user_60d' | 'system_user_permanent';
  accessTokenSet: boolean;
  tokenExpiresAt: string;
  status: Status;
  notes: string;
}

interface TenantCard {
  tenantId: string;
  name: string;
  apps: DeliveryApp[];
}

type Draft = Record<string, Partial<DeliveryApp> & { appSecret?: string; accessToken?: string }>;
type TestState = Record<string, Record<string, 'idle' | 'running' | 'ok' | 'error'>>;

const statusLabel: Record<Status, string> = {
  pending: '待配置',
  active: '已交付',
  token_expired: 'Token 过期',
  error: '异常',
};

function keyOf(tenantId: string, platform: Platform) {
  return `${tenantId}:${platform}`;
}

function fieldValue(drafts: Draft, app: DeliveryApp, field: keyof DeliveryApp) {
  const value = drafts[keyOf(app.tenantId, app.platform)]?.[field];
  return typeof value === 'string' ? value : String(app[field] ?? '');
}

async function jsonFetch(url: string, init?: RequestInit) {
  const resp = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...authHeader(), ...(init?.headers ?? {}) },
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(json.error || '请求失败');
  return json;
}

function PlatformForm({
  app,
  drafts,
  setDrafts,
  tests,
  onSave,
  onTest,
  onComplete,
}: {
  app: DeliveryApp;
  drafts: Draft;
  setDrafts: (next: Draft | ((current: Draft) => Draft)) => void;
  tests: TestState;
  onSave: (app: DeliveryApp) => Promise<void>;
  onTest: (app: DeliveryApp, kind: string) => Promise<void>;
  onComplete: (app: DeliveryApp) => Promise<void>;
}) {
  const appKey = keyOf(app.tenantId, app.platform);
  const update = (patch: Record<string, string>) => {
    setDrafts(current => ({ ...current, [appKey]: { ...current[appKey], ...patch } }));
  };
  const test = tests[appKey] ?? {};
  const platformName = app.platform === 'meta' ? 'Meta / WhatsApp' : 'Google / YouTube';
  const testItems = app.platform === 'meta'
    ? [
      ['whatsapp', '测试发送 WhatsApp'],
      ['pages', '拉取主页列表'],
      ['webhook', '检查 webhook 订阅状态'],
    ]
    : [['google', '检查 Google OAuth 配置']];

  return (
    <div className="rounded-2xl border border-border bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-black text-text-primary">{platformName}</p>
          <p className="mt-1 text-xs text-text-muted">{statusLabel[app.status]} · {app.appSecretSet ? 'Secret 已保存' : 'Secret 未保存'}</p>
        </div>
        {app.status === 'active' && <span className="rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-bold text-emerald-700">已由专属顾问配置 ✓</span>}
      </div>

      <div className="mt-4 grid gap-3">
        <label className="grid gap-1 text-xs font-bold text-text-secondary">
          App / Client ID
          <input value={fieldValue(drafts, app, 'appId')} onChange={event => update({ appId: event.target.value })} className="rounded-xl border border-border bg-surface-2 px-3 py-2 text-sm font-normal text-text-primary outline-none focus:border-primary" />
        </label>
        <label className="grid gap-1 text-xs font-bold text-text-secondary">
          App Secret / Client Secret
          <input type="password" placeholder={app.appSecretSet ? '已加密保存，留空则不修改' : '粘贴客户开发者账号里的 Secret'} onChange={event => update({ appSecret: event.target.value })} className="rounded-xl border border-border bg-surface-2 px-3 py-2 text-sm font-normal text-text-primary outline-none focus:border-primary" />
        </label>
        {app.platform === 'meta' && (
          <label className="grid gap-1 text-xs font-bold text-text-secondary">
            WhatsApp Embedded Signup Config ID
            <input value={fieldValue(drafts, app, 'waConfigId')} onChange={event => update({ waConfigId: event.target.value })} className="rounded-xl border border-border bg-surface-2 px-3 py-2 text-sm font-normal text-text-primary outline-none focus:border-primary" />
          </label>
        )}
        <label className="grid gap-1 text-xs font-bold text-text-secondary">
          Access Token
          <input type="password" placeholder={app.accessTokenSet ? '已加密保存，留空则不修改' : '可选，粘贴 60 天 user token 或 system user token'} onChange={event => update({ accessToken: event.target.value })} className="rounded-xl border border-border bg-surface-2 px-3 py-2 text-sm font-normal text-text-primary outline-none focus:border-primary" />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="grid gap-1 text-xs font-bold text-text-secondary">
            Token 类型
            <select value={fieldValue(drafts, app, 'tokenType') || 'user_60d'} onChange={event => update({ tokenType: event.target.value })} className="rounded-xl border border-border bg-surface-2 px-3 py-2 text-sm font-normal text-text-primary outline-none">
              <option value="user_60d">user_60d</option>
              <option value="system_user_permanent">system_user_permanent</option>
            </select>
          </label>
          <label className="grid gap-1 text-xs font-bold text-text-secondary">
            Token 到期时间
            <input value={fieldValue(drafts, app, 'tokenExpiresAt')} onChange={event => update({ tokenExpiresAt: event.target.value })} placeholder="2026-08-01T00:00:00.000Z" className="rounded-xl border border-border bg-surface-2 px-3 py-2 text-sm font-normal text-text-primary outline-none" />
          </label>
        </div>
        <label className="grid gap-1 text-xs font-bold text-text-secondary">
          交付备注
          <textarea value={fieldValue(drafts, app, 'notes')} onChange={event => update({ notes: event.target.value })} rows={2} className="resize-none rounded-xl border border-border bg-surface-2 px-3 py-2 text-sm font-normal text-text-primary outline-none" />
        </label>

        {app.platform === 'meta' && (
          <div className="rounded-xl border border-dashed border-border bg-surface-2 p-3">
            <p className="text-xs font-black text-text-primary">粘贴回 Meta 后台</p>
            <div className="mt-2 space-y-2 text-[11px] text-text-muted">
              <CopyLine label="Webhook URL" value={app.webhookUrl} />
              <CopyLine label="Verify Token" value={app.webhookVerifyToken || '保存后自动生成'} />
            </div>
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" onClick={() => void onSave(app)} className="inline-flex items-center gap-1.5 rounded-xl bg-slate-950 px-3 py-2 text-xs font-bold text-white">
          <Save size={13} /> 保存配置
        </button>
        {testItems.map(([kind, label]) => (
          <button key={kind} type="button" onClick={() => void onTest(app, kind)} className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-white px-3 py-2 text-xs font-bold text-text-secondary hover:bg-surface-2">
            {test[kind] === 'running' ? <Loader2 size={13} className="animate-spin" /> : test[kind] === 'ok' ? <CheckCircle2 size={13} className="text-emerald-600" /> : <ShieldCheck size={13} />}
            {label}
          </button>
        ))}
        <button type="button" onClick={() => void onComplete(app)} className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-bold text-white">
          <CheckCircle2 size={13} /> 交付完成
        </button>
      </div>
    </div>
  );
}

function CopyLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-24 shrink-0 font-bold text-text-secondary">{label}</span>
      <code className="min-w-0 flex-1 truncate rounded bg-white px-2 py-1">{value}</code>
      <button type="button" onClick={() => navigator.clipboard?.writeText(value)} className="rounded-lg border border-border bg-white p-1.5 text-text-muted hover:text-text-primary">
        <Clipboard size={12} />
      </button>
    </div>
  );
}

export default function AdminDeliveryPage() {
  const [tenants, setTenants] = useState<TenantCard[]>([]);
  const [drafts, setDrafts] = useState<Draft>({});
  const [tests, setTests] = useState<TestState>({});
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await jsonFetch('/api/overseas/admin/delivery/platform-apps');
      setTenants(data.tenants ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : '读取失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const save = async (app: DeliveryApp) => {
    const appKey = keyOf(app.tenantId, app.platform);
    const draft = drafts[appKey] ?? {};
    await jsonFetch(`/api/overseas/admin/delivery/platform-apps/${app.tenantId}/${app.platform}`, {
      method: 'PUT',
      body: JSON.stringify({
        appId: draft.appId ?? app.appId,
        appSecret: draft.appSecret ?? '',
        waConfigId: draft.waConfigId ?? app.waConfigId,
        tokenType: draft.tokenType ?? app.tokenType,
        accessToken: draft.accessToken ?? '',
        tokenExpiresAt: draft.tokenExpiresAt ?? app.tokenExpiresAt,
        status: draft.status ?? app.status,
        notes: draft.notes ?? app.notes,
      }),
    });
    setMessage('配置已保存');
    await load();
  };

  const test = async (app: DeliveryApp, kind: string) => {
    const appKey = keyOf(app.tenantId, app.platform);
    setTests(current => ({ ...current, [appKey]: { ...current[appKey], [kind]: 'running' } }));
    try {
      const data = await jsonFetch(`/api/overseas/admin/delivery/platform-apps/${app.tenantId}/${app.platform}/test/${kind}`, { method: 'POST' });
      setTests(current => ({ ...current, [appKey]: { ...current[appKey], [kind]: 'ok' } }));
      setMessage(data.message || '自检通过');
    } catch (err) {
      setTests(current => ({ ...current, [appKey]: { ...current[appKey], [kind]: 'error' } }));
      setError(err instanceof Error ? err.message : '自检失败');
    }
  };

  const complete = async (app: DeliveryApp) => {
    await jsonFetch(`/api/overseas/admin/delivery/platform-apps/${app.tenantId}/${app.platform}/complete`, {
      method: 'POST',
      body: JSON.stringify({ notes: drafts[keyOf(app.tenantId, app.platform)]?.notes ?? app.notes }),
    });
    setMessage('已标记交付完成，客户端将显示“已由专属顾问配置 ✓”');
    await load();
  };

  return (
    <div className="flex h-full flex-col bg-white">
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-5">
        <div>
          <p className="text-sm font-black text-text-primary">交付工作台</p>
          <p className="text-[11px] text-text-muted">为每个租户录入客户自己的 Meta / Google 开发者应用配置</p>
        </div>
        <button type="button" onClick={() => void load()} className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-white px-3 py-2 text-xs font-bold text-text-secondary">
          {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCcw size={13} />} 刷新
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        {message && <p className="mb-3 rounded-xl bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700">{message}</p>}
        {error && <p className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-700">{error}</p>}
        {loading ? (
          <div className="flex h-60 items-center justify-center text-text-muted"><Loader2 className="animate-spin" /></div>
        ) : tenants.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-surface p-8 text-center">
            <p className="text-sm font-black text-text-primary">还没有可配置租户</p>
            <p className="mt-2 text-xs text-text-muted">创建租户后，这里会出现交付配置卡。</p>
          </div>
        ) : (
          <div className="grid gap-4">
            {tenants.map(tenant => (
              <section key={tenant.tenantId} className="rounded-3xl border border-border bg-surface p-4">
                <div className="mb-3">
                  <p className="text-sm font-black text-text-primary">{tenant.name}</p>
                  <p className="mt-0.5 text-[11px] text-text-muted">Tenant ID: {tenant.tenantId}</p>
                </div>
                <div className="grid gap-3 xl:grid-cols-2">
                  {tenant.apps.map(app => (
                    <PlatformForm
                      key={`${tenant.tenantId}-${app.platform}`}
                      app={app}
                      drafts={drafts}
                      setDrafts={setDrafts}
                      tests={tests}
                      onSave={save}
                      onTest={test}
                      onComplete={complete}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
