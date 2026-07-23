import { useEffect, useMemo, useState } from 'react';
import {
  CalendarClock,
  Check,
  ChevronDown,
  ChevronUp,
  Clock,
  GripVertical,
  LockKeyhole,
  Plus,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import { authHeader } from '../../lib/auth';
import {
  campaignPhase,
  dateFromKey,
  type MarketId,
  type MarketingEvent,
} from './marketingCalendar';
import type { CalendarPost } from './CalendarPlanner';
import { PlatformBadge } from './PlatformBadge';

type RhythmPreset = 'light' | 'standard' | 'high';

type PostingSchedule = {
  id?: string;
  platform: string;
  market: MarketId;
  timeZone: string;
  utcOffset: number;
  preset: RhythmPreset;
  slots: Array<{ weekday: number; time: string }>;
};

export type QueueSuggestion = {
  id: string;
  scheduledAt: Date;
  title: string;
  brief: string;
  tags: string[];
  festival?: string;
};

type QueueEntry =
  | { kind: 'post'; id: string; scheduledAt: Date; post: CalendarPost }
  | { kind: 'suggestion'; id: string; scheduledAt: Date; suggestion: QueueSuggestion };

const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

const PRESETS: Array<{
  id: RhythmPreset;
  label: string;
  summary: string;
  weekdays: number[];
}> = [
  { id: 'light', label: '轻度', summary: '每周 3 条', weekdays: [1, 3, 5] },
  { id: 'standard', label: '标准', summary: '每周 5 条', weekdays: [1, 2, 3, 4, 5] },
  { id: 'high', label: '高频', summary: '每天 1 条', weekdays: [0, 1, 2, 3, 4, 5, 6] },
];

const DEFAULT_TOPICS = [
  {
    title: '主推产品：3 个采购决策点',
    brief: '从买家视角拆解用途、采购关注点和询盘入口，不补写未确认参数。',
    tags: ['主推品', '采购决策'],
  },
  {
    title: '工厂能力：从打样到交付',
    brief: '展示流程与交付节点，企业资料缺失的部分保持待确认。',
    tags: ['工厂实力', '交付'],
  },
  {
    title: '采购 FAQ：MOQ、定制与样品',
    brief: '围绕高频询盘组织短内容，引导买家索取目录和报价。',
    tags: ['采购FAQ', '询盘'],
  },
  {
    title: '质量证明：细节、包装与检验',
    brief: '用可拍摄的细节建立信任，只引用企业中心已有事实。',
    tags: ['质量', '信任'],
  },
  {
    title: '应用场景：买家如何使用这款产品',
    brief: '从使用场景切入，结尾保留清晰的 WhatsApp 询盘动作。',
    tags: ['场景', '转化'],
  },
];

function presetSlots(preset: RhythmPreset): Array<{ weekday: number; time: string }> {
  const selected = PRESETS.find(item => item.id === preset) ?? PRESETS[1];
  return selected.weekdays.map(weekday => ({ weekday, time: '20:00' }));
}

function timeParts(value: string): { hour: number; minute: number } {
  const [hour, minute] = value.split(':').map(Number);
  return {
    hour: Math.max(0, Math.min(23, hour || 0)),
    minute: Math.max(0, Math.min(59, minute || 0)),
  };
}

function targetToday(timeZone: string): Date {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = Object.fromEntries(formatter.formatToParts(new Date()).map(part => [part.type, part.value]));
  return new Date(Number(parts.year), Number(parts.month) - 1, Number(parts.day));
}

function instantForTargetSlot(day: Date, time: string, utcOffset: number): Date {
  const { hour, minute } = timeParts(time);
  const utc = Date.UTC(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute) - utcOffset * 3_600_000;
  return new Date(utc);
}

function upcomingSlots(schedule: PostingSchedule, limit = 10): Array<{ id: string; scheduledAt: Date }> {
  const now = new Date();
  const start = targetToday(schedule.timeZone);
  const slots: Array<{ id: string; scheduledAt: Date }> = [];
  for (let offset = 0; offset < 28 && slots.length < limit; offset += 1) {
    const targetDay = new Date(start);
    targetDay.setDate(targetDay.getDate() + offset);
    for (const slot of schedule.slots.filter(item => item.weekday === targetDay.getDay())) {
      const scheduledAt = instantForTargetSlot(targetDay, slot.time, schedule.utcOffset);
      if (scheduledAt.getTime() <= now.getTime() + 30 * 60_000) continue;
      slots.push({ id: `slot-${scheduledAt.toISOString()}`, scheduledAt });
    }
  }
  return slots.sort((left, right) => left.scheduledAt.getTime() - right.scheduledAt.getTime()).slice(0, limit);
}

function isSameSlot(left: Date, right: Date): boolean {
  return Math.abs(left.getTime() - right.getTime()) < 45 * 60_000;
}

function localDateKey(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function defaultSuggestion(
  id: string,
  scheduledAt: Date,
  index: number,
  events: MarketingEvent[],
  timeZone: string,
): QueueSuggestion {
  const event = events.find(item => campaignPhase(item, dateFromKey(localDateKey(scheduledAt, timeZone))));
  if (event && index % 4 === 0) {
    const phase = campaignPhase(event, dateFromKey(localDateKey(scheduledAt, timeZone)));
    return {
      id,
      scheduledAt,
      title: `${event.shortName}：${phase?.label || '营销'}内容`,
      brief: `围绕${event.shortName}组织备货、交付与询盘内容，不虚构折扣、库存或认证。`,
      tags: ['节庆', phase?.label || '营销'],
      festival: event.shortName,
    };
  }
  const topic = DEFAULT_TOPICS[index % DEFAULT_TOPICS.length];
  return { id, scheduledAt, ...topic };
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { ...authHeader(), ...(init?.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || 'request_failed');
  return data as T;
}

export function ContentQueuePanel({
  selectedPlatform,
  selectedMarket,
  marketLabel,
  marketTimeZone,
  marketTimeZoneLabel,
  utcOffset,
  posts,
  scores,
  marketingEvents,
  onCreate,
  onOpenPost,
  onConfirmed,
  suggestionOverrides,
  onSuggestionMove,
  onSuggestionsChange,
  onSuggestionDragState,
  highlightedSuggestionId,
  pinnedSuggestionId,
  onSuggestionHighlight,
  onSuggestionActivate,
  compact = false,
}: {
  selectedPlatform: string;
  selectedMarket: MarketId;
  marketLabel: string;
  marketTimeZone: string;
  marketTimeZoneLabel: string;
  utcOffset: number;
  posts: CalendarPost[];
  scores: Record<number, number[]>;
  marketingEvents: MarketingEvent[];
  onCreate?: (date: Date) => void;
  onOpenPost?: (post: CalendarPost) => void;
  onConfirmed: (post: CalendarPost) => void;
  suggestionOverrides: Record<string, string>;
  onSuggestionMove: (id: string, scheduledAt: Date) => void;
  onSuggestionsChange: (suggestions: QueueSuggestion[]) => void;
  onSuggestionDragState: (id: string) => void;
  highlightedSuggestionId: string;
  pinnedSuggestionId: string;
  onSuggestionHighlight: (id: string) => void;
  onSuggestionActivate: (id: string) => void;
  compact?: boolean;
}) {
  const [schedule, setSchedule] = useState<PostingSchedule>({
    platform: selectedPlatform,
    market: selectedMarket,
    timeZone: marketTimeZone,
    utcOffset,
    preset: 'standard',
    slots: presetSlots('standard'),
  });
  const [scheduleLoading, setScheduleLoading] = useState(true);
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const [actionId, setActionId] = useState('');
  const [dragId, setDragId] = useState('');
  const [suggestionEdits, setSuggestionEdits] = useState<Record<string, Pick<QueueSuggestion, 'title' | 'brief' | 'tags'>>>({});
  const [message, setMessage] = useState('');
  const [queueExpanded, setQueueExpanded] = useState(false);

  useEffect(() => {
    let active = true;
    setScheduleLoading(true);
    api<{ item: {
      id?: string;
      platform?: string;
      market?: MarketId;
      time_zone?: string;
      utc_offset?: number;
      preset?: RhythmPreset;
      slots?: Array<{ weekday: number; time: string }>;
    } }>(`/api/overseas/publishing/posting-schedule?platform=${encodeURIComponent(selectedPlatform)}`)
      .then(({ item }) => {
        if (!active) return;
        const preset = item.preset === 'light' || item.preset === 'high' ? item.preset : 'standard';
        setSchedule({
          id: item.id,
          platform: selectedPlatform,
          market: selectedMarket,
          timeZone: marketTimeZone,
          utcOffset,
          preset,
          slots: Array.isArray(item.slots) && item.slots.length ? item.slots : presetSlots(preset),
        });
      })
      .catch(() => {
        if (!active) return;
        setSchedule({
          platform: selectedPlatform,
          market: selectedMarket,
          timeZone: marketTimeZone,
          utcOffset,
          preset: 'standard',
          slots: presetSlots('standard'),
        });
      })
      .finally(() => {
        if (active) setScheduleLoading(false);
      });
    return () => { active = false; };
  }, [selectedPlatform]);

  useEffect(() => {
    setSchedule(previous => ({
      ...previous,
      platform: selectedPlatform,
      market: selectedMarket,
      timeZone: marketTimeZone,
      utcOffset,
    }));
  }, [marketTimeZone, selectedMarket, selectedPlatform, utcOffset]);

  const futurePosts = useMemo(
    () => posts
      .filter(post => post.platform === selectedPlatform && Date.parse(post.publishedAt) > Date.now() - 30 * 60_000)
      .sort((left, right) => Date.parse(left.publishedAt) - Date.parse(right.publishedAt)),
    [posts, selectedPlatform],
  );

  const baseSlots = useMemo(() => upcomingSlots(schedule, 10), [schedule]);

  const suggestions = useMemo(() => baseSlots
    .map((slot, index) => {
      const scheduledAt = suggestionOverrides[slot.id] ? new Date(suggestionOverrides[slot.id]) : slot.scheduledAt;
      const occupied = futurePosts.some(post => isSameSlot(new Date(post.publishedAt), scheduledAt));
      if (occupied) return null;
      const base = defaultSuggestion(slot.id, scheduledAt, index, marketingEvents, marketTimeZone);
      const edit = suggestionEdits[slot.id];
      return edit ? { ...base, ...edit, scheduledAt } : base;
    })
    .filter((item): item is QueueSuggestion => Boolean(item)),
  [baseSlots, futurePosts, marketingEvents, marketTimeZone, suggestionOverrides, suggestionEdits]);

  useEffect(() => {
    onSuggestionsChange(suggestions);
  }, [onSuggestionsChange, suggestions]);

  const queue = useMemo<QueueEntry[]>(() => [
    ...futurePosts.map(post => ({
      kind: 'post' as const,
      id: post.id,
      scheduledAt: new Date(post.publishedAt),
      post,
    })),
    ...suggestions.map(suggestion => ({
      kind: 'suggestion' as const,
      id: suggestion.id,
      scheduledAt: suggestion.scheduledAt,
      suggestion,
    })),
  ].sort((left, right) => {
    if (left.id === pinnedSuggestionId) return -1;
    if (right.id === pinnedSuggestionId) return 1;
    return left.scheduledAt.getTime() - right.scheduledAt.getTime();
  }).slice(0, 12), [futurePosts, pinnedSuggestionId, suggestions]);

  const savePreset = async (preset: RhythmPreset) => {
    const next: PostingSchedule = {
      ...schedule,
      platform: selectedPlatform,
      market: selectedMarket,
      timeZone: marketTimeZone,
      utcOffset,
      preset,
      slots: presetSlots(preset),
    };
    setSchedule(next);
    setScheduleSaving(true);
    setMessage('');
    try {
      const data = await api<{ item: {
        id?: string;
        platform: string;
        market: MarketId;
        time_zone: string;
        utc_offset: number;
        preset: RhythmPreset;
        slots: Array<{ weekday: number; time: string }>;
      } }>('/api/overseas/publishing/posting-schedule', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform: selectedPlatform,
          market: selectedMarket,
          timeZone: marketTimeZone,
          utcOffset,
          preset,
          slots: next.slots,
        }),
      });
      setSchedule(previous => ({ ...previous, id: data.item.id }));
      setMessage('发布节奏已保存，队列已按新槽位重排。');
    } catch {
      setMessage('节奏已在当前页面生效，服务器保存失败。');
    } finally {
      setScheduleSaving(false);
    }
  };

  const swapSlots = (sourceId: string, targetId: string) => {
    if (!sourceId || sourceId === targetId) return;
    const source = suggestions.find(item => item.id === sourceId);
    const target = suggestions.find(item => item.id === targetId);
    if (!source || !target) return;
    onSuggestionMove(sourceId, target.scheduledAt);
    onSuggestionMove(targetId, source.scheduledAt);
  };

  const moveToTop = (suggestion: QueueSuggestion) => {
    const first = suggestions[0];
    if (!first || first.id === suggestion.id) return;
    swapSlots(suggestion.id, first.id);
  };

  const regenerateWithLingshu = async (suggestion: QueueSuggestion) => {
    setActionId(suggestion.id);
    setMessage('');
    window.dispatchEvent(new CustomEvent('lingshu-assistant-open', {
      detail: {
        text: [
          '请为这条未来排产重新生成一版短视频内容建议，并说明新的标题、内容切入点和标签。',
          `当前平台：${selectedPlatform}`,
          `目标市场：${marketLabel}`,
          `计划时间：${suggestion.scheduledAt.toLocaleString('zh-CN')}`,
          `当前选题：${suggestion.title}`,
          `当前说明：${suggestion.brief}`,
          '不要虚构产品参数、认证、价格、库存或优惠。生成后我会继续在对话里告诉你修改意见。',
        ].join('\n'),
        context: {
          agent: 'traffic',
          label: '内容排产',
          summary: `正在为${marketLabel}的${selectedPlatform}未来排产调整内容建议。当前选题是“${suggestion.title}”，排期为${suggestion.scheduledAt.toLocaleString('zh-CN')}。`,
          suggestions: ['改得更像经验分享', '突出工厂交付能力', '换成采购 FAQ 角度', '保留节庆但弱化促销感'],
        },
      },
    }));
    try {
      const data = await api<{ suggestion: Pick<QueueSuggestion, 'title' | 'brief' | 'tags'> }>('/api/overseas/publishing/queue/suggestions/regenerate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform: selectedPlatform,
          market: marketLabel,
          scheduledAt: suggestion.scheduledAt.toISOString(),
          festival: suggestion.festival,
          currentTitle: suggestion.title,
        }),
      });
      setSuggestionEdits(previous => ({ ...previous, [suggestion.id]: data.suggestion }));
      setMessage('灵小枢已展开，并同步生成了一版新建议；你可以继续在对话里修改。');
    } catch {
      setMessage('灵小枢已展开，请直接在对话里继续修改这条建议。');
    } finally {
      setActionId('');
    }
  };

  const confirmSuggestion = async (suggestion: QueueSuggestion) => {
    setActionId(suggestion.id);
    setMessage('');
    try {
      const data = await api<{ item: CalendarPost }>('/api/overseas/publishing/calendar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scheduledAt: suggestion.scheduledAt.toISOString(),
          platform: selectedPlatform,
          title: suggestion.title,
          trackWaLink: true,
        }),
      });
      onConfirmed(data.item);
      setMessage('已确认并转移到内容日历。');
    } catch {
      setMessage('确认失败，请检查发布账号和企业资料后重试。');
    } finally {
      setActionId('');
    }
  };

  const nextOpenSlot = suggestions[0]?.scheduledAt;

  return (
    <div className={`grid items-start gap-3 ${compact ? '' : 'lg:grid-cols-[260px_minmax(0,1fr)]'}`}>
      <section data-lingshu-guide="publishing-rhythm" className="h-[168px] overflow-hidden rounded-2xl border border-border bg-white p-3 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-sky-50 text-sky-700">
              <Clock size={14} />
            </span>
            <h3 className="text-sm font-black text-text-primary">发布节奏</h3>
          </div>
          <span className="text-[10px] font-bold text-text-muted">{marketLabel}当地时间</span>
        </div>

        <div className="mt-2 grid grid-cols-3 gap-1.5">
          {PRESETS.map(preset => (
            <button
              key={preset.id}
              type="button"
              disabled={scheduleLoading || scheduleSaving}
              onClick={() => void savePreset(preset.id)}
              className={`rounded-lg border px-2 py-1.5 text-left transition ${
                schedule.preset === preset.id
                  ? 'border-emerald-300 bg-emerald-50 shadow-sm ring-1 ring-emerald-100'
                  : 'border-border bg-surface hover:border-emerald-200 hover:bg-emerald-50/40'
              }`}
            >
              <span className="flex items-center justify-between gap-1">
                <span className="text-[11px] font-black text-text-primary">{preset.label}</span>
                {schedule.preset === preset.id && <Check size={11} className="text-emerald-600" />}
              </span>
              <span className="mt-0.5 block whitespace-nowrap text-[9px] text-text-muted">{preset.summary}</span>
            </button>
          ))}
        </div>

        <div className="mt-2 flex max-h-[52px] flex-wrap gap-1 overflow-hidden">
          {schedule.slots.map(slot => (
            <span key={`${slot.weekday}-${slot.time}`} className="rounded-full border border-sky-100 bg-sky-50 px-1.5 py-0.5 text-[9px] font-bold text-sky-700">
              {WEEKDAY_LABELS[slot.weekday]} {slot.time}
            </span>
          ))}
        </div>
        {message && <p className="mt-1.5 line-clamp-1 text-[9px] font-bold text-emerald-700">{message}</p>}
      </section>

      <section data-lingshu-guide="future-queue" className={`overflow-hidden rounded-2xl border border-border bg-white shadow-sm ${queueExpanded ? '' : 'h-[168px]'}`}>
        <div className="flex h-10 items-center justify-between gap-2 border-b border-border px-3">
          <div className="flex min-w-0 items-center gap-2">
            <CalendarClock size={14} className="text-emerald-600" />
            <h3 className="shrink-0 text-sm font-black text-text-primary">未来排产队列</h3>
            <span className="truncate text-[10px] font-bold text-text-muted">{futurePosts.length} 已确认 · {suggestions.length} AI 建议</span>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={() => setQueueExpanded(previous => !previous)}
              className="inline-flex items-center gap-1 rounded-lg border border-border bg-white px-2 py-1.5 text-[10px] font-black text-text-secondary hover:border-emerald-200 hover:text-emerald-700"
              aria-expanded={queueExpanded}
            >
              {queueExpanded ? '收起' : '展开'}
              <ChevronDown size={11} className={`transition-transform ${queueExpanded ? 'rotate-180' : ''}`} />
            </button>
            <button
              type="button"
              disabled={!nextOpenSlot}
              onClick={() => nextOpenSlot && onCreate?.(nextOpenSlot)}
              className="inline-flex items-center gap-1 rounded-lg bg-slate-950 px-2.5 py-1.5 text-[10px] font-black text-white disabled:opacity-40"
            >
              <Plus size={12} /> 添加到空槽
            </button>
          </div>
        </div>

        <div
          aria-label="未来排产队列内容"
          tabIndex={0}
          className={`grid gap-2 p-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-400 ${
            queueExpanded
              ? `max-h-[360px] grid-cols-[repeat(auto-fill,minmax(172px,1fr))] overflow-y-auto [scrollbar-gutter:stable] ${compact ? 'max-h-[420px]' : ''}`
              : 'h-[128px] auto-cols-[172px] grid-flow-col grid-rows-1 overflow-x-auto overflow-y-hidden'
          }`}
        >
          {queue.map(entry => {
            const targetTime = entry.scheduledAt.toLocaleString('zh-CN', {
              timeZone: marketTimeZone,
              weekday: 'short',
              month: 'numeric',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            });
            const beijingTime = entry.scheduledAt.toLocaleTimeString('zh-CN', {
              timeZone: 'Asia/Shanghai',
              hour: '2-digit',
              minute: '2-digit',
            });
            const beijingHour = Number(entry.scheduledAt.toLocaleString('en-US', {
              timeZone: 'Asia/Shanghai',
              hour: '2-digit',
              hourCycle: 'h23',
            }));
            const tideScore = scores[entry.scheduledAt.getDay()]?.[beijingHour] || 0;

            if (entry.kind === 'post') {
              const post = entry.post;
              return (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => onOpenPost?.(post)}
                  className={`group flex min-w-0 flex-col rounded-xl border border-sky-200 bg-sky-50/70 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-sky-300 hover:shadow-md ${
                    queueExpanded ? 'h-[154px] p-2.5' : 'h-[108px] p-2'
                  }`}
                >
                  <span className="flex items-center justify-between gap-1">
                    <span className="truncate text-[10px] font-black text-text-primary">{targetTime}</span>
                    <span className="shrink-0 rounded-full bg-sky-100 px-1.5 py-0.5 text-[8px] font-black text-sky-700">已确认</span>
                  </span>
                  <span className={`${queueExpanded ? 'mt-1 flex' : 'hidden'} items-center justify-between gap-1 text-[8px] font-bold text-text-muted`}>
                    <span>北京 {beijingTime}</span>
                    <span className="inline-flex items-center gap-0.5"><LockKeyhole size={9} /> 时间锁定</span>
                  </span>
                  <span className={`${queueExpanded ? 'mt-2 line-clamp-2' : 'mt-1.5 truncate'} text-[11px] font-black leading-[1.35] text-text-primary`}>{post.title}</span>
                  <span className={`mt-auto ${queueExpanded ? 'space-y-1.5' : ''}`}>
                    <span className="flex items-center justify-between gap-1 text-[9px] text-text-muted">
                      <PlatformBadge platform={post.platform} compact />
                      {post.platformPostId ? <span className="font-black text-emerald-700">{post.inquiries} 询盘</span> : <span>等待发布</span>}
                    </span>
                    <span className={`${queueExpanded ? 'flex' : 'hidden'} items-center gap-1 text-[8px] font-bold text-emerald-600`}>
                      <i className="h-1 w-full overflow-hidden rounded-full bg-emerald-100"><i className="block h-full bg-emerald-500" style={{ width: `${Math.round(tideScore * 100)}%` }} /></i>
                      <span className="shrink-0">{Math.round(tideScore * 100)}</span>
                    </span>
                  </span>
                </button>
              );
            }

            const suggestion = entry.suggestion;
            const busy = actionId === suggestion.id;
            return (
              <div
                key={entry.id}
                draggable
                onMouseEnter={() => onSuggestionHighlight(suggestion.id)}
                onMouseLeave={() => onSuggestionHighlight('')}
                onClick={event => {
                  if (!(event.target as HTMLElement).closest('button')) onSuggestionActivate(suggestion.id);
                }}
                onMouseDown={event => {
                  if (event.button === 0 && !(event.target as HTMLElement).closest('button')) {
                    onSuggestionDragState(suggestion.id);
                  }
                }}
                onDragStart={event => {
                  setDragId(suggestion.id);
                  onSuggestionDragState(suggestion.id);
                  event.dataTransfer.effectAllowed = 'move';
                  event.dataTransfer.setData('application/x-lingshu-queue-suggestion', suggestion.id);
                  event.dataTransfer.setData('text/plain', suggestion.title);
                }}
                onDragEnd={() => {
                  setDragId('');
                  onSuggestionDragState('');
                }}
                onDragOver={event => event.preventDefault()}
                onDrop={event => {
                  event.preventDefault();
                  swapSlots(dragId, suggestion.id);
                  setDragId('');
                }}
                title={suggestion.brief}
                className={`flex min-w-0 cursor-grab flex-col rounded-xl border border-dashed bg-amber-50/70 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${
                  highlightedSuggestionId === suggestion.id || pinnedSuggestionId === suggestion.id
                    ? 'border-violet-400 bg-violet-50 ring-2 ring-violet-200 shadow-md'
                    : 'border-amber-300'
                } ${queueExpanded ? 'h-[154px] p-2.5' : 'h-[108px] p-2'}`}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="inline-flex min-w-0 items-center gap-1 text-[10px] font-black text-text-primary">
                    <GripVertical size={11} className="shrink-0 text-amber-400" />
                    <span className="truncate">{targetTime}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => moveToTop(suggestion)}
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-text-muted hover:bg-white hover:text-text-primary"
                    aria-label="移到首位"
                    title="移到首位"
                  >
                    <ChevronUp size={11} />
                  </button>
                </div>
                <div className="mt-1 flex items-center justify-between gap-1">
                  <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[8px] font-black ${
                    pinnedSuggestionId === suggestion.id ? 'bg-violet-100 text-violet-700' : 'bg-amber-100 text-amber-700'
                  }`}>
                    <Sparkles size={8} /> {pinnedSuggestionId === suggestion.id ? '日历拖动中' : 'AI 建议'}
                  </span>
                  <PlatformBadge platform={selectedPlatform} compact />
                </div>
                <p className={`${queueExpanded ? 'mt-1.5 line-clamp-2' : 'mt-1 truncate'} text-[11px] font-black leading-[1.35] text-text-primary`}>{suggestion.title}</p>
                <div className="mt-auto">
                  <div className={`${queueExpanded ? 'mb-1.5 flex' : 'hidden'} items-center justify-between gap-1 text-[8px] font-bold text-text-muted`}>
                    <span>北京 {beijingTime}</span>
                    <span className="inline-flex items-center gap-1 text-emerald-600">
                      <i className="h-1 w-8 overflow-hidden rounded-full bg-emerald-100"><i className="block h-full bg-emerald-500" style={{ width: `${Math.round(tideScore * 100)}%` }} /></i>
                      {Math.round(tideScore * 100)}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-1">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void confirmSuggestion(suggestion)}
                      className="inline-flex items-center justify-center gap-1 rounded-md bg-emerald-600 px-1.5 py-1.5 text-[9px] font-black text-white disabled:opacity-50"
                      aria-label="确认并转入日历"
                    >
                      <Check size={10} /> 确认
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void regenerateWithLingshu(suggestion)}
                      className="inline-flex items-center justify-center gap-1 rounded-md border border-amber-200 bg-white px-1.5 py-1.5 text-[9px] font-black text-amber-700 disabled:opacity-50"
                      aria-label="灵小枢换一版"
                    >
                      <RefreshCw size={10} className={busy ? 'animate-spin' : ''} /> 换一版
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
