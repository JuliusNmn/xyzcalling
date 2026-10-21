import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildMotionMetrics, motionExportChannels, METRICS } from '../src/motion-metrics.ts';
import { encodeBclip } from '../src/bclip.ts';
import { canonicalPose } from '../src/rig/solvers.ts';
const frames = poses => poses.map((world_landmarks, i) => ({ time_seconds: i / 30, world_landmarks }));
const metric = (data, name) => data.channels.find(c => c.name === name);
const near = (a, b) => assert(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test('20 independent channels describe a known static pose in physical units', () => {
  const p = canonicalPose(), data = buildMotionMetrics(frames([p, p, p]), .1);
  assert.equal(METRICS.length, 20); assert.equal(new Set(METRICS.map(m => m[0])).size, 20);
  for (const c of data.channels) { assert.equal(c.values.length, 3); assert(c.values.every(Number.isFinite)); }
  for (const name of ['body_speed', 'left_hand_speed', 'right_hand_speed', 'left_foot_speed', 'right_foot_speed']) {
    assert.deepEqual(metric(data, name).values, [0, 0, 0]); assert.deepEqual(metric(data, name).valid, [false, true, true]);
  }
  assert.deepEqual(metric(data, 'body_acceleration').valid, [false, false, true]);
  near(metric(data, 'hand_distance').values[0], Math.hypot(p[15].x-p[16].x, p[15].y-p[16].y, p[15].z-p[16].z));
  near(metric(data, 'torso_lean').values[0], 0); near(metric(data, 'torso_twist').values[0], 0);
  for (const side of ['left', 'right']) {
    near(metric(data, `${side}_elbow_angle`).values[0], 180);
    near(metric(data, `${side}_knee_angle`).values[0], 180);
    near(metric(data, `${side}_arm_reach`).values[0], 1);
  }
});
test('known velocity and acceleration use seconds, and hip translation is removed', () => {
  const poses = [0, .1, .3].map((x, i) => {
    const p = canonicalPose(); p[15].x += x;
    for (const point of p) { point.x += i * 5; point.y += i * 2; point.z -= i; }
    return p;
  });
  const data = buildMotionMetrics(frames(poses), .1);
  near(metric(data, 'left_hand_speed').values[1], 3); near(metric(data, 'left_hand_speed').values[2], 6);
  near(metric(data, 'body_speed').values[1], 3 / 12); near(metric(data, 'body_acceleration').values[2], 7.5);
  near(metric(data, 'right_hand_speed').values[2], 0);
});
test('bent arm, raised hand and tilted torso have known geometry', () => {
  const p = canonicalPose();
  p[11] = {x:0,y:-1,z:0}; p[13] = {x:1,y:-1,z:0}; p[15] = {x:1,y:-2,z:0};
  p[12] = {x:2,y:-1,z:0}; p[23] = {x:-.5,y:0,z:0}; p[24] = {x:.5,y:0,z:0};
  const data = buildMotionMetrics(frames([p]), 1/30);
  near(metric(data, 'left_elbow_angle').values[0], 90);
  near(metric(data, 'left_arm_reach').values[0], Math.SQRT1_2);
  near(metric(data, 'left_hand_height').values[0], 2);
  near(metric(data, 'torso_lean').values[0], 45);
});
test('missing, low-confidence and degenerate joints stay finite, with no derivative across gaps', () => {
  const low = canonicalPose(); low[15].visibility = .1;
  const bad = canonicalPose(); bad[15].x = NaN;
  const recovered = canonicalPose(); recovered[15].x += 10;
  const data = buildMotionMetrics(frames([canonicalPose(), low, null, bad, recovered, recovered, recovered]), 7/30);
  assert.deepEqual(metric(data, 'hand_distance').valid, [true, false, false, false, true, true, true]);
  assert.deepEqual(metric(data, 'left_hand_speed').valid, [false, false, false, false, false, true, true]);
  assert.deepEqual(metric(data, 'body_acceleration').valid, [false, false, false, false, false, false, true]);
  assert(metric(data, 'right_hand_height').valid[1]);
  const degenerate = Array.from({length:33}, () => ({x:0,y:0,z:0,visibility:1}));
  for (const c of buildMotionMetrics(frames([degenerate]), 1/30).channels) assert(c.values.every(Number.isFinite));
  assert.equal(metric(buildMotionMetrics(frames([degenerate]), 1/30), 'left_elbow_angle').valid[0], false);
});
test('non-integral loop boundaries exclude closing key and use uniform clip time', () => {
  const input = frames(Array.from({length:4}, canonicalPose)); input.push({time_seconds:.105,world_landmarks:canonicalPose()});
  const data = buildMotionMetrics(input, .105);
  assert.deepEqual(data.times, [0,1/30,2/30,.1]);
  const channels = motionExportChannels(data, true);
  assert.equal(channels.length, 173); // 20 metrics + 20 validity + time + 33 × (xyz + valid)
  assert(channels.every(c => c.values.length === 4));
  assert.equal(channels.find(c => c.name === 'joint_15_valid').values[0], 1);
  assert.throws(() => buildMotionMetrics([{time_seconds:NaN,world_landmarks:null}], 1/30), /uniformly/);
  assert.throws(() => buildMotionMetrics(input, 1), /uniformly/);
});
test('bclip output exactly matches TouchDesigner 2023.11760 native export', () => {
  const bytes = encodeBclip([{name:'hand_distance',values:[0,.25,1,-2]},{name:'hand_distance_valid',values:[1,1,0,1]}]);
  const reference = readFileSync(new URL('./fixtures/touchdesigner-reference.bclip', import.meta.url));
  assert.deepEqual(Buffer.from(bytes), reference);
});
test('bclip rejects malformed channel sets instead of producing corrupt downloads', () => {
  assert.throws(() => encodeBclip([]));
  assert.throws(() => encodeBclip([{name:'a',values:[1]},{name:'a',values:[2]}]), /unique/);
  assert.throws(() => encodeBclip([{name:'a',values:[1]},{name:'b',values:[2,3]}]), /equal/);
  assert.throws(() => encodeBclip([{name:'a',values:[Infinity]}]), /finite/);
  assert.throws(() => encodeBclip([{name:'a',values:[1e40]}]), /finite/);
  assert.throws(() => encodeBclip([{name:'a',values:[1]}], 0));
});

test('body speed tolerates partial occlusion while acceleration rejects support changes', () => {
  const visible = canonicalPose(), partial = canonicalPose(), hidden = canonicalPose();
  partial[15].visibility = 0;
  for (const id of [11, 12, 13, 14, 15, 16, 25, 26]) hidden[id].visibility = 0;
  const data = buildMotionMetrics(frames([visible, visible, partial, partial, hidden]), 5 / 30);
  assert.deepEqual(metric(data, 'body_speed').valid, [false, true, true, true, false]);
  assert.deepEqual(metric(data, 'body_acceleration').valid, [false, false, false, true, false]);
  assert(metric(data, 'body_speed').values.every(v => v === 0));
});
