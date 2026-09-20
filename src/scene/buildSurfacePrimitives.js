/**
 * Module: Builds floor and ceiling primitive batches per sector from triangulated polygon data.
 */
import { triangulateSectorPolygon } from '../mesh/triangulateSectorPolygon.js';
import { getContainedSolidSpan } from '../containedSolidSpan.js';
import { deriveSurfaceColor } from '../materials/surfaceColor.js';
import { resolveSectorSurfaceMaterial } from '../materials/gpuMaterials.js';
import { resolveSectorLightLevel } from './sectorLighting.js';

const SURFACE_Z_EPSILON = 0.0001;

function buildSurfacePrimitive(sector, kind, triangleIndices, options = {}) {
  if (!Array.isArray(triangleIndices) || triangleIndices.length === 0) {
    return null;
  }

  const z = options.z ?? (kind === 'floor' ? sector.floor : sector.ceil);
  if (typeof z !== 'number' || !Number.isFinite(z)) {
    return null;
  }

  const material = options.materialKey === undefined
    ? resolveSectorSurfaceMaterial(sector, kind)
    : (options.materialKey ? { key: options.materialKey, surfaceType: kind } : null);
  const projection = kind === 'ceiling' ? sector.ceilingProjection ?? 'world' : 'world';
  const lightLevel = resolveSectorLightLevel(sector);
  const uvOrigin = kind === 'floor' ? sector.floorUvOrigin ?? null : null;

  const triangles = triangleIndices
    .map(([aIndex, bIndex, cIndex], triangleIndex) => {
      const a = sector.vertices[aIndex];
      const b = sector.vertices[bIndex];
      const c = sector.vertices[cIndex];
      if (!a || !b || !c) {
        return null;
      }

      return {
        id: `${sector.id}-${options.idSuffix ?? kind}-tri-${triangleIndex}`,
        kind,
        sectorId: sector.id,
        color: deriveSurfaceColor(sector, kind),
        material,
        projection,
        uvOrigin,
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
    id: `${sector.id}-${options.idSuffix ?? kind}`,
    kind,
    sectorId: sector.id,
    z,
    color: deriveSurfaceColor(sector, kind),
    material,
    projection,
    uvOrigin,
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
    const containedSpan = parent && sector.solidBottomZ !== undefined
      ? getContainedSolidSpan({ parentSector: parent, childSector: sector })
      : null;
    const floorMatchesParent = parent && Math.abs((sector.floor ?? 0) - (parent.floor ?? 0)) <= SURFACE_Z_EPSILON;
    const includesFloor = !excludeFloorSectorIds.has(sector.id) && (options.includeFloor?.(sector) ?? true);
    const expectsFloor = includesFloor && !floorMatchesParent;
    const expectsCeiling = (options.includeCeilings ?? true) && !parent;
    const expectsUnderside = (options.includeCeilings ?? true) && containedSpan &&
      containedSpan.topZ > containedSpan.bottomZ + SURFACE_Z_EPSILON;
    if (!expectsFloor && !expectsCeiling && !expectsUnderside) continue;
    const triangleIndices = triangulateSectorPolygon(sector.vertices);
    if ((expectsFloor || expectsCeiling || expectsUnderside) && triangleIndices.length === 0) {
      throw new Error(
        `[SectorRenderer] Sector "${sector.id}" polygon could not be triangulated. ` +
        'Vertices must form a non-degenerate simple polygon.'
      );
    }
    const floorPrimitive = !expectsFloor
      ? null
      : buildSurfacePrimitive(sector, 'floor', triangleIndices);
    const ceilingPrimitive = !expectsCeiling
      ? null
      : buildSurfacePrimitive(sector, 'ceiling', triangleIndices);
    const undersidePrimitive = !expectsUnderside
      ? null
      : buildSurfacePrimitive(sector, 'ceiling', triangleIndices, {
        z: containedSpan.bottomZ,
        materialKey: sector.solidBottomMaterial,
        idSuffix: 'underside'
      });

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

    if (undersidePrimitive) {
      ceilings.push(undersidePrimitive);
      stats.ceilingPrimitives += 1;
      stats.ceilingTriangles += undersidePrimitive.triangles.length;
    }
  }

  return {
    floors,
    ceilings,
    stats
  };
}
