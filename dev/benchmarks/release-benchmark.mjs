import fs from 'node:fs';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {BM25Scorer as Before} from './baselines/bm25-2026-09.js';
import {BM25Scorer as After} from '../../core/bm25.js';
import {KB,entryText} from '../../data/bots/game-theory-chat/knowledge.js';
const docs=KB.map(entryText),before=new Before().fit(docs),after=new After().fit(docs);
const queries=KB.slice(0,30).map(e=>'Explain '+e.name);
for(const q of queries)assert.deepEqual(after.scoreTopK(q,20),before.scoreTopK(q,20));
function bench(model){for(const q of queries)model.scoreTopK(q,20);const samples=[];for(let run=0;run<5;run++)for(const q of queries){const t=performance.now();model.scoreTopK(q,20);samples.push(performance.now()-t);}samples.sort((a,b)=>a-b);return{median_ms:samples[75],p95_ms:samples[142]};}
const old=bench(before),current=bench(after);const result={runtime:process.version,corpus_entries:docs.length,queries:queries.length,samples:150,old,current,median_speedup:old.median_ms/current.median_ms,ranking_parity:true};
fs.writeFileSync('dev/exports/fast-policy/retrieval-benchmark.json',JSON.stringify(result,null,2)+'\n');console.log(result);
