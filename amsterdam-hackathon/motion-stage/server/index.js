import http from 'node:http';
import dgram from 'node:dgram';
import path from 'node:path';
import {readFile,writeFile,rename,stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {WebSocketServer,WebSocket} from 'ws';
import {fromBuffer} from 'osc-min';
import {encodeOsc} from './osc.js';
import {root,localConfigPath,readConfig,validate,discover} from './config.js';
import {loadRig,createRig} from './rig.js';
import {characters} from './characters.js';
import {characterInfo,createRetargetedRig} from './retarget.js';
import {State,selectAnimation,animationTime,loopBlend} from './state.js';
import {ParameterStore} from './parameters.js';
import {OscParameterRouter} from './osc-parameters.js';
import {parameterDefinitions} from '../public/parameters.js';

let config=await readConfig();
const live=new State(config), demo=new State(config);
const parameters=new ParameterStore(),sceneOverrides={};
const oscParameters=new OscParameterRouter(parameters,sceneForDeck);
function sceneForDeck(id){return sceneOverrides[id]??selectAnimation((demoMode?demo:live).snapshot(now())[id-1],catalog.filter(e=>e.available),config.fallbacks[id])?.scene??'cyan';}
function control(command,store=parameters,preview){
  const deck=command.deck??1;
  const scene=command.scene??(preview?catalog.find(e=>e.id===preview.id)?.scene:sceneForDeck(deck));
  if(command.type==='params'){
    if(!catalog.some(e=>e.scene===scene)&&!['cyan','amber','violet'].includes(scene))throw new Error('Unknown scene');
    return {deck,scene,params:command.reset?store.reset(deck,scene):store.set(deck,scene,command.params)};
  }
  if(command.type==='midi')return store.midi(command.data,id=>preview?catalog.find(e=>e.id===preview.id)?.scene:sceneForDeck(id),preview?1:command.deck);
  if(command.type==='scene'&&!preview){
    if(![1,2].includes(deck)||!(command.scene==='auto'||catalog.some(e=>e.scene===command.scene)||['cyan','amber','violet'].includes(command.scene)))throw new Error('Unknown deck or scene');
    if(command.scene==='auto')delete sceneOverrides[deck];else sceneOverrides[deck]=command.scene;return {ok:true};
  }
  throw new Error('Unknown control message');
}
const now=()=>performance.now()/1000;
let demoMode=false,demoPlaying=true,demoPosition=0,demoBpm=120,demoFader=0,demoLast=now();
let catalog=[],models=new Map(),rigs=new Map(),loading=false,sequence=0,dropped=0,oscError=null;
const artwork=new Map(),pendingArtwork=new Map();
async function prepare(c){
  const next=[];const nextModels=new Map();
  for(const entry of c.animations){
    const file=path.resolve(root,entry.file);
    try {
      const model=nextModels.get(file)??models.get(file)??await loadRig(file);
      const rig=createRig(model,entry);
      if((entry.trimEnd??0)>rig.duration)throw new Error('Loop end exceeds FBX duration');
      nextModels.set(file,model); next.push({...entry,file,duration:rig.duration,nodeNames:rig.nodeNames,available:true});
      console.log(`FBX ready: ${entry.name} (${rig.duration.toFixed(2)}s, ${rig.nodeNames.length} nodes)`);
    }catch(e){next.push({...entry,file,available:false,error:e.message});console.error(`FBX unavailable: ${entry.name}: ${e.message}`);}
  }
  return {next,nextModels};
}
const initial=await prepare(config);catalog=initial.next;models=initial.nextModels;
const characterModels=new Map(), characterCatalog=[];
for(const entry of characters){
  try{const model=await loadRig(path.resolve(root,entry.file),false);characterModels.set(entry.id,model);characterCatalog.push({...entry,...characterInfo(model),available:true});}
  catch(e){console.error(`Character unavailable: ${entry.name}: ${e.message}`);characterCatalog.push({...entry,available:false,error:e.message});}
}
const publicCharacters=()=>characterCatalog.map(({file,...entry})=>({...entry,url:`/characters/${entry.id}.fbx`}));
function selectedCharacter(id){return id&&id!=='embedded'&&characterCatalog.find(e=>e.id===id&&e.available);}
function performanceRig(entry,characterId,scope){
  const character=selectedCharacter(characterId),key=`${scope}:${entry.id}:${character?.id??'embedded'}`;
  if(!rigs.has(key))rigs.set(key,character?createRetargetedRig(models.get(entry.file),entry,characterModels.get(character.id),character.scale):createRig(models.get(entry.file),entry));
  return {rig:rigs.get(key),characterId:character?.id??'embedded',scale:character?.scale??entry.scale};
}
const publicCatalog=()=>catalog.map(({file,...e})=>({...e,url:`/assets/${e.id}.fbx`}));
function setDemoTracks(){
  for(const id of [1,2])for(const [field,value] of Object.entries({loaded:1,title:id===1?'Unmapped track · bar loop':'First Of The Year',artist:id===1?'Motion Stage demo':'Skrillex',duration:id===1?180:catalog.find(e=>e.id==='first-of-year')?.duration??142.48,songBpm:120})){
    demo.ingest(config.osc.prefix.replace('{deck}',id)+config.osc.fields[field],[value],now());
  }
}
setDemoTracks();
function advanceDemo(t){
  if(demoPlaying)demoPosition+=(t-demoLast)*demoBpm/120;demoLast=t;
  for(const id of [1,2]){
    const beat=demoPosition*2;
    for(const [field,value] of Object.entries({playing:demoPlaying?1:0,bpm:demoBpm,time:demoPosition,bar:Math.floor(beat/4)+1,beat:Math.floor(beat%4)+1,phase:beat%1,barPhase:beat%4}))demo.ingest(config.osc.prefix.replace('{deck}',id)+config.osc.fields[field],[value],t);
  }
  demo.ingest(config.osc.crossfader,[demoFader],t);
}
const udp=dgram.createSocket('udp4');
function sendRequest(address,args=[]){udp.send(encodeOsc({address,args}),config.djayPort,config.djayHost,e=>{if(e)console.error('OSC request:',e.message);});}
let lastDump=-Infinity;
function dump(){if(now()-lastDump>=1){sendRequest('/djay/request/dumpAll');lastDump=now();}}
function processPacket(packet,t,depth=0){
  if(depth>12)throw new Error('OSC bundle nesting limit');
  if(packet.oscType==='bundle'){for(const element of packet.elements)processPacket(element,t,depth+1);return;}
  const args=(packet.args??[]).map(a=>a.value);
  const param=packet.address.match(/^\/motion\/deck\/([12])\/param\/([A-Za-z][A-Za-z0-9]*)$/);
  if(param){control({type:'params',deck:Number(param[1]),params:{[param[2]]:args[0]}});return;}
  if(packet.address==='/motion/midi'){control({type:'midi',data:args});return;}
  live.ingest(packet.address,args,t);
  oscParameters.ingest(packet.address,args,t);
}
udp.on('message',buffer=>{try{processPacket(fromBuffer(buffer),now());}catch{live.invalid++;}});
udp.on('error',e=>{oscError=e.message;console.error(`OSC listener error: ${e.message}. Choose another OSC_PORT if occupied.`);});
udp.bind(config.oscPort,config.oscHost,()=>{console.log(`OSC listening: ${config.oscHost}:${config.oscPort}`);dump();});
function requestArtwork(){
  for(const d of live.decks){
    if(!d.loaded||!d.artworkAvailable||d.artwork)continue;
    const previous=pendingArtwork.get(d.id);
    if(previous?.revision===d.revision&&(previous.attempts>=3||now()-previous.at<2))continue;
    if(now()-Math.max(...Object.values(d.metadataAt),-Infinity)<.3)continue;
    const request={revision:d.revision,token:randomBytes(18).toString('hex'),at:now(),attempts:previous?.revision===d.revision?previous.attempts+1:1};
    pendingArtwork.set(d.id,request);
    sendRequest(`/djay/request/turntable${d.id}/artwork`,[`${config.callbackBaseUrl}/api/artwork/${d.id}/${request.token}`]);
  }
}
function frame(t){
  if(demoMode)advanceDemo(t);else demoLast=t;
  const source=demoMode?demo:live;
  oscParameters.sync();
  const decks=source.snapshot(t).map(deck=>{
    const entry=selectAnimation(deck,catalog.filter(e=>e.available),config.fallbacks[deck.id]);
    const scene=sceneOverrides[deck.id]??entry?.scene??'cyan';
    deck={...deck,sceneOverride:sceneOverrides[deck.id]??'auto',scene,params:parameters.get(deck.id,scene),artworkOpacity:oscParameters.snapshot(deck.id).artwork.normalized,oscControls:oscParameters.snapshot(deck.id),sceneParams:parameters.snapshot(deck.id)};
    if(!entry)return {...deck,animation:null,pose:null,warning:'No available FBX; check asset paths.'};
    const {rig,characterId,scale}=performanceRig(entry,config.deckCharacters?.[deck.id],`deck:${deck.id}`);
    const time=animationTime(deck,entry,rig.duration,config.beatsPerBar);
    const warnings=[];
    if(!deck.seenTiming)warnings.push('Waiting for timing');
    if(entry.mode==='track'&&deck.duration&&Math.abs(deck.duration-rig.duration)>1)warnings.push(`Track / FBX duration differs (${deck.duration.toFixed(1)}s / ${rig.duration.toFixed(1)}s). Set the correct recording or offset.`);
    return {...deck,artwork:deck.artwork??(entry.artwork?`/artwork/${entry.id}`:null),animation:{id:entry.id,name:entry.name,mode:entry.mode,bars:entry.bars,scene:entry.scene,scale,characterId,time,duration:rig.duration},pose:rig.sample(time,loopBlend(entry,time,rig.duration).time,loopBlend(entry,time,rig.duration).weight),warning:warnings.join(' · ')};
  });
  return {type:'frame',version:1,sequence:++sequence,serverTime:t,mode:demoMode?'demo':'live',crossfader:source.crossfader,coordinateSystem:'right-handed Y-up, meters; each deck shares the scene origin',decks,stats:{oscMessages:live.count,invalidPackets:live.invalid,droppedFrames:dropped,oscError,clients:wss.clients.size}};
}
const mime={'.mp3':'audio/mpeg','.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.fbx':'application/octet-stream'};
async function serve(res,file,req){const info=await stat(file);if(!info.isFile())throw Object.assign(new Error('Not found'),{status:404});if(req?.headers.range){const match=req.headers.range.match(/^bytes=(\d+)-(\d*)$/);if(!match){res.writeHead(416,{'Content-Range':`bytes */${info.size}`});return res.end();}const start=Number(match[1]),end=Math.min(info.size-1,match[2]?Number(match[2]):info.size-1);if(start>end){res.writeHead(416,{'Content-Range':`bytes */${info.size}`});return res.end();}res.writeHead(206,{'Content-Type':mime[path.extname(file)]??'application/octet-stream','Accept-Ranges':'bytes','Content-Range':`bytes ${start}-${end}/${info.size}`,'Content-Length':end-start+1});return createReadStream(file,{start,end}).on('error',()=>res.destroy()).pipe(res);}
res.writeHead(200,{'Content-Type':mime[path.extname(file)]??'application/octet-stream','Content-Length':info.size,'Cache-Control':'no-cache'});createReadStream(file).on('error',()=>res.destroy()).pipe(res);}
async function body(req,max=1024*1024){const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>max)throw Object.assign(new Error('Payload too large'),{status:413});chunks.push(chunk);}return Buffer.concat(chunks);}
function json(res,value,status=200){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));}
function sameOrigin(req){return !req.headers.origin||req.headers.origin===`http://${req.headers.host}`;}
let server;
server=http.createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://localhost'), route=url.pathname;
    // Artwork is deliberately a POST from djay, protected by a per-request token.
    const callback=route.match(/^\/api\/artwork\/([12])\/([a-f0-9]+)$/);
    if(callback&&req.method==='POST'){
      const id=Number(callback[1]),pending=pendingArtwork.get(id),d=live.decks[id-1];
      if(!pending||pending.token!==callback[2]||pending.revision!==d.revision||!d.loaded)return json(res,{error:'Expired artwork request'},410);
      const bytes=await body(req,5*1024*1024);
      if(bytes[0]!==255||bytes[1]!==216||bytes[2]!==255)return json(res,{error:'Expected JPEG bytes'},415);
      // Recheck after async body read: the deck may have changed meanwhile.
      if(pendingArtwork.get(id)!==pending||d.revision!==pending.revision)return json(res,{error:'Track changed'},410);
      artwork.set(id,{bytes,revision:d.revision});d.artwork=`/api/artwork/${id}?revision=${d.revision}`;return json(res,{ok:true});
    }
    if(req.method!=='GET'&&!sameOrigin(req))return json(res,{error:'Origin rejected'},403);
    if(route==='/api/params'&&req.method==='GET'){
      const deck=Number(url.searchParams.get('deck')??1),scene=url.searchParams.get('scene')??sceneForDeck(deck);
      return json(res,{deck,scene,definitions:parameterDefinitions(scene),params:parameters.get(deck,scene)});
    }
    if(['/api/params','/api/midi','/api/scene'].includes(route)&&req.method==='POST'){
      const value=JSON.parse((await body(req,4096)).toString());
      return json(res,control({...value,type:route==='/api/params'?'params':route==='/api/midi'?'midi':'scene'}));
    }
    if(route==='/api/health')return json(res,{ok:!oscError,oscError,oscPort:config.oscPort,httpPort:config.httpPort,assets:catalog.filter(e=>e.available).length});
    if(route==='/api/catalog')return json(res,{animations:publicCatalog(),characters:publicCharacters(),files:await discover(config)});
    if(route==='/api/config'&&req.method==='GET')return json(res,config);
    if(route==='/api/config'&&req.method==='PUT'){
      if(loading)return json(res,{error:'Library is already loading'},409);loading=true;
      try{
        const next=JSON.parse((await body(req)).toString());validate(next);
        for(const k of ['httpHost','httpPort','oscHost','oscPort','fps'])if(next[k]!==config[k])throw new Error(`${k} requires editing config.local.json and restarting`);
        const prepared=await prepare(next);
        const failures=prepared.next.filter(e=>!e.available);
        if(failures.length)throw new Error(failures.map(e=>`${e.name}: ${e.error}`).join('; '));
        const destination=localConfigPath;await writeFile(destination+'.tmp',JSON.stringify(next,null,2)+'\n');await rename(destination+'.tmp',destination);
        config=next;live.config=next;demo.config=next;catalog=prepared.next;models=prepared.nextModels;rigs.clear();
        for(const ws of wss.clients)if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify({type:'catalog',animations:publicCatalog(),characters:publicCharacters()}));
        return json(res,{ok:true});
      }finally{loading=false;}
    }
    if(route==='/api/demo'&&req.method==='POST'){
      const value=JSON.parse((await body(req,4096)).toString());
      if(typeof value.enabled==='boolean')demoMode=value.enabled;
      if(typeof value.playing==='boolean')demoPlaying=value.playing;
      if(Number.isFinite(value.bpm))demoBpm=Math.min(200,Math.max(40,value.bpm));
      if(Number.isFinite(value.fader))demoFader=Math.min(1,Math.max(0,value.fader));
      if(Number.isFinite(value.time))demoPosition=Math.max(0,value.time);
      if(value.track){const d=Number(value.deck);if([1,2].includes(d)){for(const [key,val]of Object.entries(value.track))if(['title','artist','duration'].includes(key))demo.ingest(config.osc.prefix.replace('{deck}',d)+config.osc.fields[key],[val],now());}}
      return json(res,{ok:true,enabled:demoMode});
    }
    if(route==='/api/character'&&req.method==='POST'){
      const {deck,characterId}=JSON.parse((await body(req,4096)).toString());
      if(![1,2].includes(deck)||!(characterId==='embedded'||selectedCharacter(characterId)))return json(res,{error:'Unknown deck or character'},400);
      const next={...config,deckCharacters:{...config.deckCharacters,[deck]:characterId}};
      await writeFile(localConfigPath+'.tmp',JSON.stringify(next,null,2)+'\n');await rename(localConfigPath+'.tmp',localConfigPath);config=next;
      return json(res,{ok:true});
    }
    const characterAsset=route.match(/^\/characters\/([\w-]+)\.fbx$/);
    if(characterAsset){const entry=characterCatalog.find(e=>e.id===characterAsset[1]);if(!entry)return json(res,{error:'Unknown character'},404);return await serve(res,path.resolve(root,entry.file),req);}
    if(route==='/api/dump' &&req.method==='POST'){dump();pendingArtwork.clear();return json(res,{ok:true});}
    const cover=route.match(/^\/api\/artwork\/([12])$/);
    if(cover){const id=Number(cover[1]),a=artwork.get(id);if(!a||a.revision!==live.decks[id-1].revision)return json(res,{error:'No artwork'},404);res.writeHead(200,{'Content-Type':'image/jpeg','Cache-Control':'no-store'});return res.end(a.bytes);}
    const sceneSource=route.match(/^\/api\/scenes\/([a-z0-9-]+)$/);
    if(sceneSource){
      const id=sceneSource[1];if(id==='registry')return json(res,{error:'Registry is not a scene'},400);
      const file=path.join(root,'public/scenes',id+'.js');await stat(file);
      if(req.method==='GET')return json(res,{file,source:await readFile(file,'utf8')});
      if(req.method==='PUT'){
        const value=JSON.parse((await body(req,64*1024)).toString());
        if(typeof value.source!=='string'||!value.source.trim())throw new Error('Scene source must not be empty');
        await writeFile(file+'.tmp',value.source);await rename(file+'.tmp',file);
        for(const ws of wss.clients)if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify({type:'scene-reload',scene:id}));
        return json(res,{ok:true});
      }
    }
    const audio=route.match(/^\/audio\/([\w-]+)$/);
    if(audio){const e=catalog.find(e=>e.id===audio[1]);if(!e?.audio) return json(res,{error:'Audio not prepared'},404);return await serve(res,path.resolve(root,e.audio),req);}
    const asset=route.match(/^\/assets\/([\w-]+)\.fbx$/);
    if(asset){const e=catalog.find(e=>e.id===asset[1]);if(!e)return json(res,{error:'Unknown asset'},404);return await serve(res,e.file);}
    const art=route.match(/^\/artwork\/([\w-]+)$/);
    if(art){const e=catalog.find(e=>e.id===art[1]);if(!e?.artwork)return json(res,{error:'No artwork'},404);return await serve(res,path.resolve(root,e.artwork));}
    if(req.method!=='GET')return json(res,{error:'Unknown route'},404);
    const base=route.startsWith('/vendor/')?path.join(root,'node_modules/three'):path.join(root,'public');
    const relative=route.startsWith('/vendor/')?route.slice(8):route==='/'?'index.html':route.slice(1);
    const file=path.resolve(base,decodeURIComponent(relative));if(!file.startsWith(base+path.sep))return json(res,{error:'Not found'},404);
    await serve(res,file);
  }catch(e){if(!res.headersSent)json(res,{error:e.message},e.status??(e.code==='ENOENT'?404:400));else res.destroy();}
});
const wss=new WebSocketServer({server,path:'/stream',maxPayload:4096,verifyClient:({req})=>sameOrigin(req)});
wss.on('error',e=>console.error('WebSocket server:',e.message));
wss.on('connection',(ws,req)=>{
  const previewId=new URL(req.url,'http://localhost').searchParams.get('preview');
  if(previewId)ws.preview={id:previewId,time:0,anchor:now(),playing:false,bpm:120,characterId:'chicken',parameters:new ParameterStore()};
  ws.on('message',raw=>{try{const command=JSON.parse(raw);
    if(['params','midi','scene'].includes(command.type)){control(command,ws.preview?.parameters??parameters,ws.preview);return;}
    if(!ws.preview)return;const p=ws.preview;if(command.characterId==='embedded'||selectedCharacter(command.characterId))p.characterId=command.characterId;const t=now();p.time+=p.playing?t-p.anchor:0;p.anchor=t;if(command.animation&&catalog.some(e=>e.id===command.animation)){p.id=command.animation;p.time=0;}if(typeof command.playing==='boolean')p.playing=command.playing;if(Number.isFinite(command.time))p.time=Math.max(0,command.time);if(Number.isFinite(command.bpm))p.bpm=Math.max(40,Math.min(200,command.bpm));}catch(e){ws.send(JSON.stringify({type:'control-error',error:e.message}));}});
  ws.send(JSON.stringify({type:'catalog',animations:publicCatalog(),characters:publicCharacters()}));ws.on('error',()=>{});});
let lastInspector=0;
function previewFrame(p,t){
  const entry=catalog.find(e=>e.id===p.id&&e.available);if(!entry)return {type:'preview-error',error:'Animation unavailable'};
  const {rig,characterId,scale}=performanceRig(entry,p.characterId,'preview');
  const elapsed=p.time+(p.playing?t-p.anchor:0);const end=entry.mode==='track'?rig.duration:entry.bars*4*60/p.bpm;
  const transportTime=entry.mode==='track'?Math.min(elapsed,end):elapsed%end;
  const deck={id:1,title:entry.name,artist:entry.match?.artist??'',loaded:true,bpm:p.bpm,playing:p.playing&&!(entry.mode==='track'&&elapsed>=end),time:transportTime,beat:transportTime*p.bpm/60,revision:0,stale:false};
  const time=animationTime(deck,entry,rig.duration,config.beatsPerBar),blend=loopBlend(entry,time,rig.duration);
  deck.scene=entry.scene;deck.params=p.parameters.get(1,entry.scene);deck.sceneParams=p.parameters.snapshot(1);
  deck.animation={id:entry.id,name:entry.name,scene:entry.scene,scale,characterId,mode:entry.mode,bars:entry.bars,time,duration:rig.duration};deck.pose=rig.sample(time,blend.time,blend.weight);
  return {type:'frame',version:1,mode:'preview',serverTime:t,crossfader:0,decks:[deck,{id:2,animation:null}],previewDuration:end};
}
const timer=setInterval(()=>{
  if(!wss.clients.size)return;
  const t=now();const packet=JSON.stringify(frame(t));
  for(const ws of wss.clients){if(ws.readyState!==WebSocket.OPEN)continue;if(ws.bufferedAmount>256*1024){dropped++;continue;}ws.send(ws.preview?JSON.stringify(previewFrame(ws.preview,t)):packet);}
  if(t-lastInspector>.5){lastInspector=t;const packet=JSON.stringify({type:'osc',messages:[...live.latest.values()].reverse()});for(const ws of wss.clients)if(!ws.preview&&ws.readyState===WebSocket.OPEN&&ws.bufferedAmount<256*1024)ws.send(packet);}
},1000/config.fps);
const artworkTimer=setInterval(requestArtwork,400);
server.listen(config.httpPort,config.httpHost,()=>console.log(`Motion Stage: http://${config.httpHost}:${config.httpPort}`));
server.on('error',e=>{console.error(e);shutdown();});
function shutdown(){clearInterval(timer);clearInterval(artworkTimer);for(const ws of wss.clients)ws.terminate();wss.close();server.close();try{udp.close();}catch{} }
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
