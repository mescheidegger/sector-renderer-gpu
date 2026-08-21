import test from 'node:test';
import assert from 'node:assert/strict';

import { WebGLRendererHost } from '../src/webgl/WebGLRendererHost.js';

test('static draw resolves animated textures by time without replacing or uploading the mesh', () => {
  const textureA = { id: 'texture-a' };
  const textureB = { id: 'texture-b' };
  const ordinaryTexture = { id: 'ordinary-texture' };
  const records = new Map([
    ['liquid-a', { texture: textureA, failed: false }],
    ['liquid-b', { texture: textureB, failed: false }],
    ['ordinary-stone', { texture: ordinaryTexture, failed: false }]
  ]);
  const boundTextures = [];
  let staticUploads = 0;
  let replacements = 0;
  const gl = {
    ELEMENT_ARRAY_BUFFER: 1,
    TEXTURE0: 2,
    TEXTURE_2D: 3,
    TRIANGLES: 4,
    UNSIGNED_SHORT: 5,
    bindBuffer() {},
    uniformMatrix4fv() {},
    uniform3f() {},
    uniform1f() {},
    activeTexture() {},
    bindTexture(_target, texture) { boundTextures.push(texture); },
    drawElements() {},
    bufferData() { staticUploads += 1; }
  };
  const logicalAnimatedGroup = {
    materialKey: 'animated-liquid', projection: 'world', startIndex: 0, indexCount: 3
  };
  const ordinaryGroup = {
    materialKey: 'ordinary-stone', projection: 'world', startIndex: 3, indexCount: 3
  };
  const installedMesh = {
    vertexBuffer: { id: 'vertices' },
    indexBuffer: { id: 'indices' },
    groups: [logicalAnimatedGroup, ordinaryGroup]
  };
  const host = Object.create(WebGLRendererHost.prototype);
  Object.assign(host, {
    gl,
    meshBuffers: installedMesh,
    materialAnimations: new Map([['animated-liquid', {
      materialKey: 'animated-liquid', frames: ['liquid-a', 'liquid-b'], frameDurationSeconds: 0.25
    }]]),
    textureRegistry: { get: (key) => records.get(key) ?? null },
    attributeLocations: {},
    uniformLocations: {
      viewProjection: {}, cameraPosition: {}, cameraYaw: {}, useTexture: {}, skyProjection: {}
    },
    setupVertexAttributes() {},
    replaceStaticMesh() { replacements += 1; }
  });
  const camera = { x: 0, y: 0, z: 1, yaw: 0 };
  const viewProjection = new Float32Array(16);

  host.drawStaticWorld(viewProjection, camera, 0);
  assert.deepEqual(boundTextures, [textureA, ordinaryTexture]);
  boundTextures.length = 0;

  host.drawStaticWorld(viewProjection, camera, 0.25);
  assert.deepEqual(boundTextures, [textureB, ordinaryTexture]);
  assert.equal(host.meshBuffers, installedMesh);
  assert.equal(host.meshBuffers.groups[0], logicalAnimatedGroup);
  assert.equal(logicalAnimatedGroup.materialKey, 'animated-liquid');
  assert.equal(replacements, 0);
  assert.equal(staticUploads, 0);
});
