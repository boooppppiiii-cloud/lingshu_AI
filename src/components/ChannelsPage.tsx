import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Share2, Plus, X, CheckCircle, AlertCircle, Wifi, WifiOff, Send, Trash2, Settings, ShieldCheck, KeyRound, Save, RefreshCw, Copy } from 'lucide-react';
import { YouTubeConnectionPanel, SocialConnectionPanel } from './YouTubeIntegration';
import { authHeader } from '../lib/auth';

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

const CHANNEL_DEFS: Record<string, {
  name: string;
  icon: string;
  color: string;
  bg: string;
  desc: string;
  oauth?: boolean;
  fields: { key: string; label: string; placeholder: string; secret?: boolean }[];
}> = {
  whatsapp: {
    name: 'WhatsApp Business',
    icon: '💬',
    color: '#25D366',
    bg: '#e8fdf0',
    desc: '连接 WhatsApp Cloud API，接收买家消息并发送模板消息',
    fields: [
      { key: 'phoneNumberId', label: 'Phone Number ID', placeholder: '123456789012345' },
      { key: 'accessToken', label: 'Access Token', placeholder: 'EAABxxxxx...', secret: true },
      { key: 'verifyToken', label: 'Verify Token（可选）', placeholder: '用于 Webhook 验证的自定义字符串' },
    ],
  },
  youtube: {
    name: 'YouTube',
    icon: '▶️',
    color: '#FF0000',
    bg: '#fff1f2',
    desc: '推荐使用 Google 登录授权，系统自动保存频道授权',
    oauth: true,
    fields: [
      { key: 'refreshToken', label: 'Refresh Token', placeholder: '建议通过 Google 授权自动生成', secret: true },
      { key: 'channelId', label: 'Channel ID（可选）', placeholder: '系统可通过授权自动识别' },
    ],
  },
  tiktok: {
    name: 'TikTok',
    icon: '🎵',
    color: '#111827',
    bg: '#f3f4f6',
    desc: '推荐使用 TikTok 登录授权，系统自动保存账号授权',
    oauth: true,
    fields: [
      { key: 'accessToken', label: 'Access Token', placeholder: 'act.xxx...', secret: true },
      { key: 'openId', label: 'Open ID（可选）', placeholder: 'TikTok Open ID' },
    ],
  },
  instagram: {
    name: 'Instagram',
    icon: '📷',
    color: '#C13584',
    bg: '#fdf2f8',
    desc: '推荐使用 Meta 登录授权，系统自动识别已绑定的 Instagram 专业账号',
    oauth: true,
    fields: [
      { key: 'accessToken', label: 'Meta Access Token', placeholder: 'EAABxxxxx...', secret: true },
      { key: 'igUserId', label: 'Instagram User ID（可选）', placeholder: '系统可通过 Token 自动发现' },
    ],
  },
  facebook: {
    name: 'Facebook',
    icon: '👍',
    color: '#1877F2',
    bg: '#eff6ff',
    desc: '推荐使用 Meta 登录授权，系统自动识别可管理的 Facebook Page',
    oauth: true,
    fields: [
      { key: 'accessToken', label: 'Page Access Token', placeholder: 'EAABxxxxx...', secret: true },
      { key: 'pageId', label: 'Page ID（可选）', placeholder: '系统可通过 Token 自动发现' },
    ],
  },
};

const ADD_ACCOUNT_TYPES = ['whatsapp', 'youtube', 'instagram', 'facebook', 'tiktok'] as const;
const OAUTH_ACCOUNT_TYPES = ['youtube', 'instagram', 'facebook', 'tiktok'] as const;
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
    title: 'Meta / Instagram / Facebook',
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

function AdminOAuthConfigPanel({
  initialConfig,
  onSaved,
}: {
  initialConfig: AdminOAuthConfig;
  onSaved: (config: AdminOAuthConfig) => void;
}) {
  const [config, setConfig] = useState(initialConfig);
  const [form, setForm] = useState<AdminOAuthForm>(() => oauthFormFromConfig(initialConfig));
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');

  useEffect(() => {
    setConfig(initialConfig);
    setForm(oauthFormFromConfig(initialConfig));
  }, [initialConfig]);

  function setField<K extends keyof AdminOAuthForm>(key: K, value: AdminOAuthForm[K]) {
    setForm(prev => ({ ...prev, [key]: value }));
  }

  async function reloadConfig() {
    setLoading(true);
    setError('');
    try {
      const r = await fetch('/api/overseas/admin/oauth-config', { headers: authHeader() });
      const data = await r.json().catch(() => ({})) as AdminOAuthConfig & { error?: string };
      if (!r.ok) throw new Error(data.error || '无法读取授权应用配置');
      setConfig(data);
      setForm(oauthFormFromConfig(data));
      onSaved(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : '无法读取授权应用配置');
    } finally {
      setLoading(false);
    }
  }

  async function saveConfig() {
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const r = await fetch('/api/overseas/admin/oauth-config', {
        method: 'PUT',
        headers: { ...authHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await r.json().catch(() => ({})) as AdminOAuthConfig & { error?: string };
      if (!r.ok) throw new Error(data.error || '保存授权应用配置失败');
      setConfig(data);
      setForm(oauthFormFromConfig(data));
      onSaved(data);
      setNotice('已保存配置，一键授权已开启。');
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存授权应用配置失败');
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
      <section className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
        <div className="flex items-start gap-3">
          <ShieldCheck size={18} className="mt-0.5 flex-shrink-0" />
          <div className="min-w-0">
            <p className="font-semibold">平台授权应用配置</p>
            <p className="mt-1 text-xs leading-relaxed text-emerald-800">
              这里保存的是平台级 OAuth 应用凭据，用于开启多个频道、主页和账号的一键授权。
            </p>
          </div>
          <button
            type="button"
            onClick={() => void reloadConfig()}
            disabled={loading}
            title="刷新配置"
            className="ml-auto inline-flex h-8 w-8 items-center justify-center rounded-lg border border-emerald-200 bg-white text-emerald-700 disabled:opacity-50"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </section>

      {notice && (
        <div className="flex items-start gap-2 rounded-lg bg-green-50 px-3 py-2 text-xs text-green-700">
          <CheckCircle size={14} className="mt-0.5 flex-shrink-0" />
          <span>{notice}</span>
        </div>
      )}
      {error && (
        <div className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">
          <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-3">
        {OAUTH_CONFIG_SECTIONS.map(section => (
          <section key={section.id} className="rounded-xl border border-gray-200 bg-white p-5">
            <div className="mb-4 flex items-start gap-3">
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-gray-50 text-gray-700">
                <KeyRound size={18} />
              </div>
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-gray-900">{section.title}</h2>
                <p className="mt-1 text-xs text-gray-500">
                  {config.secretSet[section.secretSetKey] ? '密钥已保存在服务器。' : '尚未保存密钥。'}
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
                  placeholder={section.idLabel}
                  className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-normal text-gray-900 outline-none focus:border-green-400"
                />
              </label>
              <label className="grid gap-1 text-xs font-semibold text-gray-600">
                {section.secretLabel}
                <input
                  type="password"
                  value={form[section.secretKey]}
                  onChange={e => setField(section.secretKey, e.target.value)}
                  placeholder={config.secretSet[section.secretSetKey] ? '已保存，留空不修改' : section.secretLabel}
                  className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-normal text-gray-900 outline-none focus:border-green-400"
                />
              </label>
            </div>

            <div className="mt-4 space-y-2">
              {section.callbacks.map(key => {
                const value = config.callbacks[key];
                const label = key === 'youtube' ? 'YouTube 回调地址' : key === 'instagram' ? 'Instagram 回调地址' : key === 'facebook' ? 'Facebook 回调地址' : 'TikTok 回调地址';
                return (
                  <div key={key} className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="text-[11px] font-semibold text-gray-500">{label}</span>
                      <button
                        type="button"
                        onClick={() => void copyCallback(label, value)}
                        title="复制回调地址"
                        className="inline-flex h-6 w-6 items-center justify-center rounded-md text-gray-400 hover:bg-white hover:text-gray-700"
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

      {copied && <p className="text-xs text-green-700">{copied}已复制。</p>}

      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <label className="flex items-center justify-between gap-4">
          <span>
            <span className="block text-sm font-semibold text-gray-900">手动凭据接入</span>
            <span className="mt-1 block text-xs text-gray-500">仅在需要协助排障时开启；日常推荐使用一键授权。</span>
          </span>
          <input
            type="checkbox"
            checked={form.advancedManualConnectEnabled}
            onChange={e => setField('advancedManualConnectEnabled', e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-green-600"
          />
        </label>
      </section>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => void saveConfig()}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {saving ? <RefreshCw size={15} className="animate-spin" /> : <Save size={15} />}
          保存到服务器
        </button>
      </div>

      {config.updatedAt && (
        <p className="text-right text-xs text-gray-400">上次保存：{new Date(config.updatedAt).toLocaleString('zh-CN')}</p>
      )}
    </div>
  );
}

export default function ChannelsPage() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [addType, setAddType] = useState<string>('');
  const [configTarget, setConfigTarget] = useState<Channel | null>(null);
  const [configValues, setConfigValues] = useState<Record<string, string>>({});
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, { ok: boolean; msg: string }>>({});
  const [loading, setLoading] = useState(true);
  const [adminLoading, setAdminLoading] = useState(true);
  const [adminOAuthConfig, setAdminOAuthConfig] = useState<AdminOAuthConfig | null>(null);
  const [activeTab, setActiveTab] = useState<'auth' | 'advanced'>('auth');

  useEffect(() => { void fetchInitialData(); }, []);
  useEffect(() => {
    if (!adminLoading && !adminOAuthConfig && activeTab === 'advanced') setActiveTab('auth');
  }, [activeTab, adminLoading, adminOAuthConfig]);

  async function fetchInitialData() {
    setLoading(true);
    setAdminLoading(true);
    try {
      const channelsRes = await fetch('/api/overseas/channels');
      setChannels(await channelsRes.json());
      const adminRes = await fetch('/api/overseas/admin/oauth-config', { headers: authHeader() });
      if (adminRes.ok) {
        setAdminOAuthConfig(await adminRes.json() as AdminOAuthConfig);
      } else {
        setAdminOAuthConfig(null);
      }
    } finally {
      setLoading(false);
      setAdminLoading(false);
    }
  }

  async function fetchChannels() {
    try {
      const r = await fetch('/api/overseas/channels');
      setChannels(await r.json());
    } catch {
      // Keep the current screen stable when a refresh fails.
    }
  }

  async function addChannel(type: string) {
    const def = CHANNEL_DEFS[type];
    if (def?.oauth) {
      setShowAdd(false);
      setAddType('');
      setActiveTab('auth');
      return;
    }

    const sameTypeCount = channels.filter(channel => channel.type === type).length;
    const label = sameTypeCount > 0 ? `${def.name} ${sameTypeCount + 1}` : def.name;
    await fetch('/api/overseas/channels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, label }),
    });
    await fetchChannels();
    setShowAdd(false);
    setAddType('');
    setActiveTab('advanced');
  }

  async function saveConfig(channel: Channel) {
    await fetch(`/api/overseas/channels/${channel.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: configValues }),
    });
    await fetchChannels();
    setConfigTarget(null);
  }

  async function testChannel(id: string) {
    setTesting(id);
    try {
      const r = await fetch(`/api/overseas/channels/${id}/test`, { method: 'POST' });
      const data = await r.json();
      setTestResult(prev => ({ ...prev, [id]: { ok: data.ok, msg: data.ok ? '连接成功' : (data.error ?? '连接失败') } }));
      await fetchChannels();
    } catch {
      setTestResult(prev => ({ ...prev, [id]: { ok: false, msg: '网络错误' } }));
    } finally {
      setTesting(null);
    }
  }

  async function deleteChannel(id: string) {
    await fetch(`/api/overseas/channels/${id}`, { method: 'DELETE' });
    await fetchChannels();
  }

  const connectedCount = channels.filter(c => c.status === 'connected').length;

  return (
    <div className="flex flex-col h-full bg-white">
      <div className="px-8 pt-8 pb-4 border-b border-gray-100">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">账号配置</h1>
            <p className="text-sm text-gray-500 mt-0.5">登录自己的平台账号完成授权，系统将自动保存可用频道、主页或账号</p>
          </div>
          {adminOAuthConfig && (
            <span className="inline-flex items-center gap-2 rounded-lg border border-green-100 bg-green-50 px-3 py-2 text-xs font-semibold text-green-700">
              <ShieldCheck size={14} /> 已配置
            </span>
          )}
        </div>

        <div className="flex gap-1 mt-5">
          {([
            ['auth', '一键授权'],
            ...(adminOAuthConfig ? [['advanced', '授权应用配置'] as const] : []),
          ] as const).map(([tab, label]) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === tab ? 'bg-gray-100 text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-8 py-6">
        {activeTab === 'auth' && (
          <div className="space-y-5">
            <div className="flex items-start gap-3 rounded-xl border border-green-100 bg-green-50 px-4 py-3 text-sm text-green-800">
              <ShieldCheck size={18} className="mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-semibold">推荐使用一键授权</p>
                <p className="mt-1 text-xs leading-relaxed text-green-700">联系服务顾问配置您的平台应用和回调地址，即可正常进行多个频道、主页、账号的登录授权</p>
              </div>
            </div>

            <YouTubeConnectionPanel compact />

            <div className="grid grid-cols-1 gap-5 xl:grid-cols-3 [grid-auto-rows:1fr]">
              {OAUTH_ACCOUNT_TYPES.filter(platform => platform !== 'youtube').map(platform => (
                <SocialConnectionPanel key={platform} platform={platform} />
              ))}
            </div>

            <section className="border border-gray-200 rounded-xl bg-white p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg bg-green-50 text-green-600 flex items-center justify-center text-xl">💬</div>
                  <div>
                    <h2 className="text-sm font-semibold text-gray-900">WhatsApp Business</h2>
                    <p className="text-xs text-gray-500 mt-1 leading-relaxed">WhatsApp 一键授权正在审核中，开放后可直接登录 Meta 完成连接。</p>
                  </div>
                </div>
                <button
                  disabled
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white bg-gray-900 opacity-70 cursor-not-allowed"
                >
                  审核中
                </button>
              </div>
              <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-xs text-amber-800">
                <p className="font-semibold mb-1">WhatsApp 自助授权正在审核中</p>
                <p className="leading-relaxed">审核完成后，即可在这里登录 Meta 并选择自己的 WhatsApp Business 账号。</p>
              </div>
            </section>
          </div>
        )}

        {activeTab === 'advanced' && adminOAuthConfig && (
          <AdminOAuthConfigPanel
            initialConfig={adminOAuthConfig}
            onSaved={setAdminOAuthConfig}
          />
        )}
      </div>

      <AnimatePresence>
        {showAdd && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center"
            onClick={() => { setShowAdd(false); setAddType(''); }}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-2xl w-[560px] p-6"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-5">
                <h3 className="font-semibold text-gray-900">选择账号类型</h3>
                <button onClick={() => { setShowAdd(false); setAddType(''); }} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {ADD_ACCOUNT_TYPES.map(key => {
                  const def = CHANNEL_DEFS[key];
                  return (
                    <button
                      key={key}
                      onClick={() => setAddType(key)}
                      className={`p-4 rounded-xl border-2 text-left transition-all ${addType === key ? 'border-green-500 bg-green-50' : 'border-gray-200 hover:border-gray-300'}`}
                    >
                      <div className="text-2xl mb-2">{def.icon}</div>
                      <div className="text-sm font-medium text-gray-900">{def.name}</div>
                      <div className="text-xs text-gray-500 mt-0.5 line-clamp-2">{def.desc}</div>
                    </button>
                  );
                })}
              </div>
              <p className="mt-3 text-xs text-gray-400">YouTube、Instagram、Facebook、TikTok 会跳转到一键授权区；WhatsApp 当前进入高级配置。</p>
              <div className="flex gap-3 mt-5">
                <button onClick={() => { setShowAdd(false); setAddType(''); }} className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600">取消</button>
                <button
                  onClick={() => addType && addChannel(addType)}
                  disabled={!addType}
                  className="flex-1 py-2.5 rounded-xl text-sm text-white font-medium disabled:opacity-40 transition-colors"
                  style={{ background: '#16a34a' }}
                >
                  {addType && CHANNEL_DEFS[addType]?.oauth ? '去授权连接' : `添加 ${addType ? CHANNEL_DEFS[addType]?.name : ''}`}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {configTarget && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center"
            onClick={() => setConfigTarget(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-2xl w-[480px] p-6"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{CHANNEL_DEFS[configTarget.type]?.icon}</span>
                  <h3 className="font-semibold text-gray-900">{configTarget.label} 配置</h3>
                </div>
                <button onClick={() => setConfigTarget(null)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
              </div>

              <div className="space-y-4">
                {CHANNEL_DEFS[configTarget.type]?.fields.map(f => (
                  <div key={f.key}>
                    <label className="block text-xs font-medium text-gray-700 mb-1.5">{f.label}</label>
                    <input
                      type={f.secret ? 'password' : 'text'}
                      value={configValues[f.key] ?? ''}
                      onChange={e => setConfigValues(prev => ({ ...prev, [f.key]: e.target.value }))}
                      placeholder={f.placeholder}
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-green-400 font-mono"
                    />
                  </div>
                ))}
              </div>

              {configTarget.type === 'whatsapp' && (
                <div className="mt-4 p-3 bg-blue-50 rounded-xl text-xs text-blue-700">
                  Webhook 地址：<code className="font-mono">https://your-domain/api/overseas/channels/webhook/whatsapp/{configTarget.id}</code>
                </div>
              )}

              <div className="flex gap-3 mt-5">
                <button onClick={() => setConfigTarget(null)} className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600">取消</button>
                <button
                  onClick={() => saveConfig(configTarget)}
                  className="flex-1 py-2.5 rounded-xl text-sm text-white font-medium"
                  style={{ background: '#16a34a' }}
                >
                  保存配置
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
