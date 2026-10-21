# MediaPipe To Mixamo: Body-Only Baking Pilot

## Status

21 October 2026: inspected the existing `Geo/Chicken Dance.fbx` in Blender 4.5.3.
It contains one armature with the standard `mixamorig:` bone names and a
144-frame Mixamo action. Created an offline extractor and a rest-aware rotation
baker. The calibration test uses joint positions from the original animation,
NOT MediaPipe inference: it verifies coordinate conversion, limb-direction fit,
non-static output, original-action replacement and malformed-landmark rejection.
It is not a successful video-to-animation demonstration by itself.

The user reconnected the T7 and authorized keeping the payload there. Verified
volume UUID `A54BC549-4CB9-490A-8012-ABA13A7505D4`; the disk root is system-owned,
so the new payload uses the existing user-owned `Projects` directory, without
changing permissions:

`/Volumes/T7-2tb-2509/Projects/amsterdam-hackathon/mocap`

**Working calibration result:** rendered the existing character dance, ran actual
MediaPipe 0.10.32 / Pose Landmarker lite inference (144/144 frames detected),
solved 14 body bones, exported a new FBX and reimported it in Blender 4.5.3.
The corrected `Chicken-Dance-MediaPipe-v2.fbx` has 144 frames at 30 FPS. All 65
bone names and the skinned mesh survived; maximum joint-head roundtrip error was
0.0000702 m. That measures export integrity, NOT tracking accuracy.

The original FBX SHA-256 is unchanged. The rendered source is synthetic footage,
not an independently recorded human dancer. No source FK positions are fed into
the MediaPipe extraction/baking run; the known FK fixture is a separate math test.
Noticeable pose/depth/foot-placement errors remain visible. No TD patch has been
edited and this FBX has not yet been tested in TouchDesigner.

- Preview on SSD: `mediapipe-mixamo-comparison-v2.mp4` (source / 2D detections / baked FBX).
- [Local verification report](reports/chicken-dance-calibration-20261021.json).
- First `Chicken-Dance-MediaPipe.fbx` pilot is superseded: its imported timing
  had a one-frame offset. Keep/use v2, whose FBX keys start at zero and whose
  default Blender reimport spans frames 1-144.
- Environment, model, source frames/video, landmarks and derived FBXs remain on
  the SSD. Code, dependency lock and small verification report remain local.
- Real human-video capture, face/fingers, ground contact and seamless looping
  are still unverified/unimplemented. No claim of production mocap quality.

## Smallest Useful Demo

1. Render the existing dance, or supply a short single-person full-body video.
2. Run MediaPipe Pose Landmarker offline to get 33 world landmarks per frame.
3. Convert camera coordinates to Blender axes and solve the existing Mixamo
   rig using its actual rest matrices. Do not copy VRM Euler rotations blindly.
4. Bake the resulting local bone quaternions into a NEW FBX, leaving the source
   character, original dance, TD patch and OSC receiver untouched.
5. Compare the source video and baked character. Reimport the exported FBX and
   confirm its motion/timing in Blender and then TouchDesigner.

KalidoKit is useful for later face/hands and VRM workflows, but this first baker
does not call KalidoKit. It directly maps MediaPipe world-space body directions
to Mixamo. This avoids assuming the VRM and Mixamo local rest axes are identical.

## Commands

Run from the hackathon project directory. These are manual commands, not an
automatic downloader or batch job. Substitute an actually mounted SSD path for
`PAYLOAD`; never create a stand-in under `/Volumes` when the disk is disconnected.
Use `mocap/local` only with explicit local-storage approval. Do not move existing
project assets as part of setup.

```sh
BLENDER='/Applications/Blender 4.5.3.app/Contents/MacOS/Blender'
PAYLOAD='/Volumes/T7-2tb-2509/Projects/amsterdam-hackathon/mocap'
test -d /Volumes/T7-2tb-2509 || exit 1
mkdir -p "$PAYLOAD"
/opt/homebrew/bin/python3.12 -m venv "$PAYLOAD/.venv-mocap"
"$PAYLOAD/.venv-mocap/bin/python" -m pip install --no-cache-dir -r mocap/requirements-macos-py312.lock
```

Obtain the official [Pose Landmarker lite model](https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task)
into `$PAYLOAD/pose_landmarker_lite.task`. Keep the original source URL and a
hash alongside the payload. No input video is uploaded by our extraction script.

Optional synthetic calibration render (144 PNGs; not a seamless-loop claim):

```sh
"$BLENDER" --background --factory-startup --python-exit-code 1 --python mocap/blender_calibration.py -- \
  --character 'Geo/Chicken Dance.fbx' --render-dir "$PAYLOAD/source-frames"
ffmpeg -n -framerate 30 -start_number 1 -i "$PAYLOAD/source-frames/frame_%04d.png" \
  -c:v libx264 -pix_fmt yuv420p "$PAYLOAD/source-dance.mp4"
```

Extract and bake:

```sh
"$PAYLOAD/.venv-mocap/bin/python" mocap/extract_pose.py \
  --video "$PAYLOAD/source-dance.mp4" --model "$PAYLOAD/pose_landmarker_lite.task" \
  --output "$PAYLOAD/dance-landmarks.json" --max-seconds 8
"$BLENDER" --background --factory-startup --python-exit-code 1 --python mocap/blender_retarget.py -- \
  --character 'Geo/Chicken Dance.fbx' --landmarks "$PAYLOAD/dance-landmarks.json" \
  --output "$PAYLOAD/Chicken-Dance-MediaPipe-v2.fbx"
```

Both scripts refuse to overwrite their main output. Baking writes a companion
`.report.json`. `--alpha 1` disables quaternion smoothing; default 0.6 smooths
but delays motion slightly. Low-visibility limb directions hold the previous
local rotation. Full-person detection failures are preserved in the timeline,
not removed to accelerate the clip. Extractor limits clips to 8 seconds by default.

Retarget test, requiring no extra packages or model:

```sh
"$BLENDER" --background --factory-startup --python-exit-code 1 --python mocap/blender_calibration.py -- \
  --character 'Geo/Chicken Dance.fbx' --check
```

To verify a new bake, run `blender_verify.py` with `--character`, `--landmarks`,
`--baked` and a NEW `--report` path. It reconstructs the solver output, reimports
the FBX and checks every frame's joint heads within 1 mm, bone names, duration,
presence of a skinned mesh, and unchanged source hash. It is tied to this pilot's
default alpha 0.6/visibility 0.5 settings, not arbitrary baker configurations.

For a preview, render the exported FBX using `blender_calibration.py --character
NEW_FILE --render-dir NEW_DIRECTORY`, then use `make_preview.py --source VIDEO
--frames RENDER_DIRECTORY --landmarks JSON --output NEW_MP4`.

## Important Limits

- Body only: hips, three spine bones, upper/lower arms, upper/lower legs, feet.
- Root remains fixed in place; no reconstructed global camera-space trajectory.
- No foot locking, contact constraints, hand/finger tracking or facial blendshapes.
- Limb direction constrains swing but not axial twist; elbows/shoulders can look
  unnatural. Foot sliding and monocular depth jitter are expected limitations.
- Fit to estimated landmarks is not accuracy against the real dancer. The
  synthetic fixture explicitly cannot measure MediaPipe's tracking quality.
- A baked animation is not automatically a clean loop. Choose a repeatable
  cycle and inspect/blend its endpoints before using Cycle playback.
- Keep inference/model payloads, recordings and derived animation assets out of
  Git by default. A third-party model/video retains its original licensing.

## Sources

- [MediaPipe Pose Landmarker Python](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/python)
- [KalidoKit: VRM/Live2D focus and pose solver](https://github.com/yeemachine/kalidokit)
- Blender FBX operators and math are exercised in the installed Blender 4.5.3.
