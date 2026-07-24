import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  ExternalLink,
  Loader2,
  RefreshCw,
  ShieldCheck,
  WifiOff,
} from 'lucide-react';
import { authHeader } from '../lib/auth';
import { getWhatsAppEmbeddedSignupConfig, startWhatsAppEmbeddedSignup } from '../lib/whatsappEmbeddedSignup';

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
  wecom: {
    icon: '企微',
    helper: '连接后企业微信外部联系人会进入“我的客户”，AI 按同一套接待规则生成回复草稿与跟进建议。',
    accent: 'bg-green-50 text-green-700',
  },
};

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

function ChannelStatusCard({ channel, onConnected }: { channel: TenantChannelStatus; onConnected: () => void }) {
  const meta = CHANNEL_META[channel.id] || CHANNEL_META.whatsapp;
  const view = statusView(channel);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState('');

  async function startAuthorization() {
    if (channel.id !== 'whatsapp') {
      window.dispatchEvent(new CustomEvent('lingshu-toast', {
        detail: { message: '该渠道仍由专属顾问协助授权。' },
      }));
      return;
    }
    setConnecting(true);
    setError('');
    try {
      const config = await getWhatsAppEmbeddedSignupConfig();
      await startWhatsAppEmbeddedSignup(config);
      window.dispatchEvent(new CustomEvent('lingshu-toast', {
        detail: { message: 'WhatsApp 已连接，灵枢会自动同步账号信息。' },
      }));
      onConnected();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'WhatsApp 授权失败');
    } finally {
      setConnecting(false);
    }
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
            disabled={connecting}
            className="inline-flex items-center gap-2 rounded-lg bg-gray-950 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-60"
          >
            {connecting ? <Loader2 size={15} className="animate-spin" /> : <ExternalLink size={15} />}
            {channel.id === 'whatsapp' ? '连接 WhatsApp' : '去确认授权'}
          </button>
        )}
      </div>
      {error && <p className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">{error}</p>}
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
    </section>
  );
}

export default function ChannelsPage() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [status, setStatus] = useState<ChannelsStatusResponse | null>(null);
  const [error, setError] = useState('');

  const connectedCount = useMemo(() => status?.channels.filter(channel => channel.status === 'connected').length ?? 0, [status]);

  async function load() {
    setError('');
    try {
      const statusResponse = await fetch('/api/overseas/channels/status', { headers: authHeader() });
      const statusData = await statusResponse.json().catch(() => ({})) as ChannelsStatusResponse & { error?: string };
      if (!statusResponse.ok) throw new Error(statusData.error || '无法读取渠道状态');
      setStatus(statusData);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法读取渠道状态');
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
    <div className="flex h-full flex-col bg-gray-50" data-lingshu-guide="channel-connections">
      <header className="border-b border-gray-100 bg-white px-8 py-6">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-xl font-semibold text-gray-950">账号连接</h1>
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
                <p className="text-sm font-semibold text-emerald-900">已接入 {connectedCount}/{status.channels.length} 个渠道</p>
              </div>
            </section>

            <div className="grid gap-5 xl:grid-cols-2">
              {status.channels.map(channel => <ChannelStatusCard key={channel.id} channel={channel} onConnected={() => void refresh()} />)}
            </div>

            {status.isAdmin && <AdminDiagnostics channels={status.channels} />}
          </div>
        ) : null}
      </main>
    </div>
  );
}
