import { type ReactNode, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Compass, Zap, MessageSquare, RefreshCw,
  Building2, PlugZap, Clock, ShoppingCart,
  ChevronRight, Plus, LogOut, Loader2, RefreshCcw, X, ShieldCheck,
} from 'lucide-react';
import type { Page, ConversationContext, Conversation, AgentAction } from '../App';
import { authApi, type AuthSession } from '../lib/auth';
import RightPanel from './RightPanel';
import DemoGuide from './DemoGuide';

interface NavSection {
  items: { id: Page; label: string; icon: ReactNode }[];
}

const PRIMARY_NAV: NavSection = {
  items: [
    { id: 'strategy',   label: '策略专家', icon: <Compass size={16} /> },
    { id: 'traffic',    label: '社媒流量', icon: <Zap size={16} /> },
    { id: 'conversion', label: '转化专家', icon: <MessageSquare size={16} /> },
    { id: 'retention',  label: '留存专家', icon: <RefreshCw size={16} /> },
    { id: 'orders',     label: '我的订单', icon: <ShoppingCart size={16} /> },
  ],
};

const SECONDARY_NAV: NavSection = {
  items: [
    { id: 'enterprise', label: '企业中心', icon: <Building2 size={16} /> },
    { id: 'plugins',    label: '集成中心', icon: <PlugZap size={16} /> },
    { id: 'scheduled',  label: '定时任务', icon: <Clock size={16} /> },
  ],
};

const AGENT_COLORS: Record<string, string> = {
  strategy: '#4f46e5',
  traffic:  '#16a34a',
  conversion: '#0891b2',
  retention: '#16a34a',
};

interface LayoutProps {
  page: Page;
  onNavigate: (p: Page) => void;
  conversation: ConversationContext | null;
  children: ReactNode;
  session?: import('../lib/auth').AuthSession | null;
  onLogout?: () => void;
  conversations?: Conversation[];
  activeConvId?: string | null;
  onOpenConversation?: (id: string) => void;
  onNewConversation?: () => void;
  suppressRightPanel?: boolean;
  onAction?: AgentAction;
  onSessionUpdate?: (session: AuthSession | null) => void;
  demoGuideActive?: boolean;
  onDemoGuideShown?: () => void;
}

const relTime = (ts: number) => {
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 1) return '刚刚';
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  return `${Math.floor(h / 24)} 天前`;
};

const SUB_LABEL: Record<string, string> = {
  trialing: '试用中', active: '已订阅', past_due: '续费逾期', canceled: '已取消', expired: '已过期', none: '未订阅',
};

function NavItem({
  item,
  active,
  onClick,
}: {
  item: { id: Page; label: string; icon: ReactNode };
  active: boolean;
  onClick: () => void;
}) {
  return (
    <motion.button
      whileTap={{ scale: 0.97 }}
      onClick={onClick}
      data-demo-target={item.id}
      className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium transition-colors cursor-pointer relative"
      style={
        active
          ? { background: '#ffffff', color: '#0f172a', boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }
          : { color: '#64748b' }
      }
    >
      {active && (
        <motion.span
          layoutId="nav-active"
          className="absolute inset-0 rounded-xl"
          style={{ background: '#ffffff', boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}
          transition={{ type: 'spring', damping: 30, stiffness: 350 }}
        />
      )}
      <span className="relative flex-shrink-0" style={{ color: active ? 'var(--color-accent)' : undefined }}>
        {item.icon}
      </span>
      <span className="relative flex-1 text-left">{item.label}</span>
      {active && (
        <ChevronRight size={13} className="relative flex-shrink-0" style={{ color: '#94a3b8' }} />
      )}
    </motion.button>
  );
}

const formatTokens = (value?: number | null) => {
  const n = Math.max(0, Math.floor(Number(value ?? 0)));
  return n.toLocaleString('en-US');
};

const pct = (used?: number, limit?: number) => {
  const cap = Math.max(0, Number(limit ?? 0));
  if (!cap) return 0;
  return Math.min(100, Math.max(0, (Number(used ?? 0) / cap) * 100));
};

const byToken = (tokens: number, reserve: number) => Math.max(0, Math.floor(tokens / reserve));
const isAdminSession = (session?: AuthSession | null) => (
  session?.user?.email === 'lingshu-admin@local.test' ||
  session?.tenant?.subscriptionPlan === 'admin' ||
  session?.subscription?.plan === 'admin'
);

export default function Layout({ page, onNavigate, conversation, children, session, onLogout, conversations, activeConvId, onOpenConversation, onNewConversation, suppressRightPanel, onAction, onSessionUpdate, demoGuideActive, onDemoGuideShown }: LayoutProps) {
  const recent = (conversations ?? []).filter(c => c.messages.length > 0);
  const isInConversation = conversation !== null && !suppressRightPanel;
  const [quotaOpen, setQuotaOpen] = useState(false);
  const [quotaLoading, setQuotaLoading] = useState(false);
  const [quotaUpdatedAt, setQuotaUpdatedAt] = useState<number | null>(null);
  const [liveSession, setLiveSession] = useState<AuthSession | null>(null);
  const sessionScope = session?.demo?.guideScope || session?.demo?.expiresAt || null;
  const liveSessionScope = liveSession?.demo?.guideScope || liveSession?.demo?.expiresAt || null;
  const activeSession = liveSession?.user?.id === session?.user?.id && liveSessionScope === sessionScope ? liveSession : session;
  const guideScope = activeSession?.demo?.guideScope || (activeSession?.demo?.expiresAt ? `${activeSession.user.id}:${activeSession.demo.expiresAt}` : activeSession?.user?.id || 'demo-guide');

  useEffect(() => {
    setLiveSession(null);
  }, [session?.user?.id, sessionScope]);
  const secondaryItems = isAdminSession(activeSession)
    ? [...SECONDARY_NAV.items, { id: 'admin' as Page, label: '账号总控', icon: <ShieldCheck size={16} /> }]
    : SECONDARY_NAV.items;
  const tenantName = activeSession?.tenant?.name || activeSession?.user?.name || activeSession?.user?.email?.split('@')[0] || '未命名';
  const subStatus = activeSession?.tenant?.subscriptionStatus || activeSession?.subscription?.status || 'none';
  const initial = (tenantName[0] || '灵').toUpperCase();
  const demo = activeSession?.demo;
  const remainingTokens = Math.max(0, Math.min(
    demo?.remaining?.tokens ?? demo?.limits?.tokenDaily ?? 0,
    demo?.totalRemaining?.tokens ?? demo?.limits?.tokenTotal ?? Number.POSITIVE_INFINITY,
  ));
  const tokenLabel = remainingTokens >= 1000 ? `${Math.floor(remainingTokens / 1000)}k` : String(remainingTokens);
  const suggestedChats = Math.min(demo?.remaining.aiChat ?? 0, byToken(remainingTokens, 1600));
  const suggestedGenerations = Math.min(demo?.remaining.generation ?? 0, byToken(remainingTokens, 1200));
  const suggestedVideoJobs = Math.min(demo?.totalRemaining?.videoGeneration ?? demo?.remaining.videoGeneration ?? 0, byToken(remainingTokens, 2000));
  const suggestedVideoSeconds = suggestedVideoJobs * 8;
  const suggestedAiVideoAnalyses = Math.min(suggestedGenerations, byToken(remainingTokens, 1200));
  const isTrialAccount = Boolean(
    activeSession?.demo ||
    activeSession?.tenant?.subscriptionPlan === 'trial' ||
    activeSession?.subscription?.plan === 'trial' ||
    subStatus === 'trialing'
  );
  const showDemoGuide = Boolean(demoGuideActive && (activeSession?.demo?.enabled || isTrialAccount));
  const refreshQuota = async () => {
    setQuotaLoading(true);
    try {
      const latest = await authApi.me();
      setLiveSession(latest);
      onSessionUpdate?.(latest);
      setQuotaUpdatedAt(Date.now());
    } finally {
      setQuotaLoading(false);
    }
  };
  const openQuota = () => {
    setQuotaOpen(true);
    void refreshQuota();
  };

  return (
    <div className="flex h-screen overflow-hidden">

      {/* ── Left sidebar ─────────────────────────────── */}
      <aside
        className="w-[220px] flex-shrink-0 flex flex-col border-r border-border"
        style={{ background: '#f2f3f5' }}
      >
        {/* Logo */}
        <div className="h-14 flex items-center px-4 gap-2.5 flex-shrink-0">
          <img src="/brand-logo.png" alt="灵枢 AI" className="w-7 h-7 object-contain flex-shrink-0" />
          <span className="text-sm font-bold text-text-primary font-display">灵枢 AI</span>
        </div>

        {showDemoGuide && (
          <DemoGuide
            key={guideScope}
            page={page}
            onNavigate={onNavigate}
            onShown={onDemoGuideShown}
            forceStart={Boolean(activeSession?.demo?.guideTrigger)}
          />
        )}

        {/* Primary nav */}
        <nav className="px-3 space-y-0.5">
          <p className="px-3 pt-1 pb-1.5 text-[10px] font-semibold text-text-muted uppercase tracking-wider">
            业务中台
          </p>
          {PRIMARY_NAV.items.map(item => (
            <NavItem
              key={item.id}
              item={item}
              active={page === item.id}
              onClick={() => onNavigate(item.id)}
            />
          ))}
        </nav>

        {/* Divider */}
        <div className="mx-4 my-3 border-t border-border" />

        {/* Secondary nav */}
        <nav className="px-3 space-y-0.5">
          <p className="px-3 pb-1.5 text-[10px] font-semibold text-text-muted uppercase tracking-wider">
            系统设置
          </p>
          {secondaryItems.map(item => (
            <NavItem
              key={item.id}
              item={item}
              active={page === item.id}
              onClick={() => onNavigate(item.id)}
            />
          ))}
        </nav>

        {/* Divider */}
        <div className="mx-4 my-3 border-t border-border" />

        {/* Recent conversations */}
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          <div className="px-3 flex items-center justify-between mb-1.5 flex-shrink-0">
            <p className="px-3 text-[10px] font-semibold text-text-muted uppercase tracking-wider">近期会话</p>
            <button onClick={() => onNewConversation?.()} title="新建会话"
              className="p-1 rounded-md hover:bg-black/5 text-text-muted transition-colors">
              <Plus size={12} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-3 space-y-0.5 pb-2">
            {recent.length === 0 && (
              <p className="px-3 py-2 text-[11px] text-text-muted leading-relaxed">还没有会话，去和某位专家对话后会出现在这里。</p>
            )}
            {recent.map(conv => (
              <button
                key={conv.id}
                onClick={() => onOpenConversation?.(conv.id)}
                className="w-full flex items-start gap-2.5 px-3 py-2 rounded-xl text-left transition-colors group"
                style={conv.id === activeConvId ? { background: 'rgba(255,255,255,0.8)' } : undefined}
              >
                <span
                  className="mt-0.5 w-2 h-2 rounded-full flex-shrink-0"
                  style={{ background: AGENT_COLORS[conv.agent] }}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-text-secondary truncate leading-snug group-hover:text-text-primary transition-colors">
                    {conv.title}
                  </p>
                  <p className="text-[10px] text-text-muted mt-0.5">{relTime(conv.updatedAt)}</p>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Bottom user */}
        <div className="relative px-3 py-3 border-t border-border flex-shrink-0">
          <AnimatePresence>
            {quotaOpen && (
              <motion.div
                initial={{ opacity: 0, y: 8, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.98 }}
                transition={{ duration: 0.16 }}
                className="absolute left-3 bottom-[68px] w-[324px] rounded-2xl bg-white border border-border shadow-xl p-3 z-30"
              >
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div>
                    <p className="text-xs font-bold text-text-primary">Token 使用</p>
                    <p className="text-[10px] text-text-muted mt-0.5">
                      {quotaUpdatedAt ? `${relTime(quotaUpdatedAt)}刷新` : '打开时自动刷新'}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => void refreshQuota()} disabled={quotaLoading} title="刷新额度"
                      className="p-1.5 rounded-lg hover:bg-surface-2 text-text-muted hover:text-text-primary transition-colors disabled:opacity-60">
                      {quotaLoading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCcw size={13} />}
                    </button>
                    <button onClick={() => setQuotaOpen(false)} title="关闭"
                      className="p-1.5 rounded-lg hover:bg-surface-2 text-text-muted hover:text-text-primary transition-colors">
                      <X size={13} />
                    </button>
                  </div>
                </div>

                {demo && isTrialAccount ? (
                  <div className="space-y-3">
                    <div className="rounded-xl bg-surface-2 border border-border px-3 py-2.5">
                      <div className="flex items-baseline justify-between">
                        <span className="text-[11px] font-semibold text-text-secondary">剩余 Token</span>
                        <span className="text-lg font-bold text-text-primary">{formatTokens(remainingTokens)}</span>
                      </div>
                      <div className="mt-2 h-1.5 rounded-full bg-white overflow-hidden border border-border">
                        <div
                          className="h-full rounded-full bg-accent"
                          style={{ width: `${pct(demo.usage.tokens, demo.limits.tokenDaily)}%` }}
                        />
                      </div>
                      <div className="mt-2 grid grid-cols-2 gap-2 text-[10px]">
                        <div>
                          <p className="text-text-muted">今日已用</p>
                          <p className="font-bold text-text-primary">{formatTokens(demo.usage.tokens)} / {formatTokens(demo.limits.tokenDaily)}</p>
                        </div>
                        <div>
                          <p className="text-text-muted">总计已用</p>
                          <p className="font-bold text-text-primary">{formatTokens(demo.totalUsage?.tokens)} / {formatTokens(demo.limits.tokenTotal)}</p>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-xl bg-white border border-border px-3 py-2.5">
                      <p className="text-[11px] font-bold text-text-primary mb-2">建议可用量</p>
                      <div className="space-y-1.5 text-[10px] text-text-secondary">
                        <div className="flex items-center justify-between gap-3">
                          <span>顾问对话</span>
                          <span className="font-bold text-text-primary">约 {suggestedChats} 轮</span>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <span>脚本/文案/选材生成</span>
                          <span className="font-bold text-text-primary">约 {suggestedGenerations} 次</span>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <span>视频爬取</span>
                          <span className="font-bold text-text-primary">YouTube 不吃 token</span>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <span>爆款视频抓取</span>
                          <span className="font-bold text-text-primary">建议轻量爬取</span>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <span>视频 AI 分析</span>
                          <span className="font-bold text-text-primary">约 {suggestedAiVideoAnalyses} 条</span>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <span>AI 视频生成</span>
                          <span className="font-bold text-text-primary">约 {suggestedVideoJobs} 条 / {suggestedVideoSeconds} 秒</span>
                        </div>
                      </div>
                      <p className="mt-2 text-[9px] leading-relaxed text-text-muted">
                        估算按短对话 1.6k、普通生成 1.2k、视频生成 2k token 预留；爆款视频抓取 token 消耗大，建议轻量爬取。
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      {[
                        ['对话', demo.remaining.aiChat, demo.limits.aiChatDaily],
                        ['普通生成', demo.remaining.generation, demo.limits.generationDaily],
                        ['预览渲染', demo.remaining.render, demo.limits.renderDaily],
                        ['视频生成', demo.totalRemaining?.videoGeneration ?? demo.remaining.videoGeneration ?? 0, demo.limits.videoGenerationDaily],
                      ].map(([label, left, limit]) => (
                        <div key={String(label)} className="rounded-xl border border-border bg-white px-2.5 py-2">
                          <p className="text-[10px] text-text-muted">{label}</p>
                          <p className="mt-0.5 text-sm font-bold text-text-primary">{left}<span className="text-[10px] font-medium text-text-muted"> / {limit}</span></p>
                        </div>
                      ))}
                    </div>

                    <div className="flex items-center justify-between rounded-xl bg-accent-glow px-3 py-2">
                      <span className="text-[10px] font-semibold text-text-secondary">试用状态</span>
                      <span className={`text-[10px] font-bold ${demo.expired ? 'text-red-600' : 'text-accent'}`}>
                        {demo.expired ? '已到期' : `剩余 ${demo.daysRemaining ?? '-'} 天`}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl bg-surface-2 border border-border px-3 py-3">
                    <p className="text-xs font-semibold text-text-primary">暂未读取到额度</p>
                    <p className="text-[10px] text-text-muted mt-1">点击刷新按钮重新读取测试版账号额度。</p>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
          <div className="flex items-center gap-2.5">
            <button
              onClick={openQuota}
              title="查看 Token 使用"
              className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
              style={{ background: 'linear-gradient(135deg, #4ade80, #16a34a)' }}
            >
              {initial}
            </button>
            <button onClick={openQuota} className="flex-1 min-w-0 text-left rounded-lg -my-1 py-1 hover:bg-black/5 transition-colors">
              <p className="text-xs font-semibold text-text-primary truncate">{tenantName}</p>
              <p className="text-[10px] text-text-muted truncate">
                {demo && isTrialAccount ? `Token 剩余 ${tokenLabel}` : (SUB_LABEL[subStatus] ?? subStatus)}
              </p>
            </button>
            {onLogout && (
              <button onClick={onLogout} title="退出登录"
                className="relative p-1 rounded-md hover:bg-black/5 text-text-muted hover:text-text-primary transition-colors flex-shrink-0">
                <LogOut size={13} />
              </button>
            )}
          </div>
        </div>
      </aside>

      {/* ── Main content ─────────────────────────────── */}
      <main className="flex-1 min-w-0 overflow-hidden bg-white flex flex-col">
        {children}
      </main>

      {/* ── Right panel (only in conversation mode) ── */}
      <AnimatePresence>
        {isInConversation && (
          <motion.aside
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 272, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="flex-shrink-0 bg-white flex flex-col overflow-hidden"
            style={{ boxShadow: '-6px 0 24px rgba(0,0,0,0.06)' }}
          >
            <RightPanel conversation={conversation} onAction={onAction} />
          </motion.aside>
        )}
      </AnimatePresence>
    </div>
  );
}
