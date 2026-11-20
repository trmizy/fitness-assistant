// REAL BROWSER smoke check of the playground page: v1 step -> answer -> rate -> saved; v2 free input -> answer. Run with the playground + stack up.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(path.join(process.cwd(), ".tmp-stack/deps/package.json"));
const { chromium } = require("playwright-core");
const CHROME = path.join(os.homedir(), "AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe");
const SHOTS = "test/ai-eval/results/playground-shots";
fs.mkdirSync(SHOTS, { recursive: true });
const results = [];
const ok = (n, c, d = "") => { results.push({ n, pass: !!c }); console.log(`${c ? "PASS" : "FAIL"}  ${n}${d ? " — " + d : ""}`); };

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
for (const [tag, w, h] of [["desktop", 1280, 800], ["mobile390", 390, 844]]) {
  const page = await (await browser.newContext({ viewport: { width: w, height: h } })).newPage();
  await page.goto("http://127.0.0.1:17000/");
  await page.locator("#persona option").first().waitFor({ state: "attached", timeout: 15000 });
  ok(`${tag}: three personas offered`, (await page.locator("#persona option").count()) === 3);
  ok(`${tag}: v1 step and the 'ideal' hint are shown`, /Câu 1\//.test(await page.locator("#v1step").innerText()) && (await page.locator("#v1ideal").innerText()).length > 20);
  await page.locator("#v1send").click();
  await page.locator(".ai").nth(0).waitFor({ timeout: 90000 });
  await page.waitForFunction(() => !/Đang chờ AI/.test(document.querySelector(".ai")?.innerText ?? ""), null, { timeout: 120000 });
  const first = await page.locator(".ai").first().innerText();
  ok(`${tag}: the real AI answered the v1 question`, first.length > 40 && !/Đang chờ/.test(first), first.slice(0, 70).replace(/\n/g, " "));
  await page.locator('[data-v="dung"]').first().click();
  await page.locator(".note").first().fill(`ui-check ${tag}`);
  await page.locator(".save").first().click();
  await page.locator(".saved").first().waitFor({ timeout: 10000 });
  ok(`${tag}: rating saved`, /Đã lưu/.test(await page.locator(".saved").first().innerText()));
  await page.locator("#tab-v2").click();
  await page.locator("#q").fill("Tôi nên uống bao nhiêu nước mỗi ngày khi tập?");
  await page.locator("#send").click();
  await page.waitForFunction(() => document.querySelectorAll(".ai").length >= 2 && !/Đang chờ AI/.test([...document.querySelectorAll(".ai")].pop().innerText), null, { timeout: 120000 });
  ok(`${tag}: free-typed (v2) question answered`, (await page.locator(".ai").last().innerText()).length > 30);
  ok(`${tag}: no horizontal overflow`, !(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)));
  await page.screenshot({ path: `${SHOTS}/${tag}.png` });
}
await browser.close();
const bad = results.filter((r) => !r.pass);
console.log(`${results.length - bad.length}/${results.length} passed`);
process.exit(bad.length ? 1 : 0);
