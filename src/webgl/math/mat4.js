/**
 * Module: Minimal 4x4 matrix math helpers used by the renderer camera/projection pipeline.
 */
export function createIdentityMat4() {
  return new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1
  ]);
}

/** Builds a perspective projection matrix. */
export function createPerspectiveMat4({ fovY, aspect, near, far }) {
  const f = 1 / Math.tan(fovY / 2);
  const nf = 1 / (near - far);

  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, (2 * far * near) * nf, 0
  ]);
}

/** Builds a view matrix from camera eye/target/up vectors. */
export function createLookAtMat4({ eye, center, up }) {
  const zx = eye[0] - center[0];
  const zy = eye[1] - center[1];
  const zz = eye[2] - center[2];
  const zLen = Math.hypot(zx, zy, zz) || 1;

  const znx = zx / zLen;
  const zny = zy / zLen;
  const znz = zz / zLen;

  const xx = (up[1] * znz) - (up[2] * zny);
  const xy = (up[2] * znx) - (up[0] * znz);
  const xz = (up[0] * zny) - (up[1] * znx);
  const xLen = Math.hypot(xx, xy, xz) || 1;

  const xnx = xx / xLen;
  const xny = xy / xLen;
  const xnz = xz / xLen;

  const ynx = (zny * xnz) - (znz * xny);
  const yny = (znz * xnx) - (znx * xnz);
  const ynz = (znx * xny) - (zny * xnx);

  return new Float32Array([
    xnx, ynx, znx, 0,
    xny, yny, zny, 0,
    xnz, ynz, znz, 0,
    -((xnx * eye[0]) + (xny * eye[1]) + (xnz * eye[2])),
    -((ynx * eye[0]) + (yny * eye[1]) + (ynz * eye[2])),
    -((znx * eye[0]) + (zny * eye[1]) + (znz * eye[2])),
    1
  ]);
}

/** Multiplies two 4x4 matrices (a * b). */
export function multiplyMat4(a, b) {
  const out = new Float32Array(16);

  for (let c = 0; c < 4; c += 1) {
    const b0 = b[c * 4];
    const b1 = b[c * 4 + 1];
    const b2 = b[c * 4 + 2];
    const b3 = b[c * 4 + 3];

    out[c * 4] = (a[0] * b0) + (a[4] * b1) + (a[8] * b2) + (a[12] * b3);
    out[c * 4 + 1] = (a[1] * b0) + (a[5] * b1) + (a[9] * b2) + (a[13] * b3);
    out[c * 4 + 2] = (a[2] * b0) + (a[6] * b1) + (a[10] * b2) + (a[14] * b3);
    out[c * 4 + 3] = (a[3] * b0) + (a[7] * b1) + (a[11] * b2) + (a[15] * b3);
  }

  return out;
}
