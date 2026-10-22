import { readFile } from 'node:fs/promises';
import { AnimationMixer, Group, LoadingManager, Texture, Vector3, LoopOnce } from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';

// FBX embeds images, but server-side skeletal sampling requires no image decode/GPU.
// No browser globals or texture allocation escape the synchronous parse call.
export async function loadRig(file, requireAnimation=true) {
  const bytes = await readFile(file);
  const manager = new LoadingManager();
  manager.addHandler(/.*/, { path: '', setPath(p) { this.path=p; return this; }, load() { return new Texture(); } });
  const previous = globalThis.window;
  globalThis.window = { URL: { createObjectURL: () => 'blob:server-texture-unused' } };
  try {
    const model = new FBXLoader(manager).parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
    if (requireAnimation && !model.animations.length) throw new Error('FBX contains no animation clips');
    return model;
  } finally { if (previous === undefined) delete globalThis.window; else globalThis.window=previous; }
}

export function createRig(model, entry) {
  const root = clone(model);
  const world = new Group();
  world.scale.setScalar(entry.scale);
  world.add(root);
  const nodes=[]; root.traverse(node=>nodes.push(node));
  const mixer = new AnimationMixer(root);
  const clip = model.animations[entry.clip ?? 0];
  if (!clip) throw new Error(`No clip ${entry.clip}`);
  const action = mixer.clipAction(clip); action.setLoop(LoopOnce, 1); action.clampWhenFinished=true; action.play();
  const aliases={head:'Head',leftHand:'LeftHand',rightHand:'RightHand',leftFoot:'LeftFoot',rightFoot:'RightFoot'};
  const anchors=Object.fromEntries(Object.entries(aliases).map(([key,name])=>[key,nodes.find(n=>n.isBone && (n.name.replace(/[^a-z0-9]/gi,'').toLowerCase()===`mixamorig${name}`.toLowerCase() || n.name===name))]));
  const vector=new Vector3();
  return { root, world, duration:clip.duration, nodeNames:nodes.map(n=>n.name), sample(time, blendTime=null, blendWeight=0) {
    action.reset().play(); mixer.setTime(Math.max(0,Math.min(clip.duration,time))); if(blendTime!==null&&blendWeight>0){
      const first=nodes.map(n=>({position:n.position.clone(),quaternion:n.quaternion.clone(),scale:n.scale.clone()}));
      action.reset().play();mixer.setTime(blendTime);
      nodes.forEach((n,i)=>{n.position.lerp(first[i].position,1-blendWeight);n.quaternion.slerp(first[i].quaternion,1-blendWeight);n.scale.lerp(first[i].scale,1-blendWeight);});
    }
    world.updateMatrixWorld(true);
    const transforms=nodes.map(n=>[...n.position.toArray(),...n.quaternion.toArray(),...n.scale.toArray()].map(v=>Math.round(v*1e6)/1e6));
    const worldPositions=Object.fromEntries(Object.entries(anchors).map(([key,bone])=>[key,bone ? bone.getWorldPosition(vector).toArray().map(v=>Math.round(v*1e5)/1e5) : null]));
    return {transforms,worldPositions};
  }};
}
