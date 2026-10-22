# Animation-Only Clips

Direct CLI extraction from the binary FBX animation curves, written using the
`bcli` chunk layout reverse-engineered from `pattern1.bclip`. No mesh data and no
Blender rebaking. The sample can be decoded and re-encoded byte-for-byte.

| File | Samples | Rate | Channels |
| --- | ---: | ---: | ---: |
| Chicken_Dance.bclip | 144 | 30 | 159 |
| Arms_Hip_Hop_Dance.bclip | 660 | 30 | 159 |
| Chicken_Dance_MediaPipe.bclip | 144 | 30 | 594 |

Load with a File In CHOP, retaining names and sample rate from the file. Names
follow `mixamorig_LeftHandRing2:rx`, etc. Rotations are FBX local Euler values in
degrees; translations/scales retain FBX source units. Constant authored channels
are retained, including fixed finger poses. First sample index is zero.

These are channels, NOT rigs: keep the matching character hierarchy, pre/post
rotations, rest transforms and rotation order. The MediaPipe clip matches the
baked FBX's rig conventions; sharing bone names alone does not prove that it can
drive the untouched original character correctly.

Six format/extraction tests pass, including byte-identical template roundtrip.
Native TD loading/playback is not yet verified: the active TD window changed
during inspection and further UI input was stopped. JSON files beside each clip
record source/output hashes, timing and channel names. The original sample and
FBX files are unchanged.

Recreate using `python3 mocap/fbx_to_bclip.py SOURCE.fbx OUTPUT.bclip --take mixamo.com`.
Only a single animation layer and densely baked curves are supported. Sparse
nonlinear curves are rejected rather than silently interpolated incorrectly.
