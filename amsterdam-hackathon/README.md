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
