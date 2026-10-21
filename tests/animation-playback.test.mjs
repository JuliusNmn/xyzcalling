import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AnimationClip, Bone, Group, Quaternion, QuaternionKeyframeTrack, Vector3 } from 'three';
import { AnimationPlayback } from '../src/animation-playback.ts';

function fixture() {
  const root = new Group(), bone = new Bone(); bone.name = 'Hips'; root.add(bone);
  const rotation = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);
  const clip = new AnimationClip('extracted', 1, [new QuaternionKeyframeTrack('Hips.quaternion', [0, 1], [0, 0, 0, 1, ...rotation.toArray()])]);
  root.animations = [new AnimationClip('original bundled dance', 1, [new QuaternionKeyframeTrack('Hips.quaternion', [0, 1], [...rotation.toArray(), 0, 0, 0, 1])])];
  return { root, bone, clip, playback: new AnimationPlayback(root, clip) };
}
function near(actual, expected) { assert(Math.abs(actual - expected) < 1e-6, `${actual} != ${expected}`); }

test('preview loops the supplied bake across its seam without playing the original FBX dance', () => {
  const { bone, clip, playback } = fixture();
  const before = JSON.stringify(AnimationClip.toJSON(clip));
  playback.update(.75);
  near(bone.quaternion.angleTo(new Quaternion()), Math.PI * .375);
  playback.update(.5);
  near(playback.time, .25);
  near(bone.quaternion.angleTo(new Quaternion()), Math.PI * .125);
  assert.equal(JSON.stringify(AnimationClip.toJSON(clip)), before, 'Preview must not change downloaded animation');
  playback.dispose();
});

test('pause, speed, restart and scrubbing preserve the exact last pose and original clip duration', () => {
  const { bone, clip, playback } = fixture();
  playback.playing = false; playback.update(.5); near(playback.time, 0);
  playback.seek(1); near(playback.time, 1);
  near(bone.quaternion.angleTo(new Quaternion()), Math.PI / 2);
  playback.update(.5); near(playback.time, 1);
  playback.playing = true; playback.speed = .5; playback.update(.5); near(playback.time, .25);
  playback.seek(0); near(playback.time, 0);
  playback.speed = 2; playback.update(.2); near(playback.time, .4);
  near(clip.duration, 1);
  playback.dispose();
});
