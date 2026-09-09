import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {validEmbeddings} from '../core/embedding-store.js';
function worker({offline=false,quota=false,unavailable=false}={}) {
 const handlers={},stores=new Map(),calls=[];
 const key=r=>typeof r==='string'?new URL(r,'https://relu.chat').href:r.url;
 const caches={async open(name){if(unavailable)throw new Error('unavailable');if(!stores.has(name))stores.set(name,new Map());const data=stores.get(name);return{async match(r){return data.get(key(r))?.clone();},async put(r,response){if(quota)throw new Error('quota');data.set(key(r),response.clone());}};},async keys(){return [...stores.keys()];},async delete(name){return stores.delete(name);}};
 vm.runInNewContext(readFileSync(new URL('../sw.js',import.meta.url),'utf8'),{URL,Response,AbortController,setTimeout,clearTimeout,caches,self:{location:{origin:'https://relu.chat'},addEventListener:(event,fn)=>handlers[event]=fn,skipWaiting:async()=>{},clients:{claim:async()=>{}}},fetch:async request=>{calls.push(key(request));if(offline)throw new Error('offline');return new Response('network '+key(request));}});
 const request=(path,extra={})=>({url:new URL(path,'https://relu.chat').href,method:'GET',mode:'cors',headers:new Headers(),...extra});
 const dispatch=(path,extra)=>{let result;handlers.fetch({request:request(path,extra),respondWith:p=>result=p});return result;};
 const run=event=>{let done;handlers[event]({waitUntil:p=>done=p});return done;};
 return{stores,calls,caches,dispatch,run};
}
test('install is light; activation preserves model cache and unrelated caches',async()=>{
 const w=worker();await w.run('install');assert.equal(w.calls.length,6);assert.ok(w.calls.every(u=>!u.includes('/assets/models/')&&!u.includes('/assets/transformers/')));
 await w.caches.open('relu-chat-v13');await w.caches.open('relu-chat-models-v13');await w.caches.open('another-app');await w.run('activate');
 assert.deepEqual([...w.stores.keys()].sort(),['another-app','relu-chat-models-v13','relu-chat-v14']);
});
test('navigation returns cached page or an explicit offline page',async()=>{
 const w=worker({offline:true}),cache=await w.caches.open('relu-chat-v14');await cache.put('/chat/',new Response('chat directory'));await cache.put('/errors/offline.html',new Response('Reconnect to open this page'));
 assert.equal(await(await w.dispatch('/chat/',{mode:'navigate'})).text(),'chat directory');
 assert.equal(await(await w.dispatch('/unvisited/',{mode:'navigate'})).text(),'Reconnect to open this page');
});
test('mutable policy revalidates, model bytes are reusable offline',async()=>{
 const w=worker(),cache=await w.caches.open('relu-chat-v14');await cache.put('/policy.manifest.json',new Response('old manifest'));
 assert.match(await(await w.dispatch('/policy.manifest.json')).text(),/^network/);
 const off=worker({offline:true}),model=await off.caches.open('relu-chat-models-v13');await model.put('/assets/models/all-MiniLM-L6-v2/onnx/model_quantized.onnx',new Response('model bytes'));
 assert.equal(await(await off.dispatch('/assets/models/all-MiniLM-L6-v2/onnx/model_quantized.onnx')).text(),'model bytes');assert.equal(off.calls.length,0);
});
test('API, writes, cross-origin, and range requests bypass caching',()=>{
 const w=worker();assert.equal(w.dispatch('/api/subscribe.php'),undefined);assert.equal(w.dispatch('/x.json',{method:'POST'}),undefined);assert.equal(w.dispatch('https://other.example/x.js'),undefined);assert.equal(w.dispatch('/model.bin',{headers:new Headers({range:'bytes=0-100'})}),undefined);assert.equal(w.calls.length,0);
});
test('quota or unavailable storage retains successful network responses',async()=>{
 for(const options of [{quota:true},{unavailable:true}]){
  const w=worker(options);for(const path of ['/core/chatbot-engine.js','/assets/models/all-MiniLM-L6-v2/config.json'])assert.match(await(await w.dispatch(path)).text(),/^network/);
 }
});
test('corrupt embedding cache is rejected before a backend switch',()=>{
 const intents={definition:{prototypes:['define']}};const good={entries:[Array(384).fill(.1)],intents:{definition:[Array(384).fill(.2)]}};
 assert.equal(validEmbeddings(good,1,intents),true);assert.equal(validEmbeddings({},1,intents),false);assert.equal(validEmbeddings(good,2,intents),false);
 good.intents.definition[0][10]=NaN;assert.equal(validEmbeddings(good,1,intents),false);
});
