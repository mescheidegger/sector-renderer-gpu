/**
 * Module: Normalizes caller-supplied material keys into renderer material records.
 * Material keys are opaque identifiers; texture availability is owned by the texture provider.
 */

function createMaterial(key, surfaceType) {
  if (!key) {
    return null;
  }

  return { key, surfaceType };
}

/** Preserves an authored wall material key without validating it against an asset catalog. */
export function resolveWallMaterial(wall) {
  return createMaterial(wall?.material, 'wall');
}

/** Preserves an authored floor or ceiling material key without asset-catalog lookup. */
export function resolveSectorSurfaceMaterial(sector, kind) {
  const key = kind === 'floor' ? sector?.floorMaterial : sector?.ceilingMaterial;
  return createMaterial(key, kind);
}
