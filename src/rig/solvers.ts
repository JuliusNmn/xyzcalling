import { Bone, Euler, Matrix4, Object3D, Quaternion, Vector3 } from 'three';
import { Pose } from 'kalidokit/dist/kalidokit.es.js';
import type { TPose, XYZ } from 'kalidokit';

export type Landmark = { x: number; y: number; z: number; visibility?: number };
export type SolverKind = 'custom' | 'kalidokit';
export type SolverSettings = { smoothing: number; minVisibility: number; legs: boolean };
export const DEFAULT_SETTINGS: Record<SolverKind, SolverSettings> = {
  custom: { smoothing: 0.4, minVisibility: 0.5, legs: true },
  kalidokit: { smoothing: 0.65, minVisibility: 0.5, legs: true },
};
export const LIMBS = [
  ['LeftArm', 'LeftForeArm', 11, 13], ['LeftForeArm', 'LeftHand', 13, 15],
  ['RightArm', 'RightForeArm', 12, 14], ['RightForeArm', 'RightHand', 14, 16],
  ['LeftUpLeg', 'LeftLeg', 23, 25], ['LeftLeg', 'LeftFoot', 25, 27],
  ['RightUpLeg', 'RightLeg', 24, 26], ['RightLeg', 'RightFoot', 26, 28],
  ['LeftFoot', 'LeftToeBase', 27, 31], ['RightFoot', 'RightToeBase', 28, 32],
] as const;
const TORSO = ['Hips', 'Spine', 'Spine1', 'Spine2'];
export const CONTROLLED = [...TORSO, ...LIMBS.map(limb => limb[0])];

export function cameraPoint(point: Landmark): Vector3 {
  // Same conversion as the Blender pilot, followed by Blender Z-up -> Three Y-up.
  return new Vector3(point.x, -point.y, -point.z);
}
function basis(right: Vector3, up: Vector3): Quaternion | undefined {
  if (up.length() < 0.05) return;
  up = up.clone().normalize();
  right = right.clone().addScaledVector(up, -right.dot(up));
  if (right.length() < 0.01) return;
  right.normalize();
  return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(right, up, right.clone().cross(up).normalize()));
}
export function validLandmarks(points: Landmark[] | undefined): points is Landmark[] {
  return !!points && points.length === 33 && points.every(p =>
    [p.x, p.y, p.z].every(Number.isFinite) && (p.visibility === undefined || Number.isFinite(p.visibility)));
}
function reliable(points: Landmark[], threshold: number, ...indices: number[]): boolean {
  return indices.every(index => (points[index].visibility ?? 1) >= threshold);
}
/** Retention at 30 FPS; 0 means unfiltered. Compensation keeps strength stable at other rates. */
export function smoothingAlpha(smoothing: number, seconds: number): number {
  return 1 - Math.pow(Math.min(0.95, Math.max(0, smoothing)), Math.max(0.001, seconds) * 30);
}

export class MixamoRig {
  readonly bones = new Map<string, Bone>();
  readonly restLocal = new Map<string, Quaternion>();
  readonly restWorld = new Map<string, Quaternion>();
  readonly axes = new Map<string, Vector3>();
  readonly hipBasis: Quaternion;
  readonly chestBasis: Quaternion;
  private readonly positions = new Map<string, Vector3>();

  constructor(readonly root: Object3D) {
    root.updateMatrixWorld(true);
    root.traverse(object => {
      if (!(object as Bone).isBone) return;
      const bone = object as Bone;
      const name = bone.name.replace(/^.*:/, '').replace(/^mixamorig/, '');
      this.bones.set(name, bone);
      this.restLocal.set(name, bone.quaternion.clone());
      this.restWorld.set(name, bone.getWorldQuaternion(new Quaternion()));
      this.positions.set(name, bone.position.clone());
    });
    const required = new Set([...CONTROLLED, ...LIMBS.map(limb => limb[1])]);
    const missing = [...required].filter(name => !this.bones.has(name));
    if (missing.length) throw new Error(`Missing Mixamo bones: ${missing.join(', ')}`);
    const position = (name: string) => this.bones.get(name)!.getWorldPosition(new Vector3());
    const hips = position('LeftUpLeg').add(position('RightUpLeg')).multiplyScalar(0.5);
    const chest = position('LeftArm').add(position('RightArm')).multiplyScalar(0.5);
    const up = chest.sub(hips);
    this.hipBasis = basis(position('RightUpLeg').sub(position('LeftUpLeg')), up)!;
    this.chestBasis = basis(position('RightArm').sub(position('LeftArm')), up)!;
    if (!this.hipBasis || !this.chestBasis) throw new Error('Character has a degenerate rest pose');
    for (const [name, child] of LIMBS) {
      // FBX axes differ from Blender bones: derive the long axis from the actual rig.
      this.axes.set(name, position(child).sub(position(name)).normalize()
        .applyQuaternion(this.restWorld.get(name)!.clone().invert()));
    }
  }

  reset() {
    for (const [name, bone] of this.bones) {
      bone.quaternion.copy(this.restLocal.get(name)!);
      bone.position.copy(this.positions.get(name)!);
    }
    this.root.updateMatrixWorld(true);
  }

  setLocal(name: string, target: Quaternion, alpha: number) {
    if (!target.toArray().every(Number.isFinite)) return false;
    const bone = this.bones.get(name)!;
    bone.quaternion.slerp(target.normalize(), alpha).normalize();
    bone.updateWorldMatrix(false, true);
    return true;
  }

  setWorld(name: string, target: Quaternion, alpha: number) {
    const bone = this.bones.get(name)!;
    const parent = bone.parent!.getWorldQuaternion(new Quaternion());
    return this.setLocal(name, parent.invert().multiply(target), alpha);
  }
}

/** Port of mocap/blender_retarget.py: torso bases + rest-aware limb swing. */
function custom(rig: MixamoRig, world: Landmark[], settings: SolverSettings, alpha: number): number {
  const points = world.map(cameraPoint);
  let updated = 0;
  if (reliable(world, settings.minVisibility, 11, 12, 23, 24)) {
    const hips = points[23].clone().add(points[24]).multiplyScalar(0.5);
    const chest = points[11].clone().add(points[12]).multiplyScalar(0.5);
    const up = chest.sub(hips);
    const hip = basis(points[24].clone().sub(points[23]), up);
    const shoulder = basis(points[12].clone().sub(points[11]), up);
    if (hip && shoulder) {
      hip.multiply(rig.hipBasis.clone().invert());
      shoulder.multiply(rig.chestBasis.clone().invert());
      updated += Number(rig.setWorld('Hips', hip.clone().multiply(rig.restWorld.get('Hips')!), alpha));
      for (const [index, name] of ['Spine', 'Spine1', 'Spine2'].entries()) {
        const rotation = hip.clone().slerp(shoulder, (index + 1) / 3).multiply(rig.restWorld.get(name)!);
        updated += Number(rig.setWorld(name, rotation, alpha));
      }
    }
  }
  for (const [name, , a, b] of LIMBS) {
    if (!settings.legs && a >= 23) continue;
    if (!reliable(world, settings.minVisibility, a, b)) continue;
    const direction = points[b].clone().sub(points[a]);
    if (direction.length() < 0.01) continue;
    const rotation = rig.bones.get(name)!.getWorldQuaternion(new Quaternion());
    const current = rig.axes.get(name)!.clone().applyQuaternion(rotation).normalize();
    const swing = new Quaternion().setFromUnitVectors(current, direction.normalize());
    updated += Number(rig.setWorld(name, swing.multiply(rotation), alpha));
  }
  return updated;
}

/** Same neutral fixture as mocap/solve_kalidokit.cjs. */
export function canonicalPose(): Landmark[] {
  const world = Array.from({ length: 33 }, () => ({ x: 0, y: -0.5, z: 0, visibility: 1 }));
  const set = (i: number, x: number, y: number, z = 0) => { world[i] = { x, y, z, visibility: 1 }; };
  set(11, .25, -.5); set(12, -.25, -.5);
  set(13, .5, -.5); set(14, -.5, -.5); set(15, .75, -.5); set(16, -.75, -.5);
  for (const i of [17, 19, 21]) set(i, .8, -.5);
  for (const i of [18, 20, 22]) set(i, -.8, -.5);
  set(23, .12, 0); set(24, -.12, 0); set(25, .12, .4); set(26, -.12, .4);
  set(27, .12, .8); set(28, -.12, .8); set(29, .12, .8, .02); set(30, -.12, .8, .02);
  set(31, .12, .8, -.15); set(32, -.12, .8, -.15);
  return world;
}
export function canonicalImage(world: Landmark[]): Landmark[] {
  return world.map(p => ({ ...p, x: .5 + p.x * .35, y: .5 + p.y * .5 }));
}
const neutral = canonicalPose();
const reference = Pose.solve(neutral, canonicalImage(neutral), { runtime: 'mediapipe', enableLegs: true })!;
function rotation(value: XYZ): Quaternion {
  // KalidoKit's avatar-camera frame -> our Y-up, camera-facing character frame.
  return new Quaternion().setFromEuler(new Euler(-value.x, -value.y, value.z, 'XYZ'));
}
// 1.1.5 labels MP indices 11/13/15 as Right: explicitly map anatomical sides.
const KALIDO_LIMBS = [
  ['LeftArm', 'RightUpperArm', 11, 13], ['LeftForeArm', 'RightLowerArm', 13, 15],
  ['RightArm', 'LeftUpperArm', 12, 14], ['RightForeArm', 'LeftLowerArm', 14, 16],
  ['LeftUpLeg', 'RightUpperLeg', 23, 25], ['LeftLeg', 'RightLowerLeg', 25, 27],
  ['RightUpLeg', 'LeftUpperLeg', 24, 26], ['RightLeg', 'LeftLowerLeg', 26, 28],
] as const;

function kalidokit(rig: MixamoRig, world: Landmark[], image: Landmark[], settings: SolverSettings, alpha: number): number {
  const result = Pose.solve(world.map(p => ({ ...p })), image.map(p => ({ ...p })), {
    runtime: 'mediapipe', enableLegs: settings.legs,
  });
  if (!result) return 0;
  let updated = 0;
  const apply = (name: string, value: XYZ, neutralValue: XYZ, weight = 1) => {
    const delta = rotation(value).multiply(rotation(neutralValue).invert());
    const weighted = new Quaternion().slerp(delta, weight);
    const rest = rig.restWorld.get(name)!;
    // Conjugate the neutral-corrected delta into the FBX bone's rest axes.
    const local = rig.restLocal.get(name)!.clone()
      .multiply(rest.clone().invert()).multiply(weighted).multiply(rest);
    updated += Number(rig.setLocal(name, local, alpha));
  };
  if (reliable(world, settings.minVisibility, 11, 12, 23, 24)) {
    apply('Hips', result.Hips.rotation!, reference.Hips.rotation!);
    for (const name of ['Spine', 'Spine1', 'Spine2']) apply(name, result.Spine, reference.Spine, 1 / 3);
  }
  for (const [bone, key, a, b] of KALIDO_LIMBS) {
    if (!settings.legs && a >= 23) continue;
    if (!reliable(world, settings.minVisibility, a, b)) continue;
    if (cameraPoint(world[a]).distanceTo(cameraPoint(world[b])) < 0.01) continue;
    apply(bone, result[key], reference[key]);
  }
  return updated;
}

export class PoseRetargeter {
  private lastTime: number | undefined;
  private initialized = false;
  constructor(readonly rig: MixamoRig) {}
  reset() { this.rig.reset(); this.lastTime = undefined; this.initialized = false; }

  update(kind: SolverKind, world: Landmark[] | undefined, image: Landmark[] | undefined, time: number, settings: SolverSettings) {
    if (!Number.isFinite(time)) return 0;
    const discontinuity = this.lastTime !== undefined && (time < this.lastTime || time - this.lastTime > 0.5);
    if (discontinuity) this.reset();
    const elapsed = this.lastTime === undefined ? 1 / 30 : Math.max(1 / 120, time - this.lastTime);
    this.lastTime = time;
    if (!validLandmarks(world) || (kind === 'kalidokit' && !validLandmarks(image))) return 0;
    const alpha = this.initialized ? smoothingAlpha(settings.smoothing, elapsed) : 1;
    const count = kind === 'custom' ? custom(this.rig, world, settings, alpha)
      : kalidokit(this.rig, world, image!, settings, alpha);
    if (count) this.initialized = true;
    return count;
  }
}
