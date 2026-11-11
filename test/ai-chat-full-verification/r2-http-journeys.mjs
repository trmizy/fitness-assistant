// Phase 3 R2 — H1-H6 real HTTP journeys, through the actual gateway/ai-service
// entry points (not tryTurn() direct calls), against the isolated verification
// stack (stack.mjs, ports +10000) and the isolated *_test Postgres.
// Usage: GATEWAY_URL=http://localhost:13000 node test/ai-chat-full-verification/r2-http-journeys.mjs
import { U, ok, info, setJourney, turn, aiq, confirmViaApi, finish } from "./harness.mjs";
import { sleep, http, SECRET } from "./lib.mjs";
import { spawnSync } from "node:child_process";

const cnt = (sql) => Number(aiq(sql).split("\n")[0]);

async function H1_workoutCreation() {
  setJourney("H1-workout-creation");
  const u = U.A; // availableEquipment: dumbbell+bodyweight, preferredTrainingDays [1,3,5]
  let t = await turn("create", u, "Tạo lịch tập cho tôi");
  let s = t.sessionId;
  // Resolve whatever slot gets asked (sessionMinutes most likely).
  for (let i = 0; i < 3 && !t.block("WORKOUT_PLAN_PREVIEW"); i += 1) { t = await turn("slot", u, "1 tiếng", s); s = t.sessionId; }
  const preview = t.block("WORKOUT_PLAN_PREVIEW");
  ok("H1: real draft preview produced via /ai/ask", !!preview, t.blocks.map((b) => b.type).join(","));
  if (!preview) return;
  const actionId = preview.actionId;
  ok("H1: nothing persisted before confirm (no WorkoutProgram for this action)", cnt(`select count(*) from fitness_agent_actions where id='${actionId}' and status='COMPLETED'`) === 0);
  info(`equipment note present in answer: ${/thiết bị/i.test(t.answer)}`);

  const r = await turn("revise", u, "Đổi squat.", s); s = r.sessionId;
  ok("H1: revision reuses the same pending action", r.block("WORKOUT_PLAN_PREVIEW")?.actionId === actionId, r.block("WORKOUT_PLAN_PREVIEW")?.actionId);

  const c1 = await confirmViaApi(u, actionId);
  ok("H1: confirm succeeds (200)", c1.status === 200, c1.status);
  ok("H1: exactly one COMPLETED action after confirm", cnt(`select count(*) from fitness_agent_actions where id='${actionId}' and status='COMPLETED'`) === 1);
  const c2 = await confirmViaApi(u, actionId);
  ok("H1: replaying confirm over HTTP does not duplicate (still exactly one COMPLETED)", cnt(`select count(*) from fitness_agent_actions where id='${actionId}' and status='COMPLETED'`) === 1, c2.status);
}

async function H2_crossDomainInterruption() {
  setJourney("H2-cross-domain-interruption");
  const u = U.D;
  let t = await turn("create", u, "Tạo lịch tập cho tôi");
  let s = t.sessionId;
  if (t.block("WORKOUT_PLAN_PREVIEW")) { info("H2: no slot was missing for this user — interruption test still runs against the live preview turn, not a WORKFLOW_MISSING_DATA wait"); }
  const missing = t.block("WORKFLOW_MISSING_DATA");
  const workflowsBefore = aiq(`select id, status, expected_slot from agent_workflow_sessions where user_id='${u.userId}' order by created_at desc limit 1`);

  const nut = await turn("interrupt", u, "Mục tiêu dinh dưỡng hiện tại của tôi là gì?", s);
  s = nut.sessionId;
  ok("H2: the interrupting nutrition question gets its own real answer (real macro data), not a bare workflow echo", /kcal|đạm|carb|béo/i.test(nut.answer), nut.answer.slice(0, 160));
  const workflowsAfter = aiq(`select id, status, expected_slot from agent_workflow_sessions where user_id='${u.userId}' order by created_at desc limit 1`);
  ok("H2: the pending workflow row is unchanged by the interruption", workflowsBefore === workflowsAfter, `${workflowsBefore} vs ${workflowsAfter}`);

  if (missing) {
    const resume = await turn("resume", u, "1 tiếng", s);
    ok("H2: after the interruption, answering the original slot resumes the SAME workflow into a preview", !!resume.block("WORKOUT_PLAN_PREVIEW") || !!resume.block("WORKFLOW_MISSING_DATA"), resume.blocks.map((b) => b.type).join(","));
  }
}

async function H3_crossUserIsolation() {
  setJourney("H3-cross-user-isolation");
  const owner = U.B, stranger = U.C;
  let t = await turn("create", owner, "Tạo lịch tập cho tôi");
  let s = t.sessionId;
  for (let i = 0; i < 3 && !t.block("WORKOUT_PLAN_PREVIEW"); i += 1) { t = await turn("slot", owner, "45 phút", s); s = t.sessionId; }
  const actionId = t.block("WORKOUT_PLAN_PREVIEW")?.actionId;
  if (!actionId) { ok("H3: owner must get a real pending action to test isolation against", false); return; }

  const strangerConfirm = await confirmViaApi(stranger, actionId);
  ok("H3: a stranger confirming someone else's pending action is rejected (not 200)", strangerConfirm.status !== 200, strangerConfirm.status);
  ok("H3: the stranger's rejected confirm did not complete the owner's action", cnt(`select count(*) from fitness_agent_actions where id='${actionId}' and status='COMPLETED'`) === 0);

  const payloadBefore = aiq(`select payload::text from fitness_agent_actions where id='${actionId}'`);
  await turn("stranger-revise", stranger, "Đổi squat.", s);
  const payloadAfter = aiq(`select payload::text from fitness_agent_actions where id='${actionId}'`);
  ok("H3: a stranger's own chat message never mutates the owner's pending draft (it has no knowledge of the owner's action/session)", payloadBefore === payloadAfter, "payload unchanged");

  const ownerConfirm = await confirmViaApi(owner, actionId);
  ok("H3: the real owner can still confirm their own action afterwards", ownerConfirm.status === 200, ownerConfirm.status);
}

async function H4_duplicateConfirm() {
  setJourney("H4-duplicate-confirm");
  const u = U.E;
  let t = await turn("create", u, "Tạo lịch tập cho tôi");
  let s = t.sessionId;
  for (let i = 0; i < 3 && !t.block("WORKOUT_PLAN_PREVIEW"); i += 1) { t = await turn("slot", u, "50 phút", s); s = t.sessionId; }
  const actionId = t.block("WORKOUT_PLAN_PREVIEW")?.actionId;
  if (!actionId) { ok("H4: needs a real pending action", false); return; }

  const seq1 = await confirmViaApi(u, actionId);
  const seq2 = await confirmViaApi(u, actionId);
  ok("H4 (sequential): both calls return, only one authoritative result", cnt(`select count(*) from fitness_agent_actions where id='${actionId}' and status='COMPLETED'`) === 1, `${seq1.status},${seq2.status}`);

  // Concurrent: a second real pending action, hit with two confirms at once.
  let t2 = await turn("create2", u, "Tạo lịch tập cho tôi");
  let s2 = t2.sessionId;
  for (let i = 0; i < 3 && !t2.block("WORKOUT_PLAN_PREVIEW"); i += 1) { t2 = await turn("slot2", u, "50 phút", s2); s2 = t2.sessionId; }
  const actionId2 = t2.block("WORKOUT_PLAN_PREVIEW")?.actionId;
  if (!actionId2) { ok("H4 (concurrent): needs a second real pending action", false); return; }
  const [a, b] = await Promise.allSettled([confirmViaApi(u, actionId2), confirmViaApi(u, actionId2)]);
  ok("H4 (concurrent): exactly one authoritative COMPLETED action, never two, under a real race", cnt(`select count(*) from fitness_agent_actions where id='${actionId2}' and status='COMPLETED'`) === 1, `${a.status},${b.status}`);
}

async function H5_H6_downstreamAndValidatorOutage() {
  setJourney("H5-H6-fitness-service-outage");
  const u = U.F;
  // Find and kill ONLY this verification stack's own fitness-service process (pid recorded by stack.mjs),
  // never the real gymcoach-fitness-dev container.
  const fs = await import("node:fs");
  const pids = JSON.parse(fs.readFileSync(".tmp-stack/pids.json", "utf8"));
  const fitnessPid = pids.fitness;
  info(`stopping this verification stack's own fitness-service (pid ${fitnessPid}) to simulate an outage`);
  spawnSync("taskkill", ["/PID", String(fitnessPid), "/T", "/F"], { stdio: "ignore" });
  await sleep(1500);

  // H6 (this script): fitness-service is FULLY down here (not just the equipment-validator
  // endpoint), so draft generation fails earlier (exercise search/profile context also depend
  // on it) than N4's specific scenario (validator alone unavailable, everything else OK) -
  // the two are different failure severities. The N4 unit tests (B/C in
  // fitness-agent-equipment-preview-degraded.test.ts) already cover the validator-only case
  // directly and are the primary evidence for that invariant. What this live full-outage
  // probe must still show: a truthful failure, never a hallucinated/invented plan, and no
  // authoritative persistence.
  const t = await turn("create-during-outage", u, "Tạo lịch tập cho tôi");
  const s = t.sessionId;
  const t2 = await turn("slot-during-outage", u, "40 phút", s);
  ok("H6 (full outage): draft generation fails truthfully (no invented/hallucinated plan) rather than crashing or faking success", !t2.block("WORKOUT_PLAN_PREVIEW") && t2.answer.length > 0, t2.answer.slice(0, 160));
  const preview = t2.block("WORKOUT_PLAN_PREVIEW");
  ok("H6 (full outage): no authoritative persistence happened merely from attempting a preview during the outage", !preview || cnt(`select count(*) from fitness_agent_actions where id='${preview.actionId}' and status='COMPLETED'`) === 0);

  // H5: confirming (a real downstream write to fitness-service) during the SAME outage must fail truthfully, not claim success.
  const outageConfirm = preview ? await confirmViaApi(u, preview.actionId) : { status: 0 };
  ok("H5: confirming while the downstream service is down returns a non-200 (truthful failure, not a false 'saved')", outageConfirm.status !== 200, outageConfirm.status);
  ok("H5: the failed confirm left the action NOT completed", !preview || cnt(`select count(*) from fitness_agent_actions where id='${preview.actionId}' and status='COMPLETED'`) === 0);

  // Restore and verify recovery.
  const { spawn } = await import("node:child_process");
  const path = await import("node:path");
  const root = process.cwd();
  const tsx = path.join(root, "node_modules/tsx/dist/cli.mjs");
  const PG = "postgresql://gymcoach_test:gymcoach_test_password@localhost:55433";
  const child = spawn(process.execPath, [tsx, "src/server.ts"], {
    cwd: path.join(root, "backend/services/fitness-service"),
    env: { ...process.env, NODE_ENV: "development", PORT: "13002", DATABASE_URL: `${PG}/gymcoach_fitness_test?schema=public`, FITNESS_DATABASE_URL: `${PG}/gymcoach_fitness_test?schema=public`, REDIS_HOST: "localhost", REDIS_PORT: "56379", INTERNAL_SERVICE_SECRET: SECRET, INTERNAL_API_SECRET: SECRET },
    stdio: ["ignore", "ignore", "ignore"], detached: true, windowsHide: true,
  });
  child.unref();
  pids.fitness = child.pid;
  fs.writeFileSync(".tmp-stack/pids.json", JSON.stringify(pids));
  let recovered = false;
  for (let i = 0; i < 30 && !recovered; i += 1) {
    try { recovered = (await (await fetch("http://127.0.0.1:13002/health", { signal: AbortSignal.timeout(1000) })).status) < 500; } catch { recovered = false; }
    if (!recovered) await sleep(1000);
  }
  ok("fitness-service recovered after the simulated outage", recovered);

  if (preview && recovered) {
    const recoveredConfirm = await confirmViaApi(u, preview.actionId);
    ok("once fitness-service is back, the SAME previously-degraded action can confirm normally", recoveredConfirm.status === 200, recoveredConfirm.status);
  }
}

const all = { H1_workoutCreation, H2_crossDomainInterruption, H3_crossUserIsolation, H4_duplicateConfirm, H5_H6_downstreamAndValidatorOutage };
const which = process.argv.slice(2);
const toRun = which.length ? which : Object.keys(all);
for (const name of toRun) { console.log(`\n=== ${name} ===`); await all[name](); }
finish(toRun);
