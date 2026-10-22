// Wide Open · animated contours accumulated in an independent feedback buffer.
// MID / CC21: character scale. HIGH / CC22: feedback persistence (zero = dry).
export default function createScene({THREE,group,camera,getModel=()=>null}) {
  const clamp=(v,min,max,fallback)=>Number.isFinite(v)?THREE.MathUtils.clamp(v,min,max):fallback;
  const normalMaterial=new THREE.MeshNormalMaterial({toneMapped:false});
  normalMaterial.color=new THREE.Color('#bcd4ff'); // Shared renderer's palette contract.
  const root=new THREE.Vector3(),offset=new THREE.Vector3();
  let model=null,hips=null,meshes=[],savedCamera=null,ready=false,lastTime=null,lastAnimation=null,lastRevision=null;
  let reset=true,feedback=.7,opacity=1,read=null,write=null;
  const uniforms={current:{value:null},history:{value:null},texel:{value:new THREE.Vector2()},retention:{value:0},expansion:{value:1},inkOpacity:{value:1}};
  const vertexShader='varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}';
  const trailMaterial=new THREE.ShaderMaterial({uniforms,vertexShader,depthTest:false,depthWrite:false,toneMapped:false,
    fragmentShader:`
      uniform sampler2D current,history;
      uniform vec2 texel;
      uniform float retention,expansion,inkOpacity;
      varying vec2 vUv;
      void main(){
        vec3 dx=texture2D(current,vUv+vec2(texel.x,0.)).rgb-texture2D(current,vUv-vec2(texel.x,0.)).rgb;
        vec3 dy=texture2D(current,vUv+vec2(0.,texel.y)).rgb-texture2D(current,vUv-vec2(0.,texel.y)).rgb;
        float edge=smoothstep(.12,.65,length(dx)+length(dy));
        vec3 ink=mix(vec3(.25,.8,1.),vec3(.85,.66,1.),vUv.y)*edge*inkOpacity;
        vec2 historyUv=(vUv-.5)/expansion+.5;
        vec3 echo=texture2D(history,historyUv).rgb*retention;
        echo*=step(vec3(.002),echo);
        // Max prevents a held pose from accumulating into a solid white silhouette.
        gl_FragColor=vec4(max(ink,echo),1.);
      }`});
  const copyMaterial=new THREE.ShaderMaterial({uniforms:{image:{value:null}},vertexShader,depthTest:false,depthWrite:false,toneMapped:false,
    fragmentShader:'uniform sampler2D image;varying vec2 vUv;void main(){gl_FragColor=texture2D(image,vUv);}'});
  const passScene=new THREE.Scene(),passCamera=new THREE.OrthographicCamera(-1,1,1,-1,0,1);
  const quad=new THREE.Mesh(new THREE.PlaneGeometry(2,2),trailMaterial);quad.frustumCulled=false;passScene.add(quad);
  function releaseModel(){
    for(const {mesh,material} of meshes)if(mesh.material===normalMaterial)mesh.material=material;
    meshes=[];hips=null;model=null;reset=true;
  }
  function attachModel(next){
    releaseModel();model=next;if(!model)return;
    model.traverse(n=>{
      if(n.isBone&&/^(?:mixamorig\d*:?|.*:)?Hips$/i.test(n.name))hips=n;
      if(n.isMesh){meshes.push({mesh:n,material:n.material});n.material=normalMaterial;}
    });
  }
  return {
    color:'#bcd4ff',background:'#000000',environment:false,wireframe:false,
    update(deck){
      const next=getModel();if(next!==model)attachModel(next);
      ready=!!model&&!!deck.animation&&!!deck.pose;group.visible=ready;
      if(!ready){reset=true;lastTime=null;if(model)model.visible=false;return;}
      if(lastAnimation!==deck.animation.id||lastRevision!==deck.revision||
        (lastTime!==null&&Number.isFinite(deck.time)&&(deck.time<lastTime-.05||Math.abs(deck.time-lastTime)>.5)))reset=true;
      lastAnimation=deck.animation.id;lastRevision=deck.revision;lastTime=Number.isFinite(deck.time)?deck.time:null;
      feedback=clamp(deck.params?.feedbackRate,0,1,.7);
      opacity=clamp(deck.params?.characterOpacity,0,1,1);
      // Normal colors are an opaque edge-detection input; opacity belongs to the ink pass.
      model.visible=opacity>0;normalMaterial.opacity=1;normalMaterial.depthWrite=true;
      if(normalMaterial.transparent){normalMaterial.transparent=false;normalMaterial.needsUpdate=true;}
      if(hips)hips.getWorldPosition(root);
      else if(deck.pose.worldPositions?.head)root.fromArray(deck.pose.worldPositions.head).add(offset.set(0,-.75,0));
      else model.getWorldPosition(root).add(offset.set(0,.9,0));
      if(!savedCamera)savedCamera={position:camera.position.clone(),quaternion:camera.quaternion.clone(),zoom:camera.zoom};
      // Scale in projection space around the followed hips, preserving skeleton/anchor coordinates.
      camera.zoom=clamp(deck.params?.characterScale,.5,1.5,1);camera.updateProjectionMatrix();
      camera.position.copy(root).add(offset.set(0,.15,camera.aspect<1?6.8:5.2));
      camera.lookAt(root);camera.updateMatrixWorld(true);
    },
    postprocess(renderer,target,deltaSeconds){
      if(!read){read=new THREE.WebGLRenderTarget(target.width,target.height,{depthBuffer:false,type:THREE.HalfFloatType});write=read.clone();reset=true;}
      if(read.width!==target.width||read.height!==target.height){read.setSize(target.width,target.height);write.setSize(target.width,target.height);reset=true;}
      const previousTarget=renderer.getRenderTarget();
      try{
        if(reset||!ready){
          // Clear through a black scene: do not depend on the renderer's clear color.
          const black=new THREE.Scene();black.background=new THREE.Color(0);
          for(const buffer of [read,write]){renderer.setRenderTarget(buffer);renderer.render(black,passCamera);}
          reset=false;
        }
        const dt=clamp(deltaSeconds,0,.1,1/60);
        uniforms.current.value=target.texture;uniforms.history.value=read.texture;
        uniforms.texel.value.set(1.5/target.width,1.5/target.height);
        uniforms.retention.value=ready&&feedback>0?Math.pow(.5,dt/(.035+1.1*feedback*feedback)):0;
        uniforms.expansion.value=Math.exp(dt*.13);uniforms.inkOpacity.value=ready?opacity:0;
        quad.material=trailMaterial;renderer.setRenderTarget(write);renderer.render(passScene,passCamera);
        copyMaterial.uniforms.image.value=write.texture;quad.material=copyMaterial;
        renderer.setRenderTarget(target);renderer.render(passScene,passCamera);
        [read,write]=[write,read];
      }finally{renderer.setRenderTarget(previousTarget);}
    },
    dispose(){
      releaseModel();normalMaterial.dispose();trailMaterial.dispose();copyMaterial.dispose();quad.geometry.dispose();read?.dispose();write?.dispose();
      if(savedCamera){camera.position.copy(savedCamera.position);camera.quaternion.copy(savedCamera.quaternion);camera.zoom=savedCamera.zoom;camera.updateProjectionMatrix();camera.updateMatrixWorld(true);}
    },
  };
}
