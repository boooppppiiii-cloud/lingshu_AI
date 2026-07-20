import fs from 'node:fs';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { GoogleGenAI } from '@google/genai';

loadEnv();
const apiKey = String(process.env.GEMINI_API_KEY || '').trim();
if (!apiKey) throw new Error('GEMINI_API_KEY is not configured');

const referencePath = process.argv[2];
if (!referencePath || !fs.existsSync(referencePath)) throw new Error('Reference image not found');

const prompt = `Create one continuous 4-second vertical 9:16 photorealistic smartphone beauty selfie video. The supplied image is the authoritative first frame, not merely an identity reference. Begin from that image pixel-faithfully: preserve the exact crop, head scale, downward head angle, upward direct gaze, eye size, contact-lens catchlights, bangs, tissue height, tissue texture, fingertip placement, and the two small translucent wet patches aligned directly below the eyes. Do not redesign, zoom out, recrop, enlarge the tissue, add stains, or change the first-frame expression.

0.00-1.30 seconds — hold the ecommerce hook:
Keep the supplied first-frame composition almost frozen. She has just blotted tears caused by uncomfortable contact lenses. Her head remains lowered while both eyes look upward into the camera, wide and slightly watery. The tissue top edge stays immediately under the lower eyelids. The two small clear-tear wet patches remain directly below the inner eye corners. Only natural blinking, tiny eye micro-movements and subtle phone micro-shake are allowed.

1.30-1.65 seconds — one fast reveal:
The single fingertip already visible at the far right edge pulls the tissue straight downward in one quick continuous motion. The tissue completely exits the frame within 0.35 seconds. Her head and camera remain stationary. No sideways wiping, no repeated wiping, no pause, no new hand and no fingers near the eyes.

1.65-4.00 seconds — contact-lens reveal:
With the tissue gone, keep the same extreme-close camera distance and reveal her nose and mouth without zooming out. She raises her chin only slightly, keeps looking into the lens and opens both eyes wider to display realistic colored-contact-lens reflections and iris texture. The right hand leaves with the tissue. One fingertip then enters from the lower-left edge and lightly points to the lower cheek, safely away from the eye. She begins speaking with subtle natural lip movement. Preserve realistic skin, eye moisture, lens placement, facial anatomy and identity continuity.

The wet tissue is evidence of an earlier crying-and-wiping event, but that earlier event is not shown in this clip. Reproduce only the actions explicitly written above.

Do not generate active falling tears, eye rubbing, tissue touching the eyeballs, repeated wiping, hands on both sides of the tissue, large dark or brown stains, ink-like marks, blood, makeup residue, slow removal, tissue stuck to the face, camera push-in, zoom-out, recropping, head turn, eye recoloring, glowing irises, beauty-filter skin, identity drift, hairstyle changes, extra fingers, platform UI, captions, logos, watermarks, cuts or transitions.`;

const ai = new GoogleGenAI({ apiKey });
const mimeType = referencePath.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
const imageData = fs.readFileSync(referencePath).toString('base64');
const startedAt = Date.now();
const interaction = await ai.interactions.create({
  model: 'gemini-omni-flash-preview',
  input: [
    { type: 'image', data: imageData, mime_type: mimeType },
    { type: 'text', text: prompt },
  ],
  response_format: { type: 'video', aspect_ratio: '9:16' },
});

const data = interaction.output_video?.data;
if (!data) throw new Error(`Omni returned no inline video (status: ${interaction.status || 'unknown'})`);
const outputDir = path.resolve(process.cwd(), 'data/media/generated/model-comparison');
fs.mkdirSync(outputDir, { recursive: true });
const output = path.join(outputDir, 'omni-reference-changxi-opening-4s-v3-anchor.mp4');
fs.writeFileSync(output, Buffer.from(data, 'base64'));
process.stdout.write(JSON.stringify({ ok: true, model: 'gemini-omni-flash-preview', output, elapsedSeconds: Math.round((Date.now() - startedAt) / 1000) }) + '\n');
