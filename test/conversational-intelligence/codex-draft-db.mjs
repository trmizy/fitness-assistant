import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { registerUser, putProfile, say, q } from '../ai-chat-full-verification/lib.mjs';
const label = process.argv[2] ?? 'on';
const rows = [];
for (const variant of ['A', 'B']) {
  const u = await registerUser(`codex.draft.${variant}.${Date.now()}@gymini-test.local`, 'Codex Draft');
  await putProfile(u, { hasCompletedOnboarding: true, goal: 'WEIGHT_LOSS', age: 28, heightCm: 172, currentWeight: 80, gender: 'MALE', ...(variant === 'B' ? { preferredTrainingDays: [1,3,5] } : {}) });
  let r = await say(u, 'Tạo lịch tập cho tôi.');
  const sid = r.sessionId;
  const read = () => JSON.parse(q('ai', `select coalesce(json_agg(t),'[]'::json) from (select id,status,payload->'weeklySchedule' as schedule from fitness_agent_actions where user_id='${u.userId}' and session_id='${sid}' order by created_at) t`));
  const workflow = () => q('ai', `select workflow_type||'|'||status||'|'||coalesce(expected_slot,'') from agent_workflow_sessions where user_id='${u.userId}' and session_id='${sid}' order by created_at`);
  const setup = { workflow: workflow(), actions: read().map(a => ({ id:a.id, status:a.status, days:a.schedule?.length })) };
  if (variant === 'A') await say(u, '3 buổi mỗi tuần', sid);
  const before = read();
  const profileBefore = q('user', `select row_to_json(p) from user_profiles p where "userId"='${u.userId}'`);
  r = await say(u, 'Sai rồi, phải là 5 buổi mỗi tuần.', sid);
  const after = read();
  const raw = execFileSync('docker', ['logs', 'gymcoach-ai-dev', '--since', '10m'], { encoding:'utf8', maxBuffer:40000000, stdio:['ignore','pipe','pipe'] });
  const traces = raw.split('\n').flatMap(s => { try { const j=JSON.parse(s); return j.correlationId === r.data?.traceId ? [j] : []; } catch { return []; } });
  const route = traces.find(t => t.msg === 'ci_global_trace');
  const pendingBefore = before.filter(a => a.status === 'PENDING');
  const pendingAfter = after.filter(a => a.status === 'PENDING');
  const result = { variant, setup, userId:u.userId, sessionId:sid, http:r.status, correlationId:r.data?.traceId, route:route?.route, llmCalled:route?.llmCalled, before:before.map(a=>({id:a.id,status:a.status,days:a.schedule?.length})), after:after.map(a=>({id:a.id,status:a.status,days:a.schedule?.length})), sameDraft:pendingBefore.length===1 && pendingAfter.length===1 && pendingBefore[0].id===pendingAfter[0].id, fiveDays:pendingAfter[0]?.schedule?.length===5, profileUnchanged: profileBefore === q('user', `select row_to_json(p) from user_profiles p where "userId"='${u.userId}'`), programs:q('fitness', `select count(*) from workout_programs where user_id='${u.userId}'`), recommendations:q('ai', `select count(*) from fitness_recommendations where user_id='${u.userId}'`), answer:r.answer, traces };
  rows.push(result);
  console.log(JSON.stringify(result));
}
fs.mkdirSync('test/conversational-intelligence/results/codex-remediation', {recursive:true});
fs.writeFileSync(`test/conversational-intelligence/results/codex-remediation/draft-db-${label}.json`,JSON.stringify(rows,null,2));

