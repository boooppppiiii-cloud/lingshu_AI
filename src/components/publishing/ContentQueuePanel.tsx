import { useEffect, useMemo, useState } from 'react';
import { CalendarClock, Check, ChevronDown, Clock, Film, Play } from 'lucide-react';
import { authHeader } from '../../lib/auth';
import {
  campaignPhase,
  dateFromKey,
  type MarketId,
  type MarketingEvent,
} from './marketingCalendar';
import type { CalendarPost, PendingPublishContent } from './CalendarPlanner';
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
  return { id, scheduledAt, ...DEFAULT_TOPICS[index % DEFAULT_TOPICS.length] };
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
  utcOffset,
  posts,
  marketingEvents,
  pendingItems,
  onOpenPending,
  onSuggestionsChange,
  compact = false,
}: {
  selectedPlatform: string;
  selectedMarket: MarketId;
  marketLabel: string;
  marketTimeZone: string;
  utcOffset: number;
  posts: CalendarPost[];
  marketingEvents: MarketingEvent[];
  pendingItems: PendingPublishContent[];
  onOpenPending?: (id: string) => void;
  onSuggestionsChange: (suggestions: QueueSuggestion[]) => void;
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
  const [message, setMessage] = useState('');
  const [queueExpanded, setQueueExpanded] = useState(false);

  useEffect(() => {
    let active = true;
    setScheduleLoading(true);
    api<{ item: {
      id?: string;
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
    () => posts.filter(post => post.platform === selectedPlatform && Date.parse(post.publishedAt) > Date.now() - 30 * 60_000),
    [posts, selectedPlatform],
  );

  const suggestions = useMemo(() => upcomingSlots(schedule, 10)
    .filter(slot => !futurePosts.some(post => isSameSlot(new Date(post.publishedAt), slot.scheduledAt)))
    .map((slot, index) => defaultSuggestion(slot.id, slot.scheduledAt, index, marketingEvents, marketTimeZone)),
  [futurePosts, marketingEvents, marketTimeZone, schedule]);

  useEffect(() => {
    onSuggestionsChange(suggestions);
  }, [onSuggestionsChange, suggestions]);

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
      const data = await api<{ item: { id?: string } }>('/api/overseas/publishing/posting-schedule', {
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
      setMessage('发布节奏已保存');
    } catch {
      setMessage('当前页面已更新，保存失败请重试');
    } finally {
      setScheduleSaving(false);
    }
  };

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
            <h3 className="shrink-0 text-sm font-black text-text-primary">待发布内容</h3>
            <span className="truncate text-[10px] font-bold text-text-muted">{pendingItems.length} 条</span>
          </div>
          {pendingItems.length > 0 && (
            <button
              type="button"
              onClick={() => setQueueExpanded(previous => !previous)}
              className="inline-flex items-center gap-1 rounded-lg border border-border bg-white px-2 py-1.5 text-[10px] font-black text-text-secondary hover:border-emerald-200 hover:text-emerald-700"
              aria-expanded={queueExpanded}
            >
              {queueExpanded ? '收起' : '展开'}
              <ChevronDown size={11} className={`transition-transform ${queueExpanded ? 'rotate-180' : ''}`} />
            </button>
          )}
        </div>

        <div
          aria-label="待发布内容列表"
          tabIndex={0}
          className={`grid gap-2 p-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-400 ${
            queueExpanded
              ? `max-h-[360px] grid-cols-[repeat(auto-fill,minmax(172px,1fr))] overflow-y-auto [scrollbar-gutter:stable] ${compact ? 'max-h-[420px]' : ''}`
              : 'h-[128px] auto-cols-[172px] grid-flow-col grid-rows-1 overflow-x-auto overflow-y-hidden'
          }`}
        >
          {pendingItems.length === 0 ? (
            <div className="col-span-full flex h-[108px] items-center justify-center gap-3 rounded-xl border border-dashed border-emerald-200 bg-emerald-50/40 px-4 text-center">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-emerald-600 shadow-sm"><Film size={16} /></span>
              <div className="text-left">
                <p className="text-[11px] font-black text-text-primary">还没有待发布视频</p>
                <p className="mt-0.5 text-[9px] text-text-muted">AI 智能素材生成后，会自动出现在这里</p>
              </div>
            </div>
          ) : pendingItems.map(item => {
            const scheduledLabel = item.deliveryMode === 'schedule' && item.scheduledAt
              ? new Date(item.scheduledAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
              : '待安排日期';
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onOpenPending?.(item.id)}
                className={`group flex min-w-0 flex-col rounded-xl border border-emerald-200 bg-emerald-50/50 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-400 hover:shadow-md ${
                  queueExpanded ? 'h-[154px] p-2.5' : 'h-[108px] p-2'
                }`}
              >
                <span className="flex items-center justify-between gap-2">
                  <PlatformBadge platform={item.sourcePlatform || selectedPlatform} compact />
                  <span className="inline-flex items-center gap-1 rounded-full bg-white px-1.5 py-0.5 text-[8px] font-black text-emerald-700 shadow-sm">
                    <Play size={8} fill="currentColor" /> 待发布
                  </span>
                </span>
                <span className={`${queueExpanded ? 'mt-2 line-clamp-2' : 'mt-1.5 truncate'} text-[11px] font-black leading-[1.35] text-text-primary`}>
                  {item.title || '待填写标题的视频'}
                </span>
                {queueExpanded && item.description && (
                  <span className="mt-1 line-clamp-2 text-[9px] leading-relaxed text-text-muted">{item.description}</span>
                )}
                <span className="mt-auto flex items-center justify-between gap-2 text-[8px] font-bold text-text-muted">
                  <span className="truncate">{item.sourceProjectId || item.sourcePlatform ? 'AI 智能素材' : '发布队列'}</span>
                  <span className="shrink-0 text-emerald-700">{scheduledLabel}</span>
                </span>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
