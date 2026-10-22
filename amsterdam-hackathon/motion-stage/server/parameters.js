import {parameterDefinitions,parameterDefaults} from '../public/parameters.js';
const validScene=scene=>typeof scene==='string'&&/^[a-z0-9-]{1,64}$/.test(scene);
export class ParameterStore {
  constructor(){this.values=new Map();this.midiEvents=0;}
  key(deck,scene){
    if(![1,2].includes(deck)||!validScene(scene))throw new Error('Invalid parameter deck or scene');
    return `${deck}:${scene}`;
  }
  get(deck,scene){return {...parameterDefaults(scene),...this.values.get(this.key(deck,scene))};}
  // Validate the entire patch before applying any values. Clamp to the declared range.
  set(deck,scene,params){
    const key=this.key(deck,scene),defs=parameterDefinitions(scene),patch={};
    if(!params||Array.isArray(params)||typeof params!=='object')throw new Error('params must be an object');
    for(const [name,value] of Object.entries(params)){
      if(!Object.hasOwn(defs,name)||typeof value!=='number'||!Number.isFinite(value))throw new Error(`Invalid parameter: ${name}`);
      const d=defs[name];patch[name]=Math.min(d.max,Math.max(d.min,d.integer?Math.round(value):value));
    }
    this.values.set(key,{...this.values.get(key),...patch});return this.get(deck,scene);
  }
  reset(deck,scene){this.values.delete(this.key(deck,scene));return this.get(deck,scene);}
  snapshot(deck){return Object.fromEntries([...this.values].filter(([key])=>key.startsWith(`${deck}:`)).map(([key,value])=>[key.slice(2),{...value}]));}
  midi(data,sceneForDeck,deckOverride){
    if(!Array.isArray(data)||data.length!==3||!data.every(Number.isInteger)||data[0]<128||data[0]>239||data.slice(1).some(v=>v<0||v>127))throw new Error('Expected three MIDI bytes: status, data1, data2');
    if(deckOverride!==undefined&&![1,2].includes(deckOverride))throw new Error('Invalid MIDI deck');
    this.midiEvents++;
    // Channel 1 → A, channel 2 → B. Other channels and non-CC events are ignored.
    const channel=(data[0]&15)+1,deck=deckOverride??channel;
    if((data[0]&240)!==176||![1,2].includes(deck))return {matched:false};
    const scene=sceneForDeck(deck),defs=parameterDefinitions(scene);
    const match=Object.entries(defs).find(([,d])=>d.cc===data[1]);
    if(!match)return {matched:false};
    const [name,d]=match,value=d.bipolar
      ?(data[2]<64?d.min*(1-data[2]/64):d.max*(data[2]-64)/63)
      :d.min+(d.max-d.min)*data[2]/127;
    return {matched:true,deck,scene,params:this.set(deck,scene,{[name]:value})};
  }
}
