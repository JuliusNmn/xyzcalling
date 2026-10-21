# FBX export validation — 21 October 2026

The app now exports a textured, skinned FBX using the selected solver's baked
animation. Export fidelity passed; video-based recovery is a recognizable but
coarse reconstruction, with visible arm/depth errors, narrower leg motion and
no original hip travel. It should not be described as a faithful mocap copy.

## Test performed

1. Rendered the repository's original `Chicken Dance.fbx` to 144 PNG frames and
   an H.264 MP4, 384 × 512 at 30 FPS, using Blender 4.3.0.
2. Ran actual MediaPipe 1.1.1 inference with the same full model used by the app.
   It detected the character in **144/144 frames**. No ground-truth joint
   positions were supplied to the inference or retargeting stages.
3. Fed those detections through the production TypeScript custom solver, default
   smoothing 0.4, visibility 0.5 and leg tracking enabled, then the production
   animation JSON baker. Python inference supplies the same landmark format;
   this regression does not run the browser's video-seeking code.
4. Sent the baked rig/animation through the actual HTTP FBX export endpoint.
5. Independently reimported that FBX in Blender, compared every bone's joint
   position at every frame against the browser solver, and rendered it with
   the same camera, lighting, texture settings and frame rate as the source.
6. Compared the recovered pose to the original dance without temporal alignment
   or scale fitting. Only hip translation was removed because the app explicitly
   produces in-place motion.

The browser UI was also exercised separately with the original MP4 opened as a
local file: the 4.8-second complete-video FBX export reported **145/145 tracked
samples**, including its closing keyframe, and handed the FBX to the browser's
download manager. The server response uses binary data without an attachment
header so embedded browsers can receive it through `fetch`.

## Results

| Check | Result |
| --- | --- |
| Bone hierarchy | 65 bones retained |
| Geometry | One skinned mesh, original textures render correctly |
| Reimported action | Frames 1–144, 30 FPS, last key at 4.766667 seconds |
| Maximum browser → FBX joint error, all bones/frames | **0.088 mm** (gate: <1 mm) |
| Mean browser → FBX joint error | 0.0043 mm |
| Mean ground-truth joint error, hip aligned, 19 body joints | **9.38 cm** |
| 95th-percentile ground-truth joint error | 23.91 cm |
| Mean limb-direction error, eight arm/leg segments | 19.98° |
| 95th-percentile limb-direction error | 44.87° |
| Original source file | SHA-256 unchanged |

Visual inspection of the comparison and four sampled frame pairs confirmed
intact skinning, textures and motion, with no axis flips or exploding limbs.
The broad arm-raise/lower/clap sequence is recognizable. Wrist placement, elbow
depth, foot placement and knee bend differ visibly. The export is essentially
lossless relative to the app; the remaining error comes from inference and
the body-only, in-place solver. Finger/head animation and root travel from the
original dance are not reconstructed.

Source SHA-256:
`8ce0844554d0b4fd8353638214165cba69a4237a8fd3b305226157bccc59b421`.

## Artifacts and reproduction

This run is in `artifacts/fbx-final/` (ignored by Git):

- `original.mp4`: rendered ground-truth dance.
- `generated.fbx`: new export, with mesh and embedded textures.
- `generated.mp4`: independently reimported FBX render.
- `comparison.mp4`: original on the **left**, generated on the **right**.
- `contact-sheet.png`: four sampled comparison frames.
- `verification.json`: full metrics, per-joint errors and file hashes.
- `animation.json`, `landmarks.json`, joint snapshots and logs: reproducibility evidence.

A separate 0.047-second excerpt also retained its fractional endpoint on Blender
reimport (0.046999995 seconds). This guards against rounding selections to whole
frames and Blender's handling of custom frame rates.

A copy of the small numerical report is retained in
[`fbx-validation-results.json`](fbx-validation-results.json).

Run the complete regression into a new directory:

```sh
npm run test:fbx -- artifacts/my-fbx-check
```

Requires Blender (`BLENDER_BIN` overrides discovery), FFmpeg, `uv`, and the full
model installed by `npm run setup`. The regression fails on changed source
hash, bone/skin/timing loss, or export error exceeding 1 mm. Reconstruction
accuracy is reported separately; no arbitrary threshold is used to declare
high-quality motion capture. Synthetic character footage is not evidence of
accuracy on independently recorded human footage.
