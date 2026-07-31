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
  D01: { goal: '用可验证事实降低跨境采购的心理门槛', indirectQuestion: '您比较关心的是质检报告，还是想先小批量试单看看？' },
  D02: { goal: '明确客户需要的具体认证类型，避免空口承诺', indirectQuestion: '您需要的是哪一类认证文件，方便我准确核实？' },
  D03: { goal: '识别信任危机并第一时间交接负责人', indirectQuestion: '方便告诉我具体是哪份文件让您有顾虑吗？' },
  D04: { goal: '在如实说明身份的同时守住敏感信息边界', indirectQuestion: '除了公司类型，您还想了解哪方面的资质信息？' },
  H02: { goal: '收齐独家代理意向要素，交负责人评估', indirectQuestion: '您预计覆盖的市场范围和规模大概是怎样的？' },
  I02: { goal: '找到犹豫背后的顾虑，提供低门槛下一步', indirectQuestion: '如果先从小批量试单开始，会不会更容易做决定？' },
  I03: { goal: '把多头信息收敛成一个清晰指令', indirectQuestion: '现在最关键的一件事是什么，我先帮您落实？' },
  I04: { goal: '精确复述已确认内容，避免遗漏或误加', indirectQuestion: '这样确认的内容准确吗，还有需要补充的吗？' },
  L02: { goal: '识别疑似套价并控制信息披露深度', indirectQuestion: '方便说下大概的采购数量和用途吗？' },
  L03: { goal: '判断是否为真实采购意图，避免过度投入', indirectQuestion: '您这边是有具体产品想了解，还是先随便看看？' },
  L04: { goal: '先安抚情绪，收集事实后转交负责人', indirectQuestion: '方便告诉我订单号，让负责人尽快为您处理吗？' },
};

export function progressionForStrategy(strategyId: string): StrategyProgression | null {
  return PROGRESSION_BY_STRATEGY[String(strategyId || '').trim()] ?? null;
}

export function strategyProgressionCount(): number {
  return Object.keys(PROGRESSION_BY_STRATEGY).length;
}
