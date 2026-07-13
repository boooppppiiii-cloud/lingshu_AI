import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Clipboard, KeyRound, Link2, Loader2, RefreshCcw, Save, ShieldCheck } from 'lucide-react';
import { authHeader } from '../lib/auth';

type Platform = 'meta' | 'google';
type Status = 'pending' | 'configuring' | 'waiting_customer' | 'importing_history' | 'verifying' | 'active' | 'needs_permanent_token' | 'token_expired' | 'error';

interface DeliveryApp {
  id: string;
  tenantId: string;
  platform: Platform;
  appId: string;
  appSecretSet: boolean;
  waConfigId: string;
  businessId: string;
  wabaId: string;
  phoneNumberId: string;
  pageId: string;
  igUserId: string;
  youtubeChannelId: string;
  webhookVerifyToken: string;
  webhookUrl: string;
  tokenType: 'user_60d' | 'system_user_permanent';
  accessTokenSet: boolean;
  tokenExpiresAt: string;
  status: Status;
  checklist: Record<string, boolean>;
  notes: string;
}

interface TenantCard {
  tenantId: string;
  name: string;
  apps: DeliveryApp[];
}

type Draft = Record<string, Partial<DeliveryApp> & { appSecret?: string; accessToken?: string }>;
type TestState = Record<string, Record<string, 'idle' | 'running' | 'ok' | 'error'>>;
type AssistLinkState = Record<string, { link: string; loading?: boolean }>;
type ProgressStageKey = 'email_connected' | 'business_verification' | 'permanent_token_replaced';
type ProgressStageState = 'done' | 'pending' | 'todo';

const STATUS_LABEL: Record<Status, string> = {
  pending: '待配置',
  configuring: '配置中',
  waiting_customer: '等客户操作',
  importing_history: '历史导入中',
  verifying: '验收中',
  active: '已交付',
  needs_permanent_token: '待换永久 token',
  token_expired: 'Token 过期',
  error: '异常',
};

const META_STEPS = [
  { id: 'metaApp', title: '1. Meta 开发者应用', desc: '录入 App ID / Secret，Secret 只加密保存不回显。' },
  { id: 'webhook', title: '2. Webhook 回调', desc: '复制 Webhook URL 和 Verify Token 到 Meta 后台。' },
  { id: 'whatsapp', title: '3. WhatsApp 接入', desc: '录入 Config ID / WABA / Phone Number ID，完成扫码或新号接入。' },
  { id: 'social', title: '4. FB / IG 资产', desc: '记录主页和 IG 专业账号 ID，避免客户多主页选错。' },
  { id: 'acceptance', title: '5. 验收', desc: '测试 WhatsApp 收发、Webhook 订阅和主页列表。' },
];

const GOOGLE_STEPS = [
  { id: 'googleApp', title: '1. Google OAuth 应用', desc: '录入 Client ID / Secret。' },
  { id: 'youtube', title: '2. YouTube 授权', desc: '记录频道 ID，并提醒客户通过未验证应用提示。' },
  { id: 'acceptance', title: '3. 验收', desc: '检查 YouTube 连接能读到频道。' },
];

function keyOf(tenantId: string, platform: Platform) {
  return `${tenantId}:${platform}`;
}

function appValue(drafts: Draft, app: DeliveryApp, field: keyof DeliveryApp) {
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

function CopyLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-24 shrink-0 text-[11px] font-bold text-text-muted">{label}</span>
      <code className="min-w-0 flex-1 truncate rounded-lg bg-white px-2 py-1 text-[11px] text-text-secondary">{value || '保存配置后生成'}</code>
      <button type="button" onClick={() => value && navigator.clipboard?.writeText(value)} className="rounded-lg border border-border bg-white p-1.5 text-text-muted hover:text-text-primary">
        <Clipboard size={12} />
      </button>
    </div>
  );
}

function Field({
  label,
  hint,
  value,
  placeholder,
  secret,
  onChange,
}: {
  label: string;
  hint: string;
  value?: string;
  placeholder?: string;
  secret?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-1 text-xs font-bold text-text-secondary">
      <span className="flex items-center justify-between gap-2">
        {label}
        <span className="text-[10px] font-medium text-text-muted">{hint}</span>
      </span>
      <input
        type={secret ? 'password' : 'text'}
        value={value ?? ''}
        placeholder={placeholder}
        onChange={event => onChange(event.target.value)}
        className="rounded-xl border border-border bg-surface-2 px-3 py-2 text-sm font-normal text-text-primary outline-none focus:border-primary"
      />
    </label>
  );
}

function ChecklistButton({
  app,
  id,
  label,
  drafts,
  setDrafts,
}: {
  app: DeliveryApp;
  id: string;
  label: string;
  drafts: Draft;
  setDrafts: (next: Draft | ((current: Draft) => Draft)) => void;
}) {
  const appKey = keyOf(app.tenantId, app.platform);
  const checklist = { ...(app.checklist ?? {}), ...(drafts[appKey]?.checklist ?? {}) };
  const checked = Boolean(checklist[id]);
  return (
    <button
      type="button"
      onClick={() => setDrafts(current => ({
        ...current,
        [appKey]: {
          ...current[appKey],
          checklist: { ...checklist, [id]: !checked },
        },
      }))}
      className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-bold ${checked ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-border bg-white text-text-muted'}`}
    >
      <CheckCircle2 size={12} /> {label}
    </button>
  );
}

function appFor(tenant: TenantCard, platform: Platform) {
  return tenant.apps.find(app => app.platform === platform);
}

function hasCheck(app: DeliveryApp | undefined, id: string) {
  return Boolean(app?.checklist?.[id]);
}

function DeploymentProgressStrip({
  tenant,
  busyKey,
  onToggle,
}: {
  tenant: TenantCard;
  busyKey: string;
  onToggle: (tenant: TenantCard, key: ProgressStageKey) => Promise<void>;
}) {
  const meta = appFor(tenant, 'meta');
  const google = appFor(tenant, 'google');
  const businessApproved = hasCheck(meta, 'business_verification_approved');
  const businessSubmitted = hasCheck(meta, 'business_verification_submitted');
  const stages: Array<{
    key: string;
    label: string;
    state: ProgressStageState;
    manual?: ProgressStageKey;
    hint: string;
  }> = [
    {
      key: 'meta_app',
      label: 'Meta App 已录入',
      state: meta?.appId && meta.appSecretSet ? 'done' : meta?.appId ? 'pending' : 'todo',
      hint: '由 App ID / Secret 自动判断',
    },
    {
      key: 'webhook',
      label: 'Webhook 已验证',
      state: hasCheck(meta, 'webhook_verified') || hasCheck(meta, 'messages_subscribed') || hasCheck(meta, 'webhook_test_passed') ? 'done' : 'todo',
      hint: '由 Webhook checklist / 自检结果判断',
    },
    {
      key: 'whatsapp',
      label: 'WhatsApp 已接通',
      state: hasCheck(meta, 'customer_scanned') || hasCheck(meta, 'wa_message_received') || hasCheck(meta, 'whatsapp_test_passed') || Boolean(meta?.phoneNumberId) ? 'done' : 'todo',
      hint: '由 Phone Number ID / WhatsApp 验收项判断',
    },
    {
      key: 'fb_ig',
      label: 'FB/IG 已授权',
      state: hasCheck(meta, 'fb_ig_authorized') || hasCheck(meta, 'pages_test_passed') || Boolean(meta?.pageId || meta?.igUserId) ? 'done' : 'todo',
      hint: '由主页 / IG ID 或授权 checklist 判断',
    },
    {
      key: 'youtube',
      label: 'YouTube 已授权',
      state: hasCheck(google, 'youtube_authorized') || hasCheck(google, 'google_test_passed') || Boolean(google?.youtubeChannelId) ? 'done' : 'todo',
      hint: '由频道 ID 或 YouTube checklist 判断',
    },
    {
      key: 'email',
      label: '邮箱已接通',
      state: hasCheck(meta, 'email_connected') ? 'done' : 'todo',
      manual: 'email_connected',
      hint: '手动勾选，记录顾问已完成邮箱接入',
    },
    {
      key: 'business',
      label: businessApproved ? '企业认证：已通过' : businessSubmitted ? '企业认证：审核中' : '企业认证',
      state: businessApproved ? 'done' : businessSubmitted ? 'pending' : 'todo',
      manual: 'business_verification',
      hint: '点击循环：未提交 → 审核中 → 已通过',
    },
    {
      key: 'token',
      label: '永久令牌已替换',
      state: meta?.tokenType === 'system_user_permanent' || hasCheck(meta, 'permanent_token_replaced') ? 'done' : 'todo',
      manual: 'permanent_token_replaced',
      hint: '可由 Token 类型自动判断，也可手动标记',
    },
  ];

  const doneCount = stages.filter(stage => stage.state === 'done').length;
  const total = stages.length;

  return (
    <div className="mb-3 rounded-2xl border border-border bg-white px-3 py-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-black text-text-primary">部署进度</p>
          <p className="mt-0.5 text-[11px] text-text-muted">按 SOP 阶段交接，自动项会随配置和验收更新。</p>
        </div>
        <span className="rounded-full bg-surface-2 px-2.5 py-1 text-[11px] font-black text-text-secondary">{doneCount}/{total}</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {stages.map(stage => {
          const tone = stage.state === 'done'
            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
            : stage.state === 'pending'
              ? 'border-amber-200 bg-amber-50 text-amber-700'
              : 'border-border bg-surface-2 text-text-muted';
          const content = (
            <>
              <CheckCircle2 size={12} className={stage.state === 'todo' ? 'opacity-35' : ''} />
              {stage.label}
              {busyKey === `${tenant.tenantId}:${stage.manual}` && <Loader2 size={12} className="animate-spin" />}
            </>
          );
          if (stage.manual) {
            return (
              <button
                key={stage.key}
                type="button"
                title={stage.hint}
                onClick={() => void onToggle(tenant, stage.manual!)}
                disabled={busyKey === `${tenant.tenantId}:${stage.manual}`}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[11px] font-black transition-colors disabled:opacity-60 ${tone}`}
              >
                {content}
              </button>
            );
          }
          return (
            <span key={stage.key} title={stage.hint} className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[11px] font-black ${tone}`}>
              {content}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function PlatformWizard({
  app,
  drafts,
  setDrafts,
  tests,
  onSave,
  onTest,
  onComplete,
  onAssistLink,
  assistLink,
}: {
  app: DeliveryApp;
  drafts: Draft;
  setDrafts: (next: Draft | ((current: Draft) => Draft)) => void;
  tests: TestState;
  onSave: (app: DeliveryApp) => Promise<void>;
  onTest: (app: DeliveryApp, kind: string) => Promise<void>;
  onComplete: (app: DeliveryApp) => Promise<void>;
  onAssistLink: (app: DeliveryApp) => Promise<void>;
  assistLink?: { link: string; loading?: boolean };
}) {
  const appKey = keyOf(app.tenantId, app.platform);
  const [activeStep, setActiveStep] = useState(app.platform === 'meta' ? 'metaApp' : 'googleApp');
  const test = tests[appKey] ?? {};
  const steps = app.platform === 'meta' ? META_STEPS : GOOGLE_STEPS;
  const update = (patch: Record<string, string | Record<string, boolean>>) => {
    setDrafts(current => ({ ...current, [appKey]: { ...current[appKey], ...patch } }));
  };
  const platformName = app.platform === 'meta' ? 'Meta / WhatsApp' : 'Google / YouTube';
  const draftStatus = (drafts[appKey]?.status as Status | undefined) ?? app.status;

  const testItems = app.platform === 'meta'
    ? [
      ['whatsapp', 'WhatsApp 配置'],
      ['pages', '主页列表'],
      ['webhook', 'Webhook 订阅'],
    ]
    : [['google', 'Google OAuth']];

  const statusTone = draftStatus === 'active'
    ? 'bg-emerald-50 text-emerald-700'
    : draftStatus === 'error' || draftStatus === 'token_expired'
      ? 'bg-red-50 text-red-700'
      : draftStatus === 'needs_permanent_token'
        ? 'bg-amber-50 text-amber-700'
        : 'bg-surface-2 text-text-secondary';

  return (
    <div className="rounded-2xl border border-border bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-black text-text-primary">{platformName}</p>
          <p className="mt-1 text-xs text-text-muted">顾问在客户电脑上录入，Secret / Token 加密保存，不经过微信和邮件。</p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => void onAssistLink(app)}
            disabled={assistLink?.loading}
            className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-[11px] font-black text-emerald-700 disabled:opacity-60"
          >
            {assistLink?.loading ? <Loader2 size={12} className="animate-spin" /> : <Link2 size={12} />}
            生成协助链接
          </button>
          <select
            value={draftStatus}
            onChange={event => update({ status: event.target.value })}
            className={`rounded-full border border-transparent px-2.5 py-1 text-[11px] font-black outline-none ${statusTone}`}
          >
            {Object.entries(STATUS_LABEL).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </div>
      </div>

      {assistLink?.link && (
        <div className="mt-3 flex items-center gap-2 rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2">
          <span className="shrink-0 text-[11px] font-black text-emerald-800">协助链接</span>
          <code className="min-w-0 flex-1 truncate text-[11px] text-emerald-900">{assistLink.link}</code>
          <button
            type="button"
            onClick={() => navigator.clipboard?.writeText(assistLink.link)}
            className="rounded-lg bg-white p-1.5 text-emerald-700"
            title="复制协助链接"
          >
            <Clipboard size={12} />
          </button>
        </div>
      )}

      <div className="mt-4 grid grid-cols-[160px_1fr] gap-4">
        <div className="space-y-2">
          {steps.map(step => (
            <button
              key={step.id}
              type="button"
              onClick={() => setActiveStep(step.id)}
              className={`w-full rounded-xl border px-3 py-2 text-left text-xs transition-colors ${activeStep === step.id ? 'border-slate-950 bg-slate-950 text-white' : 'border-border bg-surface-2 text-text-secondary hover:bg-white'}`}
            >
              <span className="font-black">{step.title}</span>
              <span className={`mt-1 block text-[10px] leading-4 ${activeStep === step.id ? 'text-white/70' : 'text-text-muted'}`}>{step.desc}</span>
            </button>
          ))}
        </div>

        <div className="min-w-0 space-y-3">
          {activeStep === 'metaApp' && (
            <div className="grid gap-3">
              <Field label="App ID" hint="开发者后台首页" value={appValue(drafts, app, 'appId')} onChange={value => update({ appId: value })} />
              <Field label="App Secret" hint={app.appSecretSet ? '已保存，留空不改' : '应用设置 > 基本'} secret placeholder={app.appSecretSet ? '已加密保存，留空则不修改' : '客户输入密码后复制粘贴'} onChange={value => update({ appSecret: value })} />
              <Field label="Business ID" hint="BM 设置里可找到" value={appValue(drafts, app, 'businessId')} onChange={value => update({ businessId: value })} />
              <ChecklistButton app={app} id="privacy_domain_saved" label="隐私政策和域名已填" drafts={drafts} setDrafts={setDrafts} />
            </div>
          )}

          {activeStep === 'webhook' && (
            <div className="space-y-3">
              <div className="rounded-xl border border-dashed border-border bg-surface-2 p-3">
                <p className="mb-2 text-xs font-black text-text-primary">复制到 Meta 后台</p>
                <div className="space-y-2">
                  <CopyLine label="Webhook URL" value={app.webhookUrl} />
                  <CopyLine label="Verify Token" value={app.webhookVerifyToken} />
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <ChecklistButton app={app} id="webhook_verified" label="Webhook 验证成功" drafts={drafts} setDrafts={setDrafts} />
                <ChecklistButton app={app} id="messages_subscribed" label="已订阅 messages / message_status" drafts={drafts} setDrafts={setDrafts} />
              </div>
            </div>
          )}

          {activeStep === 'whatsapp' && (
            <div className="grid gap-3">
              <Field label="Embedded Signup Config ID" hint="WhatsApp > Embedded Signup" value={appValue(drafts, app, 'waConfigId')} onChange={value => update({ waConfigId: value })} />
              <Field label="WABA ID" hint="WhatsApp Business Account" value={appValue(drafts, app, 'wabaId')} onChange={value => update({ wabaId: value })} />
              <Field label="Phone Number ID" hint="号码详情页" value={appValue(drafts, app, 'phoneNumberId')} onChange={value => update({ phoneNumberId: value })} />
              <Field label="Access Token" hint={app.accessTokenSet ? '已保存，留空不改' : '60天或永久 token'} secret placeholder={app.accessTokenSet ? '已加密保存，留空则不修改' : 'EAAB...'} onChange={value => update({ accessToken: value })} />
              <div className="grid grid-cols-2 gap-2">
                <label className="grid gap-1 text-xs font-bold text-text-secondary">
                  Token 类型
                  <select value={appValue(drafts, app, 'tokenType') || 'user_60d'} onChange={event => update({ tokenType: event.target.value })} className="rounded-xl border border-border bg-surface-2 px-3 py-2 text-sm font-normal text-text-primary outline-none">
                    <option value="user_60d">60天用户 token</option>
                    <option value="system_user_permanent">系统用户永久 token</option>
                  </select>
                </label>
                <Field label="到期时间" hint="ISO 时间" value={appValue(drafts, app, 'tokenExpiresAt')} placeholder="2026-08-01T00:00:00.000Z" onChange={value => update({ tokenExpiresAt: value })} />
              </div>
              <div className="flex flex-wrap gap-2">
                <ChecklistButton app={app} id="customer_scanned" label="客户已扫码/完成新号验证" drafts={drafts} setDrafts={setDrafts} />
                <ChecklistButton app={app} id="history_import_started" label="历史导入已启动" drafts={drafts} setDrafts={setDrafts} />
              </div>
            </div>
          )}

          {activeStep === 'social' && (
            <div className="grid gap-3">
              <Field label="Facebook Page ID" hint="主页详情/Graph API" value={appValue(drafts, app, 'pageId')} onChange={value => update({ pageId: value })} />
              <Field label="Instagram User ID" hint="IG 专业账号" value={appValue(drafts, app, 'igUserId')} onChange={value => update({ igUserId: value })} />
              <ChecklistButton app={app} id="fb_ig_authorized" label="客户已授权正确主页/IG" drafts={drafts} setDrafts={setDrafts} />
            </div>
          )}

          {activeStep === 'googleApp' && (
            <div className="grid gap-3">
              <Field label="Client ID" hint="Google Cloud OAuth" value={appValue(drafts, app, 'appId')} onChange={value => update({ appId: value })} />
              <Field label="Client Secret" hint={app.appSecretSet ? '已保存，留空不改' : 'Google Cloud OAuth'} secret placeholder={app.appSecretSet ? '已加密保存，留空则不修改' : '客户项目里的 Client Secret'} onChange={value => update({ appSecret: value })} />
              <ChecklistButton app={app} id="google_consent_published" label="OAuth 同意屏幕已发布到生产" drafts={drafts} setDrafts={setDrafts} />
            </div>
          )}

          {activeStep === 'youtube' && (
            <div className="grid gap-3">
              <Field label="YouTube Channel ID" hint="授权后可自动识别" value={appValue(drafts, app, 'youtubeChannelId')} onChange={value => update({ youtubeChannelId: value })} />
              <ChecklistButton app={app} id="youtube_authorized" label="客户已完成 YouTube 授权" drafts={drafts} setDrafts={setDrafts} />
            </div>
          )}

          {activeStep === 'acceptance' && (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                {(app.platform === 'meta'
                  ? ['wa_message_received', 'wa_reply_sent', 'boss_alert_received', 'fb_comment_received']
                  : ['youtube_channel_read']
                ).map(id => (
                  <ChecklistButton key={id} app={app} id={id} label={{
                    wa_message_received: '30秒内收到 WhatsApp 消息',
                    wa_reply_sent: '测试手机收到回复',
                    boss_alert_received: '老板提醒卡已收到',
                    fb_comment_received: '主页评论已进入收件箱',
                    youtube_channel_read: '能读取 YouTube 频道',
                  }[id] || id} drafts={drafts} setDrafts={setDrafts} />
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                {testItems.map(([kind, label]) => (
                  <button key={kind} type="button" onClick={() => void onTest(app, kind)} className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-white px-3 py-2 text-xs font-bold text-text-secondary hover:bg-surface-2">
                    {test[kind] === 'running' ? <Loader2 size={13} className="animate-spin" /> : test[kind] === 'ok' ? <CheckCircle2 size={13} className="text-emerald-600" /> : <ShieldCheck size={13} />}
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <label className="grid gap-1 text-xs font-bold text-text-secondary">
            交付备注
            <textarea value={appValue(drafts, app, 'notes')} onChange={event => update({ notes: event.target.value })} rows={2} placeholder="记录客户选择：共存/新号、测试手机号、异常处理、下次跟进时间。" className="resize-none rounded-xl border border-border bg-surface-2 px-3 py-2 text-sm font-normal text-text-primary outline-none" />
          </label>

          <div className="flex flex-wrap gap-2 border-t border-border pt-3">
            <button type="button" onClick={() => void onSave(app)} className="inline-flex items-center gap-1.5 rounded-xl bg-slate-950 px-3 py-2 text-xs font-bold text-white">
              <Save size={13} /> 保存配置
            </button>
            {app.platform === 'meta' && app.tokenType === 'user_60d' && (
              <button type="button" onClick={() => void onSave({ ...app, status: 'needs_permanent_token' })} className="inline-flex items-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">
                <KeyRound size={13} /> 标记待换永久 token
              </button>
            )}
            <button type="button" onClick={() => void onComplete(app)} className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-bold text-white">
              <CheckCircle2 size={13} /> 交付完成
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AdminDeliveryPage() {
  const [tenants, setTenants] = useState<TenantCard[]>([]);
  const [drafts, setDrafts] = useState<Draft>({});
  const [tests, setTests] = useState<TestState>({});
  const [assistLinks, setAssistLinks] = useState<AssistLinkState>({});
  const [progressBusyKey, setProgressBusyKey] = useState('');
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
        businessId: draft.businessId ?? app.businessId,
        wabaId: draft.wabaId ?? app.wabaId,
        phoneNumberId: draft.phoneNumberId ?? app.phoneNumberId,
        pageId: draft.pageId ?? app.pageId,
        igUserId: draft.igUserId ?? app.igUserId,
        youtubeChannelId: draft.youtubeChannelId ?? app.youtubeChannelId,
        tokenType: draft.tokenType ?? app.tokenType,
        accessToken: draft.accessToken ?? '',
        tokenExpiresAt: draft.tokenExpiresAt ?? app.tokenExpiresAt,
        status: draft.status ?? app.status,
        checklist: { ...(app.checklist ?? {}), ...(draft.checklist ?? {}) },
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
      const autoCheckId = {
        whatsapp: 'whatsapp_test_passed',
        pages: 'pages_test_passed',
        webhook: 'webhook_test_passed',
        google: 'google_test_passed',
      }[kind];
      if (autoCheckId) {
        await saveAppChecklist(app, { ...(app.checklist ?? {}), [autoCheckId]: true });
        await load();
      }
      setMessage(data.message || '自检通过');
    } catch (err) {
      setTests(current => ({ ...current, [appKey]: { ...current[appKey], [kind]: 'error' } }));
      setError(err instanceof Error ? err.message : '自检失败');
    }
  };

  const complete = async (app: DeliveryApp) => {
    const appKey = keyOf(app.tenantId, app.platform);
    const draft = drafts[appKey] ?? {};
    await jsonFetch(`/api/overseas/admin/delivery/platform-apps/${app.tenantId}/${app.platform}/complete`, {
      method: 'POST',
      body: JSON.stringify({ notes: draft.notes ?? app.notes }),
    });
    setMessage('已标记交付完成，客户端将显示“已由专属顾问配置”。');
    await load();
  };

  const createAssistLink = async (app: DeliveryApp) => {
    const appKey = keyOf(app.tenantId, app.platform);
    setAssistLinks(current => ({ ...current, [appKey]: { link: current[appKey]?.link ?? '', loading: true } }));
    setError('');
    try {
      const data = await jsonFetch('/api/admin/assist-links', {
        method: 'POST',
        body: JSON.stringify({ tenantId: app.tenantId, platform: app.platform }),
      });
      const link = String(data.link || '');
      setAssistLinks(current => ({ ...current, [appKey]: { link, loading: false } }));
      if (link) await navigator.clipboard?.writeText(link);
      setMessage('协助链接已生成并复制，24 小时内有效。');
    } catch (err) {
      setAssistLinks(current => ({ ...current, [appKey]: { link: current[appKey]?.link ?? '', loading: false } }));
      setError(err instanceof Error ? err.message : '协助链接生成失败');
    }
  };

  const saveAppChecklist = async (app: DeliveryApp, checklist: Record<string, boolean>) => {
    await jsonFetch(`/api/overseas/admin/delivery/platform-apps/${app.tenantId}/${app.platform}`, {
      method: 'PUT',
      body: JSON.stringify({
        appId: app.appId,
        appSecret: '',
        waConfigId: app.waConfigId,
        businessId: app.businessId,
        wabaId: app.wabaId,
        phoneNumberId: app.phoneNumberId,
        pageId: app.pageId,
        igUserId: app.igUserId,
        youtubeChannelId: app.youtubeChannelId,
        tokenType: app.tokenType,
        accessToken: '',
        tokenExpiresAt: app.tokenExpiresAt,
        status: app.status,
        checklist,
        notes: app.notes,
      }),
    });
  };

  const toggleProgressStage = async (tenant: TenantCard, key: ProgressStageKey) => {
    const app = appFor(tenant, 'meta');
    if (!app) return;
    const busy = `${tenant.tenantId}:${key}`;
    setProgressBusyKey(busy);
    setError('');
    try {
      const checklist = { ...(app.checklist ?? {}) };
      if (key === 'business_verification') {
        if (checklist.business_verification_approved) {
          checklist.business_verification_approved = false;
          checklist.business_verification_submitted = false;
        } else if (checklist.business_verification_submitted) {
          checklist.business_verification_approved = true;
        } else {
          checklist.business_verification_submitted = true;
        }
      } else {
        checklist[key] = !checklist[key];
      }
      await saveAppChecklist(app, checklist);
      setMessage('部署进度已更新');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '部署进度更新失败');
    } finally {
      setProgressBusyKey('');
    }
  };

  const summary = useMemo(() => {
    const apps = tenants.flatMap(tenant => tenant.apps);
    return {
      total: apps.length,
      active: apps.filter(app => app.status === 'active').length,
      risky: apps.filter(app => app.status === 'token_expired' || app.status === 'needs_permanent_token' || app.status === 'error').length,
    };
  }, [tenants]);

  return (
    <div className="flex h-full flex-col bg-white">
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-5">
        <div>
          <p className="text-sm font-black text-text-primary">交付工作台</p>
          <p className="text-[11px] text-text-muted">按内部部署指南录入每个租户的专属平台应用，不把 ID / Secret 写进代码。</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-surface-2 px-2.5 py-1 text-[11px] font-bold text-text-secondary">共 {summary.total} 项 · 已交付 {summary.active} · 风险 {summary.risky}</span>
          <button type="button" onClick={() => void load()} className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-white px-3 py-2 text-xs font-bold text-text-secondary">
            {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCcw size={13} />} 刷新
          </button>
        </div>
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
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-black text-text-primary">{tenant.name}</p>
                    <p className="mt-0.5 text-[11px] text-text-muted">Tenant ID: {tenant.tenantId}</p>
                  </div>
                  <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-bold text-text-secondary">现场预计 3 小时</span>
                </div>
                <DeploymentProgressStrip tenant={tenant} busyKey={progressBusyKey} onToggle={toggleProgressStage} />
                <div className="grid gap-3">
                  {tenant.apps.map(app => (
                    <PlatformWizard
                      key={`${tenant.tenantId}-${app.platform}`}
                      app={app}
                      drafts={drafts}
                      setDrafts={setDrafts}
                      tests={tests}
                      onSave={save}
                      onTest={test}
                      onComplete={complete}
                      onAssistLink={createAssistLink}
                      assistLink={assistLinks[keyOf(app.tenantId, app.platform)]}
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
