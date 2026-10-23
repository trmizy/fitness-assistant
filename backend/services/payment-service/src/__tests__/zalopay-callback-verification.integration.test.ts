/**
 * ZaloPay: a correctly SIGNED callback is not proof that the payer handed over the order's price.
 *
 * Before this change handleEvent only compared amounts for VNPay, so a ZaloPay callback (or a /v2/query poll) saying
 * "paid" settled the transaction at the amount WE asked for whatever ZaloPay reported, and the callback's own app_id
 * was never compared with ours.
 *
 * ZaloPay protocol facts these tests encode:
 *   - callback body {data, mac}; mac = HMAC-SHA256(key2, data); `data` is a JSON string
 *   - data.amount is plain VND (no x100 like VNPay); data.app_id is the merchant; data.app_trans_id is our reference
 *   - the merchant answers return_code 1 (ok) or 2 (already processed) to stop retries; anything else is retried
 *   - /v2/query answers {return_code 1 paid | 2 failed | 3 processing, amount, ...} and is not signed
 *
 * BACKEND INTEGRATION (real routes + real ledger on an isolated *_test DB). The ZaloPay gateway and the owning
 * services are a local stub - no real ZaloPay traffic. Run THIS FILE ALONE (it TRUNCATEs the shared ledger tables):
 *   DATABASE_URL="postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_payment_gw_test?schema=public" \
 *     ./node_modules/.bin/tsx --test src/__tests__/zalopay-callback-verification.integration.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { randomUUID } from 'crypto';

const APP_ID = '2553';
const KEY1 = 'test-only-zalopay-key1';
const KEY2 = 'test-only-zalopay-key2';
process.env.ZALOPAY_APP_ID = APP_ID;
process.env.ZALOPAY_KEY1 = KEY1;
process.env.ZALOPAY_KEY2 = KEY2;
process.env.PAYMENT_PROVIDER = 'ZALOPAY';
delete process.env.NODE_ENV;

import {
  skipOpts, load, shutdown, resetLedger, checkout, txnRow, ledgerRows, activations, discrepancy, escrowCredit, clientAvailable,
  ledgerSnapshot, assertNothingMoved, settlementRows, post, captureAlerts, stub, calls, NOT_ACTIVATABLE,
  type Mods, type Checkout, type Purpose,
} from './support/gateway-harness';

test.after(shutdown);

const hmac = (key: string, data: string) => crypto.createHmac('sha256', key).update(Buffer.from(data, 'utf-8')).digest('hex');

interface CbOpts {
  amount?: unknown; // the figure placed in data.amount verbatim; undefined key = omitted when `omitAmount`
  omitAmount?: boolean;
  appId?: unknown;
  omitAppId?: boolean;
  ref?: string;
  zpTransId?: number;
  key?: string; // signing key (default KEY2)
}

/** A ZaloPay callback body {data, mac}, signed with key2. */
function zpBody(c: Checkout, o: CbOpts = {}): string {
  const data: Record<string, unknown> = {
    app_trans_id: o.ref ?? c.ref,
    app_time: 1_760_000_000_000,
    app_user: 'gymcoach',
    embed_data: '{}',
    item: '[]',
    zp_trans_id: o.zpTransId ?? 240_000_000_001,
    server_time: 1_760_000_001_000,
    channel: 36,
    merchant_user_id: 'u1',
    user_fee_amount: 0,
    discount_amount: 0,
  };
  if (!o.omitAppId) data.app_id = o.appId ?? Number(APP_ID);
  if (!o.omitAmount) data.amount = o.amount === undefined ? c.price : o.amount;
  const json = JSON.stringify(data);
  return JSON.stringify({ data: json, mac: hmac(o.key ?? KEY2, json) });
}

const callback = (m: Mods, body: string) => post(m, '/payments/webhook/zalopay', body);

const newCheckout = (m: Mods, o: Parameters<typeof checkout>[2] = {}) =>
  checkout(m, 'ZALOPAY', { ref: `261014_${randomUUID().replace(/-/g, '').slice(0, 20)}`, ...o });

// ═════════════════════════════ valid payment, duplicate, replay ═════════════════════════════

test('valid payment: callback settles once (return_code 1); ledger, escrow and activation reconcile', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const c = await newCheckout(m);
  const r = await callback(m, zpBody(c));
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { return_code: 1, return_message: 'success' });
  const t = await txnRow(m, c);
  assert.equal(t.status, 'PAID');
  assert.equal(await escrowCredit(m, c), BigInt(c.price), 'escrow credit equals the amount ZaloPay reported');
  assert.equal(await ledgerRows(m, c), settlementRows(c.purpose));
  assert.equal(activations().length, 1);
  assert.equal(await discrepancy(m, c), undefined);
  const ev = await m.prisma.paymentWebhookEvent.findMany({ where: { provider: 'ZALOPAY' } });
  assert.equal(ev.length, 1);
  assert.ok(ev[0].processedAt, 'the event is marked processed');
  await m.reconcile.assertInvariant('zalopay valid');
});

test('replay after settlement: the same callback (and a re-issued one) answers return_code 2 and moves nothing', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const c = await newCheckout(m);
  const body = zpBody(c, { zpTransId: 1 });
  assert.equal((await callback(m, body)).json.return_code, 1);
  const rows = await ledgerRows(m, c);

  assert.equal((await callback(m, body)).json.return_code, 2, 'identical replay');
  assert.equal((await callback(m, zpBody(c, { zpTransId: 2 }))).json.return_code, 2, 'a re-issued callback (new zp_trans_id)');
  assert.equal(await ledgerRows(m, c), rows);
  assert.equal(await escrowCredit(m, c), BigInt(c.price));
  assert.equal(activations().length, 1, 'user-service asked once');
  await m.reconcile.assertInvariant('zalopay replay');
});

// ═════════════════════════════ amount: under, over, wrong unit, malformed ═════════════════════════════

test('wrong amount (under / over): -1 "invalid amount", nothing settles — LEDGER BEFORE == AFTER', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const c = await newCheckout(m, { price: 5_000_000 });
  await m.wallet.getEscrowWallet(); // the escrow wallet is created on first use; make it exist so the snapshots are comparable
  const before = await ledgerSnapshot(m);

  const r = await callback(m, zpBody(c, { amount: 1_000 }));
  assert.deepEqual(r.json, { return_code: -1, return_message: 'invalid amount' });
  const t = await txnRow(m, c);
  assert.equal(t.status, 'FAILED', 'checkout closed, not PAID');
  await assertNothingMoved(m, c, 'zalopay underpayment');
  const after = await ledgerSnapshot(m);
  assert.equal(after, before, 'the whole ledger is byte-for-byte unchanged');
  console.log(`LEDGER-EVIDENCE zalopay under-payment 1,000 vs 5,000,000: before=${before} after=${after}`);

  const d = await discrepancy(m, c);
  assert.equal(d.kind, 'AMOUNT_MISMATCH');
  assert.equal(d.provider, 'ZALOPAY');
  assert.equal(d.expectedAmountVnd, '5000000');
  assert.equal(d.reportedAmountVnd, '1000');
  assert.equal(d.source, 'IPN');
  assert.equal(d.gatewayTransactionNo, '240000000001');
  assert.equal(d.occurrences, 1);
  assert.ok((t.metadata as any).rates && (t.metadata as any).parties, 'frozen rate/party snapshot preserved');

  const over = await newCheckout(m, { price: 5_000_000 });
  assert.equal((await callback(m, zpBody(over, { amount: 9_000_000 }))).json.return_code, -1);
  assert.equal((await txnRow(m, over)).status, 'FAILED');
  await assertNothingMoved(m, over, 'zalopay overpayment');
  assert.equal((await discrepancy(m, over)).reportedAmountVnd, '9000000');

  assert.ok((await m.txnRepo.findWithGatewayDiscrepancy(50)).some((x) => x.id === c.txnId), 'listed for the admin');
});

test('wrong UNIT and malformed amounts are all refused: x100 (VNPay style), /100, off-by-one, fractional, negative, zero, text, exponent, null, absent', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const price = 5_000_000;
  const cases: Array<[string, CbOpts]> = [
    ['x100 (VNPay unit)', { amount: price * 100 }],
    ['/100', { amount: price / 100 }],
    ['one VND short', { amount: price - 1 }],
    ['one VND over', { amount: price + 1 }],
    ['fractional', { amount: price + 0.5 }],
    ['negative', { amount: -price }],
    ['zero', { amount: 0 }],
    ['text', { amount: 'abc' }],
    ['digits with decimal point', { amount: '5000000.00' }],
    ['exponent', { amount: '5e6' }],
    ['empty', { amount: '' }],
    ['null', { amount: null }],
    ['absent', { omitAmount: true }],
  ];
  for (const [label, o] of cases) {
    const c = await newCheckout(m, { price });
    const r = await callback(m, zpBody(c, o));
    assert.equal(r.json.return_code, -1, `${label}: refused`);
    assert.equal((await txnRow(m, c)).status, 'FAILED', `${label}: not paid`);
    await assertNothingMoved(m, c, label);
    const kind = (await discrepancy(m, c)).kind;
    assert.ok(kind === 'AMOUNT_MISMATCH' || kind === 'AMOUNT_MISSING', `${label}: recorded as ${kind}`);
  }
});

test('the amount is taken at face value only when it is exactly the price: a string of digits equal to the price settles, like the number', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const c = await newCheckout(m, { price: 750_000 });
  assert.equal((await callback(m, zpBody(c, { amount: '750000' }))).json.return_code, 1);
  assert.equal(await escrowCredit(m, c), 750_000n);
  await m.reconcile.assertInvariant('zalopay digit string');
});

// ═════════════════════════════ signature, merchant, order ═════════════════════════════

test('bad signature: -1 "mac not equal"; tampered data, wrong key, missing/garbage mac, malformed body — nothing is written', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const c = await newCheckout(m, { price: 5_000_000 });

  // Signed for 1,000 VND then edited to claim the full price — the classic tamper.
  const honest = JSON.parse(zpBody(c, { amount: 1_000 }));
  const tamperedData = (honest.data as string).replace('"amount":1000', '"amount":5000000');
  assert.notEqual(tamperedData, honest.data);
  const cases: Array<[string, string]> = [
    ['tampered amount', JSON.stringify({ data: tamperedData, mac: honest.mac })],
    ['signed with key1 instead of key2', zpBody(c, { key: KEY1 })],
    ['signed with someone else\'s key', zpBody(c, { key: 'someone-elses-key' })],
    ['mac missing', JSON.stringify({ data: honest.data })],
    ['data missing', JSON.stringify({ mac: honest.mac })],
    ['mac not a string', JSON.stringify({ data: honest.data, mac: 12345 })],
    ['data not a string (object)', JSON.stringify({ data: JSON.parse(honest.data), mac: honest.mac })],
    ['not json', 'app_trans_id=x&amount=5000000'],
    ['empty', ''],
  ];
  for (const [label, body] of cases) {
    const r = await callback(m, body);
    assert.deepEqual(r.json, { return_code: -1, return_message: 'mac not equal' }, label);
  }
  assert.equal((await txnRow(m, c)).status, 'PENDING', 'untouched');
  await assertNothingMoved(m, c, 'zalopay bad signature');
  assert.equal(await discrepancy(m, c), undefined, 'an unauthenticated callback must not be able to write to the transaction');
  assert.equal(await m.prisma.paymentWebhookEvent.count(), 0, 'and must not even leave a webhook event row');
});

test('wrong merchant: a callback signed with our key but carrying another app_id (or none) is refused', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const c = await newCheckout(m);
  assert.deepEqual((await callback(m, zpBody(c, { appId: 9999 }))).json, { return_code: -1, return_message: 'app_id not equal' });
  assert.equal((await callback(m, zpBody(c, { omitAppId: true }))).json.return_code, -1);
  assert.equal((await callback(m, zpBody(c, { appId: '' }))).json.return_code, -1);
  assert.equal((await txnRow(m, c)).status, 'PENDING');
  await assertNothingMoved(m, c, 'zalopay wrong merchant');
  assert.equal(await discrepancy(m, c), undefined);
});

test('unknown order, and a reference that belongs to another provider: -1 "order not found", nothing created or moved', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const ghost: Checkout = { txnId: randomUUID(), ref: `261014_${randomUUID().replace(/-/g, '').slice(0, 20)}`, entityId: 'x', price: 1_000_000, purpose: 'PT_CONTRACT', provider: 'ZALOPAY', parties: { ptUserId: 'p', gymId: null, clientUserId: 'c' } };
  assert.deepEqual((await callback(m, zpBody(ghost))).json, { return_code: -1, return_message: 'order not found' });
  assert.equal(await m.prisma.paymentTransaction.count(), 0);
  assert.equal(await m.prisma.walletLedgerEntry.count(), 0);

  // The same reference exists, but as a VNPAY transaction: a ZaloPay callback must not be able to settle it.
  const other = await checkout(m, 'VNPAY', { ref: ghost.ref });
  assert.equal((await callback(m, zpBody({ ...other, provider: 'ZALOPAY' }))).json.return_code, -1);
  assert.equal((await txnRow(m, other)).status, 'PENDING');
  await assertNothingMoved(m, other, 'zalopay cross-provider');

  // A reference without app_trans_id at all.
  const noRef = JSON.parse(zpBody(ghost));
  const inner = JSON.parse(noRef.data);
  delete inner.app_trans_id;
  const innerJson = JSON.stringify(inner);
  assert.equal((await callback(m, JSON.stringify({ data: innerJson, mac: hmac(KEY2, innerJson) }))).json.return_code, -1);
  assert.equal(activations().length, 0);
});

// ═════════════════════════════ duplicates of a WRONG callback: one record, one alert ═════════════════════════════

test('the same wrong-amount callback delivered many times (sequential + concurrent): ONE discrepancy record, ONE alert, still refused, nothing moves', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const c = await newCheckout(m, { price: 3_000_000 });
  const body = zpBody(c, { amount: 100 });

  const { alerts, warns } = await captureAlerts(async () => {
    for (let i = 0; i < 4; i++) assert.deepEqual((await callback(m, body)).json, { return_code: -1, return_message: 'invalid amount' }, 'a retry is still told the amount is wrong');
    const rs = await Promise.all(Array.from({ length: 4 }, () => callback(m, body)));
    for (const r of rs) assert.equal(r.json.return_code, -1);
  });
  assert.equal(alerts, 1, 'exactly one alert-level log line for the whole burst');
  assert.ok(warns <= 3, 'at most the racing concurrent deliveries leave a warn-level repeat');

  const t = await txnRow(m, c);
  assert.equal(t.status, 'FAILED');
  const meta = t.metadata as any;
  assert.equal(Object.keys(meta).filter((k) => k === 'gatewayDiscrepancy').length, 1, 'one record');
  assert.equal(meta.gatewayDiscrepancy.kind, 'AMOUNT_MISMATCH');
  assert.ok(meta.gatewayDiscrepancy.occurrences >= 1 && meta.gatewayDiscrepancy.occurrences <= 4, 'sequential retries are the same event and never reach the record again');
  assert.equal((await m.txnRepo.findWithGatewayDiscrepancy(50)).filter((x) => x.id === c.txnId).length, 1, 'listed once');

  // A DIFFERENT wrong delivery for the same order (new zp_trans_id) is a new event: the same record is bumped, no new alert.
  const again = await captureAlerts(() => callback(m, zpBody(c, { amount: 200, zpTransId: 999 })));
  assert.equal(again.result.json.return_code, -1);
  assert.equal(again.alerts, 0, 'no second alert');
  assert.equal(((await txnRow(m, c)).metadata as any).gatewayDiscrepancy.occurrences >= 2, true);
  await assertNothingMoved(m, c, 'zalopay duplicate wrong callbacks');
});

// ═════════════════════════════ races ═════════════════════════════

test('six concurrent identical callbacks settle exactly once; later re-issues answer 2', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const c = await newCheckout(m, { price: 1_200_000 });
  const body = zpBody(c, { zpTransId: 77 });
  const rs = await Promise.all(Array.from({ length: 6 }, () => callback(m, body)));
  for (const r of rs) assert.ok([1, 2].includes(r.json.return_code), `acknowledged, got ${JSON.stringify(r.json)}`);
  assert.ok(rs.some((r) => r.json.return_code === 1));
  assert.equal((await txnRow(m, c)).status, 'PAID');
  assert.equal(await escrowCredit(m, c), 1_200_000n, 'escrow credited exactly once');
  assert.equal(await ledgerRows(m, c), settlementRows(c.purpose), 'one settlement\'s worth of ledger entries');
  await m.reconcile.assertInvariant('zalopay concurrent identical');

  const more = await Promise.all([callback(m, zpBody(c, { zpTransId: 78 })), callback(m, body), callback(m, zpBody(c, { zpTransId: 79 }))]);
  for (const r of more) assert.equal(r.json.return_code, 2);
  assert.equal(await ledgerRows(m, c), settlementRows(c.purpose));
  await m.reconcile.assertInvariant('zalopay concurrent, later deliveries');
});

test('concurrent callbacks with DIFFERENT amounts: the exact one settles once, the wrong one never does', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  for (let round = 0; round < 3; round++) {
    const c = await newCheckout(m, { price: 4_000_000 });
    const rs = await Promise.all([
      callback(m, zpBody(c, { amount: 1_000, zpTransId: 201 })),
      callback(m, zpBody(c, { zpTransId: 202 })),
      callback(m, zpBody(c, { amount: 8_000_000, zpTransId: 203 })),
    ]);
    assert.equal(rs.filter((r) => r.json.return_code === 1).length, 1, 'exactly one acknowledged as settled');
    const t = await txnRow(m, c);
    assert.equal(t.status, 'PAID', 'the right payment is never lost to a wrong one racing it');
    assert.equal(await escrowCredit(m, c), 4_000_000n, 'credited the price once - never a wrong figure');
    assert.equal(await ledgerRows(m, c), settlementRows(c.purpose));
    await m.reconcile.assertInvariant(`zalopay mixed concurrent round ${round}`);
  }
});

test('a wrong-amount callback AFTER the right one settled: refused, but the PAID transaction and its ledger are untouched', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const c = await newCheckout(m, { price: 3_000_000 });
  assert.equal((await callback(m, zpBody(c))).json.return_code, 1);
  const rows = await ledgerRows(m, c);
  assert.equal((await callback(m, zpBody(c, { amount: 1_000, zpTransId: 5 }))).json.return_code, -1);
  const t = await txnRow(m, c);
  assert.equal(t.status, 'PAID', 'a settled payment is never downgraded');
  assert.equal(await ledgerRows(m, c), rows);
  assert.equal(await escrowCredit(m, c), 3_000_000n);
  assert.equal((t.metadata as any).gatewayDiscrepancy.kind, 'AMOUNT_MISMATCH', 'the odd callback is on record');
  await m.reconcile.assertInvariant('zalopay wrong after right');
});

// ═════════════════════════════ transaction states ═════════════════════════════

test('REFUNDED is never revived; a late exact payment on a FAILED checkout still settles, a late wrong one does not; CANCELLED goes through the refund path', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);

  const refunded = await newCheckout(m, { status: 'REFUNDED' });
  assert.equal((await callback(m, zpBody(refunded))).json.return_code, 2);
  assert.equal((await txnRow(m, refunded)).status, 'REFUNDED');
  await assertNothingMoved(m, refunded, 'zalopay refunded');

  const late = await newCheckout(m, { status: 'FAILED' });
  assert.equal((await callback(m, zpBody(late))).json.return_code, 1);
  assert.equal((await txnRow(m, late)).status, 'PAID');
  assert.equal(await escrowCredit(m, late), BigInt(late.price));

  const lateWrong = await newCheckout(m, { status: 'FAILED' });
  assert.equal((await callback(m, zpBody(lateWrong, { amount: 10 }))).json.return_code, -1);
  assert.equal((await txnRow(m, lateWrong)).status, 'FAILED');
  assert.equal(await ledgerRows(m, lateWrong), 0);

  const cancelled = await newCheckout(m, { status: 'CANCELLED', price: 2_000_000 });
  stub.activation = () => NOT_ACTIVATABLE('CANCELLED');
  assert.equal((await callback(m, zpBody(cancelled))).json.return_code, 1);
  const t = await txnRow(m, cancelled);
  assert.equal(t.status, 'PAID', 'ZaloPay captured the money: booked, not lost');
  assert.ok((t.metadata as any).unactivatedRefund, 'refund marker present');
  assert.equal(await clientAvailable(m, cancelled), '2000000.00', 'the client got the whole payment back');
  await m.reconcile.assertInvariant('zalopay states');
});

// ═════════════════════════════ every purpose ═════════════════════════════

for (const purpose of ['PT_CONTRACT', 'GYM_MEMBERSHIP', 'PERSONALIZED_SERVICE_PURCHASE'] as Purpose[]) {
  test(`${purpose}: exact amount settles with the right ledger; a wrong amount moves nothing`, skipOpts, async () => {
    const m = await load();
    await resetLedger(m);
    const ok = await newCheckout(m, { purpose, price: 900_000 });
    assert.equal((await callback(m, zpBody(ok))).json.return_code, 1);
    assert.equal(await escrowCredit(m, ok), 900_000n);
    assert.equal(await ledgerRows(m, ok), settlementRows(purpose));
    await m.reconcile.assertInvariant(`${purpose} exact`);

    const bad = await newCheckout(m, { purpose, price: 900_000 });
    assert.equal((await callback(m, zpBody(bad, { amount: 90 }))).json.return_code, -1);
    assert.equal(await ledgerRows(m, bad), 0);
    assert.equal(await escrowCredit(m, bad), 0n);
    await m.reconcile.assertInvariant(`${purpose} wrong`);
  });
}

// ═════════════════════════════ the poll (/v2/query) — also reached by POST /me/payments/:id/sync ═════════════════════════════

test('poll (/v2/query): exact amount settles; wrong / absent amount never does; failed and processing are not settlement', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const answer = (o: Record<string, unknown>) => { stub.gateway = () => ({ status: 200, body: o }); };

  const good = await newCheckout(m);
  answer({ return_code: 1, return_message: 'ok', is_processing: false, amount: good.price, zp_trans_id: 11 });
  assert.equal(await m.webhook.pollAndSettle(await txnRow(m, good)), 'PAID');
  assert.equal((await txnRow(m, good)).status, 'PAID');
  assert.equal(await escrowCredit(m, good), BigInt(good.price));
  assert.equal(activations().length, 1);
  await m.reconcile.assertInvariant('zalopay poll exact');

  const low = await newCheckout(m, { price: 5_000_000 });
  answer({ return_code: 1, amount: 1_000 });
  assert.equal(await m.webhook.pollAndSettle(await txnRow(m, low)), 'FAILED', 'reported as not settled');
  assert.equal((await txnRow(m, low)).status, 'FAILED');
  assert.equal((await discrepancy(m, low)).source, 'POLL');
  assert.equal(await ledgerRows(m, low), 0);

  const unit = await newCheckout(m, { price: 5_000_000 });
  answer({ return_code: 1, amount: 500_000_000 });
  assert.equal(await m.webhook.pollAndSettle(await txnRow(m, unit)), 'FAILED');
  assert.equal(await ledgerRows(m, unit), 0);

  const absent = await newCheckout(m);
  answer({ return_code: 1 });
  assert.equal(await m.webhook.pollAndSettle(await txnRow(m, absent)), 'FAILED');
  assert.equal((await discrepancy(m, absent)).kind, 'AMOUNT_MISSING');
  assert.equal(await ledgerRows(m, absent), 0);

  const processing = await newCheckout(m);
  answer({ return_code: 3, is_processing: true });
  assert.equal(await m.webhook.pollAndSettle(await txnRow(m, processing)), 'PENDING');
  assert.equal((await txnRow(m, processing)).status, 'PENDING');

  const failed = await newCheckout(m);
  answer({ return_code: 2 });
  assert.equal(await m.webhook.pollAndSettle(await txnRow(m, failed)), 'FAILED');
  assert.equal(await ledgerRows(m, failed), 0);

  assert.equal(activations().length, 1, 'only the exact payment activated anything');
  await m.reconcile.assertInvariant('zalopay poll matrix');
});

test('poll and callback racing for the same payment settle once', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const c = await newCheckout(m, { price: 1_500_000 });
  stub.gateway = () => ({ status: 200, body: { return_code: 1, amount: c.price, zp_trans_id: 31 } });
  const t0 = await txnRow(m, c);
  const rs = await Promise.all([callback(m, zpBody(c)), m.webhook.pollAndSettle(t0), callback(m, zpBody(c, { zpTransId: 32 })), m.webhook.pollAndSettle(t0)]);
  assert.ok(rs.length === 4);
  assert.equal((await txnRow(m, c)).status, 'PAID');
  assert.equal(await escrowCredit(m, c), 1_500_000n);
  assert.equal(await ledgerRows(m, c), settlementRows(c.purpose));
  await m.reconcile.assertInvariant('zalopay poll vs callback');
});

test('provider.queryTransactionStatus never reports PAID for a different amount', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const { ZaloPayProvider } = await import('../providers/zalopay.provider');
  const p = new ZaloPayProvider();
  const ask = () => p.queryTransactionStatus({ id: 'x', providerTransactionId: '261014_abc', amount: 2_000_000, createdAt: new Date(), metadata: {} });
  stub.gateway = () => ({ status: 200, body: { return_code: 1, amount: 2_000_000 } });
  assert.equal(await ask(), 'PAID');
  stub.gateway = () => ({ status: 200, body: { return_code: 1, amount: 20_000 } });
  assert.equal(await ask(), 'PENDING');
  stub.gateway = () => ({ status: 200, body: { return_code: 1 } });
  assert.equal(await ask(), 'PENDING');
  assert.ok(calls.some((x) => x.path.includes('/zp/v2/query')));
});

// ═════════════════════════════ production gate ═════════════════════════════

test('production gate: with NODE_ENV=production and no ZALOPAY_PRODUCTION_VERIFIED, no checkout starts, no callback settles and nothing is polled; verified -> works', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const prev = process.env.NODE_ENV;
  const prevFlag = process.env.ZALOPAY_PRODUCTION_VERIFIED;
  try {
    process.env.NODE_ENV = 'production';
    delete process.env.ZALOPAY_PRODUCTION_VERIFIED;

    const status = m.paymentService.providerConfigStatus('ZALOPAY');
    assert.equal(status.configured, false);
    assert.match(status.missing.join(' '), /ZALOPAY_PRODUCTION_VERIFIED/);
    assert.equal(m.paymentService.providerConfigStatus('MOMO').configured, false, 'MoMo and PayOS are gated too');
    assert.equal(m.paymentService.providerConfigStatus('PAYOS').configured, false);

    const c = await newCheckout(m);
    const r = await callback(m, zpBody(c));
    assert.deepEqual(r.json, { return_code: -1, return_message: 'gateway not enabled' }, 'not acknowledged: ZaloPay retries later');
    assert.equal((await txnRow(m, c)).status, 'PENDING', 'left alone');
    await assertNothingMoved(m, c, 'zalopay production gate callback');
    const ev = await m.prisma.paymentWebhookEvent.findMany();
    assert.ok(ev.every((e) => e.processedAt === null), 'the event is not marked processed, so a retry after enabling still settles');

    stub.gateway = () => ({ status: 200, body: { return_code: 1, amount: c.price } });
    assert.equal(await m.webhook.pollAndSettle(await txnRow(m, c)), 'UNSUPPORTED', 'the gateway is not even asked');
    assert.equal(calls.filter((x) => x.path.includes('/zp/')).length, 0);

    // The operator has verified ZaloPay against the production system and says so.
    process.env.ZALOPAY_PRODUCTION_VERIFIED = 'true';
    assert.equal(m.paymentService.providerConfigStatus('ZALOPAY').configured, true);
    assert.equal((await callback(m, zpBody(c))).json.return_code, 1, 'the same callback, retried, now settles');
    assert.equal(await escrowCredit(m, c), BigInt(c.price));
    await m.reconcile.assertInvariant('zalopay production gate lifted');
  } finally {
    if (prev === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = prev;
    if (prevFlag === undefined) delete process.env.ZALOPAY_PRODUCTION_VERIFIED; else process.env.ZALOPAY_PRODUCTION_VERIFIED = prevFlag;
  }
});

// ═════════════════════════════ other doors on the same router ═════════════════════════════

test('the generic POST door serves only ZaloPay / PayOS / MoMo: VNPAY (its IPN is a GET), MOCK and anything else are 404 and settle nothing', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const c = await checkout(m, 'VNPAY', {});
  for (const name of ['vnpay', 'VNPAY', 'mock', 'stripe', 'manual_bank_transfer', 'whatever']) {
    const r = await post(m, `/payments/webhook/${name}`, `vnp_TxnRef=${c.ref}&vnp_Amount=500000000&vnp_ResponseCode=00&vnp_TransactionStatus=00`, 'text/plain');
    assert.equal(r.status, 404, name);
  }
  assert.equal((await txnRow(m, c)).status, 'PENDING');
  await assertNothingMoved(m, c, 'generic POST door');
});
