import type { Request, Response, NextFunction } from 'express';
import { auth } from '../storage/index.js';
import { assetIdentity, verifyAssetToken } from '../lib/assetAccess.js';

export interface AuthLocals {
  userId: string;
  tenantId: string;
  supportAccess?: {
    requestId: string;
    adminEmail: string;
    tenantName: string;
    expiresAt?: string;
  };
}

/** Attach userId + tenantId to res.locals; return 401 if token is missing/invalid */
export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  // Media elements cannot attach the localStorage bearer header. The API call
  // that loads the studio first synchronizes the same token into an HttpOnly,
  // same-site asset session cookie, so proxied video/audio routes can use it.
  const result = await auth.verifyToken(req.headers.authorization) || await assetIdentity(req);
  // Browser media elements cannot attach an Authorization header. A signed URL
  // is already scoped to the exact request path, tenant and expiry by HMAC, so
  // accept a valid token for any GET/HEAD asset route instead of coupling auth
  // to Express' mount-relative req.path shape.
  const signedMedia = (req.method === 'GET' || req.method === 'HEAD')
    ? verifyAssetToken(req.query.assetToken, `${req.baseUrl}${req.path}`)
    : null;
  if (!result && !signedMedia) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  (res.locals as AuthLocals).userId = result?.userId || 'signed-media';
  (res.locals as AuthLocals).tenantId = result?.tenantId || signedMedia!.tenantId;
  (res.locals as AuthLocals).supportAccess = result?.supportAccess;
  next();
}
