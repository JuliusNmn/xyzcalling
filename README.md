# Pose Studio

Related hackathon work lives in [`amsterdam-hackathon/`](amsterdam-hackathon/HANDOFF.md).
The dashboard uses its Mixamo character and ports its custom retargeting solver
to the browser. TouchDesigner, djay OSC and the offline tools remain separate.

A local video-to-FBX workspace. Select a video, choose or upload a Mixamo character,
and download the full animation. An optional loop popover selects a shorter range.
One preview combines MediaPipe markers, Custom, Kalidokit and saved GVHMR motion.
MediaPipe's model, JavaScript and WASM are served locally; inference runs in the browser.

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
Tracking uses the default confidence and visibility thresholds; advanced tracking
and smoothing controls are hidden from the export workflow.

## Character preview and solvers

The shared preview shows the marked video and three pose columns: **Custom**,
**Kalidokit** and **GVHMR**. All follow the main video's playback, seeking and
speed. GVHMR requires a saved extraction; its column explains when none exists.
After a download is prepared, that source's column displays the processed motion.
Drag to orbit, scroll to zoom, or use **Reset camera**.

Choose **Character FBX** for both preview and export. Built-in models are **Chicken
Dance · Mixamo** and **Green Segments · Low poly**. Additional FBXs are discovered
in `assets/characters/` (or `CHARACTER_DIR`); use **Refresh models** after adding files.
**Upload FBX** validates a Mixamo body rig and saves the character in that directory
(maximum 100 MB). Use embedded textures for self-contained uploads. Arbitrary rigs
are not supported. Character changes reuse the extracted motion.

The new asset is `assets/characters/green-segments.fbx` (432 authored vertices,
352 polygon faces, 65 bones; no bundled animation). Its geometry is manually
specified in `scripts/create_green_segments.py`, using only the original skeleton
for compatibility. Rebuild with:

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python-exit-code 1 --python scripts/create_green_segments.py
```

`src/characters.ts` is the shared model catalog. FBX requests accept a catalog
`character_id`; older requests default to Chicken Dance. The server rejects unknown
IDs and loads only catalog paths. Preview retargeting accounts for each FBX's rest
axes and preserves root travel. JSON retains the source rig/motion and records the
chosen `character_id`; FBX contains the selected model with that motion baked in.

The **Animation** selector chooses the export source. GVHMR is selected when a
saved animation exists and preserves root movement. Custom and Kalidokit extract
MediaPipe poses at 30 FPS, with in-place body motion. Live previews use their
existing smoothing defaults; exports use light centered smoothing with accent
preservation, zero timing offset and no beat alignment. Smoothing controls are hidden.
Low-confidence joints hold their previous pose. Monocular depth, occlusion and
missed detections can still produce incorrect poses or foot sliding.

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

For title-named GVHMR FBXs pulled from another machine, run `npm run import:gvhmr`
to validate and link them to the local video filenames, then refresh the library.
See [saved animation matching](docs/gvhmr.md#using-saved-animations-in-pose-studio).

## Beats, waveform and dance excerpts

Run `npm run analyze:audio` to generate `<video filename>.analysis.json` beside
each video in `videos/` (or `VIDEO_DIR`). Requires `uv` and FFmpeg. This runs
Beat This! locally and precomputes the waveform, beat times, downbeats, complete
bar boundaries and tempo. Matching sidecars are reused; `--force` regenerates.

Full-video export does not require audio analysis. Select a video and character,
then press **Download FBX**. The same button extracts and downloads the motion;
there is no separate extraction step or second video player.

For an excerpt, open **Select a loop**, enter start/end seconds, or choose detected
bars when analysis is available. **Play selection** auditions the range in the
shared preview; **Repeat** loops playback. Press **Use this loop**, then the same
**Download FBX** button. **Use full video** restores the full duration. Loop seams
are not blended automatically. Use **Reload beats** after regenerating an analysis
sidecar, or **Open beat analysis** for a browser-only local video.

FBX conversion requires Blender on the server (`/Applications/Blender.app` on
macOS, `blender` on PATH elsewhere, or `BLENDER_BIN`). The selected character and
baked animation are exported together. Only rig and bone tracks go to the server;
source video and detected landmarks remain in the browser. Conversion files are
removed after download or cancellation. Exports are limited to ten minutes.

Run `npm run test:fbx` for the full extraction/export validation pipeline; see
[FBX validation](docs/fbx-validation.md). See [audio workflow and JSON formats](docs/audio-workflow.md)
for the underlying analysis and animation formats.

## Python pose extraction

### GVHMR full-video motion capture

The offline GVHMR pipeline recovers body rotations and root travel, retargets
them to a neutral 4,810-triangle mannequin with Mixamo bone names, centers the
hips horizontally on every frame, and writes `<video>.gvhmr.fbx` beside
each source in `videos/`. It also saves SMPL-X motion in `.gvhmr.npz`, source
and processing metadata in `.gvhmr.json`, and FBX round-trip checks in
`.gvhmr.validation.json`.
Turns remain, and a rolling floor estimate removes slow vertical drift while
retaining short jumps and crouches. Use `--root-motion travel` for the original
trajectory or `--character` to choose the original textured FBX.

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

The motion metric and BCLIP modules remain available in the source but are no
longer mounted in the simplified browser workflow. See [metric definitions and
TouchDesigner notes](docs/motion-metrics.md) for their data format.
