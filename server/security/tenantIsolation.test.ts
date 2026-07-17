import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

const enterprise = read('server/routes/enterprise.ts');
assert.match(enterprise, /enterpriseRouter\.use\(requireAuth\)/, 'enterprise routes must require authentication');
assert.match(enterprise, /readTenantProfile\(tenantId\)/, 'enterprise profile reads must be tenant scoped');
assert.match(enterprise, /writeTenantProfile\(tenantId, profile, userId\)/, 'enterprise profile writes must be tenant scoped');
assert.doesNotMatch(
  enterprise.slice(enterprise.indexOf("enterpriseRouter.get('/profile'"), enterprise.indexOf('export const productApiRouter')),
  /req\.query\.tenantId|x-tenant-id/,
  'authenticated enterprise UI routes must not accept a caller-selected tenant id',
);

const customers = read('server/routes/customerSuggestions.ts');
assert.match(customers, /customerSuggestionsRouter\.use\(requireAuth\)/, 'customer routes must require authentication');
assert.doesNotMatch(customers, /req\.query\.tenantId|x-tenant-id/, 'customer routes must use the authenticated tenant');
assert.match(read('server/whatsapp/historyImport.ts'), /item\.tenantId === customer\.tenantId/, 'WhatsApp timelines must include a tenant check');

const oauth = read('server/routes/whatsappOAuth.ts');
assert.match(oauth, /if \(supportAccess\) return null/, 'support sessions must not switch to a second tenant');

const videos = read('server/routes/videos.ts');
assert.match(videos, /const \{ tenantId \} = res\.locals as AuthLocals/, 'video routes must resolve tenant from auth locals');

const scheduler = read('server/routes/scheduler.ts');
assert.match(scheduler, /findIndex\(t => t\.id === req\.params\.id && t\.tenantId === tenantId\)/, 'scheduled task updates must check tenant ownership');

const caddy = read('Caddyfile');
assert.doesNotMatch(caddy, /PB_DOMAIN|pocketbase:8090/, 'PocketBase must not be exposed by the public reverse proxy');
const compose = read('docker-compose.yml');
assert.doesNotMatch(compose, /pocketbase:[\s\S]*?ports:\s*\n\s*-\s*["']?8090/m, 'PocketBase must not publish port 8090');

const setup = read('scripts/setup-pb.ts');
assert.match(setup, /ensureWorkbenchAdmin\(token\)/, 'production setup must provision the workbench administrator');
assert.match(read('server/lib/demoAccounts.ts'), /WORKBENCH_ADMIN_EMAIL/, 'workbench administrator must receive dashboard access');
assert.match(read('Dockerfile.pocketbase'), /TARGETARCH/, 'PocketBase image must follow the server CPU architecture');
assert.match(read('scripts/backup-production-data.sh'), /docker cp/, 'production backup must read the PocketBase Docker volume');

console.log('tenant isolation checks passed');
