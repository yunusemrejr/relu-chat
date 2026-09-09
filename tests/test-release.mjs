import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {tokens,bowVec,DEFAULT_INTENTS,composeV2} from '../core/nlp.js';
import {SignalLayer} from '../core/signal-layer.js';
import {SessionMemory} from '../core/session.js';
import {loadPolicyRuntime,planAnswer,getPolicyStatus} from '../policy/policy-runtime.js';
import {MLPPolicy} from '../policy/mlp-inference.js';
const root=new URL('../',import.meta.url);
const originalFetch=globalThis.fetch;
globalThis.fetch=async url=>{
 const target=new URL(String(url).replace(/^\//,''),root);
 try{return new Response(fs.readFileSync(target),{status:200});}catch{return new Response('',{status:404});}
};
await loadPolicyRuntime();
const bots=JSON.parse(fs.readFileSync(new URL('data/manifest.json',root))).bots;
const prompts={
 'game-theory-chat':['What is Nash equilibrium?','nash_eq','Explain the Shapley value','shapley'],
 'golden-age-inquiry':['Tell me about Ibn al-Haytham','ibn_al_haytham','Explain Al-Biruni','al_biruni'],
 'data-science-chat':['What is logistic regression?','logistic_regression','Explain cross-validation','cross_validation'],
 'reinforcement-learning-chat':['What is Q-learning?','q-learning','Explain SARSA','sarsa'],
 'linear-algebra-chat':['What is a dot product?','dot-product','Explain matrix rank','matrix-rank'],
 'web-platform-chat':['What is WebAssembly?','webassembly','Explain IndexedDB','indexeddb'],
};
for(const bot of bots)test(bot.name+' real retrieval, composition, follow-up and topic switch',async()=>{
 const {KB,entryText}=await import(new URL('data/bots/'+bot.id+'/knowledge.js',root));
 const {overrides}=await import(new URL('data/bots/'+bot.id+'/overrides.js',root));
 assert.equal(KB.length,bot.topic_count);assert.equal(new Set(KB.map(e=>e.id)).size,KB.length);
 for(const entry of KB)for(const category of ['def','int','ex','form','app'])assert.ok(entry.f[category].length>0,entry.id+': '+category);
 const voc=new Set(KB.flatMap(e=>tokens(entryText(e))));for(const intent of Object.values(DEFAULT_INTENTS))for(const proto of intent.prototypes)for(const word of tokens(proto))voc.add(word);
 const vocab=new Map([...voc].map((w,i)=>[w,i]));const embed=t=>bowVec(t,vocab);
 const entries=KB.map(e=>embed(entryText(e)));const intents=Object.fromEntries(Object.entries(DEFAULT_INTENTS).map(([key,v])=>[key,v.prototypes.map(embed)]));
 const session=new SessionMemory(30),signal=new SignalLayer();signal.initBM25(KB);
 const config={INTENTS:DEFAULT_INTENTS,THRESHOLDS:{},botProfile:{id:bot.id,maxTopics:2,creativityCeiling:.2}};
 async function ask(query){
  const q=embed(query);const dp=await signal.process(query,q,entries,intents,KB,config,session);
  const context={entities:dp.entities,intent:dp.intent.name,intentScores:dp.intent.rawScores,ranked:dp.rankings.reranked,entryEmb:entries,lastTopic:session.lastTopic,lastTopicAge:session.lastTopicAge,followUp:dp.session.followUp,overrides};
  const plan=await planAnswer(query,q,KB,context,config);const result=await composeV2(query,q,async t=>embed(t),entries,intents,session.lastTopic,KB,config,overrides,plan);
  assert.ok(result.text.length>15);assert.ok(!/undefined|NaN|\[object Object\]/.test(result.text));
  session.addTurn(query,result.text,dp.entities,plan.topics,[],q);return{plan,result,dp};
 }
 const [q,id,next,nextId]=prompts[bot.id];
 const first=await ask(q);assert.equal(KB[first.plan.topics[0]]?.id,id,JSON.stringify(first.plan));
 assert.ok(first.result.text.includes(KB[first.plan.topics[0]].summary),'A new subject starts with its overview');
 const follow=await ask('Give an example');assert.equal(KB[follow.plan.topics[0]]?.id,id);assert.equal(follow.plan.intent,'example');
 const switched=await ask(next);assert.equal(KB[switched.plan.topics[0]]?.id,nextId);
 assert.ok(switched.result.text.includes(KB[switched.plan.topics[0]].summary),'Switching subjects introduces the new overview');
 session.reset();const social=await ask('hello');assert.equal(social.plan.mode,'greeting');assert.equal(social.plan.topics.length,0);
 const help=await ask('help');assert.equal(help.plan.mode,'help');
 session.reset();const unknown=await ask('Book me a taxi to the airport');assert.equal(unknown.plan.mode,'off_topic',bot.id+': '+unknown.result.text);
});
test('exported model numerical parity and fixed-memory WASM',async()=>{
 const {weights}=JSON.parse(fs.readFileSync(new URL('assets/models/policy/policy.weights.json',root)));
 const model=new MLPPolicy(weights);await model.attachWasm(fs.readFileSync(new URL('assets/models/policy/policy.wasm',root)));
 assert.equal(model._wasm.memory.buffer.byteLength,131072);
 for(const row of JSON.parse(fs.readFileSync(new URL('tests/fixtures/policy-v2-parity.json',root)))){
  const x=Float32Array.from(row.x);const js=model.forward(x),wasm=model.forwardWasm(x);
  for(const head of ['modeProbs','intentProbs','topicCountProbs','fragCountProbs','toneProbs'])for(let i=0;i<js[head].length;i++)assert.ok(Math.abs(js[head][i]-wasm[head][i])<1e-6);
 }
 assert.throws(()=>model.forwardWasm(new Float32Array(24)),/Invalid policy/);
});
