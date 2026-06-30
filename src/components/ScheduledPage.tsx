import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Activity, BarChart3, Clock, Download, DownloadCloud, Plus, X, Play, Trash2, CheckCircle, Loader } from 'lucide-react';
import type { AgentAction, AgentType } from '../App';

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
interface NextAction {
  label: string;
  agent: AgentType;
  agentLabel: string;
  prompt: string;
}

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
type TaskTemplate = (typeof TASK_TEMPLATES)[number];

const CRON_PRESETS = [
  { label: '每天 01:00（北京时间）', expr: '0 1 * * *' },
  { label: '每天 08:00', expr: '0 8 * * *' },
  { label: '每天 09:00', expr: '0 9 * * *' },
  { label: '每天 18:00', expr: '0 18 * * *' },
  { label: '每周一 10:00', expr: '0 10 * * 1' },
  { label: '每周五 18:00', expr: '0 18 * * 5' },
  { label: '每月1号 09:00', expr: '0 9 1 * *' },
];

export default function ScheduledPage({ onAction }: { onAction?: AgentAction }) {
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeGroup, setActiveGroup] = useState<AgentTaskGroup>('social');
  const [showAdd, setShowAdd] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<TaskTemplate | null>(null);
  const [cronPreset, setCronPreset] = useState('');
  const [customName, setCustomName] = useState('');
  const [runningId, setRunningId] = useState<string | null>(null);
  const [runResult, setRunResult] = useState<Record<string, string>>({});
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [resultTaskId, setResultTaskId] = useState<string | null>(null);
  const [workspaceMessage, setWorkspaceMessage] = useState('');
  const [exportingId, setExportingId] = useState<string | null>(null);
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
    await createTaskFromTemplate(selectedTemplate, customName, cronPreset);
    setShowAdd(false);
    setSelectedTemplate(null);
    setCustomName('');
    setCronPreset('');
  }

  async function createTaskFromTemplate(template: TaskTemplate, name = '', cronExpr = '') {
    const body = {
      ...template,
      name: name || template.name,
      cronExpr: cronExpr || template.cronExpr,
      cronLabel: CRON_PRESETS.find(p => p.expr === (cronExpr || template.cronExpr))?.label ?? template.cronLabel,
    };
    await fetch('/api/overseas/scheduler', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    await fetchTasks();
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
    if (resultTaskId === id) setResultTaskId(null);
    await fetchTasks();
  }

  function selectGroup(group: AgentTaskGroup) {
    setActiveGroup(group);
    setSelectedTemplate(null);
    setCustomName('');
    setCronPreset('');
    setResultTaskId(null);
    setWorkspaceMessage('');
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
  const resultTask = tasks.find(task => task.id === resultTaskId) ?? null;
  const resultText = resultTask ? (runResult[resultTask.id] || resultTask.lastResult || '') : '';
  const resultTemplate = resultTask ? TASK_TEMPLATES.find(t => t.taskType === resultTask.taskType) : null;

  const exportPdf = async (task: ScheduledTask) => {
    setExportingId(task.id);
    try {
      const res = await fetch(`/api/overseas/scheduler/${task.id}/export-pdf`);
      if (!res.ok) throw new Error('PDF 导出失败');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${task.name}-任务报告.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } finally {
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
          agentLabel: '策略专家',
          prompt: `根据节日推品提醒，按市场和节日优先级整理未来 7 天需要主推的 SKU、库存水位、备货风险和负责人动作。${context}`,
        },
        {
          label: '生成社媒预热脚本和短视频内容方向',
          agent: 'traffic',
          agentLabel: '流量专家',
          prompt: `基于节日推品提醒，生成可直接使用的社媒预热脚本、短视频钩子和多语言内容方向，重点适配企业中心主要市场。${context}`,
        },
        {
          label: '生成私域触达话术并安排近 90 天询盘跟进',
          agent: 'conversion',
          agentLabel: '转化专家',
          prompt: `基于节日推品提醒，设计私域触达话术，并筛选近 90 天相关品类询盘客户，输出跟进优先级和报价/邀约话术。${context}`,
        },
      ];
    }
    if (task.taskType === 'trend_report') {
      return [
        {
          label: '把高频话题转成 3 条 TikTok 脚本方向',
          agent: 'traffic',
          agentLabel: '流量专家',
          prompt: `把爆款日报中的高频话题转成 3 条 TikTok 脚本方向，包含钩子、镜头结构和口播重点。${context}`,
        },
        {
          label: '挑选 2 个产品卖点做 A/B 内容测试',
          agent: 'traffic',
          agentLabel: '流量专家',
          prompt: `基于爆款日报，挑选 2 个产品卖点设计 A/B 内容测试方案，输出标题、素材形式和判断指标。${context}`,
        },
        {
          label: '将适配市场和语言写回企业中心学习记录',
          agent: 'strategy',
          agentLabel: '策略专家',
          prompt: `基于爆款日报，提炼适配市场、主要语言和有效内容角度，整理成可写回企业中心的 Agent 学习记录。${context}`,
        },
      ];
    }
    if (task.taskType === 'video_keyword_crawl') {
      return [
        {
          label: '查看新入库视频并筛选可复用素材',
          agent: 'traffic',
          agentLabel: '流量专家',
          prompt: `根据视频采集结果，筛选新入库视频里最值得复用的素材方向，并说明筛选标准。${context}`,
        },
        {
          label: '选择高互动视频生成克隆脚本',
          agent: 'traffic',
          agentLabel: '流量专家',
          prompt: `从视频采集结果中挑选高互动视频方向，生成 3 条去重后的克隆脚本。${context}`,
        },
        {
          label: '复盘失败下载链接并补充关键词',
          agent: 'strategy',
          agentLabel: '策略专家',
          prompt: `复盘视频采集任务中下载失败或结果不足的问题，补充下一轮关键词和平台采集策略。${context}`,
        },
      ];
    }
    if (task.taskType === 'exchange_rate') {
      return [
        {
          label: '生成多币种询盘报价话术',
          agent: 'conversion',
          agentLabel: '转化专家',
          prompt: `根据汇率日报，生成面向不同市场客户的多币种报价话术，并标注报价有效期。${context}`,
        },
        {
          label: '更新报价风险和利润提醒',
          agent: 'strategy',
          agentLabel: '策略专家',
          prompt: `根据汇率日报，判断当前报价风险、利润保护线和需要用户确认的报价策略。${context}`,
        },
        {
          label: '整理老客补货报价提醒',
          agent: 'retention',
          agentLabel: '留存专家',
          prompt: `根据汇率日报，为老客补货场景生成报价提醒和复购触达建议。${context}`,
        },
      ];
    }
    if (task.taskType === 'weekly_review') {
      return [
        {
          label: '拆解下周社媒内容任务',
          agent: 'traffic',
          agentLabel: '流量专家',
          prompt: `根据每周经营复盘，拆解下周社媒内容任务，输出选题、脚本方向和优先级。${context}`,
        },
        {
          label: '生成询盘转化跟进动作',
          agent: 'conversion',
          agentLabel: '转化专家',
          prompt: `根据每周经营复盘，生成询盘转化跟进动作、报价优化点和高意向客户处理顺序。${context}`,
        },
        {
          label: '生成老客复购唤醒动作',
          agent: 'retention',
          agentLabel: '留存专家',
          prompt: `根据每周经营复盘，生成老客复购唤醒任务、客户分层和触达节奏。${context}`,
        },
      ];
    }
    if (task.taskType === 'crm_wakeup') {
      return [
        {
          label: '生成老客唤醒分层和触达节奏',
          agent: 'retention',
          agentLabel: '留存专家',
          prompt: `根据沉默客户唤醒任务，生成客户分层、触达节奏和复购推荐逻辑。${context}`,
        },
        {
          label: '生成 WhatsApp 跟进话术',
          agent: 'conversion',
          agentLabel: '转化专家',
          prompt: `根据沉默客户唤醒任务，生成可直接发送的 WhatsApp 跟进话术，并区分高意向/普通老客。${context}`,
        },
        {
          label: '生成复购内容素材方向',
          agent: 'traffic',
          agentLabel: '流量专家',
          prompt: `根据沉默客户唤醒任务，生成适合老客复购的内容素材方向和短视频脚本钩子。${context}`,
        },
      ];
    }
    return [
      {
        label: '交给策略专家拆解后续任务',
        agent: 'strategy',
        agentLabel: '策略专家',
        prompt: `请根据这次定时任务结果，拆解可执行的后续 Agent 任务。${context}`,
      },
    ];
  };

  const goToAgent = (action: NextAction) => {
    setResultTaskId(null);
    onAction?.(action.agent, action.prompt);
  };

  const taskWorkspace = (task: ScheduledTask) => {
    switch (task.taskType) {
      case 'video_keyword_crawl':
        return {
          title: '视频采集工作台',
          cards: [
            { label: '采集平台', value: task.config.platforms || 'youtube,tiktok', desc: '按平台拉取关键词视频' },
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
            { label: '覆盖币种', value: 'CNY/SAR/AED', desc: '适配中东和人民币成本核算' },
            { label: '报价规则', value: '24h 有效', desc: '减少汇率波动风险' },
          ],
          actions: ['生成多币种报价', '复制汇率摘要', '生成询盘报价话术'],
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
          actions: ['查看结果', '复制产出', '重新执行'],
        };
    }
  };

  const resultWorkspace = resultTask ? taskWorkspace(resultTask) : null;

  const groupWorkspace = (group: AgentTaskGroup) => {
    const templates = TASK_TEMPLATES.filter(t => taskAgentGroup(t.taskType) === group);
    const cards = group === 'conversion'
      ? [
          { label: '报价辅助', value: '多币种', desc: '汇率日报联动询盘报价，减少手动换算' },
          { label: '经营复盘', value: '周维度', desc: '自动生成流量、询盘、转化复盘' },
          { label: '动作输出', value: '待创建', desc: '生成下周优化任务和跟进建议' },
        ]
      : [
          { label: '客户分层', value: '60 天', desc: '识别沉默客户和复购机会' },
          { label: '唤醒触达', value: 'WhatsApp', desc: '生成老客唤醒文案与推品理由' },
          { label: '复购节奏', value: '每周', desc: '沉淀客户偏好和下一次跟进时间' },
        ];
    const workflow = group === 'conversion'
      ? ['汇率与经营数据汇总', '生成报价/复盘建议', '输出给转化专家执行']
      : ['筛选沉默客户', '匹配历史采购偏好', '生成触达话术和推品清单'];

    return (
      <div className="mb-6 space-y-4">
        <div className="grid grid-cols-3 gap-3">
          {cards.map(card => (
            <div key={card.label} className="rounded-xl border border-gray-200 bg-white p-4">
              <p className="text-xs text-gray-500">{card.label}</p>
              <p className="text-2xl font-semibold text-gray-900 mt-2">{card.value}</p>
              <p className="text-xs text-gray-500 mt-2 leading-relaxed">{card.desc}</p>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-[1fr_1.2fr] gap-3">
          <section className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-semibold text-gray-900">可用自动化模板</p>
              <span className="text-xs text-gray-400">{templates.length} 个模板</span>
            </div>
            <div className="space-y-2">
              {templates.map(tmpl => {
                const exists = tasks.some(task => task.taskType === tmpl.taskType);
                return (
                  <div key={tmpl.taskType} className="rounded-xl border border-gray-100 bg-gray-50/60 p-3 flex items-start gap-3">
                    <span className="text-2xl">{tmpl.icon}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900">{tmpl.name}</p>
                      <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{tmpl.desc}</p>
                      <p className="text-xs text-gray-400 mt-1 flex items-center gap-1"><Clock size={10} /> {tmpl.cronLabel}</p>
                    </div>
                    <button
                      type="button"
                      onClick={e => { e.preventDefault(); e.stopPropagation(); if (!exists) void createTaskFromTemplate(tmpl); }}
                      disabled={exists}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${exists ? 'bg-green-50 text-green-700 cursor-default' : 'text-white'}`}
                      style={exists ? undefined : { background: '#16a34a' }}
                    >
                      {exists ? '已创建' : '创建'}
                    </button>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="rounded-xl border border-gray-200 bg-white p-4">
            <p className="text-sm font-semibold text-gray-900 mb-3">工作流预览</p>
            <div className="space-y-3">
              {workflow.map((step, index) => (
                <div key={step} className="flex items-center gap-3">
                  <span className="w-7 h-7 rounded-full bg-green-50 text-green-700 text-xs font-semibold flex items-center justify-center flex-shrink-0">{index + 1}</span>
                  <div className="flex-1 rounded-lg bg-gray-50 px-3 py-2">
                    <p className="text-xs font-medium text-gray-800">{step}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4 rounded-xl bg-green-50 border border-green-100 p-3">
              <p className="text-xs text-green-800 leading-relaxed">
                创建任务后，可以立即执行并在右侧结果工作台查看产出、复制内容和安排下一步。
              </p>
            </div>
          </section>
        </div>
      </div>
    );
  };

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

          {activeGroup !== 'social' && !loading && groupWorkspace(activeGroup)}

          {loading && <div className="text-sm text-gray-400 py-12 text-center">加载中...</div>}

          {!loading && filtered.length === 0 && (
            <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/50 p-8 text-center text-gray-400">
              <Clock size={40} className="mb-3 opacity-40" />
              <p className="text-sm font-medium">还没有定时任务</p>
              <p className="text-xs mt-1">可以从上方模板直接创建，或点击“新建任务”自定义执行频率</p>
            </div>
          )}

          {!loading && filtered.length > 0 && (
            <div className="mb-8">
              <h2 className="text-sm font-semibold text-gray-500 mb-3">{activeGroupMeta.label}</h2>
              <div className="grid grid-cols-3 gap-3 items-stretch">
                {filtered.map(task => {
                  const tmpl = TASK_TEMPLATES.find(t => t.taskType === task.taskType);
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

                      {/* Last result */}
                      {(result || task.lastResult) && isExpanded && (
                        <div className="mt-3 p-3 bg-gray-50 rounded-lg text-xs text-gray-600 max-h-32 overflow-y-auto whitespace-pre-wrap">
                          {result || task.lastResult}
                        </div>
                      )}

                      <div className="flex gap-2 mt-auto pt-3">
                        <button
                          type="button"
                          onClick={e => { e.preventDefault(); e.stopPropagation(); void runNow(task.id); }}
                          disabled={runningId === task.id}
                          className="flex-1 min-w-0 h-9 flex items-center justify-center gap-1.5 px-3 rounded-lg text-xs text-white disabled:opacity-50 transition-colors"
                          style={{ background: '#16a34a' }}
                        >
                          {runningId === task.id ? <Loader size={10} className="animate-spin" /> : <Play size={10} />}
                          {runningId === task.id ? '执行中' : '立即执行'}
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
        {resultTask && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/20 z-40"
              onClick={() => setResultTaskId(null)}
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
                  disabled={exportingId === resultTask.id}
                  className="h-8 px-3 rounded-lg border border-gray-200 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-50 flex items-center gap-1.5"
                >
                  {exportingId === resultTask.id ? <Loader size={12} className="animate-spin" /> : <Download size={12} />}
                  导出 PDF
                </button>
                <button type="button" onClick={() => setResultTaskId(null)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600">
                  <X size={16} />
                </button>
              </div>

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

              <div className="border-t border-gray-100 p-4 flex gap-2">
                <button
                  type="button"
                  onClick={() => { void runNow(resultTask.id); }}
                  disabled={runningId === resultTask.id}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-xs text-white font-medium disabled:opacity-50"
                  style={{ background: '#16a34a' }}
                >
                  {runningId === resultTask.id ? <Loader size={12} className="animate-spin" /> : <Play size={12} />}
                  {runningId === resultTask.id ? '执行中' : '重新执行'}
                </button>
                <button type="button" onClick={() => setResultTaskId(null)} className="px-4 py-2.5 border border-gray-200 rounded-xl text-xs text-gray-600 hover:bg-gray-50">
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
