export function validateMaterialAnimations(materialAnimations = [], textureProvider = null) {
  if (!Array.isArray(materialAnimations)) {
    throw new TypeError('[SectorRenderer] materialAnimations must be an array.');
  }
  const seen = new Set();
  const available = textureProvider ? new Set(textureProvider.getTextureKeys()) : null;
  for (const [index, animation] of materialAnimations.entries()) {
    const key = animation?.materialKey;
    if (typeof key !== 'string' || key.length === 0) {
      throw new TypeError(`[SectorRenderer] Material animation at index ${index} materialKey must be a non-empty string.`);
    }
    if (seen.has(key)) throw new TypeError(`[SectorRenderer] Duplicate material animation key "${key}".`);
    seen.add(key);
    if (!Array.isArray(animation.frames) || animation.frames.length < 2
      || animation.frames.some((frame) => typeof frame !== 'string' || frame.length === 0)) {
      throw new TypeError(`[SectorRenderer] Material animation "${key}" requires at least two non-empty frame keys.`);
    }
    if (!Number.isFinite(animation.frameDurationSeconds) || animation.frameDurationSeconds <= 0) {
      throw new TypeError(`[SectorRenderer] Material animation "${key}" frameDurationSeconds must be positive and finite.`);
    }
    if (available) {
      for (const frame of animation.frames) {
        if (!available.has(frame)) throw new TypeError(`[SectorRenderer] Material animation "${key}" references missing texture frame "${frame}".`);
      }
    }
  }
  return new Map(materialAnimations.map((animation) => [animation.materialKey, animation]));
}

export function resolveAnimatedMaterialKey(materialKey, timeSeconds = 0, animationsByKey = new Map()) {
  const animation = animationsByKey.get(materialKey);
  if (!animation) return materialKey;
  const frameIndex = Math.floor(timeSeconds / animation.frameDurationSeconds) % animation.frames.length;
  return animation.frames[frameIndex];
}
