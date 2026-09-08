import assert from 'node:assert/strict';
import test from 'node:test';

import { assertRendererTextureRecord, assertTextureProvider } from '../src/textureProvider.js';

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

test('assertRendererTextureRecord validates explicit wrap intent and full-image repeat records', () => {
  const record = {
    image: {}, uploadKey: 'wall', wrap: 'repeat',
    uvRect: { u0: 0, v0: 0, u1: 1, v1: 1 }, width: 128, height: 112
  };
  assert.equal(assertRendererTextureRecord(record), record);
  assert.throws(() => assertRendererTextureRecord({ ...record, wrap: 'mirror' }), /wrap.*clamp.*repeat/);
  assert.throws(
    () => assertRendererTextureRecord({ ...record, uvRect: { u0: 0.25, v0: 0, u1: 0.5, v1: 1 } }),
    /Repeating texture.*full-image/
  );
});
