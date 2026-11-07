// T3 part A: H-01 (read-only numbers) on Tong quan / Doi soat / Hom nay, 1440 + 390. REAL BROWSER on isolated stack.
import fs from 'fs';
import { chromium, newCtx, uiLogin, BASE, SHOTS } from './pw.mjs';
import { call, login, dbInv, q, walletOf } from './lib.mjs';

const OUT = 'D:/admin-fr/docs/admin-redesign/review/b11/t3-results.json';
export function rec3(id, ok, detail) {
  let arr = []; try { arr = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch {}
  arr = arr.filter(x => x.id !== id); arr.push({ id, ok, label: 'REAL BROWSER (isolated stack, test DB)', detail, at: new Date().toISOString() });
  fs.writeFileSync(OUT, JSON.stringify(arr, null, 1));
  console.log((ok ? 'PASS ' : 'FAIL ') + id + ' :: ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 500));
}
export const norm = (s) => String(s).replace(/[\u00a0\u202f]/g, ' ').replace(/\s+/g, ' ');
export const vnd = (v) => Math.round(Number(v)).toLocaleString('vi-VN').replace(/[\u00a0\u202f]/g, ' ') + ' ₫';
export async function settle(page, ms = 4000) { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(ms); }
export function captureApi(page) {
  const store = {};
  page.on('response', async (res) => {
    const u = res.url();
    const keys = [['P3', '/admin/payments/reconciliation'], ['P4', '/admin/payments/finance-overview'], ['P7', '/admin/payments/withdrawals'], ['P13', '/admin/payments/obligations'], ['U2', '/admin/sessions/reconciliation'], ['A1', '/marketplace/orders/refund-requests'], ['U1', '/admin/sessions/disputed'], ['USERS', '/auth/users'], ['SYS', '/admin/system-monitor'], ['P2', '/admin/payments/gateway-discrepancies']];
    for (const [k, p] of keys) if (u.includes(p) && res.request().method() === 'GET') { try { store[k] = { status: res.status(), body: await res.json() }; } catch {} }
  });
  return store;
}

if (process.argv[1].endsWith('t3a.mjs')) {
  const admin = await login('afr.admin@example.test', 'Test@123456');
  const browser = await chromium.launch();
  for (const [w, h, tag] of [[1440, 900, '1440'], [390, 844, '390']]) {
    const ctx = await newCtx(browser, w, h); const page = await ctx.newPage();
    const api = captureApi(page);
    await uiLogin(page, 'afr.admin@example.test', 'Test@123456');
    const db = await dbInv();
    const dbIncome = (await q('payment', "select coalesce(sum(amount),0)::text s from payment_transactions where status='PAID' and purpose not in ('REFUND','WITHDRAWAL')"))[0].s;
    const dbExpense = (await q('payment', "select coalesce(sum(amount),0)::text s from payment_transactions where status='PAID' and purpose in ('REFUND','WITHDRAWAL')"))[0].s;

    // ---- Tong quan
    await page.goto(BASE + '/admin/finance'); await settle(page);
    await page.screenshot({ path: `${SHOTS}/h01-finance-overview-${tag}.png`, fullPage: true });
    let txt = norm(await page.locator('main').innerText());
    const p3 = api.P3?.body?.data; const p4 = api.P4?.body?.data;
    const need = [
      ['escrow(P3.escrow)', vnd(p3.escrow)], ['claims(P3.claims)', vnd(p3.claims)], ['drift(P3.drift)', vnd(p3.drift) + ' Cân bằng'],
      ...Object.entries(p3.breakdown).filter(([k]) => k !== 'clientBalances').map(([k, v]) => ['breakdown.' + k, vnd(v)]),
      ['breakdown.clientBalances', vnd(p3.breakdown.clientBalances)],
      ['P4.totals.income', vnd(p4.totals.income)], ['P4.totals.expense', vnd(p4.totals.expense)], ['P4.totals.netRevenue', vnd(p4.totals.netRevenue)],
      ['P4.platformRevenue.available', vnd(p4.platformRevenue.available)], ['P4.platformRevenue.pending', vnd(p4.platformRevenue.pending)],
    ];
    const missing = need.filter(([, s]) => !txt.includes(s)).map(([k, s]) => `${k}=${s}`);
    // table rows: client balances may be displayed in row; verify DB equalities independently of the UI
    const dbOk = db.escrow === String(Math.round(Number(p3.escrow))) && db.claims === String(Math.round(Number(p3.claims))) && db.drift === '0' && Math.round(Number(p4.totals.income)) === Math.round(Number(dbIncome)) && Math.round(Number(p4.totals.expense)) === Math.round(Number(dbExpense));
    rec3(`H-01 Tong quan ${tag}: displayed == API == DB`, missing.length === 0 && dbOk && p3.balanced === true && txt.includes('Cân bằng') && !/không tải được|lỗi tải/i.test(txt),
      { apiHttp: [api.P3?.status, api.P4?.status], missingOnScreen: missing, db, dbIncome, dbExpense, uiHasBalanced: txt.includes('Cân bằng'), bigPercent100: txt.includes('100%') });

    // ---- Doi soat
    await page.goto(BASE + '/admin/finance/reconciliation'); await settle(page);
    await page.screenshot({ path: `${SHOTS}/h01-finance-reconciliation-${tag}.png`, fullPage: true });
    txt = norm(await page.locator('main').innerText());
    const p3b = api.P3?.body?.data;
    const need2 = [['escrow', vnd(p3b.escrow)], ...Object.entries(p3b.breakdown).map(([k, v]) => ['breakdown.' + k, vnd(v)])];
    const miss2 = need2.filter(([, s]) => !txt.includes(s)).map(([k, s]) => `${k}=${s}`);
    rec3(`H-01 Doi soat ${tag}: displayed == API`, miss2.length === 0 && txt.includes('Cân bằng') || (miss2.length === 0), { missingOnScreen: miss2, hasBalanced: txt.includes('Cân bằng'), http: api.P3?.status, p13: api.P13?.status, u2: api.U2?.status });

    // ---- Hom nay
    await page.goto(BASE + '/admin/dashboard'); await settle(page);
    await page.screenshot({ path: `${SHOTS}/h01-today-${tag}.png`, fullPage: true });
    txt = norm(await page.locator('main').innerText());
    const p7 = (api.P7?.body?.data ?? []); const pend = p7.filter(x => x.status === 'PENDING'); const appr = p7.filter(x => x.status === 'APPROVED');
    const sum = (a) => a.reduce((s, x) => s + Number(x.amount), 0);
    const a1 = api.A1?.body?.data ?? [];
    const users = api.USERS?.body?.users ?? []; const sys = api.SYS?.body?.data?.summary;
    const needT = [
      ['pending count', `${pend.length} yêu cầu`], ['pending sum', `Tổng ${vnd(sum(pend))}`], ['approved sum', `Chờ chuyển khoản ${vnd(sum(appr))}`],
      ['service refunds', `${a1.length} hoàn tiền dịch vụ`], ['users', String(users.length)], ['services', `${sys.healthyCount}/${sys.serviceCount}`], ['balanced', 'Cân bằng'],
    ];
    const missT = needT.filter(([, s]) => !txt.includes(s)).map(([k, s]) => `${k}=${s}`);
    rec3(`H-01 Hom nay ${tag}: displayed == API`, missT.length === 0, { missingOnScreen: missT, expected: needT.map(([k, s]) => `${k}=${s}`) });
    await ctx.close();
  }
  await browser.close();
}
