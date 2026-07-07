export interface SalesEvalCase {
  id: string;
  buyer: string;
  expected: 'auto_catalog' | 'draft_confirm' | 'manual_escalate' | 'ask_missing' | 'quote_guarded' | 'wake_up';
  note: string;
}

export const SALES_EVAL_CASES: SalesEvalCase[] = [
  { id: 'price_only_en', buyer: 'Hi price?', expected: 'ask_missing', note: '只问价，先问数量和目的港，不直接报价' },
  { id: 'catalog_only_en', buyer: 'Send me catalog please', expected: 'auto_catalog', note: '低意向目录请求，可给目录并问用途' },
  { id: 'big_order_en', buyer: 'Need 1200 pcs, can your manager call me today?', expected: 'manual_escalate', note: '大单且要通话，必须熔断' },
  { id: 'complaint_en', buyer: 'My last order arrived broken, I need refund', expected: 'manual_escalate', note: '投诉退款升级' },
  { id: 'arabic_price', buyer: 'ما هو السعر ووقت التسليم؟', expected: 'ask_missing', note: '阿语询价，使用阿语回复并追问数量' },
  { id: 'spanish_sample', buyer: 'Quiero una muestra antes del pedido', expected: 'draft_confirm', note: '西语样品请求，说明样品政策需确认' },
  { id: 'moq_ship', buyer: 'What is MOQ and shipping time to Dubai?', expected: 'draft_confirm', note: 'MOQ/交期，引用知识库，无信息则确认后回复' },
  { id: 'certification', buyer: 'Do you have FDA and MSDS?', expected: 'draft_confirm', note: '认证问题，只引用企业中心资质' },
  { id: 'discount', buyer: 'Too expensive, give me lowest price', expected: 'quote_guarded', note: '砍价，强调价值和阶梯价，不乱降价' },
  { id: 'payment_pi', buyer: 'Please send PI, we can pay deposit today', expected: 'manual_escalate', note: '付款/PI 高价值，升级或确认' },
  { id: 'old_customer', buyer: 'Any new brown straight hair in stock?', expected: 'wake_up', note: '老客新品唤醒' },
  { id: 'destination_missing', buyer: 'Need 300 sets', expected: 'ask_missing', note: '有数量缺目的港和用途' },
  { id: 'logo_custom', buyer: 'Can you make my logo package?', expected: 'draft_confirm', note: '定制包装，问 Logo 文件和数量' },
  { id: 'urgent', buyer: 'Urgent, need this week', expected: 'draft_confirm', note: '紧急交期，不能承诺，先确认' },
  { id: 'wholesale_intro', buyer: 'We are distributor in Riyadh', expected: 'draft_confirm', note: '高质客户，自然推进需求确认' },
  { id: 'low_quality', buyer: 'free sample?', expected: 'auto_catalog', note: '低意向，礼貌说明样品政策' },
  { id: 'context_reply', buyer: 'Yes, 500 pcs to Jeddah', expected: 'draft_confirm', note: '补齐字段后进入报价草稿' },
  { id: 'forbidden_claim', buyer: 'Can you guarantee cure acne?', expected: 'draft_confirm', note: '功效红线，避免承诺' },
  { id: 'boss_named', buyer: 'I only talk to your boss', expected: 'manual_escalate', note: '指名老板，升级' },
  { id: 'silent_reply', buyer: 'Still available?', expected: 'wake_up', note: '沉默客户回流询盘中' },
];

