// REAL BROWSER verification of the R222-03 chat retry contract (clientRequestId), through the REAL frontend (Vite :15173) +
// real gateway/auth/user/fitness/ai against the ISOLATED test DBs (stack.mjs up --web). Real login form, real tokens.
// The only injected fault is network-level, via Playwright routing: the request is forwarded to the REAL backend and then the
// RESPONSE is dropped (server processed it, the client never learns) — the exact "uncertain" case the contract targets.
// Usage (repo root): GATEWAY_URL=http://localhost:13000 node test/ai-chat-full-verification/browser-r222-03.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { sleep, registerUser, putProfile } from "./lib.mjs";

const require = createRequire(path.join(process.cwd(), ".tmp-stack/deps/package.json"));
const { chromium } = require("playwright-core");
const CHROME = path.join(os.homedir(), "AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe");
const BASE = "http://127.0.0.1:15173";
const SHOTS = "test/ai-chat-full-verification/results/screenshots-r222-03";
fs.mkdirSync(SHOTS, { recursive: true });
const PASSWORD = "TestPass#12345";
const results = [];
const ok = (name, cond, detail = "") => { results.push({ name, pass: !!cond, detail }); console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); };

const stamp = Date.now().toString(36);
const u1 = await registerUser(`r22203.a.${stamp}@gymini-test.local`, "R222 Tester A");
const u2 = await registerUser(`r22203.b.${stamp}@gymini-test.local`, "R222 Tester B");

const profile = { age: 30, gender: "MALE", heightCm: 175, goal: "MAINTENANCE", activityLevel: "MODERATELY_ACTIVE", experienceLevel: "BEGINNER", currentWeight: 78, targetWeight: 76, hasCompletedOnboarding: true };
for (const u of [u1, u2]) { const r = await putProfile(u, profile); if (r.status !== 200) throw new Error("putProfile failed " + r.status); }

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "vi-VN" });
const page = await ctx.newPage();
const shot = (name) => page.screenshot({ path: `${SHOTS}/${name}.png` });

// every chat request the browser actually sends: { path, id, question }
const seen = [];
page.on("request", (req) => {
  const u = new URL(req.url());
  if (req.method() === "POST" && /\/ai\/ask(\/stream)?$/.test(u.pathname)) {
    let body = {}; try { body = JSON.parse(req.postData() || "{}"); } catch { /* */ }
    seen.push({ path: u.pathname, id: body.clientRequestId, question: body.question });
  }
});

async function login(email) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await Promise.all([page.waitForURL((u) => !/\/login/.test(u.pathname), { timeout: 30000 }), page.getByRole("button", { name: /Đăng nhập/ }).first().click()]);
}
const chatInput = () => page.locator('input[type="text"]').last();
async function openCoach() {
  await page.goto(`${BASE}/client/ai-coach`, { waitUntil: "domcontentloaded" });
  if (!(await chatInput().isVisible().catch(() => false))) await page.getByRole("button", { name: /Cuộc trò chuyện mới/ }).first().click({ timeout: 15000 }).catch(() => {});
  await chatInput().waitFor({ state: "visible", timeout: 30000 });
}
const inputEnabled = () => page.waitForFunction(() => { const i = [...document.querySelectorAll('input[type="text"]')].pop(); return i && !i.disabled; }, null, { timeout: 240000 });
async function ask(text) { await inputEnabled(); await chatInput().fill(text); await chatInput().press("Enter"); }
const body = () => page.evaluate(() => document.body.innerText);
const retryBtn = () => page.getByRole("button", { name: /Thử lại/ });

const Q1 = "Một câu thôi: protein giúp gì cho cơ bắp?";

try {
  await login(u1.email);
  await openCoach();
  await shot("00-logged-in");

  // ── 1. response lost after the server processed the request ───────────────────────────────────────────────
  let dropped = 0;
  await page.route(/\/ai\/ask(\/stream)?$/, async (route) => {
    if (dropped === 0 && route.request().method() === "POST") {
      dropped++;
      try { await route.fetch({ timeout: 240000 }); } catch { /* backend may stream; we only need it to have been processed */ }
      await route.abort("connectionreset");
    } else await route.continue();
  });
  await ask(Q1);
  await retryBtn().first().waitFor({ state: "visible", timeout: 280000 });
  const firstId = seen[0]?.id;
  ok("1a. the first send carried a client-generated clientRequestId", typeof firstId === "string" && firstId.length >= 8, String(firstId));
  ok("1b. after the dropped response the UI offers 'Thử lại' and says the outcome is unclear / not duplicated", /không (bị )?tạo trùng/i.test(await body()), (await body()).split("\n").find((l) => /không (bị )?tạo trùng/i.test(l)) ?? "");
  await shot("01-failed-with-retry");

  // ── 2. explicit retry reuses the SAME id and the SAME question ────────────────────────────────────────────
  const before = seen.length;
  await retryBtn().first().click();
  await sleep(1500);
  await retryBtn().first().waitFor({ state: "detached", timeout: 280000 }).catch(() => {});
  await inputEnabled();
  const retried = seen.slice(before);
  ok("2a. 'Thử lại' sent exactly one new request", retried.length === 1, `${retried.length} request(s)`);
  ok("2b. the retry reused the original clientRequestId", retried[0]?.id === firstId, `${retried[0]?.id} vs ${firstId}`);
  ok("2c. the retry sent the stored question unchanged", retried[0]?.question === Q1, retried[0]?.question);
  const sessionsA = await fetch(`${process.env.GATEWAY_URL || "http://localhost:13000"}/ai/sessions`, { headers: { authorization: `Bearer ${u1.token}` } }).then((r) => r.json()).catch(() => null);
  const listA = sessionsA?.data?.sessions ?? sessionsA?.data ?? sessionsA?.sessions ?? [];
  console.log("INFO  sessions for user A after original(lost response)+retry:", Array.isArray(listA) ? listA.map((x) => x.title ?? x.id).join(" | ") : JSON.stringify(sessionsA).slice(0, 200));
  ok("2c2. the retry did NOT create a second conversation (server de-duplicated the plain question)", Array.isArray(listA) && listA.length === 1, `${Array.isArray(listA) ? listA.length : "?"} session(s)`);
  ok("2d. after a successful retry the failed banner / retry button is gone", (await retryBtn().count()) === 0);
  await shot("02-after-retry");

  // ── 3. a deliberate new send gets a NEW id, even with identical text ──────────────────────────────────────
  const b3 = seen.length;
  await ask(Q1);
  await inputEnabled();
  const fresh = seen.slice(b3);
  ok("3. a deliberate resend of identical text uses a NEW clientRequestId", fresh.length === 1 && !!fresh[0].id && fresh[0].id !== firstId, `${fresh[0]?.id} vs ${firstId}`);

  // ── 4. reload in the middle of a request -> uncertain -> retry with the same id ───────────────────────────
  await page.unroute(/\/ai\/ask(\/stream)?$/);
  await page.route(/\/ai\/ask(\/stream)?$/, async (route) => { await new Promise(() => {}); }); // hold forever: nothing is answered
  const Q3 = "Câu cuối: uống nước bao nhiêu mỗi ngày?";
  const b4 = seen.length;
  await ask(Q3);
  await sleep(1500);
  const heldId = seen.slice(b4)[0]?.id;
  ok("4a. the in-flight request had an id persisted before it left", !!heldId, String(heldId));
  const stored = await page.evaluate(() => Object.entries(localStorage).filter(([k]) => /pending|ai/i.test(k)).map(([k, v]) => `${k}=${v}`.slice(0, 400)));
  ok("4b. the request record (with its id) was persisted to the user-scoped store before completion", stored.some((s) => s.includes("clientRequestId") && s.includes(heldId)), stored.length + " matching key(s)");
  await page.unroute(/\/ai\/ask(\/stream)?$/);
  await page.reload({ waitUntil: "domcontentloaded" });
  await sleep(2500);
  // narrow screens open on the conversation list: a real user taps the conversation that was interrupted
  if (!(await chatInput().isVisible().catch(() => false))) await page.getByText(Q3).first().click({ timeout: 15000 }).catch(() => {});
  await page.waitForFunction(() => /Thử lại/.test(document.body.innerText), null, { timeout: 30000 }).catch(() => {});
  const afterReload = await body();
  ok("4c. after the reload the interrupted send is shown as unclear with 'Thử lại' (not silently replayed)", (await retryBtn().count()) >= 1 && /chưa rõ|gián đoạn|thất bại/i.test(afterReload));
  ok("4d. the reload did not auto-resend anything", seen.slice(b4).length === 1, `${seen.slice(b4).length} request(s) since`);
  await shot("04-after-reload-uncertain");
  const b4b = seen.length;
  await retryBtn().first().click();
  await sleep(1500);
  await retryBtn().first().waitFor({ state: "detached", timeout: 280000 }).catch(() => {});
  const re4 = seen.slice(b4b);
  ok("4e. the retry after reload reused the original id and question", re4.length === 1 && re4[0].id === heldId && re4[0].question === Q3, `${re4[0]?.id} vs ${heldId}`);

  // ── 5. account isolation: a FAILED record of user A must not surface for user B in the same browser ──────────
  await page.route(/\/ai\/ask(\/stream)?$/, (route) => route.abort("connectionreset"));
  await inputEnabled();
  await ask("Tin nhắn thất bại của người dùng A");
  await retryBtn().first().waitFor({ state: "visible", timeout: 60000 });
  await page.unroute(/\/ai\/ask(\/stream)?$/);
  ok("5a. user A has a failed message with 'Thử lại' before switching", (await retryBtn().count()) >= 1);
  // real sign-out through the app's own menu
  const visibleLogout = () => page.getByText(/Đăng xuất/).filter({ visible: true }).first();
  await page.mouse.click(360, 26); // avatar menu (390px viewport)
  if (!(await visibleLogout().isVisible().catch(() => false))) { await page.mouse.click(34, 26); await sleep(800); } // ☰ drawer
  await shot("05-logout-menu");
  await visibleLogout().click({ timeout: 10000 });
  await page.waitForURL(/\/login/, { timeout: 30000 });
  ok("5b. signing out through the UI lands on /login", /\/login/.test(page.url()), page.url());
  await sleep(3500); // the app finishes its own post-logout redirects
  const left = await page.evaluate(() => Object.keys(localStorage).filter((k) => /accessToken|refreshToken|CapacitorStorage.user/.test(k)));
  ok("5b2. after sign-out no access/refresh token or user record remains in storage", left.length === 0, left.join(","));
  const b5 = seen.length;
  await login(u2.email);
  await openCoach();
  await sleep(2500);
  const textB = await body();
  ok("5c. user B (same browser) does not see user A's retry button or failed text", (await retryBtn().count()) === 0 && !/Tin nhắn thất bại của người dùng A/.test(textB));
  ok("5d. switching account sent no chat request on its own", seen.length === b5);
  await shot("05-user-b");
} catch (e) {
  ok("script completed without an unexpected error", false, String(e).slice(0, 400));
  await shot("zz-error").catch(() => {});
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
fs.writeFileSync("test/ai-chat-full-verification/results/browser-r222-03.json", JSON.stringify({ at: new Date().toISOString(), requests: seen, results }, null, 2));
process.exit(failed.length ? 1 : 0);
