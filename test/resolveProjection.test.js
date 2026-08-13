import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveProjection } from '../src/webgl/resolveProjection.js';

test('projection normalization preserves exact default projection values', () => {
  assert.deepEqual(resolveProjection(), { fovY: Math.PI / 3, near: 0.1, far: 160 });
});

test('projection normalization preserves caller overrides', () => {
  assert.deepEqual(resolveProjection({ fovY: 0.75, near: 0.25, far: 500 }), {
    fovY: 0.75, near: 0.25, far: 500
  });
});
