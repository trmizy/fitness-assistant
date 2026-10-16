/**
 * A correctly SIGNED VNPay callback is not proof that the payer handed over the order's price.
 *
 * The defect this pins (found by the real two-service test H1 in user-service's
 * cross-service-money.e2e.test.ts): a 5,000,000 VND PT_CONTRACT checkout, then a perfectly signed
 * IPN with vnp_Amount=100000 (1,000 VND) and vnp_ResponseCode=00. payment-service answered
 * RspCode 00, credited the FULL 5,000,000 into escrow from `txn.amount` (the amount WE asked for —
 * the gateway-reported amount was never read), marked the transaction PAID and activated the
 * contract. One signed 1,000 VND payment bought a 5,000,000 VND contract.
 *
 * Here the real Express routes (GET /payments/webhook/vnpay and GET /payments/vnpay/return) are
 * served over real HTTP, signed with the SAME helper the provider signs with (buildSignedQuery),
 * against the isolated test database. The user-service activation call and VNPay's querydr API are
 * a local HTTP server, so settlement -> activation -> refund runs for real end to end.
 *
 * For every scenario the gateway-reported amount is reconciled with the ledger: the escrow credit
 * booked for the transaction equals the amount the gateway reported when (and only when) it was an
 * exact match, and is zero when the callback was refused; and the system invariant
 * (escrow == sum of claims) holds.
 *
 * BACKEND INTEGRATION. Run THIS FILE ALONE (it TRUNCATEs the shared ledger tables):
 *   DATABASE_URL="postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_payment_test?schema=public" \
 *     ./node_modules/.bin/tsx --test src/__tests__/vnpay-amount-verification.integration.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'crypto';
import type { AddressInfo } from 'node:net';
import { isTestDatabaseUrl } from './support/test-db-guard'; // D57-6-5 / D64: the database NAME must end with _test (the old /_test/i on the whole URL also matched the user name gymcoach_test)

// The provider reads these at import time, so they are set before anything imports it.
const TMN = 'AMTTEST1';
process.env.VNPAY_HASH_SECRET = 'test-only-vnpay-amount-secret';
process.env.VNPAY_TMN_CODE = TMN;
process.env.PAYMENT_PROVIDER = 'VNPAY';
delete process.env.VNPAY_SIMULATE;

const databaseUrl = process.env.DATABASE_URL || '';
const canUseIntegrationDb = isTestDatabaseUrl(databaseUrl);
const skipOpts = {
  skip: canUseIntegrationDb ? false : 'Requires DATABASE_URL pointing at a *_test database.',
};

// ── user-service / gym-service / ai-service activation + VNPay querydr, as one HTTP server ──────
type Answer = { status: number; body: unknown };
const calls: Array<{ path: string; body: any }> = [];
let activationResponder: (path: string) => Answer = () => ({ status: 200, body: { success: true } });
let querydrResponder: (body: any) => Answer = () => ({ status: 200, body: { vnp_ResponseCode: '91' } });

const NOT_ACTIVATABLE = (currentStatus: string): Answer => ({
  status: 409,
  body: {
    success: false,
    error: { code: 'CONTRACT_NOT_ACTIVATABLE', message: `Contract cannot be activated (status ${currentStatus})`, currentStatus },
  },
});

const gatewayServer = http.createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
    calls.push({ path: req.url ?? '', body });
    const answer = (req.url ?? '').startsWith('/querydr') ? querydrResponder(body) : activationResponder(req.url ?? '');
    res.writeHead(answer.status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(answer.body));
  });
});

type Mods = {
  prisma: (typeof import('../repositories/prisma'))['prisma'];
  vnpay: typeof import('../providers/vnpay.provider');
  webhook: typeof import('../services/webhook.service');
  reconcile: typeof import('../services/reconcile.service');
  wallet: (typeof import('../services/wallet.service'))['walletService'];
  txnRepo: (typeof import('../repositories/transaction.repository'))['transactionRepository'];
  base: string;
};
let mods: Mods | undefined;
let appServer: http.Server | undefined;
async function load(): Promise<Mods> {
  if (mods) return mods;
  await new Promise<void>((resolve) => gatewayServer.listen(0, '127.0.0.1', resolve));
  const gwBase = `http://127.0.0.1:${(gatewayServer.address() as AddressInfo).port}`;
  process.env.USER_SERVICE_URL = gwBase;
  process.env.GYM_SERVICE_URL = gwBase;
  process.env.AI_SERVICE_URL = gwBase;
  process.env.VNPAY_API_URL = `${gwBase}/querydr`;
  delete process.env.USER_LAMBDA_NAME;
  delete process.env.GYM_LAMBDA_NAME;
  delete process.env.AI_LAMBDA_NAME;

  const express = (await import('express')).default;
  const webhookRoutes = (await import('../routes/webhook.routes')).default;
  const returnRoutes = (await import('../routes/vnpay-return.routes')).default;
  const app = express();
  app.use('/payments/webhook', express.raw({ type: '*/*' }), webhookRoutes);
  app.use('/payments', returnRoutes);
  appServer = await new Promise<http.Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });

  mods = {
    prisma: (await import('../repositories/prisma')).prisma,
    vnpay: await import('../providers/vnpay.provider'),
    webhook: await import('../services/webhook.service'),
    reconcile: await import('../services/reconcile.service'),
    wallet: (await import('../services/wallet.service')).walletService,
    txnRepo: (await import('../repositories/transaction.repository')).transactionRepository,
    base: `http://127.0.0.1:${(appServer.address() as AddressInfo).port}`,
  };
  return mods;
}

test.after(async () => {
  appServer?.close();
  gatewayServer.close();
  if (mods) await mods.prisma.$disconnect();
});

async function resetLedger(m: Mods) {
  await m.prisma.$executeRawUnsafe(
    'TRUNCATE wallet_ledger_entries, platform_commissions, partner_receivables, payment_transactions, payment_webhook_events, wallets, ledger_operations RESTART IDENTITY CASCADE',
  );
  calls.length = 0;
  activationResponder = () => ({ status: 200, body: { success: true } });
  querydrResponder = () => ({ status: 200, body: { vnp_ResponseCode: '91' } });
}

type Purpose = 'PT_CONTRACT' | 'GYM_MEMBERSHIP' | 'PERSONALIZED_SERVICE_PURCHASE' | 'TRAINING_PACKAGE_PURCHASE' | 'WALLET_TOPUP';
interface Checkout {
  txnId: string; // === vnp_TxnRef
  entityId: string;
  price: number;
  purpose: Purpose;
  parties: { ptUserId: string; gymId: string | null; clientUserId: string };
}

/** A checkout the client has started: a PENDING VNPay transaction carrying the frozen rate/party snapshot. */
async function checkout(
  m: Mods,
  o: { purpose?: Purpose; price?: number; status?: 'PENDING' | 'FAILED' | 'CANCELLED' | 'REFUNDED' } = {},
): Promise<Checkout> {
  const purpose = o.purpose ?? 'PT_CONTRACT';
  const price = o.price ?? 5_000_000;
  const id = randomUUID();
  const entityId = `ent-${id.slice(0, 8)}`;
  const withGym = purpose === 'GYM_MEMBERSHIP';
  const parties = { ptUserId: `pt-${id.slice(0, 8)}`, gymId: withGym ? `gym-${id.slice(0, 8)}` : null, clientUserId: `client-${id.slice(0, 8)}` };
  const rates = withGym
    ? { platformRate: '0.10', ptRate: '0.55', gymRate: '0.35' }
    : { platformRate: '0.10', ptRate: '0.90', gymRate: '0' };

  if (purpose === 'WALLET_TOPUP') {
    const wallet = await m.wallet.getOrCreateWallet('CLIENT', parties.clientUserId);
    await m.prisma.paymentTransaction.create({
      data: {
        id, payerId: parties.clientUserId, purpose, amount: price, currency: 'VND', status: o.status ?? 'PENDING',
        provider: 'VNPAY', providerTransactionId: id, idempotencyKey: `topup-${id}`,
        payerWalletId: wallet.id, receiverWalletId: wallet.id, relatedEntityType: 'WALLET_TOPUP',
        activationStatus: 'NOT_APPLICABLE', sourceService: 'integration-test',
      },
    });
  } else {
    await m.prisma.paymentTransaction.create({
      data: {
        id, payerId: parties.clientUserId, purpose, amount: price, currency: 'VND', status: o.status ?? 'PENDING',
        provider: 'VNPAY', providerTransactionId: id, idempotencyKey: `checkout-${id}`,
        relatedEntityType: purpose, relatedEntityId: entityId, activationStatus: 'PENDING', sourceService: 'integration-test',
        metadata: { rates, parties, vnp_TxnRef: id, platform: 'web' },
      },
    });
  }
  return { txnId: id, entityId, price, purpose, parties };
}

interface QueryOpts {
  /** Whole VND the gateway reports (sent as ×100). */
  amountVnd?: number;
  /** Raw vnp_Amount, bypassing the ×100 conversion (for malformed values). null = omit the field. */
  rawAmount?: string | null;
  responseCode?: string;
  /** null = omit vnp_TransactionStatus. */
  txnStatus?: string | null;
  tmn?: string | null;
  currency?: string;
  transactionNo?: string;
  ref?: string;
}

/** A VNPay callback query signed with the very helper the provider signs with. */
function vnpQuery(m: Mods, c: Checkout, o: QueryOpts = {}): string {
  const params: Record<string, string> = {
    vnp_BankCode: 'NCB',
    vnp_PayDate: '20261014120000',
    vnp_ResponseCode: o.responseCode ?? '00',
    vnp_TransactionNo: o.transactionNo ?? String(Math.floor(10_000_000 + Math.random() * 89_999_999)),
    vnp_TxnRef: o.ref ?? c.txnId,
  };
  if (o.rawAmount !== null) params.vnp_Amount = o.rawAmount ?? String(BigInt(o.amountVnd ?? c.price) * 100n);
  if (o.txnStatus !== null) params.vnp_TransactionStatus = o.txnStatus ?? (params.vnp_ResponseCode === '00' ? '00' : '02');
  if (o.tmn !== null) params.vnp_TmnCode = o.tmn ?? TMN;
  if (o.currency) params.vnp_CurrCode = o.currency;
  const { query, signature } = m.vnpay.buildSignedQuery(params);
  return `${query}&vnp_SecureHash=${signature}`;
}

async function ipn(m: Mods, query: string): Promise<{ RspCode: string; Message: string }> {
  const res = await fetch(`${m.base}/payments/webhook/vnpay?${query}`);
  return (await res.json()) as { RspCode: string; Message: string };
}

async function browserReturn(m: Mods, query: string): Promise<{ status: number; location: string }> {
  const res = await fetch(`${m.base}/payments/vnpay/return?${query}`, { redirect: 'manual' });
  return { status: res.status, location: res.headers.get('location') ?? '' };
}

const txnRow = (m: Mods, c: Checkout) => m.prisma.paymentTransaction.findUniqueOrThrow({ where: { id: c.txnId } });
const ledgerRows = (m: Mods, c: Checkout) => m.prisma.walletLedgerEntry.count({ where: { transactionId: c.txnId } });
const activations = () => calls.filter((x) => x.path.endsWith('/activate') || x.path.endsWith('/activate-after-payment'));

/** Net escrow credit booked for THIS transaction (CREDIT - DEBIT on the escrow wallet), in whole VND. */
async function escrowCredit(m: Mods, c: Checkout): Promise<bigint> {
  const escrow = await m.wallet.getEscrowWallet();
  const rows = await m.prisma.walletLedgerEntry.findMany({ where: { transactionId: c.txnId, walletId: escrow.id, bucket: 'AVAILABLE' } });
  return rows.reduce((sum, r) => sum + (r.entryType === 'CREDIT' ? 1n : -1n) * BigInt(r.amount.toFixed(0)), 0n);
}

async function clientAvailable(m: Mods, c: Checkout): Promise<string> {
  const w = await m.wallet.getOrCreateWallet('CLIENT', c.parties.clientUserId);
  return (await m.prisma.wallet.findUniqueOrThrow({ where: { id: w.id } })).availableBalance.toFixed(2);
}

/** Nothing about the money moved for this transaction. */
async function assertNothingMoved(m: Mods, c: Checkout, why: string) {
  assert.equal(await ledgerRows(m, c), 0, `${why}: no ledger entry may exist`);
  assert.equal(await escrowCredit(m, c), 0n, `${why}: escrow credit is zero`);
  assert.equal(activations().length, 0, `${why}: nothing may be activated`);
  await m.reconcile.assertInvariant(why);
}

const discrepancy = async (m: Mods, c: Checkout) => ((await txnRow(m, c)).metadata as any)?.gatewayDiscrepancy;

// ═══════════════════════════ the exact-amount happy path, and duplicate delivery ═══════════════════════════

test('exact amount: IPN settles once (RspCode 00); the same IPN again answers 02 and moves nothing', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const c = await checkout(m);
  const q = vnpQuery(m, c, { transactionNo: '90000001' });

  assert.deepEqual(await ipn(m, q), { RspCode: '00', Message: 'Confirm Success' });
  const t = await txnRow(m, c);
  assert.equal(t.status, 'PAID');
  assert.equal(await escrowCredit(m, c), BigInt(c.price), 'escrow credit equals the amount the gateway reported');
  assert.equal(activations().length, 1, 'user-service asked exactly once');
  const rows = await ledgerRows(m, c);
  await m.reconcile.assertInvariant('exact amount');

  assert.equal((await ipn(m, q)).RspCode, '02', 'the exact same IPN again: already confirmed');
  assert.equal((await ipn(m, vnpQuery(m, c, { transactionNo: '90000002' }))).RspCode, '02', 'a different delivery of the same payment: already confirmed');
  assert.equal(await ledgerRows(m, c), rows, 'no further ledger entries');
  assert.equal(await escrowCredit(m, c), BigInt(c.price), 'still credited once');
  assert.equal(activations().length, 1, 'no further activation');
  assert.equal(await discrepancy(m, c), undefined, 'a correct payment leaves no discrepancy');
  await m.reconcile.assertInvariant('exact amount, duplicates');
});

// ═══════════════════════════════ the defect: wrong amount ═══════════════════════════════

test('H1 reproduction: 1,000 VND IPN for a 5,000,000 VND contract — RspCode 04, nothing settles, discrepancy recorded', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const c = await checkout(m, { price: 5_000_000 });
  const q = vnpQuery(m, c, { amountVnd: 1_000, transactionNo: '90000011' });

  assert.deepEqual(await ipn(m, q), { RspCode: '04', Message: 'Invalid amount' });
  const t = await txnRow(m, c);
  assert.notEqual(t.status, 'PAID', 'must not be marked paid');
  assert.equal(t.status, 'FAILED', 'checkout closed so nothing keeps polling or settling it');
  assert.ok(t.failedAt);
  await assertNothingMoved(m, c, 'underpayment');

  const d = await discrepancy(m, c);
  assert.equal(d.kind, 'AMOUNT_MISMATCH');
  assert.equal(d.expectedAmountVnd, '5000000');
  assert.equal(d.reportedAmountVnd, '1000');
  assert.equal(d.reportedMinorUnits, '100000');
  assert.equal(d.source, 'IPN');
  assert.equal(d.gatewayTransactionNo, '90000011');
  assert.equal(d.occurrences, 1);
  assert.ok((t.metadata as any).rates && (t.metadata as any).parties, 'the frozen rate/party snapshot is preserved');

  // VNPay retries an IPN it does not get 00/02 for: the same answer, still nothing moves, one more occurrence.
  assert.equal((await ipn(m, q)).RspCode, '04');
  assert.equal((await discrepancy(m, c)).occurrences, 2);
  assert.equal((await txnRow(m, c)).status, 'FAILED');
  await assertNothingMoved(m, c, 'underpayment retried');

  // The admin can find it.
  const listed = await m.txnRepo.findWithGatewayDiscrepancy(50);
  assert.ok(listed.some((x) => x.id === c.txnId), 'listed for manual handling');
});

test('overpayment: 9,000,000 VND IPN for a 5,000,000 VND contract — RspCode 04, nothing settles, discrepancy recorded', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const c = await checkout(m, { price: 5_000_000 });

  assert.deepEqual(await ipn(m, vnpQuery(m, c, { amountVnd: 9_000_000 })), { RspCode: '04', Message: 'Invalid amount' });
  assert.equal((await txnRow(m, c)).status, 'FAILED');
  await assertNothingMoved(m, c, 'overpayment');
  const d = await discrepancy(m, c);
  assert.equal(d.reportedAmountVnd, '9000000');
  assert.equal(d.expectedAmountVnd, '5000000');
});

test('amount edge cases: off by one VND, off by one minor unit, non-numeric, negative, fractional, exponent, missing — all refused with 04', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const cases: Array<[string, QueryOpts]> = [
    ['one VND short', { amountVnd: 4_999_999 }],
    ['one VND over', { amountVnd: 5_000_001 }],
    ['one minor unit over (500000001)', { rawAmount: '500000001' }],
    ['unconverted (price sent without x100)', { rawAmount: '5000000' }],
    ['non-numeric', { rawAmount: 'abc' }],
    ['negative', { rawAmount: '-500000000' }],
    ['fractional', { rawAmount: '500000000.5' }],
    ['exponent', { rawAmount: '5e8' }],
    ['empty', { rawAmount: '' }],
    ['absent', { rawAmount: null }],
  ];
  for (const [label, opts] of cases) {
    const c = await checkout(m, { price: 5_000_000 });
    const answer = await ipn(m, vnpQuery(m, c, opts));
    assert.equal(answer.RspCode, '04', `${label}: RspCode`);
    assert.equal((await txnRow(m, c)).status, 'FAILED', `${label}: not paid`);
    await assertNothingMoved(m, c, label);
  }
});

test('currency present and not VND: refused with 04, nothing moves', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const c = await checkout(m);
  assert.equal((await ipn(m, vnpQuery(m, c, { currency: 'USD' }))).RspCode, '04');
  assert.equal((await txnRow(m, c)).status, 'PENDING', 'a callback we do not accept does not touch the transaction');
  await assertNothingMoved(m, c, 'currency');
  // VND explicitly present is fine.
  assert.equal((await ipn(m, vnpQuery(m, c, { currency: 'VND' }))).RspCode, '00');
  assert.equal(await escrowCredit(m, c), BigInt(c.price));
});

// ═══════════════════════════════ reference, signature, merchant ═══════════════════════════════

test('unknown vnp_TxnRef: RspCode 01, nothing created or moved', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const ghost: Checkout = { txnId: randomUUID(), entityId: 'x', price: 1_000_000, purpose: 'PT_CONTRACT', parties: { ptUserId: 'p', gymId: null, clientUserId: 'c' } };
  assert.deepEqual(await ipn(m, vnpQuery(m, ghost)), { RspCode: '01', Message: 'Order not found' });
  assert.equal(await m.prisma.paymentTransaction.count(), 0);
  assert.equal(await m.prisma.walletLedgerEntry.count(), 0);
  assert.equal(activations().length, 0);
});

test('a reference that belongs to another provider is not found for VNPay (RspCode 01), nothing moves', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const c = await checkout(m);
  await m.prisma.paymentTransaction.update({ where: { id: c.txnId }, data: { provider: 'ZALOPAY' } });
  assert.equal((await ipn(m, vnpQuery(m, c))).RspCode, '01');
  assert.equal((await txnRow(m, c)).status, 'PENDING');
  await assertNothingMoved(m, c, 'other provider');
});

test('bad signature: RspCode 97 and nothing moves — tampered amount, wrong secret, missing hash', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const c = await checkout(m, { price: 5_000_000 });

  // Signed for 1,000 VND then edited to claim the full price — the classic tamper.
  const signedLow = vnpQuery(m, c, { amountVnd: 1_000 });
  const tampered = signedLow.replace('vnp_Amount=100000', 'vnp_Amount=500000000');
  assert.notEqual(tampered, signedLow);
  assert.deepEqual(await ipn(m, tampered), { RspCode: '97', Message: 'Invalid signature' });

  // Signed with a key that is not ours.
  const crypto = await import('crypto');
  const body = `vnp_Amount=500000000&vnp_ResponseCode=00&vnp_TmnCode=${TMN}&vnp_TransactionStatus=00&vnp_TxnRef=${c.txnId}`;
  const forged = `${body}&vnp_SecureHash=${crypto.createHmac('sha512', 'someone-elses-secret').update(body).digest('hex')}`;
  assert.equal((await ipn(m, forged)).RspCode, '97');

  // No hash at all.
  assert.equal((await ipn(m, body)).RspCode, '97');

  assert.equal((await txnRow(m, c)).status, 'PENDING', 'untouched');
  await assertNothingMoved(m, c, 'bad signature');
  assert.equal(await discrepancy(m, c), undefined, 'an unauthenticated callback must not be able to write to the transaction');
});

test('wrong merchant code (vnp_TmnCode) — validly signed but not for us: refused, nothing moves', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const c = await checkout(m);
  assert.deepEqual(await ipn(m, vnpQuery(m, c, { tmn: 'OTHERMERCHANT' })), { RspCode: '01', Message: 'Order not found' });
  assert.equal((await ipn(m, vnpQuery(m, c, { tmn: null }))).RspCode, '01', 'a callback without a merchant code is refused too');
  assert.equal((await txnRow(m, c)).status, 'PENDING');
  await assertNothingMoved(m, c, 'wrong merchant');
});

// ═══════════════════════════════ the payment did not succeed ═══════════════════════════════

test('not-successful result codes: no settlement; definitive failures close the checkout (as before), indeterminate ones leave it open', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);

  // payer cancelled (24) — definitive: the checkout is closed.
  const cancelled = await checkout(m);
  assert.equal((await ipn(m, vnpQuery(m, cancelled, { responseCode: '24', txnStatus: '02' }))).RspCode, '00');
  assert.equal((await txnRow(m, cancelled)).status, 'FAILED');
  await assertNothingMoved(m, cancelled, 'cancelled');

  // ResponseCode 00 but TransactionStatus 02 — VNPay says the transaction did NOT complete: never paid.
  const inconsistent = await checkout(m);
  assert.equal((await ipn(m, vnpQuery(m, inconsistent, { responseCode: '00', txnStatus: '02' }))).RspCode, '00');
  assert.equal((await txnRow(m, inconsistent)).status, 'PENDING', 'not settled, not failed: left for the gateway to say');
  await assertNothingMoved(m, inconsistent, 'response 00 / status 02');

  // ResponseCode 00 and no TransactionStatus at all — the required confirmation is missing: never paid.
  const noStatus = await checkout(m);
  await ipn(m, vnpQuery(m, noStatus, { responseCode: '00', txnStatus: null }));
  assert.equal((await txnRow(m, noStatus)).status, 'PENDING');
  await assertNothingMoved(m, noStatus, 'status missing');

  // 07 (suspected fraud, money held) is not a definitive failure: stays open for querydr.
  const suspect = await checkout(m);
  await ipn(m, vnpQuery(m, suspect, { responseCode: '07', txnStatus: '02' }));
  assert.equal((await txnRow(m, suspect)).status, 'PENDING');
  await assertNothingMoved(m, suspect, 'code 07');

  // A failure notice never downgrades a settled payment.
  const paid = await checkout(m);
  assert.equal((await ipn(m, vnpQuery(m, paid))).RspCode, '00');
  assert.equal((await ipn(m, vnpQuery(m, paid, { responseCode: '24', txnStatus: '02' }))).RspCode, '02');
  assert.equal((await txnRow(m, paid)).status, 'PAID');
  assert.equal(await escrowCredit(m, paid), BigInt(paid.price));
  await m.reconcile.assertInvariant('failure after success');
});

// ═══════════════════════════ late / out-of-state callbacks ═══════════════════════════

test('late genuine payment after the checkout was swept to FAILED: today\'s behaviour is kept ONLY for the exact amount', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);

  // matching amount: settles (the stale sweep closed the checkout while the payer was still on the bank page).
  const late = await checkout(m, { status: 'FAILED' });
  assert.equal((await ipn(m, vnpQuery(m, late))).RspCode, '00');
  assert.equal((await txnRow(m, late)).status, 'PAID');
  assert.equal(await escrowCredit(m, late), BigInt(late.price));
  assert.equal(activations().length, 1);
  await m.reconcile.assertInvariant('late exact');

  // mismatching amount: refused, stays FAILED, nothing moves.
  const lateWrong = await checkout(m, { status: 'FAILED' });
  assert.equal((await ipn(m, vnpQuery(m, lateWrong, { amountVnd: 1_000 }))).RspCode, '04');
  assert.equal((await txnRow(m, lateWrong)).status, 'FAILED');
  assert.equal(await escrowCredit(m, lateWrong), 0n);
  assert.equal(await ledgerRows(m, lateWrong), 0);
  assert.equal((await discrepancy(m, lateWrong)).kind, 'AMOUNT_MISMATCH');
  await m.reconcile.assertInvariant('late wrong');
});

test('CANCELLED on our side: an exact payment is booked and goes through the not-activatable -> full refund path; a wrong amount is refused', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);

  const cancelled = await checkout(m, { status: 'CANCELLED', price: 2_000_000 });
  activationResponder = () => NOT_ACTIVATABLE('CANCELLED'); // the order was cancelled on our side too
  assert.equal((await ipn(m, vnpQuery(m, cancelled))).RspCode, '00');
  const t = await txnRow(m, cancelled);
  assert.equal(t.status, 'PAID', 'the gateway did capture the money — it is booked, not lost');
  assert.notEqual(t.activationStatus, 'ACTIVATED');
  assert.ok((t.metadata as any).unactivatedRefund, 'refund marker present');
  assert.equal(await clientAvailable(m, cancelled), '2000000.00', 'the client got the whole payment back');
  assert.equal(await escrowCredit(m, cancelled), 2_000_000n, 'cash held; the claim moved to the client');
  await m.reconcile.assertInvariant('cancelled, exact, refunded');

  const cancelledWrong = await checkout(m, { status: 'CANCELLED', price: 2_000_000 });
  assert.equal((await ipn(m, vnpQuery(m, cancelledWrong, { amountVnd: 500 }))).RspCode, '04');
  assert.equal((await txnRow(m, cancelledWrong)).status, 'CANCELLED');
  assert.equal(await ledgerRows(m, cancelledWrong), 0);
  await m.reconcile.assertInvariant('cancelled, wrong');
});

test('REFUNDED transaction: a payment callback must not revive it or credit escrow again (RspCode 02)', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const c = await checkout(m, { status: 'REFUNDED' });
  assert.equal((await ipn(m, vnpQuery(m, c))).RspCode, '02');
  assert.equal((await txnRow(m, c)).status, 'REFUNDED');
  await assertNothingMoved(m, c, 'refunded');
});

test('a wrong-amount callback arriving AFTER the right one settled: 04, but the PAID transaction and its ledger are untouched', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const c = await checkout(m, { price: 3_000_000 });
  assert.equal((await ipn(m, vnpQuery(m, c))).RspCode, '00');
  const rows = await ledgerRows(m, c);
  assert.equal((await ipn(m, vnpQuery(m, c, { amountVnd: 1_000 }))).RspCode, '04');
  const t = await txnRow(m, c);
  assert.equal(t.status, 'PAID', 'a settled payment is never downgraded');
  assert.equal(await ledgerRows(m, c), rows);
  assert.equal(await escrowCredit(m, c), 3_000_000n);
  assert.equal((t.metadata as any).gatewayDiscrepancy.kind, 'AMOUNT_MISMATCH', 'but the odd callback is on record');
  await m.reconcile.assertInvariant('wrong after right');
});

// ═══════════════════════════ concurrency, for every purpose ═══════════════════════════

for (const purpose of ['PT_CONTRACT', 'GYM_MEMBERSHIP', 'PERSONALIZED_SERVICE_PURCHASE', 'TRAINING_PACKAGE_PURCHASE', 'WALLET_TOPUP'] as Purpose[]) {
  test(`${purpose}: six concurrent identical IPNs settle exactly once`, skipOpts, async () => {
    const m = await load();
    await resetLedger(m);
    const c = await checkout(m, { purpose, price: 1_200_000 });
    const q = vnpQuery(m, c, { transactionNo: '90000099' });

    const answers = await Promise.all(Array.from({ length: 6 }, () => ipn(m, q)));
    for (const a of answers) assert.ok(['00', '02'].includes(a.RspCode), `every delivery is acknowledged, got ${JSON.stringify(a)}`);
    assert.ok(answers.some((a) => a.RspCode === '00'));

    assert.equal((await txnRow(m, c)).status, 'PAID');
    if (purpose === 'WALLET_TOPUP') {
      assert.equal(await clientAvailable(m, c), '1200000.00', 'credited exactly once');
      assert.equal(await ledgerRows(m, c), 1);
    } else {
      assert.equal(await escrowCredit(m, c), 1_200_000n, 'escrow credited exactly once');
      // 1 escrow credit + the pending shares (pt, platform, and gym when there is one) — and no second set.
      const expectedRows = purpose === 'GYM_MEMBERSHIP' ? 4 : 3;
      assert.equal(await ledgerRows(m, c), expectedRows, 'one settlement\'s worth of ledger entries');
    }
    // WALLET_TOPUP is the retired top-up flow: creditWalletAndMarkPaid credits the client's wallet without an escrow
    // leg (pre-existing, unchanged here), so the escrow == claims invariant is not defined for it.
    if (purpose !== 'WALLET_TOPUP') await m.reconcile.assertInvariant(`${purpose} concurrent`);

    // Different deliveries of the same payment, concurrently, and a concurrent browser return.
    const more = await Promise.all([
      ipn(m, vnpQuery(m, c, { transactionNo: '90000100' })),
      browserReturn(m, vnpQuery(m, c, { transactionNo: '90000101' })),
      ipn(m, q),
    ]);
    assert.equal(more[0].RspCode, '02');
    assert.equal(more[2].RspCode, '02');
    assert.match(more[1].location, /status=success/);
    assert.equal(await ledgerRows(m, c), purpose === 'WALLET_TOPUP' ? 1 : purpose === 'GYM_MEMBERSHIP' ? 4 : 3);
    if (purpose !== 'WALLET_TOPUP') await m.reconcile.assertInvariant(`${purpose} concurrent, later deliveries`);
  });

  test(`${purpose}: a wrong amount is refused (04) and nothing moves`, skipOpts, async () => {
    const m = await load();
    await resetLedger(m);
    const c = await checkout(m, { purpose, price: 1_200_000 });
    assert.equal((await ipn(m, vnpQuery(m, c, { amountVnd: 100 }))).RspCode, '04');
    assert.equal((await txnRow(m, c)).status, 'FAILED');
    assert.equal(await ledgerRows(m, c), 0);
    assert.equal(await escrowCredit(m, c), 0n);
    if (purpose === 'WALLET_TOPUP') assert.equal(await clientAvailable(m, c), '0.00', 'no top-up credit');
    assert.equal(activations().length, 0);
    await m.reconcile.assertInvariant(`${purpose} wrong amount`);
  });
}

test('two concurrent IPNs with DIFFERENT amounts: only the exact one can settle, the wrong one never does', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const c = await checkout(m, { price: 4_000_000 });
  const answers = await Promise.all([
    ipn(m, vnpQuery(m, c, { amountVnd: 1_000, transactionNo: '90000201' })),
    ipn(m, vnpQuery(m, c, { transactionNo: '90000202' })),
  ]);
  assert.deepEqual(answers.map((a) => a.RspCode).sort(), ['00', '04']);
  // Whichever order they ran in, the money booked is the exact price once, or nothing — never the short amount.
  const credit = await escrowCredit(m, c);
  assert.ok(credit === 4_000_000n || credit === 0n, `escrow credit ${credit}`);
  assert.equal(credit === 4_000_000n, (await txnRow(m, c)).status === 'PAID');
  await m.reconcile.assertInvariant('mixed concurrent');
});

// ═══════════════════════════ the browser return URL ═══════════════════════════

test('return URL: exact amount settles (302 status=success); the IPN afterwards answers 02 — one settlement', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const c = await checkout(m);
  const r = await browserReturn(m, vnpQuery(m, c));
  assert.equal(r.status, 302);
  assert.match(r.location, /status=success/);
  assert.equal((await txnRow(m, c)).status, 'PAID');
  assert.equal(await escrowCredit(m, c), BigInt(c.price));
  assert.equal(activations().length, 1);

  assert.equal((await ipn(m, vnpQuery(m, c))).RspCode, '02');
  const again = await browserReturn(m, vnpQuery(m, c));
  assert.match(again.location, /status=success/, 'refreshing the result page is harmless');
  assert.equal(await escrowCredit(m, c), BigInt(c.price), 'credited once across return + IPN + refresh');
  assert.equal(activations().length, 1);
  await m.reconcile.assertInvariant('return then ipn');
});

test('return URL after the IPN: idempotent', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const c = await checkout(m);
  assert.equal((await ipn(m, vnpQuery(m, c))).RspCode, '00');
  const r = await browserReturn(m, vnpQuery(m, c));
  assert.match(r.location, /status=success/);
  assert.equal(await escrowCredit(m, c), BigInt(c.price));
  await m.reconcile.assertInvariant('ipn then return');
});

test('return URL: wrong amount (under and over) is NOT settled and shows failed; recorded as a RETURN discrepancy', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  for (const amountVnd of [1_000, 9_000_000]) {
    const c = await checkout(m, { price: 5_000_000 });
    const r = await browserReturn(m, vnpQuery(m, c, { amountVnd }));
    assert.equal(r.status, 302);
    assert.match(r.location, /status=failed/);
    assert.equal((await txnRow(m, c)).status, 'FAILED');
    await assertNothingMoved(m, c, `return ${amountVnd}`);
    const d = await discrepancy(m, c);
    assert.equal(d.source, 'RETURN');
    assert.equal(d.reportedAmountVnd, String(amountVnd));
  }
});

test('return URL: bad signature, wrong merchant, unknown reference, failed payment — nothing settles', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const c = await checkout(m);

  const tampered = vnpQuery(m, c, { amountVnd: 1_000 }).replace('vnp_Amount=100000', 'vnp_Amount=500000000');
  assert.match((await browserReturn(m, tampered)).location, /status=invalid/);
  assert.match((await browserReturn(m, vnpQuery(m, c, { tmn: 'OTHERMERCHANT' }))).location, /status=invalid/);
  const ghost = await browserReturn(m, vnpQuery(m, { ...c, txnId: randomUUID() }));
  assert.match(ghost.location, /status=invalid/);
  assert.match((await browserReturn(m, vnpQuery(m, c, { responseCode: '00', txnStatus: '02' }))).location, /status=failed/);

  assert.equal((await txnRow(m, c)).status, 'PENDING');
  await assertNothingMoved(m, c, 'hostile returns');

  // The payer cancelled at the bank (signed 24): the checkout is closed, as before.
  assert.match((await browserReturn(m, vnpQuery(m, c, { responseCode: '24', txnStatus: '02' }))).location, /status=failed/);
  assert.equal((await txnRow(m, c)).status, 'FAILED');
});

// ═══════════════════════════ the gateway poll (querydr) ═══════════════════════════

/**
 * A querydr answer signed the way VNPay signs it: HMAC-SHA512 over the pipe-joined response fields (this is written
 * out here on purpose, independent of the provider's own implementation).
 */
function signQuerydr(fields: Record<string, string>): Record<string, string> {
  const order = ['vnp_ResponseId', 'vnp_Command', 'vnp_ResponseCode', 'vnp_Message', 'vnp_TmnCode', 'vnp_TxnRef', 'vnp_Amount', 'vnp_BankCode', 'vnp_PayDate', 'vnp_TransactionNo', 'vnp_TransactionType', 'vnp_TransactionStatus', 'vnp_OrderInfo', 'vnp_PromotionCode', 'vnp_PromotionAmount'];
  const data = order.map((k) => fields[k] ?? '').join('|');
  return { ...fields, vnp_SecureHash: require('crypto').createHmac('sha512', process.env.VNPAY_HASH_SECRET as string).update(Buffer.from(data, 'utf-8')).digest('hex') };
}

function querydrSays(c: Checkout, o: { amountVnd?: number | null; tmn?: string; status?: string; ref?: string }): (body: any) => Answer {
  return () => ({
    status: 200,
    body: signQuerydr({
      vnp_ResponseId: 'resp-1',
      vnp_Command: 'querydr',
      vnp_ResponseCode: '00',
      vnp_Message: 'QueryDR Success',
      vnp_TransactionStatus: o.status ?? '00',
      vnp_TmnCode: o.tmn ?? TMN,
      vnp_TxnRef: o.ref ?? c.txnId,
      ...(o.amountVnd === null ? {} : { vnp_Amount: String(BigInt(o.amountVnd ?? c.price) * 100n) }),
    }),
  });
}

test('poll (querydr): exact amount settles; wrong/absent amount, wrong merchant or wrong reference never does', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);

  const good = await checkout(m);
  querydrResponder = querydrSays(good, {});
  assert.equal(await m.webhook.pollAndSettle(await txnRow(m, good)), 'PAID');
  assert.equal((await txnRow(m, good)).status, 'PAID');
  assert.equal(await escrowCredit(m, good), BigInt(good.price));
  await m.reconcile.assertInvariant('poll exact');

  const low = await checkout(m, { price: 5_000_000 });
  querydrResponder = querydrSays(low, { amountVnd: 1_000 });
  assert.equal(await m.webhook.pollAndSettle(await txnRow(m, low)), 'FAILED', 'reported as not settled');
  assert.equal((await txnRow(m, low)).status, 'FAILED');
  assert.equal((await discrepancy(m, low)).source, 'POLL');
  assert.equal(await ledgerRows(m, low), 0);

  const absent = await checkout(m);
  querydrResponder = querydrSays(absent, { amountVnd: null });
  assert.equal(await m.webhook.pollAndSettle(await txnRow(m, absent)), 'FAILED');
  assert.equal((await discrepancy(m, absent)).kind, 'AMOUNT_MISSING');
  assert.equal(await ledgerRows(m, absent), 0);

  const otherMerchant = await checkout(m);
  querydrResponder = querydrSays(otherMerchant, { tmn: 'OTHERMERCHANT' });
  assert.equal(await m.webhook.pollAndSettle(await txnRow(m, otherMerchant)), 'PENDING');
  assert.equal((await txnRow(m, otherMerchant)).status, 'PENDING');
  assert.equal(await ledgerRows(m, otherMerchant), 0);

  const otherRef = await checkout(m);
  querydrResponder = querydrSays(otherRef, { ref: randomUUID() });
  assert.equal(await m.webhook.pollAndSettle(await txnRow(m, otherRef)), 'PENDING');
  assert.equal(await ledgerRows(m, otherRef), 0);

  assert.equal(activations().length, 1, 'only the exact payment activated anything');
  await m.reconcile.assertInvariant('poll matrix');
});

test('VNPay provider queryTransactionStatus never reports PAID for a different amount', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const c = await checkout(m, { price: 2_000_000 });
  const provider = new m.vnpay.VNPayProvider();
  const ask = () => provider.queryTransactionStatus({ id: c.txnId, providerTransactionId: c.txnId, amount: c.price, createdAt: new Date(), metadata: {} });
  querydrResponder = querydrSays(c, { amountVnd: 2_000_000 });
  assert.equal(await ask(), 'PAID');
  querydrResponder = querydrSays(c, { amountVnd: 20_000 });
  assert.equal(await ask(), 'PENDING');
  querydrResponder = querydrSays(c, { amountVnd: null });
  assert.equal(await ask(), 'PENDING');
});

// ═══════════════════════════ other settlement doors ═══════════════════════════

test('handleEvent itself refuses a VNPAY PAID event that carries no amount (a future caller cannot forget the check)', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const c = await checkout(m);
  const outcome = await m.webhook.handleEvent({
    provider: 'VNPAY', providerEventId: `evt_${randomUUID()}`, providerTransactionId: c.txnId, payload: {}, status: 'PAID',
  });
  assert.equal(outcome, 'AMOUNT_MISMATCH');
  assert.equal((await discrepancy(m, c)).kind, 'AMOUNT_MISSING');
  assert.equal(await ledgerRows(m, c), 0);

  const c2 = await checkout(m);
  assert.equal(
    await m.webhook.handleEvent({ provider: 'VNPAY', providerEventId: `evt_${randomUUID()}`, providerTransactionId: c2.txnId, payload: {}, status: 'PAID', paidAmountVnd: String(c2.price) }),
    'SETTLED',
  );
  await m.reconcile.assertInvariant('handleEvent');
});

test('the demo checkout can never be live in production (NODE_ENV=production ignores VNPAY_SIMULATE), and is live in dev when asked for', skipOpts, async () => {
  // vnpay.provider reads its environment at import time, so each environment gets its own process.
  const probe = `
    const p = require('./src/providers/vnpay.provider');
    process.stdout.write(JSON.stringify({ simulate: p.isVnpaySimulateEnabled() }));
  `;
  const run = (env: Record<string, string>) => {
    const r = spawnSync(process.execPath, ['--import', 'tsx', '-e', probe], {
      cwd: process.cwd(),
      env: { ...process.env, VNPAY_HASH_SECRET: 'x', ...env },
      encoding: 'utf8',
    });
    assert.equal(r.status, 0, r.stderr);
    return { ...(JSON.parse(r.stdout.trim().split('\n').pop()!) as { simulate: boolean }), stderr: r.stderr + r.stdout };
  };
  const prod = run({ NODE_ENV: 'production', VNPAY_SIMULATE: 'true' });
  assert.equal(prod.simulate, false, 'production ignores VNPAY_SIMULATE');
  assert.match(prod.stderr, /VNPAY_SIMULATE=true is IGNORED/, 'and says so loudly');
  assert.equal(run({ NODE_ENV: 'development', VNPAY_SIMULATE: 'true' }).simulate, true);
  assert.equal(run({ NODE_ENV: 'development', VNPAY_SIMULATE: 'false' }).simulate, false);
});

// ═══════════════════════════ pure conversion / comparison ═══════════════════════════

test('vnp_Amount conversion is the exact inverse of checkout\'s x100, integer-only', skipOpts, async () => {
  const m = await load();
  const f = m.vnpay.vnpayMinorToVnd;
  assert.equal(f('500000000'), '5000000');
  assert.equal(f('100'), '1');
  assert.equal(f('0'), '0');
  assert.equal(f('9007199254740993' + '00'), '9007199254740993', 'beyond Number.MAX_SAFE_INTEGER stays exact');
  for (const bad of ['', ' 100', '100 ', '-100', '+100', '1.5', '100.00', '1e2', '0x64', 'abc', '150', '99', '1234567890123456789012']) {
    assert.equal(f(bad), null, `"${bad}" is not a whole number of VND in minor units`);
  }
  assert.equal(f(undefined), null);
  assert.equal(f(100), null, 'only the string form VNPay sends is accepted');

  const { compareGatewayAmount } = await import('../services/gateway-amount');
  assert.deepEqual(compareGatewayAmount('5000000.00', '5000000'), { ok: true });
  assert.deepEqual(compareGatewayAmount(5000000, '5000000'), { ok: true });
  assert.equal((compareGatewayAmount(5000000, '4999999') as any).kind, 'AMOUNT_MISMATCH');
  assert.equal((compareGatewayAmount(5000000, null) as any).kind, 'AMOUNT_MISSING');
  assert.equal((compareGatewayAmount('100.50', '100') as any).kind, 'PRICE_NOT_WHOLE_VND', 'a fractional price can never have been paid exactly');
  // The checkout path hands VNPay Math.round(amount); the helper must never "agree" by rounding.
  assert.equal(compareGatewayAmount('1000.40', '1000').ok, false);
});
