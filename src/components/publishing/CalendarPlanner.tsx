import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  Sparkles,
  Waves,
} from 'lucide-react';
import { authHeader } from '../../lib/auth';
import {
  buildMarketingEvents,
  campaignPhase,
  dateFromKey,
  daysBetween,
  eventsForMarket,
  MARKET_OPTIONS,
  timeZoneOffsetHours,
  type MarketId,
  type MarketingEvent,
} from './marketingCalendar';
import { ContentQueuePanel, type QueueSuggestion } from './ContentQueuePanel';
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
  targetAccountIds?: string[];
  targetAccountLabels?: string[];
  inquiries: number;
  isRecycle?: boolean;
  platformPostId?: string;
};

type ViewMode = 'week' | 'month';

type HoverContentData =
  | { kind: 'post'; post: CalendarPost }
  | { kind: 'suggestion'; suggestion: QueueSuggestion };

type HoveredContent = HoverContentData & { x: number; y: number };

type CalendarFestivalNotice = {
  event: MarketingEvent;
  days: number;
  phaseLabel: string;
  isReminder: boolean;
};

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

function eventTone(event: MarketingEvent): string {
  if (event.market === 'middle-east') return 'border-violet-200 bg-violet-50 text-violet-700';
  if (event.market === 'southeast-asia') return 'border-rose-200 bg-rose-50 text-rose-700';
  if (event.market === 'europe') return 'border-indigo-200 bg-indigo-50 text-indigo-700';
  if (event.market === 'north-america') return 'border-amber-200 bg-amber-50 text-amber-700';
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
  refreshKey = 0,
}: {
  onCreate?: (date: Date) => void;
  onOpenPost?: (post: CalendarPost) => void;
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
  const [activeSuggestionId, setActiveSuggestionId] = useState('');
  const [calendarDragSuggestionId, setCalendarDragSuggestionId] = useState('');
  const [matchedSuggestionId, setMatchedSuggestionId] = useState('');
  const [dragOverDate, setDragOverDate] = useState('');
  const [suggestionOverrides, setSuggestionOverrides] = useState<Record<string, string>>({});
  const [queueSuggestions, setQueueSuggestions] = useState<QueueSuggestion[]>([]);
  const [aiLayoutEnabled, setAiLayoutEnabled] = useState(false);
  const [recentlyConfirmedId, setRecentlyConfirmedId] = useState('');
  const [hoveredEventDate, setHoveredEventDate] = useState('');
  const [hoveredContent, setHoveredContent] = useState<HoveredContent | null>(null);
  const [interactionMessage, setInteractionMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [scoreSource, setScoreSource] = useState('平台参考');
  const calendarTopRef = useRef<HTMLDivElement>(null);
  const calendarScrollRef = useRef<HTMLDivElement>(null);

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

  const marketingEvents = useMemo(
    () => eventsForMarket(buildMarketingEvents(anchor), selectedMarket),
    [anchor, selectedMarket],
  );

  const festivalNoticesByDay = useMemo(() => {
    const groups: Record<string, CalendarFestivalNotice[]> = {};
    for (const event of marketingEvents) {
      groups[event.date] = [
        ...(groups[event.date] || []),
        { event, days: 0, phaseLabel: '爆发日', isReminder: false },
      ];
    }
    const todayKey = dateKey(today);
    const reminders = marketingEvents
      .map(event => {
        const eventDate = dateFromKey(event.date);
        const days = daysBetween(today, eventDate);
        const phase = campaignPhase(event, today);
        return {
          event,
          days,
          phaseLabel: phase?.label || '待准备',
          isReminder: true,
        };
      })
      .filter(notice => notice.days > 0 && notice.days <= 120)
      .slice(0, 3);
    if (reminders.length) groups[todayKey] = [...(groups[todayKey] || []), ...reminders];
    return groups;
  }, [marketingEvents, dateKey(today)]);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const weekdays = Array.from(new Set(days.slice(0, 7).map(day => day.getDay())));
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
      setError(loadError instanceof Error ? loadError.message : 'load_failed');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [range.from.toISOString(), range.to.toISOString(), mode, selectedPlatform, utcOffset, refreshKey]);

  const itemsByDay = useMemo(() => {
    const groups: Record<string, CalendarPost[]> = {};
    for (const item of items) {
      const key = dateKey(new Date(item.publishedAt));
      groups[key] = [...(groups[key] || []), item];
    }
    return groups;
  }, [items]);

  const suggestionsByDay = useMemo(() => {
    const groups: Record<string, QueueSuggestion[]> = {};
    if (!aiLayoutEnabled) return groups;
    for (const suggestion of queueSuggestions) {
      const key = dateKey(new Date(suggestion.scheduledAt));
      groups[key] = [...(groups[key] || []), suggestion];
    }
    return groups;
  }, [aiLayoutEnabled, queueSuggestions]);

  const handleSuggestionsChange = useCallback((suggestions: QueueSuggestion[]) => {
    setQueueSuggestions(suggestions);
  }, []);

  const handleSuggestionHighlight = (id: string) => {
    setMatchedSuggestionId(id);
    if (!id) return;
    const suggestion = queueSuggestions.find(item => item.id === id);
    if (!suggestion) return;
    const date = startOfDay(new Date(suggestion.scheduledAt));
    if (!days.some(day => isSameDay(day, date))) {
      setAnchor(date);
      setSelectedDate(date);
    }
    const key = dateKey(date);
    window.setTimeout(() => {
      const container = calendarScrollRef.current;
      const target = container?.querySelector<HTMLElement>(`[data-calendar-date="${key}"]`);
      if (!container || !target) return;
      container.scrollTo({
        left: Math.max(0, target.offsetLeft - (container.clientWidth - target.clientWidth) / 2),
        behavior: 'smooth',
      });
    }, 80);
  };

  const handleSuggestionActivate = (id: string) => {
    setActiveSuggestionId('');
    handleSuggestionHighlight(id);
    window.setTimeout(() => calendarTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 40);
  };

  const moveSuggestion = useCallback((id: string, scheduledAt: Date) => {
    setSuggestionOverrides(previous => ({ ...previous, [id]: scheduledAt.toISOString() }));
  }, []);

  useEffect(() => {
    setSuggestionOverrides({});
    setQueueSuggestions([]);
  }, [selectedMarket, selectedPlatform]);

  const selectedScores = scores[selectedDate.getDay()] || [];
  const matchedSuggestionDate = useMemo(() => {
    const suggestion = queueSuggestions.find(item => item.id === matchedSuggestionId || item.id === calendarDragSuggestionId);
    return suggestion ? dateKey(new Date(suggestion.scheduledAt)) : '';
  }, [calendarDragSuggestionId, matchedSuggestionId, queueSuggestions]);

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

  const moveSuggestionToDay = (suggestionId: string, day: Date) => {
    const suggestion = queueSuggestions.find(item => item.id === suggestionId);
    if (!suggestion) return;
    const source = new Date(suggestion.scheduledAt);
    const target = startOfDay(day);
    target.setHours(source.getHours(), source.getMinutes(), 0, 0);
    moveSuggestion(suggestionId, target);
    setAiLayoutEnabled(true);
    setSelectedDate(startOfDay(day));
    setActiveSuggestionId('');
    if (calendarDragSuggestionId === suggestionId) {
      window.setTimeout(() => setCalendarDragSuggestionId(''), 1600);
    }
    setInteractionMessage(`“${suggestion.title}”已移到 ${target.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}，确认后才会进入正式排期。`);
  };

  const handleConfirmed = (post: CalendarPost) => {
    setItems(previous => previous.some(item => item.id === post.id) ? previous : [...previous, post]);
    setRecentlyConfirmedId(post.id);
    setInteractionMessage(`“${post.title}”已确认并转移到内容日历。`);
    window.setTimeout(() => setRecentlyConfirmedId(''), 2400);
    window.setTimeout(() => calendarTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
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
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <CalendarDays size={15} className="text-emerald-600" />
            <h3 className="text-sm font-black text-text-primary">内容日历</h3>
          </div>
          <button
            type="button"
            data-lingshu-guide="ai-layout"
            onClick={() => {
              setAiLayoutEnabled(previous => {
                const next = !previous;
                setInteractionMessage(next ? '已让 AI 按当前发布节奏预排到日历；所有建议仍需逐条确认。' : '已隐藏 AI 预排建议，正式发布内容不受影响。');
                return next;
              });
            }}
            className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-black transition ${
              aiLayoutEnabled
                ? 'border-violet-300 bg-violet-600 text-white shadow-sm'
                : 'border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100'
            }`}
          >
            <Sparkles size={13} /> {aiLayoutEnabled ? 'AI 排布已开启' : 'AI 帮我排布发布节奏'}
          </button>
        </div>

        <div data-lingshu-guide="publishing-tide" className="mt-3 rounded-xl border border-emerald-100 bg-emerald-50/30 px-3 pb-2 pt-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Waves size={14} className="text-emerald-600" />
              <span className="text-xs font-black text-text-primary">
                {selectedDate.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' })}发布潮汐
              </span>
              {isSameDay(selectedDate, today) && <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[9px] font-black text-white">今天</span>}
            </div>
            <span className="text-[9px] font-bold text-text-muted">
              目标市场：{enterpriseMarketLabel} · {scoreSource === '账号真实数据' ? scoreSource : `${scoreSource} · 非账号实测`} · 北京时间
            </span>
          </div>
          <svg viewBox="0 0 720 104" className="mt-2 h-[104px] w-full overflow-visible" role="img" aria-label="24 小时发布潮汐折线图">
            <defs>
              <linearGradient id="publishing-tide-fill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="#10b981" stopOpacity="0.28" />
                <stop offset="100%" stopColor="#10b981" stopOpacity="0.02" />
              </linearGradient>
            </defs>
            {[20, 50, 80].map(y => <line key={y} x1="22" x2="698" y1={y} y2={y} stroke="#d1fae5" strokeDasharray="4 5" />)}
            <polygon
              points={`22,88 ${Array.from({ length: 24 }, (_, hour) => `${22 + hour * (676 / 23)},${88 - (selectedScores[hour] || 0) * 68}`).join(' ')} 698,88`}
              fill="url(#publishing-tide-fill)"
            />
            <polyline
              points={Array.from({ length: 24 }, (_, hour) => `${22 + hour * (676 / 23)},${88 - (selectedScores[hour] || 0) * 68}`).join(' ')}
              fill="none"
              stroke="#10b981"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {Array.from({ length: 24 }, (_, hour) => {
              const score = selectedScores[hour] || 0;
              if (hour % 3 !== 0 && hour !== 23) return null;
              return (
                <g key={hour}>
                  <circle cx={22 + hour * (676 / 23)} cy={88 - score * 68} r="3.5" fill="#fff" stroke="#059669" strokeWidth="2">
                    <title>{`北京 ${hour}:00 · ${market.timeZoneLabel} ${hourLabel(targetHourFromBeijing(hour, utcOffset))} · 推荐分 ${Math.round(score * 100)}`}</title>
                  </circle>
                  <text x={22 + hour * (676 / 23)} y="102" textAnchor="middle" fontSize="8" fill="#64748b">{String(hour).padStart(2, '0')}</text>
                </g>
              );
            })}
          </svg>
        </div>

        {interactionMessage && (
          <div className="mt-2 rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-[11px] font-bold text-emerald-700">
            {interactionMessage}
          </div>
        )}
        {calendarDragSuggestionId && (() => {
          const suggestion = queueSuggestions.find(item => item.id === calendarDragSuggestionId);
          return suggestion ? (
            <div className="mt-2 flex items-center justify-between gap-3 rounded-xl border border-violet-300 bg-white px-3 py-2 shadow-md ring-2 ring-violet-100">
              <span className="inline-flex min-w-0 items-center gap-2">
                <Sparkles size={12} className="shrink-0 text-violet-600" />
                <span className="truncate text-[10px] font-black text-violet-800">对应队列已置顶：{suggestion.title}</span>
              </span>
              <span className="shrink-0 text-[9px] font-bold text-violet-600">{suggestion.scheduledAt.toLocaleString('zh-CN')}</span>
            </div>
          ) : null;
        })()}

        <div ref={calendarScrollRef} className="mt-3 max-h-[420px] overflow-auto pb-2">
          <div className={`grid min-w-[960px] grid-cols-7 gap-2 ${mode === 'month' ? 'auto-rows-fr' : ''}`}>
            {days.map(day => {
              const key = dateKey(day);
              const dayItems = itemsByDay[key] || [];
              const daySuggestions = suggestionsByDay[key] || [];
              const dayFestivalNotices = festivalNoticesByDay[key] || [];
              const isToday = isSameDay(day, today);
              const isSelected = isSameDay(day, selectedDate);
              const isFestivalHovered = hoveredEventDate === key;
              const isDragTarget = dragOverDate === key;
              const isQueueMatched = matchedSuggestionDate === key;
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
                  onMouseUp={() => {
                    if (activeSuggestionId) moveSuggestionToDay(activeSuggestionId, day);
                  }}
                  onDrop={event => {
                    event.preventDefault();
                    const suggestionId = event.dataTransfer.getData('application/x-lingshu-queue-suggestion');
                    if (suggestionId) {
                      moveSuggestionToDay(suggestionId, day);
                      setDragOverDate('');
                      return;
                    }
                    const id = event.dataTransfer.getData('text/post-id') || dragId;
                    if (id) void reschedule(id, day, 10);
                    setDragId('');
                    setDragOverDate('');
                  }}
                  className={`relative flex flex-col rounded-2xl border p-2 transition ${
                    mode === 'month' ? 'min-h-[112px]' : 'min-h-[210px]'
                  } ${
                    isDragTarget
                      ? 'scale-[1.015] border-violet-400 bg-violet-50 ring-4 ring-violet-100 shadow-lg'
                      : isFestivalHovered
                        ? 'scale-[1.02] border-orange-400 bg-orange-50 ring-4 ring-orange-100 shadow-lg'
                        : isQueueMatched
                          ? 'border-violet-400 bg-violet-50/70 ring-2 ring-violet-200 shadow-md'
                          : isToday
                            ? 'border-emerald-400 bg-emerald-50/40 shadow-[0_8px_24px_rgba(16,185,129,0.12)]'
                            : isSelected
                              ? 'border-sky-300 bg-sky-50/30 ring-2 ring-sky-100'
                              : 'border-border bg-white'
                  } ${isOutsideMonth ? 'opacity-45' : ''}`}
                >
                  {isQueueMatched && (
                    <span className="absolute -top-2 left-2 rounded-full bg-violet-600 px-2 py-0.5 text-[8px] font-black text-white shadow-sm">对应队列</span>
                  )}
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

                  {dayFestivalNotices.length > 0 && (
                    <div className="mb-2 space-y-1">
                      {dayFestivalNotices.slice(0, mode === 'month' ? 1 : 3).map(notice => (
                        <button
                          key={`${notice.event.id}-${notice.isReminder ? 'reminder' : 'event'}`}
                          type="button"
                          onMouseEnter={() => setHoveredEventDate(key)}
                          onMouseLeave={() => setHoveredEventDate('')}
                          onFocus={() => setHoveredEventDate(key)}
                          onBlur={() => setHoveredEventDate('')}
                          onClick={() => setSelectedDate(startOfDay(day))}
                          className={`flex w-full items-start gap-1 rounded-lg border px-1.5 py-1 text-left ${eventTone(notice.event)}`}
                          title={notice.event.name}
                        >
                          <Flag size={9} className="mt-0.5 shrink-0" />
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center justify-between gap-1 text-[9px] font-black">
                              <span className="truncate">{notice.event.shortName}</span>
                              <span className="shrink-0">{notice.isReminder ? `D-${notice.days}` : '当天'}</span>
                            </span>
                            <span className="block truncate text-[8px] font-bold opacity-75">
                              {dateFromKey(notice.event.date).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })} · {notice.phaseLabel}
                            </span>
                          </span>
                        </button>
                      ))}
                      {dayFestivalNotices.length > (mode === 'month' ? 1 : 3) && (
                        <p className="text-center text-[8px] font-bold text-orange-600">
                          另有 {dayFestivalNotices.length - (mode === 'month' ? 1 : 3)} 个节庆提醒
                        </p>
                      )}
                    </div>
                  )}

                  <div className="space-y-1.5">
                    {daySuggestions.slice(0, mode === 'month' ? 1 : 3).map(suggestion => {
                      const isMatched = matchedSuggestionId === suggestion.id || calendarDragSuggestionId === suggestion.id;
                      return (
                        <button
                          key={suggestion.id}
                          type="button"
                          draggable
                          onMouseDown={() => {
                            setActiveSuggestionId(suggestion.id);
                            setCalendarDragSuggestionId(suggestion.id);
                            setMatchedSuggestionId(suggestion.id);
                          }}
                          onDragStart={event => {
                            setActiveSuggestionId(suggestion.id);
                            setCalendarDragSuggestionId(suggestion.id);
                            setMatchedSuggestionId(suggestion.id);
                            event.dataTransfer.effectAllowed = 'move';
                            event.dataTransfer.setData('application/x-lingshu-queue-suggestion', suggestion.id);
                            event.dataTransfer.setData('text/plain', suggestion.title);
                          }}
                          onDragEnd={() => {
                            setActiveSuggestionId('');
                            window.setTimeout(() => setCalendarDragSuggestionId(''), 1600);
                          }}
                          onMouseEnter={event => {
                            setMatchedSuggestionId(suggestion.id);
                            previewAt(event, { kind: 'suggestion', suggestion });
                          }}
                          onMouseMove={event => previewAt(event, { kind: 'suggestion', suggestion })}
                          onMouseLeave={() => {
                            setMatchedSuggestionId('');
                            setHoveredContent(null);
                          }}
                          onClick={() => setSelectedDate(startOfDay(day))}
                          className={`w-full cursor-grab rounded-xl border border-dashed bg-amber-50/80 p-1.5 text-left text-amber-800 shadow-sm transition hover:-translate-y-0.5 ${
                            isMatched ? 'border-violet-400 ring-2 ring-violet-200' : 'border-amber-400'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-1 text-[9px] font-black">
                            <span className="inline-flex items-center gap-1"><Sparkles size={9} /> AI 建议</span>
                            <span>{new Date(suggestion.scheduledAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>
                          </div>
                          <p className="mt-1 line-clamp-2 text-[10px] font-bold leading-tight">{suggestion.title}</p>
                        </button>
                      );
                    })}
                    {dayItems.slice(0, mode === 'month' ? 1 : 4).map(item => {
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
                          className={`w-full rounded-xl border p-1.5 text-left shadow-sm transition hover:-translate-y-0.5 ${meta.className} ${
                            recentlyConfirmedId === item.id ? 'animate-pulse ring-4 ring-emerald-200' : ''
                          }`}
                        >
                          <div className="flex items-center justify-between gap-1 text-[9px] font-black">
                            <PlatformBadge platform={item.platform} compact />
                            <span>{new Date(item.publishedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>
                          </div>
                          <p className="mt-1 line-clamp-2 text-[10px] font-bold leading-tight">{item.title}</p>
                          {mode === 'week' && (
                            <div className="mt-1.5 flex items-center justify-between gap-1 text-[9px]">
                              <span className="inline-flex items-center gap-0.5"><meta.Icon size={9} /> {meta.label}</span>
                              {item.platformPostId && <span>{item.inquiries} 询盘</span>}
                            </div>
                          )}
                        </button>
                      );
                    })}
                    {dayItems.length > (mode === 'month' ? 1 : 4) && (
                      <p className="text-center text-[9px] font-bold text-text-muted">还有 {dayItems.length - (mode === 'month' ? 1 : 4)} 条</p>
                    )}
                    {daySuggestions.length > (mode === 'month' ? 1 : 3) && (
                      <p className="text-center text-[9px] font-bold text-amber-600">另有 {daySuggestions.length - (mode === 'month' ? 1 : 3)} 条 AI 建议</p>
                    )}
                  </div>

                  {mode === 'week' && dayItems.length === 0 && daySuggestions.length === 0 && (
                    <button
                      type="button"
                      onClick={() => onCreate?.(day)}
                      className="mt-auto flex w-full items-center justify-center gap-1 rounded-lg border border-dashed border-sky-200 bg-sky-50/60 px-2 py-2 text-[10px] font-bold text-sky-700 hover:border-sky-300 hover:bg-sky-50"
                    >
                      <Plus size={11} /> 安排内容
                    </button>
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
        marketTimeZoneLabel={market.timeZoneLabel}
        utcOffset={utcOffset}
        posts={items}
        scores={scores}
        marketingEvents={marketingEvents}
        onCreate={onCreate}
        onOpenPost={onOpenPost}
        onConfirmed={handleConfirmed}
        suggestionOverrides={suggestionOverrides}
        onSuggestionMove={moveSuggestion}
        onSuggestionsChange={handleSuggestionsChange}
        onSuggestionDragState={setActiveSuggestionId}
        highlightedSuggestionId={matchedSuggestionId}
        pinnedSuggestionId={calendarDragSuggestionId}
        onSuggestionHighlight={handleSuggestionHighlight}
        onSuggestionActivate={handleSuggestionActivate}
      />

      {hoveredContent && (
        <div
          className="pointer-events-none fixed z-[120] w-[292px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_18px_50px_rgba(15,23,42,0.22)]"
          style={{
            left: Math.max(12, Math.min(hoveredContent.x + 14, (typeof window === 'undefined' ? 1440 : window.innerWidth) - 304)),
            top: Math.max(12, Math.min(hoveredContent.y + 14, (typeof window === 'undefined' ? 900 : window.innerHeight) - 286)),
          }}
        >
          {hoveredContent.kind === 'post' ? (() => {
            const post = hoveredContent.post;
            const meta = statusMeta(post);
            return (
              <>
                <div className="relative flex aspect-video items-center justify-center overflow-hidden bg-gradient-to-br from-slate-900 via-slate-800 to-emerald-950">
                  {post.videoUrl ? (
                    <video src={post.videoUrl} poster={post.coverUrl} autoPlay muted loop playsInline className="h-full w-full object-cover" />
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
                  {post.firstComment && <p className="mt-2 line-clamp-2 text-[9px] leading-relaxed text-text-muted">首评：{post.firstComment}</p>}
                </div>
              </>
            );
          })() : (
            <div className="p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-[9px] font-black text-amber-700">
                  <Sparkles size={10} /> AI 建议 · 待确认
                </span>
                <span className="text-[9px] text-text-muted">{new Date(hoveredContent.suggestion.scheduledAt).toLocaleString('zh-CN')}</span>
              </div>
              <p className="mt-3 text-sm font-black leading-snug text-text-primary">{hoveredContent.suggestion.title}</p>
              <p className="mt-2 text-[10px] leading-relaxed text-text-secondary">{hoveredContent.suggestion.brief}</p>
              <div className="mt-3 flex flex-wrap gap-1">
                {hoveredContent.suggestion.tags.map(tag => (
                  <span key={tag} className="rounded-full bg-amber-50 px-2 py-1 text-[9px] font-bold text-amber-700">#{tag}</span>
                ))}
              </div>
              <p className="mt-3 border-t border-amber-100 pt-2 text-[9px] font-bold text-amber-700">可继续拖到其他日期；在左侧确认后才成为正式排期。</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
