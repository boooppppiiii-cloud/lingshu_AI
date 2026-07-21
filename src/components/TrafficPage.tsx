import { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  BarChart3,
  CheckCircle2,
  Film,
  Loader2,
  Copy,
  Plus,
  PlayCircle,
  RefreshCw,
  Send,
  ShieldCheck,
  Trash2,
  Upload,
  Wand2,
  Zap,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import InspirationDashboard from './InspirationDashboard';
import AiCreateStudio from './AiCreateStudio';
import { ChannelOverview } from './YouTubeIntegration';
import type { ConversationContext, Page, RestoreSignal, KickoffSignal, AgentAction } from '../App';
import { authHeader } from '../lib/auth';

type ViewMode = 'materials' | 'create' | 'publish' | 'accounts';
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

type PublishItemStatus = 'draft' | 'publishing' | 'published' | 'partial' | 'failed';

type PublishQueueItem = {
  id: string;
  videoPath: string;
  title: string;
  description: string;
  ratio?: string;
  sourceProjectId?: string;
  targetAccountIds: string[];
  platformCopy: Record<string, PlatformCopy>;
  firstComment: string;
  trackWaLink: boolean;
  status: PublishItemStatus;
  completedTargets: number;
  error?: string;
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

function publishItemId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `publish-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function titleFromVideoPath(videoPath: string) {
  const filename = videoPath.trim().split(/[\\/]/).pop() || '';
  return filename.replace(/\.(mp4|mov|webm|mkv|avi)$/i, '') || '未命名视频';
}

function createPublishItem(draft?: PublishDraft | null, targetAccountIds: string[] = []): PublishQueueItem {
  return {
    id: publishItemId(),
    videoPath: draft?.videoPath || '',
    title: draft?.title || '',
    description: draft?.description || '',
    ratio: draft?.ratio,
    sourceProjectId: draft?.sourceProjectId,
    targetAccountIds,
    platformCopy: {},
    firstComment: '',
    trackWaLink: true,
    status: 'draft',
    completedTargets: 0,
  };
}

function readStoredPublishDraft(): PublishDraft | null {
  try {
    return JSON.parse(localStorage.getItem('ow_publish_draft') || 'null') as PublishDraft | null;
  } catch {
    return null;
  }
}

const PUBLISH_STATUS_META: Record<PublishItemStatus, { label: string; className: string }> = {
  draft: { label: '待配置', className: 'bg-slate-100 text-slate-600' },
  publishing: { label: '发布中', className: 'bg-sky-50 text-sky-700' },
  published: { label: '已完成', className: 'bg-emerald-50 text-emerald-700' },
  partial: { label: '部分失败', className: 'bg-amber-50 text-amber-700' },
  failed: { label: '发布失败', className: 'bg-red-50 text-red-700' },
};

export default function TrafficPage({
  onNavigate,
  restore,
  kickoff,
  onScriptPanelOpen,
  onScriptPanelClose,
}: Props) {
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    try {
      const initialView = localStorage.getItem('lingshu:traffic:initial-view');
      localStorage.removeItem('lingshu:traffic:initial-view');
      if (initialView === 'publish') return 'publish';
    } catch { /* ignore */ }
    return 'materials';
  });
  const [publishDraft, setPublishDraft] = useState<PublishDraft | null>(null);

  useEffect(() => {
    if (restore || kickoff) setViewMode('materials');
  }, [restore?.key, kickoff?.key]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ page?: Page; view?: ViewMode }>).detail;
      if (detail?.page === 'traffic' && detail.view) setViewMode(detail.view);
    };
    window.addEventListener('lingshu:navigate', handler);
    return () => window.removeEventListener('lingshu:navigate', handler);
  }, []);

  useEffect(() => {
    const contextByMode: Record<ViewMode, { label: string; summary: string; suggestions: string[] }> = {
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
        <div className="grid w-full grid-cols-4 gap-1.5 rounded-2xl border border-border bg-surface-2 p-1 shadow-sm">
          {[
            { mode: 'materials' as ViewMode, icon: <Film size={18} />, label: '灵感大屏' },
            { mode: 'create' as ViewMode, icon: <Wand2 size={18} />, label: 'AI智能素材' },
            { mode: 'publish' as ViewMode, icon: <Send size={18} />, label: '一键发布' },
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

function SocialPublishPanel({ onNavigate, draft }: { onNavigate?: (p: Page) => void; draft?: PublishDraft | null }) {
  const [accounts, setAccounts] = useState<PublishAccount[]>([]);
  const [items, setItems] = useState<PublishQueueItem[]>(() => [createPublishItem(draft || readStoredPublishDraft())]);
  const [activeItemId, setActiveItemId] = useState('');
  const [batchPathsOpen, setBatchPathsOpen] = useState(false);
  const [batchPaths, setBatchPaths] = useState('');
  const [loading, setLoading] = useState(true);
  const [uploadingVideos, setUploadingVideos] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [adapting, setAdapting] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const accountTargetsSeededRef = useRef(false);
  const appliedDraftRef = useRef(JSON.stringify(draft || readStoredPublishDraft() || {}));
  const videoInputRef = useRef<HTMLInputElement | null>(null);

  const connectedAccounts = accounts.filter(account => account.status === 'connected');
  const activeItem = items.find(item => item.id === activeItemId) || items[0] || null;
  const selectedConnectedAccounts = connectedAccounts.filter(account => activeItem?.targetAccountIds.includes(account.id));
  const selectedPlatforms = Array.from(new Set(selectedConnectedAccounts.map(account => account.platform)));
  const connectedAccountIds = new Set(connectedAccounts.map(account => account.id));
  const totalAssignments = items.reduce(
    (sum, item) => sum + item.targetAccountIds.filter(id => connectedAccountIds.has(id)).length,
    0,
  );
  const publishableItems = items.filter(item => (
    item.videoPath.trim() &&
    item.title.trim() &&
    item.targetAccountIds.some(id => connectedAccountIds.has(id))
  ));

  const updateItem = (id: string, patch: Partial<PublishQueueItem>) => {
    setItems(prev => prev.map(item => item.id === id ? { ...item, ...patch } : item));
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
        ...(youtube.items ?? []).map(account => ({ id: account.id, platform: 'youtube' as const, title: account.channelTitle, handle: account.channelTitle, status: account.status, avatarUrl: account.thumbnailUrl })),
        ...(tiktok.items ?? []).map(account => ({ id: account.id, platform: 'tiktok' as const, title: account.title, handle: account.handle, status: account.status, avatarUrl: account.avatarUrl })),
        ...(instagram.items ?? []).map(account => ({ id: account.id, platform: 'instagram' as const, title: account.title, handle: account.handle, status: account.status, avatarUrl: account.avatarUrl })),
        ...(facebook.items ?? []).map(account => ({ id: account.id, platform: 'facebook' as const, title: account.title, handle: account.handle, status: account.status, avatarUrl: account.avatarUrl })),
      ];
      setAccounts(next);
      if (!accountTargetsSeededRef.current) {
        const targetAccountIds = next.filter(account => account.status === 'connected').map(account => account.id);
        setItems(prev => prev.map(item => item.targetAccountIds.length ? item : { ...item, targetAccountIds }));
        accountTargetsSeededRef.current = true;
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '无法读取授权账号');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadAccounts(); }, []);

  useEffect(() => {
    if (!draft) return;
    const fingerprint = JSON.stringify(draft);
    if (fingerprint === appliedDraftRef.current) return;
    const next = createPublishItem(draft, connectedAccounts.map(account => account.id));
    setItems(prev => [...prev, next]);
    setActiveItemId(next.id);
    appliedDraftRef.current = fingerprint;
  }, [draft]);

  const toggleAccount = (accountId: string) => {
    if (!activeItem) return;
    const next = new Set(activeItem.targetAccountIds);
    if (next.has(accountId)) next.delete(accountId);
    else next.add(accountId);
    updateItem(activeItem.id, { targetAccountIds: Array.from(next), status: 'draft', error: undefined });
  };

  const togglePlatform = (platform: PublishPlatform) => {
    if (!activeItem) return;
    const ids = connectedAccounts.filter(account => account.platform === platform).map(account => account.id);
    const next = new Set(activeItem.targetAccountIds);
    const allSelected = ids.length > 0 && ids.every(id => next.has(id));
    ids.forEach(id => allSelected ? next.delete(id) : next.add(id));
    updateItem(activeItem.id, { targetAccountIds: Array.from(next), status: 'draft', error: undefined });
  };

  const selectAllAccounts = () => {
    if (!activeItem) return;
    updateItem(activeItem.id, {
      targetAccountIds: connectedAccounts.map(account => account.id),
      status: 'draft',
      error: undefined,
    });
  };

  const applyAccountsToAll = () => {
    if (!activeItem) return;
    setItems(prev => prev.map(item => ({
      ...item,
      targetAccountIds: [...activeItem.targetAccountIds],
      status: item.status === 'publishing' ? item.status : 'draft',
      error: undefined,
    })));
    setNotice(`已把当前账号配置应用到 ${items.length} 条视频。`);
  };

  const addPublishItem = () => {
    const next = createPublishItem(null, connectedAccounts.map(account => account.id));
    setItems(prev => [...prev, next]);
    setActiveItemId(next.id);
    setNotice('');
    setError('');
  };

  const duplicatePublishItem = (item: PublishQueueItem) => {
    const next: PublishQueueItem = {
      ...item,
      id: publishItemId(),
      platformCopy: { ...item.platformCopy },
      targetAccountIds: [...item.targetAccountIds],
      status: 'draft',
      completedTargets: 0,
      error: undefined,
    };
    setItems(prev => [...prev, next]);
    setActiveItemId(next.id);
  };

  const removePublishItem = (id: string) => {
    setItems(prev => {
      if (prev.length === 1) {
        const replacement = createPublishItem(null, connectedAccounts.map(account => account.id));
        setActiveItemId(replacement.id);
        return [replacement];
      }
      const next = prev.filter(item => item.id !== id);
      if (activeItem?.id === id) setActiveItemId(next[0]?.id || '');
      return next;
    });
  };

  const addBatchPaths = () => {
    const paths = Array.from(new Set(batchPaths
      .split(/\r?\n/)
      .map(value => value.trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean)));
    if (!paths.length) {
      setError('请至少输入一个本地视频路径');
      return;
    }
    const targetAccountIds = activeItem?.targetAccountIds.length
      ? activeItem.targetAccountIds
      : connectedAccounts.map(account => account.id);
    const additions = paths.map(videoPath => createPublishItem({
      videoPath,
      title: titleFromVideoPath(videoPath),
      description: activeItem?.description || '',
      ratio: activeItem?.ratio,
    }, targetAccountIds));
    setItems(prev => {
      const onlyBlank = prev.length === 1 && !prev[0].videoPath.trim() && !prev[0].title.trim();
      return onlyBlank ? additions : [...prev, ...additions];
    });
    setActiveItemId(additions[0].id);
    setBatchPaths('');
    setBatchPathsOpen(false);
    setError('');
    setNotice(`已加入 ${additions.length} 条视频。`);
  };

  const addSelectedVideoFiles = async (fileList: FileList | null) => {
    const files = Array.from(fileList || []).filter(file => /\.(mp4|mov|webm|mkv|avi)$/i.test(file.name));
    if (!files.length) return;
    setUploadingVideos(true);
    setError('');
    setNotice('');
    const targetAccountIds = activeItem?.targetAccountIds.length
      ? activeItem.targetAccountIds
      : connectedAccounts.map(account => account.id);
    const additions: PublishQueueItem[] = [];
    const failures: string[] = [];
    for (const file of files) {
      try {
        const response = await fetch('/api/overseas/publishing/local-videos', {
          method: 'POST',
          headers: {
            ...authHeader(),
            'Content-Type': 'application/octet-stream',
            'X-File-Name': encodeURIComponent(file.name),
          },
          body: file,
        });
        const data = await response.json().catch(() => ({})) as { video?: { videoPath?: string }; error?: string };
        if (!response.ok || !data.video?.videoPath) throw new Error(data.error || '视频接收失败');
        additions.push(createPublishItem({
          videoPath: data.video.videoPath,
          title: titleFromVideoPath(file.name),
          description: activeItem?.description || '',
          ratio: activeItem?.ratio,
        }, targetAccountIds));
      } catch (uploadError) {
        failures.push(`${file.name}: ${uploadError instanceof Error ? uploadError.message : '添加失败'}`);
      }
    }
    if (additions.length) {
      setItems(prev => {
        const onlyBlank = prev.length === 1 && !prev[0].videoPath.trim() && !prev[0].title.trim();
        return onlyBlank ? additions : [...prev, ...additions];
      });
      setActiveItemId(additions[0].id);
      setNotice(`已选择并加入 ${additions.length} 条视频。`);
    }
    if (failures.length) setError(failures.join('；'));
    setUploadingVideos(false);
    if (videoInputRef.current) videoInputRef.current.value = '';
  };

  const adaptCopy = async (platform?: PublishPlatform) => {
    if (!activeItem) return;
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
        body: JSON.stringify({ title: activeItem.title, description: activeItem.description, platforms, language: 'English' }),
      });
      const first = platforms[0];
      updateItem(activeItem.id, {
        platformCopy: { ...activeItem.platformCopy, ...data.copy },
        firstComment: data.copy[first]?.firstComment || activeItem.firstComment,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : '生成平台文案失败');
    } finally {
      setAdapting(false);
    }
  };

  const publish = async () => {
    if (!publishableItems.length) {
      setError('请至少配置一条含视频路径、标题和发布账号的视频');
      return;
    }
    setPublishing(true);
    setNotice('');
    setError('');
    let successfulTargets = 0;
    let failedTargets = 0;
    let skippedItems = 0;

    for (const item of items) {
      const targets = connectedAccounts.filter(account => item.targetAccountIds.includes(account.id));
      if (!item.videoPath.trim() || !item.title.trim() || !targets.length) {
        skippedItems += 1;
        updateItem(item.id, {
          status: 'failed',
          completedTargets: 0,
          error: !item.videoPath.trim() ? '缺少视频路径' : !item.title.trim() ? '缺少标题' : '未选择可用账号',
        });
        continue;
      }
      updateItem(item.id, { status: 'publishing', completedTargets: 0, error: undefined });
      const itemFailures: string[] = [];
      let itemSuccesses = 0;
      for (const account of targets) {
        const meta = PLATFORM_META[account.platform];
        const copy = item.platformCopy[account.platform];
        try {
          const url = account.platform === 'youtube'
            ? `/api/overseas/youtube/accounts/${account.id}/upload`
            : `/api/overseas/social/accounts/${account.id}/upload`;
          const publishResult = await fetchJson<{ ok: boolean; video?: unknown; tracking?: unknown }>(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              videoPath: item.videoPath.trim(),
              title: platformTitle(account.platform, copy, item.title.trim()),
              description: platformBody(account.platform, copy, item.description.trim()),
              firstComment: copy?.firstComment || item.firstComment,
              trackWaLink: item.trackWaLink,
              privacyStatus: 'public',
              madeForKids: false,
            }),
          });
          if (item.sourceProjectId) {
            await fetch('/api/overseas/studio/publish-links', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', ...authHeader() },
              body: JSON.stringify({
                projectId: item.sourceProjectId,
                accountId: account.id,
                platform: account.platform,
                title: item.title.trim(),
                publishResult,
              }),
            });
          }
          itemSuccesses += 1;
          successfulTargets += 1;
        } catch (e) {
          failedTargets += 1;
          itemFailures.push(`${meta.label} · ${account.title}: ${e instanceof Error ? e.message : '发布失败'}`);
        }
        updateItem(item.id, { completedTargets: itemSuccesses + itemFailures.length });
      }
      updateItem(item.id, {
        status: itemFailures.length ? (itemSuccesses ? 'partial' : 'failed') : 'published',
        completedTargets: targets.length,
        error: itemFailures.length ? itemFailures.join('；') : undefined,
      });
    }
    setPublishing(false);
    if (failedTargets || skippedItems) setError(`${failedTargets} 个发布目标失败，${skippedItems} 条视频配置不完整；可在队列中查看并修改。`);
    if (successfulTargets) setNotice(`已完成 ${successfulTargets} 个账号发布，每条发布均生成独立追踪码。`);
  };

  const previewRatio = activeItem?.ratio || (selectedPlatforms.length > 0 && selectedPlatforms.every(platform => platform === 'youtube') ? '16:9' : '9:16');

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
                  <p className="text-xs font-semibold text-text-muted">批量一键发布</p>
                  <h2 className="text-lg font-bold text-text-primary">多条视频，多平台、多账号统一配置发布</h2>
                </div>
              </div>
              <p className="mt-2 text-sm text-text-muted">
                每条视频可独立选择发布账号和平台文案，批量执行时逐条显示结果。
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

          <div className="mt-5 border-t border-border pt-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-text-primary">发布队列</h3>
                <p className="mt-1 text-xs text-text-muted">{items.length} 条视频 · {totalAssignments} 个发布目标</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <input
                  ref={videoInputRef}
                  type="file"
                  accept="video/mp4,video/quicktime,video/webm,video/x-matroska,video/x-msvideo"
                  multiple
                  className="hidden"
                  onChange={event => void addSelectedVideoFiles(event.target.files)}
                />
                <button type="button" onClick={() => videoInputRef.current?.click()} disabled={uploadingVideos} className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-xs font-bold text-white disabled:opacity-50">
                  {uploadingVideos ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                  {uploadingVideos ? '正在加入...' : '选择视频'}
                </button>
                <button type="button" onClick={() => setBatchPathsOpen(open => !open)} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-bold text-text-secondary hover:border-accent hover:text-accent">
                  <Film size={13} /> 批量路径
                </button>
                <button type="button" onClick={addPublishItem} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-bold text-text-secondary hover:border-accent hover:text-accent">
                  <Plus size={13} /> 添加空白
                </button>
              </div>
            </div>

            {batchPathsOpen && (
              <div className="mt-3 rounded-xl border border-border bg-surface p-3">
                <label className="block">
                  <span className="mb-1.5 block text-[11px] font-semibold text-text-secondary">每行一个本地视频路径</span>
                  <textarea
                    value={batchPaths}
                    onChange={event => setBatchPaths(event.target.value)}
                    rows={4}
                    placeholder={'D:\\videos\\product-a.mp4\nD:\\videos\\product-b.mp4'}
                    className="w-full resize-y rounded-lg border border-border bg-white px-3 py-2 font-mono text-xs outline-none focus:border-accent"
                  />
                </label>
                <div className="mt-2 flex justify-end gap-2">
                  <button type="button" onClick={() => setBatchPathsOpen(false)} className="rounded-lg border border-border px-3 py-1.5 text-xs font-bold text-text-secondary">取消</button>
                  <button type="button" onClick={addBatchPaths} className="rounded-lg bg-accent px-3 py-1.5 text-xs font-bold text-white">加入队列</button>
                </div>
              </div>
            )}

            <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {items.map((item, index) => {
                const active = item.id === activeItem?.id;
                const status = PUBLISH_STATUS_META[item.status];
                const targetCount = item.targetAccountIds.filter(id => connectedAccountIds.has(id)).length;
                return (
                  <div key={item.id} className={`flex min-w-0 items-center gap-2 rounded-xl border p-2 transition-colors ${active ? 'border-accent bg-accent-glow' : 'border-border bg-surface'}`}>
                    <button type="button" onClick={() => setActiveItemId(item.id)} className="min-w-0 flex-1 px-1.5 py-1 text-left">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-black text-text-muted">{String(index + 1).padStart(2, '0')}</span>
                        <span className="min-w-0 flex-1 truncate text-sm font-bold text-text-primary">{item.title || titleFromVideoPath(item.videoPath) || '待填写视频'}</span>
                        <span className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${status.className}`}>{status.label}</span>
                      </div>
                      <p className="mt-1 truncate text-[11px] text-text-muted">{item.videoPath || '尚未填写视频路径'} · {targetCount} 个账号</p>
                      {item.error && <p className="mt-1 truncate text-[11px] font-semibold text-red-600" title={item.error}>{item.error}</p>}
                    </button>
                    <div className="flex flex-shrink-0 items-center gap-1">
                      <button type="button" onClick={() => duplicatePublishItem(item)} className="flex h-7 w-7 items-center justify-center rounded-lg text-text-muted hover:bg-white hover:text-text-primary" title="复制配置"><Copy size={12} /></button>
                      <button type="button" onClick={() => removePublishItem(item.id)} className="flex h-7 w-7 items-center justify-center rounded-lg text-text-muted hover:bg-red-50 hover:text-red-600" title="删除视频"><Trash2 size={12} /></button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="mt-5 border-t border-border pt-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-text-primary">当前视频发布账号</h3>
                <p className="mt-1 text-xs text-text-muted">已选择 {selectedConnectedAccounts.length} 个账号，覆盖 {selectedPlatforms.length} 个平台</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {Object.entries(PLATFORM_META).map(([platform, meta]) => {
                  const platformAccounts = connectedAccounts.filter(account => account.platform === platform);
                  const selected = platformAccounts.length > 0 && platformAccounts.every(account => activeItem?.targetAccountIds.includes(account.id));
                  return (
                    <button key={platform} type="button" disabled={!platformAccounts.length} onClick={() => togglePlatform(platform as PublishPlatform)} className={`rounded-lg border px-2.5 py-1.5 text-[11px] font-bold disabled:opacity-40 ${selected ? 'border-accent bg-accent-glow text-accent' : 'border-border text-text-secondary'}`}>
                      {meta.short} {platformAccounts.length}
                    </button>
                  );
                })}
                <button type="button" onClick={selectAllAccounts} className="rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-bold text-text-secondary">全选</button>
                <button type="button" onClick={applyAccountsToAll} className="rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-bold text-text-secondary">应用到全部视频</button>
              </div>
            </div>

          <div className="mt-3 grid gap-3 md:grid-cols-4">
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
              const active = Boolean(activeItem?.targetAccountIds.includes(account.id));
              return (
                <button key={account.id} type="button" onClick={() => toggleAccount(account.id)} disabled={account.status !== 'connected'} className={`rounded-xl border p-3 text-left transition-all disabled:cursor-not-allowed disabled:opacity-55 ${active ? 'border-accent bg-accent-glow shadow-sm' : 'border-border bg-surface hover:border-border-bright'}`}>
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
          </div>
        </section>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
          <section className="space-y-5">
            <div className="rounded-2xl border border-border bg-white p-5 shadow-sm">
              <h3 className="text-sm font-bold text-text-primary">发布内容</h3>
              <div className="mt-4 space-y-3">
                <label className="block">
                  <span className="mb-1.5 block text-[11px] font-semibold text-text-secondary">本地视频路径</span>
                  <input value={activeItem?.videoPath || ''} onChange={event => activeItem && updateItem(activeItem.id, { videoPath: event.target.value, status: 'draft', error: undefined })} placeholder="/Users/.../rendered-video.mp4" className="w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm outline-none focus:border-accent" />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-[11px] font-semibold text-text-secondary">基础标题</span>
                  <input value={activeItem?.title || ''} onChange={event => activeItem && updateItem(activeItem.id, { title: event.target.value, status: 'draft', error: undefined })} placeholder="发布标题" className="w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm outline-none focus:border-accent" />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-[11px] font-semibold text-text-secondary">基础文案</span>
                  <textarea value={activeItem?.description || ''} onChange={event => activeItem && updateItem(activeItem.id, { description: event.target.value, status: 'draft', error: undefined })} rows={5} placeholder="输入卖点、脚本摘要和 hashtag" className="w-full resize-none rounded-xl border border-border bg-surface px-3 py-2.5 text-sm outline-none focus:border-accent" />
                </label>
                <div className="rounded-xl border border-emerald-100 bg-emerald-50/80 p-3">
                  <label className="flex cursor-pointer items-start gap-3">
                    <input type="checkbox" checked={activeItem?.trackWaLink ?? true} onChange={event => activeItem && updateItem(activeItem.id, { trackWaLink: event.target.checked, status: 'draft' })} className="mt-1 h-4 w-4 rounded border-border text-accent" />
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
                  const copy = activeItem?.platformCopy[platform];
                  const body = platformBody(platform, copy, activeItem?.description || '');
                  return (
                    <div key={platform} className="rounded-2xl border border-border bg-surface p-4">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-black text-text-primary">{meta.label}</span>
                        <button type="button" onClick={() => void adaptCopy(platform)} className="rounded-lg border border-border px-2 py-1 text-[11px] font-bold text-text-secondary hover:border-accent hover:text-accent">换一版</button>
                      </div>
                      {platform === 'youtube' && (
                        <input value={platformTitle(platform, copy, activeItem?.title || '')} onChange={event => activeItem && updateItem(activeItem.id, { platformCopy: { ...activeItem.platformCopy, [platform]: { ...activeItem.platformCopy[platform], title: event.target.value } } })} className="mt-3 w-full rounded-lg border border-border bg-white px-3 py-2 text-xs outline-none focus:border-accent" />
                      )}
                      <textarea value={body} onChange={event => activeItem && updateItem(activeItem.id, { platformCopy: { ...activeItem.platformCopy, [platform]: { ...activeItem.platformCopy[platform], ...(platform === 'facebook' ? { text: event.target.value } : platform === 'youtube' ? { description: event.target.value } : { caption: event.target.value }) } } })} rows={4} className="mt-3 w-full resize-none rounded-lg border border-border bg-white px-3 py-2 text-xs outline-none focus:border-accent" />
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
              <textarea value={activeItem?.firstComment || ''} onChange={event => activeItem && updateItem(activeItem.id, { firstComment: event.target.value, status: 'draft' })} rows={4} placeholder="hashtags、wa.me 链接或补充说明。平台不支持时会记录 warning。" className="w-full resize-none rounded-xl border border-border bg-surface px-3 py-2.5 text-xs outline-none focus:border-accent" />
            </label>

            <div className="mt-5 rounded-xl border border-green-100 bg-green-50 p-3">
              <div className="flex items-center gap-2 text-xs font-bold text-green-700">
                <ShieldCheck size={14} />
                发布前检查
              </div>
              <ul className="mt-2 space-y-1 text-[11px] leading-relaxed text-green-800">
                <li>队列：{items.length} 条视频，{publishableItems.length} 条可发布</li>
                <li>目标：{totalAssignments} 个账号任务，覆盖 {new Set(items.flatMap(item => connectedAccounts.filter(account => item.targetAccountIds.includes(account.id)).map(account => account.platform))).size} 个平台</li>
                <li>当前视频追踪链接：{activeItem?.trackWaLink ? '开启' : '关闭'}</li>
              </ul>
            </div>

            {notice && <div className="mt-4 flex items-start gap-2 rounded-xl border border-green-100 bg-green-50 px-3 py-2 text-xs text-green-700"><CheckCircle2 size={14} className="mt-0.5 flex-shrink-0" /><span>{notice}</span></div>}
            {error && <div className="mt-4 flex items-start gap-2 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-600"><AlertCircle size={14} className="mt-0.5 flex-shrink-0" /><span>{error}</span></div>}

            <button type="button" onClick={() => void publish()} disabled={publishing || loading || publishableItems.length === 0} className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3 text-sm font-bold text-white shadow-sm hover:brightness-95 disabled:opacity-50">
              {publishing ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
              {publishing ? '批量发布中...' : `发布 ${publishableItems.length} 条视频`}
            </button>
            <button type="button" onClick={() => onNavigate?.('strategy')} className="mt-2 w-full rounded-xl border border-border px-4 py-3 text-sm font-bold text-text-secondary hover:border-accent hover:text-accent">
              查看内容日历
            </button>
          </aside>
        </div>
      </div>
    </div>
  );
}
