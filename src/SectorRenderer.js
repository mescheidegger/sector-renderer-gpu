/**
 * Module: High-level GPU renderer facade that builds scene geometry once, delegates drawing to WebGL, and keeps lightweight debug stats up to date.
 */
import { buildGpuScene } from './buildGpuScene.js';
import { createGpuDebugSnapshot } from './debug/createGpuDebugSnapshot.js';
import { assertTextureProvider } from './textureProvider.js';
import { buildStaticMeshFromGpuScene } from './webgl/mesh/buildStaticMeshFromGpuScene.js';
import { WebGLRendererHost } from './webgl/WebGLRendererHost.js';
import { assertRendererFrame } from './contracts.js';

/**
 * Browser/WebGL facade for a sector world and its per-frame presentation.
 * The instance owns its WebGL resources, but never owns a caller-provided canvas.
 */
export class SectorRenderer {
  /**
   * Creates a renderer, validates its provider/world, builds static geometry, and initializes WebGL.
   * Supply exactly one of `canvas` and `container`; a container receives a renderer-owned canvas.
   * @param {import('./contracts.js').SectorRendererOptions} options
   */
  constructor({
    world,
    canvas,
    container,
    width,
    height,
    pixelRatio = 1,
    projection,
    textureProvider = null,
    debug = null
  }) {
    this.debug = debug;
    this.world = world;

    assertTextureProvider(textureProvider);

    const sceneBuild = this.buildStaticScene(world);
    this.gpuScene = sceneBuild.gpuScene;

    this.host = new WebGLRendererHost({
      canvas,
      container,
      width,
      height,
      pixelRatio,
      projection,
      mesh: sceneBuild.mesh,
      textureProvider
    });

    this.meshStats = sceneBuild.meshStats;
    this.buildMs = sceneBuild.buildMs;

    this.debugSnapshot = this.createSnapshot({
      renderMs: 0,
      drawCallCount: sceneBuild.mesh.groups.length,
      texturedDrawCallCount: this.meshStats.texturedGroupCount
    });
  }

  buildStaticScene(world) {
    const gpuScene = buildGpuScene(world, {
      seamDebug: this.debug?.seam ?? null
    });

    const meshBuildStart = performance.now();
    const meshBuild = buildStaticMeshFromGpuScene(gpuScene);
    const meshBuildMs = performance.now() - meshBuildStart;

    return {
      gpuScene,
      mesh: meshBuild.mesh,
      meshStats: meshBuild.stats,
      buildMs: gpuScene.buildMs + meshBuildMs
    };
  }

  /**
   * Builds and uploads a replacement static world while retaining the canvas, context, and textures.
   * The old mesh/world remain installed if building or uploading the replacement throws.
   * @param {import('./contracts.js').SectorRenderWorld} world
   */
  replaceWorld(world) {
    const sceneBuild = this.buildStaticScene(world);

    this.host.replaceStaticMesh(sceneBuild.mesh);
    this.world = world;
    this.gpuScene = sceneBuild.gpuScene;
    this.meshStats = sceneBuild.meshStats;
    this.buildMs = sceneBuild.buildMs;
    this.debugSnapshot = this.createSnapshot({
      renderMs: 0,
      drawCallCount: sceneBuild.mesh.groups.length,
      texturedDrawCallCount: this.meshStats.texturedGroupCount
    });
  }

  createSnapshot({ renderMs, drawCallCount, texturedDrawCallCount }) {
    const textureStats = this.host.getTextureStats();

    return createGpuDebugSnapshot({
      sectorCount: this.gpuScene.sectors,
      authoredWallCount: this.gpuScene.stats.authoredWalls,
      wallPrimitiveCount: this.gpuScene.walls.length,
      wallTriangleCount: this.meshStats.wallTriangles,
      floorTriangleCount: this.meshStats.floorTriangles,
      ceilingTriangleCount: this.meshStats.ceilingTriangles,
      wallMaterialCount: this.meshStats.wallMaterialCount,
      floorMaterialCount: this.meshStats.floorMaterialCount,
      ceilingMaterialCount: this.meshStats.ceilingMaterialCount,
      loadedTextureCount: textureStats.loaded,
      totalTextureCount: textureStats.total,
      texturedDrawCallCount,
      totalVertexCount: this.meshStats.vertexCount,
      totalIndexCount: this.meshStats.indexCount,
      drawCallCount,
      buildMs: this.buildMs,
      uploadInitMs: this.host.initMs,
      renderMs,
      seamDebug: this.gpuScene.seamDebug ?? null
    });
  }

  /** Draws one frame. Camera is required; presentation arrays default to empty. @param {import('./contracts.js').RendererFrame} frame */
  render(frame) {
    assertRendererFrame(frame);
    const { camera, sprites = [], worldQuads = [], overlays = [] } = frame;
    const renderStats = this.host.render({
      camera,
      sprites,
      worldQuads,
      overlays
    });

    this.debugSnapshot = this.createSnapshot({
      renderMs: renderStats.renderMs,
      drawCallCount: renderStats.drawCalls,
      texturedDrawCallCount: renderStats.texturedDrawCalls
    });
  }

  /**
   * Resizes the logical CSS viewport and its backing store.
   * @param {number} width
   * @param {number} height
   * @param {{pixelRatio?:number}} [options]
   */
  resize(width, height, { pixelRatio = 1 } = {}) {
    this.host.resize(width, height, { pixelRatio });
  }

  /** Returns the current read-only-by-convention diagnostics/performance snapshot. @returns {Object} */
  getStats() {
    return this.debugSnapshot;
  }

  /** Releases GPU resources and removes only a renderer-created canvas. Safe to call repeatedly. */
  destroy() {
    this.host.destroy();
  }
}
