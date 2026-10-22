/** Apply the shared slider / Low EQ value to a streamed character. */
export function setCharacterOpacity(model,opacity,active=true){
  model.visible=active&&opacity>0;
  model.traverse(node=>{
    if(!node.isMesh)return;
    // Skin bounds describe an earlier pose. Root travel plus a following camera
    // can leave those bounds off-screen while the actual dancer is still centered.
    // Streamed skeletons must not be culled against that stale bounding sphere.
    if(node.isSkinnedMesh)node.frustumCulled=false;
    for(const material of Array.isArray(node.material)?node.material:[node.material]){
      const transparent=opacity<1;
      if(material.transparent!==transparent){material.transparent=transparent;material.needsUpdate=true;}
      material.opacity=opacity;material.depthWrite=!transparent;
    }
  });
}
