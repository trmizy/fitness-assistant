import fs from 'node:fs';
import { registerUser, putProfile, say, q } from '../ai-chat-full-verification/lib.mjs';
const u=await registerUser(`codex.final.profile.${Date.now()}@gymini-test.local`,'Codex Final Profile');
await putProfile(u,{hasCompletedOnboarding:true,goal:'MUSCLE_GAIN',currentWeight:95,heightCm:172,age:28,gender:'MALE'});
const rows=[]; let sid;
for(const question of ['với tình trạng hiện tại tôi nên cut hay bulk?','ok đổi theo đề xuất đó','Xác nhận cập nhật.','Đã lưu thành công chưa?']){
 const r=await say(u,question,sid);sid=r.sessionId;
 rows.push({question,status:r.status,answer:r.answer,traceId:r.data?.traceId,sessionId:sid,userId:u.userId,goal:q('user',`select goal from user_profiles where "userId"='${u.userId}'`),workflow:q('ai',`select status from agent_workflow_sessions where user_id='${u.userId}' order by created_at desc limit 1`),actions:q('ai',`select count(*) from fitness_agent_actions where user_id='${u.userId}'`)});
 rows.at(-1).profileSnapshot=q('user',`select row_to_json(p) from user_profiles p where "userId"='${u.userId}'`);
}
const out={rows,confirmedWrite:rows[1].goal==='MUSCLE_GAIN' && rows[2].goal==='WEIGHT_LOSS' && rows[2].workflow==='COMPLETED',statusTruthful:!rows[3].answer.includes('Chưa có thay đổi nào được lưu')};
out.noRepeatWrite=rows[2].profileSnapshot===rows[3].profileSnapshot;
fs.writeFileSync('test/conversational-intelligence/results/codex-final-closure/profile-confirmation-followup.json',JSON.stringify(out,null,2));
console.log(JSON.stringify(out,null,2));
