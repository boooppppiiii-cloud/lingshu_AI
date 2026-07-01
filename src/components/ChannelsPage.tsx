import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Share2, Plus, X, CheckCircle, AlertCircle, Wifi, WifiOff, Send, Trash2, Settings, ShieldCheck } from 'lucide-react';
import { YouTubeConnectionPanel, SocialConnectionPanel } from './YouTubeIntegration';

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

export default function ChannelsPage() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [addType, setAddType] = useState<string>('');
  const [configTarget, setConfigTarget] = useState<Channel | null>(null);
  const [configValues, setConfigValues] = useState<Record<string, string>>({});
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, { ok: boolean; msg: string }>>({});
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'auth' | 'advanced'>('auth');

  useEffect(() => { void fetchInitialData(); }, []);

  async function fetchInitialData() {
    setLoading(true);
    try {
      const channelsRes = await fetch('/api/overseas/channels');
      setChannels(await channelsRes.json());
    } finally {
      setLoading(false);
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
            <p className="text-sm text-gray-500 mt-0.5">客户登录自己的平台账号完成授权；手动 token 只作为高级接入方式</p>
          </div>
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white"
            style={{ background: '#16a34a' }}
          >
            <Plus size={16} /> 添加账号
          </button>
        </div>

        <div className="flex gap-1 mt-5">
          {([
            ['auth', '一键授权'],
            ['advanced', `高级配置 ${channels.length > 0 ? channels.length : ''}`],
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
                <p className="font-semibold">推荐客户使用一键授权</p>
                <p className="mt-1 text-xs leading-relaxed text-green-700">你只需要在系统部署时配置一次平台应用和回调地址。之后客户添加多个频道、主页或社媒账号时，自己登录并授权即可。</p>
              </div>
            </div>

            <YouTubeConnectionPanel compact />

            <div className="grid gap-5 xl:grid-cols-3">
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
                    <p className="text-xs text-gray-500 mt-1 leading-relaxed">WhatsApp 一键授权需要接入 Meta Embedded Signup。审核通过前暂不开放客户自助连接。</p>
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
                <p className="leading-relaxed">审核完成后，客户可以在这里登录 Meta 并选择自己的 WhatsApp Business 账号。当前如需接入，可在「高级配置」里由实施人员填写 Cloud API 信息。</p>
              </div>
            </section>
          </div>
        )}

        {activeTab === 'advanced' && (
          <>
            {loading && <div className="text-sm text-gray-400 py-12 text-center">加载中...</div>}

            {!loading && channels.length === 0 && (
              <div className="flex flex-col items-center justify-center h-64 text-gray-400">
                <Share2 size={40} className="mb-3 opacity-40" />
                <p className="text-sm font-medium">还没有手动配置的账号</p>
                <p className="text-xs mt-1">推荐优先使用「一键授权」连接账号</p>
              </div>
            )}

            {channels.length > 0 && (
              <div className="flex gap-3 mb-6">
                <div className="flex items-center gap-2 px-3 py-1.5 bg-green-50 rounded-lg text-xs text-green-700">
                  <Wifi size={12} /> {connectedCount} 个已连接
                </div>
                <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-100 rounded-lg text-xs text-gray-500">
                  <WifiOff size={12} /> {channels.length - connectedCount} 个未连接
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              {channels.map(ch => {
                const def = CHANNEL_DEFS[ch.type];
                const tr = testResult[ch.id];
                return (
                  <div key={ch.id} className="border border-gray-200 rounded-xl p-5">
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <div className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl" style={{ background: def?.bg ?? '#f3f4f6' }}>
                          {def?.icon ?? '📣'}
                        </div>
                        <div>
                          <div className="font-medium text-gray-900 text-sm">{ch.label}</div>
                          <div className={`text-xs mt-0.5 flex items-center gap-1 ${ch.status === 'connected' ? 'text-green-600' : ch.status === 'error' ? 'text-red-500' : 'text-gray-400'}`}>
                            {ch.status === 'connected' && <><CheckCircle size={10} /> 已连接</>}
                            {ch.status === 'error' && <><AlertCircle size={10} /> 连接错误</>}
                            {ch.status === 'disconnected' && '未连接'}
                          </div>
                        </div>
                      </div>
                      <button onClick={() => deleteChannel(ch.id)} className="text-gray-300 hover:text-red-400 transition-colors">
                        <Trash2 size={14} />
                      </button>
                    </div>

                    <div className="flex gap-3 mb-4">
                      {[
                        { label: '已发送', val: ch.stats.sent },
                        { label: '已接收', val: ch.stats.received },
                      ].map(s => (
                        <div key={s.label} className="flex-1 bg-gray-50 rounded-lg px-3 py-2 text-center">
                          <div className="text-base font-semibold text-gray-800">{s.val}</div>
                          <div className="text-xs text-gray-400">{s.label}</div>
                        </div>
                      ))}
                      <div className="flex-1 bg-gray-50 rounded-lg px-3 py-2 text-center">
                        <div className="text-xs font-medium text-gray-800 truncate">
                          {ch.lastActivity ? new Date(ch.lastActivity).toLocaleDateString('zh-CN') : '-'}
                        </div>
                        <div className="text-xs text-gray-400">最近活动</div>
                      </div>
                    </div>

                    {tr && (
                      <div className={`text-xs px-3 py-2 rounded-lg mb-3 flex items-center gap-2 ${tr.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
                        {tr.ok ? <CheckCircle size={12} /> : <AlertCircle size={12} />}
                        {tr.msg}
                      </div>
                    )}

                    <div className="flex gap-2">
                      <button
                        onClick={() => { setConfigTarget(ch); setConfigValues(ch.config); }}
                        className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 border border-gray-200 rounded-lg text-xs text-gray-600 hover:bg-gray-50 transition-colors"
                      >
                        <Settings size={12} /> 配置
                      </button>
                      <button
                        onClick={() => testChannel(ch.id)}
                        disabled={testing === ch.id}
                        className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs text-white transition-colors disabled:opacity-50"
                        style={{ background: testing === ch.id ? '#9ca3af' : (def?.color ?? '#16a34a') }}
                      >
                        <Send size={12} /> {testing === ch.id ? '测试中...' : '测试连接'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
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
