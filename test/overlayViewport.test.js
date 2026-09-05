import assert from 'node:assert/strict';
import test from 'node:test';

import { WebGLRendererHost } from '../src/webgl/WebGLRendererHost.js';

const overlay = {
  textureKey: 'example',
  anchorX: 0.5,
  anchorY: 1,
  width: 200,
  height: 100,
  offsetX: 0,
  offsetY: -50
};

function makeHost() {
  const viewportCalls = [];
  const host = Object.create(WebGLRendererHost.prototype);
  host.canvas = { width: 0, height: 0, style: {} };
  host.gl = { viewport: (...args) => viewportCalls.push(args) };
  return { host, viewportCalls };
}

test('resize retains logical viewport dimensions separately from its backing buffer', () => {
  const { host, viewportCalls } = makeHost();
  host.resize(800, 600, { pixelRatio: 2 });

  assert.equal(host.viewportWidth, 800);
  assert.equal(host.viewportHeight, 600);
  assert.equal(host.canvas.width, 1600);
  assert.equal(host.canvas.height, 1200);
  assert.equal(host.canvas.style.width, '800px');
  assert.equal(host.canvas.style.height, '600px');
  assert.deepEqual(viewportCalls, [[0, 0, 1600, 1200]]);
  assert.equal(host.aspect, 800 / 600);
});

test('overlay NDC geometry is independent of backing-buffer pixel ratio', () => {
  const geometries = [1, 2, 3].map((pixelRatio) => {
    const { host } = makeHost();
    host.resize(800, 600, { pixelRatio });
    return host.buildOverlayQuad(overlay);
  });

  assert.deepEqual(geometries[1], geometries[0]);
  assert.deepEqual(geometries[2], geometries[0]);
});

test('changing logical viewport dimensions changes overlay NDC geometry', () => {
  const { host } = makeHost();
  host.resize(800, 600, { pixelRatio: 2 });
  const first = host.buildOverlayQuad(overlay);
  host.resize(400, 300, { pixelRatio: 2 });
  const second = host.buildOverlayQuad(overlay);

  assert.notDeepEqual(second.corners, first.corners);
  assert.equal(second.corners[1][0] - second.corners[0][0], 1);
  assert.equal(first.corners[1][0] - first.corners[0][0], 0.5);
});
