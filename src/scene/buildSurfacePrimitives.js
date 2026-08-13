/**
 * Module: Builds floor and ceiling primitive batches per sector from triangulated polygon data.
 */
import { triangulateSectorPolygon } from '../mesh/triangulateSectorPolygon.js';
import { deriveSurfaceColor } from '../materials/surfaceColor.js';
import { resolveSectorSurfaceMaterial } from '../materials/gpuMaterials.js';
import { resolveSectorLightLevel } from './sectorLighting.js';

const SURFACE_Z_EPSILON = 0.0001;

function buildSurfacePrimitive(sector, kind, triangleIndices) {
  if (!Array.isArray(triangleIndices) || triangleIndices.length === 0) {
    return null;
  }

  const z = kind === 'floor' ? sector.floor : sector.ceil;
  if (typeof z !== 'number' || !Number.isFinite(z)) {
    return null;
  }

  const material = resolveSectorSurfaceMaterial(sector, kind);
  const lightLevel = resolveSectorLightLevel(sector);

  const triangles = triangleIndices
    .map(([aIndex, bIndex, cIndex], triangleIndex) => {
      const a = sector.vertices[aIndex];
      const b = sector.vertices[bIndex];
      const c = sector.vertices[cIndex];
      if (!a || !b || !c) {
        return null;
      }

      return {
        id: `${sector.id}-${kind}-tri-${triangleIndex}`,
        kind,
        sectorId: sector.id,
        color: deriveSurfaceColor(sector, kind),
        material,
        lightLevel,
        vertices: [
          { x: a.x, y: a.y, z },
          { x: b.x, y: b.y, z },
          { x: c.x, y: c.y, z }
        ]
      };
    })
    .filter(Boolean);

  if (triangles.length === 0) {
    return null;
  }

  return {
    id: `${sector.id}-${kind}`,
    kind,
    sectorId: sector.id,
    z,
    color: deriveSurfaceColor(sector, kind),
    material,
    lightLevel,
    triangles
  };
}

/** Builds floor and ceiling primitive collections for every sector in the map. */
export function buildSurfacePrimitives(map, options = {}) {
  const sectorById = new Map((map.sectors ?? []).map((sector) => [sector.id, sector]));
  const excludeFloorSectorIds = options.excludeFloorSectorIds ?? new Set();
  const floors = [];
  const ceilings = [];
  const stats = {
    floorPrimitives: 0,
    ceilingPrimitives: 0,
    floorTriangles: 0,
    ceilingTriangles: 0
  };

  for (const sector of map.sectors) {
    const parent = sector.parentSectorId != null ? sectorById.get(sector.parentSectorId) : null;
    const floorMatchesParent = parent && Math.abs((sector.floor ?? 0) - (parent.floor ?? 0)) <= SURFACE_Z_EPSILON;
    const expectsFloor = !excludeFloorSectorIds.has(sector.id) && !floorMatchesParent;
    const expectsCeiling = !parent;
    const triangleIndices = triangulateSectorPolygon(sector.vertices);
    if ((expectsFloor || expectsCeiling) && triangleIndices.length === 0) {
      throw new Error(
        `[SectorRenderer] Sector "${sector.id}" polygon could not be triangulated. ` +
        'Vertices must form a non-degenerate simple polygon.'
      );
    }
    const floorPrimitive = excludeFloorSectorIds.has(sector.id) || floorMatchesParent
      ? null
      : buildSurfacePrimitive(sector, 'floor', triangleIndices);
    const ceilingPrimitive = parent
      ? null
      : buildSurfacePrimitive(sector, 'ceiling', triangleIndices);

    if (floorPrimitive) {
      floors.push(floorPrimitive);
      stats.floorPrimitives += 1;
      stats.floorTriangles += floorPrimitive.triangles.length;
    }

    if (ceilingPrimitive) {
      ceilings.push(ceilingPrimitive);
      stats.ceilingPrimitives += 1;
      stats.ceilingTriangles += ceilingPrimitive.triangles.length;
    }
  }

  return {
    floors,
    ceilings,
    stats
  };
}
