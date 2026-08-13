import test from 'node:test';
import assert from 'node:assert/strict';

import { buildGpuScene } from '../src/buildGpuScene.js';
import { assertValidSceneWalls } from './assertGeometry.js';
import { connectedSectorMap, singleSectorMap } from './fixtures/syntheticMaps.js';

test('compiles one rectangular sector with walls, surfaces, materials, and light', () => {
  const scene = buildGpuScene(singleSectorMap());

  assert.equal(scene.sectors, 1);
  assert.equal(scene.walls.length, 4);
  assert.equal(scene.floors.length, 1);
  assert.equal(scene.ceilings.length, 1);
  assert.deepEqual(scene.stats, {
    ...scene.stats,
    authoredWalls: 4,
    indexedWallSeams: 4,
    indexedSharedWallSeams: 0,
    solidWallPrimitives: 4,
    floorPrimitives: 1,
    ceilingPrimitives: 1,
    floorTriangles: 2,
    ceilingTriangles: 2
  });
  assert.deepEqual(new Set(scene.walls.map((wall) => wall.material?.key)), new Set(['wall-a']));
  assert.equal(scene.floors[0].material.key, 'floor-a');
  assert.equal(scene.ceilings[0].material.key, 'ceiling-a');
  assert.equal(scene.floors[0].lightLevel, 0.75);
  assertValidSceneWalls(scene.walls);
});

test('builds simple polygons with either winding and with concavity', () => {
  const polygons = [
    [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }, { x: 0, y: 3 }],
    [{ x: 0, y: 3 }, { x: 4, y: 3 }, { x: 4, y: 0 }, { x: 0, y: 0 }],
    [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }, { x: 2, y: 1 }, { x: 0, y: 3 }]
  ];

  for (const [index, vertices] of polygons.entries()) {
    const base = singleSectorMap().sectors[0];
    const scene = buildGpuScene({ sectors: [{
      ...base,
      id: `polygon-${index}`,
      vertices,
      walls: vertices.map((_, vertexIndex) => ({ a: vertexIndex, b: (vertexIndex + 1) % vertices.length }))
    }] });
    assert.equal(scene.floors[0].triangles.length, vertices.length - 2);
    assert.equal(scene.ceilings[0].triangles.length, vertices.length - 2);
  }
});

test('reports the sector when a structurally valid polygon cannot be triangulated', () => {
  const base = singleSectorMap().sectors[0];
  const vertices = [
    { x: 0, y: 0 }, { x: 3, y: 3 }, { x: 0, y: 3 }, { x: 3, y: 0 }
  ];
  const world = { sectors: [{
    ...base,
    id: 'crossed-room',
    vertices,
    walls: vertices.map((_, index) => ({ a: index, b: (index + 1) % vertices.length }))
  }] };

  assert.throws(
    () => buildGpuScene(world),
    (error) => /crossed-room/.test(error.message) && /could not be triangulated/.test(error.message) && /simple polygon/.test(error.message)
  );
});

test('preserves arbitrary caller-supplied material keys as opaque identifiers', () => {
  const scene = buildGpuScene(singleSectorMap({
    wallMaterial: 'TEST_CUSTOM_WALL',
    floorMaterial: 'TEST_CUSTOM_FLOOR',
    ceilingMaterial: 'TEST_CUSTOM_CEILING'
  }));

  assert.deepEqual(scene.walls[0].material, {
    key: 'TEST_CUSTOM_WALL',
    surfaceType: 'wall'
  });
  assert.deepEqual(scene.floors[0].material, {
    key: 'TEST_CUSTOM_FLOOR',
    surfaceType: 'floor'
  });
  assert.deepEqual(scene.ceilings[0].material, {
    key: 'TEST_CUSTOM_CEILING',
    surfaceType: 'ceiling'
  });
});

test('compiles absent and null material keys as untextured primitives', () => {
  const map = singleSectorMap({ wallMaterial: null, floorMaterial: null });
  delete map.sectors[0].ceilingMaterial;

  const scene = buildGpuScene(map);

  assert.ok(scene.walls.every((wall) => wall.material === null));
  assert.equal(scene.floors[0].material, null);
  assert.equal(scene.ceilings[0].material, null);
  assertValidSceneWalls(scene.walls);
});

test('compiles a reciprocal shared boundary as one fully open portal', () => {
  const scene = buildGpuScene(connectedSectorMap());

  assert.equal(scene.stats.authoredWalls, 8);
  assert.equal(scene.stats.indexedWallSeams, 7);
  assert.equal(scene.stats.indexedSharedWallSeams, 1);
  assert.equal(scene.stats.portalWallsProcessed, 1);
  assert.equal(scene.stats.portalOpeningsEmitted, 1);
  assert.equal(scene.stats.fullyOpenPortalsSkipped, 1);
  assert.equal(scene.stats.upperBandPrimitives, 0);
  assert.equal(scene.stats.lowerBandPrimitives, 0);
  assert.equal(scene.walls.length, 6, 'only the six exterior walls remain');
  assert.equal(scene.walls.filter((wall) => wall.seamParticipants?.length === 2).length, 0);
});

test('emits lower and upper bands around a height-difference portal', () => {
  const scene = buildGpuScene(connectedSectorMap({ rightFloor: 2, rightCeil: 5 }));
  const portalBands = scene.walls.filter((wall) => wall.kind.startsWith('portal_'));

  assert.equal(scene.stats.portalWallsProcessed, 1);
  assert.equal(scene.stats.portalOpeningsEmitted, 1);
  assert.equal(scene.stats.lowerBandPrimitives, 1);
  assert.equal(scene.stats.upperBandPrimitives, 1);
  assert.equal(scene.stats.fullyOpenPortalsSkipped, 0);
  assert.deepEqual(
    portalBands.map(({ kind, bottomZ, topZ }) => ({ kind, bottomZ, topZ })),
    [
      { kind: 'portal_lower', bottomZ: 0, topZ: 2 },
      { kind: 'portal_upper', bottomZ: 5, topZ: 6 }
    ]
  );
  assertValidSceneWalls(portalBands);
});

test('dynamicSectorIds excludes the dynamic sector floor and owned walls only', () => {
  const world = { ...connectedSectorMap(), dynamicSectorIds: ['right'] };
  const scene = buildGpuScene(world);

  assert.deepEqual(scene.floors.map((floor) => floor.sectorId), ['left']);
  assert.deepEqual(new Set(scene.walls.map((wall) => wall.ownerSectorId)), new Set(['left']));
  assert.deepEqual(new Set(scene.ceilings.map((ceiling) => ceiling.sectorId)), new Set(['left', 'right']));
  assert.equal(scene.walls.length, 3, 'the static sector retains its three exterior walls');
  assert.equal(scene.stats.floorPrimitives, 1);
  assert.equal(scene.stats.ceilingPrimitives, 2);
});

test('generic portal opening bounds emit lower and upper bands around the open region', () => {
  const world = {
    ...connectedSectorMap(),
    portalOpenings: [{ wallRef: { sectorId: 'left', wallIndex: 1 }, bottomZ: 1, topZ: 5 }]
  };
  const scene = buildGpuScene(world);
  const bands = scene.walls.filter((wall) => wall.kind.startsWith('portal_'));

  assert.deepEqual(
    bands.map(({ kind, bottomZ, topZ }) => ({ kind, bottomZ, topZ })),
    [
      { kind: 'portal_lower', bottomZ: 0, topZ: 1 },
      { kind: 'portal_upper', bottomZ: 5, topZ: 6 }
    ]
  );
});

test('generic portal trim preserves material, opening bounds, and finite geometry', () => {
  const world = {
    ...connectedSectorMap(),
    portalOpenings: [{
      wallRef: { sectorId: 'left', wallIndex: 1 },
      bottomZ: 1,
      topZ: 5,
      trimMaterial: 'TEST_PORTAL_TRIM'
    }]
  };
  const scene = buildGpuScene(world);
  const trim = scene.walls.filter((wall) => wall.id.includes('portal-trim'));

  assert.equal(trim.length, 4);
  assert.ok(trim.every((wall) => wall.material?.key === 'TEST_PORTAL_TRIM'));
  assert.ok(trim.every((wall) => wall.bottomZ === 1 && wall.topZ === 5));
  assertValidSceneWalls(trim);
});

test('parentSectorId supports the numeric zero ID', () => {
  const parent = singleSectorMap().sectors[0];
  parent.id = 0;
  const child = {
    ...structuredClone(parent),
    id: 'child',
    parentSectorId: 0,
    vertices: parent.vertices.map(({ x, y }) => ({ x: x * 0.5, y: y * 0.5 }))
  };

  const scene = buildGpuScene({ sectors: [parent, child] });

  assert.equal(scene.floors.length, 1);
  assert.equal(scene.ceilings.length, 1);
  assert.equal(scene.floors[0].sectorId, 0);
  assert.equal(scene.ceilings[0].sectorId, 0);
});

test('single-sided portal resolves the numeric zero sector ID', () => {
  const source = singleSectorMap().sectors[0];
  source.id = 'source';
  source.walls = source.walls.map((wall, index) => index === 0 ? { ...wall, portalTo: 0 } : wall);
  const target = structuredClone(source);
  target.id = 0;
  target.floor = 1;
  target.ceil = 2;
  target.vertices = target.vertices.map(({ x, y }) => ({ x: x + 10, y }));
  target.walls = target.walls.map(({ portalTo, ...wall }) => wall);

  const scene = buildGpuScene({ sectors: [source, target] });
  const portalBands = scene.walls.filter((wall) => wall.ownerSectorId === 'source' && wall.kind.startsWith('portal_'));

  assert.equal(scene.stats.portalWallsProcessed, 1);
  assert.equal(scene.stats.portalOpeningsEmitted, 1);
  assert.deepEqual(
    portalBands.map(({ kind, bottomZ, topZ, backSectorId }) => ({ kind, bottomZ, topZ, backSectorId })),
    [
      { kind: 'portal_lower', bottomZ: 0, topZ: 1, backSectorId: 0 },
      { kind: 'portal_upper', bottomZ: 2, topZ: 6, backSectorId: 0 }
    ]
  );
  assertValidSceneWalls(portalBands);
});
