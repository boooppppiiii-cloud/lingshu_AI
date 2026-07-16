/**
 * PocketBase implementation of DataStore + AuthProvider.
 *
 * This is the ONLY file that knows PocketBase's filter-string syntax and auth
 * endpoints. It wraps the low-level fetch helpers in `pb.ts`. When migrating
 * off PocketBase, write a sibling `supabaseStore.ts` against the same
 * interfaces and switch the export in `index.ts` — nothing else changes.
 */
import {
  pbGet,
  pbCreate,
  pbPatch,
  pbDelete,
  pbList,
  getTenantIdFromToken,
} from './pb.js';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type {
  AuthProvider,
  DataStore,
  Identity,
  ListQuery,
  ListResult,
  Record_,
  Where,
} from './datastore.js';
import { verifySupportAccessToken } from '../lib/supportAccess.js';

const LOCAL_AUTH_PREFIX = 'local-demo.';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCAL_STORE_DIR = path.join(__dirname, '../../data/local-store');

function isLocalDevFallbackEnabled(): boolean {
  return process.env.NODE_ENV !== 'production' && process.env.DISABLE_LOCAL_AUTH_FALLBACK !== 'true';
}

function parseLocalToken(authHeader: string | undefined): Identity | null {
  if (!isLocalDevFallbackEnabled()) return null;
  const token = authHeader?.replace(/^Bearer\s+/i, '').trim();
  if (!token?.startsWith(LOCAL_AUTH_PREFIX)) return null;
  try {
    const data = JSON.parse(Buffer.from(token.slice(LOCAL_AUTH_PREFIX.length), 'base64url').toString('utf8')) as Partial<Identity>;
    return data.userId && data.tenantId ? { userId: data.userId, tenantId: data.tenantId } : null;
  } catch {
    return null;
  }
}

function localCollectionPath(collection: string): string {
  return path.join(LOCAL_STORE_DIR, `${collection.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`);
}

function readLocalCollection<T = Record_>(collection: string): T[] {
  if (!isLocalDevFallbackEnabled()) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(localCollectionPath(collection), 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLocalCollection(collection: string, records: unknown[]): void {
  fs.mkdirSync(LOCAL_STORE_DIR, { recursive: true });
  const file = localCollectionPath(collection);
  fs.writeFileSync(file, JSON.stringify(records, null, 2), { encoding: 'utf8', mode: 0o600 });
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    // Some platforms ignore POSIX file modes.
  }
}

function sortLocalRecords<T extends Record<string, unknown>>(items: T[], sort?: string): T[] {
  if (!sort) return items;
  const desc = sort.startsWith('-');
  const key = desc ? sort.slice(1) : sort;
  return [...items].sort((a, b) => {
    const av = a[key];
    const bv = b[key];
    const an = typeof av === 'string' ? Date.parse(av) : Number(av);
    const bn = typeof bv === 'string' ? Date.parse(bv) : Number(bv);
    const left = Number.isFinite(an) && Number.isFinite(bn) ? an : String(av ?? '').localeCompare(String(bv ?? ''));
    return desc ? -left : left;
  });
}

function filterLocalRecords<T extends Record<string, unknown>>(items: T[], where?: Where): T[] {
  if (!where) return items;
  return items.filter(item => Object.entries(where).every(([key, value]) => String(item[key] ?? '') === String(value)));
}

function localCreate<T = Record_>(collection: string, data: Record<string, unknown>): T | null {
  if (!isLocalDevFallbackEnabled()) return null;
  const records = readLocalCollection<Record_>(collection);
  const now = new Date().toISOString();
  const record = {
    id: String(data.id || `${collection}_${randomUUID().replaceAll('-', '')}`),
    created: data.created || now,
    updated: data.updated || now,
    ...data,
  } as Record_;
  records.unshift(record);
  writeLocalCollection(collection, records);
  return record as T;
}

function localUpdate(collection: string, id: string, data: Record<string, unknown>): boolean {
  if (!isLocalDevFallbackEnabled()) return false;
  const records = readLocalCollection<Record_>(collection);
  const index = records.findIndex(record => record.id === id);
  if (index < 0) return false;
  records[index] = { ...records[index], ...data, updated: new Date().toISOString() };
  writeLocalCollection(collection, records);
  return true;
}

function localDelete(collection: string, id: string): boolean {
  if (!isLocalDevFallbackEnabled()) return false;
  const records = readLocalCollection<Record_>(collection);
  const next = records.filter(record => record.id !== id);
  if (next.length === records.length) return false;
  writeLocalCollection(collection, next);
  return true;
}

function localList<T = Record_>(collection: string, query: ListQuery = {}): ListResult<T> {
  const page = query.page ?? 1;
  const perPage = query.perPage ?? 20;
  const filtered = sortLocalRecords(filterLocalRecords(readLocalCollection<Record<string, unknown>>(collection), query.where), query.sort);
  const start = (page - 1) * perPage;
  return {
    items: filtered.slice(start, start + perPage) as T[],
    totalItems: filtered.length,
    totalPages: Math.ceil(filtered.length / perPage),
    page,
    perPage,
  };
}

/** Escape a value for inclusion in a PocketBase filter string. */
function pbValue(v: string | number | boolean): string {
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** Translate a backend-neutral `where` object into a PB filter string. */
function toPbFilter(where?: Where): string | undefined {
  if (!where) return undefined;
  const parts = Object.entries(where)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${k} = ${pbValue(v)}`);
  return parts.length ? parts.join(' && ') : undefined;
}

export const pbStore: DataStore = {
  async getById<T = Record_>(collection: string, id: string) {
    try {
      const remote = await pbGet(collection, id) as T | null;
      if (remote) return remote;
      return readLocalCollection<T & { id: string }>(collection).find(record => record.id === id) ?? null;
    } catch {
      return readLocalCollection<T & { id: string }>(collection).find(record => record.id === id) ?? null;
    }
  },

  async create<T = Record_>(collection: string, data: Record<string, unknown>) {
    try {
      const remote = await pbCreate(collection, data) as T | null;
      return remote ?? localCreate<T>(collection, data);
    } catch {
      return localCreate<T>(collection, data);
    }
  },

  async update(collection: string, id: string, data: Record<string, unknown>) {
    try {
      const remote = await pbPatch(collection, id, data);
      return remote || localUpdate(collection, id, data);
    } catch {
      return localUpdate(collection, id, data);
    }
  },

  async delete(collection: string, id: string) {
    try {
      const remote = await pbDelete(collection, id);
      return remote || localDelete(collection, id);
    } catch {
      return localDelete(collection, id);
    }
  },

  async list<T = Record_>(collection: string, query: ListQuery = {}): Promise<ListResult<T>> {
    try {
      const remote = await pbList<T>(collection, {
        filter: toPbFilter(query.where),
        sort: query.sort, // PB's `-field`/`field` convention matches our neutral one
        page: query.page,
        perPage: query.perPage,
      });
      if (remote.totalItems > 0) return remote;
      return localList<T>(collection, query);
    } catch {
      return localList<T>(collection, query);
    }
  },
};

export const pbAuth: AuthProvider = {
  async verifyToken(authHeader: string | undefined): Promise<Identity | null> {
    const supportAccess = verifySupportAccessToken(authHeader);
    if (supportAccess) return supportAccess;
    const local = parseLocalToken(authHeader);
    if (local) return local;
    return getTenantIdFromToken(authHeader);
  },
};
