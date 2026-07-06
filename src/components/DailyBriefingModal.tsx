import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { BarChart3, CalendarDays, CheckCircle2, Lightbulb, Sparkles, Target, X } from 'lucide-react';
import { GAME_PROFILE_OPTIONS, type GameProfileId } from '../lib/gameProfiles';

const DAILY_BRIEFING_STORAGE_KEY = 'lingqi-daily-briefing-dismissed-date-v1';

type DailyBriefingModalProps = {
  gameProfileId: GameProfileId;
  canAccessWorkshop: boolean;
  onOpenBuyingDashboard: () => void;
  onOpenWorkshop: () => void;
};

function todayKey(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatToday(): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }).format(new Date());
}

function getProfileLabel(gameProfileId: GameProfileId): string {
  return GAME_PROFILE_OPTIONS.find((profile) => profile.id === gameProfileId)?.label ?? '当前游戏';
}

export default function DailyBriefingModal({
  gameProfileId,
  canAccessWorkshop,
  onOpenBuyingDashboard,
  onOpenWorkshop,
}: DailyBriefingModalProps) {
  const [open, setOpen] = useState(false);
  const today = useMemo(() => todayKey(), []);
  const profileLabel = getProfileLabel(gameProfileId);

  useEffect(() => {
    try {
      if (localStorage.getItem(DAILY_BRIEFING_STORAGE_KEY) === today) return;
    } catch {
      /* private mode */
    }
    const timer = window.setTimeout(() => setOpen(true), 480);
    return () => window.clearTimeout(timer);
  }, [today]);

  const close = () => {
    try {
      localStorage.setItem(DAILY_BRIEFING_STORAGE_KEY, today);
    } catch {
      /* private mode */
    }
    setOpen(false);
  };

  const openBuyingDashboard = () => {
    onOpenBuyingDashboard();
    close();
  };

  const openWorkshop = () => {
    onOpenWorkshop();
    close();
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[90] flex items-center justify-center p-4 sm:p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <button
            type="button"
            aria-label="关闭日报"
            className="absolute inset-0 cursor-default bg-slate-950/45 backdrop-blur-sm"
            onClick={close}
          />

          <motion.section
            role="dialog"
            aria-modal="true"
            aria-labelledby="daily-briefing-title"
            className="relative w-full max-w-3xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
            initial={{ opacity: 0, y: 18, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 18, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 360, damping: 30 }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={close}
              className="absolute right-4 top-4 z-10 rounded-lg p-2 text-slate-400 transition-colors hover:bg-white/80 hover:text-slate-700"
              aria-label="关闭日报"
            >
              <X className="h-5 w-5" />
            </button>

            <div className="grid gap-0 md:grid-cols-[0.9fr_1.1fr]">
              <div className="bg-primary-blue px-6 py-7 text-white sm:px-8">
                <div className="mb-8 flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/12">
                    <CalendarDays className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-white/60">{formatToday()}</p>
                    <p className="text-sm font-bold text-white">灵启 AI 开屏日报</p>
                  </div>
                </div>

                <h2 id="daily-briefing-title" className="text-2xl font-black leading-tight">
                  今日聚焦
                  <span className="mt-2 block text-accent-blue">先看趋势，再做创意</span>
                </h2>
                <p className="mt-5 text-sm leading-6 text-white/72">
                  当前版本：{profileLabel}。建议先扫竞品投放变化，再把可复用钩子沉淀进脚本与资产卡片。
                </p>

                <div className="mt-8 rounded-xl border border-white/10 bg-white/8 p-4">
                  <div className="flex items-center gap-2 text-sm font-bold">
                    <Sparkles className="h-4 w-4 text-accent-blue" />
                    今日动作建议
                  </div>
                  <p className="mt-2 text-xs leading-5 text-white/64">
                    重点看 3 秒开头、福利卖点和结尾引导，优先复用已经跑量的表达结构。
                  </p>
                </div>
              </div>

              <div className="px-6 py-7 sm:px-8">
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { label: '竞品榜单', value: '待巡检' },
                    { label: '钩子复盘', value: '优先级高' },
                    { label: '资产沉淀', value: '今日必做' },
                  ].map((item) => (
                    <div key={item.label} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <p className="text-[11px] font-semibold text-slate-400">{item.label}</p>
                      <p className="mt-1 text-sm font-black text-slate-900">{item.value}</p>
                    </div>
                  ))}
                </div>

                <div className="mt-6 space-y-3">
                  {[
                    {
                      icon: <BarChart3 className="h-4 w-4" />,
                      title: '买量大屏',
                      body: '先查看竞品 TOP 与追热梗版位，找出今天值得跟进的高频题材。',
                    },
                    {
                      icon: <Target className="h-4 w-4" />,
                      title: '钩子判断',
                      body: '记录 0-3 秒冲突、福利诱导、玩法爽点，避免只看完播不看开头。',
                    },
                    {
                      icon: <Lightbulb className="h-4 w-4" />,
                      title: '创意生产',
                      body: '把有效钩子带进灵光一闪或创意迭代，快速产出今天第一版脚本。',
                    },
                  ].map((item) => (
                    <div key={item.title} className="flex gap-3 rounded-xl border border-slate-200 p-4">
                      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-blue/10 text-accent-blue">
                        {item.icon}
                      </div>
                      <div>
                        <h3 className="text-sm font-black text-slate-900">{item.title}</h3>
                        <p className="mt-1 text-xs leading-5 text-slate-500">{item.body}</p>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                  <button type="button" onClick={openBuyingDashboard} className="btn-primary flex flex-1 items-center justify-center gap-2">
                    <BarChart3 className="h-4 w-4" />
                    打开买量大屏
                  </button>
                  {canAccessWorkshop && (
                    <button type="button" onClick={openWorkshop} className="btn-secondary flex flex-1 items-center justify-center gap-2">
                      <CheckCircle2 className="h-4 w-4" />
                      去做创意
                    </button>
                  )}
                </div>
              </div>
            </div>
          </motion.section>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
