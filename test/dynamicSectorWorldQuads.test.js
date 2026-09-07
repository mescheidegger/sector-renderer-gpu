import test from 'node:test';
import assert from 'node:assert/strict';

import { createDynamicSectorWorldQuads } from '../src/index.js';
import { WebGLRendererHost } from '../src/webgl/WebGLRendererHost.js';
import { singleSectorMap } from './fixtures/syntheticMaps.js';

test('generic floor updates use exact IDs, leave the authored world untouched, and reject invalid heights', () => {
  const world = singleSectorMap();
  world.sectors[0].id = 0;
  world.dynamicSectorIds = [0];
  const original = structuredClone(world);
  const build = createDynamicSectorWorldQuads(world);
  const quads = build(new Map([[0, 2]]));
  assert.ok(quads.filter(({ surfaceType }) => surfaceType === 'floor').every(({ corners }) => corners.every((point) => point[2] === 2)));
  assert.equal(build(new Map([[0, 2]])), quads, 'unchanged heights reuse the prepared presentation');
  assert.deepEqual(world, original);
  for (const [id, z] of [['0', 2], [0, NaN], [0, Infinity], [0, 6], [0, 7]]) {
    assert.throws(() => build(new Map([[id, z]])), /Invalid dynamic floor height/);
  }
  assert.ok(build().filter(({ surfaceType }) => surfaceType === 'floor').every(({ corners }) => corners.every((point) => point[2] === 0)));
});

test('dynamic surface drawing preserves fallback color, animated materials, UVs, light, and floor culling', () => {
  const world = singleSectorMap({ lightLevel: 128, floorMaterial: 'animated-floor', wallMaterial: null });
  world.sectors[0].walls[0].material = 'missing-wall';
  world.sectors[0].walls.forEach((wall) => { wall.color = 0x336699; });
  world.dynamicSectorIds = ['room'];
  const quads = createDynamicSectorWorldQuads(world)(new Map([['room', 2]]));
  const draws = [];
  let packed;
  let useTexture;
  let culling = false;
  let texture;
  const gl = {
    ARRAY_BUFFER: 1, ELEMENT_ARRAY_BUFFER: 2, CULL_FACE: 3, BACK: 4,
    bindBuffer() {},
    bufferData(target, data) { if (target === this.ARRAY_BUFFER) packed = Array.from(data); },
    uniformMatrix4fv() {},
    uniform1f(location, value) { if (location === 'useTexture') useTexture = value; },
    activeTexture() {},
    bindTexture(_target, value) { texture = value; },
    enable(cap) { if (cap === this.CULL_FACE) culling = true; },
    disable(cap) { if (cap === this.CULL_FACE) culling = false; },
    cullFace(face) { assert.equal(face, this.BACK); },
    drawElements() { draws.push({ packed, useTexture, culling, texture }); }
  };
  const host = Object.create(WebGLRendererHost.prototype);
  Object.assign(host, {
    gl,
    setupVertexAttributes() {},
    dynamicBuffers: { vertexBuffer: {}, indexBuffer: {}, indices: new Uint16Array([0, 1, 2, 0, 2, 3]) },
    uniformLocations: { useTexture: 'useTexture' },
    materialAnimations: new Map([['animated-floor', { frames: ['frame-a', 'frame-b'], frameDurationSeconds: 0.25 }]]),
    textureRegistry: { get(key) {
      return key === 'frame-b' ? { texture: 'frame-b', uvRect: { u0: 0.2, v0: 0.3, u1: 0.5, v1: 0.6 } } : null;
    } }
  });
  assert.equal(host.drawWorldQuads({ quads, viewProjection: [], timeSeconds: 0.25 }), quads.length);
  assert.equal(culling, false, 'surface culling is restored before other world quads');
  draws.forEach((draw, index) => {
    const quad = quads[index];
    const floor = quad.surfaceType === 'floor';
    assert.equal(draw.useTexture, floor ? 1 : 0);
    assert.equal(draw.culling, floor);
    if (floor) assert.equal(draw.texture, 'frame-b');
    for (let vertex = 0; vertex < 4; vertex += 1) {
      const offset = vertex * 10;
      assert.deepEqual(draw.packed.slice(offset, offset + 5), Array.from(new Float32Array([...quad.corners[vertex], ...quad.uvs[vertex]])), 'world UVs bypass atlas remapping');
      assert.deepEqual(draw.packed.slice(offset + 5, offset + 9), Array.from(new Float32Array(quad.color)));
      assert.ok(Math.abs(draw.packed[offset + 9] - 128 / 255) < 1e-7);
    }
  });
  assert.equal(host.drawWorldQuads({ quads: [{ textureKey: 'missing', corners: quads[0].corners }], viewProjection: [] }), 0,
    'ordinary missing sprite/quad textures retain their existing skip behavior');
});
