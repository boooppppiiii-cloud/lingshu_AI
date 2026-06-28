import { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Building2, Package, Megaphone, BookOpen, Save, CheckCircle2, Loader2, Compass, Zap, MessageSquare, RefreshCw, RotateCcw } from 'lucide-react';

interface Profile {
  company: { name: string; industry: string; mainMarkets: string; founded: string; description: string };
  products: { categories: string; priceRange: string; moq: string; certifications: string; highlights: string };
  brand: { tone: string; style: string; taboos: string; usp: string };
  knowledge: string;
}

const DEFAULT: Profile = {
  company: { name: '', industry: '', mainMarkets: '', founded: '', description: '' },
  products: { categories: '', priceRange: '', moq: '', certifications: '', highlights: '' },
  brand: { tone: '', style: '专业', taboos: '', usp: '' },
  knowledge: '',
};

const AGENTS = [
  { icon: Compass, label: '策略专家', color: '#4f46e5' },
  { icon: Zap, label: '流量专家', color: '#d97706' },
  { icon: MessageSquare, label: '转化专家', color: '#0891b2' },
  { icon: RefreshCw, label: '留存专家', color: '#16a34a' },
];

interface DemoTemplate { id: string; name: string; description: string }

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

export default function EnterprisePage() {
  const [profile, setProfile] = useState<Profile>(DEFAULT);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [templates, setTemplates] = useState<DemoTemplate[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [demoBusy, setDemoBusy] = useState(false);

  useEffect(() => {
    fetch('/api/overseas/enterprise/profile')
      .then(r => r.json())
      .then((data: Partial<Profile>) => {
        setProfile(prev => ({
          company: { ...prev.company, ...data.company },
          products: { ...prev.products, ...data.products },
          brand: { ...prev.brand, ...data.brand },
          knowledge: data.knowledge ?? '',
        }));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
    fetch('/api/overseas/enterprise/demo/templates')
      .then(r => r.json())
      .then((list: DemoTemplate[]) => {
        setTemplates(Array.isArray(list) ? list : []);
        if (Array.isArray(list) && list[0]) setTemplateId(list[0].id);
      })
      .catch(() => {});
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
      if (j.profile) setProfile(j.profile);
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
      if (j.profile) setProfile(j.profile);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setDemoBusy(false);
    }
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
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-text-primary">Demo 模板</p>
                <p className="text-[11px] text-text-muted mt-0.5">当前只保留占位行业结构，等补充行业资料后可直接替换模板内容。</p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <select className={inputCls} value={templateId} onChange={e => setTemplateId(e.target.value)}>
                  {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
                <button onClick={applyTemplate} disabled={!templateId || demoBusy}
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
              <Field label="主攻市场">
                <input className={inputCls} placeholder="中东、东南亚、北美" value={profile.company.mainMarkets}
                  onChange={e => set('company')('mainMarkets', e.target.value)} />
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

          {/* Products */}
          <section className="card p-5 space-y-4">
            <div className="flex items-center gap-2 mb-1">
              <Package size={14} className="text-text-secondary" />
              <h3 className="text-sm font-semibold text-text-primary">产品目录</h3>
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
            </div>
            <Field label="核心卖点 (USP)" hint="你最想让买家记住的一句话">
              <input className={inputCls} placeholder="工厂直供，极具价格竞争力，7天极速发货" value={profile.brand.usp}
                onChange={e => set('brand')('usp', e.target.value)} />
            </Field>
            <Field label="禁忌话题" hint="客服和社媒 Agent 不应涉及的内容">
              <input className={inputCls} placeholder="不提竞品价格对比、不承诺具体到货日期…" value={profile.brand.taboos}
                onChange={e => set('brand')('taboos', e.target.value)} />
            </Field>
          </section>

          {/* Extra knowledge */}
          <section className="card p-5">
            <div className="flex items-center gap-2 mb-4">
              <BookOpen size={14} className="text-text-secondary" />
              <h3 className="text-sm font-semibold text-text-primary">补充知识库</h3>
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
