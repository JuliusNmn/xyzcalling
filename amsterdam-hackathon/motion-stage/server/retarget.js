import {Group, Matrix4, Quaternion, Vector3} from 'three';
import {clone} from 'three/addons/utils/SkeletonUtils.js';
import {createRig} from './rig.js';

// Mixamo exports use namespaces such as mixamorig:Hips and mixamorig6Hips.
export const boneKey=name=>name.replace(/^.*:/,'').replace(/^mixamorig\d*/i,'');
export function restoreBindPose(model){
  const container=model.parent;model.removeFromParent();
  model.updateMatrixWorld(true);
  const bind=new Map();
  model.traverse(mesh=>{if(mesh.isSkinnedMesh)mesh.skeleton.bones.forEach((bone,i)=>bind.set(bone,mesh.skeleton.boneInverses[i].clone().invert()));});
  for(const [bone,matrix]of bind){
    const parent=bone.parent&&(bind.get(bone.parent)??bone.parent.matrixWorld);
    const local=parent?new Matrix4().copy(parent).invert().multiply(matrix):matrix;
    local.decompose(bone.position,bone.quaternion,bone.scale);
  }
  if(container)container.add(model);
  model.updateMatrixWorld(true);
}
function bonesOf(root){const bones=new Map();root.traverse(n=>{if(n.isBone)bones.set(boneKey(n.name),n);});return bones;}
const required=['Hips','Spine','Head','LeftArm','RightArm','LeftForeArm','RightForeArm','LeftHand','RightHand','LeftUpLeg','RightUpLeg','LeftLeg','RightLeg','LeftFoot','RightFoot'];
export function characterInfo(model){
  const bones=bonesOf(model);for(const key of required)if(!bones.has(key))throw new Error(`Character missing ${key}`);
  const nodeNames=[];model.traverse(n=>nodeNames.push(n.name));return {nodeNames};
}
export function createRetargetedRig(sourceModel,entry,targetModel,targetScale=.01){
  const source=createRig(sourceModel,entry);
  // FBX defaults can contain the final animated pose. Bind matrices are the rest reference.
  restoreBindPose(source.root);
  const target=clone(targetModel),world=new Group();world.scale.setScalar(targetScale);world.add(target);restoreBindPose(target);
  source.world.updateMatrixWorld(true);world.updateMatrixWorld(true);
  const sourceBones=bonesOf(source.root),targetBones=bonesOf(target);
  characterInfo(source.root);characterInfo(target);
  // The baked GVHMR world delta is already in capture coordinates. A target's
  // different rest-facing direction belongs in its bind rotation only: rotating
  // the delta again reverses bends (verified against the original NPZ rotations).
  const rest=new Map();for(const [key,bone]of sourceBones)rest.set(key,bone.getWorldQuaternion(new Quaternion()).invert());
  const targetRest=new Map();for(const [key,bone]of targetBones)targetRest.set(key,{rotation:bone.getWorldQuaternion(new Quaternion()),local:bone.quaternion.clone()});
  const sourceOrigin=sourceBones.get('Hips').getWorldPosition(new Vector3()),targetOrigin=targetBones.get('Hips').getWorldPosition(new Vector3());
  const nodes=[];target.traverse(n=>nodes.push(n));
  const position=new Vector3(),rotation=new Quaternion(),parentRotation=new Quaternion();
  return {duration:source.duration,nodeNames:nodes.map(n=>n.name),root:target,world,sample(time,blendTime=null,blendWeight=0){
    source.sample(time,blendTime,blendWeight);
    // Parent-before-child traversal keeps target proportions and bind-local offsets.
    for(const [key,bone]of targetBones){
      const original=sourceBones.get(key),bind=targetRest.get(key);
      if(original){
        original.getWorldQuaternion(rotation).normalize().multiply(rest.get(key)).multiply(bind.rotation);
        bone.parent.getWorldQuaternion(parentRotation).invert();bone.quaternion.copy(parentRotation.multiply(rotation)).normalize();
      }else bone.quaternion.copy(bind.local);
      if(key==='Hips'){
        original.getWorldPosition(position).sub(sourceOrigin).add(targetOrigin);
        bone.position.copy(bone.parent.worldToLocal(position));
      }
      bone.updateMatrixWorld(true);
    }
    world.updateMatrixWorld(true);
    const anchors={head:'Head',leftHand:'LeftHand',rightHand:'RightHand',leftFoot:'LeftFoot',rightFoot:'RightFoot'};
    return {transforms:nodes.map(n=>[...n.position.toArray(),...n.quaternion.toArray(),...n.scale.toArray()].map(v=>Math.round(v*1e6)/1e6)),worldPositions:Object.fromEntries(Object.entries(anchors).map(([key,name])=>[key,targetBones.get(name).getWorldPosition(position).toArray().map(v=>Math.round(v*1e5)/1e5)]))};
  }};
}
