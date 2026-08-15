import test from 'node:test';
import assert from 'node:assert/strict';

import { writeQuadVertices } from '../src/webgl/WebGLRendererHost.js';

const QUAD = Object.freeze({
  corners: [[0, 0, 1], [1, 0, 1], [1, 0, 0], [0, 0, 0]],
  uvs: [[0, 1], [1, 1], [1, 0], [0, 0]]
});

function vertexLightLevels(options = {}) {
  const vertices = [];
  writeQuadVertices(vertices, { ...QUAD, ...options });
  return [9, 19, 29, 39].map((index) => vertices[index]);
}

test('dynamic world quad vertices default omitted lightLevel to one', () => {
  assert.deepEqual(vertexLightLevels(), [1, 1, 1, 1]);
});

test('dynamic world quad vertices preserve an authored non-one lightLevel', () => {
  assert.deepEqual(vertexLightLevels({ lightLevel: 0.65 }), [0.65, 0.65, 0.65, 0.65]);
});
