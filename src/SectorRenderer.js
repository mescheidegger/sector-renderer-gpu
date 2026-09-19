/**
 * Module: High-level GPU renderer facade that builds scene geometry once, delegates drawing to WebGL, and keeps lightweight debug stats up to date.
 */
import { buildGpuScene } from './buildGpuScene.js';
import { createGpuDebugSnapshot } from './debug/createGpuDebugSnapshot.js';
import { assertTextureProvider } from './textureProvider.js';
import { buildStaticMeshFromGpuScene } from './webgl/mesh/buildStaticMeshFromGpuScene.js';
import { WebGLRendererHost } from './webgl/WebGLRendererHost.js';
import { assertRendererFrame } from './contracts.js';
import { validateMaterialAnimations } from './materials/resolveAnimatedMaterialKey.js';

/**
 * Browser/WebGL facade for a sector world and its per-frame presentation.
 * The instance owns its WebGL resources, but never owns a caller-provided canvas.
 */
export class SectorRenderer {
  /**
   * With a world, builds geometry and initializes WebGL synchronously. Without a world,
   * creates an unprepared owner; await prepareSharedResources() before replaceWorld().
   * Supply exactly one of `canvas` and `container`; a container receives a renderer-owned canvas.
   * @param {import('./contracts.js').SectorRendererOptions} options
   */
  constructor({
    world = null,
    canvas,
    container,
    width,
    height,
    pixelRatio = 1,
    projection,
    textureProvider = null,
    materialAnimations = [],
    debug = null
  }) {
    this.debug = debug;
    this.world = world;
    this.rendererLifecycle = 'restoring';
    this.restoreError = null;

    assertTextureProvider(textureProvider);
    this.materialAnimations = validateMaterialAnimations(materialAnimations, textureProvider);

    const sceneBuild = world == null ? null : this.buildStaticScene(world);
    this.gpuScene = sceneBuild?.gpuScene ?? null;

    this.host = new WebGLRendererHost({
      canvas,
      container,
      width,
      height,
      pixelRatio,
      projection,
      mesh: sceneBuild?.mesh ?? null,
      textureProvider,
      materialAnimations: this.materialAnimations,
      onLifecycleChange: ({ state, error }) => {
        this.rendererLifecycle = state;
        this.restoreError = error?.message ?? null;
        if (this.debugSnapshot) {
          const textureStats = this.host?.getTextureStats?.();
          this.debugSnapshot = {
            ...this.debugSnapshot,
            gpu: {
              ...this.debugSnapshot.gpu,
              lifecycle: state,
              restoreError: this.restoreError,
              ...(textureStats
                ? { texturesLoaded: textureStats.loaded, texturesTotal: textureStats.total }
                : {}),
              ...(this.host ? { uploadInitMs: this.host.initMs } : {})
            }
          };
        }
      }
    });

    this.meshStats = sceneBuild?.meshStats ?? null;
    this.buildMs = sceneBuild?.buildMs ?? 0;

    this.debugSnapshot = this.createSnapshot({
      renderMs: 0,
      drawCallCount: sceneBuild?.mesh.groups.length ?? 0,
      texturedDrawCallCount: this.meshStats?.texturedGroupCount ?? 0
    });
  }

  /** Prepare context-owned resources incrementally, without installing a world.
   * Concurrent calls share one promise. Await before the first replaceWorld().
   * Rejects on failure, context loss or destruction; a restored context is rebuilt automatically.
   * @returns {Promise<void>}
   */
  prepareSharedResources() {
    return this.host.prepareSharedResources();
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
      sectorCount: this.gpuScene?.sectors ?? 0,
      authoredWallCount: this.gpuScene?.stats.authoredWalls ?? 0,
      wallPrimitiveCount: this.gpuScene?.walls.length ?? 0,
      wallTriangleCount: this.meshStats?.wallTriangles ?? 0,
      floorTriangleCount: this.meshStats?.floorTriangles ?? 0,
      ceilingTriangleCount: this.meshStats?.ceilingTriangles ?? 0,
      wallMaterialCount: this.meshStats?.wallMaterialCount ?? 0,
      floorMaterialCount: this.meshStats?.floorMaterialCount ?? 0,
      ceilingMaterialCount: this.meshStats?.ceilingMaterialCount ?? 0,
      loadedTextureCount: textureStats.loaded,
      totalTextureCount: textureStats.total,
      texturedDrawCallCount,
      totalVertexCount: this.meshStats?.vertexCount ?? 0,
      totalIndexCount: this.meshStats?.indexCount ?? 0,
      drawCallCount,
      buildMs: this.buildMs,
      uploadInitMs: this.host.initMs,
      renderMs,
      lifecycle: this.rendererLifecycle,
      restoreError: this.restoreError,
      seamDebug: this.gpuScene?.seamDebug ?? null
    });
  }

  /** Draws one frame. Camera is required; presentation arrays default to empty. @param {import('./contracts.js').RendererFrame} frame */
  render(frame) {
    assertRendererFrame(frame);
    const { camera, sprites = [], worldQuads = [], overlays = [], timeSeconds = 0 } = frame;
    const renderStats = this.host.render({
      camera,
      sprites,
      worldQuads,
      overlays,
      timeSeconds
    });

    this.debugSnapshot = this.createSnapshot({
      renderMs: renderStats.renderMs,
      drawCallCount: renderStats.drawCalls,
      texturedDrawCallCount: renderStats.texturedDrawCalls
    });
  }

  /**
   * Resizes the logical CSS viewport and its backing store. Pixel ratio changes
   * backing resolution only; screen-overlay dimensions remain logical pixels.
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
