import {
  GEOMETRY_EPSILON,
  makeCollinearLineKey,
  projectPointToLineParameter,
  dedupeSortedValues,
  computeSectorSideForLine
} from './geometry/seamGeometry.js';

function sortEntries(entries) {
  return [...entries].sort((left, right) => {
    if (left.sector.id !== right.sector.id) {
      return String(left.sector.id).localeCompare(String(right.sector.id));
    }
    return left.index - right.index;
  });
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function quantizedT(value) {
  return Math.round(value / GEOMETRY_EPSILON);
}

function getSideSign(value) {
  if (value > GEOMETRY_EPSILON) return 1;
  if (value < -GEOMETRY_EPSILON) return -1;
  return 0;
}

function areOppositeSides(left, right) {
  return left.sideSign !== 0 && right.sideSign !== 0 && left.sideSign !== right.sideSign;
}

function hasPortalRelationship(left, right) {
  return left.wall?.portalTo === right.sector.id || right.wall?.portalTo === left.sector.id;
}

function scorePair(left, right) {
  let score = 0;

  if (hasPortalRelationship(left, right)) {
    score -= 100000;
  }

  if (areOppositeSides(left, right)) {
    score -= 10000;
  }

  score += Math.abs(Math.abs(left.sideDistance) - Math.abs(right.sideDistance));

  return score;
}

/**
 * Creates an interval slice from the original authored wall segment.
 *
 * This intentionally does NOT reconstruct endpoints from the normalized line.
 * The normalized line is only used to discover overlap intervals.
 */
function makeIntervalSlice(entry, intervalT0, intervalT1) {
  let localStart;
  let localEnd;

  if (entry.tEnd >= entry.tStart) {
    localStart = intervalT0 - entry.tStart;
    localEnd = intervalT1 - entry.tStart;
  } else {
    localStart = entry.tStart - intervalT1;
    localEnd = entry.tStart - intervalT0;
  }

  localStart = clamp(localStart, 0, entry.length);
  localEnd = clamp(localEnd, 0, entry.length);

  if (localEnd < localStart) {
    const temp = localStart;
    localStart = localEnd;
    localEnd = temp;
  }

  return {
    a: {
      x: entry.a.x + (entry.dirX * localStart),
      y: entry.a.y + (entry.dirY * localStart)
    },
    b: {
      x: entry.a.x + (entry.dirX * localEnd),
      y: entry.a.y + (entry.dirY * localEnd)
    },
    localStart,
    localEnd
  };
}

function createIntervalEntry(entry, seamKey, intervalT0, intervalT1) {
  const slice = makeIntervalSlice(entry, intervalT0, intervalT1);

  return {
    ...entry,
    seamKey,
    intervalT0,
    intervalT1,
    intervalLocalStart: slice.localStart,
    intervalLocalEnd: slice.localEnd,
    intervalSegment: {
      a: slice.a,
      b: slice.b
    }
  };
}

function pickBestPairForEntry(entry, candidates) {
  let best = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    if (candidate === entry) continue;

    if (!hasPortalRelationship(entry, candidate) && !areOppositeSides(entry, candidate)) {
      continue;
    }

    const score = scorePair(entry, candidate);
    if (score < bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  return best;
}

/**
 * Partitions covering interval entries into actual seam units.
 *
 * Important:
 * Collinear + overlapping is not enough to mean "same physical seam".
 * Entries must either:
 * - have a portal relationship, or
 * - be on opposite sides of the line.
 *
 * Otherwise they are emitted as independent single-sided seams.
 */
function buildPhysicalSeamUnitsForInterval(participants) {
  const sorted = sortEntries(participants);
  const used = new Set();
  const units = [];

  // First pass: portal relationships are the strongest signal.
  for (const entry of sorted) {
    if (used.has(entry)) continue;

    const portalCandidates = sorted.filter((candidate) =>
      !used.has(candidate) &&
      candidate !== entry &&
      hasPortalRelationship(entry, candidate)
    );

    if (portalCandidates.length > 0) {
      const pair = pickBestPairForEntry(entry, portalCandidates);
      if (pair) {
        used.add(entry);
        used.add(pair);
        units.push(sortEntries([entry, pair]));
      }
    }
  }

  // Second pass: solid shared boundaries must be opposite-side pairs.
  for (const entry of sorted) {
    if (used.has(entry)) continue;

    const oppositeCandidates = sorted.filter((candidate) =>
      !used.has(candidate) &&
      candidate !== entry &&
      areOppositeSides(entry, candidate)
    );

    const pair = pickBestPairForEntry(entry, oppositeCandidates);
    if (pair) {
      used.add(entry);
      used.add(pair);
      units.push(sortEntries([entry, pair]));
    }
  }

  // Remaining entries are single-sided. Do not merge unrelated same-line walls.
  for (const entry of sorted) {
    if (used.has(entry)) continue;

    used.add(entry);
    units.push([entry]);
  }

  return units;
}

export function indexWallSeams(map) {
  const collinearGroups = new Map();
  let authoredWalls = 0;

  for (const sector of map.sectors) {
    for (let index = 0; index < sector.walls.length; index += 1) {
      const wall = sector.walls[index];
      const a = sector.vertices[wall.a];
      const b = sector.vertices[wall.b];

      authoredWalls += 1;

      if (!a || !b) {
        continue;
      }

      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const length = Math.hypot(dx, dy);

      if (!(length > GEOMETRY_EPSILON)) {
        continue;
      }

      const line = makeCollinearLineKey(a, b);
      if (!line) {
        continue;
      }

      const tStart = projectPointToLineParameter(a, line);
      const tEnd = projectPointToLineParameter(b, line);
      const t0 = Math.min(tStart, tEnd);
      const t1 = Math.max(tStart, tEnd);
      const sideDistance = computeSectorSideForLine(sector, line);
      const sideSign = getSideSign(sideDistance);

      const entry = {
        sector,
        wall,
        index,
        a,
        b,
        line,
        lineKey: line.key,
        dirX: dx / length,
        dirY: dy / length,
        length,
        tStart,
        tEnd,
        t0,
        t1,
        sideDistance,
        sideSign
      };

      const list = collinearGroups.get(line.key) ?? [];
      list.push(entry);
      collinearGroups.set(line.key, list);
    }
  }

  const seamWallsByKey = new Map();

  for (const [lineKey, entries] of collinearGroups.entries()) {
    const splitTs = dedupeSortedValues(entries.flatMap((entry) => [entry.t0, entry.t1]));

    for (let intervalIndex = 0; intervalIndex < splitTs.length - 1; intervalIndex += 1) {
      const intervalT0 = splitTs[intervalIndex];
      const intervalT1 = splitTs[intervalIndex + 1];

      if (!(intervalT1 > intervalT0 + GEOMETRY_EPSILON)) {
        continue;
      }

      const participants = entries.filter((entry) =>
        entry.t0 <= intervalT0 + GEOMETRY_EPSILON &&
        entry.t1 >= intervalT1 - GEOMETRY_EPSILON
      );

      if (!participants.length) {
        continue;
      }

      const physicalUnits = buildPhysicalSeamUnitsForInterval(participants);

      for (let unitIndex = 0; unitIndex < physicalUnits.length; unitIndex += 1) {
        const unit = physicalUnits[unitIndex];

        const seamKey = [
          lineKey,
          `${quantizedT(intervalT0)}:${quantizedT(intervalT1)}`,
          `unit-${unitIndex}`
        ].join('|');

        const seamEntries = sortEntries(unit).map((entry) =>
          createIntervalEntry(entry, seamKey, intervalT0, intervalT1)
        );

        seamWallsByKey.set(seamKey, seamEntries);
      }
    }
  }

  let indexedSharedWallSeams = 0;
  for (const seamEntries of seamWallsByKey.values()) {
    if (seamEntries.length > 1) {
      indexedSharedWallSeams += 1;
    }
  }

  return {
    seamWallsByKey,
    stats: {
      authoredWalls,
      indexedWallSeams: seamWallsByKey.size,
      indexedSharedWallSeams
    }
  };
}