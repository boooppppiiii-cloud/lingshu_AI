import { Readable } from 'node:stream';
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { entitlementGate } from '../middleware/subscription.js';
import { fetchCloudMaterial } from '../lib/cloudMaterials.js';

/**
 * Browser-safe cloud material playback.
 *
 * Some browser privacy clients block media loaded from an `/api/...` URL even
 * when the response is a valid image/video. Keep playback under the existing
 * `/media` namespace while retaining the same signed/cookie authentication and
 * subscription checks as the Studio API.
 */
export const cloudMaterialMediaRouter = Router();

cloudMaterialMediaRouter.use(requireAuth);
cloudMaterialMediaRouter.use(entitlementGate());

cloudMaterialMediaRouter.get('/:id/:kind', async (req, res) => {
  const field = req.params.kind === 'poster'
    ? 'posterFile'
    : req.params.kind === 'media'
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
