import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertRendererFrame,
  assertRendererTextureRecord,
  assertRendererWorld,
  assertTextureProvider
} from '../src/index.js';

test('README Hello Room data satisfies the public runtime contracts', () => {
  const checker = {};
  const textureRecord = {
    image: checker,
    uploadKey: 'checker-image',
    uvRect: { u0: 0, v0: 0, u1: 1, v1: 1 },
    width: 64,
    height: 64,
    sourceSize: { w: 64, h: 64 }
  };
  const textureProvider = {
    getTextureKeys: () => ['checker'],
    getTexture: (key) => key === 'checker' ? textureRecord : null
  };
  const vertices = [
    { x: -4, y: -3 }, { x: 4, y: -3 },
    { x: 4, y: 3 }, { x: -4, y: 3 }
  ];
  const world = {
    sectors: [{
      id: 'room', vertices,
      walls: [
        { a: 0, b: 1, material: 'checker' },
        { a: 1, b: 2, material: 'checker' },
        { a: 2, b: 3, material: 'checker' },
        { a: 3, b: 0, material: 'checker' }
      ],
      floor: 0, ceil: 3,
      floorMaterial: 'checker', ceilingMaterial: 'checker', lightLevel: 1
    }],
    dynamicSectorIds: [], portalOpenings: []
  };
  const frame = { camera: { x: 0, y: -1, z: 1.6, yaw: 0 } };

  assert.equal(assertTextureProvider(textureProvider), textureProvider);
  assert.deepEqual(textureProvider.getTextureKeys(), ['checker']);
  assert.equal(assertRendererTextureRecord(textureProvider.getTexture('checker'), 'checker'), textureRecord);
  assert.equal(assertRendererWorld(world), world);
  assert.equal(assertRendererFrame(frame), frame);
});
