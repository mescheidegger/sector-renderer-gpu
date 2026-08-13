/**
 * Module: Shared seam-geometry math helpers for epsilon comparisons, interval slicing, edge keys, and tiny inward offsets.
 */
export const GEOMETRY_EPSILON = 1e-6;
export const SHARED_SOLID_SURFACE_OFFSET = 5e-3;

/** Compares two floating-point values using an epsilon tolerance. */
export function nearlyEqual(a, b, epsilon = GEOMETRY_EPSILON) {
  return Math.abs(a - b) <= epsilon;
}

/** Subtracts one interval from a list of intervals and returns remaining spans. */
export function subtractInterval(intervals, removeStart, removeEnd, epsilon = GEOMETRY_EPSILON) {
  if (!(removeEnd > removeStart + epsilon)) {
    return intervals;
  }

  const next = [];
  for (const [start, end] of intervals) {
    const overlapStart = Math.max(start, removeStart);
    const overlapEnd = Math.min(end, removeEnd);

    if (!(overlapEnd > overlapStart + epsilon)) {
      next.push([start, end]);
      continue;
    }

    if (overlapStart > start + epsilon) {
      next.push([start, overlapStart]);
    }
    if (end > overlapEnd + epsilon) {
      next.push([overlapEnd, end]);
    }
  }

  return next;
}

/** Quantizes a coordinate for stable seam key generation. */
export function quantizeCoordinate(value, epsilon = GEOMETRY_EPSILON) {
  return Math.round(value / epsilon);
}

/** Builds an order-independent seam key for two 2D points. */
export function makeNormalizedEdgeKey(a, b) {
  const ax = quantizeCoordinate(a.x);
  const ay = quantizeCoordinate(a.y);
  const bx = quantizeCoordinate(b.x);
  const by = quantizeCoordinate(b.y);

  const left = `${ax},${ay}`;
  const right = `${bx},${by}`;
  return left <= right ? `${left}|${right}` : `${right}|${left}`;
}

/** Removes near-duplicate sorted numeric values using epsilon. */
export function dedupeSortedValues(values, epsilon = GEOMETRY_EPSILON) {
  const sorted = [...values].sort((a, b) => a - b);
  const deduped = [];

  for (const value of sorted) {
    if (!deduped.length || Math.abs(value - deduped[deduped.length - 1]) > epsilon) {
      deduped.push(value);
    }
  }

  return deduped;
}

/**
 * Builds a normalized infinite-line descriptor + key for collinear seam grouping.
 *
 * Important:
 * This is for grouping / interval detection only.
 * Emitted render geometry should still be sliced from the original authored wall segment.
 */
export function makeCollinearLineKey(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);

  if (!(length > GEOMETRY_EPSILON)) {
    return null;
  }

  let ux = dx / length;
  let uy = dy / length;

  // Canonicalize direction so reversed authored walls land in the same line group.
  if (ux < -GEOMETRY_EPSILON || (Math.abs(ux) <= GEOMETRY_EPSILON && uy < 0)) {
    ux = -ux;
    uy = -uy;
  }

  const nx = -uy;
  const ny = ux;
  const offset = (nx * a.x) + (ny * a.y);

  return {
    ux,
    uy,
    nx,
    ny,
    offset,
    key: `${quantizeCoordinate(ux)},${quantizeCoordinate(uy)},${quantizeCoordinate(offset)}`
  };
}

export function projectPointToLineParameter(point, line) {
  return (point.x * line.ux) + (point.y * line.uy);
}

/**
 * Reconstructs a point from a normalized line parameter.
 *
 * Prefer slicing from original authored wall entries for render geometry.
 * This helper is safe for diagnostics / math, but should not own emitted wall endpoints.
 */
export function pointOnLineFromParameter(line, t) {
  const baseX = line.nx * line.offset;
  const baseY = line.ny * line.offset;

  return {
    x: baseX + (line.ux * t),
    y: baseY + (line.uy * t)
  };
}

/** Computes the average center of a sector polygon. */
export function computeSectorCentroid(vertices) {
  if (!Array.isArray(vertices) || vertices.length === 0) {
    return { x: 0, y: 0 };
  }

  let sumX = 0;
  let sumY = 0;

  for (const vertex of vertices) {
    sumX += vertex.x;
    sumY += vertex.y;
  }

  return {
    x: sumX / vertices.length,
    y: sumY / vertices.length
  };
}

/** Returns signed sector-side distance relative to a normalized line. */
export function computeSectorSideForLine(sector, line) {
  const centroid = computeSectorCentroid(sector.vertices);
  return ((line.nx * centroid.x) + (line.ny * centroid.y)) - line.offset;
}

/** Offsets a wall segment slightly toward sector interior to avoid surface overlap. */
export function offsetWallTowardsSectorInterior(entry, distance) {
  const a = entry.intervalSegment?.a ?? entry.a;
  const b = entry.intervalSegment?.b ?? entry.b;

  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);

  if (!(length > GEOMETRY_EPSILON) || !(distance > 0)) {
    return { a, b };
  }

  const midX = (a.x + b.x) * 0.5;
  const midY = (a.y + b.y) * 0.5;
  const centroid = computeSectorCentroid(entry.sector.vertices);

  const leftNormalX = -dy / length;
  const leftNormalY = dx / length;
  const toCenterX = centroid.x - midX;
  const toCenterY = centroid.y - midY;
  const normalSign = ((leftNormalX * toCenterX) + (leftNormalY * toCenterY)) >= 0 ? 1 : -1;

  const offsetX = leftNormalX * normalSign * distance;
  const offsetY = leftNormalY * normalSign * distance;

  return {
    a: { x: a.x + offsetX, y: a.y + offsetY },
    b: { x: b.x + offsetX, y: b.y + offsetY }
  };
}