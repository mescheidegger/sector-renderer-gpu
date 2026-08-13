/**
 * Module: Uploads packed mesh arrays into GPU buffers and returns handles plus draw grouping metadata.
 */
export function createGpuMeshBuffers(gl, mesh) {
  const vertexBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, mesh.vertices, gl.STATIC_DRAW);

  const indexBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);

  return {
    vertexBuffer,
    indexBuffer,
    indexCount: mesh.indices.length,
    groups: mesh.groups ?? []
  };
}
