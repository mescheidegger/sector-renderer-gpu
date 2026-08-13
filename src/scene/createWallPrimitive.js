/**
 * Module: Normalizes one wall span into a consistent primitive record consumed by later mesh packing steps.
 */
import { resolveWallMaterial } from '../materials/gpuMaterials.js';
import { resolveSectorLightLevel } from './sectorLighting.js';

/** Creates a normalized wall primitive object for one vertical wall span. */
export function createWallPrimitive({
  sector,
  wall,
  index,
  a,
  b,
  kind,
  bottomZ,
  topZ,
  backSector,
  owner,
  seamKey,
  seamParticipants,
  spanIdSuffix,
  segment,
  uvUOffset
}) {
  if (!(topZ > bottomZ)) {
    return null;
  }

  const resolvedSegment = segment ?? owner?.intervalSegment ?? null;
  const wallStart = resolvedSegment?.a ?? a;
  const wallEnd = resolvedSegment?.b ?? b;
  const resolvedUvUOffset = uvUOffset ?? owner?.intervalLocalStart ?? 0;

  return {
    id: `${sector.id}-wall-${index}-${kind}${spanIdSuffix ? `-${spanIdSuffix}` : ''}`,
    kind,
    sectorId: sector.id,
    wallIndex: index,
    x0: wallStart.x,
    y0: wallStart.y,
    x1: wallEnd.x,
    y1: wallEnd.y,
    uvUOffset: resolvedUvUOffset,
    bottomZ,
    topZ,
    color: wall.color ?? 0xffffff,
    lightLevel: resolveSectorLightLevel(sector),
    material: resolveWallMaterial(wall),
    uvScale: Number.isFinite(wall.uvScale) && wall.uvScale > 0 ? wall.uvScale : null,
    portalTo: wall.portalTo ?? null,
    backSectorId: backSector?.id ?? null,
    backSectorFloor: backSector?.floor ?? null,
    backSectorCeil: backSector?.ceil ?? null,
    ownerSectorId: owner?.sector?.id ?? sector.id,
    ownerWallIndex: owner?.index ?? index,
    seamKey: seamKey ?? null,
    seamParticipants: seamParticipants ?? null
  };
}
