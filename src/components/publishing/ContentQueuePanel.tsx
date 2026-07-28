import { useEffect, useMemo, useState } from 'react';
import { CalendarClock, Check, ChevronDown, Clock, Film, Loader2, Play, Sparkles } from 'lucide-react';
import { authHeader } from '../../lib/auth';
import type { MarketId } from './marketingCalendar';
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

export type PendingPlacement = { id: string; scheduledAt: Date };

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

function upcomingSlots(schedule: PostingSchedule, limit = 40): Array<{ id: string; scheduledAt: Date }> {
  const now = new Date();
  const start = targetToday(schedule.timeZone);
  const slots: Array<{ id: string; scheduledAt: Date }> = [];
  for (let offset = 0; offset < 56 && slots.length < limit; offset += 1) {
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
  pendingItems,
  onOpenPending,
  onArrangePending,
  compact = false,
}: {
  selectedPlatform: string;
  selectedMarket: MarketId;
  marketLabel: string;
  marketTimeZone: string;
  utcOffset: number;
  posts: CalendarPost[];
  pendingItems: PendingPublishContent[];
  onOpenPending?: (id: string) => void;
  onArrangePending?: (placements: PendingPlacement[]) => Promise<void>;
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
  const [arranging, setArranging] = useState(false);
  const [message, setMessage] = useState('');
  const [queueExpanded, setQueueExpanded] = useState(false);

  useEffect(() => {
    let active = true;
    setScheduleLoading(true);
    api<{ item: { id?: string; preset?: RhythmPreset; slots?: Array<{ weekday: number; time: string }> } }>(
      `/api/overseas/publishing/posting-schedule?platform=${encodeURIComponent(selectedPlatform)}`,
    )
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
    () => posts.filter(post => Date.parse(post.publishedAt) > Date.now() - 30 * 60_000),
    [posts],
  );
  const openSlots = useMemo(
    () => upcomingSlots(schedule).filter(slot => !futurePosts.some(post => isSameSlot(new Date(post.publishedAt), slot.scheduledAt))),
    [futurePosts, schedule],
  );

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

  const arrangeWithAi = async () => {
    const placements = pendingItems.slice(0, openSlots.length).map((item, index) => ({
      id: item.id,
      scheduledAt: openSlots[index].scheduledAt,
    }));
    if (!placements.length || !onArrangePending) return;
    setArranging(true);
    setMessage('');
    try {
      await onArrangePending(placements);
      setMessage(`已排布 ${placements.length} 条视频`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '自动排布失败');
    } finally {
      setArranging(false);
    }
  };

  return (
    <div className={`grid items-start gap-3 ${compact ? '' : 'lg:grid-cols-[260px_minmax(0,1fr)]'}`}>
      <section data-lingshu-guide="publishing-rhythm" className="h-[168px] overflow-hidden rounded-2xl border border-border bg-white p-3 shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-sky-50 text-sky-700"><Clock size={14} /></span>
            <div><h3 className="text-sm font-black text-text-primary">发布节奏</h3><p className="text-[9px] font-bold text-text-muted">{marketLabel}当地时间</p></div>
          </div>
          <button
            type="button"
            data-lingshu-guide="ai-layout"
            onClick={() => void arrangeWithAi()}
            disabled={arranging || scheduleLoading || scheduleSaving || pendingItems.length === 0 || openSlots.length === 0}
            className="inline-flex items-center gap-1 rounded-lg border border-violet-200 bg-violet-50 px-2 py-1.5 text-[10px] font-black text-violet-700 hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {arranging ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
            {arranging ? '排布中' : 'AI 帮我排布'}
          </button>
        </div>

        <div className="mt-2 grid grid-cols-3 gap-1.5">
          {PRESETS.map(preset => (
            <button
              key={preset.id}
              type="button"
              disabled={scheduleLoading || scheduleSaving || arranging}
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

        <div className="mt-2 flex max-h-[24px] flex-wrap gap-1 overflow-hidden">
          {schedule.slots.map(slot => (
            <span key={`${slot.weekday}-${slot.time}`} className="rounded-full border border-sky-100 bg-sky-50 px-1.5 py-0.5 text-[9px] font-bold text-sky-700">
              {WEEKDAY_LABELS[slot.weekday]} {slot.time}
            </span>
          ))}
        </div>
        {message && <p className="mt-1 line-clamp-1 text-[9px] font-bold text-emerald-700">{message}</p>}
      </section>

      <section data-lingshu-guide="future-queue" className={`overflow-hidden rounded-2xl border border-border bg-white shadow-sm ${queueExpanded ? '' : 'h-[168px]'}`}>
        <div className="flex h-10 items-center justify-between gap-2 border-b border-border px-3">
          <div className="flex min-w-0 items-center gap-2">
            <CalendarClock size={14} className="text-emerald-600" />
            <h3 className="shrink-0 text-sm font-black text-text-primary">待发布内容</h3>
            <span className="truncate text-[10px] font-bold text-text-muted">{pendingItems.length} 条 · 可拖入日历</span>
          </div>
          {pendingItems.length > 0 && (
            <button type="button" onClick={() => setQueueExpanded(previous => !previous)} className="inline-flex items-center gap-1 rounded-lg border border-border bg-white px-2 py-1.5 text-[10px] font-black text-text-secondary hover:border-emerald-200 hover:text-emerald-700" aria-expanded={queueExpanded}>
              {queueExpanded ? '收起' : '展开'}<ChevronDown size={11} className={`transition-transform ${queueExpanded ? 'rotate-180' : ''}`} />
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
              <div className="text-left"><p className="text-[11px] font-black text-text-primary">还没有待发布视频</p><p className="mt-0.5 text-[9px] text-text-muted">视频编辑完成并保存后，会出现在这里</p></div>
            </div>
          ) : pendingItems.map(item => {
            const scheduledLabel = item.scheduledAt
              ? new Date(item.scheduledAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
              : '20:00';
            const platforms = item.platforms?.length ? item.platforms : [item.sourcePlatform || selectedPlatform];
            return (
              <button
                key={item.id}
                type="button"
                draggable
                onDragStart={event => {
                  event.dataTransfer.effectAllowed = 'move';
                  event.dataTransfer.setData('application/x-lingshu-pending-content', item.id);
                  event.dataTransfer.setData('text/plain', item.title);
                }}
                onClick={() => onOpenPending?.(item.id)}
                className={`group flex min-w-0 cursor-grab flex-col rounded-xl border border-emerald-200 bg-emerald-50/50 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-400 hover:shadow-md active:cursor-grabbing ${queueExpanded ? 'h-[154px] p-2.5' : 'h-[108px] p-2'}`}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-1">{platforms.slice(0, 3).map(platform => <PlatformBadge key={platform} platform={platform} compact />)}</span>
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-white px-1.5 py-0.5 text-[8px] font-black text-emerald-700 shadow-sm"><Play size={8} fill="currentColor" /> 待发布</span>
                </span>
                <span className={`${queueExpanded ? 'mt-2 line-clamp-2' : 'mt-1.5 truncate'} text-[11px] font-black leading-[1.35] text-text-primary`}>{item.title || '待填写标题的视频'}</span>
                {queueExpanded && item.description && <span className="mt-1 line-clamp-2 text-[9px] leading-relaxed text-text-muted">{item.description}</span>}
                <span className="mt-auto flex items-center justify-between gap-2 text-[8px] font-bold text-text-muted">
                  <span className="truncate">{item.sourceProjectId || item.sourcePlatform ? 'AI 智能素材' : '已保存内容'}</span>
                  <span className="shrink-0 text-emerald-700">计划 {scheduledLabel}</span>
                </span>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
