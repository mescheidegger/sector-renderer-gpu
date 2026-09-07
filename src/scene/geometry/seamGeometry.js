/**
 * Module: Shared seam-geometry math helpers for epsilon comparisons, interval slicing, edge keys, and tiny inward offsets.
 */
export const GEOMETRY_EPSILON = 1e-6;
export const SHARED_SOLID_SURFACE_OFFSET = 5e-3;
export const MAX_WALL_STITCH_DISTANCE = Math.max(SHARED_SOLID_SURFACE_OFFSET * 4, GEOMETRY_EPSILON * 16);

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

function polygonWindingSign(vertices) {
  let twiceArea = 0;
  for (let index = 0; index < vertices.length; index += 1) {
    const current = vertices[index];
    const next = vertices[(index + 1) % vertices.length];
    twiceArea += (current.x * next.y) - (next.x * current.y);
  }
  return twiceArea > 0 ? 1 : twiceArea < 0 ? -1 : 0;
}

function signedDistanceToLine(point, line) {
  return ((line.nx * point.x) + (line.ny * point.y)) - line.offset;
}

function nearestOffLineDistance(vertices, startIndex, step, line) {
  for (let offset = 0; offset < vertices.length; offset += 1) {
    const index = (startIndex + (offset * step) + vertices.length) % vertices.length;
    const distance = Math.abs(signedDistanceToLine(vertices[index], line));
    if (distance > GEOMETRY_EPSILON) {
      return distance;
    }
  }
  return Number.POSITIVE_INFINITY;
}

/**
 * Resolves which canonical side of a wall line contains the sector interior.
 *
 * The ordered polygon ring is authoritative: for each traversal edge covered by
 * the authored wall, a counter-clockwise polygon is interior-left and a
 * clockwise polygon is interior-right. This stays local to the boundary even
 * when a concave polygon's center lies across the wall's infinite line.
 */
export function computeWallInteriorSide(sector, wall, line) {
  const vertices = sector?.vertices;
  const wallA = vertices?.[wall?.a];
  const wallB = vertices?.[wall?.b];
  if (!Array.isArray(vertices) || vertices.length < 3 || !wallA || !wallB || !line) {
    return { sign: 0, distance: 0 };
  }

  const windingSign = polygonWindingSign(vertices);
  if (windingSign === 0) {
    return { sign: 0, distance: 0 };
  }

  const wallT0 = Math.min(
    projectPointToLineParameter(wallA, line),
    projectPointToLineParameter(wallB, line)
  );
  const wallT1 = Math.max(
    projectPointToLineParameter(wallA, line),
    projectPointToLineParameter(wallB, line)
  );
  let interiorSign = 0;
  let localDistance = Number.POSITIVE_INFINITY;

  for (let index = 0; index < vertices.length; index += 1) {
    const edgeA = vertices[index];
    const edgeB = vertices[(index + 1) % vertices.length];
    if (
      Math.abs(signedDistanceToLine(edgeA, line)) > GEOMETRY_EPSILON ||
      Math.abs(signedDistanceToLine(edgeB, line)) > GEOMETRY_EPSILON
    ) {
      continue;
    }

    const edgeT0 = projectPointToLineParameter(edgeA, line);
    const edgeT1 = projectPointToLineParameter(edgeB, line);
    const overlapStart = Math.max(wallT0, Math.min(edgeT0, edgeT1));
    const overlapEnd = Math.min(wallT1, Math.max(edgeT0, edgeT1));
    if (!(overlapEnd > overlapStart + GEOMETRY_EPSILON)) {
      continue;
    }

    const traversalDelta = edgeT1 - edgeT0;
    if (Math.abs(traversalDelta) <= GEOMETRY_EPSILON) {
      continue;
    }

    const edgeInteriorSign = windingSign * Math.sign(traversalDelta);
    if (interiorSign !== 0 && edgeInteriorSign !== interiorSign) {
      return { sign: 0, distance: 0 };
    }
    interiorSign = edgeInteriorSign;

    // Preserve a local magnitude for deterministic ambiguous-pair scoring. Its
    // sign comes from topology, not from where these neighboring vertices lie.
    localDistance = Math.min(
      localDistance,
      nearestOffLineDistance(vertices, index - 1, -1, line),
      nearestOffLineDistance(vertices, index + 2, 1, line)
    );
  }

  if (interiorSign === 0) {
    return { sign: 0, distance: 0 };
  }

  const magnitude = Number.isFinite(localDistance) ? localDistance : 0;
  return {
    sign: interiorSign,
    distance: interiorSign * magnitude
  };
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

  const interiorSide = entry.sideSign || computeWallInteriorSide(entry.sector, entry.wall, entry.line).sign;
  if (interiorSide === 0 || !entry.line) {
    return { a, b };
  }

  const offsetX = entry.line.nx * interiorSide * distance;
  const offsetY = entry.line.ny * interiorSide * distance;

  return {
    a: { x: a.x + offsetX, y: a.y + offsetY },
    b: { x: b.x + offsetX, y: b.y + offsetY }
  };
}
