export type ActionRisk = 'L1' | 'L2' | 'L3' | 'L4';
export type AutonomyLevel = 'remind' | 'draft' | 'auto';

export interface ActionRule {
  action: string;
  risk: ActionRisk;
  desc: string;
}

export const ACTION_RULES: ActionRule[] = [
  { action: 'remind_silent_high_value', risk: 'L1', desc: '高价值客户沉默提醒' },
  { action: 'remind_local_worktime', risk: 'L1', desc: '到达对方工作时间提醒' },
  { action: 'remind_festival', risk: 'L1', desc: '客户节日/生日提醒' },
  { action: 'remind_post_delivery', risk: 'L1', desc: '订单交付后回访提醒' },
  { action: 'remind_new_product_match', risk: 'L1', desc: '新品匹配提醒' },
  { action: 'draft_greeting', risk: 'L2', desc: '日常寒暄回复' },
  { action: 'draft_catalog_recommend', risk: 'L2', desc: '新品/目录推荐' },
  { action: 'draft_order_progress', risk: 'L2', desc: '订单进度同步' },
  { action: 'draft_sample_followup', risk: 'L2', desc: '样品跟进' },
  { action: 'draft_reactivate', risk: 'L2', desc: '沉默客户唤醒' },
  { action: 'auto_logistics_update', risk: 'L3', desc: '物流状态更新' },
  { action: 'auto_holiday_greeting', risk: 'L3', desc: '节假日祝福' },
  { action: 'auto_send_catalog', risk: 'L3', desc: '客户明确索要目录时发送已审批资料' },
  { action: 'auto_aftersale_confirm', risk: 'L3', desc: '标准售后确认' },
  { action: 'auto_faq_reply', risk: 'L3', desc: '知识库内产品/物流/公司基础问答' },
  { action: 'formal_quote', risk: 'L4', desc: '正式报价' },
  { action: 'discount', risk: 'L4', desc: '折扣/让利' },
  { action: 'payment_terms', risk: 'L4', desc: '付款条款' },
  { action: 'delivery_promise', risk: 'L4', desc: '交期承诺' },
  { action: 'contract_terms', risk: 'L4', desc: '合同条款' },
  { action: 'call_request', risk: 'L4', desc: '客户想通电话' },
  { action: 'proactive_call', risk: 'L4', desc: '主动约电话' },
  { action: 'complaint_compensation', risk: 'L4', desc: '客诉补偿' },
  { action: 'edit_customer_core', risk: 'L4', desc: '修改客户核心资料' },
];

export type ActionDecision = 'remind' | 'draft' | 'auto';

export function findActionRule(action: string): ActionRule {
  return ACTION_RULES.find(rule => rule.action === action) ?? ACTION_RULES.find(rule => rule.action === 'draft_greeting')!;
}

export function decideAction(action: string, autonomy: AutonomyLevel = 'draft'): { decision: ActionDecision; rule: ActionRule } {
  const rule = findActionRule(action);
  if (rule.risk === 'L1') return { decision: 'remind', rule };
  if (rule.risk === 'L4') return { decision: 'draft', rule };
  if (rule.risk === 'L2') return { decision: autonomy === 'remind' ? 'remind' : 'draft', rule };
  if (rule.risk === 'L3') return { decision: autonomy === 'auto' ? 'auto' : 'draft', rule };
  return { decision: 'draft', rule };
}

export function l3ActionRules(): ActionRule[] {
  return ACTION_RULES.filter(rule => rule.risk === 'L3');
}
