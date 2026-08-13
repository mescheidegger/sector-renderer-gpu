/**
 * Module: Ear-clipping triangulator that turns a sector polygon into triangles the GPU can render.
 */
const EPSILON = 1e-6;

function polygonSignedArea(vertices) {
  let area = 0;
  const count = vertices.length;
  for (let i = 0; i < count; i += 1) {
    const a = vertices[i];
    const b = vertices[(i + 1) % count];
    area += (a.x * b.y) - (b.x * a.y);
  }
  return area * 0.5;
}

function isConvex(prev, curr, next, windingSign) {
  const cross = ((curr.x - prev.x) * (next.y - curr.y)) - ((curr.y - prev.y) * (next.x - curr.x));
  return (cross * windingSign) > EPSILON;
}

function pointInTriangle(point, a, b, c) {
  const v0x = c.x - a.x;
  const v0y = c.y - a.y;
  const v1x = b.x - a.x;
  const v1y = b.y - a.y;
  const v2x = point.x - a.x;
  const v2y = point.y - a.y;

  const dot00 = (v0x * v0x) + (v0y * v0y);
  const dot01 = (v0x * v1x) + (v0y * v1y);
  const dot02 = (v0x * v2x) + (v0y * v2y);
  const dot11 = (v1x * v1x) + (v1y * v1y);
  const dot12 = (v1x * v2x) + (v1y * v2y);

  const denominator = (dot00 * dot11) - (dot01 * dot01);
  if (Math.abs(denominator) <= EPSILON) {
    return false;
  }

  const inv = 1 / denominator;
  const u = ((dot11 * dot02) - (dot01 * dot12)) * inv;
  const v = ((dot00 * dot12) - (dot01 * dot02)) * inv;

  return u >= -EPSILON && v >= -EPSILON && (u + v) <= (1 + EPSILON);
}

function hasPointInEar(vertices, active, prevIndex, currIndex, nextIndex) {
  const a = vertices[prevIndex];
  const b = vertices[currIndex];
  const c = vertices[nextIndex];

  for (let i = 0; i < active.length; i += 1) {
    const candidate = active[i];
    if (candidate === prevIndex || candidate === currIndex || candidate === nextIndex) {
      continue;
    }
    if (pointInTriangle(vertices[candidate], a, b, c)) {
      return true;
    }
  }

  return false;
}

/** Triangulates a simple polygon so floors/ceilings can be rendered as triangles. */
export function triangulateSectorPolygon(vertices) {
  if (!Array.isArray(vertices) || vertices.length < 3) {
    return [];
  }

  const signedArea = polygonSignedArea(vertices);
  if (Math.abs(signedArea) <= EPSILON) {
    return [];
  }

  const windingSign = signedArea > 0 ? 1 : -1;
  const active = Array.from({ length: vertices.length }, (_, index) => index);
  const triangles = [];
  let guard = 0;
  const guardLimit = vertices.length * vertices.length;

  while (active.length > 3 && guard < guardLimit) {
    let earFound = false;

    for (let i = 0; i < active.length; i += 1) {
      const prevIndex = active[(i - 1 + active.length) % active.length];
      const currIndex = active[i];
      const nextIndex = active[(i + 1) % active.length];

      if (!isConvex(vertices[prevIndex], vertices[currIndex], vertices[nextIndex], windingSign)) {
        continue;
      }

      if (hasPointInEar(vertices, active, prevIndex, currIndex, nextIndex)) {
        continue;
      }

      triangles.push([prevIndex, currIndex, nextIndex]);
      active.splice(i, 1);
      earFound = true;
      break;
    }

    if (!earFound) {
      return [];
    }

    guard += 1;
  }

  if (active.length === 3) {
    triangles.push([active[0], active[1], active[2]]);
  }

  return triangles;
}
