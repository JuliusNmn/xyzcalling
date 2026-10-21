# Audio analysis and dance clips

Run `npm run analyze:audio` to analyze every supported file immediately inside
`videos/` (or `VIDEO_DIR`). Pass files or directories after `--` to choose inputs:

```sh
npm run analyze:audio -- /path/to/dance.mp4
npm run analyze:audio -- --force
```

Requires `uv`, FFmpeg and ffprobe. The npm command explicitly selects Python 3.12
and installs the script's isolated dependencies. Beat This! 1.1.0 / PyTorch 2.8
runs locally on CPU by default. The first musical input downloads the `final0`
checkpoint (about 78 MB). `--device mps` or `--device cuda` is optional; CPU is
the verified path. No external inference API is used. The script scans once per
invocation; it is not a background watcher.

The script writes `dance.mp4.analysis.json` beside `dance.mp4`, retaining the
video extension to avoid collisions with `dance.mov`. It reuses matching
results, refuses stale/incompatible results unless `--force` is specified, and
publishes each JSON atomically. A failed file doesn't stop the remaining batch;
any failures result in a nonzero exit status. A video without audio produces an
explicit error; silent audio produces a waveform and empty beat/bar arrays.

## Browser workflow

1. Select a library video. The server loads its analysis sidecar automatically.
   After running the extractor, press **Reload analysis**.
2. Click the overview waveform, type a starting detected bar, or use its −/+
   buttons. Choose 4, 8, 16, 32 or 64 bars, or **Complete video** to include the
   entire media timeline, including the intro, ending and partial bars.
3. Use **Beat offset** −/+ to correct a misplaced downbeat in whole-beat steps.
   Positive values start later; negative values start earlier. Both endpoints
   and all intervening bar boundaries shift by detected beat indices, preserving
   the selected number of bars through tempo changes. The detail waveform shows
   these adjusted boundaries. An offset cannot extend beyond detected beats or
   the video. Full-video mode disables bar/offset controls.
4. Use **Play selection** to check the alignment. **Loop selection** is enabled
   by default and repeats the selected range; **Pause selection** stops playback.
   Unchecking Loop makes playback stop at the end. Changing the selection during
   auditioning restarts playback at the new beginning. Looping also works for
   the complete video. Browser seeking can introduce a small gap at the seam.
5. Optionally choose a solver, smoothing, visibility and person in **Character +
   video**. Without opening that panel, export uses the custom solver defaults
   and Person 1. The main detection confidence and maximum-people settings also
   apply. People are indexed by detection order, not persistent identity.
6. Choose **FBX** or **JSON**, then **Extract & export animation** to sample this exact time interval at 30 FPS
   using a separate video decoder and MediaPipe instance, then bakes bone-local
   quaternion tracks. It doesn't depend on how much of the video was played.
   Cancel is available, and changing videos cancels the operation.

For a browser-only local video, use **Open analysis JSON** to select the sidecar
manually. Video and analysis files remain in the browser. FBX conversion sends
only the rig and baked bone animation to your server; JSON export also stays
entirely in the browser. Import checks
filename, byte length, timing and schema; it does not rehash the video in the
browser. Library sidecars additionally require matching source modification
time, preventing use of stale analysis after a video changes.

## Analysis JSON, version 1

`schema` is `pose-studio.audio-analysis`, `version` is `1`. All timestamps are
seconds on the same media timeline as `video.currentTime`, not wall-clock time
or audio-only time. FFmpeg shifts source timestamps by the container start time
and fills leading/trailing audio gaps with silence before analysis. `source`
contains the filename, byte size, modification time in milliseconds and SHA-256.

| Field | Meaning |
| --- | --- |
| `duration_seconds` | Source container duration, including silent sections |
| `analyzer` | Beat This! version, checkpoint, device and postprocessing setting |
| `bpm` | Median tempo from intervals spanning up to eight beats; null when unavailable |
| `beats_seconds` | Sorted beat timestamps, including any beats before the first downbeat |
| `downbeats_seconds` | Detected bar starts, aligned to beat timestamps |
| `bars` | Complete intervals between consecutive detected downbeats |
| `warnings` | Shortage of complete bars or unusual beat counts |
| `waveform` | Precomputed mono min/max amplitude pairs; no browser audio decoding needed |

Each bar contains a zero-based `index`, `start_seconds`, `end_seconds`,
`start_beat_index` (inclusive), `end_beat_index` (exclusive), `beat_count`, and
local `bpm` calculated from that bar's duration. The UI displays one-based bar
numbers. Beat counts are measured between detected downbeats; no 4/4 assumption
is made, and there is no claim of formal time-signature detection. Only intervals
bounded by two downbeats are exported. Model mistakes can create incorrect bar
counts, especially in intros, breakdowns or weak rhythmic sections.

Waveform `encoding` is `min-max`. `peaks` contains `[minimum, maximum]` pairs in
[-1, 1], at up to 100 bins per second, capped at 30,000 bins. Bin `i` starts at
`start_seconds + i * bin_seconds`. The waveform covers `duration_seconds` and
is intended for visual navigation, not reconstruction of audio. Analysis JSON
contains no raw audio or poses.

## Dance animation JSON, version 2

`schema` is `pose-studio.dance-animation`, `version` is `2`. Analysis sidecars
remain version 1; they do not need regeneration. The animation wrapper advances
to version 2 because full-video selections have nullable bar fields and exports
can carry corrected downbeats. Three.js `animation` data remains unchanged.
The download name includes the source video, bar numbers and any beat offset,
or `complete-video`. The JSON contains:

- `source`: original fingerprint, source start/end seconds, `selection_mode`
  (`bars` or `full`), first detected bar (one-based), exact bar count and signed
  `beat_offset`. Full-video mode sets `first_detected_bar` and `bar_count` to
  null and `beat_offset` to zero; its range is `[0, video.duration]`.
- `duration_seconds`, `sample_rate_hz: 30`, `timebase: "clip-seconds"`: sampling
  starts at zero, includes regular 30 FPS samples and an exact endpoint keyframe.
  The final interval can be shorter than 1/30 second.
- `rhythm`: selected beats and complete bars, rebased to clip zero. In bar mode,
  `downbeats_seconds` and `bars` reflect the beat offset, including the closing
  boundary; `detected_downbeats_seconds` retains the original detections within
  the clip. `alignment` is `detected` or `beat-offset`, and `beat_offset` records
  the correction. Beat events are half-open `[0, duration)`. Full-video mode
  preserves original timestamps and complete detected bars; it never invents
  bar boundaries for the intro or ending.
- `solver` and `pose_model`: selected solver/settings, person and inference
  configuration for reproducibility.
- `rig`: Mixamo bone names, parent names, rest-local transforms and root transform.
  Rotations are XYZW quaternions in Three.js Y-up coordinates; positions/scales
  retain the imported FBX values, with its exported root scale.
- `animation`: standard Three.js `AnimationClip.toJSON()` data containing
  quaternion tracks for the torso and limbs. Bind to the matching FBX skeleton,
  disable its original dance and start from rest pose before playing.
- `frames`: timestamped normalized and world landmarks for the selected person,
  plus the number of updated bones. Null landmarks indicate no detection.
- `quality`: tracked and held frame counts. A tracked frame means at least one
  controlled bone updated; it does not guarantee all joints were reliable.

To consume the baked animation on the same imported Mixamo character:

```js
const clip = THREE.AnimationClip.parse(data.animation);
const mixer = new THREE.AnimationMixer(character);
mixer.clipAction(clip).play();
// In the render loop: mixer.update(deltaSeconds).
```

The JSON option exports skeletal animation plus source landmarks. There is no
character mesh or texture in the JSON download. Choose FBX to include the skinned
character, original embedded textures and baked animation.
Motion is in place, body-only, with no foot locking or finger tracking. Missing
or low-confidence bones hold their last pose; initial gaps use rest pose.
All-empty selections fail rather than downloading a static rest-pose clip.
Clips aren't made seamless automatically: matching musical boundaries doesn't
guarantee matching body poses at both ends.

Longer selections retain the same 30 FPS sampling and can take time and create
large JSON files because they include landmarks as well as animation tracks.
The browser exporter caps a selection at 100,000 regular samples (about 55
minutes at 30 FPS); larger selections report an error instead of exhausting
browser memory. Loop playback is a preview setting and doesn't bake a repeated
or blended animation into the exported clip.

## FBX export

The server uses installed Blender to load the original character, remove its
source actions, and bake the selected browser solver's rotations into the imported
bone axes. The output is a binary FBX with one animation, 65 bones, skin weights,
mesh and embedded textures. It preserves the current solver, smoothing, leg
tracking, visibility and person selections. It does not rerun pose inference.

Set `BLENDER_BIN` if Blender is outside `/Applications/Blender.app` on macOS or
outside PATH on other systems. The UI checks availability before extracting a
clip. Only one conversion runs at a time; canceling stops Blender and deletes
temporary files. Selections over ten minutes must use a shorter range or JSON.

Keys begin at time zero (Blender's importer displays that as frame 1). For
excerpts ending between 30 Hz samples, the exporter samples quaternion curves
onto a uniform grid with fractional-frame keys at 30 FPS to preserve the exact
duration. Beat/landmark metadata remains specific to the JSON format.

An existing animation JSON can also be converted without the web UI:

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \
  --python-exit-code 1 --python scripts/export_fbx.py -- \
  --input dance.json --character 'amsterdam-hackathon/Geo/Chicken Dance.fbx' \
  --output dance.fbx
```

## Checks

```sh
npm run build
npm test
uv run --no-project --python 3.12 --with numpy python -m unittest discover -s tests -p 'test_audio*.py'
```

References: [Beat This! source and model](https://github.com/CPJKU/beat_this),
[Three.js AnimationClip](https://threejs.org/docs/#api/en/animation/AnimationClip).
