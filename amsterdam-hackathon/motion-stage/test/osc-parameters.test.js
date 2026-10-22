import test from 'node:test';
import assert from 'node:assert/strict';
import {ParameterStore} from '../server/parameters.js';
import {OscParameterRouter} from '../server/osc-parameters.js';

test('C/D line faders control separate artwork opacity with unipolar values',()=>{
  const params=new ParameterStore();let scene='rumble';const router=new OscParameterRouter(params,()=>scene);
  assert.equal(router.snapshot(1).artwork.normalized,1);
  assert.equal(router.snapshot(2).artwork.normalized,1);
  for(const value of [0,.25,.5,1]){
    assert.equal(router.ingest('/djay/mixer/turntable3/lineFader',[value],10),true);
    assert.equal(router.snapshot(1).artwork.normalized,value);
    assert.equal(router.snapshot(2).artwork.normalized,1);
  }
  router.ingest('/djay/mixer/turntable4/lineFader',[.3],11);
  assert.equal(router.snapshot(2).artwork.normalized,.3);
  assert.equal(router.snapshot(1).artwork.normalized,1);
  assert.equal(params.get(1,'rumble').characterOpacity,1);
  scene='cyan';router.sync();assert.equal(router.snapshot(2).artwork.normalized,.3);
  for(const [raw,expected] of [[-2,0],[2,1]]){
    router.ingest('/djay/mixer/turntable3/lineFader',[raw],12);
    assert.equal(router.snapshot(1).artwork.normalized,expected);
  }
  for(const args of [[NaN],[Infinity],['0'],[],[null],[0,1]])assert.throws(()=>router.ingest('/djay/mixer/turntable3/lineFader',args,13));
  assert.equal(router.snapshot(1).artwork.normalized,1);
  assert.equal(router.snapshot(2).artwork.at,11);
  assert.equal(router.ingest('/djay/mixer/turntable1/lineFader',[0],14),false);
});

test('C/D EQ controls A/B opacity, rate, speed with bipolar normalization and isolation',()=>{
  const params=new ParameterStore(),router=new OscParameterRouter(params,()=> 'rumble');
  for(const [source,target] of [[3,1],[4,2]]){
    router.ingest(`/djay/mixer/turntable${source}/eq/low`,[-1],1);
    router.ingest(`/djay/mixer/turntable${source}/eq/mid`,[0],2);
    router.ingest(`/djay/mixer/turntable${source}/eq/high`,[1],3);
    assert.equal(params.get(target,'rumble').characterOpacity,0);
    assert.equal(params.get(target,'rumble').particleRate,400);
    assert.equal(params.get(target,'rumble').particleSpeed,3);
    assert.equal(params.get(target,'rumble').particleSize,.035);
    if(source===3)assert.equal(params.get(2,'rumble').characterOpacity,1);
  }
  router.ingest('/djay/mixer/turntable3/eq/low',[2],4);
  assert.equal(params.get(1,'rumble').characterOpacity,1);
  assert.equal(router.snapshot(2).bands.high.at,3);
  assert.equal(router.snapshot(2).sourceDeck,4);
});
test('unmapped controls do nothing; invalid EQ does not corrupt state',()=>{
  const params=new ParameterStore(),router=new OscParameterRouter(params,()=> 'rumble');
  for(const path of ['/djay/mixer/turntable1/eq/low','/djay/mixer/turntable2/eq/mid','/djay/mixer/turntable3/gain','/djay/mixer/turntable4/filter'])assert.equal(router.ingest(path,[-1],0),false);
  for(const args of [[NaN],['0'],[],[null],[0,1]])assert.throws(()=>router.ingest('/djay/mixer/turntable3/eq/low',args,0));
  assert.equal(params.get(1,'rumble').characterOpacity,1);
});
test('EQ is retained for scene switches; repeated packets do not override manual controls',()=>{
  const params=new ParameterStore();let scene='cyan';const router=new OscParameterRouter(params,()=>scene);
  router.ingest('/djay/mixer/turntable3/eq/low',[-.5],1);
  router.ingest('/djay/mixer/turntable3/eq/mid',[.5],1);
  assert.equal(params.get(1,'cyan').characterOpacity,.25);
  assert.equal(router.snapshot(1).bands.mid.supported,false);
  scene='rumble';router.sync();
  assert.equal(params.get(1,'rumble').characterOpacity,.25);
  assert.equal(params.get(1,'rumble').particleRate,600);
  params.set(1,'rumble',{characterOpacity:.9});
  router.ingest('/djay/mixer/turntable3/eq/low',[-.5],2);
  router.sync();assert.equal(params.get(1,'rumble').characterOpacity,.9);
  router.ingest('/djay/mixer/turntable3/eq/low',[0],3);
  assert.equal(params.get(1,'rumble').characterOpacity,.5);
});

test('First of the Year high EQ is bipolar camera speed with a stopped center; Rumble keeps particle speed',()=>{
  const params=new ParameterStore();let scene='first-of-year';const router=new OscParameterRouter(params,()=>scene);
  assert.equal(params.get(1,scene).cameraOrbitSpeed,0);
  for(const [raw,speed] of [[-1,-60],[-.5,-30],[0,0],[.5,30],[1,60]]){
    router.ingest('/djay/mixer/turntable3/eq/high',[raw],1);assert.equal(params.get(1,scene).cameraOrbitSpeed,speed);
  }
  assert.equal(router.snapshot(1).bands.high.parameter,'cameraOrbitSpeed');
  assert.equal(params.get(2,scene).cameraOrbitSpeed,0);
  router.ingest('/djay/mixer/turntable4/eq/high',[-1],2);assert.equal(params.get(2,scene).cameraOrbitSpeed,-60);
  scene='rumble';router.sync();assert.equal(params.get(1,scene).particleSpeed,3);
  assert.equal(router.snapshot(1).bands.high.parameter,'particleSpeed');
  scene='first-of-year';router.sync();assert.equal(params.get(1,scene).cameraOrbitSpeed,60);
});
