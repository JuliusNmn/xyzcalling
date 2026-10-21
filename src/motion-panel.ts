import type { AudioVideo } from './audio-timeline';
import { selectionFileSuffix, selectFullVideo, type ClipSelection } from './audio-analysis';
import type { SolverKind, SolverSettings } from './rig/solvers';
import { buildMotionMetrics, METRICS, motionExportChannels, type MotionMetrics } from './motion-metrics';
import { encodeBclip } from './bclip';

type Config = { solver: SolverKind; settings: SolverSettings; person: number; numPoses: number; confidence: number };
export class MotionPanel {
  private source?: AudioVideo;
  private data?: MotionMetrics;
  private extracted?: { selection: ClipSelection; source: AudioVideo; threshold: number };
  private request?: AbortController;
  private generation = 0;
  private busy = false;
  private raf = 0;
  private lastTime = -1;
  private resize: ResizeObserver;
  private metadata = () => this.refreshSelection();
  private cards: { canvas: HTMLCanvasElement; value: HTMLOutputElement; range: HTMLElement; low: number; high: number; count: number; background?: HTMLCanvasElement }[] = [];
  constructor(private host: HTMLElement, private video: HTMLVideoElement, private selection: () => ClipSelection | undefined,
    private config: () => Config, private onBusy: (busy: boolean) => void) {
    host.innerHTML = `
      <div class="rhythm-heading"><div><span class="eyebrow">MOTION SIGNALS</span><h2>Turn movement into controls.</h2></div><strong>20 metrics</strong></div>
      <p class="motion-intro">Drive particles with hand speed, spread light with reach, or turn a gesture into a trigger. Extract a range to inspect every signal.</p>
      <div class="motion-actions"><button class="secondary-button" data-motion="selection" disabled>Analyze selected loop</button><button class="secondary-button" data-motion="full" disabled>Analyze complete video</button><button class="text-button" data-motion="cancel" hidden>Cancel</button></div>
      <p class="audio-status" data-motion="selection-info">Select a video to begin.</p>
      <progress max="1" value="0" data-motion="progress" hidden aria-label="Motion analysis progress"></progress>
      <p class="audio-status" data-motion="status" role="status">Full-video analysis works without an audio sidecar. Select bars above for a loop.</p>
      <div data-motion="results" hidden>
        <div class="motion-export"><label><input type="checkbox" data-motion="joints" /> Include 33 joint positions</label><button class="secondary-button primary-action" data-motion="download">Download .bclip</button><button class="text-button" data-motion="guide">Download channel guide</button></div>
        <p class="audio-status" data-motion="range"></p>
        <label class="motion-scrubber">Inspect motion <output data-motion="time"></output><input data-motion="seek" aria-label="Inspect motion time" type="range" min="0" max="1" step="0.0333333333" value="0" /></label>
      </div>
      <div class="motion-grid">${METRICS.map(([id, label, unit, description]) => `<article class="motion-card"><div><h3>${label}</h3><output data-value="${id}">—</output></div><code>${id}</code><canvas data-chart="${id}" role="img" aria-label="${label} timeline in ${unit}" tabindex="0"></canvas><small data-range="${id}">${unit} · Awaiting analysis</small><p>${description}</p></article>`).join('')}</div>
      <p class="motion-note">30 Hz · Estimated 3D distances in meters · Speeds are relative to the hips, not travel through the room. Hands use wrists; feet use ankles. Raw pose signals can contain tracking jitter. Gaps are shown as breaks and export as zero with a matching <code>_valid</code> channel. Initial speed and acceleration samples are unavailable.</p>
      <p class="motion-note">In TouchDesigner, open the .bclip with a <a href="https://docs.derivative.ca/File_In_CHOP" target="_blank" rel="noreferrer">File In CHOP</a> using names in the file. Select a metric, gate it with its validity channel, then remap its range with a Math CHOP. Every download contains the entire analyzed range.</p>`;
    this.cards = METRICS.map(([id]) => ({ canvas: host.querySelector(`[data-chart="${id}"]`)!, value: host.querySelector(`[data-value="${id}"]`)!, range: host.querySelector(`[data-range="${id}"]`)!, low: 0, high: 1, count: 0 }));
    this.el('selection').addEventListener('click', () => void this.analyze(this.selection()));
    this.el('full').addEventListener('click', () => void this.analyze(selectFullVideo(video.duration)));
    this.el('cancel').addEventListener('click', () => this.request?.abort());
    this.el('download').addEventListener('click', () => this.download());
    this.el('guide').addEventListener('click', () => this.guide());
    this.el('seek').addEventListener('input', () => this.seek(Number(this.el<HTMLInputElement>('seek').value)));
    this.cards.forEach(card => {
      card.canvas.addEventListener('click', event => {
        if (!this.data) return;
        const rect = card.canvas.getBoundingClientRect(); this.seek((event.clientX - rect.left) / rect.width * this.data.duration);
      });
      card.canvas.addEventListener('keydown', event => {
        if (!this.extracted || !this.data || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const time = this.video.currentTime - this.extracted.selection.start;
        this.seek(event.key === 'Home' ? 0 : event.key === 'End' ? this.data.times.at(-1)! : time + (event.key === 'ArrowRight' ? 1 : -1) / this.data.sampleRate);
      });
    });
    video.addEventListener('loadedmetadata', this.metadata);
    this.resize = new ResizeObserver(() => this.draw()); this.resize.observe(host);
    const tick = () => { if (this.data && video.currentTime !== this.lastTime) this.draw(); this.raf = requestAnimationFrame(tick); };
    this.raf = requestAnimationFrame(tick);
  }
  private el<T extends HTMLElement = HTMLElement>(name: string) { return this.host.querySelector<T>(`[data-motion="${name}"]`)!; }
  setSource(source?: AudioVideo) {
    this.generation++; this.request?.abort(); this.source = source; this.data = undefined; this.extracted = undefined;
    this.el('results').hidden = true; this.el('status').textContent = 'Full-video analysis works without an audio sidecar. Select bars above for a loop.';
    this.cards.forEach((card, i) => { card.background = undefined; card.value.textContent = '—'; card.range.textContent = `${METRICS[i][2]} · Awaiting analysis`; });
    this.refreshSelection(); this.draw();
  }
  setBusy(busy: boolean) { this.busy = busy; this.refreshSelection(); }
  refreshSelection() {
    const s = this.selection();
    this.el<HTMLButtonElement>('selection').disabled = this.busy || !this.source || !s || s.kind !== 'bars';
    this.el<HTMLButtonElement>('full').disabled = this.busy || !this.source || !selectFullVideo(this.video.duration);
    this.el('selection-info').textContent = !this.source ? 'Select a video to begin.' : s?.kind === 'bars'
      ? `Selected loop: bars ${s.firstBar + 1}–${s.firstBar + s.count} · ${s.start.toFixed(2)}–${s.end.toFixed(2)}s${s.beatOffset ? ` · ${s.beatOffset > 0 ? '+' : ''}${s.beatOffset} beat offset` : ''}`
      : 'Choose a bar range above to analyze a loop, or analyze the complete video.';
  }
  private async analyze(selection?: ClipSelection) {
    if (!this.source || !selection || this.busy) return;
    const source = this.source, generation = this.generation, config = this.config();
    const request = this.request = new AbortController();
    this.video.pause(); this.onBusy(true); this.el('cancel').hidden = false; this.el('progress').hidden = false;
    this.el<HTMLProgressElement>('progress').value = 0;
    try {
      const { extractAnimation } = await import('./animation-export');
      const animation = await extractAnimation({ url: source.url, source, selection, ...config, signal: request.signal,
        progress: (fraction, message) => { if (generation === this.generation) { this.el<HTMLProgressElement>('progress').value = fraction; this.el('status').textContent = message; } },
      });
      request.signal.throwIfAborted();
      if (generation !== this.generation) return;
      this.data = buildMotionMetrics(animation.frames, animation.duration_seconds, config.settings.minVisibility);
      this.extracted = { source, selection: { ...selection }, threshold: config.settings.minVisibility };
      this.cards.forEach((card, i) => {
        card.background = undefined;
        const channel = this.data!.channels[i]; let low = Infinity, high = -Infinity, count = 0;
        channel.values.forEach((value, j) => { if (channel.valid[j]) { low = Math.min(low, value); high = Math.max(high, value); count++; } });
        card.low = count ? Math.min(0, low) : 0; card.high = count ? Math.max(0, high) : 1; card.count = count;
        if (card.high === card.low) card.high = card.low + 1;
        card.range.textContent = count ? `${low.toFixed(2)}–${high.toFixed(2)} ${channel.unit} · ${Math.round(count / channel.values.length * 100)}% valid` : `${channel.unit} · No valid samples`;
      });
      this.el('results').hidden = false;
      this.el<HTMLInputElement>('seek').max = String(this.data.times.at(-1));
      this.el('range').textContent = `Analyzed ${selection.kind === 'full' ? 'complete video' : selectionFileSuffix(selection)} · ${selection.start.toFixed(2)}–${selection.end.toFixed(2)}s · Person ${config.person + 1} · ${this.data.times.length} samples at 30 Hz`;
      this.el('status').textContent = '20 signals ready. Click a graph or scrub to inspect the matching video frame. Graphs use independent scales; values and exports keep their original units.';
      this.seek(0);
    } catch (error) {
      if (generation === this.generation) this.el('status').textContent = request.signal.aborted ? 'Motion analysis cancelled.' : `Motion analysis failed: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      this.request = undefined; this.onBusy(false); this.el('cancel').hidden = true; this.el('progress').hidden = true;
    }
  }
  private seek(time: number) {
    if (!this.data || !this.extracted) return;
    this.video.pause(); this.video.currentTime = this.extracted.selection.start + Math.max(0, Math.min(this.data.times.at(-1)!, time)); this.draw();
  }
  private draw() {
    this.lastTime = this.video.currentTime;
    const data = this.data, time = this.video.currentTime - (this.extracted?.selection.start ?? 0);
    const inside = data && time >= -1e-6 && time < data.duration;
    const index = data ? Math.max(0, Math.min(data.times.length - 1, Math.floor(time * data.sampleRate + 1e-6))) : 0;
    if (data) {
      this.el<HTMLInputElement>('seek').value = String(data.times[index]);
      this.el('time').textContent = inside ? `${data.times[index].toFixed(2)} / ${data.duration.toFixed(2)}s` : 'Video outside analyzed range';
    }
    this.cards.forEach((card, ci) => {
      const { canvas } = card, width = canvas.clientWidth, height = canvas.clientHeight;
      if (!width || !height) return;
      const dpr = Math.min(devicePixelRatio, 2);
      if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) { canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr); }
      const c = canvas.getContext('2d')!; c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, width, height);
      c.strokeStyle = '#d6dfcf'; c.beginPath(); c.moveTo(0, height - 6); c.lineTo(width, height - 6); c.stroke();
      if (!data) return;
      const channel = data.channels[ci];
      card.value.textContent = inside && channel.valid[index] ? `${channel.values[index].toFixed(2)} ${channel.unit}` : '—';
      if (!card.background || card.background.width !== canvas.width || card.background.height !== canvas.height) {
        const background = card.background = document.createElement('canvas');
        background.width = canvas.width; background.height = canvas.height;
        const plot = background.getContext('2d')!; plot.setTransform(dpr, 0, 0, dpr, 0, 0);
        const y = (v: number) => height - 6 - (v - card.low) / (card.high - card.low) * (height - 12);
        plot.strokeStyle = ci < 6 ? '#8971b5' : ci < 12 ? '#4b886e' : '#bd8046'; plot.lineWidth = 1.5;
        plot.beginPath(); let drawing = false;
        // Cache the waveform; only the playhead changes during playback. Buckets preserve peaks and gaps.
        const step = Math.max(1, Math.ceil(channel.values.length / width));
        for (let first = 0; first < channel.values.length; first += step) {
          let low = Infinity, high = -Infinity, valid = true;
          const end = Math.min(channel.values.length, first + step);
          for (let j = first; j < end; j++) {
            if (!channel.valid[j]) valid = false;
            else { low = Math.min(low, channel.values[j]); high = Math.max(high, channel.values[j]); }
          }
          if (!valid) drawing = false;
          if (!Number.isFinite(low)) continue;
          const x = data.times[first] / data.duration * width;
          if (drawing) plot.lineTo(x, y(channel.values[first])); else plot.moveTo(x, y(low));
          plot.lineTo(x, y(low)); plot.lineTo(x, y(high)); drawing = valid;
        }
        plot.stroke();
      }
      c.drawImage(card.background, 0, 0, width, height);
      if (inside) { const x = Math.max(0, time) / data.duration * width; c.strokeStyle = '#a55037'; c.beginPath(); c.moveTo(x, 0); c.lineTo(x, height); c.stroke(); }
    });
  }
  private save(blob: Blob, extension: string) {
    if (!this.extracted) return;
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = `${this.extracted.source.name}.${selectionFileSuffix(this.extracted.selection)}.motion.${extension}`; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  private download() {
    if (!this.data || !this.extracted) return;
    try {
      const channels = motionExportChannels(this.data, this.el<HTMLInputElement>('joints').checked, this.extracted.threshold);
      channels.push({ name: 'source_time', values: this.data.times.map(t => t + this.extracted!.selection.start) });
      this.save(new Blob([encodeBclip(channels, this.data.sampleRate)], { type: 'application/octet-stream' }), 'bclip');
      this.el('status').textContent = `Download started: ${channels.length} named channels · ${this.data.times.length} samples · 30 Hz. The file covers the analyzed range shown below.`;
    } catch (error) { this.el('status').textContent = `Download failed: ${String(error)}`; }
  }
  private guide() {
    if (!this.data || !this.extracted) return;
    const guide = { schema: 'pose-studio.motion-metrics', version: 1, source: this.extracted.source.name, selection: this.extracted.selection,
      sample_rate_hz: this.data.sampleRate, samples: this.data.times.length, visibility_threshold: this.extracted.threshold,
      coordinates: 'MediaPipe estimated meters relative to hip midpoint; x right, y down, z away from camera. Height metrics invert y. Not global locomotion. Raw landmarks; solver rotation smoothing does not affect metrics.',
      missing_data: 'Zero with matching <metric>_valid = 0. Speeds require consecutive valid samples; acceleration requires three and a stable set of tracked body joints. No differentiation across the loop seam.',
      timing: 'Clip starts at sample 0. Samples are uniform in [start, end); the irregular closing animation key is excluded. Duration is quantized up to less than 1/30 second for bclip playback.',
      channels: this.data.channels.map(({ values: _values, valid: _valid, ...metadata }) => metadata),
      extra_channels: 'Each metric has a _valid channel; clip_time and source_time are seconds. Optional joint_0_x through joint_32_z use the original MediaPipe coordinates, with joint_N_valid.',
      touchdesigner: 'File In CHOP > Use Names In File. Select CHOP to choose channels; Math CHOP to remap; optionally Filter CHOP to smooth. Gate each signal with its validity channel. Set playback/looping in TouchDesigner; no seam blending is applied.',
    };
    this.save(new Blob([JSON.stringify(guide, null, 2)], { type: 'application/json' }), 'channels.json');
  }
  dispose() { this.request?.abort(); cancelAnimationFrame(this.raf); this.resize.disconnect(); this.video.removeEventListener('loadedmetadata', this.metadata); }
}
