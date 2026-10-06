import fs from 'node:fs';
import { registerUser, putProfile, say, http, q } from '../ai-chat-full-verification/lib.mjs';
const a = await registerUser(`codex.security.a.${Date.now()}@gymini-test.local`, 'Codex Security A');
const b = await registerUser(`codex.security.b.${Date.now()}@gymini-test.local`, 'Codex Security B');
await putProfile(a, {hasCompletedOnboarding:true,goal:'WEIGHT_LOSS',age:28,heightCm:172,currentWeight:80,gender:'MALE',preferredTrainingDays:[1,3,5]});
const draft = await say(a, 'Tạo lịch tập cho tôi.');
const id = draft.data?.structuredBlocks?.find(x=>x.actionId)?.actionId;
if (!id) throw new Error('PRECONDITION_FAILED: no draft');
const results=[];
const check=(name,pass,details)=>{results.push({name,pass,details});console.log(name,pass);};
for(const [name, method, path, token, body] of [
  ['foreign-confirm','POST',`/ai/agent/actions/${id}/confirm`,b.token,{confirmed:true}],
  ['foreign-dismiss','POST',`/ai/agent/actions/${id}/dismiss`,b.token,{}],
  ['foreign-messages','GET',`/ai/sessions/${draft.sessionId}/messages`,b.token,undefined],
  ['foreign-turn','POST','/ai/ask',b.token,{question:'Lưu đi',sessionId:draft.sessionId}],
  ['no-auth','POST',`/ai/agent/actions/${id}/confirm`,undefined,{confirmed:true}],
  ['invalid-auth','POST',`/ai/agent/actions/${id}/confirm`,'invalid.token',{confirmed:true}],
]) { const r=await http(method,path,{token,body}); check(name,[401,403,404].includes(r.status),r.status); }
check('owner-draft-still-pending',q('ai',`select status from fitness_agent_actions where id='${id}'`)==='PENDING');
const corpus=JSON.parse(fs.readFileSync('test/ai-chat-full-verification/corpus/adversarial.json','utf8'));
for(const c of corpus.filter(x=>['I01','I02','I03','U01','U02','U03','U04'].includes(x.id))) {
 const r=await say(a,c.message,draft.sessionId);
 check(c.id,r.status===200 && r.answer.length>0 && !(r.data?.structuredBlocks?.length) && !(c.mustNotMatch && new RegExp(c.mustNotMatch,'i').test(r.answer)),{status:r.status,ms:r.ms,answer:r.answer});
}
check('no-program-write',q('fitness',`select count(*) from workout_programs where user_id='${a.userId}'`)==='0');
check('draft-remains-pending',q('ai',`select status from fitness_agent_actions where id='${id}'`)==='PENDING');
fs.writeFileSync('test/conversational-intelligence/results/codex-remediation/security-http.json',JSON.stringify(results,null,2));
