import test from 'node:test';
import assert from 'node:assert/strict';
import {Bone,Group,BoxGeometry,MeshStandardMaterial,SkinnedMesh,Skeleton,Vector3} from 'three';
import {CharacterInstances,characterOffsets} from '../public/character-instances.js';
import {ParameterStore} from '../server/parameters.js';
import {OscParameterRouter} from '../server/osc-parameters.js';

test('instance controls clamp and round slider, MIDI and mid EQ to 1–6; low remains opacity',()=>{
  const store=new ParameterStore();let scene='first-of-year';const router=new OscParameterRouter(store,()=>scene);
  assert.equal(store.get(1,scene).characterCount,1);
  store.set(1,scene,{characterCount:3.7});assert.equal(store.get(1,scene).characterCount,4);
  store.midi([176,21,0],()=>scene);assert.equal(store.get(1,scene).characterCount,1);
  store.midi([176,21,127],()=>scene);assert.equal(store.get(1,scene).characterCount,6);
  for(const [raw,count] of [[-1,1],[-.6,2],[-.2,3],[.2,4],[.6,5],[1,6]]){
    router.ingest('/djay/mixer/turntable3/eq/mid',[raw],0);assert.equal(store.get(1,scene).characterCount,count);
  }
  router.ingest('/djay/mixer/turntable3/eq/low',[-.5],1);assert.equal(store.get(1,scene).characterOpacity,.25);
  assert.equal(store.get(2,scene).characterCount,1);
  assert.equal(router.snapshot(1).bands.mid.parameter,'characterCount');
  store.set(1,scene,{characterCount:2});router.ingest('/djay/mixer/turntable3/eq/mid',[1],2);
  assert.equal(store.get(1,scene).characterCount,2,'unchanged state dumps must respect manual slider');
  scene='rumble';router.sync();assert.equal(store.get(1,scene).particleRate,800);
  scene='first-of-year';router.sync();assert.equal(store.get(1,scene).characterCount,6);
  router.ingest('/djay/mixer/turntable4/eq/mid',[-1],3);assert.equal(store.get(2,scene).characterCount,1);
});
test('copies synchronize bones, share opacity, keep world spacing, hide on decrease, and release only owned skeletons',()=>{
  const source=new Group();source.scale.setScalar(.01);
  const mesh=new SkinnedMesh(new BoxGeometry(),new MeshStandardMaterial()),hip=new Bone(),foot=new Bone();
  hip.add(foot);mesh.add(hip);mesh.bind(new Skeleton([hip,foot]));source.add(mesh);
  const instances=new CharacterInstances();instances.update(source,6);
  assert.equal(instances.group.children.length,5);assert.equal(new Set(characterOffsets(6).map(JSON.stringify)).size,6);
  const copy=instances.group.children[0].children[0];
  assert.notEqual(copy.skeleton,mesh.skeleton);assert.notEqual(copy.skeleton.bones[0],hip);
  assert.equal(copy.geometry,mesh.geometry);assert.equal(copy.material,mesh.material);
  hip.position.set(10,100,5);foot.quaternion.setFromAxisAngle(new Vector3(1,0,0),.5);mesh.material.opacity=.25;
  instances.update(source,6);
  assert.deepEqual(copy.skeleton.bones[0].position.toArray(),hip.position.toArray());
  assert.deepEqual(copy.skeleton.bones[1].quaternion.toArray(),foot.quaternion.toArray());
  assert.equal(copy.material.opacity,.25);
  assert.deepEqual(instances.group.children[0].position.toArray(),[-1.45,0,0]);
  instances.update(source,6);assert.equal(instances.group.children[0].position.x,-1.45,'spacing must not accumulate');
  instances.update(source,2);assert.equal(instances.group.children.filter(n=>n.visible).length,1);
  source.visible=false;instances.update(source,6);assert.equal(instances.group.children.filter(n=>n.visible).length,0);
  let disposed=0;mesh.material.addEventListener('dispose',()=>disposed++);mesh.geometry.addEventListener('dispose',()=>disposed++);
  instances.update(new Group(),1);assert.equal(instances.group.children.length,0);assert.equal(disposed,0);
});
