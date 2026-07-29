import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import ffmpegStatic from 'ffmpeg-static';
import { uploadVideoToYouTube, type YouTubeConfig } from '../integrations/youtube.js';
import {
  publishInstagramReel,
  uploadFacebookVideo,
  uploadTikTokVideo,
  type SocialPlatform,
  type SocialUploadInput,
} from '../integrations/social.js';
import { recordSuccessfulPublish, type PublishPlatform } from '../lib/publishHistory.js';
import { store } from '../storage/index.js';
import { r2Upload } from '../storage/r2.js';
import { appendTrackedWaLink, createTrackedPostDraft, finalizeTrackedPost, type PostRecord } from './waLink.js';

const execFileAsync = promisify(execFile);

interface YouTubeAccountRecord {
  id: string;
  tenantId: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  accessToken?: string;
  status: 'connected' | 'error' | 'expired';
}

interface SocialAccountRecord {
  id: string;
  tenantId: string;
  platform: SocialPlatform;
  providerAccountId: string;
  accessToken: string;
  status: 'connected' | 'error' | 'expired';
}

export interface PublishToAccountInput {
  tenantId: string;
  accountId: string;
  platform: PublishPlatform;
  videoPath?: string;
  videoUrl?: string;
  title: string;
  description?: string;
  tags?: unknown;
  privacyStatus?: 'private' | 'unlisted' | 'public';
  madeForKids?: boolean;
  projectId?: string;
  generationVersionId?: string;
  ratio?: string;
  language?: string;
  contentId?: string;
  trackWaLink?: boolean;
  trackingPost?: PostRecord;
  finalizeTracking?: boolean;
}

export interface PublishToAccountResult {
  video: unknown;
  tracking: PostRecord;
  publishRecord: ReturnType<typeof recordSuccessfulPublish> | null;
  platformPostId: string;
}

function publishError(message: string, statusCode: number): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode });
}

function normalizeVideoPath(input: string): string {
  const raw = input.trim();
  return raw.startsWith('file://') ? fileURLToPath(raw) : path.resolve(raw);
}

function parseTags(tags: unknown, description: string): string[] {
  if (Array.isArray(tags)) return tags.map(String).map(item => item.replace(/^#/, '').trim()).filter(Boolean);
  if (typeof tags === 'string') return tags.split(/[\s,，]+/).map(item => item.replace(/^#/, '').trim()).filter(Boolean);
  return Array.from(description.matchAll(/#([\p{L}\p{N}_-]+)/gu)).map(match => match[1]);
}

function accountStatus(error: any): number {
  return Number(error?.statusCode || error?.response?.status || 500) || 500;
}

async function trackingPost(input: PublishToAccountInput): Promise<PostRecord> {
  if (input.trackingPost) {
    if (input.trackingPost.tenant_id !== input.tenantId) throw publishError('Scheduled post does not belong to this tenant', 404);
    if (input.trackingPost.platform && input.trackingPost.platform !== input.platform) throw publishError('Scheduled post platform does not match target account', 400);
    return input.trackingPost;
  }
  return createTrackedPostDraft(input.tenantId, {
    contentId: input.contentId,
    platform: input.platform,
    title: input.title,
    language: input.language,
    enabled: input.trackWaLink !== false,
  });
}

function validateLocalVideo(videoPath: string | undefined, extensions: string[], maxMb: number): string {
  if (!videoPath) throw publishError('缺少待发布的视频文件', 400);
  const resolved = normalizeVideoPath(videoPath);
  if (!extensions.includes(path.extname(resolved).toLowerCase())) throw publishError('视频格式不受目标平台支持', 400);
  if (!fs.existsSync(resolved)) throw publishError('待发布视频文件不存在，请重新上传或生成', 404);
  const stat = fs.statSync(resolved);
  if (!stat.isFile()) throw publishError('视频路径不是文件', 400);
  if (stat.size > maxMb * 1024 * 1024) throw publishError(`视频超过 ${maxMb}MB`, 413);
  return resolved;
}

function socialVideoContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.mov') return 'video/quicktime';
  if (ext === '.webm') return 'video/webm';
  return 'video/mp4';
}

async function publicVideoUrlIfNeeded(filePath: string | undefined): Promise<string | undefined> {
  if (!filePath) return undefined;
  const publicBase = process.env.R2_PUBLIC_URL?.trim();
  if (!publicBase || !fs.existsSync(filePath)) return undefined;
  const key = `social-publish/${Date.now()}-${path.basename(filePath).replace(/[^\w.-]+/g, '-')}`;
  return r2Upload({ key, body: fs.readFileSync(filePath), contentType: socialVideoContentType(filePath) });
}

async function instagramCompatibleVideo(filePath: string | undefined): Promise<string | undefined> {
  if (!filePath) return undefined;
  const parsed = path.parse(filePath);
  const outputPath = path.join(parsed.dir, `${parsed.name}.instagram.mp4`);
  const sourceStat = fs.statSync(filePath);
  try {
    const outputStat = fs.statSync(outputPath);
    if (outputStat.isFile() && outputStat.size > 0 && outputStat.mtimeMs >= sourceStat.mtimeMs) return outputPath;
  } catch {
    // Build a platform-compatible derivative below.
  }
  const temporaryPath = `${outputPath}.${process.pid}.tmp.mp4`;
  try {
    await execFileAsync(String(ffmpegStatic), [
      '-hide_banner',
      '-loglevel', 'error',
      '-nostdin',
      '-y',
      '-i', filePath,
      '-filter_complex',
      '[0:v]split=2[background][foreground];'
        + '[background]scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,boxblur=20:10[background_ready];'
        + '[foreground]scale=720:1280:force_original_aspect_ratio=decrease[foreground_ready];'
        + '[background_ready][foreground_ready]overlay=(W-w)/2:(H-h)/2,format=yuv420p[video]',
      '-map', '[video]',
      '-map', '0:a?',
      '-c:v', 'libx264',
      '-profile:v', 'high',
      '-level:v', '4.0',
      '-preset', 'medium',
      '-crf', '20',
      '-maxrate', '8M',
      '-bufsize', '16M',
      '-r', '30',
      '-g', '60',
      '-keyint_min', '60',
      '-sc_threshold', '0',
      '-flags', '+cgop',
      '-c:a', 'aac',
      '-profile:a', 'aac_low',
      '-ar', '48000',
      '-ac', '2',
      '-b:a', '128k',
      '-movflags', '+faststart',
      temporaryPath,
    ], { timeout: 15 * 60_000, maxBuffer: 8 * 1024 * 1024 });
    fs.renameSync(temporaryPath, outputPath);
    return outputPath;
  } catch (error) {
    try { fs.rmSync(temporaryPath, { force: true }); } catch { /* best effort */ }
    throw publishError(`Instagram 兼容视频生成失败：${error instanceof Error ? error.message : String(error)}`, 500);
  }
}

function platformContentId(video: any): string {
  return String(video?.id || video?.videoId || video?.publishId || '').trim();
}

async function finalizeIfRequested(input: PublishToAccountInput, tracked: PostRecord, platformPostId: string): Promise<void> {
  if (input.finalizeTracking === false) return;
  await finalizeTrackedPost(tracked.id, {
    platformPostId,
    title: input.title,
    stats: { status: 'published' },
  });
}

export async function publishVideoToAccount(input: PublishToAccountInput): Promise<PublishToAccountResult> {
  if (!input.title.trim()) throw publishError('发布标题不能为空', 400);
  if (input.platform === 'youtube') {
    const account = await store.getById<YouTubeAccountRecord>('youtube_accounts', input.accountId);
    if (!account || account.tenantId !== input.tenantId) throw publishError('YouTube account not found', 404);
    if (account.status !== 'connected') throw publishError('YouTube account is not connected', 400);
    const privacyStatus = input.privacyStatus || 'unlisted';
    if (!['private', 'unlisted', 'public'].includes(privacyStatus)) throw publishError('Invalid YouTube privacy status', 400);
    const filePath = validateLocalVideo(input.videoPath, ['.mp4', '.mov', '.webm', '.mkv', '.avi'], Number(process.env.YOUTUBE_MAX_UPLOAD_MB ?? 2048));
    const tracked = await trackingPost(input);
    const description = appendTrackedWaLink('youtube', input.description || '', tracked.wa_link || '');
    const config: YouTubeConfig = {
      clientId: account.clientId,
      clientSecret: account.clientSecret,
      refreshToken: account.refreshToken,
      accessToken: account.accessToken,
    };
    try {
      const video = await uploadVideoToYouTube(config, {
        filePath,
        title: input.title,
        description,
        tags: parseTags(input.tags, description),
        privacyStatus,
        madeForKids: input.madeForKids ?? false,
      });
      const id = platformContentId(video);
      if (!id) throw publishError('YouTube did not return a video id', 502);
      await finalizeIfRequested(input, tracked, id).catch(error => console.error('[publishing] YouTube tracking update failed:', error));
      await store.update('youtube_accounts', input.accountId, { lastSyncAt: new Date().toISOString(), status: 'connected' })
        .catch(error => console.error('[publishing] YouTube account sync update failed:', error));
      let publishRecord: ReturnType<typeof recordSuccessfulPublish> | null = null;
      try {
        publishRecord = recordSuccessfulPublish({
          tenantId: input.tenantId,
          platform: 'youtube',
          accountId: input.accountId,
          platformContentId: id,
          projectId: input.projectId,
          generationVersionId: input.generationVersionId,
          title: input.title,
          description: input.description || '',
          videoPath: input.videoPath,
          ratio: input.ratio,
          language: input.language,
        });
      } catch (error) {
        console.error('[publishing] YouTube history write failed:', error);
      }
      return { video, tracking: tracked, publishRecord, platformPostId: id };
    } catch (error) {
      const status = accountStatus(error);
      if (status === 401 || status === 403) await store.update('youtube_accounts', input.accountId, { status: 'error' });
      throw error;
    }
  }

  const account = await store.getById<SocialAccountRecord>('social_accounts', input.accountId);
  if (!account || account.tenantId !== input.tenantId || account.platform !== input.platform) throw publishError('Social account not found', 404);
  if (account.status !== 'connected') throw publishError('Social account is not connected', 400);
  const filePath = input.videoPath
    ? validateLocalVideo(input.videoPath, ['.mp4', '.mov', '.webm'], Number(process.env.SOCIAL_MAX_UPLOAD_MB ?? 2048))
    : undefined;
  if (!filePath && !input.videoUrl) throw publishError('缺少待发布的视频文件或公开视频地址', 400);
  if (account.platform === 'instagram' && !input.videoUrl && !process.env.R2_PUBLIC_URL?.trim()) {
    throw publishError('Instagram 发布需要配置 R2_PUBLIC_URL 或提供公开视频地址', 400);
  }
  const tracked = await trackingPost(input);
  const socialInput: SocialUploadInput = {
    filePath,
    videoUrl: input.videoUrl,
    title: input.title,
    description: appendTrackedWaLink(account.platform, input.description || '', tracked.wa_link || ''),
    privacyStatus: input.privacyStatus,
  };
  try {
    let video: unknown;
    if (account.platform === 'tiktok') video = await uploadTikTokVideo(account.accessToken, socialInput);
    if (account.platform === 'facebook') video = await uploadFacebookVideo(account.providerAccountId, account.accessToken, process.env.META_GRAPH_VERSION?.trim() || 'v25.0', socialInput);
    if (account.platform === 'instagram') {
      const compatibleFilePath = socialInput.videoUrl ? undefined : await instagramCompatibleVideo(filePath);
      video = await publishInstagramReel(account.providerAccountId, account.accessToken, process.env.META_GRAPH_VERSION?.trim() || 'v25.0', {
        ...socialInput,
        filePath: compatibleFilePath,
        videoUrl: socialInput.videoUrl || await publicVideoUrlIfNeeded(compatibleFilePath),
      });
    }
    const id = platformContentId(video);
    if (!video || !id) throw publishError('平台没有返回发布内容 id', 502);
    await finalizeIfRequested(input, tracked, id).catch(error => console.error(`[publishing] ${account.platform} tracking update failed:`, error));
    await store.update('social_accounts', input.accountId, { lastSyncAt: new Date().toISOString(), status: 'connected' })
      .catch(error => console.error(`[publishing] ${account.platform} account sync update failed:`, error));
    let publishRecord: ReturnType<typeof recordSuccessfulPublish> | null = null;
    try {
      publishRecord = recordSuccessfulPublish({
        tenantId: input.tenantId,
        platform: account.platform,
        accountId: input.accountId,
        platformContentId: id,
        projectId: input.projectId,
        generationVersionId: input.generationVersionId,
        title: input.title,
        description: input.description || '',
        videoPath: input.videoPath,
        ratio: input.ratio,
        language: input.language,
      });
    } catch (error) {
      console.error(`[publishing] ${account.platform} history write failed:`, error);
    }
    return { video, tracking: tracked, publishRecord, platformPostId: id };
  } catch (error) {
    const status = accountStatus(error);
    if (status === 401 || status === 403) await store.update('social_accounts', input.accountId, { status: 'error' });
    throw error;
  }
}
