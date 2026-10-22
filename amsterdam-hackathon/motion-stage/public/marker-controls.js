export function createMarkerControls(root=document){
  const controls={all:root.getElementById('anchors'),hands:root.getElementById('hand-markers'),feet:root.getElementById('foot-markers')};
  const storageKey='motion-stage-markers';
  try{const saved=JSON.parse(localStorage.getItem(storageKey));for(const [key,input]of Object.entries(controls))if(input&&typeof saved?.[key]==='boolean')input.checked=saved[key];}catch{}
  for(const input of Object.values(controls))input?.addEventListener('change',()=>{try{localStorage.setItem(storageKey,JSON.stringify(Object.fromEntries(Object.entries(controls).map(([key,input])=>[key,input?.checked??true]))));}catch{}});
  return name=>(controls.all?.checked??true)&&(/Hand$/.test(name)?controls.hands?.checked??true:/Foot$/.test(name)?controls.feet?.checked??true:true);
}
