import test from 'node:test';
import assert from 'node:assert/strict';
import { eligibleAvailableDrivers, etaThreeMinuteWindow, eventForOrderStatus, notificationIdempotencyKey, shouldEmailAdminAlert } from '../src/utils/notificationRules.mjs';

test('event mapping only produces recipient-facing order transitions', () => {
  assert.equal(eventForOrderStatus('preparando'), 'order_preparing');
  assert.equal(eventForOrderStatus('en_camino'), 'order_on_the_way');
  assert.equal(eventForOrderStatus('cancelado'), null);
});

test('notification key scopes a unique event to entity and recipient', () => {
  assert.equal(notificationIdempotencyKey('money_received', 'tx-1', 'user-1'), 'money_received:tx-1:user-1');
  assert.notEqual(notificationIdempotencyKey('money_received', 'tx-1', 'user-1'), notificationIdempotencyKey('money_received', 'tx-1', 'user-2'));
  assert.throws(() => notificationIdempotencyKey('', 'id', 'recipient'));
});

test('email preferences only allow the two configured admin alert classes', () => {
  assert.equal(shouldEmailAdminAlert({ role: 'admin', eventKey: 'financial_exception', emailEnabled: true }), true);
  assert.equal(shouldEmailAdminAlert({ role: 'cliente', eventKey: 'financial_exception', emailEnabled: true }), false);
  assert.equal(shouldEmailAdminAlert({ role: 'admin', eventKey: 'profile_review_pending', emailEnabled: true }), false);
  assert.equal(shouldEmailAdminAlert({ role: 'admin', eventKey: 'inappropriate_language', emailEnabled: false }), false);
});

test('only approved available drivers receive available-order notifications', () => {
  const drivers = [
    { profileId: 'a', role: 'repartidor', approved: true, available: true },
    { profileId: 'b', role: 'repartidor', approved: false, available: true },
    { profileId: 'c', role: 'repartidor', approved: true, available: false },
    { profileId: 'd', role: 'cliente', approved: true, available: true },
  ];
  assert.deepEqual(eligibleAvailableDrivers(drivers), ['a']);
});

test('three-minute ETA uses a bounded window, preventing repeated late sends', () => {
  const now = Date.now();
  assert.equal(etaThreeMinuteWindow(now + 3 * 60_000, now), true);
  assert.equal(etaThreeMinuteWindow(now + 90_000, now), false);
  assert.equal(etaThreeMinuteWindow(now + 5 * 60_000, now), false);
});
