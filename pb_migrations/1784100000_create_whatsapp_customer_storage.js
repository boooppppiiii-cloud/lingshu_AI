/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const customers = new Collection({
    "createRule": null,
    "deleteRule": null,
    "fields": [
      { "autogeneratePattern": "[a-z0-9]{15}", "hidden": false, "id": "text_wa_customer_id", "max": 15, "min": 15, "name": "id", "pattern": "^[a-z0-9]+$", "presentable": false, "primaryKey": true, "required": true, "system": true, "type": "text" },
      { "autogeneratePattern": "", "hidden": false, "id": "text_wa_customer_tenant", "max": 0, "min": 0, "name": "tenant_id", "pattern": "", "presentable": false, "primaryKey": false, "required": true, "system": false, "type": "text" },
      { "autogeneratePattern": "", "hidden": false, "id": "text_wa_customer_customer", "max": 0, "min": 0, "name": "customer_id", "pattern": "", "presentable": false, "primaryKey": false, "required": true, "system": false, "type": "text" },
      { "autogeneratePattern": "", "hidden": false, "id": "text_wa_customer_number", "max": 0, "min": 0, "name": "wa_number", "pattern": "", "presentable": false, "primaryKey": false, "required": true, "system": false, "type": "text" },
      { "autogeneratePattern": "", "hidden": false, "id": "text_wa_customer_name", "max": 0, "min": 0, "name": "name", "pattern": "", "presentable": false, "primaryKey": false, "required": false, "system": false, "type": "text" },
      { "autogeneratePattern": "", "hidden": false, "id": "text_wa_customer_stage", "max": 0, "min": 0, "name": "stage", "pattern": "", "presentable": false, "primaryKey": false, "required": false, "system": false, "type": "text" },
      { "hidden": false, "id": "number_wa_customer_last_active", "max": null, "min": null, "name": "last_active_at", "onlyInt": true, "presentable": false, "required": false, "system": false, "type": "number" },
      { "autogeneratePattern": "", "hidden": false, "id": "text_wa_customer_payload", "max": 0, "min": 0, "name": "payload", "pattern": "", "presentable": false, "primaryKey": false, "required": true, "system": false, "type": "text" }
    ],
    "id": "pbc_whatsapp_customers",
    "indexes": [
      "CREATE UNIQUE INDEX `idx_whatsapp_customers_tenant_customer` ON `whatsapp_customers` (`tenant_id`, `customer_id`)",
      "CREATE INDEX `idx_whatsapp_customers_tenant_active` ON `whatsapp_customers` (`tenant_id`, `last_active_at`)"
    ],
    "listRule": null,
    "name": "whatsapp_customers",
    "system": false,
    "type": "base",
    "updateRule": null,
    "viewRule": null
  });

  const interactions = new Collection({
    "createRule": null,
    "deleteRule": null,
    "fields": [
      { "autogeneratePattern": "[a-z0-9]{15}", "hidden": false, "id": "text_wa_interaction_id", "max": 15, "min": 15, "name": "id", "pattern": "^[a-z0-9]+$", "presentable": false, "primaryKey": true, "required": true, "system": true, "type": "text" },
      { "autogeneratePattern": "", "hidden": false, "id": "text_wa_interaction_tenant", "max": 0, "min": 0, "name": "tenant_id", "pattern": "", "presentable": false, "primaryKey": false, "required": true, "system": false, "type": "text" },
      { "autogeneratePattern": "", "hidden": false, "id": "text_wa_interaction_interaction", "max": 0, "min": 0, "name": "interaction_id", "pattern": "", "presentable": false, "primaryKey": false, "required": true, "system": false, "type": "text" },
      { "autogeneratePattern": "", "hidden": false, "id": "text_wa_interaction_customer", "max": 0, "min": 0, "name": "customer_id", "pattern": "", "presentable": false, "primaryKey": false, "required": true, "system": false, "type": "text" },
      { "autogeneratePattern": "", "hidden": false, "id": "text_wa_interaction_number", "max": 0, "min": 0, "name": "wa_number", "pattern": "", "presentable": false, "primaryKey": false, "required": false, "system": false, "type": "text" },
      { "hidden": false, "id": "number_wa_interaction_timestamp", "max": null, "min": null, "name": "timestamp", "onlyInt": true, "presentable": false, "required": false, "system": false, "type": "number" },
      { "autogeneratePattern": "", "hidden": false, "id": "text_wa_interaction_payload", "max": 0, "min": 0, "name": "payload", "pattern": "", "presentable": false, "primaryKey": false, "required": true, "system": false, "type": "text" }
    ],
    "id": "pbc_whatsapp_interactions",
    "indexes": [
      "CREATE UNIQUE INDEX `idx_whatsapp_interactions_tenant_interaction` ON `whatsapp_interactions` (`tenant_id`, `interaction_id`)",
      "CREATE INDEX `idx_whatsapp_interactions_customer_time` ON `whatsapp_interactions` (`tenant_id`, `customer_id`, `timestamp`)"
    ],
    "listRule": null,
    "name": "whatsapp_interactions",
    "system": false,
    "type": "base",
    "updateRule": null,
    "viewRule": null
  });

  app.save(customers);
  return app.save(interactions);
}, (app) => {
  app.delete(app.findCollectionByNameOrId("pbc_whatsapp_interactions"));
  return app.delete(app.findCollectionByNameOrId("pbc_whatsapp_customers"));
});
