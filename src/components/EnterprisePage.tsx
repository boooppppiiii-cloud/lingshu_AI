import { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Building2, Package, Megaphone, BookOpen, Save, CheckCircle2, Loader2, Compass, Zap, MessageSquare, RotateCcw, Plus, Upload, X, Image, Video, FileText, Copy, FileSpreadsheet, Bell, ChevronDown, Globe2, ShieldCheck, type LucideIcon } from 'lucide-react';
import { authHeader } from '../lib/auth';
import { completeDemoStep } from '../lib/demoProgress';
import {
  heuristicProductMapping,
  mapRowToProduct,
  parseWorkbook,
  prepareSheet,
} from '../lib/productImport';

interface ProductAsset {
  name: string;
  type: string;
  size: number;
  updatedAt: string;
  url?: string;
}

interface ProductItem {
  sku?: string;
  name: string;
  category?: string;
  color?: string;
  size?: string;
  tagPrice?: string;
  material?: string;
  imageUrl?: string;
  priceRange?: string;
  moq?: string;
  certifications?: string;
  highlights?: string;
  images?: ProductAsset[];
  videos?: ProductAsset[];
  documents?: ProductAsset[];
  factoryImages?: ProductAsset[];
  packagingImages?: ProductAsset[];
  certificateImages?: ProductAsset[];
  sceneImages?: ProductAsset[];
  brandAssets?: ProductAsset[];
}

type AutonomyLevel = 'remind' | 'draft' | 'auto';
type QuoteMode = '' | 'range' | 'human_only';
type BargainPolicy = '' | 'no' | 'limited' | 'open';
type NotificationChannel = 'wecom' | 'dingtalk' | 'feishu' | 'sms';

interface BizRules {
  quoteMode: QuoteMode;
  priceRange?: string;
  bargainPolicy: BargainPolicy;
  bargainFloor?: string;
  moq: string;
  samplePolicy: string;
  paymentTerms: string;
  leadTime: string;
}

interface FaqItem {
  id: string;
  question: string;
  answer: string;
  approvedForAuto: boolean;
}

interface NotificationReceiver {
  name: string;
  channel: NotificationChannel;
  target: string;
}

interface NotificationSettings {
  receivers: NotificationReceiver[];
  workHours: { start: string; end: string };
  quietOutsideHours: boolean;
  lastTestAt?: string;
}

interface Profile {
  company: { name: string; industry: string; companyType?: string; mainMarkets: string; primaryLanguages?: string; founded: string; description: string };
  products: { categories: string; priceRange: string; moq: string; certifications: string; highlights: string; items?: ProductItem[] };
  brand: { tone: string; style: string; taboos: string; usp: string; preferredLanguages?: string };
  strategy?: { currentGoal?: string; focusProducts?: string; focusMarkets?: string; excludedMarkets?: string; pricingStrategy?: string; minMargin?: string; agentAutonomy?: string; aiAutonomy?: AutonomyLevel };
  customers?: { targetProfiles?: string; highValueSignals?: string; lowQualitySignals?: string; commonQuestions?: string; followupStyle?: string };
  operations?: { leadTime?: string; customization?: string; logistics?: string; paymentTerms?: string; riskNotes?: string };
  agentLearning?: { provenAngles?: string; weakAngles?: string; pendingAssumptions?: string; userCorrections?: string };
  bizRules?: BizRules;
  faq?: FaqItem[];
  notifications?: NotificationSettings;
  knowledge: string;
}

const DEFAULT: Profile = {
  company: { name: '', industry: '', companyType: '', mainMarkets: '', primaryLanguages: '', founded: '', description: '' },
  products: {
    categories: '',
    priceRange: '',
    moq: '',
    certifications: '',
    highlights: '',
    items: [],
  },
  brand: { tone: '', style: '', taboos: '', usp: '', preferredLanguages: '' },
  strategy: { currentGoal: '', focusProducts: '', focusMarkets: '', excludedMarkets: '', pricingStrategy: '', minMargin: '', agentAutonomy: '', aiAutonomy: 'draft' },
  customers: { targetProfiles: '', highValueSignals: '', lowQualitySignals: '', commonQuestions: '', followupStyle: '' },
  operations: { leadTime: '', customization: '', logistics: '', paymentTerms: '', riskNotes: '' },
  agentLearning: { provenAngles: '', weakAngles: '', pendingAssumptions: '', userCorrections: '' },
  bizRules: { quoteMode: '', priceRange: '', bargainPolicy: 'no', bargainFloor: '', moq: '', samplePolicy: '', paymentTerms: '', leadTime: '' },
  faq: [],
  notifications: { receivers: [], workHours: { start: '09:00', end: '22:00' }, quietOutsideHours: true, lastTestAt: '' },
  knowledge: '',
};

const AGENTS = [
  { icon: Compass, label: '首页', color: '#4f46e5' },
  { icon: Zap, label: '我的社媒', color: '#d97706' },
  { icon: MessageSquare, label: '我的客户', color: '#0891b2' },
];

const AUTONOMY_OPTIONS: Array<{ value: AutonomyLevel; title: string; desc: string; detail: string }> = [
  { value: 'remind', title: '只提醒我', desc: 'AI 发现该联系谁会告诉你', detail: '不替你写、不替你发' },
  { value: 'draft', title: '帮我写草稿（推荐）', desc: 'AI 写好回复等你确认', detail: '一键发送' },
  { value: 'auto', title: '低风险消息自动回', desc: '物流通知、基础问答等 AI 直接回复', detail: '报价等大事永远等你确认' },
];

const L3_ACTIONS = ['物流状态更新', '节假日祝福', '明确索要目录时发送已审批资料', '标准售后确认', '知识库内基础问答'];
const MARKET_OPTIONS = ['中东', '东南亚', '欧美', '拉美', '其他'];
const LANGUAGE_OPTIONS = ['英语', '阿拉伯语', '西班牙语', '法语', '俄语', '其他'];
const CHANNEL_OPTIONS: Array<{ value: NotificationChannel; label: string }> = [
  { value: 'wecom', label: '企业微信' },
  { value: 'dingtalk', label: '钉钉' },
  { value: 'feishu', label: '飞书' },
  { value: 'sms', label: '短信' },
];

type SectionKey = 'products' | 'materials' | 'bizRules' | 'faq' | 'market' | 'company';

function splitTokens(value?: string): string[] {
  return String(value ?? '').split(/[、,，\s]+/).map(item => item.trim()).filter(Boolean);
}

function joinTokens(items: string[]): string {
  return Array.from(new Set(items.filter(Boolean))).join('、');
}

function productAssetStats(items: ProductItem[]) {
  return items.reduce((acc, product) => {
    acc.images += (product.images?.length ?? 0) + (product.imageUrl ? 1 : 0);
    acc.videos += product.videos?.length ?? 0;
    acc.documents += product.documents?.length ?? 0;
    if ((product.images?.length ?? 0) + (product.imageUrl ? 1 : 0) > 0) acc.withImage += 1;
    return acc;
  }, { images: 0, videos: 0, documents: 0, withImage: 0 });
}

function sectionCompletion(profile: Profile): Record<SectionKey, boolean> {
  const items = normalizeProductItems(profile.products);
  const stats = productAssetStats(items);
  return {
    products: items.length >= 1,
    materials: stats.videos >= 1 || stats.images + stats.videos + stats.documents >= 5,
    bizRules: Boolean(profile.bizRules?.quoteMode && profile.bizRules?.samplePolicy?.trim() && profile.bizRules?.paymentTerms?.trim()),
    faq: (profile.faq ?? []).length >= 5,
    market: Boolean(profile.company.mainMarkets.trim() && profile.company.primaryLanguages?.trim()),
    company: profile.company.description.trim().length >= 50,
  };
}

function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${checked ? 'bg-emerald-500' : 'bg-slate-300'}`}
    >
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : 'translate-x-0.5'}`} />
    </button>
  );
}

function Chip({ active, children, onClick }: { active: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1.5 text-xs font-bold transition-colors ${active ? 'border-sky-200 bg-sky-50 text-sky-700' : 'border-border bg-white text-text-secondary hover:bg-surface-2'}`}
    >
      {children}
    </button>
  );
}

function KnowledgeCard({
  icon: Icon,
  title,
  purpose,
  completed,
  stat,
  children,
  id,
  highlight,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  title: string;
  purpose: string;
  completed: boolean;
  stat?: string;
  children: React.ReactNode;
  id?: string;
  highlight?: boolean;
}) {
  return (
    <section id={id} className={`rounded-lg border border-border bg-white p-5 shadow-sm transition-all ${highlight ? 'ring-2 ring-sky-300' : ''}`}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sky-50 text-sky-700">
            <Icon size={16} />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-black text-text-primary">{title}</h3>
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-black ${completed ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                {completed ? '已完成' : '未完成'}
              </span>
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-text-muted">{purpose}</p>
          </div>
        </div>
        {stat && <span className="rounded-full bg-surface-2 px-2.5 py-1 text-[11px] font-bold text-text-secondary">{stat}</span>}
      </div>
      {children}
    </section>
  );
}

interface DemoTemplate { id: string; name: string; description: string; profile?: Profile }
interface ProductApiInfo { apiKey: string; tenantId: string; createdAt?: string; lastIngestedAt?: string; lastProductName?: string }
interface ProductApiStatus { count: number; lastIngestedAt?: string; lastProductName?: string }

function matchTemplateId(profile: Profile, templates: DemoTemplate[]): string {
  const matched = templates.find(t =>
    t.profile?.company?.name === profile.company.name &&
    t.profile?.products?.categories === profile.products.categories
  );
  return matched?.id ?? '';
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-text-secondary mb-1.5">{label}</label>
      {hint && <p className="text-[11px] text-text-muted mb-1.5">{hint}</p>}
      {children}
    </div>
  );
}

const inputCls = 'w-full px-3 py-2 text-sm bg-white border border-border rounded-lg outline-none focus:border-accent focus:ring-2 focus:ring-accent/10 transition-all placeholder:text-text-muted text-text-primary';
const textareaCls = `${inputCls} resize-none`;

const MAX_PRODUCT_ASSETS = {
  images: 5,
  videos: 2,
  documents: 3,
  factoryImages: 6,
  packagingImages: 6,
  certificateImages: 6,
  sceneImages: 6,
  brandAssets: 6,
} as const;
type ProductAssetKey = keyof typeof MAX_PRODUCT_ASSETS;

function emptyProduct(index: number): ProductItem {
  return {
    name: `产品${index + 1}`,
    images: [],
    videos: [],
    documents: [],
    factoryImages: [],
    packagingImages: [],
    certificateImages: [],
    sceneImages: [],
    brandAssets: [],
  };
}

function normalizeProductItems(products: Profile['products']): ProductItem[] {
  const existing = Array.isArray(products.items) ? products.items : [];
  if (existing.length) {
    return existing.filter(item =>
      item.name || item.category || item.priceRange || item.moq || item.certifications || item.highlights ||
      item.images?.length || item.videos?.length || item.documents?.length ||
      item.factoryImages?.length || item.packagingImages?.length || item.certificateImages?.length ||
      item.sceneImages?.length || item.brandAssets?.length
    ).map((item, index) => ({
      ...emptyProduct(index),
      ...item,
      name: item.name || `产品${index + 1}`,
      images: Array.isArray(item.images) ? item.images : [],
      videos: Array.isArray(item.videos) ? item.videos : [],
      documents: Array.isArray(item.documents) ? item.documents : [],
      factoryImages: Array.isArray(item.factoryImages) && item.factoryImages.length ? item.factoryImages : (Array.isArray(item.videos) ? item.videos : []),
      packagingImages: Array.isArray(item.packagingImages) ? item.packagingImages : [],
      certificateImages: Array.isArray(item.certificateImages) && item.certificateImages.length ? item.certificateImages : (Array.isArray(item.documents) ? item.documents : []),
      sceneImages: Array.isArray(item.sceneImages) ? item.sceneImages : [],
      brandAssets: Array.isArray(item.brandAssets) ? item.brandAssets : [],
    }));
  }
  return [];
}

function formatSize(size: number): string {
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)}MB`;
  if (size >= 1024) return `${Math.round(size / 1024)}KB`;
  return `${size}B`;
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function uploadEnterpriseAsset(file: File): Promise<ProductAsset> {
  const dataUrl = await fileToDataUrl(file);
  const response = await fetch('/api/overseas/enterprise/assets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: file.name, type: file.type, dataUrl }),
  });
  if (!response.ok) throw new Error('asset upload failed');
  return response.json();
}

export default function EnterprisePage() {
  const [profile, setProfile] = useState<Profile>(DEFAULT);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [templates, setTemplates] = useState<DemoTemplate[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [demoBusy, setDemoBusy] = useState(false);
  const [apiInfo, setApiInfo] = useState<ProductApiInfo | null>(null);
  const [apiStatus, setApiStatus] = useState<ProductApiStatus>({ count: 0 });
  const [orderImporting, setOrderImporting] = useState(false);
  const [orderImportMessage, setOrderImportMessage] = useState('');
  const [autonomyHighlight, setAutonomyHighlight] = useState(false);
  const [productImporting, setProductImporting] = useState(false);
  const [productImportMessage, setProductImportMessage] = useState('');
  const [faqPreview, setFaqPreview] = useState<FaqItem[]>([]);
  const [faqStructuring, setFaqStructuring] = useState(false);
  const [notificationTesting, setNotificationTesting] = useState('');
  const [notificationMessage, setNotificationMessage] = useState('');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [notificationsHighlight, setNotificationsHighlight] = useState(false);
  const [bizRulesHighlight, setBizRulesHighlight] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch('/api/overseas/enterprise/profile').then(r => r.json()).catch(() => ({})),
      fetch('/api/overseas/enterprise/demo/templates').then(r => r.json()).catch(() => []),
      fetch('/api/overseas/enterprise/product-api', { headers: authHeader() }).then(r => r.json()).catch(() => null),
      fetch('/api/overseas/enterprise/product-api/status', { headers: authHeader() }).then(r => r.json()).catch(() => ({ count: 0 })),
    ])
      .then(([data, list, productApi, productApiStatus]: [Partial<Profile>, DemoTemplate[], ProductApiInfo | null, ProductApiStatus]) => {
        const next: Profile = {
          ...DEFAULT,
          ...data,
          company: { ...DEFAULT.company, ...data.company },
          products: { ...DEFAULT.products, ...data.products, items: normalizeProductItems({ ...DEFAULT.products, ...data.products }) },
          brand: { ...DEFAULT.brand, ...data.brand },
          strategy: { ...DEFAULT.strategy, ...data.strategy },
          customers: { ...DEFAULT.customers, ...data.customers },
          operations: { ...DEFAULT.operations, ...data.operations },
          agentLearning: { ...DEFAULT.agentLearning, ...data.agentLearning },
          bizRules: {
            ...DEFAULT.bizRules,
            ...data.bizRules,
            quoteMode: data.bizRules?.quoteMode ?? DEFAULT.bizRules!.quoteMode,
            bargainPolicy: data.bizRules?.bargainPolicy ?? DEFAULT.bizRules!.bargainPolicy,
            priceRange: data.bizRules?.priceRange || data.products?.priceRange || '',
            moq: data.bizRules?.moq || data.products?.moq || '',
            samplePolicy: data.bizRules?.samplePolicy ?? '',
            paymentTerms: data.bizRules?.paymentTerms || data.operations?.paymentTerms || '',
            leadTime: data.bizRules?.leadTime || data.operations?.leadTime || '',
          },
          faq: Array.isArray(data.faq) ? data.faq : [],
          notifications: {
            ...DEFAULT.notifications!,
            ...data.notifications,
            workHours: { ...DEFAULT.notifications!.workHours, ...data.notifications?.workHours },
            receivers: Array.isArray(data.notifications?.receivers) ? data.notifications!.receivers : [],
          },
          knowledge: data.knowledge ?? '',
        };
        const safeTemplates = Array.isArray(list) ? list : [];
        setProfile(next);
        setTemplates(safeTemplates);
        setTemplateId(matchTemplateId(next, safeTemplates));
        if (productApi) setApiInfo(productApi);
        setApiStatus(productApiStatus);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      fetch('/api/overseas/enterprise/product-api/status', { headers: authHeader() })
        .then(r => r.json())
        .then(setApiStatus)
        .catch(() => {});
    }, 5000);
    return () => window.clearInterval(timer);
  }, []);

  const set = <K extends keyof Profile>(section: K) =>
    (field: string, value: string) =>
      setProfile(prev => ({ ...prev, [section]: { ...(prev[section] as object), [field]: value } }));

  const products = normalizeProductItems(profile.products);
  const assetStats = productAssetStats(products);
  const completions = sectionCompletion(profile);
  const completedCount = Object.values(completions).filter(Boolean).length;
  const progressPercent = Math.round((completedCount / 6) * 100);
  const notificationCompleted = Boolean((profile.notifications?.receivers ?? []).length >= 1 && profile.notifications?.lastTestAt);
  const missingImageRatio = products.length ? (products.length - assetStats.withImage) / products.length : 0;
  const approvedFaqCount = (profile.faq ?? []).filter(item => item.approvedForAuto).length;
  const canAutoReply = approvedFaqCount >= 5;

  const toggleToken = (field: 'mainMarkets' | 'primaryLanguages', value: string) => {
    setProfile(prev => {
      const current = splitTokens(field === 'mainMarkets' ? prev.company.mainMarkets : prev.company.primaryLanguages);
      const next = current.includes(value) ? current.filter(item => item !== value) : [...current, value];
      return { ...prev, company: { ...prev.company, [field]: joinTokens(next) } };
    });
  };

  const setBizRule = (field: keyof BizRules, value: string) => {
    setProfile(prev => ({ ...prev, bizRules: { ...(prev.bizRules ?? DEFAULT.bizRules!), [field]: value } }));
  };

  const addFaq = () => {
    setProfile(prev => ({ ...prev, faq: [...(prev.faq ?? []), { id: crypto.randomUUID(), question: '', answer: '', approvedForAuto: false }] }));
  };

  const updateFaq = (id: string, patch: Partial<FaqItem>) => {
    setProfile(prev => ({ ...prev, faq: (prev.faq ?? []).map(item => item.id === id ? { ...item, ...patch } : item) }));
  };

  const removeFaq = (id: string) => {
    setProfile(prev => ({ ...prev, faq: (prev.faq ?? []).filter(item => item.id !== id) }));
  };

  const structureLegacyFaq = async () => {
    const source = profile.customers?.commonQuestions?.trim();
    if (!source) return;
    setFaqStructuring(true);
    try {
      const result = await fetch('/api/overseas/enterprise/faq/structure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: source }),
      }).then(r => r.json());
      setFaqPreview(Array.isArray(result.items) ? result.items : []);
    } finally {
      setFaqStructuring(false);
    }
  };

  const importFaqPreview = () => {
    setProfile(prev => ({ ...prev, faq: [...(prev.faq ?? []), ...faqPreview] }));
    setFaqPreview([]);
  };

  const addReceiver = () => {
    setProfile(prev => ({
      ...prev,
      notifications: {
        ...(prev.notifications ?? DEFAULT.notifications!),
        receivers: [...(prev.notifications?.receivers ?? []), { name: '', channel: 'wecom', target: '' }],
      },
    }));
  };

  const updateReceiver = (index: number, patch: Partial<NotificationReceiver>) => {
    setProfile(prev => {
      const notifications = prev.notifications ?? DEFAULT.notifications!;
      const receivers = notifications.receivers.map((item, i) => i === index ? { ...item, ...patch } : item);
      return { ...prev, notifications: { ...notifications, receivers } };
    });
  };

  const removeReceiver = (index: number) => {
    setProfile(prev => {
      const notifications = prev.notifications ?? DEFAULT.notifications!;
      return { ...prev, notifications: { ...notifications, receivers: notifications.receivers.filter((_, i) => i !== index) } };
    });
  };

  const testReceiver = async (receiver: NotificationReceiver, index: number) => {
    if (!receiver.target.trim()) {
      setNotificationMessage('请先填写接收目标');
      return;
    }
    setNotificationTesting(String(index));
    setNotificationMessage('');
    try {
      const result = await fetch('/api/overseas/enterprise/notifications/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ receiver }),
      }).then(r => r.json());
      if (result.error) throw new Error(result.error);
      setProfile(prev => ({
        ...prev,
        notifications: {
          ...(prev.notifications ?? DEFAULT.notifications!),
          lastTestAt: result.lastTestAt || new Date().toISOString(),
        },
      }));
      setNotificationMessage('测试提醒已发送');
    } catch (error) {
      setNotificationMessage(error instanceof Error ? error.message : '测试提醒发送失败');
    } finally {
      setNotificationTesting('');
    }
  };

  useEffect(() => {
    if (localStorage.getItem('lingshu:enterprise:highlight-autonomy') !== 'auto') return;
    localStorage.removeItem('lingshu:enterprise:highlight-autonomy');
    setAutonomyHighlight(true);
    window.setTimeout(() => document.getElementById('ai-autonomy')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 80);
    window.setTimeout(() => setAutonomyHighlight(false), 3200);
  }, [loading]);

  useEffect(() => {
    if (localStorage.getItem('lingshu:enterprise:highlight-notifications') !== 'true') return;
    localStorage.removeItem('lingshu:enterprise:highlight-notifications');
    setAdvancedOpen(true);
    setNotificationsHighlight(true);
    window.setTimeout(() => document.getElementById('notifications')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 120);
    window.setTimeout(() => setNotificationsHighlight(false), 3200);
  }, [loading]);

  useEffect(() => {
    if (localStorage.getItem('lingshu:enterprise:highlight-biz-rules') !== 'true') return;
    localStorage.removeItem('lingshu:enterprise:highlight-biz-rules');
    setBizRulesHighlight(true);
    window.setTimeout(() => document.getElementById('biz-rules')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 80);
    window.setTimeout(() => setBizRulesHighlight(false), 3200);
  }, [loading]);

  const setAutonomy = (value: AutonomyLevel) => {
    if (value === 'auto' && !canAutoReply) {
      window.alert('需要先录入并审批至少 5 条常见问答');
      return;
    }
    if (value === 'auto' && profile.strategy?.aiAutonomy !== 'auto') {
      const ok = window.confirm(`切换到低风险自动回复后，AI 将可自动处理：\n\n${L3_ACTIONS.map(item => `• ${item}`).join('\n')}\n\n报价、折扣、付款条款、交期承诺仍永远需要你确认。`);
      if (!ok) return;
    }
    setProfile(prev => ({ ...prev, strategy: { ...prev.strategy, aiAutonomy: value } }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await fetch('/api/overseas/enterprise/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profile),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally {
      setSaving(false);
    }
  };

  const applyTemplate = async () => {
    if (!templateId) return;
    setDemoBusy(true);
    try {
      const r = await fetch(`/api/overseas/enterprise/demo/templates/${templateId}/apply`, { method: 'POST' });
      const j = await r.json();
      if (j.profile) {
        const next = { ...j.profile, products: { ...DEFAULT.products, ...j.profile.products, items: normalizeProductItems({ ...DEFAULT.products, ...j.profile.products }) } };
        setProfile(next);
        setTemplateId(matchTemplateId(next, templates) || templateId);
      }
      completeDemoStep('template');
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setDemoBusy(false);
    }
  };

  const resetDemo = async () => {
    setDemoBusy(true);
    try {
      const r = await fetch('/api/overseas/enterprise/demo/reset', { method: 'POST' });
      const j = await r.json();
      if (j.profile) setProfile({ ...j.profile, products: { ...DEFAULT.products, ...j.profile.products, items: normalizeProductItems({ ...DEFAULT.products, ...j.profile.products }) } });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setDemoBusy(false);
    }
  };

  const rotateProductApiKey = async () => {
    const next = await fetch('/api/overseas/enterprise/product-api/rotate', {
      method: 'POST',
      headers: authHeader(),
    }).then(r => r.json());
    setApiInfo(next);
  };

  const importOrderCsv = async (file: File | null) => {
    if (!file) return;
    setOrderImporting(true);
    setOrderImportMessage('');
    try {
      const csv = await file.text();
      const result = await fetch('/api/overseas/enterprise/orders/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csv }),
      }).then(r => r.json());
      if (result.error) throw new Error(result.error);
      setOrderImportMessage(`已导入 ${result.imported} 条真实订单${result.skipped ? `，跳过 ${result.skipped} 条无效行` : ''}`);
    } catch (e) {
      setOrderImportMessage(e instanceof Error ? e.message : '订单导入失败，请检查 CSV 字段');
    } finally {
      setOrderImporting(false);
    }
  };

  const importProductSheet = async (file: File | null) => {
    if (!file) return;
    setProductImporting(true);
    setProductImportMessage('');
    try {
      const sheets = await parseWorkbook(file);
      const selected = sheets.slice().sort((a, b) => b.rowCount - a.rowCount)[0];
      if (!selected) throw new Error('没有读取到可导入的表格');
      const prepared = prepareSheet(selected);
      const mapping = heuristicProductMapping(prepared.headers);
      const incoming = prepared.dataRows
        .map(row => mapRowToProduct(row, mapping) as Partial<ProductItem>)
        .filter(item => item.name || item.sku)
        .map((item, index): ProductItem => ({
          name: item.name || item.sku || `导入产品${index + 1}`,
          sku: item.sku,
          color: item.color,
          size: item.size,
          tagPrice: item.tagPrice,
          material: item.material,
          imageUrl: item.imageUrl,
          priceRange: item.tagPrice,
          category: profile.products.categories,
          highlights: item.highlights,
          images: item.imageUrl ? [{ name: item.imageUrl.split('/').pop() || '商品主图', type: 'image/url', size: 0, updatedAt: new Date().toISOString(), url: item.imageUrl }] : [],
          videos: [],
          documents: [],
        }));
      if (!incoming.length) throw new Error('没有识别到有效产品行，请检查表头是否包含商品名称或 SKU');
      setProfile(prev => {
        const existing = normalizeProductItems(prev.products);
        const next = [...existing];
        for (const item of incoming) {
          const sku = item.sku?.trim();
          const index = sku ? next.findIndex(product => product.sku?.trim() === sku) : -1;
          if (index >= 0) next[index] = { ...next[index], ...item };
          else next.push(item);
        }
        return { ...prev, products: { ...prev.products, items: next } };
      });
      const skipped = prepared.dataRows.length - incoming.length;
      setProductImportMessage(`已导入 ${incoming.length} 个产品${skipped > 0 ? `，跳过 ${skipped} 行` : ''}，点击右上角保存后生效`);
    } catch (e) {
      setProductImportMessage(e instanceof Error ? e.message : '产品导入失败，请检查 CSV/XLSX 字段');
    } finally {
      setProductImporting(false);
    }
  };

  const updateProduct = (index: number, patch: Partial<ProductItem>) => {
    setProfile(prev => {
      const items = normalizeProductItems(prev.products).map((item, i) => i === index ? { ...item, ...patch } : item);
      return { ...prev, products: { ...prev.products, items } };
    });
  };

  const addProduct = () => {
    setProfile(prev => {
      const items = normalizeProductItems(prev.products);
      return { ...prev, products: { ...prev.products, items: [...items, emptyProduct(items.length)] } };
    });
  };

  const removeProduct = (index: number) => {
    setProfile(prev => {
      const items = normalizeProductItems(prev.products)
        .filter((_, i) => i !== index)
        .map((item, i) => ({ ...item, name: item.name || `产品${i + 1}` }));
      return { ...prev, products: { ...prev.products, items: items.length ? items : [emptyProduct(0)] } };
    });
  };

  const addProductAssets = async (index: number, key: ProductAssetKey, files: FileList | null) => {
    if (!files?.length) return;
    const picked = await Promise.all(Array.from(files).map(file => uploadEnterpriseAsset(file).catch(() => ({
      name: file.name,
      type: file.type || 'application/octet-stream',
      size: file.size,
      updatedAt: new Date().toISOString(),
    }))));
    setProfile(prev => {
      const items = normalizeProductItems(prev.products);
      const current = items[index]?.[key] ?? [];
      items[index] = { ...items[index], [key]: [...current, ...picked].slice(0, MAX_PRODUCT_ASSETS[key]) };
      return { ...prev, products: { ...prev.products, items } };
    });
  };

  const removeProductAsset = (index: number, key: ProductAssetKey, assetIndex: number) => {
    setProfile(prev => {
      const items = normalizeProductItems(prev.products);
      items[index] = { ...items[index], [key]: (items[index]?.[key] ?? []).filter((_, i) => i !== assetIndex) };
      return { ...prev, products: { ...prev.products, items } };
    });
  };

  const aiAutonomySection = (
    <section id="ai-autonomy" className={`rounded-lg border border-border bg-white p-5 shadow-sm transition-all ${autonomyHighlight ? 'ring-2 ring-amber-300' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-black text-text-primary">AI 参与程度</p>
          <p className="mt-1 text-[11px] leading-relaxed text-text-muted">这个设置作用于动作风险，不按客户画像放权。</p>
        </div>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-600">
          当前：{AUTONOMY_OPTIONS.find(item => item.value === (profile.strategy?.aiAutonomy ?? 'draft'))?.title}
        </span>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-3">
        {AUTONOMY_OPTIONS.map(option => {
          const active = (profile.strategy?.aiAutonomy ?? 'draft') === option.value;
          const disabled = option.value === 'auto' && !canAutoReply;
          return (
            <button
              key={option.value}
              type="button"
              title={disabled ? '需要先录入并审批至少 5 条常见问答' : undefined}
              disabled={disabled}
              onClick={() => setAutonomy(option.value)}
              className={`min-h-[118px] rounded-lg border p-3 text-left transition-all disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400 ${active ? 'border-slate-950 bg-slate-950 text-white shadow-sm' : 'border-border bg-white text-text-primary hover:border-slate-300 hover:bg-surface-2'}`}
            >
              <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full border text-[10px] font-black ${active ? 'border-white bg-white text-slate-950' : 'border-border text-text-muted'}`}>
                {active ? '✓' : ''}
              </span>
              <p className="mt-2 text-xs font-black">{option.title}</p>
              <p className={`mt-2 text-[11px] leading-5 ${active ? 'text-white/80' : disabled ? 'text-slate-400' : 'text-text-muted'}`}>{option.desc}</p>
              <p className={`text-[11px] leading-5 ${active ? 'text-white/80' : disabled ? 'text-slate-400' : 'text-text-muted'}`}>{disabled ? '需要先录入并审批至少 5 条常见问答' : option.detail}</p>
            </button>
          );
        })}
      </div>
      <p className="mt-3 rounded-lg bg-sky-50 px-3 py-2 text-[11px] font-semibold leading-relaxed text-sky-800">
        报价、折扣、付款条款、交期承诺等高风险动作仍需人工确认；报价规则未完善时，草稿不会包含具体价格。
      </p>
    </section>
  );

  const marketSection = (
    <KnowledgeCard icon={Globe2} title="目标市场与语言" purpose="决定 AI 说什么语言、按哪个时区建议联系时间" completed={completions.market}>
      <div className="space-y-4">
        <Field label="主要市场">
          <div className="flex flex-wrap gap-2">
            {MARKET_OPTIONS.map(option => <Chip key={option} active={splitTokens(profile.company.mainMarkets).includes(option)} onClick={() => toggleToken('mainMarkets', option)}>{option}</Chip>)}
          </div>
        </Field>
        <Field label="主要语言">
          <div className="flex flex-wrap gap-2">
            {LANGUAGE_OPTIONS.map(option => <Chip key={option} active={splitTokens(profile.company.primaryLanguages).includes(option)} onClick={() => toggleToken('primaryLanguages', option)}>{option}</Chip>)}
          </div>
        </Field>
      </div>
    </KnowledgeCard>
  );

  const companySection = (
    <KnowledgeCard icon={Building2} title="公司介绍" purpose="AI 开场白和自我介绍的素材" completed={completions.company} stat={`${profile.company.description.trim().length}/50 字`}>
      <div className="grid grid-cols-2 gap-4">
        <Field label="公司名称">
          <input className={inputCls} value={profile.company.name} onChange={e => set('company')('name', e.target.value)} placeholder="示例贸易有限公司" />
        </Field>
        <Field label="行业类目">
          <input className={inputCls} value={profile.company.industry} onChange={e => set('company')('industry', e.target.value)} placeholder="跨境电商 / 消费品" />
        </Field>
        <Field label="企业类型">
          <input className={inputCls} value={profile.company.companyType ?? ''} onChange={e => set('company')('companyType', e.target.value)} placeholder="工厂 / 工贸一体 / 贸易商" />
        </Field>
        <Field label="成立年份">
          <input className={inputCls} value={profile.company.founded} onChange={e => set('company')('founded', e.target.value)} placeholder="2018" />
        </Field>
      </div>
      <Field label="公司简介">
        <textarea className={textareaCls} rows={4} value={profile.company.description} onChange={e => set('company')('description', e.target.value)} placeholder="介绍公司背景、主营品类、供应链优势、交付能力和海外服务经验。" />
      </Field>
    </KnowledgeCard>
  );

  const notificationSettingsSection = (
    <div id="notifications" className={`rounded-lg border border-border bg-surface-2/40 p-4 transition-all ${notificationsHighlight ? 'ring-2 ring-sky-300' : ''}`}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Bell size={14} className="text-text-secondary" />
          <h3 className="text-sm font-black text-text-primary">通知接收方式</h3>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-black ${notificationCompleted ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
          {notificationCompleted ? '已完成' : '未完成'}
        </span>
      </div>
      <p className="mb-4 text-[11px] leading-relaxed text-text-muted">大单、客户要通话时，提醒发给谁</p>
      <div className="space-y-3">
        {(profile.notifications?.receivers ?? []).map((receiver, index) => (
          <div key={index} className="grid grid-cols-[1fr_130px_1.3fr_auto_auto] gap-2 rounded-lg border border-border bg-white p-3">
            <input className={inputCls} value={receiver.name} onChange={e => updateReceiver(index, { name: e.target.value })} placeholder="接收人姓名" />
            <select className={inputCls} value={receiver.channel} onChange={e => updateReceiver(index, { channel: e.target.value as NotificationChannel })}>
              {CHANNEL_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <input className={inputCls} value={receiver.target} onChange={e => updateReceiver(index, { target: e.target.value })} placeholder="Webhook / 手机号 / 账号" />
            <button type="button" onClick={() => void testReceiver(receiver, index)} disabled={notificationTesting === String(index)} className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-slate-950 px-3 py-2 text-xs font-bold text-white disabled:opacity-60">
              {notificationTesting === String(index) ? <Loader2 size={12} className="animate-spin" /> : <Bell size={12} />}测试
            </button>
            <button type="button" onClick={() => removeReceiver(index)} className="rounded-lg border border-border bg-white px-2 text-text-muted hover:text-red"><X size={13} /></button>
          </div>
        ))}
        <button type="button" onClick={addReceiver} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-xs font-bold text-text-secondary hover:bg-surface-2">
          <Plus size={12} />添加接收人
        </button>
        {notificationMessage && <p className="text-xs font-bold text-emerald-700">{notificationMessage}</p>}
      </div>
      <div className="mt-4 grid grid-cols-3 gap-4">
        <Field label="工作开始时间">
          <input className={inputCls} type="time" value={profile.notifications?.workHours.start ?? '09:00'} onChange={e => setProfile(prev => ({ ...prev, notifications: { ...(prev.notifications ?? DEFAULT.notifications!), workHours: { ...(prev.notifications?.workHours ?? DEFAULT.notifications!.workHours), start: e.target.value } } }))} />
        </Field>
        <Field label="工作结束时间">
          <input className={inputCls} type="time" value={profile.notifications?.workHours.end ?? '22:00'} onChange={e => setProfile(prev => ({ ...prev, notifications: { ...(prev.notifications ?? DEFAULT.notifications!), workHours: { ...(prev.notifications?.workHours ?? DEFAULT.notifications!.workHours), end: e.target.value } } }))} />
        </Field>
        <Field label="非工作时段">
          <div className="flex h-10 items-center gap-2 rounded-lg border border-border bg-white px-3">
            <Toggle checked={profile.notifications?.quietOutsideHours ?? true} onChange={checked => setProfile(prev => ({ ...prev, notifications: { ...(prev.notifications ?? DEFAULT.notifications!), quietOutsideHours: checked } }))} />
            <span className="text-xs text-text-secondary">仅记录不即时推送</span>
          </div>
        </Field>
      </div>
    </div>
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 size={20} className="text-text-muted animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-surface-2">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-white px-5">
        <div className="flex items-center gap-2.5">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
            <Building2 size={14} />
          </span>
          <span className="text-sm font-black text-text-primary">企业中心</span>
        </div>
        <motion.button
          whileTap={{ scale: 0.96 }}
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold text-white transition-all disabled:opacity-60"
          style={{ background: saved ? '#16a34a' : '#0f172a' }}
        >
          {saving ? <Loader2 size={12} className="animate-spin" /> : saved ? <CheckCircle2 size={12} /> : <Save size={12} />}
          {saved ? '已保存' : '保存'}
        </motion.button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-5 px-6 py-6">
          <section className="rounded-lg border border-border bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-black text-text-primary">企业知识库完成度 {completedCount}/6</p>
                <p className="mt-1 text-[11px] text-text-muted">资料越全，AI 回复越有分寸</p>
              </div>
              <span className="rounded-full bg-surface-2 px-3 py-1 text-xs font-black text-text-secondary">{progressPercent}%</span>
            </div>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-surface-2">
              <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${progressPercent}%` }} />
            </div>
          </section>

          <div className="rounded-lg border border-border bg-white p-4">
            <div className="flex items-start gap-3">
              <BookOpen size={15} className="mt-0.5 shrink-0 text-accent" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold text-text-primary">全局知识注入</p>
                <p className="mt-1 text-[11px] leading-relaxed text-text-muted">以下资料会进入客户回复、内容创作、交付提醒等 Agent 的上下文。</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {AGENTS.map(({ icon: Icon, label, color }) => (
                    <span key={label} className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium" style={{ background: `${color}12`, color }}>
                      <Icon size={11} />{label}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {aiAutonomySection}
          {marketSection}
          {companySection}

          <KnowledgeCard
            icon={Package}
            title="产品资料"
            purpose="AI 报价、推荐、生成视频的原料"
            completed={completions.products}
            stat={`已录入 ${products.length} 个产品 · ${assetStats.withImage} 个有主图`}
          >
            {missingImageRatio > 0.5 && (
              <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">缺少图片的产品无法生成视频</p>
            )}
            <div className="mb-4 grid grid-cols-2 gap-4">
              <Field label="主营品类">
                <input className={inputCls} value={profile.products.categories} onChange={e => set('products')('categories', e.target.value)} placeholder="美妆个护、家居日用、消费电子" />
              </Field>
              <Field label="认证资质">
                <input className={inputCls} value={profile.products.certifications} onChange={e => set('products')('certifications', e.target.value)} placeholder="CE、FDA、SGS" />
              </Field>
            </div>
            <Field label="产品核心优势">
              <textarea className={textareaCls} rows={2} value={profile.products.highlights} onChange={e => set('products')('highlights', e.target.value)} placeholder="工厂直供、支持 OEM/ODM、备货稳定" />
            </Field>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-xs font-bold text-text-secondary hover:bg-surface-2">
                {productImporting ? <Loader2 size={12} className="animate-spin" /> : <FileSpreadsheet size={12} />}
                导入产品表
                <input type="file" accept=".xlsx,.xls,.csv" className="hidden" disabled={productImporting} onChange={e => { void importProductSheet(e.currentTarget.files?.[0] ?? null); e.currentTarget.value = ''; }} />
              </label>
              <button type="button" onClick={addProduct} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-950 px-3 py-2 text-xs font-bold text-white">
                <Plus size={12} />添加产品
              </button>
              {productImportMessage && <span className="text-[11px] font-bold text-emerald-700">{productImportMessage}</span>}
            </div>
            <div className="mt-4 space-y-3">
              {products.map((product, index) => (
                <div key={index} className="rounded-lg border border-border bg-surface-2/50 p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <p className="text-xs font-black text-text-primary">产品 {index + 1}</p>
                    <button type="button" onClick={() => removeProduct(index)} className="rounded-md p-1 text-text-muted hover:bg-white hover:text-red" title="删除产品"><X size={13} /></button>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="产品名称">
                      <input className={inputCls} value={product.name} onChange={e => updateProduct(index, { name: e.target.value })} placeholder={`产品${index + 1}`} />
                    </Field>
                    <Field label="产品类目">
                      <input className={inputCls} value={product.category ?? ''} onChange={e => updateProduct(index, { category: e.target.value })} placeholder="所属品类 / 系列" />
                    </Field>
                    <Field label="参考价或标签价">
                      <input className={inputCls} value={product.priceRange ?? product.tagPrice ?? ''} onChange={e => updateProduct(index, { priceRange: e.target.value })} placeholder="$5 - $500 USD" />
                    </Field>
                    <Field label="起订量">
                      <input className={inputCls} value={product.moq ?? ''} onChange={e => updateProduct(index, { moq: e.target.value })} placeholder="50 件起，支持混批" />
                    </Field>
                  </div>
                  <Field label="产品卖点">
                    <textarea className={textareaCls} rows={2} value={product.highlights ?? ''} onChange={e => updateProduct(index, { highlights: e.target.value })} placeholder="核心卖点、适用场景、可定制项、交付优势" />
                  </Field>
                </div>
              ))}
              {!products.length && <p className="rounded-lg bg-surface-2 px-3 py-3 text-xs text-text-muted">还没有产品，先添加一个产品或导入产品表。</p>}
            </div>
          </KnowledgeCard>

          <KnowledgeCard
            icon={Image}
            title="素材库"
            purpose="AI 创作室的剪辑素材来源"
            completed={completions.materials}
            stat={`${assetStats.images} 张图 · ${assetStats.videos} 个视频 · ${assetStats.documents} 份文书`}
          >
            <div className="space-y-3">
              {products.map((product, index) => {
                const groups = [
                  { key: 'images' as const, label: '产品图', limit: MAX_PRODUCT_ASSETS.images, accept: 'image/*', icon: Image, assets: product.images ?? [] },
                  { key: 'videos' as const, label: '视频', limit: MAX_PRODUCT_ASSETS.videos, accept: 'video/*', icon: Video, assets: product.videos ?? [] },
                  { key: 'documents' as const, label: '资质文书', limit: MAX_PRODUCT_ASSETS.documents, accept: '.pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg', icon: FileText, assets: product.documents ?? [] },
                ];
                return (
                  <div key={index} className="rounded-lg border border-border bg-surface-2/40 p-3">
                    <p className="mb-3 text-xs font-black text-text-primary">{product.name || `产品${index + 1}`}</p>
                    <div className="grid grid-cols-3 gap-3">
                      {groups.map(({ key, label, limit, accept, icon: Icon, assets }) => (
                        <div key={key} className="min-w-0 rounded-lg border border-border bg-white p-3">
                          <div className="mb-2 flex items-center justify-between gap-2">
                            <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-text-secondary"><Icon size={12} />{label}</span>
                            <span className="text-[10px] text-text-muted">{assets.length}/{limit}</span>
                          </div>
                          <label className={`flex h-8 items-center justify-center gap-1.5 rounded-md border border-dashed text-[11px] font-bold ${assets.length >= limit ? 'cursor-not-allowed bg-surface-2 text-text-muted' : 'cursor-pointer text-text-secondary hover:border-border-bright hover:text-text-primary'}`}>
                            <Upload size={12} />上传
                            <input className="hidden" type="file" multiple accept={accept} disabled={assets.length >= limit} onChange={e => { addProductAssets(index, key, e.currentTarget.files); e.currentTarget.value = ''; }} />
                          </label>
                          <div className="mt-2 space-y-1">
                            {assets.map((asset, assetIndex) => (
                              <div key={`${asset.name}-${assetIndex}`} className="flex min-w-0 items-center gap-1.5 text-[10px] text-text-secondary">
                                {asset.url ? <a href={asset.url} target="_blank" rel="noreferrer" className="flex-1 truncate hover:text-text-primary">{asset.name}</a> : <span className="flex-1 truncate">{asset.name}</span>}
                                <span className="shrink-0 text-text-muted">{formatSize(asset.size)}</span>
                                <button type="button" onClick={() => removeProductAsset(index, key, assetIndex)} className="shrink-0 rounded p-0.5 text-text-muted hover:text-red"><X size={10} /></button>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </KnowledgeCard>

          <KnowledgeCard id="biz-rules" icon={ShieldCheck} title="报价与业务规则" purpose="决定 AI 回复客户时的分寸——它能说什么、不能说什么" completed={completions.bizRules} highlight={bizRulesHighlight}>
            {!completions.bizRules && <p className="mb-4 rounded-lg bg-sky-50 px-3 py-2 text-xs font-bold text-sky-800">完善报价规则后，AI 才能帮你答价格。</p>}
            <div className="space-y-4">
              <Field label="客户问价格时，AI 可以：">
                <div className="flex flex-wrap gap-2">
                  {[
                    { value: 'range' as QuoteMode, label: '报一个区间' },
                    { value: 'human_only' as QuoteMode, label: "一律说'稍后报价'等人工" },
                  ].map(option => (
                    <button key={option.value} type="button" onClick={() => setBizRule('quoteMode', option.value)} className={`rounded-lg border px-3 py-2 text-xs font-bold ${profile.bizRules?.quoteMode === option.value ? 'border-slate-950 bg-slate-950 text-white' : 'border-border bg-white text-text-secondary'}`}>
                      {option.label}
                    </button>
                  ))}
                </div>
              </Field>
              <div className="grid grid-cols-2 gap-4">
                <Field label="如果允许报区间，AI 应使用这段价格说明">
                  <input className={inputCls} value={profile.bizRules?.priceRange ?? ''} onChange={e => setBizRule('priceRange', e.target.value)} placeholder="$5 - $500 USD，按数量和规格确认" />
                </Field>
                <Field label="客户问 MOQ 时，AI 应怎么说">
                  <input className={inputCls} value={profile.bizRules?.moq ?? ''} onChange={e => setBizRule('moq', e.target.value)} placeholder="常规 50 件起，支持混批" />
                </Field>
                <Field label="样品是否免费、运费谁出">
                  <input className={inputCls} value={profile.bizRules?.samplePolicy ?? ''} onChange={e => setBizRule('samplePolicy', e.target.value)} placeholder="样品可付费申请，运费由买家承担" />
                </Field>
                <Field label="付款方式和节点">
                  <input className={inputCls} value={profile.bizRules?.paymentTerms ?? ''} onChange={e => setBizRule('paymentTerms', e.target.value)} placeholder="T/T 30% 预付，尾款出货前结清" />
                </Field>
                <Field label="交期怎么表述">
                  <input className={inputCls} value={profile.bizRules?.leadTime ?? ''} onChange={e => setBizRule('leadTime', e.target.value)} placeholder="样品 3-7 天，大货 20-35 天" />
                </Field>
                <Field label="议价底线说明">
                  <input className={inputCls} value={profile.bizRules?.bargainFloor ?? ''} onChange={e => setBizRule('bargainFloor', e.target.value)} placeholder="可小幅让利，但不承诺低于成本线" />
                </Field>
              </div>
              <Field label="客户还价时，AI 可以：">
                <div className="flex flex-wrap gap-2">
                  {[
                    { value: 'no' as BargainPolicy, label: '不议价' },
                    { value: 'limited' as BargainPolicy, label: '有限让步' },
                    { value: 'open' as BargainPolicy, label: '开放协商' },
                  ].map(option => (
                    <button key={option.value} type="button" onClick={() => setBizRule('bargainPolicy', option.value)} className={`rounded-lg border px-3 py-2 text-xs font-bold ${profile.bizRules?.bargainPolicy === option.value ? 'border-slate-950 bg-slate-950 text-white' : 'border-border bg-white text-text-secondary'}`}>
                      {option.label}
                    </button>
                  ))}
                </div>
              </Field>
            </div>
          </KnowledgeCard>

          <KnowledgeCard icon={BookOpen} title="常见问答" purpose="客户问到这些，AI 直接用你的标准答案回复" completed={completions.faq} stat={`${profile.faq?.length ?? 0} 条 · ${approvedFaqCount} 条已审批`}>
            {profile.customers?.commonQuestions?.trim() && !(profile.faq ?? []).length && (
              <div className="mb-4 rounded-lg border border-sky-200 bg-sky-50 p-3">
                <p className="text-xs font-bold text-sky-900">检测到旧版问答内容，让 AI 帮你整理成问答条目？</p>
                <button type="button" onClick={structureLegacyFaq} disabled={faqStructuring} className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-60">
                  {faqStructuring ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />}整理旧版内容
                </button>
              </div>
            )}
            {faqPreview.length > 0 && (
              <div className="mb-4 rounded-lg border border-border bg-surface-2 p-3">
                <p className="text-xs font-black text-text-primary">结构化预览</p>
                <div className="mt-2 space-y-2">
                  {faqPreview.map(item => <p key={item.id} className="text-xs text-text-secondary">Q：{item.question}<br />A：{item.answer}</p>)}
                </div>
                <div className="mt-3 flex gap-2">
                  <button type="button" onClick={importFaqPreview} className="rounded-lg bg-slate-950 px-3 py-2 text-xs font-bold text-white">确认导入</button>
                  <button type="button" onClick={() => setFaqPreview([])} className="rounded-lg border border-border bg-white px-3 py-2 text-xs font-bold text-text-secondary">取消</button>
                </div>
              </div>
            )}
            <div className="mb-4 flex justify-between gap-3">
              <p className="text-xs text-text-muted">关闭自动回复时，AI 只写草稿等你确认。</p>
              <button type="button" onClick={addFaq} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-950 px-3 py-2 text-xs font-bold text-white"><Plus size={12} />添加问答</button>
            </div>
            <div className="space-y-3">
              {(profile.faq ?? []).map((item, index) => (
                <details key={item.id} className="rounded-lg border border-border bg-surface-2/50 p-3" open={index === 0}>
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
                    <input className={`${inputCls} flex-1`} value={item.question} onChange={e => updateFaq(item.id, { question: e.target.value })} placeholder="客户会怎么问？" />
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-text-muted">允许 AI 自动回复</span>
                      <Toggle checked={item.approvedForAuto} onChange={checked => updateFaq(item.id, { approvedForAuto: checked })} />
                      <button type="button" onClick={(event) => { event.preventDefault(); removeFaq(item.id); }} className="rounded-md p-1 text-text-muted hover:text-red"><X size={13} /></button>
                    </div>
                  </summary>
                  <textarea className={`${textareaCls} mt-3`} rows={3} value={item.answer} onChange={e => updateFaq(item.id, { answer: e.target.value })} placeholder="标准答案" />
                </details>
              ))}
              {!(profile.faq ?? []).length && <p className="rounded-lg bg-surface-2 px-3 py-3 text-xs text-text-muted">还没有问答，先添加 5 条常见问题。</p>}
            </div>
          </KnowledgeCard>

          <section className="rounded-lg border border-border bg-white shadow-sm">
            <button type="button" onClick={() => setAdvancedOpen(open => !open)} className="flex w-full items-center justify-between px-5 py-4 text-left">
              <span>
                <span className="block text-sm font-black text-text-primary">高级设置</span>
                <span className="mt-1 block text-[11px] text-text-muted">经营策略、品牌调性、Agent 学习记录</span>
              </span>
              <ChevronDown size={16} className={`text-text-muted transition-transform ${advancedOpen ? 'rotate-180' : ''}`} />
            </button>
            {advancedOpen && (
              <div className="space-y-5 border-t border-border p-5">
                {notificationSettingsSection}

                <div className="rounded-lg border border-border bg-surface-2/40 p-4">
                  <div className="mb-3 flex items-center gap-2"><Compass size={14} className="text-text-secondary" /><h3 className="text-sm font-black text-text-primary">经营策略</h3></div>
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="当前阶段目标"><input className={inputCls} value={profile.strategy?.currentGoal ?? ''} onChange={e => set('strategy')('currentGoal', e.target.value)} /></Field>
                    <Field label="本期重点产品"><input className={inputCls} value={profile.strategy?.focusProducts ?? ''} onChange={e => set('strategy')('focusProducts', e.target.value)} /></Field>
                    <Field label="重点市场"><input className={inputCls} value={profile.strategy?.focusMarkets ?? ''} onChange={e => set('strategy')('focusMarkets', e.target.value)} /></Field>
                    <Field label="暂不经营市场"><input className={inputCls} value={profile.strategy?.excludedMarkets ?? ''} onChange={e => set('strategy')('excludedMarkets', e.target.value)} /></Field>
                    <Field label="最低利润率"><input className={inputCls} value={profile.strategy?.minMargin ?? ''} onChange={e => set('strategy')('minMargin', e.target.value)} /></Field>
                    <Field label="Agent 权限"><input className={inputCls} value={profile.strategy?.agentAutonomy ?? ''} onChange={e => set('strategy')('agentAutonomy', e.target.value)} /></Field>
                  </div>
                  <Field label="价格策略"><textarea className={textareaCls} rows={2} value={profile.strategy?.pricingStrategy ?? ''} onChange={e => set('strategy')('pricingStrategy', e.target.value)} /></Field>
                </div>

                <div className="rounded-lg border border-border bg-surface-2/40 p-4">
                  <div className="mb-3 flex items-center gap-2"><Megaphone size={14} className="text-text-secondary" /><h3 className="text-sm font-black text-text-primary">品牌调性</h3></div>
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="品牌调性关键词"><input className={inputCls} value={profile.brand.tone} onChange={e => set('brand')('tone', e.target.value)} /></Field>
                    <Field label="沟通风格"><input className={inputCls} value={profile.brand.style} onChange={e => set('brand')('style', e.target.value)} /></Field>
                    <Field label="首选输出语言"><input className={inputCls} value={profile.brand.preferredLanguages ?? ''} onChange={e => set('brand')('preferredLanguages', e.target.value)} /></Field>
                    <Field label="核心卖点"><input className={inputCls} value={profile.brand.usp} onChange={e => set('brand')('usp', e.target.value)} /></Field>
                  </div>
                  <Field label="禁忌话题"><input className={inputCls} value={profile.brand.taboos} onChange={e => set('brand')('taboos', e.target.value)} /></Field>
                </div>

                <div className="rounded-lg border border-border bg-surface-2/40 p-4">
                  <div className="mb-3 flex items-center gap-2"><BookOpen size={14} className="text-text-secondary" /><h3 className="text-sm font-black text-text-primary">Agent 学习记录</h3></div>
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="已验证有效角度"><textarea className={textareaCls} rows={2} value={profile.agentLearning?.provenAngles ?? ''} onChange={e => set('agentLearning')('provenAngles', e.target.value)} /></Field>
                    <Field label="低效角度 / 需降权"><textarea className={textareaCls} rows={2} value={profile.agentLearning?.weakAngles ?? ''} onChange={e => set('agentLearning')('weakAngles', e.target.value)} /></Field>
                    <Field label="待确认推断"><textarea className={textareaCls} rows={2} value={profile.agentLearning?.pendingAssumptions ?? ''} onChange={e => set('agentLearning')('pendingAssumptions', e.target.value)} /></Field>
                    <Field label="用户纠正偏好"><textarea className={textareaCls} rows={2} value={profile.agentLearning?.userCorrections ?? ''} onChange={e => set('agentLearning')('userCorrections', e.target.value)} /></Field>
                  </div>
                  <Field label="自由填写"><textarea className={textareaCls} rows={5} value={profile.knowledge} onChange={e => setProfile(prev => ({ ...prev, knowledge: e.target.value }))} /></Field>
                </div>

                <div className="rounded-lg border border-border bg-surface-2/40 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <select className={inputCls} value={templateId} onChange={e => setTemplateId(e.target.value)}>
                      <option value="">选择模板并加载</option>
                      {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                    <button data-demo-target="template" onClick={applyTemplate} disabled={!templateId || demoBusy} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-950 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">
                      {demoBusy ? <Loader2 size={12} className="animate-spin" /> : <BookOpen size={12} />}加载模板
                    </button>
                    <button onClick={resetDemo} disabled={demoBusy} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-xs font-bold text-text-secondary disabled:opacity-50">
                      <RotateCcw size={12} />重置
                    </button>
                    <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-xs font-bold text-text-secondary">
                      {orderImporting ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}上传订单 CSV
                      <input type="file" accept=".csv,text/csv" className="hidden" disabled={orderImporting} onChange={e => { const file = e.target.files?.[0] || null; e.currentTarget.value = ''; void importOrderCsv(file); }} />
                    </label>
                  </div>
                  {orderImportMessage && <p className="mt-2 text-[11px] font-bold text-emerald-700">{orderImportMessage}</p>}
                </div>
              </div>
            )}
          </section>

          <div className="h-4" />
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="h-12 flex items-center justify-between px-5 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-6 h-6 rounded-lg flex items-center justify-center" style={{ background: 'rgba(22,163,74,0.1)', color: '#16a34a' }}>
            <Building2 size={13} />
          </div>
          <span className="text-sm font-semibold text-text-primary">企业中心</span>
        </div>
        <motion.button
          whileTap={{ scale: 0.96 }}
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-all disabled:opacity-60"
          style={{ background: saved ? '#16a34a' : '#0f172a' }}
        >
          {saving ? <Loader2 size={12} className="animate-spin" /> : saved ? <CheckCircle2 size={12} /> : <Save size={12} />}
          {saved ? '已保存' : '保存'}
        </motion.button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-6 py-6 space-y-6">

          {/* Injection banner */}
          <div className="rounded-xl border border-border bg-surface p-4 flex items-start gap-3">
            <BookOpen size={15} className="text-accent flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-text-primary mb-2">全局知识注入</p>
              <p className="text-[11px] text-text-muted mb-3">以下信息将自动注入所有 Agent 的上下文，让回答更贴合你的真实业务。</p>
              <div className="flex flex-wrap gap-2">
                {AGENTS.map(({ icon: Icon, label, color }) => (
                  <span key={label} className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-medium" style={{ background: `${color}12`, color }}>
                    <Icon size={11} />{label}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <section className="card p-4">
            <div className="flex items-start gap-3">
              <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-green-50 text-green-700">
                <FileSpreadsheet size={16} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold text-text-primary">产品数据导入</p>
                    <p className="mt-1 text-[11px] leading-relaxed text-text-muted">上传本地商品表，或给 ERP 服务商使用 API 批量 upsert、查询、删除。</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="inline-flex cursor-pointer items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border text-xs font-semibold text-text-secondary hover:text-text-primary">
                      {productImporting ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
                      上传产品表
                      <input
                        type="file"
                        accept=".xlsx,.xls,.csv"
                        className="hidden"
                        disabled={productImporting}
                        onChange={e => {
                          void importProductSheet(e.currentTarget.files?.[0] ?? null);
                          e.currentTarget.value = '';
                        }}
                      />
                    </label>
                    <button type="button" onClick={rotateProductApiKey}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border text-xs font-semibold text-text-secondary hover:text-text-primary">
                      重置Key
                    </button>
                  </div>
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded-lg border border-border bg-white px-3 py-2 text-xs text-text-primary">{apiInfo?.apiKey || '正在生成...'}</code>
                  <button type="button" onClick={() => apiInfo?.apiKey && navigator.clipboard?.writeText(apiInfo.apiKey)}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-950 text-xs font-semibold text-white">
                    <Copy size={12} />复制
                  </button>
                </div>
                {productImportMessage && <p className="mt-2 text-[11px] font-semibold text-green-700">{productImportMessage}</p>}
                <p className="mt-2 text-[11px] text-text-muted">已接入商品：{apiStatus.count}{apiStatus.lastIngestedAt ? ` · 最近接入 ${apiStatus.lastProductName || '商品'}` : ''}</p>
              </div>
            </div>
          </section>

          <section className="card p-4">
            <div className="flex items-start gap-3">
              <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-green-50 text-green-700">
                <FileText size={16} />
              </span>
              <div className="min-w-0 flex-1">
                <div>
                  <p className="text-xs font-semibold text-text-primary">订单数据导入</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-text-muted">上传 ERP、Shopify、财务表或人工整理的 CSV。我的订单页只基于导入/录入的真实订单聚合 GMV、毛利和履约状态。</p>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-slate-950 px-3 py-2 text-xs font-semibold text-white">
                    {orderImporting ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
                    上传订单 CSV
                    <input type="file" accept=".csv,text/csv" className="hidden" disabled={orderImporting}
                      onChange={e => {
                        const file = e.target.files?.[0] || null;
                        e.currentTarget.value = '';
                        void importOrderCsv(file);
                      }} />
                  </label>
                  <span className="text-[11px] text-text-muted">必填：客户名称、商品/SKU、GMV；建议填写来源和来源凭证。</span>
                </div>
                {orderImportMessage && <p className="mt-2 text-[11px] font-semibold text-green-700">{orderImportMessage}</p>}
              </div>
            </div>
          </section>

          <section className="card p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-text-primary">测试号行业模板</p>
                <p className="text-[11px] text-text-muted mt-0.5">可主动选择 A 美妆、B 灯具、C 小家电三套企业画像；未选择时不会自动套模板。</p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <select className={inputCls} value={templateId} onChange={e => setTemplateId(e.target.value)}>
                  <option value="">选择模板并加载</option>
                  {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
                <button data-demo-target="template" onClick={applyTemplate} disabled={!templateId || demoBusy}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-white disabled:opacity-50"
                  style={{ background: '#0f172a' }}>
                  {demoBusy ? <Loader2 size={12} className="animate-spin" /> : <BookOpen size={12} />}加载
                </button>
                <button onClick={resetDemo} disabled={demoBusy}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border border-border text-text-secondary hover:text-text-primary disabled:opacity-50">
                  <RotateCcw size={12} />重置
                </button>
              </div>
            </div>
          </section>

          <section id="ai-autonomy" className={`card p-5 transition-all ${autonomyHighlight ? 'ring-2 ring-amber-300' : ''}`}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-text-primary">AI 参与程度</p>
                <p className="mt-1 text-[11px] leading-relaxed text-text-muted">这个设置作用于动作风险，不按客户画像放权。</p>
              </div>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-600">
                当前：{AUTONOMY_OPTIONS.find(item => item.value === (profile.strategy?.aiAutonomy ?? 'draft'))?.title}
              </span>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-3">
              {AUTONOMY_OPTIONS.map(option => {
                const active = (profile.strategy?.aiAutonomy ?? 'draft') === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setAutonomy(option.value)}
                    className={`min-h-[118px] rounded-lg border p-3 text-left transition-all ${active ? 'border-slate-950 bg-slate-950 text-white shadow-sm' : 'border-border bg-white text-text-primary hover:border-slate-300 hover:bg-surface-2'}`}
                  >
                    <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full border text-[10px] font-black ${active ? 'border-white bg-white text-slate-950' : 'border-border text-text-muted'}`}>
                      {active ? '✓' : ''}
                    </span>
                    <p className="mt-2 text-xs font-black">{option.title}</p>
                    <p className={`mt-2 text-[11px] leading-5 ${active ? 'text-white/80' : 'text-text-muted'}`}>{option.desc}</p>
                    <p className={`text-[11px] leading-5 ${active ? 'text-white/80' : 'text-text-muted'}`}>{option.detail}</p>
                  </button>
                );
              })}
            </div>
            <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-[11px] font-semibold leading-relaxed text-red-700">
              无论选择哪档：报价、折扣、付款条款、交期承诺，AI 永远不会替你决定。
            </p>
          </section>

          {/* Company Info */}
          <section className="card p-5 space-y-4">
            <div className="flex items-center gap-2 mb-1">
              <Building2 size={14} className="text-text-secondary" />
              <h3 className="text-sm font-semibold text-text-primary">公司信息</h3>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label="公司名称">
                <input className={inputCls} placeholder="示例贸易有限公司" value={profile.company.name}
                  onChange={e => set('company')('name', e.target.value)} />
              </Field>
              <Field label="行业类目">
                <input className={inputCls} placeholder="跨境电商 / 消费品" value={profile.company.industry}
                  onChange={e => set('company')('industry', e.target.value)} />
              </Field>
              <Field label="企业类型">
                <input className={inputCls} placeholder="工厂 / 工贸一体 / 贸易商 / 品牌商" value={profile.company.companyType ?? ''}
                  onChange={e => set('company')('companyType', e.target.value)} />
              </Field>
              <Field label="主攻市场">
                <input className={inputCls} placeholder="中东、东南亚、北美" value={profile.company.mainMarkets}
                  onChange={e => set('company')('mainMarkets', e.target.value)} />
              </Field>
              <Field label="主要语言">
                <input className={inputCls} placeholder="英语、阿拉伯语、西班牙语" value={profile.company.primaryLanguages ?? ''}
                  onChange={e => set('company')('primaryLanguages', e.target.value)} />
              </Field>
              <Field label="成立年份">
                <input className={inputCls} placeholder="2018" value={profile.company.founded}
                  onChange={e => set('company')('founded', e.target.value)} />
              </Field>
            </div>
            <Field label="公司简介" hint="一段话描述公司背景、优势、定位">
              <textarea className={textareaCls} rows={3} placeholder="我们是一家专注海外市场的跨境电商品牌，主营美妆个护、家居日用、消费电子，在 TikTok 和 WhatsApp 有稳定私域流量…"
                value={profile.company.description} onChange={e => set('company')('description', e.target.value)} />
            </Field>
          </section>

          {/* Strategy */}
          <section className="card p-5 space-y-4">
            <div className="flex items-center gap-2 mb-1">
              <Compass size={14} className="text-text-secondary" />
              <h3 className="text-sm font-semibold text-text-primary">经营策略</h3>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label="当前阶段目标">
                <input className={inputCls} placeholder="拿询盘 / 提转化 / 推新品 / 提利润" value={profile.strategy?.currentGoal ?? ''}
                  onChange={e => set('strategy')('currentGoal', e.target.value)} />
              </Field>
              <Field label="本期重点产品">
                <input className={inputCls} placeholder="精华液套装、LED 吊灯、空气炸锅…" value={profile.strategy?.focusProducts ?? ''}
                  onChange={e => set('strategy')('focusProducts', e.target.value)} />
              </Field>
              <Field label="重点市场">
                <input className={inputCls} placeholder="美国、沙特、德国" value={profile.strategy?.focusMarkets ?? ''}
                  onChange={e => set('strategy')('focusMarkets', e.target.value)} />
              </Field>
              <Field label="暂不经营市场">
                <input className={inputCls} placeholder="高退货率或合规风险市场" value={profile.strategy?.excludedMarkets ?? ''}
                  onChange={e => set('strategy')('excludedMarkets', e.target.value)} />
              </Field>
              <Field label="最低利润率">
                <input className={inputCls} placeholder="建议 >= 28%" value={profile.strategy?.minMargin ?? ''}
                  onChange={e => set('strategy')('minMargin', e.target.value)} />
              </Field>
              <Field label="Agent 权限">
                <input className={inputCls} placeholder="建议优先，关键动作需确认" value={profile.strategy?.agentAutonomy ?? ''}
                  onChange={e => set('strategy')('agentAutonomy', e.target.value)} />
              </Field>
            </div>
            <Field label="价格策略" hint="帮助广告、询盘、商品 Agent 判断怎么报价和表达价值">
              <textarea className={textareaCls} rows={2} placeholder="中高端定位，不走 lowest price；样品单可少量让利，大货保持利润。"
                value={profile.strategy?.pricingStrategy ?? ''} onChange={e => set('strategy')('pricingStrategy', e.target.value)} />
            </Field>
          </section>

          {/* Customers */}
          <section className="card p-5 space-y-4">
            <div className="flex items-center gap-2 mb-1">
              <MessageSquare size={14} className="text-text-secondary" />
              <h3 className="text-sm font-semibold text-text-primary">客户画像</h3>
            </div>
            <Field label="目标客户" hint="客户类型、采购目的、常见国家、预算区间">
              <textarea className={textareaCls} rows={2} value={profile.customers?.targetProfiles ?? ''}
                onChange={e => set('customers')('targetProfiles', e.target.value)} placeholder="海外品牌商、批发商、连锁零售采购；关注稳定供货、认证和可定制包装。" />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="高价值客户信号">
                <textarea className={textareaCls} rows={2} value={profile.customers?.highValueSignals ?? ''}
                  onChange={e => set('customers')('highValueSignals', e.target.value)} placeholder="询问认证、配方/规格、包装定制、复购节奏、目标上架渠道。" />
              </Field>
              <Field label="低质量询盘特征">
                <textarea className={textareaCls} rows={2} value={profile.customers?.lowQualitySignals ?? ''}
                  onChange={e => set('customers')('lowQualitySignals', e.target.value)} placeholder="只问最低价、MOQ 低于底线、无公司信息、要求未认证功效。" />
              </Field>
            </div>
            <Field label="常见问题与跟进偏好">
              <textarea className={textareaCls} rows={3} value={[profile.customers?.commonQuestions, profile.customers?.followupStyle].filter(Boolean).join('\n')}
                onChange={e => {
                  const [commonQuestions = '', ...rest] = e.target.value.split('\n');
                  setProfile(prev => ({ ...prev, customers: { ...prev.customers, commonQuestions, followupStyle: rest.join('\n') } }));
                }} placeholder={"常问：样品费、交期、认证文件、包装设计支持\n跟进：报价后第 2 天提醒，强调库存和打样档期"} />
            </Field>
          </section>

          {/* Operations */}
          <section className="card p-5 space-y-4">
            <div className="flex items-center gap-2 mb-1">
              <Zap size={14} className="text-text-secondary" />
              <h3 className="text-sm font-semibold text-text-primary">履约与运营约束</h3>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label="交期能力">
                <input className={inputCls} placeholder="样品 3-7 天，大货 20-35 天" value={profile.operations?.leadTime ?? ''}
                  onChange={e => set('operations')('leadTime', e.target.value)} />
              </Field>
              <Field label="定制能力">
                <input className={inputCls} placeholder="OEM/ODM、包装、规格、色号" value={profile.operations?.customization ?? ''}
                  onChange={e => set('operations')('customization', e.target.value)} />
              </Field>
              <Field label="物流方式">
                <input className={inputCls} placeholder="DHL/空运/海运/海外仓" value={profile.operations?.logistics ?? ''}
                  onChange={e => set('operations')('logistics', e.target.value)} />
              </Field>
              <Field label="付款条款">
                <input className={inputCls} placeholder="T/T 30% 预付，尾款出货前结清" value={profile.operations?.paymentTerms ?? ''}
                  onChange={e => set('operations')('paymentTerms', e.target.value)} />
              </Field>
            </div>
            <Field label="风险与红线">
              <textarea className={textareaCls} rows={2} placeholder="不承诺未经确认的到货日期；不使用 before/after 夸大效果；敏感功效需认证支持。"
                value={profile.operations?.riskNotes ?? ''} onChange={e => set('operations')('riskNotes', e.target.value)} />
            </Field>
          </section>

          {/* Products */}
          <section className="card p-5 space-y-4">
            <div className="flex items-center justify-between gap-3 mb-1">
              <div className="flex items-center gap-2">
                <Package size={14} className="text-text-secondary" />
                <h3 className="text-sm font-semibold text-text-primary">产品目录</h3>
              </div>
              <div className="flex items-center gap-2">
                <label className="inline-flex cursor-pointer items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border text-xs font-semibold text-text-secondary hover:text-text-primary hover:bg-surface-2">
                  {productImporting ? <Loader2 size={12} className="animate-spin" /> : <FileSpreadsheet size={12} />}
                  导入产品表
                  <input
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    className="hidden"
                    disabled={productImporting}
                    onChange={e => {
                      void importProductSheet(e.currentTarget.files?.[0] ?? null);
                      e.currentTarget.value = '';
                    }}
                  />
                </label>
                <button type="button" onClick={addProduct}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border text-xs font-semibold text-text-secondary hover:text-text-primary hover:bg-surface-2">
                  <Plus size={12} />添加产品
                </button>
              </div>
            </div>
            {productImportMessage && <p className="text-[11px] font-semibold text-green-700">{productImportMessage}</p>}
            <div className="grid grid-cols-2 gap-4">
              <Field label="主营品类">
                <input className={inputCls} placeholder="美妆个护、家居日用、消费电子" value={profile.products.categories}
                  onChange={e => set('products')('categories', e.target.value)} />
              </Field>
              <Field label="价格区间">
                <input className={inputCls} placeholder="$5 - $500 USD" value={profile.products.priceRange}
                  onChange={e => set('products')('priceRange', e.target.value)} />
              </Field>
              <Field label="起订量 (MOQ)">
                <input className={inputCls} placeholder="50件起，支持混批" value={profile.products.moq}
                  onChange={e => set('products')('moq', e.target.value)} />
              </Field>
              <Field label="认证资质">
                <input className={inputCls} placeholder="CE、FDA、SGS…" value={profile.products.certifications}
                  onChange={e => set('products')('certifications', e.target.value)} />
              </Field>
            </div>
            <Field label="产品核心优势" hint="工厂直供？独家款式？快速备货？">
              <textarea className={textareaCls} rows={2} placeholder="工厂直供，7天发货；核心系列支持多规格/多色号定制，支持 OEM/ODM"
                value={profile.products.highlights} onChange={e => set('products')('highlights', e.target.value)} />
            </Field>
            <div className="space-y-3 pt-1">
              {normalizeProductItems(profile.products).map((product, index) => {
                const assetGroups: Array<{ key: ProductAssetKey; label: string; hint: string; limit: number; accept: string; icon: LucideIcon; assets: ProductAsset[] }> = [
                  { key: 'images', label: '产品主图', hint: '白底图/瓶身/套装/矩阵', limit: MAX_PRODUCT_ASSETS.images, accept: 'image/*', icon: Image, assets: product.images ?? [] },
                  { key: 'factoryImages', label: '工厂实拍', hint: '产线/质检/仓库/团队', limit: MAX_PRODUCT_ASSETS.factoryImages, accept: 'image/*,video/*', icon: Building2, assets: product.factoryImages ?? [] },
                  { key: 'packagingImages', label: '包装定制', hint: '私标包装/标签/礼盒', limit: MAX_PRODUCT_ASSETS.packagingImages, accept: 'image/*', icon: Package, assets: product.packagingImages ?? [] },
                  { key: 'certificateImages', label: '证书资质', hint: '认证/检测/资质墙', limit: MAX_PRODUCT_ASSETS.certificateImages, accept: '.pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,image/*', icon: FileText, assets: product.certificateImages ?? [] },
                  { key: 'sceneImages', label: '使用场景', hint: '应用/成分/空间氛围', limit: MAX_PRODUCT_ASSETS.sceneImages, accept: 'image/*,video/*', icon: Video, assets: product.sceneImages ?? [] },
                  { key: 'brandAssets', label: '品牌视觉', hint: 'Logo/品牌色/参考版式', limit: MAX_PRODUCT_ASSETS.brandAssets, accept: 'image/*,.pdf', icon: Megaphone, assets: product.brandAssets ?? [] },
                ];
                return (
                  <div key={index} className="rounded-lg border border-border bg-surface-2/40 p-4 space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs font-semibold text-text-primary">产品{index + 1}</p>
                      <button type="button" onClick={() => removeProduct(index)}
                        className="p-1 rounded-md text-text-muted hover:text-red hover:bg-white" title="删除产品">
                        <X size={13} />
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="产品名称">
                        <input className={inputCls} placeholder={`产品${index + 1}`} value={product.name}
                          onChange={e => updateProduct(index, { name: e.target.value })} />
                      </Field>
                      <Field label="产品类目">
                        <input className={inputCls} placeholder="所属品类 / 系列" value={product.category ?? ''}
                          onChange={e => updateProduct(index, { category: e.target.value })} />
                      </Field>
                      <Field label="价格区间">
                        <input className={inputCls} placeholder="$5 - $500 USD" value={product.priceRange ?? ''}
                          onChange={e => updateProduct(index, { priceRange: e.target.value })} />
                      </Field>
                      <Field label="起订量">
                        <input className={inputCls} placeholder="50件起，支持混批" value={product.moq ?? ''}
                          onChange={e => updateProduct(index, { moq: e.target.value })} />
                      </Field>
                    </div>
                    <Field label="认证资质">
                      <input className={inputCls} placeholder="CE、FDA、SGS、MSDS…" value={product.certifications ?? ''}
                        onChange={e => updateProduct(index, { certifications: e.target.value })} />
                    </Field>
                    <Field label="产品卖点">
                      <textarea className={textareaCls} rows={2} placeholder="核心卖点、适用场景、可定制项、交付优势"
                        value={product.highlights ?? ''} onChange={e => updateProduct(index, { highlights: e.target.value })} />
                    </Field>
                    <div className="rounded-lg border border-accent/15 bg-accent-glow/40 p-3 text-[11px] leading-relaxed text-text-secondary">
                      这些图文素材会用于 AI 智能素材的海报生成：产品信息生成/素材库选择会按产品和卖点智能推荐，爆款复刻会先拆解竞品图文后再回填本地素材。
                    </div>
                    <div className="grid grid-cols-2 xl:grid-cols-3 gap-3">
                      {assetGroups.map(({ key, label, limit, accept, icon: Icon, assets }) => (
                        <div key={key} className="rounded-lg border border-border bg-white p-3 min-w-0">
                          <div className="flex items-center justify-between gap-2 mb-2">
                            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-text-secondary">
                              <Icon size={12} />{label}
                            </span>
                            <span className="text-[10px] text-text-muted">{assets.length}/{limit}</span>
                          </div>
                          <p className="mb-2 truncate text-[10px] text-text-muted">{assetGroups.find(group => group.key === key)?.hint}</p>
                          <label className={`flex items-center justify-center gap-1.5 h-8 rounded-md border border-dashed text-[11px] font-semibold transition-colors ${assets.length >= limit ? 'text-text-muted bg-surface-2 cursor-not-allowed' : 'text-text-secondary hover:text-text-primary hover:border-border-bright cursor-pointer'}`}>
                            <Upload size={12} />上传
                            <input
                              className="hidden"
                              type="file"
                              multiple
                              accept={accept}
                              disabled={assets.length >= limit}
                              onChange={e => {
                                addProductAssets(index, key, e.currentTarget.files);
                                e.currentTarget.value = '';
                              }}
                            />
                          </label>
                          <div className="mt-2 space-y-1">
                            {assets.map((asset, assetIndex) => (
                              <div key={`${asset.name}-${assetIndex}`} className="flex items-center gap-1.5 text-[10px] text-text-secondary min-w-0">
                                {asset.url ? (
                                  <a href={asset.url} target="_blank" rel="noreferrer" className="truncate flex-1 hover:text-text-primary">
                                    {asset.name}
                                  </a>
                                ) : (
                                  <span className="truncate flex-1">{asset.name}</span>
                                )}
                                <span className="text-text-muted flex-shrink-0">{formatSize(asset.size)}</span>
                                <button type="button" onClick={() => removeProductAsset(index, key, assetIndex)}
                                  className="p-0.5 rounded text-text-muted hover:text-red flex-shrink-0" title="移除附件">
                                  <X size={10} />
                                </button>
                              </div>
                            ))}
                            {!assets.length && <p className="text-[10px] text-text-muted">最多{limit}{label === '图片' ? '张' : label === '视频' ? '个' : '份'}</p>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Brand */}
          <section className="card p-5 space-y-4">
            <div className="flex items-center gap-2 mb-1">
              <Megaphone size={14} className="text-text-secondary" />
              <h3 className="text-sm font-semibold text-text-primary">品牌调性</h3>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label="品牌调性关键词">
                <input className={inputCls} placeholder="专业、可靠、接地气、有温度" value={profile.brand.tone}
                  onChange={e => set('brand')('tone', e.target.value)} />
              </Field>
              <Field label="沟通风格">
                <select className={inputCls} value={profile.brand.style}
                  onChange={e => set('brand')('style', e.target.value)}>
                  <option>专业</option>
                  <option>轻松</option>
                  <option>亲切</option>
                  <option>正式</option>
                </select>
              </Field>
              <Field label="首选语言版本" hint="Agent 生成话术/营销文案时默认使用，超过 2 种会先询问">
                <input className={inputCls} placeholder="英语、阿拉伯语" value={profile.brand.preferredLanguages ?? ''}
                  onChange={e => set('brand')('preferredLanguages', e.target.value)} />
              </Field>
            </div>
            <Field label="核心卖点 (USP)" hint="你最想让买家记住的一句话">
              <input className={inputCls} placeholder="工厂直供，极具价格竞争力，7天极速发货" value={profile.brand.usp}
                onChange={e => set('brand')('usp', e.target.value)} />
            </Field>
            <Field label="禁忌话题" hint="客户跟进和社媒内容不应涉及的内容">
              <input className={inputCls} placeholder="不提竞品价格对比、不承诺具体到货日期…" value={profile.brand.taboos}
                onChange={e => set('brand')('taboos', e.target.value)} />
            </Field>
          </section>

          {/* Extra knowledge */}
          <section className="card p-5">
            <div className="flex items-center gap-2 mb-4">
              <BookOpen size={14} className="text-text-secondary" />
              <h3 className="text-sm font-semibold text-text-primary">Agent 学习记录</h3>
            </div>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <Field label="已验证有效角度">
                <textarea className={textareaCls} rows={2} value={profile.agentLearning?.provenAngles ?? ''}
                  onChange={e => set('agentLearning')('provenAngles', e.target.value)} placeholder="天然成分、快速出样、真实工厂质检视频转化较好。" />
              </Field>
              <Field label="低效角度/需降权">
                <textarea className={textareaCls} rows={2} value={profile.agentLearning?.weakAngles ?? ''}
                  onChange={e => set('agentLearning')('weakAngles', e.target.value)} placeholder="lowest price、过度功效承诺、泛泛 lifestyle 文案。" />
              </Field>
              <Field label="待确认推断">
                <textarea className={textareaCls} rows={2} value={profile.agentLearning?.pendingAssumptions ?? ''}
                  onChange={e => set('agentLearning')('pendingAssumptions', e.target.value)} placeholder="近 30 天美国小批量定制询盘质量较高，待确认是否设为重点。" />
              </Field>
              <Field label="用户纠正偏好">
                <textarea className={textareaCls} rows={2} value={profile.agentLearning?.userCorrections ?? ''}
                  onChange={e => set('agentLearning')('userCorrections', e.target.value)} placeholder="避免 cheap，优先使用 cost-effective / reliable supply。" />
              </Field>
            </div>
            <Field label="自由填写" hint="运营经验、特定市场规则、历史爆款案例、常见买家问题等，Agent 会在对话中参考">
              <textarea className={textareaCls} rows={6}
                placeholder={"例：\n- 旺季前 2 周提前备货核心爆款，避免断货\n- 东南亚买家对包邮很敏感，建议设 $30 免邮门槛\n- 我们的最畅销款月销 500+，可作为引流主推"}
                value={profile.knowledge} onChange={e => setProfile(prev => ({ ...prev, knowledge: e.target.value }))} />
            </Field>
          </section>

          <div className="h-4" />
        </div>
      </div>
    </div>
  );
}
