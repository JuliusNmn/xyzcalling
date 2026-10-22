import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import createScene from '../public/scenes/ready.js';
import {ParameterStore} from '../server/parameters.js';
import {OscParameterRouter} from '../server/osc-parameters.js';
function setup(){
  const group=new THREE.Group(),camera=new THREE.PerspectiveCamera(38,1.8,.05,40);
  camera.position.set(3,1.85,4.3);camera.lookAt(0,.9,0);
  const initial=camera.position.clone(),rotation=camera.quaternion.clone();
  const scene=createScene({THREE,group,camera});
  const deck={animation:{id:'ready',time:4},beat:8,time:4,params:{rubberWarp:.55,shardFrenzy:.5,characterOpacity:0},pose:{worldPositions:{head:[0,1.7,0],leftHand:[-.7,1.2,.1],rightHand:[.7,1.4,0],leftFoot:[-.2,.1,0],rightFoot:[.2,.1,0]}}};
  const snapshot=()=>group.children.map(n=>Array.from(n.isInstancedMesh?n.instanceMatrix.array:n.geometry.attributes.position.array));
  return {group,camera,initial,rotation,scene,deck,snapshot};
}
test('Ready is pose-reactive, deterministic on pause/seek and independent of opacity',()=>{
  const s=setup();s.scene.update(s.deck);const original=s.snapshot();
  assert.equal(s.group.visible,true);assert.equal(s.group.children[7].count,96);
  s.scene.update(s.deck,10);assert.deepEqual(s.snapshot(),original);
  s.deck.animation.time=30;s.deck.beat=60;s.scene.update(s.deck);
  s.deck.animation.time=4;s.deck.beat=8;s.scene.update(s.deck);assert.deepEqual(s.snapshot(),original);
  s.deck.params.characterOpacity=1;s.scene.update(s.deck);assert.deepEqual(s.snapshot(),original);
  s.deck.pose.worldPositions.leftHand[1]+=1;s.scene.update(s.deck);assert.notDeepEqual(s.snapshot(),original);
  s.deck.params.rubberWarp=1;s.deck.params.shardFrenzy=1;s.scene.update(s.deck);
  assert(s.snapshot().flat().every(Number.isFinite));
  s.deck.pose=null;s.scene.update(s.deck);assert.equal(s.group.visible,false);
  s.scene.dispose();assert.deepEqual(s.camera.position,s.initial);assert.deepEqual(s.camera.quaternion.toArray(),s.rotation.toArray());
});
test('Ready handles missing limbs and follows actual rendered joints',()=>{
  const s=setup();s.deck.pose.worldPositions.leftHand=[NaN,0,0];delete s.deck.pose.worldPositions.rightFoot;
  s.scene.update(s.deck);assert.equal(s.group.children[7].count,48);assert(s.snapshot().flat().every(Number.isFinite));
  const model=new THREE.Group(),hip=new THREE.Bone(),hand=new THREE.Bone();hip.name='mixamorig:Hips';hand.name='mixamorig:LeftHand';
  hip.position.set(2,1,0);hand.position.set(-.5,.3,0);hip.add(hand);model.add(hip);model.updateMatrixWorld(true);
  const group=new THREE.Group(),scene=createScene({THREE,group,camera:s.camera,getModel:()=>model});
  s.deck.pose.worldPositions.leftHand=[0,0,0];scene.update(s.deck);
  const a=Array.from(group.children[7].instanceMatrix.array);
  hand.position.y+=.4;model.updateMatrixWorld(true);scene.update(s.deck);
  assert.notDeepEqual(Array.from(group.children[7].instanceMatrix.array),a);
  assert(Math.abs(s.camera.position.x-2.25)<1e-8);scene.dispose();
});
test('Ready mid/high endpoints alter the sculpture and low/mid/high route on both decks',()=>{
  const s=setup();s.deck.params.rubberWarp=0;s.deck.params.shardFrenzy=0;s.scene.update(s.deck);const calm=s.snapshot();
  s.deck.params.rubberWarp=1;s.scene.update(s.deck);const warped=s.snapshot();
  assert.notDeepEqual(warped[0],calm[0]);assert.deepEqual(warped[7],calm[7]);
  s.deck.params.shardFrenzy=1;s.scene.update(s.deck);assert.notDeepEqual(s.snapshot()[7],warped[7]);
  const store=new ParameterStore();let name='ready';const router=new OscParameterRouter(store,()=>name);
  for(const [source,deck] of [[3,1],[4,2]]){
    for(const band of ['low','mid','high'])router.ingest(`/djay/mixer/turntable${source}/eq/${band}`,[-1],0);
    assert.deepEqual(store.get(deck,name),{characterOpacity:0,rubberWarp:0,shardFrenzy:0});
    for(const band of ['low','mid','high'])router.ingest(`/djay/mixer/turntable${source}/eq/${band}`,[1],1);
    assert.deepEqual(store.get(deck,name),{characterOpacity:1,rubberWarp:1,shardFrenzy:1});
  }
  store.set(1,name,{rubberWarp:.2});router.ingest('/djay/mixer/turntable3/eq/mid',[1],2);assert.equal(store.get(1,name).rubberWarp,.2);
  store.midi([176,22,0],()=>name);assert.equal(store.get(1,name).shardFrenzy,0);
  name='rumble';router.sync();assert.equal(store.get(1,name).particleRate,800);
});
