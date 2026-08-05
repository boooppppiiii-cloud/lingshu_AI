import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clipboard,
  KeyRound,
  Loader2,
  RefreshCw,
  Save,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { authHeader } from '../lib/auth';
import { SocialPlatformIcon } from './SocialPlatformIcon';
import { SocialConnectionPanel, YouTubeConnectionPanel } from './YouTubeIntegration';

type ClearableOAuthPlatform = 'youtube' | 'meta' | 'tiktok';

interface AdminOAuthConfig {
  admin: string;
  updatedAt: string | null;
  disabledPlatforms?: ClearableOAuthPlatform[];
  callbacks: {
    youtube: string;
    instagram: string;
    facebook: string;
    tiktok: string;
  };
  values: {
    youtubeOAuthClientId: string;
    youtubeOAuthClientSecret: string;
    metaSocialAppId: string;
    metaSocialAppSecret: string;
    tiktokClientKey: string;
    tiktokClientSecret: string;
    advancedManualConnectEnabled: boolean;
  };
  secretSet: {
    youtubeOAuthClientSecret: boolean;
    metaSocialAppSecret: boolean;
    tiktokClientSecret: boolean;
  };
  secretLength?: {
    youtubeOAuthClientSecret: number;
    metaSocialAppSecret: number;
    tiktokClientSecret: number;
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
    youtubeOAuthClientSecret: config.values.youtubeOAuthClientSecret,
    metaSocialAppId: config.values.metaSocialAppId,
    metaSocialAppSecret: config.values.metaSocialAppSecret,
    tiktokClientKey: config.values.tiktokClientKey,
    tiktokClientSecret: config.values.tiktokClientSecret,
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
  required,
  onChange,
}: {
  fieldName: string;
  label: string;
  value: string;
  required?: boolean;
  onChange: (value: string) => void;
}) {
  const isCompleted = Boolean(value.trim());

  return (
    <label className="grid gap-1 text-[11px] font-bold text-text-secondary">
      <span className="flex items-center justify-between gap-2">
        <span>
          {label}
          {required && <span className="ml-0.5 text-red-500" aria-label="必填">*</span>}
        </span>
        {isCompleted && (
          <span className="inline-flex items-center gap-1 whitespace-nowrap text-[10px] text-emerald-600">
            <CheckCircle2 size={11} /> 填写完成
          </span>
        )}
      </span>
      <input
        name={fieldName}
        type="text"
        required={required}
        aria-required={required}
        autoComplete="off"
        data-1p-ignore
        data-lpignore="true"
        data-form-type="other"
        value={value}
        onChange={event => onChange(event.target.value)}
        placeholder={label}
        className="rounded-xl border border-border bg-surface-2 px-3 py-2.5 text-sm font-normal text-text-primary outline-none focus:border-emerald-400"
      />
    </label>
  );
}

function ClearConfigButton({
  platformLabel,
  disabled,
  onClick,
}: {
  platformLabel: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={`清除 ${platformLabel} 平台配置`}
      className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-2 py-1.5 text-[10px] font-bold text-red-600 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:border-border disabled:bg-surface-2 disabled:text-text-muted"
    >
      <Trash2 size={11} /> 清除配置
    </button>
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
  const [clearTarget, setClearTarget] = useState<ClearableOAuthPlatform | null>(null);
  const [clearing, setClearing] = useState(false);

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
      setNotice('平台凭证已保存。请确认下方回调地址已原样登记到平台后台，再让客户连接账号。');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '保存平台配置失败');
    } finally {
      setSaving(false);
    }
  }

  async function clearPlatformConfig() {
    if (!clearTarget) return;
    setClearing(true);
    setNotice('');
    setError('');
    try {
      const response = await fetch(`/api/overseas/admin/oauth-config/${clearTarget}`, {
        method: 'DELETE',
        headers: authHeader(),
      });
      const data = await response.json().catch(() => ({})) as {
        error?: string;
        detail?: string;
        disconnectedAccounts?: number;
        config?: AdminOAuthConfig;
      };
      if (!response.ok || !data.config) {
        throw new Error(data.detail || data.error || '清除平台配置失败');
      }
      setConfig(data.config);
      setForm(formFromConfig(data.config));
      const label = clearTarget === 'youtube'
        ? 'YouTube / Google'
        : clearTarget === 'meta'
          ? 'Instagram / Facebook'
          : 'TikTok';
      const accountCount = data.disconnectedAccounts ?? 0;
      setNotice(`${label} 配置已清除${accountCount > 0 ? `，并已断开 ${accountCount} 个已连接账号` : ''}。`);
      setClearTarget(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '清除平台配置失败');
    } finally {
      setClearing(false);
    }
  }

  const oauthPanelsKey = config?.updatedAt || 'oauth-not-configured';
  const youtubeConfigured = Boolean(form.youtubeOAuthClientId.trim() || form.youtubeOAuthClientSecret.trim());
  const metaConfigured = Boolean(form.metaSocialAppId.trim() || form.metaSocialAppSecret.trim());
  const tiktokConfigured = Boolean(form.tiktokClientKey.trim() || form.tiktokClientSecret.trim());

  return (
    <>
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
                  <span className="text-[11px] text-amber-700">保存凭证后，还要把下方回调地址原样登记到平台后台；域名、https 和路径都必须完全一致。</span>
                </div>

                <div className="grid gap-3 xl:grid-cols-3">
                  <div className="space-y-3 rounded-2xl border border-border p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="flex items-center gap-2 text-sm font-black text-text-primary">
                          <SocialPlatformIcon platform="youtube" size={20} /> YouTube / Google
                        </p>
                        <p className="mt-1 text-[11px] text-text-muted">Google Cloud OAuth Web application</p>
                      </div>
                      <ClearConfigButton platformLabel="YouTube / Google" disabled={!youtubeConfigured || clearing} onClick={() => setClearTarget('youtube')} />
                    </div>
                    <CredentialField required fieldName="youtube-oauth-client-id" label="Client ID" value={form.youtubeOAuthClientId} onChange={value => setField('youtubeOAuthClientId', value)} />
                    <CredentialField required fieldName="youtube-oauth-client-secret" label="Client Secret" value={form.youtubeOAuthClientSecret} onChange={value => setField('youtubeOAuthClientSecret', value)} />
                    <CallbackLine label="Authorized redirect URI" value={config.callbacks.youtube} />
                  </div>

                  <div className="space-y-3 rounded-2xl border border-border p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="flex items-center gap-2 text-sm font-black text-text-primary">
                          <span className="flex items-center gap-1">
                            <SocialPlatformIcon platform="instagram" size={19} />
                            <SocialPlatformIcon platform="facebook" size={19} />
                          </span>
                          Instagram / Facebook
                        </p>
                        <p className="mt-1 text-[11px] text-text-muted">两个平台共用一套 Meta App</p>
                      </div>
                      <ClearConfigButton platformLabel="Instagram / Facebook" disabled={!metaConfigured || clearing} onClick={() => setClearTarget('meta')} />
                    </div>
                    <CredentialField required fieldName="meta-social-app-id" label="App ID" value={form.metaSocialAppId} onChange={value => setField('metaSocialAppId', value)} />
                    <CredentialField required fieldName="meta-social-app-secret" label="App Secret" value={form.metaSocialAppSecret} onChange={value => setField('metaSocialAppSecret', value)} />
                    <CallbackLine label="Instagram redirect URI" value={config.callbacks.instagram} />
                    <CallbackLine label="Facebook redirect URI" value={config.callbacks.facebook} />
                  </div>

                  <div className="space-y-3 rounded-2xl border border-border p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="flex items-center gap-2 text-sm font-black text-text-primary">
                          <SocialPlatformIcon platform="tiktok" size={20} /> TikTok
                        </p>
                        <p className="mt-1 text-[11px] text-text-muted">Login Kit + Content Posting API</p>
                      </div>
                      <ClearConfigButton platformLabel="TikTok" disabled={!tiktokConfigured || clearing} onClick={() => setClearTarget('tiktok')} />
                    </div>
                    <CredentialField required fieldName="tiktok-client-key" label="Client Key" value={form.tiktokClientKey} onChange={value => setField('tiktokClientKey', value)} />
                    <CredentialField required fieldName="tiktok-client-secret" label="Client Secret" value={form.tiktokClientSecret} onChange={value => setField('tiktokClientSecret', value)} />
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

    {clearTarget && (
      <div
        className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/45 p-4"
        role="presentation"
        onMouseDown={() => !clearing && setClearTarget(null)}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="clear-platform-title"
          className="w-full max-w-md rounded-2xl border border-red-100 bg-white p-5 shadow-2xl"
          onMouseDown={event => event.stopPropagation()}
        >
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-600">
              <AlertTriangle size={19} />
            </span>
            <div>
              <h3 id="clear-platform-title" className="text-base font-black text-text-primary">
                清除 {clearTarget === 'youtube' ? 'YouTube / Google' : clearTarget === 'meta' ? 'Instagram / Facebook' : 'TikTok'} 配置？
              </h3>
              <p className="mt-2 text-sm leading-6 text-text-secondary">
                Client ID 和 Secret 会被清空，当前管理员在这个平台下已连接的账号也会同时断开。
              </p>
              <p className="mt-2 text-xs leading-5 text-text-muted">
                这不会撤销第三方平台后台的授权；如需彻底撤销，请同时到对应平台的账号安全设置中移除本应用。
              </p>
            </div>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setClearTarget(null)}
              disabled={clearing}
              className="rounded-xl border border-border bg-white px-4 py-2.5 text-xs font-bold text-text-secondary disabled:opacity-50"
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => void clearPlatformConfig()}
              disabled={clearing}
              className="inline-flex items-center gap-1.5 rounded-xl bg-red-600 px-4 py-2.5 text-xs font-black text-white disabled:opacity-50"
            >
              {clearing ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
              确认清除
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
