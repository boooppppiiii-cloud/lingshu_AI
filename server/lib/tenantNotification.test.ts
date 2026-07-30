import assert from 'node:assert/strict';
import { notifyDeliveryTeam } from './tenantPlatformApps.js';

await assert.rejects(
  notifyDeliveryTeam('test', {
    immediate: true,
    receivers: [{ name: 'unsupported sms', channel: 'sms', target: '+10000000000' }],
  }),
  /notification_receiver_not_deliverable/,
);

console.log('tenant notification delivery guard passed');
