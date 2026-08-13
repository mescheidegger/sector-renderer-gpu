/**
 * Module: Converts a normalized sector render world into GPU-friendly primitives.
 */
import { buildSurfacePrimitives } from './scene/buildSurfacePrimitives.js';
import { indexWallSeams } from './scene/indexWallSeams.js';
import { resolveWallPrimitivesFromSeams } from './scene/resolveWallPrimitivesFromSeams.js';
import { dedupeCoplanarWallPrimitives } from './scene/dedupeCoplanarWallPrimitives.js';
import {
  GEOMETRY_EPSILON,
  SHARED_SOLID_SURFACE_OFFSET
} from './scene/geometry/seamGeometry.js';
import { assertRendererWorld } from './contracts.js';

function makeWallRefKey(sectorId, wallIndex) {
  return `${String(sectorId)}:${wallIndex}`;
}

function buildPortalOpeningByWallRef(portalOpenings = []) {
  const result = new Map();
  for (const opening of portalOpenings) {
    const { sectorId, wallIndex } = opening?.wallRef ?? {};
    if (sectorId == null || !Number.isInteger(wallIndex) || wallIndex < 0) continue;
    const hasBounds = Number.isFinite(opening.bottomZ) && Number.isFinite(opening.topZ) && opening.topZ > opening.bottomZ;
    result.set(makeWallRefKey(sectorId, wallIndex), {
      openingBounds: hasBounds ? { bottomZ: opening.bottomZ, topZ: opening.topZ } : null,
      trimMaterial: opening.trimMaterial ?? null
    });
  }
  return result;
}

function resolveTargetSeamKey({ seamWallsByKey, targetSeamKey, targetWallRef }) {
  if (targetSeamKey) {
    return {
      resolvedTargetSeamKey: targetSeamKey,
      resolutionSource: 'seamKey'
    };
  }

  if (!targetWallRef) {
    return {
      resolvedTargetSeamKey: null,
      resolutionSource: null
    };
  }

  for (const [seamKey, seamEntries] of seamWallsByKey.entries()) {
    if (
      seamEntries.some((entry) =>
        String(entry.sector.id) === String(targetWallRef.sectorId) &&
        entry.index === targetWallRef.wallIndex
      )
    ) {
      return {
        resolvedTargetSeamKey: seamKey,
        resolutionSource: 'wallRef'
      };
    }
  }

  return {
    resolvedTargetSeamKey: null,
    resolutionSource: 'wallRef'
  };
}

function getSeamPrimitives(primitives, seamKey) {
  if (!seamKey) {
    return [];
  }

  return primitives
    .filter((primitive) => primitive.seamKey === seamKey)
    .map((primitive) => ({
      id: primitive.id,
      kind: primitive.kind,
      sectorId: primitive.sectorId,
      material: primitive.material,
      bottomZ: primitive.bottomZ,
      topZ: primitive.topZ,
      x0: primitive.x0,
      y0: primitive.y0,
      x1: primitive.x1,
      y1: primitive.y1
    }));
}

function buildSeamDebugSummary(seamDebugState, dedupeStats) {
  if (!seamDebugState.enabled) {
    return {
      enabled: false
    };
  }

  const resolution = seamDebugState.resolution ?? {};
  const dedupeEvents = seamDebugState.dedupeEvents ?? [];
  const qualifiedPairs = dedupeEvents.filter((event) => event.qualifiedCoplanarCandidate).length;
  const splitCount = dedupeEvents.filter((event) => event.action === 'split').length;
  const skipCount = dedupeEvents.filter((event) => event.action === 'skip').length;
  const lastEmit = resolution.lastEmittedInterval ?? null;
  const lastDedupe = dedupeEvents[dedupeEvents.length - 1] ?? null;

  return {
    enabled: true,
    seamKey: seamDebugState.targetSeamKey,
    targetSeamKey: seamDebugState.targetSeamKey,
    targetWallRef: seamDebugState.targetWallRef ?? null,
    resolutionSource: seamDebugState.resolutionSource ?? null,
    seamFound: Boolean(seamDebugState.targetSeamKey),
    participants: resolution.seamParticipants ?? [],
    treatedAsPortal: resolution.treatedAsPortal ?? false,
    portal: resolution.portal ?? null,
    splitCount: resolution.splitLevels?.length ? Math.max(0, resolution.splitLevels.length - 1) : 0,
    intervalCount: resolution.intervals?.length ?? 0,
    emittedIntervalsCount: resolution.emittedIntervalsCount ?? 0,
    skippedIntervalsCount: resolution.skippedIntervalsCount ?? 0,
    dedupeCandidatePairCount: qualifiedPairs,
    dedupePairChecks: dedupeEvents.length,
    dedupeSplitsCount: splitCount,
    dedupeSkipsCount: skipCount,
    lastEmitSummary: lastEmit
      ? `${lastEmit.kind} ${lastEmit.ownerSectorId}:${lastEmit.ownerWallIndex} ${lastEmit.bottomZ.toFixed(2)}->${lastEmit.topZ.toFixed(2)}`
      : null,
    lastDedupeSummary: lastDedupe
      ? `owner=${lastDedupe.ownerId} cand=${lastDedupe.candidateId} action=${lastDedupe.action}`
      : null,
    preDedupePrimitiveCount: seamDebugState.preDedupe.length,
    postDedupePrimitiveCount: seamDebugState.postDedupe.length,
    preDedupe: seamDebugState.preDedupe,
    postDedupe: seamDebugState.postDedupe,
    preDedupePrimitives: seamDebugState.preDedupe,
    postDedupePrimitives: seamDebugState.postDedupe,
    seamResolution: seamDebugState.resolution ?? null,
    dedupeEvents,
    dedupeStats: {
      coplanarChecks: dedupeStats.coplanarChecks,
      overlapCandidates: dedupeStats.overlapCandidates,
      overlapIntervalsSubtracted: dedupeStats.overlapIntervalsSubtracted,
      duplicatePrimitivesSkipped: dedupeStats.duplicatePrimitivesSkipped,
      splitPrimitivesCreated: dedupeStats.splitPrimitivesCreated
    }
  };
}

function pointsClose(a, b, epsilon = GEOMETRY_EPSILON) {
  return (
    Math.abs(a.x - b.x) <= epsilon &&
    Math.abs(a.y - b.y) <= epsilon
  );
}

function distance2D(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function intersectLines2D(a0, a1, b0, b1) {
  const adx = a1.x - a0.x;
  const ady = a1.y - a0.y;
  const bdx = b1.x - b0.x;
  const bdy = b1.y - b0.y;
  const denom = (adx * bdy) - (ady * bdx);

  if (Math.abs(denom) <= GEOMETRY_EPSILON) {
    return null;
  }

  const cx = b0.x - a0.x;
  const cy = b0.y - a0.y;
  const t = ((cx * bdy) - (cy * bdx)) / denom;

  return {
    x: a0.x + (adx * t),
    y: a0.y + (ady * t)
  };
}

function getTouchingEndpointKinds(a, b) {
  const touches = [];

  if (pointsClose(a.sourceA, b.sourceA)) touches.push(['a0', 'b0']);
  if (pointsClose(a.sourceA, b.sourceB)) touches.push(['a0', 'b1']);
  if (pointsClose(a.sourceB, b.sourceA)) touches.push(['a1', 'b0']);
  if (pointsClose(a.sourceB, b.sourceB)) touches.push(['a1', 'b1']);

  return touches;
}

function snapWallEndpoint(wall, endpointKind, point) {
  if (endpointKind === 'a0' || endpointKind === 'b0') {
    wall.x0 = point.x;
    wall.y0 = point.y;
    return;
  }

  wall.x1 = point.x;
  wall.y1 = point.y;
}

function isIntersectionCloseEnough(a, b, point, touch) {
  const [aEndpointKind, bEndpointKind] = touch;
  const aCurrent = aEndpointKind === 'a0'
    ? { x: a.x0, y: a.y0 }
    : { x: a.x1, y: a.y1 };
  const bCurrent = bEndpointKind === 'b0'
    ? { x: b.x0, y: b.y0 }
    : { x: b.x1, y: b.y1 };

  const maxStitchDistance = Math.max(SHARED_SOLID_SURFACE_OFFSET * 4, GEOMETRY_EPSILON * 16);

  return (
    distance2D(point, aCurrent) <= maxStitchDistance &&
    distance2D(point, bCurrent) <= maxStitchDistance
  );
}

function stitchOffsetWallCorners(walls) {
  const bySector = new Map();

  for (const wall of walls) {
    if (!wall.sharedSolidOffset || !wall.sourceA || !wall.sourceB) {
      continue;
    }

    const sectorId = wall.ownerSectorId ?? wall.sectorId;
    const sectorWalls = bySector.get(sectorId) ?? [];
    sectorWalls.push(wall);
    bySector.set(sectorId, sectorWalls);
  }

  for (const sectorWalls of bySector.values()) {
    for (let i = 0; i < sectorWalls.length; i += 1) {
      for (let j = i + 1; j < sectorWalls.length; j += 1) {
        const a = sectorWalls[i];
        const b = sectorWalls[j];
        const touches = getTouchingEndpointKinds(a, b);

        if (!touches.length) {
          continue;
        }

        const intersection = intersectLines2D(
          { x: a.x0, y: a.y0 },
          { x: a.x1, y: a.y1 },
          { x: b.x0, y: b.y0 },
          { x: b.x1, y: b.y1 }
        );

        if (!intersection) {
          continue;
        }

        for (const touch of touches) {
          if (!isIntersectionCloseEnough(a, b, intersection, touch)) {
            continue;
          }

          const [aEndpointKind, bEndpointKind] = touch;
          snapWallEndpoint(a, aEndpointKind, intersection);
          snapWallEndpoint(b, bEndpointKind, intersection);
        }
      }
    }
  }

  return walls;
}

/** Builds the complete GPU scene bundle (walls/floors/ceilings + stats) from the normalized sector render world. */
export function buildGpuScene(world, options = {}) {
  assertRendererWorld(world);
  const start = performance.now();
  const sectorById = new Map(world.sectors.map((sector) => [sector.id, sector]));
  const stats = {
    authoredWalls: 0,
    indexedWallSeams: 0,
    indexedSharedWallSeams: 0,
    solidWallPrimitives: 0,
    portalWallsProcessed: 0,
    portalOpeningsEmitted: 0,
    upperBandPrimitives: 0,
    lowerBandPrimitives: 0,
    fullyOpenPortalsSkipped: 0,
    floorPrimitives: 0,
    ceilingPrimitives: 0,
    floorTriangles: 0,
    ceilingTriangles: 0
  };

  const dynamicSectorIds = new Set(world.dynamicSectorIds ?? []);
  const surfaceResult = buildSurfacePrimitives(world, {
    excludeFloorSectorIds: dynamicSectorIds
  });
  const { floors, ceilings } = surfaceResult;
  Object.assign(stats, surfaceResult.stats);

  const seamIndexResult = indexWallSeams(world);
  const { seamWallsByKey } = seamIndexResult;
  Object.assign(stats, seamIndexResult.stats);

  const seamDebugConfig = options.seamDebug ?? {};
  const seamDebugEnabled = Boolean(seamDebugConfig.enabled);
  const targetWallRef = seamDebugConfig.targetWallRef ?? null;
  const seamKeyResolution = resolveTargetSeamKey({
    seamWallsByKey,
    targetSeamKey: seamDebugConfig.targetSeamKey ?? null,
    targetWallRef
  });
  const seamDebugState = {
    enabled: seamDebugEnabled,
    targetWallRef,
    resolutionSource: seamKeyResolution.resolutionSource,
    targetSeamKey: seamDebugEnabled ? seamKeyResolution.resolvedTargetSeamKey : null,
    resolution: null,
    preDedupe: [],
    postDedupe: [],
    dedupeEvents: []
  };

  const portalOpeningByWallRef = buildPortalOpeningByWallRef(world.portalOpenings);

  const walls = resolveWallPrimitivesFromSeams({
    seamWallsByKey,
    sectorById,
    portalOpeningByWallRef,
    stats,
    seamDebugState
  });

  seamDebugState.preDedupe = seamDebugState.enabled
    ? getSeamPrimitives(walls, seamDebugState.targetSeamKey)
    : [];

  const staticCandidateWalls = walls.filter((wall) => {
    if (!dynamicSectorIds.size) {
      return true;
    }

    if (dynamicSectorIds.has(wall.ownerSectorId)) {
      return false;
    }

    return true;
  });

  const dedupedWallResult = dedupeCoplanarWallPrimitives(staticCandidateWalls);
  const stitchedWalls = stitchOffsetWallCorners(dedupedWallResult.walls);

  stats.coplanarDedupChecks = dedupedWallResult.stats.coplanarChecks;
  stats.coplanarDedupCandidates = dedupedWallResult.stats.overlapCandidates;
  stats.coplanarDedupIntervalsSubtracted = dedupedWallResult.stats.overlapIntervalsSubtracted;
  stats.coplanarWallPrimitivesSkipped = dedupedWallResult.stats.duplicatePrimitivesSkipped;
  stats.coplanarWallPrimitiveSplits = dedupedWallResult.stats.splitPrimitivesCreated;

  seamDebugState.postDedupe = seamDebugState.enabled
    ? getSeamPrimitives(stitchedWalls, seamDebugState.targetSeamKey)
    : [];

  const seamDebug = seamDebugEnabled ? buildSeamDebugSummary(seamDebugState, dedupedWallResult.stats) : null;

  return {
    sectors: world.sectors.length,
    walls: stitchedWalls,
    floors,
    ceilings,
    stats,
    seamDebug,
    buildMs: performance.now() - start
  };
}
