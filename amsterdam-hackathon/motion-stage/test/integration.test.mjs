import test from 'node:test';import assert from 'node:assert/strict';import http from 'node:http';import dgram from 'node:dgram';import {spawn} from 'node:child_process';import {once} from 'node:events';import {WebSocket} from 'ws';import {fromBuffer} from 'osc-min';import {encodeOsc} from '../server/osc.js';import {tmpdir} from 'node:os';import path from 'node:path';import {randomUUID} from 'node:crypto';import {rm,readFile} from 'node:fs/promises';
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function waitUntil(read,timeout=8000){const start=Date.now();while(Date.now()-start<timeout){const value=await read();if(value)return value;await delay(30);}throw new Error('Timed out');}
async function port(){const s=http.createServer();s.listen(0,'127.0.0.1');await once(s,'listening');const p=s.address().port;await new Promise(r=>s.close(r));return p;}
test('real UDP → WebSocket, bundle handling, malformed packets, HTTP artwork and stale callback rejection',async t=>{
  const configPath=path.join(tmpdir(),`motion-stage-test-${randomUUID()}.json`);
  const httpPort=await port(),oscPort=await port(),fakeDjay=dgram.createSocket('udp4');fakeDjay.bind(0,'127.0.0.1');await once(fakeDjay,'listening');
  const requests=[];fakeDjay.on('message',b=>requests.push(fromBuffer(b)));
  const child=spawn(process.execPath,['server/index.js'],{cwd:new URL('..',import.meta.url),env:{...process.env,MOTION_STAGE_CONFIG:configPath,CALLBACK_BASE_URL:`http://127.0.0.1:${httpPort}`,PORT:String(httpPort),OSC_PORT:String(oscPort),DJAY_PORT:String(fakeDjay.address().port)},stdio:['ignore','pipe','pipe']});
  let log='';child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b);
  let ws;const sender=dgram.createSocket('udp4');
  t.after(async()=>{ws?.terminate();sender.close();fakeDjay.close();const done=once(child,'exit');child.kill('SIGTERM');await done;await rm(configPath,{force:true});});
  try{await waitUntil(()=>log.includes('Motion Stage:'),60000);}catch(e){throw new Error(`${e.message}\n${log}`);}
  assert.ok(requests.some(p=>p.address==='/djay/request/dumpAll'));
  let frame;ws=new WebSocket(`ws://127.0.0.1:${httpPort}/stream`);ws.on('message',b=>{const p=JSON.parse(b);if(p.type==='frame')frame=p;});await once(ws,'open');
  const send=(address,args)=>sender.send(encodeOsc({address,args}),oscPort,'127.0.0.1');
  const msg=(field,value)=>({address:'/djay/turntable1/'+field,args:[value]});
  sender.send(encodeOsc({oscType:'bundle',timetag:[0,1],elements:[msg('song/loaded',1),msg('song/artist','Test artist'),msg('song/title','Integration track'),msg('song/duration',200),msg('song/artworkAvailable',1),msg('playback/playing',0),msg('playback/time',37),msg('playback/bar',3),msg('playback/beat',2),msg('playback/barPhase',1),{address:'/djay/mixer/crossfader',args:[.75]}]}),oscPort,'127.0.0.1');
  await waitUntil(()=>frame?.decks[0].title==='Integration track'&&frame.crossfader===.75);
  assert.equal(frame.decks[0].time,37);assert.equal(frame.decks[0].beat,9);assert.equal(frame.decks[0].animation.id,'fallback-house');assert.ok(frame.decks[0].pose.worldPositions.head[1]>1);
  sender.send(Buffer.from('invalid osc'),oscPort,'127.0.0.1');await waitUntil(()=>frame?.stats.invalidPackets===1);
  const request=await waitUntil(()=>requests.find(p=>p.address==='/djay/request/turntable1/artwork'));
  // Transport fixture checks byte-for-byte HTTP handling; UI live test uses actual djay JPEGs.
  const jpeg=Buffer.from([255,216,255,224,0,2,255,217]);
  const callback=request.args[0].value;
  const response=await fetch(callback,{method:'POST',headers:{'Content-Type':'image/jpeg'},body:jpeg});assert.equal(response.status,200);
  await waitUntil(()=>frame?.decks[0].artwork);
  const image=await fetch(`http://127.0.0.1:${httpPort}${frame.decks[0].artwork}`);assert.deepEqual(Buffer.from(await image.arrayBuffer()),jpeg);
  send('/djay/turntable1/song/title',['Changed track']);await waitUntil(()=>frame?.decks[0].title==='Changed track');assert.equal(frame.decks[0].artwork,null);
  const stale=await fetch(callback,{method:'POST',body:jpeg});assert.equal(stale.status,410);
  const denied=await fetch(`http://127.0.0.1:${httpPort}/api/demo`,{method:'POST',headers:{Origin:'https://unrelated.example','Content-Type':'application/json'},body:'{"enabled":true}'});assert.equal(denied.status,403);
  const base=`http://127.0.0.1:${httpPort}`;const cfg=await(await fetch(base+'/api/config')).json();cfg.animations.find(e=>e.mode==='fallback').bars=3;
  const saved=await fetch(base+'/api/config',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(cfg)});assert.equal(saved.status,200);assert.equal(JSON.parse(await readFile(configPath,'utf8')).animations.find(e=>e.mode==='fallback').bars,3);
  cfg.animations.find(e=>e.mode==='fallback').bars=0;const invalid=await fetch(base+'/api/config',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(cfg)});assert.equal(invalid.status,400);assert.equal((await(await fetch(base+'/api/config')).json()).animations.find(e=>e.mode==='fallback').bars,3);
  const library=await(await fetch(base+'/api/catalog')).json();const audioReport=JSON.parse(await readFile(new URL('../reports/track-audio.json',import.meta.url)));const checks=[];
  for(const entry of library.animations.filter(e=>e.mode==='track')){
    const audio=audioReport.find(r=>r.id===entry.id);const title=entry.match.titles[0],artist=entry.match.artist;
    for(const [field,value]of Object.entries({artist,title,duration:audio?.audioDuration??entry.duration,loaded:1}))send('/djay/turntable1/song/'+field,[value]);
    send('/djay/turntable1/playback/time',[17]);
    await waitUntil(()=>frame?.decks[0].animation?.id===entry.id&&frame.decks[0].time===17);
    assert.equal(frame.decks[0].animation.scene,entry.id);assert.ok(frame.decks[0].pose.worldPositions.head);
    if(audio?.status==='ready')assert.ok(Math.abs(audio.audioDuration-entry.duration)<1);
    checks.push({id:entry.id,title,artist,fbxDuration:entry.duration,audioDuration:audio?.audioDuration??null,matched:true,scene:entry.scene});
  }
  for(const e of library.animations.filter(e=>e.mode==='fallback'))assert.equal(e.nodeNames.length,56,'Fallback must use new mannequin skeleton');
  assert.equal(checks.length,library.animations.filter(e=>e.mode==='track').length);
  const preview=new WebSocket(`ws://127.0.0.1:${httpPort}/stream?preview=first-of-year`);let previewFrame;
  preview.on('message',raw=>{const p=JSON.parse(raw);if(p.type==='frame')previewFrame=p;});await once(preview,'open');preview.send(JSON.stringify({time:42,playing:false}));
  await waitUntil(()=>previewFrame?.decks[0].time===42);assert.equal(previewFrame.mode,'preview');assert.equal(previewFrame.decks[0].animation.id,'first-of-year');assert.equal(frame.mode,'live');assert.notEqual(frame.decks[0].time,42);
  assert.equal(library.characters.filter(c=>c.available).length,3);
  for(const id of ['ch20-nonpbr','ch20-character','chicken','embedded']){
    preview.send(JSON.stringify({animation:'ready',time:25.2,playing:false,characterId:id}));
    await waitUntil(()=>previewFrame?.decks[0].animation.characterId===id&&previewFrame.decks[0].animation.id==='ready'&&previewFrame.decks[0].time===25.2);
    const expected=id==='embedded'?library.animations.find(e=>e.id==='ready'):library.characters.find(e=>e.id===id);
    assert.equal(previewFrame.decks[0].pose.transforms.length,expected.nodeNames.length);
    assert(previewFrame.decks[0].pose.worldPositions.head.every(Number.isFinite));
  }
  preview.send(JSON.stringify({animation:'first-of-year',time:5,playing:false}));
  preview.send(JSON.stringify({type:'params',deck:1,scene:'first-of-year',params:{characterCount:6,characterOpacity:.4}}));
  await waitUntil(()=>previewFrame?.decks[0].animation.id==='first-of-year'&&previewFrame.decks[0].params.characterCount===6);
  assert.equal(previewFrame.decks[0].params.characterOpacity,.4);
  await fetch(base+'/api/scene',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({deck:1,scene:'first-of-year'})});
  send('/djay/mixer/turntable3/eq/mid',[1]);
  await waitUntil(()=>frame.decks[0].scene==='first-of-year'&&frame.decks[0].params.characterCount===6);
  assert.equal(frame.decks[0].oscControls.bands.mid.parameter,'characterCount');
  for(const [raw,speed] of [[-1,-60],[1,60],[0,0]]){
    send('/djay/mixer/turntable3/eq/high',[raw]);
    await waitUntil(()=>frame.decks[0].params.cameraOrbitSpeed===speed);
  }
  assert.equal(frame.decks[0].oscControls.bands.high.parameter,'cameraOrbitSpeed');
  send('/djay/mixer/turntable3/eq/mid',[-1]);
  await waitUntil(()=>frame.decks[0].params.characterCount===1);
  assert.equal(previewFrame.decks[0].params.characterCount,6,'live EQ must not change independent preview');
  const picked=await fetch(base+'/api/character',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({deck:1,characterId:'ch20-character'})});assert.equal(picked.status,200);
  await waitUntil(()=>frame.decks[0].animation.characterId==='ch20-character');
  assert.equal(JSON.parse(await readFile(configPath,'utf8')).deckCharacters[1],'ch20-character');
  const rejected=await fetch(base+'/api/character',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({deck:1,characterId:'../../secret'})});assert.equal(rejected.status,400);
  const asset=await fetch(base+'/characters/ch20-character.fbx',{headers:{Range:'bytes=0-22'}});assert.equal(asset.status,206);assert.equal((await asset.arrayBuffer()).byteLength,23);
  // Shared controls: HTTP, stream commands, OSC and MIDI all reach the rendered frame.
  const post=async(route,value)=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});
  assert.equal((await post('/api/scene',{deck:1,scene:'rumble'})).status,200);
  await waitUntil(()=>frame.decks[0].scene==='rumble'); // Let cached EQ apply before the manual override.
  assert.equal((await post('/api/params',{deck:1,scene:'rumble',params:{characterOpacity:.25,particleRate:321}})).status,200);
  await waitUntil(()=>frame.decks[0].scene==='rumble'&&frame.decks[0].params.characterOpacity===.25);
  assert.equal(frame.decks[0].params.particleRate,321);
  assert.equal(frame.decks[1].params.characterOpacity,1);
  ws.send(JSON.stringify({type:'params',deck:1,scene:'rumble',params:{characterOpacity:.5}}));
  await waitUntil(()=>frame.decks[0].params.characterOpacity===.5);
  send('/motion/deck/1/param/characterOpacity',[.75]);
  await waitUntil(()=>frame.decks[0].params.characterOpacity===.75);
  assert.equal((await post('/api/midi',{data:[176,20,0]})).status,200);
  await waitUntil(()=>frame.decks[0].params.characterOpacity===0);
  send('/motion/midi',[176,20,127]);
  await waitUntil(()=>frame.decks[0].params.characterOpacity===1);
  assert.equal((await post('/api/params',{deck:1,scene:'rumble',params:{characterOpacity:'oops'}})).status,400);
  assert.equal((await post('/api/midi',{data:[176,20,999]})).status,400);
  preview.send(JSON.stringify({animation:'rumble',time:5,playing:false}));
  await waitUntil(()=>previewFrame.decks[0].scene==='rumble');
  preview.send(JSON.stringify({type:'midi',data:[176,20,0]}));
  await waitUntil(()=>previewFrame.decks[0].params.characterOpacity===0);
  assert.equal(frame.decks[0].params.characterOpacity,1,'Preview MIDI must not affect live deck');
  preview.send(JSON.stringify({type:'params',deck:1,scene:'rumble',reset:true}));
  await waitUntil(()=>previewFrame.decks[0].params.characterOpacity===1);
  // Real djay mixer addresses: C -> A, D -> B. EQ uses -1..+1.
  assert.equal((await post('/api/scene',{deck:2,scene:'rumble'})).status,200);
  for(const [source,target] of [[3,1],[4,2]]){
    send(`/djay/mixer/turntable${source}/eq/low`,[-1]);
    send(`/djay/mixer/turntable${source}/eq/mid`,[0]);
    send(`/djay/mixer/turntable${source}/eq/high`,[1]);
    await waitUntil(()=>frame.decks[target-1].params.characterOpacity===0&&frame.decks[target-1].params.particleRate===400&&frame.decks[target-1].params.particleSpeed===3);
    assert.equal(frame.decks[target-1].oscControls.sourceDeck,source);
    if(source===3)assert.equal(frame.decks[1].params.characterOpacity,1);
  }
  assert.equal(previewFrame.decks[0].params.characterOpacity,1,'Live EQ must not change independent preview');
  send('/djay/mixer/turntable3/eq/low',[1]);
  await waitUntil(()=>frame.decks[0].params.characterOpacity===1);
  assert.equal(frame.decks[1].params.characterOpacity,0);
  assert.equal((await post('/api/scene',{deck:1,scene:'cyan'})).status,200);
  await waitUntil(()=>frame.decks[0].scene==='cyan'&&frame.decks[0].params.characterOpacity===1);
  assert.equal(frame.decks[0].oscControls.bands.mid.supported,false);
  assert.equal((await post('/api/scene',{deck:1,scene:'auto'})).status,200);
  preview.terminate();
  send('/djay/turntable1/song/loaded',[0]);await waitUntil(()=>frame?.decks[0].loaded===false);assert.equal(frame.decks[0].title,'');
});
