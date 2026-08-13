/**
 * Module: Normalizes authored sector light values into stable renderer-ready scalar values.
 */
const DEFAULT_SECTOR_LIGHT = 1;

export function resolveSectorLightLevel(sector) {
  const authored = sector?.lightLevel;

  if (!Number.isFinite(authored)) {
    return DEFAULT_SECTOR_LIGHT;
  }

  if (authored <= 1) {
    return Math.min(1, Math.max(0, authored));
  }

  return Math.min(1, Math.max(0, authored / 255));
}
