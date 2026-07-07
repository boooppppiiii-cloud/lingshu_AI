import { useState, useEffect } from 'react';
import {
  BarChart3,
  AlertCircle,
  CheckCircle2,
  Film,
  Loader2,
  MessageSquare,
  PlayCircle,
  RefreshCw,
  Send,
  ShieldCheck,
  Wand2,
  Zap,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import InspirationDashboard from './InspirationDashboard';
import AiCreateStudio from './AiCreateStudio';
import AgentChatPage from './AgentChatPage';
import { ChannelOverview } from './YouTubeIntegration';
import type { ConversationContext, Page, RestoreSignal, KickoffSignal, AgentAction } from '../App';
import { authHeader } from '../lib/auth';

type ViewMode = 'materials' | 'create' | 'publish' | 'accounts' | 'chat';
type PublishDraft = {
  videoPath?: string;
  title: string;
  description: string;
  ratio?: string;
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

export default function TrafficPage({ onEnterConversation, onLeaveConversation, isInConversation, onNavigate, restore, kickoff, onAction, onScriptPanelOpen, onScriptPanelClose, onSessionRefresh }: Props) {
  const [viewMode, setViewMode] = useState<ViewMode>('materials');
  const [publishDraft, setPublishDraft] = useState<PublishDraft | null>(null);
  useEffect(() => { if (restore) setViewMode('chat'); }, [restore?.key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (kickoff) setViewMode('chat'); }, [kickoff?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleEnterChat = (ctx: ConversationContext = { agent: 'traffic' }) => {
    setViewMode('chat');
    onEnterConversation(ctx);
  };
  const handleLeave = () => {
    setViewMode('materials');
    onLeaveConversation();
  };
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
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="h-12 flex items-center justify-between px-5 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-6 h-6 rounded-lg flex items-center justify-center" style={{ background: 'rgba(22,163,74,0.1)', color: '#16a34a' }}>
            <Zap size={13} />
          </div>
          <span className="text-sm font-semibold text-text-primary">社媒流量</span>
          {isInConversation && (
            <span className="flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full ml-1" style={{ background: 'rgba(22,163,74,0.1)', color: '#16a34a' }}>
              <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
              社媒流量助手运行中
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => handleEnterChat()}
            className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors ${
              viewMode === 'chat'
                ? 'border-accent bg-accent-glow text-accent'
                : 'border-border text-text-muted hover:text-text-primary'
            }`}
          >
            <MessageSquare size={12} />
            问社媒流量
          </button>
        </div>
      </div>

      {viewMode !== 'chat' && (
        <div className="flex-shrink-0 border-b border-border bg-surface px-6 py-4">
          <div className="flex items-center gap-2 rounded-2xl border border-border bg-surface-2 p-1.5 shadow-sm">
            {([
              { mode: 'materials' as ViewMode, icon: <Film size={17} />, label: '灵感大屏', desc: '爆款拆解' },
              { mode: 'create' as ViewMode,    icon: <Wand2 size={17} />, label: 'AI素材快剪', desc: '脚本成片' },
              { mode: 'publish' as ViewMode,   icon: <Send size={17} />, label: '账号一键发布', desc: '多平台' },
              { mode: 'accounts' as ViewMode,  icon: <BarChart3 size={17} />, label: '账号流量数据', desc: '复盘' },
            ]).map(({ mode, icon, label, desc }) => {
              const active = viewMode === mode;
              return (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setViewMode(mode)}
                  className={`flex min-h-14 flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-left transition-all ${
                    active
                      ? 'bg-white text-text-primary shadow-sm ring-1 ring-border'
                      : 'text-text-muted hover:bg-white/60 hover:text-text-secondary'
                  }`}
                >
                  <span className={active ? 'text-accent' : 'text-text-muted'}>{icon}</span>
                  <span className="min-w-0">
                    <span className="block whitespace-nowrap text-base font-black">{label}</span>
                    <span className="mt-0.5 block text-[11px] font-semibold opacity-70">{desc}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <AnimatePresence mode="wait">
          {viewMode === 'materials' ? (
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
              <SocialPublishPanel onNavigate={onNavigate} draft={publishDraft} />
            </motion.div>
          ) : viewMode === 'accounts' ? (
            <motion.div key="accounts" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="h-full overflow-y-auto px-6 py-5">
              <ChannelOverview />
            </motion.div>
          ) : (
            <motion.div key="chat" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="h-full">
              <AgentChatPage
                config={{
                  type: 'traffic',
                  apiPath: '/api/overseas/agents/traffic/chat',
                  color: '#16a34a',
                  bg: 'rgba(22,163,74,0.1)',
                  icon: <Zap size={13} />,
                  name: '社媒流量',
                  tagline: '素材复用 · AI 生成 · 多账号发布 · 数据复盘',
                  suggestions: [
                    '规划四平台发布节奏',
                    '复盘账号流量数据',
                    '生成短视频素材方向',
                    '拆解爆款钩子',
                  ],
                }}
                onEnterConversation={handleEnterChat}
                onLeaveConversation={handleLeave}
                isInConversation={isInConversation}
                restoreKey={restore?.key}
                restoreMessages={restore?.messages}
                kickoff={kickoff}
                onAction={onAction}
                onSessionRefresh={onSessionRefresh}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

type PublishPlatform = 'youtube' | 'tiktok' | 'instagram' | 'facebook';
type PublishAccount = {
  id: string;
  platform: PublishPlatform;
  title: string;
  handle?: string;
  status: 'connected' | 'error' | 'expired';
  avatarUrl?: string;
};

const PLATFORM_META: Record<PublishPlatform, { label: string; short: string; color: string; format: string }> = {
  youtube: { label: 'YouTube', short: 'YT', color: '#ff0000', format: 'Shorts / Video' },
  tiktok: { label: 'TikTok', short: 'TK', color: '#111827', format: '9:16 短视频' },
  instagram: { label: 'Instagram', short: 'IG', color: '#c13584', format: 'Reels' },
  facebook: { label: 'Facebook', short: 'FB', color: '#1877f2', format: 'Reels / Page Video' },
};

const CHECK_LABELS: Record<PublishPlatform, string> = {
  youtube: 'YouTube',
  tiktok: 'TikTok',
  facebook: 'Facebook',
  instagram: 'IG',
};

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { ...init, headers: { ...authHeader(), ...(init?.headers ?? {}) } });
  const data = await r.json().catch(() => ({})) as T & { error?: string };
  if (!r.ok) throw new Error(data.error || '请求失败');
  return data;
}

function SocialPublishPanel({ onNavigate, draft }: { onNavigate?: (p: Page) => void; draft?: PublishDraft | null }) {
  const [accounts, setAccounts] = useState<PublishAccount[]>([]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [videoPath, setVideoPath] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');

  const toggle = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

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
        ...(youtube.items ?? []).map(a => ({ id: a.id, platform: 'youtube' as const, title: a.channelTitle, handle: a.channelTitle, status: a.status, avatarUrl: a.thumbnailUrl })),
        ...(tiktok.items ?? []).map(a => ({ id: a.id, platform: 'tiktok' as const, title: a.title, handle: a.handle, status: a.status, avatarUrl: a.avatarUrl })),
        ...(instagram.items ?? []).map(a => ({ id: a.id, platform: 'instagram' as const, title: a.title, handle: a.handle, status: a.status, avatarUrl: a.avatarUrl })),
        ...(facebook.items ?? []).map(a => ({ id: a.id, platform: 'facebook' as const, title: a.title, handle: a.handle, status: a.status, avatarUrl: a.avatarUrl })),
      ];
      setAccounts(next);
      setSelected(new Set(next.filter(a => a.status === 'connected').map(a => a.id)));
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

  const publish = async () => {
    const targets = accounts.filter(account => selected.has(account.id) && account.status === 'connected');
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
      try {
        const url = account.platform === 'youtube'
          ? `/api/overseas/youtube/accounts/${account.id}/upload`
          : `/api/overseas/social/accounts/${account.id}/upload`;
        await fetchJson<{ ok: boolean; video?: unknown }>(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            videoPath: videoPath.trim(),
            title: title.trim(),
            description: description.trim(),
            privacyStatus: 'public',
            madeForKids: false,
          }),
        });
      } catch (e) {
        failures.push(`${meta.label}：${e instanceof Error ? e.message : '发布失败'}`);
      }
    }
    setPublishing(false);
    if (failures.length) {
      setError(failures.join('；'));
      return;
    }
    setNotice(`已提交 ${targets.length} 个账号发布，稍后可在账号流量数据里刷新查看。`);
  };

  const connectedCount = accounts.filter(a => a.status === 'connected').length;
  const connectedAccounts = accounts.filter(a => a.status === 'connected');
  const selectedConnectedAccounts = connectedAccounts.filter(account => selected.has(account.id));
  const selectedPlatforms = Array.from(new Set(selectedConnectedAccounts.map(account => account.platform)));
  const selectedPlatformCount = selectedPlatforms.length;
  const authorizedPlatforms = (['youtube', 'tiktok', 'facebook', 'instagram'] as PublishPlatform[])
    .filter(platform => connectedAccounts.some(account => account.platform === platform));
  const selectedCountByPlatform = (platform: PublishPlatform) =>
    selectedConnectedAccounts.filter(account => account.platform === platform).length;
  const previewRatio = draft?.ratio || (selectedPlatforms.length > 0 && selectedPlatforms.every(platform => platform === 'youtube') ? '16:9' : '9:16');
  const previewAspect = previewRatio === '16:9' ? '16 / 9' : '9 / 16';
  const videoName = videoPath.trim().split(/[\\/]/).filter(Boolean).pop() || '本地视频预览';

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
                  <p className="text-xs font-semibold text-text-muted">社媒账号一键发布</p>
                  <h2 className="text-lg font-bold text-text-primary">统一选择素材、账号和发布时间</h2>
                </div>
              </div>
              <p className="mt-2 text-sm text-text-muted">
                复用集成中心授权账号，直接调用 YouTube、TikTok、Instagram、Facebook 的发布接口。
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void loadAccounts()}
                disabled={loading}
                title="刷新账号"
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border text-text-muted transition-colors hover:text-text-primary disabled:opacity-50"
              >
                <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              </button>
              <button
                type="button"
                onClick={() => onNavigate?.('channels')}
                className="rounded-lg border border-border px-3 py-2 text-xs font-semibold text-text-secondary transition-colors hover:border-accent hover:text-accent"
              >
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
                <button
                  key={account.id}
                  type="button"
                  onClick={() => toggle(account.id)}
                  className={`rounded-2xl border p-4 text-left transition-all ${
                    active ? 'border-accent bg-accent-glow shadow-sm' : 'border-border bg-surface hover:border-border-bright'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    {account.avatarUrl ? (
                      <img src={account.avatarUrl} alt={account.title} className="h-10 w-10 rounded-xl object-cover" />
                    ) : (
                      <span className="flex h-10 w-10 items-center justify-center rounded-xl text-white" style={{ background: meta.color }}>
                        <PlayCircle size={18} />
                      </span>
                    )}
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                      account.status === 'connected' ? 'bg-green-50 text-green-700' : 'bg-slate-100 text-text-muted'
                    }`}>
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

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <section className="rounded-2xl border border-border bg-white p-5 shadow-sm">
            <h3 className="text-sm font-bold text-text-primary">发布内容</h3>
            <p className="mt-1 text-xs text-text-muted">填写 AI 素材生成后得到的本地成片视频路径，系统会用本地文件提交到已授权账号。</p>
            <div className="mt-4 space-y-3">
              <label className="block">
                <span className="mb-1.5 block text-[11px] font-semibold text-text-secondary">本地视频路径</span>
                <input
                  value={videoPath}
                  onChange={e => setVideoPath(e.target.value)}
                  placeholder="/Users/.../rendered-video.mp4"
                  className="w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm outline-none focus:border-accent"
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-[11px] font-semibold text-text-secondary">标题</span>
                <input
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  placeholder="发布标题"
                  className="w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm outline-none focus:border-accent"
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-[11px] font-semibold text-text-secondary">文案与话题标签</span>
                <textarea
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  rows={5}
                  placeholder="输入发布文案、卖点和 hashtag"
                  className="w-full resize-none rounded-xl border border-border bg-surface px-3 py-2.5 text-sm outline-none focus:border-accent"
                />
              </label>
            </div>
          </section>

          <aside className="rounded-2xl border border-border bg-white p-5 shadow-sm">
            <h3 className="text-sm font-bold text-text-primary">发布设置</h3>
            <div className="mt-4 rounded-2xl border border-border bg-surface p-3">
              <div className="mb-3 flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-text-primary">发布效果缩略图</span>
                <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-bold text-accent shadow-sm">{previewRatio}</span>
              </div>
              <div className="flex justify-center">
                <div
                  className="relative w-full overflow-hidden rounded-xl border border-border bg-white shadow-inner"
                  style={{ aspectRatio: previewAspect, maxWidth: previewRatio === '16:9' ? 260 : 150 }}
                >
                  <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(22,163,74,0.12),rgba(15,23,42,0.04))]" />
                  <div className="absolute inset-x-3 top-3 flex items-center justify-between gap-2">
                    <span className="rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-bold text-text-secondary shadow-sm">
                      {previewRatio}
                    </span>
                    <PlayCircle size={16} className="text-accent" />
                  </div>
                  <div className="absolute inset-x-3 bottom-3">
                    <p className="truncate text-xs font-bold text-text-primary">{videoName}</p>
                    <p className="mt-1 text-[10px] text-text-muted">本地视频 · {selectedPlatformCount || 0} 个平台</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-5 rounded-xl border border-green-100 bg-green-50 p-3">
              <div className="flex items-center gap-2 text-xs font-bold text-green-700">
                <ShieldCheck size={14} />
                发布前检查
              </div>
              <ul className="mt-2 space-y-1 text-[11px] leading-relaxed text-green-800">
                <li>已选择 {selectedPlatformCount} 个发布平台</li>
                {authorizedPlatforms.map(platform => (
                  <li key={platform}>{CHECK_LABELS[platform]} - 已选择发布账号{selectedCountByPlatform(platform)}个</li>
                ))}
                <li>发布后可在账号流量数据看板刷新查看</li>
              </ul>
            </div>

            {notice && (
              <div className="mt-4 flex items-start gap-2 rounded-xl border border-green-100 bg-green-50 px-3 py-2 text-xs text-green-700">
                <CheckCircle2 size={14} className="mt-0.5 flex-shrink-0" />
                <span>{notice}</span>
              </div>
            )}
            {error && (
              <div className="mt-4 flex items-start gap-2 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-600">
                <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <button
              type="button"
              onClick={() => void publish()}
              disabled={publishing || loading}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3 text-sm font-bold text-white shadow-sm transition hover:brightness-95 disabled:opacity-50"
            >
              {publishing ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
              {publishing ? '发布中...' : '确认发布'}
            </button>
          </aside>
        </div>
      </div>
    </div>
  );
}
