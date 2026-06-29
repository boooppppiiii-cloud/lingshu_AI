/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_393524316")

  // add field
  collection.fields.addAt(12, new Field({
    "help": "",
    "hidden": false,
    "id": "file2606712272",
    "maxSelect": 1,
    "maxSize": 104857600,
    "mimeTypes": null,
    "name": "videoFile",
    "presentable": false,
    "protected": false,
    "required": false,
    "system": false,
    "thumbs": null,
    "type": "file"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_393524316")

  // remove field
  collection.fields.removeById("file2606712272")

  return app.save(collection)
})
