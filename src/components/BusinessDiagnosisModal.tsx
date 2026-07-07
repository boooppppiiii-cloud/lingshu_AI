import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock3,
  Maximize2,
  Minimize2,
  Sparkles,
  Target,
  TrendingUp,
  X,
} from 'lucide-react';
import type { AgentAction, Page } from '../App';
import type { AuthSession } from '../lib/auth';

interface Props {
  open: boolean;
  session: AuthSession;
  onClose: () => void;
  onDismissToday: () => void;
  onNavigate: (page: Page) => void;
  onAction?: AgentAction;
}

const opportunities = [
  '复盘美国 DTC 美妆品牌转化机会',
  '判断中东美妆批发商增长优先级',
  '整理维 C 亮肤精华备货决策',
];

const discoveries = [
  { label: '内容机会', text: '近期素材里“敏感肌、快速吸收、妆前不搓泥”重复出现，可拆成短视频脚本角度。' },
  { label: '转化提醒', text: '询盘进入批发语境时，建议优先使用阶梯报价和 MOQ 解释模板。' },
  { label: '留存动作', text: '60 天未互动老客适合按历史品类分层唤醒，先触达高客单客户。' },
];

const actionItems = [
  {
    title: '生成本周经营优先级',
    desc: '让策略专家把市场、产品和渠道动作排成一张执行表。',
    agent: 'strategy' as const,
    task: '诊断当前经营状态，输出今日异常、机会、待确认动作和本周优先级。',
  },
  {
    title: '拆 5 条热点素材脚本',
    desc: '让社媒流量围绕当前素材库提炼可发布脚本。',
    agent: 'traffic' as const,
    task: '基于当前素材库，筛选 5 个值得跟进的美妆内容角度，并生成短视频脚本。',
  },
  {
    title: '整理老客唤醒批次',
    desc: '让留存专家先处理最近 60 天未互动客户。',
    agent: 'retention' as const,
    task: '筛选最近 60 天未互动老客，生成分层唤醒计划和 WhatsApp 文案。',
  },
];

export default function BusinessDiagnosisModal({ open, session, onClose, onDismissToday, onNavigate, onAction }: Props) {
  const [expanded, setExpanded] = useState(false);
  const company = session.tenant?.name || session.user.name || '你的企业';

  const runAction = (agent: Parameters<NonNullable<Props['onAction']>>[0], task: string) => {
    onAction?.(agent, task);
    onClose();
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/35 px-5 py-6 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16, ease: 'easeOut' }}
        >
          <motion.section
            layoutId="business-diagnosis-surface"
            initial={{ opacity: 0.88, scale: 0.985 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0.92, scale: 0.985 }}
            transition={{
              layout: { type: 'spring', damping: 30, stiffness: 360, mass: 0.8 },
              opacity: { duration: 0.12, ease: 'easeOut' },
              scale: { duration: 0.16, ease: 'easeOut' },
            }}
            className={`flex max-h-[88vh] flex-col overflow-hidden rounded-2xl border border-border bg-white shadow-2xl ${expanded ? 'h-[calc(100vh-48px)] w-[calc(100vw-48px)]' : 'w-full max-w-4xl'}`}
          >
            <header className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-green-50 text-green-700">
                    <Sparkles size={16} />
                  </span>
                  <div>
                    <p className="text-xs font-semibold text-text-muted">经营诊断</p>
                    <h2 className="text-lg font-bold text-text-primary">经营状态日报</h2>
                  </div>
                </div>
                <p className="mt-2 text-sm text-text-muted">{company} · 今日异常、机会、任务和待确认动作</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onDismissToday}
                  className="h-8 rounded-lg border border-border px-3 text-xs font-semibold text-text-muted hover:bg-surface-2 hover:text-text-primary"
                >
                  今日不再出现
                </button>
                <button
                  type="button"
                  onClick={() => setExpanded(v => !v)}
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-text-muted hover:bg-surface-2 hover:text-text-primary"
                  title={expanded ? '退出全屏' : '展开全屏'}
                >
                  {expanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-text-muted hover:bg-surface-2 hover:text-text-primary"
                  title="关闭"
                >
                  <X size={16} />
                </button>
              </div>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
              <div className="grid grid-cols-4 gap-3">
                <div className="rounded-xl border border-border bg-surface p-4">
                  <div className="flex items-center gap-2 text-xs text-text-muted">
                    <AlertTriangle size={14} className="text-green-600" />
                    今日异常
                  </div>
                  <p className="mt-3 text-2xl font-bold text-text-primary">0</p>
                  <p className="mt-1 text-xs leading-relaxed text-text-muted">暂无需要立即阻断处理的经营异常。</p>
                </div>
                <div className="rounded-xl border border-border bg-surface p-4">
                  <div className="flex items-center gap-2 text-xs text-text-muted">
                    <TrendingUp size={14} className="text-emerald-600" />
                    今日机会
                  </div>
                  <p className="mt-3 text-2xl font-bold text-text-primary">4</p>
                  <p className="mt-1 text-xs leading-relaxed text-text-muted">批发询盘、热点素材、市场增长和老客唤醒均可推进。</p>
                </div>
                <div className="rounded-xl border border-border bg-surface p-4">
                  <div className="flex items-center gap-2 text-xs text-text-muted">
                    <Clock3 size={14} className="text-blue-600" />
                    待处理任务
                  </div>
                  <p className="mt-3 text-2xl font-bold text-text-primary">5</p>
                  <p className="mt-1 text-xs leading-relaxed text-text-muted">含内容采集、素材分析和客户唤醒动作。</p>
                </div>
                <div className="rounded-xl border border-border bg-surface p-4">
                  <div className="flex items-center gap-2 text-xs text-text-muted">
                    <CheckCircle2 size={14} className="text-green-600" />
                    可推进动作
                  </div>
                  <p className="mt-3 text-2xl font-bold text-text-primary">3</p>
                  <p className="mt-1 text-xs leading-relaxed text-text-muted">策略复盘、素材脚本、老客唤醒均可立即推进。</p>
                </div>
              </div>

              <div className="mt-5 grid grid-cols-[minmax(0,1.1fr)_minmax(280px,0.9fr)] gap-4">
                <section className="rounded-2xl border border-border bg-white p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-bold text-text-primary">待确认动作</h3>
                      <p className="mt-0.5 text-xs text-text-muted">确认后直接交给对应专家执行。</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => { onNavigate('scheduled'); onClose(); }}
                      className="text-xs font-semibold text-green-700"
                    >
                      查看任务
                    </button>
                  </div>
                  <div className="mt-3 space-y-2">
                    {actionItems.map(item => (
                      <button
                        key={item.title}
                        type="button"
                        onClick={() => runAction(item.agent, item.task)}
                        className="flex w-full items-start gap-3 rounded-xl border border-border bg-surface px-3 py-3 text-left transition-colors hover:border-green-200 hover:bg-green-50/60"
                      >
                        <span className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-white text-green-700 shadow-sm">
                          <Target size={14} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-semibold text-text-primary">{item.title}</span>
                          <span className="mt-1 block text-xs leading-relaxed text-text-muted">{item.desc}</span>
                        </span>
                        <ArrowRight size={14} className="mt-1 text-text-muted" />
                      </button>
                    ))}
                  </div>
                </section>

                <section className="rounded-2xl border border-border bg-white p-4">
                  <h3 className="text-sm font-bold text-text-primary">AI 发现</h3>
                  <div className="mt-3 space-y-2">
                    {discoveries.map(item => (
                      <div key={item.label} className="rounded-xl border border-border bg-surface px-3 py-3">
                        <p className="text-xs font-semibold text-green-700">{item.label}</p>
                        <p className="mt-1 text-xs leading-relaxed text-text-secondary">{item.text}</p>
                      </div>
                    ))}
                  </div>
                </section>
              </div>

              <section className="mt-5 rounded-2xl border border-border bg-surface p-4">
                <h3 className="text-sm font-bold text-text-primary">机会线索</h3>
                <div className="mt-3 grid grid-cols-3 gap-3">
                  {opportunities.map(item => (
                    <button
                      key={item}
                      type="button"
                      onClick={() => runAction('strategy', `请围绕「${item}」做经营诊断，输出机会判断、风险和下一步动作。`)}
                      className="rounded-xl border border-border bg-white px-3 py-3 text-left text-xs font-semibold text-text-secondary transition-colors hover:border-green-200 hover:text-green-700"
                    >
                      {item}
                    </button>
                  ))}
                </div>
              </section>
            </div>
          </motion.section>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
