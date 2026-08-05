import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildMarketingEvents } from '../../src/components/publishing/marketingCalendar.js';

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
assert.match(assistantUi, /setAssistantTool\(null\); setPanelView\('chat'\); setMode\('breathing'\)/, 'assistant panels must fully close instead of leaving a hidden intake tool active');
const diagnosisUi = read('src/components/BusinessDiagnosisModal.tsx');
assert.match(diagnosisUi, /onClick=\{onClose\}[\s\S]*?关闭接待设置/, 'the reception guide must be closable after it is reopened from the sidebar');
assert.match(diagnosisUi, /ui-field ui-select[\s\S]*?请选择主营品类[\s\S]*?请选择，可连续添加[\s\S]*?请选择海外平台经验/, 'guided enterprise choices must use consistent dropdown controls');
const enterpriseUi = read('src/components/EnterprisePage.tsx');
assert.match(enterpriseUi, /function OptionSelector[\s\S]*?<select[\s\S]*?<details[\s\S]*?type="checkbox"/, 'enterprise selectable fields must use single-select or multi-select dropdown controls');
assert.doesNotMatch(enterpriseUi.slice(enterpriseUi.indexOf('function OptionSelector'), enterpriseUi.indexOf('function PaginationControls')), /<Chip/, 'enterprise option selectors must not fall back to chip-only selection');
const globalStyles = read('src/index.css');
for (const styleClass of ['.ui-field', '.ui-select', '.ui-chart-panel', '.ui-floating-panel']) {
  assert.match(globalStyles, new RegExp(styleClass.replace('.', '\\.')), `${styleClass} must remain part of the shared UI system`);
}
const publishingUi = read('src/components/TrafficPage.tsx');
assert.doesNotMatch(publishingUi, /平台发布推荐|publish-recommendations/, 'one-click publishing must not render the removed platform recommendation panel');
assert.match(publishingUi, /applyContentToAll[\s\S]*?title: activeItem\.title[\s\S]*?description: activeItem\.description[\s\S]*?platformCopy:[\s\S]*?firstComment: activeItem\.firstComment/, 'applying content to all videos must copy the current publishing content');
assert.match(publishingUi, /发布队列[\s\S]*?平台账号选择[\s\S]*?内容编辑/, 'publishing queue, account selection, and content editing must remain separate sections');
assert.match(publishingUi, /setDeliveryMode\('now'\)[\s\S]*?立即发布[\s\S]*?setDeliveryMode\('flexible'\)[\s\S]*?时间待定[\s\S]*?setDeliveryMode\('schedule'\)[\s\S]*?定点排期/, 'one-click publishing must expose three unambiguous delivery modes');
assert.match(publishingUi, /item\.deliveryMode !== 'flexible'/, 'time-undecided content must never be included in direct real publishing');
const calendarPlannerUi = read('src/components/publishing/CalendarPlanner.tsx');
assert.match(calendarPlannerUi, /tideMonthDays/, 'publishing tide must cover a complete month');
assert.match(calendarPlannerUi, /onPointerDown=\{startTideDrag\}/, 'publishing tide must support horizontal pointer dragging');
assert.match(calendarPlannerUi, /全球电商节庆点/, 'publishing tide must label global ecommerce festivals');
assert.doesNotMatch(calendarPlannerUi, /festivalNoticesByDay|dayFestivalNotices/, 'festival markers must not be rendered inside calendar day cells');
assert.match(calendarPlannerUi, /pendingTimeSelection[\s\S]*?选择具体发布时间[\s\S]*?确认时间/, 'flexible calendar drops must ask for an explicit publishing time');
assert.match(calendarPlannerUi, /draggable=\{!item\.platformPostId && !item\.scheduleLocked\}/, 'fixed calendar schedules must not be draggable');
assert.match(calendarPlannerUi, /kind: 'tide'[\s\S]*?bestHour[\s\S]*?targetHour[\s\S]*?score/, 'publishing tide hover details must include time, target-market time, and score');
assert.match(calendarPlannerUi, /kind: 'slot'[\s\S]*?startHour[\s\S]*?endHour[\s\S]*?items/, 'calendar schedule slots must expose detailed hover information');
assert.match(calendarPlannerUi, /fallbackPeakScore[\s\S]*?Math\.sin/, 'publishing tide must retain a useful curve when live score data is temporarily unavailable');
assert.doesNotMatch(calendarPlannerUi, /setError\(loadError instanceof Error \? loadError\.message : 'load_failed'\)/, 'calendar UI must not expose raw transport errors');
const strategyUi = read('src/components/StrategyDataBoard.tsx');
assert.match(strategyUi, /已接入账号 \{exposure\.accountCount\}[\s\S]*?openWorkspaceView\('traffic', 'accounts'\)/, 'home connected-account affordance must navigate to social account activity');
const publishingRoutes = read('server/routes/publishing.ts');
assert.match(publishingRoutes, /scheduleLocked: req\.body\?\.scheduleLocked === true/, 'calendar creation must persist the fixed-time lock');
assert.match(publishingRoutes, /currentStats\.scheduleLocked === true[\s\S]*?定点排期时间已锁定/, 'calendar API must reject accidental fixed-time changes');
const events2026 = buildMarketingEvents(new Date(2026, 0, 1));
const eventDates2026 = Object.fromEntries(events2026.filter(event => event.date.startsWith('2026-')).map(event => [event.id, event.date]));
assert.equal(eventDates2026['2026-lunar-new-year'], '2026-02-17', '2026 Lunar New Year must use its real calendar date');
assert.equal(eventDates2026['2026-eid-al-fitr'], '2026-03-20', '2026 Eid al-Fitr must use its real calendar date');
assert.equal(eventDates2026['2026-diwali'], '2026-11-08', '2026 Diwali must use its real calendar date');
assert.equal(eventDates2026['2026-black-friday'], '2026-11-27', 'Black Friday must be derived from Thanksgiving');
assert.equal(eventDates2026['2026-cyber-monday'], '2026-11-30', 'Cyber Monday must be derived from Thanksgiving');
const studioUi = read('src/components/AiCreateStudio.tsx');
assert.match(studioUi, /buildPublishPayload[\s\S]*?sourceProjectId: projectId \|\| undefined[\s\S]*?platform: platform as[\s\S]*?goPublishCurrentWork[\s\S]*?buildPublishPayload\(\)/, 'AI materials must carry their project and platform format into one-click publishing');
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
assert.match(adminRoutes, /adminRouter\.delete\('\/oauth-config\/:platform'[\s\S]*?requireAdminUser\(req\)/, 'clearing global OAuth credentials must require an administrator');
assert.match(adminRoutes, /disconnectTenantPlatformAccounts\(admin\.tenantId, platform\)/, 'clearing global OAuth credentials must only disconnect the current administrator tenant');
const oauthConfig = read('server/lib/oauthConfig.ts');
assert.match(oauthConfig, /disabledPlatforms\?: OAuthPlatform\[\]/, 'cleared OAuth platforms must persist an explicit disabled state');
assert.match(oauthConfig, /youtubeDisabled \? '' :[\s\S]*?metaDisabled \? '' :[\s\S]*?tiktokDisabled \? '' :/, 'cleared OAuth platforms must not silently reactivate from environment variables');
const adminSocialSetup = read('src/components/AdminSocialAccountSetup.tsx');
assert.match(adminSocialSetup, /ClearConfigButton[\s\S]*?清除配置/, 'administrator platform cards must expose a clear action');
assert.match(adminSocialSetup, /role="dialog"[\s\S]*?确认清除/, 'clearing a platform must require an explicit second confirmation');
assert.match(adminSocialSetup, /disconnectedAccounts[\s\S]*?配置已清除/, 'the administrator must receive a clear success result after platform cleanup');

const socialRoutes = read('server/routes/social.ts');
assert.match(socialRoutes, /getTenantAwareTikTokOAuthClient/, 'customer TikTok OAuth must resolve tenant-aware credentials');
assert.match(socialRoutes, /getTikTokClient\(tenantId\)/, 'customer TikTok OAuth must pass the authenticated tenant');
const platformIntegrationRoutes = read('server/routes/platformIntegrations.ts');
assert.match(platformIntegrationRoutes, /put\('\/oauth-config', requireAuth[\s\S]*?tenantId[\s\S]*?upsertTenantPlatformApp/, 'customer OAuth credentials must be authenticated and tenant scoped');
assert.match(platformIntegrationRoutes, /delete\('\/oauth-config\/:platform', requireAuth[\s\S]*?tenantId[\s\S]*?deleteTenantPlatformApp\(tenantId, typedPlatform\)/, 'customer OAuth credential deletion must be authenticated and tenant scoped');
assert.match(platformIntegrationRoutes, /publicTenantPlatformApp/, 'customer OAuth config responses must use the secret-safe public serializer');
assert.match(platformIntegrationRoutes, /waConfigId:\s*text\(req\.body\?\.metaWhatsAppConfigId\)/, 'customer OAuth config must save the tenant-owned WhatsApp Embedded Signup configuration');
const socialAccountCleanup = read('server/lib/socialAccountCleanup.ts');
assert.match(socialAccountCleanup, /where: \{ tenantId \}/, 'platform account cleanup must only query the authenticated tenant');
const userSocialCredentials = read('src/components/UserSocialAppCredentials.tsx');
assert.match(userSocialCredentials, /清除配置[\s\S]*?role="dialog"[\s\S]*?确认清除/, 'integration-center credential cards must expose a confirmed clear action');
const socialCredentialsUi = read('src/components/UserSocialAppCredentials.tsx');
assert.match(socialCredentialsUi, /WhatsAppConnectionPanel[\s\S]*?startWhatsAppEmbeddedSignup/, 'customer integrations must expose WhatsApp Embedded Signup');
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
const materialAssets = read('server/storage/materialAssets.ts');
assert.match(materialAssets, /MATERIAL_ASSET_PREFIX = 'materials\/tenants'/, 'private COS materials must use a tenant prefix');
assert.match(materialAssets, /materialAssetTenantKey\(tenantId\)/, 'material object keys must derive their tenant segment from authenticated tenant data');
const studio = read('server/routes/studio.ts');
assert.match(studio, /materialAssetObjectKey\(tenantId, file\)/, 'material uploads must use an authenticated tenant COS prefix');
assert.match(studio, /r2SignedGetUrl\(key, materialSignedUrlTtlSeconds\(\)\)/, 'private COS material reads must use short-lived signed URLs');
assert.match(studio, /item\.id === req\.params\.id && item\.tenantId === tenantId/, 'material mutations must enforce tenant ownership');
assert.match(studio, /where: \{ tenant_id: tenantId \}/, 'studio projects must be queried by authenticated tenant');
assert.match(studio, /existing\.tenant_id !== tenantId/, 'studio project mutations must enforce tenant ownership');
assert.match(studio, /item\.tenantId === tenantId/, 'variation batches must be tenant filtered');
assert.match(studio, /tenantPrivateObjectKey\(namespace, tenantId, file\)/, 'studio private objects must use tenant-prefixed storage');
assert.match(studio, /persistPrivateStudioAsset\('tts', tenantId/, 'TTS objects must use private storage');
assert.match(studio, /persistPrivateStudioAsset\('voice-samples', tenantId/, 'voice samples must use private storage');
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
