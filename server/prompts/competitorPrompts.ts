export interface CompetitorAnalysisParams {
  competitorName: string;
  category: string;
  content: string;
  targetMarket?: string;
}

export interface AdCreativeInsightParams {
  adContent: string;
  platform: string;
  category?: string;
}

export function buildCompetitorAnalysisPrompt(params: CompetitorAnalysisParams): string {
  const { competitorName, category, content, targetMarket } = params;
  return `你是一位跨境电商竞品分析专家。请深度分析以下竞品信息并给出可操作的建议。

竞品名称：${competitorName}
产品类目：${category}
${targetMarket ? `目标市场：${targetMarket}` : ''}
竞品内容（文案/描述/广告语）：
${content}

请严格按以下 JSON 格式输出，不要包含任何其他内容：
{
  "positioning": "定位分析（卖点、受众、差异化策略）",
  "pricingStrategy": "定价策略推断",
  "copyStyle": "文案风格特点",
  "strengths": ["值得借鉴的点1", "值得借鉴的点2"],
  "weaknesses": ["可突破的弱点1", "可突破的弱点2"],
  "suggestions": ["我方差异化建议1", "我方差异化建议2", "我方差异化建议3"]
}`;
}

export function buildAdCreativeInsightPrompt(params: AdCreativeInsightParams): string {
  const { adContent, platform, category } = params;
  return `你是一位跨境电商广告创意分析专家，专注于${platform}平台。

请分析以下广告创意的爆款要素：
${category ? `产品类目：${category}` : ''}
平台：${platform}

广告内容：
${adContent}

请严格按以下 JSON 格式输出，不要包含任何其他内容：
{
  "hookType": "钩子类型（痛点/好奇/惊喜/权威等）",
  "emotionalTriggers": ["情绪触发点1", "情绪触发点2"],
  "structureFormula": "内容结构公式（如：痛点→解决方案→社证→CTA）",
  "keyPhrases": ["高效短语1", "高效短语2", "高效短语3"],
  "replicationGuide": "如何借鉴此创意生成自己的版本（具体步骤）"
}`;
}
