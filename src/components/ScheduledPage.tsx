import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Activity, AlertTriangle, BarChart3, Building2, ChevronDown, CircleDollarSign, Clock, Download, DownloadCloud, ExternalLink, Globe2, Loader, Play, Plus, RefreshCw, Search, Trash2, TrendingUp, X, CheckCircle } from 'lucide-react';
import type { AgentAction, AgentType } from '../App';
import { completeDemoStep, readDemoProgress } from '../lib/demoProgress';
import { authHeader } from '../lib/auth';
import { SocialPlatformIcon } from './SocialPlatformIcon';
import { normalizeKeywordInput, type KeywordPlatform } from '../lib/keywordInput';

interface ScheduledTask {
  id: string;
  name: string;
  category: 'daily' | 'monitor' | 'report' | 'automation';
  taskType: string;
  cronExpr: string;
  cronLabel: string;
  enabled: boolean;
  lastRun?: string;
  lastResult?: string;
  channelId?: string;
  config: Record<string, string>;
  createdAt: string;
}

interface VideoAnalysisItem {
  id: string;
  title: string;
  platform: string;
  thumbnailUrl?: string;
  duration?: number;
  status: 'analyzing' | 'analyzed' | 'failed' | 'paused';
  analysisMode?: string;
  updatedAt?: string;
  error?: string;
}

interface VideoStatsPayload {
  tasks?: ScheduledTask[];
  stats?: {
    updatedAt?: string;
    crawl?: {
      total?: number;
      today?: number;
      last24h?: number;
      latestAt?: string;
      byPlatform?: Record<string, number>;
    };
    fetchQueue?: {
      queued?: number;
      byStatus?: Record<string, number>;
      ops?: {
        total?: number;
        workerActive?: boolean;
        workerEnabled?: boolean;
      };
    };
    analysisQueue?: {
      queued?: number;
      byStatus?: Record<string, number>;
      pendingRecords?: number;
      analyzedRecords?: number;
      failedRecords?: number;
      items?: VideoAnalysisItem[];
      refinementItems?: Array<{
        id: string;
        title: string;
        platform: string;
        thumbnailUrl?: string;
        duration?: number;
        status: string;
        analysisMode?: string;
        analysisQuality?: string;
        syncedAt: string;
        analyzedAt?: string;
      }>;
    };
  };
}

function safeAnalysisActionMessage(message: unknown, fallback: string): string {
  const text = String(message || '').trim();
  if (!text) return fallback;
  if (/404|not found|unable to download|download webpage|unsupported url/i.test(text)) return '源视频暂时无法获取，请确认链接有效后重试。';
  if (/429|quota|resource_exhausted|额度|余额/i.test(text)) return 'AI 分析额度暂时不足，请稍后重试。';
  if (/timeout|timed out|超时/i.test(text)) return '视频分析超时，请稍后重试。';
  if (/command failed|python3|yt_dlp|\/app\/|ffmpeg|bearer|api[_-]?key/i.test(text)) return fallback;
  return text.slice(0, 120);
}

interface BusinessDynamicsPayload {
  generatedAt?: string;
  cached?: boolean;
  profile?: {
    companyName?: string;
    industry?: string;
    markets?: string[];
    products?: string[];
    pricingRule?: string;
    completion?: number;
    completionTotal?: number;
    missingFields?: string[];
    aiAccessEnabled?: boolean;
  };
  quote?: {
    baseCurrency?: string;
    sourceDate?: string;
    rates?: Array<{ code: string; rate: number; market: string }>;
    productPriceRange?: string;
    moq?: string;
    minMargin?: string;
    recommendation?: string;
  };
  intelligence?: {
    status?: 'ready' | 'profile_incomplete' | 'unavailable';
    summary?: string;
    signals?: Array<{ market: string; title: string; impact: string; action: string; risk: 'low' | 'medium' | 'high'; sourceTitle?: string; sourceUrl?: string }>;
    sources?: Array<{ title: string; url: string }>;
    error?: string;
  };
}

type AgentTaskGroup = 'social' | 'conversion' | 'customer';
type SocialTaskTab = 'crawler' | 'analysis';
interface NextAction {
  label: string;
  agent: AgentType;
  agentLabel: string;
  prompt: string;
}

const AGENT_GROUPS: { id: AgentTaskGroup; label: string; desc: string }[] = [
  { id: 'conversion', label: '经营动态定时任务', desc: '报价、主要市场和行业情报' },
  { id: 'social', label: '我的社媒定时任务', desc: '内容采集、趋势监控、社媒素材分析' },
  { id: 'customer', label: '老客唤醒定时任务', desc: '老客分层、沉默唤醒、复购触达' },
];

function taskAgentGroup(taskType: string): AgentTaskGroup {
  if (['video_keyword_crawl', 'image_post_crawl', 'competitor_account_crawl', 'trend_report', 'holiday_push'].includes(taskType)) return 'social';
  if (['crm_wakeup'].includes(taskType)) return 'customer';
  return 'conversion';
}

const TASK_TEMPLATES = [
  {
    templateId: 'instagram_video_keyword_crawl',
    taskType: 'video_keyword_crawl',
    name: 'Instagram 视频采集',
    category: 'daily' as const,
    cronExpr: '0 1 * * *',
    cronLabel: '每天 01:00（北京时间）',
    icon: '📸',
    desc: '定时采集 Instagram 关键词视频，并进入素材分析管线',
    config: { platforms: 'instagram', keywords: 'skincare', limit: '5', dateWindowDays: '7' },
  },
  {
    templateId: 'instagram_image_post_crawl', taskType: 'image_post_crawl', name: 'Instagram 图文采集', category: 'daily' as const,
    cronExpr: '0 2 * * *', cronLabel: '每天 02:00（北京时间）', icon: '🖼️', desc: '定时采集 Instagram 关键词图片帖与图文内容',
    config: { platforms: 'instagram', keywords: 'skincare', limit: '5' },
  },
  {
    templateId: 'facebook_image_post_crawl', taskType: 'image_post_crawl', name: 'Facebook 图文采集', category: 'daily' as const,
    cronExpr: '0 3 * * *', cronLabel: '每天 03:00（北京时间）', icon: '📘', desc: '定时采集 Facebook 关键词图片帖与图文内容',
    config: { platforms: 'facebook', keywords: 'skincare', limit: '5' },
  },
  ...(['youtube', 'tiktok', 'facebook', 'instagram'] as const).map((platform, index) => ({
    templateId: `${platform}_competitor_account_crawl`,
    taskType: 'competitor_account_crawl',
    name: `${platform === 'youtube' ? 'YouTube' : platform === 'tiktok' ? 'TikTok' : platform === 'facebook' ? 'Facebook' : 'Instagram'} 对标账号采集`,
    category: 'daily' as const,
    cronExpr: `0 ${4 + index} * * *`,
    cronLabel: `每天 ${String(4 + index).padStart(2, '0')}:00（北京时间）`,
    icon: platform === 'youtube' ? '▶️' : platform === 'tiktok' ? '🎵' : platform === 'facebook' ? '📘' : '📸',
    desc: `定时采集已保存的${platform === 'youtube' ? ' YouTube' : platform === 'tiktok' ? ' TikTok' : platform === 'facebook' ? ' Facebook' : ' Instagram'} 对标账号最新内容`,
    config: { platforms: platform, limit: '10', dateWindowDays: '7' },
  })),
  {
    templateId: 'youtube_video_keyword_crawl',
    taskType: 'video_keyword_crawl',
    name: 'YouTube 热点视频采集',
    category: 'daily' as const,
    cronExpr: '0 1 * * *',
    cronLabel: '每天 01:00（北京时间）',
    icon: <SocialPlatformIcon platform="youtube" size={24} />,
    desc: '每天凌晨自动采集 YouTube 热点关键词视频，并排队获取真实视频 / Gemini 分析',
    config: { platforms: 'youtube', keywords: 'skincare', limit: '5', dateWindowDays: '7' },
  },
  {
    templateId: 'tiktok_video_keyword_crawl',
    taskType: 'video_keyword_crawl',
    name: 'TikTok 热点视频采集',
    category: 'daily' as const,
    cronExpr: '0 1 * * *',
    cronLabel: '每天 01:00（北京时间）',
    icon: <SocialPlatformIcon platform="tiktok" size={24} />,
    desc: '每天凌晨自动采集 TikTok 热点关键词视频，并排队获取真实视频 / Gemini 分析',
    config: { platforms: 'tiktok', keywords: 'skincare', limit: '5', dateWindowDays: '7' },
  },
  {
    templateId: 'facebook_video_keyword_crawl',
    taskType: 'video_keyword_crawl',
    name: 'Facebook 热点视频采集',
    category: 'daily' as const,
    cronExpr: '0 1 * * *',
    cronLabel: '每天 01:00（北京时间）',
    icon: <SocialPlatformIcon platform="facebook" size={24} />,
    desc: '每天凌晨自动采集 Facebook 热点关键词视频，并排队获取真实视频 / AI 分析',
    config: { platforms: 'facebook', keywords: 'skincare', limit: '5', dateWindowDays: '7' },
  },
  { templateId: 'trend_report', taskType: 'trend_report', name: 'TikTok 爆款日报', category: 'daily' as const, cronExpr: '0 8 * * *', cronLabel: '每天 08:00', icon: <SocialPlatformIcon platform="tiktok" size={24} />, desc: '每日生成 TikTok 跨境电商热门趋势简报' },
  { templateId: 'exchange_rate', taskType: 'exchange_rate', name: '汇率与报价日报', category: 'daily' as const, cronExpr: '0 9 * * *', cronLabel: '每天 09:00', icon: '💱', desc: '按企业主要市场刷新汇率，并结合价格区间、MOQ 和毛利规则给出报价提醒' },
  { templateId: 'market_intelligence', taskType: 'market_intelligence', name: '主要市场行业周报', category: 'report' as const, cronExpr: '0 9 * * 1', cronLabel: '每周一 09:00', icon: '🌐', desc: '基于企业中心行业与市场，联网检索需求、合规、渠道和竞争动态并附公开来源' },
  { templateId: 'crm_wakeup', taskType: 'crm_wakeup', name: '沉默客户唤醒', category: 'automation' as const, cronExpr: '0 10 * * 1', cronLabel: '每周一 10:00', icon: '💌', desc: '自动生成针对 60 天沉默老客的唤醒消息并推送' },
  { templateId: 'holiday_push', taskType: 'holiday_push', name: '节日推品提醒', category: 'monitor' as const, cronExpr: '0 9 * * *', cronLabel: '每天 09:00', icon: '🎉', desc: '节日前 7 天自动提醒备货和推品策略' },
];
type TaskTemplate = (typeof TASK_TEMPLATES)[number];

const TEMPLATE_GROUPS = [
  { id: 'video', label: '视频采集', desc: '按平台和关键词采集视频', taskTypes: ['video_keyword_crawl'] },
  { id: 'image', label: '图文采集', desc: '采集图片帖与图文内容', taskTypes: ['image_post_crawl'] },
  { id: 'competitor', label: '对标账号采集', desc: '采集已保存账号的最新内容', taskTypes: ['competitor_account_crawl'] },
  { id: 'automation', label: '其他自动化', desc: '报告、提醒和客户运营任务', taskTypes: ['trend_report', 'holiday_push', 'exchange_rate', 'market_intelligence', 'weekly_review', 'crm_wakeup'] },
] as const;

const CRON_PRESETS = [
  { label: '每天 01:00（北京时间）', expr: '0 1 * * *' },
  { label: '每天 08:00', expr: '0 8 * * *' },
  { label: '每天 09:00', expr: '0 9 * * *' },
  { label: '每天 18:00', expr: '0 18 * * *' },
  { label: '每周一 10:00', expr: '0 10 * * 1' },
  { label: '每周五 18:00', expr: '0 18 * * 5' },
  { label: '每月1号 09:00', expr: '0 9 1 * *' },
];
const CRAWLER_CRON_PRESET = CRON_PRESETS[0];
const CRAWLER_LIMIT_MIN = 1;
const CRAWLER_LIMIT_MAX = 10;
const WEEKDAYS = [
  { value: '1', label: '周一' }, { value: '2', label: '周二' }, { value: '3', label: '周三' },
  { value: '4', label: '周四' }, { value: '5', label: '周五' }, { value: '6', label: '周六' }, { value: '0', label: '周日' },
];

function templateSchedule(template: TaskTemplate): { time: string; days: string[] } {
  const [minute = '0', hour = '8', , , weekdays = '*'] = template.cronExpr.split(/\s+/);
  return {
    time: `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`,
    days: weekdays === '*' ? [] : weekdays.split(','),
  };
}

function scheduleLabel(time: string, days: string[]): string {
  const dayLabel = days.length === 0
    ? '每天'
    : WEEKDAYS.filter(day => days.includes(day.value)).map(day => day.label).join('、');
  return `${dayLabel} ${time}（北京时间）`;
}

function normalizedTemplateConfig(template: TaskTemplate): Record<string, string> {
  return Object.fromEntries(Object.entries(template.config ?? {}).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
}

function normalizeCrawlerLimit(value: string): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '5';
  return String(Math.max(CRAWLER_LIMIT_MIN, Math.min(CRAWLER_LIMIT_MAX, Math.round(numeric))));
}

export default function ScheduledPage({ onAction }: { onAction?: AgentAction }) {
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeGroup, setActiveGroup] = useState<AgentTaskGroup>(() => {
    const saved = window.sessionStorage.getItem('scheduled.activeGroup');
    return saved === 'social' || saved === 'customer' || saved === 'conversion' ? saved : 'conversion';
  });
  const [socialTaskTab, setSocialTaskTab] = useState<SocialTaskTab>(() => (
    window.sessionStorage.getItem('scheduled.socialTaskTab') === 'analysis' ? 'analysis' : 'crawler'
  ));
  const [showAdd, setShowAdd] = useState(false);
  const [selectedTemplateIds, setSelectedTemplateIds] = useState<string[]>([]);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleTime, setScheduleTime] = useState('08:00');
  const [scheduleDays, setScheduleDays] = useState<string[]>([]);
  const [customName, setCustomName] = useState('');
  const [taskKeywords, setTaskKeywords] = useState('foundation');
  const [confirmedKeywordSignature, setConfirmedKeywordSignature] = useState('');
  const [runAfterCreate, setRunAfterCreate] = useState(true);
  const [createError, setCreateError] = useState('');
  const [creatingTasks, setCreatingTasks] = useState(false);
  const runResult: Record<string, string> = {};
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [resultTaskId, setResultTaskId] = useState<string | null>(null);
  const [workspaceMessage, setWorkspaceMessage] = useState('');
  const [exportingId, setExportingId] = useState<string | null>(null);
  const [exportNotice, setExportNotice] = useState<{ taskId: string; message: string; error: boolean } | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [videoStats, setVideoStats] = useState<VideoStatsPayload | null>(null);
  const [analysisQueueOpen, setAnalysisQueueOpen] = useState(() => window.sessionStorage.getItem('scheduled.analysisQueueOpen') === 'true');
  const [analysisActionId, setAnalysisActionId] = useState<string | null>(null);
  const [analysisActionError, setAnalysisActionError] = useState('');
  const [businessDynamics, setBusinessDynamics] = useState<BusinessDynamicsPayload | null>(null);
  const [businessDynamicsLoading, setBusinessDynamicsLoading] = useState(true);
  const [businessDynamicsError, setBusinessDynamicsError] = useState('');
  const didAutoOpenDemoTask = useRef(false);

  const closeResultPanel = () => {
    // 用户主动关闭后，本次页面生命周期内不再由演示引导自动拉起任务侧栏。
    didAutoOpenDemoTask.current = true;
    setResultTaskId(null);
    setWorkspaceMessage('');
  };

  useEffect(() => {
    void fetchTasks();
    void fetchVideoStats();
    void fetchBusinessDynamics();
    const timer = window.setInterval(() => {
      void fetchTasks(false);
      void fetchVideoStats();
    }, 5000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    window.sessionStorage.setItem('scheduled.activeGroup', activeGroup);
    window.sessionStorage.setItem('scheduled.socialTaskTab', socialTaskTab);
    window.sessionStorage.setItem('scheduled.analysisQueueOpen', String(analysisQueueOpen));
  }, [activeGroup, socialTaskTab, analysisQueueOpen]);

  useEffect(() => {
    if (didAutoOpenDemoTask.current) return;
    const progress = readDemoProgress();
    if (!progress.scheduler || progress.automation_workflow || resultTaskId || tasks.length === 0) return;
    didAutoOpenDemoTask.current = true;
    setResultTaskId(tasks[0].id);
  }, [resultTaskId, tasks]);

  useEffect(() => {
    if (!resultTaskId) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeResultPanel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [resultTaskId]);

  async function fetchTasks(showLoading = true) {
    if (showLoading) setLoading(true);
    try {
      const r = await fetch('/api/overseas/scheduler', { headers: authHeader() });
      if (!r.ok) {
        setTasks([]);
        return;
      }
      setTasks(await r.json());
    } finally { if (showLoading) setLoading(false); }
  }

  async function fetchVideoStats() {
    try {
      const r = await fetch('/api/overseas/scheduler/video-stats', { headers: authHeader() });
      if (!r.ok) return;
      setVideoStats(await r.json());
    } catch {
      // Keep the previous snapshot visible during backend hot reloads.
    }
  }

  async function updateVideoAnalysis(item: VideoAnalysisItem, action: 'pause' | 'reanalyze') {
    setAnalysisActionId(item.id);
    setAnalysisActionError('');
    try {
      const response = await fetch(
        action === 'pause'
          ? `/api/overseas/videos/${item.id}/analysis-pause`
          : `/api/overseas/videos/${item.id}/reanalyze`,
        {
          method: action === 'pause' ? 'POST' : 'PATCH',
          headers: { 'Content-Type': 'application/json', ...authHeader() },
          body: action === 'reanalyze'
            ? JSON.stringify({ analysisMode: item.analysisMode === 'exact' ? 'exact' : 'strategy' })
            : JSON.stringify({}),
        },
      );
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(safeAnalysisActionMessage(payload.error, action === 'pause' ? '暂停分析失败，请稍后重试。' : '重新分析失败，请稍后重试。'));
      await fetchVideoStats();
    } catch (error) {
      setAnalysisActionError(error instanceof Error ? error.message : '操作失败');
    } finally {
      setAnalysisActionId(null);
    }
  }

  async function fetchBusinessDynamics(forceRefresh = false) {
    setBusinessDynamicsLoading(true);
    setBusinessDynamicsError('');
    try {
      const query = forceRefresh ? '?refresh=1' : '';
      const response = await fetch(`/api/overseas/scheduler/business-dynamics${query}`, { headers: authHeader() });
      const payload = await response.json().catch(() => null) as BusinessDynamicsPayload & { message?: string } | null;
      if (!response.ok || !payload) throw new Error(payload?.message || '经营动态暂时无法生成');
      setBusinessDynamics(payload);
    } catch (error) {
      setBusinessDynamicsError(error instanceof Error ? error.message : '经营动态暂时无法生成');
    } finally {
      setBusinessDynamicsLoading(false);
    }
  }

  async function createTask() {
    const selectedTemplates = TASK_TEMPLATES.filter(template => selectedTemplateIds.includes(template.templateId));
    if (!selectedTemplates.length || creatingTasks) return;
    const keywordTemplates = selectedTemplates.filter(template => ['video_keyword_crawl', 'image_post_crawl'].includes(template.taskType));
    const reviews = keywordTemplates.map(template => {
      const platform = String(('config' in template ? template.config?.platforms : '') || 'youtube') as KeywordPlatform;
      return { template, platform, review: normalizeKeywordInput(taskKeywords, platform) };
    });
    const signature = reviews.map(({ platform, review }) => `${platform}:${review.serialized}`).join('|');
    if (reviews.some(({ review }) => review.items.length === 0) || (reviews.length > 0 && confirmedKeywordSignature !== signature)) {
      setCreateError('请先确认自动清洗后的关键词，再创建任务。');
      return;
    }
    const [hour = '8', minute = '0'] = scheduleTime.split(':');
    const cronExpr = `${Number(minute) || 0} ${Number(hour) || 0} * * ${scheduleDays.length ? scheduleDays.join(',') : '*'}`;
    setCreatingTasks(true);
    setCreateError('');
    try {
      const created: ScheduledTask[] = [];
      for (const template of selectedTemplates) {
        const templateConfig = normalizedTemplateConfig(template);
        const platform = String(templateConfig.platforms || 'youtube') as KeywordPlatform;
        const cleanedKeywords = normalizeKeywordInput(taskKeywords, platform).serialized;
        const saved = await createTaskFromTemplate(
          template,
          selectedTemplates.length === 1 ? customName : '',
          cronExpr,
          scheduleLabel(scheduleTime, scheduleDays),
          false,
          ['video_keyword_crawl', 'image_post_crawl'].includes(template.taskType)
            ? { ...templateConfig, keywords: cleanedKeywords }
            : templateConfig,
        );
        created.push(saved);
      }
      if (runAfterCreate) {
        const crawlerTasks = created.filter(task => ['video_keyword_crawl', 'image_post_crawl', 'competitor_account_crawl'].includes(task.taskType));
        const results = await Promise.all(crawlerTasks.map(async task => {
          const response = await fetch(`/api/overseas/scheduler/${task.id}/run`, { method: 'POST', headers: authHeader() });
          if (!response.ok) throw new Error(`${task.name} 启动失败`);
          return response.json();
        }));
        if (results.length) setWorkspaceMessage(`已创建 ${created.length} 个任务，并启动 ${results.length} 个爬虫任务。`);
      }
      await fetchTasks();
      await fetchVideoStats();
      setShowAdd(false);
      setSelectedTemplateIds([]);
      setCustomName('');
      setConfirmedKeywordSignature('');
      setScheduleOpen(false);
      if (created.length) setResultTaskId(created[created.length - 1].id);
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : '任务创建或执行失败，请重试。');
    } finally {
      setCreatingTasks(false);
    }
  }

  async function createTaskFromTemplate(template: TaskTemplate, name = '', cronExpr = '', customLabel = '', refresh = true, config: Record<string, string> = normalizedTemplateConfig(template)): Promise<ScheduledTask> {
    const resolvedCronExpr = cronExpr || template.cronExpr;
    const body = {
      ...template,
      name: name || template.name,
      config,
      cronExpr: resolvedCronExpr,
      cronLabel: customLabel || CRON_PRESETS.find(p => p.expr === resolvedCronExpr)?.label || template.cronLabel,
    };
    const response = await fetch('/api/overseas/scheduler', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error('定时任务创建失败');
    const saved = await response.json() as ScheduledTask;
    completeDemoStep('scheduler');
    if (refresh) await fetchTasks();
    return saved;
  }

  async function toggleTask(id: string) {
    await fetch(`/api/overseas/scheduler/${id}/toggle`, { method: 'POST', headers: authHeader() });
    await fetchTasks();
  }

  async function deleteTask(id: string) {
    await fetch(`/api/overseas/scheduler/${id}`, { method: 'DELETE', headers: authHeader() });
    if (resultTaskId === id) setResultTaskId(null);
    await fetchTasks();
  }

  async function runTaskNow(id: string) {
    setRunningId(id);
    try {
      await fetch(`/api/overseas/scheduler/${id}/run`, { method: 'POST', headers: authHeader() });
      await fetchTasks();
      await fetchVideoStats();
    } finally {
      setRunningId(null);
    }
  }

  async function updateCrawlerConfig(task: ScheduledTask, patch: Record<string, string>) {
    if (task.taskType !== 'video_keyword_crawl') return;
    const nextConfig = {
      ...task.config,
      ...patch,
      keywords: (patch.keywords ?? task.config.keywords ?? task.config.keyword ?? 'skincare').trim() || 'skincare',
      limit: normalizeCrawlerLimit(patch.limit ?? task.config.limit ?? '5'),
    };
    setTasks(prev => prev.map(item => item.id === task.id ? { ...item, config: nextConfig } : item));
    const res = await fetch(`/api/overseas/scheduler/${task.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({ config: nextConfig }),
    });
    if (!res.ok) {
      await fetchTasks();
      return;
    }
    const saved = await res.json() as ScheduledTask;
    setTasks(prev => prev.map(item => item.id === saved.id ? saved : item));
  }

  function selectGroup(group: AgentTaskGroup) {
    setActiveGroup(group);
    if (group !== 'social') setSocialTaskTab('crawler');
    if (group === 'conversion' && !businessDynamics && !businessDynamicsLoading) void fetchBusinessDynamics();
    setSelectedTemplateIds([]);
    setCustomName('');
    setTaskKeywords('foundation');
    setConfirmedKeywordSignature('');
    setCreateError('');
    setScheduleOpen(false);
    setResultTaskId(null);
    setWorkspaceMessage('');
  }

  function closeAddModal() {
    setShowAdd(false);
    setSelectedTemplateIds([]);
    setCustomName('');
    setTaskKeywords('foundation');
    setConfirmedKeywordSignature('');
    setCreateError('');
    setScheduleOpen(false);
  }

  function openAddModal() {
    setResultTaskId(null);
    setWorkspaceMessage('');
    setSelectedTemplateIds([]);
    setCustomName('');
    setTaskKeywords('foundation');
    setConfirmedKeywordSignature('');
    setCreateError('');
    setScheduleOpen(false);
    setShowAdd(true);
  }

  const filtered = tasks.filter(t => taskAgentGroup(t.taskType) === activeGroup);
  const activeGroupMeta = AGENT_GROUPS.find(group => group.id === activeGroup)!;
  const visibleTemplates = TASK_TEMPLATES.filter(t => taskAgentGroup(t.taskType) === activeGroup);
  const selectedTemplates = TASK_TEMPLATES.filter(template => selectedTemplateIds.includes(template.templateId));
  const selectedTemplate = selectedTemplates[0] ?? null;
  const keywordTemplates = selectedTemplates.filter(template => ['video_keyword_crawl', 'image_post_crawl'].includes(template.taskType));
  const keywordReviews = [...new Set(keywordTemplates.map(template => String(('config' in template ? template.config?.platforms : '') || 'youtube') as KeywordPlatform))]
    .map(platform => ({ platform, review: normalizeKeywordInput(taskKeywords, platform) }));
  const keywordSignature = keywordReviews.map(({ platform, review }) => `${platform}:${review.serialized}`).join('|');
  const keywordReviewReady = keywordReviews.length === 0 || keywordReviews.every(({ review }) => review.items.length > 0);
  const keywordReviewConfirmed = keywordReviews.length === 0 || (keywordReviewReady && confirmedKeywordSignature === keywordSignature);
  const groupedTemplates = TEMPLATE_GROUPS
    .map(group => ({ ...group, templates: visibleTemplates.filter(template => (group.taskTypes as readonly string[]).includes(template.taskType)) }))
    .filter(group => group.templates.length > 0);
  const stats = videoStats?.stats;
  const crawl = stats?.crawl ?? {};
  const fetchQueue = stats?.fetchQueue ?? {};
  const analysisQueue = stats?.analysisQueue ?? {};
  const analysisStatusRows = [
    { label: 'Gemini 队列', value: analysisQueue.queued ?? 0, desc: '等待/处理中' },
    { label: '待处理素材', value: analysisQueue.pendingRecords ?? 0, desc: '已入库但未完成分析' },
    { label: '已分析素材', value: analysisQueue.analyzedRecords ?? 0, desc: '可进入灵感大屏/素材库' },
    { label: '失败素材', value: analysisQueue.failedRecords ?? 0, desc: '需要重试或排查源文件' },
  ];
  const analysisStatusEntries = Object.entries(analysisQueue.byStatus ?? {});
  const analysisItems = analysisQueue.items ?? [];
  const refinementItems = analysisQueue.refinementItems ?? [];
  const crawlTasks = (videoStats?.tasks ?? tasks).filter(t => ['video_keyword_crawl', 'image_post_crawl', 'competitor_account_crawl'].includes(t.taskType));
  const showTaskList = activeGroup !== 'social' || socialTaskTab === 'crawler';
  const formatTime = (value?: string) => value
    ? new Date(value).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '暂无';
  const resultTask = tasks.find(task => task.id === resultTaskId) ?? null;
  const resultText = resultTask ? (runResult[resultTask.id] || resultTask.lastResult || '') : '';
  const templateForTask = (task: ScheduledTask) => TASK_TEMPLATES.find(t => {
    if (t.taskType !== task.taskType) return false;
    if (!['video_keyword_crawl', 'image_post_crawl', 'competitor_account_crawl'].includes(task.taskType)) return true;
    return ('config' in t ? t.config?.platforms : '') === task.config.platforms;
  }) ?? null;
  const resultTemplate = resultTask ? templateForTask(resultTask) : null;

  const exportPdf = async (task: ScheduledTask) => {
    setExportingId(task.id);
    setExportNotice(null);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 30_000);
    try {
      const res = await fetch(`/api/overseas/scheduler/${task.id}/export-pdf`, {
        headers: authHeader(),
        signal: controller.signal,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null) as { error?: string } | null;
        const message = body?.error === 'task_has_no_result'
          ? '任务执行完成后即可导出本周报告'
          : body?.error === 'not found'
            ? '当前任务已更新，请刷新页面后重试'
            : res.status >= 500
              ? '报告生成服务暂时不可用，请稍后重试'
              : `PDF 导出未完成（${res.status}）`;
        throw new Error(message);
      }
      const blob = await res.blob();
      if (!blob.size || !String(res.headers.get('content-type') || '').includes('application/pdf')) {
        throw new Error('服务器没有返回有效的 PDF 文件');
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${task.name}-任务报告.pdf`;
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      link.remove();
      // Safari/WebKit may start reading the Blob after click() returns. Revoking
      // immediately can silently cancel the download, so release it later.
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setExportNotice({ taskId: task.id, message: 'PDF 已生成，下载已开始', error: false });
    } catch (error) {
      const message = error instanceof DOMException && error.name === 'AbortError'
        ? 'PDF 生成超时，请稍后重试'
        : error instanceof Error ? error.message : 'PDF 导出失败，请稍后重试';
      setExportNotice({ taskId: task.id, message, error: true });
    } finally {
      window.clearTimeout(timeout);
      setExportingId(null);
    }
  };

  const suggestedActions = (task: ScheduledTask, output: string): NextAction[] => {
    const context = output ? `\n\n定时任务摘要：\n${output}` : '';
    if (task.taskType === 'holiday_push') {
      return [
        {
          label: '整理节日前 7 天主推 SKU 与库存水位',
          agent: 'strategy',
          agentLabel: '首页',
          prompt: `根据节日推品提醒，按市场和节日优先级整理未来 7 天需要主推的 SKU、库存水位、备货风险和负责人动作。${context}`,
        },
        {
          label: '生成社媒预热脚本和短视频内容方向',
          agent: 'traffic',
          agentLabel: '我的社媒',
          prompt: `基于节日推品提醒，生成可直接使用的社媒预热脚本、短视频钩子和多语言内容方向，重点适配企业中心主要市场。${context}`,
        },
        {
          label: '生成私域触达话术并安排近 90 天询盘跟进',
          agent: 'conversion',
          agentLabel: '我的客户',
          prompt: `基于节日推品提醒，设计私域触达话术，并筛选近 90 天相关品类询盘客户，输出跟进优先级和报价/邀约话术。${context}`,
        },
      ];
    }
    if (task.taskType === 'trend_report') {
      return [
        {
          label: '把高频话题转成 3 条 TikTok 脚本方向',
          agent: 'traffic',
          agentLabel: '我的社媒',
          prompt: `把爆款日报中的高频话题转成 3 条 TikTok 脚本方向，包含钩子、镜头结构和口播重点。${context}`,
        },
        {
          label: '挑选 2 个产品卖点做 A/B 内容测试',
          agent: 'traffic',
          agentLabel: '我的社媒',
          prompt: `基于爆款日报，挑选 2 个产品卖点设计 A/B 内容测试方案，输出标题、素材形式和判断指标。${context}`,
        },
        {
          label: '将适配市场和语言写回企业中心学习记录',
          agent: 'strategy',
          agentLabel: '首页',
          prompt: `基于爆款日报，提炼适配市场、主要语言和有效内容角度，整理成可写回企业中心的 Agent 学习记录。${context}`,
        },
      ];
    }
    if (task.taskType === 'video_keyword_crawl') {
      return [
        {
          label: '查看新入库视频并筛选可复用素材',
          agent: 'traffic',
          agentLabel: '我的社媒',
          prompt: `根据视频采集结果，筛选新入库视频里最值得复用的素材方向，并说明筛选标准。${context}`,
        },
        {
          label: '选择高互动视频生成克隆脚本',
          agent: 'traffic',
          agentLabel: '我的社媒',
          prompt: `从视频采集结果中挑选高互动视频方向，生成 3 条去重后的克隆脚本。${context}`,
        },
        {
          label: '复盘失败下载链接并补充关键词',
          agent: 'strategy',
          agentLabel: '首页',
          prompt: `复盘视频采集任务中下载失败或结果不足的问题，补充下一轮关键词和平台采集策略。${context}`,
        },
      ];
    }
    if (task.taskType === 'exchange_rate') {
      return [
        {
          label: '生成多币种询盘报价话术',
          agent: 'conversion',
          agentLabel: '我的客户',
          prompt: `根据汇率日报，生成面向不同市场客户的多币种报价话术，并标注报价有效期。${context}`,
        },
        {
          label: '更新报价风险和利润提醒',
          agent: 'strategy',
          agentLabel: '首页',
          prompt: `根据汇率日报，判断当前报价风险、利润保护线和需要用户确认的报价策略。${context}`,
        },
        {
          label: '整理老客补货报价提醒',
          agent: 'retention',
          agentLabel: '我的客户',
          prompt: `根据汇率日报，为老客补货场景生成报价提醒和复购触达建议。${context}`,
        },
      ];
    }
    if (task.taskType === 'market_intelligence') {
      return [
        {
          label: '按市场拆解报价和选品动作',
          agent: 'strategy',
          agentLabel: '首页',
          prompt: `根据主要市场行业周报，按市场拆解未来 7 天的报价、选品、合规和销售动作，并标注依据来源。${context}`,
        },
        {
          label: '把行业动态转成内容方向',
          agent: 'traffic',
          agentLabel: '我的社媒',
          prompt: `根据主要市场行业周报，把可用事实转成 3 个社媒选题和短视频内容方向，避免把未经证实的信息写成企业卖点。${context}`,
        },
        {
          label: '生成重点客户跟进理由',
          agent: 'conversion',
          agentLabel: '我的客户',
          prompt: `根据主要市场行业周报，生成不同市场客户的跟进理由、询盘问题和报价注意事项。${context}`,
        },
      ];
    }
    if (task.taskType === 'weekly_review') {
      return [
        {
          label: '拆解下周社媒内容任务',
          agent: 'traffic',
          agentLabel: '我的社媒',
          prompt: `根据每周经营复盘，拆解下周社媒内容任务，输出选题、脚本方向和优先级。${context}`,
        },
        {
          label: '生成询盘转化跟进动作',
          agent: 'conversion',
          agentLabel: '我的客户',
          prompt: `根据每周经营复盘，生成询盘转化跟进动作、报价优化点和高意向客户处理顺序。${context}`,
        },
        {
          label: '生成老客复购唤醒动作',
          agent: 'retention',
          agentLabel: '我的客户',
          prompt: `根据每周经营复盘，生成老客复购唤醒任务、客户分层和触达节奏。${context}`,
        },
      ];
    }
    if (task.taskType === 'crm_wakeup') {
      return [
        {
          label: '生成老客唤醒分层和触达节奏',
          agent: 'retention',
          agentLabel: '我的客户',
          prompt: `根据沉默客户唤醒任务，生成客户分层、触达节奏和复购推荐逻辑。${context}`,
        },
        {
          label: '生成 WhatsApp 跟进话术',
          agent: 'conversion',
          agentLabel: '我的客户',
          prompt: `根据沉默客户唤醒任务，生成可直接发送的 WhatsApp 跟进话术，并区分高意向/普通老客。${context}`,
        },
        {
          label: '生成复购内容素材方向',
          agent: 'traffic',
          agentLabel: '我的社媒',
          prompt: `根据沉默客户唤醒任务，生成适合老客复购的内容素材方向和短视频脚本钩子。${context}`,
        },
      ];
    }
    return [
      {
        label: '交给首页拆解后续任务',
        agent: 'strategy',
        agentLabel: '首页',
        prompt: `请根据这次定时任务结果，拆解可执行的后续 Agent 任务。${context}`,
      },
    ];
  };

  const goToAgent = (action: NextAction) => {
    setResultTaskId(null);
    onAction?.(action.agent, action.prompt);
    window.setTimeout(() => completeDemoStep('automation_workflow'), 600);
  };

  const taskWorkspace = (task: ScheduledTask) => {
    switch (task.taskType) {
      case 'video_keyword_crawl':
        return {
          title: '视频采集工作台',
          cards: [
            { label: '采集平台', value: task.config.platforms || 'youtube', desc: '按平台拉取关键词视频' },
            { label: '关键词', value: task.config.keywords || task.config.keyword || 'skincare', desc: '用于社媒内容采集' },
            { label: '时间窗口', value: `${task.config.dateWindowDays || '7'} 天`, desc: '只采集近期内容' },
          ],
          actions: ['刷新采集看板', '查看排队状态', '生成脚本方向'],
        };
      case 'trend_report':
        return {
          title: '爆款日报工作台',
          cards: [
            { label: '报告范围', value: 'TikTok', desc: '聚合热门品类、话题和内容角度' },
            { label: '输出频率', value: task.cronLabel, desc: '定时更新趋势简报' },
            { label: '后续动作', value: '内容矩阵', desc: '转成选题、脚本和投放建议' },
          ],
          actions: ['提炼 3 条脚本', '生成话题标签', '写回企业学习记录'],
        };
      case 'holiday_push':
        return {
          title: '节日推品工作台',
          cards: [
            { label: '提醒窗口', value: '节前 7 天', desc: '提前规划备货和触达' },
            { label: '推品对象', value: '重点 SKU', desc: '结合库存、季节和历史询盘' },
            { label: '触达方式', value: '社媒/私域', desc: '生成预热内容和跟进话术' },
          ],
          actions: ['生成节日推品清单', '生成预热脚本', '生成客户触达话术'],
        };
      case 'exchange_rate':
        return {
          title: '汇率报价工作台',
          cards: [
            { label: '基础币种', value: 'USD', desc: '统一用于报价换算' },
            { label: '覆盖币种', value: '按主要市场', desc: '由企业中心目标市场自动匹配' },
            { label: '报价规则', value: '人工确认', desc: '结合价格区间、MOQ 和毛利线' },
          ],
          actions: ['生成多币种报价', '复制汇率摘要', '生成询盘报价话术'],
        };
      case 'market_intelligence':
        return {
          title: '主要市场行业情报工作台',
          cards: [
            { label: '内部依据', value: '企业中心', desc: '行业、产品、主要市场与报价规则' },
            { label: '外部依据', value: '公开检索', desc: '需求、合规、渠道和竞争动态' },
            { label: '更新周期', value: '每周', desc: '保留来源并生成行动建议' },
          ],
          actions: ['查看公开来源', '拆解市场动作', '生成客户跟进理由'],
        };
      case 'weekly_review':
        return {
          title: '经营复盘工作台',
          cards: [
            { label: '复盘维度', value: '流量/询盘/转化', desc: '聚合关键经营指标' },
            { label: '输出周期', value: '每周', desc: '形成固定经营节奏' },
            { label: '行动沉淀', value: '下周任务', desc: '把复盘转为可执行动作' },
          ],
          actions: ['生成老板版摘要', '生成运营任务清单', '拆给各 Agent 执行'],
        };
      case 'crm_wakeup':
        return {
          title: '老客唤醒工作台',
          cards: [
            { label: '客户范围', value: '60 天沉默', desc: '筛选未复购或未回复客户' },
            { label: '触达渠道', value: 'WhatsApp', desc: '生成轻量跟进话术' },
            { label: '推荐依据', value: '历史采购', desc: '按客户偏好匹配新品' },
          ],
          actions: ['生成唤醒文案', '生成推品理由', '标记高潜客户'],
        };
      default:
        return {
          title: '任务工作台',
          cards: [
            { label: '任务类型', value: task.taskType, desc: '当前自动化任务' },
            { label: '执行频率', value: task.cronLabel, desc: '按计划自动运行' },
            { label: '状态', value: task.enabled ? '已启用' : '已停用', desc: '可随时调整' },
          ],
          actions: ['查看结果', '复制产出', '安排下一步'],
        };
    }
  };

  const resultWorkspace = resultTask ? taskWorkspace(resultTask) : null;

  const renderAutomationTemplates = (group: AgentTaskGroup) => {
    const templates = TASK_TEMPLATES.filter(template => taskAgentGroup(template.taskType) === group);
    return (
      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm font-semibold text-gray-900">可用自动化模板</p>
          <span className="text-xs text-gray-400">{templates.length} 个模板</span>
        </div>
        <div className="space-y-2">
          {templates.map(template => {
            const exists = tasks.some(task => templateForTask(task)?.templateId === template.templateId);
            return (
              <div key={template.templateId} className="flex items-start gap-3 rounded-lg border border-gray-100 bg-gray-50/70 p-3">
                <span className="text-xl">{template.icon}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-900">{template.name}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-gray-500">{template.desc}</p>
                  <p className="mt-1 flex items-center gap-1 text-xs text-gray-400"><Clock size={11} /> {template.cronLabel}</p>
                </div>
                <button
                  type="button"
                  onClick={event => { event.preventDefault(); event.stopPropagation(); if (!exists) void createTaskFromTemplate(template); }}
                  disabled={exists}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium ${exists ? 'cursor-default bg-green-50 text-green-700' : 'bg-green-600 text-white hover:bg-green-700'}`}
                >
                  {exists ? '已创建' : '创建'}
                </button>
              </div>
            );
          })}
        </div>
      </section>
    );
  };

  const businessDynamicsWorkspace = () => {
    const profile = businessDynamics?.profile;
    const quote = businessDynamics?.quote;
    const intelligence = businessDynamics?.intelligence;
    const rates = quote?.rates ?? [];
    const signals = intelligence?.signals ?? [];
    const sources = intelligence?.sources ?? [];
    const missingFields = profile?.missingFields ?? [];
    const statusLabel = businessDynamicsLoading
      ? '正在生成经营动态'
      : intelligence?.status === 'ready'
      ? '外部检索已接入'
      : intelligence?.status === 'profile_incomplete'
        ? '等待企业资料'
        : '外部检索暂不可用';
    const summaryCards = [
      { label: '报价币种', value: rates.length || 0, desc: rates.map(rate => rate.code).join(' / ') || '等待实时汇率', icon: CircleDollarSign },
      { label: '主要市场', value: profile?.markets?.length || 0, desc: profile?.markets?.join('、') || '企业中心未配置', icon: Globe2 },
      { label: '行业动态', value: signals.length || 0, desc: intelligence?.status === 'ready' ? '最近 30 天公开动态' : statusLabel, icon: TrendingUp },
      { label: '企业资料', value: `${profile?.completion ?? 0}/${profile?.completionTotal ?? 6}`, desc: missingFields.length ? `缺少：${missingFields.join('、')}` : '经营分析依据已就绪', icon: Building2 },
    ];

    return (
      <div className="mb-6 space-y-4">
        <section className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-gray-900">企业经营画像 + 外部市场检索</p>
                <span className={`rounded-full px-2 py-0.5 text-[11px] ${intelligence?.status === 'ready' ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>{statusLabel}</span>
              </div>
              <p className="mt-1 text-xs text-gray-500">
                企业中心提供内部事实，公开检索补充当前市场变化；生成时间 {formatTime(businessDynamics?.generatedAt)}{businessDynamics?.cached ? ' · 缓存结果' : ''}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => window.dispatchEvent(new CustomEvent('lingshu:navigate', { detail: { page: 'enterprise' } }))}
                className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
              >
                <Building2 size={14} /> 企业中心
              </button>
              <button
                type="button"
                onClick={() => void fetchBusinessDynamics(true)}
                disabled={businessDynamicsLoading}
                className="flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-60"
              >
                <RefreshCw size={14} className={businessDynamicsLoading ? 'animate-spin' : ''} /> 刷新动态
              </button>
            </div>
          </div>
          {businessDynamicsError && (
            <div className="mt-3 flex items-center gap-2 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700">
              <AlertTriangle size={14} /> {businessDynamicsError}
            </div>
          )}
          {missingFields.length > 0 && !businessDynamicsLoading && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2">
              <p className="text-xs text-amber-800">缺少 {missingFields.join('、')}，当前动态只能生成部分结果。</p>
              <button
                type="button"
                onClick={() => window.dispatchEvent(new CustomEvent('lingshu:navigate', { detail: { page: 'enterprise' } }))}
                className="text-xs font-medium text-amber-800 hover:underline"
              >
                去补充资料
              </button>
            </div>
          )}
        </section>

        <div className="grid grid-cols-4 gap-3">
          {summaryCards.map(card => {
            const Icon = card.icon;
            return (
              <div key={card.label} className="rounded-lg border border-gray-200 bg-white p-4">
                <div className="flex items-center gap-2 text-xs text-gray-500"><Icon size={14} className="text-green-600" /> {card.label}</div>
                <p className="mt-2 text-2xl font-semibold text-gray-900">{businessDynamicsLoading ? '—' : card.value}</p>
                <p className="mt-1 truncate text-xs text-gray-500" title={card.desc}>{card.desc}</p>
              </div>
            );
          })}
        </div>

        <div className="grid grid-cols-[0.9fr_1.4fr] gap-3">
          <section className="rounded-lg border border-gray-200 bg-white p-4">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-gray-900">报价监控</p>
                <p className="mt-0.5 text-xs text-gray-500">1 USD 基准 · 数据日期 {quote?.sourceDate || '待更新'}</p>
              </div>
              <CircleDollarSign size={18} className="text-green-600" />
            </div>
            {businessDynamicsLoading ? (
              <div className="flex h-24 items-center justify-center text-xs text-gray-400"><Loader size={16} className="mr-2 animate-spin" />正在读取汇率和报价规则</div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2">
                  {rates.map(rate => (
                    <div key={rate.code} className="rounded-lg bg-gray-50 px-3 py-2">
                      <p className="text-[11px] text-gray-400">{rate.market}</p>
                      <p className="mt-1 text-sm font-semibold text-gray-900">{rate.code} {rate.rate >= 1000 ? rate.rate.toFixed(0) : rate.rate.toFixed(4)}</p>
                    </div>
                  ))}
                  {rates.length === 0 && <p className="col-span-2 py-4 text-center text-xs text-gray-400">实时汇率暂不可用</p>}
                </div>
                <div className="mt-3 space-y-2 border-t border-gray-100 pt-3 text-xs">
                  <div className="flex justify-between gap-3"><span className="text-gray-500">价格区间</span><span className="text-right font-medium text-gray-800">{quote?.productPriceRange || '未配置'}</span></div>
                  <div className="flex justify-between gap-3"><span className="text-gray-500">MOQ</span><span className="text-right font-medium text-gray-800">{quote?.moq || '未配置'}</span></div>
                  <div className="flex justify-between gap-3"><span className="text-gray-500">最低毛利</span><span className="text-right font-medium text-gray-800">{quote?.minMargin || '未配置'}</span></div>
                </div>
                <p className="mt-3 rounded-lg bg-green-50 px-3 py-2 text-xs leading-relaxed text-green-800">{quote?.recommendation}</p>
              </>
            )}
          </section>

          <section className="rounded-lg border border-gray-200 bg-white p-4">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-gray-900">主要市场行业动态</p>
                <p className="mt-0.5 text-xs text-gray-500">只展示与报价、需求、合规、渠道或竞争相关的公开事实</p>
              </div>
              <Search size={18} className="text-green-600" />
            </div>
            {businessDynamicsLoading ? (
              <div className="flex h-40 items-center justify-center text-xs text-gray-400"><Loader size={16} className="mr-2 animate-spin" />正在结合企业资料检索外部动态</div>
            ) : (
              <>
                <p className="rounded-lg bg-gray-50 px-3 py-2 text-xs leading-relaxed text-gray-700">{intelligence?.summary || '暂无可用经营判断'}</p>
                <div className="mt-3 space-y-2">
                  {signals.slice(0, 4).map((signal, index) => (
                    <div key={`${signal.market}-${index}`} className="rounded-lg border border-gray-100 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-[11px] font-medium text-green-700">{signal.market}</p>
                          <p className="mt-0.5 text-xs font-semibold leading-relaxed text-gray-900">{signal.title}</p>
                        </div>
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] ${signal.risk === 'high' ? 'bg-red-50 text-red-700' : signal.risk === 'medium' ? 'bg-amber-50 text-amber-700' : 'bg-green-50 text-green-700'}`}>
                          {signal.risk === 'high' ? '高关注' : signal.risk === 'medium' ? '需关注' : '机会'}
                        </span>
                      </div>
                      <p className="mt-2 text-xs leading-relaxed text-gray-500">影响：{signal.impact}</p>
                      <p className="mt-1 text-xs leading-relaxed text-gray-700">建议：{signal.action}</p>
                    </div>
                  ))}
                  {signals.length === 0 && <p className="py-5 text-center text-xs text-gray-400">补充企业中心行业与主要市场后，可生成针对性动态。</p>}
                </div>
                {sources.length > 0 && (
                  <div className="mt-3 border-t border-gray-100 pt-3">
                    <p className="mb-2 text-[11px] font-medium text-gray-500">公开来源</p>
                    <div className="flex flex-wrap gap-2">
                      {sources.slice(0, 6).map(source => (
                        <a key={source.url} href={source.url} target="_blank" rel="noreferrer" className="inline-flex max-w-[240px] items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-[11px] text-gray-600 hover:border-green-200 hover:text-green-700">
                          <span className="truncate">{source.title}</span><ExternalLink size={10} className="shrink-0" />
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </section>
        </div>

        <div className="grid grid-cols-[1fr_1.05fr] gap-3">
          {renderAutomationTemplates('conversion')}
          <section className="rounded-lg border border-gray-200 bg-white p-4">
            <p className="text-sm font-semibold text-gray-900">经营动态生成链路</p>
            <div className="mt-3 space-y-3">
              {[
                '读取企业中心：行业、产品、主要市场与报价边界',
                '刷新汇率，并检索最近 30 天公开市场与行业动态',
                '形成带来源的报价提醒、风险判断和 7 天行动建议',
              ].map((step, index) => (
                <div key={step} className="flex items-center gap-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-green-50 text-xs font-semibold text-green-700">{index + 1}</span>
                  <div className="flex-1 rounded-lg bg-gray-50 px-3 py-2"><p className="text-xs font-medium text-gray-800">{step}</p></div>
                </div>
              ))}
            </div>
            <p className="mt-4 rounded-lg border border-green-100 bg-green-50 p-3 text-xs leading-relaxed text-green-800">定时任务产出可导出 PDF，也可以继续交给首页、我的社媒或我的客户拆解执行。</p>
          </section>
        </div>
      </div>
    );
  };

  const groupWorkspace = (group: AgentTaskGroup) => {
    if (group === 'conversion') return businessDynamicsWorkspace();
    const cards = [
      { label: '客户分层', value: '60 天', desc: '识别沉默客户和复购机会' },
      { label: '唤醒触达', value: 'WhatsApp', desc: '生成老客唤醒文案与推品理由' },
      { label: '复购节奏', value: '每周', desc: '沉淀客户偏好和下一次跟进时间' },
    ];
    return (
      <div className="mb-6 space-y-4">
        <div className="grid grid-cols-3 gap-3">
          {cards.map(card => (
            <div key={card.label} className="rounded-lg border border-gray-200 bg-white p-4">
              <p className="text-xs text-gray-500">{card.label}</p>
              <p className="mt-2 text-2xl font-semibold text-gray-900">{card.value}</p>
              <p className="mt-2 text-xs leading-relaxed text-gray-500">{card.desc}</p>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-[1fr_1.1fr] gap-3">
          {renderAutomationTemplates(group)}
          <section className="rounded-lg border border-gray-200 bg-white p-4">
            <p className="text-sm font-semibold text-gray-900">工作流预览</p>
            <div className="mt-3 space-y-3">
              {['筛选沉默客户', '匹配历史采购偏好', '生成触达话术和推品清单'].map((step, index) => (
                <div key={step} className="flex items-center gap-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-green-50 text-xs font-semibold text-green-700">{index + 1}</span>
                  <div className="flex-1 rounded-lg bg-gray-50 px-3 py-2"><p className="text-xs font-medium text-gray-800">{step}</p></div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    );
  };

  return (
    <div className="flex h-full flex-col bg-white" data-lingshu-guide="scheduled-tasks">
      <div className="h-12 flex items-center justify-between px-5 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-6 h-6 rounded-lg flex items-center justify-center" style={{ background: 'rgba(22,163,74,0.1)', color: '#16a34a' }}>
            <Clock size={13} />
          </div>
          <span className="text-sm font-semibold text-text-primary">定时任务</span>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
      {/* Left sidebar */}
      <div className="w-64 border-r border-gray-100 flex flex-col py-6 px-3">
        <p className="text-xs font-medium text-gray-400 px-3 mb-3">Agent 任务板块</p>
        {AGENT_GROUPS.map(group => (
          <button
            key={group.id}
            type="button"
            onClick={() => selectGroup(group.id)}
            className={`text-left px-3 py-3 rounded-lg text-sm mb-1 transition-colors ${activeGroup === group.id ? 'bg-gray-100 text-gray-900 font-medium' : 'text-gray-500 hover:text-gray-700'}`}
          >
            <span className="block">{group.label}</span>
            <span className="block text-xs text-gray-400 mt-1">
              {tasks.filter(t => taskAgentGroup(t.taskType) === group.id).length} 个任务
            </span>
          </button>
        ))}
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="px-8 py-5 border-b border-gray-100">
          <div className="flex items-center justify-between">
            <h1 className="text-base font-semibold text-gray-900">{activeGroupMeta.label}</h1>
            <button
              type="button"
              data-demo-target={!showAdd && activeGroup === 'social' ? 'scheduled_run' : undefined}
              onClick={openAddModal}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white"
              style={{ background: '#16a34a' }}
            >
              <Plus size={16} /> 新建任务
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-8 py-6">
          {activeGroup === 'social' && (
          <div className="mb-6 space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="inline-flex rounded-xl border border-gray-200 bg-gray-50 p-1">
                  {[
                    { id: 'crawler' as const, label: '社媒爬虫定时任务' },
                    { id: 'analysis' as const, label: '视频分析' },
                  ].map(tab => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setSocialTaskTab(tab.id)}
                      className={`h-8 rounded-lg px-3 text-xs font-medium transition-colors ${socialTaskTab === tab.id ? 'bg-white text-green-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-gray-500 mt-2">
                  {socialTaskTab === 'crawler'
                    ? `${crawlTasks.length > 0 ? `${crawlTasks.map(task => task.name).join(' / ')} · ${CRAWLER_CRON_PRESET.label}` : '自动采集任务未创建'} · 更新时间 ${formatTime(stats?.updatedAt)}`
                    : `视频下载入库后的 Gemini 分析进度 · 更新时间 ${formatTime(stats?.updatedAt)}`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => { void fetchTasks(); void fetchVideoStats(); }}
                className="px-3 py-1.5 rounded-lg border border-gray-200 text-xs text-gray-600 hover:bg-gray-50"
              >
                刷新
              </button>
            </div>

            {socialTaskTab === 'crawler' ? (
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-gray-200 p-4 bg-white">
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <BarChart3 size={14} className="text-orange-500" />
                    视频爬取数据
                  </div>
                  <div className="mt-3 flex items-end gap-3">
                    <span className="text-2xl font-semibold text-gray-900">{crawl.today ?? 0}</span>
                    <span className="text-xs text-gray-500 pb-1">今日新增</span>
                  </div>
                  <p className="text-xs text-gray-500 mt-2">24小时 {crawl.last24h ?? 0} 条 · 累计库内 {crawl.total ?? 0} 条 · 最新 {formatTime(crawl.latestAt)}</p>
                  <p className="text-xs text-gray-400 mt-1">累计来源：YT {crawl.byPlatform?.youtube ?? 0} / TK {crawl.byPlatform?.tiktok ?? 0} / IG {crawl.byPlatform?.instagram ?? 0} / FB {crawl.byPlatform?.facebook ?? 0}</p>
                </div>

                <div className="rounded-xl border border-gray-200 p-4 bg-white">
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <DownloadCloud size={14} className="text-blue-500" />
                    获取视频排队数据
                  </div>
                  <div className="mt-3 flex items-end gap-3">
                    <span className="text-2xl font-semibold text-gray-900">{fetchQueue.queued ?? 0}</span>
                    <span className="text-xs text-gray-500 pb-1">等待/处理中</span>
                  </div>
                  <p className="text-xs text-gray-500 mt-2">Ops 队列 {fetchQueue.ops?.total ?? 0} · Worker {fetchQueue.ops?.workerActive ? '运行中' : fetchQueue.ops?.workerEnabled ? '待命' : '关闭'}</p>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="rounded-xl border border-gray-200 p-4 bg-white">
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <Activity size={14} className="text-green-500" />
                    视频分析排队数据
                  </div>
                  <div className="mt-3 flex items-end gap-3">
                    <span className="text-2xl font-semibold text-gray-900">{analysisQueue.queued ?? 0}</span>
                    <span className="text-xs text-gray-500 pb-1">Gemini 队列</span>
                  </div>
                  <p className="text-xs text-gray-500 mt-2">已分析 {analysisQueue.analyzedRecords ?? 0} · 待处理 {analysisQueue.pendingRecords ?? 0} · 失败 {analysisQueue.failedRecords ?? 0}</p>
                </div>

                <section className="rounded-xl border border-gray-200 bg-white p-4">
                  <button
                    type="button"
                    aria-expanded={analysisQueueOpen}
                    aria-controls="video-analysis-queue-list"
                    onClick={() => setAnalysisQueueOpen(open => !open)}
                    className="mb-3 flex w-full items-center justify-between rounded-lg text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
                  >
                    <div>
                      <p className="text-sm font-semibold text-gray-900">视频分析队列</p>
                      <p className="text-xs text-gray-500 mt-0.5">点击展开，查看每条视频的分析状态与操作。</p>
                    </div>
                    <span className="flex items-center gap-2 text-xs text-gray-400">
                      {analysisItems.length} 条 · 自动刷新 5 秒
                      <ChevronDown size={16} className={`transition-transform ${analysisQueueOpen ? 'rotate-180' : ''}`} />
                    </span>
                  </button>
                  <div className="grid grid-cols-4 gap-3">
                    {analysisStatusRows.map(row => (
                      <div key={row.label} className="rounded-xl border border-gray-100 bg-gray-50/70 p-3">
                        <p className="text-xs text-gray-500">{row.label}</p>
                        <p className="mt-2 text-xl font-semibold text-gray-900">{row.value}</p>
                        <p className="mt-1 text-[11px] text-gray-400">{row.desc}</p>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 rounded-xl border border-gray-100 bg-gray-50/60 p-3">
                    <p className="text-xs font-medium text-gray-700">状态分布</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {analysisStatusEntries.length > 0 ? analysisStatusEntries.map(([status, count]) => (
                        <span key={status} className="rounded-full bg-white px-2.5 py-1 text-xs text-gray-500 border border-gray-100">
                          {status}: {count}
                        </span>
                      )) : (
                        <span className="text-xs text-gray-400">暂无状态明细</span>
                      )}
                    </div>
                  </div>
                  <AnimatePresence initial={false}>
                    {analysisQueueOpen && (
                      <motion.div
                        id="video-analysis-queue-list"
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="mt-3 max-h-[520px] space-y-2 overflow-y-auto border-t border-gray-100 pt-3">
                          {analysisActionError && (
                            <div role="status" className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-600">
                              {analysisActionError}
                            </div>
                          )}
                          {analysisItems.length === 0 ? (
                            <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/60 py-8 text-center text-xs text-gray-400">
                              暂无视频分析记录
                            </div>
                          ) : analysisItems.map(item => {
                            const statusMeta = item.status === 'analyzing'
                              ? { label: '分析中', style: 'bg-blue-50 text-blue-700' }
                              : item.status === 'analyzed'
                                ? { label: '已分析', style: 'bg-green-50 text-green-700' }
                                : item.status === 'failed'
                                  ? { label: '分析失败', style: 'bg-red-50 text-red-700' }
                                  : { label: '已暂停', style: 'bg-amber-50 text-amber-700' };
                            const actionPending = analysisActionId === item.id;
                            return (
                              <article key={item.id} data-testid={`video-analysis-row-${item.id}`} className="flex items-center gap-3 rounded-xl border border-gray-100 bg-gray-50/60 p-3">
                                {item.thumbnailUrl ? (
                                  <img src={item.thumbnailUrl} alt={`${item.title} 缩略图`} className="h-14 w-24 flex-shrink-0 rounded-lg bg-gray-100 object-cover" />
                                ) : (
                                  <div className="flex h-14 w-24 flex-shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-300"><Play size={18} /></div>
                                )}
                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-xs font-semibold text-gray-900" title={item.title}>{item.title}</p>
                                  <p className="mt-1 text-[11px] text-gray-500">{item.platform.toUpperCase()} · {item.analysisMode === 'exact' ? '精确分析' : '策略分析'} · {item.duration ? `${Math.round(item.duration)} 秒` : '时长未知'}</p>
                                  {item.error && <p className="mt-1 truncate text-[11px] text-red-500" title={item.error}>{item.error}</p>}
                                </div>
                                <span className={`flex-shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium ${statusMeta.style}`}>{statusMeta.label}</span>
                                <div className="flex flex-shrink-0 items-center gap-2">
                                  {item.status === 'analyzing' && (
                                    <button
                                      type="button"
                                      aria-label={`暂停分析 ${item.title}`}
                                      disabled={actionPending}
                                      onClick={() => void updateVideoAnalysis(item, 'pause')}
                                      className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-[11px] text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                                    >
                                      {actionPending ? '处理中…' : '暂停分析'}
                                    </button>
                                  )}
                                  {item.status !== 'analyzing' && (
                                    <button
                                      type="button"
                                      aria-label={`重新分析 ${item.title}`}
                                      disabled={actionPending}
                                      onClick={() => void updateVideoAnalysis(item, 'reanalyze')}
                                      className="rounded-lg border border-green-200 bg-white px-2.5 py-1.5 text-[11px] text-green-700 hover:bg-green-50 disabled:opacity-50"
                                    >
                                      {actionPending ? '提交中…' : '重新分析'}
                                    </button>
                                  )}
                                </div>
                              </article>
                            );
                          })}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </section>
                <section className="rounded-xl border border-gray-200 bg-white p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">精修视频同步</p>
                      <p className="text-xs text-gray-500 mt-0.5">从灵感大屏点击“AI一键爆款迭代”后自动进入此列表。</p>
                    </div>
                    <span className="text-xs text-gray-400">最近 {refinementItems.length} 条</span>
                  </div>
                  {refinementItems.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/60 py-8 text-center text-xs text-gray-400">
                      暂无已同步的精修视频
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {refinementItems.map(item => (
                        <article key={item.id} className="flex items-center gap-3 rounded-xl border border-gray-100 bg-gray-50/60 p-3">
                          {item.thumbnailUrl ? (
                            <img src={item.thumbnailUrl} alt="" className="h-12 w-20 flex-shrink-0 rounded-lg bg-gray-100 object-cover" />
                          ) : (
                            <div className="h-12 w-20 flex-shrink-0 rounded-lg bg-gray-100" />
                          )}
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-xs font-semibold text-gray-900">{item.title}</p>
                            <p className="mt-1 text-[11px] text-gray-500">{item.platform.toUpperCase()} · {item.analysisMode === 'exact' ? '全片精确分析' : '视频分析'} · {item.duration ? `${Math.round(item.duration)} 秒` : '时长未知'}</p>
                          </div>
                          <div className="flex-shrink-0 text-right">
                            <span className="rounded-full bg-green-50 px-2.5 py-1 text-[11px] font-medium text-green-700">待精修</span>
                            <p className="mt-1 text-[10px] text-gray-400">{formatTime(item.syncedAt)}</p>
                          </div>
                        </article>
                      ))}
                    </div>
                  )}
                </section>
              </div>
            )}
          </div>
          )}

          {activeGroup !== 'social' && !loading && groupWorkspace(activeGroup)}

          {loading && <div className="text-sm text-gray-400 py-12 text-center">加载中...</div>}

          {!loading && showTaskList && filtered.length === 0 && (
            <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/50 p-8 text-center text-gray-400">
              <Clock size={40} className="mb-3 opacity-40" />
              <p className="text-sm font-medium">还没有定时任务</p>
            </div>
          )}

          {!loading && showTaskList && filtered.length > 0 && (
            <div className="mb-8">
              <h2 className="text-sm font-semibold text-gray-500 mb-3">{activeGroupMeta.label}</h2>
              <div className="grid grid-cols-3 gap-3 items-stretch">
                {filtered.map(task => {
                  const tmpl = templateForTask(task);
                  const result = runResult[task.id];
                  const isExpanded = expandedId === task.id;
                  return (
                    <div key={task.id} className={`border rounded-xl p-4 min-h-[148px] h-full flex flex-col transition-all ${task.enabled ? 'border-gray-200' : 'border-gray-100 opacity-60'}`}>
                      <div className="flex items-start gap-3">
                        <div className="text-2xl">{tmpl?.icon ?? '⚙️'}</div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <p className="text-sm font-medium text-gray-900 truncate">{task.name}</p>
                            <button
                              type="button"
                              onClick={() => toggleTask(task.id)}
                              className={`w-10 h-5 rounded-full transition-colors relative flex-shrink-0 ml-2 ${task.enabled ? 'bg-green-500' : 'bg-gray-200'}`}
                            >
                              <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${task.enabled ? 'left-5.5 translate-x-0.5' : 'left-0.5'}`} />
                            </button>
                          </div>
                          <p className="text-xs text-gray-500 mt-0.5 flex items-center gap-1.5">
                            <Clock size={10} /> {task.cronLabel}
                          </p>
                          {task.lastRun && (
                            <p className="text-xs text-gray-400 mt-0.5">
                              上次执行：{new Date(task.lastRun).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                            </p>
                          )}
                        </div>
                      </div>

                      {task.taskType === 'video_keyword_crawl' && (
                        <div className="mt-3">
                          <div className="grid grid-cols-[minmax(0,1fr)_5.75rem] gap-2">
                            <label className="block min-w-0">
                              <span className="block text-[10px] text-gray-400 mb-1">检索关键词</span>
                              <input
                                defaultValue={task.config.keywords || task.config.keyword || 'skincare'}
                                onBlur={e => { void updateCrawlerConfig(task, { keywords: e.currentTarget.value }); }}
                                onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                                className="h-9 w-full rounded-lg border border-gray-200 px-2.5 text-xs text-gray-700 focus:outline-none focus:border-green-400"
                                placeholder="skincare"
                              />
                            </label>
                            <label className="block">
                              <span className="block text-[10px] text-gray-400 mb-1">目标数量</span>
                              <input
                                type="number"
                                min={CRAWLER_LIMIT_MIN}
                                max={CRAWLER_LIMIT_MAX}
                                defaultValue={task.config.limit || '5'}
                                onBlur={e => {
                                  const limit = normalizeCrawlerLimit(e.currentTarget.value);
                                  e.currentTarget.value = limit;
                                  void updateCrawlerConfig(task, { limit });
                                }}
                                onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                                className="h-9 w-full rounded-lg border border-gray-200 px-2.5 text-xs text-gray-700 focus:outline-none focus:border-green-400"
                              />
                            </label>
                          </div>
                          <p className="mt-1.5 text-[10px] text-gray-400">单条任务最多爬取 10 条视频</p>
                        </div>
                      )}

                      {/* Last result */}
                      {(result || task.lastResult) && isExpanded && (
                        <div className="mt-3 p-3 bg-gray-50 rounded-lg text-xs text-gray-600 max-h-32 overflow-y-auto whitespace-pre-wrap">
                          {result || task.lastResult}
                        </div>
                      )}

                      <div className="flex gap-2 mt-auto pt-3">
                        <button
                          type="button"
                          onClick={e => { e.preventDefault(); e.stopPropagation(); void runTaskNow(task.id); }}
                          disabled={runningId === task.id}
                          className="h-9 px-3 rounded-lg bg-green-50 text-xs text-green-700 hover:bg-green-100 disabled:opacity-50 whitespace-nowrap"
                        >
                          {runningId === task.id ? '执行中…' : '立即执行'}
                        </button>
                        <button
                          type="button"
                          onClick={e => {
                            e.preventDefault();
                            e.stopPropagation();
                            setExpandedId(isExpanded ? null : task.id);
                            setResultTaskId(task.id);
                            setWorkspaceMessage('');
                          }}
                          className="h-9 px-3 border border-gray-200 rounded-lg text-xs text-gray-500 hover:bg-gray-50 whitespace-nowrap"
                        >
                          进入页面
                        </button>
                        <button type="button" onClick={e => { e.preventDefault(); e.stopPropagation(); void deleteTask(task.id); }} className="w-9 h-9 flex items-center justify-center border border-gray-200 rounded-lg text-gray-400 hover:text-red-400 hover:border-red-200 transition-colors flex-shrink-0">
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
      </div>

      {/* Add Task Modal */}
      <AnimatePresence>
        {showAdd && (
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="新建定时任务"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center"
            onClick={closeAddModal}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-2xl w-[560px] max-h-[85vh] overflow-y-auto p-6"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-5">
                <div>
                  <h3 className="font-semibold text-gray-900">新建定时任务</h3>
                  <p className="text-xs text-gray-400 mt-0.5">{activeGroupMeta.label}</p>
                </div>
                <button type="button" onClick={closeAddModal} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
              </div>

              <p className="text-xs text-gray-500 mb-3 font-medium">选择任务模板</p>
              <div className="space-y-5 mb-5">
                {groupedTemplates.map(group => (
                  <section key={group.id}>
                    <div className="flex items-center justify-between mb-2 px-0.5">
                      <div>
                        <h4 className="text-xs font-semibold text-gray-800">{group.label}</h4>
                        <p className="text-[10px] text-gray-400 mt-0.5">{group.desc}</p>
                      </div>
                      <span className="px-2 py-0.5 rounded-full bg-gray-100 text-[10px] text-gray-500">{group.templates.length} 个</span>
                    </div>
                    <div className="space-y-2">
                    {group.templates.map(tmpl => (
                  <button
                    type="button"
                    key={tmpl.templateId}
                    data-demo-target={showAdd && selectedTemplateIds.length === 0 && tmpl.templateId === 'youtube_video_keyword_crawl' ? 'scheduled_run' : undefined}
                    onClick={() => {
                      const selected = selectedTemplateIds.includes(tmpl.templateId);
                      setSelectedTemplateIds(current => selected
                        ? current.filter(id => id !== tmpl.templateId)
                        : [...current, tmpl.templateId]);
                      if (selectedTemplateIds.length === 0 && !selected) {
                        const schedule = templateSchedule(tmpl);
                        setScheduleTime(schedule.time);
                        setScheduleDays(schedule.days);
                        if (tmpl.config && 'keywords' in tmpl.config) setTaskKeywords(String(tmpl.config.keywords || 'foundation'));
                        setConfirmedKeywordSignature('');
                        setCreateError('');
                        setScheduleOpen(false);
                      }
                      if (selected && selectedTemplateIds.length === 1) setCustomName('');
                    }}
                    className={`w-full p-3 rounded-xl border-2 text-left flex items-start gap-3 transition-all ${selectedTemplateIds.includes(tmpl.templateId) ? 'border-green-500 bg-green-50' : 'border-gray-200 hover:border-gray-300'}`}
                  >
                    <span className="text-2xl">{tmpl.icon}</span>
                    <div>
                      <div className="text-sm font-medium text-gray-900">{tmpl.name}</div>
                      <div className="text-xs text-gray-500 mt-0.5">{tmpl.desc}</div>
                      <div className="text-xs text-gray-400 mt-1 flex items-center gap-1"><Clock size={10} /> {tmpl.cronLabel}</div>
                    </div>
                    {selectedTemplateIds.includes(tmpl.templateId) && <CheckCircle size={16} className="text-green-500 ml-auto mt-0.5 flex-shrink-0" />}
                  </button>
                    ))}
                    </div>
                  </section>
                ))}
              </div>

              {selectedTemplates.length > 0 && selectedTemplate && (
                <>
                  {selectedTemplates.length === 1 ? <div className="mb-4">
                    <label className="block text-xs font-medium text-gray-700 mb-1.5">任务名称</label>
                    <input
                      value={customName}
                      onChange={e => setCustomName(e.target.value)}
                      placeholder={selectedTemplate.name}
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-green-400"
                    />
                  </div> : (
                    <div className="mb-4 rounded-xl border border-green-100 bg-green-50 px-3.5 py-3 flex items-center justify-between">
                      <div>
                        <p className="text-xs font-medium text-green-800">已选择 {selectedTemplates.length} 个任务</p>
                        <p className="text-[10px] text-green-600 mt-0.5">将使用各模板默认名称，并应用同一执行频率</p>
                      </div>
                      <button type="button" onClick={() => setSelectedTemplateIds([])} className="text-[11px] text-green-700 hover:text-green-900">清空</button>
                    </div>
                  )}
                  {selectedTemplates.some(template => ['video_keyword_crawl', 'image_post_crawl'].includes(template.taskType)) && (
                    <div className="mb-4">
                      <label className="block text-xs font-medium text-gray-700 mb-1.5">采集关键词</label>
                      <textarea
                        value={taskKeywords}
                        onChange={event => {
                          setTaskKeywords(event.target.value);
                          setConfirmedKeywordSignature('');
                          setCreateError('');
                        }}
                        placeholder={'可粘贴脏格式，例如：\n##foundation，Bahja Care عناية بهجة'}
                        rows={3}
                        className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm leading-5 resize-none focus:outline-none focus:border-green-400"
                      />
                      <p className="text-[10px] text-gray-400 mt-1.5">支持逗号、空格、换行、全角符号、标签链接及混合语种，系统会先清洗再提交。</p>

                      <div className={`mt-3 rounded-xl border p-3 ${keywordReviewReady ? 'border-green-100 bg-green-50/70' : 'border-amber-200 bg-amber-50'}`}>
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-xs font-semibold text-gray-800">自动清洗结果</p>
                            <p className="text-[10px] text-gray-500 mt-0.5">请确认以下内容，确认后才会创建并执行任务。</p>
                          </div>
                          {keywordReviewConfirmed && <span className="flex items-center gap-1 text-[10px] font-medium text-green-700"><CheckCircle size={13} /> 已确认</span>}
                        </div>
                        <div className="mt-2.5 space-y-2.5">
                          {keywordReviews.map(({ platform, review }) => (
                            <div key={platform}>
                              <div className="flex items-center gap-1.5 mb-1.5">
                                <SocialPlatformIcon platform={platform} size={13} />
                                <span className="text-[10px] font-medium text-gray-600 capitalize">{platform}</span>
                              </div>
                              {review.items.length > 0 ? (
                                <div className="flex flex-wrap gap-1.5">
                                  {review.items.map(item => <span key={item} className="max-w-full break-all px-2 py-1 rounded-full bg-white border border-green-200 text-[11px] text-green-800">{item}</span>)}
                                </div>
                              ) : (
                                <p className="flex items-center gap-1 text-[11px] text-amber-700"><AlertTriangle size={13} /> 没有识别到可用关键词，请修改输入。</p>
                              )}
                              {[...review.changes, ...review.warnings].length > 0 && (
                                <ul className="mt-2 space-y-0.5 text-[10px] text-gray-500">
                                  {[...review.changes, ...review.warnings].map(message => <li key={message}>· {message}</li>)}
                                </ul>
                              )}
                            </div>
                          ))}
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            if (!keywordReviewReady) return;
                            setConfirmedKeywordSignature(keywordSignature);
                            setCreateError('');
                          }}
                          disabled={!keywordReviewReady || keywordReviewConfirmed}
                          className="mt-3 w-full py-2 rounded-lg border border-green-300 bg-white text-xs font-medium text-green-700 disabled:opacity-50"
                        >
                          {keywordReviewConfirmed ? '已确认清洗结果' : `确认使用以上 ${keywordReviews.reduce((sum, item) => sum + item.review.items.length, 0)} 个关键词`}
                        </button>
                      </div>
                    </div>
                  )}
                  <div className="mb-5">
                    <label className="block text-xs font-medium text-gray-700 mb-1.5">执行频率</label>
                    <div className="rounded-xl border border-gray-200 overflow-hidden">
                      <button
                        type="button"
                        onClick={() => setScheduleOpen(open => !open)}
                        className="w-full px-3.5 py-3 flex items-center justify-between text-left hover:bg-gray-50 transition-colors"
                      >
                        <span className="flex items-center gap-2 text-sm text-gray-800">
                          <Clock size={14} className="text-green-600" />
                          {scheduleLabel(scheduleTime, scheduleDays)}
                        </span>
                        <ChevronDown size={16} className={`text-gray-400 transition-transform ${scheduleOpen ? 'rotate-180' : ''}`} />
                      </button>
                      <AnimatePresence initial={false}>
                        {scheduleOpen && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                            className="overflow-hidden border-t border-gray-100"
                          >
                            <div className="p-3.5 bg-gray-50/70 space-y-3">
                              <div>
                                <p className="text-[11px] text-gray-500 mb-2">执行日期</p>
                                <div className="flex flex-wrap gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => setScheduleDays([])}
                                    className={`px-3 py-1.5 rounded-full border text-xs transition-colors ${scheduleDays.length === 0 ? 'border-green-500 bg-green-50 text-green-700' : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'}`}
                                  >
                                    每天
                                  </button>
                                  {WEEKDAYS.map(day => {
                                    const selected = scheduleDays.includes(day.value);
                                    return (
                                      <button
                                        type="button"
                                        key={day.value}
                                        onClick={() => setScheduleDays(current => selected ? current.filter(value => value !== day.value) : [...current, day.value])}
                                        className={`px-3 py-1.5 rounded-full border text-xs transition-colors ${selected ? 'border-green-500 bg-green-50 text-green-700' : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'}`}
                                      >
                                        {day.label}
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                              <div className="flex items-center justify-between gap-4">
                                <div>
                                  <p className="text-[11px] text-gray-500">当日时点</p>
                                  <p className="text-[10px] text-gray-400 mt-0.5">北京时间</p>
                                </div>
                                <input
                                  type="time"
                                  value={scheduleTime}
                                  onChange={event => setScheduleTime(event.target.value || '08:00')}
                                  className="w-36 px-3 py-2 border border-gray-200 bg-white rounded-lg text-sm focus:outline-none focus:border-green-400"
                                />
                              </div>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </div>
                  {selectedTemplates.some(template => ['video_keyword_crawl', 'image_post_crawl', 'competitor_account_crawl'].includes(template.taskType)) && (
                    <button
                      type="button"
                      onClick={() => setRunAfterCreate(value => !value)}
                      className={`mb-4 w-full rounded-xl border px-3.5 py-3 flex items-center justify-between text-left transition-colors ${runAfterCreate ? 'border-green-200 bg-green-50' : 'border-gray-200 bg-white'}`}
                    >
                      <span className="flex items-center gap-2.5">
                        <span className={`w-7 h-7 rounded-lg flex items-center justify-center ${runAfterCreate ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-400'}`}><Play size={14} /></span>
                        <span>
                          <span className="block text-xs font-medium text-gray-800">创建后立即执行一次</span>
                          <span className="block text-[10px] text-gray-500 mt-0.5">确认参数没有问题后，直接启动爬虫并返回本次结果</span>
                        </span>
                      </span>
                      <span className={`w-9 h-5 rounded-full p-0.5 transition-colors ${runAfterCreate ? 'bg-green-600' : 'bg-gray-300'}`}><span className={`block w-4 h-4 rounded-full bg-white transition-transform ${runAfterCreate ? 'translate-x-4' : ''}`} /></span>
                    </button>
                  )}
                </>
              )}

              {createError && <p className="mb-3 flex items-start gap-1.5 text-xs text-red-600"><AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />{createError}</p>}
              <div className="flex gap-3">
                <button type="button" onClick={closeAddModal} className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600">取消</button>
                <button
                  type="button"
                  data-demo-target={showAdd && selectedTemplates.length > 0 ? 'scheduled_run' : undefined}
                  onClick={createTask}
                  disabled={selectedTemplates.length === 0 || creatingTasks || !keywordReviewConfirmed}
                  className="flex-1 py-2.5 rounded-xl text-sm text-white font-medium disabled:opacity-40"
                  style={{ background: '#16a34a' }}
                >
                  {creatingTasks
                    ? (runAfterCreate ? '正在创建并执行…' : '正在创建…')
                    : selectedTemplates.length > 1
                      ? `${runAfterCreate ? '创建并执行' : '创建'} ${selectedTemplates.length} 个任务`
                      : runAfterCreate && ['video_keyword_crawl', 'image_post_crawl', 'competitor_account_crawl'].includes(selectedTemplate?.taskType || '')
                        ? '创建并执行任务'
                        : '创建任务'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
        {resultTask && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/20 z-40"
              onClick={closeResultPanel}
            />
            <motion.div
              initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 300 }}
              className="fixed top-0 right-0 h-full w-[520px] bg-white border-l border-gray-200 z-50 flex flex-col shadow-2xl"
              onClick={e => e.stopPropagation()}
            >
              <div className="px-5 py-4 border-b border-gray-100 flex items-start gap-3">
                <div className="text-3xl w-11 h-11 rounded-xl bg-gray-50 flex items-center justify-center flex-shrink-0">
                  {resultTemplate?.icon ?? '⚙️'}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-gray-900 truncate">{resultWorkspace?.title ?? resultTask.name}</h3>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-green-50 text-green-700 font-medium">任务页面</span>
                  </div>
                  <p className="text-xs text-gray-700 mt-1 truncate">{resultTask.name}</p>
                  <p className="text-xs text-gray-500 mt-1">
                    {resultTask.cronLabel} · 上次执行 {formatTime(resultTask.lastRun)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => { void exportPdf(resultTask); }}
                  disabled={exportingId === resultTask.id || !resultTask.lastRun || !resultTask.lastResult}
                  title={!resultTask.lastRun || !resultTask.lastResult ? '任务执行完成后可导出 PDF' : '导出任务报告'}
                  className="h-8 px-3 rounded-lg border border-gray-200 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-50 flex items-center gap-1.5"
                >
                  {exportingId === resultTask.id ? <Loader size={12} className="animate-spin" /> : <Download size={12} />}
                  导出 PDF
                </button>
                <button type="button" aria-label="关闭任务详情" onClick={closeResultPanel} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600">
                  <X size={16} />
                </button>
              </div>

              {exportNotice?.taskId === resultTask.id && (
                <div role="status" aria-live="polite" className={`mx-5 mt-3 rounded-lg border px-3 py-2 text-xs font-medium ${exportNotice.error ? 'border-red-200 bg-red-50 text-red-700' : 'border-green-200 bg-green-50 text-green-700'}`}>
                  {exportNotice.message}
                </div>
              )}

              <div className="flex-1 overflow-y-auto p-5 space-y-5">
                {resultWorkspace && (
                  <section className="rounded-xl border border-gray-200 bg-white p-4">
                    <p className="text-xs font-semibold text-gray-800 mb-3">交互页面</p>
                    <div className="grid grid-cols-3 gap-2">
                      {resultWorkspace.cards.map(card => (
                        <div key={card.label} className="min-h-[98px] rounded-lg bg-gray-50 border border-gray-100 px-3 py-2.5">
                          <p className="text-[11px] text-gray-400">{card.label}</p>
                          <p className="text-sm font-semibold text-gray-900 mt-1 break-words">{card.value}</p>
                          <p className="text-[11px] text-gray-500 mt-1 leading-relaxed">{card.desc}</p>
                        </div>
                      ))}
                    </div>
                    <div className="grid grid-cols-3 gap-2 mt-3">
                      {resultWorkspace.actions.map(action => (
                        <button
                          key={action}
                          type="button"
                          onClick={() => setWorkspaceMessage(`${action}已准备，可结合任务产出继续处理。`)}
                          className="h-9 rounded-lg border border-gray-200 text-[11px] text-gray-600 hover:bg-gray-50 px-2"
                        >
                          {action}
                        </button>
                      ))}
                    </div>
                    {workspaceMessage && (
                      <div className="mt-3 rounded-lg bg-green-50 border border-green-100 px-3 py-2 text-xs text-green-800 leading-relaxed">
                        {workspaceMessage}
                      </div>
                    )}
                  </section>
                )}

                <section className="rounded-xl border border-gray-200 bg-white p-4">
                  <p className="text-xs font-semibold text-gray-800 mb-3">建议下一步</p>
                  <div className="space-y-2">
                    {suggestedActions(resultTask, resultText).map((action, index) => (
                      <div key={action.label} className="flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-2">
                        <span className="w-5 h-5 rounded-full bg-green-50 text-green-700 text-[10px] font-semibold flex items-center justify-center flex-shrink-0">{index + 1}</span>
                        <p className="text-xs text-gray-600 leading-relaxed flex-1">{action.label}</p>
                        <button
                          type="button"
                          data-demo-target={index === 0 ? 'automation_workflow_agent' : undefined}
                          onClick={() => goToAgent(action)}
                          className="h-7 px-2.5 rounded-lg bg-white border border-gray-200 text-[11px] text-gray-600 hover:border-green-200 hover:text-green-700 hover:bg-green-50 flex-shrink-0"
                        >
                          去{action.agentLabel}
                        </button>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="rounded-xl border border-gray-200 bg-white p-4">
                  <p className="text-xs font-semibold text-gray-800 mb-3">任务信息</p>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded-lg bg-gray-50 px-3 py-2">
                      <p className="text-gray-400">类型</p>
                      <p className="text-gray-700 font-medium mt-0.5">{resultTemplate?.name ?? resultTask.taskType}</p>
                    </div>
                    <div className="rounded-lg bg-gray-50 px-3 py-2">
                      <p className="text-gray-400">状态</p>
                      <p className="text-gray-700 font-medium mt-0.5">{resultTask.enabled ? '已启用' : '已停用'}</p>
                    </div>
                    <div className="rounded-lg bg-gray-50 px-3 py-2">
                      <p className="text-gray-400">频率</p>
                      <p className="text-gray-700 font-medium mt-0.5">{resultTask.cronLabel}</p>
                    </div>
                    <div className="rounded-lg bg-gray-50 px-3 py-2">
                      <p className="text-gray-400">创建时间</p>
                      <p className="text-gray-700 font-medium mt-0.5">{formatTime(resultTask.createdAt)}</p>
                    </div>
                  </div>
                </section>
              </div>

              <div className="border-t border-gray-100 p-4 flex justify-end">
                <button type="button" onClick={closeResultPanel} className="px-4 py-2.5 border border-gray-200 rounded-xl text-xs text-gray-600 hover:bg-gray-50">
                  关闭
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
