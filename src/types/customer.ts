export type CustomerSource =
  | 'whatsapp'
  | 'facebook'
  | 'instagram'
  | 'tiktok'
  | 'youtube'
  | 'whatsapp_from_youtube'
  | 'whatsapp_from_tiktok'
  | 'whatsapp_from_instagram'
  | 'whatsapp_from_facebook'
  | string;
export type CustomerStage = 'lead' | 'inquiry' | 'quoted' | 'won' | 'silent30' | 'silent60';
export type HandlingMode = 'ai_auto' | 'ai_draft' | 'human_needed';
export type TimelineType = 'whatsapp' | 'call' | 'note' | 'quote' | 'task' | 'system';
export type AutonomyLevel = 'remind' | 'draft' | 'auto';

export type AuthenticityBand = 'verified' | 'reduced' | 'suspected_scraping';
export type QualificationBand = 'white' | 'blue' | 'yellow' | 'red' | 'black';

export interface BantDimension {
  score: number;
  status: 'unknown' | 'partial' | 'confirmed';
  evidence: string[];
  signalPoints?: Record<string, number>;
}

export interface AuthenticityAssessment {
  score: number;
  band: AuthenticityBand;
  redFlags: string[];
  greenFlags: string[];
}

export interface BantAssessment {
  budget: BantDimension;
  authority: BantDimension;
  need: BantDimension;
  timing: BantDimension;
  rawTotal: number;
  authenticity: AuthenticityAssessment;
  total: number;
  band: QualificationBand;
  completeness: number;
  level: 'early' | 'qualified' | 'hot';
  evidence?: string[];
  updatedAt: string;
}

export interface ProgressionGoal {
  dimension: 'budget' | 'authority' | 'need' | 'timing';
  label: string;
  reason: string;
  question: string;
  questionStyle: 'spin_indirect';
  updatedAt: string;
}

export type SpinStage = 'situation' | 'problem' | 'implication' | 'need_payoff';

export interface SpinGuidance {
  stage: SpinStage;
  statement: string;
  question: string;
  rationale: string;
  updatedAt: string;
}

export interface TimelineEvent {
  id: string;
  type: TimelineType;
  actor: 'buyer' | 'seller' | 'ai' | 'owner';
  title: string;
  body: string;
  translatedBody?: string;
  time: string;
  timestamp?: number;
  autoSent?: boolean;
  sendStatus?: 'draft' | 'queued' | 'sent' | 'delivered' | 'failed';
  sendMode?: 'free_text' | 'template';
  confirmedByHuman?: boolean;
  audit?: {
    action?: string;
    risk?: 'L1' | 'L2' | 'L3' | 'L4';
    autonomy?: AutonomyLevel;
    guardRule?: string;
    knowledgeMiss?: boolean;
    buyerMessage?: string;
    evidence?: string[];
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
  sourcePostId?: string;
  sourceTrackCode?: string;
  sourcePostTitle?: string;
  sourcePostPlatform?: string;
  softAttribution?: {
    candidates: Array<{ id: string; title: string; platform: string; trackCode: string }>;
  };
  product: string;
  outboundProduct: string;
  estimatedValue: string;
  stage: CustomerStage;
  intentScore: number;
  intentSignals: string[];
  bant?: BantAssessment;
  progressionGoal?: ProgressionGoal;
  spinGuidance?: SpinGuidance;
  handlingMode: HandlingMode;
  handlingReason: string;
  aiAutoCount?: number;
  needCall?: boolean;
  hasUnread?: boolean;
  isReal?: boolean;
  isMock?: boolean;
  waNumber?: string;
  newProductMatch?: boolean;
  blockedAutoReplyReason?: string;
  pendingDraft?: string;
  knowledgeMissStreak?: number;
  fallbackCount?: number;
  handoffDueAt?: string;
  todoCompletedAt?: string;
  priority: number;
  inboxReason?: 'call' | 'large' | 'draft' | 'overdue' | 'reply';
  lastActive: string;
  lastActiveAt?: number;
  localTime: string;
  timeZone?: string;
  orders: OrderRecord[];
  tags: string[];
  summary: string;
  nextStep: string;
  timeline: TimelineEvent[];
}
