import { useEffect, useState } from 'react';
import { CheckCircle2, ChevronDown, Clipboard, KeyRound, Loader2, Save } from 'lucide-react';
import { authHeader } from '../lib/auth';
import { SocialPlatformIcon } from './SocialPlatformIcon';

type AppInfo = { appId: string; appSecretSet: boolean } | null;
type Config = {
  callbacks: Record<'youtube' | 'instagram' | 'facebook' | 'tiktok', string>;
  apps: Record<'google' | 'meta' | 'tiktok', AppInfo>;
};
type Form = {
  youtubeOAuthClientId: string;
  youtubeOAuthClientSecret: string;
  metaSocialAppId: string;
  metaSocialAppSecret: string;
  tiktokClientKey: string;
  tiktokClientSecret: string;
};
const EMPTY: Form = { youtubeOAuthClientId: '', youtubeOAuthClientSecret: '', metaSocialAppId: '', metaSocialAppSecret: '', tiktokClientKey: '', tiktokClientSecret: '' };

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

  async function load() {
    setLoading(true); setError('');
    try {
      const response = await fetch('/api/overseas/platform-integrations/oauth-config', { headers: authHeader() });
      const data = await response.json() as Config & { error?: string };
      if (!response.ok) throw new Error(data.error || '读取社媒应用配置失败');
      setConfig(data);
      setForm(current => ({ ...current, youtubeOAuthClientId: data.apps.google?.appId || '', metaSocialAppId: data.apps.meta?.appId || '', tiktokClientKey: data.apps.tiktok?.appId || '' }));
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
  const cards = config && [
    { key: 'google', title: 'YouTube / Google', icon: <SocialPlatformIcon platform="youtube" size={20} />, sub: 'Google Cloud OAuth Web application', idLabel: 'Client ID', idKey: 'youtubeOAuthClientId' as const, secretLabel: 'Client Secret', secretKey: 'youtubeOAuthClientSecret' as const, callbacks: [['Authorized redirect URI', config.callbacks.youtube]] },
    { key: 'meta', title: 'Instagram / Facebook', icon: <span className="flex gap-1"><SocialPlatformIcon platform="instagram" size={19} /><SocialPlatformIcon platform="facebook" size={19} /></span>, sub: '两个平台共用一套 Meta App', idLabel: 'App ID', idKey: 'metaSocialAppId' as const, secretLabel: 'App Secret', secretKey: 'metaSocialAppSecret' as const, callbacks: [['Instagram redirect URI', config.callbacks.instagram], ['Facebook redirect URI', config.callbacks.facebook]] },
    { key: 'tiktok', title: 'TikTok', icon: <SocialPlatformIcon platform="tiktok" size={20} />, sub: 'Login Kit + Content Posting API', idLabel: 'Client Key', idKey: 'tiktokClientKey' as const, secretLabel: 'Client Secret', secretKey: 'tiktokClientSecret' as const, callbacks: [['Redirect URI', config.callbacks.tiktok]] },
  ];
  return <section className="mb-5 overflow-hidden rounded-2xl border border-emerald-200 bg-white shadow-sm">
    <button type="button" onClick={() => setOpen(value => !value)} className="flex w-full items-center justify-between gap-3 bg-emerald-50/60 px-5 py-4 text-left">
      <div><h2 className="flex items-center gap-2 text-sm font-black text-text-primary"><KeyRound size={16} className="text-emerald-600" />配置我自己的社媒应用</h2><p className="mt-1 text-xs text-text-secondary">凭证只用于你的企业空间，账号授权与发布不与其他用户共用出口配置。</p></div><ChevronDown size={16} className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
    </button>
    {open && <div className="space-y-4 border-t border-emerald-100 p-5">
      <p className="text-[11px] text-amber-700">先在 Google、Meta 或 TikTok 开发者后台创建应用，再填写凭证。Secret 会加密保存，页面不会再次明文显示。</p>
      {message && <p className="rounded-xl bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700">{message}</p>}{error && <p className="rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-700">{error}</p>}
      {loading ? <div className="flex h-24 items-center justify-center gap-2 text-sm text-text-muted"><Loader2 size={16} className="animate-spin" />正在读取配置...</div> : <>
        <div className="grid gap-3 xl:grid-cols-3">{cards?.map(card => <div key={card.key} className="space-y-3 rounded-2xl border border-border p-4">
          <div><p className="flex items-center gap-2 text-sm font-black text-text-primary">{card.icon}{card.title}</p><p className="mt-1 text-[11px] text-text-muted">{card.sub}</p></div>
          <Field label={card.idLabel} value={form[card.idKey]} onChange={value => field(card.idKey, value)} />
          <Field label={card.secretLabel} value={form[card.secretKey]} saved={config?.apps[card.key as keyof Config['apps']]?.appSecretSet} onChange={value => field(card.secretKey, value)} />
          {card.callbacks.map(([label, value]) => <Callback key={label} label={label} value={value} />)}
        </div>)}</div>
        <div className="flex justify-end"><button type="button" disabled={saving} onClick={() => void save()} className="inline-flex items-center gap-1.5 rounded-xl bg-slate-950 px-4 py-2.5 text-xs font-black text-white disabled:opacity-50">{saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}保存我的平台凭证</button></div>
      </>}
    </div>}
  </section>;
}
