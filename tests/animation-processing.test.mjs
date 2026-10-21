import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AnimationClip, Quaternion, QuaternionKeyframeTrack, Vector3 } from 'three';
import { DEFAULT_PROCESSING, processAnimation, smoothRotations, beatAnchors, mappedTime } from '../src/animation-processing.ts';
const axis = new Vector3(0, 1, 0);
const rotations = angles => angles.flatMap(angle => new Quaternion().setFromAxisAngle(axis, angle).toArray());
const angles = values => Array.from({ length: values.length / 4 }, (_, i) => 2 * Math.atan2(values[i * 4 + 1], values[i * 4 + 3]));
function fixture() {
  const times = Array.from({ length: 61 }, (_, i) => i / 30);
  const tracks = ['Hips', 'Arm'].map(name => new QuaternionKeyframeTrack(`${name}.quaternion`, times, rotations(times.map(t => .5 * t))));
  return AnimationClip.toJSON(new AnimationClip('sample', 2, tracks));
}

test('centered smoothing reduces jitter without shifting a constant-speed motion', () => {
  const times = Array.from({ length: 61 }, (_, i) => i / 30);
  const clean = times.map(t => .5 * t), noisy = clean.map((a, i) => a + (i % 2 ? .025 : -.025));
  const result = angles(smoothRotations(times, rotations(noisy), 3, false));
  const error = result.slice(4, -4).reduce((sum, value, i) => sum + (value - clean[i + 4]) ** 2, 0);
  assert(error < .025 ** 2 * 53 * .1);
  const linear = angles(smoothRotations(times, rotations(clean), 3, false));
  for (let i = 4; i < 57; i++) assert(Math.abs(linear[i] - clean[i]) < 1e-8);
});

test('rotation averaging handles antipodal quaternions and keeps sharp accents stronger', () => {
  const times = Array.from({ length: 31 }, (_, i) => i / 30);
  const base = times.map((_, i) => i < 15 ? 0 : 1);
  const values = rotations(base);
  for (let i = 0; i < times.length; i += 2) for (let k = 0; k < 4; k++) values[i * 4 + k] *= -1;
  const plain = smoothRotations(times, values, 3, false), preserved = smoothRotations(times, values, 3, true);
  const target = new Quaternion().setFromAxisAngle(axis, 1);
  assert(new Quaternion().fromArray(preserved, 60).angleTo(target) < new Quaternion().fromArray(plain, 60).angleTo(target));
  for (let i = 0; i < times.length; i++) assert(Math.abs(new Quaternion().fromArray(preserved, i * 4).length() - 1) < 1e-9);
});

test('smoothing is symmetric in time including a fractional closing sample', () => {
  const times = [0, 1/30, 2/30, .09];
  const values = rotations([0, .2, -.1, .4]);
  const forward = smoothRotations(times, values, 3, true);
  const reverseTimes = [...times].reverse().map(t => .09 - t);
  const reverse = smoothRotations(reverseTimes, rotations([.4, -.1, .2, 0]), 3, true);
  for (let i = 0; i < times.length; i++) assert(new Quaternion().fromArray(forward, i * 4).angleTo(new Quaternion().fromArray(reverse, (3-i) * 4)) < 1e-7);
});

test('settings reuse immutable input, preserve duration and all bones, and move motion earlier with positive advance', () => {
  const raw = fixture(), original = JSON.stringify(raw);
  const off = processAnimation(raw, { ...DEFAULT_PROCESSING, smoothing: 'off' });
  const advanced = processAnimation(raw, { ...DEFAULT_PROCESSING, smoothing: 'off', advanceMs: 100 });
  processAnimation(raw, { ...DEFAULT_PROCESSING, smoothing: 'strong', beatStrength: 1 }, [.5, 1, 1.5]);
  assert.equal(JSON.stringify(raw), original);
  assert.equal(advanced.animation.duration, 2);
  assert.deepEqual(advanced.animation.tracks.map(t => t.name), raw.tracks.map(t => t.name));
  assert.deepEqual(advanced.animation.tracks[0].times, off.animation.tracks[0].times);
  const i = 15;
  assert(Math.abs(angles(advanced.animation.tracks[0].values)[i] - .3) < 1e-6);
  assert(Math.abs(angles(off.animation.tracks[0].values)[i] - .25) < 1e-6);
  assert.equal(advanced.processing.aligned_accents, 0);
});

test('beat alignment is optional, bounded, monotonic and keeps endpoints fixed', () => {
  const times = Array.from({ length: 61 }, (_, i) => i / 30);
  const energy = times.map((_, i) => i === 16 || i === 40 ? 8 : .1);
  const anchors = beatAnchors(times, energy, [.5, 1.4], 2, 1);
  assert.equal(anchors.length, 4);
  assert.deepEqual(beatAnchors(times, energy, [.5, 1.4], 2, 0), [{ output: 0, input: 0 }, { output: 2, input: 2 }]);
  assert.equal(beatAnchors(times, energy, [], 2, 1).length, 2);
  let last = -1;
  for (let t = 0; t <= 2; t += .001) {
    const source = mappedTime(t, anchors, 0, 2);
    assert(source >= last); assert(Math.abs(source - t) <= .080001); last = source;
  }
  assert.equal(mappedTime(0, anchors, 0, 2), 0);
  assert.equal(mappedTime(2, anchors, 0, 2), 2);
  assert(Math.abs(mappedTime(.5, anchors, 0, 2) - times[16]) < 1e-8);
});
