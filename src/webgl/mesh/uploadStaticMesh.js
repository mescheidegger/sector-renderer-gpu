/**
 * Module: Thin adapter around mesh buffer upload for clearer call sites.
 */
import { createGpuMeshBuffers } from './createGpuMeshBuffers.js';

/** Uploads a static mesh into GPU buffers and returns draw metadata. */
export function uploadStaticMesh(gl, mesh) {
  return createGpuMeshBuffers(gl, mesh);
}
