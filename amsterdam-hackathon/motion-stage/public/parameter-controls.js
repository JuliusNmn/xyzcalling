import {parameterDefinitions,parameterDefaults} from './parameters.js';

const midiListeners=new Set();
let midiAccessPromise;
function dispatchMidi(event){for(const listener of midiListeners)listener(event);}

export function createParameterControls(container,{deck=1,send,notice,preview=false}){
  let scene=null,rows=[],access=null,connected=false;
  const heading=document.createElement('div');heading.className='section-heading';
  const title=document.createElement('h2');title.textContent='Scene parameters';
  const reset=document.createElement('button');reset.textContent='Reset';
  reset.onclick=()=>{if(scene)send({type:'params',deck,scene,reset:true});};
  heading.append(title,reset);
  const caption=document.createElement('p');caption.className='muted';
  const oscStatus=document.createElement('p');oscStatus.className='muted';oscStatus.hidden=preview;
  const controls=document.createElement('div');controls.className='parameter-sliders';
  const midi=document.createElement('button');midi.textContent='Connect MIDI';
  const status=document.createElement('span');status.className='muted';status.setAttribute('role','status');
  const footer=document.createElement('div');footer.className='parameter-midi';footer.append(midi,status);
  container.append(heading,caption,oscStatus,controls,footer);
  const receiveMidi=event=>{
      // Forward CC only; clock / active sensing must not flood the stream.
      const data=Array.from(event.data);
      if((data[0]&240)!==176||(!preview&&(data[0]&15)!==deck-1))return;
      if(preview&&(data[0]&15)!==0)return;
      send({type:'midi',data,deck:preview?deck:undefined});
    };
  function bindInputs(){
    for(const input of access.inputs.values())input.onmidimessage=dispatchMidi;
    const names=[...access.inputs.values()].filter(i=>i.state==='connected').map(i=>i.name);
    status.textContent=names.length?names.join(', '):'No MIDI input connected';
  }
  midi.onclick=async()=>{
    try{
      if(connected){midiListeners.delete(receiveMidi);access.removeEventListener('statechange',bindInputs);connected=false;midi.textContent='Connect MIDI';status.textContent='Disconnected';return;}
      if(!navigator.requestMIDIAccess)throw new Error('Web MIDI is unavailable in this browser. Use Chrome / Edge, or send MIDI bytes to POST /api/midi.');
      access=await (midiAccessPromise??=navigator.requestMIDIAccess({sysex:false}).catch(e=>{midiAccessPromise=null;throw e;}));connected=true;midiListeners.add(receiveMidi);access.addEventListener('statechange',bindInputs);bindInputs();midi.textContent='Disconnect MIDI';
    }catch(e){notice(e.message);}
  };
  return {update(nextScene,values={},osc){
    if(!nextScene)return;
    if(!preview){
      const source=deck===1?'C':'D',target=deck===1?'A':'B';
      const bands=osc?.bands??{};
      oscStatus.textContent=`OSC ${source} → ${target} · `+['low','mid','high'].map(band=>{
        const input=bands[band];return `${band}: ${input?.at===undefined?'waiting':input.raw.toFixed(2)}${input?.supported===false?' (unused in this scene)':''}`;
      }).join(' · ');
    }
    if(scene!==nextScene){
      scene=nextScene;caption.textContent=`${scene} · ${preview?'Preview only':'Deck '+(deck===1?'A':'B')} · MIDI channel ${deck}`;
      rows=Object.entries(parameterDefinitions(scene)).map(([key,d])=>{
        const label=document.createElement('label');label.className='parameter-row';
        const line=document.createElement('span');line.className='parameter-label';
        const name=document.createElement('span');name.textContent=d.label;
        const output=document.createElement('output');line.append(name,output);
        const input=document.createElement('input');input.type='range';input.min=d.min;input.max=d.max;input.step=d.step;
        input.setAttribute('aria-label',`${preview?'Preview':'Deck '+deck} ${d.label}`);
        const hint=document.createElement('small');const band={characterScale:'mid',feedbackRate:'high',characterOpacity:'low',printStyle:'mid',saleType:'high',particleRate:'mid',characterCount:'mid',coneColors:'mid',coneIntensity:'high',particleSpeed:'high',cameraOrbitSpeed:'high'}[key];hint.textContent=`CC ${d.cc} · ${d.min}–${d.max}${!preview&&band?' · OSC '+(deck===1?'C':'D')+' '+band+' EQ':''}`;
        let dragging=false;
        input.onpointerdown=()=>dragging=true;input.onpointerup=input.onpointercancel=input.onblur=()=>dragging=false;
        input.oninput=()=>{output.value=Number(input.value).toFixed(d.integer?0:d.step<.01?3:2);send({type:'params',deck,scene,params:{[key]:Number(input.value)}});};
        label.append(line,input,hint);return {key,d,label,input,output,dragging:()=>dragging};
      });controls.replaceChildren(...rows.map(r=>r.label));
    }
    const params={...parameterDefaults(scene),...values};
    for(const row of rows)if(!row.dragging()){row.input.value=params[row.key];row.output.value=Number(params[row.key]).toFixed(row.d.integer?0:row.d.step<.01?3:2);}
  }};
}
