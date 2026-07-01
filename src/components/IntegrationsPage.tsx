import { useEffect, useState } from 'react';
import { Settings, Puzzle, Share2 } from 'lucide-react';
import PluginsPage from './PluginsPage';
import ChannelsPage from './ChannelsPage';
import YouTubeIntegrationPage from './YouTubeIntegration';

type IntegrationTab = 'plugins' | 'channels' | 'social';

const TABS: { id: IntegrationTab; label: string; desc: string; icon: typeof Puzzle }[] = [
  { id: 'plugins', label: '插件市场', desc: 'Shopify、翻译、汇率、AI 工具', icon: Puzzle },
  { id: 'channels', label: '账号配置', desc: 'WhatsApp、YouTube、TikTok、Instagram/Facebook', icon: Settings },
  { id: 'social', label: '社媒账号', desc: 'YouTube、TikTok、Instagram/Facebook', icon: Share2 },
];

const TAB_KEY = 'integrations_active_tab';

function readInitialTab(): IntegrationTab {
  try {
    const saved = localStorage.getItem(TAB_KEY);
    if (saved === 'social') return 'social';
    return saved === 'channels' ? 'channels' : 'plugins';
  } catch {
    return 'plugins';
  }
}

export default function IntegrationsPage() {
  const [activeTab, setActiveTab] = useState<IntegrationTab>(readInitialTab);

  useEffect(() => {
    try { localStorage.setItem(TAB_KEY, activeTab); } catch { /* ignore storage failures */ }
  }, [activeTab]);

  return (
    <div className="flex flex-col h-full bg-white">
      <div className="px-8 pt-8 pb-4 border-b border-gray-100">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">集成中心</h1>
          <p className="text-sm text-gray-500 mt-0.5">统一管理插件安装、账号配置和社媒账号数据</p>
        </div>

        <div className="grid grid-cols-3 gap-2 mt-5">
          {TABS.map(tab => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                type="button"
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors ${
                  active ? 'border-green-200 bg-green-50 text-gray-900' : 'border-gray-100 text-gray-500 hover:border-gray-200 hover:text-gray-700'
                }`}
              >
                <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${active ? 'bg-white text-green-600' : 'bg-gray-50 text-gray-400'}`}>
                  <Icon size={16} />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">{tab.label}</span>
                  <span className="block truncate text-xs opacity-75">{tab.desc}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="min-h-0 flex-1">
        {activeTab === 'plugins' && <PluginsPage />}
        {activeTab === 'channels' && <ChannelsPage />}
        {activeTab === 'social' && <YouTubeIntegrationPage />}
      </div>
    </div>
  );
}
