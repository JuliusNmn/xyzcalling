// Optional actual UDP generator for testing the complete OSC path. Does not control djay.
import dgram from 'node:dgram';import {encodeOsc} from './osc.js';
const socket=dgram.createSocket('udp4'),port=Number(process.env.OSC_PORT??10003),start=performance.now();
const send=(address,value)=>socket.send(encodeOsc({address,args:[value]}),port,'127.0.0.1');
for(const id of [1,2])for(const [key,value]of Object.entries({loaded:1,title:id===1?'OSC fallback demo':'First Of The Year',artist:id===1?'Motion Stage':'Skrillex',duration:142.48,bpm:120}))send(`/djay/turntable${id}/song/${key}`,value);
const timer=setInterval(()=>{const time=(performance.now()-start)/1000,beat=time*2;for(const id of [1,2])for(const [key,value]of Object.entries({playing:1,bpm:120,time,bar:Math.floor(beat/4)+1,beat:Math.floor(beat%4)+1,phase:beat%1,barPhase:beat%4}))send(`/djay/turntable${id}/playback/${key}`,value);send('/djay/mixer/crossfader',(Math.sin(time/6)+1)/2);},1000/60);
console.log(`Synthetic OSC → 127.0.0.1:${port}; stop with Ctrl+C. Do not run alongside live djay on this port.`);
process.on('SIGINT',()=>{clearInterval(timer);socket.close();});
