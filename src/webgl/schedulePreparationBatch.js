// Run GPU work in a task after a rendering opportunity. Unlike a microtask-only
// yield, this allows both paint and input between batches. Hidden documents do
// not receive animation frames, so use tasks there as well.
export function schedulePreparationBatch(callback) {
  let frame = null;
  let timer = null;
  let cancelled = false;
  const run = () => { if (!cancelled) callback(); };
  if (typeof requestAnimationFrame === 'function' && globalThis.document?.visibilityState !== 'hidden') {
    frame = requestAnimationFrame(() => { timer = setTimeout(run, 0); });
  } else {
    timer = setTimeout(run, 0);
  }
  return () => {
    cancelled = true;
    if (frame !== null) cancelAnimationFrame(frame);
    if (timer !== null) clearTimeout(timer);
  };
}
