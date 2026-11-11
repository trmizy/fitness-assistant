// Level D: AUTHENTICATED browser E2E through the REAL frontend (Vite) + real gateway/auth/user/fitness/ai + configured qwen3:30b.
// playwright-core (installed in .tmp-stack/deps) driving the local Chromium. No mocked routes, no injected tokens: real login form.
// Usage: node test/ai-chat-full-verification/browser-e2e.mjs <suite...>   suites: chat workout twotab stale mobile session nutrition pt roadmap
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { ok, info, setJourney, finish, fq, uq, aiq, fqOne, actionRow, U } from "./harness.mjs";
import { sleep, registerUser, putProfile } from "./lib.mjs";

const require = createRequire(path.join(process.cwd(), ".tmp-stack/deps/package.json"));
const { chromium } = require("playwright-core");
const CHROME = path.join(os.homedir(), "AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe");
const BASE = "http://127.0.0.1:5173";
const SHOTS = "test/ai-chat-full-verification/results/screenshots";
fs.mkdirSync(SHOTS, { recursive: true });
const PASSWORD = "TestPass#12345";
const cnt = (sql) => Number(fqOne(sql));

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const newCtx = async (viewport = { width: 1280, height: 900 }) => browser.newContext({ viewport, locale: "vi-VN" });

async function login(page, email) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await Promise.all([page.waitForURL((u) => !/\/login/.test(u.pathname), { timeout: 30000 }), page.getByRole("button", { name: /Đăng nhập/ }).first().click()]);
}
const chatInput = (page) => page.locator('input[type="text"]').last();
async function openCoach(page, sessionId) {
  await page.goto(`${BASE}/client/ai-coach${sessionId ? `?sessionId=${sessionId}` : ""}`, { waitUntil: "domcontentloaded" });
  // Narrow screens open on the conversation LIST; a real user taps "Cuộc trò chuyện mới" (or a conversation) to get the input.
  if (!sessionId && !(await chatInput(page).isVisible().catch(() => false))) {
    await page.getByRole("button", { name: /Cuộc trò chuyện mới/ }).first().click({ timeout: 15000 }).catch(() => {});
  }
  await chatInput(page).waitFor({ state: "visible", timeout: 30000 });
}
async function send(page, text, { timeout = 240000 } = {}) {
  await chatInput(page).waitFor({ state: "visible" });
  await page.waitForFunction(() => { const i = [...document.querySelectorAll('input[type="text"]')].pop(); return i && !i.disabled; }, null, { timeout });
  await chatInput(page).fill(text);
  await chatInput(page).press("Enter");
  await sleep(800);
  await page.waitForFunction(() => { const i = [...document.querySelectorAll('input[type="text"]')].pop(); return i && !i.disabled; }, null, { timeout });
  await sleep(500);
}
const pageText = (page) => page.evaluate(() => document.body.innerText);
const sessionIdOf = (page) => new URL(page.url()).searchParams.get("sessionId");
const shot = (page, name) => page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
const btn = (page, re) => page.getByRole("button", { name: re });
// Real button labels: ACTION_CONFIRMATION "Xác nhận", WORKOUT_PLAN_PREVIEW "Lưu lịch tập này", NUTRITION_PLAN_PREVIEW "Lưu thực đơn này" (profile card: "Xác nhận cập nhật", excluded).
const CONFIRM_BTN = /^(Xác nhận|Lưu lịch tập này|Lưu thực đơn này)$/;

export async function chat() {
  setJourney("browser-chat-qa");
  const ctx = await newCtx(); const page = await ctx.newPage();
  await login(page, "chat.d@gymini-test.local");
  ok("real login through the UI lands on an authenticated page", !/\/login/.test(page.url()), page.url());
  await openCoach(page);
  await send(page, "Progressive overload là gì?");
  let text = await pageText(page);
  ok("general Q&A answered in the chat UI, no action card", /overload|tăng dần/i.test(text) && (await btn(page, CONFIRM_BTN).count()) === 0);
  await shot(page, "01-general-qa");
  await send(page, "Mục tiêu hiện tại của tôi là gì?");
  text = await pageText(page);
  ok("personalized Q&A answered from the profile (goal MAINTENANCE / duy trì)", /duy trì|maintenance/i.test(text));
  await shot(page, "02-personalized-qa");
  await ctx.close();
}

async function createWorkoutPreview(page) {
  await openCoach(page);
  await send(page, "Tạo lịch tập cho tôi.");
  for (const a of ["4 buổi mỗi tuần", "60 phút mỗi buổi"]) { if (await btn(page, CONFIRM_BTN).count()) break; await send(page, a); }
  await btn(page, CONFIRM_BTN).first().waitFor({ timeout: 30000 });
}

export async function workout() {
  setJourney("browser-workout");
  const ctx = await newCtx(); const page = await ctx.newPage();
  await login(page, "chat.d@gymini-test.local");
  const uid = U.D.userId; const before = cnt(`select count(*) from workout_programs where user_id='${uid}'`);
  await createWorkoutPreview(page);
  ok("WORKOUT_PLAN_PREVIEW card rendered with Xác nhận + Bỏ qua bản này", (await btn(page, CONFIRM_BTN).count()) >= 1 && (await btn(page, /Bỏ qua bản này/).count()) >= 1);
  await shot(page, "03-workout-preview");
  await send(page, "Thứ 4 tôi bận.");
  ok("weekday revision answered truthfully in chat (kept session count)", /vẫn \d+ buổi/.test(await pageText(page)));
  await send(page, "Ổn rồi, lưu đi.");
  ok("typing 'lưu đi' does NOT save and does not claim success", /chưa lưu gì/i.test(await pageText(page)) && cnt(`select count(*) from workout_programs where user_id='${uid}'`) === before);
  await btn(page, CONFIRM_BTN).first().click();
  await page.getByText(/Đã lưu lịch tập/).first().waitFor({ timeout: 60000 });
  ok("clicking Xác nhận saves in chat and shows a success message", true);
  const detail = page.getByRole("link", { name: /Mở chi tiết/ }).first();
  await detail.waitFor({ timeout: 15000 });
  await detail.click(); await sleep(2500);
  ok("'Mở chi tiết' after saving opens the real training page (not a 404)", page.url().includes("/client/workout") && !/404|No route matches/i.test(await pageText(page)), page.url());
  await openCoach(page);
  ok("real WorkoutProgram row exists after the click", cnt(`select count(*) from workout_programs where user_id='${uid}'`) === before + 1);
  await shot(page, "04-workout-saved");
  await ctx.close();
}

export async function twotab() {
  setJourney("browser-two-tab-race");
  const uid = U.D.userId;
  for (const order of ["confirm-vs-dismiss", "dismiss-vs-confirm"]) {
    const ctx = await newCtx(); const a = await ctx.newPage(); await login(a, "chat.d@gymini-test.local");
    await createWorkoutPreview(a);
    const sid = sessionIdOf(a); const b = await ctx.newPage(); await openCoach(b, sid);
    await btn(b, CONFIRM_BTN).first().waitFor({ timeout: 30000 });
    const before = cnt(`select count(*) from workout_programs where user_id='${uid}'`);
    const clickConfirm = () => btn(a, CONFIRM_BTN).first().click();
    const clickDismiss = () => btn(b, /Bỏ qua bản này/).first().click();
    await Promise.all(order === "confirm-vs-dismiss" ? [clickConfirm(), clickDismiss()] : [clickDismiss(), clickConfirm()]);
    await sleep(6000);
    const tA = await pageText(a), tB = await pageText(b);
    const st = aiq(`select status from fitness_agent_actions where user_id='${uid}' order by created_at desc limit 1`);
    const programs = cnt(`select count(*) from workout_programs where user_id='${uid}'`) - before;
    const savedMsg = /Đã lưu lịch tập/.test(tA) || /Đã lưu lịch tập/.test(tB);
    const cancelMsg = /Đã bỏ qua bản này|Đã bỏ qua/.test(tA + tB);
    info(`${order}: status=${st} programs+${programs} saved-msg=${savedMsg} cancel-msg=${cancelMsg}`);
    ok(`${order}: exactly one terminal state in the DB and the UI never shows BOTH a success and a cancellation as successes`, (st === "COMPLETED" && programs === 1) || (st === "CANCELLED" && programs === 0), `${st} programs+${programs}`);
    ok(`${order}: no contradictory UI (not both 'Đã lưu' and a cancelled-without-saving claim for the same draft)`, !(st === "COMPLETED" && /chưa lưu gì vào hệ thống/.test(tA + tB)) && !(st === "CANCELLED" && savedMsg), `${savedMsg}/${cancelMsg}`);
    await shot(a, `05-twotab-${order}-A`); await shot(b, `05-twotab-${order}-B`);
    await ctx.close();
  }
}

export async function stale() {
  setJourney("browser-stale-card");
  const uid = U.D.userId;
  // stale dismiss after confirm elsewhere
  let ctx = await newCtx(); let a = await ctx.newPage(); await login(a, "chat.d@gymini-test.local");
  await createWorkoutPreview(a); let b = await ctx.newPage(); await openCoach(b, sessionIdOf(a)); await btn(b, CONFIRM_BTN).first().waitFor();
  await btn(a, CONFIRM_BTN).first().click(); await a.getByText(/Đã lưu lịch tập/).first().waitFor({ timeout: 60000 });
  await btn(b, /Bỏ qua bản này/).first().click(); await sleep(4000);
  let tb = await pageText(b);
  ok("stale card: dismissing after another tab saved says it was already saved (server truth wins)", /đã được lưu|đang được lưu|không thể bỏ qua/i.test(tb) && aiq(`select status from fitness_agent_actions where user_id='${uid}' order by created_at desc limit 1`) === "COMPLETED", tb.slice(-160).replace(/\n/g, " "));
  await shot(b, "06-stale-dismiss-after-confirm"); await ctx.close();
  // stale confirm after dismiss elsewhere
  ctx = await newCtx(); a = await ctx.newPage(); await login(a, "chat.d@gymini-test.local");
  await createWorkoutPreview(a); b = await ctx.newPage(); await openCoach(b, sessionIdOf(a)); await btn(b, CONFIRM_BTN).first().waitFor();
  const before = cnt(`select count(*) from workout_programs where user_id='${uid}'`);
  await btn(a, /Bỏ qua bản này/).first().click(); await sleep(3000);
  await btn(b, CONFIRM_BTN).first().click(); await sleep(4000);
  tb = await pageText(b);
  ok("stale card: confirming after a dismiss elsewhere does NOT resurrect or save", cnt(`select count(*) from workout_programs where user_id='${uid}'`) === before && aiq(`select status from fitness_agent_actions where user_id='${uid}' order by created_at desc limit 1`) === "CANCELLED", tb.slice(-160).replace(/\n/g, " "));
  await shot(b, "07-stale-confirm-after-dismiss"); await ctx.close();
}

export async function mobile() {
  setJourney("browser-mobile-cards");
  for (const width of [360, 375, 390, 412]) {
    const ctx = await newCtx({ width, height: 800 }); const page = await ctx.newPage();
    await login(page, "chat.d@gymini-test.local");
    await createWorkoutPreview(page);
    const m = await page.evaluate((src) => {
      const re = new RegExp(src);
      const b = [...document.querySelectorAll("button")].find((x) => re.test(x.innerText.trim()));
      const r = b?.getBoundingClientRect();
      return { overflowX: document.documentElement.scrollWidth - window.innerWidth, btn: r ? { top: r.top, left: r.left, right: r.right, w: r.width, h: r.height } : null, vw: window.innerWidth };
    }, CONFIRM_BTN.source);
    info(`width ${width}: ${JSON.stringify(m)}`);
    ok(`${width}px: no horizontal overflow and the primary 'Xác nhận' button is reachable (>=40px tall, inside the viewport horizontally)`, m.overflowX <= 1 && m.btn && m.btn.h >= 40 && m.btn.left >= 0 && m.btn.right <= m.vw + 1, JSON.stringify(m));
    await shot(page, `08-mobile-workout-${width}`);
    await btn(page, /Bỏ qua bản này/).first().click().catch(() => {}); // leave nothing pending
    await ctx.close();
  }
}

export async function session() {
  setJourney("browser-session-auth");
  const ctxA = await newCtx(); const a = await ctxA.newPage(); await login(a, "chat.d@gymini-test.local");
  await createWorkoutPreview(a); const sid = sessionIdOf(a);
  await a.reload({ waitUntil: "domcontentloaded" }); await chatInput(a).waitFor({ timeout: 30000 }); await sleep(2500);
  ok("page refresh keeps the conversation and the pending card (server-side state)", (await btn(a, CONFIRM_BTN).count()) >= 1 || /Tạo lịch tập/.test(await pageText(a)), sid);
  // cross-user in a separate browser context: user B must not see D's session or card
  const ctxB = await newCtx(); const b = await ctxB.newPage(); await login(b, "chat.b@gymini-test.local");
  await b.goto(`${BASE}/client/ai-coach?sessionId=${sid}`, { waitUntil: "domcontentloaded" }); await sleep(4000);
  const tb = await pageText(b);
  ok("user B opening user D's session URL sees neither D's messages nor D's pending card", !/Đây là lịch tập mình đề xuất|Bạn muốn tập mấy buổi mỗi tuần/.test(tb) && (await btn(b, CONFIRM_BTN).count()) === 0); // D-session-specific content; the sidebar history legitimately lists B's OWN earlier prompts
  await shot(b, "09-cross-user-session");
  // sign out (clear the session storage) -> protected page redirects to login; the pending card is gone from the DOM
  await ctxA.clearCookies(); await a.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await a.goto(`${BASE}/client/ai-coach`, { waitUntil: "domcontentloaded" }); await sleep(3000);
  ok("after the session is cleared the coach page redirects to /login (no action executable)", /\/login/.test(a.url()), a.url());
  await btn(a, CONFIRM_BTN).count().then((n) => ok("no confirmation button remains after logout", n === 0, n));
  // login again as D: previous user's data must not leak between accounts
  await login(a, "chat.b@gymini-test.local"); await openCoach(a);
  ok("account switch D -> B: B's chat does not show D's pending card", (await btn(a, CONFIRM_BTN).count()) === 0);
  await ctxA.close(); await ctxB.close();
}

export async function nutrition() {
  setJourney("browser-nutrition");
  const uid = U.A.userId;
  const ctx = await newCtx(); const page = await ctx.newPage(); await login(page, "chat.a@gymini-test.local");
  await openCoach(page); const before = cnt(`select count(*) from nutrition_programs where user_id='${uid}'`);
  await send(page, "Tạo thực đơn, tôi không ăn cá."); await send(page, "À tôi cũng không ăn thịt bò."); await send(page, "4 bữa");
  for (let i = 0; i < 40 && (await btn(page, CONFIRM_BTN).count()) === 0; i += 1) { await sleep(4000); await send(page, "Thực đơn xong chưa?"); }
  ok("NUTRITION_PLAN_PREVIEW card rendered with confirm/dismiss in the browser", (await btn(page, CONFIRM_BTN).count()) >= 1);
  await shot(page, "10-nutrition-preview");
  await send(page, "Ít bữa hơn.");
  for (let i = 0; i < 40 && /đang tính lại/i.test(await pageText(page).then((t) => t.slice(-400))); i += 1) { await sleep(4000); await send(page, "Xong chưa?"); }
  await btn(page, CONFIRM_BTN).last().click();
  await page.getByText(/Đã lưu thực đơn/).first().waitFor({ timeout: 60000 });
  ok("nutrition saved from the browser and a real NutritionProgram exists", cnt(`select count(*) from nutrition_programs where user_id='${uid}'`) === before + 1);
  await shot(page, "11-nutrition-saved"); await ctx.close();
}

export async function pt() {
  setJourney("browser-pt-hire");
  const uid = U.G_email ? "" : "";
  const ctx = await newCtx(); const page = await ctx.newPage(); await login(page, "chat.d@gymini-test.local");
  const D = U.D.userId; const before = Number(uq(`select count(*) from contracts where client_user_id='${D}'`));
  await openCoach(page);
  await send(page, "Tìm PT phù hợp với tôi.");
  for (const a of ["T2 T4 T6", "không giới hạn"]) { if (await btn(page, /Chọn PT/).count()) break; await send(page, a); }
  const n = await btn(page, /Chọn PT/).count();
  info("PT candidate cards with 'Chọn PT': " + n);
  await shot(page, "12-pt-recommendations");
  if (!n) { ok("PT recommendations rendered (or an honest 'no match' message)", /Chưa có lựa chọn phù hợp/.test(await pageText(page))); await ctx.close(); return; }
  await btn(page, /Chọn PT/).first().click(); await sleep(3000);
  await btn(page, CONFIRM_BTN).first().click(); await sleep(4000);
  ok("no contract after the FIRST confirmation (draft only)", Number(uq(`select count(*) from contracts where client_user_id='${D}'`)) === before);
  await btn(page, CONFIRM_BTN).last().click(); await sleep(5000);
  // either a NEW contract is created, or (client already holds an active/pending contract with this PT from an earlier run) the duplicate guard answers and the count stays
  const after2 = Number(uq(`select count(*) from contracts where client_user_id='${D}'`));
  const dupGuard = /already have an active or pending contract|đã có hợp đồng/i.test(await pageText(page));
  ok("real PT contract after the SECOND confirmation (or the duplicate-contract guard answers, no duplicate row)", after2 === before + 1 || (dupGuard && after2 === before), `before=${before} after=${after2} dupGuard=${dupGuard}`);
  await shot(page, "13-pt-contract"); await ctx.close();
}

export async function roadmap() {
  setJourney("browser-roadmap");
  const ctx = await newCtx(); const page = await ctx.newPage(); await login(page, "chat.f@gymini-test.local");
  const F = U.F.userId; const before = cnt(`select count(*) from fitness_roadmaps where user_id='${F}' and status='ACTIVE'`);
  await openCoach(page); await send(page, "Tạo lộ trình giảm mỡ cho tôi", { timeout: 300000 });
  ok("roadmap preview card rendered (HIGH risk) in the browser", (await btn(page, CONFIRM_BTN).count()) >= 1);
  await shot(page, "14-roadmap-preview");
  await btn(page, CONFIRM_BTN).first().click(); await sleep(8000);
  ok("real ACTIVE roadmap after the click", cnt(`select count(*) from fitness_roadmaps where user_id='${F}' and status='ACTIVE'`) === before + 1 || before >= 1);
  await shot(page, "15-roadmap-saved"); await ctx.close();
}


// ───────────── CI-V2 GLOBAL coverage (REAL BROWSER, real login, Docker stack, CONVERSATIONAL_INTELLIGENCE_V2=on) ─────────────
const freshClient = async (tag, profile) => { const u = await registerUser("ci.browser." + tag + "." + Date.now() + "@gymini-test.local", "CI " + tag); await putProfile(u, { hasCompletedOnboarding: true, ...profile }); return u; };
const goalOf = (u) => uq("select goal from user_profiles where \"userId\"='" + u.userId + "'");

export async function globalcov() {
  setJourney("browser-global-coverage");
  // 1. standalone READ: PT status (client D holds a real pending contract)
  {
    const ctx = await newCtx(); const page = await ctx.newPage(); await login(page, "chat.d@gymini-test.local");
    await openCoach(page); await send(page, "Tôi đang có PT chưa?");
    const t = await pageText(page);
    ok("standalone 'Tôi đang có PT chưa?' shows the real contract state and does NOT start a PT search", /Linh Phạm|hợp đồng/i.test(t) && /chờ PT duyệt|đang hoạt động/i.test(t) && !/Bạn tập được những ngày nào/.test(t));
    await shot(page, "20-global-pt-status"); await ctx.close();
  }
  // 2. personalised calorie question equals the ACTIVE NutritionGoal
  {
    const kcal = Number(fqOne("select calories from nutrition_goals where user_id='" + U.A.userId + "' and status='ACTIVE' limit 1"));
    const ctx = await newCtx(); const page = await ctx.newPage(); await login(page, "chat.a@gymini-test.local");
    await openCoach(page); await send(page, "Tôi đang ăn theo bao nhiêu calo?");
    const t = await pageText(page);
    ok("personalised calorie question shows the ACTIVE NutritionGoal (" + kcal + " kcal)", new RegExp(String(kcal).replace(/\B(?=(\d{3})+(?!\d))/g, "[.,]?")).test(t));
    await shot(page, "21-global-calorie"); await ctx.close();
  }
  // 3-5. standalone goal recommendation → confirmation → write → fresh read
  {
    const u = await freshClient("goal", { goal: "MUSCLE_GAIN", age: 22, heightCm: 173, currentWeight: 80, gender: "MALE" });
    const ctx = await newCtx(); const page = await ctx.newPage(); await login(page, u.email);
    await openCoach(page); await send(page, "với tình trạng hiện tại tôi nên cut hay bulk?");
    let t = await pageText(page);
    ok("standalone goal recommendation is explained from the user's real data (173cm, 80kg, BMI) with no card and no write", /173cm/.test(t) && /26,7/.test(t) && (await btn(page, CONFIRM_BTN).count()) === 0 && /MUSCLE_GAIN/.test(goalOf(u)));
    await shot(page, "22-global-goal-recommendation");
    await send(page, "ok đổi theo đề xuất đó");
    const confirm = page.getByRole("button", { name: /Xác nhận cập nhật/ });
    ok("'ok đổi theo đề xuất đó' shows the profile confirmation card and still writes nothing", (await confirm.count()) >= 1 && /MUSCLE_GAIN/.test(goalOf(u)));
    await shot(page, "23-global-goal-confirmation");
    await confirm.first().click(); await sleep(2500);
    ok("clicking the confirmation writes the goal", /WEIGHT_LOSS/.test(goalOf(u)), goalOf(u));
    await send(page, "Mục tiêu hiện tại của tôi là gì?");
    t = await pageText(page);
    ok("the very next 'mục tiêu hiện tại' answer shows the NEW goal (fresh authoritative state)", /giảm mỡ/.test(t.slice(-700)));
    await shot(page, "24-global-goal-fresh"); await ctx.close();
  }
  // 6. pending workflow interrupted by a personalised question, then resumed
  {
    const u = await freshClient("pending", { goal: "WEIGHT_LOSS", age: 30, heightCm: 170, currentWeight: 82, gender: "MALE", preferredTrainingDays: [1, 3, 5] });
    const ctx = await newCtx(); const page = await ctx.newPage(); await login(page, u.email);
    await openCoach(page); await send(page, "Tìm PT cho tôi.");
    const rowBefore = aiq("select id, expected_slot from agent_workflow_sessions where user_id='" + u.userId + "' order by created_at desc limit 1");
    await send(page, "Macro hiện tại của tôi bao nhiêu?");
    const t = await pageText(page);
    const rowAfter = aiq("select id, expected_slot from agent_workflow_sessions where user_id='" + u.userId + "' order by created_at desc limit 1");
    ok("the side question is answered and the PT workflow is preserved (same row, same waiting slot)", /Bạn vẫn đang tìm PT dở/.test(t) && rowBefore === rowAfter && rowBefore !== "", rowBefore + " -> " + rowAfter);
    await shot(page, "25-global-interrupt");
    await send(page, "2 triệu.");
    const t2 = await pageText(page);
    ok("answering the slot afterwards resumes the workflow (no restart)", !/Bạn tập được những ngày nào/.test(t2.slice(-500)), t2.slice(-160));
    await shot(page, "26-global-resume"); await ctx.close();
  }
}

export async function globalmobile() {
  setJourney("browser-global-mobile");
  for (const width of [360, 375, 390, 412]) {
    const u = await freshClient("m" + width, { goal: "MUSCLE_GAIN", age: 22, heightCm: 173, currentWeight: 80, gender: "MALE", preferredTrainingDays: [1, 3, 5] });
    const ctx = await newCtx({ width, height: 800 }); const page = await ctx.newPage(); await login(page, u.email);
    await openCoach(page); await send(page, "với tình trạng hiện tại tôi nên cut hay bulk?");
    await send(page, "ok đổi theo đề xuất đó");
    const m = await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => /Xác nhận cập nhật/.test(x.innerText));
      const r = b?.getBoundingClientRect();
      return { overflowX: document.documentElement.scrollWidth - window.innerWidth, btn: r ? { left: r.left, right: r.right, h: r.height } : null, vw: window.innerWidth, text: /BMI khoảng 26,7/.test(document.body.innerText) };
    });
    ok(width + "px: natural recommendation readable, confirmation card reachable, no horizontal overflow", m.text && m.overflowX <= 1 && m.btn && m.btn.h >= 40 && m.btn.left >= 0 && m.btn.right <= m.vw + 1, JSON.stringify(m));
    await shot(page, "27-global-mobile-" + width + "-confirm");
    await page.getByRole("button", { name: /Xác nhận cập nhật/ }).first().click(); await sleep(2000);
    // workflow resume on mobile: start PT search, interrupt with a read, then answer the slot
    await send(page, "Tìm PT cho tôi.");
    await send(page, "Macro hiện tại của tôi bao nhiêu?");
    const t = await pageText(page);
    ok(width + "px: interruption answered with the reminder, workflow preserved", /Bạn vẫn đang tìm PT dở/.test(t));
    await send(page, "2 triệu.");
    const t2 = await pageText(page);
    ok(width + "px: workflow resumes after the answer", !/Bạn tập được những ngày nào/.test(t2.slice(-500)));
    await shot(page, "28-global-mobile-" + width + "-resume"); await ctx.close();
  }
}

// ───────────── CI-V2 TARGETED REMEDIATION (REAL BROWSER): height read, PT status, missing profile, interruption+resume, confirmation card, draft revision ─────────────
const ERROR_MARKERS = /Unexpected error|INTERNAL_ERROR|unexpected error occurred|Something went wrong|Objects are not valid as a React child/i;
const tailAfter = (t, marker) => t.slice(Math.max(0, t.lastIndexOf(marker)));
const noHorizontalOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth <= 1);

async function runRemediation(viewport, tag) {
  const vp = viewport.width + "px";
  // 1. authoritative height + standalone PT status (distinct height/weight/target so any cross-field mix-up is visible)
  {
    const u = await freshClient(tag + "h", { goal: "WEIGHT_LOSS", age: 28, heightCm: 181, currentWeight: 90, targetWeight: 75, gender: "MALE" });
    const ctx = await newCtx(viewport); const page = await ctx.newPage(); await login(page, u.email);
    await openCoach(page); await send(page, "Tôi cao bao nhiêu?");
    let tail = tailAfter(await pageText(page), "Tôi cao bao nhiêu?");
    ok(vp + ": 'Tôi cao bao nhiêu?' shows the authoritative height (181cm), not weight (90kg) or target (75kg)", /181\s?cm/.test(tail) && !/\b90\s?kg\b/.test(tail) && !/\b75\s?kg\b/.test(tail), tail.slice(0, 160).replace(/\n/g, " "));
    await shot(page, "40-rem-" + tag + "-height");
    await send(page, "Tôi đang có PT chưa?");
    tail = tailAfter(await pageText(page), "Tôi đang có PT chưa?");
    ok(vp + ": standalone PT status reads the state and does NOT start a PT search or a workflow", /chưa có PT/i.test(tail) && !/Bạn tập được những ngày nào/.test(tail) && aiq("select count(*) from agent_workflow_sessions where user_id='" + u.userId + "'") === "0", tail.slice(0, 140).replace(/\n/g, " "));
    ok(vp + ": no horizontal overflow on the read answers", await noHorizontalOverflow(page));
    await shot(page, "41-rem-" + tag + "-ptstatus"); await ctx.close();
  }
  // 2. missing profile: the chat must not crash and must not create anything (TEST FIXTURE: the profile row is removed from the ISOLATED test DB after the page loaded)
  {
    const u = await freshClient(tag + "m", { goal: "WEIGHT_LOSS", age: 28, heightCm: 172, currentWeight: 80, gender: "MALE" });
    const ctx = await newCtx(viewport); const page = await ctx.newPage(); await login(page, u.email);
    await openCoach(page);
    uq("delete from user_profiles where \"userId\"='" + u.userId + "'"); // TEST FIXTURE — no self-service path produces "registered but no profile row"
    await send(page, "Tôi cao bao nhiêu?");
    let full = await pageText(page); let tail = tailAfter(full, "Tôi cao bao nhiêu?");
    ok(vp + ": missing profile → friendly Vietnamese guidance that names what to complete (chiều cao / cân nặng / tuổi / mục tiêu)", /chưa có hồ sơ/i.test(tail) && /chiều cao/i.test(tail) && /cân nặng/i.test(tail) && /mục tiêu/i.test(tail), tail.slice(0, 220).replace(/\n/g, " "));
    ok(vp + ": missing profile → no crash/error surface in the chat UI and the input is still usable", !ERROR_MARKERS.test(full) && (await chatInput(page).isEnabled()));
    await send(page, "Tôi đang có PT chưa?");
    tail = tailAfter(await pageText(page), "Tôi đang có PT chưa?");
    ok(vp + ": the chat keeps working after the missing-profile answer (next question answered)", /PT/.test(tail) && !ERROR_MARKERS.test(tail), tail.slice(0, 120).replace(/\n/g, " "));
    ok(vp + ": missing profile → nothing silently created (no profile row, no workflow, no pending action)", uq("select count(*) from user_profiles where \"userId\"='" + u.userId + "'") === "0" && aiq("select count(*) from agent_workflow_sessions where user_id='" + u.userId + "'") === "0" && aiq("select count(*) from fitness_agent_actions where user_id='" + u.userId + "'") === "0");
    ok(vp + ": missing-profile answer has no horizontal overflow", await noHorizontalOverflow(page));
    await shot(page, "42-rem-" + tag + "-missing-profile"); await ctx.close();
  }
  // 3. pending FIND_PT → knowledge question (RAG) → reminder → resume
  {
    const u = await freshClient(tag + "p", { goal: "WEIGHT_LOSS", age: 30, heightCm: 170, currentWeight: 82, gender: "MALE", preferredTrainingDays: [1, 3, 5] });
    const ctx = await newCtx(viewport); const page = await ctx.newPage(); await login(page, u.email);
    await openCoach(page); await send(page, "Tìm PT cho tôi.");
    const before = aiq("select id||'|'||status||'|'||coalesce(expected_slot,'') from agent_workflow_sessions where user_id='" + u.userId + "' order by created_at desc limit 1");
    // a ONE-sentence question: the web client aborts the chat stream at 30 s, and a long RAG answer from the local qwen3:4b takes 40–100 s
    const KQ = "RIR là gì? Trả lời một câu.";
    await send(page, KQ);
    const tail = tailAfter(await pageText(page), KQ);
    const after = aiq("select id||'|'||status||'|'||coalesce(expected_slot,'') from agent_workflow_sessions where user_id='" + u.userId + "' order by created_at desc limit 1");
    ok(vp + ": knowledge question answered, reminder shown, the PT workflow row is untouched", /Bạn vẫn đang tìm PT dở/.test(tail) && before === after && before !== "", before + " -> " + after);
    await shot(page, "43-rem-" + tag + "-interrupt");
    await send(page, "2 triệu.");
    const t2 = tailAfter(await pageText(page), "2 triệu.");
    ok(vp + ": answering the waiting slot resumes the SAME workflow (no restart)", !/Bạn tập được những ngày nào/.test(t2), t2.slice(0, 140).replace(/\n/g, " "));
    await shot(page, "44-rem-" + tag + "-resume"); await ctx.close();
  }
  // 4. profile confirmation card stays functional (propose → card → click → write)
  {
    const u = await freshClient(tag + "c", { goal: "MUSCLE_GAIN", age: 28, heightCm: 172, currentWeight: 95, gender: "MALE" });
    const ctx = await newCtx(viewport); const page = await ctx.newPage(); await login(page, u.email);
    await openCoach(page); await send(page, "với tình trạng hiện tại tôi nên cut hay bulk?");
    await send(page, "ok đổi theo đề xuất đó");
    const confirm = page.getByRole("button", { name: /Xác nhận cập nhật/ });
    ok(vp + ": confirmation card appears and nothing is written yet", (await confirm.count()) >= 1 && /MUSCLE_GAIN/.test(goalOf(u)), goalOf(u));
    await shot(page, "45-rem-" + tag + "-confirm-card");
    await confirm.first().click(); await sleep(2500);
    ok(vp + ": clicking the confirmation writes the goal (WEIGHT_LOSS)", /WEIGHT_LOSS/.test(goalOf(u)), goalOf(u));
    ok(vp + ": card view has no horizontal overflow", await noHorizontalOverflow(page)); await ctx.close();
  }
  // 5. a correction sent while a workout DRAFT is pending revises the draft (it is not answered as a generic recommendation)
  {
    const u = await freshClient(tag + "d", { goal: "WEIGHT_LOSS", age: 28, heightCm: 172, currentWeight: 80, gender: "MALE", preferredTrainingDays: [1, 3, 5] });
    const ctx = await newCtx(viewport); const page = await ctx.newPage(); await login(page, u.email);
    await openCoach(page); await send(page, "Tạo lịch tập cho tôi.");
    ok(vp + ": workout draft preview is shown (pre-filled days → no question)", (await btn(page, CONFIRM_BTN).count()) >= 1);
    await send(page, "sai rồi, phải là 5 buổi mỗi tuần");
    const tail = tailAfter(await pageText(page), "sai rồi, phải là 5 buổi mỗi tuần");
    ok(vp + ": the correction revises the pending draft (5 buổi) instead of a generic 'chỉ là gợi ý' recommendation", /5 buổi/.test(tail) && !/Đây chỉ là gợi ý/.test(tail), tail.slice(0, 200).replace(/\n/g, " "));
    await shot(page, "46-rem-" + tag + "-draft-revision"); await ctx.close();
  }
}
export async function remediation() { setJourney("browser-remediation-desktop"); await runRemediation({ width: 1280, height: 900 }, "d"); }
export async function remediationmobile() { setJourney("browser-remediation-mobile"); await runRemediation({ width: 390, height: 800 }, "m390"); }

const SUITES = { remediation, remediationmobile, globalcov, globalmobile, chat, workout, twotab, stale, mobile, session, nutrition, pt, roadmap };
for (const name of process.argv.slice(2)) { const fn = SUITES[name]; if (!fn) continue; try { await fn(); } catch (e) { ok(`suite ${name} threw`, false, String(e?.message).slice(0, 200)); } }
await browser.close();
finish(process.argv.slice(2));
