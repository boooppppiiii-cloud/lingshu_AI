export interface CopywritingParams {
  productName: string;
  description: string;
  targetMarket: string;
  targetAudience?: string;
  platform: string;
  tone?: string;
  language: string;
}

export function buildCopywritingPrompt(params: CopywritingParams): string {
  const { productName, description, targetMarket, targetAudience, platform, tone, language } = params;
  return `你是一位资深跨境电商广告文案专家，专门帮助中国工厂打入海外市场。请为以下产品生成高转化率的广告文案。

产品名称：${productName}
产品描述：${description}
目标市场：${targetMarket}
目标受众：${targetAudience ?? '通用消费者'}
投放平台：${platform}
文案风格：${tone ?? '专业自然'}
输出语言：${language}

请严格按以下 JSON 格式输出，不要包含任何其他内容：
{
  "headline": "标题（不超过 80 字符）",
  "subheadline": "副标题（1句话，突出核心卖点）",
  "bullets": ["卖点1", "卖点2", "卖点3"],
  "body": "正文（100-200词，符合目标语言习惯）",
  "cta": "行动号召语（简短有力）"
}`;
}
