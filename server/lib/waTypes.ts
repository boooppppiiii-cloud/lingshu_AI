import type { AutomationLevel, CustomerStage, SopStep } from './waDefaults.js';

export interface CustomerRecord {
  id: string;
  tenantId: string;
  wa_id: string;
  profile_name?: string;
  phone?: string;
  channelId?: string;
  first_source?: Record<string, unknown> | null;
  last_inbound_at?: string;
  stage?: CustomerStage;
  sop_step?: SopStep;
  automation?: AutomationLevel;
  owner?: string;
  next_step?: string;
  tags?: string[];
  orderHistory?: string[];
  inboxReason?: string;
  priority?: number;
  estimatedValue?: string;
  lastActiveLabel?: string;
}

export interface CustomerInsightRecord {
  id: string;
  tenantId: string;
  customer: string;
  language?: string;
  country_guess?: string;
  product?: string;
  quantity?: string;
  budget?: string;
  urgency?: string;
  call_request?: boolean;
  complaint?: boolean;
  intent_score?: number;
  signals?: Array<{ label: string; score: number }>;
  missing_fields?: string[];
  updatedAt?: string;
}

export interface TimelineEventRecord {
  id: string;
  tenantId: string;
  customer: string;
  type: 'message' | 'ai' | 'quote' | 'call' | 'note' | 'task';
  actor: 'buyer' | 'seller' | 'ai' | 'owner';
  title: string;
  body: string;
  ref?: string;
  status?: string;
  ts: string;
}

export interface WaMessageRecord {
  id: string;
  tenantId: string;
  channelId: string;
  customerId?: string;
  wamid: string;
  wa_id: string;
  direction: 'in' | 'out';
  type: string;
  body?: string;
  ai_draft?: string;
  media_id?: string;
  media_url?: string;
  referral?: Record<string, unknown> | null;
  context?: Record<string, unknown> | null;
  status: string;
  ts: string;
}

export interface ParsedWaMessage {
  wamid: string;
  wa_id: string;
  profileName: string;
  type: string;
  body: string;
  mediaId?: string;
  referral?: Record<string, unknown> | null;
  context?: Record<string, unknown> | null;
  ts: string;
}
