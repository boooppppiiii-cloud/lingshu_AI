import type { Request, Response, NextFunction } from 'express';
import { getTenantIdFromToken } from '../storage/pb.js';

export interface AuthLocals {
  userId: string;
  tenantId: string;
}

/** Attach userId + tenantId to res.locals; return 401 if token is missing/invalid */
export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const result = await getTenantIdFromToken(req.headers.authorization);
  if (!result) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  (res.locals as AuthLocals).userId = result.userId;
  (res.locals as AuthLocals).tenantId = result.tenantId;
  next();
}
