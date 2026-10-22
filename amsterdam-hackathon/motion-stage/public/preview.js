import {createRenderer} from './renderer.js';
import {createMarkerControls} from './marker-controls.js';
import {createParameterControls} from './parameter-controls.js';
const $=id=>document.getElementById(id);const notice=message=>{$('notice').textContent=message;$('notice').hidden=!message;};
const renderer=createRenderer($('canvas'),createMarkerControls(),notice);
let characterId='chicken';
let catalog=[],selected,ws,playing=false,lastSeek=0,reconnect,dirty=false;
let requested=new URLSearchParams(location.search).get('animation');
const audio=$('audio');
const parameterPanel=createParameterControls($('parameters'),{deck:1,send,notice,preview:true});
function send(command){if(ws?.readyState===WebSocket.OPEN)ws.send(JSON.stringify(command));else notice('Backend disconnected. Reconnect before changing controls.');}
async function loadSource(){if(!selected)return;const response=await fetch(`/api/scenes/${selected.scene}`);const value=await response.json();if(!response.ok)throw new Error(value.error);$('source').value=value.source;$('scene-file').textContent=value.file;$('save-state').textContent='One file per scene';dirty=false;}
async function choose(id){
  selected=catalog.find(e=>e.id===id);if(!selected){notice('Animation not found');return;}
  requested=id;history.replaceState(null,'','?animation='+encodeURIComponent(id));$('animation').value=id;$('title').textContent=selected.name;
  playing=false;audio.pause();send({animation:id,time:0,playing:false});$('play').textContent='Play';$('seek').value=0;
  audio.hidden=!selected.audio;if(selected.audio){audio.src=`/audio/${selected.id}`;audio.load();}else audio.removeAttribute('src');
  $('audio-note').textContent=selected.audio?'Source-video audio. Play or seek here to preview picture and sound together.':'No audio attached. Visual preview uses the BPM control.';
  $('timing').textContent=selected.mode==='track'?`Full-track timeline · ${selected.duration.toFixed(2)} seconds · scene ${selected.scene}.js`:`${selected.bars} bar loop · mannequin capture ${selected.trimStart??0}–${selected.trimEnd??selected.duration}s · scene ${selected.scene}.js`;
  try{await loadSource();}catch(e){notice(e.message);}
}
function connect(){
  ws=new WebSocket(`ws://${location.host}/stream?preview=${encodeURIComponent(requested??'real-house')}`);
  ws.onopen=()=>{$('connection').textContent='● INDEPENDENT PREVIEW';notice('');};
  ws.onmessage=event=>{const data=JSON.parse(event.data);
    if(data.type==='catalog'){catalog=data.animations;renderer.setCatalog(catalog,data.characters);$('character').replaceChildren(...[{id:'embedded',name:'Original FBX character'},...(data.characters??[])].map(e=>{const o=document.createElement('option');o.value=e.id;o.textContent=e.name;o.disabled=e.available===false;return o;}));$('character').value=characterId;send({characterId});$('animation').replaceChildren(...catalog.map(e=>{const o=document.createElement('option');o.value=e.id;o.textContent=e.name;return o;}));choose(requested??catalog[0]?.id);}
    if(data.type==='frame'){renderer.setFrame(data);parameterPanel.update(data.decks[0].scene,data.decks[0].params);const d=data.decks[0];$('seek').max=data.previewDuration;if(document.activeElement!==$('seek'))$('seek').value=d.time;$('clock').textContent=d.time.toFixed(2)+'s';if(!selected?.audio){playing=d.playing;$('play').textContent=playing?'Pause':'Play';}}
    if(data.type==='control-error')notice(data.error);
    if(data.type==='preview-error')notice(data.error);
    if(data.type==='scene-reload')renderer.reloadScene(data.scene);
  };
  ws.onclose=()=>{audio.pause();$('connection').textContent='RECONNECTING';clearTimeout(reconnect);reconnect=setTimeout(connect,1500);};
}
$('character').onchange=()=>{characterId=$('character').value;send({characterId});};
$('animation').onchange=()=>{if(dirty&&!confirm('Discard unsaved scene edits?')){$('animation').value=requested;return;}choose($('animation').value);};
$('play').onclick=async()=>{try{if(selected?.audio){if(audio.paused)await audio.play();else audio.pause();}else{playing=!playing;send({playing});$('play').textContent=playing?'Pause':'Play';}}catch(e){notice(e.message);}};
$('seek').oninput=()=>{const time=Number($('seek').value);if(selected?.audio)audio.currentTime=time;send({time});};
$('bpm').onchange=()=>send({bpm:Number($('bpm').value)});
$('restart').onclick=()=>{if(selected?.audio)audio.currentTime=0;send({time:0});};
for(const event of ['play','pause','seeked','ended'])audio.addEventListener(event,()=>{playing=!audio.paused;send({time:audio.currentTime,playing});$('play').textContent=playing?'Pause':'Play';});
setInterval(()=>{if(selected?.audio&&!audio.paused)send({time:audio.currentTime,playing:true});},100);
$('source').oninput=()=>{dirty=true;$('save-state').textContent='Unsaved changes';};
$('reload').onclick=async()=>{if(dirty&&!confirm('Discard unsaved scene edits?'))return;try{await loadSource();renderer.reloadScene(selected.scene);}catch(e){notice(e.message);}};
$('save').onclick=async()=>{try{$('save').disabled=true;const response=await fetch(`/api/scenes/${selected.scene}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({source:$('source').value})});const value=await response.json();if(!response.ok)throw new Error(value.error);dirty=false;$('save-state').textContent='Saved · scene reloaded';notice('');renderer.reloadScene(selected.scene);}catch(e){notice(e.message);}finally{$('save').disabled=false;}};
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
connect();
