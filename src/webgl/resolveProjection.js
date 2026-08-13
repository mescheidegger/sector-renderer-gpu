/** @type {Readonly<{fovY:number,near:number,far:number}>} Default perspective values; fovY is radians. */
export const DEFAULT_PROJECTION = Object.freeze({
  fovY: Math.PI / 3,
  near: 0.1,
  far: 160
});

/** Applies the default perspective values while preserving caller overrides. */
export function resolveProjection(projection = {}) {
  if (!projection || typeof projection !== 'object') throw new TypeError('[SectorRenderer] projection must be an object.');
  const resolved = {
    fovY: projection.fovY ?? DEFAULT_PROJECTION.fovY,
    near: projection.near ?? DEFAULT_PROJECTION.near,
    far: projection.far ?? DEFAULT_PROJECTION.far
  };
  if (!Number.isFinite(resolved.fovY) || resolved.fovY <= 0 || resolved.fovY >= Math.PI) throw new RangeError('[SectorRenderer] projection.fovY must be finite, greater than 0, and less than Math.PI.');
  if (!Number.isFinite(resolved.near) || resolved.near <= 0) throw new RangeError('[SectorRenderer] projection.near must be finite and greater than 0.');
  if (!Number.isFinite(resolved.far) || resolved.far <= resolved.near) throw new RangeError('[SectorRenderer] projection.far must be finite and greater than near.');
  return resolved;
}
