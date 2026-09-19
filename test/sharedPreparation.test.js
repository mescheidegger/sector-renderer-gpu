import assert from 'node:assert/strict';
import test from 'node:test';
import { SectorRenderer } from '../src/SectorRenderer.js';
import { schedulePreparationBatch } from '../src/webgl/schedulePreparationBatch.js';
import { createTrackedGl, EventCanvas, textureProvider, world } from './helpers/trackedWebGL.js';

function setup(count = 160) {
  const tracked = createTrackedGl();
  const canvas = new EventCanvas(tracked.gl);
  const renderer = new SectorRenderer({
    canvas, textureProvider: textureProvider(Array.from({ length: count }, (_, i) => `t${i}`))
  });
  const queue = [];
  renderer.host.schedulePreparationBatch = (callback) => {
    const job = { callback, cancelled: false };
    queue.push(job);
    return () => { job.cancelled = true; };
  };
  const step = () => { const job = queue.shift(); if (job && !job.cancelled) job.callback(); };
  const flush = () => { for (let i = 0; queue.length; i++) { assert.ok(i < 1000); step(); } };
  return { ...tracked, canvas, renderer, queue, step, flush };
}

test('worldless preparation is segmented, single-owner, and reused by first and subsequent worlds', async () => {
  const { renderer, state, step, flush } = setup();
  assert.equal(renderer.world, null);
  assert.equal(renderer.host.program, null);
  assert.equal(renderer.getStats().gpu.lifecycle, 'unprepared');
  renderer.render({ camera: { x: 0, y: 0, z: 1, yaw: 0 } });
  assert.equal(state.drawCalls, 0);
  const preparation = renderer.prepareSharedResources();
  assert.equal(preparation, renderer.prepareSharedResources());
  assert.equal(state.textureUploads, 0, 'even the first batch is scheduled');
  step();
  assert.ok(state.textureAllocations > 0 && state.textureAllocations < 160);
  assert.equal(renderer.host.textureRegistry, null, 'partial registries are never published');
  assert.throws(() => renderer.replaceWorld(world('t0')), /Await prepareSharedResources/);
  // Simulate a first-world consumer arriving while background preparation is running.
  const earlyStart = renderer.prepareSharedResources().then(() => renderer.replaceWorld(world('t0')));
  assert.equal(state.programAllocations, 1);
  flush();
  await earlyStart;
  const registry = renderer.host.textureRegistry;
  const program = renderer.host.program;
  const dynamicBuffers = renderer.host.dynamicBuffers;
  assert.equal(state.textureAllocations, 160);
  assert.equal(state.textureUploads, 320, 'one fallback and one image upload per unique texture');
  assert.equal(renderer.world.sectors[0].id, 't0');
  await renderer.prepareSharedResources();
  renderer.replaceWorld(world('t1'));
  assert.equal(renderer.host.textureRegistry, registry);
  assert.equal(renderer.host.program, program);
  assert.equal(renderer.host.dynamicBuffers, dynamicBuffers);
  assert.equal(state.textureUploads, 320);
  renderer.destroy();
  renderer.destroy();
  assert.equal(state.deletedTextures.length, 160);
  assert.equal(new Set(state.deletedTextures).size, 160);
  assert.equal(state.deletedPrograms.length, 1);
  assert.equal(state.deletedBuffers.length, state.bufferAllocations);
});

test('prepared worldless resources need no static buffers; first world failure is transactional', async () => {
  const { renderer, state, options, flush } = setup(1);
  const preparation = renderer.prepareSharedResources(); flush(); await preparation;
  assert.equal(renderer.host.staticMesh, null);
  assert.equal(renderer.host.meshBuffers, null);
  assert.equal(state.bufferAllocations, 2, 'only presentation buffers exist');
  options.bufferUploadErrorAt = state.bufferUploads.length + 1;
  assert.throws(() => renderer.replaceWorld(world('t0')), /OUT_OF_MEMORY/);
  assert.equal(renderer.world, null);
  assert.equal(renderer.host.meshBuffers, null);
  assert.equal(state.textureAllocations, 1);
  options.bufferUploadErrorAt = null;
  renderer.replaceWorld(world('t0'));
  renderer.render({ camera: { x: 0, y: 0, z: 1, yaw: 0 } });
  assert.ok(state.drawCalls > 0);
  renderer.destroy();
});

test('partial upload failure rolls back all staged resources and permits a clean retry', async () => {
  const { renderer, state, step, flush } = setup();
  const provider = renderer.host.textureProvider;
  const getTexture = provider.getTexture;
  provider.getTexture = (key) => { if (key === 't80') throw new Error('injected upload failure'); return getTexture(key); };
  const preparation = renderer.prepareSharedResources();
  const rejected = assert.rejects(preparation, /injected upload failure/);
  step(); flush(); await rejected;
  assert.equal(renderer.host.lifecycle, 'failed');
  assert.equal(renderer.host.textureRegistry, null);
  assert.equal(state.deletedTextures.length, state.textureAllocations);
  assert.equal(state.deletedPrograms.length, state.programAllocations);
  provider.getTexture = getTexture;
  const retry = renderer.prepareSharedResources(); flush(); await retry;
  assert.equal(renderer.host.lifecycle, 'ready');
  renderer.destroy();
  assert.equal(state.deletedTextures.length, state.textureAllocations);
});

test('destroy during preparation closes staging immediately and cancels future work', async () => {
  const { renderer, state, step, flush, queue } = setup();
  const preparation = renderer.prepareSharedResources();
  const rejected = assert.rejects(preparation, /destroyed/);
  step();
  const staleCallback = queue[0].callback;
  const allocations = state.textureAllocations;
  renderer.destroy();
  assert.equal(state.deletedTextures.length, allocations);
  assert.equal(state.deletedPrograms.length, 1);
  staleCallback(); flush(); await rejected;
  assert.equal(state.textureAllocations, allocations);
  assert.equal(renderer.host.textureRegistry, null);
  await assert.rejects(renderer.prepareSharedResources(), /destroyed/);
});

test('loss during preparation invalidates staging and old callbacks cannot publish after restoration', async () => {
  const { renderer, canvas, state, step, flush, queue } = setup();
  const preparation = renderer.prepareSharedResources();
  const rejected = assert.rejects(preparation, /context lost/);
  step();
  const staleCallback = queue[0].callback;
  const allocations = state.textureAllocations;
  canvas.emit('webglcontextlost', { preventDefault() {} });
  assert.equal(renderer.host.lifecycle, 'lost');
  assert.equal(state.deletedTextures.length, 0, 'no GL cleanup on a lost context');
  assert.equal(state.deletedPrograms.length, 0);
  flush(); await rejected;
  assert.equal(state.textureAllocations, allocations);
  assert.equal(renderer.host.textureRegistry, null);
  await assert.rejects(renderer.prepareSharedResources(), /lost/);
  canvas.emit('webglcontextrestored');
  const restored = renderer.prepareSharedResources();
  staleCallback();
  flush(); await restored;
  assert.equal(renderer.host.lifecycle, 'ready');
  assert.equal(state.textureAllocations, allocations + 160);
  renderer.replaceWorld(world('t0'));
  renderer.destroy();
  assert.equal(state.deletedTextures.length, 160);
});

test('restoration of prepared resources supports no world and the latest world installed while restoring', async () => {
  const { renderer, canvas, state, flush } = setup(2);
  const prepared = renderer.prepareSharedResources(); flush(); await prepared;
  canvas.emit('webglcontextlost'); canvas.emit('webglcontextrestored');
  const restoring = renderer.prepareSharedResources(); flush(); await restoring;
  assert.equal(renderer.host.meshBuffers, null);
  renderer.replaceWorld(world('t0'));
  canvas.emit('webglcontextlost'); canvas.emit('webglcontextrestored');
  const restoredWorld = renderer.prepareSharedResources();
  renderer.replaceWorld(world('t1'));
  flush(); await restoredWorld;
  assert.equal(renderer.host.meshBuffers.groups[0].materialKey, 't1');
  assert.equal(state.programAllocations, 3);
  assert.equal(state.textureAllocations, 6);
  renderer.destroy();
});

test('a lost context detected before the event prevents the next GL batch', async () => {
  const { renderer, gl, state, step, flush } = setup();
  const preparing = renderer.prepareSharedResources();
  const rejected = assert.rejects(preparing, /context lost/);
  step(); const uploads = state.textureUploads;
  gl.isContextLost = () => true;
  flush(); await rejected;
  assert.equal(state.textureUploads, uploads);
  assert.equal(state.deletedTextures.length, 0);
  renderer.destroy();
});

test('time budget can yield between fallback, image upload, and mipmap validation', async (t) => {
  const { renderer, gl, state, step, flush } = setup(1);
  let clock = 0;
  t.mock.method(performance, 'now', () => clock);
  const upload = gl.texImage2D;
  gl.texImage2D = (...args) => { clock += 9; upload(...args); };
  const preparing = renderer.prepareSharedResources();
  step();
  assert.equal(state.textureUploads, 1, 'only the fallback allocation fits this batch');
  step();
  assert.equal(state.textureUploads, 2, 'the image upload is its own atomic stage');
  assert.equal(renderer.host.textureRegistry, null, 'sampling still needs validation');
  gl.generateMipmap = () => { state.errors.push(gl.OUT_OF_MEMORY); };
  const rejected = assert.rejects(preparing, /mipmap.*OUT_OF_MEMORY/);
  flush(); await rejected;
  assert.equal(state.deletedTextures.length, 1);
  assert.equal(state.deletedPrograms.length, 1);
  assert.equal(renderer.host.textureRegistry, null);
  renderer.destroy();
});

test('incremental atlas aliases retain one validated upload across batch boundaries', async () => {
  const { renderer, state, flush } = setup(200);
  const record = renderer.host.textureProvider.getTexture('t0');
  renderer.host.textureProvider.getTexture = () => record;
  const preparing = renderer.prepareSharedResources(); flush(); await preparing;
  assert.equal(state.textureAllocations, 1);
  assert.equal(state.textureUploads, 2);
  assert.equal(renderer.host.textureRegistry.getStats().loaded, 200);
  renderer.destroy();
  assert.equal(state.deletedTextures.length, 1);
});

test('destroy before the first batch allocates nothing and restoration failure rolls back staging', async () => {
  const first = setup(1);
  const preparing = first.renderer.prepareSharedResources();
  const rejected = assert.rejects(preparing, /destroyed/);
  first.renderer.destroy(); first.flush(); await rejected;
  assert.equal(first.state.programAllocations, 0);
  const restored = setup(1);
  const ready = restored.renderer.prepareSharedResources(); restored.flush(); await ready;
  restored.canvas.emit('webglcontextlost');
  restored.options.bufferAllocationFailureAt = restored.state.bufferAllocations + 2;
  restored.canvas.emit('webglcontextrestored');
  const failed = assert.rejects(restored.renderer.prepareSharedResources(), /Dynamic index/);
  restored.flush(); await failed;
  assert.equal(restored.renderer.host.lifecycle, 'lost');
  assert.match(restored.renderer.getStats().gpu.restoreError, /restoration failed/);
  assert.equal(restored.state.deletedTextures.length, 1);
  assert.equal(restored.state.deletedPrograms.length, 1);
  assert.equal(restored.state.deletedBuffers.length, 1);
  restored.renderer.destroy();
});

test('scheduler yields through a frame and a task, and cancellation works in both phases', (t) => {
  const originals = Object.fromEntries(['requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout'].map(k => [k, globalThis[k]]));
  t.after(() => Object.assign(globalThis, originals));
  let frame, task, ran = 0;
  globalThis.requestAnimationFrame = fn => { frame = fn; return 1; };
  globalThis.cancelAnimationFrame = () => { frame = null; };
  globalThis.setTimeout = fn => { task = fn; return 2; };
  globalThis.clearTimeout = () => { task = null; };
  const cancel = schedulePreparationBatch(() => ran++);
  assert.equal(ran, 0); frame(); assert.equal(ran, 0); task(); assert.equal(ran, 1); cancel();
  const cancelFrame = schedulePreparationBatch(() => ran++); cancelFrame(); assert.equal(frame, null);
  const cancelTask = schedulePreparationBatch(() => ran++); frame(); cancelTask(); assert.equal(task, null);
  assert.equal(ran, 1);
});
