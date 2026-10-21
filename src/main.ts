import { FilesetResolver, PoseLandmarker, type PoseLandmarkerResult, type NormalizedLandmark } from '@mediapipe/tasks-vision';
import './style.css';
import type { CharacterView } from './character-view';
import { AudioTimeline } from './audio-timeline';
import { DEFAULT_SETTINGS } from './rig/solvers';

type VideoEntry = { name: string; title: string; url: string; bytes: number; browserOnly?: boolean; analysisUrl?: string };
const icon = (name: string) => {
  const paths: Record<string, string> = {
    pose: '<circle cx="12" cy="4" r="2"/><path d="m4 8 8 3 8-3M12 11v5m0 0-6 6m6-6 6 6"/>',
    film: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M7 3v18M17 3v18M3 8h4m-4 8h4M17 8h4m-4 8h4"/>',
    refresh: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 7a7 7 0 0 1 12-1l2 6M4 12l2 6a7 7 0 0 0 12-1"/>',
    play: '<path d="m9 5 11 7-11 7z"/>',
    folder: '<path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
    arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
    download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  };
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.pose}</svg>`;
};

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <aside class="sidebar">
    <a class="brand" href="/"> <span class="brand-icon">${icon('pose')}</span> Pose Studio <span class="version">01</span></a>
    <div class="workspace-label">WORKSPACE</div>
    <div class="nav-active">${icon('pose')} Pose landmarker <span class="nav-dot"></span></div>
    <div class="library-heading"><h2>Video library</h2><button id="refresh" class="icon-button" title="Refresh video library" aria-label="Refresh video library">${icon('refresh')}</button></div>
    <p class="library-help">Your files. Ready to explore.</p>
    <button id="open-local" class="secondary-button local-video-button">${icon('folder')} Open local video</button>
    <input id="local-file" type="file" accept="video/*,.mp4,.webm,.mov,.m4v,.ogv" hidden />
    <p class="local-video-note">Browser only · Never uploaded</p>
    <div id="library" class="library" aria-label="Video library"></div>
    <div class="folder-note">${icon('folder')}<div><strong>Add to your library</strong><p>Drop videos into <code>videos/</code>, then refresh the list.</p><small>MP4 · WebM · MOV · M4V · OGV</small></div></div>
    <div class="sidebar-footer"><span class="online-dot"></span> Private workspace <span>LOCAL</span></div>
  </aside>
  <main>
    <header><div class="breadcrumb">Vision lab <span>/</span> <strong>Pose landmarker</strong></div><a href="https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker" target="_blank" rel="noreferrer">Model documentation ↗</a></header>
    <section class="page-heading"><div><div class="eyebrow">MOVEMENT, MAPPED.</div><h1>Every move tells a story.</h1><p>Explore body movement with real-time pose landmarks.</p></div><span class="model-chip"><span class="online-dot"></span> MediaPipe · Full model</span></section>
    <div id="error" class="error-banner" role="alert" hidden></div>
    <section class="workspace">
      <div class="viewer-column">
        <div class="view-switch" aria-label="Preview view"><button id="view-video" aria-pressed="true">Video</button><button id="view-character" aria-pressed="false">Character + video</button><button id="view-compare" aria-pressed="false">Compare solvers</button><span>Inspect the motion from every angle</span></div>
        <div id="preview-grid" class="preview-grid">
        <div class="viewer-panel">
          <div class="viewer-toolbar"><div><span class="live-dot"></span><strong>Video preview</strong><span id="resolution" class="muted">—</span></div><span id="overlay-state">LANDMARK OVERLAY</span></div>
          <div class="stage" id="stage"><video id="video" controls playsinline preload="auto"></video><canvas id="overlay" aria-label="Detected pose markers"></canvas><div id="empty-state">${icon('film')}<h2>Select a video to begin</h2><p>Choose a file from your video library.</p></div></div>
          <div class="video-caption"><div><span class="tiny-label">NOW EXPLORING</span><h2 id="video-title">No video selected</h2></div><label class="speed-label">Speed <select id="speed" aria-label="Playback speed"><option value="0.25">0.25×</option><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="1.5">1.5×</option><option value="2">2×</option></select></label></div>
        </div>
        <div id="character-preview" class="viewer-panel character-panel" hidden></div>
        </div>
        <div class="stats"><div><span>Detected poses</span><strong id="poses">—</strong><small>people in frame</small></div><div><span>Visible landmarks</span><strong id="landmarks">—</strong><small>33 points per pose</small></div><div><span>Inference time</span><strong id="latency">—</strong><small>milliseconds / frame</small></div><div><span>Tracking rate</span><strong id="fps">—</strong><small>frames / second</small></div></div>
        <section id="audio-timeline" class="audio-timeline" aria-label="Audio analysis and dance extraction"></section>
      </div>
      <aside class="controls-panel">
        <div class="panel-heading"><h2>Tracking controls</h2><span class="small-tag">LIVE</span></div>
        <div class="model-status"><span id="status-dot" class="status-dot loading"></span><div><strong id="status" role="status">Loading pose model…</strong><small id="status-detail">Preparing the local runtime</small></div><button id="retry" class="icon-button" aria-label="Retry model loading" hidden>${icon('refresh')}</button></div>
        <div id="character-controls" class="control-section" hidden></div>
        <div class="control-section"><h3>DETECTION</h3><label class="field-label" for="num-poses">Maximum people</label><select id="num-poses"><option value="1">1 person</option><option value="2">2 people</option><option value="4">4 people</option></select><div class="range-label"><label for="confidence">Detection confidence</label><output id="confidence-value">50%</output></div><input id="confidence" type="range" min="10" max="90" value="50" step="5"/><div class="range-ends"><span>More sensitive</span><span>More certain</span></div></div>
        <div class="control-section"><h3>OVERLAY</h3><label class="toggle-row"><span>Show landmarks</span><input id="show-points" type="checkbox" checked/><span class="switch"></span></label><label class="toggle-row"><span>Show skeleton</span><input id="show-lines" type="checkbox" checked/><span class="switch"></span></label><label class="toggle-row"><span>Landmark numbers</span><input id="show-labels" type="checkbox"/><span class="switch"></span></label><div class="range-label"><label for="visibility">Minimum visibility</label><output id="visibility-value">50%</output></div><input id="visibility" type="range" min="0" max="100" value="50" step="5"/></div>
        <div class="legend"><span><i class="left-color"></i> Left side</span><span><i class="right-color"></i> Right side</span><span><i class="center-color"></i> Center</span></div>
        <button id="export" class="secondary-button" disabled>${icon('download')} Export frame landmarks</button>
        <p id="privacy-note" class="privacy-note">Processed in your browser.<br>Your video stays on your network.</p>
      </aside>
    </section>
    <footer><span>POSE STUDIO <span class="footer-divider">/</span> Powered by MediaPipe</span><span>33 landmarks. Endless possibilities.</span></footer>
  </main>`;

const element = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const video = element<HTMLVideoElement>('video');
const canvas = element<HTMLCanvasElement>('overlay');
const context = canvas.getContext('2d')!;
const inputCanvas = document.createElement('canvas');
const inputContext = inputCanvas.getContext('2d')!;
let model: PoseLandmarker | undefined;
let videos: VideoEntry[] = [];
let browserVideo: VideoEntry | undefined;
let selected: VideoEntry | undefined;
let latest: PoseLandmarkerResult | undefined;
let lastVideoTime = -1;
let latestMediaTime = 0;
let lastInference = 0;
let frameCount = 0;
let rateStart = performance.now();
let modelLoading = false;
let initializing: Promise<void> | undefined;
let configTimer: ReturnType<typeof setTimeout>;
let characterView: CharacterView | undefined;
let characterLoading = false;
let previewMode: 'video' | 'character' | 'compare' = 'video';
let extractingAnimation = false;
const audioTimeline = new AudioTimeline(element('audio-timeline'), video, busy => {
  extractingAnimation = busy;
}, () => ({
  ...(characterView?.exportSettings() ?? { solver: 'custom' as const, settings: { ...DEFAULT_SETTINGS.custom }, person: 0 }),
  numPoses: settings().numPoses, confidence: settings().minPoseDetectionConfidence,
}));

function error(message: string) {
  element('error').textContent = message;
  element('error').hidden = !message;
}
function status(title: string, detail: string, loading = false) {
  element('status').textContent = title;
  element('status-detail').textContent = detail;
  element('status-dot').classList.toggle('loading', loading);
}
function clearResults() {
  characterView?.reset(true);
  latest = undefined;
  lastVideoTime = -1;
  context.clearRect(0, 0, canvas.width, canvas.height);
  for (const id of ['poses', 'landmarks', 'latency', 'fps']) element(id).textContent = '—';
  element<HTMLButtonElement>('export').disabled = true;
}
function settings() {
  const confidence = Number(element<HTMLInputElement>('confidence').value) / 100;
  return { numPoses: Number(element<HTMLSelectElement>('num-poses').value), minPoseDetectionConfidence: confidence, minPosePresenceConfidence: confidence, minTrackingConfidence: confidence };
}
async function loadModel() {
  if (initializing) return initializing;
  initializing = (async () => {
    modelLoading = true;
    model?.close();
    model = undefined;
    clearResults();
    element('retry').hidden = true;
    status('Loading pose model…', 'Preparing the local runtime', true);
    try {
      const fileset = await FilesetResolver.forVisionTasks('/wasm');
      let delegate: 'GPU' | 'CPU' = 'GPU';
      const create = () => PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: '/models/pose_landmarker_full.task', delegate },
        runningMode: 'VIDEO', ...settings(),
      });
      try { model = await create(); }
      catch { delegate = 'CPU'; model = await create(); }
      status('Ready to track', `${delegate} acceleration · Full model`);
      error('');
      lastVideoTime = -1;
    } catch (reason) {
      error(`Pose model could not start. ${reason instanceof Error ? reason.message : String(reason)}`);
      status('Model unavailable', 'Retry to load the local model');
      element('retry').hidden = false;
    } finally { modelLoading = false; }
  })();
  await initializing;
  initializing = undefined;
}

function pointColor(index: number) {
  if (index === 0) return '#f5e7a3';
  return ([1, 2, 3, 7, 9].includes(index) || (index >= 11 && index % 2 === 1)) ? '#72e7c0' : '#c5b5ff';
}
function visible(point: NormalizedLandmark) {
  return (point.visibility ?? 1) >= Number(element<HTMLInputElement>('visibility').value) / 100;
}
function draw() {
  context.clearRect(0, 0, canvas.width, canvas.height);
  let visibleCount = 0;
  const points = element<HTMLInputElement>('show-points').checked;
  const lines = element<HTMLInputElement>('show-lines').checked;
  const labels = element<HTMLInputElement>('show-labels').checked;
  const unit = canvas.width / 960;
  for (const landmarks of latest?.landmarks || []) {
    if (lines) {
      context.lineWidth = 2.5 * unit;
      for (const connection of PoseLandmarker.POSE_CONNECTIONS) {
        const a = landmarks[connection.start], b = landmarks[connection.end];
        if (!visible(a) || !visible(b)) continue;
        context.strokeStyle = pointColor(connection.end);
        context.beginPath(); context.moveTo(a.x * canvas.width, a.y * canvas.height);
        context.lineTo(b.x * canvas.width, b.y * canvas.height); context.stroke();
      }
    }
    landmarks.forEach((point, index) => {
      if (!visible(point)) return;
      visibleCount++;
      const x = point.x * canvas.width, y = point.y * canvas.height;
      if (points) {
        context.beginPath(); context.arc(x, y, 4 * unit, 0, Math.PI * 2);
        context.fillStyle = pointColor(index); context.fill();
        context.strokeStyle = '#143a35'; context.lineWidth = unit; context.stroke();
      }
      if (labels) {
        context.font = `600 ${12 * unit}px monospace`; context.fillStyle = '#fff';
        context.strokeStyle = '#14211c'; context.lineWidth = 3 * unit;
        context.strokeText(String(index), x + 6 * unit, y - 6 * unit);
        context.fillText(String(index), x + 6 * unit, y - 6 * unit);
      }
    });
  }
  element('landmarks').textContent = latest ? String(visibleCount) : '—';
  element('overlay-state').textContent = points || lines || labels ? 'LANDMARK OVERLAY' : 'ORIGINAL VIDEO';
}

function infer(now: number) {
  requestAnimationFrame(infer);
  if (extractingAnimation || !model || modelLoading || video.seeking || video.readyState < 2 || !video.videoWidth || video.currentTime === lastVideoTime || now - lastInference < 40) return;
  try {
    const width = Math.min(960, video.videoWidth);
    const height = Math.round(width * video.videoHeight / video.videoWidth);
    if (inputCanvas.width !== width || inputCanvas.height !== height) {
      inputCanvas.width = canvas.width = width;
      inputCanvas.height = canvas.height = height;
    }
    inputContext.drawImage(video, 0, 0, width, height);
    lastVideoTime = video.currentTime;
    latestMediaTime = video.currentTime;
    const start = performance.now();
    // Wall-clock timestamps stay increasing across seeks, loops, and source changes.
    latest = model.detectForVideo(inputCanvas, start);
    characterView?.update(latest.worldLandmarks, latest.landmarks, latestMediaTime);
    lastInference = now;
    element('latency').textContent = (performance.now() - start).toFixed(0);
    element('poses').textContent = String(latest.landmarks.length);
    element<HTMLButtonElement>('export').disabled = false;
    frameCount++;
    if (now - rateStart >= 1000) {
      element('fps').textContent = (frameCount * 1000 / (now - rateStart)).toFixed(0);
      frameCount = 0; rateStart = now;
    }
    draw();
  } catch (reason) {
    video.pause(); model?.close(); model = undefined;
    status('Tracking interrupted', 'Retry to restart the model');
    element('retry').hidden = false;
    error(`Could not analyze this frame: ${reason instanceof Error ? reason.message : String(reason)}`);
  }
}

function renderLibrary() {
  const library = element('library');
  library.replaceChildren();
  const entries = browserVideo ? [browserVideo, ...videos] : videos;
  if (!entries.length) {
    library.innerHTML = '<p class="empty-library">Open a local video, or add a file to <code>videos/</code> and refresh.</p>';
  }
  entries.forEach((entry, index) => {
    const button = document.createElement('button');
    button.className = `video-card ${entry.url === selected?.url ? 'selected' : ''}`;
    button.setAttribute('aria-pressed', String(entry.url === selected?.url));
    const number = document.createElement('span'); number.className = 'video-number'; number.textContent = String(index + 1).padStart(2, '0');
    const content = document.createElement('span'); content.className = 'video-card-content';
    const title = document.createElement('strong'); title.textContent = entry.title;
    const details = document.createElement('small'); details.textContent = `${entry.browserOnly ? 'BROWSER ONLY' : entry.name.split('.').pop()?.toUpperCase()} · ${(entry.bytes / 1024 / 1024).toFixed(0)} MB`;
    content.append(title, details); button.append(number, content);
    button.addEventListener('click', () => selectVideo(entry)); library.append(button);
  });
}
function selectVideo(entry: VideoEntry) {
  video.pause();
  selected = entry;
  clearResults(); error('');
  element('video-title').textContent = entry.title;
  element('empty-state').hidden = true;
  element('resolution').textContent = 'Loading…';
  element('privacy-note').innerHTML = entry.browserOnly
    ? 'Processed on this device.<br>Your local video is never uploaded.'
    : 'Processed in your browser.<br>Your video stays on your network.';
  video.src = entry.url; video.load();
  void audioTimeline.setSource(entry);
  renderLibrary();
  // A fresh graph avoids carrying tracking state from a previous video.
  if (model) void loadModel();
}

function openLocalVideo(file: File) {
  if (!file.size) { error('This file is empty. Choose a video with content.'); return; }
  if (!file.type.startsWith('video/') && !/\.(mp4|webm|mov|m4v|ogv|mkv|avi)$/i.test(file.name)) {
    error('Choose a video file, such as an MP4 or WebM.'); return;
  }
  const previous = browserVideo;
  // An object URL reads the File directly in this browser. Never send the file
  // or its metadata to an API, form, or remote storage service.
  browserVideo = {
    name: file.name, title: file.name.replace(/\.[^.]+$/, ''), bytes: file.size,
    url: URL.createObjectURL(file), browserOnly: true,
  };
  selectVideo(browserVideo);
  if (previous) URL.revokeObjectURL(previous.url);
}

async function refreshLibrary() {
  const button = element<HTMLButtonElement>('refresh'); button.disabled = true;
  try {
    const response = await fetch('/api/videos');
    if (!response.ok) throw new Error('The video directory could not be read.');
    videos = (await response.json()).videos;
    const existing = selected?.browserOnly || videos.some(entry => entry.url === selected?.url);
    if (!existing && (browserVideo || videos.length)) selectVideo(browserVideo || videos[0]);
    else if (!existing && !videos.length) {
      selected = undefined; video.pause(); video.removeAttribute('src'); video.load(); clearResults();
      void audioTimeline.setSource();
      element('empty-state').hidden = false; element('video-title').textContent = 'No video selected';
    }
    renderLibrary();
  } catch (reason) { error(`Could not refresh the library. ${String(reason)}`); }
  finally { button.disabled = false; }
}

element('refresh').addEventListener('click', () => void refreshLibrary());
element('open-local').addEventListener('click', () => element<HTMLInputElement>('local-file').click());
element('local-file').addEventListener('change', () => {
  const input = element<HTMLInputElement>('local-file');
  const file = input.files?.[0];
  if (file) openLocalVideo(file);
  input.value = ''; // Allow choosing the same file again; cancelling preserves playback.
});
window.addEventListener('pagehide', event => {
  if (!event.persisted && browserVideo) URL.revokeObjectURL(browserVideo.url);
  if (!event.persisted) characterView?.dispose();
  if (!event.persisted) audioTimeline.dispose();
});
async function setView(mode: typeof previewMode) {
  previewMode = mode;
  const character = mode !== 'video';
  element('preview-grid').classList.toggle('compare-solvers', mode === 'compare');
  element('preview-grid').classList.toggle('show-character', character);
  element('character-preview').hidden = !character;
  element('character-controls').hidden = !character;
  element('view-video').setAttribute('aria-pressed', String(!character));
  element('view-character').setAttribute('aria-pressed', String(mode === 'character'));
  element('view-compare').setAttribute('aria-pressed', String(mode === 'compare'));
  if (character && !characterView && !characterLoading) {
    characterLoading = true;
    element('character-preview').textContent = 'Preparing 3D view…';
    try {
      const { CharacterView } = await import('./character-view');
      characterView = new CharacterView(element('character-preview'), element('character-controls'));
      if (latest) characterView.update(latest.worldLandmarks, latest.landmarks, latestMediaTime);
    } catch (reason) {
      element('character-preview').textContent = `3D view unavailable: ${String(reason)}. Switch to Video and try again.`;
    } finally { characterLoading = false; }
  }
  characterView?.setComparison(previewMode === 'compare');
  characterView?.setVisible(previewMode !== 'video');
}
element('view-video').addEventListener('click', () => void setView('video'));
element('view-character').addEventListener('click', () => void setView('character'));
element('view-compare').addEventListener('click', () => void setView('compare'));
element('retry').addEventListener('click', () => void loadModel());
element('speed').addEventListener('change', () => { video.playbackRate = Number(element<HTMLSelectElement>('speed').value); });
video.addEventListener('loadedmetadata', () => {
  element('stage').style.aspectRatio = `${video.videoWidth} / ${video.videoHeight}`;
  element('resolution').textContent = `${video.videoWidth} × ${video.videoHeight}`;
  video.playbackRate = Number(element<HTMLSelectElement>('speed').value);
});
video.addEventListener('seeking', clearResults);
video.addEventListener('seeked', () => { if (model && !modelLoading) void loadModel(); });
video.addEventListener('play', () => { rateStart = performance.now(); frameCount = 0; });
video.addEventListener('pause', () => { element('fps').textContent = '0'; });
video.addEventListener('error', () => {
  element('resolution').textContent = 'Playback unavailable';
  error('This video cannot be decoded by your browser. Use an MP4 with H.264 video and AAC audio for the widest compatibility.');
});
for (const id of ['show-points', 'show-lines', 'show-labels', 'visibility']) {
  element(id).addEventListener('input', () => {
    element('visibility-value').textContent = `${element<HTMLInputElement>('visibility').value}%`;
    draw();
  });
}
for (const id of ['confidence', 'num-poses']) {
  element(id).addEventListener('input', () => {
    element('confidence-value').textContent = `${element<HTMLInputElement>('confidence').value}%`;
    clearTimeout(configTimer);
    configTimer = setTimeout(async () => {
      if (model && !modelLoading) {
        try { await model.setOptions(settings()); lastVideoTime = -1; }
        catch (reason) { error(`Could not update detection settings: ${String(reason)}`); }
      }
    }, 250);
  });
}
element('export').addEventListener('click', () => {
  if (!latest) return;
  const data = { video: selected?.name, timestamp_seconds: latestMediaTime, landmarks: latest.landmarks, worldLandmarks: latest.worldLandmarks };
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = `pose-${latestMediaTime.toFixed(3)}s.json`; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

void refreshLibrary();
void loadModel();
requestAnimationFrame(infer);
