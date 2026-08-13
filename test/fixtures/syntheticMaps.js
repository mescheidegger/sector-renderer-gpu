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
