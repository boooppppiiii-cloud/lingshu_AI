import { useEffect, useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clipboard,
  KeyRound,
  Loader2,
  RefreshCw,
  Save,
  ShieldCheck,
} from 'lucide-react';
import { authHeader } from '../lib/auth';
import { SocialConnectionPanel, YouTubeConnectionPanel } from './YouTubeIntegration';

interface AdminOAuthConfig {
  admin: string;
  updatedAt: string | null;
  callbacks: {
    youtube: string;
    instagram: string;
    facebook: string;
    tiktok: string;
  };
  values: {
    youtubeOAuthClientId: string;
    metaSocialAppId: string;
    tiktokClientKey: string;
    advancedManualConnectEnabled: boolean;
  };
  secretSet: {
    youtubeOAuthClientSecret: boolean;
    metaSocialAppSecret: boolean;
    tiktokClientSecret: boolean;
  };
}

interface OAuthForm {
  youtubeOAuthClientId: string;
  youtubeOAuthClientSecret: string;
  metaSocialAppId: string;
  metaSocialAppSecret: string;
  tiktokClientKey: string;
  tiktokClientSecret: string;
  advancedManualConnectEnabled: boolean;
}

const EMPTY_FORM: OAuthForm = {
  youtubeOAuthClientId: '',
  youtubeOAuthClientSecret: '',
  metaSocialAppId: '',
  metaSocialAppSecret: '',
  tiktokClientKey: '',
  tiktokClientSecret: '',
  advancedManualConnectEnabled: false,
};

function formFromConfig(config: AdminOAuthConfig): OAuthForm {
  return {
    youtubeOAuthClientId: config.values.youtubeOAuthClientId,
    youtubeOAuthClientSecret: '',
    metaSocialAppId: config.values.metaSocialAppId,
    metaSocialAppSecret: '',
    tiktokClientKey: config.values.tiktokClientKey,
    tiktokClientSecret: '',
    advancedManualConnectEnabled: config.values.advancedManualConnectEnabled,
  };
}

function CallbackLine({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard?.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  return (
    <div className="rounded-xl border border-border bg-surface-2 px-3 py-2">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-[10px] font-bold text-text-muted">{label}</span>
        <button
          type="button"
          onClick={() => void copy()}
          className="inline-flex items-center gap-1 rounded-lg bg-white px-2 py-1 text-[10px] font-bold text-text-secondary"
        >
          {copied ? <CheckCircle2 size={11} className="text-emerald-600" /> : <Clipboard size={11} />}
          {copied ? '已复制' : '复制'}
        </button>
      </div>
      <code className="block break-all text-[11px] text-text-secondary">{value}</code>
    </div>
  );
}

function CredentialField({
  fieldName,
  label,
  value,
  secret,
  secretSaved,
  onChange,
}: {
  fieldName: string;
  label: string;
  value: string;
  secret?: boolean;
  secretSaved?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-1 text-[11px] font-bold text-text-secondary">
      <span className="flex items-center justify-between gap-2">
        {label}
        {secret && secretSaved && <span className="text-[10px] text-emerald-600">已保存</span>}
      </span>
      <input
        name={fieldName}
        type={secret ? 'password' : 'text'}
        autoComplete={secret ? 'new-password' : 'off'}
        data-1p-ignore
        data-lpignore="true"
        data-form-type="other"
        value={value}
        onChange={event => onChange(event.target.value)}
        placeholder={secret && secretSaved ? '留空则继续使用已保存的 Secret' : label}
        className="rounded-xl border border-border bg-surface-2 px-3 py-2.5 text-sm font-normal text-text-primary outline-none focus:border-emerald-400"
      />
    </label>
  );
}

export default function AdminSocialAccountSetup() {
  const [open, setOpen] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [config, setConfig] = useState<AdminOAuthConfig | null>(null);
  const [form, setForm] = useState<OAuthForm>(EMPTY_FORM);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/overseas/admin/oauth-config', { headers: authHeader() });
      const data = await response.json().catch(() => ({})) as AdminOAuthConfig & { error?: string };
      if (!response.ok) throw new Error(data.error || '无法读取管理员平台配置');
      setConfig(data);
      setForm(formFromConfig(data));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法读取管理员平台配置');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function setField<K extends keyof OAuthForm>(key: K, value: OAuthForm[K]) {
    setForm(current => ({ ...current, [key]: value }));
  }

  async function save() {
    setSaving(true);
    setNotice('');
    setError('');
    try {
      const response = await fetch('/api/overseas/admin/oauth-config', {
        method: 'PUT',
        headers: { ...authHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await response.json().catch(() => ({})) as AdminOAuthConfig & { error?: string };
      if (!response.ok) throw new Error(data.error || '保存平台配置失败');
      setConfig(data);
      setForm(formFromConfig(data));
      setNotice('平台凭证已保存，现在可以直接连接管理员自己的社媒账号。');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '保存平台配置失败');
    } finally {
      setSaving(false);
    }
  }

  const oauthPanelsKey = config?.updatedAt || 'oauth-not-configured';

  return (
    <section className="mb-4 overflow-hidden rounded-2xl border border-emerald-200 bg-emerald-50/40 shadow-sm">
      <button
        type="button"
        onClick={() => setOpen(current => !current)}
        className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
      >
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white">
            <ShieldCheck size={18} />
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-black text-text-primary">管理员自用账号直连</h2>
              <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-bold text-emerald-700">无需创建租户</span>
            </div>
            <p className="mt-1 text-xs leading-5 text-text-secondary">这里连接的账号只属于当前管理员，可直接在“一键发布”中使用。</p>
          </div>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-emerald-200 bg-white px-3 py-2 text-xs font-bold text-emerald-700">
          {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          {open ? '收起' : '展开配置'}
        </span>
      </button>

      {open && (
        <div className="space-y-5 border-t border-emerald-100 bg-white p-5">
          {notice && <p className="rounded-xl bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700">{notice}</p>}
          {error && (
            <div className="flex items-center justify-between gap-3 rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-700">
              <span>{error}</span>
              <button type="button" onClick={() => void load()} className="inline-flex items-center gap-1 rounded-lg bg-white px-2 py-1">
                <RefreshCw size={11} /> 重试
              </button>
            </div>
          )}

          {loading ? (
            <div className="flex h-28 items-center justify-center gap-2 text-sm text-text-muted">
              <Loader2 size={17} className="animate-spin" /> 正在读取平台配置...
            </div>
          ) : config ? (
            <>
              <div>
                <div className="mb-3 flex items-center gap-2">
                  <KeyRound size={15} className="text-emerald-600" />
                  <h3 className="text-sm font-black text-text-primary">平台应用凭证</h3>
                  <span className="text-[11px] text-text-muted">先在对应开发者后台登记下方回调地址，再保存凭证。</span>
                </div>

                <div className="grid gap-3 xl:grid-cols-3">
                  <div className="space-y-3 rounded-2xl border border-border p-4">
                    <div>
                      <p className="text-sm font-black text-text-primary">YouTube / Google</p>
                      <p className="mt-1 text-[11px] text-text-muted">Google Cloud OAuth Web application</p>
                    </div>
                    <CredentialField fieldName="youtube-oauth-client-id" label="Client ID" value={form.youtubeOAuthClientId} onChange={value => setField('youtubeOAuthClientId', value)} />
                    <CredentialField fieldName="youtube-oauth-client-secret" label="Client Secret" secret secretSaved={config.secretSet.youtubeOAuthClientSecret} value={form.youtubeOAuthClientSecret} onChange={value => setField('youtubeOAuthClientSecret', value)} />
                    <CallbackLine label="Authorized redirect URI" value={config.callbacks.youtube} />
                  </div>

                  <div className="space-y-3 rounded-2xl border border-border p-4">
                    <div>
                      <p className="text-sm font-black text-text-primary">Instagram / Facebook</p>
                      <p className="mt-1 text-[11px] text-text-muted">两个平台共用一套 Meta App</p>
                    </div>
                    <CredentialField fieldName="meta-social-app-id" label="App ID" value={form.metaSocialAppId} onChange={value => setField('metaSocialAppId', value)} />
                    <CredentialField fieldName="meta-social-app-secret" label="App Secret" secret secretSaved={config.secretSet.metaSocialAppSecret} value={form.metaSocialAppSecret} onChange={value => setField('metaSocialAppSecret', value)} />
                    <CallbackLine label="Instagram redirect URI" value={config.callbacks.instagram} />
                    <CallbackLine label="Facebook redirect URI" value={config.callbacks.facebook} />
                  </div>

                  <div className="space-y-3 rounded-2xl border border-border p-4">
                    <div>
                      <p className="text-sm font-black text-text-primary">TikTok</p>
                      <p className="mt-1 text-[11px] text-text-muted">Login Kit + Content Posting API</p>
                    </div>
                    <CredentialField fieldName="tiktok-client-key" label="Client Key" value={form.tiktokClientKey} onChange={value => setField('tiktokClientKey', value)} />
                    <CredentialField fieldName="tiktok-client-secret" label="Client Secret" secret secretSaved={config.secretSet.tiktokClientSecret} value={form.tiktokClientSecret} onChange={value => setField('tiktokClientSecret', value)} />
                    <CallbackLine label="Redirect URI" value={config.callbacks.tiktok} />
                  </div>
                </div>

                <div className="mt-4 flex justify-end">
                  <button
                    type="button"
                    onClick={() => void save()}
                    disabled={saving}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-slate-950 px-4 py-2.5 text-xs font-black text-white disabled:opacity-50"
                  >
                    {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                    保存平台凭证
                  </button>
                </div>
              </div>

              <div className="border-t border-border pt-5">
                <div className="mb-3">
                  <h3 className="text-sm font-black text-text-primary">连接管理员账号</h3>
                  <p className="mt-1 text-[11px] text-text-muted">凭证保存后，点击对应平台的连接按钮并在官方页面完成授权。</p>
                </div>
                <div key={oauthPanelsKey} className="grid gap-3 xl:grid-cols-2">
                  <YouTubeConnectionPanel compact />
                  <SocialConnectionPanel platform="instagram" />
                  <SocialConnectionPanel platform="facebook" />
                  <SocialConnectionPanel platform="tiktok" />
                </div>
              </div>
            </>
          ) : null}
        </div>
      )}
    </section>
  );
}
