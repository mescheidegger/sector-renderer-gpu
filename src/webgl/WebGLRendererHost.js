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
import { normalizeLightLevel } from '../scene/sectorLighting.js';
import { resolveAnimatedMaterialKey } from '../materials/resolveAnimatedMaterialKey.js';

// Prevents coplanar precision artifacts; this is not visible presentation spacing.
export const SURFACE_SEPARATION_EPSILON = 0.001;

// Camera depth is measured in world units, so near-equal sprite depths retain sprite.order semantics.
const TRANSPARENT_WORLD_DEPTH_EPSILON = 0.000001;

export const DEFAULT_WORLD_QUAD_ALPHA_CUTOFF = 0.5;

const ALPHA_MODE_UNIFORM_VALUES = Object.freeze({
  opaque: 0,
  mask: 1,
  blend: 2
});

/**
 * Compatibility rule for legacy world quads: submitted translucency stays blended,
 * while otherwise-opaque textured quads default to a mask so transparent holes survive.
 */
export function resolveWorldQuadAlphaMode(quad) {
  if (quad.alphaMode !== undefined) {
    if (Object.hasOwn(ALPHA_MODE_UNIFORM_VALUES, quad.alphaMode)) return quad.alphaMode;
    throw new TypeError(`[SectorRenderer] Unsupported world quad alphaMode "${quad.alphaMode}".`);
  }

  if ((quad.opacity ?? 1) < 1 || (quad.color?.[3] ?? 1) < 1) return 'blend';
  return quad.textureKey == null ? 'opaque' : 'mask';
}

export function resolveWorldQuadAlphaCutoff(alphaCutoff) {
  if (!Number.isFinite(alphaCutoff)) return DEFAULT_WORLD_QUAD_ALPHA_CUTOFF;
  return Math.min(1, Math.max(0, alphaCutoff));
}

export function resolveWorldQuadDraws(quads, cameraForward, viewerX, viewerY) {
  return quads.map((quad, submissionIndex) => {
    const center = quad.corners.reduce((sum, corner) => [
      sum[0] + corner[0], sum[1] + corner[1], sum[2] + corner[2]
    ], [0, 0, 0]).map((value) => value / quad.corners.length);
    return {
      kind: 'quad',
      quad,
      alphaMode: resolveWorldQuadAlphaMode(quad),
      alphaCutoff: resolveWorldQuadAlphaCutoff(quad.alphaCutoff),
      depth: ((center[0] - viewerX) * cameraForward[0])
        + ((center[1] - viewerY) * cameraForward[1]),
      submissionIndex
    };
  });
}

export function compareTransparentWorldDraws(a, b) {
  if (Math.abs(a.depth - b.depth) > TRANSPARENT_WORLD_DEPTH_EPSILON) {
    return b.depth - a.depth;
  }
  if (a.kind === 'sprite' && b.kind === 'sprite') {
    const orderDifference = (a.sprite.order ?? 0) - (b.sprite.order ?? 0);
    if (orderDifference !== 0) return orderDifference;
  }
  return a.stableIndex - b.stableIndex;
}

export function writeQuadVertices(target, {
  corners,
  opacity = 1,
  lightLevel = 1,
  color = [1, 1, 1, 1],
  uvs
}) {
  const [topLeft, topRight, bottomRight, bottomLeft] = corners;
  const [uvTopLeft, uvTopRight, uvBottomRight, uvBottomLeft] = uvs;
  const [r, g, b, a] = color;

  target.push(
    topLeft[0], topLeft[1], topLeft[2], uvTopLeft[0], uvTopLeft[1], r, g, b, a * opacity, lightLevel,
    topRight[0], topRight[1], topRight[2], uvTopRight[0], uvTopRight[1], r, g, b, a * opacity, lightLevel,
    bottomRight[0], bottomRight[1], bottomRight[2], uvBottomRight[0], uvBottomRight[1], r, g, b, a * opacity, lightLevel,
    bottomLeft[0], bottomLeft[1], bottomLeft[2], uvBottomLeft[0], uvBottomLeft[1], r, g, b, a * opacity, lightLevel
  );
}

function resolveSpriteDimensions(sprite, textureRecord) {
  return {
    width: sprite.width ?? sprite.size ?? textureRecord?.sourceSize?.w ?? textureRecord?.width ?? 1,
    height: sprite.height ?? sprite.size ?? textureRecord?.sourceSize?.h ?? textureRecord?.height ?? 1
  };
}

function normalizeVerticalSurfaceConstraints(surfaceConstraints) {
  if (!Array.isArray(surfaceConstraints)) return [];
  return surfaceConstraints.flatMap((constraint) => {
    const x = constraint?.normal?.x;
    const y = constraint?.normal?.y;
    const pointX = constraint?.point?.x;
    const pointY = constraint?.point?.y;
    const clearanceOffset = Number.isFinite(constraint?.clearanceOffset)
      ? Math.max(0, constraint.clearanceOffset)
      : 0;
    const length = Math.hypot(x, y);
    return Number.isFinite(length) && length > 0.000001
      && Number.isFinite(pointX) && Number.isFinite(pointY)
      ? [{
        normal: { x: x / length, y: y / length },
        point: { x: pointX, y: pointY },
        clearanceOffset
      }]
      : [];
  });
}

function satisfiesSurfaceClearances(displacement, constraints) {
  return constraints.every(({ normal, clearance }) => (
    (displacement.x * normal.x) + (displacement.y * normal.y) >= clearance - 1e-10
  ));
}

export function resolveSurfaceConstrainedBillboardPlacement(sprite, cameraRight, halfWidth, cameraPosition = null) {
  const surfaces = normalizeVerticalSurfaceConstraints(sprite.surfaceConstraints);
  if (surfaces.length === 0) {
    return { center: [sprite.x, sprite.y, sprite.z], scale: 1 };
  }

  if (sprite.surfaceAttachment?.mode === 'preserve-screen-anchor') {
    const cameraX = cameraPosition?.x;
    const cameraY = cameraPosition?.y;
    const cameraZ = cameraPosition?.z;
    if (![cameraX, cameraY, cameraZ].every(Number.isFinite)) {
      return { center: [sprite.x, sprite.y, sprite.z], scale: 1 };
    }

    let minimumScale = 0;
    let maximumScale = 1;
    for (const { normal, point, clearanceOffset } of surfaces) {
      const cameraDistance = ((cameraX - point.x) * normal.x) + ((cameraY - point.y) * normal.y);
      const anchorDistance = ((sprite.x - point.x) * normal.x) + ((sprite.y - point.y) * normal.y);
      const projectedHalfWidth = Math.abs(
        (cameraRight[0] * normal.x) + (cameraRight[1] * normal.y)
      ) * halfWidth;
      const requiredBaseClearance = SURFACE_SEPARATION_EPSILON + clearanceOffset;
      const constant = cameraDistance - requiredBaseClearance;
      const coefficient = anchorDistance - cameraDistance - projectedHalfWidth;
      if (Math.abs(coefficient) <= 1e-10) {
        if (constant < -1e-10) {
          return { center: [sprite.x, sprite.y, sprite.z], scale: 1 };
        }
        continue;
      }
      const bound = -constant / coefficient;
      if (coefficient > 0) {
        minimumScale = Math.max(minimumScale, bound);
      } else {
        maximumScale = Math.min(maximumScale, bound);
      }
    }

    const scale = Math.min(1, maximumScale);
    if (!Number.isFinite(scale) || scale <= 1e-10 || scale < Math.max(0, minimumScale) - 1e-10) {
      return { center: [sprite.x, sprite.y, sprite.z], scale: 1 };
    }
    const center = [
      cameraX + (scale * (sprite.x - cameraX)),
      cameraY + (scale * (sprite.y - cameraY)),
      cameraZ + (scale * (sprite.z - cameraZ))
    ];
    const satisfiesAll = surfaces.every(({ normal, point, clearanceOffset }) => {
      const centerDistance = ((center[0] - point.x) * normal.x) + ((center[1] - point.y) * normal.y);
      const projectedHalfWidth = Math.abs(
        (cameraRight[0] * normal.x) + (cameraRight[1] * normal.y)
      ) * halfWidth * scale;
      return centerDistance >= projectedHalfWidth + SURFACE_SEPARATION_EPSILON + clearanceOffset - 1e-10;
    });
    if (!satisfiesAll) {
      return { center: [sprite.x, sprite.y, sprite.z], scale: 1 };
    }
    return { center, scale };
  }

  const constraints = surfaces.map(({ normal, point, clearanceOffset }) => {
    const currentDistance = ((sprite.x - point.x) * normal.x) + ((sprite.y - point.y) * normal.y);
    const requiredDistance = Math.abs((cameraRight[0] * normal.x) + (cameraRight[1] * normal.y))
      * halfWidth + SURFACE_SEPARATION_EPSILON + clearanceOffset;
    return { normal, clearance: requiredDistance - currentDistance };
  });

  const candidates = [{ x: 0, y: 0 }, ...constraints.map(({ normal, clearance }) => ({
    x: normal.x * clearance,
    y: normal.y * clearance
  }))];

  for (let i = 0; i < constraints.length; i += 1) {
    for (let j = i + 1; j < constraints.length; j += 1) {
      const a = constraints[i];
      const b = constraints[j];
      const determinant = (a.normal.x * b.normal.y) - (a.normal.y * b.normal.x);
      if (Math.abs(determinant) <= 1e-10) continue;
      candidates.push({
        x: ((a.clearance * b.normal.y) - (a.normal.y * b.clearance)) / determinant,
        y: ((a.normal.x * b.clearance) - (a.clearance * b.normal.x)) / determinant
      });
    }
  }

  const valid = candidates.filter((candidate) => satisfiesSurfaceClearances(candidate, constraints));
  if (valid.length === 0) return { center: [sprite.x, sprite.y, sprite.z], scale: 1 };
  const displacement = valid.reduce((best, candidate) => (
    ((candidate.x ** 2) + (candidate.y ** 2)) < ((best.x ** 2) + (best.y ** 2)) ? candidate : best
  ));

  return {
    center: [sprite.x + displacement.x, sprite.y + displacement.y, sprite.z],
    scale: 1
  };
}

export function resolveSurfaceConstrainedBillboardCenter(sprite, cameraRight, halfWidth, cameraPosition = null) {
  return resolveSurfaceConstrainedBillboardPlacement(
    sprite, cameraRight, halfWidth, cameraPosition
  ).center;
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
  constructor({ canvas, container, width = 1280, height = 720, pixelRatio = 1, projection, mesh, textureProvider, materialAnimations = new Map() }) {
    const canvasTarget = resolveCanvasTarget({ canvas, container });
    this.canvas = canvasTarget.canvas;
    this.ownsCanvas = canvasTarget.ownsCanvas;
    this.ownerContainer = canvasTarget.ownerContainer;
    this.gl = null;
    this.program = null;
    this.meshBuffers = null;
    this.textureRegistry = null;
    this.dynamicBuffers = null;
    try {
      this.projection = resolveProjection(projection);
      this.materialAnimations = materialAnimations;

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
        useTexture: this.gl.getUniformLocation(this.program, 'uUseTexture'),
        skyProjection: this.gl.getUniformLocation(this.program, 'uSkyProjection'),
        cameraPosition: this.gl.getUniformLocation(this.program, 'uCameraPosition'),
        cameraYaw: this.gl.getUniformLocation(this.program, 'uCameraYaw'),
        alphaMode: this.gl.getUniformLocation(this.program, 'uAlphaMode'),
        alphaCutoff: this.gl.getUniformLocation(this.program, 'uAlphaCutoff'),
        emulateRepeat: this.gl.getUniformLocation(this.program, 'uEmulateRepeat'),
        textureSize: this.gl.getUniformLocation(this.program, 'uTextureSize')
      };

      this.meshBuffers = uploadStaticMesh(this.gl, mesh);
      const startupTextureKeys = textureProvider.getTextureKeys();
      this.textureRegistry = createTextureRegistry(this.gl, startupTextureKeys, textureProvider);
      this.dynamicBuffers = this.createDynamicBuffers();

      configureWebGLState(this.gl);

      this.resize(width, height, { pixelRatio });
      this.initMs = performance.now() - initStart;
    } catch (error) {
      this.releaseGpuResources();
      cleanupCanvasTarget(this);
      throw error;
    }
  }

  createDynamicBuffers() {
    const gl = this.gl;
    let vertexBuffer = null;
    let indexBuffer = null;

    try {
      vertexBuffer = gl.createBuffer();
      if (!vertexBuffer) {
        throw new Error('[SectorRenderer] Dynamic vertex buffer allocation failed.');
      }

      indexBuffer = gl.createBuffer();
      if (!indexBuffer) {
        throw new Error('[SectorRenderer] Dynamic index buffer allocation failed.');
      }

      return {
        vertexBuffer,
        indexBuffer,
        indices: new Uint16Array([0, 1, 2, 0, 2, 3])
      };
    } catch (error) {
      if (indexBuffer) gl.deleteBuffer(indexBuffer);
      if (vertexBuffer) gl.deleteBuffer(vertexBuffer);
      throw error;
    }
  }

  replaceStaticMesh(mesh) {
    const nextMeshBuffers = uploadStaticMesh(this.gl, mesh);
    const previousMeshBuffers = this.meshBuffers;
    this.meshBuffers = nextMeshBuffers;
    deleteStaticMeshBuffers(this.gl, previousMeshBuffers);
  }

  resize(width, height, { pixelRatio = 1 } = {}) {
    const viewport = resolveViewportSize(width, height, pixelRatio);
    const { pixelWidth, pixelHeight } = viewport;

    this.viewportWidth = viewport.width;
    this.viewportHeight = viewport.height;

    this.canvas.width = pixelWidth;
    this.canvas.height = pixelHeight;
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;

    this.gl.viewport(0, 0, pixelWidth, pixelHeight);
    this.aspect = this.viewportWidth / this.viewportHeight;
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

  setAlphaMode(alphaMode, alphaCutoff = DEFAULT_WORLD_QUAD_ALPHA_CUTOFF) {
    this.gl.uniform1f(this.uniformLocations.alphaMode, ALPHA_MODE_UNIFORM_VALUES[alphaMode]);
    this.gl.uniform1f(this.uniformLocations.alphaCutoff, alphaCutoff);
  }

  setTextureSampling(textureRecord) {
    const emulateRepeat = textureRecord?.repeatMode === 'shader';
    this.gl.uniform1f(this.uniformLocations.emulateRepeat, emulateRepeat ? 1 : 0);
    if (emulateRepeat) {
      this.gl.uniform2f(
        this.uniformLocations.textureSize,
        textureRecord.uploadWidth,
        textureRecord.uploadHeight
      );
    }
  }

  buildWorldBillboardQuad(
    sprite,
    cameraRight,
    cameraUp,
    cameraPosition = null,
    resolvedPlacement = null
  ) {
    const width = sprite.width ?? sprite.size ?? 1;
    const height = sprite.height ?? sprite.size ?? width;

    const submittedHalfWidth = width * 0.5;
    const submittedHalfHeight = height * 0.5;
    const anchorMode = sprite.anchor ?? 'center';
    const { center: [cx, cy, surfaceZ], scale } = resolvedPlacement
      ?? resolveSurfaceConstrainedBillboardPlacement(
        sprite, cameraRight, submittedHalfWidth, cameraPosition
      );
    const halfWidth = submittedHalfWidth * scale;
    const halfHeight = submittedHalfHeight * scale;
    const cz = anchorMode === 'floor' ? surfaceZ + halfHeight : surfaceZ;

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
    const width = this.viewportWidth;
    const height = this.viewportHeight;

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

  drawQuad({
    textureKey,
    quad,
    viewProjection,
    flipV = false,
    flipX = false,
    alphaMode = 'opaque',
    alphaCutoff = DEFAULT_WORLD_QUAD_ALPHA_CUTOFF
  }) {
    const gl = this.gl;
    const textureRecord = this.textureRegistry.get(textureKey);
    const useTexture = textureRecord && !textureRecord.failed ? 1 : 0;
    if (!useTexture && !quad.color) {
      return false;
    }

    const vertices = [];
    const resolvedUvs = resolveQuadUvs({
      uvRect: textureRecord?.uvRect,
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
    if (useTexture) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, textureRecord.texture);
    }
    gl.uniform1f(this.uniformLocations.useTexture, useTexture);
    gl.uniform1f(this.uniformLocations.skyProjection, quad.projection === 'sky' ? 1 : 0);
    this.setTextureSampling(textureRecord);
    this.setAlphaMode(alphaMode, alphaCutoff);
    if (quad.surfaceType === 'floor' || quad.surfaceType === 'ceiling') {
      gl.enable?.(gl.CULL_FACE);
      gl.cullFace?.(gl.BACK);
    }
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
    if (quad.surfaceType === 'floor' || quad.surfaceType === 'ceiling') gl.disable?.(gl.CULL_FACE);

    return true;
  }

  drawStaticWorld(viewProjection, camera, timeSeconds = 0) {
    const gl = this.gl;
    this.setupVertexAttributes(this.meshBuffers.vertexBuffer);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.meshBuffers.indexBuffer);

    gl.uniformMatrix4fv(this.uniformLocations.viewProjection, false, viewProjection);
    gl.uniform3f(this.uniformLocations.cameraPosition, camera.x, camera.y, camera.z);
    gl.uniform1f(this.uniformLocations.cameraYaw, camera.yaw);
    this.setAlphaMode('opaque');

    let drawCalls = 0;
    let texturedDrawCalls = 0;

    for (const group of this.meshBuffers.groups) {
      if (group.surfaceType === 'floor' || group.surfaceType === 'ceiling') {
        gl.enable?.(gl.CULL_FACE);
        gl.cullFace?.(gl.BACK);
      } else {
        gl.disable?.(gl.CULL_FACE);
      }
      const resolvedKey = resolveAnimatedMaterialKey(group.materialKey, timeSeconds, this.materialAnimations);
      const textureRecord = this.textureRegistry.get(resolvedKey);
      const useTexture = textureRecord && !textureRecord.failed ? 1 : 0;
      if (useTexture) {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, textureRecord.texture);
        texturedDrawCalls += 1;
      }

      gl.uniform1f(this.uniformLocations.useTexture, useTexture);
      gl.uniform1f(this.uniformLocations.skyProjection, group.projection === 'sky' ? 1 : 0);
      this.setTextureSampling(textureRecord);
      gl.drawElements(
        gl.TRIANGLES,
        group.indexCount,
        gl.UNSIGNED_SHORT,
        group.startIndex * Uint16Array.BYTES_PER_ELEMENT
      );
      drawCalls += 1;
    }
    gl.disable?.(gl.CULL_FACE);

    return { drawCalls, texturedDrawCalls };
  }

  resolveWorldSpriteDraws({ sprites, cameraRight, cameraForward, viewerX, viewerY, viewerZ, stableIndexOffset = 0 }) {
    return sprites.map((sprite, submissionIndex) => {
      const textureRecord = this.textureRegistry.get(sprite.textureKey);
      const dimensions = resolveSpriteDimensions(sprite, textureRecord);
      const placement = resolveSurfaceConstrainedBillboardPlacement(
        sprite,
        cameraRight,
        dimensions.width * 0.5,
        { x: viewerX, y: viewerY, z: viewerZ }
      );
      const dx = placement.center[0] - viewerX;
      const dy = placement.center[1] - viewerY;
      const depth = (dx * cameraForward[0]) + (dy * cameraForward[1]);
      return {
        kind: 'sprite', sprite, textureRecord, dimensions, placement, depth,
        submissionIndex, stableIndex: stableIndexOffset + submissionIndex
      };
    });
  }

  drawWorldSprite({ sprite, textureRecord, dimensions, placement, viewProjection, cameraRight, viewerX, viewerY, viewerZ }) {
    if (!textureRecord || textureRecord.failed) return false;

    const quad = this.buildWorldBillboardQuad(
      { ...sprite, width: dimensions.width, height: dimensions.height },
      cameraRight,
      [0, 0, 1],
      { x: viewerX, y: viewerY, z: viewerZ },
      placement
    );

    return this.drawQuad({
      textureKey: sprite.textureKey,
      quad,
      viewProjection,
      flipX: sprite.flipX,
      flipV: sprite.flipV ?? false,
      alphaMode: 'blend'
    });
  }

  drawPreparedWorldQuad({ quad, alphaMode, alphaCutoff }, viewProjection, timeSeconds = 0) {
    return this.drawQuad({
      textureKey: quad.surfaceType
        ? resolveAnimatedMaterialKey(quad.textureKey, timeSeconds, this.materialAnimations)
        : quad.textureKey,
      quad: {
        corners: quad.corners,
        opacity: quad.opacity ?? 1,
        lightLevel: normalizeLightLevel(quad.lightLevel),
        color: quad.color,
        surfaceType: quad.surfaceType,
        projection: quad.projection,
        uvs: quad.uvs ?? null
      },
      viewProjection,
      flipV: quad.flipV ?? false,
      flipX: quad.flipX ?? false,
      alphaMode,
      alphaCutoff
    });
  }

  drawOpaqueWorldQuads({ draws, viewProjection, timeSeconds = 0 }) {
    const gl = this.gl;
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    let drawCount = 0;

    for (const draw of draws) {
      if (draw.alphaMode === 'blend') continue;
      if (this.drawPreparedWorldQuad(draw, viewProjection, timeSeconds)) drawCount += 1;
    }

    return drawCount;
  }

  drawTransparentWorld({ draws, viewProjection, timeSeconds, cameraRight, viewerX, viewerY, viewerZ }) {
    const gl = this.gl;
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);

    let drawCount = 0;
    try {
      for (const draw of draws.sort(compareTransparentWorldDraws)) {
        const drawn = draw.kind === 'quad'
          ? this.drawPreparedWorldQuad(draw, viewProjection, timeSeconds)
          : this.drawWorldSprite({ ...draw, viewProjection, cameraRight, viewerX, viewerY, viewerZ });
        if (drawn) drawCount += 1;
      }
    } finally {
      gl.depthMask(true);
      this.setAlphaMode('opaque');
    }

    return drawCount;
  }

  drawOverlays(overlays) {
    const gl = this.gl;
    const overlayProjection = createIdentityMat4();
    const sorted = [...overlays].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    let draws = 0;
    try {
      for (const overlay of sorted) {
        const quad = this.buildOverlayQuad(overlay);
        if (this.drawQuad({
          textureKey: overlay.textureKey,
          quad,
          viewProjection: overlayProjection,
          alphaMode: 'blend'
        })) {
          draws += 1;
        }
      }
    } finally {
      gl.depthMask(true);
      gl.enable(gl.DEPTH_TEST);
      this.setAlphaMode('opaque');
    }

    return draws;
  }

  /** Draws one full frame of world geometry, sprites, and overlays. */
  render({ camera, sprites = [], worldQuads = [], overlays = [], timeSeconds = 0 }) {
    const start = performance.now();
    const gl = this.gl;

    gl.useProgram(this.program);
    gl.uniform1i(this.uniformLocations.texture, 0);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

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
    const preparedWorldQuads = resolveWorldQuadDraws(
      worldQuads, forward, camera.x, camera.y
    ).map((draw) => ({ ...draw, stableIndex: draw.submissionIndex }));
    const preparedSprites = this.resolveWorldSpriteDraws({
      sprites,
      cameraRight,
      cameraForward: forward,
      viewerX: camera.x,
      viewerY: camera.y,
      viewerZ: camera.z,
      stableIndexOffset: worldQuads.length
    });

    const staticStats = this.drawStaticWorld(viewProjection, camera, timeSeconds);
    const opaqueWorldQuadDraws = this.drawOpaqueWorldQuads({
      draws: preparedWorldQuads,
      timeSeconds,
      viewProjection
    });
    const transparentWorldDraws = this.drawTransparentWorld({
      draws: [
        ...preparedWorldQuads.filter(({ alphaMode }) => alphaMode === 'blend'),
        ...preparedSprites
      ],
      viewProjection,
      timeSeconds,
      cameraRight,
      viewerX: camera.x,
      viewerY: camera.y,
      viewerZ: camera.z
    });
    const overlayDraws = this.drawOverlays(overlays);

    return {
      renderMs: performance.now() - start,
      drawCalls: staticStats.drawCalls + opaqueWorldQuadDraws + transparentWorldDraws + overlayDraws,
      texturedDrawCalls: staticStats.texturedDrawCalls + opaqueWorldQuadDraws + transparentWorldDraws + overlayDraws
    };
  }

  getTextureStats() {
    return this.textureRegistry.getStats();
  }

  releaseGpuResources() {
    if (!this.gl) return;

    deleteDynamicBuffers(this.gl, this.dynamicBuffers);
    this.dynamicBuffers = null;

    this.textureRegistry?.destroy?.();
    this.textureRegistry = null;

    deleteStaticMeshBuffers(this.gl, this.meshBuffers);
    this.meshBuffers = null;

    if (this.program) {
      this.gl.deleteProgram(this.program);
      this.program = null;
    }
  }

  /** Releases WebGL resources and detaches only a renderer-owned canvas. */
  destroy() {
    if (!this.gl) return;
    this.releaseGpuResources();
    cleanupCanvasTarget(this);
    this.canvas = null;
    this.ownerContainer = null;
    this.gl = null;
  }
}
