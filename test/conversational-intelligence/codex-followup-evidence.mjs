import fs from 'node:fs';
import {spawn} from 'node:child_process';
const root='test/conversational-intelligence/results/codex-final-followup';
fs.mkdirSync(root,{recursive:true});
const prefix='test/conversational-intelligence/';
const backend=(name,file)=>[name,'docker',['exec','gymcoach-ai-dev','sh','-c',`cd /app/backend/services/ai-service && npx tsx --test src/__tests__/${file}`],null];
const jobs=process.argv[2]==='backend' ? [backend('ordering','codex-x4-resolution-independent.test.ts'),backend('independent','codex-final-closure-independent.test.ts')] : [
 ['original-repro','node',[`${prefix}codex-final-confirmation-followup.mjs`],`${prefix}results/codex-final-closure/profile-confirmation-followup.json`],
 ['matrix','node',[`${prefix}x4-confirmation-matrix.mjs`,'codex-resumed','1'],null],
 ['golden','node',[`${prefix}live-golden.mjs`],`${prefix}results/live-golden.json`],
 ['global','node',[`${prefix}live-global.mjs`],`${prefix}results/live-global.json`],
 ['draft','node',[`${prefix}codex-draft-db.mjs`,'codex-resumed'],null],
 ['security','node',[`${prefix}codex-security-http.mjs`],`${prefix}results/codex-remediation/security-http.json`],
];
const selected=process.argv[2]==='original'?jobs.slice(0,1):process.argv[2]==='remaining'?jobs.slice(1):jobs;
for(const [name,command,args,artifact] of selected){
 const before=artifact&&fs.existsSync(artifact)?fs.readFileSync(artifact):null;
 const start=Date.now(); console.log('START',name,new Date().toISOString());
 const stream=fs.createWriteStream(`${root}/${name}.log`);
 const child=spawn(command,args,{stdio:['ignore','pipe','pipe']});
 child.stdout.on('data',b=>stream.write(b));child.stderr.on('data',b=>stream.write(b));
 const exit=await new Promise(resolve=>child.on('exit',resolve));
 await new Promise(resolve=>stream.end(resolve));
 const artifactUpdated=Boolean(artifact&&fs.existsSync(artifact)&&(!before||!fs.readFileSync(artifact).equals(before)));
 if(artifactUpdated){
   fs.copyFileSync(artifact,`${root}/${artifact.split('/').pop()}`);
   if(before)fs.writeFileSync(artifact,before);
 }
 fs.writeFileSync(`${root}/${name}-status.json`,JSON.stringify({at:new Date().toISOString(),exit,ms:Date.now()-start,command,args,artifactUpdated},null,2));
 console.log('END',name,exit,fs.readFileSync(`${root}/${name}.log`,'utf8').split('\n').filter(l=>/^# (tests|pass|fail)|^not ok|^RESULT|^cells=/.test(l)).join('\n'));
}
