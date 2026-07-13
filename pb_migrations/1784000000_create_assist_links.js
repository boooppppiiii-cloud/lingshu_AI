/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = new Collection({
    "createRule": null,
    "deleteRule": null,
    "fields": [
      {
        "autogeneratePattern": "[a-z0-9]{15}",
        "hidden": false,
        "id": "text_assist_id",
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
      { "autogeneratePattern": "", "hidden": false, "id": "text_assist_token", "max": 0, "min": 0, "name": "token", "pattern": "", "presentable": false, "primaryKey": false, "required": true, "system": false, "type": "text" },
      { "autogeneratePattern": "", "hidden": false, "id": "text_assist_tenant", "max": 0, "min": 0, "name": "tenant_id", "pattern": "", "presentable": false, "primaryKey": false, "required": true, "system": false, "type": "text" },
      { "autogeneratePattern": "", "hidden": false, "id": "text_assist_platform", "max": 0, "min": 0, "name": "platform", "pattern": "^(meta|google)$", "presentable": false, "primaryKey": false, "required": true, "system": false, "type": "text" },
      { "autogeneratePattern": "", "hidden": false, "id": "text_assist_expires", "max": 0, "min": 0, "name": "expires_at", "pattern": "", "presentable": false, "primaryKey": false, "required": true, "system": false, "type": "text" },
      { "autogeneratePattern": "", "hidden": false, "id": "text_assist_used", "max": 0, "min": 0, "name": "used_at", "pattern": "", "presentable": false, "primaryKey": false, "required": false, "system": false, "type": "text" },
      { "autogeneratePattern": "", "hidden": false, "id": "text_assist_created_by", "max": 0, "min": 0, "name": "created_by", "pattern": "", "presentable": false, "primaryKey": false, "required": false, "system": false, "type": "text" }
    ],
    "id": "pbc_assist_links",
    "indexes": [
      "CREATE UNIQUE INDEX `idx_assist_links_token` ON `assist_links` (`token`)",
      "CREATE INDEX `idx_assist_links_tenant` ON `assist_links` (`tenant_id`)"
    ],
    "listRule": null,
    "name": "assist_links",
    "system": false,
    "type": "base",
    "updateRule": null,
    "viewRule": null
  });

  return app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_assist_links");
  return app.delete(collection);
});
