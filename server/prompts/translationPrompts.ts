export interface TranslationParams {
  text: string;
  targetLanguage: string;
  targetMarket?: string;
  context?: string;
}

export interface BatchTranslationParams {
  text: string;
  languages: string[];
  targetMarket?: string;
  context?: string;
}

export function buildTranslationPrompt(params: TranslationParams): string {
  const { text, targetLanguage, targetMarket, context } = params;
  return `你是一位专业的跨境营销翻译专家，精通多语言本地化。

请将以下营销文本翻译并润色为地道的${targetLanguage}：
${targetMarket ? `目标市场：${targetMarket}` : ''}
${context ? `背景说明：${context}` : ''}

原文：
${text}

要求：保留营销感，符合当地文化习惯，避免直译，语言自然流畅。
只输出翻译结果，不要任何解释或原文。`;
}

export function buildMultiLanguageBatchPrompt(params: BatchTranslationParams): string {
  const { text, languages, targetMarket, context } = params;
  return `你是一位专业的跨境营销翻译专家，精通多语言本地化。

请将以下营销文本翻译为多个语言版本：
${targetMarket ? `目标市场：${targetMarket}` : ''}
${context ? `背景说明：${context}` : ''}

原文：
${text}

需要翻译的语言：${languages.join('、')}

要求：每个版本都要保留营销感，符合当地文化习惯，避免直译。

请严格按以下 JSON 格式输出，不要包含任何其他内容：
{
  ${languages.map(lang => `"${lang}": "该语言的翻译结果"`).join(',\n  ')}
}`;
}
