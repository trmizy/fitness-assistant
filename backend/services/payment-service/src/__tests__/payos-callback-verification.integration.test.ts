/**
 * PayOS: a correctly SIGNED webhook is not proof that the payer handed over the order's price.
 *
 * PayOS facts these tests encode:
 *   - webhook body {code, desc, success, data, signature}; signature = HMAC-SHA256(checksumKey) over `data` as
 *     key=value pairs sorted by key and joined with &
 *   - one webhook per BANK TRANSFER that lands on the payment link, carrying that transfer's own `amount` (plain VND)
 *     - so an under-payment, an over-payment and a payment split in two transfers all arrive as amounts that differ
 *     from the price
 *   - the payload names no merchant: the checksum key is what binds it to us; data.paymentLinkId binds it to the link
 *     created for the transaction; data.currency is VND
 *   - HTTP 200 stops PayOS retries (any other status triggers them)
 *   - GET /v2/payment-requests/:orderCode reports status and amountPaid
 *
 * BACKEND INTEGRATION (real routes + real ledger on an isolated *_test DB); PayOS and the owning services are a local
 * stub - no real PayOS traffic. Run THIS FILE ALONE:
 *   DATABASE_URL="postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_payment_gw_test?schema=public" \
 *     ./node_modules/.bin/tsx --test src/__tests__/payos-callback-verification.integration.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { randomUUID } from 'crypto';

const CHECKSUM = 'test-only-payos-checksum-key';
process.env.PAYOS_CLIENT_ID = 'test-client-id';
process.env.PAYOS_API_KEY = 'test-api-key';
process.env.PAYOS_CHECKSUM_KEY = CHECKSUM;
process.env.PAYMENT_PROVIDER = 'PAYOS';
delete process.env.NODE_ENV;

import {
  skipOpts, load, shutdown, resetLedger, checkout, txnRow, ledgerRows, activations, discrepancy, escrowCredit,
  ledgerSnapshot, assertNothingMoved, settlementRows, post, captureAlerts, stub, calls,
  type Mods, type Checkout, type Purpose,
} from './support/gateway-harness';

test.after(shutdown);

/** PayOS's canonical string: keys sorted A-Z, k=v joined by & (null/undefined -> ''). Written out independently. */
const sortedSign = (obj: Record<string, unknown>) =>
  Object.keys(obj).sort().map((k) => `${k}=${obj[k] === null || obj[k] === undefined ? '' : obj[k]}`).join('&');
const sign = (data: Record<string, unknown>, key = CHECKSUM) => crypto.createHmac('sha256', key).update(Buffer.from(sortedSign(data), 'utf-8')).digest('hex');

let orderSeq = 0;
const nextOrderCode = () => String(1_760_000_000_000_000 + ++orderSeq);

interface WhOpts {
  amount?: unknown;
  omitAmount?: boolean;
  reference?: string;
  currency?: string | null;
  paymentLinkId?: string;
  dataCode?: string;
  bodyCode?: string;
  success?: boolean;
  orderCode?: unknown;
  omitOrderCode?: boolean;
  key?: string;
}

function payosBody(c: Checkout, o: WhOpts = {}): string {
  const data: Record<string, unknown> = {
    description: 'GYM',
    accountNumber: '12345678',
    reference: o.reference ?? 'FT26101400001',
    transactionDateTime: '2026-10-14 10:00:00',
    paymentLinkId: o.paymentLinkId ?? ((await_meta(c).paymentLinkId as string) ?? 'plink-default'),
    code: o.dataCode ?? '00',
    desc: 'Thanh cong',
    counterAccountBankId: '',
    counterAccountName: null,
    virtualAccountNumber: '',
  };
  if (!o.omitOrderCode) data.orderCode = o.orderCode ?? Number(c.ref);
  if (!o.omitAmount) data.amount = o.amount === undefined ? c.price : o.amount;
  if (o.currency !== null) data.currency = o.currency ?? 'VND';
  return JSON.stringify({ code: o.bodyCode ?? '00', desc: 'success', success: o.success ?? true, data, signature: sign(data, o.key) });
}
// The paymentLinkId stored on the checkout, remembered per reference so bodies can echo it.
const links = new Map<string, string>();
const await_meta = (c: Checkout) => ({ paymentLinkId: links.get(c.ref) });

const hook = (m: Mods, body: string) => post(m, '/payments/webhook/payos', body);

async function newCheckout(m: Mods, o: Parameters<typeof checkout>[2] = {}) {
  const ref = o.ref ?? nextOrderCode();
  const link = `plink-${randomUUID().slice(0, 8)}`;
  links.set(ref, link);
  return checkout(m, 'PAYOS', { ...o, ref, metadata: { orderCode: Number(ref), paymentLinkId: link, ...(o.metadata ?? {}) } });
}

// ═════════════════════════════ valid payment, duplicate, replay ═════════════════════════════

test('valid payment: webhook settles once (HTTP 200 success:true); ledger, escrow and activation reconcile', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const c = await newCheckout(m);
  const r = await hook(m, payosBody(c));
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { success: true });
  assert.equal((await txnRow(m, c)).status, 'PAID');
  assert.equal(await escrowCredit(m, c), BigInt(c.price));
  assert.equal(await ledgerRows(m, c), settlementRows(c.purpose));
  assert.equal(activations().length, 1);
  assert.equal(await discrepancy(m, c), undefined);
  await m.reconcile.assertInvariant('payos valid');
});

test('replay after settlement: the same webhook and a re-issued one move nothing', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const c = await newCheckout(m);
  const body = payosBody(c, { reference: 'REF-1' });
  assert.deepEqual((await hook(m, body)).json, { success: true });
  const rows = await ledgerRows(m, c);
  assert.deepEqual((await hook(m, body)).json, { success: true }, 'identical replay');
  assert.deepEqual((await hook(m, payosBody(c, { reference: 'REF-2' }))).json, { success: true }, 'a new transfer reference for an already-paid link');
  assert.equal(await ledgerRows(m, c), rows);
  assert.equal(await escrowCredit(m, c), BigInt(c.price));
  assert.equal(activations().length, 1);
  await m.reconcile.assertInvariant('payos replay');
});

// ═════════════════════════════ amount ═════════════════════════════

test('wrong amount (under / over): success:false AMOUNT_MISMATCH, nothing settles — LEDGER BEFORE == AFTER', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const c = await newCheckout(m, { price: 5_000_000 });
  await m.wallet.getEscrowWallet();
  const before = await ledgerSnapshot(m);

  const r = await hook(m, payosBody(c, { amount: 1_000 }));
  assert.equal(r.status, 200, 'HTTP 200 stops PayOS retrying a callback that can never be right');
  assert.deepEqual(r.json, { success: false, code: 'AMOUNT_MISMATCH' });
  assert.equal((await txnRow(m, c)).status, 'FAILED');
  await assertNothingMoved(m, c, 'payos underpayment');
  const after = await ledgerSnapshot(m);
  assert.equal(after, before);
  console.log(`LEDGER-EVIDENCE payos under-payment 1,000 vs 5,000,000: before=${before} after=${after}`);

  const d = await discrepancy(m, c);
  assert.equal(d.kind, 'AMOUNT_MISMATCH');
  assert.equal(d.provider, 'PAYOS');
  assert.equal(d.expectedAmountVnd, '5000000');
  assert.equal(d.reportedAmountVnd, '1000');
  assert.equal(d.gatewayTransactionNo, 'FT26101400001', 'the bank reference, for the admin to find the transfer');
  assert.equal(d.source, 'IPN');

  const over = await newCheckout(m, { price: 5_000_000 });
  assert.equal((await hook(m, payosBody(over, { amount: 9_000_000 }))).json.success, false);
  assert.equal((await txnRow(m, over)).status, 'FAILED');
  await assertNothingMoved(m, over, 'payos overpayment');
});

test('wrong UNIT and malformed amounts are refused: x100, /100, off-by-one, fractional, negative, zero, text, exponent, null, absent', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const price = 5_000_000;
  const cases: Array<[string, WhOpts]> = [
    ['x100', { amount: price * 100 }],
    ['/100', { amount: price / 100 }],
    ['one VND short', { amount: price - 1 }],
    ['one VND over', { amount: price + 1 }],
    ['fractional', { amount: price + 0.5 }],
    ['negative', { amount: -price }],
    ['zero', { amount: 0 }],
    ['text', { amount: 'abc' }],
    ['exponent', { amount: '5e6' }],
    ['null', { amount: null }],
    ['absent', { omitAmount: true }],
  ];
  for (const [label, o] of cases) {
    const c = await newCheckout(m, { price });
    const r = await hook(m, payosBody(c, o));
    assert.equal(r.json.success, false, `${label}: refused`);
    assert.equal((await txnRow(m, c)).status, 'FAILED', `${label}: not paid`);
    await assertNothingMoved(m, c, label);
  }
});

test('a payment split in two bank transfers: neither half settles the order (each webhook carries only its own amount)', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const c = await newCheckout(m, { price: 2_000_000 });
  assert.equal((await hook(m, payosBody(c, { amount: 1_000_000, reference: 'HALF-1' }))).json.success, false);
  assert.equal((await hook(m, payosBody(c, { amount: 1_000_000, reference: 'HALF-2' }))).json.success, false);
  assert.notEqual((await txnRow(m, c)).status, 'PAID');
  await assertNothingMoved(m, c, 'payos split payment');
  assert.ok((await discrepancy(m, c)).occurrences >= 2, 'both transfers are on record for the admin');
});

// ═════════════════════════════ signature, merchant binding, status ═════════════════════════════

test('bad signature: refused, and nothing is written — tampered amount, wrong key, missing signature, missing data, junk', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const c = await newCheckout(m, { price: 5_000_000 });
  const low = JSON.parse(payosBody(c, { amount: 1_000 }));
  const tampered = JSON.stringify({ ...low, data: { ...low.data, amount: 5_000_000 } });
  const cases: Array<[string, string]> = [
    ['tampered amount', tampered],
    ['signed with another merchant\'s checksum key', payosBody(c, { key: 'someone-elses-checksum-key' })],
    ['signature missing', JSON.stringify({ ...low, signature: undefined })],
    ['signature empty', JSON.stringify({ ...low, signature: '' })],
    ['data missing', JSON.stringify({ code: '00', success: true, signature: low.signature })],
    ['data not an object', JSON.stringify({ code: '00', success: true, data: 'x', signature: low.signature })],
    ['not json', 'orderCode=1&amount=5000000'],
    ['empty', ''],
  ];
  for (const [label, body] of cases) {
    const r = await hook(m, body);
    assert.deepEqual(r.json, { success: false, code: 'BAD_SIGNATURE' }, label);
  }
  assert.equal((await txnRow(m, c)).status, 'PENDING');
  await assertNothingMoved(m, c, 'payos bad signature');
  assert.equal(await discrepancy(m, c), undefined);
  assert.equal(await m.prisma.paymentWebhookEvent.count(), 0);
});

test('merchant/link binding: a validly signed webhook for a DIFFERENT payment link, or in another currency, or without orderCode, settles nothing', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const c = await newCheckout(m);
  assert.deepEqual((await hook(m, payosBody(c, { paymentLinkId: 'plink-of-someone-else', reference: 'X1' }))).json, { success: false, code: 'REFERENCE_MISMATCH' });
  assert.deepEqual((await hook(m, payosBody(c, { currency: 'USD', reference: 'X2' }))).json, { success: false, code: 'BAD_SIGNATURE' });
  assert.equal((await hook(m, payosBody(c, { omitOrderCode: true, reference: 'X3' }))).json.success, false);
  assert.equal((await txnRow(m, c)).status, 'PENDING');
  await assertNothingMoved(m, c, 'payos link binding');

  // currency omitted entirely is tolerated (PayOS sends VND); the right link then settles.
  assert.deepEqual((await hook(m, payosBody(c, { currency: null, reference: 'X4' }))).json, { success: true });
  assert.equal(await escrowCredit(m, c), BigInt(c.price));
});

test('a failed / mixed-status webhook is not a payment: data.code != 00, body.code != 00, success:false', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  for (const [label, o] of [
    ['data.code 01', { dataCode: '01' }],
    ['body.code 01', { bodyCode: '01' }],
    ['success false', { success: false }],
  ] as Array<[string, WhOpts]>) {
    const c = await newCheckout(m);
    const r = await hook(m, payosBody(c, o));
    assert.deepEqual(r.json, { success: true }, `${label}: acknowledged (nothing for PayOS to retry)`);
    assert.equal((await txnRow(m, c)).status, 'PENDING', `${label}: not settled`);
    await assertNothingMoved(m, c, label);
  }
});

test('unknown order and another provider\'s reference: refused, nothing created or moved', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const ghost: Checkout = { txnId: randomUUID(), ref: nextOrderCode(), entityId: 'x', price: 1_000_000, purpose: 'PT_CONTRACT', provider: 'PAYOS', parties: { ptUserId: 'p', gymId: null, clientUserId: 'c' } };
  links.set(ghost.ref, 'plink-ghost');
  assert.deepEqual((await hook(m, payosBody(ghost))).json, { success: false, code: 'ORDER_NOT_FOUND' });
  assert.equal(await m.prisma.paymentTransaction.count(), 0);

  const other = await checkout(m, 'ZALOPAY', { ref: ghost.ref });
  assert.equal((await hook(m, payosBody({ ...other, provider: 'PAYOS' }))).json.success, false);
  assert.equal((await txnRow(m, other)).status, 'PENDING');
  await assertNothingMoved(m, other, 'payos cross-provider');
});

test('two transactions sharing one reference (a collision): the callback is refused rather than guessed', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const ref = nextOrderCode();
  const a = await newCheckout(m, { ref });
  const b = await newCheckout(m, { ref });
  links.set(ref, 'plink-collision');
  assert.deepEqual((await hook(m, payosBody(a, { paymentLinkId: 'plink-collision' }))).json, { success: false, code: 'ERROR' });
  for (const t of [a, b]) {
    assert.equal((await txnRow(m, t)).status, 'PENDING');
    assert.equal(await ledgerRows(m, t), 0);
  }
  assert.equal(activations().length, 0);
});

test('the PayOS orderCode is unique per checkout, positive and a JS-safe integer (no millisecond collisions)', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  stub.gateway = (path) => ({ status: 200, body: path.startsWith('/payos/v2/payment-requests') ? { code: '00', desc: 'success', data: { checkoutUrl: 'https://pay.example/x', qrCode: 'qr', paymentLinkId: 'plink-x' } } : {} });
  const { PayOSProvider } = await import('../providers/payos.provider');
  const p = new PayOSProvider();
  const results: Awaited<ReturnType<typeof p.createPaymentIntent>>[] = [];
  for (let batch = 0; batch < 10; batch++) {
    // 50 at once per batch: many of them land in the same millisecond, which is where Date.now() alone collided.
    results.push(...(await Promise.all(Array.from({ length: 50 }, () => p.createPaymentIntent({ transactionId: randomUUID(), amount: 100_000, orderInfo: 'x' })))));
  }
  const codes = results.map((r) => r.providerTransactionId);
  assert.equal(new Set(codes).size, codes.length, 'all 500 order codes are distinct even though they were created in the same millisecond or two');
  for (const code of codes) {
    assert.ok(/^\d+$/.test(code));
    assert.ok(Number.isSafeInteger(Number(code)) && Number(code) > 0, `${code} is a safe positive integer`);
  }
  assert.ok(calls.some((x) => x.method === 'POST' && x.path.startsWith('/payos/v2/payment-requests')));
});

// ═════════════════════════════ duplicates of a WRONG webhook ═════════════════════════════

test('the same wrong-amount webhook delivered many times: ONE record, ONE alert, nothing moves', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const c = await newCheckout(m, { price: 3_000_000 });
  const body = payosBody(c, { amount: 100 });
  const { alerts } = await captureAlerts(async () => {
    for (let i = 0; i < 4; i++) assert.deepEqual((await hook(m, body)).json, { success: false, code: 'AMOUNT_MISMATCH' });
    const rs = await Promise.all(Array.from({ length: 4 }, () => hook(m, body)));
    for (const r of rs) assert.equal(r.json.success, false);
  });
  assert.equal(alerts, 1, 'exactly one alert-level log line');
  const t = await txnRow(m, c);
  assert.equal(t.status, 'FAILED');
  assert.equal(Object.keys(t.metadata as any).filter((k) => k === 'gatewayDiscrepancy').length, 1);
  assert.equal((await m.txnRepo.findWithGatewayDiscrepancy(50)).filter((x) => x.id === c.txnId).length, 1);
  await assertNothingMoved(m, c, 'payos duplicate wrong');
});

// ═════════════════════════════ races ═════════════════════════════

test('six concurrent identical webhooks settle exactly once', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const c = await newCheckout(m, { price: 1_200_000 });
  const body = payosBody(c, { reference: 'RACE' });
  const rs = await Promise.all(Array.from({ length: 6 }, () => hook(m, body)));
  for (const r of rs) assert.deepEqual(r.json, { success: true });
  assert.equal((await txnRow(m, c)).status, 'PAID');
  assert.equal(await escrowCredit(m, c), 1_200_000n);
  assert.equal(await ledgerRows(m, c), settlementRows(c.purpose));
  await m.reconcile.assertInvariant('payos concurrent identical');
  await Promise.all([hook(m, payosBody(c, { reference: 'RACE2' })), hook(m, body)]);
  assert.equal(await ledgerRows(m, c), settlementRows(c.purpose));
  await m.reconcile.assertInvariant('payos concurrent, later');
});

test('concurrent webhooks with DIFFERENT amounts: the exact one settles once, the wrong ones never do', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  for (let round = 0; round < 3; round++) {
    const c = await newCheckout(m, { price: 4_000_000 });
    await Promise.all([
      hook(m, payosBody(c, { amount: 1_000, reference: 'A' })),
      hook(m, payosBody(c, { reference: 'B' })),
      hook(m, payosBody(c, { amount: 8_000_000, reference: 'C' })),
    ]);
    assert.equal((await txnRow(m, c)).status, 'PAID');
    assert.equal(await escrowCredit(m, c), 4_000_000n);
    assert.equal(await ledgerRows(m, c), settlementRows(c.purpose));
    await m.reconcile.assertInvariant(`payos mixed concurrent ${round}`);
  }
});

test('a wrong-amount webhook AFTER the right one settled is refused but the PAID transaction is untouched', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const c = await newCheckout(m, { price: 3_000_000 });
  assert.equal((await hook(m, payosBody(c))).json.success, true);
  const rows = await ledgerRows(m, c);
  assert.equal((await hook(m, payosBody(c, { amount: 1_000, reference: 'LATE' }))).json.success, false);
  const t = await txnRow(m, c);
  assert.equal(t.status, 'PAID');
  assert.equal(await ledgerRows(m, c), rows);
  assert.equal((t.metadata as any).gatewayDiscrepancy.kind, 'AMOUNT_MISMATCH');
  await m.reconcile.assertInvariant('payos wrong after right');
});

// ═════════════════════════════ states and purposes ═════════════════════════════

test('REFUNDED is never revived; a late exact payment on a FAILED checkout still settles, a late wrong one does not', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const refunded = await newCheckout(m, { status: 'REFUNDED' });
  assert.equal((await hook(m, payosBody(refunded))).json.success, true);
  assert.equal((await txnRow(m, refunded)).status, 'REFUNDED');
  await assertNothingMoved(m, refunded, 'payos refunded');

  const late = await newCheckout(m, { status: 'FAILED' });
  assert.equal((await hook(m, payosBody(late))).json.success, true);
  assert.equal((await txnRow(m, late)).status, 'PAID');
  const lateWrong = await newCheckout(m, { status: 'FAILED' });
  assert.equal((await hook(m, payosBody(lateWrong, { amount: 10 }))).json.success, false);
  assert.equal((await txnRow(m, lateWrong)).status, 'FAILED');
  assert.equal(await ledgerRows(m, lateWrong), 0);
  await m.reconcile.assertInvariant('payos states');
});

for (const purpose of ['PT_CONTRACT', 'GYM_MEMBERSHIP', 'PERSONALIZED_SERVICE_PURCHASE'] as Purpose[]) {
  test(`${purpose}: exact amount settles with the right ledger; a wrong amount moves nothing`, skipOpts, async () => {
    const m = await load();
    await resetLedger(m);
    const ok = await newCheckout(m, { purpose, price: 900_000 });
    assert.equal((await hook(m, payosBody(ok))).json.success, true);
    assert.equal(await escrowCredit(m, ok), 900_000n);
    assert.equal(await ledgerRows(m, ok), settlementRows(purpose));
    const bad = await newCheckout(m, { purpose, price: 900_000 });
    assert.equal((await hook(m, payosBody(bad, { amount: 90 }))).json.success, false);
    assert.equal(await ledgerRows(m, bad), 0);
    await m.reconcile.assertInvariant(`${purpose} payos`);
  });
}

// ═════════════════════════════ the poll (GET payment-requests/:orderCode) ═════════════════════════════

test('poll: exact amountPaid settles; wrong / absent amount, other orderCode, cancelled, pending never settle wrongly', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const answer = (c: Checkout, data: Record<string, unknown>) => {
    stub.gateway = () => ({ status: 200, body: { code: '00', desc: 'success', data: { orderCode: Number(c.ref), amount: c.price, ...data } } });
  };

  const good = await newCheckout(m);
  answer(good, { status: 'PAID', amountPaid: good.price });
  assert.equal(await m.webhook.pollAndSettle(await txnRow(m, good)), 'PAID');
  assert.equal(await escrowCredit(m, good), BigInt(good.price));
  assert.equal(activations().length, 1);

  const low = await newCheckout(m, { price: 5_000_000 });
  answer(low, { status: 'PAID', amountPaid: 1_000 });
  assert.equal(await m.webhook.pollAndSettle(await txnRow(m, low)), 'FAILED');
  assert.equal((await discrepancy(m, low)).source, 'POLL');
  assert.equal(await ledgerRows(m, low), 0);

  const absent = await newCheckout(m);
  answer(absent, { status: 'PAID' });
  assert.equal(await m.webhook.pollAndSettle(await txnRow(m, absent)), 'FAILED');
  assert.equal((await discrepancy(m, absent)).kind, 'AMOUNT_MISSING');

  const wrongOrder = await newCheckout(m);
  stub.gateway = () => ({ status: 200, body: { code: '00', data: { orderCode: 42, amount: wrongOrder.price, amountPaid: wrongOrder.price, status: 'PAID' } } });
  assert.equal(await m.webhook.pollAndSettle(await txnRow(m, wrongOrder)), 'PENDING', 'an answer about another order is not a confirmation');
  assert.equal(await ledgerRows(m, wrongOrder), 0);

  const cancelled = await newCheckout(m);
  answer(cancelled, { status: 'CANCELLED', amountPaid: 0 });
  assert.equal(await m.webhook.pollAndSettle(await txnRow(m, cancelled)), 'FAILED');
  const pending = await newCheckout(m);
  answer(pending, { status: 'PENDING', amountPaid: 0 });
  assert.equal(await m.webhook.pollAndSettle(await txnRow(m, pending)), 'PENDING');
  assert.equal((await txnRow(m, pending)).status, 'PENDING');

  assert.equal(activations().length, 1, 'only the exact payment activated anything');
  await m.reconcile.assertInvariant('payos poll matrix');
});

// ═════════════════════════════ production gate ═════════════════════════════

test('production gate: not settled, not polled, no checkout until PAYOS_PRODUCTION_VERIFIED=true', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const prev = process.env.NODE_ENV;
  const prevFlag = process.env.PAYOS_PRODUCTION_VERIFIED;
  try {
    process.env.NODE_ENV = 'production';
    delete process.env.PAYOS_PRODUCTION_VERIFIED;
    assert.equal(m.paymentService.providerConfigStatus('PAYOS').configured, false);
    const c = await newCheckout(m);
    assert.deepEqual((await hook(m, payosBody(c))).json, { success: false, code: 'GATEWAY_DISABLED' });
    assert.equal((await txnRow(m, c)).status, 'PENDING');
    await assertNothingMoved(m, c, 'payos production gate');
    assert.equal(await m.webhook.pollAndSettle(await txnRow(m, c)), 'UNSUPPORTED');
    process.env.PAYOS_PRODUCTION_VERIFIED = 'true';
    assert.equal(m.paymentService.providerConfigStatus('PAYOS').configured, true);
    assert.equal((await hook(m, payosBody(c))).json.success, true, 'a retry after verification settles');
    assert.equal(await escrowCredit(m, c), BigInt(c.price));
  } finally {
    if (prev === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = prev;
    if (prevFlag === undefined) delete process.env.PAYOS_PRODUCTION_VERIFIED; else process.env.PAYOS_PRODUCTION_VERIFIED = prevFlag;
  }
});
