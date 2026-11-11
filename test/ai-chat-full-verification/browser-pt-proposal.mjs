// REAL BROWSER verification of the PT Copilot proposal card (Phase 4 step 2) through the REAL frontend (Vite :15173) + real gateway/ai/fitness/user
// on the ISOLATED test DBs (stack.mjs up --web). Real login form; accounts/contract/schedules are TEST FIXTURES from probe-pt-copilot.mjs.
// Usage (repo root): GATEWAY_URL=http://localhost:13000 PROBE_STAMP=<stamp> node test/ai-chat-full-verification/browser-pt-proposal.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";

const require = createRequire(path.join(process.cwd(), ".tmp-stack/deps/package.json"));
const { chromium } = require("playwright-core");
const CHROME = path.join(os.homedir(), "AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe");
const BASE = "http://127.0.0.1:15173";
const SHOTS = "test/ai-chat-full-verification/results/screenshots-pt-proposal";
fs.mkdirSync(SHOTS, { recursive: true });
const cache = JSON.parse(fs.readFileSync(path.join(".tmp-stack", `pt-probe-${process.env.PROBE_STAMP}.json`), "utf8"));
const fit = (q) => execFileSync("docker", ["exec", "gymcoach-test-postgres-test-1", "psql", "-U", "gymcoach_test", "-d", "gymcoach_fitness_test", "-tAc", q], { encoding: "utf8" }).trim();
const audits = (a) => Number(fit(`select count(*) from coach_client_action_audits where pt_user_id='${cache.pt.userId}' and action='${a}'`));
const results = [];
const ok = (n, c, d = "") => { results.push({ name: n, pass: !!c, detail: d }); console.log(`${c ? "PASS" : "FAIL"}  ${n}${d ? "  — " + d : ""}`); };

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const run = async (width, height, tag, doConfirm) => {
  const ctx = await browser.newContext({ viewport: { width, height }, locale: "vi-VN" });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.locator('input[type="email"]').fill(cache.pt.email);
  await page.locator('input[type="password"]').fill("TestPass#12345");
  await Promise.all([page.waitForURL((u) => !/\/login/.test(u.pathname), { timeout: 30000 }), page.getByRole("button", { name: /Đăng nhập/ }).first().click()]);
  const landed = new URL(page.url()).pathname;
  console.log(`INFO  ${tag}: after login the PT lands on ${landed}`);
  await page.goto(`${BASE}/pt/dashboard`, { waitUntil: "domcontentloaded" });
  const entry = page.getByRole("button", { name: /Mở AI Coach/ });
  await entry.first().waitFor({ state: "visible", timeout: 30000 }).catch(() => {});
  ok(`${tag}: the PT workspace (${new URL(page.url()).pathname}) has the AI Coach entry`, new URL(page.url()).pathname.startsWith("/pt") && (await entry.count()) > 0);
  await entry.first().click({ timeout: 15000, force: true }).catch(() => {});
  const input = page.locator('input[type="text"]').last();
  if (!(await input.isVisible().catch(() => false))) await page.getByRole("button", { name: /Cuộc trò chuyện mới/ }).first().click({ timeout: 15000 }).catch(() => {});
  await input.waitFor({ state: "visible", timeout: 30000 }).catch(() => {});
  const reached = await input.isVisible().catch(() => false);
  ok(`${tag}: the PT opens the coach from the PT workspace`, reached, new URL(page.url()).pathname);
  if (!reached) { await page.screenshot({ path: `${SHOTS}/${tag}-no-chat.png` }); await ctx.close(); return; }
  await input.fill("Đề xuất cách xử lý cho client risk"); await input.press("Enter");
  const card = page.getByText(/chưa gửi gì cho client/);
  await card.first().waitFor({ state: "visible", timeout: 120000 }).catch(() => {});
  const shown = await card.first().isVisible().catch(() => false);
  ok(`${tag}: proposal card is shown with the "nothing sent" note`, shown);
  const text = await page.evaluate(() => document.body.innerText);
  ok(`${tag}: card cites real evidence and offers a message draft`, /1\/5 buổi/.test(text) && /Tin nhắn|động viên/i.test(text));
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  ok(`${tag}: no horizontal overflow at ${width}px`, !overflow);
  await page.screenshot({ path: `${SHOTS}/${tag}-card.png`, fullPage: false });
  if (doConfirm && shown) {
    const before = audits("AI_PROPOSAL_APPROVED");
    await page.getByRole("button", { name: /^Xác nhận$/ }).last().click();
    await page.getByText(/Đã ghi nhận bạn duyệt/).first().waitFor({ state: "visible", timeout: 60000 }).catch(() => {});
    ok(`${tag}: approve is recorded (audit +1) and the draft text is shown`, audits("AI_PROPOSAL_APPROVED") === before + 1 && /Đã ghi nhận bạn duyệt/.test(await page.evaluate(() => document.body.innerText)));
    ok(`${tag}: after approval the "Để sau" button is gone`, (await page.getByRole("button", { name: /^Để sau$/ }).count()) === 0);
    await page.screenshot({ path: `${SHOTS}/${tag}-approved.png` });
  }
  await ctx.close();
};
await run(390, 844, "mobile390", true);
await run(1280, 800, "desktop1280", false);
await browser.close();
fs.writeFileSync("test/ai-chat-full-verification/results/browser-pt-proposal.json", JSON.stringify({ at: new Date().toISOString(), evidence: "REAL BROWSER", results }, null, 2));
const bad = results.filter((r) => !r.pass);
console.log(`\n${results.length - bad.length}/${results.length} passed`);
process.exit(bad.length ? 1 : 0);
