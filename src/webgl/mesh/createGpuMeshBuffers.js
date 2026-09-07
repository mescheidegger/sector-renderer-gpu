/**
 * Module: Uploads packed mesh arrays into GPU buffers and returns handles plus draw grouping metadata.
 */
import { clearWebGLErrors, throwIfWebGLError } from '../webGLErrors.js';

function uploadBuffer(gl, target, buffer, data, usage, label) {
  clearWebGLErrors(gl);
  try {
    gl.bindBuffer(target, buffer);
    gl.bufferData(target, data, usage);
  } catch (error) {
    throw new Error(
      `[SectorRenderer] ${label} GPU upload failed: ${error?.message ?? error}`,
      { cause: error }
    );
  }
  throwIfWebGLError(gl, `${label} GPU upload`);
}

export function createGpuMeshBuffers(gl, mesh) {
  let vertexBuffer = null;
  let indexBuffer = null;

  try {
    vertexBuffer = gl.createBuffer();
    if (!vertexBuffer) {
      throw new Error('[SectorRenderer] Vertex buffer allocation failed.');
    }
    uploadBuffer(gl, gl.ARRAY_BUFFER, vertexBuffer, mesh.vertices, gl.STATIC_DRAW, 'Vertex-buffer');

    indexBuffer = gl.createBuffer();
    if (!indexBuffer) {
      throw new Error('[SectorRenderer] Index buffer allocation failed.');
    }
    uploadBuffer(gl, gl.ELEMENT_ARRAY_BUFFER, indexBuffer, mesh.indices, gl.STATIC_DRAW, 'Index-buffer');

    return {
      vertexBuffer,
      indexBuffer,
      indexCount: mesh.indices.length,
      groups: mesh.groups ?? []
    };
  } catch (error) {
    if (indexBuffer) gl.deleteBuffer(indexBuffer);
    if (vertexBuffer) gl.deleteBuffer(vertexBuffer);
    throw error;
  }
}
