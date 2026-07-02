import { Component, useEffect, useState, type ErrorInfo, type ReactNode } from 'react';
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

class IntegrationTabBoundary extends Component<
  { tab: IntegrationTab; onReset: () => void; children: ReactNode },
  { hasError: boolean; tab: IntegrationTab }
> {
  state = { hasError: false, tab: this.props.tab };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  static getDerivedStateFromProps(props: { tab: IntegrationTab }, state: { tab: IntegrationTab }) {
    if (props.tab !== state.tab) return { hasError: false, tab: props.tab };
    return null;
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[IntegrationsPage]', error, info);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="flex h-full items-center justify-center bg-white px-6">
        <div className="w-full max-w-md rounded-xl border border-gray-100 bg-gray-50 p-5 text-center">
          <p className="text-sm font-semibold text-gray-900">当前模块暂时无法显示</p>
          <p className="mt-2 text-xs leading-relaxed text-gray-500">
            这不会影响其他集成功能。请先返回插件市场继续使用，系统会自动避开异常模块。
          </p>
          <button
            type="button"
            onClick={this.props.onReset}
            className="mt-4 rounded-lg bg-gray-900 px-4 py-2 text-xs font-semibold text-white"
          >
            返回插件市场
          </button>
        </div>
      </div>
    );
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
        <IntegrationTabBoundary tab={activeTab} onReset={() => setActiveTab('plugins')}>
          {activeTab === 'plugins' && <PluginsPage />}
          {activeTab === 'channels' && <ChannelsPage />}
          {activeTab === 'social' && <YouTubeIntegrationPage />}
        </IntegrationTabBoundary>
      </div>
    </div>
  );
}
