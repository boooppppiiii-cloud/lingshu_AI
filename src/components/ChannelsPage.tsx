import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock3,
  Copy,
  ExternalLink,
  KeyRound,
  Loader2,
  RefreshCw,
  Save,
  Settings2,
  ShieldCheck,
  WifiOff,
} from 'lucide-react';
import { authHeader } from '../lib/auth';

type UserChannelStatus = 'advisor_configuring' | 'waiting_customer' | 'importing' | 'connected' | 'needs_service';

interface TenantChannelStatus {
  id: string;
  name: string;
  oauth: boolean;
  status: UserChannelStatus;
  lastCheckedAt: string | null;
  needsAuthorization: boolean;
}

interface ChannelsStatusResponse {
  isAdmin: boolean;
  channels: TenantChannelStatus[];
}

interface Channel {
  id: string;
  type: 'whatsapp' | 'youtube' | 'tiktok' | 'instagram' | 'facebook' | 'telegram' | 'dingtalk' | 'feishu' | 'wechat' | 'shopify';
  label: string;
  enabled: boolean;
  config: Record<string, string>;
  status: 'connected' | 'disconnected' | 'error';
  connectedAt?: string;
  lastActivity?: string;
  stats: { sent: number; received: number };
}

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

interface AdminOAuthForm {
  youtubeOAuthClientId: string;
  youtubeOAuthClientSecret: string;
  metaSocialAppId: string;
  metaSocialAppSecret: string;
  tiktokClientKey: string;
  tiktokClientSecret: string;
  advancedManualConnectEnabled: boolean;
}

const CHANNEL_META: Record<string, { icon: string; helper: string; accent: string }> = {
  whatsapp: {
    icon: 'WA',
    helper: '客户聊天会自动进入“我的客户”，AI 可以生成回复草稿。',
    accent: 'bg-emerald-50 text-emerald-700',
  },
  instagram: {
    icon: 'IG',
    helper: '连接后可同步账号资产，后续用于内容发布和私信接待。',
    accent: 'bg-pink-50 text-pink-700',
  },
  facebook: {
    icon: 'FB',
    helper: '连接后可同步主页，作为广告与内容分发的基础账号。',
    accent: 'bg-blue-50 text-blue-700',
  },
  youtube: {
    icon: 'YT',
    helper: '连接后可同步频道数据，用于视频发布与表现分析。',
    accent: 'bg-red-50 text-red-700',
  },
};

const OAUTH_CONFIG_SECTIONS = [
  {
    id: 'youtube',
    title: 'YouTube / Google',
    idKey: 'youtubeOAuthClientId',
    secretKey: 'youtubeOAuthClientSecret',
    secretSetKey: 'youtubeOAuthClientSecret',
    idLabel: 'Client ID',
    secretLabel: 'Client Secret',
    callbacks: ['youtube'],
  },
  {
    id: 'meta',
    title: 'Meta / WhatsApp / Instagram / Facebook',
    idKey: 'metaSocialAppId',
    secretKey: 'metaSocialAppSecret',
    secretSetKey: 'metaSocialAppSecret',
    idLabel: 'App ID',
    secretLabel: 'App Secret',
    callbacks: ['instagram', 'facebook'],
  },
  {
    id: 'tiktok',
    title: 'TikTok',
    idKey: 'tiktokClientKey',
    secretKey: 'tiktokClientSecret',
    secretSetKey: 'tiktokClientSecret',
    idLabel: 'Client Key',
    secretLabel: 'Client Secret',
    callbacks: ['tiktok'],
  },
] as const;

function oauthFormFromConfig(config: AdminOAuthConfig): AdminOAuthForm {
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

function statusView(channel: TenantChannelStatus) {
  if (channel.status === 'connected') {
    return {
      title: '已连接 ✓ 由灵枢团队维护',
      detail: channel.lastCheckedAt ? `最后检测：${new Date(channel.lastCheckedAt).toLocaleString('zh-CN')}` : '连接状态正常',
      badge: 'bg-emerald-50 text-emerald-700 border-emerald-100',
      icon: <CheckCircle2 size={16} />,
      action: null as null | 'authorize',
    };
  }
  if (channel.status === 'waiting_customer') {
    return {
      title: '需要你确认一下',
      detail: channel.oauth ? '请按顾问提示完成授权，完成后这里会自动变为已连接。' : '请联系专属顾问完成最后确认。',
      badge: 'bg-amber-50 text-amber-700 border-amber-100',
      icon: <AlertCircle size={16} />,
      action: channel.oauth ? 'authorize' as const : null,
    };
  }
  if (channel.status === 'importing') {
    return {
      title: '待配置·正在导入历史数据',
      detail: '专属顾问已接入账号，系统正在同步历史内容和聊天记录。',
      badge: 'bg-sky-50 text-sky-700 border-sky-100',
      icon: <Loader2 size={16} className="animate-spin" />,
      action: null,
    };
  }
  if (channel.status === 'needs_service') {
    return {
      title: '待配置·专属顾问处理中',
      detail: '账号需要顾问处理，客户侧无需填写任何技术信息。',
      badge: 'bg-rose-50 text-rose-700 border-rose-100',
      icon: <WifiOff size={16} />,
      action: null,
    };
  }
  return {
    title: '待配置·专属顾问处理中',
    detail: '灵枢团队正在为你配置账号，完成后会自动更新状态。',
    badge: 'bg-gray-100 text-gray-600 border-gray-200',
    icon: <Clock3 size={16} />,
    action: null,
  };
}

function ChannelStatusCard({ channel }: { channel: TenantChannelStatus }) {
  const meta = CHANNEL_META[channel.id] || CHANNEL_META.whatsapp;
  const view = statusView(channel);

  function startAuthorization() {
    window.dispatchEvent(new CustomEvent('lingshu-toast', {
      detail: { message: '授权入口由专属顾问确认后开启，本页不会要求你填写 App ID 或 Token。' },
    }));
  }

  return (
    <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-sm font-bold ${meta.accent}`}>
            {meta.icon}
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-gray-950">{channel.name}</h2>
            <p className="mt-1 text-sm leading-relaxed text-gray-500">{meta.helper}</p>
          </div>
        </div>
        <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold ${view.badge}`}>
          {view.icon}
          {view.title}
        </span>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-gray-50 px-4 py-3">
        <p className="text-sm text-gray-600">{view.detail}</p>
        {view.action === 'authorize' && (
          <button
            type="button"
            onClick={startAuthorization}
            className="inline-flex items-center gap-2 rounded-lg bg-gray-950 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800"
          >
            <ExternalLink size={15} />
            去确认授权
          </button>
        )}
      </div>
    </section>
  );
}

function AdminDiagnostics({ channels }: { channels: TenantChannelStatus[] }) {
  return (
    <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center gap-2">
        <ShieldCheck size={18} className="text-emerald-600" />
        <h2 className="text-sm font-semibold text-gray-950">管理员只读诊断</h2>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {channels.map(channel => {
          const view = statusView(channel);
          return (
            <div key={channel.id} className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-semibold text-gray-900">{channel.name}</span>
                <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] font-semibold ${view.badge}`}>
                  {view.icon}
                  {channel.status}
                </span>
              </div>
              <p className="mt-2 text-xs text-gray-500">{view.detail}</p>
            </div>
          );
        })}
      </div>
      <p className="mt-4 text-xs text-gray-400">
        账号 ID、Secret、Token 只在交付工作台维护；这里用于快速判断客户侧看到的状态是否正确。
      </p>
    </section>
  );
}

function AdminOAuthConfigPanel({
  initialConfig,
  onSaved,
}: {
  initialConfig: AdminOAuthConfig;
  onSaved: (config: AdminOAuthConfig) => void;
}) {
  const [form, setForm] = useState<AdminOAuthForm>(() => oauthFormFromConfig(initialConfig));
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');

  useEffect(() => {
    setForm(oauthFormFromConfig(initialConfig));
  }, [initialConfig]);

  function setField<K extends keyof AdminOAuthForm>(key: K, value: AdminOAuthForm[K]) {
    setForm(prev => ({ ...prev, [key]: value }));
  }

  async function saveConfig() {
    setSaving(true);
    setNotice('');
    setError('');
    try {
      const r = await fetch('/api/overseas/admin/oauth-config', {
        method: 'PUT',
        headers: { ...authHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await r.json().catch(() => ({})) as AdminOAuthConfig & { error?: string };
      if (!r.ok) throw new Error(data.error || '保存失败');
      onSaved(data);
      setNotice('已保存。客户侧仍然只显示状态，不会看到这些凭证。');
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }

  async function copyCallback(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      window.setTimeout(() => setCopied(''), 1500);
    } catch {
      setCopied('');
    }
  }

  return (
    <div className="space-y-5">
      {notice && <div className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</div>}
      {error && <div className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}

      <div className="grid gap-4 xl:grid-cols-3">
        {OAUTH_CONFIG_SECTIONS.map(section => (
          <section key={section.id} className="rounded-2xl border border-gray-100 bg-white p-5">
            <div className="mb-4 flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gray-50 text-gray-700">
                <KeyRound size={18} />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-gray-950">{section.title}</h3>
                <p className="mt-1 text-xs text-gray-500">
                  {initialConfig.secretSet[section.secretSetKey] ? '密钥已保存，留空则不修改。' : '尚未保存密钥。'}
                </p>
              </div>
            </div>

            <div className="space-y-3">
              <label className="grid gap-1 text-xs font-semibold text-gray-600">
                {section.idLabel}
                <input
                  type="text"
                  value={form[section.idKey]}
                  onChange={e => setField(section.idKey, e.target.value)}
                  className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-normal text-gray-900 outline-none focus:border-emerald-400"
                />
              </label>
              <label className="grid gap-1 text-xs font-semibold text-gray-600">
                {section.secretLabel}
                <input
                  type="password"
                  value={form[section.secretKey]}
                  onChange={e => setField(section.secretKey, e.target.value)}
                  placeholder={initialConfig.secretSet[section.secretSetKey] ? '已保存，留空不修改' : section.secretLabel}
                  className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-normal text-gray-900 outline-none focus:border-emerald-400"
                />
              </label>
            </div>

            <div className="mt-4 space-y-2">
              {section.callbacks.map(key => {
                const value = initialConfig.callbacks[key];
                const label = key === 'youtube' ? 'YouTube 回调地址' : key === 'instagram' ? 'Instagram 回调地址' : key === 'facebook' ? 'Facebook 回调地址' : 'TikTok 回调地址';
                return (
                  <div key={key} className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="text-[11px] font-semibold text-gray-500">{label}</span>
                      <button
                        type="button"
                        onClick={() => void copyCallback(label, value)}
                        className="inline-flex h-6 w-6 items-center justify-center rounded-md text-gray-400 hover:bg-white hover:text-gray-700"
                        title="复制"
                      >
                        <Copy size={12} />
                      </button>
                    </div>
                    <code className="block break-all text-[11px] text-gray-700">{value}</code>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      {copied && <p className="text-xs text-emerald-700">{copied} 已复制。</p>}

      <section className="rounded-2xl border border-gray-100 bg-white p-5">
        <label className="flex items-center justify-between gap-4">
          <span>
            <span className="block text-sm font-semibold text-gray-950">允许旧版手填凭证</span>
            <span className="mt-1 block text-xs text-gray-500">仅用于顾问排障。常规交付请在“交付工作台”完成。</span>
          </span>
          <input
            type="checkbox"
            checked={form.advancedManualConnectEnabled}
            onChange={e => setField('advancedManualConnectEnabled', e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-emerald-600"
          />
        </label>
      </section>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => void saveConfig()}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-xl bg-gray-950 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
          保存高级配置
        </button>
      </div>
    </div>
  );
}

function LegacyManualChannels() {
  const [open, setOpen] = useState(false);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch('/api/overseas/channels', { headers: authHeader() });
      setChannels(r.ok ? await r.json() : []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (open) void load();
  }, [open]);

  return (
    <section className="rounded-2xl border border-dashed border-gray-200 bg-white">
      <button
        type="button"
        onClick={() => setOpen(prev => !prev)}
        className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
      >
        <span className="inline-flex items-center gap-2 text-sm font-semibold text-gray-900">
          <Settings2 size={16} />
          旧版手填渠道
        </span>
        {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>
      {open && (
        <div className="border-t border-gray-100 px-5 py-4">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-gray-500"><Loader2 size={15} className="animate-spin" />正在读取...</div>
          ) : channels.length ? (
            <div className="space-y-2">
              {channels.map(channel => (
                <div key={channel.id} className="flex items-center justify-between rounded-xl bg-gray-50 px-4 py-3">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">{channel.label}</p>
                    <p className="text-xs text-gray-500">{channel.type} · {channel.status}</p>
                  </div>
                  <span className="text-xs text-gray-400">请优先迁移到交付工作台</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-500">没有旧版手填渠道。</p>
          )}
        </div>
      )}
    </section>
  );
}

export default function ChannelsPage() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [status, setStatus] = useState<ChannelsStatusResponse | null>(null);
  const [adminOAuthConfig, setAdminOAuthConfig] = useState<AdminOAuthConfig | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [error, setError] = useState('');

  const connectedCount = useMemo(() => status?.channels.filter(channel => channel.status === 'connected').length ?? 0, [status]);

  async function load() {
    setError('');
    try {
      const statusRes = await fetch('/api/overseas/channels/status', { headers: authHeader() });
      const statusData = await statusRes.json().catch(() => ({})) as ChannelsStatusResponse & { error?: string };
      if (!statusRes.ok) throw new Error(statusData.error || '无法读取渠道状态');
      setStatus(statusData);

      if (statusData.isAdmin) {
        const adminRes = await fetch('/api/overseas/admin/oauth-config', { headers: authHeader() });
        setAdminOAuthConfig(adminRes.ok ? await adminRes.json() as AdminOAuthConfig : null);
      } else {
        setAdminOAuthConfig(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '无法读取渠道状态');
    } finally {
      setLoading(false);
    }
  }

  async function refresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="flex h-full flex-col bg-gray-50">
      <header className="border-b border-gray-100 bg-white px-8 py-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-gray-950">账号连接</h1>
            <p className="mt-1 text-sm text-gray-500">
              客户侧只展示连接进度；App ID、Secret、Token 由灵枢团队在交付工作台维护。
            </p>
          </div>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={refreshing}
            className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />
            刷新状态
          </button>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
        {loading ? (
          <div className="flex h-60 items-center justify-center text-sm text-gray-500">
            <Loader2 size={18} className="mr-2 animate-spin" />
            正在读取账号状态...
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-rose-100 bg-rose-50 p-5 text-sm text-rose-700">{error}</div>
        ) : status ? (
          <div className="space-y-5">
            <section className="rounded-2xl border border-emerald-100 bg-emerald-50 px-5 py-4">
              <div className="flex items-start gap-3">
                <ShieldCheck size={20} className="mt-0.5 shrink-0 text-emerald-700" />
                <div>
                  <p className="text-sm font-semibold text-emerald-900">已接入 {connectedCount}/{status.channels.length} 个渠道</p>
                  <p className="mt-1 text-sm leading-relaxed text-emerald-800">
                    如果某个渠道显示“需要你确认一下”，只需要点击授权按钮按提示确认；其他技术配置由顾问处理。
                  </p>
                </div>
              </div>
            </section>

            <div className="grid gap-5 xl:grid-cols-2">
              {status.channels.map(channel => <ChannelStatusCard key={channel.id} channel={channel} />)}
            </div>

            {status.isAdmin && (
              <>
                <AdminDiagnostics channels={status.channels} />

                <section className="rounded-2xl border border-gray-100 bg-white shadow-sm">
                  <button
                    type="button"
                    onClick={() => setAdvancedOpen(prev => !prev)}
                    className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
                  >
                    <span className="inline-flex items-center gap-2 text-sm font-semibold text-gray-950">
                      <Settings2 size={16} />
                      高级配置
                    </span>
                    {advancedOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </button>
                  {advancedOpen && (
                    <div className="space-y-5 border-t border-gray-100 p-5">
                      <div className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
                        手填配置只作为顾问排障工具。正式交付请优先使用“交付工作台”的租户卡片。
                      </div>
                      {adminOAuthConfig && (
                        <AdminOAuthConfigPanel initialConfig={adminOAuthConfig} onSaved={setAdminOAuthConfig} />
                      )}
                      <LegacyManualChannels />
                    </div>
                  )}
                </section>
              </>
            )}
          </div>
        ) : null}
      </main>
    </div>
  );
}
