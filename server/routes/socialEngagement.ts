import { Router } from 'express';
import { callLLM } from '../agents/llm.js';
import { guardOutbound } from '../autonomy/outboundGuard.js';
import { getFacebookComments, getFacebookVideos, getInstagramComments, getInstagramMedia, replyToFacebookComment, replyToInstagramComment } from '../integrations/social.js';
import { getMyVideoComments, replyToYouTubeComment, type YouTubeConfig } from '../integrations/youtube.js';
import { requireAuth, type AuthLocals } from '../middleware/auth.js';
import { store } from '../storage/index.js';
import { upsertSocialLead } from '../whatsapp/historyImport.js';

export const socialEngagementRouter = Router();
socialEngagementRouter.use(requireAuth);

type Platform = 'youtube' | 'instagram' | 'facebook' | 'tiktok';
type Status = 'pending' | 'following' | 'converted' | 'ignored' | 'replied';
type StoredState = { id: string; tenantId: string; key: string; status: Status; analysis?: unknown; repliedAt?: string; replyId?: string; updatedAt: string };
const STATE_COL = 'social_comment_states';

function graphVersion() { return process.env.META_GRAPH_VERSION?.trim() || 'v25.0'; }
function cleanJson(raw: string) { return raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''); }
function key(platform: string, accountId: string, commentId: string) { return `${platform}:${accountId}:${commentId}`; }

function heuristic(text: string) {
  const high = /\b(moq|wholesale|bulk|distributor|custom(?:ize|ization)?|logo|packaging|quote|quotation|price|\d+\s*(?:pcs|pieces|units))\b|\u6279\u53d1|\u5b9a\u5236|\u62a5\u4ef7|\u8d77\u8ba2/i.test(text);
  return {
    intent: high ? '采购意向' : '产品兴趣', score: high ? 82 : 55,
    reason: high ? '评论中出现批发、定制、数量或询价信号。' : '已表达兴趣，但尚缺少明确采购条件。',
    replies: [
      'Thanks for your interest! Could you share your target market and estimated quantity?',
      'Happy to help. Which model or customization option are you interested in?',
      'Thanks! I can share the most relevant product details. Are you sourcing for retail or a project?',
    ],
  };
}

async function analyze(text: string, platform: string, contentTitle = '') {
  try {
    const raw = await callLLM([
      'Analyze this public social comment as a B2B export sales lead.',
      'Return strict JSON only: {"intent":string,"score":number,"reason":string,"replies":[string,string,string]}.',
      'Replies must use the commenter language, sound human, avoid invented prices/lead times/promises, and end with one useful question.',
      `Platform: ${platform}\nContent: ${contentTitle}\nComment: ${text}`,
    ].join('\n'), { systemPrompt: 'You are a cautious social selling assistant for an export manufacturer.' });
    const parsed = JSON.parse(cleanJson(raw));
    if (!Array.isArray(parsed.replies) || parsed.replies.length < 3) throw new Error('invalid replies');
    return { intent: String(parsed.intent), score: Math.max(0, Math.min(100, Number(parsed.score) || 0)), reason: String(parsed.reason), replies: parsed.replies.slice(0, 3).map(String) };
  } catch { return heuristic(text); }
}

async function states(tenantId: string) {
  try { return (await store.list<StoredState>(STATE_COL, { where: { tenantId }, perPage: 500 })).items; } catch { return []; }
}

async function saveState(tenantId: string, stateKey: string, patch: Partial<StoredState>) {
  const found = (await states(tenantId)).find(item => item.key === stateKey);
  const data = { tenantId, key: stateKey, status: patch.status || found?.status || 'pending', analysis: patch.analysis ?? found?.analysis, repliedAt: patch.repliedAt ?? found?.repliedAt, replyId: patch.replyId ?? found?.replyId, updatedAt: new Date().toISOString() };
  if (found) { await store.update(STATE_COL, found.id, data); return { ...found, ...data }; }
  return await store.create<StoredState>(STATE_COL, data);
}

socialEngagementRouter.get('/comments', async (_req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const saved = await states(tenantId);
  const savedByKey = new Map(saved.map(item => [item.key, item]));
  const items: any[] = [];
  const accounts: Array<{ id: string; platform: Platform; title: string; handle?: string; status: string }> = [];
  const unavailable: Array<{ platform: string; reason: string }> = [];
  const ytAccounts = (await store.list<any>('youtube_accounts', { where: { tenantId }, perPage: 20 }).catch(() => ({ items: [] } as any))).items;
  accounts.push(...ytAccounts.map((account: any) => ({ id: account.id, platform: 'youtube' as const, title: account.channelTitle || 'YouTube', handle: account.customUrl, status: account.status })));
  for (const account of ytAccounts.filter((item: any) => item.status === 'connected')) {
    try {
      const config: YouTubeConfig = { clientId: account.clientId, clientSecret: account.clientSecret, refreshToken: account.refreshToken, accessToken: account.accessToken };
      const comments = await getMyVideoComments(config, 100, account.channelId);
      for (const comment of comments) {
        const stateKey = key('youtube', account.id, comment.id); const state = savedByKey.get(stateKey);
        items.push({ ...comment, platform: 'youtube', accountId: account.id, accountTitle: account.channelTitle, contentTitle: `YouTube video ${comment.videoId || ''}`, status: state?.status || 'pending', analysis: state?.analysis, stateKey });
      }
    } catch (error) { unavailable.push({ platform: 'youtube', reason: error instanceof Error ? error.message : '评论同步失败' }); }
  }
  const socialAccounts = (await store.list<any>('social_accounts', { where: { tenantId }, perPage: 50 }).catch(() => ({ items: [] } as any))).items;
  accounts.push(...socialAccounts.map((account: any) => ({ id: account.id, platform: account.platform as Platform, title: account.title || account.handle || account.platform, handle: account.handle, status: account.status })));
  for (const account of socialAccounts.filter((item: any) => item.status === 'connected')) {
    if (account.platform === 'tiktok') { unavailable.push({ platform: 'tiktok', reason: 'TikTok 评论 API 权限尚未开放' }); continue; }
    try {
      const content = account.platform === 'facebook'
        ? await getFacebookVideos(account.providerAccountId, account.accessToken, graphVersion(), 12)
        : await getInstagramMedia(account.providerAccountId, account.accessToken, graphVersion(), 12);
      for (const post of content) {
        const comments = account.platform === 'facebook'
          ? await getFacebookComments(post.id, account.accessToken, graphVersion(), 30)
          : await getInstagramComments(post.id, account.accessToken, graphVersion(), 30);
        for (const comment of comments) {
          const stateKey = key(account.platform, account.id, comment.id); const state = savedByKey.get(stateKey);
          items.push({ ...comment, platform: account.platform, accountId: account.id, accountTitle: account.title, contentTitle: post.title || post.description || `${account.platform} content`, status: state?.status || 'pending', analysis: state?.analysis, stateKey });
        }
      }
    } catch (error) { unavailable.push({ platform: account.platform, reason: error instanceof Error ? error.message : '评论同步失败' }); }
  }
  items.sort((a, b) => Date.parse(b.publishedAt || '') - Date.parse(a.publishedAt || ''));
  res.json({ items, total: items.length, accounts, unavailable });
});

socialEngagementRouter.post('/comments/analyze', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const text = String(req.body?.text || '').trim(); const stateKey = String(req.body?.stateKey || '');
  if (!text || !stateKey) { res.status(400).json({ error: 'comment_and_state_key_required' }); return; }
  const analysis = await analyze(text, String(req.body?.platform || ''), String(req.body?.contentTitle || ''));
  await saveState(tenantId, stateKey, { analysis });
  res.json({ analysis });
});

socialEngagementRouter.post('/comments/reply', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const platform = String(req.body?.platform || '') as Platform; const accountId = String(req.body?.accountId || ''); const commentId = String(req.body?.commentId || ''); const message = String(req.body?.message || '').trim();
  if (!accountId || !commentId || !message) { res.status(400).json({ error: 'reply_fields_required' }); return; }
  const guard = await guardOutbound(message, { tenantId, action: 'social_comment_reply' });
  if (!guard.allowed) { res.status(409).json({ error: 'human_review_required', message: '回复涉及价格、交期或承诺，请人工修改后再发送。', rule: guard.matchedRule }); return; }
  try {
    let result: { id: string };
    if (platform === 'youtube') {
    const account = await store.getById<any>('youtube_accounts', accountId);
    if (!account || account.tenantId !== tenantId) { res.status(404).json({ error: 'account_not_found' }); return; }
    result = await replyToYouTubeComment({ clientId: account.clientId, clientSecret: account.clientSecret, refreshToken: account.refreshToken, accessToken: account.accessToken }, commentId, message);
    } else if (platform === 'facebook' || platform === 'instagram') {
    const account = await store.getById<any>('social_accounts', accountId);
    if (!account || account.tenantId !== tenantId || account.platform !== platform) { res.status(404).json({ error: 'account_not_found' }); return; }
    result = platform === 'facebook'
      ? await replyToFacebookComment(commentId, account.accessToken, graphVersion(), message)
      : await replyToInstagramComment(commentId, account.accessToken, graphVersion(), message);
    } else { res.status(501).json({ error: 'platform_reply_unavailable', message: 'TikTok 评论回复需额外平台权限。' }); return; }
    const stateKey = key(platform, accountId, commentId);
    await saveState(tenantId, stateKey, { status: 'replied', repliedAt: new Date().toISOString(), replyId: result.id });
    res.json({ ok: true, replyId: result.id, status: 'replied' });
  } catch (error: any) {
    const detail = error?.response?.data?.error?.message || error?.response?.data?.error || error?.message || '平台回复失败';
    res.status(error?.response?.status || 502).json({ error: 'platform_reply_failed', message: String(detail) });
  }
});

socialEngagementRouter.patch('/comments/status', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals; const stateKey = String(req.body?.stateKey || ''); const status = String(req.body?.status || '') as Status;
  if (!stateKey || !['pending', 'following', 'converted', 'ignored', 'replied'].includes(status)) { res.status(400).json({ error: 'invalid_status' }); return; }
  const item = await saveState(tenantId, stateKey, { status }); res.json({ ok: true, item });
});

socialEngagementRouter.post('/comments/convert', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const lead = upsertSocialLead({ tenantId, platform: String(req.body?.platform || 'social'), externalId: String(req.body?.authorId || req.body?.commentId || ''), name: String(req.body?.authorName || '社媒潜客'), comment: String(req.body?.text || ''), score: Number(req.body?.score || 50), postId: String(req.body?.videoId || ''), postTitle: String(req.body?.contentTitle || '') });
  await saveState(tenantId, String(req.body?.stateKey || ''), { status: 'converted' });
  res.json({ ok: true, customerId: lead.id });
});
