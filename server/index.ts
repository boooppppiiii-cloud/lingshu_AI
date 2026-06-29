import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import express from 'express';
import compression from 'compression';
import { copywritingRouter } from './routes/copywriting.js';
import { translationRouter } from './routes/translation.js';
import { competitorRouter } from './routes/competitor.js';
import { strategyRouter } from './routes/strategy.js';
import { videosRouter } from './routes/videos.js';
import { scriptsRouter } from './routes/scripts.js';
import { trendsRouter } from './routes/trends.js';
import { assetsRouter } from './routes/assets.js';
import { enterpriseRouter } from './routes/enterprise.js';
import { agentChatRouter } from './routes/agentChat.js';
import { channelsRouter } from './routes/channels.js';
import { schedulerRouter, initScheduler } from './routes/scheduler.js';
import { pluginsRouter } from './routes/plugins.js';
import { studioRouter } from './routes/studio.js';
import { authRouter } from './routes/auth.js';
import { youtubeRouter } from './routes/youtube.js';
import { socialRouter } from './routes/social.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });

const PORT = Number(process.env.PORT ?? 8788);
const app = express();

// 跳过 SSE 流式响应（text/event-stream），否则 gzip 缓冲会拖慢首字
app.use(compression({
  filter: (req, res) => res.getHeader('Content-Type') === 'text/event-stream' ? false : compression.filter(req, res),
}));
// 50mb to support base64-encoded video uploads (≈37MB raw video)
app.use(express.json({ limit: '50mb' }));

app.get('/api/overseas/health', (_req, res) => {
  res.json({ status: 'ok', service: 'overseas-marketing-agent', port: PORT });
});

// Legacy routes (stub → to be implemented separately)
app.use('/api/overseas/copywriting', copywritingRouter);
app.use('/api/overseas/translation', translationRouter);
app.use('/api/overseas/competitor', competitorRouter);
app.use('/api/overseas/strategy', strategyRouter);

// Core routes
app.use('/api/overseas/videos', videosRouter);
app.use('/api/overseas/scripts', scriptsRouter);
app.use('/api/overseas/trends', trendsRouter);
app.use('/api/overseas/assets', assetsRouter);
app.use('/api/overseas/enterprise', enterpriseRouter);
app.use('/api/overseas/agents', agentChatRouter);
app.use('/api/overseas/channels', channelsRouter);
app.use('/api/overseas/youtube', youtubeRouter);
app.use('/api/overseas/social', socialRouter);
app.use('/api/overseas/scheduler', schedulerRouter);
app.use('/api/overseas/plugins', pluginsRouter);
app.use('/api/overseas/auth', authRouter);
app.use('/api/overseas/studio', studioRouter);

initScheduler();

// 素材库本地文件托管（POST /studio/materials 上传到 data/media/）
const mediaDir = path.join(__dirname, '..', 'data', 'media');
app.use('/media', express.static(mediaDir));

// BGM 曲库本地文件托管（内置种子曲 + POST /studio/bgm 上传）
const bgmDir = path.join(__dirname, '..', 'data', 'bgm');
app.use('/bgm', express.static(bgmDir));

// TTS 配音音频托管（POST /studio/tts 生成到 data/tts/）
const ttsDir = path.join(__dirname, '..', 'data', 'tts');
app.use('/tts', express.static(ttsDir));

// 封面 SVG 托管（POST /studio/cover 生成到 data/covers/）
const coversDir = path.join(__dirname, '..', 'data', 'covers');
app.use('/covers', express.static(coversDir));

// Serve built frontend
const distDir = path.join(__dirname, '..', 'dist');
app.use(express.static(distDir));
app.get('*', (_req, res) => {
  res.sendFile(path.join(distDir, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[overseas-agent] http://0.0.0.0:${PORT}`);
});
