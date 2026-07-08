import type { AgentAction, ConversationContext, KickoffSignal, RestoreSignal } from '../../App';

export type CustomerView = 'inbox' | 'leads' | 'won' | 'silent';
export type CustomerStage = '潜客' | '询盘中' | '已报价' | '成交' | '沉默30' | '沉默60';
export type AutomationLevel = 'auto' | 'confirm' | 'manual';
export type TimelineEventType = 'whatsapp' | 'ai' | 'call' | 'note' | 'quote' | 'task';

export interface CustomerPageProps {
  onEnterConversation: (ctx: ConversationContext) => void;
  onLeaveConversation: () => void;
  isInConversation: boolean;
  restore?: RestoreSignal;
  kickoff?: KickoffSignal;
  onAction?: AgentAction;
  onSessionRefresh?: () => void;
}

export interface TimelineEvent {
  id: string;
  type: TimelineEventType;
  actor: 'buyer' | 'seller' | 'ai' | 'owner';
  title: string;
  body: string;
  time: string;
  status?: string;
}

export interface CustomerProfile {
  id: string;
  name: string;
  country: string;
  countryName: string;
  language: string;
  timezone: string;
  localTime: string;
  source: string;
  product: string;
  estimatedValue: string;
  stage: CustomerStage;
  intentScore: number;
  intentSignals: string[];
  automation: AutomationLevel;
  priority: number;
  inboxReason?: 'call' | 'large' | 'draft' | 'overdue' | 'reply';
  lastActive: string;
  lastOrder?: string;
  orderHistory: string[];
  tags: string[];
  summary: string;
  nextStep: string;
  sla?: string;
  channelId?: string;
  waId?: string;
  phone?: string;
  insight?: {
    language?: string;
    country_guess?: string;
    product?: string;
    quantity?: string;
    budget?: string;
    urgency?: string;
    call_request?: boolean;
    complaint?: boolean;
    intent_score?: number;
    signals?: { label: string; score: number }[];
    missing_fields?: string[];
  } | null;
  window?: { open: boolean; closesAt: string | null };
  timeline: TimelineEvent[];
}
