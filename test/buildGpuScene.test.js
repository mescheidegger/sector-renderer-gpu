import test from 'node:test';
import assert from 'node:assert/strict';

import { buildGpuScene } from '../src/buildGpuScene.js';
import { assertValidSceneWalls } from './assertGeometry.js';
import {
  concaveSharedSolidMap,
  connectedSectorMap,
  rectangularSector,
  singleSectorMap,
  subdividedPortalMap
} from './fixtures/syntheticMaps.js';

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

test('pairs and inward-offsets both authored sides of a concave shared solid boundary', () => {
  for (const variant of [
    {},
    { reverseWinding: true },
    { reverseSharedWall: true },
    { reorderWalls: true }
  ]) {
    const world = concaveSharedSolidMap(variant);
    const scene = buildGpuScene(world, {
      seamDebug: {
        enabled: true,
        targetWallRef: {
          sectorId: 'concave',
          wallIndex: world.sharedWallIndices.concave
        }
      }
    });
    const sharedSurfaces = scene.walls.filter((wall) =>
      wall.sharedSolidOffset &&
      wall.sourceA.x === 2 && wall.sourceB.x === 2 &&
      Math.min(wall.sourceA.y, wall.sourceB.y) === 2 &&
      Math.max(wall.sourceA.y, wall.sourceB.y) === 4
    );

    assert.equal(scene.seamDebug.seamFound, true);
    assert.deepEqual(
      new Set(scene.seamDebug.participants.map(({ sectorId }) => sectorId)),
      new Set(['concave', 'notch'])
    );
    assert.equal(sharedSurfaces.length, 2);
    assert.equal(new Set(sharedSurfaces.map(({ seamKey }) => seamKey)).size, 1);
    assert.deepEqual(new Set(sharedSurfaces.map(({ ownerSectorId }) => ownerSectorId)), new Set(['concave', 'notch']));
    assert.deepEqual(new Set(sharedSurfaces.map(({ material }) => material?.key)), new Set(['concave-side', 'notch-side']));

    const byOwner = new Map(sharedSurfaces.map((wall) => [wall.ownerSectorId, wall]));
    assert.ok(byOwner.get('concave').x0 < 2 && byOwner.get('concave').x1 < 2);
    assert.ok(byOwner.get('notch').x0 > 2 && byOwner.get('notch').x1 > 2);
    assert.deepEqual(
      {
        color: byOwner.get('concave').color,
        lightLevel: byOwner.get('concave').lightLevel,
        uvScale: byOwner.get('concave').uvScale,
        uvUOffset: byOwner.get('concave').uvUOffset,
        wallIndex: byOwner.get('concave').ownerWallIndex
      },
      { color: 0x123456, lightLevel: 0.35, uvScale: 2, uvUOffset: 0, wallIndex: world.sharedWallIndices.concave }
    );
    assert.deepEqual(
      {
        color: byOwner.get('notch').color,
        lightLevel: byOwner.get('notch').lightLevel,
        uvScale: byOwner.get('notch').uvScale,
        uvUOffset: byOwner.get('notch').uvUOffset,
        wallIndex: byOwner.get('notch').ownerWallIndex
      },
      { color: 0xabcdef, lightLevel: 0.65, uvScale: 3, uvUOffset: 0, wallIndex: world.sharedWallIndices.notch }
    );
    assertValidSceneWalls(sharedSurfaces);
    assert.ok(sharedSurfaces.every((wall) => Math.hypot(wall.x1 - wall.x0, wall.y1 - wall.y0) > 0));
  }
});

test('preserves convex shared-solid materials and opposite inward offsets', () => {
  const left = rectangularSector({ id: 'left', x0: 0, x1: 4, wallMaterial: 'left-side' });
  const right = rectangularSector({ id: 'right', x0: 4, x1: 8, wallMaterial: 'right-side' });
  const scene = buildGpuScene({ sectors: [left, right] });
  const shared = scene.walls.filter((wall) => wall.sharedSolidOffset);

  assert.equal(scene.stats.indexedSharedWallSeams, 1);
  assert.equal(shared.length, 2);
  assert.deepEqual(new Set(shared.map((wall) => wall.material?.key)), new Set(['left-side', 'right-side']));
  assert.ok(shared.find((wall) => wall.ownerSectorId === 'left').x0 < 4);
  assert.ok(shared.find((wall) => wall.ownerSectorId === 'right').x0 > 4);
});

test('keeps local interior direction and UV continuity for a seam sliced from a longer wall', () => {
  const left = {
    ...rectangularSector({ id: 'left', x0: 0, x1: 4, y1: 8 }),
    vertices: [
      { x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 },
      { x: 4, y: 8 }, { x: 0, y: 8 }
    ],
    walls: [{ a: 1, b: 3, material: 'long-side', uvScale: 2 }]
  };
  const right = {
    ...rectangularSector({ id: 'right', x0: 4, x1: 8, y0: 2, y1: 6 }),
    walls: [{ a: 3, b: 0, material: 'short-side', uvScale: 4 }]
  };
  const scene = buildGpuScene({ sectors: [left, right] });
  const shared = scene.walls.filter((wall) => wall.sharedSolidOffset);

  assert.equal(scene.stats.indexedSharedWallSeams, 1);
  assert.equal(shared.length, 2);
  assert.ok(shared.find((wall) => wall.ownerSectorId === 'left').x0 < 4);
  assert.ok(shared.find((wall) => wall.ownerSectorId === 'right').x0 > 4);
  assert.equal(shared.find((wall) => wall.ownerSectorId === 'left').uvUOffset, 2);
  assert.equal(shared.find((wall) => wall.ownerSectorId === 'right').uvUOffset, 0);
  assertValidSceneWalls(shared);
});

test('does not pair unrelated overlapping collinear walls on the same side', () => {
  const first = rectangularSector({ id: 'first', x0: 0, x1: 4 });
  const second = rectangularSector({ id: 'second', x0: 0, x1: 4 });
  first.walls = [first.walls[0]];
  second.walls = [second.walls[0]];
  const scene = buildGpuScene({ sectors: [first, second] }, {
    seamDebug: { enabled: true, targetWallRef: { sectorId: 'first', wallIndex: 0 } }
  });

  assert.equal(scene.stats.indexedSharedWallSeams, 0);
  assert.deepEqual(scene.seamDebug.participants, [{ sectorId: 'first', wallIndex: 0 }]);
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

test('dynamicSectorIds excludes the dynamic floor and walls while preserving static exteriors', () => {
  const world = { ...connectedSectorMap(), dynamicSectorIds: ['right'] };
  const scene = buildGpuScene(world);

  assert.deepEqual(scene.floors.map((floor) => floor.sectorId), ['left']);
  assert.deepEqual(new Set(scene.walls.map((wall) => wall.ownerSectorId)), new Set(['left']));
  assert.deepEqual(new Set(scene.ceilings.map((ceiling) => ceiling.sectorId)), new Set(['left', 'right']));
  assert.equal(scene.walls.length, 3, 'the static sector retains its three exterior walls');
  assert.equal(scene.stats.floorPrimitives, 1);
  assert.equal(scene.stats.ceilingPrimitives, 2);
});

test('a seam touching a dynamic sector contributes no static height-difference bands', () => {
  const world = {
    ...connectedSectorMap({ rightFloor: 2, rightCeil: 5 }),
    dynamicSectorIds: ['right']
  };
  const scene = buildGpuScene(world);

  assert.equal(scene.walls.length, 3, 'only the static sector exterior walls remain');
  assert.equal(scene.walls.some(({ seamParticipants }) =>
    seamParticipants?.some(({ sectorId }) => sectorId === 'right')
  ), false);
  assert.equal(scene.walls.some(({ kind }) => kind === 'portal_lower' || kind === 'portal_upper'), false);
});

test('reciprocal portalLinks delegate the independent static-side seam to the dynamic sector', () => {
  const world = connectedSectorMap({ rightFloor: 2 });
  const leftWall = world.sectors[0].walls[1];
  const rightWall = world.sectors[1].walls[3];
  leftWall.portalTo = null;
  rightWall.portalTo = null;
  leftWall.portalLinks = [{ sectorId: 'right', bottomZ: 2, topZ: 6 }];
  rightWall.portalLinks = [{ sectorId: 'left', bottomZ: 2, topZ: 6 }];
  world.dynamicSectorIds = ['right'];

  const investigated = buildGpuScene(world, {
    seamDebug: { enabled: true, targetWallRef: { sectorId: 'left', wallIndex: 1 } }
  });
  assert.deepEqual(
    investigated.seamDebug.preDedupe.map(({ sectorId, kind, bottomZ, topZ }) => ({ sectorId, kind, bottomZ, topZ })),
    [{ sectorId: 'left', kind: 'portal_lower', bottomZ: 0, topZ: 2 }],
    'the independent static-side wall produces a band before dynamic filtering'
  );
  assert.equal(investigated.walls.some(({ ownerSectorId, ownerWallIndex }) =>
    (ownerSectorId === 'left' && ownerWallIndex === 1) ||
    (ownerSectorId === 'right' && ownerWallIndex === 3)
  ), false, 'neither reciprocal physical wall survives in the static GPU scene');
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

function normalizedPortalTrim(scene) {
  return scene.walls
    .filter((wall) => wall.id.includes('portal-trim'))
    .map((wall) => ({
      x0: wall.x0,
      y0: wall.y0,
      x1: wall.x1,
      y1: wall.y1,
      bottomZ: wall.bottomZ,
      topZ: wall.topZ,
      material: wall.material?.key
    }))
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}

test('portal trim follows physical endpoints across one or many seam subdivisions', () => {
  const unsplit = buildGpuScene(subdividedPortalMap({ subdivisions: 0 }));
  const expectedTrim = normalizedPortalTrim(unsplit);

  assert.equal(expectedTrim.length, 4, 'the two portal-facing sides each retain both physical ends');
  for (const subdivisions of [1, 2]) {
    const scene = buildGpuScene(subdividedPortalMap({ subdivisions }));
    const trim = normalizedPortalTrim(scene);

    assert.deepEqual(trim, expectedTrim, 'authored collinear subdivision must not change trim coverage');
    assert.equal(trim.some(({ y0, y1 }) => Math.min(y0, y1) > 0.2 && Math.max(y0, y1) < 7.8), false);
    assert.ok(trim.every(({ material, bottomZ, topZ }) =>
      material === 'TEST_PORTAL_TRIM' && bottomZ === 1 && topZ === 5
    ));
    assertValidSceneWalls(scene.walls.filter((wall) => wall.id.includes('portal-trim')));
  }

  const debugScene = buildGpuScene(subdividedPortalMap({ subdivisions: 1 }), {
    seamDebug: { enabled: true, targetWallRef: { sectorId: 'left', wallIndex: 1 } }
  });
  const trimDebug = debugScene.seamDebug.seamResolution.portalTrimSurfaceOffset;
  assert.equal(trimDebug.primitiveIds.filter(Boolean).length, 1, 'the internal interval end reports no emitted trim');
  assert.ok(Math.abs(trimDebug.appliedOffsetXY.magnitude - 0.006) < 1e-9);
});

test('portal trim preserves genuine subspan endpoints inside a longer authored wall', () => {
  const left = rectangularSector({ id: 'left', x0: 0, x1: 4, y1: 8 });
  const right = rectangularSector({
    id: 'right',
    x0: 4,
    x1: 8,
    y0: 2,
    y1: 6,
    portals: { 3: 'left' }
  });
  const scene = buildGpuScene({
    sectors: [left, right],
    portalOpenings: [{
      wallRef: { sectorId: 'right', wallIndex: 3 },
      bottomZ: 1,
      topZ: 5,
      trimMaterial: 'PARTIAL_TRIM'
    }]
  });
  const trim = scene.walls.filter((wall) => wall.id.includes('portal-trim'));

  assert.equal(trim.length, 4);
  assert.deepEqual(
    new Set(trim.flatMap(({ y0, y1 }) => [y0, y1])),
    new Set([2, 2.2, 5.8, 6])
  );
  assert.ok(trim.every(({ material }) => material?.key === 'PARTIAL_TRIM'));
  assertValidSceneWalls(trim);
});

test('adjacent portals with different opening semantics retain their shared boundary trim', () => {
  const world = subdividedPortalMap({ subdivisions: 1 });
  world.sectors[0].walls[1].portalTo = null;
  world.portalOpenings = [
    { wallRef: { sectorId: 'right', wallIndex: 3 }, bottomZ: 2, topZ: 5, trimMaterial: 'UPPER_TRIM' },
    { wallRef: { sectorId: 'right', wallIndex: 4 }, bottomZ: 1, topZ: 4, trimMaterial: 'LOWER_TRIM' }
  ];
  const scene = buildGpuScene(world);
  const trim = scene.walls.filter((wall) => wall.id.includes('portal-trim'));
  const internalTrim = trim.filter(({ y0, y1 }) =>
    Math.min(y0, y1) >= 3.8 && Math.max(y0, y1) <= 4.2
  );

  assert.ok(internalTrim.length >= 4, 'dedupe may vertically split trim but must retain both opening ends');
  assert.deepEqual(new Set(internalTrim.map(({ material }) => material?.key)), new Set(['UPPER_TRIM', 'LOWER_TRIM']));
  for (const material of ['UPPER_TRIM', 'LOWER_TRIM']) {
    const materialTrim = internalTrim.filter((wall) => wall.material?.key === material);
    assert.ok(materialTrim.some(({ x0 }) => x0 < 4));
    assert.ok(materialTrim.some(({ x0 }) => x0 > 4));
  }
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
