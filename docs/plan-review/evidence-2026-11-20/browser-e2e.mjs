// REAL BROWSER: headless Chromium -> Vite (5173) -> gateway (3000) -> auth/user/fitness on disposable *_test DBs. Real login form, no injected tokens
// (except the single clearly-labelled token-expiry step). Program fixture is prepared by API (TEST FIXTURE), everything after is UI-driven.
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";
const require = createRequire("C:/D_Backup/project_personal/fitness-assistant/.tmp-stack/deps/package.json");
const { chromium } = require("playwright-core");
const SP = "C:/Users/ASUS/AppData/Local/Temp/claude/6757a24c7e7edf08/07249fb1-0c21-4885-b207-cbf1d09844a5/scratchpad";
const SHOTS = `${SP}/shots`; fs.mkdirSync(SHOTS, { recursive: true });
const WEB = "http://127.0.0.1:5173", GW = "http://localhost:3000";
const PSQL = (db, sql) => execSync(`docker exec gymcoach-test-postgres-test-1 psql -U gymcoach_test -d ${db} -Atc "${sql.replace(/"/g, '\\"')}"`, { encoding: "utf8" }).trim();
const C = "11111111-1111-4111-8111-111111111111", P = "22222222-2222-4222-8222-222222222222";
let pass = 0, fail = 0;
const ok = (c, m, extra = "") => { (c ? pass++ : fail++); console.log(`${c ? "PASS" : "FAIL"}  ${m}${c ? "" : "  <-- " + extra}`); };
const dbStatus = () => PSQL("pr3_fitness_test", `select coalesce(string_agg(status::text,',' order by submitted_at),'') from plan_review_requests where client_user_id='${C}'`);
const dbCount = () => Number(PSQL("pr3_fitness_test", `select count(*) from plan_review_requests where client_user_id='${C}'`));

async function api(method, p, token, body) {
  const r = await fetch(GW + p, { method, headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => ({})) };
}
const apiLogin = async (email) => (await (await fetch(GW + "/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: "Pr3Test!2026" }) })).json()).accessToken;

// ── fixture (TEST FIXTURE): a clean current program for the client; no review rows
PSQL("pr3_fitness_test", `delete from plan_review_requests; delete from workout_programs`);
const ctokApi = await apiLogin("pr3.client@example.test");
const exs = PSQL("pr3_fitness_test", "select id from exercises where status='PUBLISHED' order by exercise_name limit 3").split("\n");
const d3 = new Date(Date.now() + 86400000 * 3);
const mk = await api("POST", "/workouts/programs/manual", ctokApi, { name: "Kế hoạch E2E", durationWeeks: 2, daysPerWeek: 1, startDate: d3.toISOString().slice(0, 10), repeatWeeks: 1, selectedWeekdays: [d3.getUTCDay()], replaceExisting: true,
  days: [{ dayNumber: 1, title: "Ngày 1", exercises: [{ exerciseId: exs[0], sets: 3, reps: 10, restSeconds: 90 }, { exerciseId: exs[1], sets: 3, reps: 10, restSeconds: 90 }] }] });
const prog = mk.json.data.program, exId = prog.days[0].exercises[0].id;
console.log("fixture program", prog.id, "status", mk.status);

const browser = await chromium.launch({ executablePath: path.join(os.homedir(), "AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe"), headless: true });
async function newUser(email, vp = { width: 1280, height: 900 }) {
  const ctx = await browser.newContext({ viewport: vp });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("  [pageerror]", String(e).slice(0, 140)));
  page.on("response", (r) => { if (/plan-reviews/.test(r.url()) && r.request().method() !== "GET") console.log(`  [net] ${r.request().method()} ${r.url().replace(/^.*\/api/, "")} -> ${r.status()}`); });
  page.on("console", (m) => { if (m.type() === "error" && !/WebSocket/.test(m.text())) console.log("  [console.error]", m.text().slice(0, 160)); });
  await page.goto(WEB + "/login");
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', "Pr3Test!2026");
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/(client|pt)\//, { timeout: 20000 });
  return { ctx, page };
}
const shot = (page, name) => page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
const bodyText = (page) => page.innerText("body");
const btn = (page, name) => page.getByRole("button", { name, exact: true });

const client = await newUser("pr3.client@example.test");
const pt = await newUser("pr3.pt@example.test");
ok(/\/client\//.test(client.page.url()) && /\/pt\//.test(pt.page.url()), "real login form: client lands in /client, PT in /pt", `${client.page.url()} ${pt.page.url()}`);

// ── A1.1 client opens the current Workout Plan
console.log("\n# client opens the current plan");
await client.page.goto(WEB + "/client/workout");
await client.page.getByText("PT duyệt kế hoạch").first().waitFor({ timeout: 20000 }).catch(() => {});
await shot(client.page, "01-client-plan");
let txt = await bodyText(client.page);
ok(txt.includes("Kế hoạch E2E") && txt.includes("PT duyệt kế hoạch"), "client sees the current program and the 'PT duyệt kế hoạch' panel");
ok(await btn(client.page, "Gửi PT duyệt").isVisible(), "'Gửi PT duyệt' button is offered (ACTIVE contract exists)");

// ── A1.2 send to PT, with a double-click on confirm
console.log("\n# client submits (double-click)");
await btn(client.page, "Gửi PT duyệt").click();
txt = await bodyText(client.page);
ok(/bản sao cố định/.test(txt) && /không\s*kèm chỉ số InBody/.test(txt.replace(/\s+/g, " ")), "confirmation step states what is shared (no InBody/health data)");
await shot(client.page, "02-client-confirm");
const confirmBtn = btn(client.page, "Xác nhận gửi");
await Promise.all([confirmBtn.click(), confirmBtn.click({ force: true, noWaitAfter: true }).catch(() => {})]);
await client.page.getByText("Đang chờ PT duyệt").first().waitFor({ timeout: 15000 }).catch(() => {});
ok(dbCount() === 1, `double-click on 'Xác nhận gửi' created exactly ONE request (DB rows=${dbCount()})`);
ok((await bodyText(client.page)).includes("Đang chờ PT duyệt"), "client UI shows 'Đang chờ PT duyệt'");
ok(await btn(client.page, "Huỷ yêu cầu").isVisible() && !(await btn(client.page, "Gửi PT duyệt").isVisible().catch(() => false)), "while open: only 'Huỷ yêu cầu' (no second submit)");
await shot(client.page, "03-client-pending");

// refresh keeps the state (server is the source of truth)
await client.page.reload();
await client.page.getByText("Đang chờ PT duyệt").first().waitFor({ timeout: 20000 }).catch(() => {});
ok((await bodyText(client.page)).includes("Đang chờ PT duyệt"), "after page refresh the state is still 'Đang chờ PT duyệt' (server state)");

// ── A1.3 PT receives and requests changes
console.log("\n# PT receives, views, requests changes");
await pt.page.goto(WEB + "/pt/plan-reviews");
await pt.page.getByText("Học viên ·").first().waitFor({ timeout: 20000 }).catch(() => {});
txt = await bodyText(pt.page);
ok(txt.includes("Kế hoạch chờ duyệt") && /Mới gửi/.test(txt), "PT inbox lists the new request ('Mới gửi')");
await pt.page.getByText("Học viên ·").first().click();
await pt.page.getByText("Kế hoạch E2E").first().waitFor({ timeout: 15000 }).catch(() => {});
txt = await bodyText(pt.page);
ok(/Ngày 1|Buổi 1/.test(txt) && !/inbody|userProfile/i.test(txt), "PT sees the plan snapshot (days/exercises), no body/health data");
await shot(pt.page, "04-pt-detail");
const rcBtn = btn(pt.page, "Yêu cầu chỉnh sửa");
ok(await rcBtn.isDisabled(), "'Yêu cầu chỉnh sửa' is disabled without a note");
await pt.page.getByPlaceholder(/Nhận xét/).fill("Thêm một bài vai ở buổi 1");
ok(!(await rcBtn.isDisabled()), "enabled once a note is typed");
await rcBtn.click();
await pt.page.getByText("Đã ghi nhận quyết định").first().waitFor({ timeout: 15000 }).catch(() => {});
ok(dbStatus() === "CHANGES_REQUESTED", `DB: CHANGES_REQUESTED (${dbStatus()})`);
await pt.page.waitForTimeout(1500);
ok(/Chưa có kế hoạch nào đang chờ bạn duyệt/.test(await bodyText(pt.page)), "item left the PT inbox after the decision");
await shot(pt.page, "05-pt-after-decision");

// ── A1.4 client sees feedback without reload (window focus refetch) and resubmits
console.log("\n# client sees feedback; re-sends");
await client.page.evaluate(() => { window.dispatchEvent(new Event("focus")); document.dispatchEvent(new Event("visibilitychange")); });
await client.page.getByText("PT yêu cầu chỉnh sửa").first().waitFor({ timeout: 10000 }).catch(() => {});
let seen = (await bodyText(client.page)).includes("PT yêu cầu chỉnh sửa");
if (!seen) { await client.page.reload(); await client.page.getByText("PT yêu cầu chỉnh sửa").first().waitFor({ timeout: 20000 }).catch(() => {}); }
txt = await bodyText(client.page);
ok(/PT yêu cầu chỉnh sửa/.test(txt) && txt.includes("Thêm một bài vai ở buổi 1"), `client sees the PT's status and feedback note (${seen ? "via focus refetch, no reload" : "after reload"})`);
await shot(client.page, "06-client-feedback");
ok(await btn(client.page, "Gửi lại cho PT").isVisible(), "'Gửi lại cho PT' is offered");
await btn(client.page, "Gửi lại cho PT").click();
await btn(client.page, "Xác nhận gửi").click();
await client.page.getByText("Đang chờ PT duyệt").first().waitFor({ timeout: 15000 }).catch(() => {});
ok(dbStatus() === "CHANGES_REQUESTED,PENDING_REVIEW", `resubmission is a NEW request; history kept (${dbStatus()})`);

// ── A1.5 stale: client edits the plan while the PT has the request open -> PT approval must fail
console.log("\n# stale approval (client edits the plan while PT is looking)");
await pt.page.goto(WEB + "/pt/plan-reviews");
await pt.page.getByText("Học viên ·").first().click();
await pt.page.getByText("Kế hoạch E2E").first().waitFor({ timeout: 15000 }).catch(() => {});
const edit = await api("PATCH", `/workouts/program-exercises/${exId}`, ctokApi, { reps: 15 });
ok(edit.status === 200, "client edits the plan via API while the PT page is open (fixture action)");
await btn(pt.page, "Duyệt").click();
await pt.page.waitForTimeout(2500);
txt = await bodyText(pt.page);
ok(/đã thay đổi|đã chỉnh sửa|đã được thay thế/i.test(txt), "PT sees a clear 'plan changed' message instead of success", txt.slice(0, 200));
ok(!/APPROVED/.test(dbStatus()), `nothing was approved (${dbStatus()})`);
await shot(pt.page, "07-pt-stale");

// ── A1.6 client resends the changed plan; PT approves; client sees it
console.log("\n# resend changed plan -> PT approves -> client sees APPROVED");
await client.page.reload();
await client.page.getByRole("button", { name: /Gửi lại cho PT|Gửi PT duyệt/ }).first().waitFor({ timeout: 20000 }).catch(() => {});
await shot(client.page, "08-client-after-stale");
await client.page.getByRole("button", { name: /Gửi lại cho PT|Gửi PT duyệt/ }).first().click();
await btn(client.page, "Xác nhận gửi").click();
await client.page.getByText("Đang chờ PT duyệt").first().waitFor({ timeout: 15000 }).catch(() => {});
await pt.page.goto(WEB + "/pt/plan-reviews");
await pt.page.getByText("Học viên ·").first().click();
await pt.page.getByText("Kế hoạch E2E").first().waitFor({ timeout: 15000 }).catch(() => {});
await btn(pt.page, "Duyệt").click();
await pt.page.getByText("Đã ghi nhận quyết định").first().waitFor({ timeout: 15000 }).catch(() => {});
ok(/APPROVED$/.test(dbStatus()), `DB: latest request APPROVED (${dbStatus()})`);
await client.page.reload();
await client.page.getByText("PT đã duyệt").first().waitFor({ timeout: 20000 }).catch(() => {});
ok((await bodyText(client.page)).includes("PT đã duyệt"), "client UI shows 'PT đã duyệt' for the unchanged current plan");
await shot(client.page, "09-client-approved");

// ── A1.7 approval no longer applies after another edit
const edit2 = await api("PATCH", `/workouts/program-exercises/${exId}`, ctokApi, { reps: 8 });
await client.page.reload();
await client.page.getByText(/không còn áp dụng|cần gửi lại/).first().waitFor({ timeout: 20000 }).catch(() => {});
txt = await bodyText(client.page);
ok(edit2.status === 200 && /không\s*còn áp dụng/.test(txt.replace(/\s+/g, " ")), "after the plan is edited the UI says the earlier approval no longer applies");
ok(!(await client.page.getByText("PT đã duyệt", { exact: true }).isVisible().catch(() => false)), "UI no longer shows a plain 'PT đã duyệt' badge for the changed plan");
await shot(client.page, "10-client-outdated");

// ── A1.8 token expiry (INJECTED 401s = TEST FIXTURE for expiry; the app's real handling is what is observed)
console.log("\n# token expired (injected 401 on /plan-reviews and /auth/refresh)");
await client.page.route(/\/api\/plan-reviews/, (r) => r.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ success: false, error: { code: "UNAUTHORIZED", message: "expired" } }) }));
await client.page.route(/\/api\/auth\/refresh/, (r) => r.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: "invalid refresh" }) }));
const before = dbCount();
await client.page.reload();
await client.page.waitForTimeout(6000);
const u = client.page.url(); txt = await bodyText(client.page);
ok(/\/login/.test(u) || /đăng nhập|hết hạn|Phiên/i.test(txt), `expired session: app sends the user to login / shows a session message (${u})`, txt.slice(0, 150));
ok(dbCount() === before, "no request was created while unauthorized");
await shot(client.page, "11-client-token-expired");
await client.page.unroute(/\/api\/plan-reviews/); await client.page.unroute(/\/api\/auth\/refresh/);

// ── mobile viewports for the client panel
console.log("\n# responsive (client panel)");
for (const w of [360, 390]) {
  const m = await newUser("pr3.client@example.test", { width: w, height: 800 });
  await m.page.goto(WEB + "/client/workout");
  await m.page.getByText("PT duyệt kế hoạch").first().waitFor({ timeout: 20000 }).catch(() => {});
  const overflow = await m.page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  ok(!overflow && (await m.page.getByText("PT duyệt kế hoạch").first().isVisible()), `${w}px: panel visible, no horizontal overflow`);
  await shot(m.page, `12-client-${w}`);
  await m.ctx.close();
}

await browser.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
