import test from 'node:test';
import assert from 'node:assert/strict';

import { buildGpuScene } from '../src/buildGpuScene.js';
import { buildStaticMeshFromGpuScene } from '../src/webgl/mesh/buildStaticMeshFromGpuScene.js';
import { assertValidMesh } from './assertGeometry.js';
import { singleSectorMap } from './fixtures/syntheticMaps.js';

test('packs a compiled rectangular sector into a finite, internally consistent mesh', () => {
  const result = buildStaticMeshFromGpuScene(buildGpuScene(singleSectorMap()));

  assertValidMesh(result);
  assert.equal(result.stats.wallTriangles, 8);
  assert.equal(result.stats.floorTriangles, 2);
  assert.equal(result.stats.ceilingTriangles, 2);
  assert.equal(result.stats.vertexCount, 36);
  assert.equal(result.stats.indexCount, 36);
  assert.equal(result.mesh.groups.length, 3);
});

test('groups shared material triangles and separates distinct material keys', () => {
  const scene = buildGpuScene(singleSectorMap());
  scene.walls[1].material = { key: 'wall-b', surfaceType: 'wall' };
  const result = buildStaticMeshFromGpuScene(scene);
  const byMaterial = new Map(result.mesh.groups.map((group) => [group.materialKey, group]));

  assertValidMesh(result);
  assert.equal(byMaterial.get('wall-a').indexCount, 18, 'three wall-a surfaces share one group');
  assert.equal(byMaterial.get('wall-b').indexCount, 6, 'the distinct wall gets its own group');
  assert.equal(result.stats.wallMaterialCount, 2);
  assert.equal(result.stats.texturedGroupCount, 4);
});

test('packs missing materials into one valid fallback group', () => {
  const map = singleSectorMap({ wallMaterial: null, floorMaterial: null });
  delete map.sectors[0].ceilingMaterial;
  const scene = buildGpuScene(map);
  const result = buildStaticMeshFromGpuScene(scene);

  assertValidMesh(result);
  assert.equal(result.mesh.groups.length, 1);
  assert.equal(result.mesh.groups[0].materialKey, null);
  assert.equal(result.mesh.groups[0].indexCount, result.mesh.indices.length);
  assert.equal(result.stats.texturedGroupCount, 0);
});

test('separates sky and world projection groups using the same material', () => {
  const map = singleSectorMap({ floorMaterial: 'shared' });
  map.sectors[0].ceilingMaterial = 'shared';
  map.sectors[0].ceilingProjection = 'sky';
  const result = buildStaticMeshFromGpuScene(buildGpuScene(map));
  const shared = result.mesh.groups.filter((group) => group.materialKey === 'shared');

  assert.deepEqual(shared.map((group) => group.projection).sort(), ['sky', 'world']);
  assert.equal(shared.reduce((count, group) => count + group.indexCount, 0), 12);
});

test('authored world ceiling UVs remain planar when projection is omitted or world', () => {
  const omitted = buildStaticMeshFromGpuScene(buildGpuScene(singleSectorMap()));
  const explicitMap = singleSectorMap();
  explicitMap.sectors[0].ceilingProjection = 'world';
  const explicit = buildStaticMeshFromGpuScene(buildGpuScene(explicitMap));

  assert.deepEqual(explicit.mesh.vertices, omitted.mesh.vertices);
  assert.deepEqual(explicit.mesh.indices, omitted.mesh.indices);
  assert.equal(explicit.mesh.groups.find((group) => group.surfaceType === 'ceiling').projection, 'world');
});
