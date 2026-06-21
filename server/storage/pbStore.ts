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
  getById<T = Record_>(collection: string, id: string) {
    return pbGet(collection, id) as Promise<T | null>;
  },

  create<T = Record_>(collection: string, data: Record<string, unknown>) {
    return pbCreate(collection, data) as Promise<T | null>;
  },

  update(collection: string, id: string, data: Record<string, unknown>) {
    return pbPatch(collection, id, data);
  },

  delete(collection: string, id: string) {
    return pbDelete(collection, id);
  },

  list<T = Record_>(collection: string, query: ListQuery = {}): Promise<ListResult<T>> {
    return pbList<T>(collection, {
      filter: toPbFilter(query.where),
      sort: query.sort, // PB's `-field`/`field` convention matches our neutral one
      page: query.page,
      perPage: query.perPage,
    });
  },
};

export const pbAuth: AuthProvider = {
  verifyToken(authHeader: string | undefined): Promise<Identity | null> {
    return getTenantIdFromToken(authHeader);
  },
};
