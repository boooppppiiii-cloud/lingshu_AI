import { useState, useEffect, useRef } from 'react';
import {
  MessageSquare, LayoutGrid, AlertTriangle, Clock, TrendingUp,
  CheckCircle2, Circle, ChevronLeft, Bot, User, Send,
  Sparkles, ChevronDown, Languages, Loader2, Users, RefreshCw, Filter,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import AgentChatPage from './AgentChatPage';
import type { ConversationContext, RestoreSignal, KickoffSignal, AgentAction } from '../App';

type ViewMode = 'dashboard' | 'qualified' | 'reactivation' | 'chat' | 'customer-chat';

interface Props {
  onEnterConversation: (ctx: ConversationContext) => void;
  onLeaveConversation: () => void;
  isInConversation: boolean;
  restore?: RestoreSignal;
  kickoff?: KickoffSignal;
  onAction?: AgentAction;
  onSessionRefresh?: () => void;
}

// ─── Static mock data ────────────────────────────────────────────────────────

const INQUIRIES = [
  { id: '1', buyer: 'Ahmed Al-Rashid', country: '🇸🇦', product: '假发定制 500件',  amount: '$2,400', status: 'hot',     time: '10分钟前', lang: 'EN' },
  { id: '2', buyer: 'Maria Santos',    country: '🇧🇷', product: '艾灸贴 200件',    amount: '$380',   status: 'pending', time: '1小时前',  lang: 'ES' },
  { id: '3', buyer: 'John Thompson',   country: '🇺🇸', product: '义乌小商品样品',  amount: '$120',   status: 'replied', time: '3小时前',  lang: 'EN' },
  { id: '4', buyer: 'Fatima Hassan',   country: '🇦🇪', product: '香皂礼盒 1000套', amount: '$1,800', status: 'hot',     time: '昨天',     lang: 'AR' },
  { id: '5', buyer: 'Nguyen Van A',    country: '🇻🇳', product: '发饰批发',        amount: '$260',   status: 'pending', time: '昨天',     lang: 'EN' },
];

const STATUS_META = {
  hot:     { label: '⚠️ 大单', color: '#d97706', bg: 'rgba(217,119,6,0.08)' },
  pending: { label: '待回复',  color: '#0891b2', bg: 'rgba(8,145,178,0.08)' },
  replied: { label: '已回复',  color: '#16a34a', bg: 'rgba(22,163,74,0.08)' },
};

const TASKS = [
  { label: '回复 Ahmed 假发定制询盘（大单）', done: false, urgent: true },
  { label: '发送 Maria 艾灸贴报价单',        done: false, urgent: false },
  { label: '跟进 John 样品寄送进度',          done: true,  urgent: false },
  { label: '更新 WhatsApp 阿语话术模板',      done: true,  urgent: false },
];

const QUALIFIED_CUSTOMERS = [
  { buyer: 'Ahmed Al-Rashid', source: 'WhatsApp', product: '假发定制', score: 96, reason: '500件 OEM + 明确交期问题', action: '自动首响后转人工报价' },
  { buyer: 'Fatima Hassan', source: 'WhatsApp', product: '香皂礼盒', score: 91, reason: '1000套礼盒 + 中东节日前采购', action: '推送阿语报价模板' },
  { buyer: 'Maria Santos', source: '站内 DM', product: '艾灸贴', score: 74, reason: '小批量试单，适合样品转化', action: '发送样品政策' },
  { buyer: 'Nguyen Van A', source: 'Instagram', product: '发饰批发', score: 69, reason: '询问目录，需判断复购潜力', action: '自动发送目录并追踪点击' },
];

const REACTIVATION_CUSTOMERS = [
  { buyer: 'Khalid Mohammed', tier: '高价值老客', last: '68天未互动', channel: 'WhatsApp', product: '新款棕色直发14寸', action: '发新品目录 + 老客价' },
  { buyer: 'Carlos Rivera', tier: '沉睡客', last: '55天未复购', channel: 'WhatsApp', product: '升级版热敷贴', action: '发西语包装样图' },
  { buyer: 'Omar Hassan', tier: '沉睡客', last: '74天未互动', channel: 'WhatsApp', product: '防摔磁吸壳', action: '按机型发库存表' },
  { buyer: 'Aisha Rahman', tier: 'VIP', last: '18天前下单', channel: 'WhatsApp', product: '斋月礼盒套装', action: '确认补货窗口' },
];

// zh = 中文注释，AI模式下每条消息下方显示
interface ChatMsg {
  role: 'buyer' | 'seller';
  content: string;
  time: string;
  byAi?: boolean;
  zh?: string;
}

const MOCK_THREADS: Record<string, ChatMsg[]> = {
  '1': [
    {
      role: 'buyer',  time: '09:42',
      content: 'Hello, I am interested in custom hair wigs, 500 pieces. Can you provide OEM service?',
      zh: '你好，我对定制假发感兴趣，需要500件，能做OEM吗？',
    },
    {
      role: 'seller', time: '09:43', byAi: true,
      content: 'Hi Ahmed! We support OEM from 200 pcs. 500 pcs gets you a 5% discount. What hair type and style do you need?',
      zh: '已告知支持200件起OEM、500件享9.5折，询问发质款式',
    },
    {
      role: 'buyer',  time: '10:15',
      content: 'Human hair, straight style, natural black. What is your MOQ and lead time?',
      zh: '需要人发直发天然黑色，请问最小起订量和交货期？',
    },
    {
      role: 'seller', time: '10:16', byAi: true,
      content: 'Human hair straight natural black is our hero SKU. MOQ 200 pcs, 500 pcs at 95折. Standard lead time 25 days, rush 18 days (+8%). Generating a full quote now — could you share your company name and shipping address?',
      zh: '已报价：MOQ 200件，500件95折，标准25天/加急18天（+8%）。已索取公司名和收货地址生成报价单',
    },
  ],
  '2': [
    {
      role: 'buyer',  time: '昨天 14:30',
      content: 'Hola, me interesa el parche de moxibustión, 200 piezas. ¿Cuál es el precio unitario?',
      zh: '你好，我对艾灸贴感兴趣，需要200件，单价是多少？',
    },
    {
      role: 'seller', time: '昨天 14:31', byAi: true,
      content: '¡Hola Maria! Precio unitario para 200 pcs: $1.90/ud con packaging personalizado incluido. ¿Le enviamos una muestra gratis? (Solo cubre el envío, ~$8)',
      zh: '已报价 $1.90/件含定制包装，并提出免费寄样（仅付运费约$8）',
    },
  ],
  '3': [
    {
      role: 'buyer',  time: '今天 08:00',
      content: 'Hi, I need some sample products from Yiwu, mainly small accessories. Budget around $120.',
      zh: '你好，我需要义乌的样品，主要是小配件，预算约120美元',
    },
    {
      role: 'seller', time: '今天 08:01', byAi: true,
      content: 'Hi John! $120 covers a curated sample box of 8–10 accessory categories (bestsellers). Standard shipping 7–12 days, DHL Express 3–5 days (+fee). Which do you prefer?',
      zh: '已说明 $120 可配 8–10 品类精选样品盒，询问运输偏好（标准 vs DHL）',
    },
    {
      role: 'buyer',  time: '今天 08:45',
      content: 'Curated selection sounds great! Standard shipping is fine.',
      zh: '精选搭配听起来不错，选择标准运输',
    },
    {
      role: 'seller', time: '今天 08:46', byAi: true,
      content: 'Perfect! Processing your sample box now. Tracking number will be sent in 2 business days. Can you confirm your shipping address?',
      zh: '已告知正在配盒，2个工作日内发快递单号，请确认收货地址',
    },
  ],
  '4': [
    {
      role: 'buyer',  time: '昨天 16:00',
      content: 'السلام عليكم، أريد طلب 1000 مجموعة من صناديق الصابون. ما هي أفضل سعر؟',
      zh: '您好，我想订购1000套香皂礼盒，最优价格是多少？',
    },
    {
      role: 'seller', time: '昨天 16:02', byAi: true,
      content: 'وعليكم السلام فاطمة! 1000 مجموعة بسعر $1.80/مجموعة شاملاً التغليف المخصص بشعارك. هل تودين الاطلاع على كتالوج التصاميم المتاحة؟',
      zh: '已报价 $1.80/套含定制LOGO包装，并询问是否需要查看设计模板',
    },
  ],
  '5': [
    {
      role: 'buyer',  time: '昨天 11:00',
      content: 'Hi, interested in wholesale hair accessories. What collections do you have?',
      zh: '你好，对批发发饰感兴趣，你们有哪些系列？',
    },
    {
      role: 'seller', time: '昨天 11:01', byAi: true,
      content: 'Hi Nguyen! We carry clips, bands, scrunchies, pins, and headbands. Our bestseller wholesale pack: 50 mixed pcs from $4.80/set. Want me to send the full catalog PDF?',
      zh: '已介绍发夹/发带/螺旋圈/发针/发箍等系列，畅销批发包$4.80/50件混款，询问是否需要发目录PDF',
    },
  ],
};

// AI 建议（人工模式折叠条内）
const AI_SUGGESTIONS: Record<string, string> = {
  '1': 'Thank you Ahmed! Could you please share your company name and shipping address so we can prepare the formal quotation?',
  '2': '¡Gracias Maria! ¿A qué dirección le enviamos la muestra gratuita? Tenemos 3 diseños de packaging disponibles.',
  '4': 'متابعة: مرحباً فاطمة، هل تحتاجين مزيداً من المعلومات حول التصاميم؟ يسعدنا إرسال الكتالوج الكامل.',
  '5': 'Hi Nguyen! The catalog PDF has been sent to your email. We also have new arrivals this season — shall I include those?',
};

// AI 托管看板数据
const AI_MANAGED = [
  { id: '1', buyer: 'Ahmed Al-Rashid', flag: '🇸🇦', status: 'waiting'     as const, stage: 2, alert: '⚠️ 大单'    },
  { id: '4', buyer: 'Fatima Hassan',   flag: '🇦🇪', status: 'needs_human' as const, stage: 2, alert: '45min 未回' },
  { id: '5', buyer: 'Nguyen Van A',    flag: '🇻🇳', status: 'sent'        as const, stage: 0, alert: null          },
];

const MANAGED_STATUS_META = {
  waiting:     { label: '等待回复', color: '#0891b2', bg: 'rgba(8,145,178,0.08)' },
  sent:        { label: '已发送',   color: '#16a34a', bg: 'rgba(22,163,74,0.08)' },
  needs_human: { label: '需人工',   color: '#dc2626', bg: 'rgba(220,38,38,0.08)' },
};

const FUNNEL = ['刚建联', '意向', '报价', '谈判', '下单'];
const CONVERSION_STAGES = ['进线', '意向', '询价', '样品', '首购'];
const DEFAULT_CONVERSION_STAGE: Record<string, string> = {
  '1': '询价',
  '2': '询价',
  '3': '样品',
  '4': '询价',
  '5': '意向',
};

// 目标语言元数据（人工模式显示）
const LANG_META: Record<string, { name: string; full: string }> = {
  EN: { name: 'EN', full: 'English'  },
  ES: { name: 'ES', full: 'Español'  },
  AR: { name: 'AR', full: 'العربية'  },
};

// 基于关键词的模拟翻译（中文 → 目标语言）
function mockTranslate(lang: string, text: string): string {
  if (lang === 'AR') {
    if (/报价|价格|多少钱/.test(text)) return 'سنرسل لك عرض الأسعار التفصيلي خلال ساعتين إن شاء الله.';
    if (/谢谢|感谢/.test(text))       return 'شكراً جزيلاً! يسعدنا التعاون معكم.';
    if (/样品|打样/.test(text))        return 'يمكننا إرسال عينة مجانية. هل يمكنك تزويدنا بعنوان الشحن؟';
    if (/跟进|确认|催/.test(text))     return 'مرحباً، أردنا فقط التأكد من أنكم تلقيتم رسالتنا. نحن في انتظار ردكم الكريم.';
    return 'شكراً لتواصلك معنا. سنرد عليك في أقرب وقت ممكن.';
  }
  if (lang === 'ES') {
    if (/报价|价格|多少钱/.test(text)) return 'Le enviaremos el presupuesto detallado en menos de 2 horas.';
    if (/谢谢|感谢/.test(text))       return '¡Muchas gracias! Será un placer colaborar con usted.';
    if (/样品|打样/.test(text))        return 'Podemos enviar una muestra gratuita. ¿Podría compartir su dirección de envío?';
    if (/跟进|确认|催/.test(text))     return 'Hola, solo queríamos confirmar que recibió nuestro mensaje anterior. Quedamos a su disposición.';
    return 'Gracias por contactarnos. Le responderemos a la brevedad posible.';
  }
  // EN default
  if (/报价|价格|多少钱/.test(text)) return 'We will send you a detailed quotation within 2 hours.';
  if (/谢谢|感谢/.test(text))       return "Thank you! It's a pleasure working with you.";
  if (/样品|打样/.test(text))        return 'We can arrange a free sample. Could you share your shipping address?';
  if (/跟进|确认|催/.test(text))     return "Hi, just following up to make sure you received our previous message. Looking forward to hearing from you!";
  return 'Thank you for reaching out. We will get back to you shortly.';
}

// ─── AI 托管看板 ─────────────────────────────────────────────────────────────

function AiManagedCard({ onSelect }: { onSelect: (id: string) => void }) {
  const needsHuman = AI_MANAGED.filter(s => s.status === 'needs_human').length;
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <Bot size={14} style={{ color: '#0891b2' }} />
          <span className="text-sm font-semibold text-text-primary">AI 正在托管</span>
          <span className="text-[11px] font-bold px-1.5 py-0.5 rounded-full text-white" style={{ background: '#0891b2' }}>
            {AI_MANAGED.length}
          </span>
        </div>
        {needsHuman > 0 && (
          <span className="text-[11px] font-medium px-2 py-0.5 rounded-full"
            style={{ background: 'rgba(220,38,38,0.08)', color: '#dc2626' }}>
            ⚠️ {needsHuman} 需人工介入
          </span>
        )}
      </div>
      <div className="divide-y divide-border">
        {AI_MANAGED.map(item => {
          const st = MANAGED_STATUS_META[item.status];
          return (
            <button key={item.id} onClick={() => onSelect(item.id)}
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-surface-2 transition-colors text-left">
              <span className="text-lg leading-none">{item.flag}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-sm font-medium text-text-primary">{item.buyer}</span>
                  {item.alert && (
                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded"
                      style={{
                        background: item.status === 'needs_human' ? 'rgba(220,38,38,0.08)' : 'rgba(217,119,6,0.08)',
                        color:      item.status === 'needs_human' ? '#dc2626'               : '#d97706',
                      }}>
                      {item.alert}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-0.5">
                  {FUNNEL.map((stage, i) => (
                    <div key={i} className="flex items-center gap-0.5">
                      <div className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                        style={{ background: i <= item.stage ? '#0891b2' : 'rgba(107,114,128,0.25)' }} />
                      <span className={`text-[10px] ${i === item.stage ? 'font-medium text-text-secondary' : 'text-text-muted'}`}>
                        {stage}
                      </span>
                      {i < FUNNEL.length - 1 && (
                        <div className="w-3 h-px mx-0.5 flex-shrink-0"
                          style={{ background: i < item.stage ? '#0891b2' : 'rgba(107,114,128,0.2)' }} />
                      )}
                    </div>
                  ))}
                </div>
              </div>
              <span className="text-[11px] font-medium px-2 py-0.5 rounded-full flex-shrink-0"
                style={{ background: st.bg, color: st.color }}>
                {st.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Dashboard ───────────────────────────────────────────────────────────────

function Dashboard({ onInquiryClick }: { onInquiryClick: (id: string) => void }) {
  const topId = INQUIRIES.find(i => i.status === 'hot')?.id ?? INQUIRIES[0].id;
  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-5 space-y-5">

        <div className="grid grid-cols-4 gap-3">
          {[
            { label: '今日询盘',    value: '23',  icon: <MessageSquare size={14} />, color: '#0891b2' },
            { label: '待回复',      value: '5',   icon: <Clock size={14} />,         color: '#d97706' },
            { label: '转报价率',    value: '35%', icon: <TrendingUp size={14} />,    color: '#16a34a' },
            { label: '⚠️ 大单预警', value: '2',   icon: <AlertTriangle size={14} />, color: '#dc2626' },
          ].map(s => (
            <div key={s.label} className="card p-4">
              <div className="flex items-center gap-1.5 mb-2" style={{ color: s.color }}>
                {s.icon}
                <span className="text-[11px] font-medium text-text-muted">{s.label}</span>
              </div>
              <p className="text-2xl font-bold font-display text-text-primary">{s.value}</p>
            </div>
          ))}
        </div>

        <AiManagedCard onSelect={onInquiryClick} />

        <div className="card overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <p className="text-sm font-semibold text-text-primary">近期询盘</p>
            <button
              data-demo-target="conversion_reply"
              onClick={() => {
                onInquiryClick(topId);
              }}
              className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-all text-white"
              style={{ background: '#0891b2' }}>
              <MessageSquare size={12} />生成回复建议
            </button>
          </div>
          <div className="divide-y divide-border">
            {INQUIRIES.map(inq => {
              const st = STATUS_META[inq.status as keyof typeof STATUS_META];
              return (
                <button key={inq.id} onClick={() => onInquiryClick(inq.id)}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-surface-2 transition-colors text-left">
                  <div className="w-8 h-8 rounded-full bg-surface-2 border border-border flex items-center justify-center text-sm flex-shrink-0">
                    {inq.country}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-text-primary truncate">{inq.buyer}</p>
                      <span className="text-[10px] px-1.5 py-0.5 rounded font-mono bg-surface-2 border border-border text-text-muted">{inq.lang}</span>
                    </div>
                    <p className="text-xs text-text-muted truncate">{inq.product}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-sm font-semibold text-text-primary">{inq.amount}</p>
                    <p className="text-[10px] text-text-muted">{inq.time}</p>
                  </div>
                  <span className="text-[11px] font-medium px-2 py-0.5 rounded-full flex-shrink-0"
                    style={{ background: st.bg, color: st.color }}>
                    {st.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="card p-4">
          <p className="text-sm font-semibold text-text-primary mb-3">今日待办</p>
          <div className="space-y-2">
            {TASKS.map((t, i) => (
              <div key={i} className="flex items-center gap-2.5">
                {t.done
                  ? <CheckCircle2 size={15} className="text-accent flex-shrink-0" />
                  : <Circle size={15} className="text-text-muted flex-shrink-0" />}
                <span className={`text-sm flex-1 ${t.done ? 'text-text-muted line-through' : 'text-text-secondary'}`}>
                  {t.label}
                </span>
                {t.urgent && !t.done && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                    style={{ background: 'rgba(220,38,38,0.08)', color: '#dc2626' }}>
                    紧急
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}

function QualifiedCustomersPanel({ onOpenInquiry }: { onOpenInquiry: (id: string) => void }) {
  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto px-6 py-5 space-y-5">
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: '今日进线', value: '23', color: '#0891b2' },
            { label: '高质量询盘', value: '8', color: '#16a34a' },
            { label: '已自动首响', value: '17', color: '#4f46e5' },
            { label: '需人工介入', value: '3', color: '#dc2626' },
          ].map(item => (
            <div key={item.label} className="card p-4">
              <p className="text-[11px] font-medium text-text-muted">{item.label}</p>
              <p className="mt-2 text-2xl font-bold font-display" style={{ color: item.color }}>{item.value}</p>
            </div>
          ))}
        </div>

        <div className="card overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <div className="flex items-center gap-2">
              <Filter size={14} className="text-accent" />
              <p className="text-sm font-semibold text-text-primary">成交客资自动筛选</p>
            </div>
            <span className="text-[11px] font-semibold px-2 py-1 rounded-md bg-green-50 text-green-700">自动回复开启</span>
          </div>
          <div className="divide-y divide-border">
            {QUALIFIED_CUSTOMERS.map((item, index) => (
              <button key={item.buyer} onClick={() => onOpenInquiry(index === 1 ? '4' : index === 2 ? '2' : index === 3 ? '5' : '1')}
                className="w-full grid grid-cols-[minmax(160px,1fr)_120px_90px_minmax(180px,1fr)_150px] gap-3 px-4 py-3 text-left hover:bg-surface-2 transition-colors">
                <div>
                  <p className="text-sm font-semibold text-text-primary">{item.buyer}</p>
                  <p className="text-xs text-text-muted">{item.source} · {item.product}</p>
                </div>
                <div>
                  <p className="text-[11px] text-text-muted">质量分</p>
                  <p className="text-lg font-bold text-text-primary">{item.score}</p>
                </div>
                <span className={`mt-2 h-fit rounded-full px-2 py-1 text-[11px] font-bold ${item.score >= 90 ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>
                  {item.score >= 90 ? '高意向' : '可培育'}
                </span>
                <p className="text-xs leading-relaxed text-text-secondary">{item.reason}</p>
                <p className="text-xs font-semibold text-accent">{item.action}</p>
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-border bg-surface p-4">
          <p className="text-sm font-semibold text-text-primary">自动回复规则</p>
          <div className="mt-3 grid grid-cols-3 gap-3">
            {['新询盘 2 分钟内自动首响', '高分询盘推送人工报价', '低分询盘自动发目录/样品政策'].map(rule => (
              <div key={rule} className="rounded-lg border border-border bg-white px-3 py-3 text-xs font-semibold text-text-secondary">{rule}</div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ReactivationPanel({ onChatClick }: { onChatClick: () => void }) {
  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto px-6 py-5 space-y-5">
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: '老客总数', value: '632', color: '#16a34a' },
            { label: '60天沉默', value: '65', color: '#d97706' },
            { label: 'VIP待跟进', value: '18', color: '#4f46e5' },
            { label: '本月复购率', value: '34%', color: '#0891b2' },
          ].map(item => (
            <div key={item.label} className="card p-4">
              <p className="text-[11px] font-medium text-text-muted">{item.label}</p>
              <p className="mt-2 text-2xl font-bold font-display" style={{ color: item.color }}>{item.value}</p>
            </div>
          ))}
        </div>

        <div className="card overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <div className="flex items-center gap-2">
              <RefreshCw size={14} className="text-green-700" />
              <p className="text-sm font-semibold text-text-primary">老客唤醒 · 今日优先</p>
            </div>
            <button type="button" onClick={onChatClick} className="rounded-lg bg-slate-950 px-3 py-1.5 text-xs font-bold text-white">生成唤醒话术</button>
          </div>
          <div className="divide-y divide-border">
            {REACTIVATION_CUSTOMERS.map(item => (
              <div key={item.buyer} className="grid grid-cols-[minmax(160px,1fr)_120px_120px_minmax(160px,1fr)_150px] gap-3 px-4 py-3">
                <div>
                  <p className="text-sm font-semibold text-text-primary">{item.buyer}</p>
                  <p className="text-xs text-text-muted">{item.channel} · {item.tier}</p>
                </div>
                <p className="text-xs font-semibold text-amber-700">{item.last}</p>
                <p className="text-xs text-text-secondary">{item.product}</p>
                <p className="text-xs leading-relaxed text-text-muted">基于历史采购偏好自动匹配新品/补货理由</p>
                <button type="button" className="h-fit rounded-lg border border-border px-3 py-2 text-xs font-bold text-text-secondary hover:bg-surface-2">{item.action}</button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Customer Chat View ───────────────────────────────────────────────────────

function CustomerChatView({
  selectedId,
  onSelectInquiry,
  onBack,
  onLeaveConversation,
}: {
  selectedId: string;
  onSelectInquiry: (id: string) => void;
  onBack: () => void;
  onLeaveConversation: () => void;
}) {
  const [aiMode, setAiMode]             = useState(true);
  const [humanInput, setHumanInput]     = useState('');
  const [suggestionOpen, setSuggestionOpen] = useState(false);
  const [translating, setTranslating]   = useState(false);
  const [sentMessages, setSentMessages] = useState<ChatMsg[]>([]);
  const [stageByCustomer, setStageByCustomer] = useState<Record<string, string>>(DEFAULT_CONVERSION_STAGE);
  const bottomRef = useRef<HTMLDivElement>(null);

  const inquiry      = INQUIRIES.find(i => i.id === selectedId)!;
  const thread       = [...(MOCK_THREADS[selectedId] ?? []), ...sentMessages];
  const aiSuggestion = AI_SUGGESTIONS[selectedId];
  const langMeta     = LANG_META[inquiry.lang] ?? LANG_META.EN;
  const hasChinese   = /[一-鿿]/.test(humanInput);
  const currentStage  = stageByCustomer[selectedId] ?? CONVERSION_STAGES[0];

  // Reset local conversation state on inquiry change.
  useEffect(() => {
    setAiMode(true);
    setHumanInput('');
    setSuggestionOpen(false);
    setSentMessages([]);
    bottomRef.current?.scrollIntoView({ behavior: 'instant' });
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  const switchToHuman = () => {
    setAiMode(false);
    if (aiSuggestion) setHumanInput(aiSuggestion);
  };

  const switchToAi = () => {
    setAiMode(true);
    setHumanInput('');
    setSuggestionOpen(false);
  };

  const handleBack = () => {
    onLeaveConversation();
    onBack();
  };

  const handleTranslate = () => {
    if (!hasChinese || translating) return;
    setTranslating(true);
    setTimeout(() => {
      setHumanInput(mockTranslate(inquiry.lang, humanInput));
      setTranslating(false);
    }, 700);
  };

  const handleSend = () => {
    const text = humanInput.trim();
    if (!text) return;
    setSentMessages(prev => [...prev, {
      role: 'seller',
      time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
      content: text,
      byAi: false,
      zh: '发送成功；系统将通过已连接渠道外发并记录送达状态',
    }]);
    setHumanInput('');
    setSuggestionOpen(false);
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
  };

  return (
    <div className="flex h-full">

      {/* Left: inquiry queue */}
      <div className="w-52 border-r border-border flex flex-col flex-shrink-0">
        <div className="px-3 py-2.5 border-b border-border">
          <p className="text-[10px] font-semibold text-text-muted uppercase tracking-widest">询盘队列</p>
        </div>
        <div className="flex-1 overflow-y-auto">
          {INQUIRIES.map(inq => {
            const st = STATUS_META[inq.status as keyof typeof STATUS_META];
            const isSelected = inq.id === selectedId;
            return (
              <button key={inq.id} onClick={() => onSelectInquiry(inq.id)}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors border-l-2 ${
                  isSelected ? 'bg-surface-2 border-l-[#0891b2]' : 'hover:bg-surface-2 border-l-transparent'
                }`}>
                <span className="text-base leading-none">{inq.country}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-text-primary truncate">{inq.buyer.split(' ')[0]}</p>
                  <p className="text-[10px] text-text-muted truncate mt-0.5">{inq.product}</p>
                </div>
                <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: st.color }} />
              </button>
            );
          })}
        </div>
      </div>

      {/* Right: chat */}
      <div className="flex-1 flex flex-col min-w-0">

        {/* Chat header */}
        <div className="h-12 flex items-center justify-between px-4 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <button onClick={handleBack}
              className="p-1 rounded-md hover:bg-surface-2 text-text-muted transition-colors flex-shrink-0">
              <ChevronLeft size={16} />
            </button>
            <span className="text-base leading-none">{inquiry.country}</span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-text-primary leading-none truncate">{inquiry.buyer}</p>
              <p className="text-[10px] text-text-muted mt-0.5 truncate">{inquiry.product} · {inquiry.amount}</p>
            </div>
          </div>

          {/* AI / Human toggle */}
          <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-surface-2 border border-border flex-shrink-0">
            <button onClick={switchToAi}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold transition-all ${
                aiMode ? 'bg-surface text-text-primary shadow-sm' : 'text-text-muted hover:text-text-secondary'
              }`}>
              <Bot size={11} />AI 托管
            </button>
            <button onClick={switchToHuman}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold transition-all ${
                !aiMode ? 'bg-surface text-text-primary shadow-sm' : 'text-text-muted hover:text-text-secondary'
              }`}>
              <User size={11} />人工接入
            </button>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {thread.map((msg, i) => (
            <div key={i} className={`flex gap-2 ${msg.role === 'seller' ? 'flex-row-reverse' : ''}`}>
              {/* Avatar */}
              <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 text-sm mt-0.5"
                style={{
                  background: msg.role === 'buyer'
                    ? 'rgba(107,114,128,0.12)'
                    : msg.byAi ? 'rgba(8,145,178,0.15)' : 'rgba(107,114,128,0.15)',
                }}>
                {msg.role === 'buyer'
                  ? inquiry.country
                  : msg.byAi
                    ? <Bot size={13} style={{ color: '#0891b2' }} />
                    : <User size={13} style={{ color: '#6b7280' }} />}
              </div>

              <div className="max-w-[72%]">
                {/* Bubble */}
                <div className={`px-3 py-2 rounded-2xl text-sm leading-relaxed ${
                  msg.role === 'buyer'
                    ? 'bg-surface-2 border border-border text-text-primary rounded-tl-sm'
                    : 'text-white rounded-tr-sm'
                }`} style={msg.role === 'seller' ? { background: msg.byAi ? '#0891b2' : '#374151' } : {}}>
                  {msg.content}
                </div>

                {/* Timestamp + AI badge */}
                <div className={`flex items-center gap-1.5 mt-1 px-1 ${msg.role === 'seller' ? 'flex-row-reverse' : ''}`}>
                  <span className="text-[10px] text-text-muted">{msg.time}</span>
                  {msg.byAi && msg.role === 'seller' && (
                    <span className="flex items-center gap-0.5 text-[10px]" style={{ color: '#0891b2' }}>
                      <Sparkles size={9} />AI 自动发送
                    </span>
                  )}
                </div>

                {/* 中文注释 — AI 托管模式下显示 */}
                {aiMode && msg.zh && (
                  <div className={`flex items-start gap-1 mt-1 px-1 ${msg.role === 'seller' ? 'justify-end' : ''}`}>
                    <span className="text-[10px] leading-relaxed text-text-muted"
                      style={{ fontStyle: 'italic' }}>
                      中：{msg.zh}
                    </span>
                  </div>
                )}
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        {/* Bottom bar */}
        {aiMode ? (
          <div className="px-4 py-3 border-t border-border flex-shrink-0 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: '#0891b2' }} />
              <span className="text-xs text-text-muted">AI 托管中 · 自动回复已开启</span>
            </div>
            <button onClick={switchToHuman}
              className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-border hover:border-border-bright hover:text-text-primary text-text-muted transition-all">
              <User size={11} />立即接入
            </button>
          </div>
        ) : (
          <div className="px-4 pb-4 pt-2 flex-shrink-0 space-y-2">

            {/* AI 建议折叠条 */}
            {aiSuggestion && (
              <div className="rounded-xl border border-dashed overflow-hidden"
                style={{ borderColor: 'rgba(8,145,178,0.35)', background: 'rgba(8,145,178,0.04)' }}>
                <button onClick={() => setSuggestionOpen(v => !v)}
                  className="w-full flex items-center justify-between px-3 py-2">
                  <div className="flex items-center gap-1.5">
                    <Sparkles size={11} style={{ color: '#0891b2' }} />
                    <span className="text-xs font-medium" style={{ color: '#0891b2' }}>AI 建议回复</span>
                  </div>
                  <ChevronDown size={12} style={{ color: '#0891b2' }}
                    className={`transition-transform duration-200 ${suggestionOpen ? 'rotate-180' : ''}`} />
                </button>
                <AnimatePresence>
                  {suggestionOpen && (
                    <motion.div key="sugg"
                      initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.18 }}
                      className="overflow-hidden">
                      <div className="px-3 pb-3 space-y-2.5">
                        <p className="text-xs text-text-secondary leading-relaxed">{aiSuggestion}</p>
                        <button onClick={() => { setHumanInput(aiSuggestion); setSuggestionOpen(false); }}
                          className="text-xs font-medium px-2.5 py-1 rounded-lg text-white"
                          style={{ background: '#0891b2' }}>
                          采用此建议
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}

            {/* Input box */}
            <div className="rounded-2xl border border-border bg-surface-2 overflow-hidden focus-within:border-border-bright transition-colors">
              <textarea
                value={humanInput}
                onChange={e => setHumanInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) e.preventDefault(); }}
                placeholder={`用中文或 ${langMeta.full} 输入回复…`}
                rows={2}
                className="w-full px-4 pt-3 pb-1 bg-transparent text-sm text-text-primary placeholder:text-text-muted resize-none outline-none" />

              <div className="flex items-center justify-between px-3 pb-3 pt-1">
                <div className="flex items-center gap-2">
                  {/* 目标语言徽章 */}
                  <div className="flex items-center gap-1 px-2 py-1 rounded-md bg-surface border border-border">
                    <Languages size={10} style={{ color: '#0891b2' }} />
                    <span className="text-[11px] font-medium" style={{ color: '#0891b2' }}>
                      → {langMeta.name}
                    </span>
                    <span className="text-[10px] text-text-muted ml-0.5">已自动识别</span>
                  </div>
                  {/* 一键翻译按钮 */}
                  <button onClick={handleTranslate}
                    disabled={!hasChinese || translating}
                    className="flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-lg border transition-all disabled:opacity-40"
                    style={{
                      borderColor: hasChinese && !translating ? 'rgba(8,145,178,0.4)' : undefined,
                      color:       hasChinese && !translating ? '#0891b2' : undefined,
                      background:  hasChinese && !translating ? 'rgba(8,145,178,0.06)' : undefined,
                    }}>
                    {translating
                      ? <><Loader2 size={10} className="animate-spin" />翻译中…</>
                      : <><Languages size={10} />一键翻译</>}
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  <button onClick={switchToAi}
                    className="flex items-center gap-1 text-xs text-text-muted hover:text-text-secondary transition-colors">
                    <Bot size={11} />切回 AI 托管
                  </button>
                  <button onClick={handleSend} disabled={!humanInput.trim()}
                    className="w-8 h-8 rounded-xl flex items-center justify-center transition-all disabled:opacity-40"
                    style={{ background: '#0891b2', boxShadow: '0 2px 8px rgba(8,145,178,0.3)' }}>
                    <Send size={13} className="text-white" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="w-60 border-l border-border bg-surface flex-shrink-0 px-4 py-4 overflow-y-auto">
        <p className="text-[10px] font-semibold text-text-muted uppercase tracking-widest mb-2">客户阶段</p>
        <div className="rounded-2xl border border-border bg-surface-2 p-3 mb-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-base leading-none">{inquiry.country}</span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-text-primary truncate">{inquiry.buyer}</p>
              <p className="text-[10px] text-text-muted truncate">{inquiry.product}</p>
            </div>
          </div>
          <p className="text-xs text-text-muted">当前阶段</p>
          <p className="text-xl font-bold font-display mt-1" style={{ color: '#0891b2' }}>{currentStage}</p>
        </div>

        <div className="space-y-2">
          {CONVERSION_STAGES.map((stage, idx) => {
            const active = stage === currentStage;
            return (
              <button
                key={stage}
                onClick={() => setStageByCustomer(prev => ({ ...prev, [selectedId]: stage }))}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-xl border text-left transition-all ${
                  active ? 'border-[#0891b2] bg-[#0891b2]/10 text-text-primary' : 'border-border hover:border-border-bright text-text-secondary'
                }`}>
                <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold"
                  style={{ background: active ? '#0891b2' : 'rgba(107,114,128,0.12)', color: active ? '#fff' : '#6b7280' }}>
                  {idx + 1}
                </span>
                <span className="text-sm font-semibold">{stage}</span>
              </button>
            );
          })}
        </div>

        <div className="mt-4 rounded-xl bg-surface-2 border border-border p-3 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-text-muted">语言</span>
            <span className="font-medium text-text-secondary">{langMeta.full}</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-text-muted">金额</span>
            <span className="font-medium text-text-secondary">{inquiry.amount}</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-text-muted">最近进线</span>
            <span className="font-medium text-text-secondary">{inquiry.time}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── ConversionPage (root) ────────────────────────────────────────────────────

export default function ConversionPage({
  onEnterConversation,
  onLeaveConversation,
  isInConversation,
  restore,
  kickoff,
  onAction,
  onSessionRefresh,
}: Props) {
  const [viewMode, setViewMode]                 = useState<ViewMode>('dashboard');
  const [selectedInquiryId, setSelectedInquiryId] = useState('1');

  useEffect(() => { if (restore) setViewMode('chat'); }, [restore?.key]);  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (kickoff) setViewMode('chat'); }, [kickoff?.key]);  // eslint-disable-line react-hooks/exhaustive-deps

  const openCustomerChat = (id: string) => {
    setSelectedInquiryId(id);
    setViewMode('customer-chat');
  };

  const handleEnterChat = (ctx: ConversationContext) => {
    setViewMode('chat');
    onEnterConversation(ctx);
  };

  const handleLeave = () => {
    setViewMode('dashboard');
    onLeaveConversation();
  };

  return (
    <div className="flex flex-col h-full">

      {/* Outer header — hidden in customer-chat (the view has its own header) */}
      {viewMode !== 'customer-chat' && (
        <div className="h-12 flex items-center justify-between px-5 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-6 h-6 rounded-lg flex items-center justify-center"
              style={{ background: 'rgba(8,145,178,0.1)', color: '#0891b2' }}>
              <Users size={13} />
            </div>
            <span className="text-sm font-semibold text-text-primary">我的客户</span>
            {isInConversation && viewMode === 'chat' && (
              <span className="flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full ml-1"
                style={{ background: 'rgba(8,145,178,0.1)', color: '#0891b2' }}>
                <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />客户助手
              </span>
            )}
          </div>
          <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-surface-2 border border-border">
            {([
              { mode: 'dashboard' as ViewMode, icon: <MessageSquare size={12} />, label: '潜客询盘' },
              { mode: 'qualified' as ViewMode, icon: <Filter size={12} />, label: '成交客资' },
              { mode: 'reactivation' as ViewMode, icon: <RefreshCw size={12} />, label: '老客唤醒' },
              { mode: 'chat'      as ViewMode, icon: <Bot size={12} />, label: '跟单回复建议' },
            ] as const).map(({ mode, icon, label }) => (
              <button key={mode}
                onClick={() => {
                  if (mode === 'chat') handleEnterChat({ agent: 'conversion' });
                  else setViewMode(mode);
                }}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold transition-all ${
                  viewMode === mode
                    ? 'bg-surface text-text-primary shadow-sm'
                    : 'text-text-muted hover:text-text-secondary'
                }`}>
                {icon}<span>{label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-hidden">
        <AnimatePresence mode="wait">
          {viewMode === 'dashboard' && (
            <motion.div key="dashboard" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="h-full">
              <Dashboard onInquiryClick={openCustomerChat} />
            </motion.div>
          )}
          {viewMode === 'qualified' && (
            <motion.div key="qualified" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="h-full">
              <QualifiedCustomersPanel onOpenInquiry={openCustomerChat} />
            </motion.div>
          )}
          {viewMode === 'reactivation' && (
            <motion.div key="reactivation" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="h-full">
              <ReactivationPanel onChatClick={() => handleEnterChat({
                agent: 'conversion',
                messages: [{ role: 'user', content: '请根据当前老客列表，生成老客唤醒分层、触达节奏和 WhatsApp 跟进话术。' }],
              })} />
            </motion.div>
          )}
          {viewMode === 'chat' && (
            <motion.div key="chat" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="h-full">
              <AgentChatPage
                config={{
                  type: 'conversion',
                  apiPath: '/api/overseas/agents/conversion/chat',
                  color: '#0891b2',
                  bg: 'rgba(8,145,178,0.1)',
                  icon: <MessageSquare size={13} />,
                  name: '我的客户',
                  tagline: '询盘筛选 · 自动回复 · 跟单建议 · 老客唤醒',
                  suggestions: [
                    '首响询盘模板',
                    '大单跟进话术',
                    '询盘优先级',
                    '未回复跟单话术',
                  ],
                }}
                onEnterConversation={handleEnterChat}
                onLeaveConversation={handleLeave}
                isInConversation={isInConversation}
                restoreKey={restore?.key}
                restoreMessages={restore?.messages}
                kickoff={kickoff}
                onAction={onAction}
                onSessionRefresh={onSessionRefresh}
              />
            </motion.div>
          )}
          {viewMode === 'customer-chat' && (
            <motion.div key="customer-chat" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="h-full">
              <CustomerChatView
                selectedId={selectedInquiryId}
                onSelectInquiry={setSelectedInquiryId}
                onBack={() => setViewMode('dashboard')}
                onLeaveConversation={onLeaveConversation}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
