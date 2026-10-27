import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveProjection } from '../src/webgl/resolveProjection.js';
import { createPerspectiveMat4 } from '../src/webgl/math/mat4.js';
import { SectorRenderer } from '../src/SectorRenderer.js';
import { createTrackedGl, EventCanvas, textureProvider, world } from './helpers/trackedWebGL.js';

test('projection normalization preserves exact default projection values', () => {
  assert.deepEqual(resolveProjection(), { fovY: Math.PI / 3, near: 0.1, far: 512 });
});

test('partial overrides retain the normal FOV and close-range clearance', () => {
  assert.deepEqual(resolveProjection({ far: 768 }), { fovY: Math.PI / 3, near: .1, far: 768 });
  assert.deepEqual(resolveProjection({ near: .25 }), { fovY: Math.PI / 3, near: .25, far: 512 });
});

test('projection rejects non-finite, reversed, and degenerate ranges', () => {
  for (const value of [null, false, 1, 'projection']) assert.throws(() => resolveProjection(value), TypeError);
  for (const fovY of [0, -1, Math.PI, Infinity, NaN]) assert.throws(() => resolveProjection({ fovY }), RangeError);
  for (const near of [0, -1, Infinity, NaN]) assert.throws(() => resolveProjection({ near }), RangeError);
  for (const far of [0, -.1, .1, Infinity, NaN]) assert.throws(() => resolveProjection({ far }), RangeError);
  assert.throws(() => resolveProjection({ near: 512, far: 512 }), RangeError);
  assert.throws(() => resolveProjection({ near: 513, far: 512 }), RangeError);
});

// Eye-space forward is -Z; clip-space depth must be between -W and +W.
function ndcDepth(matrix, distance) {
  return (-distance * matrix[10] + matrix[14]) / distance;
}
const perspective = projection => createPerspectiveMat4({ ...resolveProjection(projection), aspect: 16 / 9 });

test('large-map geometry beyond the old far plane survives the default perspective', () => {
  const old = perspective({ far: 160 }), current = perspective();
  for (const distance of [180, 240, 400, 480, 500]) {
    assert.ok(ndcDepth(old, distance) > 1, `legacy clips ${distance}`);
    assert.ok(ndcDepth(current, distance) < 1, `default retains ${distance}`);
  }
  assert.ok(ndcDepth(current, 520) > 1, 'the new far boundary still clips');
  assert.ok(ndcDepth(current, .05) < -1, 'the near boundary still clips');
  assert.ok(Math.abs(ndcDepth(current, .1) + 1) < 1e-6);
  assert.ok(Math.abs(ndcDepth(current, 512) - 1) < 1e-6);
});

test('larger perspective ranges keep finite matrices and identical screen scale', () => {
  const original = perspective({ far: 160 });
  for (const projection of [{}, { near: .25, far: 512 }, { near: .5, far: 768 }, { far: 2048 }]) {
    const matrix = perspective(projection), resolved = resolveProjection(projection);
    assert.ok([...matrix].every(Number.isFinite));
    assert.equal(matrix[0], original[0], 'horizontal scale');
    assert.equal(matrix[5], original[5], 'vertical 60 degree FOV');
    assert.ok(Math.abs(ndcDepth(matrix, resolved.near) + 1) < 1e-6);
    assert.ok(Math.abs(ndcDepth(matrix, resolved.far) - 1) < 1e-6);
    assert.ok(ndcDepth(matrix, resolved.near * 2) < ndcDepth(matrix, resolved.far / 2));
  }
  assert.ok(ndcDepth(perspective(), .35) > -1, 'normal collision-radius wall remains visible');
  assert.ok(ndcDepth(perspective({ near: .5, far: 768 }), .35) < -1, 'candidate C would cut a nearby wall');
});

test('renderer construction, resize, and world replacement retain the intended projection', () => {
  for (const projection of [undefined, { far: 160 }, { fovY: .8, near: .2, far: 768 }]) {
    const { gl, state } = createTrackedGl();
    const matrices = [];
    gl.uniformMatrix4fv = (_location, _transpose, matrix) => matrices.push([...matrix]);
    const renderer = new SectorRenderer({ canvas: new EventCanvas(gl), world: world('texture'),
      textureProvider: textureProvider(), projection });
    const frame = { camera: { x: 0, y: 0, z: 1, yaw: 0 } };
    renderer.render(frame);
    const matrix = matrices[0];
    assert.equal(matrix[5], 0); // Z is up in the world-to-view matrix.
    assert.equal(matrix[10], 0);
    // World +Y is forward, hence clip W = world Y for this camera.
    const expected = perspective(projection);
    assert.equal(matrix[6], -expected[10]);
    const initialDraws = renderer.getStats().gpu.drawCalls;
    renderer.resize(640, 360);
    renderer.replaceWorld(world('texture'));
    matrices.length = 0;
    renderer.render(frame);
    assert.deepEqual(matrices[0], matrix);
    assert.equal(renderer.getStats().gpu.drawCalls, initialDraws);
    assert.deepEqual(state.depthFunctionCalls, [gl.LEQUAL]);
    renderer.destroy();
  }
});

test('projection normalization preserves caller overrides', () => {
  assert.deepEqual(resolveProjection({ fovY: 0.75, near: 0.25, far: 500 }), {
    fovY: 0.75, near: 0.25, far: 500
  });
});
