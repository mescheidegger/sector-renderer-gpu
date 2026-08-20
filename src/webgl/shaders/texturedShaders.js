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
varying vec3 vWorldPosition;

void main() {
  gl_Position = uViewProjection * vec4(aPosition, 1.0);
  vUv = aUv;
  vColor = aColor;
  vLightLevel = aLightLevel;
  vWorldPosition = aPosition;
}
`;

export const TEXTURED_FRAGMENT_SHADER = `
precision mediump float;
varying vec2 vUv;
varying vec4 vColor;
varying float vLightLevel;
varying vec3 vWorldPosition;
uniform sampler2D uTexture;
uniform float uUseTexture;
uniform float uSkyProjection;
uniform vec3 uCameraPosition;
uniform float uCameraYaw;

void main() {
  vec3 viewDirection = normalize(vWorldPosition - uCameraPosition);
  const float PI = 3.141592653589793;
  float worldAzimuth = atan(viewDirection.x, viewDirection.y);
  float relativeAzimuth = atan(
    sin(worldAzimuth - uCameraYaw),
    cos(worldAzimuth - uCameraYaw)
  );
  vec2 skyUv = vec2(
    (uCameraYaw + relativeAzimuth) / (2.0 * PI),
    0.5 + atan(viewDirection.z, length(viewDirection.xy)) / PI
  );
  vec4 tex = texture2D(uTexture, mix(vUv, skyUv, uSkyProjection));
  vec4 texturedColor = vec4(tex.rgb, tex.a * vColor.a);
  vec4 baseColor = mix(vColor, texturedColor, uUseTexture);

  gl_FragColor = vec4(baseColor.rgb * vLightLevel, baseColor.a);
}
`;
