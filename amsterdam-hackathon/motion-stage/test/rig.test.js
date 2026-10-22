import test from 'node:test';import assert from 'node:assert/strict';import {Vector3,Group} from 'three';import {clone} from 'three/addons/utils/SkeletonUtils.js';
import {loadRig,createRig} from '../server/rig.js';
const file=new URL('../../Geo/Chicken%20Dance.fbx',import.meta.url);
test('FBX poses animate independently and world landmarks reconstruct from streamed local transforms',async()=>{
  const model=await loadRig(file),a=createRig(model,{scale:.01}),b=createRig(model,{scale:.01});
  const first=a.sample(0),later=a.sample(2);assert.notDeepEqual(first.transforms,later.transforms);assert.deepEqual(b.sample(0),first);
  assert.equal(Object.keys(later.worldPositions).length,5);assert.ok(later.worldPositions.head[1]>1&&later.worldPositions.head[1]<2);
  const copy=clone(model),world=new Group();world.scale.setScalar(.01);world.add(copy);let i=0;
  copy.traverse(n=>{const t=later.transforms[i++];n.position.fromArray(t);n.quaternion.fromArray(t,3);n.scale.fromArray(t,7);});world.updateMatrixWorld(true);
  const names={head:'Head',leftHand:'LeftHand',rightHand:'RightHand',leftFoot:'LeftFoot',rightFoot:'RightFoot'};
  for(const [key,suffix]of Object.entries(names)){let bone;copy.traverse(n=>{if(n.isBone&&n.name.replace(':','')===`mixamorig${suffix}`)bone=n;});const actual=bone.getWorldPosition(new Vector3()).toArray();actual.forEach((v,j)=>assert.ok(Math.abs(v-later.worldPositions[key][j])<.0001));}
});
test('loop seam blend returns the start pose and matching world anchors at full weight',async()=>{const model=await loadRig(file),rig=createRig(model,{scale:.01});const start=rig.sample(.5),end=rig.sample(3,.5,1);assert.deepEqual(end,start);});
