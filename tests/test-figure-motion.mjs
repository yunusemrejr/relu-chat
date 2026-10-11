import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

// Browser-policy regression harness. Geometry/pixels are reviewed in real
// browsers; these tests exercise visibility and preference transitions.
function setup({reduced=false,storedPause=false,nativeAnimation=true}={}) {
  const handlers={},windowHandlers={},animations=[],observers=[];
  const storage=new Map(storedPause?[['relu-motion-paused','1']]:[]);
  const media={matches:reduced,addEventListener:(_,fn)=>media.change=fn};
  const toggle={attrs:{},addEventListener:(_,fn)=>toggle.click=fn,setAttribute:(k,v)=>toggle.attrs[k]=v,getAttribute:k=>toggle.attrs[k]};
  const replay={addEventListener:(_,fn)=>replay.click=fn,closest:()=>figure};
  const agent={getAttribute:()=> '0,0;30,15;60,0',style:{getPropertyValue:()=>''}};
  if(nativeAnimation)agent.animate=(frames,timing)=>{
    const a={frames,timing,playState:'running',play(){this.playState='running';},pause(){this.playState='paused';},cancel(){this.playState='idle';this.cancelled=true;},effect:{updateTiming(t){Object.assign(timing,t);}}};
    animations.push(a);return a;
  };
  const figure={querySelector:s=>s==='.i-agent'?agent:null,querySelectorAll:()=>[],contains:el=>el===figure};
  const document={hidden:false,documentElement:{classList:{add(){}}},
    querySelectorAll:s=>s==='[data-motion-toggle]'?[toggle]:s==='[data-motion-replay]'?[replay]:s==='[data-motion-figure]'?[figure]:[],
    addEventListener:(e,fn)=>handlers[e]=fn,dispatchEvent:e=>handlers[e.type]?.(e)};
  class IntersectionObserver {constructor(fn){this.fn=fn;observers.push(this);}observe(){} }
  const window={matchMedia:()=>media,addEventListener:(e,fn)=>windowHandlers[e]=fn,IntersectionObserver};
  const localStorage={getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)};
  vm.runInNewContext(readFileSync(new URL('../assets/js/figures.js',import.meta.url),'utf8'),{window,document,localStorage,IntersectionObserver,CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}}});
  return {animations,toggle,replay,storage,document,
    visible(value,ratio=value?1:0){observers[0].fn([{target:figure,isIntersecting:value,intersectionRatio:ratio}]);},
    hidden(value){document.hidden=value;handlers.visibilitychange();},
    reduce(value){media.matches=value;media.change();},
    pagehide(){windowHandlers.pagehide();},pageshow(){windowHandlers.pageshow();}};
}

test('offscreen figures allocate no animation; leaving view suspends the timeline',()=>{
  const h=setup();assert.equal(h.animations.length,0);
  h.visible(true,.05);assert.equal(h.animations.length,0);
  h.visible(true);assert.equal(h.animations.length,1);assert.equal(h.animations[0].playState,'running');
  h.visible(true,.1);assert.equal(h.animations[0].playState,'paused');
  h.visible(false);assert.equal(h.animations[0].playState,'paused');
  h.visible(true);assert.equal(h.animations.length,1);assert.equal(h.animations[0].playState,'running');
});
test('page visibility and back/forward lifecycle suspend and resume existing tracks',()=>{
  const h=setup();h.visible(true);h.hidden(true);assert.equal(h.animations[0].playState,'paused');
  h.hidden(false);assert.equal(h.animations[0].playState,'running');
  h.pagehide();assert.equal(h.animations[0].playState,'paused');h.pageshow();assert.equal(h.animations[0].playState,'running');
});
test('pause is persistent, immediately suspends motion and disables replay',()=>{
  const h=setup();h.visible(true);h.toggle.click();
  assert.equal(h.animations[0].playState,'paused');assert.equal(h.storage.get('relu-motion-paused'),'1');assert.equal(h.replay.disabled,true);
  h.toggle.click();assert.equal(h.animations[0].playState,'running');assert.equal(h.replay.disabled,false);
  const initial=setup({storedPause:true});initial.visible(true);assert.equal(initial.animations.length,0);
});
test('reduced motion is static at load and cancels tracks when changed at runtime',()=>{
  const h=setup({reduced:true});h.visible(true);assert.equal(h.animations.length,0);assert.equal(h.replay.disabled,true);
  h.reduce(false);assert.equal(h.animations.length,1);assert.equal(h.animations[0].playState,'running');
  h.reduce(true);assert.equal(h.animations[0].cancelled,true);assert.equal(h.toggle.disabled,true);
});
test('rapid replay cancels obsolete tracks; completed tracks never restart on scroll',()=>{
  const h=setup();h.visible(true);h.replay.click();h.replay.click();
  assert.equal(h.animations.length,3);assert.ok(h.animations[0].cancelled&&h.animations[1].cancelled);
  h.animations[2].playState='finished';h.visible(false);h.visible(true);assert.equal(h.animations[2].playState,'finished');
  assert.equal(h.animations[2].timing.easing,'linear');assert.equal(h.animations[2].timing.iterations,undefined);
});
test('missing Web Animations support preserves the static SVG without throwing',()=>{
  const h=setup({nativeAnimation:false});assert.doesNotThrow(()=>h.visible(true));assert.equal(h.animations.length,0);
});
