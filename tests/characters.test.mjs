import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AnimationClip, AnimationMixer, LoadingManager, Texture, Vector3, Quaternion, QuaternionKeyframeTrack, VectorKeyframeTrack } from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { characterDefinition } from '../src/characters.ts';
import { characterRig, retargetAnimation } from '../src/character-animation.ts';
import { MixamoRig, PoseRetargeter, canonicalPose, canonicalImage } from '../src/rig/solvers.ts';
import { validateFbxPayload } from '../fbx-export-server.ts';

function loadCharacter(id) {
  const manager = new LoadingManager();
  manager.addHandler(/.*/, { path: '', setPath() { return this; }, load() { return new Texture(); } });
  const bytes = readFileSync(new URL('../' + characterDefinition(id).file, import.meta.url));
  const model = new FBXLoader(manager).parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  model.scale.multiplyScalar(.01); model.updateMatrixWorld(true); return model;
}
test('hand-built green FBX has a complete rig, rigid segments, green material and no source dance', () => {
  const model = loadCharacter('green-segments'), rig = new MixamoRig(model);
  assert.equal(rig.bones.size, 65); assert.equal(model.animations.length, 0);
  let meshes = 0;
  model.traverse(mesh => {
    if (!mesh.isSkinnedMesh) return;
    meshes++;
    assert(mesh.geometry.attributes.position.count < 3000);
    const weights = mesh.geometry.attributes.skinWeight;
    for (let i = 0; i < weights.count; i++) { assert.equal(weights.getX(i), 1); assert.equal(weights.getY(i), 0); }
    assert(mesh.material.color.g > mesh.material.color.r * 5);
  });
  assert.equal(meshes, 1);
  for (const solver of ['custom', 'kalidokit']) {
    const retargeter = new PoseRetargeter(rig), pose = canonicalPose();
    assert(retargeter.update(solver, pose, canonicalImage(pose), 0, { smoothing: 0, minVisibility: .5, legs: true }) >= 12);
    retargeter.reset();
  }
});
test('model retargeting preserves world rotation deltas, root travel and fractional duration', () => {
  const source = loadCharacter('chicken'), target = loadCharacter('green-segments');
  const sourceRig = characterRig(source), targetRig = characterRig(target);
  const hips = sourceRig.bones.find(b => b.name === 'mixamorigHips');
  const arm = sourceRig.bones.find(b => b.name === 'mixamorigLeftArm');
  const twist = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), .8);
  const animation = AnimationClip.toJSON(new AnimationClip('test', .047, [
    new QuaternionKeyframeTrack(arm.name + '.quaternion', [0, .047], [...arm.quaternion, ...new Quaternion().fromArray(arm.quaternion).multiply(twist).toArray()]),
    new QuaternionKeyframeTrack(hips.name + '.quaternion', [0, .047], [...hips.quaternion, ...hips.quaternion]),
    new VectorKeyframeTrack(hips.name + '.position', [0, .047], [...hips.position, hips.position[0] + 50, hips.position[1] + 20, hips.position[2] - 10]),
  ]));
  const before = JSON.stringify(animation);
  const converted = retargetAnimation(animation, sourceRig, targetRig);
  assert.equal(converted.duration, .047); assert.equal(JSON.stringify(animation), before);
  const originalPosition = source.getObjectByName(hips.name).getWorldPosition(new Vector3());
  const targetPosition = target.getObjectByName(hips.name).getWorldPosition(new Vector3());
  const restSource = source.getObjectByName(arm.name).getWorldQuaternion(new Quaternion());
  const restTarget = target.getObjectByName(arm.name).getWorldQuaternion(new Quaternion());
  for (const [model, clip] of [[source, AnimationClip.parse(animation)], [target, converted]]) {
    const mixer = new AnimationMixer(model), action = mixer.clipAction(clip).play();
    action.time = .047; action.paused = true; mixer.update(0); model.updateMatrixWorld(true);
  }
  const deltaSource = source.getObjectByName(arm.name).getWorldQuaternion(new Quaternion()).multiply(restSource.invert());
  const deltaTarget = target.getObjectByName(arm.name).getWorldQuaternion(new Quaternion()).multiply(restTarget.invert());
  assert(deltaSource.normalize().angleTo(deltaTarget.normalize()) < 1e-5, `rotation error ${deltaSource.angleTo(deltaTarget)}`);
  const travelSource = source.getObjectByName(hips.name).getWorldPosition(new Vector3()).sub(originalPosition);
  const travelTarget = target.getObjectByName(hips.name).getWorldPosition(new Vector3()).sub(targetPosition);
  assert(travelSource.distanceTo(travelTarget) < 1e-5);
  const payload = { schema: 'pose-studio.dance-animation', character_id: 'green-segments', rig: sourceRig, animation };
  validateFbxPayload(payload);
  assert.throws(() => validateFbxPayload({ ...payload, character_id: '../../private' }), /Unknown character/);
});

test('saved GVHMR plays on both character models at video timestamps without audio or landmarks', async () => {
  const { loadRecordedMotion, disposeRecordedCharacter } = await import('../src/recorded-animation.ts');
  const { AnimationPlayback } = await import('../src/animation-playback.ts');
  const originalFetch = globalThis.fetch, originalWindow = globalThis.window;
  const bytes = readFileSync(new URL('../videos/officialnickkosir_7696989498051202335.gvhmr.fbx', import.meta.url));
  globalThis.window = { URL };
  let requests = 0;
  globalThis.fetch = async () => { requests++; return new Response(bytes); };
  const models = [], players = [];
  try {
    const asset = { url: '/saved-motion-test', revision: '1' };
    const motion = await loadRecordedMotion(asset, new AbortController().signal);
    assert.equal(motion.rig.bones.length, 65);
    assert.equal(motion.animation.tracks.length, 195);
    assert(Math.abs(motion.animation.duration - 9.9) < 1e-5);
    const original = JSON.stringify(motion);
    const source = AnimationClip.parse(motion.animation).tracks.find(t => t.name === 'mixamorigHips.position').createInterpolant();
    const first = new Vector3().fromArray(source.evaluate(0));
    for (const id of ['chicken', 'green-segments']) {
      const model = loadCharacter(id); models.push(model);
      const player = new AnimationPlayback(model, retargetAnimation(motion.animation, motion.rig, characterRig(model))); players.push(player);
      player.playing = false;
      const root = model.getObjectByName('mixamorigHips'), start = root.getWorldPosition(new Vector3());
      // Forward, backward, repeat, and a video-container tail past the last key.
      for (const time of [2, 6, .5, .5, 9.91, 0]) {
        player.seek(time); model.updateMatrixWorld(true);
        const expected = new Vector3().fromArray(source.evaluate(Math.min(time, motion.animation.duration))).sub(first)
          .multiply(new Vector3().fromArray(motion.rig.root_transform.scale))
          .applyQuaternion(new Quaternion().fromArray(motion.rig.root_transform.quaternion));
        assert(root.getWorldPosition(new Vector3()).sub(start).distanceTo(expected) < 1e-5);
      }
    }
    await loadRecordedMotion(asset, new AbortController().signal);
    assert.equal(requests, 1, 'both previews reuse the downloaded FBX');
    assert.equal(JSON.stringify(motion), original);
    const abort = new AbortController(); abort.abort();
    await assert.rejects(loadRecordedMotion(asset, abort.signal), { name: 'AbortError' });
  } finally {
    players.forEach(player => player.dispose()); models.forEach(disposeRecordedCharacter);
    globalThis.fetch = originalFetch; globalThis.window = originalWindow;
  }
});
