// Pure math for the try-on tracker (no DOM / Three.js), so it can be unit-tested in Node.

// Face-mesh landmarks on the RIGID part of the head (forehead, nose ridge, eye corners, temples,
// cheekbones). Mouth, jaw, brows and lower cheeks are excluded: they move when talking/smiling.
// Squint-sensitive points (inner eye corners 133/362, lower lids 130/359, cheeks 116/345) are left out too.
export const RIGID = [10, 151, 9, 8, 168, 6, 197, 195, 5, 4, 33, 263,
  127, 356, 234, 454, 93, 323, 21, 251, 54, 284, 103, 332, 67, 297, 109, 338, 98, 327, 129, 358];
export const IDX = { anchor: RIGID.indexOf(168), eyeR: RIGID.indexOf(33), eyeL: RIGID.indexOf(263), top: RIGID.indexOf(10) };

// ---------- small vector helpers (arrays [x,y,z]) ----------
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scl = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = a => Math.hypot(a[0], a[1], a[2]);
export const norm = a => scl(a, 1 / (len(a) || 1));

// Rotate v by unit quaternion q = [w,x,y,z].
export function qRotate(q, v) {
  const u = [q[1], q[2], q[3]], t = scl(cross(u, v), 2);
  return add(add(v, scl(t, q[0])), cross(u, t));
}
export const qConj = q => [q[0], -q[1], -q[2], -q[3]];

// Orthonormal face basis (columns x,y,z) from eye corners + a vertical pair.
// x: right eye corner -> left eye corner, y: chin -> forehead, z: out of the face (toward camera).
export function faceBasis(pR, pL, top, bottom) {
  const x = norm(sub(pL, pR));
  const yRaw = sub(top, bottom);
  const z = norm(cross(x, yRaw));
  const y = norm(cross(z, x));
  return [x, y, z];
}
// Express p in basis B (B^T p).
export const toBasis = (B, p) => [dot(B[0], p), dot(B[1], p), dot(B[2], p)];

// Largest-eigenvalue eigenvector of a symmetric 4x4 matrix (cyclic Jacobi).
export function eigMax4(A) {
  const a = A.map(r => r.slice());
  const V = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];
  for (let sweep = 0; sweep < 16; sweep++) {
    let off = 0;
    for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) off += a[i][j] * a[i][j];
    if (off < 1e-20) break;
    for (let p = 0; p < 3; p++) for (let q = p + 1; q < 4; q++) {
      if (Math.abs(a[p][q]) < 1e-300) continue;
      const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
      const t = (theta >= 0 ? 1 : -1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < 4; k++) { const kp = a[k][p], kq = a[k][q]; a[k][p] = c * kp - s * kq; a[k][q] = s * kp + c * kq; }
      for (let k = 0; k < 4; k++) { const pk = a[p][k], qk = a[q][k]; a[p][k] = c * pk - s * qk; a[q][k] = s * pk + c * qk; }
      for (let k = 0; k < 4; k++) { const kp = V[k][p], kq = V[k][q]; V[k][p] = c * kp - s * kq; V[k][q] = s * kp + c * kq; }
    }
  }
  let m = 0;
  for (let i = 1; i < 4; i++) if (a[i][i] > a[m][m]) m = i;
  return [V[0][m], V[1][m], V[2][m], V[3][m]];
}

// Robust similarity fit b ≈ s·R·(a − ca) + cb  (Horn's quaternion method + IRLS reweighting).
// a = reference points, b = observed points. Returns q=[w,x,y,z] (rotation a->b), s, ca, cb, rms.
export function rigidFit(a, b, iters = 2) {
  const n = a.length, w = new Float64Array(n).fill(1);
  let out = null;
  for (let it = 0; it <= iters; it++) {
    let W = 0; const ca = [0, 0, 0], cb = [0, 0, 0];
    for (let i = 0; i < n; i++) { W += w[i]; for (let k = 0; k < 3; k++) { ca[k] += w[i] * a[i][k]; cb[k] += w[i] * b[i][k]; } }
    for (let k = 0; k < 3; k++) { ca[k] /= W; cb[k] /= W; }
    let Sxx = 0, Sxy = 0, Sxz = 0, Syx = 0, Syy = 0, Syz = 0, Szx = 0, Szy = 0, Szz = 0, aa = 0;
    const A = new Array(n), B = new Array(n);
    for (let i = 0; i < n; i++) {
      const x = sub(a[i], ca), y = sub(b[i], cb); A[i] = x; B[i] = y; const wi = w[i];
      Sxx += wi * x[0] * y[0]; Sxy += wi * x[0] * y[1]; Sxz += wi * x[0] * y[2];
      Syx += wi * x[1] * y[0]; Syy += wi * x[1] * y[1]; Syz += wi * x[1] * y[2];
      Szx += wi * x[2] * y[0]; Szy += wi * x[2] * y[1]; Szz += wi * x[2] * y[2];
      aa += wi * dot(x, x);
    }
    const N = [
      [Sxx + Syy + Szz, Syz - Szy, Szx - Sxz, Sxy - Syx],
      [Syz - Szy, Sxx - Syy - Szz, Sxy + Syx, Szx + Sxz],
      [Szx - Sxz, Sxy + Syx, -Sxx + Syy - Szz, Syz + Szy],
      [Sxy - Syx, Szx + Sxz, Syz + Szy, -Sxx - Syy + Szz],
    ];
    let q = eigMax4(N);
    const qn = Math.hypot(q[0], q[1], q[2], q[3]); q = q.map(v => v / qn);
    if (q[0] < 0) q = q.map(v => -v);
    let sb = 0; const RA = new Array(n);
    for (let i = 0; i < n; i++) { RA[i] = qRotate(q, A[i]); sb += w[i] * dot(B[i], RA[i]); }
    const s = sb / aa;
    const r = new Float64Array(n); let ss = 0;
    for (let i = 0; i < n; i++) { r[i] = len(sub(B[i], scl(RA[i], s))); ss += r[i] * r[i]; }
    out = { q, s, ca, cb, rms: Math.sqrt(ss / n) };
    if (it < iters) {
      const sorted = Array.from(r).sort((u, v) => u - v);
      const sigma = Math.max(1e-9, 1.5 * sorted[n >> 1]);
      for (let i = 0; i < n; i++) w[i] = 1 / (1 + (r[i] / sigma) ** 2);
    }
  }
  return out;
}

// ---------- Filters ----------
// Constant-velocity Kalman filter for one scalar channel. It smooths AND estimates velocity,
// so it has no steady lag on smooth motion and can predict ahead (x + v·t).
export class Kalman1D {
  constructor() { this.reset(); }
  reset() { this.x = null; this.v = 0; this.p00 = 0; this.p01 = 0; this.p11 = 0; }
  step(z, dt, sigMeas, sigAcc) {
    const R = sigMeas * sigMeas, q = sigAcc * sigAcc;
    if (this.x === null) { this.x = z; this.v = 0; this.p00 = R; this.p01 = 0; this.p11 = R / (dt * dt); return this; }
    this.x += this.v * dt;
    const dt2 = dt * dt, dt3 = dt2 * dt, dt4 = dt3 * dt;
    const p00 = this.p00 + 2 * dt * this.p01 + dt2 * this.p11 + q * dt4 / 4;
    const p01 = this.p01 + dt * this.p11 + q * dt3 / 2;
    const p11 = this.p11 + q * dt2;
    const S = p00 + R, k0 = p00 / S, k1 = p01 / S, y = z - this.x;
    this.x += k0 * y; this.v += k1 * y;
    this.p00 = (1 - k0) * p00; this.p01 = (1 - k0) * p01; this.p11 = p11 - k1 * p01;
    return this;
  }
  // Adaptive version: heavy smoothing when the signal is still (sigAccStill), snappy when it moves
  // (sigAccMove). Movement is detected from the innovation (how far the new measurement is from the
  // prediction, in noise units), so the switch happens on the SAME frame motion starts. `boost` lets the
  // caller share one motion level across channels (e.g. rotation + position); pass null to use own.
  // Innovation (std-devs) a measurement would produce, without updating. Used to share one motion level.
  nis(z, dt, sigMeas, sigAccStill) {
    if (this.x === null) return 0;
    const xp = this.x + this.v * dt;
    const pPred = this.p00 + 2 * dt * this.p01 + dt * dt * this.p11 + sigAccStill * sigAccStill * dt ** 4 / 4;
    return Math.abs(z - xp) / Math.sqrt(pPred + sigMeas * sigMeas);
  }
  stepAdaptive(z, dt, sigMeas, sigAccStill, sigAccMove, boost = null) {
    if (this.x === null) return this.step(z, dt, sigMeas, sigAccStill);
    const R = sigMeas * sigMeas;
    const xp = this.x + this.v * dt;
    const pPred = this.p00 + 2 * dt * this.p01 + dt * dt * this.p11 + sigAccStill * sigAccStill * dt ** 4 / 4;
    const nis = Math.abs(z - xp) / Math.sqrt(pPred + R); // innovation in std-devs
    const w = boost !== null ? boost : smoothstep(nis, 1.5, 4);
    this.motion = w; this.lastNis = nis; // NOTE: not "this.nis" (would overwrite the nis() method)
    const sigA = sigAccStill + (sigAccMove - sigAccStill) * w;
    return this.step(z, dt, sigMeas, sigA);
  }
}
export const smoothstep = (x, lo, hi) => { const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo))); return t * t * (3 - 2 * t); };

// One Euro filter (Casiez et al., CHI 2012). params: {minCutoff, beta, dCutoff} (may be getters).
export class OneEuro {
  constructor(p) { this.p = p; this.reset(); }
  reset() { this.x = null; this.dx = 0; this.xPrev = null; this.v = 0; }
  static alpha(cut, dt) { const tau = 1 / (2 * Math.PI * cut); return 1 / (1 + tau / dt); }
  filter(z, dt) {
    if (this.x === null) { this.x = z; this.xPrev = z; return z; }
    const d = (z - this.xPrev) / dt; this.xPrev = z;
    this.dx += OneEuro.alpha(this.p.dCutoff, dt) * (d - this.dx); this.v = this.dx;
    const cut = this.p.minCutoff + this.p.beta * Math.abs(this.dx);
    this.x += OneEuro.alpha(cut, dt) * (z - this.x);
    return this.x;
  }
}
