/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_2538639081")

  // add field
  collection.fields.addAt(9, new Field({
    "hidden": false,
    "id": "json3540800594",
    "maxSize": 0,
    "name": "strategy_ids",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "json"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_2538639081")

  // remove field
  collection.fields.removeById("json3540800594")

  return app.save(collection)
})
