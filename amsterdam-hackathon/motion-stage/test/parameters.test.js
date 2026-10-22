import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {ParameterStore} from '../server/parameters.js';
import rumble from '../public/scenes/rumble.js';

test('parameters validate atomically, clamp, isolate decks/scenes, and reset',()=>{
  const store=new ParameterStore();
  assert.equal(store.get(1,'rumble').characterOpacity,1);
  store.set(1,'rumble',{characterOpacity:-1,particleRate:9999});
  assert.equal(store.get(1,'rumble').characterOpacity,0);
  assert.equal(store.get(1,'rumble').particleRate,800);
  assert.equal(store.get(2,'rumble').characterOpacity,1);
  assert.equal(store.get(1,'cyan').characterOpacity,1);
  for(const patch of [{characterOpacity:.5,bad:1},{characterOpacity:NaN},{characterOpacity:'0.5'},JSON.parse('{"__proto__":1}')])assert.throws(()=>store.set(1,'rumble',patch));
  assert.equal(store.get(1,'rumble').characterOpacity,0);
  assert.throws(()=>store.set(3,'rumble',{}));
  assert.equal(store.reset(1,'rumble').characterOpacity,1);
});
test('MIDI routes CC by channel and maps endpoints; ignores notes and unknown controls',()=>{
  const store=new ParameterStore(),scene=()=> 'rumble';
  assert.equal(store.midi([0xb0,20,0],scene).matched,true);
  assert.equal(store.get(1,'rumble').characterOpacity,0);
  store.midi([0xb1,21,127],scene);
  assert.equal(store.get(2,'rumble').particleRate,800);
  assert.equal(store.get(1,'rumble').particleRate,240);
  assert.equal(store.midi([0x90,60,127],scene).matched,false);
  assert.equal(store.midi([0xb0,99,127],scene).matched,false);
  assert.equal(store.midi([0xb2,20,0],scene).matched,false);
  assert.throws(()=>store.midi([0xb0,20,128],scene));
  assert.throws(()=>store.midi([0xb0,20],scene));
  store.midi([0xb1,20,0],scene,1);
  assert.equal(store.get(1,'rumble').characterOpacity,0);
});
test('Rumble emits at both hands while invisible, follows movement, expires and resets trails',()=>{
  const group=new THREE.Group(),scene=rumble({THREE,group});
  const deck={animation:{id:'rumble'},time:0,params:{characterOpacity:0,particleRate:10,particleLifetime:.1,particleSpeed:0},pose:{worldPositions:{leftHand:[-1,2,3],rightHand:[1,2,3]}}};
  scene.update(deck,.1);
  const geometry=group.children[0].geometry,positions=geometry.attributes.position.array,alpha=geometry.attributes.alpha.array;
  assert.deepEqual([...positions.slice(0,6)],[-1,2,3,1,2,3]);
  assert.equal([...alpha].filter(v=>v>0).length,2);
  deck.params.particleRate=0;scene.update(deck,.1);
  assert.equal([...alpha].filter(v=>v>0).length,0);
  deck.params.particleRate=10;deck.pose.worldPositions.leftHand=[-2,3,4];scene.update(deck,.1);
  assert.deepEqual([...positions.slice(6,9)],[-2,3,4]);
  deck.time=10;deck.params.particleRate=0;scene.update(deck,.01);
  assert.equal([...alpha].filter(v=>v>0).length,0);
  assert.equal(scene.background,'#000000');assert.equal(scene.environment,false);
});

test('bipolar camera MIDI has exact left, neutral and right positions',()=>{
  const store=new ParameterStore(),scene=()=> 'first-of-year';
  for(const [value,speed] of [[0,-60],[32,-30],[64,0],[127,60]]){
    store.midi([176,24,value],scene);assert.equal(store.get(1,scene()).cameraOrbitSpeed,speed);
  }
  assert.equal(store.get(2,scene()).cameraOrbitSpeed,0);
});
