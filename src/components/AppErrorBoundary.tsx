import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  error: string;
}

export default class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: '' };

  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error.message : '页面渲染异常' };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('App render error:', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="min-h-screen flex items-center justify-center bg-white px-4">
        <div className="max-w-sm w-full rounded-2xl border border-gray-200 bg-white p-6 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-red-600">
            <AlertCircle size={24} />
          </div>
          <h1 className="text-base font-bold text-gray-900">页面需要刷新</h1>
          <p className="mt-2 text-sm leading-relaxed text-gray-500">
            浏览器翻译或插件可能改写了页面内容，刷新后会自动恢复。
          </p>
          <button
            onClick={() => window.location.reload()}
            className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gray-900 px-4 py-2.5 text-sm font-semibold text-white"
          >
            <RefreshCw size={15} /> 刷新页面
          </button>
        </div>
      </div>
    );
  }
}
