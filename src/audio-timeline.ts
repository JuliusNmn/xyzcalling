import type { AnimationSource } from './character-view';
import { CHARACTERS, characterOptions, characterDefinition, registerCharacter, DEFAULT_CHARACTER, type CharacterId } from './characters';
import { parseAnalysis, selectBars, selectFullVideo, selectRange, selectedBars, selectionLabel, selectionFileSuffix, type AudioAnalysis, type ClipSelection } from './audio-analysis';
import { LoadingManager, Texture } from 'three';
import { DEFAULT_SETTINGS, MixamoRig, type SolverKind, type SolverSettings } from './rig/solvers';
import type { DanceAnimation } from './animation-preview';
import type { RecordedAnimation } from './recorded-animation';
import { processAnimation, type AnimationProcessing } from './animation-processing';

export type AudioVideo = { name: string; bytes: number; url: string; analysisUrl?: string; browserOnly?: boolean; recordedAnimation?: RecordedAnimation };
export class AudioTimeline {
  private characterId: CharacterId = DEFAULT_CHARACTER;
  private source?: AudioVideo;
  private analysis?: AudioAnalysis;
  private selection?: ClipSelection;
  private loop = false;
  private barSelection?: ClipSelection;
  private invalidBars = false;
  private generation = 0;
  private request?: AbortController;
  private extraction?: AbortController;
  private externalBusy = false;
  private uploading = false;
  private prepared?: { key: string; data: DanceAnimation };
  private auditioning = false;
  private raf = 0;
  private lastDrawTime = -1;
  private resize: ResizeObserver;
  private onMetadata = () => {
    this.barSelection = undefined; this.invalidBars = false;
    for (const id of ['loop-start', 'loop-end']) this.el<HTMLInputElement>(id).max = String(this.video.duration);
    this.el<HTMLInputElement>('loop-start').value = '0';
    this.el<HTMLInputElement>('loop-end').value = String(Math.min(4, this.video.duration));
    this.choose();
  };
  private onPause = () => { if (!this.video.ended) { this.auditioning = false; this.playButton(); } };
  constructor(private host: HTMLElement, private video: HTMLVideoElement, private busy: (value: boolean) => void,
    private config: () => { solver: SolverKind; settings: SolverSettings; person: number; numPoses: number; confidence: number },
    private characterChanged: (id: CharacterId) => void = () => {},
    private animationSourceChanged: (source: AnimationSource) => void = () => {},
    private animationPrepared: (data?: DanceAnimation) => void = () => {}) {
    host.innerHTML = `
      <div class="export-heading"><div><span class="eyebrow">VIDEO TO ANIMATION</span><h2>Download your motion.</h2></div><span id="export-range" class="range-chip">Full video</span></div>
      <div class="export-setup">
        <label>Animation<select id="animation-source" aria-label="Animation source"><option value="gvhmr" disabled>GVHMR · unavailable</option><option value="custom">Custom · MediaPipe</option><option value="kalidokit">Kalidokit · MediaPipe</option></select></label>
        <label>Character FBX<select id="animation-character" aria-label="Character FBX">${characterOptions()}</select></label>
        <button id="upload-character" class="secondary-button">Upload FBX</button>
        <button id="reload-characters" class="text-button" aria-label="Refresh character directory">Refresh models</button>
        <input id="character-file" type="file" accept=".fbx" hidden />
      </div>
      <p id="character-status" class="audio-status" role="status">Choose a model from your directory or upload a Mixamo character FBX.</p>
      <div class="download-row">
        <button id="export-dance" class="secondary-button primary-action" disabled><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/></svg><span>Download FBX</span></button>
        <button id="edit-loop" class="secondary-button" popovertarget="loop-popover" disabled>Select a loop</button>
        <button id="use-full" class="text-button" hidden>Use full video</button>
        <button id="cancel-extraction" class="text-button" hidden>Cancel</button>
      </div>
      <progress id="extraction-progress" max="1" value="0" hidden aria-label="Animation export progress"></progress>
      <p id="extraction-status" class="audio-status" role="status">Choose a video, then download its full animation.</p>
      <div id="loop-popover" class="loop-popover" popover aria-labelledby="loop-title">
        <div class="popover-heading"><div><span class="eyebrow">OPTIONAL</span><h2 id="loop-title">Select a loop</h2></div><button class="text-button" popovertarget="loop-popover" popovertargetaction="hide" aria-label="Close loop selection">Close ×</button></div>
        <p class="audio-status">Choose a range, then use Download FBX on the main page.</p>
        <div class="phrase-controls time-controls"><label>Start (seconds)<input id="loop-start" type="number" min="0" step="0.01" value="0" /></label><label>End (seconds)<input id="loop-end" type="number" min="0" step="0.01" value="4" /></label></div>
        <div class="phrase-playback"><button id="play-phrase" class="secondary-button" disabled>Play selection</button><label><input id="loop-selection" type="checkbox" checked /> Repeat</label></div>
        <p id="selection-info" class="audio-status" role="status"></p>
        <div id="audio-content" hidden>
          <div class="wave-label"><span>Choose a starting bar</span><span id="audio-tempo"></span><span id="audio-position">0:00</span></div>
          <canvas id="wave-overview" class="wave-overview" role="img" aria-label="Full-track waveform and selected loop"></canvas>
          <div class="phrase-controls"><label>Start bar<input id="start-bar" type="number" min="1" value="1" step="1" /></label><label>Length<select id="bar-count"><option value="4">4 bars</option><option value="8">8 bars</option><option value="16">16 bars</option><option value="32">32 bars</option><option value="64">64 bars</option></select></label><label>Beat offset<input id="beat-offset" type="number" value="0" step="1" /></label></div>
          <div class="wave-label"><span>Selection detail</span></div><canvas id="wave-detail" class="wave-detail" role="img" aria-label="Selected loop waveform and beats"></canvas>
        </div>
        <p id="analysis-status" class="audio-status" role="status"></p>
        <div class="analysis-actions"><button id="reload-analysis" class="text-button">Reload beats</button><button id="import-analysis" class="text-button">Open beat analysis</button><input id="analysis-file" type="file" accept=".json,application/json" hidden /></div>
        <button id="apply-loop" class="secondary-button primary-action" disabled>Use this loop</button>
      </div>`;
    this.el('animation-character').addEventListener('change', () => void this.setCharacter(this.el<HTMLSelectElement>('animation-character').value));
    this.el('animation-source').addEventListener('change', () => { this.clearPrepared(); this.animationSourceChanged(this.getAnimationSource()); });
    this.el('upload-character').addEventListener('click', () => this.el<HTMLInputElement>('character-file').click());
    this.el('character-file').addEventListener('change', () => void this.uploadCharacter());
    this.el('reload-characters').addEventListener('click', () => void this.loadCharacters());
    this.el('reload-analysis').addEventListener('click', () => void this.loadAnalysis());
    this.el('import-analysis').addEventListener('click', () => this.el<HTMLInputElement>('analysis-file').click());
    this.el('analysis-file').addEventListener('change', () => void this.importAnalysis());
    for (const id of ['loop-start', 'loop-end']) this.el(id).addEventListener('input', () => { this.loop = true; this.barSelection = undefined; this.invalidBars = false; this.choose(); });
    for (const id of ['start-bar', 'bar-count', 'beat-offset']) this.el(id).addEventListener('input', () => this.chooseBars());
    this.el('wave-overview').addEventListener('click', event => {
      if (!this.analysis || this.locked()) return;
      const rect = this.el('wave-overview').getBoundingClientRect();
      const time = (event.clientX - rect.left) / rect.width * this.analysis.duration_seconds;
      const index = this.analysis.bars.findIndex(bar => bar.end_seconds > time);
      this.el<HTMLInputElement>('start-bar').value = String(Math.max(1, Math.min(index + 1, this.analysis.bars.length - Number(this.el<HTMLSelectElement>('bar-count').value) + 1)));
      this.chooseBars();
    });
    this.el('loop-popover').addEventListener('toggle', () => { this.refreshControls(); this.draw(); });
    this.el('apply-loop').addEventListener('click', () => { this.loop = true; this.choose(); this.el('loop-popover').hidePopover(); });
    this.el('use-full').addEventListener('click', () => { this.loop = false; this.auditioning = false; this.choose(); });
    this.el('play-phrase').addEventListener('click', () => void this.play());
    this.el('export-dance').addEventListener('click', () => void this.download());
    this.el('cancel-extraction').addEventListener('click', () => this.extraction?.abort());
    video.addEventListener('loadedmetadata', this.onMetadata); video.addEventListener('pause', this.onPause);
    this.resize = new ResizeObserver(() => this.draw()); this.resize.observe(this.el('loop-popover'));
    const tick = () => {
      if (this.auditioning && this.selection && !video.seeking && (video.currentTime >= this.selection.end || video.ended)) {
        if (this.el<HTMLInputElement>('loop-selection').checked) { video.currentTime = this.selection.start; void video.play().catch(() => { this.auditioning = false; this.playButton(); }); }
        else { this.auditioning = false; video.pause(); this.playButton(); }
      }
      if (video.currentTime !== this.lastDrawTime) this.draw();
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
    void this.loadCharacters();
  }
  private el<T extends HTMLElement = HTMLElement>(id: string) { return this.host.querySelector<T>(`#${id}`)!; }
  private locked() { return !!this.extraction || this.externalBusy || this.uploading; }
  private clearPrepared() { this.prepared = undefined; this.animationPrepared(); }
  getAnimationSource() { return this.el<HTMLSelectElement>('animation-source').value as AnimationSource; }
  setAnimationSource(source: AnimationSource) {
    if (this.locked() || (source === 'gvhmr' && !this.source?.recordedAnimation)) return;
    this.el<HTMLSelectElement>('animation-source').value = source; this.clearPrepared(); this.animationSourceChanged(source);
  }
  getCharacter() { return this.characterId; }
  async setCharacter(id: CharacterId) {
    if (this.locked()) { this.el<HTMLSelectElement>('animation-character').value = this.characterId; return; }
    characterDefinition(id); this.characterId = id;
    this.el<HTMLSelectElement>('animation-character').value = id; this.characterChanged(id);
  }
  setBusy(busy: boolean) { this.externalBusy = busy; this.refreshControls(); }
  private async loadCharacters() {
    try {
      const response = await fetch('/api/characters');
      if (!response.ok) throw new Error('Could not read the character directory.');
      const { characters } = await response.json();
      for (const character of characters) registerCharacter(character);
      this.el<HTMLSelectElement>('animation-character').replaceChildren(...characters.map((character: typeof CHARACTERS[number]) => new Option(character.name, character.id)));
      this.el<HTMLSelectElement>('animation-character').value = this.characterId;
      this.el('character-status').textContent = 'Models from your character directory · Upload a Mixamo character FBX to add another.';
    } catch (error) { this.el('character-status').textContent = String(error); }
  }
  private async uploadCharacter() {
    const input = this.el<HTMLInputElement>('character-file'), file = input.files?.[0]; input.value = '';
    if (!file || this.locked()) return;
    this.uploading = true; this.refreshControls();
    this.el('character-status').textContent = 'Checking character skeleton…';
    try {
      if (!/\.fbx$/i.test(file.name) || file.size > 100 * 1024 * 1024) throw new Error('Choose a character FBX smaller than 100 MB.');
      const [{ FBXLoader }, { disposeRecordedCharacter }] = await Promise.all([
        import('three/addons/loaders/FBXLoader.js'), import('./recorded-animation'),
      ]);
      const manager = new LoadingManager();
      manager.addHandler(/.*/, { load: () => new Texture(), setPath() { return this; } } as any);
      const model = new FBXLoader(manager).parse(await file.arrayBuffer(), '');
      try { new MixamoRig(model); } finally { disposeRecordedCharacter(model); }
      this.el('character-status').textContent = 'Adding character to your model directory…';
      const response = await fetch(`/api/characters?name=${encodeURIComponent(file.name)}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Character upload failed.');
      registerCharacter(result.character);
      await this.loadCharacters();
      this.uploading = false;
      await this.setCharacter(result.character.id);
      this.el('character-status').textContent = `${file.name} added. Preview and download use this character.`;
    } catch (error) { this.el('character-status').textContent = `Could not add character: ${error instanceof Error ? error.message : String(error)}`; }
    finally { this.uploading = false; this.refreshControls(); }
  }
  async setSource(source?: AudioVideo) {
    this.generation++; this.extraction?.abort(); this.request?.abort(); this.clearPrepared();
    this.source = source; this.analysis = undefined; this.loop = false; this.barSelection = undefined; this.invalidBars = false; this.selection = undefined; this.auditioning = false;
    this.el('loop-popover').hidePopover();
    this.el('audio-content').hidden = true;
    const option = this.el<HTMLSelectElement>('animation-source').querySelector<HTMLOptionElement>('[value="gvhmr"]')!;
    option.disabled = !source?.recordedAnimation; option.textContent = source?.recordedAnimation ? 'GVHMR · saved motion' : 'GVHMR · unavailable';
    this.el<HTMLSelectElement>('animation-source').value = source?.recordedAnimation ? 'gvhmr' : 'custom';
    this.animationSourceChanged(this.getAnimationSource());
    this.el('extraction-status').textContent = 'Download the full video, or select a loop.';
    this.choose(); await this.loadAnalysis();
  }
  private async loadAnalysis() {
    this.request?.abort(); const request = this.request = new AbortController(), generation = this.generation;
    this.analysis = undefined; this.el('audio-content').hidden = true;
    this.el('analysis-status').textContent = 'Use seconds to select a loop. Beat analysis is optional.';
    if (!this.source?.analysisUrl) return;
    try {
      const response = await fetch(this.source.analysisUrl, { signal: request.signal, cache: 'no-store' });
      if (!response.ok) return;
      const data = await response.json();
      if (generation === this.generation && !request.signal.aborted) this.acceptAnalysis(data);
    } catch (error) { if (!request.signal.aborted) this.el('analysis-status').textContent = `Beat analysis unavailable. You can still select a loop in seconds. ${error instanceof Error ? error.message : ''}`; }
  }
  private acceptAnalysis(value: unknown) {
    if (!this.source) return;
    const analysis = parseAnalysis(value, this.source);
    if (Number.isFinite(this.video.duration) && Math.abs(analysis.duration_seconds - this.video.duration) > .5) throw new Error('Analysis duration does not match this video.');
    this.analysis = analysis; this.el('audio-content').hidden = false;
    this.el('audio-tempo').textContent = analysis.bpm ? `${analysis.bpm.toFixed(1)} BPM` : '';
    this.el('analysis-status').textContent = 'Choose seconds above, or select detected bars.';
    this.el<HTMLInputElement>('start-bar').value = '1'; this.el<HTMLInputElement>('beat-offset').value = '0'; this.draw();
  }
  private async importAnalysis() {
    const input = this.el<HTMLInputElement>('analysis-file'), file = input.files?.[0]; input.value = '';
    if (!file || !this.source) return;
    const generation = this.generation; this.request?.abort();
    try {
      if (file.size > 20 * 1024 * 1024) throw new Error('Analysis JSON exceeds 20 MB.');
      const data = JSON.parse(await file.text()); if (generation === this.generation) this.acceptAnalysis(data);
    } catch (error) { this.el('analysis-status').textContent = String(error); }
  }
  private chooseBars() {
    if (!this.analysis || this.locked()) return;
    const selection = selectBars(this.analysis, Number(this.el<HTMLInputElement>('start-bar').value) - 1, Number(this.el<HTMLSelectElement>('bar-count').value), Number(this.el<HTMLInputElement>('beat-offset').value));
    this.loop = true; this.barSelection = selection; this.invalidBars = !selection;
    if (selection) {
      this.el<HTMLInputElement>('loop-start').value = String(selection.start);
      this.el<HTMLInputElement>('loop-end').value = String(selection.end);
    }
    this.choose(selection, true);
  }
  private range() {
    const start = this.el<HTMLInputElement>('loop-start').value, end = this.el<HTMLInputElement>('loop-end').value;
    return start.trim() && end.trim() && !this.invalidBars ? selectRange(Number(start), Number(end), this.video.duration) : undefined;
  }
  private choose(bars?: ClipSelection, useBars = false) {
    const previous = JSON.stringify(this.selection);
    this.selection = this.loop ? (useBars ? bars : this.barSelection ?? this.range()) : selectFullVideo(this.video.duration);
    if (previous !== JSON.stringify(this.selection)) { this.auditioning = false; this.clearPrepared(); }
    this.refreshControls(); this.playButton(); this.draw();
  }
  private refreshControls() {
    const locked = this.locked(), selection = this.selection;
    this.host.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>('button, input, select').forEach(input => { input.disabled = locked; });
    this.el<HTMLButtonElement>('export-dance').disabled = locked || !this.source || !selection;
    this.el<HTMLButtonElement>('edit-loop').disabled = locked || !this.source || !selectFullVideo(this.video.duration);
    this.el<HTMLButtonElement>('play-phrase').disabled = locked || !this.range();
    this.el<HTMLButtonElement>('apply-loop').disabled = locked || !this.range();
    this.el<HTMLButtonElement>('cancel-extraction').disabled = false;
    this.el('cancel-extraction').hidden = !this.extraction;
    this.el('use-full').hidden = !this.loop;
    this.el('export-range').textContent = this.loop ? selection ? `${selection.start.toFixed(2)}–${selection.end.toFixed(2)}s` : 'Invalid loop' : 'Full video';
    this.el('selection-info').textContent = this.invalidBars ? 'Choose a bar range and beat offset that fit inside this video.' : this.range() ? `${(this.range()!.end - this.range()!.start).toFixed(2)} seconds selected` : 'Choose an end after the start, within the video duration.';
  }
  private playButton() { this.el('play-phrase').textContent = this.auditioning ? 'Pause selection' : 'Play selection'; }
  private async play() {
    if (this.auditioning) { this.video.pause(); return; }
    this.loop = true; this.choose(); if (!this.selection) return;
    this.video.currentTime = this.selection.start; this.auditioning = true; this.playButton();
    try { await this.video.play(); } catch (error) { this.auditioning = false; this.playButton(); this.el('selection-info').textContent = String(error); }
  }
  private processingOptions(): AnimationProcessing { return { smoothing: 'light', preserveAccents: true, advanceMs: 0, beatStrength: 0 }; }
  private async download() {
    if (!this.source || !this.selection || this.locked()) return;
    const source = this.source, selection = { ...this.selection }, generation = this.generation, kind = this.getAnimationSource();
    const config = this.config(), character = this.characterId;
    const key = JSON.stringify([source.url, generation, selection, kind, config]);
    const controller = this.extraction = new AbortController();
    this.video.pause(); this.busy(true); this.refreshControls();
    this.el('extraction-progress').hidden = false;
    this.el<HTMLProgressElement>('extraction-progress').value = 0;
    try {
      if (selection.end - selection.start > 600) throw new Error('FBX export supports up to 10 minutes. Select a shorter loop.');
      this.el('extraction-status').textContent = 'Preparing FBX download…';
      const check = await fetch('/api/export/fbx', { signal: controller.signal });
      if (!check.ok) throw new Error((await check.json()).error || 'FBX exporter is unavailable.');
      let data = this.prepared?.key === key ? this.prepared.data : undefined;
      if (!data) {
        const raw = kind === 'gvhmr'
          ? await (await import('./recorded-animation')).extractRecordedAnimation(source, selection, this.analysis, controller.signal, text => { if (generation === this.generation) this.el('extraction-status').textContent = text; })
          : await (await import('./animation-cache')).extractCachedAnimation({ url: source.url, source, analysis: this.analysis, selection, ...config, solver: kind,
            settings: { ...DEFAULT_SETTINGS[kind], minVisibility: config.settings.minVisibility, legs: config.settings.legs }, signal: controller.signal,
            progress: (fraction, text) => { if (generation === this.generation) { this.el<HTMLProgressElement>('extraction-progress').value = fraction; this.el('extraction-status').textContent = text; } },
          });
        controller.signal.throwIfAborted();
        data = { ...raw, character_id: character, ...processAnimation(raw.animation, this.processingOptions(), raw.rhythm?.beats_seconds) };
        this.prepared = { key, data }; this.animationPrepared(data);
      }
      this.el<HTMLProgressElement>('extraction-progress').value = 1;
      this.el('extraction-status').textContent = `Creating ${characterDefinition(character).name} FBX…`;
      const response = await fetch('/api/export/fbx', { method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ schema: data.schema, character_id: character, rig: data.rig, animation: data.animation }),
      });
      if (!response.ok) throw new Error((await response.json()).error || 'FBX conversion failed.');
      const blob = await response.blob(); controller.signal.throwIfAborted();
      const url = URL.createObjectURL(blob), link = document.createElement('a');
      link.href = url; link.download = `${source.name.replace(/\.[^.]+$/, '')}.${character}.${kind}.${selectionFileSuffix(selection)}.fbx`;
      document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000);
      if (generation === this.generation) this.el('extraction-status').textContent = `${selectionLabel(selection)} downloaded · ${(selection.end - selection.start).toFixed(2)} seconds.`;
    } catch (error) {
      if (generation === this.generation) this.el('extraction-status').textContent = controller.signal.aborted ? 'Download cancelled.' : `Download failed: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      if (this.extraction === controller) { this.extraction = undefined; this.busy(false); this.el('extraction-progress').hidden = true; this.refreshControls(); }
    }
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
  dispose() {
    this.extraction?.abort(); this.request?.abort(); this.resize.disconnect(); cancelAnimationFrame(this.raf);
    this.video.removeEventListener('loadedmetadata', this.onMetadata); this.video.removeEventListener('pause', this.onPause);
  }
}
