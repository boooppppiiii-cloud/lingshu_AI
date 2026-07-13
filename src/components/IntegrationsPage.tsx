import { Component, useEffect, useState, type ErrorInfo, type ReactNode } from 'react';
import { PlugZap } from 'lucide-react';
import ChannelsPage from './ChannelsPage';

class IntegrationTabBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
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
            这不会影响其他页面。请刷新后重试账号授权配置。
          </p>
          <button
            type="button"
            onClick={() => this.setState({ hasError: false })}
            className="mt-4 rounded-lg bg-gray-900 px-4 py-2 text-xs font-semibold text-white"
          >
            重新加载
          </button>
        </div>
      </div>
    );
  }
}

export default function IntegrationsPage() {
  const [importStatus, setImportStatus] = useState<{ status?: string; done?: number; total?: number } | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () => {
      fetch('/api/overseas/customers/whatsapp/import-status')
        .then(resp => resp.ok ? resp.json() : null)
        .then(data => {
          if (alive) setImportStatus(data);
        })
        .catch(() => {});
    };
    load();
    const timer = window.setInterval(load, 5000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  const importing = importStatus?.status === 'importing';

  return (
    <div className="flex flex-col h-full bg-white">
      <div className="h-12 flex items-center justify-between px-5 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-6 h-6 rounded-lg flex items-center justify-center" style={{ background: 'rgba(22,163,74,0.1)', color: '#16a34a' }}>
            <PlugZap size={13} />
          </div>
          <span className="text-sm font-semibold text-text-primary">集成中心</span>
        </div>
        {importing && (
          <div className="mt-4 rounded-lg border border-sky-100 bg-sky-50 px-4 py-3 text-sm font-semibold text-sky-800">
            正在导入历史记录（{importStatus.done ?? 0}/{importStatus.total ?? 0}）
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1">
        <IntegrationTabBoundary>
          <ChannelsPage />
        </IntegrationTabBoundary>
      </div>
    </div>
  );
}
