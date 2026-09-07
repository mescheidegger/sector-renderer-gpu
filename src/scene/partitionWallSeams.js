import { GEOMETRY_EPSILON, SHARED_SOLID_SURFACE_OFFSET, MAX_WALL_STITCH_DISTANCE } from './geometry/seamGeometry.js';
import { PORTAL_TRIM_SURFACE_OFFSET } from './resolveWallPrimitivesFromSeams.js';

/**
 * Keep interacting seams in the same static/dynamic batch. Height changes can
 * expose previously absent spans, so dependency discovery uses XY topology,
 * not just the primitives visible at the initial height.
 */
export function partitionWallSeams(seamWallsByKey, dynamicSectorIds) {
  const dynamicSeamKeys = new Set();
  if (!dynamicSectorIds.size) return dynamicSeamKeys;

  const seams = [...seamWallsByKey].map(([key, entries]) => {
    const [first, second] = entries;
    const sharedSolid = Boolean(second &&
      first.wall.portalTo !== second.sector.id && second.wall.portalTo !== first.sector.id);
    const segment = first.intervalSegment;
    return { key, entries, segment, sharedSolid };
  });
  const dependencies = seams.map(() => []);
  const touchesDynamic = ({ sector, wall }) =>
    dynamicSectorIds.has(sector.id) || dynamicSectorIds.has(sector.parentSectorId) ||
    dynamicSectorIds.has(wall.portalTo) ||
    wall.portalLinks?.some(({ sectorId }) => dynamicSectorIds.has(sectorId));

  // Portal trim and shared-solid offsets can place parallel primitives slightly
  // off their authored line. This conservative envelope also covers end caps
  // and stitched corners; it does not alter any emitted geometry.
  const margin = 2 * Math.max(PORTAL_TRIM_SURFACE_OFFSET, SHARED_SOLID_SURFACE_OFFSET + MAX_WALL_STITCH_DISTANCE);
  const nearSegment = (point, a, b) => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(point.x - a.x - dx * t, point.y - a.y - dy * t) <= margin;
  };
  const canInteract = (left, right) => {
    const { a, b } = left.segment;
    const { a: c, b: d } = right.segment;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const ux = (b.x - a.x) / length;
    const uy = (b.y - a.y) / length;
    const cAlong = (c.x - a.x) * ux + (c.y - a.y) * uy;
    const dAlong = (d.x - a.x) * ux + (d.y - a.y) * uy;
    const cAcross = (c.x - a.x) * uy - (c.y - a.y) * ux;
    const dAcross = (d.x - a.x) * uy - (d.y - a.y) * ux;
    const overlaps = Math.min(length, Math.max(cAlong, dAlong)) - Math.max(0, Math.min(cAlong, dAlong)) > GEOMETRY_EPSILON;
    if (overlaps && Math.abs(cAcross) <= margin && Math.abs(dAcross) <= margin) return true;

    // Only offset solid seams have corner stitching/end caps. Ordinary portal
    // corners do not couple their adjacent exterior walls.
    if (left.sharedSolid && (nearSegment(a, c, d) || nearSegment(b, c, d))) return true;
    if (right.sharedSolid && (nearSegment(c, a, b) || nearSegment(d, a, b))) return true;
    return false;
  };

  for (let i = 0; i < seams.length; i += 1) {
    for (let j = i + 1; j < seams.length; j += 1) {
      if (canInteract(seams[i], seams[j]) || canInteract(seams[j], seams[i])) {
        dependencies[i].push(j);
        dependencies[j].push(i);
      }
    }
  }
  const pending = [];
  seams.forEach((seam, index) => {
    if (seam.entries.some(touchesDynamic)) pending.push(index);
  });
  while (pending.length) {
    const index = pending.pop();
    const { key } = seams[index];
    if (dynamicSeamKeys.has(key)) continue;
    dynamicSeamKeys.add(key);
    pending.push(...dependencies[index]);
  }
  return dynamicSeamKeys;
}
