/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("tenant_platform_apps");
  const hasField = (name) => {
    try { return Boolean(collection.fields.getByName(name)); } catch { return false; }
  };
  const fields = [
    ["business_id", "text_tpa_business"],
    ["waba_id", "text_tpa_waba"],
    ["phone_number_id", "text_tpa_phone"],
    ["page_id", "text_tpa_page"],
    ["ig_user_id", "text_tpa_ig"],
    ["youtube_channel_id", "text_tpa_youtube_channel"],
    ["last_checklist", "text_tpa_checklist"],
  ];
  for (const [name, id] of fields) {
    if (hasField(name)) continue;
    collection.fields.addAt(collection.fields.length, new Field({
      "autogeneratePattern": "",
      "hidden": false,
      id,
      "max": 0,
      "min": 0,
      name,
      "pattern": "",
      "presentable": false,
      "primaryKey": false,
      "required": false,
      "system": false,
      "type": "text"
    }));
  }
  try {
    const status = collection.fields.getByName("status");
    if (status) status.pattern = "^(pending|configuring|waiting_customer|importing_history|verifying|active|needs_permanent_token|token_expired|error)$";
  } catch {}
  return app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("tenant_platform_apps");
  for (const id of ["text_tpa_business", "text_tpa_waba", "text_tpa_phone", "text_tpa_page", "text_tpa_ig", "text_tpa_youtube_channel", "text_tpa_checklist"]) {
    try { collection.fields.removeById(id); } catch {}
  }
  try {
    const status = collection.fields.getByName("status");
    if (status) status.pattern = "^(pending|active|token_expired|error)$";
  } catch {}
  return app.save(collection);
});
