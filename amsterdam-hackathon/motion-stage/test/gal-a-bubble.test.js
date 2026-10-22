import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import createScene from '../public/scenes/gal-a-bubble.js';
import {parameterDefinitions} from '../public/parameters.js';
import {ParameterStore} from '../server/parameters.js';
import {OscParameterRouter} from '../server/osc-parameters.js';

function setup(){
 const camera=new THREE.PerspectiveCamera(38,1.8,.05,40);camera.position.set(3,1.85,4.3);camera.lookAt(0,.9,0);
 const original=camera.position.clone(),rotation=camera.quaternion.clone();
 const model=new THREE.Group(),hip=new THREE.Bone();hip.name='mixamorig:Hips';hip.position.y=1;model.add(hip);
 const anchors={};
 for(const [name,bone,parentName,x,y] of [['leftHand','LeftHand','LeftForeArm',-.6,.3],['rightHand','RightHand','RightForeArm',.6,.3],['leftFoot','LeftFoot','LeftLeg',-.2,-.8],['rightFoot','RightFoot','RightLeg',.2,-.8]]){
  const parent=new THREE.Bone(),end=new THREE.Bone();parent.name='mixamorig6'+parentName;end.name='mixamorig6'+bone;
  parent.position.set(x*.5,y*.5,0);end.position.copy(parent.position);hip.add(parent);parent.add(end);anchors[name]=end;
 }
 const group=new THREE.Group(),scene=createScene({THREE,group,camera,getModel:()=>model});
 const deck={time:2,animation:{id:'gal-a-bubble',time:2},params:{characterOpacity:0,coneColors:.3,coneIntensity:1.4},pose:{worldPositions:{}}};
 function update(){model.updateMatrixWorld(true);for(const [name,bone]of Object.entries(anchors))deck.pose.worldPositions[name]=bone.getWorldPosition(new THREE.Vector3()).toArray();scene.update(deck);}
 return {camera,original,rotation,model,hip,anchors,group,scene,deck,update};
}
test('cone origins match rendered joints, camera follows hips, opacity does not remove light, disposal restores camera',()=>{
 const s=setup();s.update();const u=s.group.children[0].material.uniforms;
 assert.equal(s.group.visible,true);assert.deepEqual(u.enabled.value,[1,1,1,1]);
 assert.equal(u.hue.value,.3);assert.equal(u.intensity.value,1.4);
 Object.values(s.anchors).forEach((bone,i)=>{
  const p=bone.getWorldPosition(new THREE.Vector3()).project(s.camera),e=u.emitters.value[i];
  assert.ok(Math.abs(e.x-p.x)<1e-8&&Math.abs(e.y-p.y)<1e-8);assert.ok(Math.abs(Math.hypot(e.z,e.w)-1)<1e-8);
 });
 const origin=s.camera.position.clone(),emitter=u.emitters.value[0].clone();
 s.hip.position.add(new THREE.Vector3(2,.2,-1));s.update();
 assert.ok(s.camera.position.distanceTo(origin.add(new THREE.Vector3(2,.2,-1)))<1e-8);
 assert.ok(u.emitters.value[0].clone().sub(emitter).length()<1e-8,'camera tracks translation without moving the cone on screen');
 s.deck.params.coneIntensity=0;s.update();assert.equal(u.intensity.value,0);
 s.deck.pose=null;s.scene.update(s.deck);assert.equal(s.group.visible,false);
 s.scene.dispose();assert.deepEqual(s.camera.position,s.original);assert.deepEqual(s.camera.quaternion.toArray(),s.rotation.toArray());
});
test('invalid anchors disable only their cones and limb rotation changes cone direction',()=>{
 const s=setup();s.update();const u=s.group.children[0].material.uniforms,old=u.emitters.value[0].clone();
 s.anchors.leftHand.position.set(.5,.1,0);s.update();assert.notEqual(u.emitters.value[0].z,old.z);
 s.deck.pose.worldPositions.leftHand=[NaN,0,0];s.scene.update(s.deck);assert.deepEqual(u.enabled.value,[0,1,1,1]);
 const mat=s.group.children[0].material;assert.equal(mat.blendDst,THREE.OneMinusSrcColorFactor);assert.equal(mat.depthTest,false);
});
test('three sliders route through MIDI and C/D EQ, preserve manual edits, and retain existing scene bindings',()=>{
 assert.deepEqual(Object.keys(parameterDefinitions('gal-a-bubble')),['characterOpacity','coneColors','coneIntensity']);
 const store=new ParameterStore();let scene='gal-a-bubble';const router=new OscParameterRouter(store,()=>scene);
 for(const [source,target]of [[3,1],[4,2]]){
  router.ingest(`/djay/mixer/turntable${source}/eq/low`,[-1],0);
  router.ingest(`/djay/mixer/turntable${source}/eq/mid`,[1],0);
  router.ingest(`/djay/mixer/turntable${source}/eq/high`,[0],0);
  assert.deepEqual(store.get(target,scene),{characterOpacity:0,coneColors:1,coneIntensity:1});
 }
 store.set(1,scene,{coneColors:.2});router.ingest('/djay/mixer/turntable3/eq/mid',[1],1);assert.equal(store.get(1,scene).coneColors,.2);
 store.midi([176,22,127],()=>scene);assert.equal(store.get(1,scene).coneIntensity,2);assert.equal(store.get(2,scene).coneIntensity,1);
 store.midi([176,21,0],()=>scene);assert.equal(store.get(1,scene).coneColors,0);
 assert.equal(router.snapshot(1).bands.high.parameter,'coneIntensity');
 scene='rumble';router.sync();assert.equal(store.get(1,scene).particleRate,800);
 scene='first-of-year';router.sync();assert.equal(store.get(1,scene).characterCount,6);
});
