import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidOperatingTime,
  isOperatingRangeValid,
  formatOperatingStatus,
} from '../src/utils/operatingHours.js';

test('operating hours accept only valid 24-hour values', () => {
  assert.equal(isValidOperatingTime('09:30'), true);
  assert.equal(isValidOperatingTime('21:30'), true);
  assert.equal(isValidOperatingTime('24:00'), false);
  assert.equal(isValidOperatingTime('9:30'), false);
});

test('closing at the same minute or earlier is rejected', () => {
  assert.equal(isOperatingRangeValid('21:30', '21:30'), false);
  assert.equal(isOperatingRangeValid('21:40', '21:30'), false);
  assert.equal(isOperatingRangeValid('09:30', '21:30'), true);
});

test('operating status includes closing boundary information', () => {
  assert.equal(
    formatOperatingStatus({
      configured: true,
      is_open: false,
      opens_at: '08:00',
      closes_at: '21:30',
      message: 'Cierra a las 21:30',
    }),
    'Cierra a las 21:30 · horario: 08:00 a 21:30',
  );
});
