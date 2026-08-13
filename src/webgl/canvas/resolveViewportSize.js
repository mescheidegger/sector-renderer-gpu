/** Resolves logical viewport input into deterministic backing-store dimensions. */
export function resolveViewportSize(width, height, pixelRatio = 1) {
  if (!Number.isFinite(width) || width <= 0) throw new RangeError('[SectorRenderer] viewport width must be finite and positive.');
  if (!Number.isFinite(height) || height <= 0) throw new RangeError('[SectorRenderer] viewport height must be finite and positive.');
  const resolvedPixelRatio = Number.isFinite(pixelRatio) && pixelRatio > 0 ? pixelRatio : 1;
  return {
    width,
    height,
    pixelRatio: resolvedPixelRatio,
    pixelWidth: Math.max(1, Math.floor(width * resolvedPixelRatio)),
    pixelHeight: Math.max(1, Math.floor(height * resolvedPixelRatio))
  };
}
