import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

const enterprise = read('server/routes/enterprise.ts');
assert.match(enterprise, /enterpriseRouter\.use\(requireAuth\)/, 'enterprise routes must require authentication');
assert.match(enterprise, /readTenantProfile\(tenantId\)/, 'enterprise profile reads must be tenant scoped');
assert.match(enterprise, /writeTenantProfile\(tenantId, profile, userId\)/, 'enterprise profile writes must be tenant scoped');
assert.match(enterprise, /enterpriseRouter\.patch\('\/profile'[\s\S]*?readTenantProfile\(tenantId\)[\s\S]*?mergeEnterpriseProfile/, 'diagnosis autosave must merge into the authenticated tenant profile');
assert.match(enterprise, /dataGovernance\?\.aiAccessEnabled === false/, 'AI context must honor enterprise data authorization');
assert.doesNotMatch(
  enterprise.slice(enterprise.indexOf("enterpriseRouter.get('/profile'"), enterprise.indexOf('export const productApiRouter')),
  /req\.query\.tenantId|x-tenant-id/,
  'authenticated enterprise UI routes must not accept a caller-selected tenant id',
);
assert.match(enterprise, /enterpriseAssetObjectKey\(tenantId, storedName\)/, 'enterprise asset uploads must include the authenticated tenant in their object key');
assert.match(enterprise, /enterpriseAssetObjectKey\(tenantId, file\)/, 'enterprise asset reads must derive the object key from the authenticated tenant');
assert.match(enterprise, /Compatibility path while the resumable migration/, 'enterprise assets must retain a local fallback during migration');

const customers = read('server/routes/customerSuggestions.ts');
assert.match(customers, /customerSuggestionsRouter\.use\(requireAuth\)/, 'customer routes must require authentication');
assert.doesNotMatch(customers, /req\.query\.tenantId|x-tenant-id/, 'customer routes must use the authenticated tenant');
assert.match(read('server/whatsapp/historyImport.ts'), /item\.tenantId === customer\.tenantId/, 'WhatsApp timelines must include a tenant check');

const channelStatus = read('server/routes/channels.ts');
assert.match(channelStatus, /where: \{ tenantId, status: 'connected' \}/, 'connected channel lookups must remain tenant scoped');

const oauth = read('server/routes/whatsappOAuth.ts');
assert.match(oauth, /if \(supportAccess\) return null/, 'support sessions must not switch to a second tenant');

const oauthUi = read('src/components/YouTubeIntegration.tsx');
assert.match(oauthUi, /const popup = prepareOAuthPopup\('youtube-oauth'[\s\S]*?await fetch\('\/api\/overseas\/youtube\/oauth\/start'/, 'YouTube must open its OAuth window before awaiting the start request');
assert.match(oauthUi, /const popup = prepareOAuthPopup\(`\$\{platform\}-oauth`[\s\S]*?await fetch\(`\/api\/overseas\/social\/oauth\/\$\{platform\}\/start`/, 'social platforms must open their OAuth window before awaiting the start request');
assert.doesNotMatch(oauthUi, /isTikTokReviewPending|TikTok 账号正在审核中|status\?\.configured === false/, 'all social OAuth cards must keep their connection action available');
assert.match(oauthUi, /SocialPlatformIcon/, 'integration cards must use the shared social brand logos');
const socialPlatformIcon = read('src/components/SocialPlatformIcon.tsx');
for (const brand of ['youtube', 'tiktok', 'instagram', 'facebook', 'whatsapp']) {
  assert.match(socialPlatformIcon, new RegExp(`brand === '${brand}'`), `${brand} must have a real brand logo`);
}
const assistantUi = read('src/components/GlobalAssistant.tsx');
assert.match(assistantUi, /ENTERPRISE_GUIDE_MEMORY_ID[\s\S]*?enterpriseGuideSeen/, 'enterprise center must remember its single proactive assistant guide');
assert.match(assistantUi, /要补资料？点我/, 'enterprise center must leave a concise click-to-open reminder after the proactive guide');
const publishingUi = read('src/components/TrafficPage.tsx');
assert.doesNotMatch(publishingUi, /平台发布推荐|publish-recommendations/, 'one-click publishing must not render the removed platform recommendation panel');
assert.match(publishingUi, /applyContentToAll[\s\S]*?title: activeItem\.title[\s\S]*?description: activeItem\.description[\s\S]*?platformCopy:[\s\S]*?firstComment: activeItem\.firstComment/, 'applying content to all videos must copy the current publishing content');
assert.match(publishingUi, /当前发布内容应用到全部[\s\S]*?平台账号选择[\s\S]*?内容编辑/, 'publishing queue, account selection, and content editing must remain separate sections');
const studioUi = read('src/components/AiCreateStudio.tsx');
assert.match(studioUi, /goPublishCurrentWork[\s\S]*?sourceProjectId: projectId \|\| undefined[\s\S]*?platform: platform as/, 'AI materials must carry their project and platform format into one-click publishing');
const socialSetupGuide = read('docs/客户社媒账号配置与授权操作指南.md');
assert.doesNotMatch(socialSetupGuide, /https:\/\/lingshu\.site\/api\//, 'production OAuth guidance must use the canonical app subdomain');
assert.match(socialSetupGuide, /https:\/\/app\.lingshu\.site\/api\/overseas\/youtube\/oauth\/callback/, 'the canonical YouTube callback must remain documented');

const tenantPlatformApps = read('server/lib/tenantPlatformApps.ts');
assert.match(tenantPlatformApps, /export type TenantPlatform = 'meta' \| 'google' \| 'tiktok' \| 'wecom'/, 'tenant platform applications must include TikTok');
assert.match(tenantPlatformApps, /getTenantTikTokOAuthClient[\s\S]*?getTenantPlatformApp\(tenantId, 'tiktok'\)[\s\S]*?getTikTokOAuthClient\(\)/, 'TikTok OAuth must prefer tenant credentials and retain the global fallback');
const publicPlatformApp = tenantPlatformApps.slice(
  tenantPlatformApps.indexOf('export function publicTenantPlatformApp'),
  tenantPlatformApps.indexOf('export async function upsertTenantPlatformApp'),
);
assert.doesNotMatch(publicPlatformApp, /\bappSecret\s*:/, 'customer-facing platform app data must not expose plaintext app secrets');
const adminRoutes = read('server/routes/admin.ts');
assert.match(adminRoutes, /function adminTenantPlatformApp[\s\S]*?appSecret:\s*decryptSecret\(app\.app_secret\)/, 'admin delivery responses should expose decrypted app secrets for administrator verification');
assert.match(adminRoutes, /\['meta', 'google', 'tiktok', 'wecom'\]/, 'admin delivery cards must include TikTok for every tenant');
assert.match(adminRoutes, /kind === 'tiktok'[\s\S]*?tiktok_test_passed/, 'admin delivery must provide a TikTok credential check');
for (const route of ["'/oauth-config'", "'/delivery/platform-apps'"]) {
  assert.match(adminRoutes, new RegExp(`adminRouter\\.get\\(${route}[\\s\\S]*?requireAdminUser\\(req\\)`), `${route} must require an administrator before returning credentials`);
}

const socialRoutes = read('server/routes/social.ts');
assert.match(socialRoutes, /getTenantAwareTikTokOAuthClient/, 'customer TikTok OAuth must resolve tenant-aware credentials');
assert.match(socialRoutes, /getTikTokClient\(tenantId\)/, 'customer TikTok OAuth must pass the authenticated tenant');
const assistLinks = read('server/routes/assistLinks.ts');
assert.match(assistLinks, /platform === 'meta' \|\| platform === 'google' \|\| platform === 'tiktok'/, 'assist links must accept TikTok');
assert.match(assistLinks, /getTenantAwareTikTokOAuthClient\(tenantId\)/, 'TikTok assist links must use the tenant application');
const deliveryUi = read('src/components/AdminDeliveryPage.tsx');
assert.match(deliveryUi, /type Platform = 'meta' \| 'google' \| 'tiktok' \| 'wecom'/, 'admin delivery UI must include TikTok');
assert.match(deliveryUi, /label="Client Key"[\s\S]*?label="Client Secret"[\s\S]*?app\.oauthRedirectUri/, 'admin delivery UI must expose TikTok credentials and callback');
assert.match(read('pb_migrations/1784800000_expand_tiktok_tenant_apps.js'), /\^\(meta\|google\|tiktok\|wecom\)\$/, 'PocketBase tenant platform validation must accept TikTok');

const videos = read('server/routes/videos.ts');
assert.match(videos, /const \{ tenantId \} = res\.locals as AuthLocals/, 'video routes must resolve tenant from auth locals');

for (const route of ['agentChat', 'strategy', 'draftReply', 'studio']) {
  const source = read(`server/routes/${route}.ts`);
  assert.match(source, /Router\.use\(requireAuth\)|studioRouter\.use\(requireAuth\)/, `${route} routes must require authentication`);
}
assert.doesNotMatch(read('server/routes/draftReply.ts'), /body\.tenantId/, 'draft replies must not accept a caller-selected tenant id');
assert.match(read('server/routes/agentChat.ts'), /readTenantEnterpriseProfile\(tenantId\)/, 'agent chat must use tenant enterprise context');
assert.match(read('server/routes/strategy.ts'), /readTenantEnterpriseProfile\(tenantId\)/, 'strategy chat must use tenant enterprise context');
assert.match(read('server/routes/studio.ts'), /buildEnterpriseContext\(await readTenantEnterpriseProfile\(tenantId\)\)/, 'social generation must use tenant enterprise context');
assert.match(read('server/knowledge/retrieve.ts'), /await readTenantEnterpriseProfile\(tenantId\)/, 'knowledge retrieval must use the authenticated tenant profile');
const strategyRetrieval = read('server/knowledge/strategyRetrieve.ts');
assert.match(strategyRetrieval, /where: \{ tenant_id: tenantId, status: 'active' \}/, 'strategy memory retrieval must be tenant scoped');
const styleMemory = read('server/knowledge/styleMemory.ts');
assert.match(styleMemory, /await readTenantEnterpriseProfile\(tenantId\)/, 'style distillation must read the tenant profile');
assert.match(styleMemory, /await updateTenantEnterpriseProfile\(tenantId,/, 'style distillation must update the tenant profile');
assert.doesNotMatch(styleMemory, /readEnterpriseProfile|updateEnterpriseProfile/, 'style learning must not use the global profile file');
assert.match(read('server/whatsapp/historyImport.ts'), /await readTenantEnterpriseProfile\(tenantId\)/, 'WhatsApp autonomy must use the inbound message tenant profile');

const assetAccess = read('server/lib/assetAccess.ts');
assert.match(assetAccess, /segments\[0\] === 'tenants' && segments\[1\] === viewerTenantId/, 'private assets must enforce tenant path ownership');
const serverIndex = read('server/index.ts');
for (const prefix of ['media', 'bgm', 'tts', 'voice-samples', 'covers']) {
  assert.match(serverIndex, new RegExp(`app\\.use\\('/${prefix}', requireScopedAsset`), `${prefix} assets must use scoped access`);
}

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
