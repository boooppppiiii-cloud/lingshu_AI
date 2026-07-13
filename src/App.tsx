import { Component, Suspense, useCallback, useEffect, useRef, useState, type ErrorInfo, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { BookOpen, Loader2 } from 'lucide-react';
import Layout from './components/Layout';
import AuthScreen from './components/AuthScreen';
import { authApi, type AuthSession } from './lib/auth';
import { completeDemoStep, setDemoProgressScope } from './lib/demoProgress';
import BusinessDiagnosisModal from './components/BusinessDiagnosisModal';
import GlobalAssistant from './components/GlobalAssistant';
import StrategyPage from './components/StrategyPage';
import TrafficPage from './components/TrafficPage';
import ConversionPage from './components/ConversionPage';
import OrderManagementPage from './components/OrderManagementPage';
import EnterprisePage from './components/EnterprisePage';
import IntegrationsPage from './components/IntegrationsPage';
import ScheduledPage from './components/ScheduledPage';
import AdminDashboard from './components/AdminDashboard';
import AdminDeliveryPage from './components/AdminDeliveryPage';
import AssistLinkPage from './components/AssistLinkPage';

export type Page =
  | 'strategy'
  | 'traffic'
  | 'conversion'
  | 'retention'
  | 'orders'
  | 'enterprise'
  | 'plugins'
  | 'scheduled'
  | 'admin'
  | 'adminDelivery'
  | 'channels'
  | 'youtube';

export type AgentType = 'strategy' | 'traffic' | 'conversion' | 'retention';

export interface Source { title: string; uri: string }
export interface Message {
  role: 'user' | 'assistant';
  content: string;
  sources?: Source[];
}

export interface ConversationContext {
  agent: AgentType;
  messages?: Message[];
}

export interface Conversation {
  id: string;
  agent: AgentType;
  title: string;
  messages: Message[];
  updatedAt: number;
}
export interface RestoreSignal { agent: AgentType; messages: Message[]; key: string }
export interface KickoffSignal { text: string; key: string }
export type AgentAction = (agent: AgentType, task: string) => void;

const AGENT_PAGES: Page[] = ['strategy', 'traffic', 'conversion', 'retention'];
const ALL_PAGES: Page[] = ['strategy', 'traffic', 'conversion', 'retention', 'orders', 'enterprise', 'plugins', 'scheduled', 'admin', 'adminDelivery', 'channels', 'youtube'];
const BUSINESS_DIAGNOSIS_SEEN_KEY = 'ow_business_diagnosis_seen_scope_v3';
const firstUserText = (msgs?: Message[]) => (msgs?.find(m => m.role === 'user')?.content ?? '新会话').slice(0, 24);
const customerUnifiedAgent = (agent: AgentType): AgentType => (agent === 'retention' ? 'conversion' : agent);
const loadConvs = (): Conversation[] => {
  try { return JSON.parse(localStorage.getItem('ow_convs') || '[]'); } catch { return []; }
};
const loadPage = (): Page => {
  try {
    if (window.location.pathname === '/admin/delivery') return 'adminDelivery';
    const saved = localStorage.getItem('ow_page') as Page | null;
    if (saved && !ALL_PAGES.includes(saved)) localStorage.removeItem('ow_page');
    return 'strategy';
  } catch { return 'strategy'; }
};

function PageLoading() {
  return (
    <div className="flex-1 min-h-0 flex items-center justify-center bg-white">
      <Loader2 size={20} className="animate-spin text-text-muted" />
    </div>
  );
}

function isChunkLoadError(error: unknown): boolean {
  const text = String(error instanceof Error ? `${error.name} ${error.message}` : error || '').toLowerCase();
  return text.includes('failed to fetch dynamically imported module') ||
    text.includes('loading chunk') ||
    text.includes('chunkloaderror') ||
    text.includes('importing a module script failed');
}

class PageErrorBoundary extends Component<
  { page: Page; onNavigateHome: () => void; children: ReactNode },
  { error: Error | null; resetKey: Page }
> {
  state = { error: null as Error | null, resetKey: this.props.page };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  static getDerivedStateFromProps(props: { page: Page }, state: { error: Error | null; resetKey: Page }) {
    if (props.page !== state.resetKey) return { error: null, resetKey: props.page };
    return null;
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[PageErrorBoundary]', error, info);
    if (!isChunkLoadError(error)) return;
    const retryKey = `ow_chunk_retry:${this.props.page}`;
    try {
      if (sessionStorage.getItem(retryKey)) return;
      sessionStorage.setItem(retryKey, '1');
      window.location.reload();
    } catch {
      window.location.reload();
    }
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex-1 min-h-0 flex items-center justify-center bg-white px-6">
        <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-6 text-center shadow-sm">
          <p className="text-sm font-bold text-text-primary">页面加载异常</p>
          <p className="mt-2 text-sm leading-relaxed text-text-muted">
            当前页面资源没有正确加载，请重新加载页面；如果仍然异常，可以先返回首页继续使用。
          </p>
          <div className="mt-5 flex items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-4 py-2 rounded-lg bg-text-primary text-white text-sm font-semibold"
            >
              重新加载
            </button>
            <button
              type="button"
              onClick={this.props.onNavigateHome}
              className="px-4 py-2 rounded-lg border border-border bg-white text-sm font-semibold text-text-secondary"
            >
              返回首页
            </button>
          </div>
        </div>
      </div>
    );
  }
}

export default function App() {
  if (window.location.pathname.startsWith('/assist/')) return <AssistLinkPage />;

  const [page, setPage] = useState<Page>(loadPage);
  const [conversation, setConversation] = useState<ConversationContext | null>(null);
  const [scriptPanelOpen, setScriptPanelOpen] = useState(false);

  // 会话历史（本地持久化，供全局助手恢复旧内容）
  const [conversations, setConversations] = useState<Conversation[]>(loadConvs);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [restore, setRestore] = useState<RestoreSignal | null>(null);
  const [kickoff, setKickoff] = useState<{ agent: AgentType; text: string; key: string } | null>(null);
  const convsRef = useRef<Conversation[]>(conversations);
  const activeIdRef = useRef<string | null>(null);
  const persist = (list: Conversation[]) => {
    convsRef.current = list; setConversations(list);
    try { localStorage.setItem('ow_convs', JSON.stringify(list.slice(0, 20))); } catch { /* ignore */ }
  };

  // 账号会话
  const [session, setSession] = useState<AuthSession | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [businessDiagnosisOpen, setBusinessDiagnosisOpen] = useState(false);
  const businessDiagnosisDocked = false;

  const progressScopeFor = (s: AuthSession | null) => s?.demo?.guideScope || (s?.demo?.expiresAt ? `${s.user.id}:${s.demo.expiresAt}` : s?.user?.id || s?.tenant?.id || null);
  const diagnosisScopeFor = (s: AuthSession | null) => s?.demo?.guideScope || s?.user?.id || s?.tenant?.id || 'guest';
  const showBusinessDiagnosisFor = (s: AuthSession | null) => {
    if (!s?.demo?.guideTrigger) return;
    const scope = diagnosisScopeFor(s);
    try {
      if (localStorage.getItem(BUSINESS_DIAGNOSIS_SEEN_KEY) === scope) return;
    } catch { /* ignore */ }
    setBusinessDiagnosisOpen(true);
  };
  const closeBusinessDiagnosis = () => {
    if (session) {
      try {
        localStorage.setItem(BUSINESS_DIAGNOSIS_SEEN_KEY, diagnosisScopeFor(session));
      } catch { /* ignore */ }
    }
    setBusinessDiagnosisOpen(false);
  };
  const dismissBusinessDiagnosisToday = () => {
    if (session) {
      try {
        localStorage.setItem(BUSINESS_DIAGNOSIS_SEEN_KEY, diagnosisScopeFor(session));
      } catch { /* ignore */ }
    }
    setBusinessDiagnosisOpen(false);
  };
  const reopenBusinessDiagnosis = () => setBusinessDiagnosisOpen(true);

  useEffect(() => {
    authApi.me().then(s => {
      setDemoProgressScope(progressScopeFor(s));
      setSession(s);
      showBusinessDiagnosisFor(s);
      setAuthLoading(false);
    });
  }, []);
  useEffect(() => {
    if (!session) return;
    const timer = window.setInterval(() => {
      authApi.me().then(s => {
        setDemoProgressScope(progressScopeFor(s));
        setSession(s);
      });
    }, 300_000);
    return () => window.clearInterval(timer);
  }, [session?.user?.id]);
  useEffect(() => {
    try { localStorage.setItem('ow_page', page); } catch { /* ignore */ }
  }, [page]);

  // 每次对话推进都记录/更新会话历史
  const enterConversation = (ctx: ConversationContext) => {
    if (ctx.messages?.some(msg => msg.role === 'assistant' && msg.content.trim().length > 12)) {
      if (ctx.agent === 'strategy') completeDemoStep('strategy');
      if (ctx.agent === 'conversion') completeDemoStep('conversion');
      if (ctx.agent === 'retention') completeDemoStep('retention');
    }
    setConversation(ctx);
    if (!ctx.messages?.length) {
      activeIdRef.current = null;
      setActiveConvId(null);
      setRestore({ agent: ctx.agent, messages: [], key: `open:${ctx.agent}:${Date.now()}` });
      setKickoff(null);
      setPage(ctx.agent);
      return;
    }
    let id = activeIdRef.current;
    let list = convsRef.current;
    if (id && list.some(c => c.id === id)) {
      list = list.map(c => c.id === id ? { ...c, messages: ctx.messages!, updatedAt: Date.now() } : c);
    } else {
      id = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `c${Date.now()}`;
      list = [{ id, agent: ctx.agent, title: firstUserText(ctx.messages), messages: ctx.messages!, updatedAt: Date.now() }, ...list];
      activeIdRef.current = id; setActiveConvId(id);
    }
    persist([...list].sort((a, b) => b.updatedAt - a.updatedAt));
  };
  const leaveConversation = () => setConversation(null);

  // 恢复历史会话 → 打开全局助手并载入旧内容
  const openConversation = (id: string) => {
    const conv = convsRef.current.find(c => c.id === id);
    if (!conv) return;
    activeIdRef.current = id; setActiveConvId(id);
    const pageAgent = customerUnifiedAgent(conv.agent);
    setConversation({ agent: pageAgent, messages: conv.messages });
    setRestore({ agent: pageAgent, messages: conv.messages, key: `${id}:${Date.now()}` });
    setKickoff(null);
    setPage(pageAgent);
  };
  const newConversation = () => {
    activeIdRef.current = null; setActiveConvId(null);
    setConversation(null); setKickoff(null);
    if (AGENT_PAGES.includes(page)) setRestore({ agent: page as AgentType, messages: [], key: `new:${Date.now()}` });
  };

  // 一键执行：策略专家把任务交给某个专家，跳转过去并自动发起任务
  const startAgentTask = (agent: AgentType, text: string) => {
    const pageAgent = customerUnifiedAgent(agent);
    activeIdRef.current = null; setActiveConvId(null);
    setRestore(null); setConversation(null);
    setKickoff({ agent: pageAgent, text, key: `k${Date.now()}` });
    if (!AGENT_PAGES.includes(page)) setPage(pageAgent);
  };

  const handleNavigate = useCallback((p: Page) => {
    setConversation(null); setRestore(null); setKickoff(null);
    activeIdRef.current = null; setActiveConvId(null);
    setPage(p === 'retention' ? 'conversion' : p);
    if (p === 'adminDelivery') window.history.replaceState(null, '', '/admin/delivery');
    else if (window.location.pathname === '/admin/delivery') window.history.replaceState(null, '', '/');
  }, []);

  useEffect(() => {
    const handler = (event: Event) => {
      const nextPage = (event as CustomEvent<{ page?: Page }>).detail?.page;
      if (!nextPage || !ALL_PAGES.includes(nextPage)) return;
      handleNavigate(nextPage);
    };
    window.addEventListener('lingshu:navigate', handler);
    return () => window.removeEventListener('lingshu:navigate', handler);
  }, [handleNavigate]);
  const restoreFor = (a: AgentType) => (restore && restore.agent === a ? restore : undefined);
  const kickoffFor = (a: AgentType) => (kickoff && kickoff.agent === a ? { text: kickoff.text, key: kickoff.key } : undefined);

  const handleAuthed = (s: AuthSession) => {
    setDemoProgressScope(progressScopeFor(s));
    setSession(s);
    showBusinessDiagnosisFor(s);
  };
  const refreshSession = async () => {
    const latest = await authApi.me();
    if (!latest) {
      setDemoProgressScope(null);
      setSession(null);
      setBusinessDiagnosisOpen(false);
      return;
    }
    setDemoProgressScope(progressScopeFor(latest));
    setSession(latest);
  };
  const handleLogout = () => {
    authApi.logout();
    setDemoProgressScope(null);
    setBusinessDiagnosisOpen(false);
    setSession(null);
  };

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 size={22} className="animate-spin text-text-muted" />
      </div>
    );
  }
  if (!session) return <AuthScreen onAuthed={handleAuthed} />;
  if (session.demo?.enabled && session.demo.expired) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-2 px-6">
        <div className="w-full max-w-md rounded-2xl bg-white border border-border p-6 text-center shadow-sm">
          <p className="text-sm font-bold text-text-primary">Demo 试用已到期</p>
          <p className="text-sm text-text-muted mt-2 leading-relaxed">
            当前试用账号已超过 {session.demo.trialDays} 天有效期。请联系服务顾问开通或延长试用。
          </p>
          <button onClick={handleLogout}
            className="mt-5 px-4 py-2 rounded-lg bg-text-primary text-white text-sm font-semibold">
            退出登录
          </button>
        </div>
      </div>
    );
  }

  return (
    <Layout page={page} onNavigate={handleNavigate} conversation={conversation} session={session} onLogout={handleLogout}
      onSessionUpdate={setSession}
      onOpenBusinessDiagnosis={reopenBusinessDiagnosis}
      demoGuideActive={false}
      conversations={conversations} activeConvId={activeConvId} onOpenConversation={openConversation} onNewConversation={newConversation}
      suppressRightPanel={scriptPanelOpen} onAction={startAgentTask}>
      <AnimatePresence>
        {businessDiagnosisDocked && !businessDiagnosisOpen && (
          <motion.button
            type="button"
            layoutId="business-diagnosis-surface"
            initial={{ opacity: 0.72, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0.72, scale: 0.92 }}
            transition={{
              layout: { type: 'spring', damping: 30, stiffness: 360, mass: 0.8 },
              opacity: { duration: 0.14, ease: 'easeOut' },
              scale: { duration: 0.18, ease: 'easeOut' },
            }}
            onClick={reopenBusinessDiagnosis}
            className="fixed bottom-5 right-5 z-[70] flex flex-col items-center gap-1 rounded-2xl border border-border bg-white px-3 py-3 text-text-secondary shadow-[0_16px_38px_rgba(15,23,42,0.18)] transition-colors hover:border-green-200 hover:text-green-700"
            title="打开经营日报"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-green-50 text-green-700">
              <BookOpen size={18} />
            </span>
            <span className="text-[11px] font-semibold">经营日报</span>
          </motion.button>
        )}
      </AnimatePresence>
      <BusinessDiagnosisModal
        open={businessDiagnosisOpen}
        session={session}
        onClose={closeBusinessDiagnosis}
        onDismissToday={dismissBusinessDiagnosisToday}
        onNavigate={handleNavigate}
      />
      <GlobalAssistant
        page={page}
        restore={restore}
        kickoff={kickoff}
        suppressForRightSidebar={scriptPanelOpen || conversation !== null}
        onKickoffConsumed={() => setKickoff(null)}
        onAction={startAgentTask}
        onSessionRefresh={() => void refreshSession()}
      />
      <PageErrorBoundary page={page} onNavigateHome={() => handleNavigate('strategy')}>
        <Suspense fallback={<PageLoading />}>
          {page === 'strategy' && (
            <StrategyPage
              onEnterConversation={enterConversation}
              onLeaveConversation={leaveConversation}
              isInConversation={conversation?.agent === 'strategy'}
              restore={restoreFor('strategy')}
              kickoff={kickoffFor('strategy')}
              onAction={startAgentTask}
              onSessionRefresh={() => void refreshSession()}
            />
          )}
          {page === 'traffic' && (
            <TrafficPage
              onEnterConversation={enterConversation}
              onLeaveConversation={leaveConversation}
              isInConversation={conversation?.agent === 'traffic'}
              onNavigate={handleNavigate}
              restore={restoreFor('traffic')}
              kickoff={kickoffFor('traffic')}
              onAction={startAgentTask}
              onScriptPanelOpen={() => setScriptPanelOpen(true)}
              onScriptPanelClose={() => setScriptPanelOpen(false)}
              onSessionRefresh={() => void refreshSession()}
            />
          )}
          {page === 'conversion' && (
            <ConversionPage
              onEnterConversation={enterConversation}
              onLeaveConversation={leaveConversation}
              isInConversation={conversation?.agent === 'conversion'}
              restore={restoreFor('conversion')}
              kickoff={kickoffFor('conversion')}
              onAction={startAgentTask}
              onSessionRefresh={() => void refreshSession()}
              isDemo={Boolean(session.demo?.enabled)}
            />
          )}
          {page === 'orders' && <OrderManagementPage />}
          {page === 'enterprise' && <EnterprisePage />}
          {page === 'plugins' && <IntegrationsPage />}
          {page === 'scheduled' && <ScheduledPage onAction={startAgentTask} />}
          {page === 'admin' && <AdminDashboard />}
          {page === 'adminDelivery' && <AdminDeliveryPage />}
          {(page === 'channels' || page === 'youtube') && <IntegrationsPage />}
        </Suspense>
      </PageErrorBoundary>
    </Layout>
  );
}
