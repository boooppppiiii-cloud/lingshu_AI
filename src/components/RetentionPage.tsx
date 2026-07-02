import { useState, useEffect } from 'react';
import { RefreshCw, LayoutGrid, MessageSquare, Users, TrendingUp, Sparkles, Bell, Send, ShoppingBag, Clock3 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import AgentChatPage from './AgentChatPage';
import type { ConversationContext, RestoreSignal, KickoffSignal, AgentAction, Message } from '../App';

type ViewMode = 'dashboard' | 'chat';

interface Props {
  onEnterConversation: (ctx: ConversationContext) => void;
  onLeaveConversation: () => void;
  isInConversation: boolean;
  restore?: RestoreSignal;
  kickoff?: KickoffSignal;
  onAction?: AgentAction;
  onSessionRefresh?: () => void;
}

const SEGMENTS = [
  { label: '高价值老客', count: 87,  desc: '客单价 > $500，近90天活跃', color: '#16a34a', bg: 'rgba(22,163,74,0.08)' },
  { label: '30天沉默',   count: 47,  desc: '距上次采购30-60天',          color: '#d97706', bg: 'rgba(217,119,6,0.08)' },
  { label: '60天沉默',   count: 18,  desc: '距上次采购60-90天',          color: '#dc2626', bg: 'rgba(220,38,38,0.08)' },
  { label: '待推品客户', count: 124, desc: '历史偏好与新品匹配',          color: '#4f46e5', bg: 'rgba(79,70,229,0.08)' },
];

type Customer = {
  id: string;
  buyer: string;
  country: string;
  market: string;
  channel: string;
  tier: 'VIP' | '复购客' | '沉睡客' | '新客';
  product: string;
  suggest: string;
  lastOrder: string;
  orders: number;
  totalAmount: string;
  avgOrder: string;
  lastSku: string;
  lastMessage: string;
  risk: '高' | '中' | '低';
  nextAction: string;
};

const CUSTOMERS: Customer[] = [
  { id: 'C-1001', buyer: 'Khalid Mohammed', country: '🇸🇦', market: '沙特', channel: 'WhatsApp', tier: '沉睡客', product: '假发', suggest: '新款棕色直发14寸', lastOrder: '68天前', orders: 5, totalAmount: '$42,600', avgOrder: '$8,520', lastSku: 'HD Lace Wig 13x4', lastMessage: '询问是否有更自然发际线款', risk: '高', nextAction: '发新品目录 + 老客价' },
  { id: 'C-1002', buyer: 'Linh Nguyen', country: '🇻🇳', market: '越南', channel: 'Zalo', tier: '复购客', product: '发饰', suggest: '春季新款发箍套装', lastOrder: '45天前', orders: 3, totalAmount: '$8,400', avgOrder: '$2,800', lastSku: 'Pearl Hairband Mix', lastMessage: '上次反馈儿童款卖得快', risk: '中', nextAction: '推荐亲子组合包' },
  { id: 'C-1003', buyer: 'Carlos Rivera', country: '🇲🇽', market: '墨西哥', channel: 'WhatsApp', tier: '沉睡客', product: '艾灸贴', suggest: '升级版热敷贴', lastOrder: '55天前', orders: 4, totalAmount: '$18,900', avgOrder: '$4,725', lastSku: 'Herbal Heat Patch', lastMessage: '关注物流时效和西语包装', risk: '中', nextAction: '发西语包装样图' },
  { id: 'C-1004', buyer: 'Aisha Rahman', country: '🇦🇪', market: '阿联酋', channel: 'WhatsApp', tier: 'VIP', product: '香薰蜡烛', suggest: '斋月礼盒套装', lastOrder: '18天前', orders: 9, totalAmount: '$126,000', avgOrder: '$14,000', lastSku: 'Oud Candle Gift Set', lastMessage: '询问节日前到货排期', risk: '低', nextAction: '确认补货窗口' },
  { id: 'C-1005', buyer: 'Maria Santos', country: '🇵🇭', market: '菲律宾', channel: 'Messenger', tier: '复购客', product: '美甲贴', suggest: '夏季亮片组合', lastOrder: '31天前', orders: 4, totalAmount: '$13,600', avgOrder: '$3,400', lastSku: 'Glitter Nail Wrap', lastMessage: '希望拿到小额混批价', risk: '中', nextAction: '推混批阶梯价' },
  { id: 'C-1006', buyer: 'Omar Hassan', country: '🇪🇬', market: '埃及', channel: 'WhatsApp', tier: '沉睡客', product: '手机壳', suggest: '防摔磁吸壳', lastOrder: '74天前', orders: 2, totalAmount: '$6,200', avgOrder: '$3,100', lastSku: 'MagSafe Armor Case', lastMessage: '曾询问三星机型库存', risk: '高', nextAction: '按机型发库存表' },
  { id: 'C-1007', buyer: 'Anna Kowalski', country: '🇵🇱', market: '波兰', channel: 'Email', tier: '复购客', product: '宠物梳', suggest: '双面除毛梳', lastOrder: '22天前', orders: 3, totalAmount: '$15,900', avgOrder: '$5,300', lastSku: 'Pet Grooming Comb', lastMessage: '要求 CE 文件', risk: '低', nextAction: '附认证和报价' },
  { id: 'C-1008', buyer: 'Ahmed Saleh', country: '🇶🇦', market: '卡塔尔', channel: 'WhatsApp', tier: 'VIP', product: '男士香水', suggest: '木质调旅行装', lastOrder: '12天前', orders: 11, totalAmount: '$148,500', avgOrder: '$13,500', lastSku: 'Amber Oud Perfume', lastMessage: '要独家包装方案', risk: '低', nextAction: '约定包装打样' },
  { id: 'C-1009', buyer: 'Sofia Garcia', country: '🇨🇱', market: '智利', channel: 'WhatsApp', tier: '沉睡客', product: '厨房收纳', suggest: '可折叠沥水架', lastOrder: '83天前', orders: 2, totalAmount: '$5,800', avgOrder: '$2,900', lastSku: 'Foldable Rack', lastMessage: '担心海运体积费', risk: '高', nextAction: '发压缩包装方案' },
  { id: 'C-1010', buyer: 'Minh Tran', country: '🇻🇳', market: '越南', channel: 'Zalo', tier: '新客', product: '家居灯带', suggest: 'USB 氛围灯带', lastOrder: '16天前', orders: 1, totalAmount: '$3,600', avgOrder: '$3,600', lastSku: 'LED Strip 5M', lastMessage: '试单后等客户反馈', risk: '中', nextAction: '询问试销反馈' },
  { id: 'C-1011', buyer: 'Noura Al Ali', country: '🇰🇼', market: '科威特', channel: 'WhatsApp', tier: 'VIP', product: '礼品包装', suggest: '金色开窗礼盒', lastOrder: '25天前', orders: 8, totalAmount: '$92,000', avgOrder: '$11,500', lastSku: 'Luxury Gift Box', lastMessage: '需要 Ramadan 标签', risk: '低', nextAction: '发节日标签样稿' },
  { id: 'C-1012', buyer: 'Diego Perez', country: '🇵🇪', market: '秘鲁', channel: 'Email', tier: '复购客', product: '车载支架', suggest: '磁吸快充支架', lastOrder: '39天前', orders: 4, totalAmount: '$24,800', avgOrder: '$6,200', lastSku: 'Car Phone Holder', lastMessage: '问 500 件交期', risk: '中', nextAction: '更新交期和 MOQ' },
  { id: 'C-1013', buyer: 'Sara Miller', country: '🇺🇸', market: '美国', channel: 'Email', tier: '复购客', product: '瑜伽袜', suggest: '防滑普拉提袜', lastOrder: '28天前', orders: 3, totalAmount: '$21,300', avgOrder: '$7,100', lastSku: 'Grip Yoga Socks', lastMessage: '关注亚马逊 FBA 标签', risk: '低', nextAction: '发 FBA 贴标服务' },
  { id: 'C-1014', buyer: 'Yusuf Demir', country: '🇹🇷', market: '土耳其', channel: 'WhatsApp', tier: '沉睡客', product: '剃须刀', suggest: 'USB 充电旅行款', lastOrder: '91天前', orders: 2, totalAmount: '$7,400', avgOrder: '$3,700', lastSku: 'Mini Shaver', lastMessage: '曾压价 8%', risk: '高', nextAction: '发限时返单价' },
  { id: 'C-1015', buyer: 'Emily Brown', country: '🇬🇧', market: '英国', channel: 'Email', tier: '复购客', product: '婴儿围兜', suggest: '硅胶可调围兜', lastOrder: '34天前', orders: 4, totalAmount: '$29,600', avgOrder: '$7,400', lastSku: 'Silicone Bib', lastMessage: '需要 UKCA 文件', risk: '中', nextAction: '补充合规资料' },
  { id: 'C-1016', buyer: 'Fatima Zahra', country: '🇲🇦', market: '摩洛哥', channel: 'WhatsApp', tier: '沉睡客', product: '头巾配饰', suggest: '珍珠别针套装', lastOrder: '63天前', orders: 3, totalAmount: '$9,900', avgOrder: '$3,300', lastSku: 'Hijab Pin Set', lastMessage: '喜欢金色款', risk: '高', nextAction: '发金色新款图' },
  { id: 'C-1017', buyer: 'Hiro Tanaka', country: '🇯🇵', market: '日本', channel: 'Email', tier: '新客', product: '桌面收纳', suggest: '透明抽屉盒', lastOrder: '20天前', orders: 1, totalAmount: '$4,800', avgOrder: '$4,800', lastSku: 'Acrylic Drawer', lastMessage: '要求尺寸误差说明', risk: '低', nextAction: '发规格书' },
  { id: 'C-1018', buyer: 'Priya Sharma', country: '🇮🇳', market: '印度', channel: 'WhatsApp', tier: '复购客', product: '发夹', suggest: '大号鲨鱼夹', lastOrder: '29天前', orders: 5, totalAmount: '$19,500', avgOrder: '$3,900', lastSku: 'Claw Clip Set', lastMessage: '希望加入彩色混装', risk: '低', nextAction: '推彩色混装' },
  { id: 'C-1019', buyer: 'Maya Putri', country: '🇮🇩', market: '印尼', channel: 'WhatsApp', tier: '沉睡客', product: '穆斯林服饰', suggest: '轻薄开衫', lastOrder: '72天前', orders: 3, totalAmount: '$17,400', avgOrder: '$5,800', lastSku: 'Modest Cardigan', lastMessage: '问过大码库存', risk: '高', nextAction: '按尺码发库存' },
  { id: 'C-1020', buyer: 'Lucas Silva', country: '🇧🇷', market: '巴西', channel: 'WhatsApp', tier: '复购客', product: '蓝牙耳机', suggest: '低延迟游戏耳机', lastOrder: '36天前', orders: 4, totalAmount: '$36,800', avgOrder: '$9,200', lastSku: 'TWS Earbuds Pro', lastMessage: '反馈包装破损率', risk: '中', nextAction: '说明加固方案' },
  { id: 'C-1021', buyer: 'Layla Haddad', country: '🇯🇴', market: '约旦', channel: 'WhatsApp', tier: 'VIP', product: '女包', suggest: '斋月金扣小方包', lastOrder: '14天前', orders: 7, totalAmount: '$108,500', avgOrder: '$15,500', lastSku: 'Crossbody Bag', lastMessage: '等新色卡', risk: '低', nextAction: '发新色卡' },
  { id: 'C-1022', buyer: 'Elena Rossi', country: '🇮🇹', market: '意大利', channel: 'Email', tier: '复购客', product: '咖啡杯', suggest: '陶瓷马克杯套装', lastOrder: '41天前', orders: 3, totalAmount: '$26,700', avgOrder: '$8,900', lastSku: 'Ceramic Mug Set', lastMessage: '关注洗碗机测试', risk: '中', nextAction: '发测试报告' },
  { id: 'C-1023', buyer: 'Hassan Khan', country: '🇵🇰', market: '巴基斯坦', channel: 'WhatsApp', tier: '沉睡客', product: '运动水杯', suggest: '大容量吸管杯', lastOrder: '77天前', orders: 2, totalAmount: '$6,600', avgOrder: '$3,300', lastSku: 'Sports Bottle', lastMessage: '曾询问 logo 定制', risk: '高', nextAction: '发定制案例' },
  { id: 'C-1024', buyer: 'Chloe Martin', country: '🇫🇷', market: '法国', channel: 'Email', tier: '新客', product: '香氛片', suggest: '车载香氛片', lastOrder: '19天前', orders: 1, totalAmount: '$5,200', avgOrder: '$5,200', lastSku: 'Scent Card', lastMessage: '要法语标签', risk: '低', nextAction: '发法语标签模板' },
  { id: 'C-1025', buyer: 'Ravi Patel', country: '🇰🇪', market: '肯尼亚', channel: 'WhatsApp', tier: '复购客', product: '太阳能灯', suggest: '庭院感应灯', lastOrder: '33天前', orders: 6, totalAmount: '$58,800', avgOrder: '$9,800', lastSku: 'Solar Wall Light', lastMessage: '问雨季防水等级', risk: '中', nextAction: '发 IP65 卖点' },
  { id: 'C-1026', buyer: 'Natalia Ivanova', country: '🇰🇿', market: '哈萨克斯坦', channel: 'Telegram', tier: '沉睡客', product: '保温杯', suggest: '316 不锈钢杯', lastOrder: '86天前', orders: 2, totalAmount: '$8,900', avgOrder: '$4,450', lastSku: 'Vacuum Flask', lastMessage: '物流清关资料未确认', risk: '高', nextAction: '补清关资料' },
  { id: 'C-1027', buyer: 'Ben Cohen', country: '🇮🇱', market: '以色列', channel: 'Email', tier: '复购客', product: '工具包', suggest: '家用维修套装', lastOrder: '27天前', orders: 4, totalAmount: '$31,200', avgOrder: '$7,800', lastSku: 'Tool Kit 45pcs', lastMessage: '要希伯来语说明书', risk: '低', nextAction: '发说明书样稿' },
  { id: 'C-1028', buyer: 'Grace Kim', country: '🇰🇷', market: '韩国', channel: 'Kakao', tier: '新客', product: '化妆刷', suggest: '便携刷套', lastOrder: '11天前', orders: 1, totalAmount: '$6,500', avgOrder: '$6,500', lastSku: 'Makeup Brush Set', lastMessage: '反馈刷毛柔软度不错', risk: '低', nextAction: '促成二次补货' },
  { id: 'C-1029', buyer: 'Noah Smith', country: '🇨🇦', market: '加拿大', channel: 'Email', tier: '沉睡客', product: '露营灯', suggest: '太阳能帐篷灯', lastOrder: '69天前', orders: 3, totalAmount: '$22,500', avgOrder: '$7,500', lastSku: 'Camping Lantern', lastMessage: '季节性采购暂停', risk: '高', nextAction: '发夏季备货提醒' },
  { id: 'C-1030', buyer: 'Mariam Osman', country: '🇸🇩', market: '苏丹', channel: 'WhatsApp', tier: '复购客', product: '围巾', suggest: '轻薄印花围巾', lastOrder: '37天前', orders: 4, totalAmount: '$14,400', avgOrder: '$3,600', lastSku: 'Printed Scarf', lastMessage: '希望降低单款 MOQ', risk: '中', nextAction: '推混款方案' },
  { id: 'C-1031', buyer: 'Pedro Almeida', country: '🇵🇹', market: '葡萄牙', channel: 'Email', tier: '复购客', product: '园艺剪', suggest: '省力修枝剪', lastOrder: '30天前', orders: 5, totalAmount: '$33,500', avgOrder: '$6,700', lastSku: 'Garden Pruner', lastMessage: '关注刀片材质', risk: '低', nextAction: '发材质对比' },
  { id: 'C-1032', buyer: 'Reem Mansour', country: '🇧🇭', market: '巴林', channel: 'WhatsApp', tier: 'VIP', product: '饰品套装', suggest: '珍珠开斋节套装', lastOrder: '9天前', orders: 10, totalAmount: '$136,000', avgOrder: '$13,600', lastSku: 'Pearl Jewelry Set', lastMessage: '准备节日补货', risk: '低', nextAction: '锁定排产位' },
];

const REACTIVATIONS = CUSTOMERS.slice(0, 3);

function buildCustomerHistory(customer: Customer): Message[] {
  return [
    { role: 'user', content: `打开 ${customer.buyer} 的历史沟通，并创建一条老客唤醒任务。` },
    {
      role: 'assistant',
      content: `待正式版本接入您的WhatsApp Business Platform，即可畅享agent自动触达功能。当前您可以试用跟进敬意和消息模版功能\n\n已进入 ${customer.buyer} 的客户历史对话。\n\n客户概况\n- 市场：${customer.market}\n- 渠道：${customer.channel}\n- 分层：${customer.tier}\n- 购买次数：${customer.orders} 次\n- 累计金额：${customer.totalAmount}\n- 最近订单：${customer.lastSku}，${customer.lastOrder}\n- 流失风险：${customer.risk}\n\n历史对话摘要\n- 客户：${customer.lastMessage}\n- 业务员：上次已同步产品细节和交付条件，但后续没有完成复购推进。\n- 留存专家：该客户历史采购品类为「${customer.product}」，当前适合用「${customer.suggest}」做复购唤醒。\n\n唤醒任务已创建\n- 任务：${customer.nextAction}\n- 建议渠道：${customer.channel}\n- 建议话术：Hi ${customer.buyer.split(' ')[0]}, we prepared a new ${customer.suggest} option based on your last order. I can send the latest photos, stock status, and repeat-customer price for your review today.`,
    },
  ];
}

const EVENTS = [
  { label: '斋月开始',    date: '2026-02-27', days: 61, color: '#d97706' },
  { label: '母亲节',      date: '2026-05-10', days: 153, color: '#ec4899' },
  { label: '黑色星期五',  date: '2026-11-27', days: 354, color: '#dc2626' },
];

function Dashboard({ onChatClick, onOpenCustomerHistory }: { onChatClick: () => void; onOpenCustomerHistory: (customer: Customer) => void }) {
  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-5xl mx-auto px-6 py-5 space-y-5">

        {/* Stats */}
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: '老客总数',   value: '632', icon: <Users size={14} />,       color: '#16a34a' },
            { label: '本月复购率', value: '34%', icon: <TrendingUp size={14} />,  color: '#4f46e5' },
            { label: '待唤醒',     value: '65',  icon: <Bell size={14} />,        color: '#d97706' },
            { label: '推品命中率', value: '78%', icon: <Sparkles size={14} />,   color: '#0891b2' },
          ].map(s => (
            <div key={s.label} className="card p-4">
              <div className="flex items-center gap-1.5 mb-2" style={{ color: s.color }}>{s.icon}<span className="text-[11px] font-medium text-text-muted">{s.label}</span></div>
              <p className="text-2xl font-bold font-display text-text-primary">{s.value}</p>
            </div>
          ))}
        </div>

        {/* Segments */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-semibold text-text-primary">客户分层</p>
            <button
              data-demo-target="retention_prompt"
              onClick={() => {
                onChatClick();
              }}
              className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg text-white transition-all"
              style={{ background: '#16a34a' }}>
              <RefreshCw size={12} />让 留存专家 制定策略
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {SEGMENTS.map(seg => (
              <div key={seg.label} className="card p-4 flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: seg.bg, color: seg.color }}>
                  <Users size={14} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-text-primary">{seg.label}</p>
                    <p className="text-lg font-bold font-display" style={{ color: seg.color }}>{seg.count}</p>
                  </div>
                  <p className="text-[11px] text-text-muted mt-0.5">{seg.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Reactivation suggestions */}
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <p className="text-sm font-semibold text-text-primary">唤醒建议 · 今日优先</p>
          </div>
          <div className="divide-y divide-border">
            {REACTIVATIONS.map((r, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2 transition-colors">
                <div className="w-8 h-8 rounded-full bg-surface-2 border border-border flex items-center justify-center text-sm flex-shrink-0">
                  {r.country}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-text-primary">{r.buyer}</p>
                  <p className="text-xs text-text-muted">上次购：{r.product} · {r.lastOrder}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-[11px] text-text-muted">推荐推品</p>
                  <p className="text-xs font-medium text-text-secondary">{r.suggest}</p>
                </div>
                <button onClick={() => onOpenCustomerHistory(r)}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-white flex-shrink-0 bg-text-primary hover:bg-slate-700 transition-colors">
                  <Send size={11} />
                  创建唤醒任务
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Marketing calendar */}
        <div className="card p-4">
          <p className="text-sm font-semibold text-text-primary mb-3">营销节点</p>
          <div className="space-y-2">
            {EVENTS.map(ev => (
              <div key={ev.label} className="flex items-center gap-3">
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: ev.color }} />
                <p className="text-sm text-text-secondary flex-1">{ev.label}</p>
                <p className="text-xs text-text-muted">{ev.date}</p>
                <span className="text-[11px] font-medium px-2 py-0.5 rounded-full" style={{ background: `${ev.color}12`, color: ev.color }}>
                  {ev.days}天后
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-text-primary">模拟客户表</p>
              <p className="text-[11px] text-text-muted mt-0.5">客户基础信息、订单沉淀和下一步唤醒动作</p>
            </div>
            <span className="text-[11px] font-semibold px-2 py-1 rounded-md bg-surface-2 text-text-secondary border border-border">
              {CUSTOMERS.length} 位客户
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1060px] text-left">
              <thead className="bg-surface-2 border-b border-border">
                <tr className="text-[11px] font-semibold text-text-muted">
                  {['客户', '市场/渠道', '分层', '最近购买', '订单', '金额', '最近沟通', '风险', '唤醒建议'].map(h => (
                    <th key={h} className="px-4 py-2.5 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {CUSTOMERS.map(customer => (
                  <tr key={customer.id} className="hover:bg-surface-2 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <span className="w-8 h-8 rounded-full bg-surface-2 border border-border flex items-center justify-center text-sm flex-shrink-0">{customer.country}</span>
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-text-primary truncate">{customer.buyer}</p>
                          <p className="text-[11px] text-text-muted">{customer.id}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-xs text-text-secondary">{customer.market}</p>
                      <p className="text-[11px] text-text-muted">{customer.channel}</p>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="inline-flex min-w-[54px] justify-center whitespace-nowrap text-[11px] font-semibold px-2 py-1 rounded-md bg-surface-2 text-text-secondary border border-border">{customer.tier}</span>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-xs text-text-secondary">{customer.lastSku}</p>
                      <p className="text-[11px] text-text-muted flex items-center gap-1"><Clock3 size={10} />{customer.lastOrder}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-xs text-text-secondary flex items-center gap-1"><ShoppingBag size={11} />{customer.orders} 单</p>
                      <p className="text-[11px] text-text-muted">{customer.avgOrder} / 单</p>
                    </td>
                    <td className="px-4 py-3 text-xs font-semibold text-text-primary">{customer.totalAmount}</td>
                    <td className="px-4 py-3 max-w-[180px]">
                      <p className="text-xs text-text-secondary truncate">{customer.lastMessage}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-[11px] font-semibold px-2 py-1 rounded-md ${
                        customer.risk === '高'
                          ? 'bg-red-50 text-red-700'
                          : customer.risk === '中'
                            ? 'bg-amber-50 text-amber-700'
                            : 'bg-emerald-50 text-emerald-700'
                      }`}>{customer.risk}</span>
                    </td>
                    <td className="px-4 py-3">
                      <button onClick={() => onOpenCustomerHistory(customer)}
                        className="text-xs font-semibold text-accent hover:text-accent-dim transition-colors">
                        {customer.nextAction}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </div>
  );
}

export default function RetentionPage({ onEnterConversation, onLeaveConversation, isInConversation, restore, kickoff, onAction, onSessionRefresh }: Props) {
  const [viewMode, setViewMode] = useState<ViewMode>('dashboard');
  const [customerRestore, setCustomerRestore] = useState<RestoreSignal | null>(null);
  useEffect(() => { if (restore) { setCustomerRestore(null); setViewMode('chat'); } }, [restore?.key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (kickoff) { setCustomerRestore(null); setViewMode('chat'); } }, [kickoff?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleEnterChat = (ctx: ConversationContext) => {
    setCustomerRestore(null);
    setViewMode('chat');
    onEnterConversation(ctx);
  };

  const handleOpenCustomerHistory = (customer: Customer) => {
    const messages = buildCustomerHistory(customer);
    setCustomerRestore({ agent: 'retention', messages, key: `customer:${customer.id}:${Date.now()}` });
    setViewMode('chat');
    onEnterConversation({ agent: 'retention', messages });
  };

  const handleLeave = () => {
    setCustomerRestore(null);
    setViewMode('dashboard');
    onLeaveConversation();
  };

  const activeRestore = customerRestore ?? restore;

  return (
    <div className="flex flex-col h-full">
      <div className="h-12 flex items-center justify-between px-5 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-6 h-6 rounded-lg flex items-center justify-center" style={{ background: 'rgba(22,163,74,0.1)', color: '#16a34a' }}>
            <RefreshCw size={13} />
          </div>
          <span className="text-sm font-semibold text-text-primary">留存</span>
          {isInConversation && viewMode === 'chat' && (
            <span className="flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full ml-1" style={{ background: 'rgba(22,163,74,0.1)', color: '#16a34a' }}>
              <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />留存专家
            </span>
          )}
        </div>
        <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-surface-2 border border-border">
          {([
            { mode: 'dashboard' as ViewMode, icon: <LayoutGrid size={12} />, label: '工作台' },
            { mode: 'chat' as ViewMode,      icon: <MessageSquare size={12} />, label: '对话' },
          ] as const).map(({ mode, icon, label }) => (
            <button key={mode} onClick={() => { if (mode === 'chat') handleEnterChat({ agent: 'retention' }); else setViewMode(mode); }}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold transition-all ${viewMode === mode ? 'bg-surface text-text-primary shadow-sm' : 'text-text-muted hover:text-text-secondary'}`}>
              {icon}<span>{label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden">
        <AnimatePresence mode="wait">
          {viewMode === 'dashboard' ? (
            <motion.div key="dashboard" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="h-full">
              <Dashboard
                onChatClick={() => handleEnterChat({ agent: 'retention' })}
                onOpenCustomerHistory={handleOpenCustomerHistory}
              />
            </motion.div>
          ) : (
            <motion.div key="chat" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="h-full">
              <AgentChatPage
                config={{
                  type: 'retention',
                  apiPath: '/api/overseas/agents/retention/chat',
                  color: '#16a34a',
                  bg: 'rgba(22,163,74,0.1)',
                  icon: <RefreshCw size={13} />,
                  name: '留存专家',
                  tagline: '老客画像 · 生命周期唤醒 · 行动建议',
                  suggestions: [
                    '老客唤醒策略',
                    '复购加推组合',
                    '节前触达节奏',
                    '复购消息模板',
                  ],
                }}
                onEnterConversation={handleEnterChat}
                onLeaveConversation={handleLeave}
                isInConversation={isInConversation}
                restoreKey={activeRestore?.key}
                restoreMessages={activeRestore?.messages}
                kickoff={kickoff}
                onAction={onAction}
                onSessionRefresh={onSessionRefresh}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
