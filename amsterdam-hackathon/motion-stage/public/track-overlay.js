// Debounce split OSC metadata; use hysteresis so fader jitter cannot repeat a card.
export class TrackEntranceTracker {
  constructor(){this.mode=null;this.decks=new Map();this.active=null;}
  update(frame,now){
    if(this.mode!==frame.mode){this.mode=frame.mode;this.decks.clear();this.active=null;}
    const candidates=[];
    for(const deck of frame.decks){
      const weight=deck.id===1?1-frame.crossfader:frame.crossfader;
      const key=deck.loaded&&deck.title?.trim()?JSON.stringify([deck.trackId,deck.title,deck.artist]):'';
      let state=this.decks.get(deck.id);
      if(!state||state.key!==key){state={key,since:now,armed:true};this.decks.set(deck.id,state);}
      if(weight<=.02)state.armed=true;
      if(key&&state.armed&&deck.playing&&!deck.stale&&weight>=.08&&now-state.since>=300){
        candidates.push({deck,key,weight});state.armed=false;
      }
    }
    if(candidates.length){
      candidates.sort((a,b)=>b.weight-a.weight);
      const {deck,key}=candidates[0];this.active={deck,key,expiresAt:now+5000};
    }
    if(this.active){
      const deck=frame.decks.find(d=>d.id===this.active.deck.id);
      const state=deck&&this.decks.get(deck.id),weight=deck?.id===1?1-frame.crossfader:frame.crossfader;
      if(!deck||state.key!==this.active.key||weight<=.02||now>=this.active.expiresAt)this.active=null;
      else this.active.deck=deck; // Artwork can arrive after the entrance.
    }
    return this.active;
  }
}

export function trackReveal(fader){
  const value=Number.isFinite(fader)?Math.max(0,Math.min(1,fader)):0;
  return {artwork:Math.min(1,value*2),text:Math.max(0,value*2-1)};
}

function createTrackCard(stage){
  const card=document.createElement('div');card.className='track-entrance';card.setAttribute('role','status');card.setAttribute('aria-live','polite');card.setAttribute('aria-atomic','true');card.setAttribute('aria-hidden','true');
  const cover=document.createElement('div');cover.className='track-entrance-art';
  const fallback=document.createElement('span');fallback.textContent='♪';fallback.setAttribute('aria-hidden','true');
  const img=document.createElement('img');img.alt='Album artwork';img.hidden=true;cover.append(fallback,img);
  const copy=document.createElement('div');copy.className='track-entrance-copy';
  const title=document.createElement('strong'),artist=document.createElement('span');copy.append(title,artist);card.append(cover,copy);stage.append(card);
  let artwork='',announcement='',timer;
  const hide=()=>{card.classList.remove('visible');card.setAttribute('aria-hidden','true');};
  return {update(active,now){
    if(!active){hide();return;}
    const {deck}=active,id=JSON.stringify([deck.id,active.key,active.expiresAt]);
    if(id!==announcement){
      announcement=id;title.textContent=deck.title;artist.textContent=deck.artist||'Unknown artist';
      clearTimeout(timer);
      if(Number.isFinite(active.expiresAt))timer=setTimeout(hide,Math.max(0,active.expiresAt-now));
    }
    const reveal=trackReveal(active.manual?active.opacity:1);
    cover.style.opacity=String(reveal.artwork);
    cover.style.transform=`translateY(${(1-reveal.artwork)*32}px)`;
    copy.style.opacity=String(reveal.text);
    copy.style.transform=`translateX(${(1-reveal.text)*-24}px)`;
    copy.style.visibility=reveal.text>0?'visible':'hidden';
    copy.setAttribute('aria-hidden',String(reveal.text===0));
    card.classList.toggle('manual',!!active.manual);
    card.classList.toggle('deck-b',deck.id===2);
    const url=deck.artwork||'';
    if(url!==artwork){
      artwork=url;img.hidden=true;fallback.hidden=false;img.removeAttribute('src');
      if(url){img.onload=()=>{if(artwork===url){img.hidden=false;fallback.hidden=true;}};img.onerror=()=>{img.hidden=true;fallback.hidden=false;};img.src=url;}
    }
    card.classList.add('visible');card.setAttribute('aria-hidden','false');
  }};
}

// Once either OSC fader is received, both cards are controlled manually. No
// transport, crossfader, entrance debounce or expiry can hide a raised card.
export function manualTrackCards(frame){
  if(!frame.decks.some(deck=>Number.isFinite(deck.oscControls?.artwork?.at)))return null;
  return frame.decks.filter(deck=>Number.isFinite(deck.oscControls?.artwork?.at)&&deck.loaded&&deck.title?.trim()&&(deck.artworkOpacity??0)>0)
    .map(deck=>({deck,key:JSON.stringify([deck.trackId,deck.title,deck.artist]),manual:true,opacity:Math.max(0,Math.min(1,deck.artworkOpacity)),expiresAt:Infinity}));
}

export function createTrackOverlay(stage){
  const tracker=new TrackEntranceTracker(),cards=[createTrackCard(stage),createTrackCard(stage)];
  return {update(frame){
    const now=performance.now(),manual=manualTrackCards(frame);
    if(manual!==null){
      // Reset automatic entrance state while the OSC controls own visibility.
      tracker.mode=null;
      for(const [index,card]of cards.entries())card.update(manual.find(active=>active.deck.id===index+1),now);
    }else{
      cards[0].update(tracker.update(frame,now),now);cards[1].update(null,now);
    }
  }};
}
