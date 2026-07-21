/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_1227920581")

  // add field
  collection.fields.addAt(7, new Field({
    "autogeneratePattern": "",
    "hidden": false,
    "id": "text1044760792",
    "max": 0,
    "min": 0,
    "name": "scenario",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  // add field
  collection.fields.addAt(8, new Field({
    "hidden": false,
    "id": "json3601712397",
    "maxSize": 0,
    "name": "signals",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "json"
  }))

  // add field
  collection.fields.addAt(9, new Field({
    "autogeneratePattern": "",
    "hidden": false,
    "id": "text3194813201",
    "max": 0,
    "min": 0,
    "name": "intent",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  // add field
  collection.fields.addAt(10, new Field({
    "hidden": false,
    "id": "json562247110",
    "maxSize": 0,
    "name": "strategy_steps",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "json"
  }))

  // add field
  collection.fields.addAt(11, new Field({
    "autogeneratePattern": "",
    "hidden": false,
    "id": "text3856691125",
    "max": 0,
    "min": 0,
    "name": "risk_link",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  // add field
  collection.fields.addAt(12, new Field({
    "autogeneratePattern": "",
    "hidden": false,
    "id": "text1156929664",
    "max": 0,
    "min": 0,
    "name": "escalate",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_1227920581")

  // remove field
  collection.fields.removeById("text1044760792")

  // remove field
  collection.fields.removeById("json3601712397")

  // remove field
  collection.fields.removeById("text3194813201")

  // remove field
  collection.fields.removeById("json562247110")

  // remove field
  collection.fields.removeById("text3856691125")

  // remove field
  collection.fields.removeById("text1156929664")

  return app.save(collection)
})
