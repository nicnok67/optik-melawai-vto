# Low-Latency Web Virtual Try-On for Glasses — Research

**Audience:** dev team · **Platform:** web browser (mobile + desktop) · **Status:** AI draft, not validated
**Prototype:** `index.html` in this folder (MediaPipe Face Landmarker + Three.js)

---

## 1. TL;DR

1. **"Glasses lag behind my head" is mostly a sync problem, not a speed problem.** Most web demos show the live `<video>` element and draw glasses on a canvas on top. The video is always newer than the pose (the pose took 10–40 ms of inference), so the glasses visibly trail the face. **Fix: draw the camera frame *and* the glasses in the same WebGL frame, using the exact frame you ran detection on.** Relative lag between face and glasses becomes **zero by construction**. The whole image is delayed by about one inference time, and people don't notice that in a mirror.
2. **Then cut absolute latency:** GPU delegate, `VIDEO` running mode, a 640×480 camera, `numFaces: 1`, blendshapes and matrices turned off, and a `requestVideoFrameCallback` loop.
3. **Then remove jitter without adding lag:** use a **One Euro filter** (adaptive low-pass: smooth when still, near-zero lag when moving fast), not a fixed EMA or moving average.
4. **Fit and realism:** use an orthographic camera in video-pixel units so 2D landmarks line up exactly, plus a **depth-only head occluder** so the temples go behind the head.
5. **Build or buy:** building on MediaPipe is free and controllable but means about 15 MB cold-start and fit/occlusion work. Eyewear SDKs (Fittingbox, Perfect Corp, Banuba) add PD measurement, catalog 3D pipelines and polish, at license cost. **Recommendation: build an in-house prototype to set latency targets, then run a 2-week bake-off against 1–2 vendors on the same devices.**

---

## 2. Where the delay comes from (latency budget)

| Stage | Typical | Control |
|---|---|---|
| Camera capture + ISP | 30–60 ms | Mostly fixed. Request `frameRate: 60`. |
| Frame delivered to JS | 0–16 ms | Use `requestVideoFrameCallback` (fires per new frame) instead of `requestAnimationFrame` polling. |
| Face landmark inference | ~5–40 ms (device-dependent) | GPU delegate, small input, 1 face, no blendshapes. |
| Filtering | 0 ms (One Euro), or 50–150 ms with a heavy EMA | Adaptive filter. |
| Render + composite | 1 frame | Single WebGL pass. |

Two different lags matter:

- **Relative lag** (glasses vs. face in the displayed image) is what users perceive as "not sticking". It **must be ~0**.
- **Absolute lag** (motion vs. what's on screen) is tolerated up to about 100 ms in a mirror-like UI. Lower is better, but it's secondary.

## 3. Techniques, ranked by impact

### 3.1 Frame-locked rendering (biggest win)
- Upload the video frame as a WebGL texture in the **same callback** where you run `detectForVideo(video, ts)`, then render background + glasses together. Don't show the `<video>` element.
- Implemented in the prototype: `onFrame()` → `vidTex.needsUpdate = true; renderer.render()` in sync mode. A toggle switches to the naive "live video + overlay" mode so you can see the difference.
- If you must show the live video, the only option left is **prediction**: extrapolate pose forward by about the inference time. It works for smooth motion and overshoots on sudden stops. N-euro (Shao et al., MobiCom '23) is a learned predictor that improves on this, but it's far more complex.

### 3.2 Inference speed
- `delegate: 'GPU'`, with CPU fallback.
- `runningMode: 'VIDEO'` with `detectForVideo`. After the first detection, MediaPipe tracks landmarks from the previous frame instead of re-running the face detector, which is much cheaper.
- `outputFaceBlendshapes: false`, `outputFacialTransformationMatrixes: false`, `numFaces: 1`.
- Camera at **640×480**. The model input is small anyway, and bigger frames only cost upload and resize time.
- Skip a frame when `mediaTime` hasn't changed (no duplicate work).
- Optional: run inference in a **Web Worker with OffscreenCanvas** so React or page work never blocks it. Keep the frame-lock by sending the `VideoFrame` back with the pose.

### 3.3 Jitter vs. lag: One Euro filter
- Cutoff = `minCutoff + beta × |speed|`. When the head is still, cutoff is low and jitter is removed. When the head moves fast, cutoff is high and there's almost no lag.
- Tuning (Casiez): set `beta = 0`, lower `minCutoff` until jitter at rest is acceptable, then raise `beta` while shaking your head fast until lag disappears.
- Filter **pose** (position, scale, quaternion with hemisphere continuity), not 478 raw landmarks. It's cheaper and stays rigid.
- Normalize position by face size (eye distance) if you want tuning that's independent of resolution and distance.
- Never use a fixed moving average. It always adds N/2 frames of lag.

### 3.4 Pose and fit
- Anchor at landmark **168** (nose bridge), scale from **33↔263** (outer eye corners), orientation from those plus **10↔152** (forehead↔chin), orthonormalized.
- **Orthographic camera in video-pixel coordinates**: landmarks map 1:1 to screen, so there's no FOV guessing. MediaPipe's facial transformation matrix is the alternative. It gives true metric 3D (cm) but needs a matching perspective camera (its pipeline uses about a 63° vertical FOV), and mismatches cause drift at the edges.
- Real frame sizing: map frame width in mm to face width using the eye-corner distance or a PD estimate (average adult PD is about 63 mm). Vendors sell this as "PD measurement".
- **Occlusion:** a depth-only head mesh (`colorWrite: false`) rendered before the glasses. An ellipsoid works as a start. The upgrade is MediaPipe's canonical face mesh, deformed per frame.

### 3.5 Rendering polish (no latency cost)
- PBR materials + environment map; lenses transparent with `depthWrite: false`.
- Glasses assets: glTF/GLB, under 1–2 MB each, Draco or Meshopt compressed, scaled in mm with origin at the nose bridge.
- Mirror with CSS `scaleX(-1)` on the container (free), not by flipping pixels.

### 3.6 Cold start
- About 15.5 MB for MediaPipe tasks-vision (WASM ~11.8 MB + model ~3.8 MB, per one dev measurement). Mitigations: preload on product-page idle, serve from your own CDN with long cache, Service Worker cache, start the camera and model downloads in parallel (the prototype does this).
- Jeeliz-style engines are much smaller but have no head matrix or blendshapes, and their license is commercial/proprietary.

## 4. Build vs. buy

| | In-house (MediaPipe + Three.js) | Fittingbox | Perfect Corp (YouCam) | Banuba (TINT/SDK) | Jeeliz widget |
|---|---|---|---|---|---|
| Web support | Yes | Web module (core product) | Web Enterprise, Shopify | Web, iOS, Android, Shopify | Web |
| Eyewear-specific features | DIY | Specialist, PD, frame catalog digitization | PD, occlusion, glasses removal | Glasses VTO, occlusion | Basic |
| Latency control | Full | Vendor | Vendor | Vendor | Vendor |
| Cost | Dev time, no license | License | License (real-time = Enterprise tier for some products) | License | Commercial license, repo marked legacy |
| 3D catalog pipeline | DIY (biggest hidden cost) | Included / service | Built from 3 product photos | Service | DIY |

Caveats: most comparison pages are **vendor-written**. No independent latency benchmarks exist, and pricing isn't public. Verify on your own devices.

**Hidden cost of building:** latency is solvable in weeks. The **3D model for every SKU**, accurate sizing and PD, and QA across Android devices are the long tail.

## 5. How to measure (acceptance test)

1. **Relative lag:** record the screen with a 240 fps phone while shaking your head, then count frames between face motion and glasses motion. Target: **0 frames** in frame-locked mode.
2. **Absolute lag:** clap or flash an LED in view and count frames until it appears on screen. Target: **< 100 ms** on mid-range Android.
3. **Jitter:** hold still. Glasses edge movement should be **< 1 px** at 640×480.
4. **Throughput:** detect fps ≥ camera fps (30) on the lowest target device. The prototype shows `detect fps`, `inference ms` and (where the browser supports it) `capture→pose ms`.
5. **Device matrix:** iPhone (Safari, older + newest), mid-range Android (Chrome), desktop Chrome/Safari/Firefox. Safari's `requestVideoFrameCallback` and WebGL video upload have known performance bugs (WebKit 277603), so test it explicitly.

## 6. Prototype notes (`index.html`)

- Run: `python3 -m http.server 8000` in this folder → open `http://localhost:8000`. Camera access needs localhost or HTTPS. For phones, serve over HTTPS (e.g. a tunnel).
- Panel: frame-locked vs. live mode, One Euro on/off with `minCutoff`/`beta` sliders, prediction toggle, fit sliders, occluder visualizer.
- Glasses are procedural placeholders. Swap in a GLB per SKU.
- **Not yet tested on a real camera in this session.** Syntax and all CDN/model URLs are verified. Tuning defaults (`minCutoff 1.0`, `beta 0.3`, fit offsets) need on-device adjustment.

## 7. Recommended next steps

1. Run the prototype on 3–4 target devices and record the section 5 numbers (½ day).
2. Decide the pose approach: landmarks + ortho (current) vs. transformation matrix + perspective (better for real-mm sizing).
3. Add a real GLB frame, canonical face-mesh occluder, and PD-based sizing.
4. Request trials from 1–2 vendors (e.g. Fittingbox, Perfect Corp) and run the same measurement protocol against them before committing.

## 8. Prototype v2 — measured findings and Step 1 + 2 (2026-11-18)

**Measured on the dev Mac (Chrome 147, FaceTime HD camera, dim room):** camera delivered only 23.3 fps (it advertises 30 and slows down in low light). Tracking: GPU 22.5 ms vs CPU 16.6 ms per frame. Capture→pose ≈ 26 ms. **Bottleneck = camera frame rate**, which causes tracker sliding on fast moves (the tracker searches where the face was last frame).

**Implemented:**
- *Step 1a, rigid 3D head fit:* 38 stable landmarks (forehead, nose ridge, eye corners, temples, cheekbones). A per-user reference shape is learned over the first 30 frames, then a robust similarity fit (Horn quaternion + IRLS) runs every frame. Unit test: with 4 "moving mouth" outliers, angle error is 0.075° (robust) vs 0.632° (plain), and the fit costs ~0.03 ms.
- *Step 1b, constant-velocity Kalman filter* on position, log-scale and rotation. Zero steady lag on smooth motion (unit test), built-in velocity for prediction. One Euro and Off are kept for A/B.
- *Step 1c, auto CPU/GPU:* benchmarks both on the device (25 frames each) and keeps the faster one. `?delegate=CPU|GPU` forces one.
- *Step 1d, low-light warning* when the camera stays below 26 fps.
- *Step 2, follow-face crop:* each frame the camera image is cropped around the predicted face position (velocity × frame time) and only the crop goes to the tracker. The face stays centred in the tracker's view, which targets the sliding. Status: **experimental, not yet measured on a live face.**
- Files: `vto-math.js` (pure math), `tests/vto-math.test.mjs` (run `node tests/vto-math.test.mjs`), `index.html`. `?auto` starts the camera automatically.

## Sources

- MediaPipe Face Landmarker docs (Web): https://developers.google.cn/edge/mediapipe/solutions/vision/face_landmarker/web_js
- MediaPipe Face Mesh (tracking vs re-detection, face geometry): https://github.com/google-ai-edge/mediapipe/blob/master/docs/solutions/face_mesh.md
- Three.js forum, production web face tracking (bundle sizes, Jeeliz tradeoff): https://discourse.threejs.org/t/best-production-ready-face-tracking-solution-for-three-js-webar-on-ios-android-browsers/94064
- Web vs Android responsiveness issue: https://github.com/google-ai-edge/mediapipe/issues/6041
- 1€ Filter (Casiez, Roussel, Vogel, CHI 2012): https://cristal.univ-lille.fr/~casiez/1euro
- MindAR filter tuning (minCF/beta tradeoff): https://hiukim.github.io/mind-ar-js-doc/quick-start/tracking-config
- N-euro predictor, Shao et al. MobiCom '23: https://cave.cs.columbia.edu/Statics/publications/pdfs/Shao_Mob23.pdf
- Filtering on the Go, ISMAR '24: https://eprints.lancs.ac.uk/225303/1/ISMAR_24-Filtering_on_the_Go.pdf
- requestVideoFrameCallback spec: https://wicg.github.io/video-rvfc/ · WebKit bugs: https://bugs.webkit.org/show_bug.cgi?id=211945, https://bugs.webkit.org/show_bug.cgi?id=277603
- Vendor pages (marketing, verify claims): https://www.banuba.com/blog/banuba-glasses-virtual-try-on-vs-fittingbox · https://www.perfectcorp.com/business/blog/general/best-virtual-glasses-try-on-software · https://auglio.com/en/best-virtual-try-on-eyewear-2026
- Jeeliz widget (commercial license, legacy): https://github.com/jeeliz/jeelizGlassesVTOWidget
