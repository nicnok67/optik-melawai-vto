# Optik Melawai VTO

Web prototype for a low-latency virtual try-on (VTO) of glasses. It runs in the browser with no install: MediaPipe Face Landmarker handles tracking and Three.js handles rendering.

> Status: **prototype / AI-assisted draft**, not validated for production.

## Run

```bash
python3 -m http.server 8000   # in this folder
# open http://localhost:8000      (?auto = start camera immediately, ?delegate=CPU|GPU = force tracker backend)
```

The camera needs `localhost` or HTTPS. To test on a phone, serve it over HTTPS.

## How it stays "stuck" to the face

| Technique | Why |
|---|---|
| **Frame-locked rendering** | The camera frame and the glasses are drawn together from the *same* frame, so the glasses have zero lag relative to the face. |
| **Rigid 3D head fit** (`vto-math.js`) | A robust similarity fit on 32 stable landmarks (forehead, nose, outer eye corners, temples), with the user's face shape learned in the first second. Expressions such as squinting or smiling don't move the glasses. |
| **Adaptive Kalman filter** | Heavy smoothing when the head is still, with an eased switch to responsive tracking when it moves. |
| **Follow-face crop** | The tracker sees a crop that glides with the face, which reduces sliding on fast moves. |
| **Auto CPU/GPU** | Both backends are benchmarked on the device and the faster one is kept. |
| **Face-shaped occlusion** (`face-mesh.js`) | An invisible copy of the user's face and head hides the parts of the glasses that should be behind it (far temple arm, nose pads). |
| **Low-light warning** | Webcams drop their frame rate in dim light. On the test Mac this was the main bottleneck (23 fps). |

Background, measurements and the build-vs-buy comparison are in [RESEARCH.md](RESEARCH.md).

## Tests

```bash
node tests/vto-math.test.mjs
```

## Files

- `index.html`: app (UI, tracking loop, rendering)
- `vto-math.js`: pure math (rigid fit, Kalman / One Euro filters), unit-tested
- `face-mesh.js`: face triangulation for occlusion (MediaPipe canonical face model)
- `tests/`: unit tests
- `RESEARCH.md`: research report

## Third-party notices

See [NOTICE.md](NOTICE.md). The demo sunglasses model carries Khronos and 3D Commerce logos and is **for demo use only**. Production needs Optik Melawai's own frame models.
