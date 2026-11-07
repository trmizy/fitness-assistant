// E-01 re-run with a correct load-error detector (earlier regex matched the explanatory "khong phai loi tai" copy). Drift only in afr payment DB, restored.
import { chromium, newCtx, uiLogin, BASE, SHOTS } from './pw.mjs';
import { rec3, norm, settle, vnd } from './t3a.mjs';
import { login, q, dbInv, recon } from './lib.mjs';
const admin = await login('afr.admin@example.test', 'Test@123456');
const browser = await chromium.launch();
await q('payment', "update wallets set available_balance = available_balance + 777 where owner_type='PLATFORM' and owner_id='ESCROW'");
try {
  for (const [w, h, tag] of [[1440, 900, '1440'], [390, 844, '390']]) {
    const ctx = await newCtx(browser, w, h); const page = await ctx.newPage();
    await uiLogin(page, 'afr.admin@example.test', 'Test@123456');
    const seen = {};
    for (const [p, name] of [['/admin/finance', 'overview'], ['/admin/finance/reconciliation', 'reconciliation'], ['/admin/dashboard', 'today']]) {
      await page.goto(BASE + p); await settle(page, 3000);
      const tx = norm(await page.locator('main').innerText());
      const retry = await page.getByRole('button', { name: /Thử lại/ }).count();
      seen[name] = { drift777Shown: tx.includes(vnd(777)), lechSoPill: /Lệch số/.test(tx), balancedPill: /\bCân bằng\b/.test(tx), retryButtons: retry, cannotLoadMsg: /Không tải được|Không thể tải/.test(tx), mentionsExceptionsLink: /Đối soát/.test(tx) };
      await page.screenshot({ path: `${SHOTS}/e01-drift-${name}-${tag}.png`, fullPage: true });
    }
    const ok = Object.values(seen).every(s => s.drift777Shown && !s.cannotLoadMsg && s.retryButtons === 0 && !s.balancedPill);
    rec3(`E-01 drift 777 d shown, not a load error (${tag})`, ok, seen);
    await ctx.close();
  }
} finally {
  await q('payment', "update wallets set available_balance = available_balance - 777 where owner_type='PLATFORM' and owner_id='ESCROW'");
  const a = await recon(admin.token); const d = await dbInv();
  rec3('E-01 restore: ledger balanced again (API + DB)', a.http === 200 && a.balanced && d.drift === '0', { apiDrift: a.drift, dbDrift: d.drift });
  await browser.close();
}
