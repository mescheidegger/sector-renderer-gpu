import assert from 'node:assert/strict';

export function assertValidSceneWalls(walls) {
  for (const wall of walls) {
    assert.ok(wall.topZ > wall.bottomZ, `${wall.id} must have positive height`);
    for (const key of ['x0', 'y0', 'x1', 'y1', 'bottomZ', 'topZ']) {
      assert.ok(Number.isFinite(wall[key]), `${wall.id}.${key} must be finite`);
    }
  }
}

export function assertValidMesh({ mesh, stats }) {
  assert.ok(mesh.vertices.length > 0, 'mesh should contain packed vertices');
  assert.ok(mesh.indices.length > 0, 'mesh should contain indices');
  assert.equal(mesh.vertices.length % 10, 0, 'vertices use the 10-float layout');
  assert.equal(mesh.indices.length % 3, 0, 'indices describe complete triangles');
  assert.equal(stats.vertexCount, mesh.vertices.length / 10);
  assert.equal(stats.indexCount, mesh.indices.length);
  assert.equal(
    stats.wallTriangles + stats.floorTriangles + stats.ceilingTriangles,
    mesh.indices.length / 3
  );
  assert.ok([...mesh.vertices].every(Number.isFinite), 'positions, UVs, colors, and lights must be finite');
  assert.ok([...mesh.indices].every((index) => index >= 0 && index < stats.vertexCount), 'indices must address vertices');
  assert.equal(mesh.groups.reduce((sum, group) => sum + group.indexCount, 0), mesh.indices.length);
  for (const group of mesh.groups) {
    assert.equal(group.startIndex % 3, 0);
    assert.equal(group.indexCount % 3, 0);
  }
}
