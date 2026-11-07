// Open (and cancel) every money dialog at a given width; screenshot. No mutation.
import { chromium, newCtx, uiLogin, BASE, SHOTS } from './pw.mjs';
import { rec3, norm, settle } from './t3a.mjs';
import { loadState } from './lib.mjs';
const st = loadState();
const w = Number(process.argv[2] || 390); const tag = String(w);
const browser = await chromium.launch();
const ctx = await newCtx(browser, w, w === 390 ? 844 : 900); const page = await ctx.newPage();
await uiLogin(page, 'afr.admin@example.test', 'Test@123456');
const short = (id) => id.slice(0, 8);
const rowFor = (id) => page.locator('li, tr, article, div, section').filter({ hasText: 'Yêu cầu ' + short(id) }).filter({ has: page.getByRole('button', { name: /^Từ chối/ }) }).last();
const dlg = () => page.locator('[role=alertdialog],[role=dialog]').first();
await page.goto(BASE + '/admin/finance/withdrawals'); await settle(page, 2500);
const cases = [['W5', st.w.W5, 'Duyệt', 'approve-pending'], ['W6', st.w.W6, 'Đã chi trả', 'markpaid-approved'], ['W7', st.w.W7, 'Đã chi trả', 'markpaid-pending']];
for (const [k, id, btn, name] of cases) {
  await page.getByRole('button', { name: k === 'W6' ? /Đã duyệt/ : /^Chờ duyệt/ }).first().click(); await page.waitForTimeout(500);
  const row = rowFor(id);
  await row.getByRole('button', { name: new RegExp('^' + btn) }).first().click({ timeout: 8000 });
  await page.waitForTimeout(700);
  const d = dlg(); const t = norm(await d.innerText());
  await page.screenshot({ path: `${SHOTS}/dialog-wd-${name}-${tag}.png` });
  rec3(`DIALOG ${name} ${tag}`, true, { text: t.slice(0, 700), inputs: await d.locator('input,textarea').evaluateAll(e => e.map(x => x.name || x.id || x.placeholder)) });
  await d.getByRole('button', { name: /^Huỷ$|^Hủy$|Đóng/ }).first().click().catch(async () => { await page.keyboard.press('Escape'); });
  await page.waitForTimeout(400);
}
await page.goto(BASE + '/admin/finance/refunds'); await settle(page, 2500);
await page.screenshot({ path: `${SHOTS}/refunds-list-${tag}.png`, fullPage: true });
console.log('REFUND BUTTONS', (await page.locator('main button').allInnerTexts()).filter(Boolean).join(' || '));
await browser.close();
