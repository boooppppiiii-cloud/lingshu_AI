import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Puzzle, X, CheckCircle, AlertCircle, Settings, Trash2, Plus, ChevronRight } from 'lucide-react';

interface Plugin {
  id: string;
  pluginKey: string;
  name: string;
  nameZh: string;
  category: 'ecommerce' | 'social' | 'tool' | 'ai';
  description: string;
  icon: string;
  status: 'installed' | 'not_installed' | 'error';
  config: Record<string, string>;
  installed: boolean;
  installedAt?: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  ecommerce: '电商平台',
  social: '社交媒体',
  tool: '工具',
  ai: 'AI 能力',
};

const PLUGIN_FIELDS: Record<string, { key: string; label: string; placeholder: string; secret?: boolean }[]> = {
  shopify: [
    { key: 'storeDomain', label: '店铺域名', placeholder: 'mystore.myshopify.com' },
    { key: 'accessToken', label: 'Admin API Token', placeholder: 'shpat_...', secret: true },
  ],
  tiktok_ads: [
    { key: 'advertiserId', label: 'Advertiser ID', placeholder: '6123456789' },
    { key: 'accessToken', label: 'Access Token', placeholder: 'xxx...', secret: true },
  ],
  whatsapp_business: [
    { key: 'phoneNumberId', label: 'Phone Number ID', placeholder: '123456789012345' },
    { key: 'accessToken', label: 'Access Token', placeholder: 'EAABxxxxx...', secret: true },
  ],
  google_translate: [
    { key: 'apiKey', label: 'API Key', placeholder: 'AIzaSy...', secret: true },
  ],
  amazon: [
    { key: 'sellerId', label: 'Seller ID', placeholder: 'A1B2C3...' },
    { key: 'accessKey', label: 'Access Key', placeholder: 'AKIA...', secret: true },
    { key: 'secretKey', label: 'Secret Key', placeholder: '...', secret: true },
  ],
  instagram: [
    { key: 'pageId', label: 'Page ID', placeholder: '123456789' },
    { key: 'accessToken', label: 'Page Access Token', placeholder: 'EAABxxxxx...', secret: true },
  ],
};

export default function PluginsPage() {
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'plugins' | 'skills' | 'auth'>('plugins');
  const [configTarget, setConfigTarget] = useState<Plugin | null>(null);
  const [configValues, setConfigValues] = useState<Record<string, string>>({});
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, { ok: boolean; msg: string }>>({});
  const [installing, setInstalling] = useState<string | null>(null);

  useEffect(() => { fetchPlugins(); }, []);

  async function fetchPlugins() {
    setLoading(true);
    try {
      const r = await fetch('/api/overseas/plugins');
      setPlugins(await r.json());
    } finally { setLoading(false); }
  }

  async function install(pluginKey: string) {
    setInstalling(pluginKey);
    try {
      await fetch(`/api/overseas/plugins/${pluginKey}/install`, { method: 'POST' });
      await fetchPlugins();
    } finally { setInstalling(null); }
  }

  async function uninstall(pluginKey: string) {
    await fetch(`/api/overseas/plugins/${pluginKey}`, { method: 'DELETE' });
    await fetchPlugins();
  }

  async function saveConfig(plugin: Plugin) {
    await fetch(`/api/overseas/plugins/${plugin.pluginKey}/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(configValues),
    });
    await fetchPlugins();
    setConfigTarget(null);
  }

  async function testPlugin(pluginKey: string) {
    setTesting(pluginKey);
    try {
      const r = await fetch(`/api/overseas/plugins/${pluginKey}/test`, { method: 'POST' });
      const data = await r.json();
      setTestResult(prev => ({
        ...prev,
        [pluginKey]: { ok: data.ok, msg: data.ok ? (data.shopName ? `连接成功：${data.shopName}` : (data.message ?? '连接成功')) : (data.error ?? '连接失败') },
      }));
      await fetchPlugins();
    } catch {
      setTestResult(prev => ({ ...prev, [pluginKey]: { ok: false, msg: '网络错误' } }));
    } finally { setTesting(null); }
  }

  const grouped = plugins.reduce<Record<string, Plugin[]>>((acc, p) => {
    (acc[p.category] ??= []).push(p); return acc;
  }, {});

  const installedCount = plugins.filter(p => p.installed && p.status === 'installed').length;

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <div className="px-8 pt-8 pb-4 border-b border-gray-100">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">插件市场</h1>
            <p className="text-sm text-gray-500 mt-0.5">连接电商平台、社交媒体和工具，扩展 AI 智能体能力</p>
          </div>
          {installedCount > 0 && (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-green-50 rounded-lg text-xs text-green-700">
              <CheckCircle size={12} /> {installedCount} 个已连接
            </div>
          )}
        </div>

        <div className="flex gap-1 mt-5">
          {(['plugins', 'skills', 'auth'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === tab ? 'bg-gray-100 text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
            >
              {tab === 'plugins' ? '插件' : tab === 'skills' ? '技能' : '应用授权'}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-8 py-6">
        {(activeTab === 'skills' || activeTab === 'auth') && (
          <div className="flex flex-col items-center justify-center h-64 text-gray-400">
            <Puzzle size={40} className="mb-3 opacity-40" />
            <p className="text-sm">{activeTab === 'skills' ? '技能配置' : '应用授权'}功能开发中</p>
          </div>
        )}

        {activeTab === 'plugins' && (
          <>
            {loading && <div className="text-sm text-gray-400 py-12 text-center">加载中...</div>}

            {Object.entries(grouped).map(([cat, catPlugins]) => (
              <div key={cat} className="mb-8">
                <h2 className="text-sm font-semibold text-gray-500 mb-4">{CATEGORY_LABELS[cat] ?? cat}</h2>
                <div className="grid grid-cols-2 gap-3">
                  {catPlugins.map(plugin => {
                    const tr = testResult[plugin.pluginKey];
                    const fields = PLUGIN_FIELDS[plugin.pluginKey] ?? [];
                    return (
                      <div key={plugin.pluginKey} className="border border-gray-200 rounded-xl p-4 flex items-start gap-4">
                        <div className="text-3xl flex-shrink-0 mt-0.5">{plugin.icon}</div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <p className="text-sm font-medium text-gray-900">{plugin.nameZh}</p>
                              <p className="text-xs text-gray-500 mt-0.5 leading-relaxed line-clamp-2">{plugin.description}</p>
                            </div>
                            {plugin.installed && plugin.status === 'installed' && (
                              <span className="flex-shrink-0 flex items-center gap-1 text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded-full">
                                <CheckCircle size={10} /> 已接入
                              </span>
                            )}
                            {plugin.installed && plugin.status === 'error' && (
                              <span className="flex-shrink-0 flex items-center gap-1 text-xs text-red-500 bg-red-50 px-2 py-0.5 rounded-full">
                                <AlertCircle size={10} /> 错误
                              </span>
                            )}
                          </div>

                          {tr && (
                            <div className={`mt-2 text-xs px-2 py-1.5 rounded-lg flex items-center gap-1.5 ${tr.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
                              {tr.ok ? <CheckCircle size={10} /> : <AlertCircle size={10} />}
                              {tr.msg}
                            </div>
                          )}

                          <div className="flex gap-2 mt-3">
                            {!plugin.installed ? (
                              <button
                                onClick={() => install(plugin.pluginKey)}
                                disabled={installing === plugin.pluginKey}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-white font-medium disabled:opacity-50 transition-colors"
                                style={{ background: '#16a34a' }}
                              >
                                <Plus size={12} /> {installing === plugin.pluginKey ? '安装中...' : '安装'}
                              </button>
                            ) : (
                              <>
                                {fields.length > 0 && (
                                  <button
                                    onClick={() => { setConfigTarget(plugin); setConfigValues(plugin.config); }}
                                    className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 rounded-lg text-xs text-gray-600 hover:bg-gray-50 transition-colors"
                                  >
                                    <Settings size={12} /> 配置
                                  </button>
                                )}
                                <button
                                  onClick={() => testPlugin(plugin.pluginKey)}
                                  disabled={testing === plugin.pluginKey}
                                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-white disabled:opacity-50 transition-colors"
                                  style={{ background: '#16a34a' }}
                                >
                                  {testing === plugin.pluginKey ? '测试中...' : '测试'}
                                </button>
                                <button
                                  onClick={() => uninstall(plugin.pluginKey)}
                                  className="px-2.5 py-1.5 border border-gray-200 rounded-lg text-gray-400 hover:text-red-400 hover:border-red-200 transition-colors"
                                >
                                  <Trash2 size={12} />
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </>
        )}
      </div>

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
              className="bg-white rounded-2xl w-[460px] p-6"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{configTarget.icon}</span>
                  <h3 className="font-semibold text-gray-900">{configTarget.nameZh} 配置</h3>
                </div>
                <button onClick={() => setConfigTarget(null)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
              </div>
              <div className="space-y-4">
                {(PLUGIN_FIELDS[configTarget.pluginKey] ?? []).map(f => (
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
              <div className="flex gap-3 mt-5">
                <button onClick={() => setConfigTarget(null)} className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600">取消</button>
                <button
                  onClick={() => saveConfig(configTarget)}
                  className="flex-1 py-2.5 rounded-xl text-sm text-white font-medium"
                  style={{ background: '#16a34a' }}
                >
                  保存
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
