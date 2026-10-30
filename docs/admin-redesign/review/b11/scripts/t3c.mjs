// T3 part C: UI mutations H-02, H-03, E-03, H-04, membership refund, E-01 on the isolated stack. REAL BROWSER; DB/ledger verified after each.
import { chromium, newCtx, uiLogin, BASE, SHOTS } from './pw.mjs';
import { rec3, norm, settle, vnd } from './t3a.mjs';
import { call, login, loadState, saveState, walletOf, q, dbInv, recon } from './lib.mjs';
const st = loadState(); const PW = 'Test@123456'; const num = Number;
const admin = await login('afr.admin@example.test', PW);
const c1 = await login('afr.c1@example.test', PW), c3 = await login('afr.c3@example.test', PW), c4 = await login('afr.c4@example.test', PW);
const esc = async () => num((await walletOf('PLATFORM', 'ESCROW')).a);
const wd = async (id) => (await q('payment', 'select status, bank_reference, reviewed_by, paid_at from withdrawal_requests where id=$1', [id]))[0];
const ops = async (key) => (await q('payment', 'select count(*)::int n from ledger_operations where key=$1', [key]))[0].n;
const invOk = async () => { const a = await recon(admin.token); const d = await dbInv(); return { ok: a.http === 200 && a.balanced === true && d.drift === '0', apiDrift: a.drift, dbDrift: d.drift, escrow: a.escrow }; };
const short = (id) => id.slice(0, 8);

const browser = await chromium.launch();
const ctx = await newCtx(browser, 1440, 900); const page = await ctx.newPage();
const posts = []; page.on('response', async (r) => { if (r.request().method() === 'POST' && /admin\/payments\/withdrawals|refund/.test(r.url())) posts.push({ url: r.url().replace(/https?:\/\/[^/]+/, ''), status: r.status() }); });
await uiLogin(page, 'afr.admin@example.test', PW);
const rowFor = (id) => page.locator('li, tr, article, div, section').filter({ hasText: 'Yêu cầu ' + short(id) }).filter({ has: page.getByRole('button', { name: /^Từ chối/ }) }).last();
const dlg = () => page.locator('[role=alertdialog],[role=dialog]').first();
const chip = async (re) => { await page.getByRole('button', { name: re }).first().click(); await page.waitForTimeout(500); };
const chipText = async () => norm(await page.locator('main').innerText());

// ---------- H-02: approve W5 in the UI
await page.goto(BASE + '/admin/finance/withdrawals'); await settle(page, 2500);
let w = await walletOf('CLIENT', c1.id), e0 = await esc();
await rowFor(st.w.W5).getByRole('button', { name: /^Duyệt/ }).first().click(); await page.waitForTimeout(600);
let dtxt = norm(await dlg().innerText());
await page.screenshot({ path: `${SHOTS}/h02-approve-dialog-1440.png` });
posts.length = 0;
await dlg().getByRole('button', { name: /Duyệt và khoá tiền/ }).click(); await page.waitForTimeout(3000);
let w2 = await walletOf('CLIENT', c1.id), e1 = await esc(); let row = await wd(st.w.W5);
await page.screenshot({ path: `${SHOTS}/h02-after-approve-1440.png` });
let t = await chipText();
let iv = await invOk();
rec3('H-02 approve in UI (dialog says money NOT transferred; then APPROVED chip)', /chưa được chuyển|chưa chuyển/.test(dtxt) && row.status === 'APPROVED' && num(w.a) - num(w2.a) === 50000 && num(w2.l) - num(w.l) === 50000 && e0 === e1 && (await ops('WITHDRAWAL_LOCK:' + st.w.W5)) === 1 && posts.length === 1 && iv.ok,
  { dialogHasNotTransferredWording: /chưa được chuyển|chưa chuyển/.test(dtxt), post: posts.slice(), dbStatus: row.status, availDelta: num(w2.a) - num(w.a), lockedDelta: num(w2.l) - num(w.l), escrowDelta: e1 - e0, lockOps: await ops('WITHDRAWAL_LOCK:' + st.w.W5), chipsAfter: t.match(/Chờ duyệt \d+|Đã duyệt – chờ chuyển khoản \d+/g), inv: iv });

// ---------- H-03: mark W6 paid in the UI (from APPROVED)
await chip(/Đã duyệt/);
w = await walletOf('CLIENT', c1.id); e0 = await esc();
await rowFor(st.w.W6).getByRole('button', { name: /^Đã chi trả/ }).first().click(); await page.waitForTimeout(600);
const confirmBtn = dlg().getByRole('button', { name: /^Xác nhận/ });
const emptyDisabled = await confirmBtn.isDisabled().catch(() => null);
let emptyClickPost = 0; posts.length = 0;
if (emptyDisabled === false) { await confirmBtn.click(); await page.waitForTimeout(800); emptyClickPost = posts.length; }
await dlg().locator('input').first().fill('AFR-UI-BANK-0006');
await page.screenshot({ path: `${SHOTS}/h03-markpaid-dialog-1440.png` });
posts.length = 0;
await confirmBtn.click(); await page.waitForTimeout(3500);
w2 = await walletOf('CLIENT', c1.id); e1 = await esc(); row = await wd(st.w.W6);
const wtx = await q('payment', "select status, purpose from payment_transactions where idempotency_key=$1", ['WITHDRAWAL:' + st.w.W6]);
t = await chipText(); iv = await invOk();
await page.screenshot({ path: `${SHOTS}/h03-after-markpaid-1440.png` });
rec3('H-03 mark paid in UI (from APPROVED): ledger + P3 balanced', row.status === 'PAID' && row.bank_reference === 'AFR-UI-BANK-0006' && num(w.l) - num(w2.l) === 50000 && e0 - e1 === 50000 && wtx.length === 1 && wtx[0].status === 'PAID' && posts.length === 1 && posts[0].status === 200 && iv.ok,
  { emptyRefConfirmDisabled: emptyDisabled, postsOnEmptyRef: emptyClickPost, post: posts.slice(), dbStatus: row.status, bankRef: row.bank_reference, lockedDelta: num(w2.l) - num(w.l), escrowDelta: e1 - e0, withdrawalTx: wtx, uiTextAfter: t.slice(0, 220), inv: iv });

// ---------- E-03: another admin pays W7 while this tab is stale
await chip(/^Chờ duyệt/);
const pageStaleHasW7 = (await chipText()).includes('Yêu cầu ' + short(st.w.W7));
const pre = await call('POST', `/admin/payments/withdrawals/${st.w.W7}/mark-paid`, { token: admin.token, body: { bankReference: 'AFR-OTHER-ADMIN-0007' } });
w = await walletOf('CLIENT', (await login('afr.c2@example.test', PW)).id); e0 = await esc();
await rowFor(st.w.W7).getByRole('button', { name: /^Đã chi trả/ }).first().click(); await page.waitForTimeout(600);
await dlg().locator('input').first().fill('AFR-UI-DUP-0007');
posts.length = 0;
await dlg().getByRole('button', { name: /^Xác nhận/ }).click(); await page.waitForTimeout(3000);
const dAfter = (await dlg().isVisible().catch(() => false)) ? norm(await dlg().innerText()) : '';
t = await chipText();
await page.screenshot({ path: `${SHOTS}/e03-stale-markpaid-1440.png` });
const w7 = await wd(st.w.W7); const e2 = await esc();
const n7 = (await q('payment', "select count(*)::int n from payment_transactions where idempotency_key=$1", ['WITHDRAWAL:' + st.w.W7]))[0].n;
iv = await invOk();
const msgShown = /đã được chi|đã chi lúc|đã xử lý|đã ở trạng thái|PAID/i.test(dAfter + ' ' + t);
rec3('E-03 stale tab: second payer gets a clear message, no second money effect', pre.status === 200 && posts.length === 1 && e0 - e2 === 0 && n7 === 1 && w7.bank_reference === 'AFR-OTHER-ADMIN-0007' && iv.ok,
  { apiPrePaid: pre.status, uiPost: posts.slice(), uiMessageMatchesPlan: msgShown, dialogTextAfter: dAfter.slice(0, 400), pageTextSnippet: t.slice(0, 300), dbBankRef: w7.bank_reference, withdrawalTx: n7, escrowDeltaFromUiClick: e0 - e2, inv: iv, note: 'same admin identity used for the "other admin" API call' });

// ---------- H-04: service refund approve in UI (partial 200.000)
await page.goto(BASE + '/admin/finance/refunds'); await settle(page, 2500);
await page.getByRole('button', { name: /Xem chi tiết/ }).first().click(); await page.waitForTimeout(2500);
const num1 = page.locator('main input[type=number]').first();
const notes = page.locator('main textarea').first();
const w4 = await walletOf('CLIENT', c4.id);
// E-10 in UI: above the ceiling
await num1.fill('700000'); await notes.fill('AFR UI over-ceiling attempt');
const overBtnDisabled = await page.getByRole('button', { name: /Duyệt hoàn tiền/ }).first().isDisabled().catch(() => null);
const overText = norm(await page.locator('main').innerText());
await page.screenshot({ path: `${SHOTS}/e10-over-ceiling-1440.png` });
posts.length = 0;
if (overBtnDisabled === false) { await page.getByRole('button', { name: /Duyệt hoàn tiền/ }).first().click(); await page.waitForTimeout(1200); }
const overPosts = posts.length; const dOver = (await dlg().isVisible().catch(() => false)) ? norm(await dlg().innerText()) : '';
if (dOver) { await page.keyboard.press('Escape'); await page.waitForTimeout(500); }
rec3('E-10 UI blocks refund above ceiling (no POST, wallet unchanged)', overPosts === 0 && num((await walletOf('CLIENT', c4.id)).a) === num(w4.a), { approveButtonDisabled: overBtnDisabled, postsSent: overPosts, dialogOpened: !!dOver, hasCeilingText: /600\.000/.test(overText), wallet: w4.a });
await num1.fill('200000');
await page.getByRole('button', { name: /Duyệt hoàn tiền/ }).first().click(); await page.waitForTimeout(800);
const rd = norm(await dlg().innerText());
await page.screenshot({ path: `${SHOTS}/h04-refund-dialog-1440.png` });
posts.length = 0;
await dlg().getByRole('button').filter({ hasText: /^(Xác nhận|Duyệt|Hoàn)/ }).last().click(); await page.waitForTimeout(3500);
const w4b = await walletOf('CLIENT', c4.id); iv = await invOk();
const keyOps = await q('payment', 'select key from ledger_operations where key like $1', ['%PERSONALIZED_REFUND:' + st.orders.c4 + '%']);
await page.screenshot({ path: `${SHOTS}/h04-after-refund-1440.png` });
rec3('H-04 service refund approve in UI: dialog says credited to customer wallet, ceiling, amount; wallet +200.000 once', /ví khách|ví của khách/i.test(rd) && /200\.000/.test(rd) && /600\.000/.test(rd) && num(w4b.a) - num(w4.a) === 200000 && keyOps.length === 1 && keyOps[0].key.includes('200000') && posts.length === 1 && iv.ok,
  { dialogText: rd.slice(0, 600), post: posts.slice(), walletDelta: num(w4b.a) - num(w4.a), ledgerKeys: keyOps.map(k => k.key), inv: iv });

// ---------- Membership refund (G1) in UI on c3's membership
await page.goto(BASE + '/admin/finance/refunds?type=membership'); await settle(page, 2000);
const w3 = await walletOf('CLIENT', c3.id);
await page.locator('main input[type=text]').first().fill(st.memberships.c3.id);
await page.locator('main select').first().selectOption('TRANSACTION_ERROR');
await page.getByRole('button', { name: /Xem lại và hoàn tiền/ }).click(); await page.waitForTimeout(800);
const md = norm(await dlg().innerText());
await page.screenshot({ path: `${SHOTS}/g1-membership-confirm-1440.png` });
posts.length = 0;
await dlg().getByRole('button').filter({ hasText: /^(Xác nhận|Hoàn)/ }).last().click(); await page.waitForTimeout(3500);
const w3b = await walletOf('CLIENT', c3.id); iv = await invOk();
await page.screenshot({ path: `${SHOTS}/g1-after-membership-refund-1440.png` });
rec3('G1 membership refund in UI: client wallet credited once, ledger balanced', posts.length === 1 && posts[0].status === 200 && num(w3b.a) - num(w3.a) > 0 && num(w3b.a) - num(w3.a) < 500000 && iv.ok, { dialogText: md.slice(0, 500), post: posts.slice(), walletDelta: num(w3b.a) - num(w3.a), inv: iv });

// ---------- E-01 in UI: drift in the isolated payment DB only, restored afterwards
await q('payment', "update wallets set available_balance = available_balance + 777 where owner_type='PLATFORM' and owner_id='ESCROW'");
const seen = {};
for (const [p, name] of [['/admin/finance', 'overview'], ['/admin/finance/reconciliation', 'reconciliation'], ['/admin/dashboard', 'today']]) {
  await page.goto(BASE + p); await settle(page, 3000);
  const tx = norm(await page.locator('main').innerText());
  seen[name] = { hasDrift777: tx.includes(vnd(777)), hasChenhLech: /Lệch|lệch/.test(tx), saysBalanced: /Cân bằng/.test(tx) && !/Lệch/.test(tx), loadErr: /không tải được|lỗi tải/i.test(tx) };
  await page.screenshot({ path: `${SHOTS}/e01-drift-${name}-1440.png`, fullPage: true });
}
await q('payment', "update wallets set available_balance = available_balance - 777 where owner_type='PLATFORM' and owner_id='ESCROW'");
iv = await invOk();
rec3('E-01 drift 777 d: red drift shown on Tong quan / Doi soat / Hom nay, no load error', Object.values(seen).every(s => s.hasDrift777 && !s.loadErr && !s.saysBalanced) && iv.ok, { seen, restoredInv: iv });

saveState(st);
await browser.close();
