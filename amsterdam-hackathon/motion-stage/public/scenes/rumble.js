// Red hand emitters in world space. Particle trails stay independent of character opacity.
// Parameter ranges and MIDI CCs are declared in public/parameters.js.
export default function createScene({THREE,group}) {
  const capacity=6400,positions=new Float32Array(capacity*3),velocities=new Float32Array(capacity*3);
  const ages=new Float32Array(capacity),lifetimes=new Float32Array(capacity),alphas=new Float32Array(capacity);
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.BufferAttribute(positions,3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('alpha',new THREE.BufferAttribute(alphas,1).setUsage(THREE.DynamicDrawUsage));
  const material=new THREE.ShaderMaterial({
    uniforms:{size:{value:.035}},transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,
    vertexShader:`attribute float alpha; varying float opacity; uniform float size;
      void main(){opacity=alpha;vec4 p=modelViewMatrix*vec4(position,1.0);
      gl_Position=projectionMatrix*p;gl_PointSize=clamp(size*700.0/max(0.1,-p.z),1.0,100.0);}`,
    fragmentShader:`varying float opacity;
      void main(){float r=length(gl_PointCoord-vec2(0.5))*2.0;if(r>1.0)discard;
      float glow=pow(1.0-r,1.6);gl_FragColor=vec4(1.0,0.008,0.002,glow*opacity);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      }`,
  });
  const particles=new THREE.Points(geometry,material);particles.frustumCulled=false;group.add(particles);
  let cursor=0,lastTime=null,lastAnimation=null;
  const emitters=[{name:'leftHand',carry:0,previous:null},{name:'rightHand',carry:0,previous:null}];
  return {
    color:'#e0c4c4',background:'#000000',environment:false,wireframe:false,
    update(deck,deltaSeconds){
      const p=deck.params??{},rate=p.particleRate??240,lifetime=p.particleLifetime??1.2,speed=p.particleSpeed??.65;
      const dt=Math.max(0,Math.min(.1,deltaSeconds));material.uniforms.size.value=p.particleSize??.035;
      if(lastAnimation!==deck.animation?.id||(lastTime!==null&&Math.abs(deck.time-lastTime)>.5)){
        alphas.fill(0);lifetimes.fill(0);for(const emitter of emitters){emitter.carry=0;emitter.previous=null;}
      }
      lastAnimation=deck.animation?.id;lastTime=deck.time;
      for(let i=0;i<capacity;i++){
        if(!lifetimes[i])continue;
        ages[i]+=dt;
        if(ages[i]>=lifetimes[i]){alphas[i]=0;lifetimes[i]=0;continue;}
        const j=i*3;velocities[j+1]-=.18*dt;
        for(let k=0;k<3;k++)positions[j+k]+=velocities[j+k]*dt;
        alphas[i]=Math.pow(1-ages[i]/lifetimes[i],1.5);
      }
      for(const emitter of emitters){
        const hand=deck.pose?.worldPositions?.[emitter.name];
        if(!hand||!hand.every(Number.isFinite)){emitter.previous=null;emitter.carry=0;continue;}
        emitter.carry+=rate*dt;const count=Math.floor(emitter.carry);emitter.carry-=count;
        for(let n=0;n<count;n++){
          const i=cursor++%capacity,j=i*3,t=(n+1)/count;
          const z=Math.random()*2-1,angle=Math.random()*Math.PI*2,r=Math.sqrt(1-z*z),v=speed*(.3+Math.random()*.7);
          for(let k=0;k<3;k++)positions[j+k]=emitter.previous?emitter.previous[k]+(hand[k]-emitter.previous[k])*t:hand[k];
          velocities[j]=r*Math.cos(angle)*v;velocities[j+1]=z*v+.12;velocities[j+2]=r*Math.sin(angle)*v;
          ages[i]=0;lifetimes[i]=lifetime;alphas[i]=1;
        }
        emitter.previous=[...hand];
      }
      geometry.attributes.position.needsUpdate=true;geometry.attributes.alpha.needsUpdate=true;
    },
    // The renderer disposes geometry/material attached to group on reload or scene switch.
    dispose(){},
  };
}
