import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import createScene from '../public/scenes/first-of-year.js';
import motion from '../public/scenes/data/first-of-year.js';
import {analyzeFootfalls,rootAt} from '../public/scenes/disco-contacts.js';

const fps=30;
function steps(){return Array.from({length:181},(_,i)=>{
  const time=i/fps;
  const lift=start=>time>=start&&time<=start+.6?.18*Math.sin((time-start)/.6*Math.PI):0;
  return {time,root:[time,-time*.5],feet:[[-.15,.1+lift(1)+lift(3),0],[.15,.1,0]]};
});}
test('contacts emit once on landing, never on takeoff, planted feet or centimetre jitter',()=>{
  const samples=steps(),{events}=analyzeFootfalls(samples,fps);
  assert.equal(events.length,2);
  events.forEach((event,i)=>{assert.equal(event.foot,0);assert(Math.abs(event.time-[1.6,3.6][i])<.1);assert.equal(event.x,event.time-.15);assert.equal(event.z,-event.time*.5);});
  const jitter=samples.map((s,i)=>({...s,feet:[[-.15,.1+Math.sin(i)*.01,0],[.15,.1,0]]}));
  assert.equal(analyzeFootfalls(jitter,fps).events.length,0);
  const both=samples.map(s=>({...s,feet:[s.feet[0],[.15,s.feet[0][1],0]]}));
  assert.equal(analyzeFootfalls(both,fps).events.length,4);
});
test('root trajectory interpolates in aligned world coordinates and holds endpoints',()=>{
  const source={fps:30,root_xz:[[0,0],[2,-4]]};
  assert.deepEqual(rootAt(source,-1),[0,0]);assert.deepEqual(rootAt(source,1/60),[1,-2]);assert.deepEqual(rootAt(source,8),[2,-4]);
  assert.equal(motion.root_xz.length,4275);assert.deepEqual(rootAt(motion,0),[0,0]);
  assert(Math.max(...motion.root_xz.map(p=>Math.hypot(...p)))>5);
});
test('scene uses animation time and reconstructs exactly after seeks, pauses, loops and model switches',()=>{
  const group=new THREE.Group(),scene=createScene({THREE,group});
  const floor=group.children.find(o=>o.isMesh),u=floor.material.uniforms;
  const deck=(time,characterId='chicken')=>({time:999,animation:{id:'first-of-year',time,characterId},pose:{worldPositions:{leftFoot:[-.1,.15,0],rightFoot:[.1,.15,0]}}});
  const event=motion.profiles.chicken.events[0],time=event.time+.3;
  const snapshot=()=>({time:u.time.value,travel:u.travel.value.toArray(),count:u.count.value,waves:u.waves.value.slice(0,u.count.value).map(v=>v.toArray()),floor:floor.position.y});
  scene.update(deck(time));const first=snapshot();assert(first.count>0);assert.equal(first.time,time);
  scene.update(deck(time),10);assert.deepEqual(snapshot(),first,'paused timeline must freeze');
  scene.update(deck(110));scene.update(deck(0));assert.equal(u.count.value,0);
  scene.update(deck(time));assert.deepEqual(snapshot(),first,'seek history must not affect waves');
  scene.update(deck(time,'ch20-nonpbr'));assert.equal(group.userData.footfalls,motion.profiles['ch20-nonpbr'].events.length);
  scene.update(deck(time));assert.deepEqual(snapshot(),first);
  scene.update({...deck(time),animation:{id:'rumble',time}});assert.equal(group.visible,false);
  assert.equal(scene.environment,false);
});
test('calibrated contact profiles cover every selectable character without duplicate foot strikes',()=>{
  assert.deepEqual(Object.keys(motion.profiles),['embedded','chicken','ch20-nonpbr','ch20-character']);
  for(const profile of Object.values(motion.profiles)){
    assert(profile.events.length>50&&profile.events.length<200);
    assert(profile.floor.length>=Math.floor(motion.duration*profile.floorFps));
    for(const foot of [0,1]){
      const events=profile.events.filter(e=>e.foot===foot);
      events.forEach((e,i)=>{assert(Object.values(e).every(Number.isFinite));assert(e.time>=0&&e.time<=motion.duration);if(i)assert(e.time-events[i-1].time>=.17999);});
    }
  }
});

test('each character instance has matching floor waves and opacity never removes the floor',()=>{
  const group=new THREE.Group(),scene=createScene({THREE,group});
  const uniforms=group.children.find(o=>o.isMesh).material.uniforms;
  const time=motion.profiles.chicken.events[0].time+.1;
  const deck={animation:{id:'first-of-year',time,characterId:'chicken'},params:{characterCount:1,characterOpacity:0},pose:{worldPositions:{leftFoot:[-.1,.15,0],rightFoot:[.1,.15,0]}}};
  scene.update(deck);const count=uniforms.count.value;
  deck.params.characterCount=6;scene.update(deck);
  assert.equal(uniforms.count.value,count*6);assert.equal(group.visible,true);
  assert.equal(uniforms.feet.value.filter(p=>p.w>0).length,12);
  deck.params.characterCount=1;scene.update(deck);assert.equal(uniforms.count.value,count);
  assert.equal(uniforms.feet.value.filter(p=>p.w>0).length,2);
});

test('camera orbits left/right, stops at center without snapping, aims at center and restores on exit',()=>{
  const camera=new THREE.PerspectiveCamera(38,1.4,.05,40);camera.position.set(3,1.85,4.3);camera.lookAt(0,.9,0);
  const initial=camera.position.clone(),rotation=camera.quaternion.clone();
  const scene=createScene({THREE,group:new THREE.Group(),camera});
  const deck={animation:{id:'first-of-year',time:5,characterId:'chicken'},params:{cameraOrbitSpeed:0,characterCount:1},pose:{worldPositions:{}}};
  scene.update(deck,0);
  const angle=()=>Math.atan2(camera.position.x,camera.position.z);
  const start=angle();deck.params.cameraOrbitSpeed=60;scene.update(deck,.1);
  assert(Math.abs(angle()-start-Math.PI/30)<1e-10);
  deck.params.cameraOrbitSpeed=0;const stopped=camera.position.clone();
  scene.update(deck,.1);assert(camera.position.distanceTo(stopped)<1e-10);
  deck.params.cameraOrbitSpeed=-60;scene.update(deck,.1);assert(Math.abs(angle()-start)<1e-10);
  const direction=camera.getWorldDirection(new THREE.Vector3());
  assert(direction.distanceTo(new THREE.Vector3(0,.85,0).sub(camera.position).normalize())<1e-10);
  deck.params.characterCount=6;deck.params.cameraOrbitSpeed=0;
  for(let i=0;i<200;i++)scene.update(deck,.1);
  const center=new THREE.Vector3(0,.85,-.9);
  assert(camera.getWorldDirection(new THREE.Vector3()).distanceTo(center.clone().sub(camera.position).normalize())<1e-9);
  assert(Math.hypot(camera.position.x,camera.position.z+.9)>6);
  scene.dispose();assert(camera.position.distanceTo(initial)<1e-10);assert(camera.quaternion.angleTo(rotation)<1e-7);
});
test('camera angular speed is independent of render cadence',()=>{
  const angleAt=fps=>{
    const camera=new THREE.PerspectiveCamera(38,1.4,.05,40);camera.position.set(3,1.85,4.3);
    const scene=createScene({THREE,group:new THREE.Group(),camera});
    const deck={animation:{id:'first-of-year',time:5},params:{cameraOrbitSpeed:-30},pose:{worldPositions:{}}};
    for(let i=0;i<fps;i++)scene.update(deck,1/fps);
    return Math.atan2(camera.position.x,camera.position.z);
  };
  assert(Math.abs(angleAt(30)-angleAt(60))<1e-10);
});
