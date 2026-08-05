import { useEffect, useState } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, ChevronDown, Clipboard, KeyRound, Loader2, RefreshCw, Save, Trash2 } from 'lucide-react';
import { authHeader } from '../lib/auth';
import { getWhatsAppEmbeddedSignupConfig, startWhatsAppEmbeddedSignup } from '../lib/whatsappEmbeddedSignup';
import { SocialPlatformIcon } from './SocialPlatformIcon';

type AppInfo = {
  appId: string;
  appSecretSet: boolean;
  waConfigId: string;
  phoneNumberId: string;
  waPublicNumber: string;
  webhookVerifyToken: string;
  accessTokenSet: boolean;
  status: string;
} | null;
type Config = {
  callbacks: Record<'youtube' | 'instagram' | 'facebook' | 'tiktok', string>;
  metaWebhookUrl: string;
  apps: Record<'google' | 'meta' | 'tiktok', AppInfo>;
};
type ConfigPlatform = keyof Config['apps'];
type Form = {
  youtubeOAuthClientId: string;
  youtubeOAuthClientSecret: string;
  metaSocialAppId: string;
  metaSocialAppSecret: string;
  metaWhatsAppConfigId: string;
  tiktokClientKey: string;
  tiktokClientSecret: string;
};
const EMPTY: Form = { youtubeOAuthClientId: '', youtubeOAuthClientSecret: '', metaSocialAppId: '', metaSocialAppSecret: '', metaWhatsAppConfigId: '', tiktokClientKey: '', tiktokClientSecret: '' };

const PLATFORM_LABELS: Record<ConfigPlatform, string> = {
  google: 'YouTube / Google',
  meta: 'Instagram / Facebook / WhatsApp',
  tiktok: 'TikTok',
};

function withoutPlatformCredentials(form: Form, platform: ConfigPlatform): Form {
  if (platform === 'google') return { ...form, youtubeOAuthClientId: '', youtubeOAuthClientSecret: '' };
  if (platform === 'meta') return { ...form, metaSocialAppId: '', metaSocialAppSecret: '', metaWhatsAppConfigId: '' };
  return { ...form, tiktokClientKey: '', tiktokClientSecret: '' };
}

function Callback({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return <div className="rounded-xl border border-border bg-surface-2 px-3 py-2">
    <div className="mb-1 flex items-center justify-between gap-2"><span className="text-[10px] font-bold text-text-muted">{label}</span>
      <button type="button" onClick={async () => { await navigator.clipboard?.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1200); }} className="inline-flex items-center gap-1 rounded-lg bg-white px-2 py-1 text-[10px] font-bold text-text-secondary">
        {copied ? <CheckCircle2 size={11} className="text-emerald-600" /> : <Clipboard size={11} />}{copied ? '已复制' : '复制'}
      </button>
    </div><code className="block break-all text-[11px] text-text-secondary">{value}</code>
  </div>;
}

function Field({ label, value, saved, onChange }: { label: string; value: string; saved?: boolean; onChange: (value: string) => void }) {
  return <label className="grid gap-1 text-[11px] font-bold text-text-secondary">
    <span className="flex items-center justify-between"><span>{label}<span className="ml-0.5 text-red-500">*</span></span>{(value.trim() || saved) && <span className="inline-flex items-center gap-1 text-[10px] text-emerald-600"><CheckCircle2 size={11} />已填写</span>}</span>
    <input type="text" autoComplete="off" data-1p-ignore data-lpignore="true" value={value} onChange={e => onChange(e.target.value)} placeholder={saved ? '已安全保存；留空表示不修改' : label} className="rounded-xl border border-border bg-surface-2 px-3 py-2.5 text-sm font-normal text-text-primary outline-none focus:border-emerald-400" />
  </label>;
}

export default function UserSocialAppCredentials() {
  const [open, setOpen] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [config, setConfig] = useState<Config | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [clearTarget, setClearTarget] = useState<ConfigPlatform | null>(null);
  const [clearing, setClearing] = useState(false);

  async function load() {
    setLoading(true); setError('');
    try {
      const response = await fetch('/api/overseas/platform-integrations/oauth-config', { headers: authHeader() });
      const data = await response.json() as Config & { error?: string };
      if (!response.ok) throw new Error(data.error || '读取社媒应用配置失败');
      setConfig(data);
      setForm(current => ({ ...current, youtubeOAuthClientId: data.apps.google?.appId || '', metaSocialAppId: data.apps.meta?.appId || '', metaWhatsAppConfigId: data.apps.meta?.waConfigId || '', tiktokClientKey: data.apps.tiktok?.appId || '' }));
    } catch (reason) { setError(reason instanceof Error ? reason.message : '读取社媒应用配置失败'); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  const field = <K extends keyof Form>(key: K, value: Form[K]) => setForm(current => ({ ...current, [key]: value }));
  async function save() {
    setSaving(true); setMessage(''); setError('');
    try {
      const response = await fetch('/api/overseas/platform-integrations/oauth-config', { method: 'PUT', headers: { ...authHeader(), 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      const data = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(data.error || '保存失败');
      setMessage('已保存到你的企业空间。请把下方回调地址原样添加到各平台后台，再连接账号。');
      setForm(current => ({ ...current, youtubeOAuthClientSecret: '', metaSocialAppSecret: '', tiktokClientSecret: '' }));
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : '保存失败'); }
    finally { setSaving(false); }
  }
  async function clearPlatform() {
    if (!clearTarget) return;
    setClearing(true); setMessage(''); setError('');
    try {
      const response = await fetch(`/api/overseas/platform-integrations/oauth-config/${clearTarget}`, {
        method: 'DELETE',
        headers: authHeader(),
      });
      const data = await response.json().catch(() => ({})) as { error?: string; detail?: string; disconnectedAccounts?: number };
      if (!response.ok) throw new Error(data.detail || data.error || '清除平台配置失败');
      const label = PLATFORM_LABELS[clearTarget];
      const accountCount = data.disconnectedAccounts ?? 0;
      setForm(current => withoutPlatformCredentials(current, clearTarget));
      setClearTarget(null);
      await load();
      setMessage(`${label} 配置已清除${accountCount > 0 ? `，并已断开 ${accountCount} 个已连接账号` : ''}。`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '清除平台配置失败'); }
    finally { setClearing(false); }
  }
  const cards = config && [
    { key: 'google', title: 'YouTube / Google', icon: <SocialPlatformIcon platform="youtube" size={20} />, sub: 'Google Cloud OAuth Web application', idLabel: 'Client ID', idKey: 'youtubeOAuthClientId' as const, secretLabel: 'Client Secret', secretKey: 'youtubeOAuthClientSecret' as const, callbacks: [['Authorized redirect URI', config.callbacks.youtube]] },
    { key: 'meta', title: 'Instagram / Facebook / WhatsApp', icon: <span className="flex gap-1"><SocialPlatformIcon platform="instagram" size={19} /><SocialPlatformIcon platform="facebook" size={19} /><SocialPlatformIcon platform="whatsapp" size={19} /></span>, sub: '三个平台共用一套 Meta App', idLabel: 'App ID', idKey: 'metaSocialAppId' as const, secretLabel: 'App Secret', secretKey: 'metaSocialAppSecret' as const, callbacks: [['Instagram redirect URI', config.callbacks.instagram], ['Facebook redirect URI', config.callbacks.facebook], ['WhatsApp Webhook Callback URL', config.metaWebhookUrl], ['WhatsApp Webhook Verify Token', config.apps.meta?.webhookVerifyToken || '保存 Meta 应用后自动生成']] },
    { key: 'tiktok', title: 'TikTok', icon: <SocialPlatformIcon platform="tiktok" size={20} />, sub: 'Login Kit + Content Posting API', idLabel: 'Client Key', idKey: 'tiktokClientKey' as const, secretLabel: 'Client Secret', secretKey: 'tiktokClientSecret' as const, callbacks: [['Redirect URI', config.callbacks.tiktok]] },
  ];
  return <>
  <section className="mb-5 overflow-hidden rounded-2xl border border-emerald-200 bg-white shadow-sm">
    <button type="button" onClick={() => setOpen(value => !value)} className="flex w-full items-center justify-between gap-3 bg-emerald-50/60 px-5 py-4 text-left">
      <div><h2 className="flex items-center gap-2 text-sm font-black text-text-primary"><KeyRound size={16} className="text-emerald-600" />配置我自己的社媒应用</h2><p className="mt-1 text-xs text-text-secondary">凭证只用于你的企业空间，账号授权与发布不与其他用户共用出口配置。</p></div><ChevronDown size={16} className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
    </button>
    {open && <div className="space-y-4 border-t border-emerald-100 p-5">
      <p className="text-[11px] text-amber-700">先在 Google、Meta 或 TikTok 开发者后台创建应用，再填写凭证。Secret 会加密保存，页面不会再次明文显示。</p>
      {message && <p className="rounded-xl bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700">{message}</p>}{error && <p className="rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-700">{error}</p>}
      {loading ? <div className="flex h-24 items-center justify-center gap-2 text-sm text-text-muted"><Loader2 size={16} className="animate-spin" />正在读取配置...</div> : <>
        <div className="grid gap-3 xl:grid-cols-3">{cards?.map(card => <div key={card.key} className="space-y-3 rounded-2xl border border-border p-4">
          <div className="flex items-start justify-between gap-3">
            <div><p className="flex items-center gap-2 text-sm font-black text-text-primary">{card.icon}{card.title}</p><p className="mt-1 text-[11px] text-text-muted">{card.sub}</p></div>
            <button
              type="button"
              onClick={() => setClearTarget(card.key as ConfigPlatform)}
              disabled={!config?.apps[card.key as ConfigPlatform] || clearing}
              aria-label={`清除 ${card.title} 平台配置`}
              className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-2 py-1.5 text-[10px] font-bold text-red-600 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:border-border disabled:bg-surface-2 disabled:text-text-muted"
            >
              <Trash2 size={11} />清除配置
            </button>
          </div>
          <Field label={card.idLabel} value={form[card.idKey]} onChange={value => field(card.idKey, value)} />
          <Field label={card.secretLabel} value={form[card.secretKey]} saved={config?.apps[card.key as keyof Config['apps']]?.appSecretSet} onChange={value => field(card.secretKey, value)} />
          {card.key === 'meta' && <Field label="Embedded Signup Config ID（连接 WhatsApp 时填写）" value={form.metaWhatsAppConfigId} onChange={value => field('metaWhatsAppConfigId', value)} />}
          {card.callbacks.map(([label, value]) => <Callback key={label} label={label} value={value} />)}
        </div>)}</div>
        <div className="flex justify-end"><button type="button" disabled={saving} onClick={() => void save()} className="inline-flex items-center gap-1.5 rounded-xl bg-slate-950 px-4 py-2.5 text-xs font-black text-white disabled:opacity-50">{saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}保存我的平台凭证</button></div>
      </>}
    </div>}
  </section>
  {clearTarget && <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/45 p-4" role="presentation" onMouseDown={() => !clearing && setClearTarget(null)}>
    <div role="dialog" aria-modal="true" aria-labelledby="clear-user-platform-title" className="w-full max-w-md rounded-2xl border border-red-100 bg-white p-5 shadow-2xl" onMouseDown={event => event.stopPropagation()}>
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-600"><AlertTriangle size={19} /></span>
        <div>
          <h3 id="clear-user-platform-title" className="text-base font-black text-text-primary">清除 {PLATFORM_LABELS[clearTarget]} 配置？</h3>
          <p className="mt-2 text-sm leading-6 text-text-secondary">应用凭证会从你的企业空间中删除，这个平台下已连接的账号也会同时断开。</p>
          <p className="mt-2 text-xs leading-5 text-text-muted">这不会撤销第三方平台后台的授权；如需彻底撤销，请同时到对应平台的账号安全设置中移除本应用。</p>
        </div>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" onClick={() => setClearTarget(null)} disabled={clearing} className="rounded-xl border border-border bg-white px-4 py-2.5 text-xs font-bold text-text-secondary disabled:opacity-50">取消</button>
        <button type="button" onClick={() => void clearPlatform()} disabled={clearing} className="inline-flex items-center gap-1.5 rounded-xl bg-red-600 px-4 py-2.5 text-xs font-black text-white disabled:opacity-50">
          {clearing ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}确认清除
        </button>
      </div>
    </div>
  </div>}
  </>;
}

export function WhatsAppConnectionPanel() {
  const [config, setConfig] = useState<Config | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/overseas/platform-integrations/oauth-config', { headers: authHeader() });
      const data = await response.json().catch(() => ({})) as Config & { error?: string };
      if (!response.ok) throw new Error(data.error || '读取 WhatsApp 配置失败');
      setConfig(data);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '读取 WhatsApp 配置失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);
  const meta = config?.apps.meta;
  const connected = Boolean(meta?.phoneNumberId && meta?.accessTokenSet && meta?.status === 'active');

  async function connect() {
    setConnecting(true);
    setMessage('');
    setError('');
    try {
      const signupConfig = await getWhatsAppEmbeddedSignupConfig();
      await startWhatsAppEmbeddedSignup(signupConfig);
      setMessage('WhatsApp Business 已连接成功。');
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'WhatsApp 授权没有完成');
    } finally {
      setConnecting(false);
    }
  }

  return <section className="flex min-h-[360px] flex-col rounded-xl border border-gray-200 bg-white p-5">
    <div className="flex flex-col items-stretch gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600"><SocialPlatformIcon platform="whatsapp" size={24} /></div>
        <div className="min-w-0"><h2 className="text-sm font-semibold text-gray-900">WhatsApp Business 一键授权</h2><p className="mt-1 text-xs leading-relaxed text-gray-500">连接后，客户发来的 WhatsApp 消息会自动进入“我的客户”。</p></div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button type="button" onClick={() => void load()} disabled={loading} title="刷新" className="rounded-lg border border-gray-200 p-2 text-gray-500 disabled:opacity-50"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /></button>
        <button type="button" onClick={() => void connect()} disabled={connecting || loading} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
          {connecting ? <Loader2 size={15} className="animate-spin" /> : <SocialPlatformIcon platform="whatsapp" size={17} />}{connected ? '重新连接' : '连接 WhatsApp'}
        </button>
      </div>
    </div>
    {message && <div className="mt-4 flex items-start gap-2 rounded-lg bg-green-50 px-3 py-2 text-xs text-green-700"><CheckCircle2 size={14} className="mt-0.5 shrink-0" /><span>{message}</span></div>}
    {error && <div className="mt-4 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600"><AlertCircle size={14} className="mt-0.5 shrink-0" /><span>{error}</span></div>}
    {loading ? <div className="mt-auto flex min-h-[104px] items-center gap-2 text-sm text-gray-400"><Loader2 size={16} className="animate-spin" />正在读取 WhatsApp 状态...</div> : connected ? (
      <div className="mt-auto rounded-xl border border-gray-200 p-4">
        <div className="flex items-center gap-2"><CheckCircle2 size={18} className="text-emerald-600" /><p className="text-sm font-semibold text-gray-900">WhatsApp Business 已连接</p></div>
        <div className="mt-3 grid gap-2 text-xs text-gray-500 sm:grid-cols-2">
          <div className="rounded-lg bg-gray-50 px-3 py-2"><span className="block text-[10px] text-gray-400">号码</span>{meta?.waPublicNumber || '已完成授权'}</div>
          <div className="rounded-lg bg-gray-50 px-3 py-2"><span className="block text-[10px] text-gray-400">Phone Number ID</span><span className="break-all">{meta?.phoneNumberId}</span></div>
        </div>
      </div>
    ) : <div className="mt-auto rounded-xl border border-dashed border-gray-200 px-4 py-5 text-center"><SocialPlatformIcon platform="whatsapp" size={32} className="mx-auto mb-2 opacity-35" /><p className="text-sm font-medium text-gray-700">还没有连接 WhatsApp Business</p><p className="mt-1 text-xs text-gray-400">请先在上方保存 Meta App 和 Embedded Signup Config ID。</p></div>}
  </section>;
}
