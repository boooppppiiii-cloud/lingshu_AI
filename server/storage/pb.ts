/**
 * PocketBase Admin client — fetch-based, no SDK dependency.
 * Pattern: cached admin token, auto-refresh on 401.
 */

export function getPbUrl(): string {
  return (process.env.PB_URL ?? 'http://localhost:8090').replace(/\/$/, '');
}

let cachedToken: string | null = null;
let cachedIdentityKey: string | null = null;

function adminCreds(): { email: string; password: string } | null {
  const email = process.env.PB_ADMIN_EMAIL?.trim();
  const password = process.env.PB_ADMIN_PASSWORD?.trim();
  if (!email || !password) return null;
  return { email, password };
}

export async function getPbAdminToken(): Promise<string | null> {
  const creds = adminCreds();
  if (!creds) return null;

  const key = `${creds.email}\0${creds.password}`;
  if (cachedToken && cachedIdentityKey === key) return cachedToken;

  cachedToken = null;
  cachedIdentityKey = key;

  const pbUrl = getPbUrl();
  const body = JSON.stringify({ identity: creds.email, password: creds.password });

  for (const path of [
    '/api/collections/_superusers/auth-with-password',
    '/api/admins/auth-with-password',
  ]) {
    try {
      const res = await fetch(`${pbUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
      if (!res.ok) continue;
      const json = (await res.json()) as { token?: string };
      if (json.token) {
        cachedToken = json.token;
        cachedIdentityKey = key;
        return cachedToken;
      }
    } catch {
      continue;
    }
  }
  return null;
}

/** Invalidate cached token (call on 401 response) */
export function invalidatePbAdminToken(): void {
  cachedToken = null;
}

export async function adminFetch(
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  const token = await getPbAdminToken();
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string> ?? {}),
    ...(token ? { Authorization: token } : {}),
  };
  const res = await fetch(`${getPbUrl()}${path}`, { ...options, headers });
  if (res.status === 401) {
    invalidatePbAdminToken();
  }
  return res;
}

/** Resolve user's tenantId from PocketBase JWT token */
export async function getTenantIdFromToken(
  authHeader: string | undefined,
): Promise<{ userId: string; tenantId: string } | null> {
  if (!authHeader) return null;
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;

  try {
    const res = await fetch(`${getPbUrl()}/api/collections/users/auth-refresh`, {
      method: 'POST',
      headers: { Authorization: token },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { record?: { id?: string; tenantId?: string } };
    const userId = json.record?.id;
    const tenantId = json.record?.tenantId;
    if (!userId || !tenantId) return null;
    return { userId, tenantId };
  } catch {
    return null;
  }
}

/** GET /api/collections/:col/records/:id */
export async function pbGet(
  collection: string,
  id: string,
): Promise<Record<string, unknown> | null> {
  const res = await adminFetch(
    `/api/collections/${encodeURIComponent(collection)}/records/${encodeURIComponent(id)}`,
  );
  if (!res.ok) return null;
  return (await res.json()) as Record<string, unknown>;
}

/** POST /api/collections/:col/records */
export async function pbCreate(
  collection: string,
  data: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const res = await adminFetch(
    `/api/collections/${encodeURIComponent(collection)}/records`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    },
  );
  if (!res.ok) {
    console.error(`[pb] create ${collection} failed`, res.status, await res.text().catch(() => ''));
    return null;
  }
  return (await res.json()) as Record<string, unknown>;
}

/** PATCH /api/collections/:col/records/:id */
export async function pbPatch(
  collection: string,
  id: string,
  data: Record<string, unknown>,
): Promise<boolean> {
  const res = await adminFetch(
    `/api/collections/${encodeURIComponent(collection)}/records/${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    },
  );
  if (!res.ok) {
    console.error(`[pb] patch ${collection}/${id} failed`, res.status, await res.text().catch(() => ''));
  }
  return res.ok;
}

/** DELETE /api/collections/:col/records/:id */
export async function pbDelete(collection: string, id: string): Promise<boolean> {
  const res = await adminFetch(
    `/api/collections/${encodeURIComponent(collection)}/records/${encodeURIComponent(id)}`,
    { method: 'DELETE' },
  );
  return res.ok;
}

export interface PbListOptions {
  filter?: string;
  sort?: string;
  page?: number;
  perPage?: number;
  expand?: string;
}

export interface PbListResult<T = Record<string, unknown>> {
  items: T[];
  totalItems: number;
  totalPages: number;
  page: number;
  perPage: number;
}

/** GET /api/collections/:col/records with filter/sort/pagination */
export async function pbList<T = Record<string, unknown>>(
  collection: string,
  opts: PbListOptions = {},
): Promise<PbListResult<T>> {
  const params = new URLSearchParams();
  if (opts.filter) params.set('filter', opts.filter);
  if (opts.sort) params.set('sort', opts.sort);
  if (opts.page) params.set('page', String(opts.page));
  if (opts.perPage) params.set('perPage', String(opts.perPage));
  if (opts.expand) params.set('expand', opts.expand);

  const res = await adminFetch(
    `/api/collections/${encodeURIComponent(collection)}/records?${params}`,
  );
  if (!res.ok) {
    return { items: [], totalItems: 0, totalPages: 0, page: 1, perPage: 20 };
  }
  const json = (await res.json()) as {
    items?: T[];
    totalItems?: number;
    totalPages?: number;
    page?: number;
    perPage?: number;
  };
  return {
    items: json.items ?? [],
    totalItems: json.totalItems ?? 0,
    totalPages: json.totalPages ?? 0,
    page: json.page ?? 1,
    perPage: json.perPage ?? 20,
  };
}

export async function pbListStrict<T = Record<string, unknown>>(
  collection: string,
  opts: PbListOptions = {},
): Promise<PbListResult<T>> {
  const params = new URLSearchParams();
  if (opts.filter) params.set('filter', opts.filter);
  if (opts.sort) params.set('sort', opts.sort);
  if (opts.page) params.set('page', String(opts.page));
  if (opts.perPage) params.set('perPage', String(opts.perPage));
  if (opts.expand) params.set('expand', opts.expand);

  const res = await adminFetch(
    `/api/collections/${encodeURIComponent(collection)}/records?${params}`,
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`${collection} read failed (${res.status})${detail ? `: ${detail}` : ''}`);
  }
  const json = (await res.json()) as {
    items?: T[];
    totalItems?: number;
    totalPages?: number;
    page?: number;
    perPage?: number;
  };
  return {
    items: json.items ?? [],
    totalItems: json.totalItems ?? 0,
    totalPages: json.totalPages ?? 0,
    page: json.page ?? 1,
    perPage: json.perPage ?? 20,
  };
}
