import {readFile, readdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
export const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const localConfigPath=path.resolve(process.env.MOTION_STAGE_CONFIG??path.join(root,'config.local.json'));
export async function readConfig() {
  const defaults=JSON.parse(await readFile(path.join(root,'config.json'),'utf8'));
  let local={};try {local=JSON.parse(await readFile(localConfigPath,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
  const c={...defaults,...local};
  c.httpPort=Number(process.env.PORT??c.httpPort);c.httpHost=process.env.HOST??c.httpHost;
  c.djayPort=Number(process.env.DJAY_PORT??c.djayPort);c.oscPort=Number(process.env.OSC_PORT??c.oscPort);c.oscHost=process.env.OSC_HOST??c.oscHost;
  if(process.env.PORT&&!local.callbackBaseUrl)c.callbackBaseUrl=`http://${c.httpHost}:${c.httpPort}`;
  if(process.env.CALLBACK_BASE_URL)c.callbackBaseUrl=process.env.CALLBACK_BASE_URL;
  validate(c);return c;
}
export function validate(c) {
  for(const key of ['httpPort','oscPort','djayPort'])if(!Number.isInteger(c[key])||c[key]<1||c[key]>65535)throw new Error(`Invalid ${key}`);
  if(!Number.isFinite(c.fps)||c.fps<1||c.fps>60)throw new Error('fps must be 1–60');
  if(!Number.isFinite(c.staleSeconds)||c.staleSeconds<0||c.staleSeconds>10)throw new Error('staleSeconds must be 0–10');
  if(c.beatsPerBar!==4)throw new Error('djay v4 uses 4 beats per bar');
  if(!c.osc?.prefix?.includes('{deck}')||!c.osc.fields||!c.osc.crossfader)throw new Error('Missing OSC address mapping');
  const range=c.osc.crossfaderRange;if(!Array.isArray(range)||range.length!==2||!range.every(Number.isFinite)||range[0]===range[1])throw new Error('Invalid crossfader range');
  for(const key of ['beatBase','barBase','timeScale'])if(!Number.isFinite(c.osc[key]))throw new Error(`Invalid ${key}`);
  const callback=new URL(c.callbackBaseUrl);if(callback.protocol!=='http:')throw new Error('Artwork callback must use HTTP');
  for(const id of Object.values(c.deckCharacters??{}))if(!['embedded','chicken','ch20-nonpbr','ch20-character'].includes(id))throw new Error('Unknown character');
  const ids=new Set();
  if(!Array.isArray(c.animations)||!c.animations.length||c.animations.length>32)throw new Error('Provide 1–32 animation entries');
  for(const e of c.animations){
    if(!/^[\w-]+$/.test(e.id)||ids.has(e.id))throw new Error('Animation IDs must be unique letters, digits, dashes');ids.add(e.id);
    if(typeof e.file!=='string'||!e.file.toLowerCase().endsWith('.fbx'))throw new Error(`Invalid FBX file for ${e.id}`);
    if(!['fallback','track'].includes(e.mode)||!/^[a-z0-9-]+$/.test(e.scene))throw new Error(`Invalid mode or scene for ${e.id}`);
    if(!Number.isFinite(e.scale)||e.scale<=0||e.scale>100)throw new Error(`Invalid scale for ${e.id}`);
    if(e.mode==='fallback'&&(!Number.isInteger(e.bars)||e.bars<1))throw new Error(`Set a positive bar count for ${e.id}`);
    for(const key of ['trimStart','trimEnd','loopBlendFraction'])if(e[key]!==undefined&&(!Number.isFinite(e[key])||e[key]<0))throw new Error(`Invalid ${key}`);
    if((e.trimEnd!==undefined&&e.trimEnd<=(e.trimStart??0))||(e.loopBlendFraction??0)>.5)throw new Error('Invalid loop range or blend');
    if(e.offsetSeconds!==undefined&&!Number.isFinite(e.offsetSeconds))throw new Error('Invalid offset');
    if(e.match?.titles&&!Array.isArray(e.match.titles))throw new Error('titles must be an array');
  }
  for(const id of [1,2])if(!c.animations.some(e=>e.id===c.fallbacks[id]&&e.mode==='fallback'))throw new Error(`Deck ${id} needs a fallback`);
}
export async function discover(c){
  try{return (await readdir(path.resolve(root,c.assetDirectory))).filter(n=>n.endsWith('.fbx')).sort().map(name=>({name,file:path.join(c.assetDirectory,name)}));}catch{return [];}
}
