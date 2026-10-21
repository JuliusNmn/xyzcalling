import { AnimationClip, LoadingManager, Texture, TextureLoader, Vector3, Quaternion, type Group, type SkinnedMesh, type Bone, type KeyframeTrack } from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { excerptRhythm, sampleTimes, selectionMetadata, type AudioAnalysis, type ClipSelection } from './audio-analysis';
import type { DanceAnimation } from './animation-preview';

export type RecordedAnimation = { kind: 'gvhmr'; url: string; duration: number; bytes: number; revision: string; heldOutroFrames: number | null };
class EmptyTextureLoader extends TextureLoader { override load(url: string) { if (url.startsWith('blob:')) URL.revokeObjectURL(url); return new Texture<HTMLImageElement>(); } }
let cached: { key: string; bytes: ArrayBuffer } | undefined;
export async function recordedBytes(asset: RecordedAnimation, signal: AbortSignal) {
  const key = `${asset.url}?v=${encodeURIComponent(asset.revision)}`;
  if (cached?.key === key) { signal.throwIfAborted(); return cached.bytes; }
  const response = await fetch(key, { signal });
  if (!response.ok) throw new Error('The saved animation could not be loaded. Refresh the video library.');
  const bytes = await response.arrayBuffer(); signal.throwIfAborted();
  cached = { key, bytes }; return bytes;
}

/** Sample the source timeline, keeping root travel and a fractional closing key.
 * Muxed video/audio can outlast the FBX by a few frames. Hold only that bounded
 * tail (250 ms maximum), without stretching or rescaling the motion timeline. */
export function excerptAnimation(clip: AnimationClip, selection: ClipSelection) {
  if (selection.start < 0 || selection.end > clip.duration + .25) throw new Error('The saved animation does not cover this video selection.');
  const times = sampleTimes(selection.end - selection.start);
  const tracks = clip.tracks.map(track => {
    // Three exposes interpolant factories at runtime on every KeyframeTrack.
    const interpolant = (track as KeyframeTrack & { createInterpolant(): { evaluate(time: number): ArrayLike<number> } }).createInterpolant();
    const values = times.flatMap(time => Array.from(interpolant.evaluate(Math.min(clip.duration, selection.start + time))));
    const copy = track.clone(); copy.times = new Float32Array(times); copy.values = new Float32Array(values); return copy;
  });
  return new AnimationClip('GVHMR · ' + clip.name, selection.end - selection.start, tracks);
}

export async function extractRecordedAnimation(source: { name: string; bytes: number; recordedAnimation?: RecordedAnimation }, selection: ClipSelection, analysis: AudioAnalysis, signal: AbortSignal): Promise<DanceAnimation> {
  const asset = source.recordedAnimation;
  if (!asset) throw new Error('No saved GVHMR animation is available for this video.');
  const manager = new LoadingManager(); manager.addHandler(/.*/, new EmptyTextureLoader());
  const character = new FBXLoader(manager).parse(await recordedBytes(asset, signal), '');
  try {
    character.scale.multiplyScalar(.01); character.updateMatrixWorld(true);
    const clip = character.animations.find(clip => clip.duration > 0 && clip.tracks.length);
    if (!clip) throw new Error('The saved FBX contains no animation.');
    // Exported FBX defaults can be the final pose. Use the skin bind pose as the
    // rest reference for Blender conversion, never that animated default pose.
    character.traverse(object => { if ((object as SkinnedMesh).isSkinnedMesh) (object as SkinnedMesh).skeleton.pose(); });
    character.updateMatrixWorld(true);
    const bones: Bone[] = []; character.traverse(object => { if ((object as Bone).isBone) bones.push(object as Bone); });
    const rootBone = bones.find(bone => !(bone.parent as Bone)?.isBone);
    if (!rootBone?.parent || bones.length !== 65) throw new Error('Expected the saved Mixamo skeleton.');
    const parent = rootBone.parent;
    // The exported Armature tracks are static. Fold them into the root transform;
    // refuse moving containers instead of silently losing their motion.
    const names = new Set(bones.map(bone => bone.name));
    for (const track of clip.tracks.filter(track => !names.has(track.name.split('.')[0]))) {
      const size = track.getValueSize();
      if (!track.values.every((value, i) => Math.abs(value - track.values[i % size]) < .0001)) throw new Error('Animated FBX containers are not supported.');
    }
    const sampled = excerptAnimation(new AnimationClip(clip.name, clip.duration, clip.tracks.filter(track => names.has(track.name.split('.')[0]))), selection);
    const times = sampleTimes(sampled.duration);
    return {
      schema: 'pose-studio.dance-animation', version: 2,
      source: { ...analysis.source, ...selectionMetadata(selection) }, duration_seconds: sampled.duration, sample_rate_hz: 30, timebase: 'clip-seconds',
      saved_source: asset,
      solver: { name: 'gvhmr', settings: null, person_index: null },
      pose_model: { name: 'gvhmr', inference_mode: 'precomputed', person_selection: 'dominant person in the saved extraction' },
      quality: { frames: times.length, tracked_frames: null, held_frames: null, tracked_fraction: null,
        note: `Precomputed GVHMR. Per-frame confidence is unavailable. ${asset.heldOutroFrames === null ? 'Original inference metadata was not supplied.' : `The full source holds ${asset.heldOutroFrames} black-outro frames.`}${selection.end > clip.duration ? ` The last pose is held for ${((selection.end - clip.duration) * 1000).toFixed(0)} ms to cover the video ending.` : ''}` },
      rig: { name: 'Chicken Dance Mixamo', space: 'Three.js Y-up, bone-local transforms', in_place: false,
        root_transform: { position: parent.getWorldPosition(new Vector3()).toArray(), quaternion: parent.getWorldQuaternion(new Quaternion()).toArray(), scale: parent.getWorldScale(new Vector3()).toArray() },
        bones: bones.map(bone => ({ name: bone.name, parent: (bone.parent as Bone)?.isBone ? bone.parent!.name : null,
          position: bone.position.toArray(), quaternion: bone.quaternion.toArray(), scale: bone.scale.toArray() })) },
      rhythm: excerptRhythm(analysis, selection), animation: AnimationClip.toJSON(sampled), frames: [],
      landmark_coordinates: { landmarks: 'Not included in the saved FBX', world_landmarks: 'Not included in the saved FBX' },
    };
  } finally { disposeRecordedCharacter(character); }
}
export function disposeRecordedCharacter(character: Group) {
  character.traverse(object => {
    const mesh = object as SkinnedMesh;
    mesh.geometry?.dispose(); mesh.skeleton?.dispose();
    if (mesh.material) for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      for (const value of Object.values(material)) if (value && typeof value === 'object' && 'isTexture' in value) value.dispose();
      material.dispose();
    }
  });
}
