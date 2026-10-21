export type Bar = {
  index: number; start_seconds: number; end_seconds: number;
  start_beat_index: number; end_beat_index: number; beat_count: number; bpm: number;
};
export type AudioAnalysis = {
  schema: 'pose-studio.audio-analysis'; version: 1; timebase: 'video-seconds';
  source: { name: string; bytes: number; mtime_ms: number; sha256: string };
  duration_seconds: number; bpm: number | null; beats_seconds: number[]; downbeats_seconds: number[];
  bars: Bar[]; warnings: string[];
  waveform: { encoding: 'min-max'; start_seconds: number; duration_seconds: number; bin_seconds: number; peaks: [number, number][] };
};
export const BAR_COUNTS = [4, 8, 16, 32, 64] as const;
export type BarSelection = { kind: 'bars'; firstBar: number; count: number; beatOffset: number; start: number; end: number };
export type ClipSelection = BarSelection | { kind: 'full'; start: number; end: number };

export function parseAnalysis(value: unknown, source: { name: string; bytes: number }): AudioAnalysis {
  const a = value as AudioAnalysis;
  const invalid = () => { throw new Error('Invalid or incompatible audio analysis. Regenerate the sidecar.'); };
  if (!a || a.schema !== 'pose-studio.audio-analysis' || a.version !== 1 || a.timebase !== 'video-seconds') invalid();
  if (a.source?.name !== source.name || a.source?.bytes !== source.bytes) throw new Error('This analysis belongs to a different video.');
  if (!Number.isFinite(a.duration_seconds) || a.duration_seconds <= 0 || !Number.isFinite(a.source.mtime_ms) ||
      !/^[a-f0-9]{64}$/.test(a.source.sha256) || (a.bpm !== null && (!Number.isFinite(a.bpm) || a.bpm <= 0))) invalid();
  for (const times of [a.beats_seconds, a.downbeats_seconds]) {
    if (!Array.isArray(times) || times.length > 1000000 || times.some((t, i) =>
      !Number.isFinite(t) || t < 0 || t >= a.duration_seconds || (i > 0 && t <= times[i - 1]))) invalid();
  }
  if (!Array.isArray(a.bars) || a.bars.length !== Math.max(0, a.downbeats_seconds.length - 1)) invalid();
  a.bars.forEach((bar, i) => {
    if (bar.index !== i || bar.start_seconds !== a.downbeats_seconds[i] || bar.end_seconds !== a.downbeats_seconds[i + 1] ||
        !Number.isInteger(bar.start_beat_index) || !Number.isInteger(bar.end_beat_index) ||
        bar.start_seconds !== a.beats_seconds[bar.start_beat_index] || bar.end_seconds !== a.beats_seconds[bar.end_beat_index] ||
        bar.beat_count !== bar.end_beat_index - bar.start_beat_index || bar.beat_count < 1 ||
        !Number.isFinite(bar.bpm) || bar.bpm <= 0) invalid();
  });
  const w = a.waveform;
  if (!w || w.encoding !== 'min-max' || w.start_seconds !== 0 || w.duration_seconds !== a.duration_seconds ||
      !Number.isFinite(w.bin_seconds) || w.bin_seconds <= 0 || !Array.isArray(w.peaks) ||
      w.peaks.length < 1 || w.peaks.length > 30000 || Math.abs(w.bin_seconds * w.peaks.length - a.duration_seconds) > .001 ||
      w.peaks.some(p => !Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite) || p[0] < -1 || p[1] > 1 || p[0] > p[1])) invalid();
  if (!Array.isArray(a.warnings) || !a.warnings.every(warning => typeof warning === 'string')) invalid();
  return a;
}

export function selectBars(a: AudioAnalysis, firstBar: number, count: number, beatOffset = 0): BarSelection | undefined {
  if (!(BAR_COUNTS as readonly number[]).includes(count) || !Number.isInteger(firstBar) || firstBar < 0 ||
      firstBar + count > a.bars.length || !Number.isInteger(beatOffset)) return;
  const firstBeat = a.bars[firstBar].start_beat_index + beatOffset;
  const lastBeat = a.bars[firstBar + count - 1].end_beat_index + beatOffset;
  if (firstBeat < 0 || lastBeat >= a.beats_seconds.length) return;
  return { kind: 'bars', firstBar, count, beatOffset, start: a.beats_seconds[firstBeat], end: a.beats_seconds[lastBeat] };
}

export function selectFullVideo(duration: number): ClipSelection | undefined {
  if (!Number.isFinite(duration) || duration <= 0) return;
  return { kind: 'full', start: 0, end: duration };
}

/** Bar boundaries move by beat indices, preserving tempo changes and meter. */
export function selectedBars(a: AudioAnalysis, selection: ClipSelection): Bar[] {
  if (selection.kind === 'full') return a.bars.filter(bar => bar.start_seconds >= selection.start && bar.end_seconds <= selection.end);
  return a.bars.slice(selection.firstBar, selection.firstBar + selection.count).map(bar => {
    const start = bar.start_beat_index + selection.beatOffset, end = bar.end_beat_index + selection.beatOffset;
    return { ...bar, start_beat_index: start, end_beat_index: end, start_seconds: a.beats_seconds[start], end_seconds: a.beats_seconds[end],
      bpm: 60 * bar.beat_count / (a.beats_seconds[end] - a.beats_seconds[start]) };
  });
}

export function selectionLabel(s: ClipSelection): string { return s.kind === 'full' ? 'Complete video' : `${s.count} bars`; }

export function selectionMetadata(s: ClipSelection) {
  return { start_seconds: s.start, end_seconds: s.end, selection_mode: s.kind,
    first_detected_bar: s.kind === 'bars' ? s.firstBar + 1 : null,
    bar_count: s.kind === 'bars' ? s.count : null, beat_offset: s.kind === 'bars' ? s.beatOffset : 0 };
}

export function selectionFileSuffix(s: ClipSelection): string {
  return s.kind === 'full' ? 'complete-video' : `bars-${s.firstBar + 1}-${s.firstBar + s.count}${s.beatOffset ? `.beat-offset-${s.beatOffset > 0 ? '+' : ''}${s.beatOffset}` : ''}`;
}

export function excerptRhythm(a: AudioAnalysis, selection: ClipSelection) {
  const { start, end } = selection;
  const bars = selectedBars(a, selection);
  let baseBeat = a.beats_seconds.findIndex(time => time >= start);
  if (baseBeat < 0) baseBeat = a.beats_seconds.length;
  const detected = a.downbeats_seconds.filter(t => t >= start && t <= end).map(t => t - start);
  return {
    timebase: 'clip-seconds', duration_seconds: end - start,
    alignment: selection.kind === 'bars' && selection.beatOffset !== 0 ? 'beat-offset' : 'detected',
    beat_offset: selection.kind === 'bars' ? selection.beatOffset : 0,
    beats_seconds: a.beats_seconds.filter(t => t >= start && t < end).map(t => t - start),
    // Include the end boundary, so a consumer can reconstruct all complete bars.
    downbeats_seconds: selection.kind === 'bars' ? [...bars.map(b => b.start_seconds - start), end - start] : detected,
    detected_downbeats_seconds: detected,
    bars: bars.map((bar, i) => ({ ...bar, index: i,
      start_seconds: bar.start_seconds - start, end_seconds: bar.end_seconds - start,
      start_beat_index: bar.start_beat_index - baseBeat, end_beat_index: bar.end_beat_index - baseBeat })),
  };
}

export function sampleTimes(duration: number, fps = 30): number[] {
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(fps) || fps < 1 || duration * fps > 100000) throw new Error('Invalid or excessively long animation range.');
  const times = Array.from({ length: Math.ceil(duration * fps) }, (_, i) => i / fps);
  times.push(duration); // Exact closing keyframe; never shorten the last bar.
  return times;
}
