export function createTrackedGl(options = {}) {
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
    vertexAttributeEnables: [],
    vertexAttributePointers: [],
    bufferBindings: [],
    drawSubmissions: [],
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
  const boundBuffers = new Map();
  const bufferContents = new Map();
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
    bindBuffer(target, buffer) {
      boundBuffers.set(target, buffer);
      state.bufferBindings.push({ target, buffer });
    },
    bufferData(target, data, usage) {
      const buffer = boundBuffers.get(target) ?? null;
      state.bufferUploads.push({ target, data, usage, buffer });
      bufferContents.set(buffer, data);
      if (state.bufferUploads.length === options.bufferUploadErrorAt) {
        state.errors.push(gl.OUT_OF_MEMORY);
      }
    },
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
    enableVertexAttribArray(location) { state.vertexAttributeEnables.push(location); },
    vertexAttribPointer(location, size, type, normalized, stride, offset) {
      state.vertexAttributePointers.push({
        location, size, type, normalized, stride, offset,
        buffer: boundBuffers.get(gl.ARRAY_BUFFER) ?? null
      });
    },
    drawElements(mode, count, type, offset) {
      state.drawCalls += 1;
      const vertexBuffer = boundBuffers.get(gl.ARRAY_BUFFER) ?? null;
      state.drawSubmissions.push({
        mode,
        count,
        type,
        offset,
        vertexBuffer,
        indexBuffer: boundBuffers.get(gl.ELEMENT_ARRAY_BUFFER) ?? null,
        vertexData: bufferContents.get(vertexBuffer) ?? null
      });
    }
  };
  return { gl, state, options };
}

export class EventCanvas {
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

export function mesh(marker = 1) {
  return {
    vertices: new Float32Array([marker, 0, 0]),
    indices: new Uint16Array([0]),
    groups: [{ materialKey: 'texture', projection: 'world', startIndex: 0, indexCount: 1 }]
  };
}

export function textureProvider(keys = ['texture']) {
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

export function world(material) {
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

