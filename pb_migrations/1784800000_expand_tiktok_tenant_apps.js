migrate((app) => {
  const tenantApps = app.findCollectionByNameOrId('tenant_platform_apps');
  tenantApps.fields.getByName('platform').pattern = '^(meta|google|tiktok|wecom)$';
  app.save(tenantApps);

  const assistLinks = app.findCollectionByNameOrId('assist_links');
  assistLinks.fields.getByName('platform').pattern = '^(meta|google|tiktok)$';
  return app.save(assistLinks);
}, (app) => {
  const tenantApps = app.findCollectionByNameOrId('tenant_platform_apps');
  tenantApps.fields.getByName('platform').pattern = '^(meta|google|wecom)$';
  app.save(tenantApps);

  const assistLinks = app.findCollectionByNameOrId('assist_links');
  assistLinks.fields.getByName('platform').pattern = '^(meta|google)$';
  return app.save(assistLinks);
});
