/**
 * Module: Normalizes authored light values into stable renderer-ready scalar values.
 */
const DEFAULT_LIGHT_LEVEL = 1;

export function normalizeLightLevel(authored) {
  if (!Number.isFinite(authored)) {
    return DEFAULT_LIGHT_LEVEL;
  }

  if (authored <= 1) {
    return Math.min(1, Math.max(0, authored));
  }

  return Math.min(1, Math.max(0, authored / 255));
}

export function resolveSectorLightLevel(sector) {
  return normalizeLightLevel(sector?.lightLevel);
}
