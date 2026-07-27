import assert from 'node:assert/strict';
import { adminFetch, invalidatePbAdminToken } from './pb.js';

const originalFetch = globalThis.fetch;
const originalEmail = process.env.PB_ADMIN_EMAIL;
const originalPassword = process.env.PB_ADMIN_PASSWORD;
const originalUrl = process.env.PB_URL;

process.env.PB_ADMIN_EMAIL = 'admin@example.test';
process.env.PB_ADMIN_PASSWORD = 'test-password';
process.env.PB_URL = 'http://pocketbase.test';
invalidatePbAdminToken();

const calls: Array<{ url: string; authorization: string }> = [];
let authCount = 0;
globalThis.fetch = async (input, init) => {
  const url = String(input);
  const headers = init?.headers as Record<string, string> | undefined;
  calls.push({ url, authorization: headers?.Authorization ?? '' });
  if (url.endsWith('/api/collections/_superusers/auth-with-password')) {
    authCount += 1;
    return Response.json({ token: `admin-token-${authCount}` });
  }
  if (url.endsWith('/api/collections/tenant_profiles/records')) {
    if (headers?.Authorization === 'admin-token-1') {
      return Response.json({ message: 'Only superusers can perform this action.' }, { status: 403 });
    }
    return Response.json({ id: 'profile-1' });
  }
  return new Response(null, { status: 404 });
};

try {
  const response = await adminFetch('/api/collections/tenant_profiles/records', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.equal(response.status, 200);
  assert.equal(authCount, 2, 'a stale PocketBase admin token should trigger one re-authentication');
  const writes = calls.filter(call => call.url.endsWith('/api/collections/tenant_profiles/records'));
  assert.deepEqual(writes.map(call => call.authorization), ['admin-token-1', 'admin-token-2']);
  console.log('PocketBase admin retry passed');
} finally {
  globalThis.fetch = originalFetch;
  invalidatePbAdminToken();
  if (originalEmail === undefined) delete process.env.PB_ADMIN_EMAIL; else process.env.PB_ADMIN_EMAIL = originalEmail;
  if (originalPassword === undefined) delete process.env.PB_ADMIN_PASSWORD; else process.env.PB_ADMIN_PASSWORD = originalPassword;
  if (originalUrl === undefined) delete process.env.PB_URL; else process.env.PB_URL = originalUrl;
}
