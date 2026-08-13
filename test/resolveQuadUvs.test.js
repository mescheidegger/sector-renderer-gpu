import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveQuadUvs } from '../src/webgl/resolveQuadUvs.js';

const uvRect = { u0: 0.25, v0: 0.125, u1: 0.75, v1: 0.625 };

test('default quad UVs respect the atlas rectangle', () => {
  assert.deepEqual(resolveQuadUvs({ uvRect }), [
    [0.25, 0.625], [0.75, 0.625], [0.75, 0.125], [0.25, 0.125]
  ]);
});

test('flipX reverses automatic horizontal sampling only', () => {
  assert.deepEqual(resolveQuadUvs({ uvRect, flipX: true }), [
    [0.75, 0.625], [0.25, 0.625], [0.25, 0.125], [0.75, 0.125]
  ]);
});

test('flipV reverses automatic vertical sampling only', () => {
  assert.deepEqual(resolveQuadUvs({ uvRect, flipV: true }), [
    [0.25, 0.125], [0.75, 0.125], [0.75, 0.625], [0.25, 0.625]
  ]);
});

test('flipX and flipV reverse both automatic sampling axes', () => {
  assert.deepEqual(resolveQuadUvs({ uvRect, flipX: true, flipV: true }), [
    [0.75, 0.125], [0.25, 0.125], [0.25, 0.625], [0.75, 0.625]
  ]);
});

test('custom UVs remain authoritative when flips are requested', () => {
  const custom = [[0.1, 0.2], [0.3, 0.4], [0.5, 0.6], [0.7, 0.8]];
  assert.equal(resolveQuadUvs({ uvRect, uvs: custom, flipX: true, flipV: true }), custom);
});
