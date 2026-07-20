/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("trend_videos")
  const field = collection.fields.getByName("aiAnalysis")
  field.max = 0
  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("trend_videos")
  const field = collection.fields.getByName("aiAnalysis")
  field.max = 5000
  return app.save(collection)
})
