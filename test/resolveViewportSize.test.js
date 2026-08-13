import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveViewportSize } from '../src/webgl/canvas/resolveViewportSize.js';

test('viewport sizing scales logical dimensions by pixel ratio', () => {
  assert.deepEqual(resolveViewportSize(800, 600, 2), {
    width: 800, height: 600, pixelRatio: 2, pixelWidth: 1600, pixelHeight: 1200
  });
  assert.equal(resolveViewportSize(800, 600, 1).pixelWidth, 800);
  assert.equal(resolveViewportSize(800, 600, 1).pixelHeight, 600);
});

test('viewport sizing rejects invalid dimensions and normalizes invalid ratios', () => {
  for (const value of [0, -1, Number.NaN, Infinity]) {
    assert.throws(() => resolveViewportSize(value, 20, 1), /width.*finite and positive/);
    assert.throws(() => resolveViewportSize(20, value, 1), /height.*finite and positive/);
  }
  assert.equal(resolveViewportSize(10, 20, 0).pixelRatio, 1);
  assert.equal(resolveViewportSize(10, 20, Number.NaN).pixelRatio, 1);
  assert.equal(resolveViewportSize(10, 20, -2).pixelWidth, 10);
});
