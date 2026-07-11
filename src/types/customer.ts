export type CustomerSource = 'whatsapp' | 'facebook' | 'instagram' | 'tiktok';
export type CustomerStage = 'lead' | 'inquiry' | 'quoted' | 'won' | 'silent30' | 'silent60';
export type HandlingMode = 'ai_auto' | 'ai_draft' | 'human_needed';
export type TimelineType = 'whatsapp' | 'call' | 'note' | 'quote' | 'task' | 'system';
export type AutonomyLevel = 'remind' | 'draft' | 'auto';

export interface TimelineEvent {
  id: string;
  type: TimelineType;
  actor: 'buyer' | 'seller' | 'ai' | 'owner';
  title: string;
  body: string;
  time: string;
  autoSent?: boolean;
  audit?: {
    action?: string;
    risk?: 'L1' | 'L2' | 'L3' | 'L4';
    autonomy?: AutonomyLevel;
    guardRule?: string;
  };
}

export interface OrderRecord {
  id: string;
  status: 'paid' | 'refunded' | 'cancelled' | 'pending';
  total: string;
  createdAt: string;
  items?: { name: string; qty: number }[];
}

export interface CustomerProfile {
  id: string;
  name: string;
  avatar: string;
  countryName: string;
  email?: string;
  language: string;
  languageLocked: boolean;
  source: CustomerSource;
  product: string;
  outboundProduct: string;
  estimatedValue: string;
  stage: CustomerStage;
  intentScore: number;
  intentSignals: string[];
  handlingMode: HandlingMode;
  handlingReason: string;
  aiAutoCount?: number;
  needCall?: boolean;
  hasUnread?: boolean;
  isReal?: boolean;
  waNumber?: string;
  newProductMatch?: boolean;
  blockedAutoReplyReason?: string;
  pendingDraft?: string;
  todoCompletedAt?: string;
  priority: number;
  inboxReason?: 'call' | 'large' | 'draft' | 'overdue' | 'reply';
  lastActive: string;
  localTime: string;
  orders: OrderRecord[];
  tags: string[];
  summary: string;
  nextStep: string;
  timeline: TimelineEvent[];
}
