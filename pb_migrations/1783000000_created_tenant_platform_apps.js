/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = new Collection({
    "createRule": null,
    "deleteRule": null,
    "fields": [
      {
        "autogeneratePattern": "[a-z0-9]{15}",
        "hidden": false,
        "id": "text_tpa_id",
        "max": 15,
        "min": 15,
        "name": "id",
        "pattern": "^[a-z0-9]+$",
        "presentable": false,
        "primaryKey": true,
        "required": true,
        "system": true,
        "type": "text"
      },
      { "autogeneratePattern": "", "hidden": false, "id": "text_tpa_tenant", "max": 0, "min": 0, "name": "tenant_id", "pattern": "", "presentable": false, "primaryKey": false, "required": true, "system": false, "type": "text" },
      { "autogeneratePattern": "", "hidden": false, "id": "text_tpa_platform", "max": 0, "min": 0, "name": "platform", "pattern": "^(meta|google)$", "presentable": false, "primaryKey": false, "required": true, "system": false, "type": "text" },
      { "autogeneratePattern": "", "hidden": false, "id": "text_tpa_app_id", "max": 0, "min": 0, "name": "app_id", "pattern": "", "presentable": false, "primaryKey": false, "required": false, "system": false, "type": "text" },
      { "autogeneratePattern": "", "hidden": true, "id": "text_tpa_app_secret", "max": 0, "min": 0, "name": "app_secret", "pattern": "", "presentable": false, "primaryKey": false, "required": false, "system": false, "type": "text" },
      { "autogeneratePattern": "", "hidden": false, "id": "text_tpa_wa_config", "max": 0, "min": 0, "name": "wa_config_id", "pattern": "", "presentable": false, "primaryKey": false, "required": false, "system": false, "type": "text" },
      { "autogeneratePattern": "", "hidden": false, "id": "text_tpa_verify", "max": 0, "min": 0, "name": "webhook_verify_token", "pattern": "", "presentable": false, "primaryKey": false, "required": false, "system": false, "type": "text" },
      { "autogeneratePattern": "", "hidden": false, "id": "text_tpa_token_type", "max": 0, "min": 0, "name": "token_type", "pattern": "^(user_60d|system_user_permanent)$", "presentable": false, "primaryKey": false, "required": false, "system": false, "type": "text" },
      { "autogeneratePattern": "", "hidden": true, "id": "text_tpa_access_token", "max": 0, "min": 0, "name": "access_token", "pattern": "", "presentable": false, "primaryKey": false, "required": false, "system": false, "type": "text" },
      { "autogeneratePattern": "", "hidden": false, "id": "text_tpa_token_exp", "max": 0, "min": 0, "name": "token_expires_at", "pattern": "", "presentable": false, "primaryKey": false, "required": false, "system": false, "type": "text" },
      { "autogeneratePattern": "", "hidden": false, "id": "text_tpa_status", "max": 0, "min": 0, "name": "status", "pattern": "^(pending|active|token_expired|error)$", "presentable": false, "primaryKey": false, "required": false, "system": false, "type": "text" },
      { "autogeneratePattern": "", "hidden": false, "id": "text_tpa_notes", "max": 0, "min": 0, "name": "notes", "pattern": "", "presentable": false, "primaryKey": false, "required": false, "system": false, "type": "text" }
    ],
    "id": "pbc_tenant_platform_apps",
    "indexes": [
      "CREATE UNIQUE INDEX `idx_tenant_platform_apps_unique` ON `tenant_platform_apps` (`tenant_id`, `platform`)",
      "CREATE INDEX `idx_tenant_platform_apps_status` ON `tenant_platform_apps` (`status`)"
    ],
    "listRule": null,
    "name": "tenant_platform_apps",
    "system": false,
    "type": "base",
    "updateRule": null,
    "viewRule": null
  });

  return app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_tenant_platform_apps");
  return app.delete(collection);
});
