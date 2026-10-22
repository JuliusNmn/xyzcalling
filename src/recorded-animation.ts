import { AnimationClip, LoadingManager, Texture, TextureLoader, type Group, type SkinnedMesh, type KeyframeTrack } from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { excerptRhythm, sampleTimes, selectionMetadata, type AudioAnalysis, type ClipSelection } from './audio-analysis';
import type { DanceAnimation } from './animation-preview';
import { characterRig, restoreBindPose } from './character-animation';

export type RecordedAnimation = { kind: 'gvhmr'; url: string; duration: number; bytes: number; revision: string; heldOutroFrames: number | null };
class EmptyTextureLoader extends TextureLoader { override load(url: string) { if (url.startsWith('blob:')) URL.revokeObjectURL(url); return new Texture<HTMLImageElement>(); } }
let cached: { key: string; bytes: ArrayBuffer } | undefined;
type LoadProgress = (message: string) => void;
const DOWNLOAD_CHUNK = 2 * 1024 * 1024;
const DOWNLOAD_ATTEMPTS = 10;
/** Bound each network request and retry interrupted chunks without restarting a large file. */
async function downloadChunks(key: string, total: number, signal: AbortSignal, progress?: LoadProgress) {
  let output: Uint8Array | undefined, etag: string | null = null;
  for (let start = 0; start < total; start += DOWNLOAD_CHUNK) {
    const end = Math.min(total, start + DOWNLOAD_CHUNK) - 1;
    let part: { response: Response; bytes: ArrayBuffer } | undefined;
    for (let attempt = 1; attempt <= DOWNLOAD_ATTEMPTS; attempt++) {
      signal.throwIfAborted();
      try {
        const headers: Record<string, string> = { Range: `bytes=${start}-${end}` };
        if (etag) headers['If-Range'] = etag;
        const response = await fetch(key, { signal, headers, cache: 'no-store' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        part = { response, bytes: await response.arrayBuffer() };
        break;
      } catch (error) {
        signal.throwIfAborted();
        if (attempt === DOWNLOAD_ATTEMPTS) throw new Error(`Could not download animation bytes ${start}–${end} after ${DOWNLOAD_ATTEMPTS} attempts: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
        console.warn('[GVHMR] Retrying download chunk', { url: key, start, end, attempt }, error);
      }
    }
    signal.throwIfAborted();
    const { response, bytes } = part!;
    // A server without Range support can still supply the complete file.
    if (start === 0 && response.status === 200 && bytes.byteLength === total) return bytes;
    if (response.status !== 206 || response.headers.get('Content-Range') !== `bytes ${start}-${end}/${total}` || bytes.byteLength !== end - start + 1) {
      throw new Error('The server returned an incomplete or changed animation. Refresh the video library and retry.');
    }
    if (start === 0) etag = response.headers.get('ETag');
    else if (etag && response.headers.get('ETag') !== etag) throw new Error('The animation changed during download. Refresh the video library and retry.');
    output ??= new Uint8Array(total);
    output.set(new Uint8Array(bytes), start);
    progress?.(`Downloading animation · ${((end + 1) / 1e6).toFixed(1)} / ${(total / 1e6).toFixed(1)} MB`);
  }
  return output!.buffer as ArrayBuffer;
}
export async function recordedBytes(asset: RecordedAnimation, signal: AbortSignal, progress?: LoadProgress) {
  const key = `${asset.url}?v=${encodeURIComponent(asset.revision)}`;
  if (cached?.key === key) { signal.throwIfAborted(); return cached.bytes; }
  const started = performance.now();
  let status: number | undefined;
  try {
    progress?.('Downloading saved animation…');
    let bytes: ArrayBuffer;
    if (asset.bytes > DOWNLOAD_CHUNK * 4) bytes = await downloadChunks(key, asset.bytes, signal, progress);
    else {
      const response = await fetch(key, { signal }); status = response.status;
      if (!response.ok) throw new Error(`HTTP ${status}. Refresh the video library.`);
      bytes = await response.arrayBuffer();
    }
    signal.throwIfAborted();
    if (asset.bytes && bytes.byteLength !== asset.bytes) throw new Error(`Received ${bytes.byteLength} of ${asset.bytes} expected bytes. Refresh the video library and retry.`);
    console.info('[GVHMR] Download complete', { url: key, bytes: bytes.byteLength, milliseconds: Math.round(performance.now() - started) });
    cached = { key, bytes }; return bytes;
  } catch (error) {
    signal.throwIfAborted();
    const seconds = ((performance.now() - started) / 1000).toFixed(1);
    console.error('[GVHMR] Download failed', { url: key, status, expectedBytes: asset.bytes, seconds }, error);
    throw new Error(`Animation download failed after ${seconds}s: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
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

/** Raw saved motion for either preview, independent of audio analysis or MediaPipe. */
export async function loadRecordedMotion(asset: RecordedAnimation, signal: AbortSignal, progress?: LoadProgress) {
  const bytes = await recordedBytes(asset, signal, progress);
  progress?.('Preparing saved animation…');
  const started = performance.now();
  let character: Group | undefined;
  const manager = new LoadingManager(); manager.addHandler(/.*/, new EmptyTextureLoader());
  try {
    character = new FBXLoader(manager).parse(bytes, '');
    const clip = character.animations.find(clip => clip.duration > 0 && clip.tracks.length);
    if (!clip) throw new Error('The saved FBX contains no animation.');
    // Exported FBX defaults can be the final pose. Use the skin bind pose as the
    // rest reference for Blender conversion, never that animated default pose.
    restoreBindPose(character);
    character.scale.multiplyScalar(.01);
    character.updateMatrixWorld(true);
    const rig = characterRig(character);
    // The exported Armature tracks are static. Fold them into the root transform;
    // refuse moving containers instead of silently losing their motion.
    const names = new Set(rig.bones.map(bone => bone.name));
    for (const track of clip.tracks.filter(track => !names.has(track.name.split('.')[0]))) {
      const size = track.getValueSize();
      if (!track.values.every((value, i) => Math.abs(value - track.values[i % size]) < .0001)) throw new Error('Animated FBX containers are not supported.');
    }
    return {
      animation: AnimationClip.toJSON(new AnimationClip(clip.name, clip.duration, clip.tracks.filter(track => names.has(track.name.split('.')[0])))),
      rig: { ...rig, name: 'Saved Mixamo motion', in_place: false },
    };
  } catch (error) {
    console.error('[GVHMR] FBX parsing failed', { url: asset.url, bytes: bytes.byteLength }, error);
    throw new Error(`Animation parsing failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  } finally {
    if (character) disposeRecordedCharacter(character);
    console.info('[GVHMR] FBX parsing finished', { url: asset.url, milliseconds: Math.round(performance.now() - started) });
  }
}

export async function extractRecordedAnimation(source: { name: string; bytes: number; recordedAnimation?: RecordedAnimation }, selection: ClipSelection, analysis: AudioAnalysis | undefined, signal: AbortSignal, progress?: LoadProgress): Promise<DanceAnimation> {
  const asset = source.recordedAnimation;
  if (!asset) throw new Error('No saved GVHMR animation is available for this video.');
  const motion = await loadRecordedMotion(asset, signal, progress);
  const clip = AnimationClip.parse(motion.animation), sampled = excerptAnimation(clip, selection);
  const times = sampleTimes(sampled.duration);
  return {
    schema: 'pose-studio.dance-animation', version: 2,
    source: { ...(analysis?.source ?? { name: source.name, bytes: source.bytes }), ...selectionMetadata(selection) }, duration_seconds: sampled.duration, sample_rate_hz: 30, timebase: 'clip-seconds',
    saved_source: asset,
    solver: { name: 'gvhmr', settings: null, person_index: null },
    pose_model: { name: 'gvhmr', inference_mode: 'precomputed', person_selection: 'dominant person in the saved extraction' },
    quality: { frames: times.length, tracked_frames: null, held_frames: null, tracked_fraction: null,
      note: `Precomputed GVHMR. Per-frame confidence is unavailable. ${asset.heldOutroFrames === null ? 'Original inference metadata was not supplied.' : `The full source holds ${asset.heldOutroFrames} black-outro frames.`}${selection.end > clip.duration ? ` The last pose is held for ${((selection.end - clip.duration) * 1000).toFixed(0)} ms to cover the video ending.` : ''}` },
    rig: motion.rig,
    rhythm: analysis ? excerptRhythm(analysis, selection) : null, animation: AnimationClip.toJSON(sampled), frames: [],
    landmark_coordinates: { landmarks: 'Not included in the saved FBX', world_landmarks: 'Not included in the saved FBX' },
  };
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
