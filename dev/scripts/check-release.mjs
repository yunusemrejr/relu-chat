import {spawnSync} from 'node:child_process';
import {readdirSync, mkdirSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const tests=readdirSync(new URL('../../tests/',import.meta.url)).filter(n=>/^test-.*\.(?:m?js|py)$/.test(n)).sort();
const commands=[...tests.map(n=>[n.endsWith('.py')?'python3':process.execPath,'tests/'+n]),
 ...['test-policy-runtime.js','test-signal-layer.js','test-quality.js'].map(n=>[process.execPath,'dev/scripts/'+n]),
 [process.execPath,'scripts/blog/validate.js'],['python3','dev/scripts/check-site.py']];
const records=[];
for(const [command,...args] of commands){
 const run=spawnSync(command,args,{cwd:root,encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024});
 const passed=run.status===0;
 records.push({command:[command,...args].join(' '),exit_code:run.status,error:run.error?.message,output:run.stdout+run.stderr});
 console.log(`${passed?'PASS':'FAIL'} ${args.join(' ')}`);
 if(!passed)console.error(run.stdout,run.stderr,run.error?.message||'');
}
mkdirSync(new URL('../exports/',import.meta.url),{recursive:true});
writeFileSync(new URL('../exports/release-test-results.json',import.meta.url),JSON.stringify(records,null,2)+'\n');
process.exitCode=records.some(r=>r.exit_code!==0)?1:0;
