/**
 * Module: Creates and validates the WebGL context with renderer-specific options.
 */
export function createWebGLContext(canvas) {
  const gl = canvas.getContext('webgl', {
    alpha: false,
    antialias: false,
    depth: true,
    stencil: false,
    premultipliedAlpha: false
  });

  if (!gl) {
    throw new Error('WebGL is not supported by this browser/runtime.');
  }

  return gl;
}
