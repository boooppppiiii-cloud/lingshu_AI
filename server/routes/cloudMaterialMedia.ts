import { Readable } from 'node:stream';
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { entitlementGate } from '../middleware/subscription.js';
import { fetchCloudMaterial } from '../lib/cloudMaterials.js';
import { assetIdentity, verifyAssetToken } from '../lib/assetAccess.js';
import type { AuthLocals } from '../middleware/auth.js';

/**
 * Browser-safe cloud material playback.
 *
 * Some browser privacy clients block media loaded from an `/api/...` URL even
 * when the response is a valid image/video. Keep playback under the existing
 * `/media` namespace while retaining the same signed/cookie authentication and
 * subscription checks as the Studio API.
 */
export const cloudMaterialMediaRouter = Router();

cloudMaterialMediaRouter.use(async (req, res, next) => {
  const signedMatch = req.path.match(/^\/([^/]+)\/signed\/([^/]+)\/([^/]+)$/);
  if (!signedMatch) {
    await requireAuth(req, res, next);
    return;
  }
  const identity = await assetIdentity(req);
  const originalPath = `${req.baseUrl}/${signedMatch[1]}/${signedMatch[3]}`;
  const signed = identity ? null : verifyAssetToken(signedMatch[2], originalPath);
  if (!identity && !signed) {
    res.status(401).end();
    return;
  }
  (res.locals as AuthLocals).userId = identity?.userId || 'signed-media';
  (res.locals as AuthLocals).tenantId = identity?.tenantId || signed!.tenantId;
  next();
});
cloudMaterialMediaRouter.use(entitlementGate());

cloudMaterialMediaRouter.get(['/:id/:kind', '/:id/signed/:assetToken/:kind'], async (req, res) => {
  const field = req.params.kind === 'poster.jpg'
    ? 'posterFile'
    : req.params.kind === 'media.mp4'
      ? 'videoFile'
      : null;
  if (!field) {
    res.status(404).end();
    return;
  }

  const upstream = await fetchCloudMaterial(req.params.id, field, req.headers.range);
  if (!upstream || !upstream.body) {
    res.status(404).end();
    return;
  }

  for (const header of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']) {
    const value = upstream.headers.get(header);
    if (value) res.setHeader(header, value);
  }
  res.setHeader('Cache-Control', field === 'posterFile' ? 'private, max-age=86400' : 'private, max-age=3600');
  res.setHeader('Vary', 'Cookie, Authorization');
  res.status(upstream.status);
  Readable.fromWeb(upstream.body as any).pipe(res);
});
