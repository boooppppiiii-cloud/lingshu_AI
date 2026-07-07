import { useState, useEffect } from 'react';
import {
  Loader2,
  MessageSquare,
  Eye,
  ThumbsUp,
  TvMinimalPlay,
  CheckCircle,
  AlertCircle,
  ExternalLink,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { authHeader } from '../lib/auth';

interface YouTubeAccount {
  id: string;
  channelId: string;
  channelTitle: string;
  customUrl?: string;
  thumbnailUrl?: string;
  subscriberCount: number;
  videoCount: number;
  viewCount: number;
  status: 'connected' | 'error' | 'expired';
  connectedAt?: string;
  lastSyncAt?: string;
}

interface OAuthStatus {
  configured: boolean;
  redirectUri: string;
  scopes: string[];
  manualConnectEnabled?: boolean;
}

interface OAuthWindowMessage {
  source?: string;
  type?: string;
  status?: 'success' | 'error';
  accountId?: string;
  channelTitle?: string;
  message?: string;
}

interface ManualOAuthValues {
  refreshToken: string;
}

interface YouTubeVideo {
  id: string;
  title: string;
  description: string;
  publishedAt: string;
  thumbnailUrl: string;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  duration: string;
}

interface YouTubeComment {
  id: string;
  authorName: string;
  authorProfileImageUrl?: string;
  textDisplay: string;
  likeCount: number;
  publishedAt: string;
  videoId: string;
}

type SocialPlatform = 'tiktok' | 'instagram' | 'facebook';

interface SocialAccount {
  id: string;
  platform: SocialPlatform;
  providerAccountId: string;
  title: string;
  handle?: string;
  avatarUrl?: string;
  parentPageName?: string;
  followerCount: number;
  videoCount: number;
  viewCount: number;
  likeCount: number;
  status: 'connected' | 'error' | 'expired';
  connectedAt?: string;
  lastSyncAt?: string;
}

interface SocialOAuthStatus {
  configured: boolean;
  redirectUri: string;
  scopes: string[];
  manualConnectEnabled?: boolean;
}

interface SocialOAuthWindowMessage {
  source?: string;
  type?: string;
  platform?: SocialPlatform;
  status?: 'success' | 'error';
  message?: string;
}

interface ManualSocialValues {
  accessToken: string;
  refreshToken: string;
  providerAccountId: string;
  parentPageId: string;
}

const compactNumber = new Intl.NumberFormat('zh-CN', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

function channelUrl(account: YouTubeAccount) {
  return `https://www.youtube.com/channel/${account.channelId}`;
}

function externalAccountUrl(account: { platform: string; providerAccountId: string; handle?: string }) {
  if (account.platform === 'youtube') return `https://www.youtube.com/channel/${account.providerAccountId}`;
  if (account.platform === 'facebook') return `https://www.facebook.com/${account.providerAccountId}`;
  if (account.platform === 'instagram') {
    const handle = account.handle?.replace(/^@/, '').trim();
    return handle ? `https://www.instagram.com/${handle}/` : '';
  }
  if (account.platform === 'tiktok') {
    const handle = account.handle?.replace(/^@/, '').trim();
    return handle ? `https://www.tiktok.com/@${handle}` : '';
  }
  return '';
}

function statusLabel(status: YouTubeAccount['status']) {
  if (status === 'connected') return '已连接';
  if (status === 'expired') return '授权过期';
  return '连接异常';
}

function statusClass(status: YouTubeAccount['status']) {
  if (status === 'connected') return 'text-green-600 bg-green-50';
  if (status === 'expired') return 'text-amber-700 bg-amber-50';
  return 'text-red-600 bg-red-50';
}

export function YouTubeConnectionPanel({ compact = false }: { compact?: boolean }) {
  const [accounts, setAccounts] = useState<YouTubeAccount[]>([]);
  const [oauthStatus, setOauthStatus] = useState<OAuthStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualSaving, setManualSaving] = useState(false);
  const [manualValues, setManualValues] = useState<ManualOAuthValues>({
    refreshToken: '',
  });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const loadConnectionState = async () => {
    setLoading(true);
    setError('');
    try {
      const [statusRes, accountsRes] = await Promise.all([
        fetch('/api/overseas/youtube/oauth/status', { headers: authHeader() }),
        fetch('/api/overseas/youtube/accounts', { headers: authHeader() }),
      ]);
      const statusData = await statusRes.json().catch(() => ({})) as OAuthStatus & { error?: string };
      const accountsData = await accountsRes.json().catch(() => ({})) as { items?: YouTubeAccount[]; error?: string };
      if (!statusRes.ok) throw new Error(statusData.error || '无法读取 YouTube 授权配置');
      if (!accountsRes.ok) throw new Error(accountsData.error || '无法读取 YouTube 账号');
      setOauthStatus(statusData);
      setAccounts(accountsData.items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : '读取 YouTube 连接状态失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadConnectionState();
  }, []);

  useEffect(() => {
    const onMessage = (event: MessageEvent<OAuthWindowMessage>) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data;
      if (data?.source !== 'overseas-workbench' || data.type !== 'youtube-oauth') return;
      setConnecting(false);
      if (data.status === 'success') {
        setNotice(data.channelTitle ? `${data.channelTitle} 已连接成功` : 'YouTube 已连接成功');
        setError('');
        void loadConnectionState();
      } else {
        setError(data.message || 'YouTube 授权没有完成');
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const startOAuth = async () => {
    setConnecting(true);
    setError('');
    setNotice('');
    try {
      const r = await fetch('/api/overseas/youtube/oauth/start', {
        method: 'POST',
        headers: { ...authHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ returnTo: `${window.location.pathname}${window.location.search}` }),
      });
      const data = await r.json().catch(() => ({})) as { url?: string; error?: string };
      if (!r.ok || !data.url) throw new Error(data.error || '无法打开 YouTube 授权');

      const popup = window.open(data.url, 'youtube-oauth', 'width=580,height=720,menubar=no,toolbar=no,location=yes,status=no');
      if (!popup) {
        window.location.assign(data.url);
        return;
      }
      popup.focus();
    } catch (e) {
      setConnecting(false);
      setError(e instanceof Error ? e.message : 'YouTube 授权启动失败');
    }
  };

  const disconnectAccount = async (id: string) => {
    setDeletingId(id);
    setError('');
    try {
      const r = await fetch(`/api/overseas/youtube/accounts/${id}`, {
        method: 'DELETE',
        headers: authHeader(),
      });
      const data = await r.json().catch(() => ({})) as { error?: string };
      if (!r.ok) throw new Error(data.error || '断开 YouTube 失败');
      setAccounts(prev => prev.filter(a => a.id !== id));
      setNotice('YouTube 账号已断开');
    } catch (e) {
      setError(e instanceof Error ? e.message : '断开 YouTube 失败');
    } finally {
      setDeletingId(null);
    }
  };

  const connectManually = async () => {
    if (!manualValues.refreshToken.trim()) {
      setError('请填写 Refresh Token');
      return;
    }

    setManualSaving(true);
    setError('');
    setNotice('');
    try {
      const r = await fetch('/api/overseas/youtube/connect', {
        method: 'POST',
        headers: { ...authHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          refreshToken: manualValues.refreshToken.trim(),
        }),
      });
      const data = await r.json().catch(() => ({})) as { channelTitle?: string; error?: string };
      if (!r.ok) throw new Error(data.error || 'YouTube 手动接入失败');

      setNotice(data.channelTitle ? `${data.channelTitle} 已连接成功` : 'YouTube 已连接成功');
      setManualValues({ refreshToken: '' });
      setManualOpen(false);
      await loadConnectionState();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'YouTube 手动接入失败');
    } finally {
      setManualSaving(false);
    }
  };

  return (
    <section className={`border border-gray-200 rounded-xl bg-white ${compact ? 'p-4' : 'p-5'}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <div className="w-10 h-10 rounded-lg bg-red-50 text-red-600 flex items-center justify-center flex-shrink-0">
            <TvMinimalPlay size={20} />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-gray-900">YouTube 一键授权</h2>
            <p className="text-xs text-gray-500 mt-1 leading-relaxed">
              登录您的 YouTube 账号并允许授权后，AI 生成的视频即可直接发布到该频道。
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() => void loadConnectionState()}
            disabled={loading}
            title="刷新"
            className="p-2 rounded-lg border border-gray-200 text-gray-500 hover:text-gray-800 hover:border-gray-300 disabled:opacity-50"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={() => void startOAuth()}
            disabled={connecting || loading || oauthStatus?.configured === false}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {connecting ? <Loader2 size={15} className="animate-spin" /> : <TvMinimalPlay size={15} />}
            {accounts.length > 0 ? '重新连接' : '连接 YouTube'}
          </button>
        </div>
      </div>

      {notice && (
        <div className="mt-4 flex items-start gap-2 rounded-lg bg-green-50 px-3 py-2 text-xs text-green-700">
          <CheckCircle size={14} className="mt-0.5 flex-shrink-0" />
          <span>{notice}</span>
        </div>
      )}

      {error && (
        <div className="mt-4 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">
          <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {oauthStatus && !oauthStatus.configured && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-xs text-amber-800">
          <p className="font-semibold mb-1">YouTube 一键授权暂未开启</p>
          <p className="leading-relaxed">请联系服务顾问配置平台应用和回调地址，完成后即可登录 YouTube 账号进行授权。</p>
          <code className="mt-2 block break-all rounded-md bg-white/70 px-2 py-1 text-[11px] text-amber-900">{oauthStatus.redirectUri}</code>
        </div>
      )}

      {oauthStatus?.manualConnectEnabled && (
      <div className="mt-4 border-t border-gray-100 pt-4">
        <button
          onClick={() => setManualOpen(v => !v)}
          className="text-xs font-semibold text-gray-500 hover:text-gray-900"
        >
          {manualOpen ? '收起手动接入' : '手动接入'}
        </button>

        {manualOpen && (
          <div className="mt-3 grid gap-3 rounded-xl border border-gray-200 bg-gray-50 p-3">
            <p className="text-xs leading-relaxed text-gray-500">
              适用于已完成授权但需要手动补充频道凭据的场景。请按服务顾问提供的信息填写。
            </p>
            <div className="grid gap-2 md:grid-cols-1">
              <label className="grid gap-1 text-xs font-semibold text-gray-600">
                Refresh Token
                <input
                  type="password"
                  value={manualValues.refreshToken}
                  onChange={e => setManualValues(v => ({ ...v, refreshToken: e.target.value }))}
                  placeholder="1//..."
                  className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-normal text-gray-900 outline-none focus:border-red-300"
                />
              </label>
            </div>
            <div className="flex items-center justify-end">
              <button
                onClick={() => void connectManually()}
                disabled={manualSaving}
                className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
              >
                {manualSaving && <Loader2 size={12} className="animate-spin" />}
                保存并连接
              </button>
            </div>
          </div>
        )}
      </div>
      )}

      {loading ? (
        <div className="mt-5 flex items-center gap-2 text-sm text-gray-400">
          <Loader2 size={16} className="animate-spin" /> 正在读取 YouTube 连接状态...
        </div>
      ) : accounts.length > 0 ? (
        <div className="mt-5 grid gap-3" style={{ gridTemplateColumns: compact ? '1fr' : 'repeat(auto-fit, minmax(260px, 1fr))' }}>
          {accounts.map(account => (
            <div key={account.id} className="border border-gray-200 rounded-xl p-4">
              <div className="flex items-start gap-3">
                {account.thumbnailUrl ? (
                  <img src={account.thumbnailUrl} alt={account.channelTitle} className="w-11 h-11 rounded-lg object-cover flex-shrink-0" />
                ) : (
                  <div className="w-11 h-11 rounded-lg bg-red-50 text-red-600 flex items-center justify-center flex-shrink-0">
                    <TvMinimalPlay size={18} />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">{account.channelTitle}</p>
                    <span className={`px-1.5 py-0.5 rounded-md text-[10px] font-semibold flex-shrink-0 ${statusClass(account.status)}`}>
                      {statusLabel(account.status)}
                    </span>
                  </div>
                  <p className="text-[11px] text-gray-400 truncate mt-0.5">{account.channelId}</p>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-lg bg-gray-50 px-2 py-1.5">
                      <p className="text-xs font-semibold text-gray-900">{compactNumber.format(account.subscriberCount || 0)}</p>
                      <p className="text-[10px] text-gray-400">订阅</p>
                    </div>
                    <div className="rounded-lg bg-gray-50 px-2 py-1.5">
                      <p className="text-xs font-semibold text-gray-900">{compactNumber.format(account.videoCount || 0)}</p>
                      <p className="text-[10px] text-gray-400">视频</p>
                    </div>
                    <div className="rounded-lg bg-gray-50 px-2 py-1.5">
                      <p className="text-xs font-semibold text-gray-900">{compactNumber.format(account.viewCount || 0)}</p>
                      <p className="text-[10px] text-gray-400">播放</p>
                    </div>
                  </div>
                </div>
              </div>
              <div className="mt-4 flex items-center gap-2">
                <a
                  href={channelUrl(account)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-semibold text-gray-600 hover:text-gray-900 hover:border-gray-300"
                >
                  <ExternalLink size={12} /> 打开频道
                </a>
                <button
                  onClick={() => void disconnectAccount(account.id)}
                  disabled={deletingId === account.id}
                  className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-semibold text-gray-500 hover:text-red-600 hover:border-red-200 disabled:opacity-50"
                >
                  {deletingId === account.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                  断开
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-5 rounded-xl border border-dashed border-gray-200 px-4 py-5 text-center">
          <TvMinimalPlay size={28} className="mx-auto text-gray-300 mb-2" />
          <p className="text-sm font-medium text-gray-700">还没有连接 YouTube 频道</p>
          <p className="text-xs text-gray-400 mt-1">连接后，我的社媒里的 AI 生成视频可以一键发布到 YouTube。</p>
        </div>
      )}
    </section>
  );
}

const SOCIAL_META: Record<SocialPlatform, {
  label: string;
  description: string;
  envHint: string;
  color: string;
  bg: string;
}> = {
  tiktok: {
    label: 'TikTok',
    description: '连接 TikTok 后可读取账号视频数据，并通过 Content Posting API 发布短视频。',
    envHint: 'TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET',
    color: '#111827',
    bg: '#eef2ff',
  },
  instagram: {
    label: 'Instagram',
    description: '连接 Instagram 专业账号后可读取媒体和评论，并发布 Reels。',
    envHint: 'META_SOCIAL_APP_ID / META_SOCIAL_APP_SECRET',
    color: '#c13584',
    bg: '#fdf2f8',
  },
  facebook: {
    label: 'Facebook',
    description: '连接 Facebook Page 后可读取主页视频和评论，并发布视频到主页。',
    envHint: 'META_SOCIAL_APP_ID / META_SOCIAL_APP_SECRET',
    color: '#1877f2',
    bg: '#eff6ff',
  },
};

const emptyManualSocialValues: ManualSocialValues = {
  accessToken: '',
  refreshToken: '',
  providerAccountId: '',
  parentPageId: '',
};

const SOCIAL_MANUAL_COPY: Record<SocialPlatform, {
  tokenLabel: string;
  tokenPlaceholder: string;
  accountLabel: string;
  accountPlaceholder: string;
  pageLabel?: string;
  pagePlaceholder?: string;
  helper: string;
}> = {
  tiktok: {
    tokenLabel: 'Access Token',
    tokenPlaceholder: 'act....',
    accountLabel: 'Open ID（可选）',
    accountPlaceholder: '系统会自动识别，可不填',
    pageLabel: 'Refresh Token（可选）',
    pagePlaceholder: '用于后续刷新授权',
    helper: '适用于已完成 TikTok 授权但需要手动补充账号凭据的场景。系统会先读取账号资料，成功后才保存。',
  },
  instagram: {
    tokenLabel: 'Meta Access Token',
    tokenPlaceholder: 'User Token 或 Page Token',
    accountLabel: 'Facebook Page ID（可选）',
    accountPlaceholder: '不填则自动识别',
    helper: '填一个未过期的 Meta Access Token 即可；系统会自动查找 Facebook Page 和已绑定的 Instagram 专业账号。',
  },
  facebook: {
    tokenLabel: 'Meta Access Token',
    tokenPlaceholder: 'User Token 或 Page Token',
    accountLabel: 'Facebook Page ID（可选）',
    accountPlaceholder: '不填则自动识别',
    helper: '填一个未过期的 Meta Access Token 即可；系统会自动查找并连接可管理的 Facebook Page。',
  },
};

export function SocialConnectionPanel({ platform }: { platform: SocialPlatform }) {
  const meta = SOCIAL_META[platform];
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [status, setStatus] = useState<SocialOAuthStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualSaving, setManualSaving] = useState(false);
  const [manualValues, setManualValues] = useState<ManualSocialValues>(emptyManualSocialValues);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const manualCopy = SOCIAL_MANUAL_COPY[platform];
  const isTikTokReviewPending = platform === 'tiktok' && status?.configured === false;

  const loadState = async () => {
    setLoading(true);
    setError('');
    try {
      const [statusRes, accountsRes] = await Promise.all([
        fetch(`/api/overseas/social/oauth/${platform}/status`, { headers: authHeader() }),
        fetch(`/api/overseas/social/accounts?platform=${platform}`, { headers: authHeader() }),
      ]);
      const statusData = await statusRes.json().catch(() => ({})) as SocialOAuthStatus & { error?: string };
      const accountsData = await accountsRes.json().catch(() => ({})) as { items?: SocialAccount[]; error?: string };
      if (!statusRes.ok) throw new Error(statusData.error || `无法读取 ${meta.label} 授权配置`);
      if (!accountsRes.ok) throw new Error(accountsData.error || `无法读取 ${meta.label} 账号`);
      setStatus(statusData);
      setAccounts(accountsData.items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : `读取 ${meta.label} 连接状态失败`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadState(); }, [platform]);

  useEffect(() => {
    const onMessage = (event: MessageEvent<SocialOAuthWindowMessage>) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data;
      if (data?.source !== 'overseas-workbench' || data.type !== 'social-oauth' || data.platform !== platform) return;
      setConnecting(false);
      if (data.status === 'success') {
        setNotice(`${meta.label} 已连接成功`);
        setError('');
        void loadState();
      } else {
        setError(data.message || `${meta.label} 授权没有完成`);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [platform]);

  const startOAuth = async () => {
    setConnecting(true);
    setError('');
    setNotice('');
    try {
      const r = await fetch(`/api/overseas/social/oauth/${platform}/start`, {
        method: 'POST',
        headers: { ...authHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ returnTo: `${window.location.pathname}${window.location.search}` }),
      });
      const data = await r.json().catch(() => ({})) as { url?: string; error?: string };
      if (!r.ok || !data.url) throw new Error(data.error || `无法打开 ${meta.label} 授权`);
      const popup = window.open(data.url, `${platform}-oauth`, 'width=620,height=760,menubar=no,toolbar=no,location=yes,status=no');
      if (!popup) {
        window.location.assign(data.url);
        return;
      }
      popup.focus();
    } catch (e) {
      setConnecting(false);
      setError(e instanceof Error ? e.message : `${meta.label} 授权启动失败`);
    }
  };

  const disconnect = async (id: string) => {
    setDeletingId(id);
    setError('');
    try {
      const r = await fetch(`/api/overseas/social/accounts/${id}`, { method: 'DELETE', headers: authHeader() });
      const data = await r.json().catch(() => ({})) as { error?: string };
      if (!r.ok) throw new Error(data.error || `断开 ${meta.label} 失败`);
      setAccounts(prev => prev.filter(a => a.id !== id));
      setNotice(`${meta.label} 账号已断开`);
    } catch (e) {
      setError(e instanceof Error ? e.message : `断开 ${meta.label} 失败`);
    } finally {
      setDeletingId(null);
    }
  };

  const connectManually = async () => {
    const accessToken = manualValues.accessToken.trim();
    const providerAccountId = manualValues.providerAccountId.trim();
    const parentPageId = manualValues.parentPageId.trim();

    if (!accessToken) {
      setError(`请填写 ${manualCopy.tokenLabel}`);
      return;
    }

    setManualSaving(true);
    setError('');
    setNotice('');
    try {
      const r = await fetch('/api/overseas/social/connect/manual', {
        method: 'POST',
        headers: { ...authHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform,
          accessToken,
          refreshToken: manualValues.refreshToken.trim(),
          providerAccountId,
          parentPageId,
        }),
      });
      const data = await r.json().catch(() => ({})) as { account?: SocialAccount; error?: string };
      if (!r.ok) throw new Error(data.error || `${meta.label} 手动接入失败`);
      setNotice(data.account?.title ? `${data.account.title} 已连接成功` : `${meta.label} 已连接成功`);
      setManualValues(emptyManualSocialValues);
      setManualOpen(false);
      await loadState();
    } catch (e) {
      setError(e instanceof Error ? e.message : `${meta.label} 手动接入失败`);
    } finally {
      setManualSaving(false);
    }
  };

  return (
    <section className="flex h-full min-h-[360px] flex-col rounded-xl border border-gray-200 bg-white p-5">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: meta.bg, color: meta.color }}>
            <TvMinimalPlay size={20} />
          </div>
          <div className="min-w-0">
            <h2 className="truncate whitespace-nowrap text-sm font-semibold text-gray-900">{meta.label} 授权</h2>
            <p className="mt-1 min-h-[72px] text-xs leading-relaxed text-gray-500">{meta.description}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button onClick={() => void loadState()} disabled={loading} title="刷新"
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:text-gray-800 hover:border-gray-300 disabled:opacity-50">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
          <button onClick={() => void startOAuth()} disabled={connecting || loading || status?.configured === false}
            className="inline-flex h-10 w-[156px] items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
            style={{ background: meta.color }}>
            {connecting ? <Loader2 size={15} className="animate-spin" /> : <TvMinimalPlay size={15} />}
            {isTikTokReviewPending ? '审核中' : accounts.length > 0 ? '重新连接' : `连接 ${meta.label}`}
          </button>
        </div>
      </div>

      <div className="mt-4 min-h-[132px]">
        {notice && (
          <div className="mb-3 flex items-start gap-2 rounded-lg bg-green-50 px-3 py-2 text-xs text-green-700">
            <CheckCircle size={14} className="mt-0.5 flex-shrink-0" />
            <span>{notice}</span>
          </div>
        )}
        {error && (
          <div className="mb-3 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">
            <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {isTikTokReviewPending ? (
          <div className="flex min-h-[132px] flex-col justify-center rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-xs text-amber-800">
            <p className="font-semibold mb-1">TikTok 账号正在审核中</p>
            <p className="leading-relaxed">TikTok 发布权限需要平台审核，当前暂时不能连接账号或发布视频。审核通过后，系统会自动开放 TikTok 授权入口。</p>
          </div>
        ) : status && !status.configured ? (
          <div className="flex min-h-[132px] flex-col justify-center rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-xs text-amber-800">
            <p className="font-semibold mb-1">{meta.label} 授权暂未开启</p>
            <p className="leading-relaxed">请联系服务顾问配置平台应用和回调地址，完成后即可登录账号进行授权。</p>
            <code className="mt-2 block break-all rounded-md bg-white/70 px-2 py-1 text-[11px] text-amber-900">{status.redirectUri}</code>
          </div>
        ) : null}
      </div>

      {status?.manualConnectEnabled && !isTikTokReviewPending && (
      <div className="mt-4 border-t border-gray-100 pt-4">
        <button
          onClick={() => setManualOpen(v => !v)}
          className="text-xs font-semibold text-gray-500 hover:text-gray-900"
        >
          {manualOpen ? '收起手动接入' : '手动接入'}
        </button>

        {manualOpen && (
          <div className="mt-3 grid gap-3 rounded-xl border border-gray-200 bg-gray-50 p-3">
            <p className="text-xs leading-relaxed text-gray-500">{manualCopy.helper}</p>
            <div className={`grid gap-2 ${manualCopy.pageLabel ? 'md:grid-cols-3' : 'md:grid-cols-2'}`}>
              <label className="grid gap-1 text-xs font-semibold text-gray-600">
                {manualCopy.tokenLabel}
                <input
                  type="password"
                  value={manualValues.accessToken}
                  onChange={e => setManualValues(v => ({ ...v, accessToken: e.target.value }))}
                  placeholder={manualCopy.tokenPlaceholder}
                  className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-normal text-gray-900 outline-none focus:border-gray-400"
                />
              </label>
              <label className="grid gap-1 text-xs font-semibold text-gray-600">
                {manualCopy.accountLabel}
                <input
                  value={manualValues.providerAccountId}
                  onChange={e => setManualValues(v => ({ ...v, providerAccountId: e.target.value }))}
                  placeholder={manualCopy.accountPlaceholder}
                  className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-normal text-gray-900 outline-none focus:border-gray-400"
                />
              </label>
              {manualCopy.pageLabel && (
                <label className="grid gap-1 text-xs font-semibold text-gray-600">
                  {manualCopy.pageLabel}
                  <input
                    type={platform === 'tiktok' ? 'password' : 'text'}
                    value={platform === 'tiktok' ? manualValues.refreshToken : manualValues.parentPageId}
                    onChange={e => setManualValues(v => platform === 'tiktok'
                      ? { ...v, refreshToken: e.target.value }
                      : { ...v, parentPageId: e.target.value })}
                    placeholder={manualCopy.pagePlaceholder}
                    className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-normal text-gray-900 outline-none focus:border-gray-400"
                  />
                </label>
              )}
            </div>
            <div className="flex items-center justify-end">
              <button
                onClick={() => void connectManually()}
                disabled={manualSaving}
                className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
              >
                {manualSaving && <Loader2 size={12} className="animate-spin" />}
                保存并连接
              </button>
            </div>
          </div>
        )}
      </div>
      )}

      {loading ? (
        <div className="mt-auto flex min-h-[104px] items-center gap-2 text-sm text-gray-400">
          <Loader2 size={16} className="animate-spin" /> 正在读取 {meta.label} 连接状态...
        </div>
      ) : accounts.length > 0 ? (
        <div className="mt-auto grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
          {accounts.map(account => (
            <div key={account.id} className="border border-gray-200 rounded-xl p-4">
              <div className="flex items-start gap-3">
                {account.avatarUrl ? (
                  <img src={account.avatarUrl} alt={account.title} className="w-11 h-11 rounded-lg object-cover flex-shrink-0" />
                ) : (
                  <div className="w-11 h-11 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: meta.bg, color: meta.color }}>
                    <TvMinimalPlay size={18} />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">{account.title}</p>
                    <span className={`px-1.5 py-0.5 rounded-md text-[10px] font-semibold flex-shrink-0 ${statusClass(account.status)}`}>
                      {statusLabel(account.status)}
                    </span>
                  </div>
                  <p className="text-[11px] text-gray-400 truncate mt-0.5">{account.handle || account.providerAccountId}</p>
                  {account.parentPageName && <p className="text-[11px] text-gray-400 truncate mt-0.5">Page: {account.parentPageName}</p>}
                </div>
              </div>
              <div className="mt-4 flex items-center gap-2">
                {externalAccountUrl(account) && (
                  <a
                    href={externalAccountUrl(account)}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-semibold text-gray-600 hover:text-gray-900 hover:border-gray-300"
                  >
                    <ExternalLink size={12} /> 打开主页
                  </a>
                )}
                <button onClick={() => void disconnect(account.id)} disabled={deletingId === account.id}
                  className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-semibold text-gray-500 hover:text-red-600 hover:border-red-200 disabled:opacity-50">
                  {deletingId === account.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                  断开
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-auto rounded-xl border border-dashed border-gray-200 px-4 py-5 text-center">
          <TvMinimalPlay size={28} className="mx-auto text-gray-300 mb-2" />
          <p className="text-sm font-medium text-gray-700">还没有连接 {meta.label} 账号</p>
          <p className="text-xs text-gray-400 mt-1">连接后会出现在「频道总览」和「一键发布」里。</p>
        </div>
      )}
    </section>
  );
}

function formatDate(value: string) {
  if (!value) return '-';
  return new Date(value).toLocaleDateString('zh-CN');
}

function platformTone(platform: string) {
  if (platform === 'youtube') return { background: '#fff1f2', color: '#dc2626' };
  if (platform === 'tiktok') return { background: '#eef2ff', color: '#111827' };
  if (platform === 'facebook') return { background: '#eff6ff', color: '#1877f2' };
  return { background: '#fdf2f8', color: '#be185d' };
}

async function fetchJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { headers: authHeader() });
  const data = await r.json().catch(() => ({})) as T & { error?: string };
  if (!r.ok) throw new Error(data.error || '请求失败');
  return data;
}

export function ChannelOverview() {
  type OverviewPlatform = 'youtube' | 'tiktok' | 'instagram' | 'facebook';
  const [platform, setPlatform] = useState<OverviewPlatform>('youtube');
  type OverviewAccount = {
    id: string;
    platform: OverviewPlatform;
    providerAccountId: string;
    title: string;
    handle?: string;
    avatarUrl?: string;
    followerCount: number;
    videoCount: number;
    viewCount: number;
    likeCount: number;
    status: 'connected' | 'error' | 'expired';
    parentPageName?: string;
  };
  type OverviewVideo = YouTubeVideo & { permalinkUrl?: string };
  const [accounts, setAccounts] = useState<OverviewAccount[]>([]);
  const [counts, setCounts] = useState<Record<OverviewPlatform, number>>({ youtube: 0, tiktok: 0, instagram: 0, facebook: 0 });
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [videos, setVideos] = useState<OverviewVideo[]>([]);
  const [selectedVideoId, setSelectedVideoId] = useState('');
  const [comments, setComments] = useState<YouTubeComment[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [videosLoading, setVideosLoading] = useState(false);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [error, setError] = useState('');

  const selectedAccount = accounts.find(a => a.id === selectedAccountId) ?? null;
  const selectedVideo = videos.find(v => v.id === selectedVideoId) ?? null;

  const currentPlatform = platform as OverviewPlatform;
  const accountUrl = (account: OverviewAccount) => externalAccountUrl(account);
  const mapYouTube = (a: YouTubeAccount): OverviewAccount => ({
    id: a.id,
    platform: 'youtube',
    providerAccountId: a.channelId,
    title: a.channelTitle,
    handle: a.channelTitle,
    avatarUrl: a.thumbnailUrl,
    followerCount: a.subscriberCount,
    videoCount: a.videoCount,
    viewCount: a.viewCount,
    likeCount: 0,
    status: a.status,
  });
  const loadPlatformAccounts = async (target: OverviewPlatform) => {
    if (target === 'youtube') {
      const data = await fetchJson<{ items?: YouTubeAccount[] }>('/api/overseas/youtube/accounts');
      return (data.items ?? []).filter(a => a.status === 'connected').map(mapYouTube);
    }
    const data = await fetchJson<{ items?: SocialAccount[] }>(`/api/overseas/social/accounts?platform=${target}`);
    return (data.items ?? []).filter(a => a.status === 'connected').map((a): OverviewAccount => ({
      id: a.id,
      platform: a.platform,
      providerAccountId: a.providerAccountId,
      title: a.title,
      handle: a.handle,
      avatarUrl: a.avatarUrl,
      followerCount: a.followerCount,
      videoCount: a.videoCount,
      viewCount: a.viewCount,
      likeCount: a.likeCount,
      status: a.status,
      parentPageName: a.parentPageName,
    }));
  };

  const loadCounts = async () => {
    const platforms: OverviewPlatform[] = ['youtube', 'tiktok', 'instagram', 'facebook'];
    const results = await Promise.allSettled(platforms.map(loadPlatformAccounts));
    const next = { youtube: 0, tiktok: 0, instagram: 0, facebook: 0 };
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') next[platforms[index]] = result.value.length;
    });
    setCounts(next);
  };

  const loadAccounts = async (target: OverviewPlatform = currentPlatform) => {
    setAccountsLoading(true);
    setError('');
    try {
      const connected = await loadPlatformAccounts(target);
      setAccounts(connected);
      setSelectedAccountId(connected[0]?.id || '');
    } catch (e) {
      setError(e instanceof Error ? e.message : '无法读取频道账号');
    } finally {
      setAccountsLoading(false);
    }
  };

  useEffect(() => {
    void loadCounts();
  }, []);

  useEffect(() => {
    setSelectedAccountId('');
    setVideos([]);
    setComments([]);
    void loadAccounts(currentPlatform);
  }, [platform]);

  useEffect(() => {
    if (!selectedAccountId) {
      setVideos([]);
      setSelectedVideoId('');
      setComments([]);
      return;
    }
    setVideosLoading(true);
    setError('');
    const url = currentPlatform === 'youtube'
      ? `/api/overseas/youtube/accounts/${selectedAccountId}/videos?maxResults=50`
      : `/api/overseas/social/accounts/${selectedAccountId}/videos?maxResults=50`;
    fetchJson<{ videos?: OverviewVideo[] }>(url)
      .then(data => {
        const list = data.videos ?? [];
        setVideos(list);
        setSelectedVideoId(list[0]?.id || '');
      })
      .catch(e => setError(e instanceof Error ? e.message : '无法读取视频列表'))
      .finally(() => setVideosLoading(false));
  }, [selectedAccountId, currentPlatform]);

  useEffect(() => {
    if (!selectedAccountId || !selectedVideoId) {
      setComments([]);
      return;
    }
    setCommentsLoading(true);
    setError('');
    const url = currentPlatform === 'youtube'
      ? `/api/overseas/youtube/accounts/${selectedAccountId}/video/${selectedVideoId}/comments?maxResults=50`
      : `/api/overseas/social/accounts/${selectedAccountId}/video/${selectedVideoId}/comments?maxResults=50`;
    fetchJson<{ comments?: YouTubeComment[] }>(url)
      .then(data => setComments(data.comments ?? []))
      .catch(() => setComments([]))
      .finally(() => setCommentsLoading(false));
  }, [selectedAccountId, selectedVideoId, currentPlatform]);

  const platforms = [
    { id: 'youtube' as const, label: 'YouTube', count: counts.youtube },
    { id: 'tiktok' as const, label: 'TikTok', count: counts.tiktok },
    { id: 'instagram' as const, label: 'Instagram', count: counts.instagram },
    { id: 'facebook' as const, label: 'Facebook', count: counts.facebook },
  ];

  return (
    <div className="flex flex-col h-full gap-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex gap-1 rounded-xl bg-gray-100 p-1">
          {platforms.map(p => (
            <button key={p.id} onClick={() => setPlatform(p.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${platform === p.id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800'}`}>
              {p.label}{p.count > 0 ? ` ${p.count}` : ''}
            </button>
          ))}
        </div>
        <button onClick={() => { void loadCounts(); void loadAccounts(currentPlatform); }} disabled={accountsLoading}
          title="刷新频道总览"
          className="p-2 rounded-lg border border-gray-200 text-gray-500 hover:text-gray-900 disabled:opacity-50">
          <RefreshCw size={14} className={accountsLoading ? 'animate-spin' : ''} />
        </button>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">
          <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {accountsLoading ? (
        <div className="flex items-center gap-2 text-sm text-gray-400 py-12 justify-center">
          <Loader2 size={16} className="animate-spin" /> 正在读取频道账号...
        </div>
      ) : accounts.length === 0 ? (
        <div className="flex-1 grid place-items-center rounded-xl border border-dashed border-gray-200 bg-gray-50">
          <div className="text-center">
            <TvMinimalPlay size={34} className="mx-auto mb-2 text-gray-300" />
            <p className="text-sm font-semibold text-gray-800">还没有已授权的 {platforms.find(p => p.id === currentPlatform)?.label} 账号</p>
            <p className="mt-1 text-xs text-gray-400">请先在「账号配置 - 一键授权」连接账号。</p>
          </div>
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 gap-5" style={{ gridTemplateColumns: '260px minmax(0, 1fr)' }}>
          <aside className="min-h-0 overflow-y-auto border border-gray-200 rounded-xl p-3">
            <p className="px-1 pb-2 text-xs font-semibold text-gray-500">账号</p>
            <div className="space-y-2">
              {accounts.map(account => (
                <button key={account.id} onClick={() => setSelectedAccountId(account.id)}
                  className={`w-full flex items-center gap-3 rounded-lg border px-3 py-2 text-left ${selectedAccountId === account.id ? 'border-red-200 bg-red-50' : 'border-gray-100 hover:border-gray-200'}`}>
                  {account.avatarUrl ? (
                    <img src={account.avatarUrl} alt={account.title} className="w-9 h-9 rounded-lg object-cover flex-shrink-0" />
                  ) : (
                    <span className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={platformTone(account.platform)}>
                      <TvMinimalPlay size={16} />
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-gray-900">{account.title}</span>
                    <span className="block truncate text-[11px] text-gray-400">{account.handle || account.providerAccountId}</span>
                  </span>
                </button>
              ))}
            </div>
          </aside>

          <main className="min-w-0 min-h-0 flex flex-col gap-4">
            {selectedAccount && (
              <div className="border border-gray-200 rounded-xl p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">{selectedAccount.title}</p>
                    <p className="mt-1 text-xs text-gray-400 truncate">{selectedAccount.handle || selectedAccount.providerAccountId}</p>
                    {selectedAccount.parentPageName && <p className="mt-1 text-xs text-gray-400 truncate">Page: {selectedAccount.parentPageName}</p>}
                  </div>
                  {accountUrl(selectedAccount) && <a href={accountUrl(selectedAccount)} target="_blank" rel="noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:text-gray-900">
                    <ExternalLink size={12} /> {selectedAccount.platform === 'youtube' ? '打开频道' : '打开主页'}
                  </a>}
                </div>
                <div className="mt-4 grid grid-cols-3 gap-3">
                  <div className="rounded-lg bg-gray-50 px-3 py-2">
                    <p className="text-base font-bold text-gray-900">{compactNumber.format(selectedAccount.followerCount || 0)}</p>
                    <p className="text-[11px] text-gray-400">{selectedAccount.platform === 'youtube' ? '订阅' : '粉丝'}</p>
                  </div>
                  <div className="rounded-lg bg-gray-50 px-3 py-2">
                    <p className="text-base font-bold text-gray-900">{compactNumber.format(selectedAccount.videoCount || 0)}</p>
                    <p className="text-[11px] text-gray-400">视频</p>
                  </div>
                  <div className="rounded-lg bg-gray-50 px-3 py-2">
                    <p className="text-base font-bold text-gray-900">{compactNumber.format(selectedAccount.viewCount || 0)}</p>
                    <p className="text-[11px] text-gray-400">播放</p>
                  </div>
                </div>
              </div>
            )}

            <div className="grid min-h-0 flex-1 gap-4" style={{ gridTemplateColumns: 'minmax(0, 1.2fr) minmax(300px, 0.8fr)' }}>
              <section className="min-h-0 overflow-y-auto border border-gray-200 rounded-xl p-3">
                <div className="flex items-center justify-between px-1 pb-3">
                  <p className="text-xs font-semibold text-gray-500">视频</p>
                  {videos.length > 0 && <span className="text-[11px] text-gray-400">最近 {videos.length} 条</span>}
                </div>
                {videosLoading ? (
                  <div className="flex items-center gap-2 text-sm text-gray-400 py-10 justify-center">
                    <Loader2 size={16} className="animate-spin" /> 正在读取视频...
                  </div>
                ) : videos.length === 0 ? (
                  <div className="py-16 text-center text-sm text-gray-400">暂无视频</div>
                ) : (
                  <div className="space-y-2">
                    {videos.map(video => (
                      <button key={video.id} onClick={() => setSelectedVideoId(video.id)}
                        className={`w-full flex gap-3 rounded-lg border p-2 text-left ${selectedVideoId === video.id ? 'border-red-200 bg-red-50' : 'border-gray-100 hover:border-gray-200'}`}>
                        <img src={video.thumbnailUrl} alt={video.title} className="w-24 h-14 rounded-md object-cover bg-gray-100 flex-shrink-0" />
                        <span className="min-w-0 flex-1">
                          <span className="block line-clamp-2 text-sm font-semibold text-gray-900">{video.title}</span>
                          <span className="mt-2 flex items-center gap-3 text-[11px] text-gray-400">
                            <span className="inline-flex items-center gap-1"><Eye size={11} />{compactNumber.format(video.viewCount || 0)}</span>
                            <span className="inline-flex items-center gap-1"><MessageSquare size={11} />{compactNumber.format(video.commentCount || 0)}</span>
                            <span>{formatDate(video.publishedAt)}</span>
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </section>

              <section className="min-h-0 overflow-y-auto border border-gray-200 rounded-xl p-3">
                <div className="px-1 pb-3">
                  <p className="text-xs font-semibold text-gray-500">评论</p>
                  {selectedVideo && <p className="mt-1 line-clamp-1 text-[11px] text-gray-400">{selectedVideo.title}</p>}
                </div>
                {commentsLoading ? (
                  <div className="flex items-center gap-2 text-sm text-gray-400 py-10 justify-center">
                    <Loader2 size={16} className="animate-spin" /> 正在读取评论...
                  </div>
                ) : !selectedVideo ? (
                  <div className="py-16 text-center text-sm text-gray-400">请选择视频</div>
                ) : comments.length === 0 ? (
                  <div className="py-16 text-center text-sm text-gray-400">暂无评论</div>
                ) : (
                  <div className="space-y-3">
                    {comments.map(comment => (
                      <article key={comment.id} className="rounded-lg border border-gray-100 p-3">
                        <div className="flex items-center gap-2 mb-2">
                          {comment.authorProfileImageUrl ? (
                            <img src={comment.authorProfileImageUrl} alt={comment.authorName} className="w-7 h-7 rounded-full object-cover flex-shrink-0" />
                          ) : (
                            <span className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center text-xs font-semibold text-gray-500 flex-shrink-0">
                              {comment.authorName?.[0] ?? '?'}
                            </span>
                          )}
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-xs font-semibold text-gray-900">{comment.authorName}</p>
                            <p className="text-[10px] text-gray-400">{formatDate(comment.publishedAt)}</p>
                          </div>
                          {comment.likeCount > 0 && (
                            <span className="inline-flex items-center gap-1 text-[10px] text-gray-400">
                              <ThumbsUp size={10} /> {comment.likeCount}
                            </span>
                          )}
                        </div>
                        <p className="text-xs leading-relaxed text-gray-700">{comment.textDisplay}</p>
                      </article>
                    ))}
                  </div>
                )}
              </section>
            </div>
          </main>
        </div>
      )}
    </div>
  );
}

export function YouTubeContent() {
  return <ChannelOverview />;
}

// ── Full standalone page ───────────────────────────────────────────────────────
export default function YouTubeIntegrationPage() {
  return (
    <div className="flex flex-col h-full bg-white">
      <div className="px-8 pt-8 pb-4 border-b border-gray-100">
        <h1 className="text-xl font-semibold text-gray-900">频道总览</h1>
        <p className="text-sm text-gray-500 mt-0.5">多个平台账号的视频与评论数据</p>
      </div>
      <div className="flex-1 overflow-y-auto px-8 py-6">
        <ChannelOverview />
      </div>
    </div>
  );
}
