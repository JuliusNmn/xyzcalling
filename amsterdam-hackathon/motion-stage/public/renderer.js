import * as THREE from 'three';
import {FBXLoader} from 'three/addons/loaders/FBXLoader.js';
import {clone} from 'three/addons/utils/SkeletonUtils.js';
import {parameterDefaults} from './parameters.js';
import {CharacterInstances} from './character-instances.js';
import {setCharacterOpacity} from './character-opacity.js';
export function createRenderer(canvas, anchorsCheckbox, notice=console.error){
const $=id=>({canvas,stage:canvas.parentElement,anchors:anchorsCheckbox}[id]);
let latest,previous,receivedAt=0,catalog=[],characters=[],sceneOverrides={},sceneVersions={};
const colors={cyan:0x87e1d3,amber:0xefad74,violet:0xbb9bf6};
const loaderManager=new THREE.LoadingManager();
loaderManager.addHandler(/.*/,{path:'',setPath(p){this.path=p;return this;},load(){return new THREE.Texture();}});
const loader=new FBXLoader(loaderManager), cache=new Map();
function loadModel(entry){if(!cache.has(entry.url)){cache.set(entry.url,loader.loadAsync(entry.url).then(model=>{model.traverse(n=>{if(n.isMesh){const old=Array.isArray(n.material)?n.material:[n.material];old.forEach(m=>{for(const value of Object.values(m))if(value?.isTexture)value.dispose();m.dispose();});n.material=new THREE.MeshStandardMaterial({color:0xa5b7b0,roughness:.62,metalness:.22});}});return model;}).catch(e=>{cache.delete(entry.url);throw e;}));}return cache.get(entry.url);}
let renderer;
try{renderer=new THREE.WebGLRenderer({canvas:$('canvas'),antialias:true,powerPreference:'high-performance'});}catch(e){notice(`WebGL unavailable: ${e.message}`);}
const stages=[1,2].map(id=>{
  const scene=new THREE.Scene();scene.background=new THREE.Color(0x0a1515);scene.fog=new THREE.Fog(0x0a1515,5,13);
  const camera=new THREE.PerspectiveCamera(38,1,.05,40);camera.position.set(3,1.85,4.3);camera.lookAt(0,.9,0);
  scene.add(new THREE.HemisphereLight(0xcff4eb,0x394930,2.3));
  const key=new THREE.DirectionalLight(0xe5ffed,3.2);key.position.set(2,5,3);scene.add(key);
  const rim=new THREE.DirectionalLight(0x6acbbb,4);rim.position.set(-2,2,-2);scene.add(rim);
  const floor=new THREE.Mesh(new THREE.CircleGeometry(12,80),new THREE.MeshStandardMaterial({color:0x0d1716,roughness:.95}));floor.rotation.x=-Math.PI/2;floor.position.y=-.025;scene.add(floor);
  const grid=new THREE.GridHelper(20,40,0x284b43,0x18332c);grid.position.y=-.02;scene.add(grid);
  const ring=new THREE.Mesh(new THREE.RingGeometry(1.17,1.18,100),new THREE.MeshBasicMaterial({color:colors.cyan,side:THREE.DoubleSide,transparent:true,opacity:.4}));ring.rotation.x=-Math.PI/2;ring.position.y=-.009;scene.add(ring);
  const anchors={};for(const name of ['head','leftHand','rightHand','leftFoot','rightFoot']){const point=new THREE.Mesh(new THREE.SphereGeometry(.027,12,8),new THREE.MeshBasicMaterial({color:0xd9ff85,depthTest:false}));point.renderOrder=10;scene.add(point);anchors[name]=point;}
  const instances=new CharacterInstances();scene.add(instances.group);
  return {id,scene,camera,instances,rim,floor,grid,ring,anchors,target:new THREE.WebGLRenderTarget(1,1),model:null,nodes:[],asset:null,loading:null,sceneName:null};
});
const composite=new THREE.Scene(),quadCamera=new THREE.OrthographicCamera(-1,1,1,-1,0,1);
const mixMaterial=new THREE.ShaderMaterial({uniforms:{a:{value:stages[0].target.texture},b:{value:stages[1].target.texture},mixAmount:{value:0}},vertexShader:'varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position,1.0);}',fragmentShader:'uniform sampler2D a;uniform sampler2D b;uniform float mixAmount;varying vec2 vUv;void main(){gl_FragColor=mix(texture2D(a,vUv),texture2D(b,vUv),mixAmount);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}'});
composite.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2),mixMaterial));
if(renderer){renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.2;}
const resize=()=>{if(!renderer)return;const {width,height}=$('stage').getBoundingClientRect();renderer.setSize(width,height,false);const dpr=renderer.getPixelRatio();for(const stage of stages){stage.camera.aspect=width/height;stage.camera.updateProjectionMatrix();stage.target.setSize(width*dpr,height*dpr);}};
new ResizeObserver(resize).observe($('stage'));resize();
function disposeGroup(group){if(!group)return;group.traverse(n=>{n.geometry?.dispose();for(const m of (Array.isArray(n.material)?n.material:[n.material]))m?.dispose();});group.removeFromParent();}
async function styleScene(stage,name){
  if(stage.sceneName===name||stage.sceneLoading===name)return;
  const token=(stage.sceneToken??0)+1;stage.sceneToken=token;stage.sceneLoading=name;
  const group=new THREE.Group();
  try{
    const module=await import(`/scenes/${name}.js?v=${sceneVersions[name]??0}`);
    const hook=module.default({THREE,group,camera:stage.camera,getModel:()=>stage.asset===assetKey(latest?.decks[stage.id-1]?.animation)?stage.model:null});
    if(stage.sceneToken!==token){hook?.dispose?.();disposeGroup(group);return;}
    stage.hook?.dispose?.();disposeGroup(stage.effects);stage.effects=group;stage.scene.add(group);stage.hook=hook;stage.sceneName=name;
    const color=new THREE.Color(hook.color??colors.cyan);stage.rim.color.copy(color);stage.ring.material.color.copy(color);stage.scene.background.copy(hook.background!==undefined?new THREE.Color(hook.background):color.clone().multiplyScalar(.035));stage.scene.fog.color.copy(stage.scene.background);
    stage.floor.visible=stage.grid.visible=stage.ring.visible=hook.environment!==false;
    if(stage.model)stage.model.traverse(n=>{if(n.isMesh){n.material.color.copy(color);n.material.wireframe=hook.wireframe??false;}});
  }catch(e){disposeGroup(group);stage.sceneName=name;notice(`Scene ${name}: ${e.message}`);}finally{if(stage.sceneToken===token)stage.sceneLoading=null;}
}
const assetKey=animation=>animation?.characterId&&animation.characterId!=='embedded'?'character:'+animation.characterId:'animation:'+animation?.id;
async function ensureModel(stage,animation){
  const id=assetKey(animation);
  if(!animation||stage.asset===id||stage.loading===id)return;
  const entry=animation.characterId&&animation.characterId!=='embedded'?characters.find(e=>e.id===animation.characterId):catalog.find(e=>e.id===animation.id);if(!entry)return;
  stage.loading=id;
  if(stage.model)stage.model.visible=false;
  try{
    const source=await loadModel(entry);if(stage.loading!==id)return;
    stage.instances.clear();
    if(stage.model){stage.scene.remove(stage.model);stage.model.traverse(n=>{if(n.isMesh)n.material.dispose();});}
    const model=clone(source);model.traverse(n=>{if(n.isMesh)n.material=n.material.clone();});
    const wrapper=new THREE.Group();wrapper.scale.setScalar(animation.scale);wrapper.add(model);
    stage.scene.add(wrapper);stage.model=wrapper;stage.nodes=[];model.traverse(n=>stage.nodes.push(n));
    if(stage.nodes.length!==entry.nodeNames.length||stage.nodes.some((n,i)=>n.name!==entry.nodeNames[i]))throw new Error(`Skeleton layout mismatch for ${entry.name}`);
    stage.asset=id;stage.sceneName=null;styleScene(stage,sceneOverrides[stage.id]??stage.activeScene??animation.scene);
  }catch(e){notice(`Could not load character: ${e.message}`);stage.asset=null;}finally{if(stage.loading===id)stage.loading=null;}
}
let lastRender=performance.now();
const p=new THREE.Vector3(),s=new THREE.Vector3(),q=new THREE.Quaternion(),p0=new THREE.Vector3(),s0=new THREE.Vector3(),q0=new THREE.Quaternion();
function animate(){
  requestAnimationFrame(animate);if(!renderer)return;const renderNow=performance.now(),delta=Math.min(.1,(renderNow-lastRender)/1000);lastRender=renderNow;
  const alpha=Math.min(1,Math.max(0,(performance.now()-receivedAt)/33.333));
  for(const stage of stages){
    const deck=latest?.decks[stage.id-1],old=previous?.decks[stage.id-1];
    if(deck?.animation){
      stage.activeScene=deck.scene??deck.animation.scene;
      ensureModel(stage,deck.animation);styleScene(stage,sceneOverrides[stage.id]??stage.activeScene);
      if(stage.asset===assetKey(deck.animation)&&deck.pose){
        const canBlend=old?.animation?.id===deck.animation.id&&assetKey(old.animation)===assetKey(deck.animation)&&old.revision===deck.revision;
        for(let i=0;i<stage.nodes.length;i++){
          const transform=deck.pose.transforms[i];if(!transform)continue;
          p.fromArray(transform);q.fromArray(transform,3);s.fromArray(transform,7);
          const from=canBlend?old.pose?.transforms[i]:null;
          if(from){p0.fromArray(from);q0.fromArray(from,3);s0.fromArray(from,7);p.lerpVectors(p0,p,alpha);q.slerpQuaternions(q0,q,alpha);s.lerpVectors(s0,s,alpha);}
          const node=stage.nodes[i];node.position.copy(p);node.quaternion.copy(q);node.scale.copy(s);
        }
        stage.model.updateMatrixWorld(true);
      }
      for(const [name,point]of Object.entries(stage.anchors)){const pos=deck.pose?.worldPositions[name];point.visible=(typeof anchorsCheckbox==='function'?anchorsCheckbox(name):anchorsCheckbox.checked)&&!!pos&&stage.asset===assetKey(deck.animation);if(pos)point.position.fromArray(pos);}
    }
    if(deck&&stage.hook){
      const params={...parameterDefaults(stage.sceneName),...(deck.sceneParams?.[stage.sceneName]??{}),...(stage.sceneName===(deck.scene??deck.animation?.scene)?deck.params:{})};
      if(stage.model)setCharacterOpacity(stage.model,params.characterOpacity,stage.asset===assetKey(deck.animation));
      const worldPositions={};
      for(const [name,pos] of Object.entries(deck.pose?.worldPositions??{})){
        const previousPos=old?.animation?.id===deck.animation?.id&&assetKey(old.animation)===assetKey(deck.animation)&&old.revision===deck.revision?old.pose?.worldPositions?.[name]:null;
        worldPositions[name]=previousPos?pos.map((v,i)=>previousPos[i]+(v-previousPos[i])*alpha):pos;
      }
      stage.effectDeck={...deck,params,pose:deck.pose?{...deck.pose,worldPositions}:null};
    }
    if(deck&&stage.hook?.update)try{stage.hook.update(stage.effectDeck,delta);}catch(e){notice(`Scene update: ${e.message}`);stage.hook.update=null;}
    stage.instances.update(stage.model,stage.hook?.characterInstances&&deck?.animation&&deck.pose?stage.effectDeck?.params.characterCount:1);
    renderer.setRenderTarget(stage.target);renderer.render(stage.scene,stage.camera);
    if(stage.hook?.postprocess)try{stage.hook.postprocess(renderer,stage.target,delta);}catch(e){notice(`Scene postprocess: ${e.message}`);stage.hook.postprocess=null;}
  }
  mixMaterial.uniforms.mixAmount.value=latest?.crossfader??0;
  renderer.setRenderTarget(null);renderer.render(composite,quadCamera);
}
animate();
return {
 setFrame(frame){previous=latest;latest=frame;receivedAt=performance.now();},
 setCatalog(entries,models=[]){catalog=entries;characters=models;for(const stage of stages){stage.asset=null;stage.loading=null;}cache.clear();},
 setOverride(deck,name){if(name==='auto')delete sceneOverrides[deck];else sceneOverrides[deck]=name;},
 reloadScene(name){sceneVersions[name]=Date.now();for(const stage of stages)if(stage.sceneName===name){stage.sceneName=null;stage.sceneLoading=null;stage.sceneToken=(stage.sceneToken??0)+1;}},
 resize
};
}
