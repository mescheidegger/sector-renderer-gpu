import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeLightLevel } from '../src/scene/sectorLighting.js';

test('light level normalization defaults omitted values to one', () => {
  assert.equal(normalizeLightLevel(), 1);
});

test('light level normalization preserves direct brightness scalars', () => {
  assert.equal(normalizeLightLevel(0.65), 0.65);
});

test('light level normalization interprets values above one on a 0..255 scale', () => {
  assert.ok(Math.abs(normalizeLightLevel(128) - (128 / 255)) < Number.EPSILON);
});

test('light level normalization clamps values to the supported range', () => {
  assert.equal(normalizeLightLevel(-10), 0);
  assert.equal(normalizeLightLevel(256), 1);
});

test('light level normalization defaults non-finite values to one', () => {
  assert.equal(normalizeLightLevel(Number.NaN), 1);
  assert.equal(normalizeLightLevel(Number.POSITIVE_INFINITY), 1);
  assert.equal(normalizeLightLevel(Number.NEGATIVE_INFINITY), 1);
});
