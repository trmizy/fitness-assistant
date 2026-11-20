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
const shot = (n) => page.screenshot({ path: `${HERE}/logs/shots/sync-${n}.png`, fullPage: true });
const status = async () => { const el = page.getByTestId("plan-sync-status").first(); await el.waitFor({ timeout: 15000 }); return { state: await el.getAttribute("data-state"), text: (await el.innerText()).trim() }; };
const waitState = async (s, ms = 12000) => { const t0 = Date.now(); let last; while (Date.now() - t0 < ms) { last = await status().catch(() => ({ state: "?", text: "" })); if (last.state === s) return last; await sleep(300); } return last; };
const openPlan = async () => { await page.goto(WEB + "/client/plans"); await page.getByText("MUSCLE_GAIN Plan").first().waitFor({ timeout: 20000 }).catch(() => {}); await page.getByText("MUSCLE_GAIN Plan").first().click().catch(() => {}); await sleep(1200); };
const saveViaUi = async () => {
  nets.length = 0; // each save is judged by ITS OWN response, never by a banner left over from the previous one
  const confirmVisible = await page.getByRole("button", { name: /^(Lưu lịch tập|Cập nhật lịch tập)$/ }).first().isVisible().catch(() => false);
  if (!confirmVisible) await page.getByRole("button", { name: /^(Lưu vào lịch tập|Lưu lại vào lịch tập|Cập nhật lịch tập theo bản \d+)$/ }).first().click({ timeout: 8000 });
  await sleep(600);
  for (const wd of ["T2", "T3", "T5", "T6"]) await page.getByRole("button", { name: wd, exact: true }).first().click({ timeout: 1500 }).catch(() => {});
  await page.getByRole("button", { name: /^(Lưu lịch tập|Cập nhật lịch tập)$/ }).first().click({ timeout: 8000 });
};
const outcome = async () => { for (let i = 0; i < 40 && !nets.some((n) => /save-to-workout-log/.test(n)); i++) await sleep(250); await sleep(600); const el = page.getByTestId("save-outcome").first(); await el.waitFor({ timeout: 15000 }).catch(() => {}); return { kind: await el.getAttribute("data-kind").catch(() => null), text: (await el.innerText().catch(() => "")).split("\n")[0] }; };
const adjustViaUi = async (text) => {
  await page.getByRole("button", { name: /Điều chỉnh kế hoạch/ }).first().click({ timeout: 15000 });
  await page.getByPlaceholder(/Tăng bài chân/).fill(text); await page.getByRole("button", { name: /Gửi điều chỉnh/ }).click();
  await page.getByText("Đã điều chỉnh kế hoạch").first().waitFor({ timeout: 45000 }); await sleep(1500);
};

console.log("\n# K9-1 never saved");
await openPlan(); let s = await status(); await shot("1-never-saved");
ok(s.state === "never_saved" && /chưa được lưu/.test(s.text), "plan never saved => state never_saved ('chưa được lưu vào lịch tập')", JSON.stringify(s));
ok(await page.getByRole("button", { name: /^Lưu vào lịch tập$/ }).first().isVisible(), "opener button reads 'Lưu vào lịch tập'");

console.log("\n# K9-2 first save creates ONE program");
await saveViaUi(); let o = await outcome(); await sleep(1500); await shot("2-first-save");
ok(o.kind === "first_save" && /^Đã lưu kế hoạch vào lịch tập\./.test(o.text), "first save message = 'Đã lưu kế hoạch vào lịch tập.' (not 'đã lưu trước đó')", JSON.stringify(o));
s = await waitState("synced"); ok(s.state === "synced" && /theo bản 1/.test(s.text), "after the save the page derives state synced (program follows v1)", JSON.stringify(s));
ok(progCount() === "1" && /v1 ai1/.test(progState()), "backend: exactly ONE program, v1 ai1", `${progCount()} ${progState()}`);
const PROG = progId();

console.log("\n# K9-3 revise through the UI => new revision pending sync");
await adjustViaUi("Mỗi buổi 6 bài"); await shot("3-after-adjust");
ok(/v2 COMPLETED perDay=6/.test(planState(A)), "backend: SAME plan id now v2 with 6/day", planState(A));
ok(await page.getByTestId("save-outcome").count() === 0, "the old 'saved' banner is cleared when the plan version changes");
s = await waitState("pending_sync"); ok(s.state === "pending_sync" && /Bản 2 chưa được áp dụng/.test(s.text), "state pending_sync: 'Bản 2 chưa được áp dụng vào lịch tập đang tập.'", JSON.stringify(s));
ok(await page.getByRole("button", { name: /^Cập nhật lịch tập theo bản 2$/ }).first().isVisible(), "opener button says 'Cập nhật lịch tập theo bản 2' (not a plain 'save')");
ok(/v1 ai1/.test(progState()), "the program in use is unchanged until the client applies the revision", progState());

console.log("\n# K9-4 apply => synced message, same program, no duplicate");
await saveViaUi(); o = await outcome(); await sleep(1500); await shot("4-synced");
ok(o.kind === "synced" && /Đã cập nhật chương trình tập theo phiên bản 2/.test(o.text), "message says the program WAS updated to version 2 (never 'đã lưu trước đó')", JSON.stringify(o));
ok(!/trước đó/.test(await page.innerText("body")), "the misleading 'đã lưu trước đó' text is gone");
ok(progCount() === "1" && progId() === PROG && /v2 ai2/.test(progState()), "backend: SAME program id, v2 ai2, still ONE program (no duplicate WorkoutProgram)", `${progCount()} ${progState()}`);
s = await waitState("synced"); ok(s.state === "synced" && /theo bản 2/.test(s.text), "state synced (follows v2)", JSON.stringify(s));

console.log("\n# K9-5 saving again with nothing new");
await saveViaUi(); o = await outcome(); await sleep(1000);
ok(o.kind === "already_current" && /đã khớp với phiên bản 2/.test(o.text), "repeat save says it already matches v2 — nothing changed", JSON.stringify(o));
ok(progCount() === "1" && /v2 ai2/.test(progState()), "backend: still one program, program version NOT bumped by a no-op save", `${progCount()} ${progState()}`);

console.log("\n# K9-6 Undo (v2 -> v3, same plan id) recomputes the sync state");
await page.getByRole("button", { name: /Quay lại phiên bản|Quay lại bản/ }).first().click({ timeout: 10000 }); await sleep(2500); await shot("6-after-undo");
ok(/v3 COMPLETED perDay=4/.test(planState(A)) && PSQL(AI, `select count(*) from workout_plans where user_id='${C}'`) === "1", "backend: Undo kept the SAME plan id, version moved FORWARD to v3 with the v1 content", planState(A));
s = await waitState("pending_sync"); ok(s.state === "pending_sync" && /Bản 3 chưa được áp dụng/.test(s.text), "state pending_sync again (plan v3 vs program ai2) — version display follows the plan", JSON.stringify(s));
ok(/v2 ai2/.test(progState()), "undo alone does not touch the program", progState());

console.log("\n# K9-7 sync FAILURE is visible, then retry succeeds");
await page.route("**/save-to-workout-log", (r) => r.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ success: false, error: { message: "boom" } }) }));
await saveViaUi(); await sleep(2000); await shot("7-sync-failed");
s = await status(); ok(s.state === "sync_failed" && /Chưa đồng bộ được/.test(s.text), "failed sync is shown as sync_failed", JSON.stringify(s));
ok(await page.getByTestId("save-outcome").count() === 0, "no success banner after a failure");
ok(/v2 ai2/.test(progState()), "program untouched by the failed attempt", progState());
await page.unroute("**/save-to-workout-log");
await saveViaUi(); o = await outcome(); await sleep(1500);
ok(o.kind === "synced" && /phiên bản 3/.test(o.text), "retry after the failure syncs to v3", JSON.stringify(o));
ok(progCount() === "1" && progId() === PROG && /v3 ai3/.test(progState()), "backend: same program id, v3 ai3, one program", `${progCount()} ${progState()}`);
s = await waitState("synced"); ok(s.state === "synced" && /theo bản 3/.test(s.text), "state synced (v3)", JSON.stringify(s));

console.log("\n# K9-8 reload (stale local state) derives the same truth from the server");
await page.reload(); await page.getByText("MUSCLE_GAIN Plan").first().waitFor({ timeout: 20000 }).catch(() => {}); await page.getByText("MUSCLE_GAIN Plan").first().click().catch(() => {}); await sleep(1500);
s = await status(); ok(s.state === "synced" && /theo bản 3/.test(s.text), "after a full reload the state is still synced v3 (not driven by local flags)", JSON.stringify(s));

console.log("\n# K9-9 viewports 360/375/390/412: no horizontal overflow, status + opener button inside the viewport");
for (const w of [360, 375, 390, 412]) {
  await page.setViewportSize({ width: w, height: 900 }); await openPlan(); await sleep(800);
  const m = await page.evaluate(() => { const st = document.querySelector('[data-testid="plan-sync-status"]'); const b = [...document.querySelectorAll("button")].find((x) => /lịch tập/i.test(x.innerText) && /Lưu|Cập nhật/.test(x.innerText)); const r = (e) => { if (!e) return null; const q = e.getBoundingClientRect(); return { l: Math.round(q.left), r: Math.round(q.right) }; };
    return { sw: document.documentElement.scrollWidth, iw: window.innerWidth, st: r(st), btn: r(b) }; });
  await shot(`9-viewport-${w}`);
  ok(m.sw <= m.iw + 1 && m.st && m.st.l >= 0 && m.st.r <= m.iw + 1 && m.btn && m.btn.l >= 0 && m.btn.r <= m.iw + 1, `viewport ${w}px: no horizontal scroll; sync status and save button within the screen`, JSON.stringify(m));
}
await page.setViewportSize({ width: 1280, height: 1100 }); await openPlan();

console.log("\n# K9-10 STALE response: a save answer that arrives AFTER the plan version changed must not paint a banner for the old version");
await adjustViaUi("Mỗi buổi 5 bài"); // plan -> v4, pending
s = await waitState("pending_sync"); ok(s.state === "pending_sync" && /Bản 4/.test(s.text), "plan v4 pending", JSON.stringify(s));
await page.route("**/save-to-workout-log", async (r) => { await sleep(6000); await r.continue(); }); // slow answer
await saveViaUi(); await sleep(800);
await page.getByRole("button", { name: /Quay lại phiên bản|Quay lại bản/ }).first().click({ timeout: 10000 }); // plan -> v5 while the save is still in flight
await sleep(9000); await shot("10-stale-response");
ok(/v5 COMPLETED perDay=4/.test(planState(A)), "backend: undo moved the plan to v5 (v3 content, 4/day) while the save was in flight", planState(A));
ok(await page.getByTestId("save-outcome").count() === 0, "NO success banner is shown for the old version when its answer arrives late");
// the slow request reached the server only AFTER the undo, so the server synced the LATEST plan (v5): the truthful state is synced v5
s = await waitState("synced"); ok(s.state === "synced" && /theo bản 5/.test(s.text) && /ai5/.test(progState()), "state recomputed from the server for the CURRENT plan: program really follows v5", JSON.stringify(s) + " " + progState());
ok(progCount() === "1", "still one program", progCount());
await page.unroute("**/save-to-workout-log");

console.log("\n# K9-11 TOKEN EXPIRY: 401 on save");
await page.route("**/save-to-workout-log", (r) => r.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ success: false, error: { code: "UNAUTHORIZED", message: "Token expired" } }) }));
await saveViaUi(); await sleep(3500); await shot("11-token-expiry");
const urlAfter = page.url();
console.log("  url after 401:", urlAfter);
ok(await page.getByTestId("save-outcome").count() === 0, "401 never produces a success banner");
ok(/v5/.test(planState(A)) && progCount() === "1", "401 wrote nothing", `${planState(A)} ${progCount()}`);
await page.unroute("**/save-to-workout-log");

console.log("\n# K9-12 Idempotency-Key on adjust requests: reused after network loss, renewed after a definitive server answer");
const adjKeys = []; page.on("request", (r) => { if (/\/plans\/adjust$/.test(r.url()) && r.method() === "POST") adjKeys.push(r.headers()["idempotency-key"] ?? null); });
const submitAdjust = async (text) => { const ta = page.getByPlaceholder(/Tăng bài chân/); if (!(await ta.isVisible().catch(() => false))) await page.getByRole("button", { name: /Điều chỉnh kế hoạch/ }).first().click({ timeout: 15000 }); await page.getByPlaceholder(/Tăng bài chân/).fill(text); await page.getByRole("button", { name: /Gửi điều chỉnh/ }).click(); };
await openPlan();
await page.route("**/plans/adjust", (r) => r.abort("failed")); // the request never gets an answer
await submitAdjust("Mỗi buổi 5 bài"); await sleep(1800);
await page.unroute("**/plans/adjust");
await page.getByRole("button", { name: /Gửi điều chỉnh/ }).click(); // same text, retried
await page.getByText("Đã điều chỉnh kế hoạch").first().waitFor({ timeout: 45000 }); await sleep(1500);
ok(adjKeys.length === 2 && adjKeys[0] && adjKeys[0] === adjKeys[1] && /^w-[A-Za-z0-9]+-/.test(adjKeys[0]), "network loss: the retry of the SAME action reuses the Idempotency-Key", JSON.stringify(adjKeys));
await page.route("**/plans/adjust", (r) => r.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ success: false, error: { code: "VALIDATION_ERROR", message: "Không thể điều chỉnh lúc này" } }) })); // a definitive answer
await submitAdjust("Mỗi buổi 6 bài"); await sleep(1800);
await page.unroute("**/plans/adjust");
await page.getByRole("button", { name: /Gửi điều chỉnh/ }).click();
await page.getByText("Đã điều chỉnh kế hoạch").first().waitFor({ timeout: 45000 }); await sleep(1500);
ok(adjKeys.length === 4 && adjKeys[2] && adjKeys[3] && adjKeys[2] !== adjKeys[3] && adjKeys[3] !== adjKeys[0], "a definitive server answer (409): the next attempt is a NEW action with a NEW key", JSON.stringify(adjKeys));
ok(/COMPLETED perDay=6/.test(planState(A)), "backend: the retried requests produced exactly the intended revision (6/day)", planState(A));
ok(PSQL(AI, `select count(*) from ai_generation_operations where target_id='${A}' and status in ('ADMITTED','PUBLISHED','RUNNING')`) === "0", "no operation left in flight");

console.log("\n  [net]", nets.join(" | "));
await browser.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
