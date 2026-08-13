/**
 * Module: Applies default global WebGL state (depth, blend, clear settings) expected by this renderer.
 */
export function configureWebGLState(gl) {
  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LEQUAL);
  gl.disable(gl.CULL_FACE);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.clearColor(0.03, 0.03, 0.05, 1);
  gl.clearDepth(1);
}
