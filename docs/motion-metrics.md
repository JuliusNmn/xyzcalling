# Motion metrics and TouchDesigner export

The Motion Signals panel below the audio timeline analyzes the selected bar loop or the complete video. Full-video analysis also works for browser-local videos without an audio sidecar. Analysis uses the selected person, detection confidence and character tracking-visibility threshold, captured when analysis starts. Choose Character + video to change person or tracking visibility. Detection order is not persistent identity.

Click **Analyze selected loop** or **Analyze complete video**, then inspect all 20 timelines, click any graph, or scrub the shared control to seek the source video. Arrow keys on a focused graph step one sample; Home/End go to the endpoints. Each card shows its original units, observed range and valid sample percentage. Graphs use independent scales; exports retain physical values. Downloads always refer to the explicit **Analyzed** range, even if you subsequently change the bar selection. Changing videos clears the result. Cancellation or a failed re-analysis preserves the previous result for the same video.

## Channels

| Channel | Unit | Meaning |
| --- | --- | --- |
| `body_speed` | m/s | Mean speed of tracked shoulders, elbows, wrists, hips, knees and ankles relative to the hips; requires at least six joints. |
| `left_hand_speed` | m/s | Wrist speed relative to the hips. |
| `right_hand_speed` | m/s | Wrist speed relative to the hips. |
| `left_foot_speed` | m/s | Ankle speed relative to the hips. |
| `right_foot_speed` | m/s | Ankle speed relative to the hips. |
| `body_acceleration` | m/s² | Signed change in body movement speed per second. |
| `hand_distance` | m | 3D distance between wrists. |
| `foot_distance` | m | 3D distance between ankles. |
| `left_hand_height` | m | Wrist height above the hip midpoint; positive is up. |
| `right_hand_height` | m | Wrist height above the hip midpoint; positive is up. |
| `left_foot_height` | m | Ankle height above the hip midpoint; usually negative. |
| `right_foot_height` | m | Ankle height above the hip midpoint; usually negative. |
| `left_elbow_angle` | deg | Shoulder–elbow–wrist interior angle; 180° is straight. |
| `right_elbow_angle` | deg | Shoulder–elbow–wrist interior angle; 180° is straight. |
| `left_knee_angle` | deg | Hip–knee–ankle interior angle; 180° is straight. |
| `right_knee_angle` | deg | Hip–knee–ankle interior angle; 180° is straight. |
| `torso_lean` | deg | Angle of hip-to-shoulder midpoint from vertical; 0° is upright. |
| `torso_twist` | deg | Signed shoulder heading minus hip heading in the horizontal plane, −180° to 180°. |
| `left_arm_reach` | ratio | Shoulder-to-wrist distance divided by upper arm plus forearm length; 1 is fully extended. |
| `right_arm_reach` | ratio | Shoulder-to-wrist distance divided by upper arm plus forearm length; 1 is fully extended. |

The calculations use the extracted MediaPipe world landmarks, before character retargeting. Rotation smoothing and Track legs affect the character, not these signals. Wrist and ankle positions stand in for hands and feet. Coordinates are estimated meters relative to the hip midpoint: x right, y down, z away from the camera. Heights invert y. Speed subtracts the current hip midpoint from each joint before differentiating, so global translation cancels. These are movement signals, not measurements of travel through the room or foot contact.

Body speed averages the valid members of 12 major joints and requires at least six; its support can vary as joints become visible. Body acceleration is only valid when that support stays the same across consecutive speeds. Each individual measurement requires all of its own input joints. Nonfinite positions, low visibility and degenerate angles are invalid. No gap filling, filtering or loop-seam blending is applied. Tracking jitter can be smoothed downstream in TouchDesigner.

## Downloads and timing

**Download .bclip** creates a binary clip entirely in the browser. It includes 20 metric channels, their 20 matching `_valid` flags, `clip_time` and `source_time`: 42 channels. **Include 33 joint positions** adds `joint_0_x` through `joint_32_z` and a validity channel per joint: 174 channels total. Optional joints keep original MediaPipe coordinates. The **channel guide** JSON records units, formulas, selected range, timing and visibility threshold.

Missing values export as zero with validity 0. Validity is 1 only when the sample can be calculated. Speeds need two consecutive valid frames; acceleration needs three. Initial derivatives and derivatives across gaps are invalid rather than false movement spikes. There is no derivative across the end-to-start loop seam.

CHOP samples use uniform 30 Hz timing beginning at clip time zero, covering the half-open range [selection.start, selection.end). The irregular closing key used by FBX animation is omitted. There are ceil(duration × 30) samples, so TouchDesigner playback duration rounds up by less than one sample (33.3 ms). Source time retains the selection offset. The guide preserves the exact requested boundaries.

On the server computer, use **http://127.0.0.1:3000** for downloads. The app listens on loopback alongside its private-network address; Chrome may block binary downloads from a plain-HTTP network origin. No browser security bypass is needed on loopback. Remote access should use trusted HTTPS for downloads.

Load the file using a [File In CHOP](https://docs.derivative.ca/File_In_CHOP) and **Use Names In File**. Use a Select CHOP to pick a metric, its validity flag to gate it, and a Math CHOP to map the original units to a useful control range. Playback and looping are configured in TouchDesigner. Channels are held outside their range by the file's extend defaults; the file does not automatically make the choreography seamless.

## Binary compatibility and validation

The writer implements TouchDesigner's legacy `bcli` variant: big-endian float32 samples, named tracks, a rate packet, float64 start index, sample count, length-prefixed clip/track packets and end markers. This is a real binary format, not ASCII with a renamed extension. Modern Houdini's [channel format documentation](https://www.sidefx.com/docs/houdini/io/formats/channel_formats.html) describes another magic string (`bclp`); this exporter targets the variant generated and accepted by TouchDesigner itself.

The regression fixture `tests/fixtures/touchdesigner-reference.bclip` was generated locally by TouchDesigner 2023.11760 on 2026-10-21 from two 30 Hz, four-sample channels: hand_distance = [0, 0.25, 1, -2], hand_distance_valid = [1, 1, 0, 1]. The writer reproduces all 252 bytes exactly. A separate 174-channel moving-pose file was imported into TouchDesigner, checking every name and sample, 30 samples at 30 Hz, and no import errors. Maximum absolute error was 0.00000746 from float32 quantization. Results are recorded in `docs/motion-validation-results.json`.

Unit tests cover stationary and moving poses, velocity/acceleration units, hip translation invariance, geometric angles and heights, missing joints, confidence gaps, degenerate geometry, non-integral loop boundaries, optional joint channels and invalid binary input. Run `npm test` and `npm run build`.
