// Gal a Bubble · eight projected light cones, screen-composited over the stage.
// Limb directions come from the rendered skeleton, so every character rig works.
const LIMBS=[['leftHand','LeftHand','LeftForeArm'],['rightHand','RightHand','RightForeArm'],['leftFoot','LeftFoot','LeftLeg'],['rightFoot','RightFoot','RightLeg']];
const finite=p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite);
export default function createScene({THREE,group,camera,getModel=()=>null}) {
  const uniforms={
    emitters:{value:Array.from({length:4},()=>new THREE.Vector4())},
    enabled:{value:[0,0,0,0]},aspect:{value:1},hue:{value:.08},intensity:{value:1},time:{value:0},
  };
  const material=new THREE.ShaderMaterial({
    uniforms,transparent:true,depthTest:false,depthWrite:false,toneMapped:false,
    // Screen: out = source + destination * (1 - source). Zero intensity is identity.
    blending:THREE.CustomBlending,blendEquation:THREE.AddEquation,
    blendSrc:THREE.OneFactor,blendDst:THREE.OneMinusSrcColorFactor,
    blendSrcAlpha:THREE.ZeroFactor,blendDstAlpha:THREE.OneFactor,
    vertexShader:`varying vec2 screen;
      void main(){screen=position.xy;gl_Position=vec4(position.xy,0.,1.);}`,
    fragmentShader:`
      varying vec2 screen;
      uniform vec4 emitters[4];uniform float enabled[4];
      uniform float aspect,hue,intensity,time;
      vec3 palette(float h){return .5+.5*cos(6.2831853*(h+vec3(0.,.66667,.33333)));}
      void main(){
        vec3 light=vec3(0.);
        for(int i=0;i<4;i++){
          vec2 offset=vec2((screen.x-emitters[i].x)*aspect,screen.y-emitters[i].y);
          vec2 axis=emitters[i].zw;
          float along=dot(offset,axis);
          float across=abs(offset.x*axis.y-offset.y*axis.x);
          // abs(along) creates the opposed pair, meeting exactly at the joint.
          float distance=abs(along),width=.012+distance*.37;
          float cone=(1.-smoothstep(width*.84,width,across))*exp(-distance*.48);
          float rays=.82+.18*cos(across/max(width,.001)*26.+distance*2.-time*.65+float(i));
          float energy=cone*rays*enabled[i]*intensity*.72;
          vec3 tint=palette(hue+float(i)*.21+(along<0.?.11:0.));
          vec3 ink=(1.-exp(-energy))*mix(vec3(.035),tint,.965);
          light=1.-(1.-light)*(1.-ink);
        }
        gl_FragColor=vec4(light,1.);
      }`,
  });
  const cones=new THREE.Mesh(new THREE.PlaneGeometry(2,2),material);
  cones.name='Gal a Bubble · bidirectional tinted cones';cones.frustumCulled=false;cones.renderOrder=100;
  group.add(cones);
  const root=new THREE.Vector3(),point=new THREE.Vector3(),parent=new THREE.Vector3(),projected=new THREE.Vector3(),projectedParent=new THREE.Vector3();
  const cameraOffset=new THREE.Vector3(0,.55,4.6),lookOffset=new THREE.Vector3(0,.05,0);
  let model=null,bones=new Map(),savedCamera=null;
  return {
    color:'#e8d9f4',background:'#08040f',environment:false,wireframe:false,
    update(deck){
      const positions=deck.pose?.worldPositions;
      group.visible=!!positions&&!!deck.animation;
      if(!group.visible)return;
      const nextModel=getModel();
      if(model!==nextModel){
        model=nextModel;bones=new Map();
        model?.traverse(n=>{if(n.isBone)bones.set(n.name.replace(/^.*:/,'').replace(/^mixamorig\d*/i,''),n);});
      }
      // Exact hip follow makes seeking and looping deterministic, without camera lag.
      if(bones.has('Hips'))bones.get('Hips').getWorldPosition(root);
      else if(finite(positions.head))root.fromArray(positions.head).add(new THREE.Vector3(0,-.75,0));
      else {group.visible=false;return;}
      if(!savedCamera)savedCamera={position:camera.position.clone(),quaternion:camera.quaternion.clone()};
      camera.position.copy(root).add(cameraOffset);camera.lookAt(point.copy(root).add(lookOffset));camera.updateMatrixWorld(true);
      uniforms.aspect.value=camera.aspect;
      uniforms.hue.value=deck.params?.coneColors??.08;
      uniforms.intensity.value=deck.params?.coneIntensity??1;
      uniforms.time.value=deck.animation.time??deck.time??0;
      LIMBS.forEach(([anchor,boneName,parentName],i)=>{
        uniforms.enabled.value[i]=0;
        if(!finite(positions[anchor]))return;
        if(bones.has(boneName))bones.get(boneName).getWorldPosition(point);else point.fromArray(positions[anchor]);
        if(bones.has(parentName))bones.get(parentName).getWorldPosition(parent);else parent.copy(root);
        projected.copy(point).project(camera);projectedParent.copy(parent).project(camera);
        if(!Number.isFinite(projected.x+projected.y+projected.z)||projected.z < -1||projected.z > 1)return;
        let x=(projected.x-projectedParent.x)*camera.aspect,y=projected.y-projectedParent.y;
        const length=Math.hypot(x,y);
        // A limb aimed straight at the lens still has a stable, visible cone pair.
        if(length<.001){x=i%2===0?-1:1;y=.35;}else{x/=length;y/=length;}
        const norm=Math.hypot(x,y);
        uniforms.emitters.value[i].set(projected.x,projected.y,x/norm,y/norm);uniforms.enabled.value[i]=1;
      });
    },
    dispose(){
      // Only restore after this hook actually took ownership of the camera.
      if(savedCamera){camera.position.copy(savedCamera.position);camera.quaternion.copy(savedCamera.quaternion);camera.updateMatrixWorld(true);}
      // Group geometry/material are disposed by the renderer.
    },
  };
}
