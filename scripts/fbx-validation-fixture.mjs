// Drive the actual browser solver and baker with detected video landmarks.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { AnimationMixer, LoadingManager, Texture, Vector3, LoopOnce } from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { MixamoRig, PoseRetargeter, CONTROLLED, DEFAULT_SETTINGS } from '../src/rig/solvers.ts';
import { bakeAnimation } from '../src/animation-export.ts';
import { validateFbxPayload } from '../fbx-export-server.ts';

const directory = process.argv[2];
if (!directory) throw new Error('Usage: node --import tsx scripts/fbx-validation-fixture.mjs OUTPUT_DIRECTORY');
const manager = new LoadingManager();
manager.addHandler(/.*/, { path: '', setPath() { return this; }, load() { return new Texture(); } });
const bytes = readFileSync(new URL('../amsterdam-hackathon/Geo/Chicken Dance.fbx', import.meta.url));
function load() {
  const root = new FBXLoader(manager).parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  root.scale.multiplyScalar(.01); root.updateMatrixWorld(true);
  return root;
}
const input = JSON.parse(readFileSync(path.join(directory, 'landmarks.json'), 'utf8'));
const root = load(), rig = new MixamoRig(root), retargeter = new PoseRetargeter(rig);
const source = load(), sourceRig = new MixamoRig(source), mixer = new AnimationMixer(source);
const action = mixer.clipAction(source.animations[0]); action.setLoop(LoopOnce, 1); action.clampWhenFinished = true; action.play();
const skeleton = [...rig.bones.values()].map(b => ({ name: b.name, parent: b.parent?.isBone ? b.parent.name : null,
  position: b.position.toArray(), quaternion: b.quaternion.toArray(), scale: b.scale.toArray() }));
const rotations = new Map(CONTROLLED.map(name => [name, []]));
const expected = [], groundTruth = [], times = [];
const heads = r => Object.fromEntries([...r.bones].map(([name, bone]) => {
  const p = bone.getWorldPosition(new Vector3()); return [name, [p.x, -p.z, p.y]];
}));
for (const frame of input.frames) {
  times.push(frame.time);
  retargeter.update('custom', frame.world, frame.image, frame.time, DEFAULT_SETTINGS.custom);
  for (const name of CONTROLLED) rotations.get(name).push(...rig.bones.get(name).quaternion.toArray());
  expected.push(heads(rig)); mixer.setTime(frame.time); source.updateMatrixWorld(true); groundTruth.push(heads(sourceRig));
}
const payload = { schema: 'pose-studio.dance-animation', rig: {
  root_transform: { position: root.position.toArray(), quaternion: root.quaternion.toArray(), scale: root.scale.toArray() }, bones: skeleton,
}, animation: bakeAnimation(rig, times, rotations, 'Chicken Dance · MediaPipe full · Custom') };
validateFbxPayload(payload);
writeFileSync(path.join(directory, 'animation.json'), JSON.stringify(payload));
writeFileSync(path.join(directory, 'browser-joints.json'), JSON.stringify(expected));
writeFileSync(path.join(directory, 'ground-truth-joints.json'), JSON.stringify(groundTruth));
console.log(JSON.stringify({ frames: times.length, detected: input.detected_frames, bones: skeleton.length, duration: payload.animation.duration }));
