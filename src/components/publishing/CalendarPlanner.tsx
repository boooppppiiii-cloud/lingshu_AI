import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Flag,
  Grid2X2,
  Play,
  Plus,
  RefreshCw,
  Waves,
} from 'lucide-react';
import { authHeader } from '../../lib/auth';
import {
  buildMarketingEvents,
  MARKET_OPTIONS,
  timeZoneOffsetHours,
  type MarketId,
  type MarketingEvent,
} from './marketingCalendar';
import { ContentQueuePanel, type PendingPlacement } from './ContentQueuePanel';
import { PlatformBadge } from './PlatformBadge';

export type CalendarPost = {
  id: string;
  platform: string;
  title: string;
  description?: string;
  publishedAt: string;
  status: 'scheduled' | 'published' | string;
  coverUrl?: string;
  videoUrl?: string;
  duration?: number;
  contentId?: string;
  firstComment?: string;
  videoPath?: string;
  videoPreviewUrl?: string;
  trackWaLink?: boolean;
  targetAccountIds?: string[];
  targetAccountLabels?: string[];
  publishError?: string;
  publishAttempts?: number;
  nextPublishAttemptAt?: string;
  inquiries: number;
  isRecycle?: boolean;
  platformPostId?: string;
};

export type PendingPublishContent = {
  id: string;
  title: string;
  description?: string;
  sourceProjectId?: string;
  sourcePlatform?: string;
  platforms?: string[];
  deliveryMode?: 'now' | 'schedule';
  scheduledAt?: string;
  status?: string;
};

type ViewMode = 'week' | 'month';

type HoverContentData = { kind: 'post'; post: CalendarPost };

type HoveredContent = HoverContentData & { x: number; y: number };

type BestTimeResponse = {
  weekday: number;
  scores: number[];
  source?: string;
  confidence?: string;
  utcOffset?: number | null;
};

type EnterpriseProfileLite = {
  company?: { mainMarkets?: string };
  strategy?: { focusMarkets?: string };
};

function marketIdFromEnterprise(value: string): MarketId {
  const candidates = value.split(/[、,，/；;\s]+/).map(item => item.trim()).filter(Boolean);
  for (const candidate of candidates) {
    if (/北美|美国|加拿大|墨西哥/i.test(candidate)) return 'north-america';
    if (/欧洲|欧盟|德国|法国|英国|意大利|西班牙|荷兰|波兰/i.test(candidate)) return 'europe';
    if (/中东|沙特|阿联酋|迪拜|卡塔尔|科威特|阿曼|巴林/i.test(candidate)) return 'middle-east';
    if (/东南亚|印尼|印度尼西亚|新加坡|马来西亚|泰国|越南|菲律宾/i.test(candidate)) return 'southeast-asia';
    if (/中亚|哈萨克斯坦|乌兹别克斯坦|吉尔吉斯斯坦|塔吉克斯坦|土库曼斯坦/i.test(candidate)) return 'central-asia';
    if (/南亚|印度|巴基斯坦|孟加拉|斯里兰卡|尼泊尔/i.test(candidate)) return 'south-asia';
    if (/东亚|日本|韩国|蒙古/i.test(candidate)) return 'east-asia';
    if (/拉美|拉丁美洲|巴西|阿根廷|智利|哥伦比亚|秘鲁/i.test(candidate)) return 'latin-america';
    if (/非洲|南非|尼日利亚|埃及|肯尼亚|摩洛哥/i.test(candidate)) return 'africa';
    if (/大洋洲|澳大利亚|新西兰/i.test(candidate)) return 'oceania';
    if (/俄罗斯|独联体|俄语区/i.test(candidate)) return 'cis';
  }
  return 'global';
}

function startOfWeek(date: Date): Date {
  const next = new Date(date);
  const day = next.getDay();
  next.setDate(next.getDate() - day);
  next.setHours(0, 0, 0, 0);
  return next;
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
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
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isSameDay(left: Date, right: Date): boolean {
  return dateKey(left) === dateKey(right);
}

function roundToHalfHour(date: Date): Date {
  const next = new Date(date);
  const minutes = next.getMinutes();
  next.setMinutes(minutes < 30 ? 0 : 30, 0, 0);
  return next;
}

function statusMeta(item: CalendarPost): { label: string; className: string; Icon: typeof Clock } {
  if (item.platformPostId || item.status === 'published') {
    return { label: '已发布', className: 'border-emerald-200 bg-emerald-50 text-emerald-700', Icon: CheckCircle2 };
  }
  if (item.status === 'scheduled') {
    return { label: '已排期', className: 'border-sky-200 bg-sky-50 text-sky-700', Icon: CalendarClock };
  }
  if (item.status === 'publishing') {
    return { label: '正在发布', className: 'border-amber-200 bg-amber-50 text-amber-700', Icon: RefreshCw };
  }
  if (item.status === 'failed') {
    return { label: '发布失败', className: 'border-red-200 bg-red-50 text-red-700', Icon: Flag };
  }
  if (item.status === 'partial') {
    return { label: '部分发布', className: 'border-orange-200 bg-orange-50 text-orange-700', Icon: Flag };
  }
  return { label: item.status || '草稿', className: 'border-slate-200 bg-slate-50 text-slate-600', Icon: Clock };
}

function targetHourFromBeijing(hour: number, offset: number): number {
  return (hour - 8 + offset + 24) % 24;
}

function hourLabel(value: number): string {
  const hour = Math.floor(value);
  const minutes = value % 1 ? '30' : '00';
  return `${String(hour).padStart(2, '0')}:${minutes}`;
}

type ChartPoint = { x: number; y: number };

function smoothChartPath(points: ChartPoint[]): string {
  if (!points.length) return '';
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  return points.slice(0, -1).reduce((path, point, index) => {
    const previous = points[index - 1] || point;
    const next = points[index + 1];
    const afterNext = points[index + 2] || next;
    const control1 = {
      x: point.x + (next.x - previous.x) / 6,
      y: point.y + (next.y - previous.y) / 6,
    };
    const control2 = {
      x: next.x - (afterNext.x - point.x) / 6,
      y: next.y - (afterNext.y - point.y) / 6,
    };
    return `${path} C ${control1.x.toFixed(2)} ${control1.y.toFixed(2)}, ${control2.x.toFixed(2)} ${control2.y.toFixed(2)}, ${next.x} ${next.y}`;
  }, `M ${points[0].x} ${points[0].y}`);
}

function eventTone(event: MarketingEvent): string {
  if (event.market === 'middle-east') return 'border-violet-200 bg-violet-50 text-violet-700';
  if (event.market === 'southeast-asia') return 'border-rose-200 bg-rose-50 text-rose-700';
  if (event.market === 'europe') return 'border-indigo-200 bg-indigo-50 text-indigo-700';
  if (event.market === 'north-america') return 'border-amber-200 bg-amber-50 text-amber-700';
  if (event.market === 'south-asia') return 'border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700';
  if (event.market === 'east-asia') return 'border-red-200 bg-red-50 text-red-700';
  if (event.market === 'latin-america') return 'border-cyan-200 bg-cyan-50 text-cyan-700';
  if (event.market === 'oceania') return 'border-blue-200 bg-blue-50 text-blue-700';
  return 'border-orange-200 bg-orange-50 text-orange-700';
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
  pendingItems = [],
  onOpenPending,
  onSchedulePending,
  refreshKey = 0,
}: {
  onCreate?: (date: Date) => void;
  onOpenPost?: (post: CalendarPost) => void;
  pendingItems?: PendingPublishContent[];
  onOpenPending?: (id: string) => void;
  onSchedulePending?: (id: string, scheduledAt: Date) => Promise<number>;
  refreshKey?: number;
}) {
  const today = startOfDay(new Date());
  const [mode, setMode] = useState<ViewMode>('week');
  const [anchor, setAnchor] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState(() => startOfDay(new Date()));
  const selectedPlatform = 'tiktok';
  const [selectedMarket, setSelectedMarket] = useState<MarketId>('global');
  const [enterpriseMarketLabel, setEnterpriseMarketLabel] = useState('综合市场');
  const [items, setItems] = useState<CalendarPost[]>([]);
  const [scores, setScores] = useState<Record<number, number[]>>({});
  const [dragId, setDragId] = useState('');
  const [dragOverDate, setDragOverDate] = useState('');
  const [isTideDragging, setIsTideDragging] = useState(false);
  const [hoveredContent, setHoveredContent] = useState<HoveredContent | null>(null);
  const [interactionMessage, setInteractionMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [scoreSource, setScoreSource] = useState('平台参考');
  const calendarTopRef = useRef<HTMLDivElement>(null);
  const calendarScrollRef = useRef<HTMLDivElement>(null);
  const tideScrollRef = useRef<HTMLDivElement>(null);
  const tideDragRef = useRef({ pointerId: -1, startX: 0, scrollLeft: 0, moved: false });

  const market = MARKET_OPTIONS.find(option => option.id === selectedMarket) ?? MARKET_OPTIONS[0];
  const utcOffset = useMemo(
    () => timeZoneOffsetHours(market.timeZone, selectedDate),
    [market.timeZone, selectedDate],
  );

  useEffect(() => {
    let active = true;
    api<EnterpriseProfileLite>('/api/overseas/enterprise/profile')
      .then(profile => {
        if (!active) return;
        const configuredMarket = profile.strategy?.focusMarkets?.trim() || profile.company?.mainMarkets?.trim();
        if (!configuredMarket) return;
        setEnterpriseMarketLabel(configuredMarket);
        setSelectedMarket(marketIdFromEnterprise(configuredMarket));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

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
    const queueFrom = startOfDay(new Date());
    const calendarFrom = days[0];
    const calendarTo = addDays(days[days.length - 1], 1);
    const from = calendarFrom.getTime() < queueFrom.getTime() ? calendarFrom : queueFrom;
    const queueTo = addDays(queueFrom, 35);
    const to = calendarTo.getTime() > queueTo.getTime() ? calendarTo : queueTo;
    return { from, to };
  }, [days]);

  const tideMonthDays = useMemo(() => {
    const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const dayCount = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0).getDate();
    return Array.from({ length: dayCount }, (_, index) => addDays(first, index));
  }, [anchor]);

  const tideEvents = useMemo(() => {
    const firstKey = dateKey(tideMonthDays[0]);
    const lastKey = dateKey(tideMonthDays[tideMonthDays.length - 1]);
    return buildMarketingEvents(anchor).filter(event => event.date >= firstKey && event.date <= lastKey);
  }, [anchor, tideMonthDays]);

  const load = async (silent = false) => {
    if (!silent) {
      setLoading(true);
      setError('');
    }
    try {
      const weekdays = [0, 1, 2, 3, 4, 5, 6];
      const [calendar, scoreRows] = await Promise.all([
        api<{ items: CalendarPost[] }>(`/api/overseas/publishing/calendar?from=${encodeURIComponent(iso(range.from))}&to=${encodeURIComponent(iso(range.to))}`),
        Promise.all(weekdays.map(weekday =>
          api<BestTimeResponse>(
            `/api/overseas/publishing/best-time?platform=${encodeURIComponent(selectedPlatform)}&weekday=${weekday}&utcOffset=${encodeURIComponent(String(utcOffset))}`,
          ),
        )),
      ]);
      setItems(calendar.items || []);
      setScores(Object.fromEntries(scoreRows.map(row => [row.weekday, row.scores])));
      setScoreSource(scoreRows.some(row => row.source === 'account_history') ? '账号真实数据' : '平台参考');
    } catch (loadError) {
      if (!silent) setError(loadError instanceof Error ? loadError.message : 'load_failed');
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(true), 30_000);
    return () => window.clearInterval(timer);
  }, [range.from.toISOString(), range.to.toISOString(), mode, selectedPlatform, utcOffset, refreshKey]);

  const itemsByDay = useMemo(() => {
    const groups: Record<string, CalendarPost[]> = {};
    for (const item of items) {
      const key = dateKey(new Date(item.publishedAt));
      groups[key] = [...(groups[key] || []), item];
    }
    return groups;
  }, [items]);

  const tideDayWidth = 106;
  const tideChartWidth = tideMonthDays.length * tideDayWidth;
  const tidePeakScores = tideMonthDays.map(day => {
    const dayScores = scores[day.getDay()] || [];
    return dayScores.length ? Math.max(...dayScores) : 0.46;
  });
  const tideMinScore = Math.min(...tidePeakScores);
  const tideMaxScore = Math.max(...tidePeakScores);
  const tideScoreSpread = tideMaxScore - tideMinScore;
  const tidePoints = tideMonthDays.map((day, index) => {
    const peakScore = tidePeakScores[index];
    const relativeScore = tideScoreSpread >= 0.02
      ? (peakScore - tideMinScore) / tideScoreSpread
      : 0.5;
    return {
      x: index * tideDayWidth + tideDayWidth / 2,
      y: 122 - relativeScore * 48,
    };
  });
  const tideLinePath = smoothChartPath(tidePoints);
  const tideAreaPath = `${tideLinePath} L ${tidePoints[tidePoints.length - 1].x} 132 L ${tidePoints[0].x} 132 Z`;
  const selectedScores = scores[selectedDate.getDay()] || [];
  const selectedBestHour = selectedScores.length
    ? selectedScores.reduce((bestHour, score, hour, all) => score > all[bestHour] ? hour : bestHour, 0)
    : 20;

  const eventsByDay = useMemo(() => {
    const grouped: Record<string, MarketingEvent[]> = {};
    for (const event of tideEvents) grouped[event.date] = [...(grouped[event.date] || []), event];
    return grouped;
  }, [tideEvents]);

  const placePendingContent = async (id: string, scheduledAt: Date) => {
    if (!onSchedulePending) throw new Error('排期功能暂不可用');
    await onSchedulePending(id, scheduledAt);
    setSelectedDate(startOfDay(scheduledAt));
  };

  const arrangePendingContent = async (placements: PendingPlacement[]) => {
    let completed = 0;
    const failures: string[] = [];
    for (const placement of placements) {
      try {
        await placePendingContent(placement.id, placement.scheduledAt);
        completed += 1;
      } catch (arrangeError) {
        failures.push(arrangeError instanceof Error ? arrangeError.message : '排期失败');
      }
    }
    await load();
    setInteractionMessage(failures.length
      ? `已排入 ${completed} 条，${failures.length} 条需要重新检查。`
      : `已按当前发布节奏排入 ${completed} 条视频。`);
    if (failures.length) throw new Error(failures[0]);
  };

  const schedulePendingOnDay = async (id: string, day: Date) => {
    const pending = pendingItems.find(item => item.id === id);
    if (!pending) return;
    const planned = pending.scheduledAt ? new Date(pending.scheduledAt) : new Date();
    const target = startOfDay(day);
    target.setHours(
      Number.isFinite(planned.getTime()) ? planned.getHours() : 20,
      Number.isFinite(planned.getTime()) ? planned.getMinutes() : 0,
      0,
      0,
    );
    try {
      await placePendingContent(id, target);
      await load();
      setInteractionMessage(`“${pending.title}”已安排到 ${target.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}。`);
    } catch (scheduleError) {
      setInteractionMessage(scheduleError instanceof Error ? scheduleError.message : '排期失败，请重试');
    }
  };

  const reschedule = async (postId: string, day: Date, hour = 10) => {
    const target = roundToHalfHour(new Date(day));
    target.setHours(hour, 0, 0, 0);
    const data = await api<{ item: CalendarPost }>(`/api/overseas/publishing/calendar/${postId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scheduledAt: target.toISOString() }),
    });
    setItems(previous => previous.map(item => item.id === postId ? data.item : item));
  };

  const previewAt = (event: React.MouseEvent, content: HoverContentData) => {
    setHoveredContent({ ...content, x: event.clientX, y: event.clientY } as HoveredContent);
  };

  const moveRange = (direction: number) => {
    const next = mode === 'month'
      ? new Date(anchor.getFullYear(), anchor.getMonth() + direction, 1)
      : addDays(anchor, 7 * direction);
    setAnchor(next);
    setSelectedDate(startOfDay(next));
  };

  const goToday = () => {
    const next = new Date();
    setAnchor(next);
    setSelectedDate(startOfDay(next));
  };

  useEffect(() => {
    const scroller = tideScrollRef.current;
    if (!scroller) return;
    const isSelectedInMonth = selectedDate.getFullYear() === anchor.getFullYear()
      && selectedDate.getMonth() === anchor.getMonth();
    const targetIndex = isSelectedInMonth ? selectedDate.getDate() - 1 : 0;
    const targetLeft = Math.max(0, targetIndex * tideDayWidth - scroller.clientWidth / 2 + tideDayWidth / 2);
    scroller.scrollTo({ left: targetLeft, behavior: 'smooth' });
  }, [anchor.getFullYear(), anchor.getMonth(), dateKey(selectedDate)]);

  const startTideDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    tideDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      scrollLeft: event.currentTarget.scrollLeft,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsTideDragging(true);
  };

  const moveTideDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (tideDragRef.current.pointerId !== event.pointerId) return;
    const distance = event.clientX - tideDragRef.current.startX;
    if (Math.abs(distance) > 5) tideDragRef.current.moved = true;
    if (!tideDragRef.current.moved) return;
    event.preventDefault();
    event.currentTarget.scrollLeft = tideDragRef.current.scrollLeft - distance;
  };

  const endTideDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (tideDragRef.current.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    tideDragRef.current.pointerId = -1;
    setIsTideDragging(false);
  };

  const selectTideDate = (day: Date) => {
    if (tideDragRef.current.moved) {
      tideDragRef.current.moved = false;
      return;
    }
    setSelectedDate(startOfDay(day));
  };

  return (
    <div className="space-y-3" data-lingshu-guide="content-planner">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700">
              <CalendarDays size={17} />
            </span>
            <h2 className="text-base font-black text-text-primary">内容排产工作台</h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => moveRange(-1)} className="rounded-lg border border-border p-2 text-text-muted hover:text-text-primary" aria-label="上一周期">
              <ChevronLeft size={15} />
            </button>
            <button type="button" onClick={goToday} className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-700">今天</button>
            <button type="button" onClick={() => moveRange(1)} className="rounded-lg border border-border p-2 text-text-muted hover:text-text-primary" aria-label="下一周期">
              <ChevronRight size={15} />
            </button>
            <div className="ml-1 flex rounded-lg border border-border bg-surface p-1">
              {[
                ['week', Grid2X2, '周'],
                ['month', CalendarDays, '月'],
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
            <button type="button" onClick={() => void load()} className="rounded-lg border border-border p-2 text-text-muted hover:text-text-primary" aria-label="刷新日历">
              <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

      </div>

      {error && <div className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-600">{error}</div>}

      <div ref={calendarTopRef} data-lingshu-guide="content-calendar" className="scroll-mt-28 rounded-2xl border border-border bg-white p-3 shadow-[0_12px_32px_rgba(15,23,42,0.12)]">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <CalendarDays size={15} className="text-emerald-600" />
            <h3 className="text-sm font-black text-text-primary">内容日历</h3>
          </div>
        </div>

        <div data-lingshu-guide="publishing-tide" className="mt-3 overflow-hidden rounded-xl border border-emerald-100 bg-emerald-50/30 pb-2 pt-3">
          <div className="flex flex-wrap items-start justify-between gap-2 px-3">
            <div>
              <div className="flex items-center gap-2">
                <Waves size={14} className="text-emerald-600" />
                <span className="text-xs font-black text-text-primary">
                  {anchor.getFullYear()} 年 {anchor.getMonth() + 1} 月发布潮汐
                </span>
                <span className="rounded-full bg-white px-2 py-0.5 text-[9px] font-black text-emerald-700 shadow-sm">
                  本月 {tideMonthDays.length} 天
                </span>
              </div>
              <p className="mt-1 text-[9px] font-bold text-text-muted">按住潮汐左右拖动，可查看整月发布节奏与全球重点电商节庆</p>
            </div>
            <div className="text-right">
              <p className="text-[9px] font-bold text-text-muted">
                目标市场：{enterpriseMarketLabel} · {scoreSource === '账号真实数据' ? scoreSource : `${scoreSource} · 非账号实测`}
              </p>
              <p className="mt-1 text-[9px] font-black text-emerald-700">
                {selectedDate.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' })} · 建议北京时间 {hourLabel(selectedBestHour)}
                {market.id !== 'global' && `（${market.timeZoneLabel} ${hourLabel(targetHourFromBeijing(selectedBestHour, utcOffset))}）`}
              </p>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-y border-emerald-100/80 bg-white/70 px-3 py-1.5 text-[8px] font-bold text-text-muted">
            <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500" />发布热度</span>
            <span className="inline-flex items-center gap-1"><Flag size={9} className="text-orange-500" />全球电商节庆点（标注真实日期）</span>
            <span className="ml-auto">节庆点仅显示在潮汐中</span>
          </div>
          <div
            ref={tideScrollRef}
            onPointerDown={startTideDrag}
            onPointerMove={moveTideDrag}
            onPointerUp={endTideDrag}
            onPointerCancel={endTideDrag}
            className={`overflow-x-auto overflow-y-hidden select-none ${isTideDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
            style={{ touchAction: 'pan-y' }}
            aria-label={`${anchor.getFullYear()} 年 ${anchor.getMonth() + 1} 月可拖动发布潮汐`}
          >
            <div className="relative h-[188px]" style={{ width: tideChartWidth }}>
              <svg viewBox={`0 0 ${tideChartWidth} 170`} className="absolute inset-x-0 bottom-0 h-[170px]" role="img" aria-label="一个月发布潮汐与全球重点电商节庆图">
                <defs>
                  <linearGradient id="publishing-tide-fill" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity="0.28" />
                    <stop offset="100%" stopColor="#10b981" stopOpacity="0.02" />
                  </linearGradient>
                  <filter id="publishing-tide-glow" x="-10%" y="-35%" width="120%" height="170%">
                    <feGaussianBlur stdDeviation="2.2" result="blur" />
                    <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                  </filter>
                </defs>
                {[76, 104, 132].map(y => <line key={y} x1="0" x2={tideChartWidth} y1={y} y2={y} stroke="#d1fae5" strokeDasharray="4 5" />)}
                {tideMonthDays.map((day, index) => {
                  const x = index * tideDayWidth;
                  const isSelected = isSameDay(day, selectedDate);
                  return (
                    <g key={dateKey(day)}>
                      {isSelected && <rect x={x + 4} y="66" width={tideDayWidth - 8} height="96" rx="12" fill="#dbeafe" opacity="0.72" />}
                      <line x1={x} x2={x} y1="68" y2="146" stroke="#ecfdf5" />
                    </g>
                  );
                })}
                {tideEvents.map(event => {
                  const dayIndex = Number(event.date.slice(-2)) - 1;
                  const point = tidePoints[dayIndex];
                  return <line key={`${event.id}-guide`} x1={point.x} x2={point.x} y1="54" y2={point.y - 5} stroke="#f59e0b" strokeWidth="1.5" strokeDasharray="3 4" opacity="0.65" />;
                })}
                <path d={tideAreaPath} fill="url(#publishing-tide-fill)" />
                <path d={tideLinePath} fill="none" stroke="#10b981" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" filter="url(#publishing-tide-glow)" />
                {tideMonthDays.map((day, index) => {
                  const dayScores = scores[day.getDay()] || [];
                  const bestHour = dayScores.length
                    ? dayScores.reduce((best, score, hour, all) => score > all[best] ? hour : best, 0)
                    : 20;
                  const peakScore = dayScores[bestHour] || 0;
                  const point = tidePoints[index];
                  const isSelected = isSameDay(day, selectedDate);
                  return (
                    <g key={`${dateKey(day)}-point`} onClick={() => selectTideDate(day)} className="cursor-pointer">
                      <circle cx={point.x} cy={point.y} r={isSelected ? 5 : 3.5} fill="#fff" stroke={isSelected ? '#0284c7' : '#059669'} strokeWidth={isSelected ? 3 : 2}>
                        <title>{`${day.toLocaleDateString('zh-CN')} · 北京 ${hourLabel(bestHour)} · ${market.timeZoneLabel} ${hourLabel(targetHourFromBeijing(bestHour, utcOffset))} · 推荐分 ${Math.round(peakScore * 100)}`}</title>
                      </circle>
                      <text x={point.x} y="157" textAnchor="middle" fontSize="8" fontWeight={isSelected ? 800 : 600} fill={isSelected ? '#0369a1' : '#64748b'}>
                        {`${day.getMonth() + 1}/${day.getDate()} ${day.toLocaleDateString('zh-CN', { weekday: 'short' })}`}
                      </text>
                    </g>
                  );
                })}
              </svg>
              {tideEvents.map(event => {
                const dayIndex = Number(event.date.slice(-2)) - 1;
                const sameDayIndex = (eventsByDay[event.date] || []).findIndex(item => item.id === event.id);
                const marketLabel = MARKET_OPTIONS.find(option => option.id === event.market)?.label || '全球';
                return (
                  <button
                    key={event.id}
                    type="button"
                    onClick={() => selectTideDate(tideMonthDays[dayIndex])}
                    className={`absolute z-10 w-[96px] rounded-lg border px-1.5 py-1 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${eventTone(event)}`}
                    style={{ left: dayIndex * tideDayWidth + 5, top: 4 + sameDayIndex * 38 }}
                    title={`${event.name} · ${event.date} · ${event.note}（${event.source}）`}
                  >
                    <span className="flex items-center gap-1 text-[8px] font-black"><Flag size={8} /><span className="truncate">{event.shortName}</span></span>
                    <span className="mt-0.5 block truncate text-[7px] font-bold opacity-80">{event.date.slice(5).replace('-', '/')} · {marketLabel}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {interactionMessage && (
          <div className="mt-2 rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-[11px] font-bold text-emerald-700">
            {interactionMessage}
          </div>
        )}
        <div ref={calendarScrollRef} className="mt-3 max-h-[420px] overflow-auto pb-2">
          <div className={`grid min-w-[960px] grid-cols-7 gap-2 ${mode === 'month' ? 'auto-rows-fr' : ''}`}>
            {days.map(day => {
              const key = dateKey(day);
              const dayItems = itemsByDay[key] || [];
              const isToday = isSameDay(day, today);
              const isSelected = isSameDay(day, selectedDate);
              const isDragTarget = dragOverDate === key;
              const isOutsideMonth = mode === 'month' && day.getMonth() !== anchor.getMonth();
              return (
                <div
                  key={key}
                  data-calendar-date={key}
                  onDragOver={event => {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = 'move';
                    setDragOverDate(key);
                  }}
                  onDragLeave={event => {
                    if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragOverDate('');
                  }}
                  onDrop={event => {
                    event.preventDefault();
                    const pendingId = event.dataTransfer.getData('application/x-lingshu-pending-content');
                    if (pendingId) {
                      void schedulePendingOnDay(pendingId, day);
                      setDragOverDate('');
                      return;
                    }
                    const id = event.dataTransfer.getData('text/post-id') || dragId;
                    if (id) void reschedule(id, day, 10);
                    setDragId('');
                    setDragOverDate('');
                  }}
                  className={`relative flex flex-col rounded-2xl border p-2 transition ${
                    mode === 'month' ? 'min-h-[112px]' : 'min-h-[292px]'
                  } ${
                    isDragTarget
                      ? 'scale-[1.015] border-violet-400 bg-violet-50 ring-4 ring-violet-100 shadow-lg'
                      : isToday
                          ? 'border-emerald-400 bg-emerald-50/40 shadow-[0_8px_24px_rgba(16,185,129,0.12)]'
                          : isSelected
                            ? 'border-sky-300 bg-sky-50/30 ring-2 ring-sky-100'
                            : 'border-border bg-white'
                  } ${isOutsideMonth ? 'opacity-45' : ''}`}
                >
                  <button
                    type="button"
                    onClick={() => setSelectedDate(startOfDay(day))}
                    className="mb-2 flex w-full items-center justify-between rounded-xl px-1 py-1 text-left hover:bg-white/80"
                  >
                    <span>
                      <span className={`block text-xs font-black ${isToday ? 'text-emerald-700' : 'text-text-primary'}`}>
                        {day.toLocaleDateString('zh-CN', { weekday: 'short' })}
                      </span>
                      <span className="text-[10px] text-text-muted">{day.getMonth() + 1}/{day.getDate()}</span>
                    </span>
                    <span className={`flex h-7 min-w-7 items-center justify-center rounded-full px-1.5 text-xs font-black ${
                      isToday ? 'bg-emerald-600 text-white shadow-sm' : isSelected ? 'bg-sky-100 text-sky-700' : 'bg-surface-2 text-text-secondary'
                    }`}>
                      {day.getDate()}
                    </span>
                  </button>

                  {mode === 'week' ? (
                    <div className="mt-auto overflow-hidden rounded-xl border border-slate-100 bg-slate-50/40">
                      {[0, 6, 12, 18].map(startHour => {
                        const bucketItems = dayItems.filter(item => {
                          const hour = new Date(item.publishedAt).getHours();
                          return hour >= startHour && hour < startHour + 6;
                        });
                        return (
                          <div key={startHour} className="grid min-h-[46px] grid-cols-[25px_minmax(0,1fr)] border-t border-dashed border-slate-200 first:border-t-0">
                            <span className="border-r border-slate-100 pt-1.5 text-center text-[8px] font-black text-slate-400">{String(startHour).padStart(2, '0')}</span>
                            <div className="space-y-1 p-1">
                              {bucketItems.map(item => {
                                const meta = statusMeta(item);
                                return (
                                  <button
                                    key={item.id}
                                    type="button"
                                    draggable={!item.platformPostId}
                                    onDragStart={event => {
                                      setDragId(item.id);
                                      event.dataTransfer.setData('text/post-id', item.id);
                                    }}
                                    onMouseEnter={event => previewAt(event, { kind: 'post', post: item })}
                                    onMouseMove={event => previewAt(event, { kind: 'post', post: item })}
                                    onMouseLeave={() => setHoveredContent(null)}
                                    onClick={() => onOpenPost?.(item)}
                                    className={`w-full rounded-lg border px-1.5 py-1 text-left shadow-sm transition hover:-translate-y-0.5 ${meta.className}`}
                                  >
                                    <span className="flex items-center justify-between gap-1 text-[8px] font-black"><PlatformBadge platform={item.platform} compact /><span>{new Date(item.publishedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span></span>
                                    <span className="mt-0.5 block truncate text-[9px] font-bold">{item.title}</span>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      {dayItems.slice(0, 1).map(item => {
                        const meta = statusMeta(item);
                        return (
                          <button key={item.id} type="button" onClick={() => onOpenPost?.(item)} className={`w-full rounded-xl border p-1.5 text-left shadow-sm ${meta.className}`}>
                            <span className="flex items-center justify-between gap-1 text-[9px] font-black"><PlatformBadge platform={item.platform} compact /><span>{new Date(item.publishedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span></span>
                            <span className="mt-1 block truncate text-[10px] font-bold">{item.title}</span>
                          </button>
                        );
                      })}
                      {dayItems.length > 1 && <p className="text-center text-[9px] font-bold text-text-muted">还有 {dayItems.length - 1} 条</p>}
                    </div>
                  )}

                  {mode === 'week' && dayItems.length === 0 && (
                    <button type="button" onClick={() => onCreate?.(day)} className="mt-1 flex w-full items-center justify-center gap-1 rounded-lg border border-dashed border-sky-200 bg-sky-50/60 px-2 py-1.5 text-[9px] font-bold text-sky-700 hover:bg-sky-50"><Plus size={10} /> 添加内容</button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <ContentQueuePanel
        selectedPlatform={selectedPlatform}
        selectedMarket={selectedMarket}
        marketLabel={enterpriseMarketLabel}
        marketTimeZone={market.timeZone}
        utcOffset={utcOffset}
        posts={items}
        pendingItems={pendingItems}
        onOpenPending={onOpenPending}
        onArrangePending={arrangePendingContent}
      />

      {hoveredContent && (
        <div
          className="pointer-events-none fixed z-[120] w-[292px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_18px_50px_rgba(15,23,42,0.22)]"
          style={{
            left: Math.max(12, Math.min(hoveredContent.x + 14, (typeof window === 'undefined' ? 1440 : window.innerWidth) - 304)),
            top: Math.max(12, Math.min(hoveredContent.y + 14, (typeof window === 'undefined' ? 900 : window.innerHeight) - 286)),
          }}
        >
          {(() => {
            const post = hoveredContent.post;
            const meta = statusMeta(post);
            return (
              <>
                <div className="relative flex aspect-video items-center justify-center overflow-hidden bg-gradient-to-br from-slate-900 via-slate-800 to-emerald-950">
                  {post.videoPreviewUrl || post.videoUrl ? (
                    <video src={post.videoPreviewUrl || post.videoUrl} poster={post.coverUrl} autoPlay muted loop playsInline className="h-full w-full object-cover" />
                  ) : post.coverUrl ? (
                    <img src={post.coverUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="text-center text-white">
                      <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-white/15 backdrop-blur">
                        <Play size={18} fill="currentColor" />
                      </span>
                      <p className="mt-2 text-[10px] font-bold text-white/65">视频素材待关联</p>
                    </div>
                  )}
                  <span className="absolute left-2 top-2 flex items-center gap-1.5 rounded-lg bg-black/55 p-1 text-[9px] font-black text-white backdrop-blur">
                    <PlatformBadge platform={post.platform} />
                    <span>{post.duration ? `${Math.round(post.duration)}s` : '视频内容'}</span>
                  </span>
                </div>
                <div className="p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className={`rounded-full border px-2 py-0.5 text-[9px] font-black ${meta.className}`}>{meta.label}</span>
                    <span className="text-[9px] text-text-muted">{new Date(post.publishedAt).toLocaleString('zh-CN')}</span>
                  </div>
                  <p className="mt-2 text-xs font-black leading-snug text-text-primary">{post.title}</p>
                  <div className="mt-2 flex items-center justify-between rounded-lg bg-surface px-2.5 py-2 text-[10px] text-text-secondary">
                    <span>{post.isRecycle ? '循环发布' : '单次内容'}</span>
                    <span className="font-black text-emerald-700">{post.inquiries || 0} 条询盘</span>
                  </div>
                  {post.publishError && <p className="mt-2 rounded-lg bg-red-50 px-2.5 py-2 text-[9px] leading-relaxed text-red-700">{post.publishError}</p>}
                  {post.firstComment && <p className="mt-2 line-clamp-2 text-[9px] leading-relaxed text-text-muted">首评：{post.firstComment}</p>}
                </div>
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
}
