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
      return await pbGet(collection, id) as T | null;
    } catch {
      return null;
    }
  },

  async create<T = Record_>(collection: string, data: Record<string, unknown>) {
    try {
      return await pbCreate(collection, data) as T | null;
    } catch {
      return null;
    }
  },

  async update(collection: string, id: string, data: Record<string, unknown>) {
    try {
      return await pbPatch(collection, id, data);
    } catch {
      return false;
    }
  },

  async delete(collection: string, id: string) {
    try {
      return await pbDelete(collection, id);
    } catch {
      return false;
    }
  },

  async list<T = Record_>(collection: string, query: ListQuery = {}): Promise<ListResult<T>> {
    try {
      return await pbList<T>(collection, {
        filter: toPbFilter(query.where),
        sort: query.sort, // PB's `-field`/`field` convention matches our neutral one
        page: query.page,
        perPage: query.perPage,
      });
    } catch {
      return { items: [], totalItems: 0, totalPages: 0, page: query.page ?? 1, perPage: query.perPage ?? 20 };
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
