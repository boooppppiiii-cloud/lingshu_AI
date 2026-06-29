import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import Layout from './components/Layout';
import AuthScreen from './components/AuthScreen';
import { authApi, type AuthSession } from './lib/auth';
import StrategyPage from './components/StrategyPage';
import TrafficPage from './components/TrafficPage';
import ConversionPage from './components/ConversionPage';
import RetentionPage from './components/RetentionPage';
import EnterprisePage from './components/EnterprisePage';
import PluginsPage from './components/PluginsPage';
import ScheduledPage from './components/ScheduledPage';
import ChannelsPage from './components/ChannelsPage';
import ComingSoon from './components/ComingSoon';
import YouTubeIntegrationPage from './components/YouTubeIntegration';

export type Page =
  | 'strategy'
  | 'traffic'
  | 'conversion'
  | 'retention'
  | 'enterprise'
  | 'plugins'
  | 'scheduled'
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
const firstUserText = (msgs?: Message[]) => (msgs?.find(m => m.role === 'user')?.content ?? '新会话').slice(0, 24);
const loadConvs = (): Conversation[] => {
  try { return JSON.parse(localStorage.getItem('ow_convs') || '[]'); } catch { return []; }
};

export default function App() {
  const [page, setPage] = useState<Page>('strategy');
  const [conversation, setConversation] = useState<ConversationContext | null>(null);

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

  useEffect(() => {
    authApi.me().then(s => { setSession(s); setAuthLoading(false); });
  }, []);

  // 每次对话推进都记录/更新近期会话
  const enterConversation = (ctx: ConversationContext) => {
    setConversation(ctx);
    if (!ctx.messages?.length) return;
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

  const handleNavigate = (p: Page) => {
    setConversation(null); setRestore(null); setKickoff(null);
    activeIdRef.current = null; setActiveConvId(null);
    setPage(p);
  };
  const restoreFor = (a: AgentType) => (restore && restore.agent === a ? restore : undefined);
  const kickoffFor = (a: AgentType) => (kickoff && kickoff.agent === a ? { text: kickoff.text, key: kickoff.key } : undefined);

  const handleLogout = () => { authApi.logout(); setSession(null); };

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 size={22} className="animate-spin text-text-muted" />
      </div>
    );
  }
  if (!session) return <AuthScreen onAuthed={setSession} />;

  return (
    <Layout page={page} onNavigate={handleNavigate} conversation={conversation} session={session} onLogout={handleLogout}
      conversations={conversations} activeConvId={activeConvId} onOpenConversation={openConversation} onNewConversation={newConversation}>
      {page === 'strategy' && (
        <StrategyPage
          onEnterConversation={enterConversation}
          onLeaveConversation={leaveConversation}
          isInConversation={conversation?.agent === 'strategy'}
          restore={restoreFor('strategy')}
          kickoff={kickoffFor('strategy')}
          onAction={startAgentTask}
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
        />
      )}
      {page === 'enterprise' && <EnterprisePage />}
      {page === 'plugins' && <PluginsPage />}
      {page === 'scheduled' && <ScheduledPage />}
      {page === 'channels' && <ChannelsPage />}
      {page === 'youtube' && <YouTubeIntegrationPage />}
    </Layout>
  );
}
