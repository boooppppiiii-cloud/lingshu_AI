import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Film, Info, Loader2, Play, RefreshCw, Users } from 'lucide-react';
import { authHeader } from '../lib/auth';

interface SocialAccount {
  id: string;
  platform: 'tiktok' | 'instagram' | 'facebook';
  title?: string;
  handle?: string;
  followerCount?: number;
  videoCount?: number;
  viewCount?: number;
  likeCount?: number;
  status?: string;
}

interface YouTubeAccount {
  id: string;
  channelTitle?: string;
  subscriberCount?: number;
  videoCount?: number;
  viewCount?: number;
  status?: string;
}

interface RealVideo {
  id: string;
  platform: string;
  account: string;
  title: string;
  publishedAt?: string;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  shareCount?: number;
  permalinkUrl?: string;
}

async function readJson<T>(url: string, fallback: T): Promise<T> {
  try {
    const res = await fetch(url, { headers: authHeader() });
    if (!res.ok) return fallback;
    return await res.json() as T;
  } catch {
    return fallback;
  }
}

function num(value: unknown): number {
  return Number(value || 0) || 0;
}

function compact(value: number): string {
  if (value >= 10000) return `${(value / 10000).toFixed(1)}万`;
  return value.toLocaleString();
}

function normalizeVideo(raw: any, platform: string, account: string): RealVideo {
  return {
    id: `${platform}-${String(raw.id || raw.videoId || Math.random())}`,
    platform,
    account,
    title: String(raw.title || raw.description || raw.snippet?.title || `${platform} video`),
    publishedAt: String(raw.publishedAt || raw.created_time || raw.snippet?.publishedAt || ''),
    viewCount: num(raw.viewCount || raw.statistics?.viewCount),
    likeCount: num(raw.likeCount || raw.statistics?.likeCount),
    commentCount: num(raw.commentCount || raw.statistics?.commentCount),
    shareCount: num(raw.shareCount),
    permalinkUrl: String(raw.permalinkUrl || raw.shareUrl || raw.share_url || raw.url || ''),
  };
}

export default function TrafficDataBoard(_props: { windowDays?: number }) {
  const [socialAccounts, setSocialAccounts] = useState<SocialAccount[]>([]);
  const [youtubeAccounts, setYoutubeAccounts] = useState<YouTubeAccount[]>([]);
  const [videos, setVideos] = useState<RealVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    (async () => {
      const [social, youtube] = await Promise.all([
        readJson<{ items?: SocialAccount[] }>('/api/overseas/social/accounts', { items: [] }),
        readJson<{ items?: YouTubeAccount[] }>('/api/overseas/youtube/accounts', { items: [] }),
      ]);
      const socialItems = social.items ?? [];
      const youtubeItems = youtube.items ?? [];
      const videoResults = await Promise.allSettled([
        ...socialItems.map(async account => {
          const data = await readJson<{ videos?: any[] }>(`/api/overseas/social/accounts/${account.id}/videos?maxResults=50`, { videos: [] });
          return (data.videos ?? []).map(video => normalizeVideo(video, account.platform, account.title || account.handle || account.platform));
        }),
        ...youtubeItems.map(async account => {
          const data = await readJson<{ videos?: any[] }>(`/api/overseas/youtube/accounts/${account.id}/videos?maxResults=50`, { videos: [] });
          return (data.videos ?? []).map(video => normalizeVideo(video, 'youtube', account.channelTitle || 'YouTube'));
        }),
      ]);
      const nextVideos = videoResults.flatMap(result => result.status === 'fulfilled' ? result.value : []);
      if (!alive) return;
      setSocialAccounts(socialItems);
      setYoutubeAccounts(youtubeItems);
      setVideos(nextVideos.sort((a, b) => Date.parse(b.publishedAt || '') - Date.parse(a.publishedAt || '')));
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [refreshKey]);

  const summary = useMemo(() => {
    const accountCount = socialAccounts.length + youtubeAccounts.length;
    return {
      accountCount,
      videoCount: videos.length,
      views: videos.reduce((sum, item) => sum + item.viewCount, 0),
      interactions: videos.reduce((sum, item) => sum + item.likeCount + item.commentCount + num(item.shareCount), 0),
    };
  }, [socialAccounts.length, videos, youtubeAccounts.length]);

  const accounts = [
    ...socialAccounts.map(account => ({
      id: account.id,
      platform: account.platform,
      name: account.title || account.handle || account.platform,
      followers: num(account.followerCount),
      videos: num(account.videoCount),
      views: num(account.viewCount),
      status: account.status || 'connected',
    })),
    ...youtubeAccounts.map(account => ({
      id: account.id,
      platform: 'youtube',
      name: account.channelTitle || 'YouTube',
      followers: num(account.subscriberCount),
      videos: num(account.videoCount),
      views: num(account.viewCount),
      status: account.status || 'connected',
    })),
  ];

  return (
    <div className="h-full overflow-y-auto px-6 py-5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <p className="text-sm font-bold text-text-primary">社媒真实数据</p>
          <p className="mt-1 text-xs text-text-muted">仅展示已授权账号和平台接口返回的视频数据。</p>
        </div>
        <button type="button" onClick={() => setRefreshKey(v => v + 1)} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-text-secondary hover:text-text-primary">
          <RefreshCw size={12} />刷新
        </button>
      </div>

      {loading ? (
        <div className="flex h-48 items-center justify-center gap-2 text-sm text-text-muted"><Loader2 size={16} className="animate-spin" />读取真实社媒数据...</div>
      ) : accounts.length === 0 ? (
        <EmptyState text="暂无已授权社媒账号。接入 TikTok / Instagram / Facebook / YouTube 后，这里才会展示真实数据。" />
      ) : (
        <>
          <div className="mb-4 grid gap-3 md:grid-cols-4">
            <StatCard label="已授权账号" value={compact(summary.accountCount)} icon={<Users size={14} />} />
            <StatCard label="可读取视频" value={compact(summary.videoCount)} icon={<Film size={14} />} />
            <StatCard label="视频播放" value={compact(summary.views)} icon={<Play size={14} />} />
            <StatCard label="互动合计" value={compact(summary.interactions)} icon={<Info size={14} />} />
          </div>

          <section className="mb-4 rounded-xl border border-border bg-white p-4">
            <p className="mb-3 text-sm font-bold text-text-primary">已接入账号</p>
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {accounts.map(account => (
                <div key={`${account.platform}-${account.id}`} className="rounded-lg border border-border bg-surface px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-semibold text-text-primary">{account.name}</p>
                    <span className="rounded bg-green-50 px-2 py-0.5 text-[10px] font-bold text-green-700">{account.platform}</span>
                  </div>
                  <p className="mt-1 text-xs text-text-muted">粉丝/订阅 {compact(account.followers)} · 视频 {compact(account.videos)} · 累计播放 {compact(account.views)}</p>
                </div>
              ))}
            </div>
          </section>

          {videos.length > 0 ? (
            <section className="rounded-xl border border-border bg-white">
              <div className="border-b border-border px-4 py-3">
                <p className="text-sm font-bold text-text-primary">真实视频明细</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-surface-2 text-text-secondary">
                    <tr>
                      {['平台', '账号', '内容', '播放', '点赞', '评论', '发布时间'].map(head => <th key={head} className="px-3 py-2 text-left font-semibold">{head}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {videos.map(video => (
                      <tr key={video.id} className="border-t border-border">
                        <td className="px-3 py-2">{video.platform}</td>
                        <td className="px-3 py-2">{video.account}</td>
                        <td className="max-w-[320px] truncate px-3 py-2" title={video.title}>{video.permalinkUrl ? <a href={video.permalinkUrl} target="_blank" rel="noreferrer" className="text-accent hover:underline">{video.title}</a> : video.title}</td>
                        <td className="px-3 py-2">{compact(video.viewCount)}</td>
                        <td className="px-3 py-2">{compact(video.likeCount)}</td>
                        <td className="px-3 py-2">{compact(video.commentCount)}</td>
                        <td className="px-3 py-2 text-text-muted">{video.publishedAt ? new Date(video.publishedAt).toLocaleDateString() : '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : (
            <EmptyState text="已找到授权账号，但当前接口没有返回可展示的视频数据。" />
          )}
        </>
      )}

      <p className="mt-4 flex items-center gap-1.5 text-[11px] text-text-muted">
        <Info size={12} /> 已删除完播率、ROAS、内容基因等暂无真实来源的组件。
      </p>
    </div>
  );
}

function StatCard({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-white p-3">
      <div className="flex items-center gap-2 text-green-700">{icon}<span className="text-xs font-semibold text-text-secondary">{label}</span></div>
      <p className="mt-2 text-2xl font-bold leading-none text-text-primary">{value}</p>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-surface p-6 text-sm text-text-muted">
      <div className="flex items-start gap-2"><AlertCircle size={16} className="mt-0.5 text-text-muted" /><p>{text}</p></div>
    </div>
  );
}
