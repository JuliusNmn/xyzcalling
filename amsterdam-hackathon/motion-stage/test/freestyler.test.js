import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import createScene from '../public/scenes/freestyler.js';
import {ParameterStore} from '../server/parameters.js';
import {OscParameterRouter} from '../server/osc-parameters.js';

test('outline survives low zero; shading, type, pose following and restoration are independent',()=>{
 const camera=new THREE.PerspectiveCamera(38,1.6,.05,40);camera.position.set(3,1.85,4.3);camera.lookAt(0,.9,0);
 const oldPosition=camera.position.clone(),oldQuaternion=camera.quaternion.clone();
 const group=new THREE.Group(),model=new THREE.Group(),hip=new THREE.Bone();hip.name='mixamorig:Hips';hip.position.y=1;model.add(hip);
 const original=new THREE.MeshStandardMaterial(),geometry=new THREE.BoxGeometry(.5,1,.4),mesh=new THREE.Mesh(geometry,original);hip.add(mesh);
 let active=model,geometryDisposed=false;geometry.addEventListener('dispose',()=>geometryDisposed=true);
 const hook=createScene({THREE,group,camera,getModel:()=>active});
 const deck={animation:{id:'freestyler'},pose:{worldPositions:{}},beat:4,params:{characterOpacity:0,printStyle:0,saleType:0}};
 model.updateMatrixWorld(true);model.visible=false;hook.update(deck);
 assert.equal(hook.background,'#000000');assert.equal(hook.environment,false);assert.equal(model.visible,true);
 assert.equal(mesh.material.uniforms.fill.value,0);assert.equal(mesh.material.transparent,false);
 const outline=group.getObjectByName('Freestyler · cream ink contour'),sign=group.getObjectByName('FREE STYLE! · dimensional sale burst');
 assert.equal(outline.visible,true);assert.equal(outline.material.side,THREE.BackSide);assert.ok(outline.material.uniforms.shell.value<0);
 assert.deepEqual(outline.matrix.elements,mesh.matrixWorld.elements);assert.equal(sign.visible,false);
 deck.params={characterOpacity:1,printStyle:1,saleType:1};hook.update(deck);
 assert.equal(mesh.material.uniforms.fill.value,1);assert.equal(mesh.material.uniforms.print.value,1);assert.equal(sign.visible,true);
 assert.ok(sign.children.some(n=>n.geometry?.type==='ExtrudeGeometry'),'real dimensional lettering');
 const before=camera.position.clone();hip.position.x=2;model.updateMatrixWorld(true);hook.update(deck);
 assert.ok(Math.abs(camera.position.x-before.x-2)<1e-8);assert.deepEqual(outline.matrix.elements,mesh.matrixWorld.elements);
 active=null;hook.update(deck);assert.equal(mesh.material,original);assert.equal(outline.parent,null);assert.equal(group.visible,false);
 hook.dispose();assert.equal(geometryDisposed,false);assert.deepEqual(camera.position,oldPosition);assert.deepEqual(camera.quaternion.toArray(),oldQuaternion.toArray());
});

test('skinned contour shares the animated skeleton without taking geometry ownership',()=>{
 const model=new THREE.Group(),mesh=new THREE.SkinnedMesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial());
 const bone=new THREE.Bone();bone.name='Hips';mesh.add(bone);mesh.bind(new THREE.Skeleton([bone]));model.add(mesh);model.updateMatrixWorld(true);
 const group=new THREE.Group(),hook=createScene({THREE,group,camera:new THREE.PerspectiveCamera(),getModel:()=>model});
 hook.update({animation:{},pose:{worldPositions:{}},params:{}});
 const outline=group.getObjectByName('Freestyler · cream ink contour');assert.equal(outline.skeleton,mesh.skeleton);assert.equal(outline.geometry,mesh.geometry);
 hook.dispose();assert.equal(outline.parent,null);assert.ok(mesh.material.isMeshBasicMaterial);
});

test('all three controls accept MIDI and C/D EQ, with scene isolation and manual override',()=>{
 const store=new ParameterStore();let scene='freestyler';const router=new OscParameterRouter(store,()=>scene);
 for(const [source,target]of [[3,1],[4,2]]){
  for(const band of ['low','mid','high'])router.ingest(`/djay/mixer/turntable${source}/eq/${band}`,[-1],0);
  assert.deepEqual(store.get(target,scene),{characterOpacity:0,printStyle:0,saleType:0});
  for(const band of ['low','mid','high'])router.ingest(`/djay/mixer/turntable${source}/eq/${band}`,[1],1);
  assert.deepEqual(store.get(target,scene),{characterOpacity:1,printStyle:1,saleType:1});
 }
 store.set(1,scene,{printStyle:.23});router.ingest('/djay/mixer/turntable3/eq/mid',[1],2);assert.equal(store.get(1,scene).printStyle,.23);
 for(const [cc,key]of [[20,'characterOpacity'],[21,'printStyle'],[22,'saleType']]){store.midi([176,cc,0],()=>scene);assert.equal(store.get(1,scene)[key],0);assert.equal(store.get(2,scene)[key],1);}
 scene='rumble';router.sync();assert.equal(store.get(1,scene).particleRate,800);
});
