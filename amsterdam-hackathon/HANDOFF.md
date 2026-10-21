# Amsterdam Hackathon Snapshot

Copied on 21 October 2026 into this separate subdirectory at Moritz's request.
Source checkout: `weisenhills/amsterdam-hackathon`, base commit `bf0a87f`, plus
its current uncommitted prototype work. This is a snapshot, not a nested Git repo
or a submodule. The surrounding Pose Studio application is unchanged.

## Included

- `TD.toe`: TouchDesigner scene snapshot.
- `Geo/`: existing Mixamo Chicken Dance character/animation and textures.
- OSC listener, TouchDesigner callbacks and Python tests.
- `mocap/`: offline pose extraction, direct-direction retargeter, FBX baker,
  synthetic calibration tests, export verification, preview generator and locks.
- Small verification report from the completed direct-solver calibration.

## Verified And Pending

The direct solver completed actual MediaPipe inference on a rendered Chicken
Dance video, detecting 144/144 frames. Its timing-corrected baked FBX was
reimported in Blender: 65 bones, skinned mesh and 144-frame/30-FPS timing preserved.
This proves pipeline/export operation, not high-quality capture or real-video
tracking. TouchDesigner import of that new FBX remains untested.

`mocap/solve_kalidokit.cjs` is a WORK-IN-PROGRESS comparison stage. KalidoKit
1.1.5 has been run locally on the same recording and synthetic convention probes.
The main package entry is incompatible with modern Node's extensionless ESM
resolution, so the script intentionally loads the published UMD bundle. The
KalidoKit-to-Mixamo adapter, second baked FBX and A/B comparison are NOT finished.
Do not present the existing direct-solver preview as a KalidoKit result.

## Excluded

No nested `.git`, Python virtual environments, `node_modules`, downloaded models,
render caches, automatic TD backups, recordings or generated FBXs are included.
They are not needed for the Pose Studio app to run. On Moritz's machine the
prototype payload is under:

`/Volumes/T7-2tb-2509/Projects/amsterdam-hackathon/mocap`

The working derived FBX there is `Chicken-Dance-MediaPipe-v2.fbx`, with preview
`mediapipe-mixamo-comparison-v2.mp4`. The absolute paths in development notes and
the verification report describe that machine; configure your own payload path.
The original source FBX is unchanged. Third-party character assets retain their
original licensing; this snapshot does not grant redistribution rights.

See [`mocap/README.md`](mocap/README.md) for reproduction steps and known limits.
The standalone OSC receiver and this app must not compete for the same UDP port.
