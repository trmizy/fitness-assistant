import fs from 'node:fs';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
const root = 'test/conversational-intelligence/results/codex-final-followup';
fs.mkdirSync(root, {recursive:true});
const productionFiles = ['services/fitness-agent-tools.ts','services/fitness-agent.service.ts','services/confirmation-boundary.ts','conversational-intelligence/global/profile-errors.ts','conversational-intelligence/global/global-turn.ts','conversational-intelligence/global/llm-route.ts','llm/json_llm_call.util.ts','conversational-intelligence/index.ts'];
const productionManifest = productionFiles.map(p=>({path:p,sha256:crypto.createHash('sha256').update(fs.readFileSync(`backend/services/ai-service/src/${p}`)).digest('hex')}));
if(!fs.existsSync(`${root}/production-manifest.json`)) fs.writeFileSync(`${root}/production-manifest.json`,JSON.stringify(productionManifest,null,2));
else if(JSON.stringify(JSON.parse(fs.readFileSync(`${root}/production-manifest.json`,'utf8')))!==JSON.stringify(productionManifest)) throw new Error('Production source changed during verification');
const suite = 'cd /app/backend/services/ai-service && npx tsx --test src/__tests__/conversational-intelligence-*.test.ts src/__tests__/codex-remediation-boundary.test.ts src/__tests__/agent-workflow-*.test.ts src/__tests__/fitness-agent-*.test.ts src/__tests__/x4-confirmation-followup.test.ts';
const mode = process.argv[2] ?? 'regression';
const configs = mode === 'retry' ? [['A-retry','off','off'],['B-retry','on','off']] : mode === 'a-retry' ? [['A-retry','off','off']] : [['A','off','off'],['B','on','off'],['C','on','on']];
const jobs = ['regression','retry','a-retry'].includes(mode) ? configs.map(([label,ci,llm]) => [label,'docker',['exec','-e',`CONVERSATIONAL_INTELLIGENCE_V2=${ci}`,'-e',`CONVERSATIONAL_INTELLIGENCE_V2_LLM=${llm}`,'gymcoach-ai-dev','sh','-c',suite]]) : mode === 'matrix' ? [['matrix','node',['test/conversational-intelligence/x4-confirmation-matrix.mjs','codex-independent','1']]] : mode === 'golden' ? [['golden','node',['test/conversational-intelligence/live-golden.mjs']],['global','node',['test/conversational-intelligence/live-global.mjs']]] : [['independent','docker',['exec','gymcoach-ai-dev','sh','-c','cd /app/backend/services/ai-service && npx tsx --test src/__tests__/codex-final-closure-independent.test.ts']]];
const testFiles = fs.readdirSync('backend/services/ai-service/src/__tests__').filter(p=>/^(conversational-intelligence-|codex-remediation-boundary|agent-workflow-|fitness-agent-|x4-confirmation-followup).*\.test\.ts$/.test(p));
fs.writeFileSync(`${root}/test-manifest.json`,JSON.stringify(testFiles.map(p=>({path:p,sha256:crypto.createHash('sha256').update(fs.readFileSync(`backend/services/ai-service/src/__tests__/${p}`)).digest('hex')})),null,2));
for (const [label,cmd,args] of jobs) {
  const files = mode === 'golden' ? ['test/conversational-intelligence/results/live-golden.json','test/conversational-intelligence/results/live-global.json'] : [];
  const before=files.map(p=>fs.existsSync(p)?fs.readFileSync(p):null);
  const log=fs.createWriteStream(`${root}/${label}.log`);
  const start=Date.now(); console.log('START',label,new Date().toISOString());
  const child=spawn(cmd,args,{stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',b=>log.write(b)); child.stderr.on('data',b=>log.write(b));
  const exit=await new Promise(resolve=>child.on('exit',resolve));
  await new Promise(resolve=>log.end(resolve));
  files.forEach((p,i)=>{if(fs.existsSync(p) && !fs.readFileSync(p).equals(before[i]??Buffer.alloc(0))){fs.copyFileSync(p,`${root}/${p.split('/').pop()}`);if(before[i])fs.writeFileSync(p,before[i]);}});
  fs.writeFileSync(`${root}/${label}-status.json`,JSON.stringify({at:new Date().toISOString(),exit,ms:Date.now()-start,cmd,args},null,2));
  const text=fs.readFileSync(`${root}/${label}.log`,'utf8');
  console.log('END',label,exit,text.split('\n').filter(l=>/^# (tests|pass|fail|duration)|^not ok|RESULT|cells=/.test(l)).join('\n'));
}
