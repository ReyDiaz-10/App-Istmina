import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_FONT_SCALE,
  normalizeFontScale,
  scaleTextStyle,
} from '../src/utils/fontScale.mjs';

test('font scale clamps supported values and defaults invalid values', () => {
  assert.equal(normalizeFontScale(0.7), 0.8);
  assert.equal(normalizeFontScale(1.26), 1.3);
  assert.equal(normalizeFontScale(1.8), 1.4);
  assert.equal(normalizeFontScale(Number.NaN), DEFAULT_FONT_SCALE);
});

test('text scaling preserves other styles and scales font size and line height', () => {
  const scaled = scaleTextStyle({ color: '#222', fontSize: 16, lineHeight: 24 }, 1.2);
  assert.equal(scaled.fontSize, 16 * 1.2);
  assert.equal(scaled.lineHeight, 24 * 1.2);
  assert.equal(scaled.color, '#222');

  assert.equal(scaleTextStyle({ color: '#222' }, 1.2).fontSize, 14 * 1.2);
});
