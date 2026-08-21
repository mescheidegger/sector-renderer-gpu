import assert from 'node:assert/strict';
import test from 'node:test';
import * as api from '../src/index.js';
import { resolveProjection, DEFAULT_PROJECTION } from '../src/webgl/resolveProjection.js';
import { createTextureRegistry } from '../src/webgl/textures/createTextureRegistry.js';
import { buildGpuScene } from '../src/buildGpuScene.js';
import { buildStaticMeshFromGpuScene } from '../src/webgl/mesh/buildStaticMeshFromGpuScene.js';

const sector = (id = 1) => ({
  id,
  floor: 0,
  ceil: 3,
  vertices: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 2 }],
  walls: [{ a: 0, b: 1 }]
});
const world = (extra = {}) => ({ sectors: [sector()], ...extra });

test('public barrel exposes only the deliberate consumer API', () => {
  assert.deepEqual(Object.keys(api).sort(), ['DEFAULT_PROJECTION','SectorRenderer','assertRendererFrame','assertRendererTextureRecord','assertRendererWorld','assertTextureProvider'].sort());
  assert.equal('createApp' in api, false);
});

test('renderer world boundary validates IDs and references', () => {
  const validWorld = world();
  assert.equal(api.assertRendererWorld(validWorld), validWorld);
  assert.throws(() => api.assertRendererWorld({ sectors: [sector(1), sector(1)] }), /duplicate/);
  assert.throws(() => api.assertRendererWorld({ sectors: [sector(1), sector('1')] }), /collides/);
  assert.throws(() => api.assertRendererWorld(world({ dynamicSectorIds: [2] })), /Unknown dynamic/);
  assert.throws(() => api.assertRendererWorld(world({ dynamicSectorIds: ['1'] })), /Unknown dynamic/);
  assert.throws(() => api.assertRendererWorld(world({ dynamicSectorIds: [1, 1] })), /Duplicate dynamic/);
  assert.throws(() => api.assertRendererWorld(world({ portalOpenings: [{}] })), /invalid wallRef/);
  assert.throws(() => api.assertRendererWorld(world({ portalOpenings: [{ wallRef: { sectorId: 2, wallIndex: 0 } }] })), /unknown sector/);
  assert.throws(() => api.assertRendererWorld(world({ portalOpenings: [{ wallRef: { sectorId: '1', wallIndex: 0 } }] })), /unknown sector/);
  assert.throws(() => api.assertRendererWorld(world({ portalOpenings: [{ wallRef: { sectorId: 1, wallIndex: 1 } }] })), /out of range/);
  const ref = { wallRef: { sectorId: 1, wallIndex: 0 } };
  assert.throws(() => api.assertRendererWorld(world({ portalOpenings: [ref, { ...ref }] })), /Duplicate portal/);
  assert.throws(() => api.assertRendererWorld(world({ portalOpenings: [{ ...ref, trimMaterial: 42 }] })), /trimMaterial.*string/);
  assert.throws(() => api.assertRendererWorld({ sectors: [{ ...sector(), floorMaterial: 42 }] }), /floorMaterial.*string/);
  assert.throws(() => api.assertRendererWorld({ sectors: [{ ...sector(), walls: [{ a: 0, b: 1, material: 42 }] }] }), /material.*string/);
});

test('ceiling projection accepts world and sky, defaults downstream to world, and rejects other values', () => {
  assert.doesNotThrow(() => api.assertRendererWorld({ sectors: [{ ...sector(), ceilingProjection: 'world' }] }));
  assert.doesNotThrow(() => api.assertRendererWorld({ sectors: [{ ...sector(), ceilingProjection: 'sky' }] }));
  assert.throws(
    () => api.assertRendererWorld({ sectors: [{ ...sector(), ceilingProjection: 'screen' }] }),
    /ceilingProjection must be "world" or "sky"/
  );

  const omitted = buildGpuScene({ sectors: [sector()] });
  assert.equal(omitted.ceilings[0].projection, 'world');
  assert.equal(omitted.ceilings[0].triangles[0].projection, 'world');
  const sky = buildGpuScene({ sectors: [{ ...sector(), ceilingProjection: 'sky' }] });
  assert.equal(sky.ceilings[0].projection, 'sky');
  assert.equal(sky.ceilings[0].triangles[0].projection, 'sky');
  assert.equal(sky.floors[0].projection, 'world');
});

test('renderer world boundary validates exact portal and parent sector IDs', () => {
  const target = sector(0);
  const referencing = (overrides) => ({ ...sector('source'), ...overrides });

  assert.doesNotThrow(() => api.assertRendererWorld({
    sectors: [target, referencing({
      parentSectorId: 0,
      walls: [{ a: 0, b: 1, portalTo: 0 }]
    })]
  }));
  assert.throws(
    () => api.assertRendererWorld({ sectors: [target, referencing({ walls: [{ a: 0, b: 1, portalTo: '0' }] })] }),
    /Sector "source" wall 0 portalTo references unknown sector "0"/
  );
  assert.throws(
    () => api.assertRendererWorld({ sectors: [target, referencing({ parentSectorId: '0' })] }),
    /Sector "source" parentSectorId references unknown sector "0"/
  );
});

test('renderer world boundary rejects IDs outside string or finite number', () => {
  for (const id of [{}, [], true, Symbol('sector'), NaN, Infinity]) {
    assert.throws(() => api.assertRendererWorld({ sectors: [sector(id)] }), /id must be a string or finite number/);
  }
  for (const portalTo of [{}, [], true, NaN, Infinity]) {
    assert.throws(
      () => api.assertRendererWorld({ sectors: [sector(0), { ...sector('source'), walls: [{ a: 0, b: 1, portalTo }] }] }),
      /portalTo must be a string or finite number/
    );
  }
  for (const parentSectorId of [{}, [], true, NaN, Infinity]) {
    assert.throws(
      () => api.assertRendererWorld({ sectors: [sector(0), { ...sector('child'), parentSectorId }] }),
      /parentSectorId must be a string or finite number/
    );
  }
});

test('renderer world boundary validates basic sector geometry', () => {
  const withSector = (overrides) => ({ sectors: [{ ...sector('room'), ...overrides }] });

  assert.throws(() => api.assertRendererWorld(withSector({ vertices: [{ x: 0, y: 0 }, { x: 1, y: 1 }] })), /room.*at least 3 vertices/);
  assert.throws(() => api.assertRendererWorld(withSector({ vertices: [{ x: 0, y: 0 }, { x: Infinity, y: 0 }, { x: 0, y: 1 }] })), /room.*vertex 1 x.*finite/);
  assert.throws(() => api.assertRendererWorld(withSector({ vertices: [{ x: 0, y: 0 }, { x: 1, y: NaN }, { x: 0, y: 1 }] })), /room.*vertex 1 y.*finite/);
  assert.throws(() => api.assertRendererWorld(withSector({ vertices: [{ x: 0, y: 0 }, null, { x: 0, y: 1 }] })), /room.*vertex 1.*object/);
  assert.throws(() => api.assertRendererWorld(withSector({ floor: NaN })), /room.*floor.*finite/);
  assert.throws(() => api.assertRendererWorld(withSector({ ceil: Infinity })), /room.*ceil.*finite/);
  assert.throws(() => api.assertRendererWorld(withSector({ floor: 3, ceil: 3 })), /room.*ceil.*greater than floor/);
  assert.throws(() => api.assertRendererWorld(withSector({ floor: 4, ceil: 3 })), /room.*ceil.*greater than floor/);
  assert.throws(() => api.assertRendererWorld(withSector({ walls: [{ a: 0.5, b: 1 }] })), /room.*wall 0 a.*integer/);
  assert.throws(() => api.assertRendererWorld(withSector({ walls: [{ a: 0, b: 8 }] })), /room.*wall 0.*vertex 8.*3 vertices/);
  assert.throws(() => api.assertRendererWorld(withSector({ walls: [{ a: 1, b: 1 }] })), /room.*wall 0.*different vertices/);
});

test('renderer frame boundary validates camera and collections', () => {
  const frame = { camera: { x: 0, y: 0, z: 1, yaw: 0 }, sprites: [], worldQuads: [], overlays: [] };
  assert.equal(api.assertRendererFrame(frame), frame);
  assert.throws(() => api.assertRendererFrame({ camera: { ...frame.camera, yaw: NaN } }), /yaw.*finite/);
  for (const key of ['sprites', 'worldQuads', 'overlays']) assert.throws(() => api.assertRendererFrame({ ...frame, [key]: {} }), new RegExp(`${key} must be an array`));
});

test('renderer frame accepts optional simulation time and rejects invalid time', () => {
  const frame = { camera: { x: 0, y: 0, z: 1, yaw: 0 }, timeSeconds: 1.25 };
  assert.equal(api.assertRendererFrame(frame), frame);
  assert.doesNotThrow(() => api.assertRendererFrame({ camera: frame.camera }));
  assert.throws(() => api.assertRendererFrame({ ...frame, timeSeconds: -1 }), /timeSeconds/);
  assert.throws(() => api.assertRendererFrame({ ...frame, timeSeconds: Infinity }), /timeSeconds/);
});

test('projection validates partial overrides while preserving exact defaults', () => {
  assert.deepEqual(resolveProjection(), DEFAULT_PROJECTION);
  assert.equal(resolveProjection({ near: 1 }).near, 1);
  for (const p of [{ fovY: 0 }, { fovY: Math.PI }, { near: 0 }, { near: -1 }, { far: NaN }, { near: 10, far: 5 }]) assert.throws(() => resolveProjection(p), /projection/);
});

test('renderer texture records validate package fields', () => {
  const image = {};
  const valid = { image, uploadKey: 'atlas', uvRect: { u0: 0, v0: 0, u1: 1, v1: 1 }, width: 1, height: 2, sourceSize: { w: 1, h: 2 } };
  assert.equal(api.assertRendererTextureRecord(valid, 'ok'), valid);
  assert.throws(() => api.assertRendererTextureRecord({ ...valid, uploadKey: '' }), /uploadKey/);
  assert.throws(() => api.assertRendererTextureRecord({ ...valid, uvRect: { ...valid.uvRect, u1: 2 } }), /uvRect/);
  assert.throws(() => api.assertRendererTextureRecord({ ...valid, width: 0 }), /width/);
  assert.throws(() => api.assertRendererTextureRecord({ ...valid, sourceSize: { w: 0, h: 1 } }), /sourceSize/);
});

test('texture registry rejects bad keys and conflicting shared upload images', () => {
  const gl = { getExtension: () => null, deleteTexture() {} };
  assert.throws(() => createTextureRegistry(gl, null, {}), /must return an array/);
  assert.throws(() => createTextureRegistry(gl, ['a', 'a'], {}), /Duplicate texture key/);
  const records = { a: { image: {}, uploadKey: 'same', uvRect: {u0:0,v0:0,u1:1,v1:1}, width:1,height:1 }, b: { image: {}, uploadKey: 'same', uvRect: {u0:0,v0:0,u1:1,v1:1}, width:1,height:1 } };
  const uploadGl = { ...gl, TEXTURE_2D:1, RGBA:2, UNSIGNED_BYTE:3, UNPACK_FLIP_Y_WEBGL:4, TEXTURE_WRAP_S:5, TEXTURE_WRAP_T:6, CLAMP_TO_EDGE:7, TEXTURE_MAG_FILTER:8, TEXTURE_MIN_FILTER:9, NEAREST:10, LINEAR:11, createTexture: () => ({}), bindTexture(){}, pixelStorei(){}, texImage2D(){}, texParameteri(){} };
  assert.throws(() => createTextureRegistry(uploadGl, ['a','b'], { getTexture: key => records[key] }), /different image/);
});

test('static mesh accepts 65535 vertices and rejects the first overflowing triangle', () => {
  const triangle = { vertices: [{x:0,y:0,z:0},{x:1,y:0,z:0},{x:0,y:1,z:0}] };
  const scene = count => ({ walls: [], floors: [{ triangles: Array(count).fill(triangle), material: null }], ceilings: [] });
  assert.equal(buildStaticMeshFromGpuScene(scene(21845)).mesh.indices.length, 65535);
  assert.throws(() => buildStaticMeshFromGpuScene(scene(21846)), /WebGL1 Uint16 index limit/);
});

test('buildGpuScene does not mutate seam debug input', () => {
  const debug = { enabled: true, targetWallRef: { sectorId: 1, wallIndex: 0 } };
  const before = structuredClone(debug);
  buildGpuScene({ sectors: [] }, { seamDebug: debug });
  assert.deepEqual(debug, before);
});

test('failed initialization removes only a renderer-owned canvas', () => {
  const canvas = { style: {}, parentNode: null, getContext: () => null };
  const container = {
    ownerDocument: { createElement: () => canvas },
    appendChild(child) { child.parentNode = this; },
    removeChild(child) { child.parentNode = null; }
  };
  const textureProvider = { getTextureKeys: () => [], getTexture: () => null };
  assert.throws(() => new api.SectorRenderer({ world: { sectors: [] }, container, width: 1, height: 1, textureProvider }), /WebGL/);
  assert.equal(canvas.parentNode, null);

  const callerCanvas = { style: {}, parentNode: container, getContext: () => null };
  assert.throws(() => new api.SectorRenderer({ world: { sectors: [] }, canvas: callerCanvas, width: 1, height: 1, textureProvider }), /WebGL/);
  assert.equal(callerCanvas.parentNode, container);
});

test('floor UV origin accepts finite coordinates and rejects malformed values', () => {
  assert.doesNotThrow(() => api.assertRendererWorld({ sectors: [{ ...sector(), floorUvOrigin: { x: 1.25, y: -2 } }] }));
  for (const floorUvOrigin of [null, {}, { x: 0 }, { x: NaN, y: 0 }, { x: 0, y: Infinity }, [0, 0]]) {
    if (floorUvOrigin === null) continue;
    assert.throws(() => api.assertRendererWorld({ sectors: [{ ...sector(), floorUvOrigin }] }), /floorUvOrigin.*finite x and y/);
  }
});
