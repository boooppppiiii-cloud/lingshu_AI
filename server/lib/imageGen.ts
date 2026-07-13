import { GoogleGenAI } from '@google/genai';

export interface ReferenceImage {
  mimeType: string;
  base64: string;
}

export interface GeneratedImage {
  bytes: Buffer;
  mimeType: string;
  source: 'gemini' | 'seedream';
  model: string;
}

function normalizeMime(mimeType?: string): string {
  if (!mimeType) return 'image/png';
  if (mimeType.includes('jpeg') || mimeType.includes('jpg')) return 'image/jpeg';
  if (mimeType.includes('webp')) return 'image/webp';
  return 'image/png';
}

function extFromMime(mimeType: string): string {
  if (mimeType.includes('jpeg') || mimeType.includes('jpg')) return 'jpg';
  if (mimeType.includes('webp')) return 'webp';
  return 'png';
}

export function imageExt(mimeType: string): string {
  return extFromMime(mimeType);
}

function extractInlineImage(resp: any): { data: string; mimeType: string } | null {
  const outputs = Array.isArray(resp?.outputs) ? resp.outputs : [];
  for (const output of outputs) {
    if (output?.type === 'image' && output?.data) return { data: String(output.data), mimeType: normalizeMime(output.mime_type || output.mimeType) };
  }
  const outputImage = resp?.output_image || resp?.outputImage;
  if (outputImage?.data) return { data: String(outputImage.data), mimeType: normalizeMime(outputImage.mime_type || outputImage.mimeType) };

  const parts = resp?.candidates?.flatMap((candidate: any) => candidate?.content?.parts || []) || [];
  for (const part of parts) {
    const inline = part?.inlineData;
    if (inline?.data) return { data: String(inline.data), mimeType: normalizeMime(inline.mimeType) };
  }
  return null;
}

async function generateGeminiImage(input: {
  prompt: string;
  ratio: string;
  references?: ReferenceImage[];
}): Promise<GeneratedImage> {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) throw new Error('GEMINI_API_KEY is not configured');
  const ai = new GoogleGenAI({ apiKey });
  const model = (process.env.GEMINI_IMAGE_MODEL || 'gemini-3-pro-image-preview').trim();
  const refs = (input.references || []).slice(0, 4);

  // Nano Banana image models use the Interactions API in @google/genai >= 2.0.
  if ((process.env.GEMINI_DISABLE_INTERACTIONS_IMAGE || '').trim() !== 'true') {
    try {
      const interactionInput = refs.length
        ? [
            { type: 'text', text: `${input.prompt}\n\nCanvas aspect ratio: ${input.ratio}. Return one polished final poster image.` },
            ...refs.map(ref => ({ type: 'image', data: ref.base64, mime_type: ref.mimeType })),
          ]
        : `${input.prompt}\n\nCanvas aspect ratio: ${input.ratio}. Return one polished final poster image.`;
      const interaction = await (ai as any).interactions.create({
        model,
        input: interactionInput,
        response_modalities: ['image'],
      });
      const image = extractInlineImage(interaction);
      if (image?.data) {
        return { bytes: Buffer.from(image.data, 'base64'), mimeType: image.mimeType, source: 'gemini', model };
      }
    } catch (err) {
      if (process.env.DEBUG_IMAGE_GEN === 'true') console.warn('[imageGen] interactions image failed:', err);
    }
  }

  try {
    const parts: any[] = [
      { text: `${input.prompt}\n\nCanvas aspect ratio: ${input.ratio}. Return one polished final poster image.` },
      ...refs.map(ref => ({ inlineData: { data: ref.base64, mimeType: ref.mimeType } })),
    ];
    const resp = await ai.models.generateContent({
      model,
      contents: [{ role: 'user', parts }] as any,
      config: { responseModalities: ['TEXT', 'IMAGE'] } as any,
    } as any);
    const image = extractInlineImage(resp);
    if (image?.data) {
      return { bytes: Buffer.from(image.data, 'base64'), mimeType: image.mimeType, source: 'gemini', model };
    }
  } catch (err) {
    if (process.env.DEBUG_IMAGE_GEN === 'true') console.warn('[imageGen] generateContent image failed:', err);
  }

  const imageModel = (process.env.GEMINI_IMAGEN_MODEL || '').trim();
  if (!imageModel) throw new Error(`Gemini image model ${model} returned no image bytes`);
  const resp = await ai.models.generateImages({
    model: imageModel,
    prompt: input.prompt,
    config: { numberOfImages: 1, aspectRatio: input.ratio } as any,
  });
  const data = (resp as any).generatedImages?.[0]?.image?.imageBytes;
  if (!data) throw new Error('Gemini image generation returned no image bytes');
  return { bytes: Buffer.from(String(data), 'base64'), mimeType: 'image/png', source: 'gemini', model: imageModel };
}

async function generateSeedreamImage(_input: {
  prompt: string;
  ratio: string;
  references?: ReferenceImage[];
}): Promise<GeneratedImage> {
  throw new Error('Seedream image fallback is not configured yet');
}

export async function generatePosterImage(input: {
  prompt: string;
  ratio: string;
  references?: ReferenceImage[];
}): Promise<GeneratedImage> {
  try {
    return await generateGeminiImage(input);
  } catch (geminiErr: any) {
    if ((process.env.SEEDREAM_IMAGE_ENABLED || '').trim() === 'true') {
      try {
        return await generateSeedreamImage(input);
      } catch (seedreamErr: any) {
        throw new Error(`Gemini image failed: ${geminiErr?.message || geminiErr}; Seedream failed: ${seedreamErr?.message || seedreamErr}`);
      }
    }
    throw geminiErr;
  }
}
