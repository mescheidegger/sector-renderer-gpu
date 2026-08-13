import assert from 'node:assert/strict';
import test from 'node:test';

import { assertTextureProvider } from '../src/textureProvider.js';

test('assertTextureProvider accepts the normalized provider contract', () => {
  const provider = { getTextureKeys: () => [], getTexture: () => null };
  assert.equal(assertTextureProvider(provider), provider);
});

test('assertTextureProvider reports every missing required method', () => {
  assert.throws(
    () => assertTextureProvider({ getTexture: () => null }),
    /missing methods: getTextureKeys/
  );
  assert.throws(
    () => assertTextureProvider({ getTextureKeys: () => [] }),
    /missing methods: getTexture/
  );
});

test('assertTextureProvider rejects null and non-object providers', () => {
  assert.throws(() => assertTextureProvider(null), /textureProvider is required/);
  assert.throws(() => assertTextureProvider('textures'), /textureProvider is required/);
});
