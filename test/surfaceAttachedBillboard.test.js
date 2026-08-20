import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resolveSurfaceConstrainedBillboardCenter,
  SURFACE_SEPARATION_EPSILON
} from '../src/webgl/WebGLRendererHost.js';

const close = (actual, expected, epsilon = 1e-10) => assert.ok(Math.abs(actual - expected) < epsilon, `${actual} != ${expected}`);
const displacement = (sprite, right, halfWidth) => {
  const center = resolveSurfaceConstrainedBillboardCenter(sprite, right, halfWidth);
  return { x: center[0] - sprite.x, y: center[1] - sprite.y };
};

test('ordinary sprites and sprites with unusable constraints retain their submitted center', () => {
  const sprite = { x: 4, y: 2, z: 1 };
  assert.deepEqual(resolveSurfaceConstrainedBillboardCenter(sprite, [1, 0, 0], 0.6), [4, 2, 1]);
  for (const surfaceConstraints of [[{ normal: { x: 0, y: 0 }, point: { x: 0, y: 0 } }], [{ normal: { x: NaN, y: 1 }, point: { x: 0, y: 0 } }], [null]]) {
    assert.deepEqual(resolveSurfaceConstrainedBillboardCenter({ ...sprite, surfaceConstraints }, [1, 0, 0], 0.6), [4, 2, 1]);
  }
});

test('one surface is normalized and stays epsilon-close straight-on', () => {
  const unit = { x: 4.02, y: 2, z: 1, surfaceConstraints: [{ normal: { x: 1, y: 0 }, point: { x: 4.02, y: 2 } }] };
  const scaled = { ...unit, surfaceConstraints: [{ normal: { x: 20, y: 0 }, point: { x: 4.02, y: 2 } }] };
  const expected = [4.02 + SURFACE_SEPARATION_EPSILON, 2, 1];
  assert.deepEqual(resolveSurfaceConstrainedBillboardCenter(unit, [0, 1, 0], 0.6), expected);
  assert.deepEqual(resolveSurfaceConstrainedBillboardCenter(scaled, [0, 1, 0], 0.6), expected);
});

test('one oblique surface clears the projected billboard half-width', () => {
  const sprite = { x: 0, y: 0, z: 1, surfaceConstraints: [{ normal: { x: 1, y: 0 }, point: { x: 0, y: 0 } }] };
  const offset = displacement(sprite, [1, 0, 0], 0.6);
  close(offset.x, 0.6 + SURFACE_SEPARATION_EPSILON);
  close(offset.y, 0);
});

test('perpendicular constraints clear both planes with the minimum displacement', () => {
  const sprite = { x: 0, y: 0, z: 1, surfaceConstraints: [{ normal: { x: 1, y: 0 }, point: { x: 0, y: 0 } }, { normal: { x: 0, y: 1 }, point: { x: 0, y: 0 } }] };
  const offset = displacement(sprite, [Math.SQRT1_2, Math.SQRT1_2, 0], 1);
  const clearance = Math.SQRT1_2 + SURFACE_SEPARATION_EPSILON;
  close(offset.x, clearance);
  close(offset.y, clearance);
  close(Math.hypot(offset.x, offset.y), Math.SQRT2 * clearance);
});

test('non-perpendicular constraints use the minimal valid intersection', () => {
  const angle = Math.PI / 3;
  const second = { x: -Math.cos(angle), y: Math.sin(angle) };
  const sprite = { x: 0, y: 0, z: 1, surfaceConstraints: [{ normal: { x: 1, y: 0 }, point: { x: 0, y: 0 } }, { normal: second, point: { x: 0, y: 0 } }] };
  const right = [0, 1, 0];
  const offset = displacement(sprite, right, 1);
  const firstClearance = SURFACE_SEPARATION_EPSILON;
  const secondClearance = Math.sin(angle) + SURFACE_SEPARATION_EPSILON;
  const expectedY = (secondClearance + (Math.cos(angle) * firstClearance)) / Math.sin(angle);
  close(offset.x, firstClearance);
  close(offset.y, expectedY);
  assert.ok((offset.x * second.x) + (offset.y * second.y) >= secondClearance - 1e-10);
  close(Math.hypot(offset.x, offset.y), Math.hypot(firstClearance, expectedY));
});

test('an offset plane adds only missing clearance and none when already clear', () => {
  const constraint = { normal: { x: 1, y: 0 }, point: { x: 0, y: 0 } };
  const partiallyClear = { x: 0.4, y: 0, z: 1, surfaceConstraints: [constraint] };
  const partial = displacement(partiallyClear, [1, 0, 0], 0.6);
  close(partial.x, 0.2 + SURFACE_SEPARATION_EPSILON);
  close(partial.y, 0);

  const alreadyClear = { ...partiallyClear, x: 0.7 };
  assert.deepEqual(resolveSurfaceConstrainedBillboardCenter(alreadyClear, [1, 0, 0], 0.6), [0.7, 0, 1]);
});

test('a 1.2-wide billboard clears either nearby corner plane but ignores distant endpoints', () => {
  const wall = { normal: { x: 0, y: 1 }, point: { x: 0, y: 0 } };
  const left = { normal: { x: 1, y: 0 }, point: { x: 0, y: 0 } };
  const right = { normal: { x: -1, y: 0 }, point: { x: 4, y: 0 } };
  const makeSprite = (x) => ({ x, y: 0.02, z: 1, surfaceConstraints: [wall, left, right] });

  const nearLeft = displacement(makeSprite(0.2), [1, 0, 0], 0.6);
  close(nearLeft.x, 0.4 + SURFACE_SEPARATION_EPSILON);
  const nearRight = displacement(makeSprite(3.8), [1, 0, 0], 0.6);
  close(nearRight.x, -(0.4 + SURFACE_SEPARATION_EPSILON));
  const far = displacement(makeSprite(2), [1, 0, 0], 0.6);
  close(far.x, 0);
});
