import { prepareSceneGeometry, buildSceneGeometry } from './buildGpuScene.js';
import { buildSceneQuads } from './mesh/buildSceneQuads.js';

/**
 * Prepare generic replacement geometry for world.dynamicSectorIds. The caller
 * owns motion and supplies a Map of current absolute floor heights. Topology,
 * ceilings, materials and dynamic IDs must remain fixed; recreate on world changes.
 * @param {import('./contracts.js').SectorRenderWorld} world
 * @returns {(floorZBySectorId?: Map<string|number, number>) => import('./contracts.js').RendererWorldQuad[]}
 */
export function createDynamicSectorWorldQuads(world) {
  const prepared = prepareSceneGeometry(world);
  let previousHeights = null;
  let quads = [];
  return (floorZBySectorId = new Map()) => {
    if (previousHeights && previousHeights.size === floorZBySectorId.size &&
      [...floorZBySectorId].every(([id, floor]) => previousHeights.get(id) === floor)) return quads;

    quads = [...buildSceneQuads(buildSceneGeometry(prepared, { dynamic: true, floorZBySectorId }))];
    previousHeights = new Map(floorZBySectorId);
    return quads;
  };
}
