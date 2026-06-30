import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Activity, BarChart3, Clock, DownloadCloud, Plus, X, Play, Trash2, CheckCircle, Loader } from 'lucide-react';

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
    };
  };
}

type AgentTaskGroup = 'social' | 'conversion' | 'customer';

const AGENT_GROUPS: { id: AgentTaskGroup; label: string; desc: string }[] = [
  { id: 'social', label: '社媒 Agent 定时任务', desc: '内容采集、趋势监控、社媒素材分析' },
  { id: 'conversion', label: '销转 Agent 定时任务', desc: '报价、询盘、经营复盘和转化动作' },
  { id: 'customer', label: '客户管理 Agent 定时任务', desc: '老客分层、沉默唤醒、复购触达' },
];

function taskAgentGroup(taskType: string): AgentTaskGroup {
  if (['video_keyword_crawl', 'trend_report', 'holiday_push'].includes(taskType)) return 'social';
  if (['crm_wakeup'].includes(taskType)) return 'customer';
  return 'conversion';
}

const TASK_TEMPLATES = [
  {
    taskType: 'video_keyword_crawl',
    name: 'YT/TK 关键词视频自动采集',
    category: 'daily' as const,
    cronExpr: '0 1 * * *',
    cronLabel: '每天 01:00（北京时间）',
    icon: '🎬',
    desc: '每天凌晨自动采集 YouTube 和 TikTok 关键词视频，并排队获取真实视频 / Gemini 分析',
    config: { platforms: 'youtube,tiktok', keywords: 'skincare', limit: '12', dateWindowDays: '7' },
  },
  { taskType: 'trend_report', name: 'TikTok 爆款日报', category: 'daily' as const, cronExpr: '0 8 * * *', cronLabel: '每天 08:00', icon: '🔥', desc: '每日生成 TikTok 跨境电商热门趋势简报' },
  { taskType: 'exchange_rate', name: '汇率日报', category: 'daily' as const, cronExpr: '0 9 * * *', cronLabel: '每天 09:00', icon: '💱', desc: '实时获取 USD/SAR/AED/VND/MYR 等汇率并发送' },
  { taskType: 'weekly_review', name: '每周经营复盘', category: 'report' as const, cronExpr: '0 18 * * 5', cronLabel: '每周五 18:00', icon: '📊', desc: 'AI 生成本周流量、询盘、转化、复购复盘报告' },
  { taskType: 'crm_wakeup', name: '沉默客户唤醒', category: 'automation' as const, cronExpr: '0 10 * * 1', cronLabel: '每周一 10:00', icon: '💌', desc: '自动生成针对 60 天沉默老客的唤醒消息并推送' },
  { taskType: 'holiday_push', name: '节日推品提醒', category: 'monitor' as const, cronExpr: '0 9 * * *', cronLabel: '每天 09:00', icon: '🎉', desc: '节日前 7 天自动提醒备货和推品策略' },
];

const CRON_PRESETS = [
  { label: '每天 01:00（北京时间）', expr: '0 1 * * *' },
  { label: '每天 08:00', expr: '0 8 * * *' },
  { label: '每天 09:00', expr: '0 9 * * *' },
  { label: '每天 18:00', expr: '0 18 * * *' },
  { label: '每周一 10:00', expr: '0 10 * * 1' },
  { label: '每周五 18:00', expr: '0 18 * * 5' },
  { label: '每月1号 09:00', expr: '0 9 1 * *' },
];

export default function ScheduledPage() {
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeGroup, setActiveGroup] = useState<AgentTaskGroup>('social');
  const [showAdd, setShowAdd] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<typeof TASK_TEMPLATES[0] | null>(null);
  const [cronPreset, setCronPreset] = useState('');
  const [customName, setCustomName] = useState('');
  const [runningId, setRunningId] = useState<string | null>(null);
  const [runResult, setRunResult] = useState<Record<string, string>>({});
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [videoStats, setVideoStats] = useState<VideoStatsPayload | null>(null);

  useEffect(() => {
    void fetchTasks();
    void fetchVideoStats();
    const timer = window.setInterval(() => { void fetchVideoStats(); }, 5000);
    return () => window.clearInterval(timer);
  }, []);

  async function fetchTasks() {
    setLoading(true);
    try {
      const r = await fetch('/api/overseas/scheduler');
      setTasks(await r.json());
    } finally { setLoading(false); }
  }

  async function fetchVideoStats() {
    try {
      const r = await fetch('/api/overseas/scheduler/video-stats');
      if (!r.ok) return;
      setVideoStats(await r.json());
    } catch {
      // Keep the previous snapshot visible during backend hot reloads.
    }
  }

  async function createTask() {
    if (!selectedTemplate) return;
    const body = {
      ...selectedTemplate,
      name: customName || selectedTemplate.name,
      cronExpr: cronPreset || selectedTemplate.cronExpr,
      cronLabel: CRON_PRESETS.find(p => p.expr === (cronPreset || selectedTemplate.cronExpr))?.label ?? selectedTemplate.cronLabel,
    };
    await fetch('/api/overseas/scheduler', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    await fetchTasks();
    setShowAdd(false);
    setSelectedTemplate(null);
    setCustomName('');
    setCronPreset('');
  }

  async function toggleTask(id: string) {
    await fetch(`/api/overseas/scheduler/${id}/toggle`, { method: 'POST' });
    await fetchTasks();
  }

  async function runNow(id: string) {
    setRunningId(id);
    try {
      const r = await fetch(`/api/overseas/scheduler/${id}/run`, { method: 'POST' });
      const data = await r.json();
      setRunResult(prev => ({ ...prev, [id]: data.result ?? '执行完成' }));
      setExpandedId(id);
      await fetchTasks();
      await fetchVideoStats();
    } finally { setRunningId(null); }
  }

  async function deleteTask(id: string) {
    await fetch(`/api/overseas/scheduler/${id}`, { method: 'DELETE' });
    await fetchTasks();
  }

  function selectGroup(group: AgentTaskGroup) {
    setActiveGroup(group);
    setSelectedTemplate(null);
    setCustomName('');
    setCronPreset('');
  }

  function closeAddModal() {
    setShowAdd(false);
    setSelectedTemplate(null);
    setCustomName('');
    setCronPreset('');
  }

  const filtered = tasks.filter(t => taskAgentGroup(t.taskType) === activeGroup);
  const activeGroupMeta = AGENT_GROUPS.find(group => group.id === activeGroup)!;
  const visibleTemplates = TASK_TEMPLATES.filter(t => taskAgentGroup(t.taskType) === activeGroup);
  const stats = videoStats?.stats;
  const crawl = stats?.crawl ?? {};
  const fetchQueue = stats?.fetchQueue ?? {};
  const analysisQueue = stats?.analysisQueue ?? {};
  const crawlTask = (videoStats?.tasks ?? tasks).find(t => t.taskType === 'video_keyword_crawl');
  const formatTime = (value?: string) => value
    ? new Date(value).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '暂无';

  return (
    <div className="flex h-full bg-white">
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
        {/* Header */}
        <div className="px-8 pt-8 pb-4 border-b border-gray-100">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-semibold text-gray-900">{activeGroupMeta.label}</h1>
              <p className="text-sm text-gray-500 mt-0.5">{activeGroupMeta.desc}</p>
            </div>
            <button
              type="button"
              onClick={() => { setSelectedTemplate(null); setCustomName(''); setCronPreset(''); setShowAdd(true); }}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white"
              style={{ background: '#16a34a' }}
            >
              <Plus size={16} /> 新建任务
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-8 py-6">
          {activeGroup === 'social' && (
          <div className="mb-6">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h2 className="text-sm font-semibold text-gray-900">社媒爬虫定时任务 / 视频采集实时看板</h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  {crawlTask ? `${crawlTask.name} · ${crawlTask.cronLabel}` : '自动采集任务未创建'} · 更新时间 {formatTime(stats?.updatedAt)}
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
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-xl border border-gray-200 p-4 bg-white">
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <BarChart3 size={14} className="text-orange-500" />
                  视频爬取数据
                </div>
                <div className="mt-3 flex items-end gap-3">
                  <span className="text-2xl font-semibold text-gray-900">{crawl.total ?? 0}</span>
                  <span className="text-xs text-gray-500 pb-1">库内视频</span>
                </div>
                <p className="text-xs text-gray-500 mt-2">今日 {crawl.today ?? 0} 条 · 24小时 {crawl.last24h ?? 0} 条 · 最新 {formatTime(crawl.latestAt)}</p>
                <p className="text-xs text-gray-400 mt-1">YT {crawl.byPlatform?.youtube ?? 0} / TK {crawl.byPlatform?.tiktok ?? 0} / IG {crawl.byPlatform?.instagram ?? 0} / FB {crawl.byPlatform?.facebook ?? 0}</p>
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
                <p className="text-xs text-gray-400 mt-1">queued {fetchQueue.byStatus?.queued ?? 0} / downloading {fetchQueue.byStatus?.downloading ?? 0} / ops {fetchQueue.byStatus?.ops_queued ?? 0}</p>
              </div>

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
                <p className="text-xs text-gray-400 mt-1">queued {analysisQueue.byStatus?.queued ?? 0} / analyzing {analysisQueue.byStatus?.analyzing ?? 0} / video {analysisQueue.byStatus?.analyzed ?? 0}</p>
              </div>
            </div>
          </div>
          )}

          {loading && <div className="text-sm text-gray-400 py-12 text-center">加载中...</div>}

          {!loading && filtered.length === 0 && (
            <div className="flex flex-col items-center justify-center h-64 text-gray-400">
              <Clock size={40} className="mb-3 opacity-40" />
              <p className="text-sm font-medium">还没有定时任务</p>
              <p className="text-xs mt-1">点击"新建任务"创建你的第一个自动化任务</p>
            </div>
          )}

          {!loading && filtered.length > 0 && (
            <div className="mb-8">
              <h2 className="text-sm font-semibold text-gray-500 mb-3">{activeGroupMeta.label}</h2>
              <div className="grid grid-cols-2 gap-3">
                {filtered.map(task => {
                  const tmpl = TASK_TEMPLATES.find(t => t.taskType === task.taskType);
                  const result = runResult[task.id];
                  const isExpanded = expandedId === task.id;
                  return (
                    <div key={task.id} className={`border rounded-xl p-4 transition-all ${task.enabled ? 'border-gray-200' : 'border-gray-100 opacity-60'}`}>
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

                      {/* Last result */}
                      {(result || task.lastResult) && isExpanded && (
                        <div className="mt-3 p-3 bg-gray-50 rounded-lg text-xs text-gray-600 max-h-32 overflow-y-auto whitespace-pre-wrap">
                          {result || task.lastResult}
                        </div>
                      )}

                      <div className="flex gap-2 mt-3">
                        <button
                          type="button"
                          onClick={() => runNow(task.id)}
                          disabled={runningId === task.id}
                          className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs text-white disabled:opacity-50 transition-colors"
                          style={{ background: '#16a34a' }}
                        >
                          {runningId === task.id ? <Loader size={10} className="animate-spin" /> : <Play size={10} />}
                          {runningId === task.id ? '执行中' : '立即执行'}
                        </button>
                        {(result || task.lastResult) && (
                          <button
                            type="button"
                            onClick={() => setExpandedId(isExpanded ? null : task.id)}
                            className="px-3 py-1.5 border border-gray-200 rounded-lg text-xs text-gray-500 hover:bg-gray-50"
                          >
                            {isExpanded ? '收起' : '查看结果'}
                          </button>
                        )}
                        <button type="button" onClick={() => deleteTask(task.id)} className="px-2.5 py-1.5 border border-gray-200 rounded-lg text-gray-400 hover:text-red-400 hover:border-red-200 transition-colors">
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

      {/* Add Task Modal */}
      <AnimatePresence>
        {showAdd && (
          <motion.div
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
              <div className="space-y-2 mb-5">
                {visibleTemplates.map(tmpl => (
                  <button
                    type="button"
                    key={tmpl.taskType}
                    onClick={() => setSelectedTemplate(tmpl)}
                    className={`w-full p-3 rounded-xl border-2 text-left flex items-start gap-3 transition-all ${selectedTemplate?.taskType === tmpl.taskType ? 'border-green-500 bg-green-50' : 'border-gray-200 hover:border-gray-300'}`}
                  >
                    <span className="text-2xl">{tmpl.icon}</span>
                    <div>
                      <div className="text-sm font-medium text-gray-900">{tmpl.name}</div>
                      <div className="text-xs text-gray-500 mt-0.5">{tmpl.desc}</div>
                      <div className="text-xs text-gray-400 mt-1 flex items-center gap-1"><Clock size={10} /> {tmpl.cronLabel}</div>
                    </div>
                    {selectedTemplate?.taskType === tmpl.taskType && <CheckCircle size={16} className="text-green-500 ml-auto mt-0.5 flex-shrink-0" />}
                  </button>
                ))}
              </div>

              {selectedTemplate && (
                <>
                  <div className="mb-4">
                    <label className="block text-xs font-medium text-gray-700 mb-1.5">任务名称</label>
                    <input
                      value={customName}
                      onChange={e => setCustomName(e.target.value)}
                      placeholder={selectedTemplate.name}
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-green-400"
                    />
                  </div>
                  <div className="mb-5">
                    <label className="block text-xs font-medium text-gray-700 mb-1.5">执行频率</label>
                    <div className="grid grid-cols-3 gap-2">
                      {CRON_PRESETS.map(p => (
                        <button
                          type="button"
                          key={p.expr}
                          onClick={() => setCronPreset(p.expr)}
                          className={`py-2 px-3 rounded-lg border text-xs transition-all ${(cronPreset || selectedTemplate.cronExpr) === p.expr ? 'border-green-500 bg-green-50 text-green-700' : 'border-gray-200 text-gray-600 hover:border-gray-300'}`}
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}

              <div className="flex gap-3">
                <button type="button" onClick={closeAddModal} className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600">取消</button>
                <button
                  type="button"
                  onClick={createTask}
                  disabled={!selectedTemplate}
                  className="flex-1 py-2.5 rounded-xl text-sm text-white font-medium disabled:opacity-40"
                  style={{ background: '#16a34a' }}
                >
                  创建任务
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
