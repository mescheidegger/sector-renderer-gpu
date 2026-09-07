import assert from 'node:assert/strict';
import test from 'node:test';

import { WebGLRendererHost } from '../src/webgl/WebGLRendererHost.js';

function drawSprites(sprites, yaw = 0) {
  const drawn = [];
  const depthMasks = [];
  const host = Object.create(WebGLRendererHost.prototype);
  Object.assign(host, {
    gl: {
      COLOR_BUFFER_BIT: 1,
      DEPTH_BUFFER_BIT: 2,
      clear() {},
      useProgram() {},
      uniform1i() {},
      depthMask: (enabled) => depthMasks.push(enabled)
    },
    program: {},
    uniformLocations: { texture: 'texture' },
    projection: { fovY: Math.PI / 2, near: 0.1, far: 100 },
    aspect: 1,
    textureRegistry: {
      get: () => ({ width: 1, height: 1 })
    },
    drawStaticWorld: () => ({ drawCalls: 0, texturedDrawCalls: 0 }),
    drawWorldQuads: () => 0,
    drawOverlays: () => 0,
    drawQuad({ textureKey, quad }) {
      drawn.push({ textureKey, quad });
      return true;
    }
  });

  const stats = host.render({
    camera: { x: 0, y: 0, z: 0, yaw },
    sprites,
    worldQuads: [],
    overlays: []
  });

  assert.equal(stats.drawCalls, sprites.length);
  assert.deepEqual(depthMasks, [false, true]);
  return drawn;
}

const drawnKeys = (sprites, yaw) => drawSprites(sprites, yaw).map(({ textureKey }) => textureKey);

test('world sprites sort by camera-forward depth when radial distance disagrees', () => {
  const sprites = [
    { textureKey: 'radially-farther', x: 2, y: 4, z: 0 },
    { textureKey: 'camera-deeper', x: 1.5, y: 4.1, z: 0 }
  ];

  assert.ok(Math.hypot(2, 4) > Math.hypot(1.5, 4.1));
  assert.deepEqual(drawnKeys(sprites, 0), ['camera-deeper', 'radially-farther']);
});

test('world sprite depth ordering follows camera yaw', () => {
  const sprites = [
    { textureKey: 'x-deeper', x: 4, y: 1, z: 0 },
    { textureKey: 'y-deeper', x: 1, y: 4, z: 0 }
  ];

  assert.deepEqual(drawnKeys(sprites, 0), ['y-deeper', 'x-deeper']);
  assert.deepEqual(drawnKeys(sprites, Math.PI / 2), ['x-deeper', 'y-deeper']);
});

test('effectively equal camera depths use sprite.order instead of lateral distance', () => {
  const sprites = [
    { textureKey: 'lower-order', x: 100, y: 4, z: 0, order: -2 },
    { textureKey: 'higher-order', x: 0, y: 4.0000005, z: 0, order: 5 }
  ];

  assert.deepEqual(drawnKeys(sprites, 0), ['lower-order', 'higher-order']);
});

test('world sprite depth and billboard geometry share the resolved surface placement', () => {
  const sprites = [
    {
      textureKey: 'surface-resolved-farther',
      x: 0,
      y: 4,
      z: 0,
      surfaceConstraints: [{ normal: { x: 0, y: 1 }, point: { x: 0, y: 4 } }]
    },
    { textureKey: 'authored-farther', x: 0, y: 4.0005, z: 0 }
  ];

  const drawn = drawSprites(sprites, 0);
  assert.deepEqual(drawn.map(({ textureKey }) => textureKey), [
    'surface-resolved-farther',
    'authored-farther'
  ]);
  const resolvedCenterY = drawn[0].quad.corners.reduce((sum, corner) => sum + corner[1], 0) / 4;
  assert.equal(resolvedCenterY, 4.001);
});
