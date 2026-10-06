import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import {registerUser,putProfile,say,q,dismissAction} from '../ai-chat-full-verification/lib.mjs';
const results=[];
for(const scenario of ['history-over-five','action-cancelled-later']){
 const user=await registerUser(`codex.x4.edge.${scenario}.${Date.now()}@gymini-test.local`,'Codex X4 Edge');
 await putProfile(user,{hasCompletedOnboarding:true,goal:'MUSCLE_GAIN',currentWeight:95,heightCm:172,age:28,gender:'MALE'});
 const rec=await say(user,'với tình trạng hiện tại tôi nên cut hay bulk?');
 const sid=rec.sessionId;
 await say(user,'ok đổi theo đề xuất đó',sid);
 const confirmed=await say(user,'Xác nhận cập nhật.',sid);
 const profile=()=>q('user',`select row_to_json(p) from user_profiles p where "userId"='${user.userId}'`);
 const before=profile();
 if(JSON.parse(before).goal!=='WEIGHT_LOSS')throw new Error('Real profile write precondition failed');
 let dismissal;
 if(scenario==='history-over-five'){
   for(let i=0;i<6;i++)q('ai',`insert into agent_workflow_sessions(id,user_id,session_id,workflow_type,status,expires_at,created_at,updated_at) values ('${randomUUID()}','${user.userId}','${sid}','CREATE_WORKOUT_PLAN','CANCELLED',now()+interval '10 minutes',now(),now())`);
 }else{
   const id=randomUUID();
   q('ai',`insert into fitness_agent_actions(id,user_id,session_id,kind,risk,payload,status,expires_at,created_at) values ('${id}','${user.userId}','${sid}','CREATE_WORKOUT_PLAN','MEDIUM','{"weeklySchedule":[]}'::jsonb,'PENDING',now()+interval '10 minutes',now()-interval '20 minutes')`);
   const r=await dismissAction(user,id);
   dismissal={http:r.status,response:r.json,status:q('ai',`select status from fitness_agent_actions where id='${id}'`)};
   if(r.status!==200||dismissal.status!=='CANCELLED')throw new Error('Real dismissal precondition failed');
 }
 const response=await say(user,'Đã lưu thành công chưa?',sid);
 const row={scenario,userId:user.userId,sessionId:sid,confirmedAnswer:confirmed.answer,http:response.status,answer:response.answer,traceId:response.data?.traceId,
   goal:JSON.parse(profile()).goal,profileUnchanged:before===profile(),dismissal,
   workflows:JSON.parse(q('ai',`select json_agg(t) from (select status,pending_profile_update,created_at,updated_at from agent_workflow_sessions where user_id='${user.userId}' order by updated_at desc) t`)),
   actions:JSON.parse(q('ai',`select coalesce(json_agg(t),'[]'::json) from (select status,created_at from fitness_agent_actions where user_id='${user.userId}') t`)),
   truthful:scenario==='history-over-five'?/^Rồi/.test(response.answer):/đã được bỏ qua/.test(response.answer)};
 results.push(row);
 fs.writeFileSync('test/conversational-intelligence/results/codex-final-followup/x4-edge-http.json',JSON.stringify(results,null,2));
 console.log(JSON.stringify({scenario,http:row.http,answer:row.answer,goal:row.goal,profileUnchanged:row.profileUnchanged,truthful:row.truthful}));
}
process.exitCode=results.every(r=>r.truthful)?0:1;
