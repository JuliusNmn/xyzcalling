# Pose Studio

A TypeScript dashboard for MediaPipe Pose Landmarker, with a local video library,
live skeleton/landmark overlays, playback and confidence controls, and JSON export
of the current frame. MediaPipe's full model, JavaScript, and WASM are served
locally. Inference runs in the viewer's browser; no external inference service is used.

## Run

Requires Node.js 22.12+.

```sh
npm install
npm run setup
npm run build
npm start
```

The server automatically binds to the first active ZeroTier IPv4 address reported
by `/usr/local/bin/zerotier-cli`. On this machine the URL is
**http://10.244.196.67:3000**. If ZeroTier is unavailable it binds to loopback.
You can explicitly choose an address and port:

```sh
HOST=127.0.0.1 PORT=3000 npm start
```

For development, run `npm run dev` to use Vite middleware with live reload.

## Video library

Put files in `videos/`, then press the library's refresh button. Click any entry
to load it, and press play in the video player. MP4, WebM, MOV, M4V, and OGV files
are listed; codec support varies by browser. Use H.264 video and AAC audio in an
MP4 container for the widest compatibility. The supplied video is a directly
downloaded 1080p H.264/AAC MP4. Set `VIDEO_DIR` to serve a different directory.

Processing frames are downscaled to at most 960 pixels wide, with a maximum of
25 inference calls per second. Actual throughput depends on the browser/device.
GPU inference is preferred, with CPU fallback. The model resets after seeking
or switching videos. Landmarks use normalized image coordinates; world landmarks
are in meters relative to the hip midpoint. Pose array indices are not stable IDs.
The minimum visibility slider only filters the overlay. Export captures the most
recent analyzed frame and includes its video timestamp.

## Keep it running on macOS

```sh
npm run service:install
npm run service:status
npm run service:stop
```

The user LaunchAgent `local.pose-studio` runs independently of the terminal,
restarts after crashes, and starts at login. Logs are in `logs/`. After rebuilding,
run `npm run service:install` to restart with the new build. The machine must be
awake and connected to ZeroTier for other members of the network to reach it.
The service waits and retries if the ZeroTier interface is unavailable at login.
The server exposes the video library to that network without an additional login.
To remove the service permanently, stop it and remove
`~/Library/LaunchAgents/local.pose-studio.plist`.

## Python extraction

The earlier offline extractor still works with the video's new location:

```sh
uv run --python 3.12 pose_landmarker.py
```

Reference: [MediaPipe Pose Landmarker for Web](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker/web_js).
