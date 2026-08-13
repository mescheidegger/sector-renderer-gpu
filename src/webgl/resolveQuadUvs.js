/**
 * Resolves atlas-aware quad UVs. Explicit UVs are caller-owned and bypass flips.
 * Corner order is top-left, top-right, bottom-right, bottom-left.
 */
export function resolveQuadUvs({
  uvRect = { u0: 0, v0: 0, u1: 1, v1: 1 },
  uvs = null,
  flipX = false,
  flipV = false
} = {}) {
  if (Array.isArray(uvs) && uvs.length === 4) {
    return uvs;
  }

  const uLeft = flipX ? uvRect.u1 : uvRect.u0;
  const uRight = flipX ? uvRect.u0 : uvRect.u1;
  const vTop = flipV ? uvRect.v0 : uvRect.v1;
  const vBottom = flipV ? uvRect.v1 : uvRect.v0;

  return [
    [uLeft, vTop],
    [uRight, vTop],
    [uRight, vBottom],
    [uLeft, vBottom]
  ];
}
