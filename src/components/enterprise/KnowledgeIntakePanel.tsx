import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  BellRing,
  BookCheck,
  Bot,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleDashed,
  FileText,
  Loader2,
  MessageSquareText,
  PackageCheck,
  PenLine,
  Quote,
  WandSparkles,
  Zap,
} from 'lucide-react';
import { authHeader } from '../../lib/auth';

type QuoteMode = '' | 'range' | 'human_only';
type BargainPolicy = '' | 'no' | 'limited' | 'open';
type NotificationChannel = 'wecom' | 'dingtalk' | 'feishu' | 'sms';

interface BizRules {
  quoteMode?: QuoteMode;
  priceRange?: string;
  bargainPolicy?: BargainPolicy;
  bargainFloor?: string;
  moq?: string;
  samplePolicy?: string;
  paymentTerms?: string;
  leadTime?: string;
}

interface NotificationReceiver {
  name: string;
  channel: NotificationChannel;
  target: string;
}

interface ExistingNotifications {
  receivers?: NotificationReceiver[];
  workHours?: { start?: string; end?: string };
  quietOutsideHours?: boolean;
  nightMode?: { enabled?: boolean; autoCategories?: 'approved' };
}

interface PreviewFaq {
  id?: string;
  question: string;
  answer: string;
  approvedForAuto: boolean;
  source?: 'manual' | 'learned';
}

interface KnowledgePreview {
  source: 'history' | 'products';
  historyMessageCount: number;
  conversationCount: number;
  companyIntro: string;
  bizRules: BizRules;
  faqs: PreviewFaq[];
  evidence: string[];
  missing: string[];
}

interface CapabilityState {
  unlocked: boolean;
  label: string;
  reason: string;
}

interface CompletionState {
  completed: number;
  total: number;
  notificationsReady: boolean;
  capabilities: {
    productGrounding: CapabilityState;
    quoteDraft: CapabilityState;
    autoReply: CapabilityState;
    importantAlerts: CapabilityState;
  };
}

export interface AppliedProfile {
  company?: Record<string, unknown>;
  bizRules?: Record<string, unknown>;
  faq?: Array<Record<string, unknown>>;
  notifications?: Record<string, unknown>;
  knowledgeIntake?: Record<string, unknown>;
}

interface Props {
  mode?: 'onboarding' | 'center';
  compact?: boolean;
  onDone?: () => void;
  onApplied?: (profile: AppliedProfile) => void;
}

const EMPTY_COMPLETION: CompletionState = {
  completed: 0,
  total: 6,
  notificationsReady: false,
  capabilities: {
    productGrounding: { unlocked: false, label: '看懂产品', reason: '先录入 1 个主推产品' },
    quoteDraft: { unlocked: false, label: '识别询价并转人工', reason: '确认样品、付款和交期口径' },
    autoReply: { unlocked: false, label: '自动回答常见问题', reason: '审批 5 条常见问答后解锁' },
    importantAlerts: { unlocked: false, label: '及时提醒重要询盘', reason: '设置并测试 1 位通知接收人' },
  },
};

const CHANNELS: Array<{ value: NotificationChannel; label: string; placeholder: string }> = [
  { value: 'wecom', label: '企业微信', placeholder: '群机器人 Webhook 或接收账号' },
  { value: 'dingtalk', label: '钉钉', placeholder: '群机器人 Webhook' },
  { value: 'feishu', label: '飞书', placeholder: '群机器人 Webhook' },
  { value: 'sms', label: '短信', placeholder: '接收手机号' },
];

function optionClass(active: boolean) {
  return `rounded-lg border px-4 py-3 text-left transition-colors ${active
    ? 'border-emerald-500 bg-emerald-50 text-emerald-900'
    : 'border-border bg-white text-text-secondary hover:border-emerald-200 hover:bg-emerald-50/30'}`;
}

function CapabilityCard({ state, icon: Icon }: { state: CapabilityState; icon: typeof PackageCheck }) {
  return (
    <div className={`min-w-0 rounded-lg border p-3 ${state.unlocked ? 'border-emerald-200 bg-emerald-50/60' : 'border-border bg-surface-2/55'}`}>
      <div className="flex items-center gap-2">
        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${state.unlocked ? 'bg-emerald-100 text-emerald-700' : 'bg-white text-text-muted'}`}>
          {state.unlocked ? <Check size={14} strokeWidth={3} /> : <Icon size={14} />}
        </span>
        <p className="truncate text-xs font-black text-text-primary">{state.label}</p>
      </div>
      <p className="mt-2 line-clamp-2 text-[11px] leading-5 text-text-muted">{state.reason}</p>
    </div>
  );
}

export default function KnowledgeIntakePanel({ mode = 'center', compact = false, onDone, onApplied }: Props) {
  const [completion, setCompletion] = useState<CompletionState>(EMPTY_COMPLETION);
  const [view, setView] = useState<'overview' | 'preview' | 'interview'>('overview');
  const [preview, setPreview] = useState<KnowledgePreview | null>(null);
  const [selectedFaqs, setSelectedFaqs] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);
  const [profileLoading, setProfileLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [interviewStep, setInterviewStep] = useState(0);
  const [rules, setRules] = useState<BizRules>({ quoteMode: '', bargainPolicy: 'no' });
  const [sampleChoice, setSampleChoice] = useState('');
  const [receiver, setReceiver] = useState({ name: '', channel: 'wecom' as NotificationChannel, target: '' });
  const [workHours, setWorkHours] = useState({ start: '09:00', end: '21:00' });
  const [existingNotifications, setExistingNotifications] = useState<ExistingNotifications>({});

  const refreshCompletion = async () => {
    const response = await fetch('/api/overseas/enterprise/knowledge-completion', { headers: authHeader() });
    if (!response.ok) return;
    const data = await response.json();
    if (data?.capabilities) setCompletion(data as CompletionState);
  };

  useEffect(() => {
    void refreshCompletion();
    void fetch('/api/overseas/enterprise/profile', { headers: authHeader() })
      .then(response => response.ok ? response.json() : null)
      .then(data => {
        if (!data || typeof data !== 'object') return;
        const currentRules = data.bizRules && typeof data.bizRules === 'object' ? data.bizRules as BizRules : {};
        const notifications = data.notifications && typeof data.notifications === 'object'
          ? data.notifications as ExistingNotifications
          : {};
        const receivers = Array.isArray(notifications.receivers) ? notifications.receivers : [];
        const firstReceiver = receivers[0];
        setRules({ bargainPolicy: 'no', ...currentRules, quoteMode: 'human_only' });
        if (currentRules.samplePolicy) {
          const presetPolicies = ['可以寄样，样品费和运费另算', '样品收费，正式下单后可抵扣样品费', '先确认客户资质和需求，再由我决定'];
          setSampleChoice(presetPolicies.includes(currentRules.samplePolicy) ? currentRules.samplePolicy : 'custom');
        }
        setExistingNotifications(notifications);
        if (firstReceiver) setReceiver(firstReceiver);
        setWorkHours({
          start: notifications.workHours?.start || '09:00',
          end: notifications.workHours?.end || '21:00',
        });
      })
      .catch(() => null)
      .finally(() => setProfileLoading(false));
  }, []);

  const capabilityList = useMemo(() => [
    { state: completion.capabilities.productGrounding, icon: PackageCheck },
    { state: completion.capabilities.quoteDraft, icon: Quote },
    { state: completion.capabilities.autoReply, icon: MessageSquareText },
    { state: completion.capabilities.importantAlerts, icon: BellRing },
  ], [completion]);

  const generatePreview = async (kind: 'extract' | 'draft') => {
    setLoading(true);
    setMessage('');
    try {
      const response = await fetch(`/api/overseas/enterprise/knowledge-intake/${kind}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || 'AI 暂时没有整理成功，请稍后重试');
      const next = data as KnowledgePreview;
      if (kind === 'extract' && !next.historyMessageCount) {
        setPreview(null);
        setView('overview');
        setMessage('目前还没有可整理的历史聊天。请先接入 WhatsApp/企业微信历史记录，或选择“根据现有产品生成初稿”。');
        return;
      }
      setPreview(next);
      setRules(current => ({ ...current, ...(next.bizRules || {}), quoteMode: 'human_only' }));
      setSelectedFaqs(new Set(next.faqs.map((_, index) => index)));
      setView('preview');
      if (kind === 'draft' && !next.companyIntro && !next.faqs.length && !Object.values(next.bizRules || {}).some(Boolean)) {
        setMessage('还没有足够的产品资料。先录入 1 个主推产品，AI 才能起草可靠内容；也可以直接回答 4 个小问题。');
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'AI 暂时没有整理成功，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  const applyKnowledge = async (payload: Record<string, unknown>, successText: string) => {
    setSaving(true);
    setMessage('');
    try {
      const response = await fetch('/api/overseas/enterprise/knowledge-intake/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || data.error || '保存失败');
      setCompletion(data.completion || completion);
      onApplied?.(data.profile || {});
      setMessage(successText);
      return data.profile as AppliedProfile;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存失败，请稍后重试');
      return null;
    } finally {
      setSaving(false);
    }
  };

  const confirmPreview = async () => {
    if (!preview) return;
    const faqs = preview.faqs.filter((_, index) => selectedFaqs.has(index));
    const profile = await applyKnowledge({
      companyIntro: preview.companyIntro,
      bizRules: { ...rules, quoteMode: 'human_only' },
      faqs,
      source: preview.source,
      extractedMessages: preview.historyMessageCount,
      confirmedSections: ['company', 'bizRules', ...(faqs.length ? ['faq'] : [])],
    }, `已确认并保存${faqs.length ? `，加入 ${faqs.length} 条问答初稿` : ''}`);
    if (profile) {
      setView('overview');
      await refreshCompletion();
    }
  };

  const finishInterview = async () => {
    const samplePolicy = sampleChoice === 'custom' ? rules.samplePolicy : sampleChoice;
    const existingReceivers = Array.isArray(existingNotifications.receivers) ? existingNotifications.receivers : [];
    const nextReceiver = receiver.target.trim() ? { ...receiver, name: receiver.name.trim() || '负责人', target: receiver.target.trim() } : null;
    const receivers = nextReceiver
      ? [...existingReceivers.filter(item => !(item.channel === nextReceiver.channel && item.target.trim() === nextReceiver.target)), nextReceiver]
      : existingReceivers;
    const notifications = {
      ...existingNotifications,
      receivers,
      workHours,
      quietOutsideHours: existingNotifications.quietOutsideHours ?? true,
      nightMode: {
        enabled: existingNotifications.nightMode?.enabled ?? false,
        autoCategories: 'approved' as const,
      },
    };
    const profile = await applyKnowledge({
      bizRules: { ...rules, samplePolicy },
      notifications,
      source: 'interview',
      confirmedSections: ['bizRules', ...(receiver.target.trim() ? ['notifications'] : [])],
    }, 'AI 接待口径已保存');
    if (!profile) return;
    if (receiver.target.trim()) {
      await fetch('/api/overseas/enterprise/notifications/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ receiver: { ...receiver, name: receiver.name.trim() || '负责人' } }),
      }).catch(() => null);
    }
    await refreshCompletion();
    setView('overview');
  };

  if (view === 'preview' && preview) {
    const canConfirmPreview = Boolean(
      preview.companyIntro.trim()
      || preview.faqs.some((faq, index) => selectedFaqs.has(index) && faq.question.trim() && faq.answer.trim())
      || Object.values(rules).some(value => String(value || '').trim()),
    );
    return (
      <section className="rounded-lg border border-border bg-white shadow-sm">
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div className="flex min-w-0 items-start gap-3">
            <button type="button" onClick={() => { setView('overview'); setMessage(''); }} className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border text-text-secondary hover:bg-surface-2" title="返回">
              <ArrowLeft size={15} />
            </button>
            <div>
              <p className="text-sm font-black text-text-primary">AI 已整理好，确认后才会写入</p>
              <p className="mt-1 text-[11px] leading-5 text-text-muted">
                {preview.source === 'history' && preview.historyMessageCount
                  ? `依据 ${preview.conversationCount} 段会话、${preview.historyMessageCount} 条历史消息整理`
                  : '依据已录入的企业和产品资料起草'}
              </p>
            </div>
          </div>
          <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-700">待你确认</span>
        </div>

        <div className="max-h-[58vh] space-y-5 overflow-y-auto p-5">
          {message && <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">{message}</div>}
          <div className="rounded-lg border border-border p-4">
            <div className="mb-3 flex items-start gap-3">
              <FileText size={16} className="mt-0.5 text-emerald-700" />
              <div><p className="text-xs font-black text-text-primary">公司介绍</p><p className="mt-1 text-[11px] text-text-muted">用途：AI 自我介绍、回复资质问题和生成公司文案。</p></div>
            </div>
            <textarea value={preview.companyIntro} onChange={event => setPreview({ ...preview, companyIntro: event.target.value })} rows={4} className="w-full resize-none rounded-lg border border-border px-3 py-2 text-sm leading-6 outline-none focus:border-emerald-400" placeholder="例如：我们专注于护肤品 OEM/ODM，服务中东和东南亚批发客户……" />
          </div>

          <div className="rounded-lg border border-border p-4">
            <div className="mb-3 flex items-start gap-3">
              <Quote size={16} className="mt-0.5 text-emerald-700" />
              <div><p className="text-xs font-black text-text-primary">询价处理规则</p><p className="mt-1 text-[11px] text-text-muted">客户询价时只收集数量和规格，并标记为“等待人工报价”；AI 不会直接报价。</p></div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs font-bold leading-5 text-amber-800">客户询价 → 等待人工报价 → 提醒负责人接手</div>
              <label className="text-xs font-bold text-text-secondary">内部参考价格（不会自动发给客户）<input value={rules.priceRange || ''} onChange={event => setRules(current => ({ ...current, priceRange: event.target.value }))} className="mt-1.5 w-full rounded-lg border border-border px-3 py-2 text-sm" placeholder="例如：常规款 US$3-5，仅供销售参考" /></label>
              <label className="text-xs font-bold text-text-secondary">起订量<input value={rules.moq || ''} onChange={event => setRules(current => ({ ...current, moq: event.target.value }))} className="mt-1.5 w-full rounded-lg border border-border px-3 py-2 text-sm" placeholder="例如：500 件起，支持混色" /></label>
              <label className="text-xs font-bold text-text-secondary">样品政策<input value={rules.samplePolicy || ''} onChange={event => setRules(current => ({ ...current, samplePolicy: event.target.value }))} className="mt-1.5 w-full rounded-lg border border-border px-3 py-2 text-sm" placeholder="例如：样品收费，下单后可抵扣" /></label>
              <label className="text-xs font-bold text-text-secondary">付款方式<input value={rules.paymentTerms || ''} onChange={event => setRules(current => ({ ...current, paymentTerms: event.target.value }))} className="mt-1.5 w-full rounded-lg border border-border px-3 py-2 text-sm" placeholder="例如：30% 定金，发货前付尾款" /></label>
              <label className="text-xs font-bold text-text-secondary">常规交期<input value={rules.leadTime || ''} onChange={event => setRules(current => ({ ...current, leadTime: event.target.value }))} className="mt-1.5 w-full rounded-lg border border-border px-3 py-2 text-sm" placeholder="例如：确认订单后 15-20 天" /></label>
            </div>
          </div>

          <div className="rounded-lg border border-border p-4">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div className="flex items-start gap-3"><BookCheck size={16} className="mt-0.5 text-emerald-700" /><div><p className="text-xs font-black text-text-primary">常见问答初稿</p><p className="mt-1 text-[11px] text-text-muted">先勾选要保存的内容；默认只给 AI 写草稿，不会自动发给客户。</p></div></div>
              <span className="shrink-0 text-[11px] font-bold text-text-muted">已选 {selectedFaqs.size}/{preview.faqs.length}</span>
            </div>
            <div className="space-y-2">
              {preview.faqs.map((faq, index) => {
                const checked = selectedFaqs.has(index);
                return (
                  <div key={`${faq.question}-${index}`} className={`rounded-lg border p-3 ${checked ? 'border-emerald-200 bg-emerald-50/40' : 'border-border bg-surface-2/40 opacity-65'}`}>
                    <div className="flex items-start gap-3">
                      <button type="button" onClick={() => setSelectedFaqs(current => { const next = new Set(current); if (next.has(index)) next.delete(index); else next.add(index); return next; })} className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border ${checked ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-border bg-white text-transparent'}`}><Check size={12} /></button>
                      <div className="min-w-0 flex-1 space-y-2">
                        <input value={faq.question} onChange={event => setPreview({ ...preview, faqs: preview.faqs.map((item, faqIndex) => faqIndex === index ? { ...item, question: event.target.value } : item) })} className="w-full border-0 bg-transparent p-0 text-xs font-black text-text-primary outline-none" />
                        <textarea value={faq.answer} onChange={event => setPreview({ ...preview, faqs: preview.faqs.map((item, faqIndex) => faqIndex === index ? { ...item, answer: event.target.value } : item) })} rows={2} className="w-full resize-none border-0 bg-transparent p-0 text-xs leading-5 text-text-secondary outline-none" />
                        <button
                          type="button"
                          disabled={!checked}
                          onClick={() => setPreview({
                            ...preview,
                            faqs: preview.faqs.map((item, faqIndex) => faqIndex === index ? { ...item, approvedForAuto: !item.approvedForAuto } : item),
                          })}
                          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-black transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${faq.approvedForAuto ? 'bg-emerald-600 text-white' : 'border border-border bg-white text-text-muted'}`}
                          title="只有你主动批准的标准答案，AI 才能在安全规则内自动发送"
                        >
                          {faq.approvedForAuto ? <CheckCircle2 size={11} /> : <CircleDashed size={11} />}
                          {faq.approvedForAuto ? '已允许自动回复' : '仅用于草稿'}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
              {!preview.faqs.length && <p className="rounded-lg bg-surface-2 px-3 py-4 text-center text-xs text-text-muted">现有资料不足以可靠生成 FAQ，可以先完成下面的生活化问答。</p>}
            </div>
          </div>

          {preview.evidence.length > 0 && <div className="rounded-lg bg-surface-2 p-3 text-[11px] leading-5 text-text-muted"><p className="font-bold text-text-secondary">AI 整理依据</p>{preview.evidence.map(item => <p key={item}>· {item}</p>)}</div>}
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-4">
          <p className="text-[11px] text-text-muted">保存后仍可在企业中心逐项修改。</p>
          <button type="button" onClick={() => void confirmPreview()} disabled={saving || !canConfirmPreview} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-xs font-black text-white disabled:cursor-not-allowed disabled:opacity-40">{saving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}确认并充能</button>
        </div>
      </section>
    );
  }

  if (view === 'interview') {
    const steps = [
      <div key="bargain" className="space-y-3"><p className="text-base font-black text-text-primary">客户还价时，AI 可以谈到什么程度？</p><p className="text-xs text-text-muted">AI 只按你确认的边界写草稿，不会自己承诺折扣。</p>{[{ value: 'no', title: '不谈折扣，交给我处理', desc: '最稳妥，适合刚开始使用' }, { value: 'limited', title: '可以小幅议价', desc: 'AI 先确认采购量，再按你写的底线推进' }, { value: 'open', title: '可以灵活谈，但先收集条件', desc: '适合熟悉的常规品类' }].map(item => <button key={item.value} type="button" onClick={() => setRules(current => ({ ...current, bargainPolicy: item.value as BargainPolicy }))} className={`w-full ${optionClass(rules.bargainPolicy === item.value)}`}><span className="block text-sm font-black">{item.title}</span><span className="mt-1 block text-xs opacity-75">{item.desc}</span></button>)}{rules.bargainPolicy === 'limited' && <input value={rules.bargainFloor || ''} onChange={event => setRules(current => ({ ...current, bargainFloor: event.target.value }))} className="w-full rounded-lg border border-border px-3 py-2.5 text-sm" placeholder="例如：最多优惠 5%，大单另行确认" />}</div>,
      <div key="sample" className="space-y-3"><p className="text-base font-black text-text-primary">客户要样品时，通常怎么处理？</p><p className="text-xs text-text-muted">选最接近的一项，后面随时能改。</p>{['可以寄样，样品费和运费另算', '样品收费，正式下单后可抵扣样品费', '先确认客户资质和需求，再由我决定', 'custom'].map(item => <button key={item} type="button" onClick={() => { setSampleChoice(item); if (item !== 'custom') setRules(current => ({ ...current, samplePolicy: item })); }} className={`w-full ${optionClass(sampleChoice === item)}`}><span className="block text-sm font-black">{item === 'custom' ? '我的情况不一样' : item}</span></button>)}{sampleChoice === 'custom' && <textarea value={rules.samplePolicy || ''} onChange={event => setRules(current => ({ ...current, samplePolicy: event.target.value }))} rows={3} className="w-full resize-none rounded-lg border border-border px-3 py-2.5 text-sm" placeholder="用平时和客户说话的方式写就行，AI 会照着执行" />}</div>,
      <div key="delivery" className="space-y-4"><p className="text-base font-black text-text-primary">再补两句常用口径</p><p className="text-xs text-text-muted">不知道可以留空，AI 遇到这类问题会转给你确认。</p><label className="block text-xs font-bold text-text-secondary">常用付款方式<input value={rules.paymentTerms || ''} onChange={event => setRules(current => ({ ...current, paymentTerms: event.target.value }))} className="mt-1.5 w-full rounded-lg border border-border px-3 py-2.5 text-sm" placeholder="例如：30% 定金，发货前付尾款" /></label><label className="block text-xs font-bold text-text-secondary">常规交期<input value={rules.leadTime || ''} onChange={event => setRules(current => ({ ...current, leadTime: event.target.value }))} className="mt-1.5 w-full rounded-lg border border-border px-3 py-2.5 text-sm" placeholder="例如：确认订单后 15-20 天" /></label><label className="block text-xs font-bold text-text-secondary">常见起订量<input value={rules.moq || ''} onChange={event => setRules(current => ({ ...current, moq: event.target.value }))} className="mt-1.5 w-full rounded-lg border border-border px-3 py-2.5 text-sm" placeholder="例如：500 件起，支持混色" /></label></div>,
      <div key="notify" className="space-y-4"><p className="text-base font-black text-text-primary">重要询盘应该提醒谁？</p><p className="text-xs text-text-muted">大单、投诉、客户要求人工时会及时提醒；普通消息不会轰炸你。</p><div className="grid grid-cols-2 gap-3"><label className="text-xs font-bold text-text-secondary">负责人<input value={receiver.name} onChange={event => setReceiver(current => ({ ...current, name: event.target.value }))} className="mt-1.5 w-full rounded-lg border border-border px-3 py-2.5 text-sm" placeholder="例如：王老板" /></label><label className="text-xs font-bold text-text-secondary">提醒方式<select value={receiver.channel} onChange={event => setReceiver(current => ({ ...current, channel: event.target.value as NotificationChannel, target: '' }))} className="mt-1.5 w-full rounded-lg border border-border bg-white px-3 py-2.5 text-sm">{CHANNELS.map(channel => <option key={channel.value} value={channel.value}>{channel.label}</option>)}</select></label></div><label className="block text-xs font-bold text-text-secondary">接收地址或账号<input value={receiver.target} onChange={event => setReceiver(current => ({ ...current, target: event.target.value }))} className="mt-1.5 w-full rounded-lg border border-border px-3 py-2.5 text-sm" placeholder={CHANNELS.find(channel => channel.value === receiver.channel)?.placeholder} /></label><div><p className="mb-2 text-xs font-bold text-text-secondary">通常几点有人看消息？</p><div className="flex items-center gap-2"><input type="time" value={workHours.start} onChange={event => setWorkHours(current => ({ ...current, start: event.target.value }))} className="rounded-lg border border-border px-3 py-2 text-sm" /><span className="text-xs text-text-muted">到</span><input type="time" value={workHours.end} onChange={event => setWorkHours(current => ({ ...current, end: event.target.value }))} className="rounded-lg border border-border px-3 py-2 text-sm" /></div></div></div>,
    ];
    const canContinue = interviewStep === 0 ? Boolean(rules.bargainPolicy) : interviewStep === 1 ? Boolean(sampleChoice && (sampleChoice !== 'custom' || rules.samplePolicy?.trim())) : true;
    return (
      <section className="rounded-lg border border-border bg-white shadow-sm">
        <div className="border-b border-border px-5 py-4"><div className="flex items-center justify-between"><button type="button" onClick={() => { if (interviewStep) setInterviewStep(step => step - 1); else { setView('overview'); setMessage(''); } }} className="inline-flex items-center gap-1.5 text-xs font-bold text-text-secondary"><ArrowLeft size={14} />返回</button><span className="text-[11px] font-bold text-text-muted">{interviewStep + 1} / {steps.length}</span></div><div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-2"><div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${((interviewStep + 1) / steps.length) * 100}%` }} /></div></div>
        <div className="min-h-[330px] p-5">{steps[interviewStep]}{message && <p className="mt-4 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">{message}</p>}</div>
        <div className="flex justify-end border-t border-border px-5 py-4">{interviewStep < steps.length - 1 ? <button type="button" disabled={!canContinue} onClick={() => setInterviewStep(step => step + 1)} className="inline-flex items-center gap-2 rounded-lg bg-slate-950 px-4 py-2.5 text-xs font-black text-white disabled:opacity-40">下一题<ChevronRight size={14} /></button> : <button type="button" disabled={saving} onClick={() => void finishInterview()} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-xs font-black text-white disabled:opacity-50">{saving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}保存，开始辅助接待</button>}</div>
      </section>
    );
  }

  if (compact) {
    const unlockedCount = Object.values(completion.capabilities).filter(item => item.unlocked).length;
    const chargePercent = Math.round((unlockedCount / 4) * 100);
    return (
      <section className="bg-white">
        <div className="border-b border-border px-4 py-4">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700"><Bot size={19} /></span>
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-black text-text-primary">给灵小枢一些真实原料</h2>
              <p className="mt-1 text-xs leading-5 text-text-muted">选一种最省事的方式，AI 整理成初稿，你确认后才会用于回复。</p>
              <div className="mt-3">
                <div className="flex items-center justify-between text-[11px] font-black">
                  <span className="inline-flex items-center gap-1.5 text-emerald-700"><Zap size={12} fill="currentColor" />AI 充能进度</span>
                  <span className="text-text-secondary">{chargePercent}% · 已解锁 {unlockedCount}/4 项</span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-emerald-100">
                  <div className="h-full rounded-full bg-emerald-500 transition-all duration-500" style={{ width: `${chargePercent}%` }} />
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-2 p-4">
          <button type="button" disabled={loading || profileLoading} onClick={() => void generatePreview('extract')} className="group flex w-full items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 text-left transition-colors hover:bg-emerald-50 disabled:opacity-60">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-emerald-700 shadow-sm">{loading ? <Loader2 size={17} className="animate-spin" /> : <MessageSquareText size={17} />}</span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2 text-sm font-black text-text-primary">整理历史聊天<span className="rounded-full bg-white px-2 py-0.5 text-[9px] font-black text-emerald-700">已有客户推荐</span></span>
              <span className="mt-1 block line-clamp-2 text-[11px] leading-5 text-text-muted">从真实聊天中提取常见问题、接待习惯和老板原本的说话方式。</span>
            </span>
            <ChevronRight size={16} className="shrink-0 text-emerald-600" />
          </button>

          <button type="button" disabled={loading || profileLoading} onClick={() => void generatePreview('draft')} className="flex w-full items-center gap-3 rounded-xl border border-border bg-white p-3 text-left transition-colors hover:bg-surface-2 disabled:opacity-60">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sky-50 text-sky-700"><WandSparkles size={17} /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-black text-text-primary">根据产品生成接待初稿</span>
              <span className="mt-1 block line-clamp-2 text-[11px] leading-5 text-text-muted">用已录入产品起草公司介绍、常见问答和基础接待口径。</span>
            </span>
            <ChevronRight size={16} className="shrink-0 text-text-muted" />
          </button>

          <button type="button" disabled={profileLoading} onClick={() => { setInterviewStep(0); setView('interview'); setMessage(''); }} className="flex w-full items-center gap-3 rounded-xl border border-border bg-white p-3 text-left transition-colors hover:bg-surface-2 disabled:opacity-60">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-700"><PenLine size={17} /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-black text-text-primary">回答 4 个问题</span>
              <span className="mt-1 block line-clamp-2 text-[11px] leading-5 text-text-muted">一次只回答一件事，快速划清 AI 回复和转人工的边界。</span>
            </span>
            <ChevronRight size={16} className="shrink-0 text-text-muted" />
          </button>

          {message && <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold leading-5 text-amber-800">{message}</div>}
          <p className="flex items-center gap-1.5 px-1 pt-1 text-[11px] text-text-muted"><CircleDashed size={13} />可以分几次完成，已确认的内容会持续保存。</p>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-border bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700"><Bot size={19} /></span>
          <div>
            <div className="flex flex-wrap items-center gap-2"><h2 className="text-base font-black text-text-primary">{mode === 'onboarding' ? '最后一步：让 AI 先会接待' : '快速采集：让 AI 学会怎么替你回复'}</h2><span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-black text-emerald-700">不用填长表</span></div>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-text-muted">{mode === 'onboarding' ? '任选一项就能开始，也可以直接完成诊断，稍后再到企业中心补充。' : '这是资料采集入口，不是另一套设置。AI 会把聊天、产品或访谈整理进下方同一份企业资料，你确认后才会生效。'}</p>
          </div>
        </div>
        {mode === 'center' && <span className="rounded-full bg-surface-2 px-3 py-1 text-xs font-black text-text-secondary">AI 能力 {Object.values(completion.capabilities).filter(item => item.unlocked).length}/4</span>}
      </div>

      {mode === 'center' && <div className={`mt-4 grid gap-2 ${compact ? 'grid-cols-2' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4'}`}>{capabilityList.map(item => <CapabilityCard key={item.state.label} {...item} />)}</div>}

      {mode === 'center' && <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg bg-surface-2 px-3 py-2.5 text-[11px] font-bold text-text-secondary">
        <span>提供原料</span><ChevronRight size={12} className="text-text-muted" />
        <span>AI 整理初稿</span><ChevronRight size={12} className="text-text-muted" />
        <span>你确认</span><ChevronRight size={12} className="text-text-muted" />
        <span className="text-emerald-700">写入唯一资料库并用于回复</span>
      </div>}

      <div className={`mt-5 grid gap-3 ${compact ? 'grid-cols-2' : mode === 'onboarding' ? 'md:grid-cols-2' : 'md:grid-cols-3'}`}>
        {mode === 'center' && <button type="button" disabled={loading || profileLoading} onClick={() => void generatePreview('extract')} className={`group rounded-lg border border-emerald-200 bg-emerald-50/55 p-4 text-left transition-colors hover:bg-emerald-50 disabled:opacity-60 ${compact ? 'col-span-2' : ''}`}>
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">{loading ? <Loader2 size={16} className="animate-spin" /> : <MessageSquareText size={16} />}</span><p className="mt-3 text-sm font-black text-text-primary">已有客户聊天：整理真实话术</p><p className="mt-1 text-[11px] leading-5 text-text-muted">适合已经接入 WhatsApp/企业微信的用户。AI 从老板过去的真实回复中提取常见问答和接待习惯。</p><span className="mt-3 inline-flex items-center gap-1 text-xs font-black text-emerald-700">读取历史聊天<ChevronRight size={13} /></span>
        </button>}
        <button type="button" disabled={loading || profileLoading} onClick={() => void generatePreview('draft')} className="rounded-lg border border-border bg-white p-4 text-left transition-colors hover:bg-surface-2 disabled:opacity-60">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-50 text-sky-700"><WandSparkles size={16} /></span><p className="mt-3 text-sm font-black text-text-primary">生成接待初稿</p><p className="mt-1 text-[11px] leading-5 text-text-muted">AI 根据刚才录入的产品，先起草公司介绍、常见问答和接待口径，由你确认后使用。</p><span className="mt-3 inline-flex items-center gap-1 text-xs font-black text-sky-700">立即生成<ChevronRight size={13} /></span>
        </button>
        <button type="button" disabled={profileLoading} onClick={() => { setInterviewStep(0); setView('interview'); setMessage(''); }} className="rounded-lg border border-border bg-white p-4 text-left transition-colors hover:bg-surface-2 disabled:opacity-60">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-50 text-amber-700"><PenLine size={16} /></span><p className="mt-3 text-sm font-black text-text-primary">回答 4 个问题</p><p className="mt-1 text-[11px] leading-5 text-text-muted">用 4 个生活化问题，告诉 AI 哪些能回复、哪些必须交给你处理。</p><span className="mt-3 inline-flex items-center gap-1 text-xs font-black text-amber-700">开始回答<ChevronRight size={13} /></span>
        </button>
      </div>

      {message && <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold leading-5 text-amber-800">{message}</div>}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        <p className="inline-flex items-center gap-1.5 text-[11px] text-text-muted"><CircleDashed size={13} />{mode === 'onboarding' ? '这两项都可以跳过，之后随时到企业中心继续完善。' : '先让 AI 能开口，其他资料可以边用边补。'}</p>
        {mode === 'onboarding' && <button type="button" onClick={onDone} className="inline-flex items-center gap-2 rounded-lg bg-slate-950 px-5 py-2.5 text-xs font-black text-white shadow-sm hover:bg-slate-800"><CheckCircle2 size={14} />完成诊断</button>}
      </div>
    </section>
  );
}
