/// <reference path="../pb_data/types.d.ts" />

function field(name, type, extra) {
  return Object.assign({
    id: `${type}${Math.random().toString(36).slice(2, 12)}`,
    name,
    type,
    required: false,
    system: false,
    hidden: false,
    presentable: false,
  }, extra || {});
}

function text(name) {
  return field(name, 'text', {
    min: 0,
    max: 0,
    pattern: '',
    autogeneratePattern: '',
    primaryKey: false,
  });
}

function number(name) {
  return field(name, 'number', { min: null, max: null, onlyInt: false });
}

function json(name) {
  return field(name, 'json', { maxSize: 0 });
}

function bool(name) {
  return field(name, 'bool', {});
}

function baseCollection(name, fields, indexes) {
  return new Collection({
    name,
    type: 'base',
    system: false,
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    indexes: indexes || [],
    fields: [
      {
        id: `text${Math.random().toString(36).slice(2, 12)}`,
        name: 'id',
        type: 'text',
        system: true,
        required: true,
        primaryKey: true,
        hidden: false,
        presentable: false,
        min: 15,
        max: 15,
        pattern: '^[a-z0-9]+$',
        autogeneratePattern: '[a-z0-9]{15}',
      },
      ...fields,
    ],
  });
}

migrate((app) => {
  app.save(baseCollection('wa_messages', [
    text('tenantId'), text('channelId'), text('customerId'), text('wamid'), text('wa_id'),
    text('direction'), text('type'), text('body'), text('ai_draft'), text('media_id'), text('media_url'),
    json('referral'), json('context'), text('status'), text('ts'),
  ], [
    'CREATE UNIQUE INDEX idx_wa_messages_wamid ON wa_messages (wamid)',
    'CREATE INDEX idx_wa_messages_customer_ts ON wa_messages (tenantId, customerId, ts)',
  ]));

  app.save(baseCollection('customers', [
    text('tenantId'), text('wa_id'), text('profile_name'), text('phone'), text('channelId'),
    json('first_source'), text('last_inbound_at'), text('stage'), text('sop_step'),
    text('automation'), text('owner'), text('next_step'), json('tags'), json('orderHistory'),
    text('inboxReason'), number('priority'), text('estimatedValue'), text('lastActiveLabel'),
  ], [
    'CREATE UNIQUE INDEX idx_customers_tenant_wa ON customers (tenantId, wa_id)',
    'CREATE INDEX idx_customers_tenant_stage ON customers (tenantId, stage)',
  ]));

  app.save(baseCollection('customer_insights', [
    text('tenantId'), text('customer'), text('language'), text('country_guess'), text('product'),
    text('quantity'), text('budget'), text('urgency'), bool('call_request'), bool('complaint'),
    number('intent_score'), json('signals'), json('missing_fields'), text('updatedAt'),
  ], [
    'CREATE UNIQUE INDEX idx_customer_insights_customer ON customer_insights (customer)',
  ]));

  app.save(baseCollection('timeline_events', [
    text('tenantId'), text('customer'), text('type'), text('actor'), text('title'), text('body'),
    text('ref'), text('status'), text('ts'),
  ], [
    'CREATE INDEX idx_timeline_customer_ts ON timeline_events (tenantId, customer, ts)',
  ]));
}, (app) => {
  for (const name of ['timeline_events', 'customer_insights', 'customers', 'wa_messages']) {
    const col = app.findCollectionByNameOrId(name);
    if (col) app.delete(col);
  }
});
