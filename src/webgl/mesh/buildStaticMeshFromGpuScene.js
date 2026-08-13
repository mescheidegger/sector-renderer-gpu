/**
 * Module: Packs GPU scene primitives into vertex/index buffers grouped by material for efficient static drawing.
 */
const WALL_UV_SCALE = 1;
const WALL_HEIGHT_UV_SCALE = 1;
const PLANAR_UV_SCALE = 1;

function unpackColor(colorHex) {
  const r = ((colorHex >> 16) & 0xff) / 255;
  const g = ((colorHex >> 8) & 0xff) / 255;
  const b = (colorHex & 0xff) / 255;
  return [r, g, b, 1];
}

function getGroupKey(material) {
  return material?.key ?? '__fallback_flat__';
}

/** Builds packed static mesh buffers and stats from GPU scene primitives. */
export function buildStaticMeshFromGpuScene(gpuScene) {
  const vertices = [];
  const groupIndexMap = new Map();
  const materialSets = {
    wall: new Set(),
    floor: new Set(),
    ceiling: new Set()
  };

  let nextIndex = 0;

  const stats = {
    wallTriangles: 0,
    floorTriangles: 0,
    ceilingTriangles: 0,
    wallMaterialCount: 0,
    floorMaterialCount: 0,
    ceilingMaterialCount: 0,
    vertexCount: 0,
    indexCount: 0,
    texturedGroupCount: 0
  };

  const getGroup = (material, fallbackColor, surfaceType) => {
    const groupKey = getGroupKey(material);
    if (!groupIndexMap.has(groupKey)) {
      groupIndexMap.set(groupKey, {
        materialKey: material?.key ?? null,
        surfaceType,
        fallbackColor,
        indices: []
      });
    }

    return groupIndexMap.get(groupKey);
  };

  const pushVertex = (position, uv, color, lightLevel) => {
    vertices.push(
      position.x,
      position.y,
      position.z,
      uv.u,
      uv.v,
      color[0],
      color[1],
      color[2],
      color[3],
      lightLevel
    );
  };

  const pushTriangle = ({ a, b, c, uvA, uvB, uvC, color, kind, material }) => {
    if (nextIndex + 2 > 65535) {
      throw new RangeError(`[SectorRenderer] Static mesh exceeds the WebGL1 Uint16 index limit (vertex count ${nextIndex + 3}; maximum index 65535 / vertex capacity 65536).`);
    }
    const group = getGroup(material, color, kind);

    const lightLevel = typeof a.lightLevel === 'number' ? a.lightLevel : 1;
    pushVertex(a, uvA, color, lightLevel);
    pushVertex(b, uvB, color, lightLevel);
    pushVertex(c, uvC, color, lightLevel);

    group.indices.push(nextIndex, nextIndex + 1, nextIndex + 2);
    nextIndex += 3;

    if (kind === 'wall') stats.wallTriangles += 1;
    if (kind === 'floor') stats.floorTriangles += 1;
    if (kind === 'ceiling') stats.ceilingTriangles += 1;

    if (material?.key) {
      materialSets[kind].add(material.key);
    }
  };

  for (const wall of gpuScene.walls) {
    const color = unpackColor(wall.color ?? 0xffffff);
    const lightLevel = wall.lightLevel ?? 1;
    const length = Math.hypot(wall.x1 - wall.x0, wall.y1 - wall.y0);
    const uvScale = Number.isFinite(wall.uvScale) && wall.uvScale > 0 ? wall.uvScale : WALL_UV_SCALE;
    const uStart = wall.uvUStart ?? ((wall.uvUOffset ?? 0) / uvScale);
    const uEnd = wall.uvUEnd ?? (((wall.uvUOffset ?? 0) + length) / uvScale);
    const vBottom = wall.bottomZ / WALL_HEIGHT_UV_SCALE;
    const vTop = wall.topZ / WALL_HEIGHT_UV_SCALE;

    const leftBottom = { x: wall.x0, y: wall.y0, z: wall.bottomZ, lightLevel };
    const rightBottom = { x: wall.x1, y: wall.y1, z: wall.bottomZ, lightLevel };
    const rightTop = { x: wall.x1, y: wall.y1, z: wall.topZ, lightLevel };
    const leftTop = { x: wall.x0, y: wall.y0, z: wall.topZ, lightLevel };

    pushTriangle({
      a: leftBottom,
      b: rightBottom,
      c: rightTop,
      uvA: { u: uStart, v: vBottom },
      uvB: { u: uEnd, v: vBottom },
      uvC: { u: uEnd, v: vTop },
      color,
      kind: 'wall',
      material: wall.material
    });

    pushTriangle({
      a: leftBottom,
      b: rightTop,
      c: leftTop,
      uvA: { u: uStart, v: vBottom },
      uvB: { u: uEnd, v: vTop },
      uvC: { u: uStart, v: vTop },
      color,
      kind: 'wall',
      material: wall.material
    });
  }

  for (const floor of gpuScene.floors) {
    const color = unpackColor(floor.color ?? 0x7f7f7f);
    for (const tri of floor.triangles) {
      const [baseA, baseB, baseC] = tri.vertices;
      const a = { ...baseA, lightLevel: floor.lightLevel ?? 1 };
      const b = { ...baseB, lightLevel: floor.lightLevel ?? 1 };
      const c = { ...baseC, lightLevel: floor.lightLevel ?? 1 };
      pushTriangle({
        a,
        b,
        c,
        uvA: { u: a.x / PLANAR_UV_SCALE, v: a.y / PLANAR_UV_SCALE },
        uvB: { u: b.x / PLANAR_UV_SCALE, v: b.y / PLANAR_UV_SCALE },
        uvC: { u: c.x / PLANAR_UV_SCALE, v: c.y / PLANAR_UV_SCALE },
        color,
        kind: 'floor',
        material: floor.material
      });
    }
  }

  for (const ceiling of gpuScene.ceilings) {
    const color = unpackColor(ceiling.color ?? 0xa0a0a0);
    for (const tri of ceiling.triangles) {
      const [baseA, baseB, baseC] = tri.vertices;
      const a = { ...baseA, lightLevel: ceiling.lightLevel ?? 1 };
      const b = { ...baseB, lightLevel: ceiling.lightLevel ?? 1 };
      const c = { ...baseC, lightLevel: ceiling.lightLevel ?? 1 };
      pushTriangle({
        a,
        b: c,
        c: b,
        uvA: { u: a.x / PLANAR_UV_SCALE, v: a.y / PLANAR_UV_SCALE },
        uvB: { u: c.x / PLANAR_UV_SCALE, v: c.y / PLANAR_UV_SCALE },
        uvC: { u: b.x / PLANAR_UV_SCALE, v: b.y / PLANAR_UV_SCALE },
        color,
        kind: 'ceiling',
        material: ceiling.material
      });
    }
  }

  const groups = [];
  const packedIndices = [];

  for (const group of groupIndexMap.values()) {
    const startIndex = packedIndices.length;
    packedIndices.push(...group.indices);

    groups.push({
      materialKey: group.materialKey,
      surfaceType: group.surfaceType,
      fallbackColor: group.fallbackColor,
      startIndex,
      indexCount: group.indices.length
    });
  }

  stats.wallMaterialCount = materialSets.wall.size;
  stats.floorMaterialCount = materialSets.floor.size;
  stats.ceilingMaterialCount = materialSets.ceiling.size;
  stats.texturedGroupCount = groups.filter((group) => Boolean(group.materialKey)).length;
  stats.vertexCount = vertices.length / 10;
  stats.indexCount = packedIndices.length;

  return {
    mesh: {
      vertices: new Float32Array(vertices),
      indices: new Uint16Array(packedIndices),
      groups
    },
    stats
  };
}
