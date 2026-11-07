import { call, login, dbInv, walletOf, q, rec, inv, loadState, saveState, recon } from './lib.mjs';
const PW = 'Test@123456'; const st = loadState();
const admin = await login('afr.admin@example.test', PW);
const c2 = await login('afr.c2@example.test', PW);
// E-03 re-record with exact detail (sequential replay of markPaid on a PAID row)
rec('E-03 markPaid sequential replay on PAID row (plan expects 200 replay)', false,
  { observedHttp: 400, observedCode: 'INVALID_STATUS', message: 'Khong the chi tra mot yeu cau o trang thai PAID', moneyEffect: 'none (escrow/locked unchanged, 1 WITHDRAWAL tx)', source: 'withdrawal.service.ts markPaid pre-check rejects PAID before the in-transaction replay; only a CONCURRENT second call replays (200)', severity: 'P3 spec/audit mismatch, no money impact' });

// E-01: drift -> 409 with body ; create drift ONLY in the afr payment DB then restore exactly
const pay = await import('./lib.mjs');
const before = await dbInv();
await q('payment', "update wallets set available_balance = available_balance + 1234.56 where owner_type='PLATFORM' and owner_id='ESCROW'");
const r = await call('GET', '/admin/payments/reconciliation', { token: admin.token });
rec('E-01 drift -> HTTP 409 with full data body', r.status === 409 && r.body?.success === false && r.body?.data?.balanced === false && r.body?.data?.drift === '1234.56',
  { http: r.status, success: r.body?.success, drift: r.body?.data?.drift, escrow: r.body?.data?.escrow, claims: r.body?.data?.claims, balanced: r.body?.data?.balanced, errorCode: r.body?.error?.code });
const dash = await call('GET', '/admin/dashboard', { token: admin.token });
rec('W1 dashboard tolerates 409 money state', dash.status === 200, { http: dash.status, money: JSON.stringify(dash.body?.data?.money ?? dash.body?.data?.reconciliation ?? null).slice(0, 200) });
const ob = await call('GET', '/admin/payments/obligations', { token: admin.token });
rec('P13 while drifted (obligations still 200)', ob.status === 200, { http: ob.status });
await q('payment', "update wallets set available_balance = available_balance - 1234.56 where owner_type='PLATFORM' and owner_id='ESCROW'");
await inv(admin.token, '20-after-drift-restored');

// E-05: approve when wallet can no longer fund it (create the shortage only in the afr DB, restore afterwards)
const wr = await call('POST', '/me/withdrawals', { token: c2.token, body: { amount: '20000', payoutInfo: 'AFR Bank E05' } });
const wid = wr.body?.data?.id;
const w0 = await walletOf('CLIENT', c2.id);
await q('payment', "update wallets set available_balance = 0 where owner_type='CLIENT' and owner_id=$1", [c2.id]);
const ap = await call('POST', `/admin/payments/withdrawals/${wid}/approve`, { token: admin.token });
await q('payment', "update wallets set available_balance = $2 where owner_type='CLIENT' and owner_id=$1", [c2.id, w0.a]);
const row = (await q('payment', 'select status from withdrawal_requests where id=$1', [wid]))[0];
rec('E-05 approve with insufficient wallet -> currently 500 INTERNAL_ERROR (G-13)', ap.status === 500, { http: ap.status, code: ap.body?.error?.code, rowStatus: row.status, note: 'plan says 500 today; target 409 not implemented (BACKEND GAP G-13)' });
await inv(admin.token, '21-after-E05-restored');
// reject the helper request to keep queue clean
await call('POST', `/admin/payments/withdrawals/${wid}/reject`, { token: admin.token, body: { reason: 'AFR E-05 helper' } });

// G1 negative paths
const g1 = await call('POST', `/admin/gym-memberships/${st.memberships.c2.id}/refund`, { token: admin.token, body: { reason: 'TRANSACTION_ERROR' } });
const wC2 = await walletOf('CLIENT', c2.id);
rec('G1 sequential repeat on already-refunded membership (informational)', true, { http: g1.status, body: JSON.stringify(g1.body).slice(0, 200), c2WalletAvail: wC2.a });
const gBad = await call('POST', `/admin/gym-memberships/${st.memberships.c3.id}/refund`, { token: admin.token, body: { reason: 'BOGUS' } });
rec('G1 invalid reason -> 4xx, membership untouched', gBad.status >= 400 && gBad.status < 500, { http: gBad.status, body: JSON.stringify(gBad.body).slice(0, 200) });
const gAnon = await call('POST', `/admin/gym-memberships/${st.memberships.c3.id}/refund`, { token: c2.token, body: { reason: 'TRANSACTION_ERROR' } });
rec('G1 customer -> 403', gAnon.status === 403, { http: gAnon.status });
await inv(admin.token, '22-after-G1-negative');
