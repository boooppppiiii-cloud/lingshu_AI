/**
 * Generate 42 social-media cover images (mock-9 to mock-50)
 * using Imagen 4 Fast via Google GenAI SDK.
 * Run: NODE_USE_ENV_PROXY=1 node scripts/gen-covers.mjs
 */
import { GoogleGenAI } from '@google/genai';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '../src/assets/covers');
const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
  throw new Error('GEMINI_API_KEY is required');
}
const ai = new GoogleGenAI({ apiKey: API_KEY });

// ── 42 cover definitions ─────────────────────────────────────────────────────
// ratio: '9:16' | '16:9' | '3:4'
const COVERS = [
  // ── 9:16 TikTok / Instagram Reels (mock-9 to mock-23) ──────────────────
  { id: 9,  ratio: '9:16', prompt: 'TikTok video thumbnail, young asian woman holding multiple skincare product bottles, bright pastel pink background, huge smile, beauty influencer vibe, clean studio lighting, vertical portrait, no text, photorealistic' },
  { id: 10, ratio: '9:16', prompt: 'TikTok thumbnail, flat lay of hair care products arranged neatly on white marble, rose gold and pink color palette, shampoo bottles and hair mask jars, beauty aesthetic, overhead shot, vertical, no text' },
  { id: 11, ratio: '9:16', prompt: 'TikTok product review thumbnail, woman holding a small portable mini fan in summer outdoor setting, sunshine, smiling, bright yellow and white tones, vertical portrait, photorealistic, no text' },
  { id: 12, ratio: '9:16', prompt: 'TikTok kitchen gadget video thumbnail, close-up of hands using a colorful vegetable chopper, fresh vegetables, bright white kitchen background, clean and modern, vertical, photorealistic, no text' },
  { id: 13, ratio: '9:16', prompt: 'Instagram Reels thumbnail, aesthetic home office desk setup, plants, LED strip lights, laptop, ring light, warm ambient lighting, cozy productive vibe, vertical portrait, no text, photorealistic' },
  { id: 14, ratio: '9:16', prompt: 'TikTok travel vlog thumbnail, young woman at tropical beach holding sunscreen bottle, golden hour lighting, palm trees in background, summer lifestyle, vertical, photorealistic, no text' },
  { id: 15, ratio: '9:16', prompt: 'Instagram Reels fitness transformation thumbnail, athletic woman in workout gear, gym setting, motivational energy, strong and confident pose, vertical portrait, bright lighting, photorealistic, no text' },
  { id: 16, ratio: '9:16', prompt: 'TikTok GRWM makeup tutorial thumbnail, woman applying bold red lipstick, close-up face with flawless makeup, glamorous beauty aesthetic, studio lighting, vertical, photorealistic, no text' },
  { id: 17, ratio: '9:16', prompt: 'TikTok pet accessories haul thumbnail, cute golden retriever wearing a colorful bandana, surrounded by dog toys and treats, bright background, adorable and playful, vertical, photorealistic, no text' },
  { id: 18, ratio: '9:16', prompt: 'Instagram Reels minimalist wardrobe capsule collection thumbnail, neutral toned clothing hanging neatly on white rack, clean aesthetic, beige and cream palette, vertical, photorealistic, no text' },
  { id: 19, ratio: '9:16', prompt: 'TikTok food recipe thumbnail, colorful acai smoothie bowl from slight above angle, topped with fresh fruits and granola, vibrant purple and pink tones, beautiful food styling, vertical, photorealistic, no text' },
  { id: 20, ratio: '9:16', prompt: 'TikTok small business packaging orders thumbnail, hands wrapping products with pink tissue paper and ribbon, brown boxes, cozy workspace, warm lighting, aesthetic and satisfying, vertical, photorealistic, no text' },
  { id: 21, ratio: '9:16', prompt: 'Instagram Reels jewelry haul thumbnail, gold necklaces bracelets and rings arranged beautifully on white velvet tray, luxury aesthetic, studio lighting, vertical, photorealistic, no text' },
  { id: 22, ratio: '9:16', prompt: 'TikTok mom life hack products thumbnail, organized bright kitchen with storage solutions and gadgets, clean and cheerful, vertical portrait, photorealistic, no text' },
  { id: 23, ratio: '9:16', prompt: 'TikTok home fragrance review thumbnail, woman holding elegant candle with both hands near face, eyes closed peacefully, soft warm lighting, cozy bedroom background, vertical, photorealistic, no text' },

  // ── 16:9 YouTube / Facebook (mock-24 to mock-38) ───────────────────────
  { id: 24, ratio: '16:9', prompt: 'YouTube thumbnail style, woman holding 5 different gadgets showing thumbs up, bright orange background, bold product review energy, collage composition, photorealistic, no text, high contrast' },
  { id: 25, ratio: '16:9', prompt: 'YouTube product comparison thumbnail, two smartphones side by side on white background, comparison layout, clean tech review aesthetic, horizontal, photorealistic, no text' },
  { id: 26, ratio: '16:9', prompt: 'YouTube review thumbnail, hands holding a sleek portable bluetooth speaker, white studio background, tech product showcase, horizontal, clean lighting, photorealistic, no text' },
  { id: 27, ratio: '16:9', prompt: 'YouTube haul video thumbnail, excited woman surrounded by multiple shopping boxes and bags, yellow background, shopping haul energy, horizontal, photorealistic, no text' },
  { id: 28, ratio: '16:9', prompt: 'YouTube kitchen gadget review thumbnail, woman cooking using an air fryer in bright modern kitchen, warm colors, lifestyle shot, horizontal, photorealistic, no text' },
  { id: 29, ratio: '16:9', prompt: 'YouTube skeptical product test thumbnail, person holding product with raised eyebrow expression, blue and white background, does it work energy, horizontal, photorealistic, no text' },
  { id: 30, ratio: '16:9', prompt: 'YouTube home organization before after thumbnail, split scene comparison, cluttered desk on left vs perfectly organized desk on right, horizontal layout, photorealistic, no text' },
  { id: 31, ratio: '16:9', prompt: 'YouTube travel essentials flat lay thumbnail, luggage passport headphones sunscreen and accessories arranged neatly on white background, travel aesthetic, horizontal, photorealistic, no text' },
  { id: 32, ratio: '16:9', prompt: 'YouTube budget vs luxury product comparison thumbnail, cheap vs expensive skincare products side by side, white background, comparison test, horizontal, photorealistic, no text' },
  { id: 33, ratio: '16:9', prompt: 'YouTube fitness equipment review thumbnail, woman using resistance bands in home gym, natural light, workout lifestyle, horizontal, photorealistic, no text' },
  { id: 34, ratio: '16:9', prompt: 'YouTube car accessories review thumbnail, dashboard filled with useful tech gadgets phone holder air freshener organizer, interior shot, horizontal, photorealistic, no text' },
  { id: 35, ratio: '16:9', prompt: 'YouTube skincare products lineup review thumbnail, row of skincare bottles and jars on marble counter, beauty editorial style, horizontal, soft studio lighting, photorealistic, no text' },
  { id: 36, ratio: '16:9', prompt: 'YouTube haul thumbnail, boxes and products from online shopping spread on floor, person sitting surrounded by items, excited expression, horizontal, photorealistic, no text' },
  { id: 37, ratio: '16:9', prompt: 'YouTube kids toy review thumbnail, happy child playing with colorful building blocks toy, bright room, playful and joyful energy, horizontal, photorealistic, no text' },
  { id: 38, ratio: '16:9', prompt: 'YouTube room decor haul thumbnail, aesthetic bedroom with fairy lights plants and decorative items, cozy warm tones, horizontal lifestyle shot, photorealistic, no text' },

  // ── 3:4 Pinterest / Instagram (mock-39 to mock-50) ─────────────────────
  { id: 39, ratio: '3:4', prompt: 'Pinterest product photography, elegant glass perfume bottle surrounded by white roses and eucalyptus, luxury lifestyle aesthetic, soft natural light, portrait ratio, photorealistic, no text' },
  { id: 40, ratio: '3:4', prompt: 'Pinterest cozy bedroom aesthetic, layered throw pillows blankets and candles on white bedding, warm neutral tones, hygge lifestyle, portrait, photorealistic, no text' },
  { id: 41, ratio: '3:4', prompt: 'Pinterest food photography, colorful overhead shot of healthy buddha bowl with vegetables grains and sauce, fresh and vibrant, portrait ratio, photorealistic, no text' },
  { id: 42, ratio: '3:4', prompt: 'Pinterest fitness lifestyle flat lay, yoga mat with resistance bands water bottle protein shaker and earphones, clean white background, workout aesthetic, portrait, photorealistic, no text' },
  { id: 43, ratio: '3:4', prompt: 'Pinterest beauty flat lay, luxury skincare routine products arranged aesthetically with flowers and crystals, pastel pink background, editorial style, portrait, photorealistic, no text' },
  { id: 44, ratio: '3:4', prompt: 'Pinterest travel inspiration, beach accessories sunhat sunglasses and journal arranged on sandy beach, summer vibes, golden hour, portrait, photorealistic, no text' },
  { id: 45, ratio: '3:4', prompt: 'Pinterest home organization, beautifully organized pantry with glass jars labeled with spices and grains, white shelves, clean minimal aesthetic, portrait, photorealistic, no text' },
  { id: 46, ratio: '3:4', prompt: 'Pinterest fashion mood board, accessories and trendy clothing items arranged artfully, gold jewelry and sunglasses, warm aesthetic, portrait, photorealistic, no text' },
  { id: 47, ratio: '3:4', prompt: 'Pinterest wellness morning routine, ceramic mug of tea with open book and small plant on wooden table, warm cozy morning light, portrait ratio, photorealistic, no text' },
  { id: 48, ratio: '3:4', prompt: 'Pinterest baby products flat lay, soft baby clothes accessories toys on pastel mint background, newborn aesthetic, gentle and cute, portrait, photorealistic, no text' },
  { id: 49, ratio: '3:4', prompt: 'Pinterest plant parent aesthetic, multiple potted succulents and tropical houseplants arranged on wooden shelf, bright airy living room, portrait, photorealistic, no text' },
  { id: 50, ratio: '3:4', prompt: 'Pinterest DIY craft supplies flat lay, colorful embroidery threads scissors fabric and needles arranged neatly on white background, handmade crafts aesthetic, portrait, photorealistic, no text' },
];

// ── Generate ─────────────────────────────────────────────────────────────────
let success = 0, failed = 0;

for (const cover of COVERS) {
  const outPath = path.join(OUT_DIR, `mock-${cover.id}.png`);
  if (fs.existsSync(outPath)) {
    console.log(`⟳  mock-${cover.id}.png already exists, skipping`);
    success++;
    continue;
  }
  try {
    const resp = await ai.models.generateImages({
      model: 'imagen-4.0-fast-generate-001',
      prompt: cover.prompt,
      config: { numberOfImages: 1, aspectRatio: cover.ratio },
    });
    const bytes = resp.generatedImages?.[0]?.image?.imageBytes;
    if (!bytes) throw new Error('no imageBytes in response');
    fs.writeFileSync(outPath, Buffer.from(bytes, 'base64'));
    console.log(`✓  mock-${cover.id}.png  [${cover.ratio}]`);
    success++;
  } catch (err) {
    console.error(`✗  mock-${cover.id}:`, err.message?.slice(0, 120));
    failed++;
  }
  // ~1.5s between requests to stay within rate limits
  await new Promise(r => setTimeout(r, 1500));
}

console.log(`\nDone: ${success} ok, ${failed} failed`);
