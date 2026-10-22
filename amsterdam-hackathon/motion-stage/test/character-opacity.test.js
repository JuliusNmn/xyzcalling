import test from 'node:test';
import assert from 'node:assert/strict';
import {Bone,BoxGeometry,Float32BufferAttribute,Frustum,Group,Matrix4,MeshStandardMaterial,PerspectiveCamera,Skeleton,SkinnedMesh,Uint16BufferAttribute} from 'three';
import {setCharacterOpacity} from '../public/character-opacity.js';
import {ParameterStore} from '../server/parameters.js';
import {OscParameterRouter} from '../server/osc-parameters.js';

function dancer(){
  const geometry=new BoxGeometry(1,2,1),count=geometry.attributes.position.count;
  geometry.setAttribute('skinIndex',new Uint16BufferAttribute(new Uint16Array(count*4),4));
  const weights=new Float32Array(count*4);for(let i=0;i<count;i++)weights[i*4]=1;
  geometry.setAttribute('skinWeight',new Float32BufferAttribute(weights,4));
  const mesh=new SkinnedMesh(geometry,new MeshStandardMaterial()),hip=new Bone(),model=new Group();
  mesh.add(hip);mesh.bind(new Skeleton([hip]));model.add(mesh);model.updateMatrixWorld(true);
  return {model,mesh,hip};
}
test('moving skin remains renderable after the camera leaves its cached bounds and opacity returns from zero',()=>{
  const {model,mesh,hip}=dancer(),camera=new PerspectiveCamera(38,1.8,.05,40),frustum=new Frustum();
  const follow=()=>{model.updateMatrixWorld(true);camera.position.set(hip.position.x,0,4.6);camera.lookAt(hip.position.x,0,0);camera.updateMatrixWorld(true);frustum.setFromProjectionMatrix(new Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));};
  follow();assert.equal(frustum.intersectsObject(mesh),true); // Cache the first pose, as WebGLRenderer does.
  setCharacterOpacity(model,0);hip.position.x=20;follow();
  assert.equal(frustum.intersectsObject(mesh),false,'the initial skin sphere is now off-screen');
  setCharacterOpacity(model,1);
  assert.equal(model.visible,true);
  assert.equal(!mesh.frustumCulled||frustum.intersectsObject(mesh),true,'renderer must submit the moving skin');
  mesh.computeBoundingSphere();assert.equal(frustum.intersectsObject(mesh),true,'the actual current skin remains in view');
});
test('Gal a Bubble slider, MIDI and Low EQ restore opacity on both decks without unchanged OSC dumps overriding the slider',()=>{
  const scene='gal-a-bubble',store=new ParameterStore(),router=new OscParameterRouter(store,()=>scene);
  for(const deck of [1,2]){
    const {model,mesh}=dancer(),address=`/djay/mixer/turntable${deck+2}/eq/low`;
    const check=value=>{setCharacterOpacity(model,store.get(deck,scene).characterOpacity);assert.equal(mesh.material.opacity,value);assert.equal(model.visible,value>0);assert.equal(mesh.material.transparent,value<1);assert.equal(mesh.material.depthWrite,value===1);};
    router.ingest(address,[-1],0);check(0);
    store.set(deck,scene,{characterOpacity:1});router.ingest(address,[-1],1);check(1);
    router.ingest(address,[0],2);check(.5);
    router.ingest(address,[-1],3);check(0);
    router.ingest(address,[1],4);check(1);
    store.midi([175+deck,20,0],()=>scene);check(0);
    store.midi([175+deck,20,127],()=>scene);check(1);
    setCharacterOpacity(model,1,false);assert.equal(model.visible,false,'a mismatched asset stays hidden');
  }
});
