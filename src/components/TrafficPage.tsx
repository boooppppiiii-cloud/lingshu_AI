import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  Film,
  Loader2,
  MessageCircle,
  PlayCircle,
  RefreshCw,
  Repeat2,
  Send,
  ShieldCheck,
  Wand2,
  Zap,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import InspirationDashboard from './InspirationDashboard';
import AiCreateStudio from './AiCreateStudio';
import { ChannelOverview } from './YouTubeIntegration';
import { CalendarPlanner, type CalendarPost } from './publishing/CalendarPlanner';
import type { ConversationContext, Page, RestoreSignal, KickoffSignal, AgentAction } from '../App';
import { authHeader } from '../lib/auth';

type ViewMode = 'calendar' | 'materials' | 'create' | 'publish' | 'effects' | 'recycle' | 'accounts';
type PublishPlatform = 'youtube' | 'tiktok' | 'instagram' | 'facebook';

type PublishDraft = {
  videoPath?: string;
  title: string;
  description: string;
  ratio?: string;
  sourceProjectId?: string;
};

type PublishAccount = {
  id: string;
  platform: PublishPlatform;
  title: string;
  handle?: string;
  status: 'connected' | 'error' | 'expired';
  avatarUrl?: string;
};

type PlatformCopy = {
  title?: string;
  description?: string;
  caption?: string;
  text?: string;
  tags?: string[];
  hashtags?: string[];
  firstComment?: string;
};

type PublishingEffectPost = {
  id: string;
  platform: string;
  title: string;
  publishedAt: string;
  trackCode: string;
  waLink: string;
  stats: { views?: number; likes?: number; comments?: number; status?: string };
  inquiries: number;
  deals: number;
};

type RecycleList = {
  id: string;
  name: string;
  enabled?: boolean;
  items?: Array<{ contentId: string; title?: string; paused?: boolean }>;
  slots?: Array<{ weekday: number; time: string; platforms: string[] }>;
  refresh_mode?: 'copy' | 'copy_cover' | 'copy_cover_hook';
  cursor?: number;
};

interface Props {
  onEnterConversation: (ctx: ConversationContext) => void;
  onLeaveConversation: () => void;
  isInConversation: boolean;
  onNavigate?: (p: Page) => void;
  restore?: RestoreSignal;
  kickoff?: KickoffSignal;
  onAction?: AgentAction;
  onScriptPanelOpen?: () => void;
  onScriptPanelClose?: () => void;
  onSessionRefresh?: () => void;
}

const PLATFORM_META: Record<PublishPlatform, { label: string; short: string; color: string; format: string }> = {
  youtube: { label: 'YouTube', short: 'YT', color: '#ff0000', format: 'Shorts / Video' },
  tiktok: { label: 'TikTok', short: 'TK', color: '#111827', format: '9:16 短视频' },
  instagram: { label: 'Instagram', short: 'IG', color: '#c13584', format: 'Reels' },
  facebook: { label: 'Facebook', short: 'FB', color: '#1877f2', format: 'Reels / Page Video' },
};

const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { ...authHeader(), ...(init?.headers ?? {}) } });
  const data = await response.json().catch(() => ({})) as T & { error?: string; message?: string };
  if (!response.ok) throw new Error(data.message || data.error || '请求失败');
  return data;
}

function platformBody(platform: PublishPlatform, copy?: PlatformCopy, fallback = '') {
  if (!copy) return fallback;
  if (platform === 'youtube') return copy.description || fallback;
  if (platform === 'facebook') return copy.text || fallback;
  return copy.caption || fallback;
}

function platformTitle(platform: PublishPlatform, copy?: PlatformCopy, fallback = '') {
  if (platform === 'youtube') return copy?.title || fallback;
  return fallback;
}

export default function TrafficPage({
  onNavigate,
  restore,
  kickoff,
  onScriptPanelOpen,
  onScriptPanelClose,
}: Props) {
  const [viewMode, setViewMode] = useState<ViewMode>('calendar');
  const [publishDraft, setPublishDraft] = useState<PublishDraft | null>(null);

  useEffect(() => {
    if (restore || kickoff) setViewMode('materials');
  }, [restore?.key, kickoff?.key]);

  useEffect(() => {
    if (localStorage.getItem('lingshu:traffic:source-post-id')) setViewMode('effects');
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ page?: Page; view?: ViewMode }>).detail;
      if (detail?.page === 'traffic' && detail.view) setViewMode(detail.view);
    };
    window.addEventListener('lingshu:navigate', handler);
    return () => window.removeEventListener('lingshu:navigate', handler);
  }, []);

  useEffect(() => {
    const contextByMode: Record<ViewMode, { label: string; summary: string; suggestions: string[] }> = {
      calendar: {
        label: '内容日历',
        summary: '当前在内容日历，适合安排发布时间、查看热力建议、复盘已发布内容带来的询盘。',
        suggestions: ['找一个适合发布的时间', '把爆款内容排进日历', '查看本周发布节奏', '解释询盘角标含义'],
      },
      materials: {
        label: '我的社媒',
        summary: '当前在社媒灵感大屏，适合拆解爆款内容、筛选素材方向、规划发布节奏。',
        suggestions: ['拆解当前素材方向', '规划本周发布节奏', '找出适合目标市场的内容角度', '把素材转成创作任务'],
      },
      create: {
        label: 'AI智能素材',
        summary: '当前在 AI 智能素材页，适合生成图文海报、短视频脚本、标题、口播钩子和发布文案。',
        suggestions: ['生成一套主推品素材', '把卖点改成外语口播', '设计 Facebook 图文文案', '优化视频开头 3 秒钩子'],
      },
      publish: {
        label: '账号一键发布',
        summary: '当前在账号一键发布页，适合检查授权账号、生成分平台文案包、确认首评和 WhatsApp 追踪链接。',
        suggestions: ['生成四个平台的差异化文案', '检查首评内容', '确认追踪链接', '排到建议时段发布'],
      },
      effects: {
        label: '内容效果',
        summary: '当前在内容询盘归因看板，适合复盘哪些发布带来了 WhatsApp 询盘和成交。',
        suggestions: ['找出带来询盘最多的内容', '总结高询盘内容共同点', '推荐下一条变体内容', '解释内容成交归因数据'],
      },
      recycle: {
        label: '保鲜循环',
        summary: '当前在循环列表，适合把成片加入自动保鲜队列，设置发布频次和改编档位。',
        suggestions: ['新建一个循环列表', '解释三种保鲜档位', '推荐循环发布时间', '检查防重复规则'],
      },
      accounts: {
        label: '账号流量数据',
        summary: '当前在账号流量数据看板，适合复盘各平台账号表现、找出增长趋势和下一轮内容优化方向。',
        suggestions: ['复盘账号流量表现', '找出上升最快的平台', '给我下周发布建议', '总结高表现内容规律'],
      },
    };
    window.dispatchEvent(new CustomEvent('lingshu-assistant-context', {
      detail: { agent: 'traffic', ...contextByMode[viewMode] },
    }));
  }, [viewMode]);

  const handleEnterWorkflow = (payload: unknown) => {
    try { localStorage.setItem('ow_video_kickoff', JSON.stringify(payload)); } catch { /* ignore */ }
    setViewMode('create');
  };

  const handleGoPublish = (draft: PublishDraft) => {
    setPublishDraft(draft);
    try { localStorage.setItem('ow_publish_draft', JSON.stringify(draft)); } catch { /* ignore */ }
    setViewMode('publish');
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 flex-shrink-0 items-center justify-between border-b border-border px-5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
            <Zap size={13} />
          </div>
          <span className="text-sm font-semibold text-text-primary">我的社媒</span>
        </div>
      </header>

      <div className="flex-shrink-0 border-b border-border bg-surface px-6 py-3">
        <div className="grid w-full grid-cols-7 gap-1.5 rounded-2xl border border-border bg-surface-2 p-1 shadow-sm">
          {[
            { mode: 'calendar' as ViewMode, icon: <CalendarDays size={18} />, label: '内容日历' },
            { mode: 'materials' as ViewMode, icon: <Film size={18} />, label: '灵感大屏' },
            { mode: 'create' as ViewMode, icon: <Wand2 size={18} />, label: 'AI智能素材' },
            { mode: 'publish' as ViewMode, icon: <Send size={18} />, label: '一键发布' },
            { mode: 'effects' as ViewMode, icon: <BarChart3 size={18} />, label: '内容效果' },
            { mode: 'recycle' as ViewMode, icon: <Repeat2 size={18} />, label: '保鲜循环' },
            { mode: 'accounts' as ViewMode, icon: <BarChart3 size={18} />, label: '账号数据' },
          ].map(({ mode, icon, label }) => {
            const active = viewMode === mode;
            return (
              <button
                key={mode}
                type="button"
                onClick={() => setViewMode(mode)}
                className={`flex h-10 items-center justify-center gap-2 rounded-xl px-3 text-sm font-black transition-all ${
                  active ? 'bg-white text-text-primary shadow-sm ring-1 ring-border' : 'text-text-muted hover:bg-white/60 hover:text-text-secondary'
                }`}
              >
                <span className={active ? 'text-accent' : 'text-text-muted'}>{icon}</span>
                <span className="min-w-0 truncate">{label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <main className="min-h-0 flex-1 overflow-hidden">
        <AnimatePresence mode="wait">
          {viewMode === 'calendar' ? (
            <motion.div key="calendar" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="h-full overflow-y-auto px-6 py-5">
              <CalendarPlanner
                onCreate={(date) => {
                  setPublishDraft({ title: `排期内容 ${date.toLocaleDateString()}`, description: '', videoPath: '' });
                  setViewMode('publish');
                }}
                onOpenPost={() => setViewMode('effects')}
              />
            </motion.div>
          ) : viewMode === 'materials' ? (
            <motion.div key="materials" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="h-full overflow-y-auto">
              <InspirationDashboard
                onScriptPanelOpen={onScriptPanelOpen}
                onScriptPanelClose={onScriptPanelClose}
                onNavigate={onNavigate}
                onEnterWorkflow={handleEnterWorkflow}
              />
            </motion.div>
          ) : viewMode === 'create' ? (
            <motion.div key="create" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="h-full">
              <AiCreateStudio onNavigate={onNavigate} onGoPublish={handleGoPublish} />
            </motion.div>
          ) : viewMode === 'publish' ? (
            <motion.div key="publish" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="h-full overflow-y-auto">
              <SocialPublishPanel onNavigate={onNavigate} draft={publishDraft} onOpenCalendar={() => setViewMode('calendar')} />
            </motion.div>
          ) : viewMode === 'effects' ? (
            <motion.div key="effects" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="h-full overflow-y-auto">
              <PublishingEffectsPanel onVariant={(post) => {
                setPublishDraft({ title: `${post.title} - 变体`, description: '', videoPath: '' });
                setViewMode('publish');
              }} />
            </motion.div>
          ) : viewMode === 'recycle' ? (
            <motion.div key="recycle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="h-full overflow-y-auto">
              <RecycleListsPanel />
            </motion.div>
          ) : (
            <motion.div key="accounts" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="h-full overflow-y-auto px-6 py-5">
              <ChannelOverview />
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}

function SocialPublishPanel({ onNavigate, draft, onOpenCalendar }: { onNavigate?: (p: Page) => void; draft?: PublishDraft | null; onOpenCalendar: () => void }) {
  const [accounts, setAccounts] = useState<PublishAccount[]>([]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [platformCopy, setPlatformCopy] = useState<Record<string, PlatformCopy>>({});
  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [adapting, setAdapting] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [videoPath, setVideoPath] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [firstComment, setFirstComment] = useState('');
  const [trackWaLink, setTrackWaLink] = useState(true);

  const connectedAccounts = accounts.filter(account => account.status === 'connected');
  const selectedConnectedAccounts = connectedAccounts.filter(account => selected.has(account.id));
  const selectedPlatforms = Array.from(new Set(selectedConnectedAccounts.map(account => account.platform)));

  const loadAccounts = async () => {
    setLoading(true);
    setError('');
    try {
      const [youtube, tiktok, instagram, facebook] = await Promise.all([
        fetchJson<{ items?: Array<{ id: string; channelTitle: string; status: PublishAccount['status']; thumbnailUrl?: string }> }>('/api/overseas/youtube/accounts'),
        fetchJson<{ items?: Array<{ id: string; title: string; handle?: string; status: PublishAccount['status']; avatarUrl?: string }> }>('/api/overseas/social/accounts?platform=tiktok'),
        fetchJson<{ items?: Array<{ id: string; title: string; handle?: string; status: PublishAccount['status']; avatarUrl?: string }> }>('/api/overseas/social/accounts?platform=instagram'),
        fetchJson<{ items?: Array<{ id: string; title: string; handle?: string; status: PublishAccount['status']; avatarUrl?: string }> }>('/api/overseas/social/accounts?platform=facebook'),
      ]);
      const next: PublishAccount[] = [
        ...(youtube.items ?? []).map(account => ({ id: account.id, platform: 'youtube' as const, title: account.channelTitle, handle: account.channelTitle, status: account.status, avatarUrl: account.thumbnailUrl })),
        ...(tiktok.items ?? []).map(account => ({ id: account.id, platform: 'tiktok' as const, title: account.title, handle: account.handle, status: account.status, avatarUrl: account.avatarUrl })),
        ...(instagram.items ?? []).map(account => ({ id: account.id, platform: 'instagram' as const, title: account.title, handle: account.handle, status: account.status, avatarUrl: account.avatarUrl })),
        ...(facebook.items ?? []).map(account => ({ id: account.id, platform: 'facebook' as const, title: account.title, handle: account.handle, status: account.status, avatarUrl: account.avatarUrl })),
      ];
      setAccounts(next);
      setSelected(new Set(next.filter(account => account.status === 'connected').map(account => account.id)));
    } catch (e) {
      setError(e instanceof Error ? e.message : '无法读取授权账号');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadAccounts(); }, []);

  useEffect(() => {
    let nextDraft = draft;
    if (!nextDraft) {
      try {
        nextDraft = JSON.parse(localStorage.getItem('ow_publish_draft') || 'null') as PublishDraft | null;
      } catch {
        nextDraft = null;
      }
    }
    if (!nextDraft) return;
    setVideoPath(nextDraft.videoPath || '');
    setTitle(nextDraft.title || '');
    setDescription(nextDraft.description || '');
  }, [draft]);

  const toggle = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const adaptCopy = async (platform?: PublishPlatform) => {
    const platforms = platform ? [platform] : selectedPlatforms;
    if (!platforms.length) {
      setError('请先选择至少一个发布账号');
      return;
    }
    setAdapting(true);
    setError('');
    try {
      const data = await fetchJson<{ copy: Record<string, PlatformCopy> }>('/api/overseas/publishing/adapt-copy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, description, platforms, language: 'English' }),
      });
      setPlatformCopy(prev => ({ ...prev, ...data.copy }));
      const first = platforms[0];
      if (data.copy[first]?.firstComment) setFirstComment(data.copy[first].firstComment || '');
    } catch (e) {
      setError(e instanceof Error ? e.message : '生成平台文案失败');
    } finally {
      setAdapting(false);
    }
  };

  const publish = async () => {
    const targets = selectedConnectedAccounts;
    if (!targets.length) {
      setError('请先选择至少一个已授权账号');
      return;
    }
    if (!title.trim()) {
      setError('请填写发布标题');
      return;
    }
    if (!videoPath.trim()) {
      setError('请填写本地成片视频路径');
      return;
    }
    setPublishing(true);
    setNotice('');
    setError('');
    const failures: string[] = [];
    for (const account of targets) {
      const meta = PLATFORM_META[account.platform];
      const copy = platformCopy[account.platform];
      try {
        const url = account.platform === 'youtube'
          ? `/api/overseas/youtube/accounts/${account.id}/upload`
          : `/api/overseas/social/accounts/${account.id}/upload`;
        const publishResult = await fetchJson<{ ok: boolean; video?: unknown; tracking?: unknown }>(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            videoPath: videoPath.trim(),
            title: platformTitle(account.platform, copy, title.trim()),
            description: platformBody(account.platform, copy, description.trim()),
            firstComment: copy?.firstComment || firstComment,
            trackWaLink,
            privacyStatus: 'public',
            madeForKids: false,
          }),
        });
        if (draft?.sourceProjectId) {
          await fetch('/api/overseas/studio/publish-links', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeader() },
            body: JSON.stringify({
              projectId: draft.sourceProjectId,
              accountId: account.id,
              platform: account.platform,
              title: title.trim(),
              publishResult,
            }),
          });
        }
      } catch (e) {
        failures.push(`${meta.label}: ${e instanceof Error ? e.message : '发布失败'}`);
      }
    }
    setPublishing(false);
    if (failures.length) {
      setError(failures.join('；'));
      return;
    }
    setNotice(`已提交 ${targets.length} 个账号发布。每条发布都会生成独立追踪码，可在内容效果里查看询盘。`);
  };

  const previewRatio = draft?.ratio || (selectedPlatforms.length > 0 && selectedPlatforms.every(platform => platform === 'youtube') ? '16:9' : '9:16');

  return (
    <div className="px-6 py-5">
      <div className="mx-auto max-w-6xl space-y-5">
        <section className="rounded-2xl border border-border bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent-glow text-accent">
                  <Send size={16} />
                </span>
                <div>
                  <p className="text-xs font-semibold text-text-muted">账号一键发布</p>
                  <h2 className="text-lg font-bold text-text-primary">生成分平台文案包，发布后自动归因询盘</h2>
                </div>
              </div>
              <p className="mt-2 text-sm text-text-muted">
                选择成片和账号后，系统会为各平台生成不同文案，并自动附带 WhatsApp 追踪链接。首评失败不会影响主发布。
              </p>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => void loadAccounts()} disabled={loading} className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border text-text-muted hover:text-text-primary disabled:opacity-50">
                <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              </button>
              <button type="button" onClick={() => onNavigate?.('channels')} className="rounded-lg border border-border px-3 py-2 text-xs font-semibold text-text-secondary hover:border-accent hover:text-accent">
                管理账号授权
              </button>
            </div>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-4">
            {loading ? (
              <div className="col-span-full flex items-center justify-center gap-2 rounded-xl border border-border bg-surface py-10 text-sm text-text-muted">
                <Loader2 size={16} className="animate-spin" /> 正在读取已授权账号...
              </div>
            ) : accounts.length === 0 ? (
              <div className="col-span-full rounded-xl border border-dashed border-border bg-surface px-4 py-8 text-center">
                <p className="text-sm font-bold text-text-primary">还没有可发布账号</p>
                <p className="mt-1 text-xs text-text-muted">请先进入集成中心完成 YouTube / TikTok / Instagram / Facebook 授权。</p>
              </div>
            ) : accounts.map(account => {
              const meta = PLATFORM_META[account.platform];
              const active = selected.has(account.id);
              return (
                <button key={account.id} type="button" onClick={() => toggle(account.id)} className={`rounded-2xl border p-4 text-left transition-all ${active ? 'border-accent bg-accent-glow shadow-sm' : 'border-border bg-surface hover:border-border-bright'}`}>
                  <div className="flex items-center justify-between gap-3">
                    {account.avatarUrl ? (
                      <img src={account.avatarUrl} alt={account.title} className="h-10 w-10 rounded-xl object-cover" />
                    ) : (
                      <span className="flex h-10 w-10 items-center justify-center rounded-xl text-white" style={{ background: meta.color }}>
                        <PlayCircle size={18} />
                      </span>
                    )}
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${account.status === 'connected' ? 'bg-green-50 text-green-700' : 'bg-slate-100 text-text-muted'}`}>
                      {account.status === 'connected' ? '可发布' : '需重新授权'}
                    </span>
                  </div>
                  <p className="mt-3 text-sm font-bold text-text-primary">{meta.label} <span className="text-xs text-text-muted">({meta.short})</span></p>
                  <p className="mt-1 truncate text-xs font-semibold text-text-secondary">{account.handle || account.title}</p>
                  <p className="mt-2 text-xs text-text-muted">{meta.format}</p>
                </button>
              );
            })}
          </div>
        </section>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
          <section className="space-y-5">
            <div className="rounded-2xl border border-border bg-white p-5 shadow-sm">
              <h3 className="text-sm font-bold text-text-primary">发布内容</h3>
              <div className="mt-4 space-y-3">
                <label className="block">
                  <span className="mb-1.5 block text-[11px] font-semibold text-text-secondary">本地视频路径</span>
                  <input value={videoPath} onChange={event => setVideoPath(event.target.value)} placeholder="/Users/.../rendered-video.mp4" className="w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm outline-none focus:border-accent" />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-[11px] font-semibold text-text-secondary">基础标题</span>
                  <input value={title} onChange={event => setTitle(event.target.value)} placeholder="发布标题" className="w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm outline-none focus:border-accent" />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-[11px] font-semibold text-text-secondary">基础文案</span>
                  <textarea value={description} onChange={event => setDescription(event.target.value)} rows={5} placeholder="输入卖点、脚本摘要和 hashtag" className="w-full resize-none rounded-xl border border-border bg-surface px-3 py-2.5 text-sm outline-none focus:border-accent" />
                </label>
                <div className="rounded-xl border border-emerald-100 bg-emerald-50/80 p-3">
                  <label className="flex cursor-pointer items-start gap-3">
                    <input type="checkbox" checked={trackWaLink} onChange={event => setTrackWaLink(event.target.checked)} className="mt-1 h-4 w-4 rounded border-border text-accent" />
                    <span>
                      <span className="block text-xs font-black text-emerald-900">已附带 WhatsApp 询盘链接</span>
                      <span className="mt-1 block text-[11px] leading-5 text-emerald-800">发布时自动生成短追踪码。买家首条消息带码后，客户来源会精确归因到这条内容。</span>
                    </span>
                  </label>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-border bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-bold text-text-primary">分平台改编预览</h3>
                  <p className="mt-1 text-xs text-text-muted">每个平台文案互不相同，单卡可换一版。</p>
                </div>
                <button type="button" onClick={() => void adaptCopy()} disabled={adapting || selectedPlatforms.length === 0} className="inline-flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-xs font-bold text-white disabled:opacity-50">
                  {adapting ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
                  一键生成
                </button>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {(selectedPlatforms.length ? selectedPlatforms : (['youtube', 'tiktok', 'instagram', 'facebook'] as PublishPlatform[])).map(platform => {
                  const meta = PLATFORM_META[platform];
                  const copy = platformCopy[platform];
                  const body = platformBody(platform, copy, description);
                  return (
                    <div key={platform} className="rounded-2xl border border-border bg-surface p-4">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-black text-text-primary">{meta.label}</span>
                        <button type="button" onClick={() => void adaptCopy(platform)} className="rounded-lg border border-border px-2 py-1 text-[11px] font-bold text-text-secondary hover:border-accent hover:text-accent">换一版</button>
                      </div>
                      {platform === 'youtube' && (
                        <input value={platformTitle(platform, copy, title)} onChange={event => setPlatformCopy(prev => ({ ...prev, [platform]: { ...prev[platform], title: event.target.value } }))} className="mt-3 w-full rounded-lg border border-border bg-white px-3 py-2 text-xs outline-none focus:border-accent" />
                      )}
                      <textarea value={body} onChange={event => setPlatformCopy(prev => ({ ...prev, [platform]: { ...prev[platform], ...(platform === 'facebook' ? { text: event.target.value } : platform === 'youtube' ? { description: event.target.value } : { caption: event.target.value }) } }))} rows={4} className="mt-3 w-full resize-none rounded-lg border border-border bg-white px-3 py-2 text-xs outline-none focus:border-accent" />
                      <div className="mt-2 flex items-center justify-between text-[11px] text-text-muted">
                        <span>{body.length} 字符</span>
                        <span>{platform === 'tiktok' && body.length > 120 ? '超出建议长度' : '长度正常'}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>

          <aside className="rounded-2xl border border-border bg-white p-5 shadow-sm">
            <h3 className="text-sm font-bold text-text-primary">发布设置</h3>
            <div className="mt-4 rounded-2xl border border-border bg-surface p-3">
              <div className="mb-3 flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-text-primary">发布预览</span>
                <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-bold text-accent shadow-sm">{previewRatio}</span>
              </div>
              <div className="flex justify-center">
                <div className="relative w-full overflow-hidden rounded-xl border border-border bg-white shadow-inner" style={{ aspectRatio: previewRatio === '16:9' ? '16 / 9' : '9 / 16', maxWidth: previewRatio === '16:9' ? 260 : 150 }}>
                  <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(22,163,74,0.12),rgba(15,23,42,0.04))]" />
                  <PlayCircle size={22} className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-accent" />
                </div>
              </div>
            </div>

            <label className="mt-4 block">
              <span className="mb-1.5 block text-[11px] font-semibold text-text-secondary">首条评论</span>
              <textarea value={firstComment} onChange={event => setFirstComment(event.target.value)} rows={4} placeholder="hashtags、wa.me 链接或补充说明。平台不支持时会记录 warning。" className="w-full resize-none rounded-xl border border-border bg-surface px-3 py-2.5 text-xs outline-none focus:border-accent" />
            </label>

            <div className="mt-5 rounded-xl border border-green-100 bg-green-50 p-3">
              <div className="flex items-center gap-2 text-xs font-bold text-green-700">
                <ShieldCheck size={14} />
                发布前检查
              </div>
              <ul className="mt-2 space-y-1 text-[11px] leading-relaxed text-green-800">
                <li>已选择 {selectedPlatforms.length} 个发布平台</li>
                <li>WhatsApp 追踪链接：{trackWaLink ? '开启' : '关闭'}</li>
                <li>首评失败不影响主发布，发布详情会显示 warning</li>
              </ul>
            </div>

            {notice && <div className="mt-4 flex items-start gap-2 rounded-xl border border-green-100 bg-green-50 px-3 py-2 text-xs text-green-700"><CheckCircle2 size={14} className="mt-0.5 flex-shrink-0" /><span>{notice}</span></div>}
            {error && <div className="mt-4 flex items-start gap-2 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-600"><AlertCircle size={14} className="mt-0.5 flex-shrink-0" /><span>{error}</span></div>}

            <button type="button" onClick={() => void publish()} disabled={publishing || loading} className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3 text-sm font-bold text-white shadow-sm hover:brightness-95 disabled:opacity-50">
              {publishing ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
              {publishing ? '发布中...' : '确认发布'}
            </button>
            <button type="button" onClick={onOpenCalendar} className="mt-2 w-full rounded-xl border border-border px-4 py-3 text-sm font-bold text-text-secondary hover:border-accent hover:text-accent">
              回到内容日历
            </button>
          </aside>
        </div>
      </div>
    </div>
  );
}

function PublishingEffectsPanel({ onVariant }: { onVariant: (post: PublishingEffectPost) => void }) {
  const [items, setItems] = useState<PublishingEffectPost[]>([]);
  const [summary, setSummary] = useState({ posts30d: 0, inquiries30d: 0, deals30d: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await fetchJson<{ items?: PublishingEffectPost[]; summary?: typeof summary }>('/api/overseas/publishing/posts/effects');
      setItems(data.items || []);
      setSummary(data.summary || { posts30d: 0, inquiries30d: 0, deals30d: 0 });
    } catch (e) {
      setError(e instanceof Error ? e.message : '无法读取内容效果数据');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const threshold = useMemo(() => {
    const sorted = [...items].sort((a, b) => b.inquiries - a.inquiries);
    return sorted[Math.max(0, Math.floor(sorted.length * 0.2) - 1)]?.inquiries || 1;
  }, [items]);

  return (
    <div className="px-6 py-5">
      <div className="mx-auto max-w-6xl space-y-5">
        <section className="rounded-2xl border border-border bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold text-text-muted">内容到询盘归因</p>
              <h2 className="text-lg font-bold text-text-primary">哪些内容真的带来了客户</h2>
            </div>
            <button type="button" onClick={() => void load()} className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs font-bold text-text-secondary hover:border-accent hover:text-accent">
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> 刷新
            </button>
          </div>
          <div className="mt-5 grid gap-3 md:grid-cols-3">
            {[
              ['近30天发布', summary.posts30d],
              ['带来询盘', summary.inquiries30d],
              ['归因成交', summary.deals30d],
            ].map(([label, value]) => (
              <div key={label} className="rounded-2xl border border-border bg-surface p-4">
                <p className="text-xs font-bold text-text-muted">{label}</p>
                <p className="mt-2 text-2xl font-black text-text-primary">{value}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-border bg-white shadow-sm">
          <div className="border-b border-border px-5 py-4">
            <h3 className="text-sm font-bold text-text-primary">发布明细</h3>
            <p className="mt-1 text-xs text-text-muted">默认按询盘数排序。高询盘内容可以直接做变体再发。</p>
          </div>
          {error && <div className="m-5 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-600">{error}</div>}
          {notice && <div className="m-5 rounded-xl border border-green-100 bg-green-50 px-3 py-2 text-xs text-green-700">{notice}</div>}
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-text-muted"><Loader2 size={16} className="animate-spin" /> 正在读取...</div>
          ) : items.length === 0 ? (
            <div className="py-16 text-center">
              <p className="text-sm font-bold text-text-primary">还没有可归因的发布记录</p>
              <p className="mt-1 text-xs text-text-muted">发布内容时保持“附带 WhatsApp 询盘链接”开启，这里就会出现询盘和成交数据。</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="bg-surface text-xs font-bold text-text-muted">
                  <tr>
                    <th className="px-5 py-3">内容</th>
                    <th className="px-4 py-3">平台</th>
                    <th className="px-4 py-3">播放/互动</th>
                    <th className="px-4 py-3">询盘数</th>
                    <th className="px-4 py-3">成交数</th>
                    <th className="px-4 py-3">追踪码</th>
                    <th className="px-5 py-3 text-right">动作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {items.map(item => {
                    const hot = item.inquiries >= threshold && item.inquiries > 0;
                    return (
                      <tr key={item.id} className="hover:bg-surface/60">
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-3">
                            <div className="flex h-12 w-16 items-center justify-center rounded-xl bg-surface-2 text-accent"><PlayCircle size={18} /></div>
                            <div className="min-w-0">
                              <p className="truncate font-bold text-text-primary">{item.title || '未命名发布'}</p>
                              <p className="mt-1 text-xs text-text-muted">{item.publishedAt ? new Date(item.publishedAt).toLocaleString() : '待发布'}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-4 font-bold text-text-secondary">{item.platform}</td>
                        <td className="px-4 py-4 text-xs text-text-muted">{Number(item.stats?.views || 0).toLocaleString()} 播放 · {Number(item.stats?.likes || 0).toLocaleString()} 赞</td>
                        <td className="px-4 py-4 text-base font-black text-primary">{item.inquiries}</td>
                        <td className="px-4 py-4 text-base font-black text-emerald-600">{item.deals}</td>
                        <td className="px-4 py-4"><span className="rounded-full bg-surface-2 px-2 py-1 text-xs font-bold text-text-secondary">#{item.trackCode}</span></td>
                        <td className="px-5 py-4 text-right">
                          <button
                            type="button"
                            onClick={() => hot ? onVariant(item) : setNotice('这条内容还没进入前 20% 表现，建议先观察。')}
                            className={`rounded-lg px-3 py-1.5 text-xs font-bold ${hot ? 'border border-accent text-accent hover:bg-accent-glow' : 'border border-border text-text-muted'}`}
                          >
                            AI 做个变体再发
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function RecycleListsPanel() {
  const [items, setItems] = useState<RecycleList[]>([]);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState('');
  const [name, setName] = useState('主推品保鲜循环');
  const [mode, setMode] = useState<'copy' | 'copy_cover' | 'copy_cover_hook'>('copy');

  const load = async () => {
    setLoading(true);
    try {
      const data = await fetchJson<{ items?: RecycleList[] }>('/api/overseas/publishing/recycle-lists');
      setItems(data.items || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const create = async () => {
    const data = await fetchJson<{ item: RecycleList }>('/api/overseas/publishing/recycle-lists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        enabled: false,
        refreshMode: mode,
        items: [],
        slots: [{ weekday: 1, time: '10:00', platforms: ['tiktok', 'instagram'] }],
      }),
    });
    setItems(prev => [data.item, ...prev]);
    setNotice('循环列表已创建。添加成片后即可开启。');
  };

  const toggle = async (item: RecycleList) => {
    const data = await fetchJson<{ item: RecycleList }>(`/api/overseas/publishing/recycle-lists/${item.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !item.enabled }),
    });
    setItems(prev => prev.map(row => row.id === item.id ? data.item : row));
  };

  return (
    <div className="px-6 py-5">
      <div className="mx-auto max-w-5xl space-y-5">
        <section className="rounded-2xl border border-border bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-50 text-sky-700"><Repeat2 size={18} /></span>
            <div>
              <h2 className="text-lg font-black text-text-primary">保鲜循环</h2>
              <p className="text-xs text-text-muted">把成片放进循环列表，到点自动改编发布，并生成新的 WhatsApp 追踪码。</p>
            </div>
          </div>
          <div className="mt-5 grid gap-3 md:grid-cols-[1fr_220px_120px]">
            <input value={name} onChange={event => setName(event.target.value)} className="rounded-xl border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent" />
            <select value={mode} onChange={event => setMode(event.target.value as typeof mode)} className="rounded-xl border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent">
              <option value="copy">只改文案</option>
              <option value="copy_cover">改文案 + 封面</option>
              <option value="copy_cover_hook">改文案 + 封面 + 开头3秒</option>
            </select>
            <button type="button" onClick={() => void create()} className="rounded-xl bg-accent px-4 py-2 text-sm font-bold text-white">新建</button>
          </div>
          {notice && <p className="mt-3 rounded-xl border border-green-100 bg-green-50 px-3 py-2 text-xs text-green-700">{notice}</p>}
        </section>

        <section className="rounded-2xl border border-border bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <h3 className="text-sm font-bold text-text-primary">循环列表</h3>
            <button type="button" onClick={() => void load()} className="rounded-lg border border-border p-2 text-text-muted hover:text-text-primary"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /></button>
          </div>
          {items.length === 0 ? (
            <div className="py-16 text-center text-sm text-text-muted">还没有循环列表。先新建一个，再加入成片。</div>
          ) : (
            <div className="divide-y divide-border">
              {items.map(item => (
                <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                  <div>
                    <p className="text-sm font-black text-text-primary">{item.name}</p>
                    <p className="mt-1 text-xs text-text-muted">
                      {item.items?.length || 0} 条内容 · {item.slots?.length || 0} 个槽位 · {item.refresh_mode || 'copy'}
                    </p>
                    <p className="mt-1 text-[11px] text-text-muted">
                      默认槽位：{item.slots?.[0] ? `${WEEKDAY_LABELS[item.slots[0].weekday]} ${item.slots[0].time} · ${item.slots[0].platforms.join('/')}` : '未设置'}
                    </p>
                  </div>
                  <button type="button" onClick={() => void toggle(item)} className={`rounded-xl px-4 py-2 text-xs font-black ${item.enabled ? 'bg-emerald-50 text-emerald-700' : 'bg-surface-2 text-text-muted'}`}>
                    {item.enabled ? '已开启' : '已暂停'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
