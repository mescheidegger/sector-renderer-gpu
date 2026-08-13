/**
 * Module: Owns WebGL resources and either uses a caller-provided canvas or manages a renderer-created canvas.
 */
import { createWebGLContext } from './createWebGLContext.js';
import { createShaderProgram } from './createShaderProgram.js';
import { createIdentityMat4, createLookAtMat4, createPerspectiveMat4, multiplyMat4 } from './math/mat4.js';
import { uploadStaticMesh } from './mesh/uploadStaticMesh.js';
import { TEXTURED_FRAGMENT_SHADER, TEXTURED_VERTEX_SHADER } from './shaders/texturedShaders.js';
import { configureWebGLState } from './state/configureWebGLState.js';
import { createTextureRegistry } from './textures/createTextureRegistry.js';
import { cleanupCanvasTarget, resolveCanvasTarget } from './canvas/resolveCanvasTarget.js';
import { resolveViewportSize } from './canvas/resolveViewportSize.js';
import { resolveProjection } from './resolveProjection.js';
import { resolveQuadUvs } from './resolveQuadUvs.js';

function writeQuadVertices(target, {
  corners,
  opacity = 1,
  uvs
}) {
  const [topLeft, topRight, bottomRight, bottomLeft] = corners;
  const [uvTopLeft, uvTopRight, uvBottomRight, uvBottomLeft] = uvs;

  target.push(
    topLeft[0], topLeft[1], topLeft[2], uvTopLeft[0], uvTopLeft[1], 1, 1, 1, opacity, 1,
    topRight[0], topRight[1], topRight[2], uvTopRight[0], uvTopRight[1], 1, 1, 1, opacity, 1,
    bottomRight[0], bottomRight[1], bottomRight[2], uvBottomRight[0], uvBottomRight[1], 1, 1, 1, opacity, 1,
    bottomLeft[0], bottomLeft[1], bottomLeft[2], uvBottomLeft[0], uvBottomLeft[1], 1, 1, 1, opacity, 1
  );
}

function resolveSpriteDimensions(sprite, textureRecord) {
  return {
    width: sprite.width ?? sprite.size ?? textureRecord?.sourceSize?.w ?? textureRecord?.width ?? 1,
    height: sprite.height ?? sprite.size ?? textureRecord?.sourceSize?.h ?? textureRecord?.height ?? 1
  };
}

function deleteStaticMeshBuffers(gl, meshBuffers) {
  if (!gl || !meshBuffers) return;
  if (meshBuffers.vertexBuffer) {
    gl.deleteBuffer(meshBuffers.vertexBuffer);
  }
  if (meshBuffers.indexBuffer) {
    gl.deleteBuffer(meshBuffers.indexBuffer);
  }
}

function deleteDynamicBuffers(gl, dynamicBuffers) {
  if (!gl || !dynamicBuffers) return;
  if (dynamicBuffers.vertexBuffer) {
    gl.deleteBuffer(dynamicBuffers.vertexBuffer);
  }
  if (dynamicBuffers.indexBuffer) {
    gl.deleteBuffer(dynamicBuffers.indexBuffer);
  }
}

/** Low-level WebGL host that owns GPU resources and performs all frame drawing. */
export class WebGLRendererHost {
  constructor({ canvas, container, width = 1280, height = 720, pixelRatio = 1, projection, mesh, textureProvider }) {
    const canvasTarget = resolveCanvasTarget({ canvas, container });
    this.canvas = canvasTarget.canvas;
    this.ownsCanvas = canvasTarget.ownsCanvas;
    this.ownerContainer = canvasTarget.ownerContainer;
    try {
      this.projection = resolveProjection(projection);

      this.gl = createWebGLContext(this.canvas);

      const initStart = performance.now();

      this.program = createShaderProgram(this.gl, {
        vertexSource: TEXTURED_VERTEX_SHADER,
        fragmentSource: TEXTURED_FRAGMENT_SHADER
      });

      this.attributeLocations = {
        position: this.gl.getAttribLocation(this.program, 'aPosition'),
        uv: this.gl.getAttribLocation(this.program, 'aUv'),
        color: this.gl.getAttribLocation(this.program, 'aColor'),
        lightLevel: this.gl.getAttribLocation(this.program, 'aLightLevel')
      };

      this.uniformLocations = {
        viewProjection: this.gl.getUniformLocation(this.program, 'uViewProjection'),
        texture: this.gl.getUniformLocation(this.program, 'uTexture'),
        useTexture: this.gl.getUniformLocation(this.program, 'uUseTexture')
      };

      this.meshBuffers = uploadStaticMesh(this.gl, mesh);
      const startupTextureKeys = textureProvider.getTextureKeys();
      this.textureRegistry = createTextureRegistry(this.gl, startupTextureKeys, textureProvider);
      this.dynamicBuffers = this.createDynamicBuffers();

      configureWebGLState(this.gl);

      this.resize(width, height, { pixelRatio });
      this.initMs = performance.now() - initStart;
    } catch (error) {
      cleanupCanvasTarget(this);
      throw error;
    }
  }

  createDynamicBuffers() {
    const gl = this.gl;
    return {
      vertexBuffer: gl.createBuffer(),
      indexBuffer: gl.createBuffer(),
      indices: new Uint16Array([0, 1, 2, 0, 2, 3])
    };
  }

  replaceStaticMesh(mesh) {
    const nextMeshBuffers = uploadStaticMesh(this.gl, mesh);
    const previousMeshBuffers = this.meshBuffers;
    this.meshBuffers = nextMeshBuffers;
    deleteStaticMeshBuffers(this.gl, previousMeshBuffers);
  }

  resize(width, height, { pixelRatio = 1 } = {}) {
    const { pixelWidth, pixelHeight } = resolveViewportSize(width, height, pixelRatio);

    this.canvas.width = pixelWidth;
    this.canvas.height = pixelHeight;
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;

    this.gl.viewport(0, 0, pixelWidth, pixelHeight);
    this.aspect = pixelWidth / pixelHeight;
  }

  setupVertexAttributes(vertexBuffer) {
    const gl = this.gl;
    const stride = 10 * Float32Array.BYTES_PER_ELEMENT;

    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);

    gl.enableVertexAttribArray(this.attributeLocations.position);
    gl.vertexAttribPointer(this.attributeLocations.position, 3, gl.FLOAT, false, stride, 0);

    gl.enableVertexAttribArray(this.attributeLocations.uv);
    gl.vertexAttribPointer(
      this.attributeLocations.uv,
      2,
      gl.FLOAT,
      false,
      stride,
      3 * Float32Array.BYTES_PER_ELEMENT
    );

    gl.enableVertexAttribArray(this.attributeLocations.color);
    gl.vertexAttribPointer(
      this.attributeLocations.color,
      4,
      gl.FLOAT,
      false,
      stride,
      5 * Float32Array.BYTES_PER_ELEMENT
    );

    gl.enableVertexAttribArray(this.attributeLocations.lightLevel);
    gl.vertexAttribPointer(this.attributeLocations.lightLevel, 1, gl.FLOAT, false, stride, 9 * Float32Array.BYTES_PER_ELEMENT);
  }

  buildWorldBillboardQuad(sprite, cameraRight, cameraUp) {
    const width = sprite.width ?? sprite.size ?? 1;
    const height = sprite.height ?? sprite.size ?? width;

    const halfWidth = width * 0.5;
    const halfHeight = height * 0.5;
    const anchorMode = sprite.anchor ?? 'center';
    const centerZ = anchorMode === 'floor' ? sprite.z + halfHeight : sprite.z;

    const cx = sprite.x;
    const cy = sprite.y;
    const cz = centerZ;

    const rx = cameraRight[0] * halfWidth;
    const ry = cameraRight[1] * halfWidth;
    const rz = cameraRight[2] * halfWidth;

    const ux = cameraUp[0] * halfHeight;
    const uy = cameraUp[1] * halfHeight;
    const uz = cameraUp[2] * halfHeight;

    return {
      corners: [
        [cx - rx + ux, cy - ry + uy, cz - rz + uz],
        [cx + rx + ux, cy + ry + uy, cz + rz + uz],
        [cx + rx - ux, cy + ry - uy, cz + rz - uz],
        [cx - rx - ux, cy - ry - uy, cz - rz - uz]
      ],
      opacity: sprite.opacity ?? 1
    };
  }

  buildOverlayQuad(overlay) {
    const width = this.canvas.width;
    const height = this.canvas.height;

    const centerX = (overlay.anchorX * width) + (overlay.offsetX ?? 0);
    const centerY = (overlay.anchorY * height) + (overlay.offsetY ?? 0);

    const spriteWidth = overlay.width;
    const spriteHeight = overlay.height;
    const pivotX = overlay.pivotX ?? 0.5;
    const pivotY = overlay.pivotY ?? 0.5;

    const leftPx = centerX - (spriteWidth * pivotX);
    const topPx = centerY - (spriteHeight * pivotY);
    const rightPx = leftPx + spriteWidth;
    const bottomPx = topPx + spriteHeight;
    const rotation = overlay.rotation ?? 0;
    const pivotPxX = leftPx + (spriteWidth * pivotX);
    const pivotPxY = topPx + (spriteHeight * pivotY);

    const toNdcX = (px) => ((px / width) * 2) - 1;
    const toNdcY = (py) => 1 - ((py / height) * 2);
    const rotatePoint = (px, py) => {
      if (rotation === 0) {
        return [px, py];
      }

      const dx = px - pivotPxX;
      const dy = py - pivotPxY;
      const cosR = Math.cos(rotation);
      const sinR = Math.sin(rotation);
      return [
        pivotPxX + (dx * cosR) - (dy * sinR),
        pivotPxY + (dx * sinR) + (dy * cosR)
      ];
    };

    const [topLeftX, topLeftY] = rotatePoint(leftPx, topPx);
    const [topRightX, topRightY] = rotatePoint(rightPx, topPx);
    const [bottomRightX, bottomRightY] = rotatePoint(rightPx, bottomPx);
    const [bottomLeftX, bottomLeftY] = rotatePoint(leftPx, bottomPx);

    return {
      corners: [
        [toNdcX(topLeftX), toNdcY(topLeftY), 0],
        [toNdcX(topRightX), toNdcY(topRightY), 0],
        [toNdcX(bottomRightX), toNdcY(bottomRightY), 0],
        [toNdcX(bottomLeftX), toNdcY(bottomLeftY), 0]
      ],
      opacity: overlay.opacity ?? 1
    };
  }

  drawQuad({ textureKey, quad, viewProjection, flipV = false, flipX = false }) {
    const gl = this.gl;
    const textureRecord = this.textureRegistry.get(textureKey);
    if (!textureRecord || textureRecord.failed) {
      return false;
    }

    const vertices = [];
    const resolvedUvs = resolveQuadUvs({
      uvRect: textureRecord.uvRect,
      uvs: quad.uvs,
      flipX,
      flipV
    });

    writeQuadVertices(vertices, { ...quad, uvs: resolvedUvs });

    this.setupVertexAttributes(this.dynamicBuffers.vertexBuffer);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.dynamicBuffers.vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.DYNAMIC_DRAW);

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.dynamicBuffers.indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, this.dynamicBuffers.indices, gl.DYNAMIC_DRAW);

    gl.uniformMatrix4fv(this.uniformLocations.viewProjection, false, viewProjection);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, textureRecord.texture);
    gl.uniform1f(this.uniformLocations.useTexture, 1);
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);

    return true;
  }

  drawStaticWorld(viewProjection) {
    const gl = this.gl;
    this.setupVertexAttributes(this.meshBuffers.vertexBuffer);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.meshBuffers.indexBuffer);

    gl.uniformMatrix4fv(this.uniformLocations.viewProjection, false, viewProjection);

    let drawCalls = 0;
    let texturedDrawCalls = 0;

    for (const group of this.meshBuffers.groups) {
      const textureRecord = this.textureRegistry.get(group.materialKey);
      const useTexture = textureRecord && !textureRecord.failed ? 1 : 0;
      if (useTexture) {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, textureRecord.texture);
        texturedDrawCalls += 1;
      }

      gl.uniform1f(this.uniformLocations.useTexture, useTexture);
      gl.drawElements(
        gl.TRIANGLES,
        group.indexCount,
        gl.UNSIGNED_SHORT,
        group.startIndex * Uint16Array.BYTES_PER_ELEMENT
      );
      drawCalls += 1;
    }

    return { drawCalls, texturedDrawCalls };
  }

  drawWorldSprites({ sprites, viewProjection, cameraRight, viewerX, viewerY }) {
    const gl = this.gl;
    const sorted = [...sprites].sort((a, b) => {
      const aDx = (a.x ?? 0) - viewerX;
      const aDy = (a.y ?? 0) - viewerY;
      const bDx = (b.x ?? 0) - viewerX;
      const bDy = (b.y ?? 0) - viewerY;
      const aDistanceSq = (aDx * aDx) + (aDy * aDy);
      const bDistanceSq = (bDx * bDx) + (bDy * bDy);

      if (Math.abs(aDistanceSq - bDistanceSq) > 0.000001) {
        return bDistanceSq - aDistanceSq;
      }

      return (a.order ?? 0) - (b.order ?? 0);
    });

    gl.depthMask(false);

    let draws = 0;
    for (const sprite of sorted) {
      const textureRecord = this.textureRegistry.get(sprite.textureKey);
      if (!textureRecord || textureRecord.failed) {
        continue;
      }

      const dimensions = resolveSpriteDimensions(sprite, textureRecord);
      const quad = this.buildWorldBillboardQuad(
        {
          ...sprite,
          width: dimensions.width,
          height: dimensions.height
        },
        cameraRight,
        [0, 0, 1]
      );

      if (this.drawQuad({
        textureKey: sprite.textureKey,
        quad,
        viewProjection,
        flipX: sprite.flipX,
        flipV: sprite.flipV ?? false
      })) {
        draws += 1;
      }
    }

    gl.depthMask(true);

    return draws;
  }

  drawWorldQuads({ quads, viewProjection }) {
    let draws = 0;

    for (const quad of quads) {
      if (this.drawQuad({
        textureKey: quad.textureKey,
        quad: {
          corners: quad.corners,
          opacity: quad.opacity ?? 1,
          uvs: quad.uvs ?? null
        },
        viewProjection,
        flipV: quad.flipV ?? false,
        flipX: quad.flipX ?? false
      })) {
        draws += 1;
      }
    }

    return draws;
  }

  drawOverlays(overlays) {
    const gl = this.gl;
    const overlayProjection = createIdentityMat4();
    const sorted = [...overlays].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);

    let draws = 0;
    for (const overlay of sorted) {
      const quad = this.buildOverlayQuad(overlay);
      if (this.drawQuad({ textureKey: overlay.textureKey, quad, viewProjection: overlayProjection })) {
        draws += 1;
      }
    }

    gl.depthMask(true);
    gl.enable(gl.DEPTH_TEST);

    return draws;
  }

  /** Draws one full frame of world geometry, sprites, and overlays. */
  render({ camera, sprites = [], worldQuads = [], overlays = [] }) {
    const start = performance.now();
    const gl = this.gl;

    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.uniform1i(this.uniformLocations.texture, 0);

    const forward = [Math.sin(camera.yaw), Math.cos(camera.yaw), 0];
    const eye = [camera.x, camera.y, camera.z];
    const center = [eye[0] + forward[0], eye[1] + forward[1], eye[2] + forward[2]];

    const view = createLookAtMat4({ eye, center, up: [0, 0, 1] });
    const projection = createPerspectiveMat4({
      fovY: this.projection.fovY,
      aspect: this.aspect,
      near: this.projection.near,
      far: this.projection.far
    });
    const viewProjection = multiplyMat4(projection, view);

    const cameraRight = [Math.cos(camera.yaw), -Math.sin(camera.yaw), 0];

    const staticStats = this.drawStaticWorld(viewProjection);
    const worldQuadDraws = this.drawWorldQuads({
      quads: worldQuads,
      viewProjection
    });
    const worldSpriteDraws = this.drawWorldSprites({
      sprites,
      viewProjection,
      cameraRight,
      viewerX: camera.x,
      viewerY: camera.y
    });
    const overlayDraws = this.drawOverlays(overlays);

    return {
      renderMs: performance.now() - start,
      drawCalls: staticStats.drawCalls + worldSpriteDraws + worldQuadDraws + overlayDraws,
      texturedDrawCalls: staticStats.texturedDrawCalls + worldSpriteDraws + worldQuadDraws + overlayDraws
    };
  }

  getTextureStats() {
    return this.textureRegistry.getStats();
  }

  /** Releases WebGL resources and detaches only a renderer-owned canvas. */
  destroy() {
    if (!this.gl) return;
    deleteStaticMeshBuffers(this.gl, this.meshBuffers);
    deleteDynamicBuffers(this.gl, this.dynamicBuffers);
    this.textureRegistry?.destroy?.();
    if (this.program) {
      this.gl.deleteProgram(this.program);
    }
    this.meshBuffers = null;
    this.textureRegistry = null;
    this.dynamicBuffers = null;
    cleanupCanvasTarget(this);
    this.canvas = null;
    this.ownerContainer = null;
    this.gl = null;
    this.program = null;
  }
}
