import {Group} from 'three';
import {clone} from 'three/addons/utils/SkeletonUtils.js';

// Keep the original dancer at the origin, then add a small backing ensemble.
const OFFSETS=[[0,0],[-1.45,0],[1.45,0],[-1.45,-1.8],[0,-1.8],[1.45,-1.8]];
export const characterOffsets=count=>OFFSETS.slice(0,Math.max(1,Math.min(6,Math.round(Number.isFinite(count)?count:1))));

/** Independent skeletons, shared geometry/materials, and the same streamed pose. */
export class CharacterInstances {
  constructor(){this.group=new Group();this.source=null;this.sourceNodes=[];this.copies=[];}
  clear(){
    for(const {model} of this.copies){
      // Geometry/material belong to the source; only clone skeleton GPU state is ours.
      const skeletons=new Set();model.traverse(n=>{if(n.isSkinnedMesh)skeletons.add(n.skeleton);});
      for(const skeleton of skeletons)skeleton.dispose();
      model.removeFromParent();
    }
    this.copies=[];this.source=null;this.sourceNodes=[];
  }
  update(source,count=1){
    if(source!==this.source){this.clear();this.source=source;source?.traverse(n=>this.sourceNodes.push(n));}
    if(!source)return;
    const offsets=characterOffsets(count);
    while(this.copies.length<offsets.length-1){
      const model=clone(source),nodes=[];model.traverse(n=>nodes.push(n));
      this.group.add(model);this.copies.push({model,nodes});
    }
    for(const [i,{model,nodes}] of this.copies.entries()){
      model.visible=source.visible&&i<offsets.length-1;
      if(!model.visible)continue;
      nodes.forEach((node,j)=>{
        const original=this.sourceNodes[j];node.position.copy(original.position);node.quaternion.copy(original.quaternion);node.scale.copy(original.scale);node.visible=original.visible;
      });
      model.position.x+=offsets[i+1][0];model.position.z+=offsets[i+1][1];model.updateMatrixWorld(true);
    }
  }
}
