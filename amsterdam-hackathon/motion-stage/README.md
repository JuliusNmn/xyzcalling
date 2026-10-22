# Motion Stage

Local djay OSC → server-side FBX animation → WebSocket → two-deck Three.js renderer.
This is separate from TouchDesigner and Pose Studio. No `.toe` file is modified.

## Run

Requires Node 22+. From this directory:

```sh
npm ci
npm start
```

Open **http://127.0.0.1:3100**. Set djay's Advanced OSC target to
**127.0.0.1:10003**, and its incoming/request port to **10001**. Port 10002 was
already occupied during setup. The app requests a complete state dump on startup;
use **Signal monitor → Request full djay state** after reconnecting.

The server is a foreground process, not an installed login service. Stop with
Ctrl+C. Environment overrides: `HOST`, `PORT`, `OSC_HOST`, `OSC_PORT`, `DJAY_PORT`.
For a remote browser/djay, explicitly configure reachable bind addresses and
`callbackBaseUrl` in `config.local.json`; the callback URL must be reachable by
djay. Default operation stays on loopback. The local configuration UI has no login.

## Use

- **Live OSC** receives real deck 1 / deck 2 state. The fader follows djay.
- **Try demo** uses a separate synthetic state. Pause, seek, change tempo, move
  the fader, or switch deck B between a track assignment and a fallback. Real OSC
  continues to be received independently; return to Live OSC to show it.
- **Animation library** sets mode, bar count, scene, exact artist/title aliases,
  offset and each deck's fallback. Changes persist in ignored `config.local.json`.
- **From Pose Studio** discovers the 20 updated FBXs in `../../videos`.
  Import chosen captures instead of loading the entire collection into memory.
  Each new fallback starts at 4 bars: set the correct musical length yourself.
- **Automatic scene** selects the scene assigned to the matched animation. The
  deck dropdown can override it for experimentation. Mint and amber are solid
  character scenes; violet is a wireframe scene. The fullscreen button opens
  clean program output.
- **Anchors** displays head, wrist/hand, and ankle/foot joint origins. Their exact
  XYZ values are listed below the stage and included in every pose packet.

The `npm run demo` command is an optional real UDP generator, distinct from the
in-app demo. Do not send it to the same listener concurrently with actual djay.

## Animation timing and identity

`config.json` is the checked-in default; `config.local.json` replaces top-level
settings when present. The routing JSON editor exposes paths, scales, clip index,
artwork file, and network settings. Bind ports/FPS require restart. A failed
library save leaves the previous configuration active.

Full-track entries (`mode: "track"`) match exact normalized artist + title aliases.
Ambiguous matches use a fallback. There is no stable track ID in djay OSC v4;
optional configured `trackId` matching is available for other senders. Title-only
fuzzy matching is deliberately avoided. Use the precise edit/recording identity.

Full-track playback samples `playback/time + offsetSeconds`, in seconds. It does
not stretch or wrap; outside the FBX duration it holds the endpoint. The UI warns
when the song and FBX durations differ by more than one second. The included
First of the Year capture is **142.48 seconds of the dance video**, not verified
as synchronized to every release of the song. Map the matching audio edit or
provide the correct full-length FBX and offset before performing with it.

Fallback playback uses:

```text
absoluteBeat = (bar - 1) * 4 + barPhase
clipTime = positiveModulo(absoluteBeat, bars * 4) / (bars * 4) * clipDuration
```

This keeps a declared two-bar clip at exactly two bars as tempo changes. A
fallback's bar count is a declaration, not automatic beat detection. Captures
aren't automatically seamless; choose a cycle with matching endpoints. Original
root motion is retained. The supplied fallback counts are editable demo choices.

Transport updates re-anchor the clock for cue jumps, seeks and loops. Between
packets the server advances beats at current BPM and playback seconds at the
current/base BPM ratio. Pause freezes both. If OSC disappears, extrapolation is
bounded to three seconds, then holds. This is a visual synchronization system,
not sample-accurate audio playback or a reconstruction of scratch trajectories.

## OSC v4 implementation

Based on the user-supplied `djay-pro-osc-specification-v4-2.pdf`, Document Version
4, 11 May 2026, builds 66135+. The saved TouchDesigner patch corroborated time,
beat, barPhase and crossfader addresses.

| Address | Interpretation |
| --- | --- |
| `/djay/mixer/turntable{3,4}/lineFader` | C → A now-playing card, D → B now-playing card; 0–0.5 slides and fades in artwork; 0.5–1 slides and fades in title and artist, keeping artwork fully visible. Lowering the fader reverses this sequence. The overlay has no label or background bubble. Once received, OSC faders override the automatic entrance and five-second timeout; raised cards stay visible until lowered or the track is unloaded. |
| `/djay/turntable{1,2}/song/{loaded,title,artist,album,duration,bpm,artworkAvailable}` | Deck metadata, duration in seconds, base BPM |
| `/djay/turntable{1,2}/playback/{playing,time,bpm}` | Transport, seconds and current tempo |
| `/djay/turntable{1,2}/playback/bar` | Integer bar, counting from 1 |
| `/djay/turntable{1,2}/playback/beat` | Integer beat inside bar, 1–4 |
| `/djay/turntable{1,2}/playback/phase` | Fraction inside current beat, 0–1 |
| `/djay/turntable{1,2}/playback/barPhase` | Position inside bar, 0–4 |
| `/djay/mixer/crossfader` | 0 = A, 0.5 = equal visual blend, 1 = B |

When barPhase is available it is authoritative over beat/phase. Octal escapes in
metadata are decoded for matching/display (`H\366r` → `Hör`); the OSC inspector
retains raw arguments. Unknown addresses, including line faders, EQ, stems, loops
and decks 3/4, are included in the bounded raw OSC view. They do not drive extra
scene decks in this two-deck version.

The receiver sends `/djay/request/dumpAll` no more than once a second. For each
loaded track with artwork, it sends `/djay/request/turntableN/artwork` with a
unique HTTP callback URL. djay POSTs JPEG bytes to that endpoint. Requests are
retried up to three times, and obsolete callbacks are rejected using deck
revision and request token. Artwork is stored in memory and served to the
frontend by revisioned URL. Optional `artwork` in an animation entry can point
to a local image used when no live artwork has arrived.

## Stream contract

Connect to `ws://127.0.0.1:3100/stream`.

1. `type: "catalog"`: animation IDs, asset URLs, durations and `nodeNames` in
   deterministic FBX traversal order. Sent on connection and library reload.
2. `type: "frame"`, `version: 1`: latest complete deck state, crossfader, animation
   choice/time, artwork URL and pose at 30 Hz. Includes sequence/serverTime,
   live/demo mode and diagnostic counters.
3. `type: "osc"`: bounded latest-value records `{address,args,at}`, at 2 Hz. This
   coalesces repeated OSC updates; it is not a lossless packet recorder. `at` and
   `serverTime` are process-monotonic seconds, not Unix timestamps.

Each deck's `pose.transforms[i]` is:

```text
[px, py, pz, qx, qy, qz, qw, sx, sy, sz]
```

These are **local FBX node transforms in the FBX's native units**, indexed by
`catalog.nodeNames`. Include every node, not only bones, to preserve parent/root
transforms and skinning. The frontend loads the same FBX once, checks node names,
wraps it in a group scaled by `animation.scale`, and applies streamed transforms.
It never runs its own AnimationMixer. Adjacent received poses are interpolated
for display; server playback remains authoritative.

`pose.worldPositions` contains `head`, `leftHand`, `rightHand`, `leftFoot`,
`rightFoot`, each `[x,y,z]` in **meters, right-handed, Y up**, after all ancestor
transforms and the configured FBX scale. Each deck has the same scene origin.
Missing named bones produce `null`, never made-up landmarks. These are skeleton
joint origins, not fingertip, skull-surface or foot-contact estimates, nor
real-world measurements of a dancer. Existing FBXs use Mixamo names; other rigs
need an explicit landmark-name adapter in `server/rig.js`.

Two independent scene render targets are combined with a linear visual
crossfade. Rendering uses a single WebGL context. OSC packets only update state;
pose sampling/broadcast is rate-limited. Slow WebSocket clients skip frames at
256 KiB buffered data rather than queueing an unbounded backlog. The inspector
is limited to 160 addresses. Asset imports parse FBX on the Node main thread;
preload required clips before performing, since a large import can briefly pause
stream processing. This is not a guarantee of long-session crash immunity.

## Validation — 22 October 2026

```sh
npm test
npm run test:integration
```

15 unit/FBX tests passed, covering v4 timing, looping, seek/pause/stale behavior,
matching, metadata invalidation, input validation and actual skeleton/world-space
reconstruction. One isolated integration test passed through real UDP bundles,
WebSocket output, malformed packets, artwork POST/retrieval, stale callback
rejection, seven track mappings, preview isolation and cross-origin write rejection. The HTTP test uses transport fixture
bytes; actual JPEG display was separately verified with live djay.

Live verification: djay sent `Downtown` / `Linds, Linds` at 150 BPM on deck A and
`WACH` / `GEORGE RADSPORT; Cravings320` on deck B; both album JPEGs arrived through
the documented OSC-request/HTTP-POST flow. No invalid packets or dropped frames
were observed during the check. Browser preview verified both character rigs,
scene crossfade, live/demo separation and no browser console errors. Full-track
alignment with a real matching audio recording remains to be calibrated.

`xyzcalling` was fast-forwarded to `6c6218d`; this app references those files in
place. It does not duplicate or convert the FBXs or redistribute their licenses.

Implementation references: [Three.js FBXLoader](https://threejs.org/docs/pages/FBXLoader.html),
[AnimationMixer](https://threejs.org/docs/pages/AnimationMixer.html),
[WebGLRenderTarget](https://threejs.org/docs/pages/WebGLRenderTarget.html).

## Track scenes and independent preview

Seven source-video edits are now mapped: Real House Dancing, Rumble, Wide Open,
Freestyler, Ready, First Of The Year, and Gal a Bubble. Tagged MP3s and an M3U
playlist live on the external SSD at:

`/Volumes/T7-2tb-2509/Projects/amsterdam-hackathon/Audio/Motion Stage`

Use these source-video edits for testing: they preserve the captured timeline,
including intros/outros. Commercial album/radio versions can have different
arrangements. `reports/track-audio.json` records download status, source URLs,
audio tags and durations. `reports/track-mapping-verification.json` records
successful synthetic OSC matching against those tags and actual loaded FBXs.

**Animation library → Preview & edit scene** opens an independent preview. It
has play/pause, seek, BPM, optional source audio and a JavaScript editor. Preview
uses its own WebSocket transport; it does not change the live deck state or fader.
Audio playback re-anchors the preview timeline. Preview BPM is an adjustable
visual clock, not an analyzed beatgrid; live performance uses djay's beatgrid.

Each track has exactly one editable scene module:

| Track | Scene file |
| --- | --- |
| Real House Dancing | `public/scenes/real-house.js` |
| Rumble | `public/scenes/rumble.js` |
| Wide Open | `public/scenes/wide-open.js` |
| Freestyler | `public/scenes/freestyler.js` |
| Ready | `public/scenes/ready.js` |
| First Of The Year | `public/scenes/first-of-year.js` |
| Gal a Bubble | `public/scenes/gal-a-bubble.js` |

Edit on disk, then click **Reload file**, or edit in the preview and click
**Save scene**. Saves write that exact module and reload it in connected viewers,
including live output. `public/renderer.js` supplies the character, lighting,
anchor markers, and crossfade. A scene exports `createScene({THREE,group,camera})`
and returns `{color,wireframe,update(deck,deltaSeconds),dispose()}`. Put custom
objects in `group`; use `deck.pose.worldPositions` to attach effects to the body,
and `deck.beat`/`deck.bpm` for musical effects. Group resources are cleaned up on
scene switches. The boilerplate has commented examples. A broken scene reports
its error in the preview; fix it and save again.

Fallback A uses the new mannequin from Real House Dancing, seconds 12.4–16;
fallback B uses the new mannequin from Ready, seconds 25.2–28.8. Both run over two
bars and blend the last 12% toward the start pose. Endpoints were selected by
comparing joint positions; the blend removes the pose discontinuity but is not
foot-contact correction or a guarantee of a perfect dance cycle. `trimStart`,
`trimEnd`, `bars`, and `loopBlendFraction` remain editable in routing JSON.

### Live character retargeting

The Character picker on each live deck now selects the backend output rig. Choices
are Chicken Dance, the two Ch20 exports, and Original FBX character. Live choices
are saved in `config.local.json` under `deckCharacters`. Scene Lab has its own
independent picker; switching it does not affect live decks or transport.

The backend samples the source clip, transfers bind-relative world rotations in capture coordinates to
the target bones, preserves target bone lengths and source root displacement,
and recomputes the five world anchors on the target. Frames identify the target
with `animation.characterId`; the WebSocket catalog includes its URL, node order
and scale in `characters`. The frontend loads that model and applies streamed
local transforms. It does not run a separate animation mixer or retarget solver.
Mixamo prefixes including `mixamorig6` are normalized for matching. The target's
own baked dance clips are ignored. Select Original FBX character to compare the
source, including any extraction/baking defects; changing the skin cannot repair
missing or incorrect source motion.

The user-supplied Ch20 files live on the mounted SSD at
`/Volumes/T7-2tb-2509/Projects/amsterdam-hackathon/Characters`, linked from
`motion-stage/characters`. Both versions contain the same Ch20 mesh and 65-bone
rig; `Ch20_nonPBR.fbx` also contains two clips, while `character.fbx` contains none.

Retargeting regression checks compare the output rotations with samples from the
original GVHMR `.npz` inference data. Do not apply an additional rest-facing yaw
to these baked rotation deltas: their coordinate conversion was already baked.

## Scene sliders and MIDI

The live deck cards and Scene Lab have a **Scene parameters** slider panel. All
scenes expose `characterOpacity` (0–1). Rumble adds red particles emitted at both
hands over a pure black background; hiding the character leaves the particles
visible. Rate, size, lifetime and speed have their own sliders. Reset restores
that scene's defaults. Values are held per deck and scene until backend restart.
Scene Lab parameters are private to its WebSocket session (reset on reconnect).

Declare numeric controls in `public/parameters.js`; scenes read `deck.params` in
`update(deck, deltaSeconds)`. Frames include `deck.scene`, `deck.params`, and
`deck.sceneParams`. The live scene selector is backend-owned, so MIDI follows the
selected scene and other browser clients see the same selection and values.

Connect MIDI in the parameter panel using a Web MIDI capable browser (Chrome or
Edge). Select Connect MIDI on each live deck you want to control. Channel 1 controls
A; channel 2 controls B. Scene Lab listens to channel 1 and affects its preview only.
Devices connected after enabling MIDI are picked up automatically.

| MIDI CC | Parameter | Range |
| --- | --- | --- |
| 20 | Character opacity | 0–1 |
| 21 | Rumble particles / second / hand | 0–800 |
| 22 | Rumble particle size | 0.005–0.15 |
| 23 | Rumble lifetime, seconds | 0.1–4 |
| 24 | Rumble speed, meters / second | 0–3 |

CC values 0–127 map linearly onto the range. Other channels, unmapped CCs and
non-CC MIDI messages are ignored. The backend accepts MIDI bytes through HTTP,
WebSocket, or OSC; direct hardware access is provided by the browser MIDI bridge.
Enable a hardware input in one browser client to avoid duplicate forwarding.

Backend control examples (JSON, `Content-Type: application/json`):

```text
GET /api/params?deck=1&scene=rumble
POST /api/params  {"deck":1,"scene":"rumble","params":{"characterOpacity":0.35,"particleRate":400}}
POST /api/params  {"deck":1,"scene":"rumble","reset":true}
POST /api/scene   {"deck":1,"scene":"rumble"}
POST /api/scene   {"deck":1,"scene":"auto"}
POST /api/midi    {"data":[176,20,64]}
```

`scene` can be omitted on parameter updates to target the active scene. Invalid
names/non-finite values reject the entire update; valid numeric values are clamped.
On `/stream`, send the same objects with `type: "params"`, `"scene"`, or `"midi"`.
Preview sockets accept parameter and MIDI commands in their own session. Errors
return `type: "control-error"`. The next pose frame carries the updated values.
On the existing OSC port, `/motion/deck/1/param/characterOpacity` with one float
updates the active scene; `/motion/midi` accepts the three integer MIDI bytes.
These routes work independently of the live/demo transport selection.

## Deck C/D EQ control over OSC

Incoming djay EQ messages on the existing OSC port control the live stage directly:
C (turntable 3) controls A; D (turntable 4) controls B. No browser MIDI connection is
needed. The live parameter panel displays the received EQ values and mappings.

| C/D EQ | A/B parameter | Rumble range |
| --- | --- | --- |
| Low | Character opacity | 0–1 |
| Mid | Particle rate per hand | 0–800 |
| High | Particle speed | 0–3 m/s |

Addresses are `/djay/mixer/turntable3/eq/low`, `/eq/mid`, `/eq/high`, and the
same paths with `turntable4`. Confirmed incoming values are -1..+1: fully down
maps to the parameter minimum, center to its midpoint, fully up to its maximum.
Gain, filter, channel faders, and A/B EQ are not mapped.

The routing follows the active A/B scenes, including scene overrides. Opacity
works in every scene; mid/high only apply to scenes declaring particle rate/speed.
Received EQ positions are retained and applied when changing scene. Manual sliders
and MIDI still work: repeated unchanged EQ packets do not overwrite them, but the
next knob movement takes control again. Independent Scene Lab previews are unaffected.

## First of the Year: RGB dancefloor

The `first-of-year` scene now scrolls a disco tile floor beneath the centered
character and emits expanding RGB rings at detected footfalls. Open
`/preview.html?animation=first-of-year` in Scene Lab, or use the existing track
assignment in live output. The scene uses `animation.time`, so cue jumps, pauses,
track offsets and tempo changes stay on the sampled animation timeline.

The in-place FBX has no horizontal hip travel. The scene restores the original
NPZ's X/Z trajectory using the bake's heading alignment and translation scale.
Impacts remain fixed to the floor as the character travels. Contact timing and
positions are precomputed from the lower ankle/toe bone on each available rig:
3.5 cm contact band, 7.5 cm release band, and 180 ms minimum retrigger interval.
A smoothed three-second lower envelope estimates the floor without pinning jumps.
These are mocap contact estimates, not foot locking. Live ankle anchors add soft
contact light below the feet. Calibration includes the original FBX and all three
selectable character exports; no server or OSC changes are required.

Edit `public/scenes/first-of-year.js` to change tile size, wave speed, lighting or
colors. Supporting motion/contact data is generated in
`public/scenes/data/first-of-year.js`. After replacing the capture or character
rigs, regenerate it with `python3 scripts/prepare-first-of-year.py` (NumPy and the
local npm dependencies required), then refresh Scene Lab. Run
`node --test test/disco.test.js` for contact, trajectory, pause and seek checks.

First of the Year exposes **Character opacity** (CC 20 / C or D low EQ) and
**Character instances** (CC 21 / C or D mid EQ). Instance count is an integer
from 1 to 6; EQ maps −1 to one and +1 to six. All copies use the same streamed
pose and opacity, with independent skeletons and matching floor ripples. Rumble's
mid mapping remains particle rate. The preview sliders affect only Scene Lab;
live C controls deck A and D controls deck B.

First of the Year's **Camera rotation (°/s)** slider / MIDI CC 24 / C or D high EQ
orbits around the center of the dancers: center (0) stops, minimum rotates left
at −60°/s, and maximum rotates right at +60°/s. Speed changes preserve the current
angle. The orbit uses elapsed display time, including while the dance is paused;
centering high holds the view. Framing adapts to the instance count, and leaving
the scene restores the previous camera.

## Gal a Bubble · light cones

The camera follows the rendered hips. Each hand and foot emits two opposing
screen-space cones aligned with its animated forearm or lower leg. Screen blending
combines the colors with the image underneath; overlaps form an abstract light
composition. Character opacity can reach zero while the cones keep moving.

| Slider | MIDI CC | C/D EQ | Range |
| --- | --- | --- | --- |
| Character opacity | 20 | Low | 0–1 |
| Cone colors (palette hue) | 21 | Mid | 0–1 |
| Cone intensity | 22 | High | 0–2 |

C controls live deck A and D controls B. Scene Lab controls remain independent.
Intensity zero removes the cones. Camera framing is restored on scene exit.

### What Else Is There? · animated sphere grid

The `real-house` scene (Real House Dancing) places solid mint spheres at both
hands, feet, elbows and the head. Mid unfolds their 49 copies into a 7×7 grid.
Each grid sphere retains its joint's full movement relative to the first valid
pose after loading the scene/character; seeking and knob changes keep that reference.
Low controls only character opacity, and High controls sphere radius (0.015–0.22 m).
These controls use MIDI CC 20/21/22 and the existing C→A / D→B low/mid/high EQ routing.
The Scene Lab sliders control its independent preview; hardware EQ controls live decks.
