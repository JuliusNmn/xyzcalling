import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import createScene from '../public/scenes/wide-open.js';
import {ParameterStore} from '../server/parameters.js';
import {OscParameterRouter} from '../server/osc-parameters.js';

function setup(){
  const camera=new THREE.PerspectiveCamera(38,1.6,.05,40);camera.position.set(3,2,4);camera.lookAt(0,1,0);camera.zoom=.9;
  const model=new THREE.Group(),hip=new THREE.Bone();hip.name='mixamorig:Hips';hip.position.y=1;model.add(hip);
  const mesh=new THREE.SkinnedMesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial());model.add(mesh);mesh.bind(new THREE.Skeleton([hip]));model.updateMatrixWorld(true);
  let active=model;
  const hook=createScene({THREE,group:new THREE.Group(),camera,getModel:()=>active});
  const deck={animation:{id:'wide-open'},time:0,revision:1,pose:{worldPositions:{}},params:{characterScale:1,feedbackRate:.7,characterOpacity:1}};
  return {camera,model,hip,mesh,hook,deck,setActive:value=>active=value};
}

test('camera follows animated hips; scaling preserves rig and camera/material state is restored',()=>{
  const {camera,model,hip,mesh,hook,deck,setActive}=setup();
  const original=mesh.material,position=camera.position.clone(),quaternion=camera.quaternion.clone(),scale=model.scale.clone();
  hook.update(deck);assert(mesh.material.isMeshNormalMaterial);const before=camera.position.clone();
  hip.position.set(3,2,-4);model.updateMatrixWorld(true);deck.params.characterScale=1.5;hook.update(deck);
  assert.deepEqual(camera.position.clone().sub(before).toArray(),[3,1,-4]);assert.equal(camera.zoom,1.5);assert.deepEqual(model.scale,scale);
  deck.params.characterOpacity=0;hook.update(deck);assert.equal(model.visible,false);
  setActive(null);hook.update(deck);assert.equal(mesh.material,original);
  hook.dispose();assert.deepEqual(camera.position,position);assert.deepEqual(camera.quaternion.toArray(),quaternion.toArray());assert.equal(camera.zoom,.9);
});

test('feedback uses distinct buffers, time-based decay, clears on seek/resize/unload, and releases GPU targets',()=>{
  const {hook,deck}=setup(),target=new THREE.WebGLRenderTarget(640,360),calls=[],buffers=new Set();let active=target,disposed=0;
  const renderer={getRenderTarget:()=>active,setRenderTarget:t=>{active=t;},render:scene=>{
    if(scene.background){calls.push({clear:true});return;}
    const u=scene.children[0].material.uniforms;
    if(u.history){
      assert.notEqual(active.texture,u.history.value);assert.notEqual(active.texture,u.current.value);
      calls.push({retention:u.retention.value,history:u.history.value,texel:u.texel.value.clone()});
      if(!buffers.has(active)){buffers.add(active);active.addEventListener('dispose',()=>disposed++);}
    }
  }};
  const render=dt=>{calls.length=0;hook.postprocess(renderer,target,dt);assert.equal(active,target);return calls.find(c=>!c.clear);};
  hook.update(deck);const first=render(1/60);assert.equal(calls.filter(c=>c.clear).length,2);
  const second=render(1/30);assert(Math.abs(second.retention-first.retention**2)<1e-12);assert.notEqual(first.history,second.history);assert.equal(calls.filter(c=>c.clear).length,0);
  deck.params.feedbackRate=0;hook.update(deck);assert.equal(render(1/60).retention,0);
  deck.params.feedbackRate=1;hook.update(deck);assert(render(1/60).retention>first.retention);
  deck.time=12;hook.update(deck);render(1/60);assert.equal(calls.filter(c=>c.clear).length,2);
  target.setSize(320,180);render(1/60);assert.equal(calls.filter(c=>c.clear).length,2);
  deck.pose=null;hook.update(deck);assert.equal(render(1/60).retention,0);assert.equal(calls.filter(c=>c.clear).length,2);
  const beforeDispose=disposed;hook.dispose();assert.equal(disposed-beforeDispose,2);
});

test('C/D mid EQ controls size and high EQ controls feedback; MIDI and scene isolation remain intact',()=>{
  const store=new ParameterStore();let scene='wide-open';const router=new OscParameterRouter(store,()=>scene);
  for(const [source,deck]of [[3,1],[4,2]]){
    for(const [raw,size,feedback]of [[-1,.5,0],[0,1,.5],[1,1.5,1]]){
      router.ingest(`/djay/mixer/turntable${source}/eq/mid`,[raw],0);router.ingest(`/djay/mixer/turntable${source}/eq/high`,[raw],0);
      assert.equal(store.get(deck,scene).characterScale,size);assert.equal(store.get(deck,scene).feedbackRate,feedback);
    }
  }
  store.set(1,scene,{feedbackRate:.3});router.ingest('/djay/mixer/turntable3/eq/high',[1],1);assert.equal(store.get(1,scene).feedbackRate,.3);
  store.midi([176,21,0],()=>scene);store.midi([176,22,0],()=>scene);assert.equal(store.get(1,scene).characterScale,.5);assert.equal(store.get(1,scene).feedbackRate,0);assert.equal(store.get(2,scene).feedbackRate,1);
  scene='freestyler';router.sync();assert.equal(store.get(1,scene).printStyle,1);assert.equal(store.get(1,scene).saleType,1);assert.equal(store.get(1,scene).feedbackRate,undefined);
});
