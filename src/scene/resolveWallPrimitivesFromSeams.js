/**
 * Module: Core seam resolver that decides whether each seam is solid or portal and emits the corresponding wall primitives.
 */
import { resolveWallMaterial } from '../materials/gpuMaterials.js';
import { createWallPrimitive } from './createWallPrimitive.js';
import {
  GEOMETRY_EPSILON,
  offsetWallTowardsSectorInterior,
  SHARED_SOLID_SURFACE_OFFSET
} from './geometry/seamGeometry.js';

const PORTAL_TRIM_SIDE_WIDTH = 0.2;
export const PORTAL_TRIM_SURFACE_OFFSET = 6e-3;

function classifyGpuPortalWall(frontSector, backSector) {
  const openTop = Math.min(frontSector.ceil, backSector.ceil);
  const openBottom = Math.max(frontSector.floor, backSector.floor);
  const isOpen = openTop > openBottom;
  const hasUpperBand = frontSector.ceil > backSector.ceil;
  const hasLowerBand = frontSector.floor < backSector.floor;

  return {
    isOpen,
    hasUpperBand,
    hasLowerBand,
    openTop,
    openBottom
  };
}

function classifyGpuPortalWallWithOpeningBounds(frontSector, backSector, openingBounds) {
  if (!openingBounds) {
    return classifyGpuPortalWall(frontSector, backSector);
  }

  const openBottom = Math.max(frontSector.floor, backSector.floor, openingBounds.bottomZ);
  const openTop = Math.min(frontSector.ceil, backSector.ceil, openingBounds.topZ);
  const isOpen = openTop > openBottom;

  return {
    isOpen,
    hasUpperBand: frontSector.ceil > openTop + GEOMETRY_EPSILON,
    hasLowerBand: frontSector.floor < openBottom - GEOMETRY_EPSILON,
    openTop,
    openBottom
  };
}

function emitPortalTrimPrimitivesForSeam({
  walls,
  seamKey,
  seamParticipants,
  entry,
  otherSector,
  trimMaterial,
  openingBottomZ,
  openingTopZ,
  emitStart = true,
  emitEnd = true,
  continuousSpanLength = null,
  seamDebugResolution
}) {
  if (!trimMaterial || !(openingTopZ > openingBottomZ + GEOMETRY_EPSILON)) {
    return;
  }

  const shiftedSegment = offsetWallTowardsSectorInterior(entry, PORTAL_TRIM_SURFACE_OFFSET);
  const sourceSegment = getEntryIntervalSegment(entry);
  const trimOffsetXY = {
    x: shiftedSegment.a.x - sourceSegment.a.x,
    y: shiftedSegment.a.y - sourceSegment.a.y,
    magnitude: Math.hypot(shiftedSegment.a.x - sourceSegment.a.x, shiftedSegment.a.y - sourceSegment.a.y)
  };
  const segmentDX = shiftedSegment.b.x - shiftedSegment.a.x;
  const segmentDY = shiftedSegment.b.y - shiftedSegment.a.y;
  const segmentLength = Math.hypot(segmentDX, segmentDY);
  if (!(segmentLength > GEOMETRY_EPSILON)) {
    return;
  }

  const openingLength = continuousSpanLength ?? segmentLength;
  const maxUsableWidth = (openingLength * 0.5) - GEOMETRY_EPSILON;
  const stripWidth = Math.min(PORTAL_TRIM_SIDE_WIDTH, maxUsableWidth);
  if (!(stripWidth > GEOMETRY_EPSILON)) {
    return;
  }

  const dirX = segmentDX / segmentLength;
  const dirY = segmentDY / segmentLength;

  const startSegment = {
    a: shiftedSegment.a,
    b: {
      x: shiftedSegment.a.x + (dirX * stripWidth),
      y: shiftedSegment.a.y + (dirY * stripWidth)
    }
  };

  const endSegment = {
    a: {
      x: shiftedSegment.b.x - (dirX * stripWidth),
      y: shiftedSegment.b.y - (dirY * stripWidth)
    },
    b: shiftedSegment.b
  };

  const createTrimPrimitive = (segment, spanIdSuffix) => {
    const primitive = createWallPrimitive({
      sector: entry.sector,
      wall: entry.wall,
      index: entry.index,
      a: entry.a,
      b: entry.b,
      kind: 'solid',
      bottomZ: openingBottomZ,
      topZ: openingTopZ,
      backSector: otherSector,
      owner: entry,
      seamKey,
      seamParticipants,
      spanIdSuffix,
      segment
    });

    if (!primitive) {
      return;
    }

    primitive.material = resolveWallMaterial({
      ...entry.wall,
      material: trimMaterial
    });
    primitive.uvUStart = 0;
    primitive.uvUEnd = 1;
    primitive.portalTrimSurfaceOffsetXY = { ...trimOffsetXY };
    walls.push(primitive);
    return primitive;
  };

  const startPrimitive = emitStart
    ? createTrimPrimitive(startSegment, 'portal-trim-start')
    : null;
  const endPrimitive = emitEnd
    ? createTrimPrimitive(endSegment, 'portal-trim-end')
    : null;

  if (seamDebugResolution) {
    seamDebugResolution.portalTrimSurfaceOffset = {
      configuredOffset: PORTAL_TRIM_SURFACE_OFFSET,
      appliedOffsetXY: trimOffsetXY,
      primitiveIds: [startPrimitive?.id ?? null, endPrimitive?.id ?? null]
    };
  }
}


function resolvePortalMetadataForEntries(seamEntries, portalOpeningByWallRef) {
  for (const entry of seamEntries) {
    const wallRefKey = `${String(entry.sector.id)}:${entry.index}`;
    const metadata = portalOpeningByWallRef?.get(wallRefKey) ?? null;
    if (metadata) {
      return { wallRefKey, ...metadata };
    }
  }
  return { wallRefKey: null, trimMaterial: null, openingBounds: null };
}

function sortSeamEntries(seamEntries) {
  return [...seamEntries].sort((left, right) => {
    if (left.sector.id !== right.sector.id) {
      return String(left.sector.id).localeCompare(String(right.sector.id));
    }
    return left.index - right.index;
  });
}

function sameSectorPair(left, right) {
  return (
    (Object.is(left.sectorA, right.sectorA) && Object.is(left.sectorB, right.sectorB)) ||
    (Object.is(left.sectorA, right.sectorB) && Object.is(left.sectorB, right.sectorA))
  );
}

function sameOpeningBounds(left, right) {
  if (!left && !right) return true;
  if (!left || !right) return false;
  return (
    Math.abs(left.bottomZ - right.bottomZ) <= GEOMETRY_EPSILON &&
    Math.abs(left.topZ - right.topZ) <= GEOMETRY_EPSILON
  );
}

function portalTrimSemanticsMatch(left, right) {
  return (
    left.lineKey === right.lineKey &&
    left.paired === right.paired &&
    sameSectorPair(left, right) &&
    left.trimMaterial === right.trimMaterial &&
    sameOpeningBounds(left.openingBounds, right.openingBounds) &&
    Math.abs(left.openingBottomZ - right.openingBottomZ) <= GEOMETRY_EPSILON &&
    Math.abs(left.openingTopZ - right.openingTopZ) <= GEOMETRY_EPSILON
  );
}

function describePortalTrimSeam(seamEntries, sectorById, portalOpeningByWallRef) {
  const sortedEntries = sortSeamEntries(seamEntries);
  const owner = sortedEntries[0];
  const opposite = sortedEntries[1] ?? null;
  const portalMetadata = resolvePortalMetadataForEntries(sortedEntries, portalOpeningByWallRef);
  if (!owner || !portalMetadata.trimMaterial) return null;

  let otherSector = null;
  if (opposite) {
    const isPortal = (
      owner.wall.portalTo === opposite.sector.id ||
      opposite.wall.portalTo === owner.sector.id
    );
    if (!isPortal) return null;
    otherSector = opposite.sector;
  } else if (owner.wall.portalTo != null) {
    otherSector = sectorById.get(owner.wall.portalTo) ?? null;
  }
  if (!otherSector) return null;

  const portal = classifyGpuPortalWallWithOpeningBounds(
    owner.sector,
    otherSector,
    portalMetadata.openingBounds
  );
  if (!portal.isOpen) return null;

  return {
    seamKey: owner.seamKey,
    lineKey: owner.lineKey,
    intervalT0: owner.intervalT0,
    intervalT1: owner.intervalT1,
    sectorA: owner.sector.id,
    sectorB: otherSector.id,
    paired: Boolean(opposite),
    trimMaterial: portalMetadata.trimMaterial,
    openingBounds: portalMetadata.openingBounds,
    openingBottomZ: portal.openBottom,
    openingTopZ: portal.openTop,
    exposeT0: true,
    exposeT1: true
  };
}

/** Determine exposed physical opening ends before any trim primitives are emitted. */
function preparePortalTrimEndpointExposure(seamWallsByKey, sectorById, portalOpeningByWallRef) {
  const descriptors = [...seamWallsByKey.values()]
    .map((entries) => describePortalTrimSeam(entries, sectorById, portalOpeningByWallRef))
    .filter(Boolean);
  const parent = descriptors.map((_, index) => index);
  const descriptorIndicesByLine = new Map();
  descriptors.forEach((descriptor, index) => {
    const indices = descriptorIndicesByLine.get(descriptor.lineKey) ?? [];
    indices.push(index);
    descriptorIndicesByLine.set(descriptor.lineKey, indices);
  });
  const find = (index) => {
    while (parent[index] !== index) {
      parent[index] = parent[parent[index]];
      index = parent[index];
    }
    return index;
  };
  const union = (left, right) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parent[rightRoot] = leftRoot;
  };

  for (const descriptorIndices of descriptorIndicesByLine.values()) {
    for (let leftOffset = 0; leftOffset < descriptorIndices.length; leftOffset += 1) {
      const leftIndex = descriptorIndices[leftOffset];
      const left = descriptors[leftIndex];
      for (let rightOffset = leftOffset + 1; rightOffset < descriptorIndices.length; rightOffset += 1) {
        const rightIndex = descriptorIndices[rightOffset];
        const right = descriptors[rightIndex];
        if (!portalTrimSemanticsMatch(left, right)) continue;

        if (Math.abs(left.intervalT1 - right.intervalT0) <= GEOMETRY_EPSILON) {
          left.exposeT1 = false;
          right.exposeT0 = false;
          union(leftIndex, rightIndex);
        } else if (Math.abs(right.intervalT1 - left.intervalT0) <= GEOMETRY_EPSILON) {
          right.exposeT1 = false;
          left.exposeT0 = false;
          union(leftIndex, rightIndex);
        }
      }
    }
  }

  const spansByRoot = new Map();
  descriptors.forEach((descriptor, index) => {
    const root = find(index);
    const span = spansByRoot.get(root) ?? {
      t0: descriptor.intervalT0,
      t1: descriptor.intervalT1
    };
    span.t0 = Math.min(span.t0, descriptor.intervalT0);
    span.t1 = Math.max(span.t1, descriptor.intervalT1);
    spansByRoot.set(root, span);
  });

  return new Map(descriptors.map((descriptor, index) => {
    const span = spansByRoot.get(find(index));
    return [descriptor.seamKey, {
      exposeT0: descriptor.exposeT0,
      exposeT1: descriptor.exposeT1,
      continuousSpanLength: span.t1 - span.t0
    }];
  }));
}

function getEntryTrimEndpointExposure(entry, seamExposure) {
  if (!seamExposure) {
    return { emitStart: true, emitEnd: true, continuousSpanLength: null };
  }
  const followsCanonicalLine = entry.tEnd >= entry.tStart;
  return {
    emitStart: followsCanonicalLine ? seamExposure.exposeT0 : seamExposure.exposeT1,
    emitEnd: followsCanonicalLine ? seamExposure.exposeT1 : seamExposure.exposeT0,
    continuousSpanLength: seamExposure.continuousSpanLength
  };
}

function getEntryIntervalSegment(entry) {
  return entry.intervalSegment ?? { a: entry.a, b: entry.b };
}

function emitOffsetEndCap({
  emitFromEntry,
  entry,
  otherSector,
  bottomZ,
  topZ,
  sourcePoint,
  offsetPoint,
  spanIdSuffix
}) {
  const capLength = Math.hypot(offsetPoint.x - sourcePoint.x, offsetPoint.y - sourcePoint.y);
  if (!(capLength > GEOMETRY_EPSILON)) {
    return null;
  }

  return emitFromEntry({
    entry,
    otherSector,
    kind: 'solid',
    bottomZ,
    topZ,
    spanIdSuffix,
    segment: {
      a: sourcePoint,
      b: offsetPoint
    }
  });
}

function resolveWallSpansForSeam({
  walls,
  sectorById,
  portalOpeningByWallRef,
  seamKey,
  seamEntries,
  portalTrimEndpointExposure,
  stats,
  seamDebugState
}) {
  if (!Array.isArray(seamEntries) || seamEntries.length === 0) {
    return;
  }

  const sortedEntries = sortSeamEntries(seamEntries);

  const owner = sortedEntries[0];
  const opposite = sortedEntries.find((entry) => entry !== owner) ?? null;
  const seamParticipants = sortedEntries.map((entry) => ({
    sectorId: entry.sector.id,
    wallIndex: entry.index
  }));
  const portalMetadata = resolvePortalMetadataForEntries(sortedEntries, portalOpeningByWallRef);
  const trimMaterial = portalMetadata.trimMaterial;
  const openingBounds = portalMetadata.openingBounds;
  const seamDebugActive = Boolean(seamDebugState?.enabled && seamDebugState.targetSeamKey === seamKey);
  const seamDebugResolution = seamDebugActive
    ? {
      seamKey,
      seamParticipants,
      treatedAsPortal: false,
      leftSectorId: null,
      rightSectorId: null,
      splitLevels: [],
      portal: null,
      intervals: [],
      emittedIntervalsCount: 0,
      skippedIntervalsCount: 0,
      lastEmittedInterval: null,
      portalTrimSurfaceOffset: null,
      portalOpeningWallRefKey: portalMetadata.wallRefKey
    }
    : null;

  const emitFromEntry = ({ entry, otherSector, kind, bottomZ, topZ, spanIdSuffix, segment }) => {
    const intervalSegment = getEntryIntervalSegment(entry);
    const primitive = createWallPrimitive({
      sector: entry.sector,
      wall: entry.wall,
      index: entry.index,
      a: entry.a,
      b: entry.b,
      kind,
      bottomZ,
      topZ,
      backSector: otherSector,
      owner: entry,
      seamKey,
      seamParticipants,
      spanIdSuffix,
      segment
    });

    if (!primitive) {
      return null;
    }

    walls.push(primitive);

    if (seamDebugResolution) {
      seamDebugResolution.lastEmittedInterval = {
        primitiveId: primitive.id,
        kind,
        ownerSectorId: primitive.ownerSectorId,
        ownerWallIndex: primitive.ownerWallIndex,
        material: primitive.material,
        bottomZ,
        topZ
      };
    }

    if (kind === 'solid') {
      stats.solidWallPrimitives += 1;
    } else if (kind === 'portal_upper') {
      stats.upperBandPrimitives += 1;
    } else if (kind === 'portal_lower') {
      stats.lowerBandPrimitives += 1;
    }

    return primitive;
  };

  if (!opposite) {
    const ownerSector = owner.sector;
    if (owner.wall.portalLinks?.length) {
      stats.portalWallsProcessed += 1;
      const links = owner.wall.portalLinks
        .map((link) => ({
          ...link,
          bottomZ: Math.max(ownerSector.floor, sectorById.get(link.sectorId)?.floor ?? ownerSector.floor, link.bottomZ),
          topZ: Math.min(ownerSector.ceil, sectorById.get(link.sectorId)?.ceil ?? ownerSector.ceil, link.topZ)
        }))
        .filter((link) => link.topZ > link.bottomZ + GEOMETRY_EPSILON)
        .sort((a, b) => a.bottomZ - b.bottomZ);
      const levels = [...new Set([ownerSector.floor, ownerSector.ceil, ...links.flatMap((link) => [link.bottomZ, link.topZ])])].sort((a, b) => a - b);
      let emittedBand = false;
      for (let index = 0; index < levels.length - 1; index += 1) {
        const bottomZ = levels[index];
        const topZ = levels[index + 1];
        const openLink = links.find((link) => bottomZ >= link.bottomZ - GEOMETRY_EPSILON && topZ <= link.topZ + GEOMETRY_EPSILON);
        if (openLink) continue;
        const nextLink = links.find((link) => link.bottomZ >= topZ - GEOMETRY_EPSILON);
        const kind = nextLink ? 'portal_lower' : 'portal_upper';
        emittedBand = Boolean(emitFromEntry({
          entry: owner,
          otherSector: nextLink ? sectorById.get(nextLink.sectorId) : null,
          kind,
          bottomZ,
          topZ,
          spanIdSuffix: `vertical-link-gap-${index}`
        })) || emittedBand;
      }
      stats.portalOpeningsEmitted += links.length;
      if (!emittedBand) stats.fullyOpenPortalsSkipped += 1;
      if (seamDebugResolution) {
        seamDebugResolution.treatedAsPortal = true;
        seamDebugResolution.splitLevels = levels;
        seamDebugResolution.portalLinks = links;
        seamDebugState.resolution = seamDebugResolution;
      }
      return;
    }
    const backSectorFromPortal = owner.wall.portalTo != null ? (sectorById.get(owner.wall.portalTo) ?? null) : null;
    const treatAsPortal = Boolean(backSectorFromPortal);

    if (!treatAsPortal) {
      const parentSector = ownerSector.parentSectorId != null ? (sectorById.get(ownerSector.parentSectorId) ?? null) : null;
      const solidBottomZ = parentSector ? Math.min(parentSector.floor, ownerSector.floor) : ownerSector.floor;
      const solidTopZ = parentSector ? Math.max(parentSector.floor, ownerSector.floor) : ownerSector.ceil;
      const emittedPrimitive = emitFromEntry({
        entry: owner,
        otherSector: parentSector,
        kind: 'solid',
        bottomZ: solidBottomZ,
        topZ: solidTopZ
      });
      if (seamDebugResolution) {
        seamDebugResolution.leftSectorId = ownerSector.id;
        seamDebugResolution.splitLevels = [ownerSector.floor, ownerSector.ceil];
        seamDebugResolution.intervals.push({
          intervalIndex: 0,
          bottomZ: ownerSector.floor,
          topZ: ownerSector.ceil,
          leftSolid: true,
          rightSolid: false,
          skipped: !Boolean(emittedPrimitive),
          skipReason: emittedPrimitive ? null : 'emit-failed',
          emitted: emittedPrimitive
            ? [{
              primitiveId: emittedPrimitive.id,
              kind: 'solid',
              sourceSectorId: owner.sector.id,
              sourceWallIndex: owner.index,
              material: emittedPrimitive.material
            }]
            : []
        });
        seamDebugResolution.emittedIntervalsCount = emittedPrimitive ? 1 : 0;
        seamDebugResolution.skippedIntervalsCount = emittedPrimitive ? 0 : 1;
        seamDebugState.resolution = seamDebugResolution;
      }
      return;
    }

    stats.portalWallsProcessed += 1;
    const portal = classifyGpuPortalWallWithOpeningBounds(ownerSector, backSectorFromPortal, openingBounds);
    if (seamDebugResolution) {
      seamDebugResolution.treatedAsPortal = true;
      seamDebugResolution.leftSectorId = ownerSector.id;
      seamDebugResolution.rightSectorId = backSectorFromPortal.id;
      seamDebugResolution.splitLevels = [ownerSector.floor, ownerSector.ceil, backSectorFromPortal.floor, backSectorFromPortal.ceil]
        .sort((a, b) => a - b);
      seamDebugResolution.portal = {
        openBottom: portal.openBottom,
        openTop: portal.openTop,
        hasUpperBand: portal.hasUpperBand,
        hasLowerBand: portal.hasLowerBand,
        isOpen: portal.isOpen
      };
    }
    if (!portal.isOpen) {
      const emittedPrimitive = emitFromEntry({
        entry: owner,
        otherSector: backSectorFromPortal,
        kind: 'solid',
        bottomZ: ownerSector.floor,
        topZ: ownerSector.ceil
      });
      if (seamDebugResolution) {
        seamDebugResolution.intervals.push({
          intervalIndex: 0,
          bottomZ: ownerSector.floor,
          topZ: ownerSector.ceil,
          leftSolid: true,
          rightSolid: false,
          skipped: !Boolean(emittedPrimitive),
          skipReason: emittedPrimitive ? null : 'emit-failed',
          emitted: emittedPrimitive
            ? [{
              primitiveId: emittedPrimitive.id,
              kind: 'solid',
              sourceSectorId: owner.sector.id,
              sourceWallIndex: owner.index,
              material: emittedPrimitive.material
            }]
            : []
        });
        seamDebugResolution.emittedIntervalsCount = emittedPrimitive ? 1 : 0;
        seamDebugResolution.skippedIntervalsCount = emittedPrimitive ? 0 : 1;
        seamDebugState.resolution = seamDebugResolution;
      }
      return;
    }

    stats.portalOpeningsEmitted += 1;
    let emittedPortalBand = false;
    if (portal.hasUpperBand) {
      emittedPortalBand = Boolean(emitFromEntry({
        entry: owner,
        otherSector: backSectorFromPortal,
        kind: 'portal_upper',
        bottomZ: portal.openTop,
        topZ: ownerSector.ceil
      })) || emittedPortalBand;
    }
    if (portal.hasLowerBand) {
      emittedPortalBand = Boolean(emitFromEntry({
        entry: owner,
        otherSector: backSectorFromPortal,
        kind: 'portal_lower',
        bottomZ: ownerSector.floor,
        topZ: portal.openBottom
      })) || emittedPortalBand;
    }

    emitPortalTrimPrimitivesForSeam({
      walls,
      seamKey,
      seamParticipants,
      entry: owner,
      otherSector: backSectorFromPortal,
      trimMaterial,
      openingBottomZ: portal.openBottom,
      openingTopZ: portal.openTop,
      ...getEntryTrimEndpointExposure(owner, portalTrimEndpointExposure),
      seamDebugResolution
    });

    if (!emittedPortalBand) {
      stats.fullyOpenPortalsSkipped += 1;
    }
    if (seamDebugResolution) {
      seamDebugState.resolution = seamDebugResolution;
    }
    return;
  }

  const left = owner;
  const right = opposite;
  const leftSector = left.sector;
  const rightSector = right.sector;
  const leftPortalToRight = left.wall.portalTo === rightSector.id;
  const rightPortalToLeft = right.wall.portalTo === leftSector.id;
  const treatAsPortal = Boolean(leftPortalToRight || rightPortalToLeft);

  if (treatAsPortal) {
    stats.portalWallsProcessed += 1;
  }

  const portalLeft = classifyGpuPortalWallWithOpeningBounds(leftSector, rightSector, openingBounds);
  const portalRight = classifyGpuPortalWallWithOpeningBounds(rightSector, leftSector, openingBounds);
  const splitLevelsSource = [
    leftSector.floor,
    leftSector.ceil,
    rightSector.floor,
    rightSector.ceil,
    portalLeft.openBottom,
    portalLeft.openTop,
    portalRight.openBottom,
    portalRight.openTop
  ];
  const splitLevels = [...new Set(splitLevelsSource)].sort((a, b) => a - b);
  if (seamDebugResolution) {
    seamDebugResolution.treatedAsPortal = treatAsPortal;
    seamDebugResolution.leftSectorId = leftSector.id;
    seamDebugResolution.rightSectorId = rightSector.id;
    seamDebugResolution.splitLevels = splitLevels;
    seamDebugResolution.portal = {
      openBottom: portalLeft.openBottom,
      openTop: portalLeft.openTop,
      hasUpperBand: portalLeft.hasUpperBand,
      hasLowerBand: portalLeft.hasLowerBand,
      isOpen: portalLeft.isOpen
    };
  }
  if (treatAsPortal && portalLeft.isOpen) {
    stats.portalOpeningsEmitted += 1;
  }

  let emittedPortalBand = false;
  for (let i = 0; i < splitLevels.length - 1; i += 1) {
    const bottomZ = splitLevels[i];
    const topZ = splitLevels[i + 1];
    if (!(topZ > bottomZ + GEOMETRY_EPSILON)) {
      continue;
    }

    const leftSolid = (bottomZ >= leftSector.floor - GEOMETRY_EPSILON) && (topZ <= leftSector.ceil + GEOMETRY_EPSILON);
    const rightSolid = (bottomZ >= rightSector.floor - GEOMETRY_EPSILON) && (topZ <= rightSector.ceil + GEOMETRY_EPSILON);
    const intervalDebug = seamDebugResolution
      ? {
        intervalIndex: i,
        bottomZ,
        topZ,
        leftSolid,
        rightSolid,
        skipped: false,
        skipReason: null,
        emitted: []
      }
      : null;

    if (!leftSolid && !rightSolid) {
      if (intervalDebug) {
        intervalDebug.skipped = true;
        intervalDebug.skipReason = 'neither-solid';
        seamDebugResolution.skippedIntervalsCount += 1;
        seamDebugResolution.intervals.push(intervalDebug);
      }
      continue;
    }

    const intervalInsidePortalOpening = (
      treatAsPortal
      && leftSolid
      && rightSolid
      && portalLeft.isOpen
      && bottomZ >= (portalLeft.openBottom - GEOMETRY_EPSILON)
      && topZ <= (portalLeft.openTop + GEOMETRY_EPSILON)
    );

    if (intervalInsidePortalOpening) {
      if (intervalDebug) {
        intervalDebug.skipped = true;
        intervalDebug.skipReason = 'portal-opening';
        seamDebugResolution.skippedIntervalsCount += 1;
        seamDebugResolution.intervals.push(intervalDebug);
      }
      continue;
    }

    if (leftSolid && rightSolid && !treatAsPortal) {
      const leftSourceSegment = getEntryIntervalSegment(left);
      const rightSourceSegment = getEntryIntervalSegment(right);
      const leftSegment = offsetWallTowardsSectorInterior(
        {
          ...left,
          intervalSegment: leftSourceSegment
        },
        SHARED_SOLID_SURFACE_OFFSET
      );
      const rightSegment = offsetWallTowardsSectorInterior(
        {
          ...right,
          intervalSegment: rightSourceSegment
        },
        SHARED_SOLID_SURFACE_OFFSET
      );
      const leftPrimitive = emitFromEntry({
        entry: left,
        otherSector: rightSector,
        kind: 'solid',
        bottomZ,
        topZ,
        spanIdSuffix: `shared-left-${i}`,
        segment: leftSegment
      });
      const rightPrimitive = emitFromEntry({
        entry: right,
        otherSector: leftSector,
        kind: 'solid',
        bottomZ,
        topZ,
        spanIdSuffix: `shared-right-${i}`,
        segment: rightSegment
      });
      if (leftPrimitive) {
        leftPrimitive.sharedSolidOffset = true;
        leftPrimitive.sourceA = leftSourceSegment.a;
        leftPrimitive.sourceB = leftSourceSegment.b;
      }

      if (rightPrimitive) {
        rightPrimitive.sharedSolidOffset = true;
        rightPrimitive.sourceA = rightSourceSegment.a;
        rightPrimitive.sourceB = rightSourceSegment.b;
      }
      const leftStartCap = emitOffsetEndCap({
        emitFromEntry,
        entry: left,
        otherSector: rightSector,
        bottomZ,
        topZ,
        sourcePoint: leftSourceSegment.a,
        offsetPoint: leftSegment.a,
        spanIdSuffix: `shared-left-${i}-cap-start`
      });
      const leftEndCap = emitOffsetEndCap({
        emitFromEntry,
        entry: left,
        otherSector: rightSector,
        bottomZ,
        topZ,
        sourcePoint: leftSourceSegment.b,
        offsetPoint: leftSegment.b,
        spanIdSuffix: `shared-left-${i}-cap-end`
      });
      const rightStartCap = emitOffsetEndCap({
        emitFromEntry,
        entry: right,
        otherSector: leftSector,
        bottomZ,
        topZ,
        sourcePoint: rightSourceSegment.a,
        offsetPoint: rightSegment.a,
        spanIdSuffix: `shared-right-${i}-cap-start`
      });
      const rightEndCap = emitOffsetEndCap({
        emitFromEntry,
        entry: right,
        otherSector: leftSector,
        bottomZ,
        topZ,
        sourcePoint: rightSourceSegment.b,
        offsetPoint: rightSegment.b,
        spanIdSuffix: `shared-right-${i}-cap-end`
      });

      for (const capPrimitive of [leftStartCap, leftEndCap, rightStartCap, rightEndCap]) {
        if (!capPrimitive) {
          continue;
        }
        capPrimitive.sharedSolidOffsetCap = true;
      }
      if (leftStartCap) {
        leftStartCap.sourceA = leftSourceSegment.a;
        leftStartCap.sourceB = leftSegment.a;
      }
      if (leftEndCap) {
        leftEndCap.sourceA = leftSegment.b;
        leftEndCap.sourceB = leftSourceSegment.b;
      }
      if (rightStartCap) {
        rightStartCap.sourceA = rightSourceSegment.a;
        rightStartCap.sourceB = rightSegment.a;
      }
      if (rightEndCap) {
        rightEndCap.sourceA = rightSegment.b;
        rightEndCap.sourceB = rightSourceSegment.b;
      }
      if (intervalDebug) {
        const emittedSharedPrimitives = [
          leftPrimitive,
          rightPrimitive,
          leftStartCap,
          leftEndCap,
          rightStartCap,
          rightEndCap
        ];
        for (const primitive of emittedSharedPrimitives) {
          if (!primitive) {
            continue;
          }
          intervalDebug.emitted.push({
            primitiveId: primitive.id,
            kind: 'solid',
            sourceSectorId: primitive.ownerSectorId,
            sourceWallIndex: primitive.ownerWallIndex,
            material: primitive.material
          });
        }
        seamDebugResolution.emittedIntervalsCount += intervalDebug.emitted.length;
        seamDebugResolution.intervals.push(intervalDebug);
      }
      continue;
    }

    const emittingEntry = leftSolid ? left : right;
    const otherSector = leftSolid ? rightSector : leftSector;
    const portalFromEmitter = leftSolid ? portalLeft : portalRight;
    let kind = 'solid';
    if (treatAsPortal) {
      if (portalFromEmitter.hasUpperBand && bottomZ >= (portalFromEmitter.openTop - GEOMETRY_EPSILON)) {
        kind = 'portal_upper';
      } else if (portalFromEmitter.hasLowerBand && topZ <= (portalFromEmitter.openBottom + GEOMETRY_EPSILON)) {
        kind = 'portal_lower';
      }
    }

    const emittedPrimitive = emitFromEntry({
      entry: emittingEntry,
      otherSector,
      kind,
      bottomZ,
      topZ,
      spanIdSuffix: `interval-${i}`
    });
    if (emittedPrimitive && kind !== 'solid') {
      emittedPortalBand = true;
    }
    if (intervalDebug) {
      if (emittedPrimitive) {
        intervalDebug.emitted.push({
          primitiveId: emittedPrimitive.id,
          kind,
          sourceSectorId: emittingEntry.sector.id,
          sourceWallIndex: emittingEntry.index,
          material: emittedPrimitive.material
        });
        seamDebugResolution.emittedIntervalsCount += 1;
      } else {
        intervalDebug.skipped = true;
        intervalDebug.skipReason = 'emit-failed';
        seamDebugResolution.skippedIntervalsCount += 1;
      }
      seamDebugResolution.intervals.push(intervalDebug);
    }
  }

  if (treatAsPortal && portalLeft.isOpen) {
    emitPortalTrimPrimitivesForSeam({
      walls,
      seamKey,
      seamParticipants,
      entry: left,
      otherSector: rightSector,
      trimMaterial,
      openingBottomZ: portalLeft.openBottom,
      openingTopZ: portalLeft.openTop,
      ...getEntryTrimEndpointExposure(left, portalTrimEndpointExposure),
      seamDebugResolution
    });

    emitPortalTrimPrimitivesForSeam({
      walls,
      seamKey,
      seamParticipants,
      entry: right,
      otherSector: leftSector,
      trimMaterial,
      openingBottomZ: portalRight.openBottom,
      openingTopZ: portalRight.openTop,
      ...getEntryTrimEndpointExposure(right, portalTrimEndpointExposure),
      seamDebugResolution
    });
  }

  if (treatAsPortal && !emittedPortalBand) {
    stats.fullyOpenPortalsSkipped += 1;
  }

  if (seamDebugResolution) {
    seamDebugState.resolution = seamDebugResolution;
  }
}

/** Resolves all seams into emitted wall primitives, including portal bands and optional portal trim. */
export function resolveWallPrimitivesFromSeams({
  seamWallsByKey,
  sectorById,
  portalOpeningByWallRef,
  stats,
  seamDebugState
}) {
  const walls = [];
  const portalTrimEndpointExposureBySeamKey = preparePortalTrimEndpointExposure(
    seamWallsByKey,
    sectorById,
    portalOpeningByWallRef
  );

  for (const seamEntries of seamWallsByKey.values()) {
    const seamKey = seamEntries[0]?.seamKey ?? null;
    resolveWallSpansForSeam({
      walls,
      sectorById,
      seamKey,
      seamEntries,
      portalOpeningByWallRef,
      portalTrimEndpointExposure: portalTrimEndpointExposureBySeamKey.get(seamKey) ?? null,
      stats,
      seamDebugState
    });
  }

  return walls;
}
