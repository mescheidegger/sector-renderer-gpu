/** Narrow GL-error helpers for renderer-owned resource construction transactions. */

function getWebGLErrorName(gl, error) {
  const names = [
    ['INVALID_ENUM', gl.INVALID_ENUM],
    ['INVALID_VALUE', gl.INVALID_VALUE],
    ['INVALID_OPERATION', gl.INVALID_OPERATION],
    ['INVALID_FRAMEBUFFER_OPERATION', gl.INVALID_FRAMEBUFFER_OPERATION],
    ['OUT_OF_MEMORY', gl.OUT_OF_MEMORY],
    ['CONTEXT_LOST_WEBGL', gl.CONTEXT_LOST_WEBGL]
  ];
  return names.find(([, value]) => value === error)?.[0] ?? 'UNKNOWN_ERROR';
}

function drainWebGLErrors(gl) {
  if (typeof gl.getError !== 'function') return [];

  const errors = [];
  const noError = gl.NO_ERROR ?? 0;
  let error = gl.getError();
  while (error != null && error !== noError) {
    errors.push(error);
    error = gl.getError();
  }
  return errors;
}

/** Discards errors that predate a renderer-owned upload validation boundary. */
export function clearWebGLErrors(gl) {
  drainWebGLErrors(gl);
}

/** Throws a contextual renderer error when a resource operation recorded a GL error. */
export function throwIfWebGLError(gl, operation) {
  const errors = drainWebGLErrors(gl);
  if (errors.length === 0) return;

  const details = errors.map((error) => (
    `${getWebGLErrorName(gl, error)} (0x${error.toString(16).toUpperCase()})`
  )).join(', ');
  throw new Error(`[SectorRenderer] ${operation} failed: ${details}.`);
}
