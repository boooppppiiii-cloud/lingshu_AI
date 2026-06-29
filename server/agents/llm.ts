import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';

export type LLMBackend = 'gemini' | 'qwen' | 'claude';

export interface LLMCallOptions {
  backend?: LLMBackend;
  model?: string;
  systemPrompt?: string;
  deepThinking?: boolean;
}

function resolveBackend(opts: LLMCallOptions): LLMBackend {
  return opts.backend ?? (process.env.OVERSEAS_LLM_BACKEND as LLMBackend) ?? 'gemini';
}

async function callGemini(prompt: string, opts: LLMCallOptions): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not set');

  const ai = new GoogleGenAI({ apiKey });
  const model = opts.model ?? process.env.GEMINI_MODEL ?? 'gemini-2.5-flash';

  const contents = opts.systemPrompt
    ? `${opts.systemPrompt}\n\n${prompt}`
    : prompt;

  const response = await ai.models.generateContent({ model, contents });
  return response.text ?? '';
}

async function callQwen(prompt: string, opts: LLMCallOptions): Promise<string> {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) throw new Error('DASHSCOPE_API_KEY not set');

  const client = new OpenAI({
    apiKey,
    baseURL: process.env.DASHSCOPE_BASE_URL ?? 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  });

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
  if (opts.systemPrompt) messages.push({ role: 'system', content: opts.systemPrompt });
  messages.push({ role: 'user', content: prompt });

  const completion = await client.chat.completions.create({
    model: opts.model ?? 'qwen-plus',
    messages,
  });

  return completion.choices[0]?.message?.content ?? '';
}

export async function callLLM(prompt: string, opts: LLMCallOptions = {}): Promise<string> {
  const backend = resolveBackend(opts);
  switch (backend) {
    case 'gemini': return callGemini(prompt, opts);
    case 'qwen':   return callQwen(prompt, opts);
    default:       throw new Error(`Unsupported backend: ${backend}`);
  }
}

export type ChatMessage = { role: 'user' | 'assistant'; content: string };

// 流式事件：文本块 或 联网引用来源
export interface GroundingSource { title: string; uri: string }
export type StreamEvent = { text: string } | { sources: GroundingSource[] };

async function* streamGeminiChat(messages: ChatMessage[], opts: LLMCallOptions): AsyncGenerator<StreamEvent> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not set');

  const ai = new GoogleGenAI({ apiKey });
  const modelId = opts.model ?? process.env.GEMINI_MODEL ?? 'gemini-2.5-flash';

  const contents = messages.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  const baseConfig: Record<string, unknown> = {
    // 默认低延迟；用户打开深度思考时给中等预算，避免明显拖慢首字。
    thinkingConfig: { thinkingBudget: opts.deepThinking ? 768 : 0 },
    ...(opts.systemPrompt ? { systemInstruction: { parts: [{ text: opts.systemPrompt }] } } : {}),
  };

  // 单次尝试：withSearch 时挂联网检索（可引用真实来源），否则纯生成（更稳）
  async function* attempt(withSearch: boolean): AsyncGenerator<StreamEvent> {
    const stream = await ai.models.generateContentStream({
      model: modelId,
      contents,
      config: withSearch ? { ...baseConfig, tools: [{ googleSearch: {} }] } : baseConfig,
    });
    const sources: GroundingSource[] = [];
    const seen = new Set<string>();
    for await (const chunk of stream) {
      const text = chunk.text;
      if (text) yield { text };
      const gm = (chunk as any).candidates?.[0]?.groundingMetadata;
      for (const g of gm?.groundingChunks ?? []) {
        const uri = g?.web?.uri;
        if (uri && !seen.has(uri)) { seen.add(uri); sources.push({ title: g.web.title ?? uri, uri }); }
      }
    }
    if (sources.length) yield { sources: sources.slice(0, 6) };
  }

  // 联网流偶发中途断流（terminated）。已吐内容就保留；几乎没吐就无联网重试一次（很稳）。
  let emitted = 0;
  try {
    for await (const ev of attempt(true)) {
      if ('text' in ev) emitted += ev.text.length;
      yield ev;
    }
  } catch {
    if (emitted < 20) {
      for await (const ev of attempt(false)) yield ev;
    }
  }
}

async function* streamQwenChat(messages: ChatMessage[], opts: LLMCallOptions): AsyncGenerator<StreamEvent> {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) throw new Error('DASHSCOPE_API_KEY not set');

  const client = new OpenAI({
    apiKey,
    baseURL: process.env.DASHSCOPE_BASE_URL ?? 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  });

  const msgs: OpenAI.Chat.ChatCompletionMessageParam[] = [];
  if (opts.systemPrompt) msgs.push({ role: 'system', content: opts.systemPrompt });
  msgs.push(...messages.map(m => ({ role: m.role, content: m.content }) as OpenAI.Chat.ChatCompletionMessageParam));

  const stream = await client.chat.completions.create({ model: opts.model ?? 'qwen-plus', messages: msgs, stream: true });
  for await (const chunk of stream) {
    const text = chunk.choices[0]?.delta?.content;
    if (text) yield { text };
  }
}

export async function* callLLMChatStream(messages: ChatMessage[], opts: LLMCallOptions = {}): AsyncGenerator<StreamEvent> {
  const backend = resolveBackend(opts);
  switch (backend) {
    case 'gemini': yield* streamGeminiChat(messages, opts); break;
    case 'qwen':   yield* streamQwenChat(messages, opts); break;
    default:       throw new Error(`Unsupported backend: ${backend}`);
  }
}
