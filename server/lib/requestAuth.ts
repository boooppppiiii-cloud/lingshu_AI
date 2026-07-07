import type { Request, Response } from 'express';
import { auth, type Identity } from '../storage/index.js';

export async function requireIdentity(req: Request, res: Response): Promise<Identity | null> {
  const identity = await auth.verifyToken(req.headers.authorization);
  if (!identity) {
    res.status(401).json({ error: 'unauthorized' });
    return null;
  }
  return identity;
}
