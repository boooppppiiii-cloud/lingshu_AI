import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { motion } from 'motion/react';
import { Sparkles } from 'lucide-react';
import type { Page } from '../App';
import { DEMO_PROGRESS_EVENT, readDemoProgress, type DemoStepId } from '../lib/demoProgress';

interface GuideStep {
  id: DemoStepId;
  title: string;
  body: string;
  target: string;
  page: Page;
}

const STEPS: GuideStep[] = [
  {
    id: 'template',
    title: '第一步 加载企业模版',
    body: '先点击被高亮的加载按钮，我会把测试号行业资料注入企业中心，让后面的 Agent 更懂你的业务。',
    target: 'template',
    page: 'enterprise',
  },
  {
    id: 'strategy',
    title: '第二步 获取策略建议',
    body: '点击页面中高亮的问题卡片，让策略专家先帮你把目标市场、产品和增长动作串起来。',
    target: 'strategy_prompt',
    page: 'strategy',
  },
  {
    id: 'traffic',
    title: '第三步 生成脚本',
    body: '在流量专家里点击高亮的生成按钮，体验一次爆款素材脚本生成。生成后我会直接带你进入第四步。',
    target: 'traffic_script_generate',
    page: 'traffic',
  },
  {
    id: 'conversion',
    title: '第四步 处理模拟询盘',
    body: '点击高亮按钮，让转化专家接手一条模拟询盘，看看报价话术如何被自动整理和推进。',
    target: 'conversion_reply',
    page: 'conversion',
  },
  {
    id: 'retention',
    title: '第五步 创建老客唤醒',
    body: '点击高亮的问题卡片，让留存专家生成老客分层、复购触达和唤醒节奏。',
    target: 'retention_prompt',
    page: 'retention',
  },
  {
    id: 'scheduler',
    title: '第六步 创建自动任务',
    body: '从 0 新建一个每天 01:00 的视频采集定时任务，不需要立即执行真实爬虫。',
    target: 'scheduled_run',
    page: 'scheduled',
  },
  {
    id: 'automation_workflow',
    title: '第七步 体验自动化工作流',
    body: '在定时任务详情里点击一条“去某某专家”，我会带着任务上下文自动跳到对应 Agent。',
    target: 'automation_workflow_agent',
    page: 'scheduled',
  },
];

const CONFETTI_COLORS = ['#16a34a', '#22c55e', '#0ea5e9', '#f59e0b', '#ef4444', '#8b5cf6', '#14b8a6', '#f97316'];

function useTargetRect(target: string, tick: number) {
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    const update = () => {
      const el = document.querySelector(`[data-demo-target="${target}"]`);
      setRect(el ? el.getBoundingClientRect() : null);
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    const observer = new MutationObserver(update);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-demo-target'] });
    const timer = window.setTimeout(update, 80);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
      observer.disconnect();
      window.clearTimeout(timer);
    };
  }, [target, tick]);

  return rect;
}

export default function DemoGuide({ page, onNavigate, onShown, forceStart }: { page: Page; onNavigate: (p: Page) => void; onShown?: () => void; forceStart?: boolean }) {
  const [done, setDone] = useState<Record<string, boolean>>(() => forceStart ? {} : readDemoProgress());
  const [showCelebration, setShowCelebration] = useState(false);
  const wasCompleteRef = useRef(STEPS.every(step => readDemoProgress()[step.id]));
  const didNotifyShownRef = useRef(false);
  const [tick, setTick] = useState(0);
  const current = useMemo(() => STEPS.find(step => !done[step.id]) ?? STEPS[STEPS.length - 1], [done]);
  const currentStepIndex = STEPS.findIndex(step => step.id === current.id);
  const rect = useTargetRect(current.target, tick);
  const completedCount = STEPS.filter(step => done[step.id]).length;
  const isComplete = completedCount === STEPS.length;
  const confetti = useMemo(() => Array.from({ length: 72 }, (_, index) => ({
    id: index,
    left: `${(index * 37) % 100}%`,
    delay: `${(index % 12) * 0.08}s`,
    duration: `${4.8 + (index % 8) * 0.24}s`,
    color: CONFETTI_COLORS[index % CONFETTI_COLORS.length],
    rotate: `${(index * 23) % 180}deg`,
    size: 6 + (index % 4) * 2,
    drift: ((index * 29) % 180) - 90,
  })), []);

  useEffect(() => {
    if (!didNotifyShownRef.current) {
      didNotifyShownRef.current = true;
      onShown?.();
    }
    const applyProgress = (next: Record<string, boolean>) => {
      const nextComplete = STEPS.every(step => next[step.id]);
      if (nextComplete && !wasCompleteRef.current) {
        setShowCelebration(true);
        window.setTimeout(() => setShowCelebration(false), 7200);
      }
      wasCompleteRef.current = nextComplete;
      setDone(next);
      setTick(value => value + 1);
    };
    const sync = () => {
      applyProgress(readDemoProgress());
    };
    const onCustom = (event: Event) => {
      applyProgress((event as CustomEvent<Record<string, boolean>>).detail ?? readDemoProgress());
    };
    window.addEventListener('storage', sync);
    window.addEventListener(DEMO_PROGRESS_EVENT, onCustom);
    return () => {
      window.removeEventListener('storage', sync);
      window.removeEventListener(DEMO_PROGRESS_EVENT, onCustom);
    };
  }, [onShown]);

  useEffect(() => {
    if (isComplete || current.page === page) return;
    const timer = window.setTimeout(() => {
      onNavigate(current.page);
      setTick(value => value + 1);
    }, 260);
    return () => window.clearTimeout(timer);
  }, [current.id, current.page, isComplete, onNavigate, page]);

  const go = () => {
    onNavigate(current.page);
    window.setTimeout(() => setTick(value => value + 1), 120);
  };

  if (isComplete) {
    return showCelebration ? (
      <div className="fixed inset-0 z-[90] pointer-events-none overflow-hidden bg-slate-950/18 backdrop-blur-[1px]">
        {confetti.map(piece => (
          <span
            key={piece.id}
            className="absolute -top-10 rounded-[2px]"
            style={{
              left: piece.left,
              width: piece.size,
              height: piece.size * 1.8,
              background: piece.color,
              transform: `rotate(${piece.rotate})`,
              animation: `demo-confetti-fall ${piece.duration} ${piece.delay} cubic-bezier(.18,.72,.28,.98) forwards`,
              '--drift': `${piece.drift}px`,
            } as CSSProperties}
          />
        ))}
        <motion.div
          initial={{ opacity: 0, scale: 0.92, y: 16 }}
          animate={{ opacity: 1, scale: [0.92, 1.04, 1], y: 0 }}
          exit={{ opacity: 0, scale: 0.96 }}
          transition={{ duration: 0.72, times: [0, 0.58, 1], ease: 'easeOut' }}
          className="absolute inset-0 flex items-center justify-center px-6"
        >
          <div className="max-w-[560px] rounded-[8px] border border-white/60 bg-white/94 px-8 py-7 text-center shadow-2xl">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-green-50 text-green-600">
              <Sparkles size={22} />
            </div>
            <p className="text-2xl font-bold text-slate-950 leading-snug">
              现在你已经了解灵枢AI啦，一起加油吧～
            </p>
          </div>
        </motion.div>
        <style>{`
          @keyframes demo-confetti-fall {
            0% { transform: translate3d(0, -12vh, 0) rotate(0deg); opacity: 0; }
            8% { opacity: 1; }
            100% { transform: translate3d(var(--drift, 0), 112vh, 0) rotate(720deg); opacity: 0.95; }
          }
        `}</style>
      </div>
    ) : null;
  }

  return (
    <>
      {rect && (
        <div
          className="fixed z-[70] rounded-2xl pointer-events-none transition-all duration-200"
          style={{
            left: rect.left - 6,
            top: rect.top - 6,
            width: rect.width + 12,
            height: rect.height + 12,
            boxShadow: '0 0 0 9999px rgba(15, 23, 42, 0.10), 0 0 0 3px rgba(34, 197, 94, 0.45), 0 14px 36px rgba(22, 163, 74, 0.28)',
          }}
        />
      )}

      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: -6 }}
        animate={{ opacity: 1, scale: [0.96, 1.025, 1], y: [-6, 0, 0] }}
        transition={{ duration: 0.55, times: [0, 0.62, 1], ease: 'easeOut' }}
        className="fixed bottom-6 left-4 w-[318px] max-w-[calc(100vw-32px)] rounded-2xl border border-green-100 bg-white shadow-lg overflow-visible z-[71]"
      >
        <div className="px-4 py-4">
          <div className="flex items-start gap-3">
            <span className="w-8 h-8 rounded-xl bg-green-50 text-green-600 flex items-center justify-center flex-shrink-0">
              <Sparkles size={14} />
            </span>
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-text-primary leading-relaxed">
                你好，我是灵枢AI，你的出海外贸助手，请多多指教！
              </p>
            </div>
          </div>

          <div className="mt-4">
            <p className="text-[15px] font-bold text-slate-900 leading-snug">{current.title}</p>
          </div>

          <p className="text-xs text-text-secondary mt-3 leading-relaxed">
            {current.page !== page ? '我正在带你进入对应页面，稍等一下。' : current.body}
          </p>

          <div className="flex items-center justify-between gap-3 mt-4">
            <span className="inline-flex items-center rounded-full bg-slate-50 px-2.5 py-1 text-[12px] font-bold text-slate-700">
              当前步骤 {currentStepIndex + 1}/{STEPS.length}
            </span>
            <button
              type="button"
              onClick={go}
              className="h-8 px-4 rounded-lg text-xs font-semibold text-white flex-shrink-0"
              style={{ background: '#16a34a' }}
            >
              带我去
            </button>
          </div>

        </div>
      </motion.div>
    </>
  );
}
