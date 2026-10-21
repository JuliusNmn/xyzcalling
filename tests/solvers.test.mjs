import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AnimationMixer, LoadingManager, Texture, Vector3 } from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { MixamoRig, PoseRetargeter, LIMBS, CONTROLLED, canonicalPose, canonicalImage, cameraPoint, smoothingAlpha } from '../src/rig/solvers.ts';

const bytes = readFileSync(new URL('../amsterdam-hackathon/Geo/Chicken Dance.fbx', import.meta.url));
function loadCharacter() {
  // Read the real FBX in Node; skin geometry and bones are parsed, images are irrelevant to math tests.
  const manager = new LoadingManager();
  manager.addHandler(/.*/, { path: '', setPath() { return this; }, load() { return new Texture(); } });
  const character = new FBXLoader(manager).parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  character.scale.setScalar(.01); character.updateMatrixWorld(true);
  return character;
}
function makeRig() { return new MixamoRig(loadCharacter()); }
const unfiltered = { smoothing: 0, minVisibility: .5, legs: true };
function direction(rig, name, child) {
  return rig.bones.get(child).getWorldPosition(new Vector3()).sub(rig.bones.get(name).getWorldPosition(new Vector3())).normalize();
}
function snapshot(rig) { return [...rig.bones].map(([name, bone]) => [name, bone.quaternion.toArray(), bone.position.toArray()]); }
function raisedArm() {
  const points = canonicalPose();
  for (const [id, distance] of [[13, .25], [15, .5], [17, .55], [19, .55], [21, .55]]) {
    points[id].x = .25 + distance * Math.SQRT1_2;
    points[id].y = -.5 - distance * Math.SQRT1_2;
  }
  return points;
}

test('comparison characters have independent skinning, poses and smoothing history', () => {
  const character = loadCharacter(), copy = clone(character);
  const customRig = new MixamoRig(character), kalidoRig = new MixamoRig(copy);
  const custom = new PoseRetargeter(customRig), kalido = new PoseRetargeter(kalidoRig);
  const sourceSkins = [], cloneSkins = [];
  character.traverse(object => { if (object.isSkinnedMesh) sourceSkins.push(object); });
  copy.traverse(object => { if (object.isSkinnedMesh) cloneSkins.push(object); });
  assert(sourceSkins.length > 0);
  for (const [index, mesh] of sourceSkins.entries()) {
    assert.notEqual(mesh.skeleton, cloneSkins[index].skeleton);
    mesh.skeleton.bones.forEach((bone, i) => assert.notEqual(bone, cloneSkins[index].skeleton.bones[i]));
  }
  const neutral = canonicalPose(), raised = raisedArm();
  custom.update('custom', neutral, canonicalImage(neutral), 0, unfiltered);
  kalido.update('kalidokit', neutral, canonicalImage(neutral), 0, { ...unfiltered, smoothing: .9 });
  const before = snapshot(kalidoRig);
  assert.equal(custom.update('custom', raised, canonicalImage(raised), 1 / 30, unfiltered), 14);
  assert.deepEqual(snapshot(kalidoRig), before);
  const customPose = snapshot(customRig);
  // Kalidokit can leave a straight elbow undefined; valid rotations must still update.
  assert(kalido.update('kalidokit', raised, canonicalImage(raised), 1 / 30, { ...unfiltered, smoothing: .9 }) > 0);
  assert.notDeepEqual(snapshot(kalidoRig), before);
  assert.deepEqual(snapshot(customRig), customPose);
  kalido.reset();
  assert.deepEqual(snapshot(customRig), customPose);
});

test('custom solver matches known FBX limb directions across its original dance', () => {
  const source = loadCharacter(), target = makeRig(), sourceRig = new MixamoRig(source);
  const mixer = new AnimationMixer(source); mixer.clipAction(source.animations[0]).play();
  const solver = new PoseRetargeter(target);
  let maxError = 0;
  for (const time of [0, .4, .8, 1.2, 1.6, 2, 2.4, 2.8, 3.2, 3.6, 4, 4.4]) {
    mixer.setTime(time); source.updateMatrixWorld(true);
    const points = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 1 }));
    for (const [name, child, a, b] of LIMBS) {
      for (const [bone, index] of [[name, a], [child, b]]) {
        const point = sourceRig.bones.get(bone).getWorldPosition(new Vector3());
        points[index] = { x: point.x, y: -point.y, z: -point.z, visibility: 1 };
      }
    }
    assert.equal(solver.update('custom', points, undefined, time, unfiltered), 14);
    for (const [name, child, a, b] of LIMBS) {
      const expected = cameraPoint(points[b]).sub(cameraPoint(points[a])).normalize();
      maxError = Math.max(maxError, direction(target, name, child).angleTo(expected));
    }
  }
  assert(maxError < 0.001, `Maximum limb direction error: ${maxError} rad`);
});

test('Kalidokit neutral calibration preserves the actual FBX rest rotations', () => {
  const rig = makeRig(), solver = new PoseRetargeter(rig), world = canonicalPose();
  assert.equal(solver.update('kalidokit', world, canonicalImage(world), 0, unfiltered), 12);
  for (const name of CONTROLLED) assert(rig.bones.get(name).quaternion.angleTo(rig.restLocal.get(name)) < 1e-6, name);
});

test('Kalidokit maps an anatomical left arm raise to the left arm, and forward knee to forward depth', () => {
  const rig = makeRig(), solver = new PoseRetargeter(rig), world = raisedArm();
  const left = direction(rig, 'LeftArm', 'LeftForeArm'), right = direction(rig, 'RightArm', 'RightForeArm');
  solver.update('kalidokit', world, canonicalImage(world), 0, unfiltered);
  assert(direction(rig, 'LeftArm', 'LeftForeArm').y > left.y + .2);
  assert(direction(rig, 'RightArm', 'RightForeArm').angleTo(right) < 1e-6);
  solver.reset();
  const knee = canonicalPose(); knee[25].z = -.2; knee[25].y = .34641; knee[27].z = -.2; knee[27].y = .74641;
  const rest = direction(rig, 'LeftUpLeg', 'LeftLeg');
  solver.update('kalidokit', knee, canonicalImage(knee), 0, unfiltered);
  assert(direction(rig, 'LeftUpLeg', 'LeftLeg').z > rest.z + .2);
});

for (const kind of ['custom', 'kalidokit']) {
  test(`${kind}: smoothing reduces rotation jumps and preserves bone lengths`, () => {
    const smoothRig = makeRig(), rawRig = makeRig();
    const smooth = new PoseRetargeter(smoothRig), raw = new PoseRetargeter(rawRig);
    const neutral = canonicalPose(), raised = raisedArm();
    const settings = { ...unfiltered, smoothing: .9 };
    const positions = [...smoothRig.bones.values()].map(bone => bone.position.toArray());
    smooth.update(kind, neutral, canonicalImage(neutral), 0, settings);
    raw.update(kind, neutral, canonicalImage(neutral), 0, unfiltered);
    const before = smoothRig.bones.get('LeftArm').quaternion.clone();
    smooth.update(kind, raised, canonicalImage(raised), 1 / 30, settings);
    raw.update(kind, raised, canonicalImage(raised), 1 / 30, unfiltered);
    const filtered = before.angleTo(smoothRig.bones.get('LeftArm').quaternion);
    const unfilteredAngle = before.angleTo(rawRig.bones.get('LeftArm').quaternion);
    assert(unfilteredAngle > .1);
    assert(filtered < unfilteredAngle * .2);
    assert.deepEqual([...smoothRig.bones.values()].map(bone => bone.position.toArray()), positions);
  });

  test(`${kind}: missing, malformed, nonfinite and low-confidence data holds the last pose`, () => {
    const rig = makeRig(), solver = new PoseRetargeter(rig), world = raisedArm();
    solver.update(kind, world, canonicalImage(world), 0, unfiltered);
    const before = snapshot(rig);
    assert.equal(solver.update(kind, undefined, undefined, .03, unfiltered), 0);
    assert.equal(solver.update(kind, world.slice(0, 3), undefined, .06, unfiltered), 0);
    const invalid = structuredClone(world); invalid[11].x = NaN;
    assert.equal(solver.update(kind, invalid, canonicalImage(world), .09, unfiltered), 0);
    assert.equal(solver.update(kind, world.map(p => ({ ...p, visibility: 0 })), canonicalImage(world), .12, unfiltered), 0);
    assert.deepEqual(snapshot(rig), before);
  });

  test(`${kind}: resetting after a seek removes smoothing history and disables leg updates`, () => {
    const rig = makeRig(), solver = new PoseRetargeter(rig), world = raisedArm();
    solver.update(kind, world, canonicalImage(world), 1, unfiltered);
    solver.reset();
    for (const [name, bone] of rig.bones) assert(bone.quaternion.angleTo(rig.restLocal.get(name)) < 1e-6);
    const before = rig.bones.get('LeftUpLeg').quaternion.clone();
    solver.update(kind, world, canonicalImage(world), 0, { ...unfiltered, legs: false });
    assert(rig.bones.get('LeftUpLeg').quaternion.angleTo(before) < 1e-6);
  });
}

test('smoothing has the same response at 30 and 60 FPS', () => {
  const one = smoothingAlpha(.4, 1 / 30), half = smoothingAlpha(.4, 1 / 60);
  assert(Math.abs(one - (1 - (1 - half) ** 2)) < 1e-12);
  assert.equal(smoothingAlpha(0, 1 / 30), 1);
});
