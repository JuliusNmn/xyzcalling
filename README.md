# Pose Studio

Related hackathon work lives in [`amsterdam-hackathon/`](amsterdam-hackathon/HANDOFF.md).
The dashboard uses its Mixamo character and ports its custom retargeting solver
to the browser. TouchDesigner, djay OSC and the offline tools remain separate.

A TypeScript dashboard for MediaPipe Pose Landmarker, with a local video library,
live skeleton/landmark overlays, playback and confidence controls, and JSON export
of the current frame. MediaPipe's full model, JavaScript, and WASM are served
locally. Inference runs in the viewer's browser; no external inference service is used.

## Run

Requires Node.js 22.12+.

```sh
npm install
npm run setup
npm run build
npm start
```

The server automatically binds to the first active ZeroTier IPv4 address reported
by `/usr/local/bin/zerotier-cli`. On this machine the URL is
**http://10.244.196.67:3000**. If ZeroTier is unavailable it binds to loopback.
You can explicitly choose an address and port:

```sh
HOST=127.0.0.1 PORT=3000 npm start
```

For development, run `npm run dev` to use Vite middleware with live reload.

## Video library

Use **Open local video** to select a file from your device. Playback and pose
analysis use a browser object URL; neither the file nor its metadata is uploaded
to the backend. It appears as **BROWSER ONLY**, remains selectable alongside the
server library, and disappears when the page reloads. Opening another local file
replaces the previous local entry and releases its object URL. Refreshing the
server library preserves the selected local video.

Put files in `videos/`, then press the library's refresh button. Click any entry
to load it, and press play in the video player. MP4, WebM, MOV, M4V, and OGV files
are listed; codec support varies by browser. Use H.264 video and AAC audio in an
MP4 container for the widest compatibility. The supplied video is a directly
downloaded 1080p H.264/AAC MP4. Set `VIDEO_DIR` to serve a different directory.

Processing frames are downscaled to at most 960 pixels wide, with a maximum of
25 inference calls per second. Actual throughput depends on the browser/device.
GPU inference is preferred, with CPU fallback. The model resets after seeking
or switching videos. Landmarks use normalized image coordinates; world landmarks
are in meters relative to the hip midpoint. Pose array indices are not stable IDs.
The minimum visibility slider only filters the overlay. Export captures the most
recent analyzed frame and includes its video timestamp.

## Character preview and solvers

Choose **Character + video** to load the textured Mixamo character from
`amsterdam-hackathon/Geo/Chicken Dance.fbx`. Its embedded dance is disabled:
only the current video's MediaPipe results drive the preview. Drag to orbit,
scroll to zoom, or use **Reset camera**. Character assets load on demand.

Choose **Compare solvers** to see Custom and Kalidokit side by side, with the
source video below. Both use the same detected person and video frame, with
independent rigs and smoothing history. Orbit and zoom are linked for comparison.
Use **Configure / export solver** to choose whose settings to edit (and whose
motion to use for dance exports); both characters remain visible. Changing this
selector in comparison mode preserves both solvers' motion history. The skeleton
toggle, person selector and camera reset apply to both previews.

The **Inverse kinematics** selector switches between:

- **Custom · rest-aware**: browser port of `mocap/blender_retarget.py`. Fits the
  hips and spine to torso bases, then swings the arms, legs and feet toward
  landmark directions using the FBX's actual rest axes (14 controlled bones).
- **Kalidokit · 1.1.5**: `Pose.solve` with neutral-pose calibration, anatomical
  side mapping and rotation conversion into this Mixamo rig (12 controlled
  bones). Feet inherit leg motion. This is an adapter for the supplied rig,
  not a general-purpose retargeter for arbitrary FBX files.

Both have independent **Rotation smoothing**, **Tracking visibility** and
**Track legs** settings, retained when switching solvers during the session.
Smoothing uses quaternion interpolation compensated for the video frame interval:
0% is immediate; higher values reduce jitter with more lag. The custom default
is 40% retention (equivalent to the pilot's 0.6 interpolation at 30 FPS);
Kalidokit defaults to 65%. Seeking, changing video/person or switching solvers
resets the filter so motion does not blend across unrelated frames.

Low-confidence joints hold their previous local rotations. **Show character
skeleton** exposes the parsed rig, and **Detected person** chooses a MediaPipe
pose array entry (increase **Maximum people** to detect more people).
All solving remains in the browser, including for browser-only local videos.

This is an in-place body preview and exporter: no root translation, foot locking,
hand/finger or face animation. Monocular depth ambiguity,
occlusion and missed detections can still produce incorrect poses or foot sliding.

Run `npm test` for solver checks against the actual FBX: custom direction fitting,
Kalidokit neutral/side mapping, smoothing, bone-length preservation, confidence
handling and reset behavior. These checks verify implementation behavior, not
motion-capture accuracy on real footage.

## Keep it running on macOS

```sh
npm run service:install
npm run service:status
npm run service:stop
```

The user LaunchAgent `local.pose-studio` runs independently of the terminal,
restarts after crashes, and starts at login. Logs are in `logs/`. After rebuilding,
run `npm run service:install` to restart with the new build. The machine must be
awake and connected to ZeroTier for other members of the network to reach it.
The service waits and retries if the ZeroTier interface is unavailable at login.
The server exposes the video library to that network without an additional login.
To remove the service permanently, stop it and remove
`~/Library/LaunchAgents/local.pose-studio.plist`.

## Beats, waveform and dance excerpts

Run `npm run analyze:audio` to generate `<video filename>.analysis.json` beside
each video in `videos/` (or `VIDEO_DIR`). Requires `uv` and FFmpeg. This runs
Beat This! locally and precomputes the waveform, beat times, downbeats, complete
bar boundaries and tempo. Matching sidecars are reused; `--force` regenerates.

The viewer loads these files automatically. Use **Reload analysis** after an
extraction, select a starting bar and **4 / 8 / 16 / 32 / 64 bars** or **Complete
video**, audition the phrase with **Loop selection** (on by default),
then press **Extract & preview animation**. Extraction samples the selected range
at 30 FPS and opens a textured 3D loop preview. Pause, restart, scrub to any pose,
change preview speed, or drag to orbit before choosing **FBX** or **JSON** and
pressing **Download animation**. Downloads reuse the previewed animation without
repeating pose inference. Changing the video, selection or tracking/solver settings
clears the preview and requires a new extraction. Preview speed only affects
playback; downloads retain the original duration and contain one cycle.

### Offline animation controls

The extraction panel has **Off / Light / Balanced / Strong** smoothing,
**Preserve fast accents**, a **Motion timing** adjustment (−250 to +250 ms;
positive moves motion earlier), and optional **Align accents to beats**.
Light smoothing and accent preservation are the defaults; timing and beat
alignment start at zero. These options affect the extracted animation and its
FBX/JSON downloads, not the live character viewer. The motion-signal panel can use the same settings in Smoothed mode, or retain the original data in Raw mode.

Extraction uses independent MediaPipe image inference and disables the solver's
recursive rotation smoothing. The raw animation and landmarks are kept in memory
for the current selection. Adjusting any processing control reuses that extraction;
it does not load the model or scan video frames again. Changing the source, range,
solver, person or detection/visibility/leg settings requires a fresh extraction.
Changing the live rotation-smoothing slider does not invalidate the offline cache.
The shared cache keeps the most recent extraction until a different range/tracking configuration is extracted or the page reloads. Animation and motion-signal extraction reuse it when their range and tracking configuration match.

Smoothing is a centered, hemisphere-correct quaternion average over 5, 7 or 11
samples at 30 Hz. Accent preservation reduces smoothing during fast rotations.
This removes the recursive filter's trailing response, but strong smoothing can
still soften gestures and inference/occlusion errors can remain. Clip edges use
available neighbors; the loop seam is not blended. Timing offsets hold the nearest
pose at the ends rather than wrapping across the seam.

Beat alignment detects peaks in whole-body angular speed and moves nearby peaks
partway toward detected beats (up to 80 ms at full strength). All bones use one
monotonic time map, with bounded speed changes and fixed endpoints before any
manual timing offset. This is an optional creative adjustment, not a measurement
of tracking latency. It can alter the dancer's original groove. No beat data means
alignment is disabled. JSON includes the processing settings and timing anchors;
its source landmarks and rhythm remain at their original timestamps.

The extracted preview displays its own source-video player alongside the character.
**Sync with source video** uses that video's clock for animation playback, including
scrubbing, speed changes and looping. **Unsmoothed comparison** shows the cached raw
animation; downloads always use the processed version. Turn sync off to play the
animation on its own. None of these controls change the main live video preview.

FBX includes the textured, skinned Mixamo
character with the selected solver's animation; JSON includes quaternion animation,
source landmarks, timing, solver settings and tracking-quality counts. Browser-only videos support
manually opening their sidecar JSON without uploading anything.

FBX conversion requires Blender on the server (`/Applications/Blender.app` on
macOS, `blender` on PATH elsewhere, or set `BLENDER_BIN` to its executable).
Only the skeleton and baked rotation tracks are sent to the server; the source
video and detected landmarks stay in the browser. Temporary conversion files
are removed after download or cancellation. FBX selections are limited to ten
minutes. JSON export remains entirely in the browser.
Loop previews also run entirely in the browser and work without Blender. The
loop seam is shown without blending; this feature does not make clips seamless.

Run `npm run test:fbx` for a complete render → MediaPipe full → browser solver →
HTTP FBX export → reimport/render comparison. Requires Blender, FFmpeg, `uv`, and
the model installed by `npm run setup`. Outputs go to an ignored `artifacts/`
directory. See [FBX validation results](docs/fbx-validation.md) for measured
export fidelity and the remaining motion-reconstruction error.

Starting-bar and beat-offset **−/+** buttons let you move through the video and
correct a misplaced downbeat. Offsets shift both ends and the displayed/exported
bar boundaries by whole detected beats. Exports use animation JSON version 2;
existing audio analysis files remain compatible.

See [audio workflow and JSON formats](docs/audio-workflow.md) for the schema,
commands, import example and limitations.

## Python pose extraction

### GVHMR full-video motion capture

The offline GVHMR pipeline recovers body rotations and root travel, retargets
them to the textured Mixamo character, and writes `<video>.gvhmr.fbx` beside
each source in `videos/`. It also saves SMPL-X motion in `.gvhmr.npz`, source
and processing metadata in `.gvhmr.json`, and FBX round-trip checks in
`.gvhmr.validation.json`.

```powershell
./scripts/setup-gvhmr.ps1 -SmplxModel 'C:/path/to/SMPLX_NEUTRAL.npz'
./artifacts/gvhmr-env/Scripts/python.exe scripts/gvhmr_extract.py
```

Requires an NVIDIA CUDA GPU and the licensed SMPL-X v1.1 neutral model.
See [GVHMR setup and output details](docs/gvhmr.md). The environment, model
weights, Blender, and intermediate results stay under ignored `artifacts/`.

The earlier offline extractor still works with the video's new location:

```sh
uv run --python 3.12 pose_landmarker.py
```

Reference: [MediaPipe Pose Landmarker for Web](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker/web_js).

### Motion signals for TouchDesigner

The **Motion Signals** panel adds 20 derived channels with synchronized timeline graphs: body/hand/foot speeds, movement acceleration, hand/foot separation, hand/foot heights, elbow/knee angles, torso lean/twist and arm reach. Analyze the selected bar loop or the complete video, then download a native binary **.bclip** with named channels at 30 Hz, validity flags and optional 33-joint positions. Full-video analysis also works without an audio sidecar. See [the metric definitions, coordinate conventions and TouchDesigner workflow](docs/motion-metrics.md).
