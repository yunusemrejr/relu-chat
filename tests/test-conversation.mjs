import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {interpretMessage,conversationalReply} from '../core/conversation.js';
import {SessionMemory} from '../core/session.js';
const bots=JSON.parse(fs.readFileSync(new URL('../data/manifest.json',import.meta.url))).bots;
test('casual language and stretched words have explicit conversational meaning',()=>{
 for(const [kind,queries] of Object.entries({greeting:['hey sup','heyyy','hiiii!','hey, what\'s up?','How are you?'],acknowledgement:['ok got it','okay, that makes sense!','👍'],thanks:['cool thanks','thank you!'],clarify:['what do you mean?','wdym','I don’t get it','???','wait what','can u explain that'],how:['howww','how does that work?'],why:['whyyyy?'],example:['give me an example','like what?'],farewell:['see ya','bye!']}))
  for(const query of queries)assert.equal(interpretMessage(query).kind,kind,query);
});
test('greetings and acknowledgments never swallow a real subject question',()=>{
 for(const [input,expected] of [['hey, explain Nash equilibrium','explain Nash equilibrium'],['ok got it, can you explain SARSA?','explain SARSA?'],['okay but what is PCA?','what is PCA?'],['pls compare Q-learning and SARSA','compare Q-learning and SARSA'],["what's matrix rank?",'what is matrix rank?']]){
  const result=interpretMessage(input);assert.equal(result.kind,'question',input);assert.equal(result.query,expected,input);
 }
 for(const query of ['not okay','I do not agree with Nash equilibrium','what do you mean by matrix rank?','hello world program','explain BAAAB and C++'])assert.equal(interpretMessage(query).kind,'question',query);
 assert.equal(interpretMessage('ok but howww?').kind,'how');
});
for(const bot of bots)test(bot.name+' retains topic through casual turns and grounds clarifications',async()=>{
 const {KB}=await import(new URL('../data/bots/'+bot.id+'/knowledge.js',import.meta.url));
 const session=new SessionMemory(30);
 function send(query){const result=conversationalReply(interpretMessage(query),session,KB,bot);assert.ok(result);session.addTurn(query,result.text,[],result.topics,[]);return result;}
 const missing=send('what do you mean?');assert.equal(missing.topics.length,0);assert.match(missing.text,/Which topic/);assert.equal(missing.showSuggestions,true);
 send('hey sup');assert.equal(session.lastTopic,null);
 const selected=KB.length-1;session.addTurn('explain '+KB[selected].name,KB[selected].f.def[0],[],[selected],[]);
 const acknowledged=send('ok got it');assert.equal(acknowledged.topics.length,0);assert.equal(session.lastTopic,selected);assert.ok(acknowledged.text.length<120);
 for(const query of ['what do you mean?','howww','give me an example','whyyyy?','short version']){
  const answer=send(query);assert.deepEqual(answer.topics,[selected]);assert.ok(answer.text.includes(KB[selected].name));
  assert.ok(Object.values(KB[selected].f).flat().some(fragment=>answer.text.includes(fragment)));assert.ok(!/undefined|NaN/.test(answer.text));
 }
 send('thanks');send('hey');assert.equal(session.lastTopic,selected);
 session.reset();assert.match(send('howww').text,/Which topic/);assert.equal(session.lastTopic,null);
});
