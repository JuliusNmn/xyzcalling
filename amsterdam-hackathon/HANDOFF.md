# Amsterdam Hackathon Snapshot

## Snapshot refresh · 22 October 2026

Updated from `weisenhills/amsterdam-hackathon` commit
`d3b6cfa5f06113bf072aef40f51fec069100c666` into `JuliusNmn/xyzcalling`.
This directory now includes the complete tracked Motion Stage application,
including Ready (Acid Rubber), What Else Is There? (the `real-house` sphere grid),
Wide Open, Gal a Bubble, Freestyler, and First of the Year scenes, plus the
committed stage controls, TouchDesigner snapshots, clips, mocap tools and reports.
Animation-library paths are adjusted to this repository’s `videos/` directory.
It remains a plain directory, with no nested Git repository or submodule.

Run Motion Stage separately with `cd amsterdam-hackathon/motion-stage`,
`npm ci`, then `npm start`. See its README for configuration and OSC routing.
Media paths and the two Ch20 character symlinks retain the source machine's SSD
locations; configure them for another machine. Dependencies, local configuration,
models and other ignored runtime payloads are not part of this snapshot.

The original snapshot notes below describe the earlier calibration work.

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
