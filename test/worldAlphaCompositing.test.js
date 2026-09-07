import assert from 'node:assert/strict';
import test from 'node:test';

import {
  compareTransparentWorldDraws,
  resolveWorldQuadAlphaCutoff,
  resolveWorldQuadAlphaMode,
  resolveWorldQuadDraws,
  WebGLRendererHost
} from '../src/webgl/WebGLRendererHost.js';
import { TEXTURED_FRAGMENT_SHADER } from '../src/webgl/shaders/texturedShaders.js';

function cornersAt(x, y) {
  return [
    [x - 0.5, y, 1],
    [x + 0.5, y, 1],
    [x + 0.5, y, 0],
    [x - 0.5, y, 0]
  ];
}

function quad(textureKey, x, y, fields = {}) {
  return { textureKey, corners: cornersAt(x, y), ...fields };
}

function createStateGl() {
  const state = {
    depthMask: true,
    depthMasks: [],
    enabled: [],
    blends: [],
    uniforms: []
  };
  const gl = {
    DEPTH_TEST: 'depth-test',
    BLEND: 'blend',
    SRC_ALPHA: 'src-alpha',
    ONE_MINUS_SRC_ALPHA: 'one-minus-src-alpha',
    enable(capability) { state.enabled.push(capability); },
    depthMask(enabled) {
      state.depthMask = enabled;
      state.depthMasks.push(enabled);
    },
    blendFunc(source, destination) { state.blends.push([source, destination]); },
    uniform1f(location, value) { state.uniforms.push([location, value]); }
  };
  return { gl, state };
}

function prepared(quads, forward = [0, 1, 0]) {
  return resolveWorldQuadDraws(quads, forward, 0, 0)
    .map((draw) => ({ ...draw, stableIndex: draw.submissionIndex }));
}

test('world quad compatibility resolution distinguishes opaque, mask, and blend modes', () => {
  assert.equal(resolveWorldQuadAlphaMode(quad('texture', 0, 1, { alphaMode: 'opaque' })), 'opaque');
  assert.equal(resolveWorldQuadAlphaMode(quad('texture', 0, 1, { alphaMode: 'mask' })), 'mask');
  assert.equal(resolveWorldQuadAlphaMode(quad('texture', 0, 1, { alphaMode: 'blend' })), 'blend');
  assert.equal(resolveWorldQuadAlphaMode(quad('texture', 0, 1)), 'mask');
  assert.equal(resolveWorldQuadAlphaMode(quad('texture', 0, 1, { opacity: 0.75 })), 'blend');
  assert.equal(resolveWorldQuadAlphaMode(quad('texture', 0, 1, { color: [1, 1, 1, 0.75] })), 'blend');
  assert.equal(resolveWorldQuadAlphaMode(quad(null, 0, 1, { color: [1, 1, 1, 1] })), 'opaque');
  assert.throws(
    () => resolveWorldQuadAlphaMode(quad('texture', 0, 1, { alphaMode: 'unknown' })),
    /Unsupported world quad alphaMode/
  );

  assert.equal(resolveWorldQuadAlphaCutoff(), 0.5);
  assert.equal(resolveWorldQuadAlphaCutoff(-1), 0);
  assert.equal(resolveWorldQuadAlphaCutoff(0.25), 0.25);
  assert.equal(resolveWorldQuadAlphaCutoff(2), 1);
});

test('mask shader discards transparent fragments and makes survivors opaque', () => {
  const discard = TEXTURED_FRAGMENT_SHADER.indexOf('if (baseColor.a < uAlphaCutoff) discard;');
  const output = TEXTURED_FRAGMENT_SHADER.indexOf('gl_FragColor =');
  assert.ok(discard >= 0 && discard < output, 'discard occurs before fragment color/depth output');
  assert.match(TEXTURED_FRAGMENT_SHADER, /else if \(uAlphaMode < 1\.5\)[\s\S]*outputAlpha = 1\.0;/);
  assert.match(TEXTURED_FRAGMENT_SHADER, /gl_FragColor = vec4\(baseColor\.rgb \* vLightLevel, outputAlpha\);/);
});

test('alpha modes and mask cutoff map to explicit shader uniforms', () => {
  const { gl, state } = createStateGl();
  const host = Object.create(WebGLRendererHost.prototype);
  Object.assign(host, {
    gl,
    uniformLocations: { alphaMode: 'alpha-mode', alphaCutoff: 'alpha-cutoff' }
  });
  host.setAlphaMode('opaque');
  host.setAlphaMode('mask', 0.3);
  host.setAlphaMode('blend');
  assert.deepEqual(state.uniforms, [
    ['alpha-mode', 0], ['alpha-cutoff', 0.5],
    ['alpha-mode', 1], ['alpha-cutoff', 0.3],
    ['alpha-mode', 2], ['alpha-cutoff', 0.5]
  ]);
});

test('opaque and masked world quads keep depth writes enabled and blended quads stay out of that pass', () => {
  const { gl, state } = createStateGl();
  const seen = [];
  const host = Object.create(WebGLRendererHost.prototype);
  Object.assign(host, {
    gl,
    drawPreparedWorldQuad(draw) {
      seen.push({ key: draw.quad.textureKey, alphaMode: draw.alphaMode, cutoff: draw.alphaCutoff, depthMask: state.depthMask });
      return true;
    }
  });

  const draws = prepared([
    quad('translucent', 0, 1, { alphaMode: 'blend' }),
    quad('solid', 0, 2, { alphaMode: 'opaque' }),
    quad('grate', 0, 3, { alphaMode: 'mask', alphaCutoff: 0.3 })
  ]);
  assert.equal(host.drawOpaqueWorldQuads({ draws, viewProjection: [] }), 2);
  assert.deepEqual(seen, [
    { key: 'solid', alphaMode: 'opaque', cutoff: 0.5, depthMask: true },
    { key: 'grate', alphaMode: 'mask', cutoff: 0.3, depthMask: true }
  ]);
  assert.deepEqual(state.depthMasks, [true]);
  assert.ok(state.enabled.includes(gl.DEPTH_TEST));
});

test('transparent world pass depth-tests, disables depth writes, configures blending, and restores state', () => {
  const { gl, state } = createStateGl();
  const seen = [];
  const host = Object.create(WebGLRendererHost.prototype);
  Object.assign(host, {
    gl,
    uniformLocations: { alphaMode: 'alpha-mode', alphaCutoff: 'alpha-cutoff' },
    drawPreparedWorldQuad(draw) {
      seen.push([draw.quad.textureKey, state.depthMask]);
      return true;
    }
  });

  const draws = prepared([
    quad('near', 0, 2, { alphaMode: 'blend' }),
    quad('far', 0, 4, { alphaMode: 'blend' })
  ]);
  assert.equal(host.drawTransparentWorld({ draws, viewProjection: [] }), 2);
  assert.deepEqual(seen, [['far', false], ['near', false]]);
  assert.ok(state.enabled.includes(gl.DEPTH_TEST));
  assert.ok(state.enabled.includes(gl.BLEND));
  assert.deepEqual(state.blends, [[gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA]]);
  assert.deepEqual(state.depthMasks, [false, true]);
  assert.deepEqual(state.uniforms.slice(-2), [['alpha-mode', 0], ['alpha-cutoff', 0.5]]);
});

test('transparent world pass restores depth and alpha shader state when drawing throws', () => {
  const { gl, state } = createStateGl();
  const host = Object.create(WebGLRendererHost.prototype);
  Object.assign(host, {
    gl,
    uniformLocations: { alphaMode: 'alpha-mode', alphaCutoff: 'alpha-cutoff' },
    drawPreparedWorldQuad() { throw new Error('injected draw failure'); }
  });

  assert.throws(
    () => host.drawTransparentWorld({
      draws: prepared([quad('broken', 0, 2, { alphaMode: 'blend' })]),
      viewProjection: []
    }),
    /injected draw failure/
  );
  assert.equal(state.depthMask, true);
  assert.deepEqual(state.uniforms.slice(-2), [['alpha-mode', 0], ['alpha-cutoff', 0.5]]);
});

test('transparent world quad ordering uses camera-forward depth instead of radial distance', () => {
  const draws = prepared([
    quad('radially-farther', 2, 4, { alphaMode: 'blend' }),
    quad('camera-deeper', 1.5, 4.1, { alphaMode: 'blend' })
  ]);
  assert.ok(Math.hypot(2, 4) > Math.hypot(1.5, 4.1));
  assert.deepEqual(draws.sort(compareTransparentWorldDraws).map(({ quad: item }) => item.textureKey), [
    'camera-deeper', 'radially-farther'
  ]);
});

test('transparent world quad ordering follows camera yaw', () => {
  const quads = [
    quad('x-deeper', 4, 1, { alphaMode: 'blend' }),
    quad('y-deeper', 1, 4, { alphaMode: 'blend' })
  ];
  const keys = (forward) => prepared(quads, forward)
    .sort(compareTransparentWorldDraws).map(({ quad: item }) => item.textureKey);
  assert.deepEqual(keys([0, 1, 0]), ['y-deeper', 'x-deeper']);
  assert.deepEqual(keys([1, 0, 0]), ['x-deeper', 'y-deeper']);
});

test('equal-depth transparent world quads retain deterministic submission order', () => {
  const draws = prepared([
    quad('first', -2, 4, { alphaMode: 'blend' }),
    quad('second', 2, 4, { alphaMode: 'blend' })
  ]);
  assert.deepEqual(draws.reverse().sort(compareTransparentWorldDraws).map(({ quad: item }) => item.textureKey), [
    'first', 'second'
  ]);
});

test('blended world quads and billboard sprites interleave by shared camera depth', () => {
  const drawOrder = (quadDepth, spriteDepth) => {
    const { gl } = createStateGl();
    const order = [];
    const host = Object.create(WebGLRendererHost.prototype);
    Object.assign(host, {
      gl,
      uniformLocations: { alphaMode: 'alpha-mode', alphaCutoff: 'alpha-cutoff' },
      textureRegistry: { get: () => ({ width: 1, height: 1 }) },
      drawPreparedWorldQuad(draw) { order.push(draw.quad.textureKey); return true; },
      drawWorldSprite(draw) { order.push(draw.sprite.textureKey); return true; }
    });
    const quadDraw = { ...prepared([quad('quad', 0, quadDepth, { alphaMode: 'blend' })])[0], stableIndex: 0 };
    const spriteDraw = host.resolveWorldSpriteDraws({
      sprites: [{ textureKey: 'sprite', x: 0, y: spriteDepth, z: 0, order: 0 }],
      cameraRight: [1, 0, 0], cameraForward: [0, 1, 0],
      viewerX: 0, viewerY: 0, viewerZ: 0, stableIndexOffset: 1
    })[0];
    host.drawTransparentWorld({ draws: [quadDraw, spriteDraw], viewProjection: [] });
    return order;
  };

  assert.deepEqual(drawOrder(4, 2), ['quad', 'sprite']);
  assert.deepEqual(drawOrder(2, 4), ['sprite', 'quad']);
});

test('sprite order remains the deterministic tie-break for effectively equal sprite depths', () => {
  const sprites = [
    { kind: 'sprite', sprite: { textureKey: 'higher-order', order: 5 }, depth: 4.0000005, stableIndex: 0 },
    { kind: 'sprite', sprite: { textureKey: 'lower-order', order: -2 }, depth: 4, stableIndex: 1 }
  ];
  assert.deepEqual(sprites.sort(compareTransparentWorldDraws).map(({ sprite }) => sprite.textureKey), [
    'lower-order', 'higher-order'
  ]);
});

test('static world, sprites, and overlays establish their own alpha behavior', () => {
  const staticModes = [];
  const staticHost = Object.create(WebGLRendererHost.prototype);
  Object.assign(staticHost, {
    gl: {
      ELEMENT_ARRAY_BUFFER: 1,
      bindBuffer() {}, uniformMatrix4fv() {}, uniform3f() {}, uniform1f() {}, disable() {}
    },
    meshBuffers: { vertexBuffer: {}, indexBuffer: {}, groups: [] },
    uniformLocations: {},
    setupVertexAttributes() {},
    setAlphaMode(mode) { staticModes.push(mode); }
  });
  staticHost.drawStaticWorld([], { x: 0, y: 0, z: 0, yaw: 0 });
  assert.deepEqual(staticModes, ['opaque']);

  let spriteMode;
  const spriteHost = Object.create(WebGLRendererHost.prototype);
  Object.assign(spriteHost, {
    drawQuad(draw) { spriteMode = draw.alphaMode; return true; },
    buildWorldBillboardQuad: WebGLRendererHost.prototype.buildWorldBillboardQuad
  });
  spriteHost.drawWorldSprite({
    sprite: { textureKey: 'sprite', x: 0, y: 1, z: 0 },
    textureRecord: {}, dimensions: { width: 1, height: 1 },
    placement: { center: [0, 1, 0], scale: 1 }, viewProjection: [], cameraRight: [1, 0, 0],
    viewerX: 0, viewerY: 0, viewerZ: 0
  });
  assert.equal(spriteMode, 'blend');

  const { gl, state } = createStateGl();
  gl.disable = () => {};
  const overlayModes = [];
  const overlayHost = Object.create(WebGLRendererHost.prototype);
  Object.assign(overlayHost, {
    gl,
    viewportWidth: 100,
    viewportHeight: 100,
    uniformLocations: { alphaMode: 'alpha-mode', alphaCutoff: 'alpha-cutoff' },
    drawQuad(draw) { overlayModes.push(draw.alphaMode); return true; }
  });
  overlayHost.drawOverlays([{
    textureKey: 'overlay', anchorX: 0.5, anchorY: 0.5, width: 10, height: 10
  }]);
  assert.deepEqual(overlayModes, ['blend']);
  assert.equal(state.depthMask, true);
  assert.deepEqual(state.uniforms.slice(-2), [['alpha-mode', 0], ['alpha-cutoff', 0.5]]);
});

test('opaque and masked geometry is submitted before transparent world objects', () => {
  const { gl } = createStateGl();
  Object.assign(gl, {
    COLOR_BUFFER_BIT: 1,
    DEPTH_BUFFER_BIT: 2,
    clear() {}, useProgram() {}, uniform1i() {}
  });
  const order = [];
  const host = Object.create(WebGLRendererHost.prototype);
  Object.assign(host, {
    gl,
    program: {},
    uniformLocations: { texture: 'texture' },
    projection: { fovY: Math.PI / 2, near: 0.1, far: 100 },
    aspect: 1,
    textureRegistry: { get: () => null },
    drawStaticWorld() { order.push('static'); return { drawCalls: 0, texturedDrawCalls: 0 }; },
    drawOpaqueWorldQuads({ draws }) {
      order.push(...draws.filter(({ alphaMode }) => alphaMode !== 'blend').map(({ quad: item }) => item.textureKey));
      return 2;
    },
    resolveWorldSpriteDraws() { return []; },
    drawTransparentWorld({ draws }) {
      order.push(...draws.map(({ quad: item }) => item.textureKey));
      return 1;
    },
    drawOverlays() { return 0; }
  });
  host.render({
    camera: { x: 0, y: 0, z: 0, yaw: 0 },
    worldQuads: [
      quad('blend-first', 0, 4, { alphaMode: 'blend' }),
      quad('opaque-later', 0, 2, { alphaMode: 'opaque' }),
      quad('mask-last', 0, 3, { alphaMode: 'mask' })
    ]
  });
  assert.deepEqual(order, ['static', 'opaque-later', 'mask-last', 'blend-first']);
});
