import {parameterDefinitions} from '../public/parameters.js';

// Confirmed from live djay OSC: EQ is -1..+1, C=turntable3 and D=turntable4.
export const eqBindings={low:'characterOpacity',mid:'particleRate',high:'particleSpeed'};
const bindingsFor=scene=>scene==='ready'?{low:'characterOpacity',mid:'rubberWarp',high:'shardFrenzy'}:scene==='real-house'?{low:'characterOpacity',mid:'gridSpread',high:'sphereSize'}:scene==='wide-open'?{low:'characterOpacity',mid:'characterScale',high:'feedbackRate'}:scene==='freestyler'?{low:'characterOpacity',mid:'printStyle',high:'saleType'}:scene==='gal-a-bubble'?{low:'characterOpacity',mid:'coneColors',high:'coneIntensity'}:scene==='first-of-year'?{...eqBindings,mid:'characterCount',high:'cameraOrbitSpeed'}:eqBindings;
export class OscParameterRouter {
  constructor(parameters,sceneForDeck){this.parameters=parameters;this.sceneForDeck=sceneForDeck;this.inputs=new Map();this.scenes=new Map();this.artworkFaders=new Map();}
  apply(deck,band,input,scene){
    const parameter=bindingsFor(scene)[band],definition=parameterDefinitions(scene)[parameter];
    if(!definition)return; // Cache the control even if this scene has no matching parameter.
    const value=definition.min+(definition.max-definition.min)*input.normalized;
    this.parameters.set(deck,scene,{[parameter]:value});
  }
  sync(){
    for(const deck of [1,2]){
      const scene=this.sceneForDeck(deck);if(this.scenes.get(deck)===scene)continue;
      this.scenes.set(deck,scene);
      for(const band of Object.keys(eqBindings)){const input=this.inputs.get(`${deck}:${band}`);if(input)this.apply(deck,band,input,scene);}
    }
  }
  ingest(address,args,time){
    // djay OSC v4: line faders are unipolar 0..1; C/D control artwork on A/B.
    const fader=address.match(/^\/djay\/mixer\/turntable([34])\/lineFader$/);
    if(fader){
      if(args.length!==1||typeof args[0]!=='number'||!Number.isFinite(args[0]))throw new Error('Expected one finite numeric line fader value');
      const deck=Number(fader[1])-2,raw=Math.max(0,Math.min(1,args[0]));
      this.artworkFaders.set(deck,{raw,normalized:raw,at:time});
      return true;
    }
    const match=address.match(/^\/djay\/mixer\/turntable([34])\/eq\/(low|mid|high)$/);
    if(!match)return false;
    if(args.length!==1||typeof args[0]!=='number'||!Number.isFinite(args[0]))throw new Error('Expected one finite numeric EQ value');
    const deck=Number(match[1])-2,band=match[2],raw=Math.max(-1,Math.min(1,args[0]));
    const key=`${deck}:${band}`,previous=this.inputs.get(key),input={raw,normalized:(raw+1)/2,at:time};
    this.inputs.set(key,input);this.sync();
    // Periodic state dumps must not undo a manual slider/MIDI change; only knob
    // movement or a scene switch takes control again.
    if(!previous||previous.raw!==raw)this.apply(deck,band,input,this.scenes.get(deck));
    return true;
  }
  snapshot(deck){
    const scene=this.sceneForDeck(deck),definitions=parameterDefinitions(scene);
    return {sourceDeck:deck+2,artwork:{parameter:'artworkOpacity',normalized:1,...this.artworkFaders.get(deck)},bands:Object.fromEntries(Object.entries(bindingsFor(scene)).map(([band,parameter])=>[band,{parameter,supported:!!definitions[parameter],...this.inputs.get(`${deck}:${band}`)}]))};
  }
}
