/** Final surface attributes shared by static mesh packing and world quads. */
const WALL_UV_SCALE = 1;
const WALL_HEIGHT_UV_SCALE = 1;
const PLANAR_UV_SCALE = 1;

function unpackColor(color) {
  return [((color >> 16) & 0xff) / 255, ((color >> 8) & 0xff) / 255, (color & 0xff) / 255, 1];
}

function attributes(primitive, surfaceType, defaultColor) {
  return {
    textureKey: primitive.material?.key ?? null,
    color: unpackColor(primitive.color ?? defaultColor),
    lightLevel: primitive.lightLevel ?? 1,
    surfaceType,
    projection: primitive.projection ?? 'world'
  };
}

export function* buildSceneQuads(scene) {
  for (const wall of scene.walls) {
    const length = Math.hypot(wall.x1 - wall.x0, wall.y1 - wall.y0);
    const uvScale = Number.isFinite(wall.uvScale) && wall.uvScale > 0 ? wall.uvScale : WALL_UV_SCALE;
    const uStart = wall.uvUStart ?? ((wall.uvUOffset ?? 0) / uvScale);
    const uEnd = wall.uvUEnd ?? (((wall.uvUOffset ?? 0) + length) / uvScale);
    const vBottom = wall.bottomZ / WALL_HEIGHT_UV_SCALE;
    const vTop = wall.topZ / WALL_HEIGHT_UV_SCALE;
    yield {
      ...attributes(wall, 'wall', 0xffffff),
      corners: [
        [wall.x0, wall.y0, wall.bottomZ],
        [wall.x1, wall.y1, wall.bottomZ],
        [wall.x1, wall.y1, wall.topZ],
        [wall.x0, wall.y0, wall.topZ]
      ],
      uvs: [[uStart, vBottom], [uEnd, vBottom], [uEnd, vTop], [uStart, vTop]]
    };
  }

  for (const [surfaces, kind, defaultColor] of [
    [scene.floors, 'floor', 0x7f7f7f],
    [scene.ceilings, 'ceiling', 0xa0a0a0]
  ]) {
    for (const surface of surfaces) {
      for (const triangle of surface.triangles) {
        const [a, originalB, originalC] = triangle.vertices;
        const cross = (originalB.x - a.x) * (originalC.y - a.y) - (originalB.y - a.y) * (originalC.x - a.x);
        const reverse = kind === 'ceiling' ? cross >= 0 : cross < 0;
        const b = reverse ? originalC : originalB;
        const c = reverse ? originalB : originalC;
        const origin = kind === 'floor' ? surface.uvOrigin : null;
        yield {
          ...attributes(surface, kind, defaultColor),
          corners: [a, b, c, c].map(({ x, y, z }) => [x, y, z]),
          uvs: [a, b, c, c].map(({ x, y }) => [
            (x - (origin?.x ?? 0)) / PLANAR_UV_SCALE,
            (y - (origin?.y ?? 0)) / PLANAR_UV_SCALE
          ])
        };
      }
    }
  }
}
