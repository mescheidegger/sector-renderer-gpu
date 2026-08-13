/**
 * Module: Removes duplicate coplanar wall spans (with Z/XY splitting when needed) to avoid double-rendering shared surfaces.
 */
import { GEOMETRY_EPSILON, nearlyEqual, subtractInterval } from './geometry/seamGeometry.js';

function primitiveSortKey(primitive) {
  return `${primitive.sectorId}:${primitive.wallIndex}:${primitive.kind}:${primitive.id}`;
}

function rangesOverlap(a0, a1, b0, b1) {
  return !(a1 <= b0 + GEOMETRY_EPSILON || b1 <= a0 + GEOMETRY_EPSILON);
}

function computeZOverlap(owner, candidate) {
  if (!rangesOverlap(owner.bottomZ, owner.topZ, candidate.bottomZ, candidate.topZ)) {
    return null;
  }
  return [
    Math.max(owner.bottomZ, candidate.bottomZ),
    Math.min(owner.topZ, candidate.topZ)
  ];
}

function areCoplanarXY(owner, candidate) {
  const ownerDx = owner.x1 - owner.x0;
  const ownerDy = owner.y1 - owner.y0;
  const ownerLength = Math.hypot(ownerDx, ownerDy);
  if (!(ownerLength > GEOMETRY_EPSILON)) return false;

  const candidateDx = candidate.x1 - candidate.x0;
  const candidateDy = candidate.y1 - candidate.y0;

  const directionCross = (ownerDx * candidateDy) - (ownerDy * candidateDx);
  if (!nearlyEqual(directionCross, 0)) return false;

  const toStartX = candidate.x0 - owner.x0;
  const toStartY = candidate.y0 - owner.y0;
  const toEndX = candidate.x1 - owner.x0;
  const toEndY = candidate.y1 - owner.y0;

  const startCross = (ownerDx * toStartY) - (ownerDy * toStartX);
  const endCross = (ownerDx * toEndY) - (ownerDy * toEndX);

  return nearlyEqual(startCross, 0) && nearlyEqual(endCross, 0);
}

function splitPrimitiveByZ(primitive, zStart, zEnd) {
  const parts = [];

  // bottom slice
  if (primitive.bottomZ < zStart - GEOMETRY_EPSILON) {
    parts.push({
      ...primitive,
      id: `${primitive.id}-z-bottom`,
      bottomZ: primitive.bottomZ,
      topZ: zStart
    });
  }

  // overlap slice
  parts.push({
    ...primitive,
    id: `${primitive.id}-z-mid`,
    bottomZ: zStart,
    topZ: zEnd
  });

  // top slice
  if (primitive.topZ > zEnd + GEOMETRY_EPSILON) {
    parts.push({
      ...primitive,
      id: `${primitive.id}-z-top`,
      bottomZ: zEnd,
      topZ: primitive.topZ
    });
  }

  return parts;
}

/** Removes duplicate coplanar wall spans to prevent z-fighting and wasted triangles. */
export function dedupeCoplanarWallPrimitives(wallPrimitives) {
  const sorted = [...wallPrimitives].sort((a, b) =>
    primitiveSortKey(a).localeCompare(primitiveSortKey(b))
  );

  const deduped = [];
  const stats = {
    coplanarChecks: 0,
    overlapCandidates: 0,
    overlapIntervalsSubtracted: 0,
    duplicatePrimitivesSkipped: 0,
    splitPrimitivesCreated: 0
  };

  for (const primitive of sorted) {
    const dx = primitive.x1 - primitive.x0;
    const dy = primitive.y1 - primitive.y0;
    const length = Math.hypot(dx, dy);

    if (!(length > GEOMETRY_EPSILON)) {
      stats.duplicatePrimitivesSkipped++;
      continue;
    }

    const ux = dx / length;
    const uy = dy / length;

    let workingSet = [primitive];

    for (const owner of deduped) {
      const nextSet = [];

      for (const part of workingSet) {
        stats.coplanarChecks++;

        if (owner.kind !== part.kind) {
          nextSet.push(part);
          continue;
        }

        if (!areCoplanarXY(owner, part)) {
          nextSet.push(part);
          continue;
        }

        const zOverlap = computeZOverlap(owner, part);
        if (!zOverlap) {
          nextSet.push(part);
          continue;
        }

        stats.overlapCandidates++;

        const [zStart, zEnd] = zOverlap;

        // split by Z first
        const zParts = splitPrimitiveByZ(part, zStart, zEnd);

        for (const zPart of zParts) {
          // only subtract XY for overlapping Z slice
          if (zPart.bottomZ >= zStart - GEOMETRY_EPSILON &&
              zPart.topZ <= zEnd + GEOMETRY_EPSILON) {

            let remaining = [[0, Math.hypot(zPart.x1 - zPart.x0, zPart.y1 - zPart.y0)]];

            const ownerStartT =
              ((owner.x0 - zPart.x0) * ux) +
              ((owner.y0 - zPart.y0) * uy);

            const ownerEndT =
              ((owner.x1 - zPart.x0) * ux) +
              ((owner.y1 - zPart.y0) * uy);

            const overlapStart = Math.max(0, Math.min(ownerStartT, ownerEndT));
            const overlapEnd = Math.min(length, Math.max(ownerStartT, ownerEndT));

            if (overlapEnd > overlapStart + GEOMETRY_EPSILON) {
              remaining = subtractInterval(remaining, overlapStart, overlapEnd);
              stats.overlapIntervalsSubtracted++;
            }

            for (let i = 0; i < remaining.length; i++) {
              const [start, end] = remaining[i];
              if (!(end > start + GEOMETRY_EPSILON)) continue;

              nextSet.push({
                ...zPart,
                id: `${zPart.id}-xy-${i}`,
                x0: zPart.x0 + ux * start,
                y0: zPart.y0 + uy * start,
                x1: zPart.x0 + ux * end,
                y1: zPart.y0 + uy * end,
                uvUOffset: (zPart.uvUOffset ?? 0) + start
              });
            }
          } else {
            // non-overlapping Z slice stays intact
            nextSet.push(zPart);
          }
        }
      }

      workingSet = nextSet;
      if (workingSet.length === 0) break;
    }

    deduped.push(...workingSet);
  }

  return {
    walls: deduped,
    stats
  };
}
