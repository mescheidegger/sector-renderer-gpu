import assert from 'node:assert/strict';
import test from 'node:test';

import { TEXTURED_FRAGMENT_SHADER } from '../src/webgl/shaders/texturedShaders.js';
import { resolveTextureSampling } from '../src/webgl/textures/createTextureRegistry.js';
import { WebGLRendererHost } from '../src/webgl/WebGLRendererHost.js';

test('NPOT repeat keeps both axes repeatable while POT repeat stays on hardware wrapping', () => {
  assert.deepEqual(resolveTextureSampling({ width: 128, height: 112, wrap: 'repeat' }), {
    wrap: 'repeat', gpuWrap: 'clamp', repeatMode: 'shader', useMipmaps: false
  });
  assert.deepEqual(resolveTextureSampling({ width: 128, height: 128, wrap: 'repeat' }), {
    wrap: 'repeat', gpuWrap: 'repeat', repeatMode: 'hardware', useMipmaps: true
  });
  assert.deepEqual(resolveTextureSampling({ width: 128, height: 128, wrap: 'clamp' }), {
    wrap: 'clamp', gpuWrap: 'clamp', repeatMode: 'none', useMipmaps: true
  });
});

test('NPOT repeat shader wraps and linearly combines texels across U and V seams', () => {
  assert.match(TEXTURED_FRAGMENT_SHADER, /texelPosition = uv \* uTextureSize - vec2\(0\.5\)/);
  assert.match(TEXTURED_FRAGMENT_SHADER, /first = mod\(texelBase, uTextureSize\)/);
  assert.match(TEXTURED_FRAGMENT_SHADER, /second = mod\(texelBase \+ vec2\(1\.0\), uTextureSize\)/);
  assert.match(TEXTURED_FRAGMENT_SHADER, /vec2\(secondUv\.x, firstUv\.y\)/);
  assert.match(TEXTURED_FRAGMENT_SHADER, /vec2\(firstUv\.x, secondUv\.y\)/);
  assert.match(TEXTURED_FRAGMENT_SHADER, /texelBlend\.x[\s\S]*texelBlend\.y/);

  // The shader's mod-based texel addressing is periodic for positive and negative
  // coordinates instead of converging on either clamped edge.
  const wrappedTexel = (coordinate, size) => {
    const base = Math.floor((coordinate * size) - 0.5);
    return ((base % size) + size) % size;
  };
  for (const size of [128, 112]) {
    assert.equal(wrappedTexel(2.25, size), wrappedTexel(0.25, size));
    assert.equal(wrappedTexel(-1.25, size), wrappedTexel(0.75, size));
    assert.notEqual(wrappedTexel(2.25, size), size - 1);
    assert.notEqual(wrappedTexel(-1.25, size), 0);
  }
});

test('draw-time sampling uniforms enable emulation only for NPOT repeat records', () => {
  const calls = [];
  const host = Object.create(WebGLRendererHost.prototype);
  Object.assign(host, {
    gl: {
      uniform1f(location, value) { calls.push(['uniform1f', location, value]); },
      uniform2f(location, x, y) { calls.push(['uniform2f', location, x, y]); }
    },
    uniformLocations: { emulateRepeat: 'repeat', textureSize: 'size' }
  });

  host.setTextureSampling({ repeatMode: 'shader', uploadWidth: 128, uploadHeight: 112 });
  host.setTextureSampling({ repeatMode: 'hardware', uploadWidth: 128, uploadHeight: 128 });
  host.setTextureSampling({ repeatMode: 'none', uploadWidth: 64, uploadHeight: 32 });

  assert.deepEqual(calls, [
    ['uniform1f', 'repeat', 1],
    ['uniform2f', 'size', 128, 112],
    ['uniform1f', 'repeat', 0],
    ['uniform1f', 'repeat', 0]
  ]);
});
