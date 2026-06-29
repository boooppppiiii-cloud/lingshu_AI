export interface StrategyParams {
  productName: string;
  category: string;
  targetMarket: string;
  budget?: string;
  competitors?: string;
  advantages?: string;
}

export function buildStrategyPrompt(params: StrategyParams): string {
  const { productName, category, targetMarket, budget, competitors, advantages } = params;
  return `你是一位资深跨境电商营销策略专家，有丰富的中国工厂出海实战经验。

请为以下产品制定详细的海外营销策略：

产品：${productName}
品类：${category}
目标市场：${targetMarket}
${budget ? `预算范围：${budget}` : ''}
${competitors ? `主要竞争对手：${competitors}` : ''}
${advantages ? `核心优势：${advantages}` : ''}

请严格按以下 JSON 格式输出，不要包含任何其他内容：
{
  "marketAnalysis": "市场分析与核心机会点（2-3句）",
  "targetPersona": {
    "description": "目标受众画像描述",
    "demographics": "年龄、性别、收入等",
    "psychographics": "兴趣、痛点、购买动机"
  },
  "channelMix": [
    { "channel": "渠道名称", "priority": "高/中/低", "rationale": "选择理由" }
  ],
  "contentStrategy": "内容策略核心方向（风格、话题、形式）",
  "keywordStrategy": "关键词/流量策略要点",
  "budgetAllocation": [
    { "channel": "渠道", "percentage": "占比%", "note": "说明" }
  ],
  "actionPlan": [
    { "phase": "第1阶段（Day 1-30）", "focus": "重点任务", "actions": ["行动1", "行动2"] },
    { "phase": "第2阶段（Day 31-60）", "focus": "重点任务", "actions": ["行动1", "行动2"] },
    { "phase": "第3阶段（Day 61-90）", "focus": "重点任务", "actions": ["行动1", "行动2"] }
  ]
}`;
}
