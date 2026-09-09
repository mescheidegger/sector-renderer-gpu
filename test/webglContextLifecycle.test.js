import assert from 'node:assert/strict';
import test from 'node:test';

import { SectorRenderer } from '../src/SectorRenderer.js';
import { WebGLRendererHost } from '../src/webgl/WebGLRendererHost.js';

function createTrackedGl(options = {}) {
  const state = {
    contextRequests: 0,
    shaderAllocations: 0,
    programAllocations: 0,
    bufferAllocations: 0,
    textureAllocations: 0,
    bufferUploads: [],
    textureUploads: 0,
    attributeLookups: 0,
    uniformLookups: 0,
    viewportCalls: [],
    enableCalls: [],
    depthFunctionCalls: [],
    clearColorCalls: [],
    useProgramCalls: 0,
    drawCalls: 0,
    deletedBuffers: [],
    deletedTextures: [],
    deletedShaders: [],
    deletedPrograms: [],
    errors: []
  };
  const noop = () => {};
  const gl = {
    NO_ERROR: 0,
    INVALID_ENUM: 0x0500,
    INVALID_VALUE: 0x0501,
    INVALID_OPERATION: 0x0502,
    INVALID_FRAMEBUFFER_OPERATION: 0x0506,
    OUT_OF_MEMORY: 0x0505,
    CONTEXT_LOST_WEBGL: 0x9242,
    VERTEX_SHADER: 1,
    FRAGMENT_SHADER: 2,
    COMPILE_STATUS: 3,
    LINK_STATUS: 4,
    ARRAY_BUFFER: 5,
    ELEMENT_ARRAY_BUFFER: 6,
    STATIC_DRAW: 7,
    DYNAMIC_DRAW: 8,
    TEXTURE_2D: 9,
    RGBA: 10,
    UNSIGNED_BYTE: 11,
    UNPACK_FLIP_Y_WEBGL: 12,
    TEXTURE_WRAP_S: 13,
    TEXTURE_WRAP_T: 14,
    CLAMP_TO_EDGE: 15,
    REPEAT: 16,
    TEXTURE_MAG_FILTER: 17,
    TEXTURE_MIN_FILTER: 18,
    NEAREST: 19,
    LINEAR: 20,
    LINEAR_MIPMAP_LINEAR: 21,
    MAX_TEXTURE_SIZE: 22,
    DEPTH_TEST: 23,
    LEQUAL: 24,
    CULL_FACE: 25,
    BLEND: 26,
    SRC_ALPHA: 27,
    ONE_MINUS_SRC_ALPHA: 28,
    COLOR_BUFFER_BIT: 29,
    DEPTH_BUFFER_BIT: 30,
    FLOAT: 31,
    TRIANGLES: 32,
    UNSIGNED_SHORT: 33,
    TEXTURE0: 34,
    BACK: 35,
    createShader() {
      state.shaderAllocations += 1;
      if (state.shaderAllocations === options.shaderAllocationFailureAt) return null;
      return { kind: 'shader', id: state.shaderAllocations };
    },
    shaderSource: noop,
    compileShader: noop,
    getShaderParameter: () => true,
    getShaderInfoLog: () => '',
    deleteShader(shader) { state.deletedShaders.push(shader); },
    createProgram() {
      state.programAllocations += 1;
      return { kind: 'program', id: state.programAllocations };
    },
    attachShader: noop,
    linkProgram: noop,
    getProgramParameter: () => true,
    getProgramInfoLog: () => '',
    deleteProgram(program) { state.deletedPrograms.push(program); },
    getAttribLocation() {
      state.attributeLookups += 1;
      return state.attributeLookups;
    },
    getUniformLocation() {
      state.uniformLookups += 1;
      return { id: state.uniformLookups };
    },
    createBuffer() {
      state.bufferAllocations += 1;
      if (state.bufferAllocations === options.bufferAllocationFailureAt) return null;
      return { kind: 'buffer', id: state.bufferAllocations };
    },
    bindBuffer: noop,
    bufferData(target, data, usage) { state.bufferUploads.push({ target, data, usage }); },
    deleteBuffer(buffer) { state.deletedBuffers.push(buffer); },
    createTexture() {
      state.textureAllocations += 1;
      return { kind: 'texture', id: state.textureAllocations };
    },
    bindTexture: noop,
    pixelStorei: noop,
    texImage2D() { state.textureUploads += 1; },
    texParameteri: noop,
    texParameterf: noop,
    generateMipmap: noop,
    deleteTexture(texture) { state.deletedTextures.push(texture); },
    getExtension: () => null,
    getParameter(parameter) {
      if (parameter === gl.MAX_TEXTURE_SIZE) return 4096;
      return null;
    },
    getError() { return state.errors.shift() ?? gl.NO_ERROR; },
    enable(value) { state.enableCalls.push(value); },
    disable: noop,
    depthFunc(value) { state.depthFunctionCalls.push(value); },
    blendFunc: noop,
    clearColor(...values) { state.clearColorCalls.push(values); },
    clearDepth: noop,
    viewport(...values) { state.viewportCalls.push(values); },
    useProgram() { state.useProgramCalls += 1; },
    uniform1i: noop,
    uniform1f: noop,
    uniform2f: noop,
    uniform3f: noop,
    uniformMatrix4fv: noop,
    activeTexture: noop,
    depthMask: noop,
    cullFace: noop,
    clear: noop,
    enableVertexAttribArray: noop,
    vertexAttribPointer: noop,
    drawElements() { state.drawCalls += 1; }
  };
  return { gl, state, options };
}

class EventCanvas {
  constructor(gl, parentNode = null) {
    this.gl = gl;
    this.parentNode = parentNode;
    this.style = {};
    this.listeners = new Map();
  }

  getContext() {
    return this.gl;
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type, event = {}) {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event);
  }

  listenerCount(type) {
    return this.listeners.get(type)?.size ?? 0;
  }

  firstListener(type) {
    return [...(this.listeners.get(type) ?? [])][0] ?? null;
  }
}

function mesh(marker = 1) {
  return {
    vertices: new Float32Array([marker, 0, 0]),
    indices: new Uint16Array([0]),
    groups: [{ materialKey: 'texture', projection: 'world', startIndex: 0, indexCount: 1 }]
  };
}

function textureProvider(keys = ['texture']) {
  const records = new Map(keys.map((key) => [key, {
    image: { width: 2, height: 2 },
    uploadKey: key,
    uvRect: { u0: 0, v0: 0, u1: 1, v1: 1 },
    width: 2,
    height: 2
  }]));
  return {
    getTextureKeys: () => [...keys],
    getTexture: (key) => records.get(key) ?? null
  };
}

function createHost(tracked, options = {}) {
  const canvas = options.canvas ?? new EventCanvas(tracked.gl);
  return {
    canvas,
    host: new WebGLRendererHost({
      canvas,
      width: options.width ?? 8,
      height: options.height ?? 6,
      pixelRatio: options.pixelRatio ?? 1,
      mesh: options.mesh ?? mesh(),
      textureProvider: options.textureProvider ?? textureProvider()
    })
  };
}

function frame() {
  return { camera: { x: 0, y: 0, z: 1, yaw: 0 } };
}

function world(material) {
  return {
    sectors: [{
      id: material,
      floor: 0,
      ceil: 3,
      floorMaterial: material,
      ceilingMaterial: material,
      vertices: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 2 }],
      walls: [
        { a: 0, b: 1, material },
        { a: 1, b: 2, material },
        { a: 2, b: 0, material }
      ]
    }]
  };
}

function resourceIds(resources) {
  return resources.map(({ id }) => id);
}

test('context listeners belong to the resolved canvas and initialization failures remove them', () => {
  const tracked = createTrackedGl();
  const canvas = new EventCanvas(tracked.gl);
  const containerListeners = [];
  const container = {
    ownerDocument: { createElement: () => canvas },
    appendChild(child) { child.parentNode = this; },
    removeChild(child) { child.parentNode = null; },
    addEventListener(...args) { containerListeners.push(args); }
  };
  const host = new WebGLRendererHost({
    container, width: 2, height: 2, mesh: mesh(), textureProvider: textureProvider()
  });

  assert.equal(canvas.listenerCount('webglcontextlost'), 1);
  assert.equal(canvas.listenerCount('webglcontextrestored'), 1);
  assert.deepEqual(containerListeners, []);
  host.destroy();
  assert.equal(canvas.listenerCount('webglcontextlost'), 0);
  assert.equal(canvas.listenerCount('webglcontextrestored'), 0);
  assert.equal(canvas.parentNode, null);

  const failed = createTrackedGl({ shaderAllocationFailureAt: 1 });
  const failedCanvas = new EventCanvas(failed.gl);
  assert.throws(
    () => new WebGLRendererHost({
      canvas: failedCanvas,
      width: 2,
      height: 2,
      mesh: mesh(),
      textureProvider: textureProvider()
    }),
    /Vertex shader allocation failed/
  );
  assert.equal(failedCanvas.listenerCount('webglcontextlost'), 0);
  assert.equal(failedCanvas.listenerCount('webglcontextrestored'), 0);
});

test('context loss prevents default, invalidates GPU handles, and makes rendering a neutral no-op', () => {
  const tracked = createTrackedGl();
  const { canvas, host } = createHost(tracked);
  const canonicalMesh = host.staticMesh;
  const uploadsBeforeLoss = tracked.state.bufferUploads.length;
  let prevented = false;

  canvas.emit('webglcontextlost', { preventDefault() { prevented = true; } });

  assert.equal(prevented, true);
  assert.deepEqual(host.getLifecycleStatus(), { state: 'lost', error: null });
  assert.equal(host.program, null);
  assert.equal(host.meshBuffers, null);
  assert.equal(host.dynamicBuffers, null);
  assert.equal(host.textureRegistry, null);
  assert.equal(host.staticMesh, canonicalMesh);
  assert.deepEqual(host.getTextureStats(), {
    total: 1, loaded: 0, failed: 0, uploadedTextures: 0
  });

  const stats = host.render(frame());
  assert.deepEqual(stats, { renderMs: 0, drawCalls: 0, texturedDrawCalls: 0 });
  assert.equal(tracked.state.bufferUploads.length, uploadsBeforeLoss);
  assert.equal(tracked.state.useProgramCalls, 0);
  assert.equal(tracked.state.drawCalls, 0);
  assert.deepEqual(tracked.state.deletedBuffers, []);
  assert.deepEqual(tracked.state.deletedTextures, []);
  assert.deepEqual(tracked.state.deletedPrograms, []);
  host.destroy();
});

test('context restoration recreates every renderer-owned GPU resource and resumes drawing', () => {
  const tracked = createTrackedGl();
  const { canvas, host } = createHost(tracked);
  const original = {
    program: host.program,
    meshBuffers: host.meshBuffers,
    dynamicBuffers: host.dynamicBuffers,
    texture: host.textureRegistry.get('texture').texture
  };

  canvas.emit('webglcontextlost', { preventDefault() {} });
  canvas.emit('webglcontextrestored');

  assert.deepEqual(host.getLifecycleStatus(), { state: 'ready', error: null });
  assert.notEqual(host.program, original.program);
  assert.notEqual(host.meshBuffers.vertexBuffer, original.meshBuffers.vertexBuffer);
  assert.notEqual(host.dynamicBuffers.vertexBuffer, original.dynamicBuffers.vertexBuffer);
  assert.notEqual(host.textureRegistry.get('texture').texture, original.texture);
  assert.equal(tracked.state.shaderAllocations, 4);
  assert.equal(tracked.state.programAllocations, 2);
  assert.equal(tracked.state.bufferAllocations, 8);
  assert.equal(tracked.state.textureAllocations, 2);
  assert.equal(tracked.state.textureUploads, 4);
  assert.equal(tracked.state.attributeLookups, 8);
  assert.equal(tracked.state.uniformLookups, 20);
  assert.equal(tracked.state.depthFunctionCalls.length, 2);
  assert.equal(tracked.state.clearColorCalls.length, 2);
  assert.deepEqual(tracked.state.viewportCalls, [[0, 0, 8, 6], [0, 0, 8, 6]]);

  const renderStats = host.render(frame());
  assert.equal(Number.isFinite(renderStats.renderMs), true);
  assert.equal(renderStats.drawCalls, 1);
  assert.equal(renderStats.texturedDrawCalls, 1);
  assert.equal(tracked.state.drawCalls, 1);
  host.destroy();
});

test('world replacement during loss retains and restores only the latest CPU mesh', () => {
  const tracked = createTrackedGl();
  const canvas = new EventCanvas(tracked.gl);
  const worldA = world('a');
  const worldB = world('b');
  const renderer = new SectorRenderer({
    world: worldA,
    canvas,
    width: 4,
    height: 3,
    textureProvider: textureProvider(['a', 'b'])
  });

  canvas.emit('webglcontextlost', { preventDefault() {} });
  const uploadCountAtLoss = tracked.state.bufferUploads.length;
  renderer.replaceWorld(worldB);

  assert.equal(renderer.world, worldB);
  assert.equal(tracked.state.bufferUploads.length, uploadCountAtLoss);
  assert.deepEqual(new Set(renderer.host.staticMesh.groups.map(({ materialKey }) => materialKey)), new Set(['b']));
  assert.equal(renderer.getStats().gpu.lifecycle, 'lost');
  assert.equal(renderer.getStats().gpu.texturesLoaded, 0);

  canvas.emit('webglcontextrestored');
  assert.equal(renderer.getStats().gpu.lifecycle, 'ready');
  assert.equal(renderer.getStats().gpu.restoreError, null);
  assert.equal(renderer.getStats().gpu.texturesLoaded, 2);
  assert.deepEqual(new Set(renderer.host.meshBuffers.groups.map(({ materialKey }) => materialKey)), new Set(['b']));
  const lastStaticVertexUpload = tracked.state.bufferUploads
    .filter(({ target, usage }) => target === tracked.gl.ARRAY_BUFFER && usage === tracked.gl.STATIC_DRAW)
    .at(-1);
  assert.equal(lastStaticVertexUpload.data, renderer.host.staticMesh.vertices);
  renderer.destroy();
});

test('resize during loss updates the canvas immediately and restores the latest viewport', () => {
  const tracked = createTrackedGl();
  const { canvas, host } = createHost(tracked, { width: 4, height: 3 });
  canvas.emit('webglcontextlost', { preventDefault() {} });
  const viewportCountAtLoss = tracked.state.viewportCalls.length;

  host.resize(10, 5, { pixelRatio: 2 });

  assert.equal(host.viewportWidth, 10);
  assert.equal(host.viewportHeight, 5);
  assert.equal(host.pixelRatio, 2);
  assert.equal(canvas.width, 20);
  assert.equal(canvas.height, 10);
  assert.equal(canvas.style.width, '10px');
  assert.equal(canvas.style.height, '5px');
  assert.equal(tracked.state.viewportCalls.length, viewportCountAtLoss);

  canvas.emit('webglcontextrestored');
  assert.deepEqual(tracked.state.viewportCalls.at(-1), [0, 0, 20, 10]);
  assert.equal(host.aspect, 2);
  host.destroy();
});

test('destroy while lost is idempotent, removes listeners, and blocks a captured restore callback', () => {
  const tracked = createTrackedGl();
  const parent = {};
  const canvas = new EventCanvas(tracked.gl, parent);
  const { host } = createHost(tracked, { canvas });
  const restoreCallback = canvas.firstListener('webglcontextrestored');
  canvas.emit('webglcontextlost', { preventDefault() {} });
  const allocationsAtLoss = {
    programs: tracked.state.programAllocations,
    buffers: tracked.state.bufferAllocations,
    textures: tracked.state.textureAllocations
  };

  host.destroy();
  host.destroy();
  restoreCallback();

  assert.deepEqual(host.getLifecycleStatus(), { state: 'destroyed', error: null });
  assert.equal(canvas.listenerCount('webglcontextlost'), 0);
  assert.equal(canvas.listenerCount('webglcontextrestored'), 0);
  assert.equal(canvas.parentNode, parent);
  assert.deepEqual({
    programs: tracked.state.programAllocations,
    buffers: tracked.state.bufferAllocations,
    textures: tracked.state.textureAllocations
  }, allocationsAtLoss);
  assert.deepEqual(tracked.state.deletedBuffers, []);
  assert.deepEqual(tracked.state.deletedTextures, []);
  assert.deepEqual(tracked.state.deletedPrograms, []);
});

test('destroy during restoration prevents the rebuild from starting', () => {
  const tracked = createTrackedGl();
  const canvas = new EventCanvas(tracked.gl);
  let host = null;
  host = new WebGLRendererHost({
    canvas,
    width: 2,
    height: 2,
    mesh: mesh(),
    textureProvider: textureProvider(),
    onLifecycleChange({ state }) {
      if (state === 'restoring' && host) host.destroy();
    }
  });
  canvas.emit('webglcontextlost', { preventDefault() {} });
  const allocationsAtLoss = tracked.state.bufferAllocations;

  canvas.emit('webglcontextrestored');

  assert.equal(host.lifecycle, 'destroyed');
  assert.equal(tracked.state.bufferAllocations, allocationsAtLoss);
  assert.equal(canvas.listenerCount('webglcontextlost'), 0);
  assert.equal(canvas.listenerCount('webglcontextrestored'), 0);
});

test('restore failure cleans staged resources and exposes an unavailable diagnostic without double deletion', () => {
  const tracked = createTrackedGl();
  const canvas = new EventCanvas(tracked.gl);
  const renderer = new SectorRenderer({
    world: world('texture'),
    canvas,
    width: 4,
    height: 3,
    textureProvider: textureProvider()
  });
  canvas.emit('webglcontextlost', { preventDefault() {} });
  tracked.options.bufferAllocationFailureAt = tracked.state.bufferAllocations + 4;

  canvas.emit('webglcontextrestored');

  assert.equal(renderer.host.lifecycle, 'lost');
  assert.equal(renderer.host.program, null);
  assert.equal(renderer.host.meshBuffers, null);
  assert.equal(renderer.host.dynamicBuffers, null);
  assert.equal(renderer.host.textureRegistry, null);
  assert.match(renderer.host.lastRestoreError.message, /context restoration failed.*Dynamic index buffer allocation failed/);
  assert.equal(renderer.getStats().gpu.lifecycle, 'lost');
  assert.match(renderer.getStats().gpu.restoreError, /Dynamic index buffer allocation failed/);
  assert.deepEqual(resourceIds(tracked.state.deletedBuffers), [7, 5, 6]);
  assert.deepEqual(resourceIds(tracked.state.deletedTextures), [2]);
  assert.deepEqual(resourceIds(tracked.state.deletedPrograms), [2]);
  assert.deepEqual(renderer.host.render(frame()), {
    renderMs: 0, drawCalls: 0, texturedDrawCalls: 0
  });

  const deletionCounts = {
    buffers: tracked.state.deletedBuffers.length,
    textures: tracked.state.deletedTextures.length,
    programs: tracked.state.deletedPrograms.length
  };
  renderer.destroy();
  renderer.destroy();
  assert.deepEqual({
    buffers: tracked.state.deletedBuffers.length,
    textures: tracked.state.deletedTextures.length,
    programs: tracked.state.deletedPrograms.length
  }, deletionCounts);
});
