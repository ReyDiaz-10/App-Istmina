import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getCustomerDeliveryMinutes,
  getCustomerPreparationMinutes,
  getDriverBusinessTargetMinutes,
  getMinutesUntilEta,
} from '../src/utils/deliveryEtas.js';

const now = Date.parse('2026-11-20T12:00:00.000Z');

test('role-specific ETA buffers use remaining real time without mutating it', () => {
  const eta = new Date(now + 20 * 60000).toISOString();
  assert.equal(getDriverBusinessTargetMinutes(eta, now), 15);
  assert.equal(getCustomerPreparationMinutes(eta, now), 25);
  assert.equal(getCustomerDeliveryMinutes(eta, now), 30);
  assert.equal(getMinutesUntilEta(eta, now), 20);
});

test('driver target stays at five minutes and expired estimates never go negative', () => {
  const nearEta = new Date(now + 4 * 60000).toISOString();
  const expiredEta = new Date(now - 60000).toISOString();
  assert.equal(getDriverBusinessTargetMinutes(nearEta, now), 5);
  assert.equal(getMinutesUntilEta(expiredEta, now), 0);
  assert.equal(getCustomerPreparationMinutes(expiredEta, now), 5);
  assert.equal(getCustomerDeliveryMinutes(expiredEta, now), 10);
});

test('invalid timestamps and clocks do not produce NaN estimates', () => {
  assert.equal(getMinutesUntilEta('not-a-date', now), null);
  assert.equal(getDriverBusinessTargetMinutes(null, now), null);
  assert.equal(getCustomerPreparationMinutes(new Date(now + 60000).toISOString(), Number.NaN), null);
});
