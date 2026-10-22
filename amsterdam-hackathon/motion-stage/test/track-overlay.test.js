import test from 'node:test';
import assert from 'node:assert/strict';
import {TrackEntranceTracker,manualTrackCards,trackReveal} from '../public/track-overlay.js';
const deck=(id,extra={})=>({id,loaded:true,title:`Track ${id}`,artist:`Artist ${id}`,playing:true,stale:false,...extra});
const frame=(fader=0,a={},b={},mode='live')=>({mode,crossfader:fader,decks:[deck(1,a),deck(2,b)]});
test('muted deck loading stays silent; incoming track displays for five seconds',()=>{
 const t=new TrackEntranceTracker();assert.equal(t.update(frame(),0),null);
 assert.equal(t.update(frame(),300).deck.id,1);
 assert.equal(t.update(frame(),5300),null);
 assert.equal(t.update(frame(.04),5400),null);
 const card=t.update(frame(.1),5500);assert.equal(card.deck.id,2);assert.equal(card.expiresAt,10500);
 assert.equal(t.update(frame(.6),8000).expiresAt,10500);
 assert.equal(t.update(frame(.6),10500),null);
});
test('fader jitter does not repeat; fading fully out rearms the entrance',()=>{
 const t=new TrackEntranceTracker();t.update(frame(),0);t.update(frame(),300);t.update(frame(.1),400);
 assert.equal(t.update(frame(.07),5500),null);assert.equal(t.update(frame(.09),5600),null);
 t.update(frame(.01),5700);assert.equal(t.update(frame(.09),5800).deck.id,2);
});
test('split metadata settles; late artwork updates without extending the card',()=>{
 const t=new TrackEntranceTracker();t.update(frame(0,{title:'New',artist:''}),0);
 assert.equal(t.update(frame(0,{title:'New',artist:'New artist'}),200),null);
 assert.equal(t.update(frame(0,{title:'New',artist:'New artist'}),499),null);
 const card=t.update(frame(0,{title:'New',artist:'New artist'}),500);assert.equal(card.deck.artist,'New artist');
 const art=t.update(frame(0,{title:'New',artist:'New artist',artwork:'/new.jpg'}),900);assert.equal(art.deck.artwork,'/new.jpg');assert.equal(art.expiresAt,5500);
 assert.equal(t.update(frame(0,{loaded:false}),1000),null);
});
test('paused/stale tracks do not announce; mode changes reset identity',()=>{
 const t=new TrackEntranceTracker();t.update(frame(0,{playing:false}),0);
 assert.equal(t.update(frame(0,{playing:false}),1000),null);
 assert.equal(t.update(frame(0,{stale:true}),1100),null);
 assert.equal(t.update(frame(),1200).deck.id,1);
 assert.equal(t.update(frame(1,{}, {},'demo'),1300),null);
 assert.equal(t.update(frame(1,{}, {},'demo'),1600).deck.id,2);
});
test('replacing a track on a visible deck clears old metadata and announces the replacement',()=>{
 const t=new TrackEntranceTracker();t.update(frame(),0);t.update(frame(),300);
 assert.equal(t.update(frame(0,{title:'Replacement'}),400),null);
 assert.equal(t.update(frame(0,{title:'Replacement'}),700).deck.title,'Replacement');
});

test('OSC faders override automatic card timing and independently control whole cards',()=>{
 assert.equal(manualTrackCards(frame()),null);
 const controlled=(opacity,at=0)=>({artworkOpacity:opacity,oscControls:{artwork:{at}}});
 let cards=manualTrackCards(frame(1,{...controlled(.4),playing:false,stale:true},controlled(.7)));
 assert.deepEqual(cards.map(c=>[c.deck.id,c.opacity,c.expiresAt]),[[1,.4,Infinity],[2,.7,Infinity]]);
 assert.ok(cards.every(c=>c.manual));
 cards=manualTrackCards(frame(0,controlled(0),controlled(1)));
 assert.deepEqual(cards.map(c=>c.deck.id),[2]);
 assert.deepEqual(manualTrackCards(frame(0,controlled(0),controlled(0))),[]);
 assert.deepEqual(manualTrackCards(frame(0,{...controlled(1),loaded:false},{...controlled(1),title:''})),[]);
 assert.deepEqual(manualTrackCards(frame(0,controlled(.5),{})).map(c=>c.deck.id),[1]);
});

test('fader reveals artwork in the first half and text in the second, in both directions',()=>{
 for(const [value,artwork,text] of [[0,0,0],[.25,.5,0],[.5,1,0],[.75,1,.5],[1,1,1],[.75,1,.5],[.5,1,0],[.25,.5,0],[0,0,0]]){
  assert.deepEqual(trackReveal(value),{artwork,text});
 }
 assert.deepEqual(trackReveal(-1),{artwork:0,text:0});
 assert.deepEqual(trackReveal(2),{artwork:1,text:1});
 assert.deepEqual(trackReveal(NaN),{artwork:0,text:0});
});
