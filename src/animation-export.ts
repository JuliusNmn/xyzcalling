import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import { AnimationClip, LoadingManager, QuaternionKeyframeTrack, Texture, TextureLoader, type Object3D, type Mesh } from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { CONTROLLED, MixamoRig, PoseRetargeter, type SolverKind, type SolverSettings } from './rig/solvers';
import { excerptRhythm, sampleTimes, selectionLabel, selectionMetadata, type AudioAnalysis, type ClipSelection } from './audio-analysis';

// Parsing a skeleton for export doesn't require loading any of the FBX textures.
class EmptyTextureLoader extends TextureLoader { override load() { return new Texture<HTMLImageElement>(); } }

export function bakeAnimation(rig: MixamoRig, times: number[], rotations: Map<string, number[]>, name: string) {
  return AnimationClip.toJSON(new AnimationClip(name, times[times.length - 1], CONTROLLED.map(bone =>
    new QuaternionKeyframeTrack(`${rig.bones.get(bone)!.name}.quaternion`, times, rotations.get(bone)!))));
}

function waitFor(video: HTMLVideoElement, event: string, signal: AbortSignal, action: () => void) {
  return new Promise<void>((resolve, reject) => {
    signal.throwIfAborted();
    const clean = () => { clearTimeout(timer); video.removeEventListener(event, done); video.removeEventListener('error', failed); signal.removeEventListener('abort', aborted); };
    const done = () => { clean(); resolve(); };
    const failed = () => { clean(); reject(new Error('Video decoding failed during animation extraction.')); };
    const aborted = () => { clean(); reject(new DOMException('Extraction cancelled', 'AbortError')); };
    const timer = setTimeout(() => { clean(); reject(new Error('Timed out waiting for a video frame.')); }, 30000);
    video.addEventListener(event, done, { once: true }); video.addEventListener('error', failed, { once: true }); signal.addEventListener('abort', aborted, { once: true });
    try { action(); } catch (error) { clean(); reject(error); }
  });
}

export async function extractAnimation(options: {
  url: string; analysis?: AudioAnalysis; source?: { name: string; bytes: number }; selection: ClipSelection;
  solver: SolverKind; settings: SolverSettings; person: number; numPoses: number; confidence: number;
  offline?: boolean;
  signal: AbortSignal; progress: (fraction: number, message: string) => void;
}) {
  const { analysis, selection, signal, progress } = options;
  if (options.person >= options.numPoses) throw new Error('Increase Maximum people to include the selected person, or select Person 1.');
  const duration = selection.end - selection.start;
  const times = sampleTimes(duration);
  const video = document.createElement('video');
  video.muted = true; video.playsInline = true; video.preload = 'auto';
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d')!;
  let model: PoseLandmarker | undefined;
  let character: Object3D | undefined;
  try {
    progress(0, 'Preparing video and animation rig…');
    await waitFor(video, 'loadeddata', signal, () => { video.src = options.url; video.load(); });
    if (selection.end > video.duration + .05) throw new Error('The selection extends past the video. Reload its analysis.');
    signal.throwIfAborted();
    const response = await fetch('/character/Chicken%20Dance.fbx', { signal });
    if (!response.ok) throw new Error('The Mixamo character could not be loaded.');
    const manager = new LoadingManager(); manager.addHandler(/.*/, new EmptyTextureLoader());
    character = new FBXLoader(manager).parse(await response.arrayBuffer(), '');
    character.animations = []; character.scale.multiplyScalar(.01); character.updateMatrixWorld(true);
    const rig = new MixamoRig(character), retargeter = new PoseRetargeter(rig);
    const skeleton = [...rig.bones.values()].map(bone => ({ name: bone.name,
      parent: (bone.parent as { isBone?: boolean })?.isBone ? bone.parent!.name : null,
      position: bone.position.toArray(), quaternion: bone.quaternion.toArray(), scale: bone.scale.toArray() }));
    progress(0, 'Loading pose model…');
    const fileset = await FilesetResolver.forVisionTasks('/wasm');
    signal.throwIfAborted();
    model = await PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: '/models/pose_landmarker_full.task', delegate: 'CPU' },
      runningMode: options.offline ? 'IMAGE' : 'VIDEO', numPoses: options.numPoses, minPoseDetectionConfidence: options.confidence,
      minPosePresenceConfidence: options.confidence, minTrackingConfidence: options.confidence,
    });
    canvas.width = Math.min(960, video.videoWidth); canvas.height = Math.round(canvas.width * video.videoHeight / video.videoWidth);
    const rotations = new Map(CONTROLLED.map(bone => [bone, [] as number[]]));
    const frames = [];
    let tracked = 0;
    for (const [index, time] of times.entries()) {
      signal.throwIfAborted();
      const sourceTime = Math.min(selection.start + time, video.duration - .001);
      if (Math.abs(video.currentTime - sourceTime) > .00001) await waitFor(video, 'seeked', signal, () => { video.currentTime = sourceTime; });
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const result = options.offline ? model.detect(canvas) : model.detectForVideo(canvas, time * 1000);
      const world = result.worldLandmarks[options.person], landmarks = result.landmarks[options.person];
      const updated = retargeter.update(options.solver, world, landmarks, time, options.offline ? { ...options.settings, smoothing: 0 } : options.settings);
      if (updated) tracked++;
      frames.push({ time_seconds: time, source_time_seconds: sourceTime, updated_bones: updated,
        landmarks: landmarks ?? null, world_landmarks: world ?? null });
      for (const bone of CONTROLLED) rotations.get(bone)!.push(...rig.bones.get(bone)!.quaternion.toArray());
      progress((index + 1) / times.length, `Extracting frame ${index + 1} of ${times.length}…`);
      // Keep cancel/progress responsive, including when adjacent samples share a video frame.
      if (index % 5 === 0) await new Promise(resolve => setTimeout(resolve, 0));
    }
    if (!tracked) throw new Error('No usable body poses were found in this selection. Try another range or person.');
    return {
      schema: 'pose-studio.dance-animation', version: 2,
      source: { ...(analysis?.source ?? options.source ?? { name: 'video', bytes: 0 }), ...selectionMetadata(selection) },
      duration_seconds: duration, sample_rate_hz: 30, timebase: 'clip-seconds',
      solver: { name: options.solver, settings: options.offline ? { ...options.settings, smoothing: 0 } : options.settings, person_index: options.person },
      pose_model: { name: 'mediapipe-pose-landmarker-full', version: '1.1.1', max_width: 960,
        confidence: options.confidence, num_poses: options.numPoses, inference_mode: options.offline ? 'independent-images' : 'video' },
      quality: { frames: times.length, tracked_frames: tracked, held_frames: times.length - tracked,
        tracked_fraction: tracked / times.length, note: 'Missing or low-confidence bones hold their previous pose; initial gaps use rest pose. Person indices are detection order, not persistent identities.' },
      rig: { name: 'Chicken Dance Mixamo', space: 'Three.js Y-up, bone-local transforms',
        in_place: true, root_transform: { position: character.position.toArray(), quaternion: character.quaternion.toArray(), scale: character.scale.toArray() }, bones: skeleton },
      rhythm: analysis ? excerptRhythm(analysis, selection) : null,
      animation: bakeAnimation(rig, times, rotations, `${selectionLabel(selection)} · ${analysis?.source.name ?? options.source?.name ?? 'video'}`),
      frames,
      landmark_coordinates: { landmarks: 'MediaPipe normalized image coordinates', world_landmarks: 'MediaPipe meters relative to hip midpoint; x right, y down, z away from camera' },
    };
  } finally {
    model?.close(); video.pause(); video.removeAttribute('src'); video.load();
    character?.traverse(object => {
      const mesh = object as Mesh;
      mesh.geometry?.dispose();
      if (mesh.material) for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        for (const value of Object.values(material)) if (value && typeof value === 'object' && 'isTexture' in value) value.dispose();
        material.dispose();
      }
    });
  }
}
