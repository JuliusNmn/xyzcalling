import {characterOffsets} from '../character-instances.js';
import motion from './data/first-of-year.js';
import {rootAt, WAVE_LIFETIME} from './disco-contacts.js';

// First of the Year · scrolling RGB tiles + footfall shockwaves.
// The FBX is in-place. Recover its removed X/Z path from the original NPZ,
// keeping the character centered and every impact fixed to the world floor.
// Contacts were measured from ankle/toe bones on each of Motion Stage's rigs.
const TILE_SIZE=.32, WAVE_SPEED=2.8, SOLE_CLEARANCE=.035, MAX_WAVES=48;
export default function createScene({THREE,group,camera}) {
  // Capture lazily: the renderer disposes the outgoing scene after constructing
  // this one. Restore its camera on exit, including after hot-reloading this file.
  let savedCamera=null,angle=0,radius=5.2;
  const focus=new THREE.Vector3(0,.85,0),desiredFocus=new THREE.Vector3();
  function orbit(offsets,speed,deltaSeconds){
    if(!camera)return;
    if(!savedCamera){
      savedCamera={position:camera.position.clone(),quaternion:camera.quaternion.clone()};
      angle=Math.atan2(camera.position.x,camera.position.z);
    }
    const dt=Number.isFinite(deltaSeconds)?Math.max(0,Math.min(.1,deltaSeconds)):0;
    const velocity=Number.isFinite(speed)?Math.max(-60,Math.min(60,speed)):0;
    // Positive = camera travels right from the initial front view. Changing
    // speed never snaps the angle; the bipolar center holds the current angle.
    angle=(angle+THREE.MathUtils.degToRad(velocity)*dt)%(Math.PI*2);
    const xs=offsets.map(p=>p[0]),zs=offsets.map(p=>p[1]);
    const minX=Math.min(...xs),maxX=Math.max(...xs),minZ=Math.min(...zs),maxZ=Math.max(...zs);
    desiredFocus.set((minX+maxX)/2,.85,(minZ+maxZ)/2);
    const halfVertical=THREE.MathUtils.degToRad(camera.fov/2);
    const halfHorizontal=Math.atan(Math.tan(halfVertical)*camera.aspect);
    const extent=Math.hypot((maxX-minX)/2,(maxZ-minZ)/2)+.7;
    const desiredRadius=Math.max(5.2,extent/Math.sin(Math.min(halfVertical,halfHorizontal)));
    const blend=1-Math.exp(-5*dt);
    focus.lerp(desiredFocus,blend);radius+=(desiredRadius-radius)*blend;
    camera.position.set(focus.x+Math.sin(angle)*radius,2.5,focus.z+Math.cos(angle)*radius);
    camera.lookAt(focus);
  }
  const uniforms={
    time:{value:0},travel:{value:new THREE.Vector2()},count:{value:0},
    waves:{value:Array.from({length:MAX_WAVES},()=>new THREE.Vector4())},
    feet:{value:Array.from({length:12},()=>new THREE.Vector4())},
  };
  const material=new THREE.ShaderMaterial({
    uniforms,
    vertexShader:`varying vec2 surface;
      void main(){surface=position.xy;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader:`
      varying vec2 surface;
      uniform float time;
      uniform vec2 travel;
      uniform int count;
      uniform vec4 waves[${MAX_WAVES}];
      uniform vec4 feet[12];
      vec3 rgb(float hue){return .5+.5*cos(6.283185*(hue+vec3(0.,.6667,.3333)));}
      void main(){
        vec2 local=vec2(surface.x,-surface.y);
        vec2 world=local+travel;
        vec2 cell=floor(world/${TILE_SIZE});
        vec2 center=(cell+.5)*${TILE_SIZE};
        vec2 edges=abs(fract(world/${TILE_SIZE})-.5);
        float tile=1.-smoothstep(.425,.48,max(edges.x,edges.y));
        float breath=.5+.5*sin(time*1.6+cell.x*.46+cell.y*.61);
        vec3 color=rgb(cell.x*.073+cell.y*.037+time*.035)*(.10+.15*breath);
        float energy=0.;
        for(int i=0;i<${MAX_WAVES};i++){
          if(i>=count)break;
          vec4 wave=waves[i];
          float age=time-wave.z;
          float distanceToHit=length(center-wave.xy);
          float ring=exp(-pow((distanceToHit-age*${WAVE_SPEED})/.24,2.));
          float fade=pow(max(0.,1.-age/${WAVE_LIFETIME}),1.5);
          float impact=exp(-distanceToHit*7.)*exp(-age*9.);
          float power=(ring*fade+impact)*wave.w;
          color+=rgb(distanceToHit*.18-age*.5+wave.z*.13)*power*2.5;
          energy+=power;
        }
        for(int i=0;i<12;i++){
          float contact=exp(-length(local-feet[i].xy)*9.)*feet[i].w;
          color+=(i%2==0?vec3(.1,.8,1.):vec3(1.,.1,.55))*contact*.5;
        }
        color=color*tile+vec3(.012,.012,.025)*(1.-tile);
        color+=vec3(.22,.30,.4)*energy*tile;
        color=mix(vec3(.001,.002,.006),color,1.-smoothstep(3.5,10.,length(local)));
        gl_FragColor=vec4(color,1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const floor=new THREE.Mesh(new THREE.PlaneGeometry(40,40),material);
  floor.name='First of the Year · RGB floor';floor.rotation.x=-Math.PI/2;group.add(floor);
  const cyan=new THREE.PointLight('#19ddff',7,6,2);cyan.position.set(-1.8,1.3,1.2);
  const magenta=new THREE.PointLight('#ff269c',8,6,2);magenta.position.set(1.8,1.4,-.8);
  group.add(cyan,magenta);
  return {
    color:'#d8d3ef',background:'#010208',environment:false,wireframe:false,characterInstances:true,
    update(deck,deltaSeconds=0){
      // The selected animation's sampled time includes the configured offset,
      // endpoint hold and tempo changes. Wall-clock delta must not drive waves.
      const valid=deck.animation?.id==='first-of-year'&&!!deck.pose;
      group.visible=valid;if(!valid)return;
      const time=Math.max(0,Math.min(motion.duration,deck.animation.time??deck.time));
      if(!Number.isFinite(time))return;
      const profile=motion.profiles[deck.animation.characterId]??motion.profiles.embedded;
      const root=rootAt(motion,time);uniforms.travel.value.set(...root);uniforms.time.value=time;
      const frame=Math.min(profile.floor.length-1,time*profile.floorFps),lo=Math.floor(frame),hi=Math.min(lo+1,profile.floor.length-1),mix=frame-lo;
      floor.position.y=profile.floor[lo]*(1-mix)+profile.floor[hi]*mix-SOLE_CLEARANCE;
      const offsets=characterOffsets(deck.params?.characterCount);
      orbit(offsets,deck.params?.cameraOrbitSpeed??0,deltaSeconds);
      const events=profile.events.filter(e=>e.time<=time&&time-e.time<WAVE_LIFETIME)
        .flatMap(e=>offsets.map(([x,z])=>({...e,x:e.x+x,z:e.z+z}))).slice(-MAX_WAVES);
      uniforms.count.value=events.length;
      events.forEach((e,i)=>uniforms.waves.value[i].set(e.x,e.z,e.time,e.strength));
      // Live foot positions add small contact pools, independently of baked rings.
      uniforms.feet.value.forEach(foot=>{foot.w=0;});
      offsets.forEach(([x,z],instance)=>['leftFoot','rightFoot'].forEach((name,i)=>{
        const foot=deck.pose.worldPositions?.[name];
        if(foot?.every(Number.isFinite))uniforms.feet.value[instance*2+i].set(foot[0]+x,foot[2]+z,foot[1],Math.max(0,1-Math.max(0,foot[1]-floor.position.y-.05)/.12));
      }));
      group.userData.footfalls=profile.events.length;
      group.userData.rootTravel=root;
    },
    // Renderer disposes the group's geometries/materials on scene switch/reload.
    dispose(){
      if(savedCamera){camera.position.copy(savedCamera.position);camera.quaternion.copy(savedCamera.quaternion);}
    },
  };
}
