function effectiveFloor(sector, getFloorZ) {
  const floor = getFloorZ?.(sector?.id) ?? sector?.floor;
  if (!Number.isFinite(floor)) {
    throw new TypeError('[containedSolidSpan] Contained solid floors must be finite.');
  }
  return floor;
}

/**
 * Resolves the physical interval occupied by a contained sector. Legacy
 * children use the interval between the effective parent and child floors
 * (including their historical dynamically inverted case); explicitly
 * elevated children begin at their fixed solidBottomZ.
 */
export function getContainedSolidSpan({ parentSector, childSector, getFloorZ = null }) {
  if (!parentSector || !childSector) {
    throw new TypeError('[containedSolidSpan] parentSector and childSector are required.');
  }

  const childFloorZ = effectiveFloor(childSector, getFloorZ);
  const hasExplicitBottom = childSector.solidBottomZ !== undefined;
  const parentFloorZ = hasExplicitBottom ? null : effectiveFloor(parentSector, getFloorZ);
  // Legacy moving parents have always been allowed to cross a contained
  // child's authored floor. Keep that renderer/collision interval normalized;
  // explicit elevated solids retain their authored lower-to-upper ordering.
  const bottomZ = hasExplicitBottom
    ? childSector.solidBottomZ
    : Math.min(parentFloorZ, childFloorZ);
  const topZ = hasExplicitBottom
    ? childFloorZ
    : Math.max(parentFloorZ, childFloorZ);

  if (!Number.isFinite(bottomZ)) {
    throw new TypeError('[containedSolidSpan] Contained solid bottom must be finite.');
  }
  if (bottomZ > topZ) {
    throw new RangeError(
      `[containedSolidSpan] Contained solid bottom ${bottomZ} must be <= top ${topZ}.`
    );
  }

  return { bottomZ, topZ };
}
