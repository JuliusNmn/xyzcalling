// Seven animated joints unfold into a 7 × 7 lattice of solid spheres.
const JOINTS = [
  ['leftHand','LeftHand'],['rightHand','RightHand'],
  ['leftFoot','LeftFoot'],['rightFoot','RightFoot'],
  ['leftElbow','LeftForeArm'],['rightElbow','RightForeArm'],['head','Head'],
];
const finite=p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite);
const bounded=(value,fallback,min,max)=>Number.isFinite(value)?Math.max(min,Math.min(max,value)):fallback;
export default function createScene({THREE,group,camera,getModel=()=>null}) {
  const geometry=new THREE.SphereGeometry(1,20,14);
  const material=new THREE.MeshStandardMaterial({color:'#8fdfd2',emissive:'#277e73',emissiveIntensity:.35,roughness:.28,metalness:.25});
  const spheres=[];
  for(let row=0;row<7;row++)for(let column=0;column<7;column++){
    const sphere=new THREE.Mesh(geometry,material);
    sphere.name=`Joint sphere ${row}:${column}`;
    sphere.userData.joint=JOINTS[(column+row*2)%7][0];
    sphere.userData.grid=new THREE.Vector3((column-3)*.48,1+(row-3)*.48,0);
    sphere.visible=false;group.add(sphere);spheres.push(sphere);
  }
  const current=new Map(),reference=new Map(),point=new THREE.Vector3(),offset=new THREE.Vector3();
  let model=null,bones=new Map(),animation=null,savedCamera=null;
  return {
    color:'#8fdfd2',background:'#030c0d',environment:false,wireframe:false,
    update(deck){
      const positions=deck.pose?.worldPositions,nextModel=getModel();
      group.visible=!!positions&&!!deck.animation;
      if(!group.visible)return;
      if(model!==nextModel||animation!==deck.animation.id){
        model=nextModel;animation=deck.animation.id;bones=new Map();reference.clear();
        model?.traverse(n=>{if(n.isBone)bones.set(n.name.replace(/^.*:/,'').replace(/^mixamorig\d*/i,''),n);});
      }
      current.clear();
      for(const [anchor,boneName]of JOINTS){
        const bone=bones.get(boneName);
        if(bone)bone.getWorldPosition(point);
        else if(finite(positions[anchor]))point.fromArray(positions[anchor]);
        else continue;
        if(!point.toArray().every(Number.isFinite))continue;
        current.set(anchor,point.clone());
        // Fixed reference: knob movement and seeks never recapture the pose.
        if(!reference.has(anchor))reference.set(anchor,point.clone());
      }
      const spread=bounded(deck.params?.gridSpread,0,0,1);
      const radius=bounded(deck.params?.sphereSize,.065,.015,.22);
      for(const sphere of spheres){
        const joint=sphere.userData.joint,p=current.get(joint);
        sphere.visible=!!p;if(!p)continue;
        // P + spread × (grid - reference) retains the full animation delta even
        // at spread=1. At spread=0 all copies coincide at their actual joints.
        offset.copy(sphere.userData.grid).sub(reference.get(joint));
        sphere.position.copy(p).addScaledVector(offset,spread);sphere.scale.setScalar(radius);
      }
      if(camera){
        if(!savedCamera)savedCamera={position:camera.position.clone(),quaternion:camera.quaternion.clone()};
        camera.position.set(0,1.2,7.8);camera.lookAt(0,1,0);camera.updateMatrixWorld(true);
      }
    },
    dispose(){
      if(savedCamera){camera.position.copy(savedCamera.position);camera.quaternion.copy(savedCamera.quaternion);camera.updateMatrixWorld(true);}
      // Renderer owns the group's geometry and materials.
    },
  };
}
