/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_699394385")

  collection.fields.addAt(6, new Field({
    "autogeneratePattern": "",
    "help": "AI autonomy level: remind, draft, or auto",
    "hidden": false,
    "id": "text1783600000",
    "max": 0,
    "min": 0,
    "name": "ai_autonomy",
    "pattern": "^(remind|draft|auto)$",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_699394385")

  collection.fields.removeById("text1783600000")

  return app.save(collection)
})
