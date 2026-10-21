import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAnalysis, selectBars, selectFullVideo, selectedBars, selectionMetadata, selectionFileSuffix, excerptRhythm, sampleTimes } from '../src/audio-analysis.ts';

function fixture() {
  // Alternating 3/4 and 4/4, with a pickup before the first full detected bar.
  const beats = Array.from({ length: 501 }, (_, i) => .25 + i * .5);
  const indices = [2];
  for (let i = 0; i < 128; i++) indices.push(indices.at(-1) + (i % 2 ? 4 : 3));
  const bars = indices.slice(0, -1).map((a, i) => ({ index: i, start_seconds: beats[a], end_seconds: beats[indices[i + 1]],
    start_beat_index: a, end_beat_index: indices[i + 1], beat_count: indices[i + 1] - a, bpm: 120 }));
  return { schema: 'pose-studio.audio-analysis', version: 1, timebase: 'video-seconds',
    source: { name: 'dance.mp4', bytes: 100, mtime_ms: 1, sha256: 'a'.repeat(64) }, duration_seconds: 251,
    bpm: 120, beats_seconds: beats, downbeats_seconds: indices.map(i => beats[i]), bars, warnings: [],
    waveform: { encoding: 'min-max', start_seconds: 0, duration_seconds: 251, bin_seconds: 1, peaks: Array.from({ length: 251 }, () => [-.5, .5]) } };
}
test('4/8/16/32/64-bar selections use detected downbeats across changing meter', () => {
  const a = parseAnalysis(fixture(), { name: 'dance.mp4', bytes: 100 });
  for (const count of [4, 8, 16, 32, 64]) {
    const selection = selectBars(a, 3, count);
    assert.equal(selection.start, a.downbeats_seconds[3]);
    assert.equal(selection.end, a.downbeats_seconds[3 + count]);
    const clip = excerptRhythm(a, selection);
    assert.equal(clip.bars.length, count);
    assert.equal(clip.downbeats_seconds.length, count + 1);
    assert.equal(clip.downbeats_seconds[0], 0);
    assert.equal(clip.downbeats_seconds.at(-1), clip.duration_seconds);
    assert.equal(clip.beats_seconds.length, count * 3.5);
    assert.equal(clip.bars.at(-1).end_beat_index, clip.beats_seconds.length);
  }
  assert.equal(selectBars(a, 125, 4), undefined);
  assert.equal(selectBars(a, -1, 4), undefined);
  assert.equal(selectBars(a, .5, 4), undefined);
  assert.equal(selectBars(a, 0, 2), undefined);
});
test('beat offsets shift every boundary by beat index through tempo changes', () => {
  const a = fixture();
  a.beats_seconds = a.beats_seconds.map((t, i) => t + i * i * .002);
  a.downbeats_seconds = a.downbeats_seconds.map((_, i) => a.beats_seconds[i < a.bars.length ? a.bars[i].start_beat_index : a.bars.at(-1).end_beat_index]);
  a.bars.forEach(bar => { bar.start_seconds = a.beats_seconds[bar.start_beat_index]; bar.end_seconds = a.beats_seconds[bar.end_beat_index]; });
  for (const offset of [-2, -1, 1, 3]) {
    const s = selectBars(a, 3, 8, offset), bars = selectedBars(a, s), rhythm = excerptRhythm(a, s);
    assert.equal(s.start, a.beats_seconds[a.bars[3].start_beat_index + offset]);
    assert.equal(s.end, a.beats_seconds[a.bars[10].end_beat_index + offset]);
    assert.equal(bars.length, 8);
    assert.deepEqual(bars.map(b => b.beat_count), a.bars.slice(3, 11).map(b => b.beat_count));
    assert.equal(rhythm.downbeats_seconds[0], 0);
    assert.equal(rhythm.downbeats_seconds.at(-1), s.end - s.start);
    assert.equal(rhythm.beats_seconds.length, 28);
    assert.equal(rhythm.alignment, 'beat-offset');
    assert.equal(rhythm.beat_offset, offset);
    assert.equal(selectionMetadata(s).beat_offset, offset);
    assert.match(selectionFileSuffix(s), /beat-offset/);
    assert(bars.every(b => b.bpm > 0));
  }
  assert.equal(selectBars(a, 0, 4, -3), undefined);
  assert.equal(selectBars(a, 124, 4, 100), undefined);
  assert.equal(selectBars(a, 0, 4, .5), undefined);
});
test('complete video includes pickup and trailing sections and handles no beats', () => {
  const a = fixture(), s = selectFullVideo(250.9);
  assert.deepEqual(s, { kind: 'full', start: 0, end: 250.9 });
  const rhythm = excerptRhythm(a, s);
  assert.equal(rhythm.duration_seconds, 250.9);
  assert.equal(rhythm.beats_seconds[0], .25);
  assert.equal(rhythm.bars.length, a.bars.length);
  assert.equal(rhythm.bars[0].start_seconds, a.bars[0].start_seconds);
  assert.equal(selectionMetadata(s).bar_count, null);
  assert.equal(selectionMetadata(s).first_detected_bar, null);
  assert.equal(selectionFileSuffix(s), 'complete-video');
  assert.equal(selectFullVideo(NaN), undefined);
  assert.equal(selectFullVideo(Infinity), undefined);
  const empty = excerptRhythm({ ...a, bars: [], downbeats_seconds: [], beats_seconds: [] }, s);
  assert.deepEqual(empty.bars, []); assert.deepEqual(empty.beats_seconds, []);
  const shorter = excerptRhythm(a, selectFullVideo(a.bars[4].start_seconds + .2));
  assert.equal(shorter.bars.length, 4); // Do not pretend the partial last bar is complete.
});
test('sidecars reject mismatched sources, invalid timing and malformed waveforms', () => {
  assert.throws(() => parseAnalysis(fixture(), { name: 'other.mp4', bytes: 100 }), /different video/);
  for (const corrupt of [
    a => a.version = 2, a => a.beats_seconds[2] = NaN, a => a.bars[2].end_seconds += 1,
    a => a.waveform.peaks[0] = [1, -1], a => a.waveform.bin_seconds = Infinity,
    a => a.downbeats_seconds.reverse(), a => a.bpm = Infinity,
  ]) { const a = fixture(); corrupt(a); assert.throws(() => parseAnalysis(a, a.source)); }
});
test('sampling retains exact closing boundary without duplicate keys', () => {
  for (const duration of [8, 8.013, .001]) {
    const times = sampleTimes(duration);
    assert.equal(times[0], 0); assert.equal(times.at(-1), duration);
    assert(times.every((t, i) => i === 0 || t > times[i - 1]));
  }
  assert.throws(() => sampleTimes(Infinity));
});
