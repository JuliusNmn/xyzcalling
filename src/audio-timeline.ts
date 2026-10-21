import { parseAnalysis, selectBars, selectFullVideo, selectedBars, selectionLabel, selectionFileSuffix, type AudioAnalysis, type ClipSelection } from './audio-analysis';
import { DEFAULT_SETTINGS, type SolverKind, type SolverSettings } from './rig/solvers';
import type { AnimationPreview, DanceAnimation } from './animation-preview';

export type AudioVideo = { name: string; bytes: number; url: string; analysisUrl?: string; browserOnly?: boolean };
export class AudioTimeline {
  private source?: AudioVideo;
  private analysis?: AudioAnalysis;
  private selection?: ClipSelection;
  private generation = 0;
  private request?: AbortController;
  private extraction?: AbortController;
  private preview?: AnimationPreview;
  private prepared?: { data: DanceAnimation; key: string; source: AudioVideo; selection: ClipSelection };
  private auditioning = false;
  private raf = 0;
  private lastDrawTime = -1;
  private resize: ResizeObserver;
  private onMetadata = () => { if (!this.extraction) this.choose(); };
  private onEnded = () => this.advancePlayback();
  private onPause = () => {
    if (this.video.paused && !this.video.ended) {
      this.auditioning = false; this.playButton();
    }
  };
  constructor(private host: HTMLElement, private video: HTMLVideoElement, private busy: (value: boolean) => void,
    private config: () => { solver: SolverKind; settings: SolverSettings; person: number; numPoses: number; confidence: number }) {
    host.innerHTML = `
      <div class="rhythm-heading"><div><span class="eyebrow">MUSIC & MOVEMENT</span><h2>Find your phrase.</h2></div><strong id="audio-tempo">— BPM</strong></div>
      <div class="analysis-actions"><button id="reload-analysis" class="text-button">Reload analysis</button><button id="import-analysis" class="text-button">Open analysis JSON</button><input id="analysis-file" type="file" accept=".json,application/json" hidden /></div>
      <p id="analysis-status" class="audio-status" role="status">Select a video to load its audio analysis.</p>
      <div id="audio-content" hidden>
        <div class="wave-label"><span>TRACK OVERVIEW · Click to choose a starting bar</span><span id="audio-position">0:00</span></div>
        <canvas id="wave-overview" class="wave-overview" role="img" aria-label="Full-track waveform with detected bars and selected range"></canvas>
        <div class="phrase-controls">
          <div class="phrase-field"><label for="start-bar">Start at detected bar</label><div class="phrase-stepper"><button id="previous-bar" type="button" aria-label="Previous starting bar">−</button><input id="start-bar" type="number" min="1" value="1" step="1" /><button id="next-bar" type="button" aria-label="Next starting bar">+</button></div></div>
          <div class="phrase-field"><label for="beat-offset">Beat offset</label><div class="phrase-stepper"><button id="previous-beat" type="button" aria-label="Shift one beat earlier">−</button><input id="beat-offset" type="number" value="0" step="1" /><button id="next-beat" type="button" aria-label="Shift one beat later">+</button></div></div>
          <label>Phrase length<select id="bar-count"><option value="4">4 bars</option><option value="8">8 bars</option><option value="16">16 bars</option><option value="32">32 bars</option><option value="64">64 bars</option><option value="full">Complete video</option></select></label>
        </div>
        <div class="phrase-playback"><button id="play-phrase" class="secondary-button">Play selection</button><label><input id="loop-selection" type="checkbox" checked /> Loop selection</label></div>
        <div class="wave-label"><span id="detail-label">SELECTION DETAIL · Beats / numbered bar starts</span><span id="selection-range"></span></div>
        <canvas id="wave-detail" class="wave-detail" role="img" aria-label="Selected phrase waveform and beat markers"></canvas>
        <p id="selection-info" class="audio-status"></p>
        <div class="export-controls"><button id="preview-dance" class="secondary-button primary-action">Extract & preview animation</button><button id="cancel-extraction" class="text-button" hidden>Cancel</button></div>
        <progress id="extraction-progress" max="1" value="0" hidden aria-label="Animation extraction progress"></progress>
        <p id="extraction-status" class="audio-status" role="status"></p>
        <div id="animation-preview" class="animation-preview" hidden></div>
        <div class="export-controls"><label>Download format <select id="animation-format"><option value="fbx">FBX · textured character</option><option value="json">JSON · animation & landmarks</option></select></label><button id="export-dance" class="secondary-button" disabled>Download animation</button></div>
        <p class="audio-footnote">30 FPS · Mixamo body animation · In place · Uses the current character solver settings. FBX sends bone animation to your server for conversion; video stays in your browser. Bar alignment is estimated; audition before exporting. Clips are not automatically seamless loops.</p>
      </div>`;
    this.el('reload-analysis').addEventListener('click', () => void this.load());
    this.el('import-analysis').addEventListener('click', () => this.el<HTMLInputElement>('analysis-file').click());
    this.el('analysis-file').addEventListener('change', () => void this.importFile());
    this.el('start-bar').addEventListener('input', () => this.choose());
    this.el('beat-offset').addEventListener('input', () => this.choose());
    for (const [id, input, delta] of [
      ['previous-bar', 'start-bar', -1], ['next-bar', 'start-bar', 1],
      ['previous-beat', 'beat-offset', -1], ['next-beat', 'beat-offset', 1],
    ] as const) this.el(id).addEventListener('click', () => {
      const field = this.el<HTMLInputElement>(input); field.value = String(Number(field.value) + delta); this.choose();
    });
    this.el('bar-count').addEventListener('change', () => {
      const count = Number(this.el<HTMLSelectElement>('bar-count').value);
      const start = this.el<HTMLInputElement>('start-bar');
      if (this.analysis && Number.isFinite(count)) start.value = String(Math.max(1, Math.min(Number(start.value), this.analysis.bars.length - count + 1)));
      this.choose();
    });
    this.el('wave-overview').addEventListener('click', event => {
      if (!this.analysis || this.extraction || this.el<HTMLSelectElement>('bar-count').value === 'full') return;
      const rect = this.el('wave-overview').getBoundingClientRect();
      const time = (event.clientX - rect.left) / rect.width * this.analysis.duration_seconds;
      let index = this.analysis.bars.findIndex(bar => bar.end_seconds > time);
      if (index < 0) index = this.analysis.bars.length - 1;
      const max = Math.max(0, this.analysis.bars.length - Number(this.el<HTMLSelectElement>('bar-count').value));
      this.el<HTMLInputElement>('start-bar').value = String(Math.max(0, Math.min(index, max)) + 1); this.choose();
    });
    this.el('play-phrase').addEventListener('click', () => void this.play());
    this.el('preview-dance').addEventListener('click', () => void this.prepare());
    this.el('export-dance').addEventListener('click', () => void this.export());
    this.el('cancel-extraction').addEventListener('click', () => this.extraction?.abort());
    this.video.addEventListener('loadedmetadata', this.onMetadata);
    this.video.addEventListener('ended', this.onEnded);
    this.video.addEventListener('pause', this.onPause);
    this.resize = new ResizeObserver(() => this.draw()); this.resize.observe(host);
    const tick = () => {
      this.checkPreview();
      if (this.analysis) {
        this.advancePlayback();
        if (this.video.currentTime !== this.lastDrawTime) this.draw();
      }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }
  private el<T extends HTMLElement = HTMLElement>(id: string) { return this.host.querySelector<T>(`#${id}`)!; }
  private message(text: string) { this.el('analysis-status').textContent = text; }
  async setSource(source?: AudioVideo) {
    this.extraction?.abort(); this.source = source; this.auditioning = false;
    await this.load();
  }
  async load() {
    this.clearPreview();
    if (this.auditioning) this.video.pause();
    this.auditioning = false; this.playButton();
    const generation = ++this.generation;
    this.request?.abort(); this.request = new AbortController();
    this.analysis = undefined; this.selection = undefined; this.el('audio-content').hidden = true;
    this.el('audio-tempo').textContent = '— BPM';
    if (!this.source) { this.message('Select a video to load its audio analysis.'); return; }
    if (!this.source.analysisUrl) { this.message('Open the analysis JSON saved beside this local video. Both files stay in your browser.'); return; }
    this.message('Loading waveform and beat analysis…');
    try {
      const response = await fetch(this.source.analysisUrl, { signal: this.request.signal, cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not load audio analysis.');
      if (generation === this.generation) this.accept(data);
    } catch (error) {
      if (generation === this.generation) this.message(error instanceof Error ? error.message : String(error));
    }
  }
  private async importFile() {
    const input = this.el<HTMLInputElement>('analysis-file'), file = input.files?.[0]; input.value = '';
    if (!file || !this.source) return;
    const generation = ++this.generation; this.request?.abort();
    try {
      if (file.size > 20 * 1024 * 1024) throw new Error('Analysis JSON exceeds the 20 MB limit.');
      const data = JSON.parse(await file.text());
      if (generation === this.generation) this.accept(data);
    } catch (error) { if (generation === this.generation) this.message(String(error)); }
  }
  private accept(value: unknown) {
    if (!this.source) return;
    const analysis = parseAnalysis(value, this.source);
    if (Number.isFinite(this.video.duration) && Math.abs(analysis.duration_seconds - this.video.duration) > .5) throw new Error('Analysis duration does not match this video.');
    this.clearPreview();
    this.analysis = analysis;
    this.el('audio-content').hidden = false;
    this.el('audio-tempo').textContent = analysis.bpm === null ? 'No tempo detected' : `${analysis.bpm.toFixed(1)} BPM`;
    this.message(`${analysis.beats_seconds.length} beats · ${analysis.bars.length} complete bars. ${analysis.warnings.join(' ')}`);
    this.el<HTMLInputElement>('start-bar').value = '1';
    this.el<HTMLInputElement>('beat-offset').value = '0';
    this.el('extraction-status').textContent = '';
    this.choose();
  }
  private choose() {
    const wasPlaying = this.auditioning && !this.video.paused;
    this.auditioning = false;
    if (!this.analysis) return;
    const full = this.el<HTMLSelectElement>('bar-count').value === 'full';
    const count = Number(this.el<HTMLSelectElement>('bar-count').value), offset = this.el<HTMLInputElement>('beat-offset');
    const input = this.el<HTMLInputElement>('start-bar'); input.max = String(Math.max(1, full ? this.analysis.bars.length : this.analysis.bars.length - count + 1));
    const first = Number(input.value) - 1, beatOffset = Number(offset.value);
    this.selection = full ? selectFullVideo(this.video.duration) : selectBars(this.analysis, first, count, beatOffset);
    if (this.selection && Number.isFinite(this.video.duration) && this.selection.end > this.video.duration) this.selection = undefined;
    input.disabled = offset.disabled = full || !!this.extraction;
    this.el<HTMLButtonElement>('previous-bar').disabled = full || !!this.extraction || first <= 0;
    this.el<HTMLButtonElement>('next-bar').disabled = full || !!this.extraction || first >= this.analysis.bars.length - count;
    this.el<HTMLButtonElement>('previous-beat').disabled = full || !!this.extraction || !selectBars(this.analysis, first, count, beatOffset - 1);
    this.el<HTMLButtonElement>('next-beat').disabled = full || !!this.extraction || !selectBars(this.analysis, first, count, beatOffset + 1);
    this.el<HTMLButtonElement>('play-phrase').disabled = !this.selection || !!this.extraction;
    this.checkPreview();
    this.el<HTMLButtonElement>('preview-dance').disabled = !this.selection || !!this.extraction;
    this.el<HTMLButtonElement>('export-dance').disabled = !this.prepared || !!this.extraction;
    if (this.selection) {
      const s = this.selection;
      const beats = this.analysis.beats_seconds.filter(t => t >= s.start && t < s.end).length;
      this.el('selection-range').textContent = `${s.start.toFixed(2)} – ${s.end.toFixed(2)}s`;
      const label = s.kind === 'full' ? 'Complete video · Intro and ending included' :
        `Bars ${s.firstBar + 1}–${s.firstBar + s.count}${s.beatOffset ? ` · ${s.beatOffset > 0 ? '+' : ''}${s.beatOffset} beat offset` : ''}`;
      this.el('selection-info').textContent = `${label} · ${beats} beats · ${(s.end - s.start).toFixed(2)} seconds`;
      this.el('detail-label').textContent = s.kind === 'bars' && s.beatOffset ? 'SELECTION DETAIL · Beats / adjusted bar starts' : 'SELECTION DETAIL · Beats / numbered bar starts';
      if (wasPlaying) { this.video.currentTime = s.start; this.auditioning = true; }
    } else {
      this.el('selection-range').textContent = '';
      this.el('selection-info').textContent = full ? 'Waiting for the video duration…' :
        `Choose a starting bar with ${count} complete bars remaining, and a beat offset that keeps both ends inside the video.`;
      if (wasPlaying) this.video.pause();
    }
    this.playButton();
    this.draw();
  }
  private playButton() { this.el('play-phrase').textContent = this.auditioning ? 'Pause selection' : 'Play selection'; }
  private advancePlayback() {
    if (!this.auditioning || !this.selection || this.video.seeking || this.video.currentTime < this.selection.end) return;
    if (this.el<HTMLInputElement>('loop-selection').checked) {
      this.video.currentTime = this.selection.start;
      void this.video.play().catch(error => { this.auditioning = false; this.playButton(); this.message(String(error)); });
    } else {
      this.auditioning = false; this.video.pause(); this.video.currentTime = this.selection.end; this.playButton();
    }
  }
  private async play() {
    if (!this.selection) return;
    if (this.auditioning) { this.auditioning = false; this.video.pause(); this.playButton(); return; }
    this.video.currentTime = this.selection.start; this.auditioning = true;
    this.playButton();
    try { await this.video.play(); } catch (error) { this.auditioning = false; this.playButton(); this.message(String(error)); }
  }
  private draw() {
    if (!this.analysis) return;
    this.lastDrawTime = this.video.currentTime;
    this.el('audio-position').textContent = `${Math.floor(this.video.currentTime / 60)}:${Math.floor(this.video.currentTime % 60).toString().padStart(2, '0')}`;
    this.drawWave('wave-overview', 0, this.analysis.duration_seconds, false);
    this.drawWave('wave-detail', this.selection?.start ?? 0, this.selection?.end ?? Math.min(10, this.analysis.duration_seconds), true);
  }
  private drawWave(id: string, start: number, end: number, detail: boolean) {
    const a = this.analysis!;
    const canvas = this.el<HTMLCanvasElement>(id), width = canvas.clientWidth, height = canvas.clientHeight;
    if (!width || end <= start) return;
    const dpr = Math.min(devicePixelRatio, 2);
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    }
    const c = canvas.getContext('2d')!; c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, width, height);
    const x = (time: number) => (time - start) / (end - start) * width;
    if (this.selection) { c.fillStyle = '#dfeccc'; c.fillRect(x(this.selection.start), 0, x(this.selection.end) - x(this.selection.start), height); }
    c.strokeStyle = '#729179'; c.lineWidth = 1;
    const peaks = a.waveform.peaks, bin = a.waveform.bin_seconds;
    c.beginPath();
    for (let px = 0; px < width; px++) {
      const first = Math.max(0, Math.floor((start + px / width * (end - start)) / bin));
      const last = Math.min(peaks.length, Math.max(first + 1, Math.ceil((start + (px + 1) / width * (end - start)) / bin)));
      let low = 0, high = 0;
      for (let i = first; i < last; i++) { low = Math.min(low, peaks[i][0]); high = Math.max(high, peaks[i][1]); }
      c.moveTo(px + .5, height / 2 - high * height * .32); c.lineTo(px + .5, height / 2 - low * height * .32);
    }
    c.stroke();
    if (detail) {
      c.strokeStyle = '#8d9a8966'; c.beginPath();
      for (const time of a.beats_seconds) if (time >= start && time <= end) { c.moveTo(x(time), 23); c.lineTo(x(time), height); }
      c.stroke();
    }
    c.strokeStyle = detail ? '#355a40' : '#65845855'; c.fillStyle = '#355a40'; c.font = '10px system-ui';
    let lastLabel = -50;
    const bars = detail && this.selection?.kind === 'bars' ? selectedBars(a, this.selection) : undefined;
    const boundaries = bars ? [...bars.map(bar => ({ time: bar.start_seconds, label: bar.index + 1 })),
      { time: bars[bars.length - 1].end_seconds, label: bars[bars.length - 1].index + 2 }] :
      a.downbeats_seconds.map((time, i) => ({ time, label: i + 1 }));
    boundaries.forEach(({ time, label }) => {
      if (time < start || time > end) return;
      const px = x(time); c.beginPath(); c.moveTo(px, 0); c.lineTo(px, height); c.stroke();
      if (detail && px - lastLabel > 25 && px < width - 12) { c.fillText(String(label), px + 4, 15); lastLabel = px; }
    });
    const playhead = x(this.video.currentTime);
    if (playhead >= 0 && playhead <= width) { c.strokeStyle = '#af623b'; c.lineWidth = 2; c.beginPath(); c.moveTo(playhead, 0); c.lineTo(playhead, height); c.stroke(); }
  }
  private previewKey() {
    return JSON.stringify([this.source?.url, this.generation, this.selection, this.config()]);
  }
  private clearPreview() {
    this.preview?.dispose(); this.preview = undefined; this.prepared = undefined;
    this.el('animation-preview').hidden = true;
    this.el<HTMLButtonElement>('export-dance').disabled = true;
  }
  private checkPreview() {
    if (this.prepared && this.prepared.key !== this.previewKey()) {
      this.extraction?.abort();
      this.clearPreview();
      this.el('extraction-status').textContent = 'Selection or tracking settings changed. Extract a new preview before downloading.';
    }
  }
  private beginOperation() {
    const controller = this.extraction = new AbortController();
    this.video.pause(); this.auditioning = false; this.playButton(); this.busy(true);
    this.host.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>('button, input, select').forEach(el => { el.disabled = true; });
    this.el<HTMLButtonElement>('cancel-extraction').disabled = false; this.el('cancel-extraction').hidden = false;
    return controller;
  }
  private finishOperation(controller: AbortController) {
    if (this.extraction !== controller) return;
    this.extraction = undefined; this.busy(false);
    this.host.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>('button, input, select').forEach(el => { el.disabled = false; });
    this.el('cancel-extraction').hidden = true; this.el('extraction-progress').hidden = true; this.choose();
  }
  private async prepare() {
    if (!this.analysis || !this.selection || !this.source || this.extraction) return;
    const source = this.source, analysis = this.analysis, selection = this.selection, generation = this.generation;
    const config = this.config() ?? { solver: 'custom' as const, settings: DEFAULT_SETTINGS.custom, person: 0, numPoses: 1, confidence: .5 };
    const key = this.previewKey();
    this.clearPreview();
    const controller = this.beginOperation();
    this.el('extraction-progress').hidden = false; this.el<HTMLProgressElement>('extraction-progress').value = 0;
    let preview: AnimationPreview | undefined;
    try {
      const { extractAnimation } = await import('./animation-export');
      const data = await extractAnimation({ url: source.url, analysis, selection, ...config, signal: controller.signal,
        progress: (fraction, message) => { if (generation === this.generation) { this.el<HTMLProgressElement>('extraction-progress').value = fraction; this.el('extraction-status').textContent = message; } },
      });
      controller.signal.throwIfAborted();
      if (key !== this.previewKey()) throw new Error('Selection or tracking settings changed. Extract a new preview.');
      this.el('extraction-status').textContent = 'Loading animation loop preview…';
      const { AnimationPreview } = await import('./animation-preview');
      controller.signal.throwIfAborted();
      this.el('animation-preview').hidden = false;
      preview = this.preview = new AnimationPreview(this.el('animation-preview'));
      await preview.load(data, controller.signal);
      controller.signal.throwIfAborted();
      if (key !== this.previewKey()) throw new Error('Selection or tracking settings changed. Extract a new preview.');
      this.prepared = { data, key, source, selection };
      this.el('extraction-status').textContent = `Preview ready · ${data.quality.tracked_frames}/${data.quality.frames} frames tracked (${Math.round(data.quality.tracked_fraction * 100)}%). ${data.quality.held_frames} frames held the previous pose. Inspect the loop, then download.`;
    } catch (error) {
      if (this.preview === preview) this.clearPreview();
      if (generation === this.generation) this.el('extraction-status').textContent = controller.signal.aborted ? 'Extraction cancelled.' : `Preview failed: ${error instanceof Error ? error.message : String(error)}`;
    } finally { this.finishOperation(controller); }
  }
  private async export() {
    this.checkPreview();
    if (!this.prepared || this.extraction) return;
    const { data, source, selection } = this.prepared, generation = this.generation;
    const format = this.el<HTMLSelectElement>('animation-format').value;
    const controller = this.beginOperation();
    try {
      let blob: Blob;
      if (format === 'fbx') {
        if (data.duration_seconds > 600) throw new Error('FBX export supports clips up to 10 minutes. Choose a shorter selection or download JSON.');
        this.el('extraction-status').textContent = 'Checking FBX exporter…';
        const check = await fetch('/api/export/fbx', { signal: controller.signal });
        if (!check.ok) throw new Error((await check.json()).error || 'FBX exporter is unavailable.');
        this.el('extraction-status').textContent = 'Baking the previewed animation as a textured FBX…';
        const response = await fetch('/api/export/fbx', { method: 'POST', signal: controller.signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ schema: data.schema, rig: data.rig, animation: data.animation }),
        });
        if (!response.ok) throw new Error((await response.json()).error || 'FBX conversion failed.');
        blob = await response.blob();
      } else blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
      controller.signal.throwIfAborted();
      this.checkPreview(); controller.signal.throwIfAborted();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a'); link.href = url; link.download = `${source.name}.${selectionFileSuffix(selection)}.${format === 'fbx' ? 'fbx' : 'dance.json'}`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      if (generation === this.generation) this.el('extraction-status').textContent = `Downloaded ${selectionLabel(selection).toLowerCase()} as ${format.toUpperCase()} · Same animation as the preview.`;
    } catch (error) {
      if (generation === this.generation) this.el('extraction-status').textContent = controller.signal.aborted
        ? (this.prepared ? 'Download cancelled. Your preview is still available.' : 'Download cancelled. Extract a new preview before downloading.')
        : `Download failed: ${error instanceof Error ? error.message : String(error)}`;
    } finally { this.finishOperation(controller); }
  }
  dispose() {
    this.clearPreview();
    this.extraction?.abort(); this.request?.abort(); this.resize.disconnect(); cancelAnimationFrame(this.raf);
    this.video.removeEventListener('loadedmetadata', this.onMetadata); this.video.removeEventListener('ended', this.onEnded); this.video.removeEventListener('pause', this.onPause);
  }
}
