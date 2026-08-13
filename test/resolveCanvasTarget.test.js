import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanupCanvasTarget, resolveCanvasTarget } from '../src/webgl/canvas/resolveCanvasTarget.js';

test('provided canvas remains caller-owned and is not removed by cleanup', () => {
  let createCount = 0;
  let removeCount = 0;
  const container = {
    ownerDocument: { createElement: () => { createCount += 1; return {}; } },
    removeChild: () => { removeCount += 1; }
  };
  const canvas = { parentNode: container, style: {}, className: 'consumer-canvas', getContext() {} };

  const target = resolveCanvasTarget({ canvas });
  assert.equal(target.canvas, canvas);
  assert.equal(target.ownsCanvas, false);
  assert.equal(target.ownerContainer, null);
  cleanupCanvasTarget(target);
  assert.equal(createCount, 0);
  assert.equal(removeCount, 0);
  assert.equal(canvas.className, 'consumer-canvas');
});

test('container target creates, appends, and cleans up a renderer-owned canvas', () => {
  let createCount = 0;
  const canvas = { parentNode: null, style: {} };
  const container = {
    ownerDocument: {
      createElement(tagName) {
        createCount += 1;
        assert.equal(tagName, 'canvas');
        return canvas;
      }
    },
    appendChild(child) {
      assert.equal(child, canvas);
      child.parentNode = this;
    },
    removeChild(child) {
      assert.equal(child, canvas);
      child.parentNode = null;
    }
  };

  const target = resolveCanvasTarget({ container });
  assert.equal(createCount, 1);
  assert.equal(target.canvas, canvas);
  assert.equal(target.ownsCanvas, true);
  assert.equal(target.ownerContainer, container);
  assert.equal(canvas.style.display, 'block');
  cleanupCanvasTarget(target);
  assert.equal(canvas.parentNode, null);
});

test('canvas target must be exactly one of canvas or container', () => {
  assert.throws(() => resolveCanvasTarget({}), /exactly one rendering target/);
  assert.throws(() => resolveCanvasTarget({ canvas: {}, container: {} }), /exactly one rendering target/);
});
