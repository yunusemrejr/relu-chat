import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {tokens,bowVec,DEFAULT_INTENTS} from '../../core/nlp.js';
import {SignalLayer} from '../../core/signal-layer.js';
import {SessionMemory} from '../../core/session.js';
import {extractPolicyFeatures} from '../../policy/feature-extractor.js';
const bots=JSON.parse(fs.readFileSync('data/manifest.json')).bots;
const names=['qSimTop1','qSimTop2','entityCount','entityBoostHit','intentDefScore','intentExScore','intentFormScore','intentAppScore','intentCompScore','lastTopicSim','lastTopicAge','kbCoverage','queryLenTokens','hasComparisonCue','hasFormalCue','hasExampleCue','botCreativity','domainMatch','followUpType','wasAmbiguous','avgTruthConf','avgSourceConf','minDifficulty','fragDiversity','avoidWithCount'];
const trainTemplates=[['What is {x}?',0],['Explain {x}',0],['Give an example of {x}',1],['Illustrate {x}',1],['Formal definition of {x}',2],['Equation for {x}',2],['Applications of {x}',3],['Where is {x} used?',3],['Compare {x} and {y}',4],['{x} vs {y}',4]];
const heldTemplates=[['Help me understand {x}',0],['Describe {x}',0],['A worked example of {x}',1],['Demonstrate {x}',1],['Show the math behind {x}',2],['Derive a formula for {x}',2],['Practical uses of {x}',3],['Why is {x} useful?',3],['What is the difference between {x} and {y}?',4],['Distinguish {x} from {y}',4]];
const rows=[];
for(const bot of bots){
 const {KB,entryText}=await import(pathToFileURL(process.cwd()+'/data/bots/'+bot.id+'/knowledge.js'));
 const vocabulary=new Set(KB.flatMap(e=>tokens(entryText(e))));
 for(const v of Object.values(DEFAULT_INTENTS))for(const t of v.prototypes)for(const word of tokens(t))vocabulary.add(word);
 const vocab=new Map([...vocabulary].map((w,i)=>[w,i])); const embed=t=>bowVec(t,vocab);
 const entryEmb=KB.map(e=>embed(entryText(e)));const intentEmb=Object.fromEntries(Object.entries(DEFAULT_INTENTS).map(([k,v])=>[k,v.prototypes.map(embed)]));
 const signal=new SignalLayer();signal.initBM25(KB);
 const profile={id:bot.id,creativityCeiling:0.2,maxTopics:2};const config={INTENTS:DEFAULT_INTENTS,THRESHOLDS:{},botProfile:profile};
 async function add(query,intent,mode,split,topic,follow=false){
  const session=new SessionMemory(30);
  if(follow)session.addTurn('Explain '+KB[topic].name,'Prior explanation',[topic],[topic],[],entryEmb[topic]);
  const q=embed(query);const dp=await signal.process(query,q,entryEmb,intentEmb,KB,config,session);
  const f=extractPolicyFeatures(query,q,dp.rankings.reranked,dp.entities,dp.intent.rawScores,session.lastTopic,session.lastTopicAge,KB,config,entryEmb,dp.session.followUp,false);
  rows.push({query,bot:bot.id,topic:topic===null?null:KB[topic].id,split,x:names.map(n=>Number(f[n])||0),targets:{mode,intent,topic_count:intent===4?1:0,frag_count:intent===2?2:1,tone:intent===2?1:0},expectedTopic:topic,topTopic:dp.rankings.reranked[0]?.i});
 }
 for(let i=0;i<KB.length;i++){
  const split=i%7===0?'test':i%7===1?'validation':'train';
  for(const [template,intent] of split==='train'?trainTemplates:heldTemplates){
   await add(template.replace('{x}',KB[i].name).replace('{y}',KB[(i+1)%KB.length].name),intent,intent===4?4:0,split,i);
  }
  await add(split==='train'?'Give another example':'A worked example please',1,0,split,i,true);
  await add(split==='train'?'Go deeper':'Explain that further',0,0,split,i,true);
 }
 for(const [split,queries] of Object.entries({train:['buy a pizza','weather tomorrow','write a poem','book a flight','football score'],validation:['recommend a restaurant','latest celebrity news'],test:['find me a taxi','what is the weather in Tokyo','write my shopping list']}))for(const q of queries)await add(q,0,1,split,null);
 console.log(bot.id,'features prepared');
}
fs.writeFileSync('dev/datasets/policy-runtime-v2.json',JSON.stringify({schema:'0.5.0',features:names,rows}));
console.log(rows.length,'runtime-derived cases; split by topic and question template.');
