import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import Layout from './components/Layout';
import AuthScreen from './components/AuthScreen';
import { authApi, type AuthSession } from './lib/auth';
import { completeDemoStep, resetDemoProgress, setDemoProgressScope } from './lib/demoProgress';

const StrategyPage = lazy(() => import('./components/StrategyPage'));
const TrafficPage = lazy(() => import('./components/TrafficPage'));
const ConversionPage = lazy(() => import('./components/ConversionPage'));
const RetentionPage = lazy(() => import('./components/RetentionPage'));
const EnterprisePage = lazy(() => import('./components/EnterprisePage'));
const IntegrationsPage = lazy(() => import('./components/IntegrationsPage'));
const ScheduledPage = lazy(() => import('./components/ScheduledPage'));
const AdminDashboard = lazy(() => import('./components/AdminDashboard'));

export type Page =
  | 'strategy'
  | 'traffic'
  | 'conversion'
  | 'retention'
  | 'enterprise'
  | 'plugins'
  | 'scheduled'
  | 'admin'
  | 'channels'
  | 'youtube';

export type AgentType = 'strategy' | 'traffic' | 'conversion' | 'retention';
const DEMO_GUIDE_ACTIVE_SCOPE_KEY = 'ow_demo_guide_active_scope';

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
const ALL_PAGES: Page[] = ['strategy', 'traffic', 'conversion', 'retention', 'enterprise', 'plugins', 'scheduled', 'admin', 'channels', 'youtube'];
const firstUserText = (msgs?: Message[]) => (msgs?.find(m => m.role === 'user')?.content ?? '新会话').slice(0, 24);
const loadConvs = (): Conversation[] => {
  try { return JSON.parse(localStorage.getItem('ow_convs') || '[]'); } catch { return []; }
};
const loadPage = (): Page => {
  try {
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

export default function App() {
  const [page, setPage] = useState<Page>(loadPage);
  const [conversation, setConversation] = useState<ConversationContext | null>(null);
  const [scriptPanelOpen, setScriptPanelOpen] = useState(false);

  // 会话历史（近期会话，本地持久化）
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
  const [demoGuideActive, setDemoGuideActive] = useState(false);

  const progressScopeFor = (s: AuthSession | null) => s?.demo?.guideScope || (s?.demo?.expiresAt ? `${s.user.id}:${s.demo.expiresAt}` : s?.user?.id || s?.tenant?.id || null);
  const shouldShowGuide = (s: AuthSession | null) => {
    if (!s?.demo?.enabled) return false;
    return Boolean(s.demo.guideTrigger && progressScopeFor(s));
  };
  const hasActiveGuideScope = (s: AuthSession | null) => {
    const scope = progressScopeFor(s);
    if (!s?.demo?.enabled || !scope) return false;
    try { return sessionStorage.getItem(DEMO_GUIDE_ACTIVE_SCOPE_KEY) === scope; } catch { return false; }
  };
  const showGuideFor = (s: AuthSession) => {
    const scope = progressScopeFor(s);
    if (scope) {
      try { sessionStorage.setItem(DEMO_GUIDE_ACTIVE_SCOPE_KEY, scope); } catch { /* ignore */ }
    }
    resetDemoProgress();
    setDemoGuideActive(true);
  };

  useEffect(() => {
    authApi.me().then(s => {
      setDemoProgressScope(progressScopeFor(s));
      if (s && shouldShowGuide(s)) showGuideFor(s);
      else setDemoGuideActive(hasActiveGuideScope(s));
      setSession(s);
      setAuthLoading(false);
    });
  }, []);
  useEffect(() => {
    if (!session) return;
    const timer = window.setInterval(() => {
      authApi.me().then(s => {
        setDemoProgressScope(progressScopeFor(s));
        if (s && shouldShowGuide(s)) showGuideFor(s);
        else if (s) setDemoGuideActive(hasActiveGuideScope(s));
        setSession(s);
        if (!s) setDemoGuideActive(false);
      });
    }, 300_000);
    return () => window.clearInterval(timer);
  }, [session?.user?.id]);
  useEffect(() => {
    try { localStorage.setItem('ow_page', page); } catch { /* ignore */ }
  }, [page]);

  // 每次对话推进都记录/更新近期会话
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

  // 点击近期会话 → 回到该历史会话并可继续提问
  const openConversation = (id: string) => {
    const conv = convsRef.current.find(c => c.id === id);
    if (!conv) return;
    activeIdRef.current = id; setActiveConvId(id);
    setConversation({ agent: conv.agent, messages: conv.messages });
    setRestore({ agent: conv.agent, messages: conv.messages, key: `${id}:${Date.now()}` });
    setKickoff(null);
    setPage(conv.agent);
  };
  const newConversation = () => {
    activeIdRef.current = null; setActiveConvId(null);
    setConversation(null); setKickoff(null);
    if (AGENT_PAGES.includes(page)) setRestore({ agent: page as AgentType, messages: [], key: `new:${Date.now()}` });
  };

  // 一键执行：策略专家把任务交给某个专家，跳转过去并自动发起任务
  const startAgentTask = (agent: AgentType, text: string) => {
    activeIdRef.current = null; setActiveConvId(null);
    setRestore(null); setConversation({ agent });
    setKickoff({ agent, text, key: `k${Date.now()}` });
    setPage(agent);
  };

  const handleNavigate = useCallback((p: Page) => {
    setConversation(null); setRestore(null); setKickoff(null);
    activeIdRef.current = null; setActiveConvId(null);
    setPage(p);
  }, []);
  const restoreFor = (a: AgentType) => (restore && restore.agent === a ? restore : undefined);
  const kickoffFor = (a: AgentType) => (kickoff && kickoff.agent === a ? { text: kickoff.text, key: kickoff.key } : undefined);

  const handleAuthed = (s: AuthSession) => {
    setDemoProgressScope(progressScopeFor(s));
    if (shouldShowGuide(s)) {
      showGuideFor(s);
    } else {
      setDemoGuideActive(hasActiveGuideScope(s));
    }
    setSession(s);
  };
  const refreshSession = async () => {
    const latest = await authApi.me();
    if (!latest) {
      setDemoProgressScope(null);
      setSession(null);
      setDemoGuideActive(false);
      return;
    }
    setDemoProgressScope(progressScopeFor(latest));
    setDemoGuideActive(hasActiveGuideScope(latest));
    setSession(latest);
  };
  const handleLogout = () => {
    authApi.logout();
    try { sessionStorage.removeItem(DEMO_GUIDE_ACTIVE_SCOPE_KEY); } catch { /* ignore */ }
    setDemoProgressScope(null);
    setDemoGuideActive(false);
    setSession(null);
  };
  const handleDemoGuideShown = useCallback(() => {
    void authApi.guideSeen();
  }, []);

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
            当前试用账号已超过 {session.demo.trialDays} 天有效期。请联系管理员开通或延长试用。
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
      demoGuideActive={demoGuideActive}
      onDemoGuideShown={handleDemoGuideShown}
      conversations={conversations} activeConvId={activeConvId} onOpenConversation={openConversation} onNewConversation={newConversation}
      suppressRightPanel={scriptPanelOpen} onAction={startAgentTask}>
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
          />
        )}
        {page === 'retention' && (
          <RetentionPage
            onEnterConversation={enterConversation}
            onLeaveConversation={leaveConversation}
            isInConversation={conversation?.agent === 'retention'}
            restore={restoreFor('retention')}
            kickoff={kickoffFor('retention')}
            onAction={startAgentTask}
            onSessionRefresh={() => void refreshSession()}
          />
        )}
        {page === 'enterprise' && <EnterprisePage />}
        {page === 'plugins' && <IntegrationsPage />}
        {page === 'scheduled' && <ScheduledPage onAction={startAgentTask} />}
        {page === 'admin' && <AdminDashboard />}
        {(page === 'channels' || page === 'youtube') && <IntegrationsPage />}
      </Suspense>
    </Layout>
  );
}
