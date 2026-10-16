/**
 * MoMo: a correctly SIGNED IPN is not proof that the payer handed over the order's price.
 *
 * MoMo facts these tests encode:
 *   - IPN is a JSON POST {partnerCode, orderId, requestId, amount, orderInfo, orderType, transId, resultCode, message,
 *     payType, responseTime, extraData, signature}; signature = HMAC-SHA256(secretKey) over the alphabetically ordered
 *     fields, with the merchant's own accessKey in front
 *   - amount is plain VND; partnerCode is the merchant; orderId is the reference WE sent at create time
 *   - resultCode 0 = captured, 9000 = authorised but not captured, anything else = failed (transId 0 for a failure)
 *   - the merchant must answer HTTP 204; our route acknowledges first and settles afterwards, so these tests wait for the
 *     asynchronous settlement (or, for refusals, for it to have had every chance to run)
 *   - /query answers {partnerCode, orderId, amount, transId, resultCode, ...}
 *
 * BACKEND INTEGRATION (real routes + real ledger on an isolated *_test DB); MoMo and the owning services are a local
 * stub - no real MoMo traffic. Run THIS FILE ALONE:
 *   DATABASE_URL="postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_payment_gw_test?schema=public" \
 *     ./node_modules/.bin/tsx --test src/__tests__/momo-callback-verification.integration.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { randomUUID } from 'crypto';

const PARTNER = 'MOMOTEST01';
const ACCESS = 'test-only-momo-access-key';
const SECRET = 'test-only-momo-secret-key';
process.env.MOMO_PARTNER_CODE = PARTNER;
process.env.MOMO_ACCESS_KEY = ACCESS;
process.env.MOMO_SECRET_KEY = SECRET;
process.env.MOMO_IPN_URL = 'https://example.invalid/ipn';
process.env.PAYMENT_PROVIDER = 'MOMO';
delete process.env.NODE_ENV;

import {
  skipOpts, load, shutdown, resetLedger, checkout, txnRow, ledgerRows, activations, discrepancy, escrowCredit, clientAvailable,
  ledgerSnapshot, assertNothingMoved, settlementRows, post, waitFor, captureAlerts, stub, NOT_ACTIVATABLE,
  type Mods, type Checkout, type Purpose,
} from './support/gateway-harness';

test.after(shutdown);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sig = (p: Record<string, unknown>, key = SECRET) =>
  crypto.createHmac('sha256', key).update([
    `accessKey=${ACCESS}`, `amount=${p.amount}`, `extraData=${p.extraData}`, `message=${p.message}`, `orderId=${p.orderId}`,
    `orderInfo=${p.orderInfo}`, `orderType=${p.orderType}`, `partnerCode=${p.partnerCode}`, `payType=${p.payType}`,
    `requestId=${p.requestId}`, `responseTime=${p.responseTime}`, `resultCode=${p.resultCode}`, `transId=${p.transId}`,
  ].join('&')).digest('hex');

interface IpnOpts {
  amount?: unknown;
  omitAmount?: boolean;
  partnerCode?: string | null;
  orderId?: string | null;
  resultCode?: number;
  transId?: number;
  key?: string;
}

function ipnBody(c: Checkout, o: IpnOpts = {}): string {
  const p: Record<string, unknown> = {
    partnerCode: o.partnerCode === null ? undefined : (o.partnerCode ?? PARTNER),
    orderId: o.orderId === null ? undefined : (o.orderId ?? c.ref),
    requestId: c.ref,
    orderInfo: 'PT_CONTRACT',
    orderType: 'momo_wallet',
    transId: o.transId ?? 2_000_000_001,
    resultCode: o.resultCode ?? 0,
    message: 'Successful.',
    payType: 'qr',
    responseTime: 1_760_000_000_000,
    extraData: '',
  };
  if (!o.omitAmount) p.amount = o.amount === undefined ? c.price : o.amount;
  p.signature = sig(p, o.key);
  return JSON.stringify(p);
}

const ipn = (m: Mods, body: string) => post(m, '/payments/webhook/momo', body);
const newCheckout = (m: Mods, o: Parameters<typeof checkout>[2] = {}) => checkout(m, 'MOMO', o);
/** An IPN was acknowledged; give the asynchronous processing every chance to have finished. */
const idle = () => sleep(300);
const paid = (m: Mods, c: Checkout) => waitFor(async () => (await txnRow(m, c)).status === 'PAID', `${c.txnId} PAID`);

// ═════════════════════════════ valid payment, duplicate, replay ═════════════════════════════

test('valid payment: IPN acknowledged 204, settled once; ledger, escrow and activation reconcile', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const c = await newCheckout(m);
  const r = await ipn(m, ipnBody(c));
  assert.equal(r.status, 204);
  await paid(m, c);
  assert.equal(await escrowCredit(m, c), BigInt(c.price));
  assert.equal(await ledgerRows(m, c), settlementRows(c.purpose));
  assert.equal(activations().length, 1);
  assert.equal(await discrepancy(m, c), undefined);
  const ev = await m.prisma.paymentWebhookEvent.findMany({ where: { provider: 'MOMO' } });
  assert.equal(ev.length, 1, 'the pre-persisted row and the processed row are the same event');
  await waitFor(async () => (await m.prisma.paymentWebhookEvent.findMany()).every((e) => e.processedAt !== null), 'event processed');
  await m.reconcile.assertInvariant('momo valid');
});

test('replay after settlement: the same IPN and a re-issued one (new transId) move nothing', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const c = await newCheckout(m);
  const body = ipnBody(c);
  assert.equal((await ipn(m, body)).status, 204);
  await paid(m, c);
  const rows = await ledgerRows(m, c);
  assert.equal((await ipn(m, body)).status, 204);
  assert.equal((await ipn(m, ipnBody(c, { transId: 2_000_000_002 }))).status, 204);
  await idle();
  assert.equal(await ledgerRows(m, c), rows);
  assert.equal(await escrowCredit(m, c), BigInt(c.price));
  assert.equal(activations().length, 1);
  await m.reconcile.assertInvariant('momo replay');
});

// ═════════════════════════════ amount ═════════════════════════════

test('wrong amount (under / over): nothing settles, recorded for the admin — LEDGER BEFORE == AFTER', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const c = await newCheckout(m, { price: 5_000_000 });
  await m.wallet.getEscrowWallet();
  const before = await ledgerSnapshot(m);

  assert.equal((await ipn(m, ipnBody(c, { amount: 1_000 }))).status, 204, 'MoMo still gets its 204');
  await waitFor(async () => (await txnRow(m, c)).status === 'FAILED', 'discrepancy recorded');
  await assertNothingMoved(m, c, 'momo underpayment');
  const after = await ledgerSnapshot(m);
  assert.equal(after, before);
  console.log(`LEDGER-EVIDENCE momo under-payment 1,000 vs 5,000,000: before=${before} after=${after}`);

  const d = await discrepancy(m, c);
  assert.equal(d.kind, 'AMOUNT_MISMATCH');
  assert.equal(d.provider, 'MOMO');
  assert.equal(d.expectedAmountVnd, '5000000');
  assert.equal(d.reportedAmountVnd, '1000');
  assert.equal(d.gatewayTransactionNo, '2000000001', 'MoMo\'s transId, for the admin to find the payment');
  assert.equal(d.source, 'IPN');

  const over = await newCheckout(m, { price: 5_000_000 });
  await ipn(m, ipnBody(over, { amount: 9_000_000 }));
  await waitFor(async () => (await txnRow(m, over)).status === 'FAILED', 'over recorded');
  await assertNothingMoved(m, over, 'momo overpayment');
});

test('wrong UNIT and malformed amounts are refused: x100, /100, off-by-one, fractional, negative, zero, text, exponent, null, absent', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const price = 5_000_000;
  const cases: Array<[string, IpnOpts]> = [
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
    assert.equal((await ipn(m, ipnBody(c, o))).status, 204, label);
    await waitFor(async () => (await txnRow(m, c)).status === 'FAILED', `${label}: recorded`);
    await assertNothingMoved(m, c, label);
  }
});

test('MoMo may send the amount as a numeric string: digits equal to the price settle exactly like the number', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const c = await newCheckout(m, { price: 750_000 });
  await ipn(m, ipnBody(c, { amount: '750000' }));
  await paid(m, c);
  assert.equal(await escrowCredit(m, c), 750_000n);
});

// ═════════════════════════════ signature, merchant, order ═════════════════════════════

test('bad signature: refused with 400 and nothing is written — tampered amount, wrong key, signature missing, junk', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const c = await newCheckout(m, { price: 5_000_000 });
  const low = JSON.parse(ipnBody(c, { amount: 1_000 }));
  const cases: Array<[string, string]> = [
    ['tampered amount', JSON.stringify({ ...low, amount: 5_000_000 })],
    ['tampered result code', JSON.stringify({ ...ipnBody, ...JSON.parse(ipnBody(c, { resultCode: 1006, amount: 5_000_000 })), resultCode: 0 })],
    ['signed with another merchant\'s secret', ipnBody(c, { key: 'someone-elses-secret' })],
    ['signature missing', JSON.stringify({ ...low, signature: undefined })],
    ['signature empty', JSON.stringify({ ...low, signature: '' })],
    ['not json', 'orderId=x&amount=5000000'],
    ['empty', ''],
    ['json null', 'null'],
  ];
  for (const [label, body] of cases) assert.equal((await ipn(m, body)).status, 400, label);
  await idle();
  assert.equal((await txnRow(m, c)).status, 'PENDING');
  await assertNothingMoved(m, c, 'momo bad signature');
  assert.equal(await discrepancy(m, c), undefined);
  assert.equal(await m.prisma.paymentWebhookEvent.count(), 0, 'not even a webhook event row');
});

test('wrong merchant: an IPN signed with our key but addressed to another partnerCode (or none) is refused', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const c = await newCheckout(m);
  assert.equal((await ipn(m, ipnBody(c, { partnerCode: 'SOMEONEELSE' }))).status, 400);
  assert.equal((await ipn(m, ipnBody(c, { partnerCode: null }))).status, 400);
  assert.equal((await ipn(m, ipnBody(c, { partnerCode: '' }))).status, 400);
  await idle();
  assert.equal((await txnRow(m, c)).status, 'PENDING');
  await assertNothingMoved(m, c, 'momo wrong partner');
  assert.equal(await m.prisma.paymentWebhookEvent.count(), 0);
});

test('unknown order, and another provider\'s reference: acknowledged but nothing created or settled', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const ghost: Checkout = { txnId: randomUUID(), ref: randomUUID(), entityId: 'x', price: 1_000_000, purpose: 'PT_CONTRACT', provider: 'MOMO', parties: { ptUserId: 'p', gymId: null, clientUserId: 'c' } };
  assert.equal((await ipn(m, ipnBody(ghost))).status, 204);
  await idle();
  assert.equal(await m.prisma.paymentTransaction.count(), 0);
  assert.equal(await m.prisma.walletLedgerEntry.count(), 0);

  const other = await checkout(m, 'VNPAY', { ref: ghost.ref });
  await ipn(m, ipnBody({ ...other, provider: 'MOMO' }));
  await idle();
  assert.equal((await txnRow(m, other)).status, 'PENDING');
  await assertNothingMoved(m, other, 'momo cross-provider');
});

// ═════════════════════════════ result codes ═════════════════════════════

test('failure and progress codes are not payments; every failed IPN is its own event; a later capture still settles', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const a = await newCheckout(m);
  const b = await newCheckout(m);
  // MoMo reports a failed attempt with transId 0 - for two DIFFERENT orders that must not be one event.
  await ipn(m, ipnBody(a, { resultCode: 1006, transId: 0 }));
  await ipn(m, ipnBody(b, { resultCode: 1006, transId: 0 }));
  await waitFor(async () => (await m.prisma.paymentWebhookEvent.count({ where: { processedAt: { not: null } } })) === 2, 'both failures processed as separate events');
  for (const c of [a, b]) {
    assert.equal((await txnRow(m, c)).status, 'PENDING');
    await assertNothingMoved(m, c, 'momo failure');
  }

  // 9000: authorised, not captured - acknowledged, nothing to book, no event row.
  const before = await m.prisma.paymentWebhookEvent.count();
  assert.equal((await ipn(m, ipnBody(a, { resultCode: 9000, transId: 2_000_000_050 }))).status, 204);
  await idle();
  assert.equal(await m.prisma.paymentWebhookEvent.count(), before);
  await assertNothingMoved(m, a, 'momo 9000');

  // The payer retries and the capture arrives: settles once.
  await ipn(m, ipnBody(a, { resultCode: 0, transId: 2_000_000_051 }));
  await paid(m, a);
  assert.equal(await escrowCredit(m, a), BigInt(a.price));
  await m.reconcile.assertInvariant('momo failure then capture');
});

// ═════════════════════════════ duplicates of a WRONG IPN ═════════════════════════════

test('the same wrong-amount IPN delivered many times: ONE record, ONE alert, nothing moves', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const c = await newCheckout(m, { price: 3_000_000 });
  const body = ipnBody(c, { amount: 100 });
  const { alerts } = await captureAlerts(async () => {
    for (let i = 0; i < 4; i++) await ipn(m, body);
    await Promise.all(Array.from({ length: 4 }, () => ipn(m, body)));
    await waitFor(async () => (await txnRow(m, c)).status === 'FAILED', 'recorded');
    await idle();
  });
  assert.equal(alerts, 1, 'exactly one alert-level log line');
  const t = await txnRow(m, c);
  assert.equal(Object.keys(t.metadata as any).filter((k) => k === 'gatewayDiscrepancy').length, 1);
  assert.equal((await m.txnRepo.findWithGatewayDiscrepancy(50)).filter((x) => x.id === c.txnId).length, 1);
  await assertNothingMoved(m, c, 'momo duplicate wrong');
});

// ═════════════════════════════ races ═════════════════════════════

test('six concurrent identical IPNs settle exactly once', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const c = await newCheckout(m, { price: 1_200_000 });
  const body = ipnBody(c, { transId: 777 });
  const rs = await Promise.all(Array.from({ length: 6 }, () => ipn(m, body)));
  for (const r of rs) assert.equal(r.status, 204);
  await paid(m, c);
  await idle();
  assert.equal(await escrowCredit(m, c), 1_200_000n);
  assert.equal(await ledgerRows(m, c), settlementRows(c.purpose));
  await m.reconcile.assertInvariant('momo concurrent identical');
});

test('concurrent IPNs with DIFFERENT amounts: the exact one settles once, the wrong ones never do', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  for (let round = 0; round < 3; round++) {
    const c = await newCheckout(m, { price: 4_000_000 });
    await Promise.all([
      ipn(m, ipnBody(c, { amount: 1_000, transId: 301 })),
      ipn(m, ipnBody(c, { transId: 302 })),
      ipn(m, ipnBody(c, { amount: 8_000_000, transId: 303 })),
    ]);
    await paid(m, c);
    await idle();
    assert.equal(await escrowCredit(m, c), 4_000_000n);
    assert.equal(await ledgerRows(m, c), settlementRows(c.purpose));
    await m.reconcile.assertInvariant(`momo mixed concurrent ${round}`);
  }
});

test('a wrong-amount IPN AFTER the right one settled leaves the PAID transaction untouched', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const c = await newCheckout(m, { price: 3_000_000 });
  await ipn(m, ipnBody(c));
  await paid(m, c);
  const rows = await ledgerRows(m, c);
  await ipn(m, ipnBody(c, { amount: 1_000, transId: 55 }));
  await waitFor(async () => Boolean(await discrepancy(m, c)), 'odd callback on record');
  const t = await txnRow(m, c);
  assert.equal(t.status, 'PAID');
  assert.equal(await ledgerRows(m, c), rows);
  assert.equal(await escrowCredit(m, c), 3_000_000n);
  await m.reconcile.assertInvariant('momo wrong after right');
});

// ═════════════════════════════ states and purposes ═════════════════════════════

test('REFUNDED is never revived; a late exact payment on a FAILED checkout settles, a wrong one does not; CANCELLED goes through the refund path', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const refunded = await newCheckout(m, { status: 'REFUNDED' });
  await ipn(m, ipnBody(refunded));
  await idle();
  assert.equal((await txnRow(m, refunded)).status, 'REFUNDED');
  await assertNothingMoved(m, refunded, 'momo refunded');

  const late = await newCheckout(m, { status: 'FAILED' });
  await ipn(m, ipnBody(late));
  await paid(m, late);
  const lateWrong = await newCheckout(m, { status: 'FAILED' });
  await ipn(m, ipnBody(lateWrong, { amount: 10 }));
  await waitFor(async () => Boolean(await discrepancy(m, lateWrong)), 'late wrong recorded');
  assert.equal((await txnRow(m, lateWrong)).status, 'FAILED');
  assert.equal(await ledgerRows(m, lateWrong), 0);

  const cancelled = await newCheckout(m, { status: 'CANCELLED', price: 2_000_000 });
  stub.activation = () => NOT_ACTIVATABLE('CANCELLED');
  await ipn(m, ipnBody(cancelled));
  await paid(m, cancelled);
  await waitFor(async () => Boolean(((await txnRow(m, cancelled)).metadata as any).unactivatedRefund), 'refund marker');
  assert.equal(await clientAvailable(m, cancelled), '2000000.00');
  await m.reconcile.assertInvariant('momo states');
});

for (const purpose of ['PT_CONTRACT', 'GYM_MEMBERSHIP', 'PERSONALIZED_SERVICE_PURCHASE'] as Purpose[]) {
  test(`${purpose}: exact amount settles with the right ledger; a wrong amount moves nothing`, skipOpts, async () => {
    const m = await load();
    await resetLedger(m);
    const ok = await newCheckout(m, { purpose, price: 900_000 });
    await ipn(m, ipnBody(ok));
    await paid(m, ok);
    assert.equal(await escrowCredit(m, ok), 900_000n);
    assert.equal(await ledgerRows(m, ok), settlementRows(purpose));
    const bad = await newCheckout(m, { purpose, price: 900_000 });
    await ipn(m, ipnBody(bad, { amount: 90 }));
    await waitFor(async () => (await txnRow(m, bad)).status === 'FAILED', 'wrong recorded');
    assert.equal(await ledgerRows(m, bad), 0);
    await m.reconcile.assertInvariant(`${purpose} momo`);
  });
}

// ═════════════════════════════ the poll (/query) ═════════════════════════════

test('poll (/query): exact amount settles; wrong / absent amount, other partner or order, pending and failed codes never settle wrongly', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const say = (c: Checkout, o: Record<string, unknown>) => {
    stub.gateway = () => ({ status: 200, body: { partnerCode: PARTNER, orderId: c.ref, requestId: `query_${c.txnId}`, resultCode: 0, amount: c.price, transId: 9001, message: 'Successful.', ...o } });
  };

  const good = await newCheckout(m);
  say(good, {});
  assert.equal(await m.webhook.pollAndSettle(await txnRow(m, good)), 'PAID');
  assert.equal(await escrowCredit(m, good), BigInt(good.price));
  assert.equal(activations().length, 1);

  const low = await newCheckout(m, { price: 5_000_000 });
  say(low, { amount: 1_000 });
  assert.equal(await m.webhook.pollAndSettle(await txnRow(m, low)), 'FAILED');
  assert.equal((await discrepancy(m, low)).source, 'POLL');
  assert.equal(await ledgerRows(m, low), 0);

  const absent = await newCheckout(m);
  say(absent, { amount: undefined });
  assert.equal(await m.webhook.pollAndSettle(await txnRow(m, absent)), 'FAILED');
  assert.equal((await discrepancy(m, absent)).kind, 'AMOUNT_MISSING');

  const otherPartner = await newCheckout(m);
  say(otherPartner, { partnerCode: 'SOMEONEELSE' });
  assert.equal(await m.webhook.pollAndSettle(await txnRow(m, otherPartner)), 'PENDING');
  assert.equal(await ledgerRows(m, otherPartner), 0);

  const otherOrder = await newCheckout(m);
  say(otherOrder, { orderId: randomUUID() });
  assert.equal(await m.webhook.pollAndSettle(await txnRow(m, otherOrder)), 'PENDING');
  assert.equal(await ledgerRows(m, otherOrder), 0);

  const badSig = await newCheckout(m);
  say(badSig, { signature: 'deadbeef' });
  assert.equal(await m.webhook.pollAndSettle(await txnRow(m, badSig)), 'PENDING', 'a signature that is present must verify');
  assert.equal(await ledgerRows(m, badSig), 0);

  for (const code of [1000, 7000, 7002, 9000]) {
    const c = await newCheckout(m);
    say(c, { resultCode: code });
    assert.equal(await m.webhook.pollAndSettle(await txnRow(m, c)), 'PENDING', `resultCode ${code}`);
  }
  const failed = await newCheckout(m);
  say(failed, { resultCode: 1005 });
  assert.equal(await m.webhook.pollAndSettle(await txnRow(m, failed)), 'FAILED');
  assert.equal(await ledgerRows(m, failed), 0);

  assert.equal(activations().length, 1, 'only the exact payment activated anything');
  await m.reconcile.assertInvariant('momo poll matrix');
});

test('provider.queryTransactionStatus never reports PAID for a different amount', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const { MoMoProvider } = await import('../providers/momo.provider');
  const p = new MoMoProvider();
  const orderId = randomUUID();
  const ask = () => p.queryTransactionStatus({ id: 'x', providerTransactionId: orderId, amount: 2_000_000, createdAt: new Date(), metadata: {} });
  const say = (o: Record<string, unknown>) => { stub.gateway = () => ({ status: 200, body: { partnerCode: PARTNER, orderId, resultCode: 0, ...o } }); };
  say({ amount: 2_000_000 });
  assert.equal(await ask(), 'PAID');
  say({ amount: 20_000 });
  assert.equal(await ask(), 'PENDING');
  say({});
  assert.equal(await ask(), 'PENDING');
});

// ═════════════════════════════ production gate ═════════════════════════════

test('production gate: acknowledged but NOT settled, event left retryable, not polled, until MOMO_PRODUCTION_VERIFIED=true', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const prev = process.env.NODE_ENV;
  const prevFlag = process.env.MOMO_PRODUCTION_VERIFIED;
  try {
    process.env.NODE_ENV = 'production';
    delete process.env.MOMO_PRODUCTION_VERIFIED;
    assert.equal(m.paymentService.providerConfigStatus('MOMO').configured, false);
    const c = await newCheckout(m);
    assert.equal((await ipn(m, ipnBody(c))).status, 204);
    await idle();
    assert.equal((await txnRow(m, c)).status, 'PENDING');
    await assertNothingMoved(m, c, 'momo production gate');
    const ev = await m.prisma.paymentWebhookEvent.findMany();
    assert.ok(ev.length === 1 && ev[0].processedAt === null, 'the event is persisted and left unprocessed');
    assert.equal(await m.webhook.pollAndSettle(await txnRow(m, c)), 'UNSUPPORTED');

    process.env.MOMO_PRODUCTION_VERIFIED = 'true';
    assert.equal(m.paymentService.providerConfigStatus('MOMO').configured, true);
    await ipn(m, ipnBody(c));
    await paid(m, c);
    assert.equal(await escrowCredit(m, c), BigInt(c.price));
  } finally {
    if (prev === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = prev;
    if (prevFlag === undefined) delete process.env.MOMO_PRODUCTION_VERIFIED; else process.env.MOMO_PRODUCTION_VERIFIED = prevFlag;
  }
});
