import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const env={...process.env,NODE_ENV:'test',LLM_PROVIDER:'ollama',LLM_MODEL:'qwen3:4b-instruct-2507-q4_K_M',LLM_BASE_URL:'http://127.0.0.1:11434',OLLAMA_BASE_URL:'http://127.0.0.1:11434',LIVE_LLM_MODEL:'qwen3:4b-instruct-2507-q4_K_M',LIVE_LLM_BASE_URL:'http://127.0.0.1:11434',LLM_TIMEOUT_MS:'170000',DATABASE_URL:'postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_ai_test?schema=public',REDIS_PORT:'56379',REDIS_HOST:'localhost'};
for(const [name,file,args] of [['narrator','backend/services/ai-service/src/scripts/evaluateLiveNarrator.ts',[]],['semantic','test/model-4b-recheck/semantic.ts',['24']]]){
 const r=spawnSync(process.execPath,['node_modules/tsx/dist/cli.mjs',file,...args],{env,encoding:'utf8',timeout:900000,maxBuffer:10000000});
 writeFileSync(`test/model-4b-recheck/${name}.txt`,(r.stdout??'')+'\n'+(r.stderr??''));
 console.log(JSON.stringify({name,exit:r.status,error:r.error?.message}));
}
