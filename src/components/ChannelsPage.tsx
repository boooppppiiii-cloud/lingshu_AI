import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Share2, Plus, X, CheckCircle, AlertCircle, Wifi, WifiOff, Send, Trash2, Settings } from 'lucide-react';
import { ChannelOverview, SocialConnectionPanel, YouTubeConnectionPanel } from './YouTubeIntegration';

interface Channel {
  id: string;
  type: 'whatsapp' | 'telegram' | 'dingtalk' | 'feishu' | 'wechat' | 'shopify';
  label: string;
  enabled: boolean;
  config: Record<string, string>;
  status: 'connected' | 'disconnected' | 'error';
  connectedAt?: string;
  lastActivity?: string;
  stats: { sent: number; received: number };
}

const CHANNEL_DEFS: Record<string, {
  name: string; icon: string; color: string; bg: string;
  fields: { key: string; label: string; placeholder: string; secret?: boolean }[];
  desc: string;
}> = {
  whatsapp: {
    name: 'WhatsApp Business', icon: '💬', color: '#25D366', bg: '#e8fdf0',
    desc: '通过 Meta Cloud API 与买家 WhatsApp 互动，支持消息接收与模板消息群发',
    fields: [
      { key: 'phoneNumberId', label: 'Phone Number ID', placeholder: '123456789012345' },
      { key: 'accessToken', label: 'Access Token', placeholder: 'EAABxxxxx...', secret: true },
      { key: 'verifyToken', label: 'Verify Token', placeholder: '自定义字符串，用于 Webhook 验证' },
    ],
  },
  telegram: {
    name: 'Telegram Bot', icon: '✈️', color: '#2AABEE', bg: '#e8f5fd',
    desc: '通过 Telegram Bot API 接收买家消息并自动回复，配置简单，无需审核',
    fields: [
      { key: 'botToken', label: 'Bot Token', placeholder: '123456:ABCxxxxx...', secret: true },
      { key: 'defaultChatId', label: '默认 Chat ID（可选）', placeholder: '-100123456789' },
    ],
  },
  dingtalk: {
    name: '钉钉群机器人', icon: '📌', color: '#1677FF', bg: '#e8f0ff',
    desc: '发送业务通知到钉钉群，支持文本和 Markdown 消息，适合内部团队协作',
    fields: [
      { key: 'webhookUrl', label: 'Webhook URL', placeholder: 'https://oapi.dingtalk.com/robot/send?access_token=...' },
      { key: 'secret', label: '加签密钥（可选）', placeholder: 'SEC...', secret: true },
    ],
  },
  feishu: {
    name: '飞书群机器人', icon: '🦅', color: '#3370FF', bg: '#e8edff',
    desc: '发送卡片消息到飞书群，支持富文本格式，适合内部日报和工作汇报',
    fields: [
      { key: 'webhookUrl', label: 'Webhook URL', placeholder: 'https://open.feishu.cn/open-apis/bot/v2/hook/...' },
      { key: 'secret', label: '签名校验密钥（可选）', placeholder: 'xxx', secret: true },
    ],
  },
  wechat: {
    name: '微信公众号', icon: '💚', color: '#07C160', bg: '#e8fdf0',
    desc: '通过微信公众号向粉丝发送模板消息，需要已认证公众号',
    fields: [
      { key: 'appId', label: 'AppID', placeholder: 'wx123...' },
      { key: 'appSecret', label: 'AppSecret', placeholder: '...', secret: true },
      { key: 'token', label: 'Token', placeholder: '服务器验证 Token' },
    ],
  },
  shopify: {
    name: 'Shopify', icon: '🛍️', color: '#96BF48', bg: '#f3f9e8',
    desc: '连接 Shopify 店铺，同步订单、商品和客户数据',
    fields: [
      { key: 'storeDomain', label: '店铺域名', placeholder: 'mystore.myshopify.com' },
      { key: 'accessToken', label: 'Admin API Token', placeholder: 'shpat_...', secret: true },
    ],
  },
};

export default function ChannelsPage() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [addType, setAddType] = useState<string>('');
  const [configTarget, setConfigTarget] = useState<Channel | null>(null);
  const [configValues, setConfigValues] = useState<Record<string, string>>({});
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, { ok: boolean; msg: string }>>({});
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'config' | 'auth' | 'youtube'>('config');

  useEffect(() => { fetchChannels(); }, []);

  async function fetchChannels() {
    setLoading(true);
    try {
      const r = await fetch('/api/overseas/channels');
      setChannels(await r.json());
    } finally { setLoading(false); }
  }

  async function addChannel(type: string) {
    const def = CHANNEL_DEFS[type];
    await fetch('/api/overseas/channels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, label: def.name }),
    });
    await fetchChannels();
    setShowAdd(false);
    setAddType('');
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
    } finally { setTesting(null); }
  }

  async function deleteChannel(id: string) {
    await fetch(`/api/overseas/channels/${id}`, { method: 'DELETE' });
    await fetchChannels();
  }

  const connectedCount = channels.filter(c => c.status === 'connected').length;

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <div className="px-8 pt-8 pb-4 border-b border-gray-100">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">消息渠道</h1>
            <p className="text-sm text-gray-500 mt-0.5">配置 AI 智能体与买家交互的消息平台，客户填写自己的账号信息完成接入</p>
          </div>
          {activeTab === 'config' && (
            <button
              onClick={() => setShowAdd(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white"
              style={{ background: '#16a34a' }}
            >
              <Plus size={16} /> 添加渠道
            </button>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mt-5">
          {([
            { id: 'config', label: `渠道配置${channels.length > 0 ? ` ${channels.length}` : ''}` },
            { id: 'auth',   label: '配对授权' },
            { id: 'youtube', label: '频道总览' },
          ] as { id: 'config' | 'auth' | 'youtube'; label: string }[]).map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === tab.id ? 'bg-gray-100 text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-8 py-6">
        {activeTab === 'youtube' && (
          <div className="flex flex-col h-full">
            <ChannelOverview />
          </div>
        )}

        {activeTab === 'auth' && (
          <div className="max-w-5xl space-y-5">
            <YouTubeConnectionPanel />
            <SocialConnectionPanel platform="tiktok" />
            <SocialConnectionPanel platform="instagram" />
            <SocialConnectionPanel platform="facebook" />
          </div>
        )}

        {activeTab === 'config' && (
          <>
            {loading && <div className="text-sm text-gray-400 py-12 text-center">加载中...</div>}

            {!loading && channels.length === 0 && (
              <div className="flex flex-col items-center justify-center h-64 text-gray-400">
                <Share2 size={40} className="mb-3 opacity-40" />
                <p className="text-sm font-medium">还没有配置任何渠道</p>
                <p className="text-xs mt-1">点击右上角"添加渠道"开始配置</p>
              </div>
            )}

            {/* Stats */}
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

            {/* Channel grid */}
            <div className="grid grid-cols-2 gap-4">
              {channels.map(ch => {
                const def = CHANNEL_DEFS[ch.type];
                const tr = testResult[ch.id];
                return (
                  <div key={ch.id} className="border border-gray-200 rounded-xl p-5">
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <div className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl" style={{ background: def?.bg ?? '#f3f4f6' }}>
                          {def?.icon ?? '📡'}
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

                    {/* Stats */}
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
                          {ch.lastActivity ? new Date(ch.lastActivity).toLocaleDateString('zh-CN') : '—'}
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

      {/* Add Channel Modal */}
      <AnimatePresence>
        {showAdd && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center"
            onClick={() => { setShowAdd(false); setAddType(''); }}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-2xl w-[520px] p-6"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-5">
                <h3 className="font-semibold text-gray-900">选择渠道类型</h3>
                <button onClick={() => { setShowAdd(false); setAddType(''); }} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {Object.entries(CHANNEL_DEFS).map(([key, def]) => (
                  <button
                    key={key}
                    onClick={() => setAddType(key)}
                    className={`p-4 rounded-xl border-2 text-left transition-all ${addType === key ? 'border-green-500 bg-green-50' : 'border-gray-200 hover:border-gray-300'}`}
                  >
                    <div className="text-2xl mb-2">{def.icon}</div>
                    <div className="text-sm font-medium text-gray-900">{def.name}</div>
                    <div className="text-xs text-gray-500 mt-0.5 line-clamp-2">{def.desc}</div>
                  </button>
                ))}
              </div>
              <div className="flex gap-3 mt-5">
                <button onClick={() => { setShowAdd(false); setAddType(''); }} className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600">取消</button>
                <button
                  onClick={() => addType && addChannel(addType)}
                  disabled={!addType}
                  className="flex-1 py-2.5 rounded-xl text-sm text-white font-medium disabled:opacity-40 transition-colors"
                  style={{ background: '#16a34a' }}
                >
                  添加 {addType ? CHANNEL_DEFS[addType]?.name : ''}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Config Modal */}
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
              {configTarget.type === 'telegram' && (
                <div className="mt-4 p-3 bg-blue-50 rounded-xl text-xs text-blue-700">
                  Webhook 地址：<code className="font-mono">https://your-domain/api/overseas/channels/webhook/telegram/{configTarget.id}</code>
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
