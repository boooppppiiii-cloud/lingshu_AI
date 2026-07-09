import { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Building2, Package, Megaphone, BookOpen, Save, CheckCircle2, Loader2, Compass, Zap, MessageSquare, RotateCcw, Plus, Upload, X, Image, Video, FileText, KeyRound, Copy, ExternalLink, Download as DownloadIcon } from 'lucide-react';
import { authHeader } from '../lib/auth';
import { completeDemoStep } from '../lib/demoProgress';

interface ProductAsset {
  name: string;
  type: string;
  size: number;
  updatedAt: string;
  url?: string;
}

interface ProductItem {
  name: string;
  category?: string;
  priceRange?: string;
  moq?: string;
  certifications?: string;
  highlights?: string;
  images?: ProductAsset[];
  videos?: ProductAsset[];
  documents?: ProductAsset[];
}

interface Profile {
  company: { name: string; industry: string; companyType?: string; mainMarkets: string; primaryLanguages?: string; founded: string; description: string };
  products: { categories: string; priceRange: string; moq: string; certifications: string; highlights: string; items?: ProductItem[] };
  brand: { tone: string; style: string; taboos: string; usp: string; preferredLanguages?: string };
  strategy?: { currentGoal?: string; focusProducts?: string; focusMarkets?: string; excludedMarkets?: string; pricingStrategy?: string; minMargin?: string; agentAutonomy?: string };
  customers?: { targetProfiles?: string; highValueSignals?: string; lowQualitySignals?: string; commonQuestions?: string; followupStyle?: string };
  operations?: { leadTime?: string; customization?: string; logistics?: string; paymentTerms?: string; riskNotes?: string };
  agentLearning?: { provenAngles?: string; weakAngles?: string; pendingAssumptions?: string; userCorrections?: string };
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
  strategy: { currentGoal: '', focusProducts: '', focusMarkets: '', excludedMarkets: '', pricingStrategy: '', minMargin: '', agentAutonomy: '' },
  customers: { targetProfiles: '', highValueSignals: '', lowQualitySignals: '', commonQuestions: '', followupStyle: '' },
  operations: { leadTime: '', customization: '', logistics: '', paymentTerms: '', riskNotes: '' },
  agentLearning: { provenAngles: '', weakAngles: '', pendingAssumptions: '', userCorrections: '' },
  knowledge: '',
};

const AGENTS = [
  { icon: Compass, label: '首页', color: '#4f46e5' },
  { icon: Zap, label: '我的社媒', color: '#d97706' },
  { icon: MessageSquare, label: '我的客户', color: '#0891b2' },
];

interface DemoTemplate { id: string; name: string; description: string; profile?: Profile }
interface ProductApiInfo { apiKey: string; tenantId: string; docsUrl: string; createdAt?: string; lastIngestedAt?: string; lastProductName?: string }
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

const MAX_PRODUCT_ASSETS = { images: 5, videos: 2, documents: 3 } as const;

function emptyProduct(index: number): ProductItem {
  return { name: `产品${index + 1}`, images: [], videos: [], documents: [] };
}

function normalizeProductItems(products: Profile['products']): ProductItem[] {
  const existing = Array.isArray(products.items) ? products.items : [];
  if (existing.length) {
    return existing.filter(item =>
      item.name || item.category || item.priceRange || item.moq || item.certifications || item.highlights ||
      item.images?.length || item.videos?.length || item.documents?.length
    ).map((item, index) => ({
      ...emptyProduct(index),
      ...item,
      name: item.name || `产品${index + 1}`,
      images: Array.isArray(item.images) ? item.images : [],
      videos: Array.isArray(item.videos) ? item.videos : [],
      documents: Array.isArray(item.documents) ? item.documents : [],
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

  const downloadOrderTemplate = () => {
    const headers = ['订单号', '客户名称', '商品/SKU', '市场', '渠道', '数量', 'GMV', '成本', '状态', '订单日期', '负责人', '来源', '来源凭证'];
    const csv = `${headers.join(',')}\n`;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'lingshu-orders-template.csv';
    link.click();
    URL.revokeObjectURL(url);
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

  const addProductAssets = async (index: number, key: 'images' | 'videos' | 'documents', files: FileList | null) => {
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

  const removeProductAsset = (index: number, key: 'images' | 'videos' | 'documents', assetIndex: number) => {
    setProfile(prev => {
      const items = normalizeProductItems(prev.products);
      items[index] = { ...items[index], [key]: (items[index]?.[key] ?? []).filter((_, i) => i !== assetIndex) };
      return { ...prev, products: { ...prev.products, items } };
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 size={20} className="text-text-muted animate-spin" />
      </div>
    );
  }

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
                <KeyRound size={16} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold text-text-primary">产品 API 接入</p>
                    <p className="mt-1 text-[11px] leading-relaxed text-text-muted">给 ERP 服务商使用：批量 upsert、查询、删除。服装自由属性统一放 attributes JSON。</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <a href={apiInfo?.docsUrl || '/api/overseas/enterprise/product-api/docs'} target="_blank" rel="noreferrer"
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border text-xs font-semibold text-text-secondary hover:text-text-primary">
                      文档 <ExternalLink size={12} />
                    </a>
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
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold text-text-primary">真实订单数据导入</p>
                    <p className="mt-1 text-[11px] leading-relaxed text-text-muted">上传 ERP、Shopify、财务表或人工整理的 CSV。我的订单页只基于导入/录入的真实订单聚合 GMV、毛利和履约状态。</p>
                  </div>
                  <button type="button" onClick={downloadOrderTemplate}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border text-xs font-semibold text-text-secondary hover:text-text-primary">
                    模板 <DownloadIcon />
                  </button>
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
              <button type="button" onClick={addProduct}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border text-xs font-semibold text-text-secondary hover:text-text-primary hover:bg-surface-2">
                <Plus size={12} />添加产品
              </button>
            </div>
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
                const assetGroups = [
                  { key: 'images' as const, label: '图片', limit: MAX_PRODUCT_ASSETS.images, accept: 'image/*', icon: Image, assets: product.images ?? [] },
                  { key: 'videos' as const, label: '视频', limit: MAX_PRODUCT_ASSETS.videos, accept: 'video/*', icon: Video, assets: product.videos ?? [] },
                  { key: 'documents' as const, label: '资质文书', limit: MAX_PRODUCT_ASSETS.documents, accept: '.pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg', icon: FileText, assets: product.documents ?? [] },
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
                    <div className="grid grid-cols-3 gap-3">
                      {assetGroups.map(({ key, label, limit, accept, icon: Icon, assets }) => (
                        <div key={key} className="rounded-lg border border-border bg-white p-3 min-w-0">
                          <div className="flex items-center justify-between gap-2 mb-2">
                            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-text-secondary">
                              <Icon size={12} />{label}
                            </span>
                            <span className="text-[10px] text-text-muted">{assets.length}/{limit}</span>
                          </div>
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
