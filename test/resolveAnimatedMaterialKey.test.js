import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveAnimatedMaterialKey, validateMaterialAnimations } from '../src/materials/resolveAnimatedMaterialKey.js';

const definition = { materialKey: 'virtual', frames: ['a', 'b', 'c'], frameDurationSeconds: 0.5 };
const animations = new Map([['virtual', definition]]);

test('resolves deterministic boundaries, wrapping, and omitted time', () => {
  assert.equal(resolveAnimatedMaterialKey('virtual', undefined, animations), 'a');
  assert.equal(resolveAnimatedMaterialKey('virtual', 0.4999, animations), 'a');
  assert.equal(resolveAnimatedMaterialKey('virtual', 0.5, animations), 'b');
  assert.equal(resolveAnimatedMaterialKey('virtual', 1.5, animations), 'a');
  assert.equal(resolveAnimatedMaterialKey('ordinary', 10, animations), 'ordinary');
});

test('validates definitions and texture frame availability', () => {
  const provider = { getTextureKeys: () => ['a', 'b', 'c'] };
  assert.equal(validateMaterialAnimations([definition], provider).get('virtual'), definition);
  for (const invalid of [
    [{ ...definition, materialKey: '' }],
    [definition, definition],
    [{ ...definition, frames: ['a'] }],
    [{ ...definition, frames: ['a', ''] }],
    [{ ...definition, frameDurationSeconds: 0 }],
    [{ ...definition, frames: ['a', 'missing'] }]
  ]) assert.throws(() => validateMaterialAnimations(invalid, provider), /SectorRenderer/);
});
