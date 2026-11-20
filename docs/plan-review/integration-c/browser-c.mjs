// Integration C — REAL BROWSER (Chromium + Vite + gateway + auth/user/fitness/ai on disposable *_test DBs; ai model = stub). Real login form, real clicks.
// Setup of the Program/PT contract fixture is done by API (TEST FIXTURE); the AI revision, applying it, the review round-trip and undo are UI-driven.
import path from "node:path"; import os from "node:os"; import fs from "node:fs"; import { execSync } from "node:child_process"; import { createRequire } from "node:module";
const require = createRequire("C:/D_Backup/project_personal/fitness-assistant/.tmp-stack/deps/package.json"); const { chromium } = require("playwright-core");
const HERE = "C:/D_Backup/project_personal/fitness-assistant/docs/plan-review/integration-c"; fs.mkdirSync(`${HERE}/logs/shots`, { recursive: true });
const GW = "http://localhost:3000", WEB = "http://127.0.0.1:5173";
const AI = "revision_ai_test", FIT = "pr3_fitness_test", USR = "pr3_user_test";
const C = "11111111-1111-4111-8111-111111111111", P = "22222222-2222-4222-8222-222222222222";
const PSQL = (db, sql) => execSync(`docker exec gymcoach-test-postgres-test-1 psql -U gymcoach_test -d ${db} -Atc "${sql.replace(/"/g, '\\"')}"`, { encoding: "utf8" }).trim();
let pass = 0, fail = 0;
const ok = (c, m, extra = "") => { (c ? pass++ : fail++); console.log(`${c ? "PASS" : "FAIL"}  ${m}${c ? "" : "  <-- " + String(extra).slice(0, 300)}`); };
const tokens = JSON.parse(fs.readFileSync(`${HERE}/logs/tokens.json`, "utf8"));
const tok = (e) => tokens[e].token;
const api = async (m, p, t, b) => { const r = await fetch(GW + p, { method: m, headers: { "content-type": "application/json", authorization: `Bearer ${t}` }, body: b ? JSON.stringify(b) : undefined }); const j = await r.json().catch(() => ({})); return { status: r.status, json: j, data: j?.data ?? j }; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const planState = (id) => PSQL(AI, `select 'v'||version||' '||status||' perDay='||jsonb_array_length(plan->'weeklySchedule'->0->'exercises') from workout_plans where id='${id}'`);
const progState = () => PSQL(FIT, `select 'v'||version||' ai'||coalesce(ai_plan_version::text,'-') from workout_programs where user_id='${C}' and status='ACTIVE' order by created_at desc limit 1`);
const reviews = () => PSQL(FIT, `select coalesce(string_agg(status::text||'@v'||subject_version, ', ' order by submitted_at),'-') from plan_review_requests where client_user_id='${C}'`);

// reset + fixture
PSQL(AI, `delete from workout_plan_revisions; delete from ai_generation_operations; delete from published_plans; delete from workout_plans where user_id='${C}'`);
PSQL(FIT, `delete from plan_review_requests; delete from workouts where user_id='${C}'; delete from workout_schedules where user_id='${C}'; delete from workout_programs where user_id='${C}'`);
PSQL(USR, `delete from notifications; update contracts set status='ACTIVE'`); execSync("docker exec gymcoach-test-redis-test-1 redis-cli FLUSHALL"); fs.writeFileSync(`${HERE}/stub-control.json`, '{"mode":"ok"}');
const ct = tok("pr3.client@example.test"), pt = tok("pr3.pt@example.test");
const gen = await api("POST", "/plans/workout/generate", ct, { goal: "MUSCLE_GAIN", durationWeeks: 4, daysPerWeek: 4, exercisesPerDay: 4, trainingLocation: "GYM", equipmentPreference: "MIXED_GYM" });
const A = gen.data.planId; for (let i = 0; i < 30; i++) { await sleep(500); const j = await api("GET", `/plans/job/${gen.data.jobId}`, ct); if (j.data.status === "COMPLETED") break; }
const d = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
await api("POST", `/plans/${A}/save-to-workout-log`, ct, { startDate: d, repeatWeeks: 1, selectedWeekdays: [1, 2, 4, 5], replaceExisting: true });
const r1 = await api("POST", "/plan-reviews", ct, { ptUserId: P, expectedVersion: 1 }); await api("POST", `/plan-reviews/${r1.data.request.id}/decision`, pt, { decision: "APPROVE", note: "ok", expectedRevision: r1.data.request.revision });
console.log(`fixture: planId=${A} plan[${planState(A)}] program[${progState()}] reviews[${reviews()}]`);

const browser = await chromium.launch({ executablePath: path.join(os.homedir(), "AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe"), headless: true });
const login = async (email) => { const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } }); const page = await ctx.newPage(); page.on("dialog", (dlg) => void dlg.accept()); page.on("response", (r) => { if (/\/api\/(plans\/adjust|plans\/[0-9a-f-]+\/(save-to-workout-log|revert)|plan-reviews)/.test(r.url()) && r.request().method() !== "GET") console.log(`  [net] ${r.request().method()} ${r.url().replace(/^.*\/api/, "")} -> ${r.status()}`); }); await page.goto(WEB + "/login"); await page.fill('input[type="email"]', email); await page.fill('input[type="password"]', "Pr3Test!2026"); await page.click('button[type="submit"]'); await page.waitForURL(/\/(client|pt)\//, { timeout: 20000 }); return page; };
const shot = (p, n) => p.screenshot({ path: `${HERE}/logs/shots/${n}.png`, fullPage: true });
const text = (p) => p.innerText("body");
const client = await login("pr3.client@example.test"), ptPage = await login("pr3.pt@example.test");

// U1 AI revision from the UI
console.log("\n# U1 AI plan revision driven from the AI plans page");
await client.goto(WEB + "/client/plans"); await client.getByText("MUSCLE_GAIN Plan").first().waitFor({ timeout: 20000 }).catch(() => {});
await client.getByText("MUSCLE_GAIN Plan").first().click().catch(() => {});
await client.getByRole("button", { name: /Điều chỉnh kế hoạch/ }).first().click({ timeout: 15000 }).catch((e) => console.log("  (adjust button not found)", String(e).slice(0, 80)));
await client.getByPlaceholder(/Tăng bài chân/).fill("Mỗi buổi 8 bài"); await shot(client, "U1-adjust-panel");
await client.getByRole("button", { name: /Gửi điều chỉnh/ }).click();
const toastOk = await client.getByText("Đã điều chỉnh kế hoạch").first().waitFor({ timeout: 45000 }).then(() => true).catch(() => false);
await sleep(1500); await shot(client, "U1-after-adjust");
ok(toastOk, "U1 UI shows 'Đã điều chỉnh kế hoạch' after the job completes (polling by the OLD jobId contract)");
ok(/v2 COMPLETED perDay=8/.test(planState(A)) && PSQL(AI, `select count(*) from workout_plans where user_id='${C}'`) === "1", "U1 backend: SAME plan id, v2, 4x8, still ONE plan row (no 'Plan A.1' appeared in the list)", planState(A));
const list = await text(client);
ok((list.match(/MUSCLE_GAIN Plan/g) ?? []).length >= 1 && !/\(v\d\)/.test(list) && !/Thất bại \(1\)/.test(list), "U1 UI list shows no duplicate/failed placeholder plan", list.slice(list.indexOf("Đang xử lý"), list.indexOf("Đang xử lý") + 120).replace(/\n/g, " | "));
ok(await client.getByRole("button", { name: /Quay lại phiên bản|Quay lại bản/ }).first().isVisible().catch(() => false), "U1 UI still offers the Undo button (compat flag _metadata.revision.previousPlanId set by the in-place revision)");
ok(/perDay=8/.test(planState(A)) && /v1 ai1/.test(progState()), "U1 the Program in use is NOT changed by the AI revision itself", progState());

// U2 client applies the revision from the UI
console.log("\n# U2 apply the revised plan to the program (UI)");
await client.getByRole("button", { name: /Lưu vào lịch tập/ }).first().click();
await sleep(800); await shot(client, "U2-save-panel");
const panelButtons = await client.$$eval("button", (bs) => bs.map((b) => b.innerText.trim()).filter(Boolean));
console.log("  buttons:", JSON.stringify(panelButtons.filter((t) => /Lưu|Thứ|CN|T\d|Xác nhận|Hủy|Huỷ|Thay|Giữ/.test(t))));
// choose the same 4 weekdays if the panel asks for them, then confirm
for (const wd of ["T2", "T3", "T5", "T6"]) await client.getByRole("button", { name: wd, exact: true }).first().click({ timeout: 1500 }).catch(() => {});
const confirmBtn = client.getByRole("button", { name: "Lưu lịch tập", exact: true });
await confirmBtn.click({ timeout: 8000 }).catch((e) => console.log("  (confirm click issue)", String(e).slice(0, 80)));
await sleep(3500); await shot(client, "U2-after-save");
const saved = await text(client);
ok(/v2 ai2/.test(progState()), "U2 backend: the SAME program was updated in place (version 2, aiPlanVersion 2)", progState());
console.log("  UI message after save:", (saved.match(/Kế hoạch này đã được lưu[^\n]*|Đã lưu kế hoạch[^\n]*|đã cập nhật[^\n]*/i) ?? ["(none matched)"])[0]);
ok(/Kế hoạch này đã được lưu vào lịch tập trước đó/.test(saved), "U2 KNOWN GAP (documented, file not modified): AIPlansPage ignores contentSynced and still says 'đã được lưu … trước đó' although the program WAS updated");

// U3 workout page: stale approval -> resubmit -> PT approves -> approved (all UI)
console.log("\n# U3 review round-trip in the UI");
await client.goto(WEB + "/client/workout"); await client.getByText("PT duyệt kế hoạch").first().waitFor({ timeout: 20000 }).catch(() => {});
await shot(client, "U3-workout-outdated");
const w1 = await text(client);
ok(/Đã duyệt bản cũ — cần gửi lại/.test(w1) && /không\s*còn áp dụng/.test(w1.replace(/\s+/g, " ")), "U3 the Workout page says the earlier approval no longer applies (program v2)");
await client.getByRole("button", { name: "Gửi lại cho PT", exact: true }).click(); await client.getByRole("button", { name: "Xác nhận gửi", exact: true }).click();
await client.getByText("Đang chờ PT duyệt").first().waitFor({ timeout: 15000 }).catch(() => {});
ok(/APPROVED@v1, PENDING_REVIEW@v2/.test(reviews()), `U3 new request is bound to program v2 (${reviews()})`);
await ptPage.goto(WEB + "/pt/plan-reviews"); await ptPage.getByText("Học viên ·").first().click({ timeout: 20000 });
await ptPage.getByText(/Buổi 1|Ngày 1/).first().waitFor({ timeout: 15000 }).catch(() => {});
const ptTxt = await text(ptPage); await shot(ptPage, "U3-pt-detail");
ok((ptTxt.match(/hiệp/g) ?? []).length === 32, "U3 the PT sees the REVISED plan (4 days x 8 exercises = 32 rows in the snapshot)", String((ptTxt.match(/hiệp/g) ?? []).length));
await ptPage.getByRole("button", { name: "Duyệt", exact: true }).click(); await ptPage.getByText("Đã ghi nhận quyết định").first().waitFor({ timeout: 15000 }).catch(() => {});
ok(/APPROVED@v2$/.test(reviews()), `U3 PT approved v2 (${reviews()})`);
await client.reload(); await client.getByText("PT đã duyệt").first().waitFor({ timeout: 20000 }).catch(() => {}); await shot(client, "U3-client-approved");
ok((await text(client)).includes("PT đã duyệt"), "U3 client UI shows 'PT đã duyệt' for the current (updated) program");

// U4 undo from the UI -> same plan id, version still forward
console.log("\n# U4 undo from the UI");
await client.goto(WEB + "/client/plans"); await client.getByText("MUSCLE_GAIN Plan").first().click({ timeout: 20000 }).catch(() => {});
await client.getByRole("button", { name: /Quay lại phiên bản|Quay lại bản/ }).first().click({ timeout: 15000 }).catch((e) => console.log("  (undo not clickable)", String(e).slice(0, 80)));
await sleep(3000); await shot(client, "U4-after-undo");
ok(/v3 COMPLETED perDay=4/.test(planState(A)) && PSQL(AI, `select count(*) from workout_plans where user_id='${C}'`) === "1", "U4 undo restores content A into the SAME plan id; version 3 (monotonic); one plan row", planState(A));
ok(/APPROVED@v2$/.test(reviews()) && /v2 ai2/.test(progState()), "U4 the undo of the AI plan does not touch the Program or the approval until the client applies it again", `${progState()} / ${reviews()}`);

await browser.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
