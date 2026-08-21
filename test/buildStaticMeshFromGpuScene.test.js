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

test('floor UV origin produces a local zero-to-one span while omission stays world-aligned', () => {
  const map = singleSectorMap();
  map.sectors[0].vertices = map.sectors[0].vertices.map(({ x, y }) => ({ x: x + 45.2, y: y + 7.7 }));
  // Make the fixture exactly one world unit square.
  const minX = Math.min(...map.sectors[0].vertices.map(({ x }) => x));
  const minY = Math.min(...map.sectors[0].vertices.map(({ y }) => y));
  map.sectors[0].vertices = [{ x: minX, y: minY }, { x: minX + 1, y: minY }, { x: minX + 1, y: minY + 1 }, { x: minX, y: minY + 1 }];

  const absolute = buildStaticMeshFromGpuScene(buildGpuScene(map)).mesh;
  map.sectors[0].floorUvOrigin = { x: minX, y: minY };
  const local = buildStaticMeshFromGpuScene(buildGpuScene(map)).mesh;
  const floorUvs = (mesh) => {
    const group = mesh.groups.find(({ surfaceType }) => surfaceType === 'floor');
    return Array.from(mesh.indices.slice(group.startIndex, group.startIndex + group.indexCount), (index) => ({
      u: mesh.vertices[index * 10 + 3], v: mesh.vertices[index * 10 + 4]
    }));
  };
  const span = (values, key) => [Math.min(...values.map((uv) => uv[key])), Math.max(...values.map((uv) => uv[key]))];
  assert.deepEqual(span(floorUvs(local), 'u'), [0, 1]);
  assert.deepEqual(span(floorUvs(local), 'v'), [0, 1]);
  assert.ok(span(floorUvs(absolute), 'u')[0] > 45, 'omitted origin retains absolute-world U mapping');
  assert.ok(span(floorUvs(absolute), 'v')[0] > 7, 'omitted origin retains absolute-world V mapping');
});
