import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Clock, Grid2X2, List, Plus, RefreshCw } from 'lucide-react';
import { authHeader } from '../../lib/auth';

export type CalendarPost = {
  id: string;
  platform: string;
  title: string;
  publishedAt: string;
  status: 'scheduled' | 'published' | string;
  coverUrl?: string;
  inquiries: number;
  isRecycle?: boolean;
  platformPostId?: string;
};

type ViewMode = 'week' | 'month' | 'list';

function startOfWeek(date: Date): Date {
  const next = new Date(date);
  const day = next.getDay();
  next.setDate(next.getDate() - day);
  next.setHours(0, 0, 0, 0);
  return next;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function iso(date: Date): string {
  return date.toISOString();
}

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function roundToHalfHour(date: Date): Date {
  const next = new Date(date);
  const minutes = next.getMinutes();
  next.setMinutes(minutes < 30 ? 0 : 30, 0, 0);
  return next;
}

function platformLabel(platform: string): string {
  if (platform === 'youtube') return 'YT';
  if (platform === 'tiktok') return 'TK';
  if (platform === 'instagram') return 'IG';
  if (platform === 'facebook') return 'FB';
  return platform.slice(0, 2).toUpperCase();
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(url, { ...init, headers: { ...authHeader(), ...(init?.headers || {}) } });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data?.error || 'request_failed');
  return data as T;
}

export function CalendarPlanner({
  onCreate,
  onOpenPost,
}: {
  onCreate?: (date: Date) => void;
  onOpenPost?: (post: CalendarPost) => void;
}) {
  const [mode, setMode] = useState<ViewMode>('week');
  const [anchor, setAnchor] = useState(() => new Date());
  const [items, setItems] = useState<CalendarPost[]>([]);
  const [scores, setScores] = useState<Record<number, number[]>>({});
  const [dragId, setDragId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const days = useMemo(() => {
    if (mode === 'month') {
      const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
      const start = startOfWeek(first);
      return Array.from({ length: 42 }, (_, index) => addDays(start, index));
    }
    const start = startOfWeek(anchor);
    return Array.from({ length: 7 }, (_, index) => addDays(start, index));
  }, [anchor, mode]);

  const range = useMemo(() => {
    const from = days[0];
    const to = addDays(days[days.length - 1], 1);
    return { from, to };
  }, [days]);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [calendar, scoreRows] = await Promise.all([
        api<{ items: CalendarPost[] }>(`/api/overseas/publishing/calendar?from=${encodeURIComponent(iso(range.from))}&to=${encodeURIComponent(iso(range.to))}`),
        Promise.all(days.slice(0, mode === 'month' ? 7 : days.length).map(day =>
          api<{ weekday: number; scores: number[] }>(`/api/overseas/publishing/best-time?platform=tiktok&weekday=${day.getDay()}`),
        )),
      ]);
      setItems(calendar.items || []);
      setScores(Object.fromEntries(scoreRows.map(row => [row.weekday, row.scores])));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'load_failed');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [range.from.toISOString(), range.to.toISOString(), mode]);

  const itemsByDay = useMemo(() => {
    const groups: Record<string, CalendarPost[]> = {};
    for (const item of items) {
      const key = dateKey(new Date(item.publishedAt));
      groups[key] = [...(groups[key] || []), item];
    }
    return groups;
  }, [items]);

  const reschedule = async (postId: string, day: Date, hour = 10) => {
    const target = roundToHalfHour(new Date(day));
    target.setHours(hour, 0, 0, 0);
    const data = await api<{ item: CalendarPost }>(`/api/overseas/publishing/calendar/${postId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scheduledAt: target.toISOString() }),
    });
    setItems(prev => prev.map(item => item.id === postId ? data.item : item));
  };

  const heat = (day: Date): string => {
    const row = scores[day.getDay()] || [];
    const best = Math.max(...row, 0);
    if (best >= 0.9) return 'bg-emerald-50';
    if (best >= 0.7) return 'bg-sky-50';
    return 'bg-white';
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700">
            <CalendarDays size={17} />
          </span>
          <div>
            <h2 className="text-base font-black text-text-primary">内容日历</h2>
            <p className="text-xs text-text-muted">颜色越深，越适合发布；已发布卡片显示询盘数。</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setAnchor(addDays(anchor, mode === 'month' ? -30 : -7))} className="rounded-lg border border-border p-2 text-text-muted hover:text-text-primary">
            <ChevronLeft size={15} />
          </button>
          <button type="button" onClick={() => setAnchor(new Date())} className="rounded-lg border border-border px-3 py-2 text-xs font-bold text-text-secondary">今天</button>
          <button type="button" onClick={() => setAnchor(addDays(anchor, mode === 'month' ? 30 : 7))} className="rounded-lg border border-border p-2 text-text-muted hover:text-text-primary">
            <ChevronRight size={15} />
          </button>
          <div className="ml-1 flex rounded-lg border border-border bg-surface p-1">
            {[
              ['week', Grid2X2, '周'],
              ['month', CalendarDays, '月'],
              ['list', List, '列表'],
            ].map(([value, Icon, label]) => (
              <button
                key={value as string}
                type="button"
                onClick={() => setMode(value as ViewMode)}
                className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-bold ${mode === value ? 'bg-white text-text-primary shadow-sm' : 'text-text-muted'}`}
              >
                <Icon size={13} /> {label as string}
              </button>
            ))}
          </div>
          <button type="button" onClick={() => void load()} className="rounded-lg border border-border p-2 text-text-muted hover:text-text-primary">
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {error && <div className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-600">{error}</div>}

      {mode === 'list' ? (
        <div className="overflow-hidden rounded-2xl border border-border bg-white">
          {items.length === 0 ? (
            <div className="py-14 text-center text-sm text-text-muted">还没有排期内容</div>
          ) : items.map(item => (
            <button key={item.id} type="button" onClick={() => onOpenPost?.(item)} className="flex w-full items-center gap-3 border-b border-border px-4 py-3 text-left last:border-b-0 hover:bg-surface">
              <span className="rounded-lg bg-surface-2 px-2 py-1 text-xs font-black text-text-secondary">{platformLabel(item.platform)}</span>
              <span className="min-w-0 flex-1 truncate text-sm font-bold text-text-primary">{item.title}</span>
              <span className="text-xs text-text-muted">{new Date(item.publishedAt).toLocaleString()}</span>
              <span className="rounded-full bg-emerald-50 px-2 py-1 text-xs font-black text-emerald-700">{item.inquiries} 询盘</span>
            </button>
          ))}
        </div>
      ) : (
        <div className={`grid gap-2 ${mode === 'month' ? 'grid-cols-7' : 'grid-cols-7'}`}>
          {days.map(day => {
            const key = dateKey(day);
            const dayItems = itemsByDay[key] || [];
            return (
              <div
                key={key}
                onDragOver={event => event.preventDefault()}
                onDrop={event => {
                  event.preventDefault();
                  const id = event.dataTransfer.getData('text/post-id') || dragId;
                  if (id) void reschedule(id, day, 10);
                  setDragId('');
                }}
                className={`min-h-[170px] rounded-2xl border border-border p-2 ${heat(day)}`}
              >
                <button type="button" onClick={() => onCreate?.(day)} className="mb-2 flex w-full items-center justify-between rounded-lg px-1 py-1 text-left hover:bg-white/70">
                  <span>
                    <span className="block text-xs font-black text-text-primary">{day.toLocaleDateString(undefined, { weekday: 'short' })}</span>
                    <span className="text-[11px] text-text-muted">{day.getMonth() + 1}/{day.getDate()}</span>
                  </span>
                  <Plus size={14} className="text-text-muted" />
                </button>
                <div className="space-y-2">
                  {dayItems.slice(0, mode === 'month' ? 3 : 6).map(item => (
                    <button
                      key={item.id}
                      type="button"
                      draggable={!item.platformPostId}
                      onDragStart={event => {
                        setDragId(item.id);
                        event.dataTransfer.setData('text/post-id', item.id);
                      }}
                      onClick={() => onOpenPost?.(item)}
                      className="w-full rounded-xl border border-border bg-white p-2 text-left shadow-sm hover:border-emerald-200"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[10px] font-black text-text-secondary">{platformLabel(item.platform)}</span>
                        <span className="text-[10px] text-text-muted">{new Date(item.publishedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs font-bold text-text-primary">{item.title}</p>
                      <div className="mt-2 flex items-center justify-between">
                        <span className="inline-flex items-center gap-1 text-[10px] text-text-muted"><Clock size={10} /> {item.status}</span>
                        <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-black text-emerald-700">{item.inquiries}</span>
                      </div>
                      {item.isRecycle && <span className="mt-1 inline-block rounded-full bg-sky-50 px-1.5 py-0.5 text-[10px] font-black text-sky-700">循环</span>}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
