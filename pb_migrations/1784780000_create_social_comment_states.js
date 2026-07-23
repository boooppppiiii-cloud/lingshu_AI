/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = new Collection({
    "createRule": null,
    "deleteRule": null,
    "fields": [
      { "autogeneratePattern": "[a-z0-9]{15}", "hidden": false, "id": "text_social_comment_id", "max": 15, "min": 15, "name": "id", "pattern": "^[a-z0-9]+$", "presentable": false, "primaryKey": true, "required": true, "system": true, "type": "text" },
      { "autogeneratePattern": "", "hidden": false, "id": "text_social_comment_tenant", "max": 0, "min": 0, "name": "tenantId", "pattern": "", "presentable": false, "primaryKey": false, "required": true, "system": false, "type": "text" },
      { "autogeneratePattern": "", "hidden": false, "id": "text_social_comment_key", "max": 0, "min": 0, "name": "key", "pattern": "", "presentable": false, "primaryKey": false, "required": true, "system": false, "type": "text" },
      { "autogeneratePattern": "", "hidden": false, "id": "text_social_comment_status", "max": 0, "min": 0, "name": "status", "pattern": "", "presentable": false, "primaryKey": false, "required": true, "system": false, "type": "text" },
      { "hidden": false, "id": "json_social_comment_analysis", "maxSize": 200000, "name": "analysis", "presentable": false, "required": false, "system": false, "type": "json" },
      { "autogeneratePattern": "", "hidden": false, "id": "text_social_comment_replied", "max": 0, "min": 0, "name": "repliedAt", "pattern": "", "presentable": false, "primaryKey": false, "required": false, "system": false, "type": "text" },
      { "autogeneratePattern": "", "hidden": false, "id": "text_social_comment_reply_id", "max": 0, "min": 0, "name": "replyId", "pattern": "", "presentable": false, "primaryKey": false, "required": false, "system": false, "type": "text" },
      { "autogeneratePattern": "", "hidden": false, "id": "text_social_comment_updated", "max": 0, "min": 0, "name": "updatedAt", "pattern": "", "presentable": false, "primaryKey": false, "required": true, "system": false, "type": "text" }
    ],
    "id": "pbc_social_comment_states",
    "indexes": [
      "CREATE UNIQUE INDEX `idx_social_comment_state_key` ON `social_comment_states` (`tenantId`, `key`)",
      "CREATE INDEX `idx_social_comment_state_status` ON `social_comment_states` (`tenantId`, `status`)"
    ],
    "listRule": null,
    "name": "social_comment_states",
    "system": false,
    "type": "base",
    "updateRule": null,
    "viewRule": null
  });
  return app.save(collection);
}, (app) => app.delete(app.findCollectionByNameOrId("pbc_social_comment_states")));
