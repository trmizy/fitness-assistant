import { call, login, dbInv, walletOf, q, rec, inv, loadState, saveState } from './lib.mjs';
const PW = 'Test@123456'; const st = loadState(); st.w = st.w || {};
const admin = await login('afr.admin@example.test', PW);
const c1 = await login('afr.c1@example.test', PW), c2 = await login('afr.c2@example.test', PW);
const num = (x) => Number(x);
async function reqW(cl, amount, info = 'AFR Bank 0001 / NGUYEN VAN A') {
  const r = await call('POST', '/me/withdrawals', { token: cl.token, body: { amount: String(amount), payoutInfo: info } });
  if (r.status !== 201) throw new Error('withdraw req ' + r.status + JSON.stringify(r.body));
  return r.body.data.id;
}
const ops = async (key) => (await q('payment', 'select count(*)::int n from ledger_operations where key=$1', [key]))[0].n;
const wdRow = async (id) => (await q('payment', 'select status, amount::text, reviewed_by, bank_reference, paid_at from withdrawal_requests where id=$1', [id]))[0];
const esc = async () => num((await walletOf('PLATFORM', 'ESCROW')).a);
const W = {};
for (const k of ['W1', 'W2', 'W3', 'W4']) W[k] = await reqW(c1, 50000);
for (const k of ['W5', 'W6']) W[k] = await reqW(c1, 50000);
W.W7 = await reqW(c2, 50000);
rec('WD-requests-created', true, W);
let r = await call('GET', '/admin/payments/withdrawals', { token: admin.token });
rec('P7-list-pending', r.status === 200 && r.body.data.length === 7 && r.body.data.every(x => x.status === 'PENDING'), { http: r.status, n: r.body.data?.length, order: 'createdAt asc' });
await inv(admin.token, '10-after-requests');

// H-02: approve W1 double-submit
let w = await walletOf('CLIENT', c1.id); let e0 = await esc();
const [a1, a2] = await Promise.all([1, 2].map(() => call('POST', `/admin/payments/withdrawals/${W.W1}/approve`, { token: admin.token })));
let w2 = await walletOf('CLIENT', c1.id); let e1 = await esc();
const lockOps1 = await ops('WITHDRAWAL_LOCK:' + W.W1);
rec('H-02/E-04 approve W1 double-submit', a1.status === 200 && a2.status === 200 && lockOps1 === 1 && num(w.a) - num(w2.a) === 50000 && num(w2.l) - num(w.l) === 50000 && e0 === e1,
  { statuses: [a1.status, a2.status], lockOps: lockOps1, availDelta: num(w2.a) - num(w.a), lockedDelta: num(w2.l) - num(w.l), escrowDelta: e1 - e0, row: await wdRow(W.W1) });
await inv(admin.token, '11-after-approve-W1');

// H-03: markPaid from APPROVED
w = w2; e0 = e1;
r = await call('POST', `/admin/payments/withdrawals/${W.W1}/mark-paid`, { token: admin.token, body: { bankReference: 'AFR-BANK-REF-0001' } });
w2 = await walletOf('CLIENT', c1.id); e1 = await esc();
let tx = await q('payment', 'select id, status, purpose, amount::text, initiated_by from payment_transactions where idempotency_key=$1', ['WITHDRAWAL:' + W.W1]);
rec('H-03 markPaid from APPROVED', r.status === 200 && num(w.l) - num(w2.l) === 50000 && e0 - e1 === 50000 && tx.length === 1 && tx[0].status === 'PAID' && tx[0].purpose === 'WITHDRAWAL',
  { http: r.status, lockedDelta: num(w2.l) - num(w.l), escrowDelta: e1 - e0, tx, row: await wdRow(W.W1) });
await inv(admin.token, '12-after-markPaid-W1');

// E-03: replay markPaid (another admin already paid)
w = w2; e0 = e1;
r = await call('POST', `/admin/payments/withdrawals/${W.W1}/mark-paid`, { token: admin.token, body: { bankReference: 'AFR-BANK-REF-0001' } });
w2 = await walletOf('CLIENT', c1.id); e1 = await esc();
const txn = (await q('payment', "select count(*)::int n from payment_transactions where purpose='WITHDRAWAL' and idempotency_key=$1", ['WITHDRAWAL:' + W.W1]))[0].n;
rec('E-03 markPaid replay -> PAID, no second effect', r.status === 200 && r.body?.data?.status === 'PAID' && e0 === e1 && w.l === w2.l && txn === 1,
  { http: r.status, status: r.body?.data?.status, paidAt: r.body?.data?.paidAt, reviewedBy: r.body?.data?.reviewedBy, escrowDelta: e1 - e0, withdrawalTx: txn });
r = await call('POST', `/admin/payments/withdrawals/${W.W1}/mark-paid`, { token: admin.token, body: { bankReference: 'AFR-OTHER-REF' } });
rec('E-03b markPaid replay with different bankReference (informational)', true, { http: r.status, body: JSON.stringify(r.body).slice(0, 200), bankRefStored: (await wdRow(W.W1)).bank_reference });
await inv(admin.token, '13-after-replay');

// A-04: markPaid directly from PENDING (W2) + double submit
w = await walletOf('CLIENT', c1.id); e0 = await esc();
const [m1, m2] = await Promise.all([1, 2].map(() => call('POST', `/admin/payments/withdrawals/${W.W2}/mark-paid`, { token: admin.token, body: { bankReference: 'AFR-BANK-REF-0002' } })));
w2 = await walletOf('CLIENT', c1.id); e1 = await esc();
const tx2 = await q('payment', 'select status, purpose from payment_transactions where idempotency_key=$1', ['WITHDRAWAL:' + W.W2]);
rec('A-04/E-04 markPaid from PENDING double-submit', m1.status === 200 && m2.status === 200 && e0 - e1 === 50000 && num(w.a) - num(w2.a) === 50000 && num(w2.l) === num(w.l) && tx2.length === 1,
  { statuses: [m1.status, m2.status], availDelta: num(w2.a) - num(w.a), lockedDelta: num(w2.l) - num(w.l), escrowDelta: e1 - e0, tx: tx2, lockOps: await ops('WITHDRAWAL_LOCK:' + W.W2), row: await wdRow(W.W2) });
await inv(admin.token, '14-after-markPaid-from-PENDING');

// reject PENDING W3 (no ledger)
w = await walletOf('CLIENT', c1.id); e0 = await esc();
r = await call('POST', `/admin/payments/withdrawals/${W.W3}/reject`, { token: admin.token, body: { reason: 'AFR test: sai thong tin ngan hang' } });
w2 = await walletOf('CLIENT', c1.id); e1 = await esc();
rec('reject PENDING W3', r.status === 200 && r.body?.data?.status === 'REJECTED' && w.a === w2.a && w.l === w2.l && e0 === e1, { http: r.status, status: r.body?.data?.status, availDelta: num(w2.a) - num(w.a), escrowDelta: e1 - e0 });
r = await call('POST', `/admin/payments/withdrawals/${W.W4}/reject`, { token: admin.token, body: {} });
rec('reject without reason -> 400', r.status === 400, { http: r.status, code: r.body?.error?.code });
await call('POST', `/admin/payments/withdrawals/${W.W4}/approve`, { token: admin.token });
w = await walletOf('CLIENT', c1.id);
r = await call('POST', `/admin/payments/withdrawals/${W.W4}/reject`, { token: admin.token, body: { reason: 'AFR test: huy sau khi duyet' } });
w2 = await walletOf('CLIENT', c1.id);
const unl = await ops('WITHDRAWAL_UNLOCK:' + W.W4);
rec('reject APPROVED W4 -> unlock', r.status === 200 && num(w.l) - num(w2.l) === 50000 && num(w2.a) - num(w.a) === 50000 && unl === 1, { http: r.status, lockedDelta: num(w2.l) - num(w.l), availDelta: num(w2.a) - num(w.a), unlockOps: unl });
r = await call('POST', `/admin/payments/withdrawals/${W.W1}/reject`, { token: admin.token, body: { reason: 'x' } });
rec('reject PAID -> 400', r.status === 400, { http: r.status, code: r.body?.error?.code });
r = await call('POST', `/admin/payments/withdrawals/${W.W1}/approve`, { token: admin.token });
rec('approve PAID -> 400', r.status === 400, { http: r.status, code: r.body?.error?.code });
r = await call('POST', `/admin/payments/withdrawals/${W.W5}/mark-paid`, { token: admin.token, body: {} });
rec('markPaid without bankReference -> 400', r.status === 400, { http: r.status, code: r.body?.error?.code });
r = await call('POST', '/admin/payments/withdrawals/00000000-0000-0000-0000-000000000000/approve', { token: admin.token });
rec('approve unknown id -> 404', r.status === 404, { http: r.status, code: r.body?.error?.code });
r = await call('POST', `/admin/payments/withdrawals/${W.W5}/approve`, { token: c2.token });
rec('customer approve -> 403, row unchanged', r.status === 403 && (await wdRow(W.W5)).status === 'PENDING', { http: r.status });
r = await call('POST', `/admin/payments/withdrawals/${W.W5}/approve`, {});
rec('anonymous approve -> 401', r.status === 401, { http: r.status });
await inv(admin.token, '15-after-rejects');
r = await call('POST', `/admin/payments/withdrawals/${W.W6}/approve`, { token: admin.token });
rec('seed W6 APPROVED for UI', r.status === 200, { http: r.status });
await inv(admin.token, '16-after-seed-W6');
st.w = W; saveState(st);
