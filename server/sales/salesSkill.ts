export interface StrategyProgression {
  goal: string;
  indirectQuestion: string;
}

const PROGRESSION_BY_STRATEGY: Record<string, StrategyProgression> = {
  S01: { goal: '找出客户认为价格高的具体比较项', indirectQuestion: '除了单价，您现在还在比较交期、文件还是售后？' },
  S02: { goal: '把同行报价拉回同口径比较', indirectQuestion: '对方报价里包含哪些文件、包装和交付条件？' },
  S03: { goal: '确认除折扣外是否仍有成交阻碍', indirectQuestion: '如果采购条件确认，内部还有哪一步需要通过？' },
  S04: { goal: '确认真实采购场景和首要需求', indirectQuestion: '这批产品主要用于门店、经销，还是新品牌上线？' },
  S05: { goal: '用数量和市场区分真实采购与探价', indirectQuestion: '您准备先测哪个市场，大概按什么数量规划？' },
  S06: { goal: '确认试单规模及放量可能', indirectQuestion: '您希望先测试市场，还是按常规补货量采购？' },
  S07: { goal: '确认样品验证标准和后续动作', indirectQuestion: '样品到手后，您最先会测试哪一项？' },
  S08: { goal: '确认客户真实业务节点', indirectQuestion: '这批货是配合旺季、补货，还是某个上线日期？' },
  S09: { goal: '识别付款条件的决策约束', indirectQuestion: '贵司通常由谁确认付款安排和合同条件？' },
  S10: { goal: '找出报价后的真实阻碍', indirectQuestion: '目前卡住的是产品匹配、内部确认，还是采购时间？' },
  S11: { goal: '拿到样品反馈并约定决策节点', indirectQuestion: '团队测试后，哪项反馈最影响下一步采购？' },
  S12: { goal: '找到老客户当前的新需求触发点', indirectQuestion: '最近是补原来的货，还是在准备新的产品线？' },
  S13: { goal: '收齐 OEM/独家需求并立即交接', indirectQuestion: '先确认销售市场、预计量和上线时间，哪项最确定？' },
  S14: { goal: '控制风险并收集可核验事实', indirectQuestion: '这次问题对应哪个订单和批次，您看到的具体情况是什么？' },
  S15: { goal: '确定通话目的与可执行时间', indirectQuestion: '您希望通话重点确认什么，哪个时间段方便？' },
};

export function progressionForStrategy(strategyId: string): StrategyProgression | null {
  return PROGRESSION_BY_STRATEGY[String(strategyId || '').trim()] ?? null;
}

export function strategyProgressionCount(): number {
  return Object.keys(PROGRESSION_BY_STRATEGY).length;
}
