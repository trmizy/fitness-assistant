import { call, login, recon, dbInv, walletOf, q, rec, inv, loadState } from './lib.mjs';
const PW='Test@123456'; const st = loadState();
const admin = await login('afr.admin@example.test', PW);
const c1 = await login('afr.c1@example.test', PW), c2 = await login('afr.c2@example.test', PW);
await inv(admin.token, '00-start');
// --- G1 membership refund c1 (single) ---
const w1b = await walletOf('CLIENT', c1.id);
let r = await call('POST', `/admin/gym-memberships/${st.memberships.c1.id}/refund`, { token: admin.token, body: { reason: 'TRANSACTION_ERROR' } });
console.log('G1 c1', r.status, JSON.stringify(r.body).slice(0, 500));
const w1a = await walletOf('CLIENT', c1.id);
rec('G1-c1-refund', r.status === 200, { http: r.status, refundAmount: r.body?.data?.refundAmount ?? r.body?.refundAmount, walletBefore: w1b?.a, walletAfter: w1a?.a });
await inv(admin.token, '01-after-G1-c1');
// --- G1 double submit c2 ---
const w2b = await walletOf('CLIENT', c2.id);
const [ra, rb] = await Promise.all([1,2].map(() => call('POST', `/admin/gym-memberships/${st.memberships.c2.id}/refund`, { token: admin.token, body: { reason: 'TRANSACTION_ERROR' } })));
const w2a = await walletOf('CLIENT', c2.id);
const ra1 = ra.body?.data?.refundAmount ?? ra.body?.refundAmount;
console.log('G1 c2 double', ra.status, rb.status, JSON.stringify(ra.body).slice(0,300), JSON.stringify(rb.body).slice(0,300));
const delta = Number(w2a.a) - Number(w2b?.a ?? 0);
const entries = await q('payment', "select count(*)::int n from wallet_ledger_entries e join wallets w on w.id=e.wallet_id where w.owner_type='CLIENT' and w.owner_id=$1 and e.entry_type='CREDIT'", [c2.id]);
rec('G1-c2-double-submit', delta === Number(ra1 ?? w2a.a) && delta > 0, { statuses: [ra.status, rb.status], refundAmount: ra1, clientWalletDelta: delta, clientCreditEntries: entries[0].n });
await inv(admin.token, '02-after-G1-c2-double');
const m = await q('gym', 'select id, status from gym_memberships where id = any($1)', [[st.memberships.c1.id, st.memberships.c2.id]]);
rec('G1-membership-status', m.every(x => x.status !== 'ACTIVE'), m);
