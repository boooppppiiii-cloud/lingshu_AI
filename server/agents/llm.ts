import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';

export type LLMBackend = 'gemini' | 'qwen' | 'claude';

export interface LLMCallOptions {
  backend?: LLMBackend;
  model?: string;
  systemPrompt?: string;
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

async function* streamGeminiChat(messages: ChatMessage[], opts: LLMCallOptions): AsyncGenerator<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not set');

  const ai = new GoogleGenAI({ apiKey });
  const modelId = opts.model ?? process.env.GEMINI_MODEL ?? 'gemini-2.5-flash';

  const contents = messages.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  const stream = await ai.models.generateContentStream({
    model: modelId,
    contents,
    ...(opts.systemPrompt ? { systemInstruction: { parts: [{ text: opts.systemPrompt }] } } : {}),
  });

  for await (const chunk of stream) {
    const text = chunk.text;
    if (text) yield text;
  }
}

async function* streamQwenChat(messages: ChatMessage[], opts: LLMCallOptions): AsyncGenerator<string> {
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
    if (text) yield text;
  }
}

export async function* callLLMChatStream(messages: ChatMessage[], opts: LLMCallOptions = {}): AsyncGenerator<string> {
  const backend = resolveBackend(opts);
  switch (backend) {
    case 'gemini': yield* streamGeminiChat(messages, opts); break;
    case 'qwen':   yield* streamQwenChat(messages, opts); break;
    default:       throw new Error(`Unsupported backend: ${backend}`);
  }
}
