import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import createScene from '../public/scenes/real-house.js';
import {ParameterStore} from '../server/parameters.js';
import {OscParameterRouter} from '../server/osc-parameters.js';
const names=['LeftHand','RightHand','LeftFoot','RightFoot','LeftForeArm','RightForeArm','Head'];
function setup(){
 const model=new THREE.Group(),bones=names.map((name,i)=>{const b=new THREE.Bone();b.name='mixamorig6'+name;b.position.set(i*.1,i*.2,.1);model.add(b);return b;});
 const group=new THREE.Group(),camera=new THREE.PerspectiveCamera(38,1.8,.05,40);camera.position.set(3,2,4);camera.lookAt(0,1,0);
 const original=camera.position.clone(),rotation=camera.quaternion.clone();
 const scene=createScene({THREE,group,camera,getModel:()=>model});
 const deck={animation:{id:'real-house'},pose:{worldPositions:{}},params:{gridSpread:0,sphereSize:.065,characterOpacity:0}};
 const update=()=>{model.updateMatrixWorld(true);scene.update(deck);};
 return {model,bones,group,camera,scene,deck,update,original,rotation};
}
test('joint spheres unfold to regular grid, retain full animation at every spread, and ignore character opacity',()=>{
 const s=setup();s.update();assert.equal(s.group.children.length,49);assert.equal(s.group.visible,true);
 for(const mesh of s.group.children)assert.ok(mesh.visible);
 const initial=s.group.children.map(m=>m.position.clone());
 assert.equal(new Set(initial.map(p=>p.toArray().join(','))).size,7);
 s.deck.params.gridSpread=1;s.update();
 for(const mesh of s.group.children)assert.ok(mesh.position.distanceTo(mesh.userData.grid)<1e-10);
 const displacement=new THREE.Vector3(.13,.21,-.08);s.bones.forEach(b=>b.position.add(displacement));
 for(const spread of [0,.5,1]){
  s.deck.params.gridSpread=spread;s.update();
  s.group.children.forEach((mesh,i)=>{
   const expected=initial[i].clone().lerp(mesh.userData.grid,spread).add(displacement);
   assert.ok(mesh.position.distanceTo(expected)<1e-10);
  });
 }
 s.deck.params.sphereSize=.19;s.update();assert.equal(s.group.children[0].scale.x,.19);
 s.deck.pose=null;s.update();assert.equal(s.group.visible,false);
 s.scene.dispose();assert.deepEqual(s.camera.position,s.original);assert.deepEqual(s.camera.quaternion.toArray(),s.rotation.toArray());
});
test('missing joints hide only their spheres and invalid parameters cannot corrupt transforms',()=>{
 const group=new THREE.Group(),scene=createScene({THREE,group});
 const deck={animation:{id:'real-house'},pose:{worldPositions:{leftHand:[1,2,3],rightHand:[NaN,0,0]}},params:{gridSpread:NaN,sphereSize:Infinity}};
 scene.update(deck);assert.equal(group.children.filter(m=>m.visible).length,7);
 for(const mesh of group.children.filter(m=>m.visible)){assert.deepEqual(mesh.position.toArray(),[1,2,3]);assert.equal(mesh.scale.x,.065);}
});
test('low/mid/high OSC and MIDI control opacity, spread, size on separate decks',()=>{
 const store=new ParameterStore();let scene='real-house';const router=new OscParameterRouter(store,()=>scene);
 for(const [source,deck]of [[3,1],[4,2]]){
  for(const [band,value]of [['low',-1],['mid',1],['high',1]])router.ingest(`/djay/mixer/turntable${source}/eq/${band}`,[value],0);
  assert.deepEqual(store.get(deck,scene),{characterOpacity:0,gridSpread:1,sphereSize:.22});
 }
 store.midi([176,21,0],()=>scene);assert.equal(store.get(1,scene).gridSpread,0);assert.equal(store.get(2,scene).gridSpread,1);
 router.ingest('/djay/mixer/turntable3/eq/mid',[1],1);assert.equal(store.get(1,scene).gridSpread,0);
 store.midi([176,22,0],()=>scene);assert.equal(store.get(1,scene).sphereSize,.015);
 assert.equal(router.snapshot(1).bands.high.parameter,'sphereSize');
 scene='rumble';router.sync();assert.equal(store.get(1,scene).particleRate,800);assert.equal(store.get(1,scene).particleSpeed,3);
});
