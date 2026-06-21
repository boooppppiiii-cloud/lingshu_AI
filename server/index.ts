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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });

const PORT = Number(process.env.PORT ?? 8788);
const app = express();

app.use(compression());
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
app.use('/api/overseas/scheduler', schedulerRouter);
app.use('/api/overseas/plugins', pluginsRouter);
app.use('/api/overseas/studio', studioRouter);

initScheduler();

// Serve built frontend
const distDir = path.join(__dirname, '..', 'dist');
app.use(express.static(distDir));
app.get('*', (_req, res) => {
  res.sendFile(path.join(distDir, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[overseas-agent] http://0.0.0.0:${PORT}`);
});
