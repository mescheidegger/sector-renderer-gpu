import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resolveSurfaceConstrainedBillboardCenter,
  resolveSurfaceConstrainedBillboardPlacement,
  WebGLRendererHost,
  SURFACE_SEPARATION_EPSILON
} from '../src/webgl/WebGLRendererHost.js';

const close = (actual, expected, epsilon = 1e-10) => assert.ok(Math.abs(actual - expected) < epsilon, `${actual} != ${expected}`);
const displacement = (sprite, right, halfWidth) => {
  const center = resolveSurfaceConstrainedBillboardCenter(sprite, right, halfWidth);
  return { x: center[0] - sprite.x, y: center[1] - sprite.y };
};
const screenAnchoredPlacement = (sprite, camera, halfWidth = 0.6) => {
  const dx = sprite.x - camera.x;
  const dy = sprite.y - camera.y;
  const length = Math.hypot(dx, dy);
  const cameraRight = [dy / length, -dx / length, 0];
  return resolveSurfaceConstrainedBillboardPlacement(sprite, cameraRight, halfWidth, camera);
};
const screenAnchoredCenter = (sprite, camera, halfWidth = 0.6) => (
  screenAnchoredPlacement(sprite, camera, halfWidth).center
);
const assertCameraCollinear = (anchor, center, camera) => {
  const anchorX = anchor.x - camera.x;
  const anchorY = anchor.y - camera.y;
  const centerX = center[0] - camera.x;
  const centerY = center[1] - camera.y;
  const anchorZ = anchor.z - camera.z;
  const centerZ = center[2] - camera.z;
  close((anchorX * centerY) - (anchorY * centerX), 0, 1e-8);
  close((anchorX * centerZ) - (anchorZ * centerX), 0, 1e-8);
  close((anchorY * centerZ) - (anchorZ * centerY), 0, 1e-8);
};
const assertClearsEverySurface = (sprite, center, camera, halfWidth = 0.6, scale = 1) => {
  const dx = sprite.x - camera.x;
  const dy = sprite.y - camera.y;
  const length = Math.hypot(dx, dy);
  const cameraRight = [dy / length, -dx / length];
  for (const constraint of sprite.surfaceConstraints) {
    const { normal, point } = constraint;
    const normalLength = Math.hypot(normal.x, normal.y);
    const nx = normal.x / normalLength;
    const ny = normal.y / normalLength;
    const distance = ((center[0] - point.x) * nx) + ((center[1] - point.y) * ny);
    const required = Math.abs((cameraRight[0] * nx) + (cameraRight[1] * ny))
      * halfWidth * scale + SURFACE_SEPARATION_EPSILON + (constraint.clearanceOffset ?? 0);
    assert.ok(distance >= required - 1e-10, `${distance} does not clear ${required}`);
  }
};

test('ordinary sprites and sprites with unusable constraints retain their submitted center', () => {
  const sprite = { x: 4, y: 2, z: 1 };
  assert.deepEqual(resolveSurfaceConstrainedBillboardCenter(sprite, [1, 0, 0], 0.6), [4, 2, 1]);
  for (const surfaceConstraints of [[{ normal: { x: 0, y: 0 }, point: { x: 0, y: 0 } }], [{ normal: { x: NaN, y: 1 }, point: { x: 0, y: 0 } }], [null]]) {
    assert.deepEqual(resolveSurfaceConstrainedBillboardCenter({ ...sprite, surfaceConstraints }, [1, 0, 0], 0.6), [4, 2, 1]);
  }
});

test('one surface is normalized and stays epsilon-close straight-on', () => {
  const unit = { x: 4.02, y: 2, z: 1, surfaceConstraints: [{ normal: { x: 1, y: 0 }, point: { x: 4.02, y: 2 } }] };
  const scaled = { ...unit, surfaceConstraints: [{ normal: { x: 20, y: 0 }, point: { x: 4.02, y: 2 } }] };
  const expected = [4.02 + SURFACE_SEPARATION_EPSILON, 2, 1];
  assert.deepEqual(resolveSurfaceConstrainedBillboardCenter(unit, [0, 1, 0], 0.6), expected);
  assert.deepEqual(resolveSurfaceConstrainedBillboardCenter(scaled, [0, 1, 0], 0.6), expected);
});

test('a surface clearance offset adds spacing beyond the projected half-width', () => {
  const sprite = {
    x: 0, y: 0, z: 1,
    surfaceConstraints: [{
      normal: { x: 1, y: 0 }, point: { x: 0, y: 0 }, clearanceOffset: 0.15
    }]
  };
  const offset = displacement(sprite, [0, 1, 0], 0.6);
  close(offset.x, 0.15 + SURFACE_SEPARATION_EPSILON);
  close(offset.y, 0);
});

test('one oblique surface clears the projected billboard half-width', () => {
  const sprite = { x: 0, y: 0, z: 1, surfaceConstraints: [{ normal: { x: 1, y: 0 }, point: { x: 0, y: 0 } }] };
  const offset = displacement(sprite, [1, 0, 0], 0.6);
  close(offset.x, 0.6 + SURFACE_SEPARATION_EPSILON);
  close(offset.y, 0);
});

test('perpendicular constraints clear both planes with the minimum displacement', () => {
  const sprite = { x: 0, y: 0, z: 1, surfaceConstraints: [{ normal: { x: 1, y: 0 }, point: { x: 0, y: 0 } }, { normal: { x: 0, y: 1 }, point: { x: 0, y: 0 } }] };
  const offset = displacement(sprite, [Math.SQRT1_2, Math.SQRT1_2, 0], 1);
  const clearance = Math.SQRT1_2 + SURFACE_SEPARATION_EPSILON;
  close(offset.x, clearance);
  close(offset.y, clearance);
  close(Math.hypot(offset.x, offset.y), Math.SQRT2 * clearance);
});

test('screen-anchor clearance stays camera-collinear across wall sides, angles, and distances', () => {
  const wall = { normal: { x: 1, y: 0 }, point: { x: 0, y: 0 } };
  const sprite = {
    x: 0.02, y: 0, z: 1.15,
    surfaceAttachment: { mode: 'preserve-screen-anchor' },
    surfaceConstraints: [wall]
  };

  for (const camera of [
    { x: 4, y: 0, z: 1 },
    { x: 4, y: 3, z: 2 },
    { x: 4, y: -3, z: 0.5 },
    { x: 40, y: 30, z: 1.7 },
    { x: 8, y: 16, z: 2.2 }
  ]) {
    const center = screenAnchoredCenter(sprite, camera);
    assertCameraCollinear(sprite, center, camera);
    assert.ok(center[0] >= sprite.x, 'clearance moves toward the camera-facing side');
  }
});

test('screen-anchor clearance satisfies perpendicular corner planes along the camera ray', () => {
  const sprite = {
    x: 0.02, y: 0.02, z: 1,
    surfaceAttachment: { mode: 'preserve-screen-anchor' },
    surfaceConstraints: [
      { normal: { x: 1, y: 0 }, point: { x: 0, y: 0 } },
      { normal: { x: 0, y: 1 }, point: { x: 0, y: 0 } }
    ]
  };
  const camera = { x: 5, y: 5, z: 1 };
  const { center, scale } = screenAnchoredPlacement(sprite, camera);

  assertCameraCollinear(sprite, center, camera);
  assert.ok(center[0] > sprite.x);
  assert.ok(center[1] > sprite.y);
  assertClearsEverySurface(sprite, center, camera, 0.6, scale);
});

test('screen-anchor interval respects an upper bound from an initially clear surface', () => {
  const sprite = {
    x: 0, y: 0, z: 1,
    surfaceAttachment: { mode: 'preserve-screen-anchor' },
    surfaceConstraints: [
      { normal: { x: 1, y: 0 }, point: { x: 0, y: 0 } },
      { normal: { x: 0, y: -1 }, point: { x: 0, y: 2 } }
    ]
  };
  const camera = { x: 5, y: 5, z: 1 };
  const { center, scale } = screenAnchoredPlacement(sprite, camera);

  assert.notDeepEqual(center, [sprite.x, sprite.y, sprite.z]);
  assertCameraCollinear(sprite, center, camera);
  assertClearsEverySurface(sprite, center, camera, 0.6, scale);
});

test('screen-anchor interval rejects movement that would violate an initially clear surface', () => {
  const sprite = {
    x: 0, y: 0, z: 1,
    surfaceAttachment: { mode: 'preserve-screen-anchor' },
    surfaceConstraints: [
      { normal: { x: 1, y: 0 }, point: { x: 0, y: 0 } },
      { normal: { x: 0, y: -1 }, point: { x: 0, y: 0.7 } }
    ]
  };
  const camera = { x: 5, y: 5, z: 1 };

  assert.deepEqual(screenAnchoredCenter(sprite, camera), [sprite.x, sprite.y, sprite.z]);
});

test('screen-anchor mode does not move when every corner plane is already clear', () => {
  const sprite = {
    x: 1, y: 1, z: 1,
    surfaceAttachment: { mode: 'preserve-screen-anchor' },
    surfaceConstraints: [
      { normal: { x: 1, y: 0 }, point: { x: 0, y: 0 } },
      { normal: { x: 0, y: 1 }, point: { x: 0, y: 0 } }
    ]
  };

  assert.deepEqual(screenAnchoredCenter(sprite, { x: 5, y: 5, z: 2 }), [1, 1, 1]);
});

test('screen-anchor corner behavior is deterministic from opposite camera sides', () => {
  const sprite = {
    x: 0.02, y: 0.02, z: 1,
    surfaceAttachment: { mode: 'preserve-screen-anchor' },
    surfaceConstraints: [
      { normal: { x: 1, y: 0 }, point: { x: 0, y: 0 } },
      { normal: { x: 0, y: 1 }, point: { x: 0, y: 0 } }
    ]
  };

  const clearable = screenAnchoredPlacement(sprite, { x: 5, y: 5, z: 1 });
  assertClearsEverySurface(sprite, clearable.center, { x: 5, y: 5, z: 1 }, 0.6, clearable.scale);
  for (const camera of [{ x: -5, y: 5, z: 1 }, { x: 5, y: -5, z: 1 }, { x: -5, y: -5, z: 1 }]) {
    assert.deepEqual(screenAnchoredCenter(sprite, camera), [sprite.x, sprite.y, sprite.z]);
  }
});

test('near-grazing screen-anchor clearance scales the billboard to remain fully visible', () => {
  const sprite = {
    x: 0, y: 0, z: 1,
    surfaceAttachment: { mode: 'preserve-screen-anchor' },
    surfaceConstraints: [{ normal: { x: 1, y: 0 }, point: { x: 0, y: 0 } }]
  };
  const camera = { x: 0.35, y: -20, z: 1 };
  const placement = screenAnchoredPlacement(sprite, camera);

  assert.ok(placement.scale > 0 && placement.scale < 1);
  assertCameraCollinear(sprite, placement.center, camera);
  assertClearsEverySurface(sprite, placement.center, camera, 0.6, placement.scale);
  assert.notEqual(placement.center[1], sprite.y, 'movement stays on the camera ray, not the wall normal');
});

test('screen-anchor placement uniformly scales every billboard corner around the camera', () => {
  const wall = [{ normal: { x: 1, y: 0 }, point: { x: 0, y: 0 } }];
  const corner = [
    { normal: { x: 1, y: 0 }, point: { x: 0, y: 0 } },
    { normal: { x: 0, y: 1 }, point: { x: 0, y: 0 } }
  ];
  const scenarios = [
    { camera: { x: 5, y: 0, z: 1 }, sprite: { x: 0, y: 0, z: 1 }, constraints: wall },
    { camera: { x: 5, y: -4, z: 2 }, sprite: { x: 0, y: 0, z: 1 }, constraints: wall },
    { camera: { x: 0.35, y: -20, z: 1 }, sprite: { x: 0, y: 0, z: 1 }, constraints: wall },
    { camera: { x: 50, y: -30, z: 3 }, sprite: { x: 0, y: 0, z: 0.5 }, constraints: wall },
    { camera: { x: 5, y: 5, z: 2 }, sprite: { x: 0, y: 0, z: 1 }, constraints: corner },
    {
      camera: { x: 0.5, y: -12, z: 3 }, sprite: { x: 0, y: 0, z: 0, anchor: 'floor' },
      constraints: [{ ...wall[0], clearanceOffset: 0.12 }]
    }
  ];

  for (const { camera, sprite: submitted, constraints } of scenarios) {
    const sprite = {
      ...submitted,
      width: 1.2,
      height: 0.8,
      surfaceAttachment: { mode: 'preserve-screen-anchor' },
      surfaceConstraints: constraints
    };
    const dx = sprite.x - camera.x;
    const dy = sprite.y - camera.y;
    const length = Math.hypot(dx, dy);
    const cameraRight = [dy / length, -dx / length, 0];
    const placement = resolveSurfaceConstrainedBillboardPlacement(sprite, cameraRight, 0.6, camera);
    const original = WebGLRendererHost.prototype.buildWorldBillboardQuad.call(
      {}, { ...sprite, surfaceAttachment: null, surfaceConstraints: null }, cameraRight, [0, 0, 1], camera
    );
    const resolved = WebGLRendererHost.prototype.buildWorldBillboardQuad.call(
      {}, sprite, cameraRight, [0, 0, 1], camera
    );

    for (let index = 0; index < original.corners.length; index += 1) {
      for (let axis = 0; axis < 3; axis += 1) {
        const cameraCoordinate = [camera.x, camera.y, camera.z][axis];
        close(
          resolved.corners[index][axis],
          cameraCoordinate + (placement.scale * (original.corners[index][axis] - cameraCoordinate)),
          1e-8
        );
      }
    }
  }
});

test('non-perpendicular constraints use the minimal valid intersection', () => {
  const angle = Math.PI / 3;
  const second = { x: -Math.cos(angle), y: Math.sin(angle) };
  const sprite = { x: 0, y: 0, z: 1, surfaceConstraints: [{ normal: { x: 1, y: 0 }, point: { x: 0, y: 0 } }, { normal: second, point: { x: 0, y: 0 } }] };
  const right = [0, 1, 0];
  const offset = displacement(sprite, right, 1);
  const firstClearance = SURFACE_SEPARATION_EPSILON;
  const secondClearance = Math.sin(angle) + SURFACE_SEPARATION_EPSILON;
  const expectedY = (secondClearance + (Math.cos(angle) * firstClearance)) / Math.sin(angle);
  close(offset.x, firstClearance);
  close(offset.y, expectedY);
  assert.ok((offset.x * second.x) + (offset.y * second.y) >= secondClearance - 1e-10);
  close(Math.hypot(offset.x, offset.y), Math.hypot(firstClearance, expectedY));
});

test('an offset plane adds only missing clearance and none when already clear', () => {
  const constraint = { normal: { x: 1, y: 0 }, point: { x: 0, y: 0 } };
  const partiallyClear = { x: 0.4, y: 0, z: 1, surfaceConstraints: [constraint] };
  const partial = displacement(partiallyClear, [1, 0, 0], 0.6);
  close(partial.x, 0.2 + SURFACE_SEPARATION_EPSILON);
  close(partial.y, 0);

  const alreadyClear = { ...partiallyClear, x: 0.7 };
  assert.deepEqual(resolveSurfaceConstrainedBillboardCenter(alreadyClear, [1, 0, 0], 0.6), [0.7, 0, 1]);
});

test('a 1.2-wide billboard clears either nearby corner plane but ignores distant endpoints', () => {
  const wall = { normal: { x: 0, y: 1 }, point: { x: 0, y: 0 } };
  const left = { normal: { x: 1, y: 0 }, point: { x: 0, y: 0 } };
  const right = { normal: { x: -1, y: 0 }, point: { x: 4, y: 0 } };
  const makeSprite = (x) => ({ x, y: 0.02, z: 1, surfaceConstraints: [wall, left, right] });

  const nearLeft = displacement(makeSprite(0.2), [1, 0, 0], 0.6);
  close(nearLeft.x, 0.4 + SURFACE_SEPARATION_EPSILON);
  const nearRight = displacement(makeSprite(3.8), [1, 0, 0], 0.6);
  close(nearRight.x, -(0.4 + SURFACE_SEPARATION_EPSILON));
  const far = displacement(makeSprite(2), [1, 0, 0], 0.6);
  close(far.x, 0);
});
