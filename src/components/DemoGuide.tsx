import { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { Check, Sparkles } from 'lucide-react';
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
    body: '去转化专家看看私域、询盘、报价话术是怎么被自动整理和推进的。',
    target: 'conversion',
    page: 'conversion',
  },
  {
    id: 'retention',
    title: '第五步 创建老客唤醒',
    body: '去留存专家体验老客分层、复购触达和唤醒节奏。',
    target: 'retention',
    page: 'retention',
  },
  {
    id: 'scheduler',
    title: '第六步 查看自动任务',
    body: '去定时任务里任选一个任务执行或进入页面，看看 Agent 如何沉淀周期性工作。',
    target: 'scheduled',
    page: 'scheduled',
  },
  {
    id: 'automation_workflow',
    title: '第七步 体验自动化工作流',
    body: '在定时任务详情里点击一条“去某某专家”，我会带着任务上下文自动跳到对应 Agent。',
    target: 'scheduled',
    page: 'scheduled',
  },
];

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
    const timer = window.setTimeout(update, 80);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
      window.clearTimeout(timer);
    };
  }, [target, tick]);

  return rect;
}

export default function DemoGuide({ onNavigate }: { onNavigate: (p: Page) => void }) {
  const [done, setDone] = useState<Record<string, boolean>>(readDemoProgress);
  const [tick, setTick] = useState(0);
  const current = useMemo(() => STEPS.find(step => !done[step.id]) ?? STEPS[STEPS.length - 1], [done]);
  const rect = useTargetRect(current.target, tick);
  const completedCount = STEPS.filter(step => done[step.id]).length;

  useEffect(() => {
    const sync = () => {
      setDone(readDemoProgress());
      setTick(value => value + 1);
    };
    const onCustom = (event: Event) => {
      setDone((event as CustomEvent<Record<string, boolean>>).detail ?? readDemoProgress());
      setTick(value => value + 1);
    };
    window.addEventListener('storage', sync);
    window.addEventListener(DEMO_PROGRESS_EVENT, onCustom);
    return () => {
      window.removeEventListener('storage', sync);
      window.removeEventListener(DEMO_PROGRESS_EVENT, onCustom);
    };
  }, []);

  const go = () => {
    onNavigate(current.page);
    window.setTimeout(() => setTick(value => value + 1), 120);
  };

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
              <p className="text-xs text-text-muted mt-1.5 leading-relaxed">{current.title}</p>
            </div>
          </div>

          <p className="text-xs text-text-secondary mt-4 leading-relaxed">{current.body}</p>

          <div className="flex items-center justify-between gap-3 mt-4">
            <span className="text-[11px] text-text-muted">{completedCount}/{STEPS.length} 已体验</span>
            <button
              type="button"
              onClick={go}
              className="h-8 px-4 rounded-lg text-xs font-semibold text-white flex-shrink-0"
              style={{ background: '#16a34a' }}
            >
              带我去
            </button>
          </div>

          {completedCount === STEPS.length && (
            <div className="mt-3 flex items-center gap-1.5 rounded-lg bg-green-50 px-2.5 py-2 text-[11px] text-green-700">
              <Check size={12} /> 已完成主要体验，可以自由探索了。
            </div>
          )}
        </div>
      </motion.div>
    </>
  );
}
