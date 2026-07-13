/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = new Collection({
    "createRule": null,
    "deleteRule": null,
    "fields": [
      {
        "autogeneratePattern": "[a-z0-9]{15}",
        "hidden": false,
        "id": "text3208210256",
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
      { "autogeneratePattern": "", "hidden": false, "id": "text3783197223", "max": 0, "min": 0, "name": "tenantId", "pattern": "", "presentable": false, "primaryKey": false, "required": false, "system": false, "type": "text" },
      { "autogeneratePattern": "", "hidden": false, "id": "text1626063431", "max": 0, "min": 0, "name": "platform", "pattern": "", "presentable": false, "primaryKey": false, "required": false, "system": false, "type": "text" },
      { "autogeneratePattern": "", "hidden": false, "id": "text4072985501", "max": 0, "min": 0, "name": "accountUrl", "pattern": "", "presentable": false, "primaryKey": false, "required": false, "system": false, "type": "text" },
      { "autogeneratePattern": "", "hidden": false, "id": "text3736311492", "max": 0, "min": 0, "name": "accountName", "pattern": "", "presentable": false, "primaryKey": false, "required": false, "system": false, "type": "text" },
      { "autogeneratePattern": "", "hidden": false, "id": "text2161484870", "max": 0, "min": 0, "name": "handle", "pattern": "", "presentable": false, "primaryKey": false, "required": false, "system": false, "type": "text" },
      { "autogeneratePattern": "", "hidden": false, "id": "text2791689016", "max": 0, "min": 0, "name": "avatarUrl", "pattern": "", "presentable": false, "primaryKey": false, "required": false, "system": false, "type": "text" },
      { "autogeneratePattern": "", "hidden": false, "id": "text3387378", "max": 0, "min": 0, "name": "note", "pattern": "", "presentable": false, "primaryKey": false, "required": false, "system": false, "type": "text" },
      { "autogeneratePattern": "", "hidden": false, "id": "text1792353427", "max": 0, "min": 0, "name": "lastCrawledAt", "pattern": "", "presentable": false, "primaryKey": false, "required": false, "system": false, "type": "text" },
      { "hidden": false, "id": "number2427769027", "max": null, "min": null, "name": "lastCrawlCount", "onlyInt": false, "presentable": false, "required": false, "system": false, "type": "number" },
      { "autogeneratePattern": "", "hidden": false, "id": "text2474278340", "max": 0, "min": 0, "name": "createdAt", "pattern": "", "presentable": false, "primaryKey": false, "required": false, "system": false, "type": "text" }
    ],
    "id": "pbc_3901506420",
    "indexes": [],
    "listRule": null,
    "name": "competitor_accounts",
    "system": false,
    "type": "base",
    "updateRule": null,
    "viewRule": null
  });

  return app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_3901506420");

  return app.delete(collection);
})
