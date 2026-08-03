import { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  BarChart3,
  ChevronLeft,
  CheckCircle2,
  Film,
  Loader2,
  Copy,
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
import AccountActivity from './AccountActivity';
import { CalendarPlanner, type CalendarPost } from './publishing/CalendarPlanner';
import type { ConversationContext, Page, RestoreSignal, KickoffSignal, AgentAction } from '../App';
import { authHeader } from '../lib/auth';
import { SocialPlatformIcon } from './SocialPlatformIcon';

type ViewMode = 'materials' | 'create' | 'publish' | 'accounts';
type PublishPlatform = 'youtube' | 'tiktok' | 'instagram' | 'facebook';

type PublishDraftItem = {
  videoPath?: string;
  previewUrl?: string;
  title: string;
  description: string;
  ratio?: string;
  sourceProjectId?: string;
  platform?: PublishPlatform;
};

type PublishDraft = PublishDraftItem & {
  items?: PublishDraftItem[];
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

type PublishItemStatus = 'draft' | 'ready' | 'publishing' | 'scheduled' | 'published' | 'partial' | 'failed';
type DeliveryMode = 'now' | 'schedule';

type PublishQueueItem = {
  id: string;
  selected: boolean;
  videoPath: string;
  previewUrl?: string;
  title: string;
  description: string;
  ratio?: string;
  sourceProjectId?: string;
  sourcePlatform?: PublishPlatform;
  targetAccountIds: string[];
  platformCopy: Record<string, PlatformCopy>;
  firstComment: string;
  trackWaLink: boolean;
  deliveryMode: DeliveryMode;
  scheduledAt: string;
  calendarPostIds?: string[];
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

const PLATFORM_META: Record<PublishPlatform, { label: string; color: string; format: string }> = {
  youtube: { label: 'YouTube', color: '#ff0000', format: 'Shorts / Video' },
  tiktok: { label: 'TikTok', color: '#111827', format: '9:16 短视频' },
  instagram: { label: 'Instagram', color: '#c13584', format: 'Reels' },
  facebook: { label: 'Facebook', color: '#1877f2', format: 'Reels / Page Video' },
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

function browserVideoUrl(value: string | undefined): string {
  const candidate = String(value || '').trim();
  if (/^(?:https?:\/\/|blob:|data:video\/)/i.test(candidate)) return candidate;
  if (/^\/(?:api\/|media\/|covers\/|generated\/)/i.test(candidate)) return candidate;
  return '';
}

function createPublishItem(draft?: PublishDraftItem | null, targetAccountIds: string[] = []): PublishQueueItem {
  const sourcePlatform = draft?.platform;
  const initialCopy: Record<string, PlatformCopy> = sourcePlatform
    ? {
      [sourcePlatform]: sourcePlatform === 'youtube'
        ? { title: draft?.title || '', description: draft?.description || '' }
        : sourcePlatform === 'facebook'
          ? { text: draft?.description || '' }
          : { caption: draft?.description || '' },
    }
    : {};
  return {
    id: publishItemId(),
    selected: Boolean(draft?.videoPath?.trim()),
    videoPath: draft?.videoPath || '',
    previewUrl: draft?.previewUrl || browserVideoUrl(draft?.videoPath),
    title: draft?.title || '',
    description: draft?.description || '',
    ratio: draft?.ratio,
    sourceProjectId: draft?.sourceProjectId,
    sourcePlatform,
    targetAccountIds,
    platformCopy: initialCopy,
    firstComment: '',
    trackWaLink: true,
    deliveryMode: 'now',
    scheduledAt: '',
    status: 'draft',
    completedTargets: 0,
  };
}

function expandPublishDraft(draft?: PublishDraft | null): PublishDraftItem[] {
  if (!draft) return [];
  const { items, ...base } = draft;
  if (!items?.length) return [base];
  return items.map(item => ({ ...base, ...item }));
}

function createPublishItems(draft?: PublishDraft | null, targetAccountIds: string[] = []): PublishQueueItem[] {
  const drafts = expandPublishDraft(draft).filter(item => Boolean(item.videoPath?.trim()));
  return drafts.length
    ? drafts.map(item => createPublishItem(item, targetAccountIds))
    : draft ? [] : [createPublishItem(null, targetAccountIds)];
}

function mergePublishItems(previous: PublishQueueItem[], additions: PublishQueueItem[]): PublishQueueItem[] {
  if (!additions.length) return previous;
  const onlyBlank = previous.length === 1 && !previous[0].videoPath.trim() && !previous[0].title.trim();
  const replacementProjectIds = new Set(additions.map(item => item.sourceProjectId).filter(Boolean));
  const base = onlyBlank
    ? []
    : previous.filter(item => !item.sourceProjectId || !replacementProjectIds.has(item.sourceProjectId));
  const existingKeys = new Set(base.map(item => item.videoPath.trim() || item.title.trim()).filter(Boolean));
  const unique = additions.filter(item => {
    const key = item.videoPath.trim() || item.title.trim();
    if (!key || existingKeys.has(key)) return false;
    existingKeys.add(key);
    return true;
  });
  return unique.length ? [...base, ...unique] : previous;
}

function dateTimeLocalValue(date: Date): string {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function nextScheduleValue(): string {
  const next = new Date(Date.now() + 60 * 60_000);
  next.setMinutes(next.getMinutes() < 30 ? 30 : 0, 0, 0);
  if (next.getMinutes() === 0) next.setHours(next.getHours() + 1);
  return dateTimeLocalValue(next);
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
  ready: { label: '待发布', className: 'bg-emerald-50 text-emerald-700' },
  publishing: { label: '发布中', className: 'bg-sky-50 text-sky-700' },
  scheduled: { label: '已排期', className: 'bg-violet-50 text-violet-700' },
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
      const initialView = localStorage.getItem('lingshu:traffic:initial-view') as ViewMode | null;
      localStorage.removeItem('lingshu:traffic:initial-view');
      if (initialView && ['materials', 'create', 'publish', 'accounts'].includes(initialView)) return initialView;
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
        label: '账号动态',
        summary: '当前在账号动态，适合查看账号表现，以及识别评论中的高意向商机。',
        suggestions: ['查看待回复高意向评论', '判断评论采购意图', '生成真人化回复', '复盘账号表现'],
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

  const handleReturnToPreview = (projectId?: string) => {
    try {
      localStorage.setItem('ow_publish_return_to_preview', JSON.stringify({
        at: Date.now(),
        projectId: projectId || publishDraft?.sourceProjectId || readStoredPublishDraft()?.sourceProjectId || '',
      }));
    } catch { /* ignore */ }
    setViewMode('create');
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
            { mode: 'materials' as ViewMode, icon: <Film size={18} />, label: '灵感大屏', guide: 'social-inspiration' },
            { mode: 'create' as ViewMode, icon: <Wand2 size={18} />, label: 'AI智能素材', guide: 'ai-create' },
            { mode: 'publish' as ViewMode, icon: <Send size={18} />, label: '一键发布', guide: 'publishing-workbench' },
            { mode: 'accounts' as ViewMode, icon: <BarChart3 size={18} />, label: '账号动态', guide: 'social-performance' },
          ].map(({ mode, icon, label, guide }) => {
            const active = viewMode === mode;
            return (
              <button
                key={mode}
                type="button"
                data-lingshu-guide={guide}
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
              <SocialPublishPanel onNavigate={onNavigate} draft={publishDraft} onReturnToPreview={handleReturnToPreview} />
            </motion.div>
          ) : (
            <motion.div key="accounts" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="h-full overflow-y-auto">
              <AccountActivity />
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}

function SocialPublishPanel({ onNavigate, draft, onReturnToPreview }: { onNavigate?: (p: Page) => void; draft?: PublishDraft | null; onReturnToPreview?: (projectId?: string) => void }) {
  const [workspaceTab, setWorkspaceTab] = useState<'schedule' | 'publish'>(() => draft || readStoredPublishDraft() ? 'publish' : 'schedule');
  const [accounts, setAccounts] = useState<PublishAccount[]>([]);
  const [items, setItems] = useState<PublishQueueItem[]>(() => createPublishItems(draft || readStoredPublishDraft()));
  const [activeItemId, setActiveItemId] = useState('');
  const [loading, setLoading] = useState(true);
  const [uploadingVideos, setUploadingVideos] = useState(false);
  const [savingContent, setSavingContent] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishConfirmationOpen, setPublishConfirmationOpen] = useState(false);
  const [adapting, setAdapting] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [calendarRefreshKey, setCalendarRefreshKey] = useState(0);
  const [contentEditorMode, setContentEditorMode] = useState<'common' | 'platform'>('common');
  const [pendingTargetAccountIds, setPendingTargetAccountIds] = useState<string[]>([]);
  const accountTargetsSeededRef = useRef(false);
  const pendingAccountTargetsSeededRef = useRef(false);
  const appliedDraftRef = useRef(JSON.stringify(draft || readStoredPublishDraft() || {}));
  const materializedVideoPathsRef = useRef(new Set<string>());
  const videoInputRef = useRef<HTMLInputElement | null>(null);
  const publishSettingsRef = useRef<HTMLElement | null>(null);

  const connectedAccounts = accounts.filter(account => account.status === 'connected');
  const activeItem = items.find(item => item.id === activeItemId) || items[0] || null;
  const activePreviewUrl = activeItem?.previewUrl || browserVideoUrl(activeItem?.videoPath);
  const activeCalendarPost = Boolean(activeItem?.calendarPostIds?.length);
  const pendingCalendarItems = items
    .filter(item => (
      ['ready', 'partial', 'failed'].includes(item.status) &&
      Boolean(item.videoPath.trim() || item.title.trim() || item.sourceProjectId || item.sourcePlatform)
    ))
    .map(item => ({
      id: item.id,
      title: item.title || titleFromVideoPath(item.videoPath),
      description: item.description,
      sourceProjectId: item.sourceProjectId,
      sourcePlatform: item.sourcePlatform,
      platforms: Array.from(new Set(
        connectedAccounts
          .filter(account => item.targetAccountIds.includes(account.id))
          .map(account => account.platform),
      )),
      deliveryMode: item.deliveryMode,
      scheduledAt: item.scheduledAt,
      status: item.status,
    }));
  const selectedTargetAccountIds = activeItem?.targetAccountIds ?? pendingTargetAccountIds;
  const selectedConnectedAccounts = connectedAccounts.filter(account => selectedTargetAccountIds.includes(account.id));
  const selectedPlatforms = Array.from(new Set(selectedConnectedAccounts.map(account => account.platform)));
  const connectedAccountIds = new Set(connectedAccounts.map(account => account.id));
  const totalAssignments = items.reduce(
    (sum, item) => sum + item.targetAccountIds.filter(id => connectedAccountIds.has(id)).length,
    0,
  );
  const selectedAssignments = items.reduce(
    (sum, item) => item.selected ? sum + item.targetAccountIds.filter(id => connectedAccountIds.has(id)).length : sum,
    0,
  );
  const publishableItems = items.filter(item => (
    item.selected &&
    item.videoPath.trim() &&
    item.title.trim() &&
    item.targetAccountIds.some(id => connectedAccountIds.has(id)) &&
    ['ready', 'partial', 'failed'].includes(item.status)
  ));
  const immediateItems = publishableItems.filter(item => item.deliveryMode === 'now');
  const scheduledItems = publishableItems.filter(item => item.deliveryMode === 'schedule' && Boolean(item.scheduledAt));
  const publishableAssignments = publishableItems.reduce(
    (sum, item) => sum + item.targetAccountIds.filter(id => connectedAccountIds.has(id)).length,
    0,
  );

  const updateItem = (id: string, patch: Partial<PublishQueueItem>) => {
    setItems(prev => prev.map(item => item.id === id ? { ...item, ...patch } : item));
  };

  const selectedQueueItems = items.filter(item => item.selected);
  const selectableQueueItems = items.filter(item => item.videoPath.trim());
  const allQueueItemsSelected = selectableQueueItems.length > 0 && selectableQueueItems.every(item => item.selected);
  const toggleAllQueueItems = () => {
    const selected = !allQueueItemsSelected;
    setItems(previous => previous.map(item => ({ ...item, selected: Boolean(item.videoPath.trim()) && selected })));
  };

  const setDeliveryMode = (mode: DeliveryMode) => {
    if (!activeItem) return;
    updateItem(activeItem.id, {
      deliveryMode: mode,
      scheduledAt: mode === 'schedule' ? (activeItem.scheduledAt || nextScheduleValue()) : activeItem.scheduledAt,
      status: 'draft',
      error: undefined,
    });
  };

  const scheduleForCalendarDate = (date: Date) => {
    let scheduled = new Date(date);
    scheduled.setHours(20, 0, 0, 0);
    if (scheduled.getTime() <= Date.now()) {
      scheduled = new Date(Date.now() + 60 * 60_000);
      scheduled.setMinutes(scheduled.getMinutes() < 30 ? 30 : 0, 0, 0);
      if (scheduled.getMinutes() === 0) scheduled.setHours(scheduled.getHours() + 1);
    }
    const scheduledAt = dateTimeLocalValue(scheduled);
    if (activeItem) {
      updateItem(activeItem.id, { deliveryMode: 'schedule', scheduledAt, status: 'draft', error: undefined });
    } else {
      const next = {
        ...createPublishItem(null, connectedAccounts.map(account => account.id)),
        deliveryMode: 'schedule' as const,
        scheduledAt,
      };
      setItems([next]);
      setActiveItemId(next.id);
    }
    setNotice(`已把当前视频安排到 ${scheduled.toLocaleString('zh-CN', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}，补齐素材后即可加入日历。`);
    window.setTimeout(() => publishSettingsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60);
  };

  const openPendingContent = (id: string) => {
    const item = items.find(candidate => candidate.id === id);
    if (!item) return;
    setActiveItemId(id);
    setWorkspaceTab('publish');
    setNotice(`已打开“${item.title || titleFromVideoPath(item.videoPath)}”，可以继续编辑或安排发布时间。`);
    window.setTimeout(() => document.getElementById('publishing-content-editor')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60);
  };

  const saveCurrentContent = async () => {
    if (!activeItem) return;
    const targets = connectedAccounts.filter(account => activeItem.targetAccountIds.includes(account.id));
    if (!activeItem.videoPath.trim()) { setError('请先上传视频'); return; }
    if (!targets.length) { setError('请先选择至少一个发布平台账号'); return; }
    if (!activeItem.title.trim()) { setError('请填写视频标题'); return; }
    if (!activeItem.description.trim()) { setError('请填写发布文案'); return; }
    if (activeItem.calendarPostIds?.length) {
      const calendarPlatform = activeItem.sourcePlatform || selectedPlatforms[0];
      const platformTargets = calendarPlatform
        ? targets.filter(account => account.platform === calendarPlatform)
        : targets;
      const copy = calendarPlatform ? activeItem.platformCopy[calendarPlatform] : undefined;
      setSavingContent(true);
      setError('');
      try {
        await Promise.all(activeItem.calendarPostIds.map(postId => fetchJson(`/api/overseas/publishing/calendar/${postId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: calendarPlatform ? platformTitle(calendarPlatform, copy, activeItem.title.trim()) : activeItem.title.trim(),
            description: calendarPlatform ? platformBody(calendarPlatform, copy, activeItem.description.trim()) : activeItem.description.trim(),
            firstComment: copy?.firstComment || activeItem.firstComment,
            videoPath: activeItem.videoPath.trim(),
            targetAccountIds: platformTargets.map(account => account.id),
            targetAccountLabels: platformTargets.map(account => account.handle || account.title),
            trackWaLink: activeItem.trackWaLink,
          }),
        })));
        updateItem(activeItem.id, {
          status: 'ready',
          deliveryMode: 'now',
          error: undefined,
        });
        setCalendarRefreshKey(value => value + 1);
        setNotice(`“${activeItem.title.trim()}”的日历内容已保存，可以确认真实发布。`);
      } catch (saveError) {
        setError(saveError instanceof Error ? saveError.message : '保存日历内容失败');
      } finally {
        setSavingContent(false);
      }
      return;
    }
    const scheduledAt = activeItem.scheduledAt || nextScheduleValue();
    updateItem(activeItem.id, {
      status: 'ready',
      deliveryMode: 'schedule',
      scheduledAt,
      error: undefined,
    });
    setError('');
    setNotice(`“${activeItem.title.trim()}”已保存并进入待发布内容。`);
    setWorkspaceTab('schedule');
    window.setTimeout(() => document.getElementById('publishing-calendar')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
  };

  const schedulePendingContent = async (id: string, scheduledAt: Date): Promise<number> => {
    const item = items.find(candidate => candidate.id === id);
    if (!item || !['ready', 'partial', 'failed'].includes(item.status)) throw new Error('这条视频还没有保存到待发布内容');
    if (!Number.isFinite(scheduledAt.getTime()) || scheduledAt.getTime() <= Date.now()) throw new Error('计划发布时间必须晚于当前时间');
    const targets = connectedAccounts.filter(account => item.targetAccountIds.includes(account.id));
    if (!targets.length) throw new Error('这条视频还没有选择可用的发布账号');

    const createdIds: string[] = [];
    const failures: string[] = [];
    for (const postId of item.calendarPostIds || []) {
      try { await fetchJson(`/api/overseas/publishing/calendar/${postId}`, { method: 'DELETE' }); } catch { /* stale placeholder */ }
    }
    const platforms = Array.from(new Set(targets.map(account => account.platform)));
    for (const platform of platforms) {
      const platformAccounts = targets.filter(account => account.platform === platform);
      const copy = item.platformCopy[platform];
      try {
        const result = await fetchJson<{ item: CalendarPost }>('/api/overseas/publishing/calendar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            scheduledAt: scheduledAt.toISOString(),
            platform,
            title: platformTitle(platform, copy, item.title.trim()),
            description: platformBody(platform, copy, item.description.trim()),
            contentId: item.sourceProjectId,
            firstComment: copy?.firstComment || item.firstComment,
            videoPath: item.videoPath.trim(),
            targetAccountIds: platformAccounts.map(account => account.id),
            targetAccountLabels: platformAccounts.map(account => account.handle || account.title),
            trackWaLink: item.trackWaLink,
          }),
        });
        createdIds.push(result.item.id);
      } catch (scheduleError) {
        failures.push(`${PLATFORM_META[platform].label}：${scheduleError instanceof Error ? scheduleError.message : '排期失败'}`);
      }
    }
    updateItem(item.id, {
      deliveryMode: 'schedule',
      scheduledAt: dateTimeLocalValue(scheduledAt),
      status: failures.length ? (createdIds.length ? 'partial' : 'ready') : 'scheduled',
      calendarPostIds: createdIds.length ? createdIds : undefined,
      completedTargets: failures.length ? createdIds.length : targets.length,
      error: failures.length ? failures.join('；') : undefined,
    });
    setCalendarRefreshKey(value => value + 1);
    if (failures.length) throw new Error(failures.join('；'));
    setNotice(`“${item.title}”已安排到 ${scheduledAt.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}。`);
    return createdIds.length;
  };

  const openCalendarPost = (post: CalendarPost) => {
    if (post.platformPostId || post.status === 'published') {
      setError('这条内容已经发布，不能再次提交平台');
      setWorkspaceTab('publish');
      return;
    }
    if (post.status === 'publishing') {
      setError('这条内容正在提交平台，请等待发布结果，避免重复发布');
      setWorkspaceTab('publish');
      return;
    }
    if (post.status === 'partial') {
      void fetchJson<{ item: CalendarPost }>(`/api/overseas/publishing/calendar/${post.id}/retry`, { method: 'POST' })
        .then(() => {
          setNotice(`“${post.title}”会仅重试尚未成功的账号，已发布账号不会重复提交。`);
          setCalendarRefreshKey(value => value + 1);
        })
        .catch(retryError => setError(retryError instanceof Error ? retryError.message : '重试发布失败'));
      setWorkspaceTab('publish');
      return;
    }
    const fallbackTargetIds = connectedAccounts
      .filter(account => account.platform === post.platform)
      .map(account => account.id);
    const targetAccountIds = (post.targetAccountIds || []).filter(id => connectedAccountIds.has(id));
    const patch: Partial<PublishQueueItem> = {
      videoPath: post.videoPath || '',
      previewUrl: post.videoPreviewUrl || post.videoUrl || browserVideoUrl(post.videoPath),
      title: post.title,
      description: post.description || '',
      sourcePlatform: post.platform in PLATFORM_META ? post.platform as PublishPlatform : undefined,
      targetAccountIds: targetAccountIds.length ? targetAccountIds : fallbackTargetIds,
      firstComment: post.firstComment || '',
      trackWaLink: post.trackWaLink !== false,
      deliveryMode: 'now',
      scheduledAt: dateTimeLocalValue(new Date(post.publishedAt)),
      calendarPostIds: [post.id],
      status: 'draft',
      completedTargets: 0,
      error: undefined,
    };
    const existing = items.find(item => item.calendarPostIds?.includes(post.id));
    if (existing) {
      updateItem(existing.id, patch);
      setActiveItemId(existing.id);
    } else {
      const next = { ...createPublishItem(null), ...patch } as PublishQueueItem;
      setItems(previous => [...previous, next]);
      setActiveItemId(next.id);
    }
    setNotice(`已将“${post.title}”带回发布队列。确认素材和账号后，可直接提交平台。`);
    setWorkspaceTab('publish');
    window.setTimeout(() => publishSettingsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60);
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
      if (!pendingAccountTargetsSeededRef.current) {
        setPendingTargetAccountIds(next.filter(account => account.status === 'connected').map(account => account.id));
        pendingAccountTargetsSeededRef.current = true;
      }
      if (!accountTargetsSeededRef.current) {
        const connected = next.filter(account => account.status === 'connected');
        setItems(prev => prev.map(item => {
          if (item.targetAccountIds.length) return item;
          const matchingSource = item.sourcePlatform
            ? connected.filter(account => account.platform === item.sourcePlatform)
            : [];
          return {
            ...item,
            targetAccountIds: (matchingSource.length ? matchingSource : connected).map(account => account.id),
          };
        }));
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
    const additions = createPublishItems(draft, connectedAccounts.map(account => account.id));
    setItems(prev => mergePublishItems(prev, additions));
    setActiveItemId(additions[0]?.id || '');
    setWorkspaceTab('publish');
    appliedDraftRef.current = fingerprint;
  }, [draft]);

  useEffect(() => {
    const pendingPaths = items
      .filter(item => item.videoPath.trim() && !item.previewUrl && !browserVideoUrl(item.videoPath))
      .map(item => item.videoPath.trim())
      .filter(videoPath => !materializedVideoPathsRef.current.has(videoPath));
    if (!pendingPaths.length) return;
    pendingPaths.forEach(videoPath => materializedVideoPathsRef.current.add(videoPath));
    void fetchJson<{ videos?: Array<{ sourcePath: string; videoPath?: string; previewUrl?: string; error?: string }> }>('/api/overseas/publishing/local-videos/import-rendered', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoPaths: pendingPaths }),
    }).then(result => {
      const imported = new Map((result.videos || []).map(video => [video.sourcePath, video]));
      setItems(previous => previous.map(item => {
        const video = imported.get(item.videoPath.trim());
        if (!video) return item;
        if (video.videoPath) return { ...item, videoPath: video.videoPath, previewUrl: video.previewUrl, selected: true, error: undefined };
        return { ...item, videoPath: '', previewUrl: undefined, selected: false, error: '原成片文件已失效，请返回 AI 智能素材重新生成此版本。' };
      }));
    }).catch(importError => {
      pendingPaths.forEach(videoPath => materializedVideoPathsRef.current.delete(videoPath));
      setError(importError instanceof Error ? importError.message : '无法读取已生成成片');
    });
  }, [items]);

  const toggleAccount = (accountId: string) => {
    const next = new Set(selectedTargetAccountIds);
    if (next.has(accountId)) next.delete(accountId);
    else next.add(accountId);
    if (activeItem) updateItem(activeItem.id, { targetAccountIds: Array.from(next), status: 'draft', error: undefined });
    else setPendingTargetAccountIds(Array.from(next));
  };

  const togglePlatform = (platform: PublishPlatform) => {
    const ids = connectedAccounts.filter(account => account.platform === platform).map(account => account.id);
    const next = new Set(selectedTargetAccountIds);
    const allSelected = ids.length > 0 && ids.every(id => next.has(id));
    ids.forEach(id => allSelected ? next.delete(id) : next.add(id));
    if (activeItem) updateItem(activeItem.id, { targetAccountIds: Array.from(next), status: 'draft', error: undefined });
    else setPendingTargetAccountIds(Array.from(next));
  };

  const selectAllAccounts = () => {
    const ids = connectedAccounts.map(account => account.id);
    if (activeItem) updateItem(activeItem.id, { targetAccountIds: ids, status: 'draft', error: undefined });
    else setPendingTargetAccountIds(ids);
  };

  const applyContentToAll = () => {
    if (!activeItem) return;
    const lockedStatuses: PublishItemStatus[] = ['publishing', 'scheduled', 'published'];
    const targetIds = new Set(
      items
        .filter(item => item.id !== activeItem.id && !lockedStatuses.includes(item.status))
        .map(item => item.id),
    );
    if (!targetIds.size) return;

    setItems(previous => previous.map(item => targetIds.has(item.id) ? {
      ...item,
      title: activeItem.title,
      description: activeItem.description,
      platformCopy: Object.fromEntries(
        Object.entries(activeItem.platformCopy).map(([platform, copy]) => [platform, {
          ...copy,
          tags: copy.tags ? [...copy.tags] : undefined,
          hashtags: copy.hashtags ? [...copy.hashtags] : undefined,
        }]),
      ),
      firstComment: activeItem.firstComment,
      trackWaLink: activeItem.trackWaLink,
      status: 'draft',
      error: undefined,
    } : item));
    setNotice(`已把当前视频的发布内容同步到另外 ${targetIds.size} 条视频，视频文件、平台账号和发布时间保持不变。`);
  };

  const duplicatePublishItem = (item: PublishQueueItem) => {
    const next: PublishQueueItem = {
      ...item,
      id: publishItemId(),
      platformCopy: { ...item.platformCopy },
      targetAccountIds: [...item.targetAccountIds],
      calendarPostIds: undefined,
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

  const addSelectedVideoFiles = async (fileList: FileList | null) => {
    const files = Array.from(fileList || []).filter(file => /\.(mp4|mov|webm|mkv|avi)$/i.test(file.name));
    if (!files.length) return;
    setUploadingVideos(true);
    setError('');
    setNotice('');
    const targetAccountIds = activeItem ? activeItem.targetAccountIds : pendingTargetAccountIds;
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
        const data = await response.json().catch(() => ({})) as { video?: { videoPath?: string; previewUrl?: string }; error?: string };
        if (!response.ok || !data.video?.videoPath) throw new Error(data.error || '视频接收失败');
        additions.push(createPublishItem({
          videoPath: data.video.videoPath,
          previewUrl: data.video.previewUrl,
          title: titleFromVideoPath(file.name),
          description: activeItem?.description || '',
          ratio: activeItem?.ratio,
          platform: activeItem?.sourcePlatform,
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
      setWorkspaceTab('publish');
      setNotice(`已加入 ${additions.length} 条视频，发布预览已启动。`);
      window.setTimeout(() => document.getElementById('publishing-video-preview')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 80);
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
        status: 'draft',
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : '生成平台文案失败');
    } finally {
      setAdapting(false);
    }
  };

  const requestPublishConfirmation = () => {
    if (!publishableItems.length) {
      setError('请至少配置一条含视频路径、标题和发布账号的视频');
      return;
    }
    setError('');
    setPublishConfirmationOpen(true);
  };

  const publishConfirmed = async () => {
    if (!publishableItems.length) {
      setPublishConfirmationOpen(false);
      setError('没有可发布的内容，请重新检查视频、标题和账号');
      return;
    }
    setPublishConfirmationOpen(false);
    setPublishing(true);
    setNotice('');
    setError('');
    let successfulTargets = 0;
    let scheduledTargets = 0;
    let failedTargets = 0;
    let skippedItems = 0;

    for (const item of items) {
      if (!item.selected) continue;
      if (item.status === 'published' || item.status === 'scheduled') continue;
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
      if (item.deliveryMode === 'schedule') {
        const scheduledTime = Date.parse(item.scheduledAt);
        if (!Number.isFinite(scheduledTime) || scheduledTime <= Date.now()) {
          skippedItems += 1;
          updateItem(item.id, {
            status: 'failed',
            completedTargets: 0,
            error: '请选择未来的排期时间',
          });
          continue;
        }
        updateItem(item.id, { status: 'publishing', completedTargets: 0, error: undefined });
        const itemFailures: string[] = [];
        const createdIds: string[] = [];
        for (const postId of item.calendarPostIds || []) {
          try {
            await fetchJson(`/api/overseas/publishing/calendar/${postId}`, { method: 'DELETE' });
          } catch {
            // The previous placeholder may already have been removed; creating the new plan can continue.
          }
        }
        const platforms = Array.from(new Set(targets.map(account => account.platform)));
        for (const platform of platforms) {
          const platformAccounts = targets.filter(account => account.platform === platform);
          const copy = item.platformCopy[platform];
          try {
            const result = await fetchJson<{ item: CalendarPost }>('/api/overseas/publishing/calendar', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                scheduledAt: new Date(scheduledTime).toISOString(),
                platform,
                title: platformTitle(platform, copy, item.title.trim()),
                description: platformBody(platform, copy, item.description.trim()),
                contentId: item.sourceProjectId,
                firstComment: copy?.firstComment || item.firstComment,
                videoPath: item.videoPath.trim(),
                targetAccountIds: platformAccounts.map(account => account.id),
                targetAccountLabels: platformAccounts.map(account => account.handle || account.title),
                trackWaLink: item.trackWaLink,
              }),
            });
            createdIds.push(result.item.id);
            scheduledTargets += platformAccounts.length;
          } catch (scheduleError) {
            failedTargets += platformAccounts.length;
            itemFailures.push(`${PLATFORM_META[platform].label}: ${scheduleError instanceof Error ? scheduleError.message : '加入排期失败'}`);
          }
        }
        updateItem(item.id, {
          status: itemFailures.length ? (createdIds.length ? 'partial' : 'failed') : 'scheduled',
          calendarPostIds: createdIds.length ? createdIds : item.calendarPostIds,
          completedTargets: targets.length,
          error: itemFailures.length ? itemFailures.join('；') : undefined,
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
      if (!itemFailures.length && itemSuccesses > 0 && item.calendarPostIds?.length) {
        await Promise.all(item.calendarPostIds.map(postId =>
          fetch(`/api/overseas/publishing/calendar/${postId}`, {
            method: 'DELETE',
            headers: authHeader(),
          }).catch(() => undefined),
        ));
      }
    }
    setPublishing(false);
    setCalendarRefreshKey(value => value + 1);
    if (failedTargets || skippedItems) setError(`${failedTargets} 个发布目标失败，${skippedItems} 条视频配置不完整；可在队列中查看并修改。`);
    if (successfulTargets) setNotice(`已完成 ${successfulTargets} 个账号发布，每条发布均生成独立追踪码。`);
    if (scheduledTargets) setNotice(previous => `${previous ? `${previous} ` : ''}已将 ${scheduledTargets} 个账号任务加入内容日历；系统会在设定时间自动发布到已选账号。`);
  };

  const previewRatio = activeItem?.ratio || (selectedPlatforms.length > 0 && selectedPlatforms.every(platform => platform === 'youtube') ? '16:9' : '9:16');

  return (
    <div className="px-6 pb-5 pt-3">
      <div className="mx-auto max-w-[1600px] space-y-4">
        <div className="flex justify-center">
          <div className="grid w-full max-w-xl grid-cols-2 gap-1 rounded-2xl border border-border bg-surface-2 p-1 shadow-sm">
            <button
              type="button"
              onClick={() => setWorkspaceTab('schedule')}
              className={`h-10 rounded-xl px-4 text-sm font-black transition-all ${workspaceTab === 'schedule' ? 'bg-white text-text-primary shadow-sm ring-1 ring-border' : 'text-text-muted hover:bg-white/60'}`}
            >
              内容排产工作台
            </button>
            <button
              type="button"
              onClick={() => setWorkspaceTab('publish')}
              className={`h-10 rounded-xl px-4 text-sm font-black transition-all ${workspaceTab === 'publish' ? 'bg-white text-text-primary shadow-sm ring-1 ring-border' : 'text-text-muted hover:bg-white/60'}`}
            >
              一键发布内容
            </button>
          </div>
        </div>

        {workspaceTab === 'schedule' ? (
        <section id="publishing-calendar" className="scroll-mt-5 rounded-2xl border border-border bg-surface/60 p-3 shadow-sm">
          <CalendarPlanner
            refreshKey={calendarRefreshKey}
            onCreate={scheduleForCalendarDate}
            onOpenPost={openCalendarPost}
            pendingItems={pendingCalendarItems}
            onOpenPending={openPendingContent}
            onSchedulePending={schedulePendingContent}
          />
        </section>
        ) : (
        <>

        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <section className="space-y-4">
        <section data-lingshu-guide="publishing-workbench" className="rounded-2xl border border-emerald-200 bg-white p-4 shadow-sm ring-1 ring-emerald-50">
          <div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-text-primary">发布队列</h3>
                <p className="mt-1 text-xs text-text-muted">所有产出版本 {items.length} 条 · 已选 {selectedQueueItems.length} 条 · {totalAssignments} 个发布目标</p>
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
                <button type="button" onClick={() => videoInputRef.current?.click()} disabled={uploadingVideos} className="inline-flex h-9 w-24 items-center justify-center gap-1.5 rounded-lg bg-accent text-xs font-bold text-white disabled:opacity-50">
                  {uploadingVideos ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                  {uploadingVideos ? '上传中' : '上传'}
                </button>
                <button
                  type="button"
                  onClick={applyContentToAll}
                  disabled={!activeItem || items.every(item => item.id === activeItem.id || ['publishing', 'scheduled', 'published'].includes(item.status))}
                  title="复制当前视频的标题、发布配文、分平台文案、首评和询盘追踪设置；不会覆盖视频文件、平台账号和发布时间"
                  className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-accent/30 bg-accent-glow px-3 text-xs font-bold text-accent hover:border-accent disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Copy size={13} /> 应用到全部视频
                </button>
                <button type="button" onClick={toggleAllQueueItems} className="inline-flex h-9 w-24 items-center justify-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 text-xs font-bold text-emerald-700">
                  <CheckCircle2 size={13} />
                  {allQueueItemsSelected ? '取消全选' : '全选'}
                </button>
              </div>
            </div>

            <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {items.map((item, index) => {
                const active = item.id === activeItem?.id;
                const status = PUBLISH_STATUS_META[item.status];
                const hasVideo = Boolean(item.videoPath.trim());
                const targetCount = item.targetAccountIds.filter(id => connectedAccountIds.has(id)).length;
                return (
                  <div key={item.id} className={`flex min-w-0 items-center gap-2 rounded-xl border p-2 transition-colors ${active ? 'border-accent bg-accent-glow' : 'border-border bg-surface'}`}>
                    <input
                      type="checkbox"
                      checked={item.selected}
                      onChange={event => updateItem(item.id, { selected: event.target.checked })}
                      disabled={!hasVideo}
                      aria-label={`选择素材 ${item.title || index + 1}`}
                      className="h-4 w-4 flex-shrink-0 rounded border-border text-emerald-600"
                    />
                    <button type="button" onClick={() => setActiveItemId(item.id)} className="min-w-0 flex-1 px-1.5 py-1 text-left">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-black text-text-muted">{String(index + 1).padStart(2, '0')}</span>
                        <span className="min-w-0 flex-1 truncate text-sm font-bold text-text-primary">{item.title || titleFromVideoPath(item.videoPath) || '待填写视频'}</span>
                        <span className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${hasVideo ? status.className : 'bg-amber-50 text-amber-700'}`}>{hasVideo ? status.label : '未生成成片'}</span>
                      </div>
                      <p className="mt-1 truncate text-[11px] text-text-muted">
                        {item.videoPath || '请返回 AI 智能素材生成该版本成片'} · {targetCount} 个账号 · {item.deliveryMode === 'now' ? '立即发布' : item.scheduledAt ? `排期 ${new Date(item.scheduledAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : '待选排期'}
                      </p>
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

        </section>

        <section data-lingshu-guide="publish-accounts" className="rounded-2xl border border-border bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-text-primary">平台账号选择</h3>
                <p className="mt-1 text-xs text-text-muted">当前视频已选择 {selectedConnectedAccounts.length} 个账号，覆盖 {selectedPlatforms.length} 个平台</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {Object.entries(PLATFORM_META).map(([platform, meta]) => {
                  const platformAccounts = connectedAccounts.filter(account => account.platform === platform);
                  const selected = platformAccounts.length > 0 && platformAccounts.every(account => selectedTargetAccountIds.includes(account.id));
                  return (
                    <button key={platform} type="button" disabled={!platformAccounts.length} onClick={() => togglePlatform(platform as PublishPlatform)} className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-bold disabled:opacity-40 ${selected ? 'border-accent bg-accent-glow text-accent' : 'border-border text-text-secondary'}`}>
                      <SocialPlatformIcon platform={platform} size={15} /> {platformAccounts.length}
                    </button>
                  );
                })}
                <button type="button" onClick={selectAllAccounts} className="rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-bold text-text-secondary">全选</button>
              </div>
            </div>

          <div className="mt-3 grid gap-2 md:grid-cols-3">
            {loading ? (
              <div className="col-span-full flex items-center justify-center gap-2 rounded-xl border border-border bg-surface py-10 text-sm text-text-muted">
                <Loader2 size={16} className="animate-spin" /> 正在读取已授权账号...
              </div>
            ) : accounts.length === 0 ? (
              <div className="col-span-full rounded-xl border border-dashed border-border bg-surface px-4 py-8 text-center">
                <p className="text-sm font-bold text-text-primary">还没有已连接账号</p>
                <p className="mt-1 text-xs text-text-muted">请先进入集成中心完成 YouTube / TikTok / Instagram / Facebook 授权。</p>
              </div>
            ) : accounts.map(account => {
              const meta = PLATFORM_META[account.platform];
              const active = selectedTargetAccountIds.includes(account.id);
              return (
                <button key={account.id} type="button" onClick={() => toggleAccount(account.id)} disabled={account.status !== 'connected'} className={`rounded-xl border p-2.5 text-left transition-all disabled:cursor-not-allowed disabled:opacity-55 ${active ? 'border-accent bg-accent-glow shadow-sm' : 'border-border bg-surface hover:border-border-bright'}`}>
                  <div className="flex items-center justify-between gap-3">
                    {account.avatarUrl ? (
                      <img src={account.avatarUrl} alt={account.title} className="h-10 w-10 shrink-0 rounded-xl object-cover" />
                    ) : (
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white" style={{ background: meta.color }}>
                        <SocialPlatformIcon platform={account.platform} size={20} />
                      </span>
                    )}
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${account.status === 'connected' ? 'bg-green-50 text-green-700' : 'bg-slate-100 text-text-muted'}`}>
                      {account.status === 'connected' ? '已连接' : '需重新授权'}
                    </span>
                  </div>
                  <p className="mt-2 inline-flex items-center gap-1.5 text-sm font-bold text-text-primary"><SocialPlatformIcon platform={account.platform} size={16} /> {meta.label}</p>
                  <p className="mt-1 truncate text-xs font-semibold text-text-secondary">{account.handle || account.title}</p>
                  <p className="mt-2 text-xs text-text-muted">{meta.format}</p>
                </button>
              );
            })}
          </div>
        </section>

            <section id="publishing-content-editor" className="scroll-mt-24 rounded-2xl border border-border bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-bold text-text-primary">发布内容编辑</h3>
                  <p className="mt-1 text-xs text-text-muted">统一编辑通用内容，或切换到各平台的差异化文案。</p>
                </div>
                <div className="inline-grid grid-cols-2 gap-1 rounded-xl border border-border bg-surface-2 p-1">
                  <button type="button" onClick={() => setContentEditorMode('common')} className={`h-8 rounded-lg px-4 text-xs font-black transition ${contentEditorMode === 'common' ? 'bg-white text-text-primary shadow-sm' : 'text-text-muted hover:text-text-secondary'}`}>
                    通用内容
                  </button>
                  <button type="button" onClick={() => setContentEditorMode('platform')} className={`h-8 rounded-lg px-4 text-xs font-black transition ${contentEditorMode === 'platform' ? 'bg-white text-text-primary shadow-sm' : 'text-text-muted hover:text-text-secondary'}`}>
                    分平台内容
                  </button>
                </div>
              </div>
              {contentEditorMode === 'common' && (
              <div className="mt-4 space-y-3">
                <label className="block">
                  <span className="mb-1.5 block text-[11px] font-semibold text-text-secondary">素材文件</span>
                  <input value={activeItem?.videoPath || ''} onChange={event => activeItem && updateItem(activeItem.id, { videoPath: event.target.value, status: 'draft', error: undefined })} placeholder="/Users/.../rendered-video.mp4" className="w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm outline-none focus:border-accent" />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-[11px] font-semibold text-text-secondary">作品标题</span>
                  <input value={activeItem?.title || ''} onChange={event => activeItem && updateItem(activeItem.id, { title: event.target.value, status: 'draft', error: undefined })} placeholder="发布标题" className="w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm outline-none focus:border-accent" />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-[11px] font-semibold text-text-secondary">发布配文</span>
                  <textarea value={activeItem?.description || ''} onChange={event => activeItem && updateItem(activeItem.id, { description: event.target.value, status: 'draft', error: undefined })} rows={3} placeholder="输入卖点、脚本摘要和 hashtag" className="w-full resize-none rounded-xl border border-border bg-surface px-3 py-2.5 text-sm outline-none focus:border-accent" />
                </label>
                <div className="rounded-xl border border-emerald-100 bg-emerald-50/80 p-3">
                  <label className="flex cursor-pointer items-start gap-3">
                    <input type="checkbox" checked={activeItem?.trackWaLink ?? true} onChange={event => activeItem && updateItem(activeItem.id, { trackWaLink: event.target.checked, status: 'draft' })} className="mt-1 h-4 w-4 rounded border-border text-accent" />
                    <span>
                      <span className="flex items-center gap-1.5 text-xs font-black text-emerald-900"><SocialPlatformIcon platform="whatsapp" size={15} /> 已附带 WhatsApp 询盘链接</span>
                      <span className="mt-1 block text-[11px] leading-5 text-emerald-800">发布时自动生成短追踪码。买家首条消息带码后，客户来源会精确归因到这条内容。</span>
                    </span>
                  </label>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
                  <p className="text-[11px] text-text-muted">
                    {activeCalendarPost
                      ? '保存会同步更新内容日历；保存成功后可在右侧确认并真实发布。'
                      : '保存后进入待发布队列，可立即发布或排期。'}
                  </p>
                  <button
                    type="button"
                    onClick={() => void saveCurrentContent()}
                    disabled={savingContent || !activeItem || activeItem.status === 'publishing' || activeItem.status === 'scheduled' || activeItem.status === 'published'}
                    className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-black text-white shadow-sm hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    {savingContent ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                    {savingContent
                      ? '正在保存...'
                      : activeCalendarPost
                        ? activeItem?.status === 'ready' ? '日历修改已保存' : '保存日历修改'
                        : activeItem?.status === 'ready' ? '已保存到待发布内容' : '保存并加入待发布内容'}
                  </button>
                </div>
              </div>
              )}

              {contentEditorMode === 'platform' && (
              <div className="mt-4 border-t border-border pt-4">
              <div className="mt-4 flex justify-end">
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
                        <span className="inline-flex items-center gap-1.5 text-sm font-black text-text-primary"><SocialPlatformIcon platform={platform} size={16} /> {meta.label}</span>
                        <button type="button" onClick={() => void adaptCopy(platform)} className="rounded-lg border border-border px-2 py-1 text-[11px] font-bold text-text-secondary hover:border-accent hover:text-accent">换一版</button>
                      </div>
                      {platform === 'youtube' && (
                        <input value={platformTitle(platform, copy, activeItem?.title || '')} onChange={event => activeItem && updateItem(activeItem.id, { platformCopy: { ...activeItem.platformCopy, [platform]: { ...activeItem.platformCopy[platform], title: event.target.value } }, status: 'draft', error: undefined })} className="mt-3 w-full rounded-lg border border-border bg-white px-3 py-2 text-xs outline-none focus:border-accent" />
                      )}
                      <textarea value={body} onChange={event => activeItem && updateItem(activeItem.id, { platformCopy: { ...activeItem.platformCopy, [platform]: { ...activeItem.platformCopy[platform], ...(platform === 'facebook' ? { text: event.target.value } : platform === 'youtube' ? { description: event.target.value } : { caption: event.target.value }) } }, status: 'draft', error: undefined })} rows={4} className="mt-3 w-full resize-none rounded-lg border border-border bg-white px-3 py-2 text-xs outline-none focus:border-accent" />
                      <div className="mt-2 flex items-center justify-between text-[11px] text-text-muted">
                        <span>{body.length} 字符</span>
                        <span>{platform === 'tiktok' && body.length > 120 ? '超出建议长度' : '长度正常'}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
              </div>
              )}
            </section>
          </section>

          <aside ref={publishSettingsRef} className="scroll-mt-24 rounded-2xl border border-border bg-white p-4 shadow-sm xl:sticky xl:top-4 xl:max-h-[calc(100vh-7rem)] xl:overflow-y-auto">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-bold text-text-primary">发布设置</h3>
              <button
                type="button"
                onClick={() => onReturnToPreview?.(activeItem?.sourceProjectId || draft?.sourceProjectId || readStoredPublishDraft()?.sourceProjectId)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-bold text-text-secondary hover:border-accent hover:text-accent"
              >
                <ChevronLeft size={12} /> 返回成片预览
              </button>
            </div>
            <div data-lingshu-guide="publish-mode" className="mt-4 rounded-2xl border border-border bg-surface p-3">
              <p className="text-[11px] font-bold text-text-secondary">当前视频的发布方式</p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setDeliveryMode('now')}
                  className={`rounded-xl border px-3 py-2 text-xs font-black ${activeItem?.deliveryMode === 'now' ? 'border-accent bg-accent text-white' : 'border-border bg-white text-text-secondary'}`}
                >
                  立即发布
                </button>
                <button
                  type="button"
                  onClick={() => setDeliveryMode('schedule')}
                  className={`rounded-xl border px-3 py-2 text-xs font-black ${activeItem?.deliveryMode === 'schedule' ? 'border-violet-500 bg-violet-600 text-white' : 'border-border bg-white text-text-secondary'}`}
                >
                  加入排期
                </button>
              </div>
              {activeItem?.deliveryMode === 'schedule' && (
                <label className="mt-3 block">
                  <span className="mb-1.5 block text-[11px] font-semibold text-text-secondary">计划发布时间</span>
                  <input
                    type="datetime-local"
                    min={dateTimeLocalValue(new Date(Date.now() + 5 * 60_000))}
                    value={activeItem.scheduledAt}
                    onChange={event => updateItem(activeItem.id, { scheduledAt: event.target.value, status: 'draft', error: undefined })}
                    className="w-full rounded-xl border border-border bg-white px-3 py-2.5 text-xs outline-none focus:border-violet-400"
                  />
                </label>
              )}
            </div>
            <div id="publishing-video-preview" className="mt-4 scroll-mt-24 rounded-2xl border border-border bg-surface p-3">
              <div className="mb-3 flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-text-primary">发布预览</span>
                <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-bold text-accent shadow-sm">{previewRatio}</span>
              </div>
              <div className="flex justify-center">
                <div className="relative w-full overflow-hidden rounded-xl border border-border bg-black shadow-inner" style={{ aspectRatio: previewRatio === '16:9' ? '16 / 9' : '9 / 16', maxWidth: previewRatio === '16:9' ? 260 : 150 }}>
                  {activePreviewUrl ? (
                    <video
                      key={activePreviewUrl}
                      src={activePreviewUrl}
                      autoPlay
                      muted
                      loop
                      controls
                      playsInline
                      preload="metadata"
                      onLoadedData={event => { void event.currentTarget.play().catch(() => undefined); }}
                      className="h-full w-full object-contain"
                    />
                  ) : (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950 text-white/70">
                      <PlayCircle size={22} />
                      <span className="mt-2 text-[10px] font-bold">上传视频后自动预览</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <label className="mt-4 block">
              <span className="mb-1.5 block text-[11px] font-semibold text-text-secondary">首条评论</span>
              <textarea value={activeItem?.firstComment || ''} onChange={event => activeItem && updateItem(activeItem.id, { firstComment: event.target.value, status: 'draft' })} rows={3} placeholder="hashtags、wa.me 链接或补充说明。平台不支持时会记录 warning。" className="w-full resize-none rounded-xl border border-border bg-surface px-3 py-2.5 text-xs outline-none focus:border-accent" />
            </label>

            <div className="mt-5 rounded-xl border border-green-100 bg-green-50 p-3">
              <div className="flex items-center gap-2 text-xs font-bold text-green-700">
                <ShieldCheck size={14} />
                发布前检查
              </div>
              <ul className="mt-2 space-y-1 text-[11px] leading-relaxed text-green-800">
                <li>队列：{items.length} 条视频，{immediateItems.length} 条立即发布，{scheduledItems.length} 条加入排期</li>
                <li>目标：{totalAssignments} 个账号任务，覆盖 {new Set(items.flatMap(item => connectedAccounts.filter(account => item.targetAccountIds.includes(account.id)).map(account => account.platform))).size} 个平台</li>
                <li>当前视频追踪链接：{activeItem?.trackWaLink ? '开启' : '关闭'}</li>
              </ul>
            </div>
            {selectedPlatforms.includes('tiktok') && (
              <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-[10px] leading-5 text-amber-800">
                TikTok 正式公开发布前，还需按平台要求读取创作者信息，并让用户确认可见范围、评论、合拍和拼接选项；应用未通过审核时通常只能私密发布。
              </div>
            )}

            {notice && <div className="mt-4 flex items-start gap-2 rounded-xl border border-green-100 bg-green-50 px-3 py-2 text-xs text-green-700"><CheckCircle2 size={14} className="mt-0.5 flex-shrink-0" /><span>{notice}</span></div>}
            {error && <div className="mt-4 flex items-start gap-2 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-600"><AlertCircle size={14} className="mt-0.5 flex-shrink-0" /><span>{error}</span></div>}

            <button type="button" onClick={requestPublishConfirmation} disabled={publishing || loading || publishableItems.length === 0} className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3 text-sm font-bold text-white shadow-sm hover:brightness-95 disabled:opacity-50">
              {publishing ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
              {publishing
                ? '正在遍历账号群发...'
                : activeCalendarPost && activeItem?.deliveryMode === 'now'
                  ? `确认并真实发布 · ${publishableItems.length} 条`
                  : `群发选中素材 · ${publishableItems.length} 条 / ${selectedAssignments} 个账号目标`}
            </button>
          </aside>
        </div>
        {publishConfirmationOpen && (
          <div className="fixed inset-0 z-[180] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="publish-confirmation-title">
            <div className="w-full max-w-md rounded-2xl border border-border bg-white p-5 shadow-2xl">
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700"><Send size={18} /></span>
                <div>
                  <h3 id="publish-confirmation-title" className="text-base font-black text-text-primary">确认发布这些内容？</h3>
                  <p className="mt-1 text-xs leading-5 text-text-muted">立即发布会直接调用已授权平台账号；排期内容会在设定时间自动提交。两种方式都是真实发布，不是模拟操作。</p>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-3"><p className="text-[10px] font-bold text-emerald-700">立即真实发布</p><p className="mt-1 text-lg font-black text-emerald-900">{immediateItems.length} 条</p></div>
                <div className="rounded-xl border border-violet-100 bg-violet-50 p-3"><p className="text-[10px] font-bold text-violet-700">定时自动发布</p><p className="mt-1 text-lg font-black text-violet-900">{scheduledItems.length} 条</p></div>
              </div>
              <p className="mt-3 rounded-xl bg-surface px-3 py-2 text-[11px] leading-5 text-text-secondary">共 {publishableAssignments} 个账号目标。部分平台可能因审核、权限或素材规范拒绝发布，失败项会保留在队列中供修改后重试。</p>
              <div className="mt-5 flex justify-end gap-2">
                <button type="button" onClick={() => setPublishConfirmationOpen(false)} className="rounded-xl border border-border px-4 py-2.5 text-xs font-black text-text-secondary hover:bg-surface">返回检查</button>
                <button type="button" onClick={() => void publishConfirmed()} className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-black text-white hover:bg-emerald-700"><CheckCircle2 size={14} /> 确认真实发布</button>
              </div>
            </div>
          </div>
        )}
        </>
        )}
      </div>
    </div>
  );
}
