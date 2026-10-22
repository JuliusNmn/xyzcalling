import {FontLoader} from 'three/addons/loaders/FontLoader.js';

// FREE STYLE! · comic-book sale lettering and a live, skinned ink silhouette.
// LOW (CC20): fill, MID (CC21): print contrast/dots, HIGH (CC22): type reveal/motion.
export default function createScene({THREE,group,camera,getModel=()=>null}) {
  const clamp=(value,fallback)=>Number.isFinite(value)?THREE.MathUtils.clamp(value,0,1):fallback;
  const uniforms={fill:{value:.6},print:{value:.5},shell:{value:0}};
  const vertexShader=`
    #include <common>
    #include <morphtarget_pars_vertex>
    #include <skinning_pars_vertex>
    uniform float shell;
    varying vec3 inkNormal;
    void main(){
      #include <morphinstance_vertex>
      #include <beginnormal_vertex>
      #include <morphnormal_vertex>
      #include <skinbase_vertex>
      #include <skinnormal_vertex>
      #include <defaultnormal_vertex>
      #include <begin_vertex>
      #include <morphtarget_vertex>
      #include <skinning_vertex>
      vec4 mvPosition=modelViewMatrix*vec4(transformed,1.);
      inkNormal=normalize(transformedNormal);
      mvPosition.xyz+=normalize(transformedNormal)*shell;
      gl_Position=projectionMatrix*mvPosition;
    }`;
  const fillMaterial=new THREE.ShaderMaterial({uniforms,vertexShader,toneMapped:false,
    fragmentShader:`uniform float fill,print; varying vec3 inkNormal;
      void main(){
        vec3 n=normalize(inkNormal);
        float light=dot(n,normalize(vec3(-.45,.7,.8)))*.5+.5;
        float threshold=mix(.28,.65,print);
        vec3 ink=light>threshold+.22?vec3(1.,.86,.20):light>threshold?vec3(.06,.65,.9):vec3(.015,.07,.18);
        float pitch=mix(12.,4.5,print);
        vec2 grid=mod(gl_FragCoord.xy,pitch)/pitch-.5;
        float radius=mix(.08,.37,print)*(1.-smoothstep(.5,.98,light));
        float dotInk=1.-smoothstep(radius-.035,radius+.035,length(grid));
        ink=mix(ink,vec3(.005),dotInk*.95);
        float contour=smoothstep(.04,.23,abs(n.z));
        ink*=contour;
        gl_FragColor=vec4(ink*fill,1.);
        #include <colorspace_fragment>
      }`});
  // The renderer expects a color field on character materials; the shader owns its palette.
  fillMaterial.color=new THREE.Color('#ffdc38');
  const outlineMaterial=new THREE.ShaderMaterial({
    uniforms:{shell:{value:-.012}},vertexShader,side:THREE.BackSide,toneMapped:false,
    fragmentShader:'void main(){gl_FragColor=vec4(1.,.96,.81,1.);}',
  });
  outlineMaterial.color=new THREE.Color('#fff4cf');
  let model=null,meshes=[],hips=null,savedCamera=null;
  const root=new THREE.Vector3(),target=new THREE.Vector3();
  function releaseModel(){
    for(const {mesh,material,outline}of meshes){
      if(mesh.material===fillMaterial)mesh.material=material;
      outline.removeFromParent(); // Shared source geometry belongs to the model cache.
    }
    if(model)model.visible=true;
    meshes=[];hips=null;model=null;
  }
  function attachModel(next){
    releaseModel();model=next;if(!model)return;
    model.traverse(n=>{
      if(n.isBone&&/^(?:mixamorig\d*:?|.*:)?Hips$/i.test(n.name))hips=n;
      if(!n.isMesh)return;
      const outline=n.isSkinnedMesh?new THREE.SkinnedMesh(n.geometry,outlineMaterial):new THREE.Mesh(n.geometry,outlineMaterial);
      outline.name='Freestyler · cream ink contour';outline.frustumCulled=false;outline.matrixAutoUpdate=false;
      if(n.isSkinnedMesh){outline.bindMode=n.bindMode;outline.bindMatrix.copy(n.bindMatrix);outline.bindMatrixInverse.copy(n.bindMatrixInverse);outline.skeleton=n.skeleton;}
      outline.morphTargetInfluences=n.morphTargetInfluences;
      meshes.push({mesh:n,material:n.material,outline});n.material=fillMaterial;group.add(outline);
    });
  }

  const sign=new THREE.Group();sign.name='FREE STYLE! · dimensional sale burst';group.add(sign);
  const font=new FontLoader().parse(TYPEFACE);
  const basic=color=>new THREE.MeshBasicMaterial({color,toneMapped:false});
  const black=basic('#050505'),cream=basic('#fff5d5'),yellow=basic('#ffe12c'),red=basic('#ed263e'),blue=basic('#075aaa');
  function burst(radius){
    const shape=new THREE.Shape();
    for(let i=0;i<32;i++){
      const a=i*Math.PI/16,r=radius*(i%2?.69:1)*(1+.06*Math.sin(i*5));
      const x=Math.cos(a)*r*1.18,y=Math.sin(a)*r;
      if(i===0)shape.moveTo(x,y);else shape.lineTo(x,y);
    }shape.closePath();return shape;
  }
  for(const [radius,z,material]of [[1.03,-.18,cream],[.99,-.15,black],[.94,-.12,red]]){
    const mesh=new THREE.Mesh(new THREE.ShapeGeometry(burst(radius)),material);mesh.position.z=z;sign.add(mesh);
  }
  // Ben-Day dots on the red sale burst, clipped by its own silhouette.
  red.onBeforeCompile=shader=>{
    shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>',`
      vec2 cell=mod(gl_FragCoord.xy,9.)/9.-.5;
      outgoingLight*=mix(1.,.35,1.-smoothstep(.19,.25,length(cell)));
      #include <opaque_fragment>`);
  };
  function text(word,y,width,face){
    const geo=new THREE.ExtrudeGeometry(font.generateShapes(word,1),{depth:.12,bevelEnabled:true,bevelThickness:.012,bevelSize:.012,bevelSegments:1,curveSegments:8});
    // Hand-lettered italic lean, with real extruded side walls.
    const positions=geo.attributes.position;
    for(let i=0;i<positions.count;i++)positions.setX(i,positions.getX(i)+positions.getY(i)*.15);
    positions.needsUpdate=true;geo.computeVertexNormals();geo.computeBoundingBox();
    const bounds=geo.boundingBox,size=bounds.max.x-bounds.min.x,factor=width/size;
    geo.translate(-(bounds.min.x+bounds.max.x)/2,-bounds.min.y,0);geo.scale(factor,factor,factor);
    const shadow=new THREE.Mesh(geo,black);shadow.scale.set(1.045,1.08,1);shadow.position.set(.045,y-.055,-.025);sign.add(shadow);
    const letters=new THREE.Mesh(geo,[face,blue]);letters.position.set(0,y,.015);sign.add(letters);
  }
  text('FREE',.13,1.66,yellow);text('STYLE!',-.44,1.94,cream);
  // Comic registration ticks outside the burst.
  for(let i=0;i<5;i++){
    const a=(i/5)*Math.PI*2+.3;
    const tick=new THREE.Mesh(new THREE.BoxGeometry(.045,.19,.025),i%2?yellow:cream);
    tick.position.set(Math.cos(a)*1.35,Math.sin(a)*1.12,-.08);tick.rotation.z=a-Math.PI/2;sign.add(tick);
  }
  return {
    color:'#ffe12c',background:'#000000',environment:false,wireframe:false,
    update(deck){
      const next=getModel();if(next!==model)attachModel(next);
      const ready=!!model&&!!deck.animation&&!!deck.pose;group.visible=ready;if(!ready)return;
      const low=clamp(deck.params?.characterOpacity,.6),mid=clamp(deck.params?.printStyle,.5),hi=clamp(deck.params?.saleType,.8);
      uniforms.fill.value=low;uniforms.print.value=mid;
      // Low zero is opaque black with a visible contour, never a disappearing model.
      model.visible=true;fillMaterial.opacity=1;fillMaterial.transparent=false;fillMaterial.depthWrite=true;
      if(hips)hips.getWorldPosition(root);
      else if(deck.pose.worldPositions?.head)root.fromArray(deck.pose.worldPositions.head).add(new THREE.Vector3(0,-.75,0));
      else root.set(0,.9,0);
      if(!savedCamera)savedCamera={position:camera.position.clone(),quaternion:camera.quaternion.clone()};
      const narrow=camera.aspect<1.15;
      const distance=narrow?6.7:5.6;
      camera.position.copy(root).add(target.set(.65,.3,distance));
      camera.lookAt(target.copy(root).add(new THREE.Vector3(.65,.15,0)));camera.updateMatrixWorld(true);
      for(const {mesh,outline}of meshes){outline.matrix.copy(mesh.matrixWorld);outline.visible=mesh.visible;}
      sign.visible=hi>.001;
      const beat=Number.isFinite(deck.beat)?deck.beat:(deck.time??0)*(deck.bpm??120)/60;
      const pulse=Math.pow(.5+.5*Math.cos(beat*Math.PI*2),8);
      const reveal=THREE.MathUtils.smoothstep(hi,0,.3);
      const scale=(.66+.2*hi+.035*hi*pulse)*reveal;
      sign.scale.setScalar(scale);
      sign.position.copy(root).add(target.set(1.4,.22,.1));
      sign.rotation.set(.03*Math.sin(beat*Math.PI*.5)*hi,-.13+hi*.14*Math.sin(beat*Math.PI*.25),.08+.035*hi*Math.sin(beat*Math.PI*.5));
    },
    dispose(){
      releaseModel();fillMaterial.dispose();outlineMaterial.dispose();
      if(savedCamera){camera.position.copy(savedCamera.position);camera.quaternion.copy(savedCamera.quaternion);camera.updateMatrixWorld(true);}
      // Renderer owns all sign geometries/materials; source character geometry is untouched.
    },
  };
}

const TYPEFACE={"glyphs":{"S":{"x_min":0,"x_max":826,"ha":915,"o":"m 826 306 q 701 55 826 148 q 423 -29 587 -29 q 138 60 255 -29 q 0 318 13 154 l 208 318 q 288 192 216 238 q 437 152 352 152 q 559 181 506 152 q 623 282 623 217 q 466 411 623 372 q 176 487 197 478 q 18 719 18 557 q 136 958 18 869 q 399 1040 244 1040 q 670 956 561 1040 q 791 713 791 864 l 591 713 q 526 826 583 786 q 393 866 469 866 q 277 838 326 866 q 218 742 218 804 q 374 617 218 655 q 667 542 646 552 q 826 306 826 471 "},"!":{"x_min":0,"x_max":204,"ha":307,"o":"m 204 739 q 182 515 204 686 q 152 282 167 398 l 52 282 q 13 589 27 473 q 0 739 0 704 l 0 1013 l 204 1013 l 204 739 m 204 0 l 0 0 l 0 203 l 204 203 l 204 0 "},"?":{"x_min":1,"x_max":687,"ha":785,"o":"m 687 734 q 621 563 687 634 q 501 454 560 508 q 436 293 436 386 l 251 293 l 251 391 q 363 557 251 462 q 476 724 476 653 q 432 827 476 788 q 332 866 389 866 q 238 827 275 866 q 195 699 195 781 l 1 699 q 110 955 1 861 q 352 1040 210 1040 q 582 963 489 1040 q 687 734 687 878 m 446 0 l 243 0 l 243 203 l 446 203 l 446 0 "},"F":{"x_min":0,"x_max":706.953125,"ha":778,"o":"m 706 837 l 206 837 l 206 606 l 645 606 l 645 431 l 206 431 l 206 0 l 0 0 l 0 1013 l 706 1013 l 706 837 "},"R":{"x_min":0,"x_max":836.109375,"ha":947,"o":"m 836 0 l 608 0 q 588 53 596 20 q 581 144 581 86 q 581 179 581 162 q 581 215 581 197 q 553 345 581 306 q 428 393 518 393 l 208 393 l 208 0 l 0 0 l 0 1013 l 491 1013 q 720 944 630 1013 q 819 734 819 869 q 778 584 819 654 q 664 485 738 513 q 757 415 727 463 q 794 231 794 358 l 794 170 q 800 84 794 116 q 836 31 806 51 l 836 0 m 462 838 l 208 838 l 208 572 l 452 572 q 562 604 517 572 q 612 704 612 640 q 568 801 612 765 q 462 838 525 838 "},"E":{"x_min":0,"x_max":761.109375,"ha":824,"o":"m 761 0 l 0 0 l 0 1013 l 734 1013 l 734 837 l 206 837 l 206 621 l 690 621 l 690 446 l 206 446 l 206 186 l 761 186 l 761 0 "},"Y":{"x_min":0,"x_max":836,"ha":931,"o":"m 836 1013 l 532 376 l 532 0 l 322 0 l 322 376 l 0 1013 l 208 1013 l 427 576 l 626 1013 l 836 1013 "},"L":{"x_min":0,"x_max":704.171875,"ha":763,"o":"m 704 0 l 0 0 l 0 1013 l 208 1013 l 208 186 l 704 186 l 704 0 "}," ":{"x_min":0,"x_max":0,"ha":375},"T":{"x_min":0,"x_max":809,"ha":894,"o":"m 809 831 l 509 831 l 509 0 l 299 0 l 299 831 l 0 831 l 0 1013 l 809 1013 l 809 831 "}},"cssFontWeight":"bold","ascender":1216,"underlinePosition":-100,"cssFontStyle":"normal","boundingBox":{"yMin":-333,"xMin":-162,"yMax":1216,"xMax":1681},"resolution":1000,"original_font_information":{"postscript_name":"Helvetiker-Bold","version_string":"Version 1.00 2004 initial release","vendor_url":"http://www.magenta.gr","full_font_name":"Helvetiker Bold","font_family_name":"Helvetiker","copyright":"Copyright (c) Magenta ltd, 2004.","description":"","trademark":"","designer":"","designer_url":"","unique_font_identifier":"Magenta ltd:Helvetiker Bold:22-10-104","license_url":"http://www.ellak.gr/fonts/MgOpen/license.html","license_description":"Copyright (c) 2004 by MAGENTA Ltd. All Rights Reserved.\r\n\r\nPermission is hereby granted, free of charge, to any person obtaining a copy of the fonts accompanying this license (\"Fonts\") and associated documentation files (the \"Font Software\"), to reproduce and distribute the Font Software, including without limitation the rights to use, copy, merge, publish, distribute, and/or sell copies of the Font Software, and to permit persons to whom the Font Software is furnished to do so, subject to the following conditions: \r\n\r\nThe above copyright and this permission notice shall be included in all copies of one or more of the Font Software typefaces.\r\n\r\nThe Font Software may be modified, altered, or added to, and in particular the designs of glyphs or characters in the Fonts may be modified and additional glyphs or characters may be added to the Fonts, only if the fonts are renamed to names not containing the word \"MgOpen\", or if the modifications are accepted for inclusion in the Font Software itself by the each appointed Administrator.\r\n\r\nThis License becomes null and void to the extent applicable to Fonts or Font Software that has been modified and is distributed under the \"MgOpen\" name.\r\n\r\nThe Font Software may be sold as part of a larger software package but no copy of one or more of the Font Software typefaces may be sold by itself. \r\n\r\nTHE FONT SOFTWARE IS PROVIDED \"AS IS\", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL MAGENTA OR PERSONS OR BODIES IN CHARGE OF ADMINISTRATION AND MAINTENANCE OF THE FONT SOFTWARE BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM OTHER DEALINGS IN THE FONT SOFTWARE.","manufacturer_name":"Magenta ltd","font_sub_family_name":"Bold"},"descender":-334,"familyName":"Helvetiker","lineHeight":1549,"underlineThickness":50};
