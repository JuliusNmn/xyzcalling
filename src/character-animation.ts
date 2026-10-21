import { AnimationClip, Matrix4, Quaternion, QuaternionKeyframeTrack, Vector3, VectorKeyframeTrack, type Bone, type Group, type KeyframeTrack } from 'three';
import type { DanceAnimation } from './animation-preview';

type Rig = DanceAnimation['rig'];
/** Capture the actual parent container too: Blender FBX adds an Armature transform. */
export function characterRig(character: Group): Rig {
  character.updateMatrixWorld(true);
  const bones: Bone[] = [];
  character.traverse(object => { if ((object as Bone).isBone) bones.push(object as Bone); });
  const parent = bones.find(bone => !(bone.parent as Bone)?.isBone)?.parent;
  if (!parent) throw new Error('Character has no skeleton.');
  return { name: character.name, space: 'Three.js Y-up, bone-local transforms', in_place: true,
    root_transform: { position: parent.getWorldPosition(new Vector3()).toArray(), quaternion: parent.getWorldQuaternion(new Quaternion()).toArray(), scale: parent.getWorldScale(new Vector3()).toArray() },
    bones: bones.map(bone => ({ name: bone.name, parent: (bone.parent as Bone)?.isBone ? bone.parent!.name : null,
      position: bone.position.toArray(), quaternion: bone.quaternion.toArray(), scale: bone.scale.toArray() })) };
}
function worldRest(rig: Rig) {
  const result = new Map<string, Quaternion>();
  for (const bone of rig.bones) result.set(bone.name, (bone.parent ? result.get(bone.parent)! : new Quaternion().fromArray(rig.root_transform.quaternion)).clone().multiply(new Quaternion().fromArray(bone.quaternion)));
  return result;
}
/** Match the server baker: transfer world-space rest-relative rotations and root travel.
 * Local FBX axes differ between original, saved GVHMR and Blender-authored characters.
 */
export function retargetAnimation(animation: DanceAnimation['animation'], source: Rig, target: Rig) {
  const clip = AnimationClip.parse(animation);
  const sourceRest = worldRest(source), targetRest = worldRest(target);
  const samplers = new Map(clip.tracks.map(track => [track.name,
    (track as KeyframeTrack & { createInterpolant(): { evaluate(time: number): ArrayLike<number> } }).createInterpolant()]));
  const times = [...new Set(clip.tracks.flatMap(track => Array.from(track.times)))].sort((a, b) => a - b);
  const values = new Map(target.bones.map(bone => [bone.name, [] as number[]]));
  const root = target.bones.find(bone => bone.parent === null)!;
  const sourceRoot = source.bones.find(bone => bone.name === root.name);
  const position = samplers.get(`${root.name}.position`), positions: number[] = [];
  const sourceMatrix = new Matrix4().compose(new Vector3().fromArray(source.root_transform.position), new Quaternion().fromArray(source.root_transform.quaternion), new Vector3().fromArray(source.root_transform.scale));
  const sourceOrigin = sourceRoot && new Vector3().fromArray(sourceRoot.position).applyMatrix4(sourceMatrix);
  for (const time of times) {
    const world = new Map<string, Quaternion>(), desired = new Map<string, Quaternion>();
    for (const bone of source.bones) {
      const local = samplers.get(`${bone.name}.quaternion`)?.evaluate(time) ?? bone.quaternion;
      const parent = bone.parent ? world.get(bone.parent)! : new Quaternion().fromArray(source.root_transform.quaternion);
      world.set(bone.name, parent.clone().multiply(new Quaternion().fromArray(Array.from(local))));
    }
    for (const bone of target.bones) {
      if (!world.has(bone.name)) throw new Error(`Animation is missing ${bone.name}.`);
      const rotation = world.get(bone.name)!.clone().multiply(sourceRest.get(bone.name)!.clone().invert()).multiply(targetRest.get(bone.name)!);
      desired.set(bone.name, rotation);
      const parent = bone.parent ? desired.get(bone.parent)! : new Quaternion().fromArray(target.root_transform.quaternion);
      values.get(bone.name)!.push(...parent.clone().invert().multiply(rotation).normalize().toArray());
    }
    if (position && sourceOrigin) {
      const delta = new Vector3().fromArray(Array.from(position.evaluate(time))).applyMatrix4(sourceMatrix).sub(sourceOrigin);
      // Transform a displacement, without applying either container's translation.
      delta.applyQuaternion(new Quaternion().fromArray(target.root_transform.quaternion).invert()).divide(new Vector3().fromArray(target.root_transform.scale));
      positions.push(...delta.add(new Vector3().fromArray(root.position)).toArray());
    }
  }
  const tracks: KeyframeTrack[] = target.bones.map(bone => new QuaternionKeyframeTrack(`${bone.name}.quaternion`, times, values.get(bone.name)!));
  if (positions.length) tracks.push(new VectorKeyframeTrack(`${root.name}.position`, times, positions));
  return new AnimationClip(clip.name, clip.duration, tracks);
}
