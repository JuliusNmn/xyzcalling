# Motion Studio — live visuals and animation workflow

Motion Studio is the live djay-to-Three.js app called **Motion Stage** in this repository. **Scene Lab** edits its visual scenes. **Pose Studio**, in the sibling `xyzcalling` repository, previews captured motion and exports full animations or loops. The Windows **GVHMR** pipeline creates new motion captures from video.

## 1. Run Motion Studio

Use Node.js **22.12 or newer** for both applications. Keep the two repositories beside each other so the default animation paths resolve:

```text
projects/
├── amsterdam-hackathon/
│   └── motion-stage/
└── xyzcalling/
    └── videos/
```

The `amsterdam-hackathon/` folder bundled inside `xyzcalling` is an older snapshot; start the live app from the sibling repository shown above.

From `amsterdam-hackathon`:

```sh
cd motion-stage
npm ci
npm start
```

Open **[Motion Studio](http://127.0.0.1:3100)**. Leave the terminal running; `Ctrl+C` stops it. On later launches, `npm start` is enough unless dependencies changed.

In djay's Advanced OSC settings, set:

| Setting | Value for both apps on the same machine |
| --- | --- |
| OSC target IP | `127.0.0.1` |
| OSC target port | `10003` |
| Incoming/request port | `10001` |

Select **Live OSC**, load a track, and check **Signal monitor**. If necessary, click **Request full djay state**. The crossfader follows djay. **Try demo** lets you test without djay; return to **Live OSC** for real deck input.

Animation FBXs must exist at the configured paths. The supplied source-edit audio and artwork are on `/Volumes/T7-2tb-2509/Projects/amsterdam-hackathon/Audio/Motion Stage`; mount that SSD for previews with audio. On another computer, update those paths. Missing optional audio/artwork does not supply a replacement soundtrack.

For network use, configure reachable `httpHost`, `oscHost`, `djayHost`, and `callbackBaseUrl` values in `motion-stage/config.local.json`; `127.0.0.1` only reaches the same computer. Restart after changing bind addresses or ports.

### Map a track to an animation and Scene Lab preset

The routing is:

```text
djay artist + title → animation entry → FBX file + scene ID
unmapped track     → that deck's fallback animation + scene ID
```

In **Animation library**:

1. Find the animation, or use **From Pose Studio** to import an FBX from `xyzcalling/videos/`.
2. Set **Playback mode** to **Full track · seconds**.
3. Enter **Exact artist** and **Track titles**, one accepted title per line. Copy the metadata received from djay in Signal monitor.
4. Pick the **Scene** preset and set **Track offset in seconds** if needed.
5. Click **Save assignment**. On the live deck, select **Automatic scene** to use the saved mapping.

Matching ignores case and surrounding whitespace and normalizes Unicode. Artist and title must otherwise match; a title alone is insufficient. No match, or multiple matching entries, selects the deck's fallback. A deck's manual scene selection overrides the mapped scene until you return to **Automatic scene**.

### Edit the animation file and mapping in JSON

Open the routing JSON editor from Settings. Change an entry's `file` to replace its animation. Paths are relative to **`motion-stage/`**, even if you launched Node from another directory; absolute paths also work.

For example, this is an entry inside the `animations` array, not an entire configuration file:

```json
{
  "id": "rumble",
  "name": "Rumble",
  "file": "../../xyzcalling/videos/Skrillex Fred Again.. Flowdan Rumble.gvhmr.fbx",
  "mode": "track",
  "scale": 0.01,
  "scene": "rumble",
  "offsetSeconds": 0,
  "match": {
    "artist": "Skrillex, Fred again.. & Flowdan",
    "titles": ["Rumble", "Flowdan Rumble"]
  }
}
```

`scene: "rumble"` loads `motion-stage/public/scenes/rumble.js`. `scale: 0.01` is the current FBX-to-meter scale. Track animations sample **djay playback time + offsetSeconds**: a positive offset starts farther into the animation. They hold at the endpoints rather than looping. Use the same audio edit as the source video; an album or radio edit can have different timing.

| File | What it controls |
| --- | --- |
| `motion-stage/config.json` | Shared, checked-in defaults: mappings, FBX paths, fallbacks and network settings |
| `motion-stage/config.local.json` | Machine-local overrides written by the UI; ignored by Git |
| `motion-stage/public/scenes/<scene-id>.js` | The scene code edited by Scene Lab |
| `motion-stage/public/scenes/registry.js` | Scene IDs and names in dropdowns |
| `motion-stage/public/parameters.js` | Slider definitions, ranges, defaults and MIDI CC mappings |

Local settings replace defaults **at the top level**: a local `animations` array replaces the entire default array. If edits to `config.json` appear to do nothing, check `config.local.json`. To share a mapping, copy the intended entries into the checked-in defaults and review machine-specific asset paths before committing.

UI saves validate/load the library and apply it immediately. Restart after editing configuration on disk. If replacing an FBX at the same path, restart too: the backend caches loaded models by path. A UI save requires all configured animations to load successfully.

### Edit Scene Lab presets

Click **Preview & edit scene** on an animation card, or open [Scene Lab for Rumble](http://127.0.0.1:3100/preview.html?animation=rumble).

Scene Lab has an independent playhead, BPM control and character picker. Edit the JavaScript and click **Save scene**, or edit its file on disk and click **Reload file**. **Save scene writes the real file and reloads it in connected live viewers**, even though preview playback itself is independent.

The current track scene IDs are `real-house`, `rumble`, `wide-open`, `freestyler`, `ready`, `first-of-year`, and `gal-a-bubble`. The general presets are `cyan` (Mint studio), `amber` (Amber room), and `violet` (Violet wireframe).

To add a preset, create `public/scenes/<new-id>.js`, add its ID/name to `public/scenes/registry.js`, then assign that ID to an animation. Follow an existing module's `createScene({THREE, group, camera})` interface. Refresh the browser after changing the registry.

Use **Scene parameters** for live adjustments. Rumble exposes hand-particle rate, size, lifetime and speed; every scene has character opacity. Slider values are temporary: live values reset on backend restart, and Scene Lab values reset on reconnect. Change defaults in `public/parameters.js` to persist them in code.

The latest OSC controls map deck C's low/mid/high EQ to deck A's character opacity/particle rate/particle speed; deck D controls B. Particle controls apply to scenes that define them. Scene Lab preview parameters remain independent.

### Where to put looping animations

Put exported loop FBXs directly in **`xyzcalling/videos/`**, the default import directory. They can have ordinary names such as `my-house-loop.fbx`. Refresh Motion Studio and import through **From Pose Studio**. Importing initially creates a **four-bar fallback**; change the bar count to the actual musical length.

Set **Playback mode → Fallback · musical loop**, choose its scene, **Save assignment**, then click **Fallback A** and/or **Fallback B**. The `fallbacks` object stores those animation IDs:

```json
"fallbacks": {
  "1": "my-house-loop",
  "2": "fallback-ready"
}
```

For a full exported loop, omit `trimStart` and `trimEnd`. Alternatively, reuse part of a full capture without exporting another FBX. This existing fallback entry demonstrates the fields:

```json
{
  "id": "fallback-house",
  "name": "Mannequin · House loop",
  "file": "../../xyzcalling/videos/Real House Dancing.gvhmr.fbx",
  "mode": "fallback",
  "bars": 2,
  "scale": 0.01,
  "scene": "cyan",
  "trimStart": 12.4,
  "trimEnd": 16,
  "loopBlendFraction": 0.12
}
```

Trim values are seconds in the original FBX; `trimEnd` must not exceed its duration. The selected range stretches to `bars × 4` beats at djay's current tempo. `loopBlendFraction: 0.12` blends the last 12% toward the starting pose; use matching endpoints for a cleaner cycle. The blend is not foot locking.

You can choose another import folder with `assetDirectory`. Discovery only scans that folder's top level, not subfolders. An animation may also reference a file anywhere through its explicit `file` path. Copy a browser-downloaded loop into the library yourself; downloading does not install it in Motion Studio.

## 2. Launch the animation viewer and loop extractor

Both are part of **Pose Studio** in `xyzcalling`. In a separate terminal, from that repository's root:

```sh
npm ci
npm run setup
npm run build
npm start
```

`setup` downloads the browser pose model. Subsequent launches only need `npm start`; rebuild after changing the app. Development mode is `npm run dev`.

Open the URL printed by the server, normally port **3000**. On the configured Mac it automatically chooses the active ZeroTier address when available; otherwise it uses loopback. To explicitly use [localhost](http://127.0.0.1:3000):

```sh
HOST=127.0.0.1 PORT=3000 npm start
```

On Windows PowerShell, set environment variables separately:

```powershell
$env:HOST = '127.0.0.1'
$env:PORT = '3000'
npm start
```

### View an animation

1. Put the source video in `xyzcalling/videos/` and refresh the video library.
2. Select the video and a **Character FBX**. Play, seek or change playback speed in the shared preview.
3. Choose the **Animation** source: Custom, Kalidokit or GVHMR. Saved GVHMR requires matching `.gvhmr.json` metadata and `.gvhmr.fbx` beside the video.

**Open local video** previews a browser-only file without uploading it; that selection disappears on reload. For the shared saved-GVHMR workflow, use the server's video library.

If title-named FBXs arrived from another machine without matching metadata, run:

```sh
npm run import:gvhmr
```

This requires FFmpeg's `ffprobe` on PATH. It links only unambiguous filename/title matches with compatible animation durations and preserves existing metadata. Check its report, then refresh the library.

### Extract a loop

1. Select the video, character and animation source.
2. Click **Select a loop** and enter start/end seconds, or choose detected bars when beat analysis is available.
3. Click **Play selection** with **Repeat** enabled to check the seam.
4. Click **Use this loop**, then **Download FBX** on the main page.
5. Copy the downloaded FBX into `xyzcalling/videos/`, then import and assign it as a fallback in Motion Studio as described above.

**Use full video** restores full-length export. Pose Studio does not automatically blend loop seams. For bar selection, generate beat/waveform sidecars first (requires `uv` and FFmpeg):

```sh
npm run analyze:audio
```

Then click **Reload beats**. Audio analysis is optional for manually timed excerpts and full-video exports.

FBX conversion requires Blender on the Pose Studio server. On macOS it detects `/Applications/Blender.app`; elsewhere use `blender` on PATH or `BLENDER_BIN`. A Windows machine already set up for GVHMR can reuse its Blender:

```powershell
$env:BLENDER_BIN = (Resolve-Path './artifacts/blender/blender-4.2.0-windows-x64/blender.exe').Path
npm start
```

Browser exports are limited to ten minutes. Selecting saved GVHMR uses the existing capture; it does not start a new CUDA extraction.

## 3. Add new animations on the Windows machine with GVHMR

Run these commands from the **`xyzcalling` repository root**. GVHMR is the offline NVIDIA/CUDA workflow; it does not need Motion Studio running.

### One-time setup

Requirements: Git, `uv`, an NVIDIA CUDA-capable GPU/driver, and the licensed **SMPL-X v1.1 neutral model** (`SMPLX_NEUTRAL.npz`). The existing workflow was tested with an RTX 3080 with 12 GB VRAM. Allow about 14 GB for the environment/models plus video and processing space.

```powershell
./scripts/setup-gvhmr.ps1 -SmplxModel 'C:/path/to/SMPLX_NEUTRAL.npz'
```

Replace the example path with your downloaded model. Setup installs the pinned Python/CUDA dependencies, public checkpoints and Blender under ignored `artifacts/`. It copies the supplied licensed model; it does not obtain that model for you. See [the detailed GVHMR guide](https://github.com/JuliusNmn/xyzcalling/blob/main/docs/gvhmr.md) for setup and model-source details.

### Process a new source

Copy an MP4 into `videos/`, then run:

```powershell
./artifacts/gvhmr-env/Scripts/python.exe scripts/gvhmr_extract.py --video 'videos/My Dance.mp4'
```

To process all MP4s in `videos/`:

```powershell
./artifacts/gvhmr-env/Scripts/python.exe scripts/gvhmr_extract.py
```

An explicit run regenerates final sidecars; the all-video command is not limited to new files. Processing caches are reused. Useful options:

| Option | Use |
| --- | --- |
| `--batch-size 2` | Reduce the default batch size of four if GPU memory is tight |
| `--static-camera` | Only when the source camera is actually fixed |
| `--root-motion travel` | Keep the estimated trajectory instead of the default centered motion |
| `--force-predict` | Rerun neural inference while reusing preprocessing caches |

For `My Dance.mp4`, expect these outputs beside the video:

```text
videos/My Dance.gvhmr.fbx              # Animated neutral Mixamo-named character
videos/My Dance.gvhmr.npz              # Original inferred motion and trajectory
videos/My Dance.gvhmr.json             # Source/timing/processing metadata
videos/My Dance.gvhmr.validation.json  # FBX round-trip validation report
```

Wait for successful completion and inspect the validation report. The default FBX centers horizontal hip motion while retaining turns and correcting slow vertical drift. Use `--root-motion travel` when you need locomotion. The NPZ retains the original trajectory in either mode.

### Bring the result back into the project

Transfer the source video and all four outputs to the playback machine's `xyzcalling/videos/`, keeping their basenames together. The original video is needed for Pose Studio's synchronized viewer; Motion Studio itself only needs the referenced FBX.

The repository tracks GVHMR output suffixes, while most source videos and all `artifacts/` contents are ignored. If sharing through Git, stage the specific output files, review their sizes/diff, then commit and push through your normal workflow. Transfer ignored source videos separately. Keep CUDA environments, caches and licensed model files in `artifacts/`.

Refresh Pose Studio and verify the saved animation against its video. If filenames differ, run `npm run import:gvhmr` and check its report. Then refresh Motion Studio, import the FBX, and either map it to exact track metadata or extract a loop and assign a fallback.

## Troubleshooting and further notes

| Symptom | Check |
| --- | --- |
| Motion Studio shows no live data | djay targets UDP `10003`; select Live OSC and request a full state dump |
| A track always uses the fallback | Exact artist/title, duplicate mappings, FBX availability and local config overrides |
| A different scene appears | Set the live deck to Automatic scene |
| A new FBX is missing from the import list | Correct `assetDirectory`, top-level `.fbx` file, then refresh the page |
| An FBX replacement still looks old | Restart Motion Studio to clear its file-path cache |
| A library save fails | Every configured FBX must load; inspect missing paths and trim ranges |
| Scene Lab has no audio | Mount the SSD or update the entry's `audio` path |
| Pose Studio has no GVHMR option | Source video, matching metadata/FBX, import report, then refresh the library |
| FBX download fails | Blender is installed on the server and `BLENDER_BIN` points to it |

See [Motion Stage's technical README](motion-stage/README.md) for the stream, scene and OSC interfaces, and [Pose Studio's README](https://github.com/JuliusNmn/xyzcalling/blob/main/README.md) for the viewer.

Documentation checked on 22 October 2026 against the Motion Stage app, scene parameter and OSC control commits (`95123ee`, `4e0631d`, `5f79898`) and Pose Studio `6c6218d`. This repository also includes the First of the Year dancefloor in `619da5e`; see the Motion Stage technical README for its scene details.


<details>
<summary>Earlier TouchDesigner setup and investigation notes (historical)</summary>

These notes preserve the earlier prototype investigation. Use the workflow above for the current Motion Studio setup.

# Amsterdam Hackathon

Started20October2026. Main goal: connect djay Pro TestFlight's live deck data to TouchDesigner visuals, retaining musical timing and track identity where actually available.

## Project Files And Setup

Body-animation prototype: see [MediaPipe to Mixamo baking pilot](mocap/README.md).

- `TD.toe`: main TouchDesigner patch. Save the current working patch here for version control.
- `Geo/`: scene assets, including the Chicken Dance FBX and its textures. Third-party assets retain their original licensing; this repository grants no redistribution rights.
- `osc_song_listener.py`: standalone OSC song-metadata listener.
- `osc_song_state_callbacks.py` and `osc_metadata_callbacks.py`: TouchDesigner callback scripts.
- Local virtual environments, import caches and automatic backups are excluded from Git, not deleted.

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python -m unittest -v
```

Tests include a local UDP socket test; permit loopback access when prompted. The observations below are dated development notes, not guarantees about the current live patch.

## Observed Setup

### Python Song Listener - 20 October

Local `.venv` created with Python3.14.7 and `python-osc==1.10.2` installed from PyPI. No other dependencies or model downloads. `osc_song_listener.py` exposes `print_song_message(address, *args)` and `listen_for_song_messages(host, port, deck)`.

```sh
cd /Users/moritzcarlonaeumann/2026-Calendar/projects/amsterdam-hackathon
.venv/bin/python osc_song_listener.py --port 10002
# Or restrict output to the addresses for deck1:
.venv/bin/python osc_song_listener.py --port 10002 --deck 1
```

Set djay's OSC Target IP127.0.0.1 and Target Port10002 to match. Default10002 avoids competing with the previously observed TD receiver on10000. This listener does not forward to TD or change djay settings. To use10000 instead, first stop TD's receiver on that port, then use `--port 10000`. Ctrl+C stops the listener. No persistent service or automatically running listener installed.

Prints exactly the user-supplied Document Version4 song fields: loaded, duration, title, artist, album, genre, artworkAvailable, key, bpm. Default all deck prefixes; `--deck 1` restricts to turntable1. Prints every received matching event without deduplication. Arguments are JSON-escaped for safe display and exact string preservation; literal special-character escape sequences are not decoded because their full encoding specification was not supplied. The provided field list does not include a unique track ID.

Tests: `.venv/bin/python -m unittest -v test_osc_song_listener.py`. Covers field/deck routing, ignored controls, string/argument preservation, actual local UDP receive and duplicate-port rejection. Synthetic UDP reception is not proof of live djay metadata reception.

- djay Pro TestFlight app identifier: `com.algoriddim.djay-iphone-free-adhoc`.
- Advanced settings UI shows OSC output to `127.0.0.1:10000`, receiving on10001; snapshot reports1152sent messages/second. This is app-reported activity, not a decoded packet inventory.
- User confirms an OSC In CHOP receives live data. TouchDesigner2025.31550 has a UDP socket on10000. Existing unsaved patch: `/Users/moritzcarlonaeumann/Desktop/2026TDProjects/2026TDProjects.54.toe`.
- Existing OSC In DAT `oscin2` is visible in `/project1/scenes/sceneTemplate3`, initially showing only its message header. Its Connect settings have not been inspected successfully; no claim that its port/filter is correct. UI actions failed with `noWindowsAvailable`; no patch saved/changed by this inspection.
- No confirmed title/artist/track-ID OSC address or actual decoded metadata message yet. Do not invent these paths or equate a deck index to recording identity.

## Receive And Inspect Metadata

### Hold Latest Values Rather Than A Scrolling Message Log

Confirmed by user's20October screenshot: actual OSC messages include deck1album/artist/title/artworkAvailable/duration/loaded/bpm and deck2key. Literal title escape `H\366r` observed; BPM updates0,0,93 are genuine separate received values. These are observed names/values, not a complete beta schema or stable current-track identity.

Create an EMPTY Table DAT called `song_state` next to the OSC In DAT. Put the function from `osc_song_state_callbacks.py` in that OSC In DAT's Callbacks DAT. It upserts by full OSC address: one row per address, latest value replaces the previous value. Multiple decks and fields remain separate; no wiring between the Table DAT and OSC In DAT is required. Reload a track after installing the callback because messages already discarded by the receiver cannot be recovered automatically.

Read title in a Text TOP's Python expression: `op('song_state')['/djay/turntable1/song/title', 'value'].val`. Only use after that row exists; before the first message, use a conditional empty-string fallback. Callback preserves literal escape sequences and numeric zeroes. This simple cache stores latest field values, not a synchronized complete-song snapshot or history. An unloaded deck may retain old fields; check its `loaded` row before displaying them. No live TD installation performed by creating these files.

1. Keep the working OSC In CHOP for live numeric controls.
2. In OSC In DAT, set Protocol Messaging(UDP), Port10000, Active On, OSC Address Scope `*`. For same-Mac traffic, Local Address127.0.0.1 is appropriate. Split Bundle into Messages On and Split Message into Columns On improve inspection. Match the sender's destination, not its10001 listen port.
3. Load/reload a track in djay while receiving, as metadata might be emitted only on change. Keep a bounded message table; frequent control updates may otherwise push rare metadata out immediately.
4. Identify actual observed address/argument pairs for each deck. Distinguish artist/title text, source-specific track IDs, internal library title IDs and session/history IDs. Absence in a short capture is not proof the beta never sends metadata.
5. Keep long numeric/string identifiers as strings, not CHOP floats: precision may be lost if converted to numeric control channels.

For a metadata-only table after initial discovery, optionally use `osc_metadata_callbacks.py` in a separate OSC In DAT's callbacks. It retains likely metadata addresses OR string-valued messages, with explicit limits. It is a discovery heuristic, not a verified djay schema. It has not been installed into the live patch. Create a sibling Table DAT called `osc_metadata_latest` first; inspect its rows after loading a track. A retained value may be stale after a track change if the sender does not emit a replacement; it is not automatically a current-deck cache.

## Read-Only Local Fallback

Found `/Users/moritzcarlonaeumann/Music/djay/djay Media Library (Development).djayMediaLibrary/NowPlaying.txt`.

Inspection read title `8kmh (feat. CRO & Haftbefehl)`, artist `Psaiko.Dino/CRO/Haftbefehl`, album `#hangster`, time03:17. This text identifies what the file reported at inspection, not both deck states, continuous updates, or a unique track ID. Current file has no explicit ID. Do not edit it.

Adjacent `MediaLibrary.db` exists and was opened with sqlite3 `-readonly` only for schema inspection. Any future identity lookup must preserve WAL consistency and use exact version-aware source mappings; no library writes or new dependency installation.

Passive packet capture on loopback/UDP10000 was attempted with noninteractive sudo but blocked by administrator authentication. No capture obtained and no password requested. No separate UDP listener was bound to10000, avoiding interference with TD.

## Next Milestone

Record real OSC addresses and value types, prove one track-change metadata event, then connect one reliable deck/timing signal to one visual parameter. Keep the scope small before adding artwork, lyrics, section maps or beat-analysis lookup. No new models, audio extraction, native library writes, project migration or delegation started.

Bulky recordings/assets belong on mounted `/Volumes/T7-2tb-2509`; this SSD was safely ejected earlier. Do not create a local substitute under `/Volumes` while disconnected. Existing TD patch remains at its original path.

Sources: [OSC In DAT](https://derivative.ca/UserGuide/OSC_In_DAT), [OSC In DAT callbacks](https://derivative.ca/UserGuide/OscinDAT_Class), [Network Protocols](https://derivative.ca/UserGuide/Network_Protocols), [djay-connect format research](https://github.com/chrisle/djay-connect). Public djay OSC beta metadata schema was not found; older discussions do not override the observed beta settings.

## Motion Stage browser app

The standalone djay OSC → FBX pose stream → Three.js app is in
[`motion-stage/`](motion-stage/README.md). Start with `cd motion-stage && npm ci && npm start`.
Open http://127.0.0.1:3100 and send djay OSC to 127.0.0.1:10003.
It includes album-art callbacks, per-track scenes, bar-synced fallback clips,
world-space hand/head/foot positions, a crossfader and an isolated demo mode.

</details>
