const DEFAULT_MATERIALS = Object.freeze({
  wall: 'wall-a',
  floor: 'floor-a',
  ceiling: 'ceiling-a'
});

function makeWalls(count, wallMaterial, portals = {}) {
  return Array.from({ length: count }, (_, index) => ({
    a: index,
    b: (index + 1) % count,
    color: 0xffffff,
    material: wallMaterial,
    portalTo: portals[index] ?? null
  }));
}

export function rectangularSector({
  id,
  x0,
  x1,
  y0 = 0,
  y1 = 4,
  floor = 0,
  ceil = 6,
  lightLevel = 0.75,
  wallMaterial = DEFAULT_MATERIALS.wall,
  floorMaterial = DEFAULT_MATERIALS.floor,
  ceilingMaterial = DEFAULT_MATERIALS.ceiling,
  portals = {}
}) {
  const vertices = [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 }
  ];

  return {
    id,
    floor,
    ceil,
    lightLevel,
    floorMaterial,
    ceilingMaterial,
    vertices,
    walls: makeWalls(vertices.length, wallMaterial, portals)
  };
}

export function singleSectorMap(overrides = {}) {
  return {
    sectors: [rectangularSector({ id: 'room', x0: 0, x1: 4, ...overrides })]
  };
}

export function connectedSectorMap({
  leftFloor = 0,
  leftCeil = 6,
  rightFloor = 0,
  rightCeil = 6,
  reciprocal = true
} = {}) {
  const left = rectangularSector({
    id: 'left',
    x0: 0,
    x1: 4,
    floor: leftFloor,
    ceil: leftCeil,
    wallMaterial: 'wall-a',
    floorMaterial: 'floor-a',
    ceilingMaterial: 'ceiling-a',
    portals: { 1: 'right' }
  });
  const right = rectangularSector({
    id: 'right',
    x0: 4,
    x1: 8,
    floor: rightFloor,
    ceil: rightCeil,
    wallMaterial: 'wall-b',
    floorMaterial: 'floor-b',
    ceilingMaterial: 'ceiling-b',
    portals: reciprocal ? { 3: 'left' } : {}
  });

  return { sectors: [left, right] };
}

function makePolygonSector({
  id,
  points,
  reverseWinding,
  reverseSharedWall,
  reorderWalls,
  sharedMaterial,
  wallMaterial,
  lightLevel,
  wallColor,
  uvScale
}) {
  const vertices = (reverseWinding ? [...points].reverse() : points)
    .map(([x, y]) => ({ x, y }));
  const walls = makeWalls(vertices.length, wallMaterial);
  let sharedWallIndex = walls.findIndex(({ a, b }) => {
    const endpoints = [vertices[a], vertices[b]];
    return endpoints.every(({ x, y }) => x === 2 && (y === 2 || y === 4));
  });
  walls[sharedWallIndex] = {
    ...walls[sharedWallIndex],
    material: sharedMaterial,
    color: wallColor,
    uvScale
  };
  if (reverseSharedWall) {
    const wall = walls[sharedWallIndex];
    walls[sharedWallIndex] = { ...wall, a: wall.b, b: wall.a };
  }
  if (reorderWalls) {
    walls.reverse();
    sharedWallIndex = walls.length - 1 - sharedWallIndex;
  }

  return {
    id,
    floor: 0,
    ceil: 6,
    lightLevel,
    floorMaterial: `${id}-floor`,
    ceilingMaterial: `${id}-ceiling`,
    vertices,
    walls,
    sharedWallIndex
  };
}

/** Exact C-shaped sector and rectangular notch neighbor used by seam regressions. */
export function concaveSharedSolidMap({
  reverseWinding = false,
  reverseSharedWall = false,
  reorderWalls = false
} = {}) {
  const concave = makePolygonSector({
    id: 'concave',
    points: [[0, 0], [6, 0], [6, 2], [2, 2], [2, 4], [6, 4], [6, 6], [0, 6]],
    reverseWinding,
    reverseSharedWall,
    reorderWalls,
    sharedMaterial: 'concave-side',
    wallMaterial: 'concave-exterior',
    lightLevel: 0.35,
    wallColor: 0x123456,
    uvScale: 2
  });
  const notch = makePolygonSector({
    id: 'notch',
    points: [[2, 2], [6, 2], [6, 4], [2, 4]],
    reverseWinding,
    reverseSharedWall,
    reorderWalls,
    sharedMaterial: 'notch-side',
    wallMaterial: 'notch-exterior',
    lightLevel: 0.65,
    wallColor: 0xabcdef,
    uvScale: 3
  });

  return {
    sectors: [concave, notch],
    sharedWallIndices: {
      concave: concave.sharedWallIndex,
      notch: notch.sharedWallIndex
    }
  };
}
