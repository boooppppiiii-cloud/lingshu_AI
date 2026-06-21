/**
 * Backend-agnostic data + auth interfaces.
 *
 * Routes depend ONLY on these types — never on PocketBase (or any other
 * backend) syntax. To migrate backends (e.g. PocketBase → Supabase), write a
 * new implementation of `DataStore` + `AuthProvider` and swap it in
 * `storage/index.ts`. Routes stay untouched.
 */

/** A stored record always has a string `id`; everything else is backend data. */
export type Record_ = { id: string } & Record<string, unknown>;

/** Equality conditions, all AND-ed together. The only query shape the app uses. */
export type Where = Record<string, string | number | boolean>;

export interface ListQuery {
  /** Equality filter; every entry is AND-ed. e.g. { tenantId, status } */
  where?: Where;
  /**
   * Backend-neutral sort key. Prefix with `-` for descending.
   * e.g. "-createdAt" (newest first), "sceneIndex" (ascending).
   */
  sort?: string;
  page?: number;
  perPage?: number;
}

export interface ListResult<T = Record_> {
  items: T[];
  totalItems: number;
  totalPages: number;
  page: number;
  perPage: number;
}

/** CRUD surface every backend must implement. Collection = table name. */
export interface DataStore {
  getById<T = Record_>(collection: string, id: string): Promise<T | null>;
  create<T = Record_>(collection: string, data: Record<string, unknown>): Promise<T | null>;
  update(collection: string, id: string, data: Record<string, unknown>): Promise<boolean>;
  delete(collection: string, id: string): Promise<boolean>;
  list<T = Record_>(collection: string, query?: ListQuery): Promise<ListResult<T>>;
}

/** Resolved identity from a request's auth token. */
export interface Identity {
  userId: string;
  tenantId: string;
}

/** Token verification surface. Swap implementations to change auth backend. */
export interface AuthProvider {
  /** Verify an `Authorization` header value; null = unauthenticated. */
  verifyToken(authHeader: string | undefined): Promise<Identity | null>;
}
