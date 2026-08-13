/**
 * Module: Builds a single normalized debug payload that UI/debug tools can consume without knowing renderer internals.
 */
export function createGpuDebugSnapshot({
  sectorCount,
  authoredWallCount,
  wallPrimitiveCount,
  wallTriangleCount,
  floorTriangleCount,
  ceilingTriangleCount,
  wallMaterialCount,
  floorMaterialCount,
  ceilingMaterialCount,
  loadedTextureCount,
  totalTextureCount,
  texturedDrawCallCount,
  totalVertexCount,
  totalIndexCount,
  drawCallCount,
  buildMs,
  uploadInitMs,
  renderMs,
  seamDebug = null
}) {
  return {
    backend: 'gpu',
    gpu: {
      sectors: sectorCount,
      authoredWalls: authoredWallCount,
      wallPrimitives: wallPrimitiveCount,
      wallTriangles: wallTriangleCount,
      floorTriangles: floorTriangleCount,
      ceilingTriangles: ceilingTriangleCount,
      wallMaterials: wallMaterialCount,
      floorMaterials: floorMaterialCount,
      ceilingMaterials: ceilingMaterialCount,
      texturesLoaded: loadedTextureCount,
      texturesTotal: totalTextureCount,
      texturedDrawCalls: texturedDrawCallCount,
      totalVertices: totalVertexCount,
      totalIndices: totalIndexCount,
      drawCalls: drawCallCount,
      buildMs,
      uploadInitMs,
      renderMs,
      seamDebug
    }
  };
}
