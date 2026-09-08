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
uniform float uAlphaMode;
uniform float uAlphaCutoff;
uniform float uEmulateRepeat;
uniform vec2 uTextureSize;

vec4 sampleTexture(vec2 uv) {
  if (uEmulateRepeat < 0.5) {
    return texture2D(uTexture, uv);
  }

  // WebGL1 forbids REPEAT on NPOT uploads. Sample the four wrapped texels
  // explicitly so LINEAR filtering remains continuous across both seams.
  vec2 texelPosition = uv * uTextureSize - vec2(0.5);
  vec2 texelBase = floor(texelPosition);
  vec2 texelBlend = fract(texelPosition);
  vec2 first = mod(texelBase, uTextureSize);
  vec2 second = mod(texelBase + vec2(1.0), uTextureSize);
  vec2 firstUv = (first + vec2(0.5)) / uTextureSize;
  vec2 secondUv = (second + vec2(0.5)) / uTextureSize;

  vec4 bottomLeft = texture2D(uTexture, firstUv);
  vec4 bottomRight = texture2D(uTexture, vec2(secondUv.x, firstUv.y));
  vec4 topLeft = texture2D(uTexture, vec2(firstUv.x, secondUv.y));
  vec4 topRight = texture2D(uTexture, secondUv);
  return mix(
    mix(bottomLeft, bottomRight, texelBlend.x),
    mix(topLeft, topRight, texelBlend.x),
    texelBlend.y
  );
}

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
  vec4 tex = sampleTexture(mix(vUv, skyUv, uSkyProjection));
  vec4 texturedColor = vec4(tex.rgb, tex.a * vColor.a);
  vec4 baseColor = mix(vColor, texturedColor, uUseTexture);

  float outputAlpha = baseColor.a;
  if (uAlphaMode < 0.5) {
    outputAlpha = 1.0;
  } else if (uAlphaMode < 1.5) {
    if (baseColor.a < uAlphaCutoff) discard;
    outputAlpha = 1.0;
  }

  gl_FragColor = vec4(baseColor.rgb * vLightLevel, outputAlpha);
}
`;
