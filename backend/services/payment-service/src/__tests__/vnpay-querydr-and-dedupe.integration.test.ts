/**
 * VNPay follow-ups to the amount verification (D50 V1):
 *   1. the querydr RESPONSE must be signature-verified before anything in it can settle (or fail) a transaction;
 *   2. duplicate deliveries of a wrong-amount callback leave ONE discrepancy record and raise ONE alert, and VNPay keeps
 *      hearing RspCode 04 (never 02 just to stop the retries);
 *   3. VNPay is the one gateway allowed in production without an extra switch;
 *   4. the retired WALLET_TOPUP credit (no escrow leg) cannot be reached by a late callback in production.
 *
 * BACKEND INTEGRATION (real routes + real ledger on an isolated *_test DB); VNPay and the owning services are a local
 * stub - no real VNPay traffic. Run THIS FILE ALONE:
 *   DATABASE_URL="postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_payment_gw_test?schema=public" \
 *     ./node_modules/.bin/tsx --test src/__tests__/vnpay-querydr-and-dedupe.integration.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';

const TMN = 'QDRTEST1';
const SECRET = 'test-only-vnpay-querydr-secret';
process.env.VNPAY_HASH_SECRET = SECRET;
process.env.VNPAY_TMN_CODE = TMN;
process.env.PAYMENT_PROVIDER = 'VNPAY';
delete process.env.NODE_ENV;

import {
  skipOpts, canUseIntegrationDb, load, shutdown, resetLedger, checkout, txnRow, ledgerRows, activations, discrepancy, escrowCredit, clientAvailable,
  assertNothingMoved, captureAlerts, stub,
  type Mods, type Checkout,
} from './support/gateway-harness';

// The last test knowingly re-enables the retired WALLET_TOPUP credit (a client balance with NO escrow leg), which leaves the shared
// ledger violating the global money invariant (claims > escrow by that 400,000). Leave the isolated DB the way a fresh one is, so the
// next file that asserts the invariant (withdrawal-locking, withdrawal) does not inherit a deliberate legacy-credit drift.
test.after(async () => {
  if (canUseIntegrationDb) await resetLedger(await load());
  await shutdown();
});

const ORDER = ['vnp_ResponseId', 'vnp_Command', 'vnp_ResponseCode', 'vnp_Message', 'vnp_TmnCode', 'vnp_TxnRef', 'vnp_Amount', 'vnp_BankCode', 'vnp_PayDate', 'vnp_TransactionNo', 'vnp_TransactionType', 'vnp_TransactionStatus', 'vnp_OrderInfo', 'vnp_PromotionCode', 'vnp_PromotionAmount'];
/** Signs a querydr answer the way VNPay's guide says (written independently of the provider). */
function signed(fields: Record<string, string>, key = SECRET): Record<string, string> {
  const hash = crypto.createHmac('sha512', key).update(Buffer.from(ORDER.map((k) => fields[k] ?? '').join('|'), 'utf-8')).digest('hex');
  return { ...fields, vnp_SecureHash: hash };
}
const answerFields = (c: Checkout, o: { amountVnd?: number; status?: string } = {}): Record<string, string> => ({
  vnp_ResponseId: 'r1', vnp_Command: 'querydr', vnp_ResponseCode: '00', vnp_Message: 'QueryDR Success', vnp_TmnCode: TMN, vnp_TxnRef: c.ref,
  vnp_Amount: String(BigInt(o.amountVnd ?? c.price) * 100n), vnp_BankCode: 'NCB', vnp_PayDate: '20261014120000', vnp_TransactionNo: '14000001',
  vnp_TransactionType: '01', vnp_TransactionStatus: o.status ?? '00', vnp_OrderInfo: 'x',
});
const say = (body: Record<string, string>) => { stub.gateway = () => ({ status: 200, body }); };
const newCheckout = (m: Mods, o: Parameters<typeof checkout>[2] = {}) => checkout(m, 'VNPAY', { metadata: { vnp_TxnRef: undefined }, ...o });

async function vnpQuery(c: Checkout, o: { amountVnd?: number } = {}) {
  const { buildSignedQuery } = await import('../providers/vnpay.provider');
  const params: Record<string, string> = {
    vnp_Amount: String(BigInt(o.amountVnd ?? c.price) * 100n), vnp_BankCode: 'NCB', vnp_PayDate: '20261014120000',
    vnp_ResponseCode: '00', vnp_TransactionNo: '14000002', vnp_TransactionStatus: '00', vnp_TmnCode: TMN, vnp_TxnRef: c.ref,
  };
  const { query, signature } = buildSignedQuery(params);
  return `${query}&vnp_SecureHash=${signature}`;
}
const ipn = async (m: Mods, q: string) => (await (await fetch(`${m.base}/payments/webhook/vnpay?${q}`)).json()) as { RspCode: string };

// ═════════════════════════════ querydr response signature ═════════════════════════════

test('querydr: only a SIGNED answer can settle; unsigned, wrong-key, tampered amount and tampered status are ignored', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const poll = async (c: Checkout) => m.webhook.pollAndSettle(await txnRow(m, c));

  const good = await newCheckout(m);
  say(signed(answerFields(good)));
  assert.equal(await poll(good), 'PAID');
  assert.equal(await escrowCredit(m, good), BigInt(good.price));

  const unsigned = await newCheckout(m);
  say(answerFields(unsigned));
  assert.equal(await poll(unsigned), 'PENDING', 'a "paid" answer with no vnp_SecureHash is not a confirmation');

  const wrongKey = await newCheckout(m);
  say(signed(answerFields(wrongKey), 'someone-elses-secret'));
  assert.equal(await poll(wrongKey), 'PENDING');

  // Signed for 1,000 VND, then altered in transit to claim the full price.
  const amountTampered = await newCheckout(m, { price: 5_000_000 });
  say({ ...signed(answerFields(amountTampered, { amountVnd: 1_000 })), vnp_Amount: '500000000' });
  assert.equal(await poll(amountTampered), 'PENDING');

  // Signed as "not completed" (01), altered to "completed" (00).
  const statusTampered = await newCheckout(m);
  say({ ...signed(answerFields(statusTampered, { status: '01' })), vnp_TransactionStatus: '00' });
  assert.equal(await poll(statusTampered), 'PENDING');

  // A forged "failed" cannot close a checkout either.
  const failedForged = await newCheckout(m);
  say(answerFields(failedForged, { status: '02' }));
  assert.equal(await poll(failedForged), 'PENDING');
  assert.equal((await txnRow(m, failedForged)).status, 'PENDING');

  // Signed but for a different reference/merchant: still not this transaction's confirmation.
  const otherRef = await newCheckout(m);
  say(signed({ ...answerFields(otherRef), vnp_TxnRef: 'some-other-ref' }));
  assert.equal(await poll(otherRef), 'PENDING');
  const otherTmn = await newCheckout(m);
  say(signed({ ...answerFields(otherTmn), vnp_TmnCode: 'OTHERMERCH' }));
  assert.equal(await poll(otherTmn), 'PENDING');

  for (const c of [unsigned, wrongKey, amountTampered, statusTampered, otherRef, otherTmn]) {
    assert.equal(await ledgerRows(m, c), 0);
    assert.equal(await discrepancy(m, c), undefined, 'an unauthenticated answer writes nothing to the transaction');
  }
  assert.equal(activations().length, 1, 'only the signed, exact payment activated anything');
  await m.reconcile.assertInvariant('querydr signature');
});

test('querydr: a SIGNED answer with the wrong amount is still recorded as a discrepancy (source POLL) and never settles', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const c = await newCheckout(m, { price: 5_000_000 });
  say(signed(answerFields(c, { amountVnd: 1_000 })));
  assert.equal(await m.webhook.pollAndSettle(await txnRow(m, c)), 'FAILED');
  assert.equal((await discrepancy(m, c)).source, 'POLL');
  await assertNothingMoved(m, c, 'querydr signed wrong amount');
});

// ═════════════════════════════ duplicates of a wrong callback ═════════════════════════════

test('VNPay: the same wrong-amount IPN delivered many times: RspCode 04 every time, ONE record, ONE alert', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const c = await newCheckout(m, { price: 3_000_000 });
  const q = await vnpQuery(c, { amountVnd: 1_000 });
  const { alerts } = await captureAlerts(async () => {
    for (let i = 0; i < 4; i++) assert.equal((await ipn(m, q)).RspCode, '04');
    const rs = await Promise.all(Array.from({ length: 4 }, () => ipn(m, q)));
    for (const r of rs) assert.equal(r.RspCode, '04', 'never 02 just to make VNPay stop retrying');
    assert.equal((await (await fetch(`${m.base}/payments/vnpay/return?${q}`, { redirect: 'manual' })).headers.get('location'))?.includes('status=failed'), true);
  });
  assert.equal(alerts, 1, 'exactly one alert-level log line for IPN x8 + a browser return');
  const t = await txnRow(m, c);
  assert.equal(Object.keys(t.metadata as any).filter((k) => k === 'gatewayDiscrepancy').length, 1);
  assert.equal((t.metadata as any).gatewayDiscrepancy.occurrences, 9, 'the single record counts the deliveries');
  assert.equal((await m.txnRepo.findWithGatewayDiscrepancy(50)).filter((x) => x.id === c.txnId).length, 1, 'listed once for the admin');
  assert.equal(t.status, 'FAILED', 'clearly flagged, not PAID');
  await assertNothingMoved(m, c, 'vnpay duplicate wrong');
});

// ═════════════════════════════ production ═════════════════════════════

test('production: VNPay still settles (no extra switch); the retired WALLET_TOPUP credit is refused and recorded, unless knowingly re-enabled', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const prev = process.env.NODE_ENV;
  const prevFlag = process.env.LEGACY_WALLET_TOPUP_SETTLEMENT;
  try {
    process.env.NODE_ENV = 'production';
    delete process.env.LEGACY_WALLET_TOPUP_SETTLEMENT;
    assert.equal(m.paymentService.providerConfigStatus('VNPAY').configured, true);

    const ok = await newCheckout(m);
    assert.equal((await ipn(m, await vnpQuery(ok))).RspCode, '00');
    assert.equal(await escrowCredit(m, ok), BigInt(ok.price));

    const topup = await checkout(m, 'VNPAY', { purpose: 'WALLET_TOPUP', price: 1_000_000 });
    assert.equal((await ipn(m, await vnpQuery(topup))).RspCode, '02', 'handled: nothing for VNPay to retry');
    assert.equal(await clientAvailable(m, topup), '0.00', 'no wallet balance is minted');
    assert.equal(await ledgerRows(m, topup), 0);
    assert.equal((await discrepancy(m, topup)).kind, 'PURPOSE_NOT_SETTLEABLE');
    await m.reconcile.assertInvariant('production retired top-up');

    // Knowing opt-in restores the old behaviour for an operator who really has such a row to honour.
    process.env.LEGACY_WALLET_TOPUP_SETTLEMENT = 'true';
    const topup2 = await checkout(m, 'VNPAY', { purpose: 'WALLET_TOPUP', price: 400_000 });
    assert.equal((await ipn(m, await vnpQuery(topup2))).RspCode, '00');
    assert.equal(await clientAvailable(m, topup2), '400000.00');
  } finally {
    if (prev === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = prev;
    if (prevFlag === undefined) delete process.env.LEGACY_WALLET_TOPUP_SETTLEMENT; else process.env.LEGACY_WALLET_TOPUP_SETTLEMENT = prevFlag;
  }
});
