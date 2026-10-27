/**
 * Module: Packs GPU scene primitives into vertex/index buffers grouped by material for efficient static drawing.
 */
import { buildSceneQuads } from '../../mesh/buildSceneQuads.js';

/** Builds packed static mesh buffers and stats from GPU scene primitives. */
export function buildStaticMeshFromGpuScene(gpuScene) {
  const vertices = [];
  const groupLookup = new Map();
  const unpackedGroups = [];
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

  const getGroup = (material, fallbackColor, surfaceType, projection = 'world', cullBackFaces = false) => {
    const materialKey = material?.key ?? null;
    let projectionGroups = groupLookup.get(materialKey);
    if (!projectionGroups) {
      projectionGroups = new Map();
      groupLookup.set(materialKey, projectionGroups);
    }
    let surfaceGroups = projectionGroups.get(projection);
    if (!surfaceGroups) {
      surfaceGroups = new Map();
      projectionGroups.set(projection, surfaceGroups);
    }
    const surfaceKey = `${surfaceType}:${cullBackFaces}`;
    if (!surfaceGroups.has(surfaceKey)) {
      const group = {
        materialKey,
        surfaceType,
        projection,
        ...(cullBackFaces ? { cullBackFaces: true } : {}),
        fallbackColor,
        indices: []
      };
      surfaceGroups.set(surfaceKey, group);
      unpackedGroups.push(group);
    }

    return surfaceGroups.get(surfaceKey);
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

  const pushTriangle = ({ a, b, c, uvA, uvB, uvC, color, kind, material, projection = 'world', cullBackFaces = false }) => {
    if (nextIndex + 2 > 65535) {
      throw new RangeError(`[SectorRenderer] Static mesh exceeds the WebGL1 Uint16 index limit (vertex count ${nextIndex + 3}; maximum index 65535 / vertex capacity 65536).`);
    }
    const group = getGroup(material, color, kind, projection, cullBackFaces);

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

  for (const quad of buildSceneQuads(gpuScene)) {
    const indices = quad.surfaceType === 'wall' ? [[0, 1, 2], [0, 2, 3]] : [[0, 1, 2]];
    for (const [ia, ib, ic] of indices) {
      const position = (index) => {
        const [x, y, z] = quad.corners[index];
        return { x, y, z, lightLevel: quad.lightLevel };
      };
      const uv = (index) => ({ u: quad.uvs[index][0], v: quad.uvs[index][1] });
      pushTriangle({
        a: position(ia), b: position(ib), c: position(ic),
        uvA: uv(ia), uvB: uv(ib), uvC: uv(ic),
        color: quad.color,
        kind: quad.surfaceType,
        material: quad.textureKey ? { key: quad.textureKey } : null,
        projection: quad.projection,
        cullBackFaces: quad.cullBackFaces
      });
    }
  }

  const groups = [];
  const packedIndices = [];

  for (const group of unpackedGroups) {
    const startIndex = packedIndices.length;
    packedIndices.push(...group.indices);

    groups.push({
      materialKey: group.materialKey,
      surfaceType: group.surfaceType,
      projection: group.projection,
      ...(group.cullBackFaces ? { cullBackFaces: true } : {}),
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
