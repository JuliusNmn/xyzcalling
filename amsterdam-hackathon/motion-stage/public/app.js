import {createRenderer} from './renderer.js';
import {createTrackOverlay} from './track-overlay.js';
import {createMarkerControls} from './marker-controls.js';
import {scenes} from './scenes/registry.js';
import {createParameterControls} from './parameter-controls.js';
const $=id=>document.getElementById(id), escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const colors={cyan:0x87e1d3,amber:0xefad74,violet:0xbb9bf6};
let characters=[],catalog=[],config,files=[],latest,previous,receivedAt=0,sceneOverrides={},demo=false,frames=0,rateAt=performance.now(),lastUi=0;
function notice(message){$('notice').textContent=message;$('notice').hidden=!message;}
async function api(route,body,method='POST'){const response=await fetch(route,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const result=await response.json();if(!response.ok)throw new Error(result.error);return result;}
async function action(work){try{await work();}catch(e){notice(e.message);}}
const renderer=createRenderer($('canvas'),createMarkerControls(),notice);
const resize=()=>renderer.resize();
const trackOverlay=createTrackOverlay($('stage'));

$('decks').innerHTML=[1,2].map((id)=>`<article class="deck"><div class="deck-top"><div><span class="deck-letter ${id===1?'cyan':'amber'}">${id===1?'A':'B'}</span> DECK ${String(id).padStart(2,'0')}</div><span class="transport" id="transport-${id}">WAITING</span></div><div class="track-info"><div class="cover" id="cover-${id}">NO ART</div><div class="track-text"><h3 id="title-${id}">No track loaded</h3><p id="artist-${id}">Waiting for djay</p></div></div><div class="deck-metrics"><div><small>BPM</small><b id="bpm-${id}">—</b></div><div><small>BAR / BEAT</small><b id="beat-${id}">—</b></div><div><small>POSITION</small><b id="time-${id}">0:00</b></div></div><div class="assignment"><span id="animation-mode-${id}">FALLBACK</span><strong id="animation-${id}">Loading</strong></div><select id="scene-${id}" aria-label="Deck ${id} scene"><option value="auto">Automatic scene</option><option value="cyan">01 · Mint studio</option><option value="amber">02 · Amber room</option><option value="violet">03 · Violet wireframe</option></select><label>Character<select id="character-${id}" aria-label="Deck ${id} character"></select></label><p class="warning" id="warning-${id}"></p></article>`).join('');
let controlSocket;
function sendControl(command){if(controlSocket?.readyState===WebSocket.OPEN)controlSocket.send(JSON.stringify(command));else notice('Backend disconnected. Reconnect before changing parameters.');}
const parameterPanels={};
for(const id of [1,2]){
  const select=$(`scene-${id}`);select.replaceChildren(...[{id:'auto',name:'Automatic scene'},...scenes].map(s=>{const o=document.createElement('option');o.value=s.id;o.textContent=s.name;return o;}));
  select.onchange=e=>sendControl({type:'scene',deck:id,scene:e.target.value});
  const panel=document.createElement('section');panel.className='scene-parameters';select.closest('article').append(panel);
  parameterPanels[id]=createParameterControls(panel,{deck:id,send:sendControl,notice});
}
for(const id of [1,2])$(`character-${id}`).onchange=e=>action(()=>api('/api/character',{deck:id,characterId:e.target.value}));
function characterOptions(){for(const id of [1,2])$(`character-${id}`).innerHTML=[{id:'embedded',name:'Original FBX character'},...characters].map(e=>`<option value="${escape(e.id)}" ${e.available===false?'disabled':''}>${escape(e.name)}</option>`).join('');}
const anchorNames={head:'Head',leftHand:'L hand',rightHand:'R hand',leftFoot:'L foot',rightFoot:'R foot'};
$('position-values').innerHTML=Object.entries(anchorNames).map(([key,label])=>`<div><div class="point-name"><i></i>${label}</div><div class="point-coord" id="pos-${key}">—</div></div>`).join('');
const timeLabel=t=>`${Math.floor(Math.max(0,t)/60)}:${String(Math.floor(Math.max(0,t)%60)).padStart(2,'0')}`;
function updateUi(frame){
  demo=frame.mode==='demo';$('live-mode').classList.toggle('selected',!demo);$('demo-mode').classList.toggle('selected',demo);$('demo-controls').hidden=!demo;$('fader').disabled=!demo;
  $('mode-badge').textContent=demo?'DEMO':'LIVE';$('fader-source').textContent=demo?'Demo control · live OSC stays separate':'Following djay OSC';
  if(document.activeElement!==$('fader'))$('fader').value=frame.crossfader;
  $('mix-label').textContent=`${Math.round((1-frame.crossfader)*100)}% / ${Math.round(frame.crossfader*100)}%`;
  $('stage-label').textContent=frame.crossfader<.03?'DECK A / PROGRAM':frame.crossfader>.97?'DECK B / PROGRAM':'A + B / CROSSFADE';
  $('stage-status').textContent=frame.decks.some(d=>d.stale)?'Waiting for live OSC':demo?'SIMULATED TRANSPORT':'LIVE · POSE SYNCHRONIZED';
  for(const d of frame.decks){
    parameterPanels[d.id].update(d.scene??d.animation?.scene,d.params,d.oscControls);
    $(`scene-${d.id}`).value=d.sceneOverride??'auto';
    if(document.activeElement!==$(`character-${d.id}`))$(`character-${d.id}`).value=d.animation?.characterId??'embedded';
    $(`title-${d.id}`).textContent=d.loaded?(d.title||'Loading metadata…'):'No track loaded';$(`artist-${d.id}`).textContent=d.artist||'Waiting for djay';
    $(`bpm-${d.id}`).textContent=d.bpm?d.bpm.toFixed(1):'—';$(`beat-${d.id}`).textContent=`${Math.floor(d.beat/4)+1}.${Math.floor(((d.beat%4)+4)%4)+1}`;$(`time-${d.id}`).textContent=timeLabel(d.time);
    $(`transport-${d.id}`).textContent=d.stale?'NO SIGNAL':d.playing?'▶ PLAYING':'Ⅱ PAUSED';
    $(`animation-${d.id}`).textContent=d.animation?.name??'Unavailable';$(`animation-mode-${d.id}`).textContent=d.animation?.mode==='track'?'TRACK SYNC':`${d.animation?.bars??'—'} BAR LOOP`;
    $(`warning-${d.id}`).textContent=d.warning||'';
    const cover=$(`cover-${d.id}`);if(cover.dataset.url!==(d.artwork??'')){cover.dataset.url=d.artwork??'';cover.replaceChildren();if(d.artwork){const img=document.createElement('img');img.src=d.artwork;img.alt='Album artwork';img.onerror=()=>cover.textContent='NO ART';cover.append(img);}else cover.textContent='NO ART';}
  }
  const positions=frame.decks[Number($('position-deck').value)-1]?.pose?.worldPositions;
  for(const key of Object.keys(anchorNames))$(`pos-${key}`).innerHTML=positions?.[key]?positions[key].map((v,i)=>`<span>${'XYZ'[i]}</span>${v.toFixed(3)}<br>`).join(''):'—';
  $('osc-count').textContent=frame.stats.oscMessages.toLocaleString();$('invalid-count').textContent=frame.stats.invalidPackets;$('drop-count').textContent=frame.stats.droppedFrames;
  if(frame.stats.oscError)notice(`OSC: ${frame.stats.oscError}`);
  if(document.activeElement!==$('demo-seek'))$('demo-seek').value=frame.decks[0].time;
}
let reconnectTimer;
function connect(){
  const ws=new WebSocket(`${location.protocol==='https:'?'wss':'ws'}://${location.host}/stream`);
  controlSocket=ws;
  ws.onopen=()=>{$('connection').textContent='● ENGINE CONNECTED';notice('');};
  ws.onmessage=event=>{const data=JSON.parse(event.data);if(data.type==='catalog'){catalog=data.animations;characters=data.characters??[];renderer.setCatalog(catalog,characters);characterOptions();renderLibrary();}
    if(data.type==='frame'){previous=latest;latest=data;renderer.setFrame(data);trackOverlay.update(data);receivedAt=performance.now();frames++;if(receivedAt-rateAt>=1000){$('pose-rate').textContent=Math.round(frames*1000/(receivedAt-rateAt));frames=0;rateAt=receivedAt;}if(receivedAt-lastUi>100){lastUi=receivedAt;updateUi(data);}}
    if(data.type==='control-error')notice(data.error);
    if(data.type==='scene-reload')renderer.reloadScene(data.scene);
    if(data.type==='osc'){$('osc-empty').hidden=data.messages.length>0;$('osc-table').innerHTML=data.messages.map(m=>`<tr><td>${escape(m.address)}</td><td>${escape(JSON.stringify(m.args))}</td></tr>`).join('');}};
  ws.onclose=()=>{$('connection').textContent='● RECONNECTING';notice('Connection lost. Holding the last pose; reconnecting…');clearTimeout(reconnectTimer);reconnectTimer=setTimeout(connect,1500);};
  ws.onerror=()=>ws.close();
}
connect();
for(const button of document.querySelectorAll('[data-tab]'))button.onclick=()=>{for(const name of ['stage','library','signal'])$(`tab-${name}`).hidden=button.dataset.tab!==name;for(const b of document.querySelectorAll('[data-tab]'))b.classList.toggle('active',b===button);resize();};
$('live-mode').onclick=()=>action(()=>api('/api/demo',{enabled:false}));$('demo-mode').onclick=()=>action(()=>api('/api/demo',{enabled:true}));
$('fader').oninput=e=>action(()=>api('/api/demo',{fader:Number(e.target.value)}));
$('demo-bpm').onchange=e=>action(()=>api('/api/demo',{bpm:Number(e.target.value)}));
$('demo-seek').oninput=e=>action(()=>api('/api/demo',{time:Number(e.target.value)}));
let playing=true,switched=false;
$('play-demo').onclick=()=>action(async()=>{playing=!playing;await api('/api/demo',{playing});$('play-demo').textContent=playing?'Pause':'Play';});
$('switch-demo').onclick=()=>action(async()=>{switched=!switched;await api('/api/demo',{deck:2,track:switched?{title:'Unmapped track',artist:'Demo',duration:180}:{title:'First Of The Year',artist:'Skrillex',duration:catalog.find(e=>e.id==='first-of-year')?.duration??142.48}});});
$('fullscreen').onclick=()=>action(()=>document.fullscreenElement?document.exitFullscreen():$('stage').requestFullscreen());
$('dump').onclick=()=>action(async()=>{await api('/api/dump',{});notice('Requested current state and artwork from djay.');});
async function fetchConfig(){config=await (await fetch('/api/config')).json();const inventory=await(await fetch('/api/catalog')).json();files=inventory.files;catalog=inventory.animations;$('osc-address').textContent=`Receive ${config.oscHost}:${config.oscPort} · djay requests ${config.djayHost}:${config.djayPort}`;$('import-file').innerHTML=files.map(f=>`<option value="${escape(f.file)}">${escape(f.name)}</option>`).join('');renderLibrary();}
function renderLibrary(){if(!config)return;
  $('library').innerHTML=config.animations.map(entry=>{const c=catalog.find(c=>c.id===entry.id);return `<article class="library-card" data-id="${escape(entry.id)}"><div class="clip-icon">${entry.mode==='track'?'↗':'↻'}</div><h3>${escape(entry.name)}</h3><p class="muted">${c?.available?`${c.duration.toFixed(2)} seconds · ${c.nodeNames.length} rig nodes`:escape(c?.error??'Loading…')}</p><label>Playback mode<select data-field="mode"><option value="fallback" ${entry.mode==='fallback'?'selected':''}>Fallback · musical loop</option><option value="track" ${entry.mode==='track'?'selected':''}>Full track · seconds</option></select></label><label>Loop length in bars<input data-field="bars" type="number" min="1" value="${entry.bars??4}"></label><label>Scene<select data-field="scene">${scenes.map(scene=>`<option value="${scene.id}" ${entry.scene===scene.id?'selected':''}>${scene.name}</option>`).join('')}</select></label><label>Exact artist<input data-field="artist" value="${escape(entry.match?.artist??'')}"></label><label>Track titles (one per line)<textarea data-field="titles" style="height:64px;font-size:11px">${escape(entry.match?.titles?.join('\n')??'')}</textarea></label><label>Track offset in seconds<input data-field="offset" type="number" step="0.01" value="${entry.offsetSeconds??0}"></label><a class="preview-link" target="_blank" href="/preview.html?animation=${escape(entry.id)}">▶ Preview & edit scene ↗</a><button class="save-entry">Save assignment</button><div style="display:flex;gap:8px"><button class="fallback" data-deck="1">${config.fallbacks[1]===entry.id?'✓ ':''}Fallback A</button><button class="fallback" data-deck="2">${config.fallbacks[2]===entry.id?'✓ ':''}Fallback B</button></div></article>`;}).join('');
  for(const card of document.querySelectorAll('.library-card')){
    card.querySelector('.save-entry').onclick=()=>action(async()=>{const next=structuredClone(config),e=next.animations.find(e=>e.id===card.dataset.id),v=f=>card.querySelector(`[data-field="${f}"]`).value;e.mode=v('mode');e.bars=Number(v('bars'));e.scene=v('scene');e.offsetSeconds=Number(v('offset'));e.match={artist:v('artist'),titles:v('titles').split('\n').map(t=>t.trim()).filter(Boolean)};await saveConfig(next);});
    for(const b of card.querySelectorAll('.fallback'))b.onclick=()=>action(async()=>{const next=structuredClone(config);if(next.animations.find(e=>e.id===card.dataset.id).mode!=='fallback')throw new Error('Choose fallback playback mode before assigning this clip.');next.fallbacks[b.dataset.deck]=card.dataset.id;await saveConfig(next);});
  }
}
async function saveConfig(next){notice('Loading and validating animation library…');await api('/api/config',next,'PUT');await fetchConfig();notice('Animation assignments saved.');}
$('import-animation').onclick=()=>action(async()=>{const file=$('import-file').value;if(!file)throw new Error('No FBX captures found.');if(config.animations.some(e=>e.file===file))throw new Error('This capture is already in the library.');const next=structuredClone(config);const name=files.find(f=>f.file===file).name.replace(/\.gvhmr\.fbx$/,'');next.animations.push({id:`capture-${Date.now().toString(36)}`,name,file,mode:'fallback',bars:4,scale:.01,scene:'cyan'});$('import-status').textContent='Loading capture…';try{await saveConfig(next);$('import-status').textContent='Imported. Set the musical bar length below.';}finally{if($('import-status').textContent==='Loading capture…')$('import-status').textContent='';}});
for(const id of ['edit-config','settings'])$(id).onclick=()=>action(async()=>{await fetchConfig();$('config-json').value=JSON.stringify(config,null,2);$('config-result').textContent='';$('editor').showModal();});
$('save-config').onclick=()=>action(async()=>{$('save-config').disabled=true;try{await saveConfig(JSON.parse($('config-json').value));$('config-result').textContent='Saved';$('editor').close();}catch(e){$('config-result').textContent=e.message;throw e;}finally{$('save-config').disabled=false;}});
action(fetchConfig);
