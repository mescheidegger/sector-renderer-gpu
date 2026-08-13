/**
 * Module: Primary textured shader sources used by the GPU renderer.
 */
export const TEXTURED_VERTEX_SHADER = `
attribute vec3 aPosition;
attribute vec2 aUv;
attribute vec4 aColor;
attribute float aLightLevel;
uniform mat4 uViewProjection;
varying vec2 vUv;
varying vec4 vColor;
varying float vLightLevel;

void main() {
  gl_Position = uViewProjection * vec4(aPosition, 1.0);
  vUv = aUv;
  vColor = aColor;
  vLightLevel = aLightLevel;
}
`;

export const TEXTURED_FRAGMENT_SHADER = `
precision mediump float;
varying vec2 vUv;
varying vec4 vColor;
varying float vLightLevel;
uniform sampler2D uTexture;
uniform float uUseTexture;

void main() {
  vec4 tex = texture2D(uTexture, vUv);
  vec4 texturedColor = vec4(tex.rgb, tex.a * vColor.a);
  vec4 baseColor = mix(vColor, texturedColor, uUseTexture);

  gl_FragColor = vec4(baseColor.rgb * vLightLevel, baseColor.a);
}
`;
