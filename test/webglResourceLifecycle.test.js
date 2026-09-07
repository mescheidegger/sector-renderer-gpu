import assert from 'node:assert/strict';
import test from 'node:test';
import { createShaderProgram } from '../src/webgl/createShaderProgram.js';
import { createGpuMeshBuffers } from '../src/webgl/mesh/createGpuMeshBuffers.js';
import { createTextureRegistry } from '../src/webgl/textures/createTextureRegistry.js';
import { WebGLRendererHost } from '../src/webgl/WebGLRendererHost.js';

function createTrackedGl(options = {}) {
  const state = {
    bufferAllocations: 0,
    bufferUploads: 0,
    textureAllocations: 0,
    textureUploads: 0,
    shaderAllocations: 0,
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
    createShader() {
      state.shaderAllocations += 1;
      if (state.shaderAllocations === options.shaderAllocationFailureAt) return null;
      return { kind: 'shader', id: state.shaderAllocations };
    },
    shaderSource: noop,
    compileShader: noop,
    getShaderParameter(shader) {
      return shader.id !== options.shaderCompilationFailureAt;
    },
    getShaderInfoLog: () => 'injected compile error',
    deleteShader(shader) { state.deletedShaders.push(shader); },
    createProgram() {
      return options.programAllocationFailure ? null : { kind: 'program', id: 1 };
    },
    attachShader: noop,
    linkProgram: noop,
    getProgramParameter: () => !options.programLinkFailure,
    getProgramInfoLog: () => 'injected link error',
    deleteProgram(program) { state.deletedPrograms.push(program); },
    createBuffer() {
      state.bufferAllocations += 1;
      if (state.bufferAllocations === options.bufferAllocationFailureAt) return null;
      return { kind: 'buffer', id: state.bufferAllocations };
    },
    bindBuffer: noop,
    bufferData() {
      state.bufferUploads += 1;
      if (state.bufferUploads === options.bufferUploadErrorAt) {
        state.errors.push(gl.OUT_OF_MEMORY);
      }
    },
    deleteBuffer(buffer) { state.deletedBuffers.push(buffer); },
    createTexture() {
      state.textureAllocations += 1;
      if (state.textureAllocations === options.textureAllocationFailureAt) return null;
      return { kind: 'texture', id: state.textureAllocations };
    },
    bindTexture: noop,
    pixelStorei: noop,
    texImage2D() {
      state.textureUploads += 1;
      if (state.textureUploads === options.textureUploadErrorAt) {
        state.errors.push(gl.INVALID_VALUE);
      }
    },
    texParameteri: noop,
    texParameterf: noop,
    generateMipmap() {
      if (options.mipmapError) state.errors.push(gl.INVALID_OPERATION);
    },
    deleteTexture(texture) { state.deletedTextures.push(texture); },
    getExtension: () => null,
    getParameter(parameter) {
      if (parameter === gl.MAX_TEXTURE_SIZE) return options.maxTextureSize ?? 4096;
      return null;
    },
    getError() { return state.errors.shift() ?? gl.NO_ERROR; },
    getAttribLocation: () => 0,
    getUniformLocation: () => ({}),
    enable: noop,
    disable: noop,
    depthFunc: noop,
    blendFunc: noop,
    clearColor: noop,
    clearDepth: noop,
    viewport: noop
  };
  return { gl, state };
}

const mesh = () => ({
  vertices: new Float32Array([0, 0, 0]),
  indices: new Uint16Array([0]),
  groups: [{ startIndex: 0, indexCount: 1 }]
});

const image = (width = 2, height = 2) => ({ width, height });

function textureRecord(uploadKey, textureImage = image()) {
  return {
    image: textureImage,
    uploadKey,
    uvRect: { u0: 0, v0: 0, u1: 1, v1: 1 },
    width: textureImage.width,
    height: textureImage.height
  };
}

function provider(records = {}) {
  return {
    getTextureKeys: () => Object.keys(records),
    getTexture: (key) => records[key] ?? null
  };
}

function ids(resources) {
  return resources.map((resource) => resource.id);
}

function createCanvas(gl, parentNode = null) {
  return {
    style: {},
    parentNode,
    getContext: () => gl
  };
}

test('static mesh upload rejects null buffer allocations and deletes partial buffers', () => {
  const vertexFailure = createTrackedGl({ bufferAllocationFailureAt: 1 });
  let uploaded;
  assert.throws(() => { uploaded = createGpuMeshBuffers(vertexFailure.gl, mesh()); }, /Vertex buffer allocation failed/);
  assert.equal(uploaded, undefined);
  assert.deepEqual(vertexFailure.state.deletedBuffers, []);

  const indexFailure = createTrackedGl({ bufferAllocationFailureAt: 2 });
  assert.throws(() => createGpuMeshBuffers(indexFailure.gl, mesh()), /Index buffer allocation failed/);
  assert.deepEqual(ids(indexFailure.state.deletedBuffers), [1]);
});

test('static mesh upload detects vertex and index GL errors and releases every staged buffer', () => {
  const vertexFailure = createTrackedGl({ bufferUploadErrorAt: 1 });
  assert.throws(() => createGpuMeshBuffers(vertexFailure.gl, mesh()), /Vertex-buffer GPU upload failed.*OUT_OF_MEMORY/);
  assert.deepEqual(ids(vertexFailure.state.deletedBuffers), [1]);

  const indexFailure = createTrackedGl({ bufferUploadErrorAt: 2 });
  assert.throws(() => createGpuMeshBuffers(indexFailure.gl, mesh()), /Index-buffer GPU upload failed.*OUT_OF_MEMORY/);
  assert.deepEqual(ids(indexFailure.state.deletedBuffers), [2, 1]);
});

test('static mesh replacement preserves the old mesh when staging fails', () => {
  const { gl, state } = createTrackedGl({ bufferUploadErrorAt: 2 });
  const host = Object.create(WebGLRendererHost.prototype);
  const oldMesh = { vertexBuffer: { id: 'old-v' }, indexBuffer: { id: 'old-i' }, groups: [] };
  host.gl = gl;
  host.meshBuffers = oldMesh;

  assert.throws(() => host.replaceStaticMesh(mesh()), /Index-buffer GPU upload failed/);
  assert.equal(host.meshBuffers, oldMesh);
  assert.deepEqual(ids(state.deletedBuffers), [2, 1]);
});

test('successful static mesh replacement installs new buffers and releases old buffers once', () => {
  const { gl, state } = createTrackedGl();
  const host = Object.create(WebGLRendererHost.prototype);
  const oldMesh = { vertexBuffer: { id: 'old-v' }, indexBuffer: { id: 'old-i' }, groups: [] };
  host.gl = gl;
  host.meshBuffers = oldMesh;
  host.dynamicBuffers = null;
  host.textureRegistry = null;
  host.program = null;
  host.canvas = createCanvas(gl);
  host.ownsCanvas = false;
  host.ownerContainer = null;

  host.replaceStaticMesh(mesh());
  assert.notEqual(host.meshBuffers, oldMesh);
  assert.deepEqual(ids(state.deletedBuffers), ['old-v', 'old-i']);
  assert.deepEqual([host.meshBuffers.vertexBuffer.id, host.meshBuffers.indexBuffer.id], [1, 2]);

  host.destroy();
  host.destroy();
  assert.deepEqual(ids(state.deletedBuffers), ['old-v', 'old-i', 1, 2]);
});

test('texture registry rejects allocation, upload, mipmap, and device-limit failures transactionally', () => {
  const allocationFailure = createTrackedGl({ textureAllocationFailureAt: 1 });
  assert.throws(
    () => createTextureRegistry(allocationFailure.gl, ['a'], provider({ a: textureRecord('a') })),
    /Texture allocation failed.*"a"/
  );
  assert.deepEqual(allocationFailure.state.deletedTextures, []);

  const uploadFailure = createTrackedGl({ textureUploadErrorAt: 2 });
  let registry;
  assert.throws(
    () => { registry = createTextureRegistry(uploadFailure.gl, ['a'], provider({ a: textureRecord('a') })); },
    /Texture GPU upload.*image upload.*INVALID_VALUE/
  );
  assert.equal(registry, undefined);
  assert.deepEqual(ids(uploadFailure.state.deletedTextures), [1]);

  const mipmapFailure = createTrackedGl({ mipmapError: true });
  assert.throws(
    () => createTextureRegistry(mipmapFailure.gl, ['a'], provider({ a: textureRecord('a') })),
    /mipmap\/sampling configuration.*INVALID_OPERATION/
  );
  assert.deepEqual(ids(mipmapFailure.state.deletedTextures), [1]);

  const limitFailure = createTrackedGl({ maxTextureSize: 4 });
  assert.throws(
    () => createTextureRegistry(limitFailure.gl, ['huge'], provider({ huge: textureRecord('huge', image(8, 2)) })),
    /"huge" \(8x2\).*exceeds.*MAX_TEXTURE_SIZE \(4\)/
  );
  assert.equal(limitFailure.state.textureAllocations, 0);
});

test('texture registry rolls back prior uploads after a later texture fails', () => {
  const { gl, state } = createTrackedGl({ textureUploadErrorAt: 4 });
  const records = {
    first: textureRecord('first'),
    second: textureRecord('second')
  };
  assert.throws(
    () => createTextureRegistry(gl, ['first', 'second'], provider(records)),
    /"second".*Texture GPU upload/
  );
  assert.deepEqual(ids(state.deletedTextures), [1, 2]);
});

test('texture uploadKey deduplication retains one loaded GPU texture and destroys it once', () => {
  const { gl, state } = createTrackedGl();
  const sharedImage = image();
  const registry = createTextureRegistry(gl, ['a', 'b'], provider({
    a: textureRecord('shared', sharedImage),
    b: textureRecord('shared', sharedImage)
  }));

  assert.equal(registry.get('a').loaded, true);
  assert.equal(registry.get('a').failed, false);
  assert.equal(registry.get('a').texture, registry.get('b').texture);
  assert.deepEqual(registry.getStats(), { total: 2, loaded: 2, failed: 0, uploadedTextures: 1 });
  registry.destroy();
  registry.destroy();
  assert.deepEqual(ids(state.deletedTextures), [1]);
});

test('shader and program construction cleans up exact resources at every failure stage', () => {
  const cases = [
    [{ shaderAllocationFailureAt: 1 }, /Vertex shader allocation failed/, [], []],
    [{ shaderCompilationFailureAt: 1 }, /Vertex shader compilation failed/, [1], []],
    [{ shaderAllocationFailureAt: 2 }, /Fragment shader allocation failed/, [1], []],
    [{ shaderCompilationFailureAt: 2 }, /Fragment shader compilation failed/, [2, 1], []],
    [{ programAllocationFailure: true }, /Shader program allocation failed/, [1, 2], []],
    [{ programLinkFailure: true }, /Shader program link failed/, [1, 2], [1]]
  ];

  for (const [options, message, deletedShaders, deletedPrograms] of cases) {
    const { gl, state } = createTrackedGl(options);
    assert.throws(
      () => createShaderProgram(gl, { vertexSource: 'vertex', fragmentSource: 'fragment' }),
      message
    );
    assert.deepEqual(ids(state.deletedShaders), deletedShaders);
    assert.deepEqual(ids(state.deletedPrograms), deletedPrograms);
  }
});

test('renderer initialization releases a program when static mesh allocation fails', () => {
  const { gl, state } = createTrackedGl({ bufferAllocationFailureAt: 1 });
  const parent = {};
  const canvas = createCanvas(gl, parent);
  assert.throws(
    () => new WebGLRendererHost({ canvas, width: 1, height: 1, mesh: mesh(), textureProvider: provider() }),
    /Vertex buffer allocation failed/
  );
  assert.deepEqual(ids(state.deletedPrograms), [1]);
  assert.deepEqual(ids(state.deletedShaders), [1, 2]);
  assert.equal(canvas.parentNode, parent);
});

test('renderer initialization releases static mesh and program when texture allocation fails', () => {
  const { gl, state } = createTrackedGl({ textureAllocationFailureAt: 1 });
  const canvas = createCanvas(gl);
  assert.throws(
    () => new WebGLRendererHost({
      canvas,
      width: 1,
      height: 1,
      mesh: mesh(),
      textureProvider: provider({ a: textureRecord('a') })
    }),
    /Texture allocation failed/
  );
  assert.deepEqual(ids(state.deletedBuffers), [1, 2]);
  assert.deepEqual(ids(state.deletedPrograms), [1]);
});

test('renderer initialization cleans one partial dynamic buffer and all earlier resources', () => {
  const { gl, state } = createTrackedGl({ bufferAllocationFailureAt: 4 });
  const canvas = createCanvas(gl);
  const container = {
    ownerDocument: { createElement: () => canvas },
    appendChild(child) { child.parentNode = this; },
    removeChild(child) { child.parentNode = null; }
  };

  assert.throws(
    () => new WebGLRendererHost({
      container,
      width: 1,
      height: 1,
      mesh: mesh(),
      textureProvider: provider({ a: textureRecord('a') })
    }),
    /Dynamic index buffer allocation failed/
  );
  assert.deepEqual(ids(state.deletedBuffers), [3, 1, 2]);
  assert.deepEqual(ids(state.deletedTextures), [1]);
  assert.deepEqual(ids(state.deletedPrograms), [1]);
  assert.equal(canvas.parentNode, null);
});

test('successful renderer destruction releases all owned GPU resources exactly once and preserves caller canvas', () => {
  const { gl, state } = createTrackedGl();
  const parent = {};
  const canvas = createCanvas(gl, parent);
  const host = new WebGLRendererHost({
    canvas,
    width: 2,
    height: 2,
    mesh: mesh(),
    textureProvider: provider({ a: textureRecord('a') })
  });

  host.destroy();
  host.destroy();
  assert.deepEqual(ids(state.deletedBuffers), [3, 4, 1, 2]);
  assert.deepEqual(ids(state.deletedTextures), [1]);
  assert.deepEqual(ids(state.deletedPrograms), [1]);
  assert.deepEqual(ids(state.deletedShaders), [1, 2]);
  assert.equal(canvas.parentNode, parent);
});
