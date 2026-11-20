// REAL BROWSER — plan <-> program SYNC semantics of the AI plans page, run against the ISOLATED PATCHED COPY of the web app
// (.tmp-stack/web-sync-patch, Vite on :5174 proxied to the local gateway on :3000). The owner's AIPlansPage.tsx is NOT modified.
// Backend = local stack on disposable *_test DBs, model = stub. Usage: node browser-sync.mjs [webBase]   (default http://127.0.0.1:5174)
import path from "node:path"; import os from "node:os"; import fs from "node:fs"; import { execSync } from "node:child_process"; import { createRequire } from "node:module";
const require = createRequire("C:/D_Backup/project_personal/fitness-assistant/.tmp-stack/deps/package.json"); const { chromium } = require("playwright-core");
const HERE = "C:/D_Backup/project_personal/fitness-assistant/docs/plan-review/integration-c"; fs.mkdirSync(`${HERE}/logs/shots`, { recursive: true });
const GW = "http://localhost:3000", WEB = process.argv[2] ?? "http://127.0.0.1:5174";
const AI = "revision_ai_test", FIT = "pr3_fitness_test", USR = "pr3_user_test";
const C = "11111111-1111-4111-8111-111111111111";
const PSQL = (db, sql) => execSync(`docker exec gymcoach-test-postgres-test-1 psql -U gymcoach_test -d ${db} -Atc "${sql.replace(/"/g, '\\"')}"`, { encoding: "utf8" }).trim();
let pass = 0, fail = 0;
const ok = (c, m, extra = "") => { (c ? pass++ : fail++); console.log(`${c ? "PASS" : "FAIL"}  ${m}${c ? "" : "  <-- " + String(extra).slice(0, 300)}`); };
const tokens = JSON.parse(fs.readFileSync(`${HERE}/logs/tokens.json`, "utf8")); const tok = (e) => tokens[e].token;
const api = async (m, p, t, b) => { const r = await fetch(GW + p, { method: m, headers: { "content-type": "application/json", authorization: `Bearer ${t}` }, body: b ? JSON.stringify(b) : undefined }); return r.json().catch(() => ({})); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const planState = (id) => PSQL(AI, `select 'v'||version||' '||status||' perDay='||jsonb_array_length(plan->'weeklySchedule'->0->'exercises') from workout_plans where id='${id}'`);
const progState = () => PSQL(FIT, `select coalesce((select 'v'||version||' ai'||coalesce(ai_plan_version::text,'-') from workout_programs where user_id='${C}' and status='ACTIVE' order by created_at desc limit 1),'none')`);
const progCount = () => PSQL(FIT, `select count(*) from workout_programs where user_id='${C}'`);
const progId = () => PSQL(FIT, `select coalesce((select id::text from workout_programs where user_id='${C}' and status='ACTIVE' order by created_at desc limit 1),'')`);

// reset (disposable DBs only) + a COMPLETED plan that was NEVER saved
PSQL(AI, `delete from workout_plan_revisions; delete from ai_generation_operations; delete from published_plans; delete from workout_plans where user_id='${C}'`);
PSQL(FIT, `delete from plan_review_requests; delete from workouts where user_id='${C}'; delete from workout_schedules where user_id='${C}'; delete from workout_programs where user_id='${C}'`);
PSQL(USR, `delete from notifications; update contracts set status='ACTIVE'`); execSync("docker exec gymcoach-test-redis-test-1 redis-cli FLUSHALL"); fs.writeFileSync(`${HERE}/stub-control.json`, '{"mode":"ok"}');
const ct = tok("pr3.client@example.test");
const gen = await api("POST", "/plans/workout/generate", ct, { goal: "MUSCLE_GAIN", durationWeeks: 4, daysPerWeek: 4, exercisesPerDay: 4, trainingLocation: "GYM", equipmentPreference: "MIXED_GYM" });
const A = gen.data.planId; for (let i = 0; i < 30; i++) { await sleep(500); const j = await api("GET", `/plans/job/${gen.data.jobId}`, ct); if (j.data.status === "COMPLETED") break; }
console.log(`fixture: planId=${A} plan[${planState(A)}] program[${progState()}]  (web under test: ${WEB})`);

const browser = await chromium.launch({ executablePath: path.join(os.homedir(), "AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe"), headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1100 } }); const page = await ctx.newPage(); page.on("dialog", (d) => void d.accept());
const nets = []; page.on("response", (r) => { if (/\/api\/plans\/[0-9a-f-]+\/(save-to-workout-log|revert)|\/api\/plans\/adjust/.test(r.url()) && r.request().method() !== "GET") { nets.push(`${r.request().method()} ${r.url().replace(/^.*\/api/, "")} ${r.status()}`); } });
await page.goto(WEB + "/login"); await page.fill('input[type="email"]', "pr3.client@example.test"); await page.fill('input[type="password"]', "Pr3Test!2026"); await page.click('button[type="submit"]'); await page.waitForURL(/\/(client|pt)\//, { timeout: 20000 });
// (header above = browser-sync.mjs: login, helpers, reset, fixture plan A = 4 days, NOT saved yet)
// B1-12 — REAL BROWSER on the CURRENT source (web :5173): the program's number of training days follows an AI revision that changes daysPerWeek.
const WEBB = process.argv[2] ?? "http://127.0.0.1:5173";
const shotB = (n) => page.screenshot({ path: `${HERE}/logs/shots/b1-${n}.png`, fullPage: true });
const waitJobDone = async (jobId) => { for (let i = 0; i < 60; i++) { await sleep(700); const j = await api("GET", `/plans/job/${jobId}`, ct); if (j.data?.status === "COMPLETED" || j.data?.status === "FAILED") return j.data; } return null; };
const programDays = () => PSQL(FIT, `select count(*) from workout_program_days d join workout_programs p on p.id=d.program_id where p.user_id='${C}' and p.status='ACTIVE'`);
const pageText = async () => (await page.innerText("body")).replace(/\s+/g, " ");
const d0 = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
await api("POST", `/plans/${A}/save-to-workout-log`, ct, { startDate: d0, repeatWeeks: 1, selectedWeekdays: [1, 2, 4, 5], replaceExisting: true });
const PROG0 = progId();
console.log(`\n# B1-12 fixture: program ${PROG0.slice(0, 8)} [${progState()}] days=${programDays()}`);
await page.goto(WEBB + "/client/workout"); await sleep(2500);
ok(/4\s*buổi\/tuần/.test(await pageText()), "before: the Workout page shows the program as 4 buổi/tuần");

// the AI revises the plan to 5 days
const q = await api("POST", "/plans/adjust", ct, { planId: A, adjustments: "Thêm 1 buổi tập", expectedVersion: 1 });
const job = await waitJobDone(q.data.jobId);
ok(job?.status === "COMPLETED" && /v2 COMPLETED/.test(planState(A)), "revision to 5 days completed (same plan id, v2)", JSON.stringify(job).slice(0, 200) + planState(A));

// the client applies it through the REAL UI (AI plans page -> save panel)
await page.goto(WEBB + "/client/plans"); await page.getByText("MUSCLE_GAIN Plan").first().waitFor({ timeout: 20000 }).catch(() => {}); await page.getByText("MUSCLE_GAIN Plan").first().click().catch(() => {}); await sleep(1500);
const applyViaUi = async (days) => {
  await page.getByRole("button", { name: /(Lưu|Cập nhật).*lịch tập/ }).first().click({ timeout: 10000 }); await sleep(700);
  const confirm = page.getByRole("button", { name: /^(Lưu lịch tập|Cập nhật lịch tập)$/ }).first();
  for (const wd of ["T2", "T3", "T4", "T5", "T6", "T7", "CN"]) { if (await confirm.isEnabled().catch(() => false)) break; await page.getByRole("button", { name: wd, exact: true }).first().click({ timeout: 1500 }).catch(() => {}); }
  await shotB(`panel-${days}`);
  await confirm.click({ timeout: 8000 }); await sleep(3500);
};
await applyViaUi(5);
ok(progId() === PROG0 && progCount() === "1" && programDays() === "5" && /v2 ai2/.test(progState()), "backend: SAME program id, ONE program, 5 days, version 2", `${progId()} ${progCount()} days=${programDays()} ${progState()}`);
await page.goto(WEBB + "/client/workout"); await sleep(2500); await shotB("workout-5days");
ok(/5\s*buổi\/tuần/.test(await pageText()) && !/4\s*buổi\/tuần/.test(await pageText()), "B1-12 UI: the Workout page now shows the program as 5 buổi/tuần");

// Undo (plan v3 = the original 4-day content) then re-apply: the program goes back to 4 days, same ids
await page.goto(WEBB + "/client/plans"); await page.getByText("MUSCLE_GAIN Plan").first().click().catch(() => {}); await sleep(1500);
await page.getByRole("button", { name: /Quay lại phiên bản|Quay lại bản/ }).first().click({ timeout: 10000 }); await sleep(2500);
ok(/v3 COMPLETED/.test(planState(A)), "Undo: same plan id, version moved forward to v3 (4-day content)", planState(A));
ok(/v2 ai2/.test(progState()) && programDays() === "5", "Undo alone does not touch the program (still 5 days)", `${progState()} days=${programDays()}`);
await applyViaUi(4);
ok(progId() === PROG0 && programDays() === "4" && /v3 ai3/.test(progState()), "backend: SAME program id, now 4 days again, version 3", `${progId()} days=${programDays()} ${progState()}`);
await page.goto(WEBB + "/client/workout"); await sleep(2500); await shotB("workout-4days-again");
ok(/4\s*buổi\/tuần/.test(await pageText()), "B1-12 UI: the Workout page shows 4 buổi/tuần again after the undo was re-applied");
await browser.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
