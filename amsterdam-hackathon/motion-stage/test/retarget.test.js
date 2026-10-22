import test from 'node:test';
import assert from 'node:assert/strict';
import {Group,Matrix4,Quaternion,Vector3} from 'three';
import {clone} from 'three/addons/utils/SkeletonUtils.js';
import {loadRig,createRig} from '../server/rig.js';
import {boneKey,createRetargetedRig,restoreBindPose,characterInfo} from '../server/retarget.js';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {root} from '../server/config.js';
const config=JSON.parse(await readFile(new URL('../config.json',import.meta.url)));
const ready= config.animations.find(e=>e.id==='ready');
const source=await loadRig(path.resolve(root,ready.file));
const targets=await Promise.all(['../Geo/Chicken Dance.fbx','characters/Ch20_nonPBR.fbx','characters/character.fbx'].map(f=>loadRig(path.resolve(root,f),false)));
function bones(model){const result=new Map();model.traverse(n=>{if(n.isBone)result.set(boneKey(n.name),n)});return result;}
test('Mixamo namespaces normalize across both Ch20 exports',()=>{
  for(const name of ['mixamorig:Hips','mixamorigHips','mixamorig6Hips'])assert.equal(boneKey(name),'Hips');
  assert.equal(targets[1].animations.length,2);assert.equal(targets[2].animations.length,0);
  for(const target of targets)assert(characterInfo(target).nodeNames.length>60);
});
for(const [index,target]of targets.entries())test(`Ready retarget target ${index}: bind-relative rotations, travel, stable seeking and streamed anchors`,()=>{
  const driver=createRig(source,ready);restoreBindPose(driver.root);driver.world.updateMatrixWorld(true);
  const originalBones=bones(driver.root),rootStart=originalBones.get('Hips').getWorldPosition(new Vector3());
  const sourceRest=new Map([...originalBones].map(([name,b])=>[name,b.getWorldQuaternion(new Quaternion())]));
  const rig=createRetargetedRig(source,ready,target),targetBones=bones(rig.root);
  const targetStart=targetBones.get('Hips').getWorldPosition(new Vector3());
  const targetRest=new Map([...targetBones].map(([name,b])=>[name,b.getWorldQuaternion(new Quaternion())]));
  const restLengths=new Map([...targetBones].filter(([name])=>name!=='Hips').map(([name,b])=>[name,b.position.length()]));
  const model=clone(target),world=new Group();world.scale.setScalar(.01);world.add(model);const nodes=[];model.traverse(n=>nodes.push(n));
  for(const t of [0,25.2,80,190,.5,25.2]){
    driver.sample(t);const pose=rig.sample(t);
    assert(pose.transforms.flat().every(Number.isFinite));
    for(const [name,b]of targetBones){
      if(restLengths.has(name))assert(Math.abs(b.position.length()-restLengths.get(name))<1e-6);
      if(!originalBones.has(name))continue;
      const a=originalBones.get(name).getWorldQuaternion(new Quaternion()).multiply(sourceRest.get(name).clone().invert());
      const z=b.getWorldQuaternion(new Quaternion()).multiply(targetRest.get(name).clone().invert());
      assert(a.normalize().angleTo(z.normalize())<1e-5,`${name} rotation at ${t}: ${a.angleTo(z)}`);
    }
    const travel=originalBones.get('Hips').getWorldPosition(new Vector3()).sub(rootStart);
    assert(targetBones.get('Hips').getWorldPosition(new Vector3()).sub(targetStart).distanceTo(travel)<1e-5);
    nodes.forEach((n,i)=>{const tr=pose.transforms[i];n.position.fromArray(tr);n.quaternion.fromArray(tr,3);n.scale.fromArray(tr,7);});world.updateMatrixWorld(true);
    const reconstructed=bones(model);
    for(const [key,name]of Object.entries({head:'Head',leftHand:'LeftHand',rightHand:'RightHand',leftFoot:'LeftFoot',rightFoot:'RightFoot'}))assert(reconstructed.get(name).getWorldPosition(new Vector3()).distanceTo(new Vector3().fromArray(pose.worldPositions[key]))<.0001);
  }
  const first=rig.sample(25.2);rig.sample(180);assert.deepEqual(rig.sample(25.2),first);
  assert.deepEqual(rig.sample(28.8,25.2,1),first);
});

// Independent ground truth: inference rotations, not the already-baked mannequin.
// This catches applying the mannequin's opposite rest-facing direction a second time.
const inference=JSON.parse(await readFile(new URL('./fixtures/inference-rotations.json',import.meta.url)));
const body=['Hips','LeftUpLeg','RightUpLeg','Spine','LeftLeg','RightLeg','Spine1','LeftFoot','RightFoot','Spine2','LeftToeBase','RightToeBase','Neck','LeftShoulder','RightShoulder','Head','LeftArm','RightArm','LeftForeArm','RightForeArm','LeftHand','RightHand'];
for(const id of ['fallback-house','ready'])test(`${id} matches original inference rotations on every selectable character`,async()=>{
  const entry=config.animations.find(e=>e.id===id);
  const model=id==='ready'?source:await loadRig(path.resolve(root,entry.file));
  for(const target of targets){
    const rig=createRetargetedRig(model,entry,target),byName=bones(rig.root);
    const rest=new Map(body.map(name=>[name,byName.get(name).getWorldQuaternion(new Quaternion()).normalize()]));
    for(const sample of inference.samples.filter(s=>s.id===id)){
      rig.sample(sample.time);
      const heading=new Quaternion().setFromAxisAngle(new Vector3(0,1,0),-sample.heading);
      body.forEach((name,i)=>{
        const matrix=sample.rotations[i];
        const rotation=new Quaternion().setFromRotationMatrix(new Matrix4().set(...matrix[0],0,...matrix[1],0,...matrix[2],0,0,0,0,1)).normalize();
        const expected=heading.clone().multiply(rotation).multiply(rest.get(name)).normalize();
        const actual=byName.get(name).getWorldQuaternion(new Quaternion()).normalize();
        assert(actual.angleTo(expected)<.001,`${id}: ${name} at ${sample.time}s differs from inference by ${actual.angleTo(expected)*180/Math.PI} degrees`);
      });
    }
  }
});
test('Rumble on Chicken Dance preserves the original FBX joint poses',async()=>{
  const entry=config.animations.find(e=>e.id==='rumble'),model=await loadRig(path.resolve(root,entry.file));
  const native=createRig(model,entry),retarget=createRetargetedRig(model,entry,targets[0]);
  const original=bones(native.root),converted=bones(retarget.root);
  for(const time of [0,2,13,25,100]){
    native.sample(time);retarget.sample(time);
    for(const name of original.keys()){
      assert(original.get(name).getWorldPosition(new Vector3()).distanceTo(converted.get(name).getWorldPosition(new Vector3()))<.0001,`${name} position at ${time}`);
      assert(original.get(name).getWorldQuaternion(new Quaternion()).normalize().angleTo(converted.get(name).getWorldQuaternion(new Quaternion()).normalize())<.0001,`${name} rotation at ${time}`);
    }
  }
});
