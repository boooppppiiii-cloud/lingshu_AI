import { Router, type Request, type Response } from 'express';
import { auth, store } from '../storage/index.js';

type AssistantThread = {
  id: string;
  tenantId: string;
  agentId: string;
  messages: unknown[];
  draftInput: string;
  scrollPosition: number;
  unreadCount: number;
  updatedAt: string;
};

async function requireIdentity(req: Request, res: Response) {
  const identity = await auth.verifyToken(req.header('authorization'));
  if (!identity) {
    res.status(401).json({ error: 'unauthorized' });
    return null;
  }
  return identity;
}

export const assistantThreadsRouter = Router();

assistantThreadsRouter.get('/', async (req: Request, res: Response) => {
  const identity = await requireIdentity(req, res);
  if (!identity) return;
  const result = await store.list<AssistantThread>('assistant_threads', {
    where: { tenantId: identity.tenantId },
    perPage: 20,
  });
  res.json({ items: result.items });
});

assistantThreadsRouter.get('/:agentId', async (req: Request, res: Response) => {
  const identity = await requireIdentity(req, res);
  if (!identity) return;
  const result = await store.list<AssistantThread>('assistant_threads', {
    where: { tenantId: identity.tenantId, agentId: req.params.agentId },
    perPage: 1,
  });
  res.json(result.items[0] ?? {
    id: '',
    tenantId: identity.tenantId,
    agentId: req.params.agentId,
    messages: [],
    draftInput: '',
    scrollPosition: 0,
    unreadCount: 0,
  });
});

assistantThreadsRouter.put('/:agentId', async (req: Request, res: Response) => {
  const identity = await requireIdentity(req, res);
  if (!identity) return;
  const existing = await store.list<AssistantThread>('assistant_threads', {
    where: { tenantId: identity.tenantId, agentId: req.params.agentId },
    perPage: 1,
  });
  const payload = {
    tenantId: identity.tenantId,
    agentId: req.params.agentId,
    messages: Array.isArray(req.body.messages) ? req.body.messages : [],
    draftInput: String(req.body.draftInput ?? ''),
    scrollPosition: Number(req.body.scrollPosition ?? 0),
    unreadCount: Math.max(0, Number(req.body.unreadCount ?? 0)),
    updatedAt: new Date().toISOString(),
  };
  const current = existing.items[0];
  if (current?.id) {
    await store.update('assistant_threads', current.id, payload);
    res.json({ ...current, ...payload });
    return;
  }
  const created = await store.create<AssistantThread>('assistant_threads', payload);
  res.json(created ?? { id: '', ...payload });
});
