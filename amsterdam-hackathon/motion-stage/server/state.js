const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const mod=(n,m)=>((n%m)+m)%m;
const norm=v=>String(v??'').normalize('NFKC').trim().toLowerCase();
const bool=v=>v===true || v===1 || v==='1' || v==='true';
// v4 encodes non-ASCII metadata as octal character escapes, e.g. H\366r.
export const decodeMetadata=v=>String(v??'').replace(/\\([0-7]{3})/g,(_,oct)=>String.fromCharCode(parseInt(oct,8)));
const freshDeck=(id,now)=>({id,loaded:false,title:'',artist:'',album:'',trackId:'',duration:0,bpm:0,songBpm:0,playing:false,time:0,beat:0,bar:0,beatInBar:0,phase:0,barPhase:0,hasBarPhase:false,rate:1,artworkAvailable:false,artwork:null,anchor:now,lastSeen:null,seenTiming:false,revision:0,metadataAt:{}});
export class State {
  constructor(config, now=0) { this.config=config; this.decks=[freshDeck(1,now),freshDeck(2,now)]; this.crossfader=0; this.count=0; this.invalid=0; this.latest=new Map(); }
  clock(d,now) {
    const elapsed=d.playing ? Math.max(0,Math.min(now-d.anchor,this.config.staleSeconds)) : 0;
    return {time:d.time+elapsed*d.rate,beat:d.beat+elapsed*d.bpm/60};
  }
  ingest(address,args,now) {
    if(typeof address!=='string'||address.length>256) return false;
    this.count++;
    this.latest.delete(address); this.latest.set(address,{address,args:args.map(v=> typeof v==='string'?v.slice(0,500): ArrayBuffer.isView(v)?`[blob ${v.byteLength} bytes]`:v),at:now});
    if(this.latest.size>160) this.latest.delete(this.latest.keys().next().value);
    const raw=args[0], number=Number(raw), finite=raw!==null && raw!=='' && Number.isFinite(number);
    if(address===this.config.osc.crossfader) { if(finite) { const [a,b]=this.config.osc.crossfaderRange; this.crossfader=clamp((number-a)/(b-a),0,1); } return true; }
    for(const d of this.decks) {
      const prefix=this.config.osc.prefix.replace('{deck}',d.id);
      if(!address.startsWith(prefix)) continue;
      const field=Object.keys(this.config.osc.fields).find(k=>prefix+this.config.osc.fields[k]===address);
      if(!field) return false;
      d.lastSeen=now;
      const clock=this.clock(d,now); d.time=clock.time; d.beat=clock.beat; d.anchor=now;
      if(['title','artist','album','trackId'].includes(field)) {
        const value=decodeMetadata(raw).slice(0,1024);
        if(d[field]!==value && ['title','artist','trackId'].includes(field)) {
          d.artwork=null; d.revision++;
          if(field==='title' && d.title) {
            // Preserve metadata already delivered in this change burst, invalidate older fields.
            for(const key of ['artist','album','duration'])if(now-(d.metadataAt[key]??-Infinity)>.25)d[key]=key==='duration'?0:'';
            d.time=0;d.beat=0;d.bar=0;d.barPhase=0;d.hasBarPhase=false;d.seenTiming=false;
          }
        }
        d[field]=value; d.metadataAt[field]=now;
      } else if(field==='loaded') {
        if(!bool(raw)) Object.assign(d,freshDeck(d.id,now),{revision:d.revision+1,lastSeen:now});
        else d.loaded=true;
      } else if(field==='playing') d.playing=bool(raw);
      else if(field==='artworkAvailable') { d.artworkAvailable=bool(raw); if(!d.artworkAvailable)d.artwork=null; }
      else if(finite) {
        if(field==='time') { d.time=Math.max(0,number*this.config.osc.timeScale); d.seenTiming=true; }
        if(field==='bar')d.bar=number-this.config.osc.barBase;
        if(field==='beat')d.beatInBar=number-this.config.osc.beatBase;
        if(field==='phase')d.phase=clamp(number,0,1);
        if(field==='barPhase'){d.barPhase=clamp(number,0,this.config.beatsPerBar);d.hasBarPhase=true;}
        if(['bar','beat','phase','barPhase'].includes(field)) {d.beat=d.bar*this.config.beatsPerBar+(d.hasBarPhase?d.barPhase:d.beatInBar+d.phase);d.seenTiming=true;}
        if(field==='songBpm') {d.songBpm=clamp(number,0,400); if(!d.bpm)d.bpm=d.songBpm;}
        if(field==='bpm')d.bpm=clamp(number,0,400);
        if(field==='duration'){d.duration=Math.max(0,number);d.metadataAt.duration=now;}
        // Playback seconds advance at the tempo ratio; OSC time re-anchors every update.
        if(['songBpm','bpm'].includes(field)) d.rate=d.songBpm>0?d.bpm/d.songBpm:1;
      }
      return true;
    }
    return false;
  }
  snapshot(now) {return this.decks.map(d=>({...d,...this.clock(d,now),stale:d.lastSeen===null||now-d.lastSeen>this.config.staleSeconds}));}
}
export function selectAnimation(deck,entries,fallback) {
  if(deck.loaded) {
    const exact=entries.find(e=>e.mode==='track'&&e.match?.trackId&&String(e.match.trackId)===deck.trackId);
    if(exact)return exact;
    const matches=entries.filter(e=>e.mode==='track'&&e.match?.artist&&norm(e.match.artist)===norm(deck.artist)&&(e.match.titles??[]).some(t=>norm(t)===norm(deck.title)));
    if(matches.length===1)return matches[0];
  }
  return entries.find(e=>e.id===fallback&&e.mode==='fallback')??entries.find(e=>e.mode==='fallback');
}
export function animationTime(deck,entry,duration,beatsPerBar) {
  if(entry.mode==='fallback'){const start=entry.trimStart??0,end=entry.trimEnd??duration;return start+mod(deck.beat,entry.bars*beatsPerBar)/(entry.bars*beatsPerBar)*(end-start);}
  return clamp(deck.time+(entry.offsetSeconds??0),0,duration);
}

export function loopBlend(entry,time,duration){const start=entry.trimStart??0,end=entry.trimEnd??duration,fraction=entry.loopBlendFraction??0;if(entry.mode!=='fallback'||fraction<=0)return {time:null,weight:0};const blend=(end-start)*fraction;return {time:start,weight:Math.max(0,Math.min(1,(time-(end-blend))/blend))};}
