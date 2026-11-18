// Run: node tests/vto-math.test.mjs
import assert from 'node:assert/strict';
import { rigidFit, qRotate, Kalman1D, faceBasis, toBasis, eigMax4 } from '../vto-math.js';

let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5;
const qFromAxisAngle = (ax, ang) => { const n = Math.hypot(...ax), s = Math.sin(ang / 2); return [Math.cos(ang / 2), ax[0] / n * s, ax[1] / n * s, ax[2] / n * s]; };
const qAngle = (q1, q2) => 2 * Math.acos(Math.min(1, Math.abs(q1[0]*q2[0]+q1[1]*q2[1]+q1[2]*q2[2]+q1[3]*q2[3])));

// 1. eigMax4 on a diagonal matrix
{ const v = eigMax4([[1,0,0,0],[0,5,0,0],[0,0,2,0],[0,0,0,-3]]); assert.ok(Math.abs(Math.abs(v[1]) - 1) < 1e-9, 'eigMax4 diag'); }

// 2. Exact similarity recovery
const ref = Array.from({ length: 38 }, () => [rnd() * 2, rnd() * 2, rnd()]);
for (const [ax, ang] of [[[0,1,0], 0.6], [[1,0.3,0], -0.4], [[0.2,0.1,1], 1.2], [[1,1,1], 2.5]]) {
  const q = qFromAxisAngle(ax, ang), s = 87.5, t = [320, -240, 15];
  const obs = ref.map(p => qRotate(q, p).map((v, k) => v * s + t[k]));
  const f = rigidFit(ref, obs);
  assert.ok(qAngle(f.q, q) < 1e-6, `rotation recovered (${ang})`);
  assert.ok(Math.abs(f.s - s) < 1e-6, 'scale recovered');
  assert.ok(f.rms < 1e-6, 'rms ~0');
}
console.log('ok  exact similarity recovery');

// 3. Noise + outliers (mouth-like movers): robust fit stays close
{
  const q = qFromAxisAngle([0.3,1,0.1], 0.5), s = 100, t = [300, -200, 0];
  const obs = ref.map(p => qRotate(q, p).map((v, k) => v * s + t[k] + rnd() * 1.0));
  for (const i of [3, 9, 20, 30]) obs[i][1] += 25; // 4 points pulled 25 px
  const robust = rigidFit(ref, obs, 2), plain = rigidFit(ref, obs, 0);
  const eR = qAngle(robust.q, q) * 180 / Math.PI, eP = qAngle(plain.q, q) * 180 / Math.PI;
  console.log(`ok  outliers: robust err ${eR.toFixed(3)}°, non-robust err ${eP.toFixed(3)}°`);
  assert.ok(eR < eP, 'IRLS reduces outlier influence');
  assert.ok(eR < 0.5, 'robust error under 0.5°');
}

// 4. Kalman: tracks a ramp with no steady lag, and predicts ahead
{
  const k = new Kalman1D(), dt = 1 / 30;
  let last;
  for (let i = 0; i < 90; i++) { const z = 300 * i * dt; last = k.step(z, dt, 1, 2000); }
  const truth = 300 * 89 * dt;
  assert.ok(Math.abs(last.x - truth) < 0.5, `ramp lag ${Math.abs(last.x - truth)}`);
  assert.ok(Math.abs(last.v - 300) < 2, `velocity ${last.v}`);
  console.log(`ok  kalman ramp: lag ${(truth - last.x).toFixed(3)} px, v ${last.v.toFixed(1)} px/s`);
}

// 5. Kalman reduces jitter on a static noisy signal
{
  const k = new Kalman1D(), dt = 1 / 30; let se = 0, sr = 0;
  for (let i = 0; i < 300; i++) { const z = 100 + rnd() * 4; const x = k.step(z, dt, 1.2, 50).x; if (i > 30) { se += (x - 100) ** 2; sr += (z - 100) ** 2; } }
  console.log(`ok  kalman jitter: raw rms ${Math.sqrt(sr/269).toFixed(3)} -> filtered ${Math.sqrt(se/269).toFixed(3)}`);
  assert.ok(se < sr * 0.5);
}

// 5b. Adaptive Kalman: steadier than fixed when still, still snappy at motion onset
{
  let sd = 5; const n01 = () => { let u = 0; for (let i = 0; i < 6; i++) { sd = (sd * 16807) % 2147483647; u += sd / 2147483647; } return (u - 3) * 1.41; };
  const S = 100, dt = 1 / 24;
  const jitter = f => { let p = null, j = 0, n = 0; for (let i = 0; i < 300; i++) { const x = f(n01()); if (i > 30 && p !== null) { j += (x - p) ** 2; n++; } p = x; } return Math.sqrt(j / n); };
  const onsetLag = f => { for (let i = 0; i < 60; i++) f(n01()); let x; for (let i = 1; i <= 3; i++) x = f(200 * i * dt + n01()); return Math.abs(200 * 3 * dt - x); };
  const fixed = () => { const k = new Kalman1D(); return z => k.step(z, dt, 0.01 * S, 14 * S).x; };
  const smooth = () => { const k = new Kalman1D(); return z => k.step(z, dt, 0.01 * S, 1 * S).x; };
  const adapt = () => { const k = new Kalman1D(); return z => k.stepAdaptive(z, dt, 0.01 * S, 1 * S, 40 * S).x; };
  const jF = jitter(fixed()), jA = jitter(adapt()), lS = onsetLag(smooth()), lA = onsetLag(adapt());
  console.log(`ok  adaptive kalman: still jitter ${jF.toFixed(2)} -> ${jA.toFixed(2)} px; onset lag smooth-fixed ${lS.toFixed(1)} vs adaptive ${lA.toFixed(1)} px`);
  assert.ok(jA < jF * 0.7, 'adaptive is steadier when still');
  assert.ok(lA < lS * 0.5, 'adaptive is snappier at motion onset than equally-smooth fixed filter');
}

// 5c. Regression: nis() must stay callable after stepAdaptive() (a field once shadowed it -> page froze)
{
  const k = new Kalman1D();
  for (let i = 0; i < 5; i++) { k.nis(i, 1 / 24, 1, 1); k.stepAdaptive(i, 1 / 24, 1, 1, 40, null); }
  assert.equal(typeof k.nis, 'function', 'nis is still a method');
  console.log('ok  nis() callable after stepAdaptive (freeze regression)');
}

// 6. faceBasis is orthonormal and right-handed
{
  const B = faceBasis([-1, 0.1, 0], [1, 0, 0.1], [0, 2, 0.2], [0, -2, 0]);
  const d = (a, b) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) assert.ok(Math.abs(d(B[i], B[j]) - (i === j ? 1 : 0)) < 1e-9);
  const c = [B[0][1]*B[1][2]-B[0][2]*B[1][1], B[0][2]*B[1][0]-B[0][0]*B[1][2], B[0][0]*B[1][1]-B[0][1]*B[1][0]];
  assert.ok(d(c, B[2]) > 0.999, 'right-handed');
  toBasis(B, B[0]).forEach((v, i) => assert.ok(Math.abs(v - [1, 0, 0][i]) < 1e-9));
  console.log('ok  faceBasis orthonormal, right-handed');
}

// 7. Speed: fit must be cheap per frame
{
  const q = qFromAxisAngle([0,1,0], 0.3); const obs = ref.map(p => qRotate(q, p).map(v => v * 90));
  const t0 = performance.now(); for (let i = 0; i < 2000; i++) rigidFit(ref, obs, 2);
  console.log(`ok  rigidFit cost ${((performance.now() - t0) / 2000 * 1000).toFixed(1)} µs/frame`);
}
console.log('ALL PASS');
