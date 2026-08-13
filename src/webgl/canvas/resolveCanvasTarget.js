/** Resolves the renderer's mutually exclusive caller-owned or container-owned canvas target. */
export function resolveCanvasTarget({ canvas = null, container = null }) {
  const hasCanvas = canvas != null;
  const hasContainer = container != null;

  if (hasCanvas === hasContainer) {
    throw new Error('[SectorRenderer] Provide exactly one rendering target: canvas or container.');
  }

  if (hasCanvas) {
    if (typeof canvas.getContext !== 'function') throw new TypeError('[SectorRenderer] canvas must expose getContext().');
    return { canvas, ownsCanvas: false, ownerContainer: null };
  }

  if (typeof container?.ownerDocument?.createElement !== 'function' || typeof container?.appendChild !== 'function') throw new TypeError('[SectorRenderer] container must expose ownerDocument.createElement() and appendChild().');
  const createdCanvas = container.ownerDocument.createElement('canvas');
  createdCanvas.style.display = 'block';
  container.appendChild(createdCanvas);
  return { canvas: createdCanvas, ownsCanvas: true, ownerContainer: container };
}

/** Removes a renderer-created canvas when it remains attached to its original container. */
export function cleanupCanvasTarget({ canvas, ownsCanvas, ownerContainer }) {
  if (ownsCanvas && canvas?.parentNode === ownerContainer) {
    ownerContainer.removeChild(canvas);
  }
}
