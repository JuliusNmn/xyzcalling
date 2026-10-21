import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalPose } from '../src/rig/solvers.ts';
import { DEFAULT_PROCESSING, mappedTime } from '../src/animation-processing.ts';
import { processMotionFrames } from '../src/motion-processing.ts';
import { buildMotionMetrics, motionExportChannels } from '../src/motion-metrics.ts';
import { ExtractionCache } from '../src/animation-cache.ts';
const duration = 2;
const identity = [{ output: 0, input: 0 }, { output: duration, input: duration }];
const options = { ...DEFAULT_PROCESSING, smoothing: 'balanced', preserveAccents: false };
function fixture(move = () => {}) {
  return Array.from({ length: 61 }, (_, i) => { const points = canonicalPose(); move(points, i); return { time_seconds: i / 30, world_landmarks: points }; });
}
function channel(data, name) { return data.channels.find(c => c.name === name); }
function metric(frames) { return buildMotionMetrics(frames, duration); }

test('position smoothing reduces derivative jitter, uses cached immutable landmarks and preserves constant motion timing', () => {
  const frames = fixture((p, i) => { p[15].x += i / 30 + (i % 2 ? .01 : -.01); });
  const before = JSON.stringify(frames);
  const processed = processMotionFrames(frames, duration, .5, options, identity);
  const rawSpeed = channel(metric(frames), 'left_hand_speed').values.slice(5, -5);
  const smoothSpeed = channel(metric(processed.frames), 'left_hand_speed').values.slice(5, -5);
  const error = values => values.reduce((s, v) => s + (v - 1) ** 2, 0);
  assert(error(smoothSpeed) < error(rawSpeed) * .05);
  assert.equal(JSON.stringify(frames), before);
  assert.deepEqual(processed, processMotionFrames(frames, duration, .5, options, identity));
  const linear = fixture((p, i) => { p[15].x += i / 30; });
  const filtered = processMotionFrames(linear, duration, .5, options, identity);
  for (let i = 5; i < 56; i++) assert(Math.abs(filtered.frames[i].world_landmarks[15].x - linear[i].world_landmarks[15].x) < 1e-9);
});

test('retimed signals and optional joints use the shared animation time map; speed reflects time warp', () => {
  const frames = fixture((p, i) => { p[15].x += i / 30; });
  const anchors = [{ output: 0, input: 0 }, { output: 1, input: 1.2 }, { output: 2, input: 2 }];
  const settings = { ...options, smoothing: 'off', advanceMs: 100 };
  const processed = processMotionFrames(frames, duration, .5, settings, anchors);
  for (let i = 0; i < processed.frames.length; i++) {
    const expected = mappedTime(i / 30, anchors, 100, duration);
    assert(Math.abs(processed.sourceTimes[i] - expected) < 1e-9);
    assert(Math.abs(processed.frames[i].world_landmarks[15].x - (.75 + expected)) < 1e-9);
  }
  const data = metric(processed.frames);
  assert(Math.abs(channel(data, 'left_hand_speed').values[10] - 1.2) < 1e-8);
  assert(Math.abs(channel(data, 'left_hand_speed').values[40] - .8) < 1e-8);
  const joints = motionExportChannels(data, true);
  assert.equal(joints.find(c => c.name === 'joint_15_x').values[10], processed.frames[10].world_landmarks[15].x);
  assert.equal(data.times[10], 10 / 30);
});

test('gaps and low-confidence landmarks remain invalid; smoothing never blends across them', () => {
  const frames = fixture((p, i) => { p[15].x = i < 30 ? 1 : 5; });
  frames[30].world_landmarks[15].visibility = .1;
  frames[40].world_landmarks = null;
  const processed = processMotionFrames(frames, duration, .5, options, identity);
  assert.equal(processed.frames[29].world_landmarks[15].x, 1);
  assert(Math.abs(processed.frames[31].world_landmarks[15].x - 5) < 1e-9);
  const data = metric(processed.frames);
  assert.equal(channel(data, 'hand_distance').valid[30], false);
  assert.equal(channel(data, 'hand_distance').valid[31], true);
  assert.equal(channel(data, 'left_hand_speed').valid[31], false);
  assert.equal(channel(data, 'body_acceleration').valid[42], false);
  const zeroThreshold = processMotionFrames(frames, duration, 0, options, identity);
  const zeroMetrics = buildMotionMetrics(zeroThreshold.frames, duration, 0);
  assert.equal(channel(zeroMetrics, 'body_speed').valid[40], false);
  assert(motionExportChannels(zeroMetrics, true, 0).every(c => c.values.every(Number.isFinite)));
});

test('Off and zero timing preserve raw metrics, and accent preservation retains a fast gesture', () => {
  const frames = fixture((p, i) => { p[15].x = i < 30 ? 1 : 2; });
  frames[20].world_landmarks = null;
  const off = processMotionFrames(frames, duration, .5, { ...options, smoothing: 'off' }, identity);
  assert.deepEqual(metric(off.frames).channels, metric(frames).channels);
  const smooth = processMotionFrames(frames, duration, .5, options, identity);
  const accents = processMotionFrames(frames, duration, .5, { ...options, preserveAccents: true }, identity);
  assert(2 - accents.frames[30].world_landmarks[15].x < 2 - smooth.frames[30].world_landmarks[15].x);
});

test('irregular closing samples are smoothed but excluded from uniform bclip data', () => {
  const frames = fixture().slice(0, 2); frames.push({ ...frames[1], time_seconds: .047 });
  const result = processMotionFrames(frames, .047, .5, options, [{ output: 0, input: 0 }, { output: .047, input: .047 }]);
  const data = buildMotionMetrics(result.frames, .047);
  assert.equal(data.times.length, 2); assert.deepEqual(data.times, [0, 1 / 30]);
  assert(motionExportChannels(data, true).every(c => c.values.every(Number.isFinite)));
});

test('animation and metrics share an extraction across smoothing changes, but not different tracking input', async () => {
  const cache = new ExtractionCache(); let calls = 0;
  const input = { url: 'blob:test-video', source: { name: 'test', bytes: 10 }, selection: { kind: 'full', start: 0, end: 2 },
    solver: 'custom', settings: { smoothing: .4, minVisibility: .5, legs: true }, person: 0, numPoses: 1, confidence: .5,
    signal: new AbortController().signal, progress() {} };
  const extract = async opts => { calls++; assert.equal(opts.offline, true); return { frames: fixture(), rhythm: null }; };
  const first = await cache.get(input, extract);
  const second = await cache.get({ ...input, settings: { ...input.settings, smoothing: .9 } }, extract);
  assert.equal(calls, 1); assert.equal(second.frames, first.frames);
  await cache.get({ ...input, person: 1 }, extract); assert.equal(calls, 2);
  const abort = new AbortController(); abort.abort();
  await assert.rejects(cache.get({ ...input, signal: abort.signal }, extract), { name: 'AbortError' });
  assert.equal(calls, 2);
});
