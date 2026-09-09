import fs from 'node:fs';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {MLPPolicy} from '../../policy/mlp-inference.js';
const path='dev/exports/fast-policy/';
const payload=JSON.parse(fs.readFileSync(path+'policy.weights.json'));
const model=new MLPPolicy(payload.weights);
const fixtures=JSON.parse(fs.readFileSync(path+'parity-fixtures.json'));
const mapping={mode:'modeProbs',intent:'intentProbs',topic_count:'topicCountProbs',frag_count:'fragCountProbs',tone:'toneProbs'};
let maxExportError=0,maxWasmError=0;
await model.attachWasm(fs.readFileSync('assets/models/policy/policy.wasm'));
for(const row of fixtures){
 const x=Float32Array.from(row.x);const js=model.forward(x),wasm=model.forwardWasm(x);
 for(const [head,name] of Object.entries(mapping))for(let i=0;i<js[name].length;i++){
  maxExportError=Math.max(maxExportError,Math.abs(js[name][i]-row.probs[head][i]));
  maxWasmError=Math.max(maxWasmError,Math.abs(js[name][i]-wasm[name][i]));
 }
}
assert.ok(maxExportError<1e-5,'Python/JS export parity');assert.ok(maxWasmError<1e-6,'JS/WASM parity');
for(let i=0;i<500;i++){model.forward(Float32Array.from(fixtures[i%fixtures.length].x));model.forwardWasm(Float32Array.from(fixtures[i%fixtures.length].x));}
function benchmark(method){const times=[];for(let i=0;i<3000;i++){const x=Float32Array.from(fixtures[i%fixtures.length].x);const start=performance.now();model[method](x);times.push((performance.now()-start)*1000);}times.sort((a,b)=>a-b);return {median_us:times[1500],p95_us:times[2850]};}
const result={fixtures:fixtures.length,maxExportError,maxWasmError,js:benchmark('forward'),wasm:benchmark('forwardWasm'),wasmBytes:fs.statSync('assets/models/policy/policy.wasm').size,node:process.version};
fs.writeFileSync(path+'parity-benchmark.json',JSON.stringify(result,null,2)+'\n');console.log(result);
