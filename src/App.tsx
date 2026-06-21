import { useState } from 'react';
import Layout from './components/Layout';
import StrategyPage from './components/StrategyPage';
import TrafficPage from './components/TrafficPage';
import ConversionPage from './components/ConversionPage';
import RetentionPage from './components/RetentionPage';
import EnterprisePage from './components/EnterprisePage';
import PluginsPage from './components/PluginsPage';
import ScheduledPage from './components/ScheduledPage';
import ChannelsPage from './components/ChannelsPage';
import ComingSoon from './components/ComingSoon';

export type Page =
  | 'strategy'
  | 'traffic'
  | 'conversion'
  | 'retention'
  | 'enterprise'
  | 'plugins'
  | 'scheduled'
  | 'channels';

export type AgentType = 'strategy' | 'traffic' | 'conversion' | 'retention';

export interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export interface ConversationContext {
  agent: AgentType;
  messages?: Message[];
}

export default function App() {
  const [page, setPage] = useState<Page>('strategy');
  const [conversation, setConversation] = useState<ConversationContext | null>(null);

  const enterConversation = (ctx: ConversationContext) => setConversation(ctx);
  const leaveConversation = () => setConversation(null);

  const handleNavigate = (p: Page) => {
    setConversation(null);
    setPage(p);
  };

  return (
    <Layout page={page} onNavigate={handleNavigate} conversation={conversation}>
      {page === 'strategy' && (
        <StrategyPage
          onEnterConversation={enterConversation}
          onLeaveConversation={leaveConversation}
          isInConversation={conversation?.agent === 'strategy'}
        />
      )}
      {page === 'traffic' && (
        <TrafficPage
          onEnterConversation={enterConversation}
          onLeaveConversation={leaveConversation}
          isInConversation={conversation?.agent === 'traffic'}
        />
      )}
      {page === 'conversion' && (
        <ConversionPage
          onEnterConversation={enterConversation}
          onLeaveConversation={leaveConversation}
          isInConversation={conversation?.agent === 'conversion'}
        />
      )}
      {page === 'retention' && (
        <RetentionPage
          onEnterConversation={enterConversation}
          onLeaveConversation={leaveConversation}
          isInConversation={conversation?.agent === 'retention'}
        />
      )}
      {page === 'enterprise' && <EnterprisePage />}
      {page === 'plugins' && <PluginsPage />}
      {page === 'scheduled' && <ScheduledPage />}
      {page === 'channels' && <ChannelsPage />}
    </Layout>
  );
}
