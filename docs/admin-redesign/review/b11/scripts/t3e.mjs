// A-01 / A-02 on the real UI + 390px dialogs/pages for refunds. No money mutation except an extra refund REQUEST (customer side API) used only to open the dialog and cancel.
import { chromium, newCtx, uiLogin, BASE, SHOTS } from './pw.mjs';
import { rec3, norm, settle } from './t3a.mjs';
import { call, login, loadState, q, dbInv } from './lib.mjs';
const st = loadState(); const PW = 'Test@123456';
const c3 = await login('afr.c3@example.test', PW);
const rr = await call('POST', `/marketplace/orders/${st.orders.c3}/refund-request`, { token: c3.token, body: { reason: 'AFR second request (390 dialog probe)' } });
console.log('c3 second refund-request', rr.status, rr.body?.data?.status ?? JSON.stringify(rr.body).slice(0, 200));
const browser = await chromium.launch();
for (const [w, h, tag] of [[1440, 900, '1440'], [390, 844, '390']]) {
  const ctx = await newCtx(browser, w, h); const page = await ctx.newPage();
  const reqs = []; page.on('request', r => { if (r.url().includes('/admin/payments/finance-overview')) reqs.push(new URL(r.url()).search); });
  await uiLogin(page, 'afr.admin@example.test', PW);
  await page.goto(BASE + '/admin/finance'); await settle(page, 2500);
  const h0 = await page.locator('table').first().evaluate(e => e.getBoundingClientRect().height).catch(() => null);
  reqs.length = 0;
  await page.getByRole('button', { name: 'Tháng', exact: true }).click(); await page.waitForTimeout(2000);
  const url2 = page.url(); const monthReq = reqs.slice();
  await page.screenshot({ path: `${SHOTS}/a02-month-${tag}.png`, fullPage: true });
  const txt2 = norm(await page.locator('main').innerText());
  rec3(`A-02 day->month chip: URL ?group=month, API groupBy=month (${tag})`, /group=month/.test(url2) && monthReq.some(s => /groupBy=month/.test(s)), { url: url2, apiQuery: monthReq });
  // A-01: empty period
  await page.getByRole('button', { name: 'Tuỳ chọn' }).click(); await page.waitForTimeout(500);
  const inputs = page.locator('main input[type=date]');
  await inputs.nth(0).fill('2026-01-01'); await inputs.nth(1).fill('2026-01-31'); reqs.length = 0;
  await page.waitForTimeout(3000);
  const txt = norm(await page.locator('main').innerText());
  await page.screenshot({ path: `${SHOTS}/a01-empty-period-${tag}.png`, fullPage: true });
  rec3(`A-01 empty period shows "no transactions", no fake zero chart (${tag})`, /Không có giao dịch trong kỳ/.test(txt), { urlNow: page.url(), apiQuery: reqs.slice(), hasEmptyMsg: /Không có giao dịch trong kỳ/.test(txt), snippet: (txt.match(/Tiền vào nền tảng.{0,160}/) || [''])[0] });
  // refunds + withdrawals post-state pages
  for (const [p, name] of [['/admin/finance/withdrawals', 'withdrawals-final'], ['/admin/finance/refunds', 'refunds-final']]) {
    await page.goto(BASE + p); await settle(page, 2500); await page.screenshot({ path: `${SHOTS}/${name}-${tag}.png`, fullPage: true });
  }
  if (tag === '390') {
    await page.goto(BASE + '/admin/finance/refunds'); await settle(page, 2500);
    await page.getByRole('button', { name: /Xem chi tiết/ }).first().click(); await page.waitForTimeout(2500);
    await page.locator('main input[type=number]').first().fill('100000'); await page.locator('main textarea').first().fill('AFR 390 probe');
    await page.getByRole('button', { name: /Duyệt hoàn tiền/ }).first().click(); await page.waitForTimeout(800);
    const d = page.locator('[role=alertdialog],[role=dialog]').first(); const dt = norm(await d.innerText());
    await page.screenshot({ path: `${SHOTS}/h04-refund-dialog-390.png` });
    rec3('H-04 refund dialog at 390 (opened, then cancelled)', /ví khách|ví của khách/i.test(dt) && /100\.000/.test(dt), { text: dt.slice(0, 500) });
    await d.getByRole('button', { name: /^Huỷ$|^Hủy$/ }).first().click().catch(async () => { await page.keyboard.press('Escape'); });
  }
  await ctx.close();
}
await browser.close();
console.log(await dbInv());
