/**
 * A client who paid for a PT contract that can no longer be activated gets the whole payment
 * back — automatically, once, and visibly.
 *
 * The defect this pins. payment-service moves the money first (settleContractPayment: the price
 * lands in escrow and in the PT's / gym's / platform's PENDING buckets), THEN asks user-service
 * to activate the contract. user-service used to answer `200 { success: true }` for a contract
 * it had NOT activated (cancelled by a party or by the 12-hour payment deadline while the
 * client was on the bank's page, or already active under another payment), and payment-service
 * marked the transaction ACTIVATED on any 2xx. Result: the client paid, the money sat in
 * escrow, the contract was CANCELLED and nothing ever refunded it.
 *
 * user-service now answers 409 CONTRACT_NOT_ACTIVATABLE for that case. Here the user-service
 * HTTP boundary is a REAL local HTTP server (postServiceJson reads USER_SERVICE_URL per call),
 * so the whole payment-service path runs for real against the isolated test database:
 * handleEvent -> settlePurchase -> callActivateEndpoint (axios) -> refund -> ledger.
 *
 * BACKEND INTEGRATION. Run THIS FILE ALONE (it TRUNCATEs the shared ledger tables):
 *   DATABASE_URL="postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_payment_test?schema=public" \
 *     ./node_modules/.bin/tsx --test src/__tests__/contract-unactivatable-payment-refund.integration.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'crypto';
import type { AddressInfo } from 'node:net';

const databaseUrl = process.env.DATABASE_URL || '';
const canUseIntegrationDb = /_test/i.test(databaseUrl);
const skipOpts = {
  skip: canUseIntegrationDb ? false : 'Requires DATABASE_URL pointing at a *_test database.',
};

// ── user-service, as an HTTP server ─────────────────────────────────────────────────────────
type Answer = { status: number; body: unknown } | 'DROP';
const calls: Array<{ path: string; body: any }> = [];
let responder: (path: string, body: any) => Answer = () => ({ status: 200, body: { success: true } });

const NOT_ACTIVATABLE = (currentStatus: string): Answer => ({
  status: 409,
  body: {
    success: false,
    error: { code: 'CONTRACT_NOT_ACTIVATABLE', message: `Contract cannot be activated (status ${currentStatus})`, currentStatus },
  },
});

const server = http.createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
    calls.push({ path: req.url ?? '', body });
    const answer = responder(req.url ?? '', body);
    if (answer === 'DROP') return void req.socket.destroy(); // transport failure
    res.writeHead(answer.status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(answer.body));
  });
});
let serverReady: Promise<void> | undefined;
function startServer(): Promise<void> {
  serverReady ??= new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      process.env.USER_SERVICE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      delete process.env.USER_LAMBDA_NAME;
      resolve();
    });
  });
  return serverReady;
}

type Mods = {
  prisma: (typeof import('../repositories/prisma'))['prisma'];
  Prisma: (typeof import('../generated/prisma'))['Prisma'];
  ledger: typeof import('../services/contract-ledger.service');
  webhook: typeof import('../services/webhook.service');
  recon: typeof import('../services/reconciliation.service');
  reconcile: typeof import('../services/reconcile.service');
  wallet: (typeof import('../services/wallet.service'))['walletService'];
  withdrawals: (typeof import('../repositories/withdrawal.repository'))['withdrawalRepository'];
};
let mods: Mods | undefined;
async function load(): Promise<Mods> {
  await startServer();
  if (!mods) {
    mods = {
      prisma: (await import('../repositories/prisma')).prisma,
      Prisma: (await import('../generated/prisma')).Prisma,
      ledger: await import('../services/contract-ledger.service'),
      webhook: await import('../services/webhook.service'),
      recon: await import('../services/reconciliation.service'),
      reconcile: await import('../services/reconcile.service'),
      wallet: (await import('../services/wallet.service')).walletService,
      withdrawals: (await import('../repositories/withdrawal.repository')).withdrawalRepository,
    };
  }
  return mods;
}

test.after(async () => {
  server.close();
  if (mods) await mods.prisma.$disconnect();
});

async function resetLedger(m: Mods) {
  await m.prisma.$executeRawUnsafe(
    'TRUNCATE wallet_ledger_entries, platform_commissions, partner_receivables, payment_transactions, wallets, ledger_operations RESTART IDENTITY CASCADE',
  );
  calls.length = 0;
  responder = () => ({ status: 200, body: { success: true } });
}

interface Checkout {
  contractId: string;
  txnId: string;
  providerTxnId: string;
  price: number;
  parties: { ptUserId: string; gymId: string | null; clientUserId: string };
}

/** A checkout the client has started: PENDING transaction with the frozen rate/party snapshot. */
async function checkout(
  m: Mods,
  o: { id: string; pt: string; gym?: string | null; price?: number; client?: string },
): Promise<Checkout> {
  const price = o.price ?? 1_000_000;
  const gymId = o.gym ?? null;
  const parties = { ptUserId: o.pt, gymId, clientUserId: o.client ?? `client-${o.id}` };
  const rates = gymId
    ? { platformRate: '0.10', ptRate: '0.55', gymRate: '0.35' }
    : { platformRate: '0.10', ptRate: '0.90', gymRate: '0' };
  const providerTxnId = `vnpay_${randomUUID()}`;
  const txn = await m.prisma.paymentTransaction.create({
    data: {
      payerId: parties.clientUserId,
      purpose: 'PT_CONTRACT',
      amount: price,
      currency: 'VND',
      status: 'PENDING',
      provider: 'VNPAY',
      providerTransactionId: providerTxnId,
      idempotencyKey: `checkout-${o.id}-${randomUUID()}`,
      relatedEntityType: 'PT_CONTRACT',
      relatedEntityId: o.id,
      activationStatus: 'PENDING',
      sourceService: 'integration-test',
      metadata: { rates, parties },
    },
  });
  return { contractId: o.id, txnId: txn.id, providerTxnId, price, parties };
}

/** The gateway confirms payment: the same entry point a real webhook / poll uses. */
async function gatewayConfirms(m: Mods, c: Checkout, eventId = `evt_${randomUUID()}`) {
  await m.webhook.handleEvent({
    provider: 'VNPAY',
    providerEventId: eventId,
    providerTransactionId: c.providerTxnId,
    payload: {},
    status: 'PAID',
  });
}

async function txnRow(m: Mods, c: Checkout) {
  return m.prisma.paymentTransaction.findUniqueOrThrow({ where: { id: c.txnId } });
}

async function bal(m: Mods, type: 'CLIENT' | 'PT' | 'GYM' | 'PLATFORM', id: string) {
  const w = await m.wallet.getOrCreateWallet(type, id);
  const fresh = await m.prisma.wallet.findUniqueOrThrow({ where: { id: w.id } });
  return { available: fresh.availableBalance.toFixed(2), pending: fresh.pendingBalance.toFixed(2) };
}

async function escrow(m: Mods) {
  const w = await m.wallet.getEscrowWallet();
  const fresh = await m.prisma.wallet.findUniqueOrThrow({ where: { id: w.id } });
  return fresh.availableBalance.toFixed(2);
}

const activateCalls = (c: Checkout) => calls.filter((x) => x.path === `/internal/contracts/${c.contractId}/activate-after-payment`);

// ── the defect, end to end ──────────────────────────────────────────────────────────────────

test('contract no longer activatable (cancelled while on the bank page): client is refunded 100%, parties hold nothing, tx not ACTIVATED', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const c = await checkout(m, { id: 'c-cancelled', pt: 'pt-1', price: 1_000_000 });
  responder = () => NOT_ACTIVATABLE('CANCELLED');

  await gatewayConfirms(m, c);

  assert.equal(activateCalls(c).length, 1, 'user-service asked exactly once');
  assert.deepEqual(await bal(m, 'CLIENT', c.parties.clientUserId), { available: '1000000.00', pending: '0.00' }, 'client holds the full price');
  assert.deepEqual(await bal(m, 'PT', 'pt-1'), { available: '0.00', pending: '0.00' }, 'PT holds nothing from it');
  const revenue = await m.wallet.getRevenueWallet();
  const rev = await m.prisma.wallet.findUniqueOrThrow({ where: { id: revenue.id } });
  assert.equal(rev.pendingBalance.toFixed(2), '0.00', 'platform pending from it is back to zero');
  assert.equal(rev.availableBalance.toFixed(2), '0.00', 'the platform did not keep a cut of a refunded payment');
  assert.equal(await escrow(m), '1000000.00', 'cash still held; the claim on it moved to the client');
  await m.reconcile.assertInvariant('unactivatable refund, no gym');

  const t = await txnRow(m, c);
  assert.equal(t.status, 'PAID', 'the gateway did capture the money');
  assert.notEqual(t.activationStatus, 'ACTIVATED', 'must NOT claim the contract was activated');
  assert.equal(t.activationStatus, 'ACTIVATION_FAILED', 'closed for the retry sweep, visible to an admin');
  const note = (t.metadata as any).unactivatedRefund;
  assert.ok(note, 'refund marker on the transaction');
  assert.equal(note.reason, 'CONTRACT_NOT_ACTIVATABLE');
  assert.equal(note.contractStatus, 'CANCELLED');
  assert.equal(note.amount, '1000000.00');
  assert.equal(note.idempotencyKey, `CONTRACT_UNACTIVATED_REFUND:${c.txnId}`);
  assert.ok((t.metadata as any).rates && (t.metadata as any).parties, 'the frozen snapshot is preserved');
});

test('with a gym share: gym pending is reversed too', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const c = await checkout(m, { id: 'c-gym', pt: 'pt-g', gym: 'gym-g', price: 2_000_000 });
  responder = () => NOT_ACTIVATABLE('EXPIRED');

  await gatewayConfirms(m, c);

  assert.deepEqual(await bal(m, 'CLIENT', c.parties.clientUserId), { available: '2000000.00', pending: '0.00' });
  assert.deepEqual(await bal(m, 'PT', 'pt-g'), { available: '0.00', pending: '0.00' });
  assert.deepEqual(await bal(m, 'GYM', 'gym-g'), { available: '0.00', pending: '0.00' });
  assert.equal(await escrow(m), '2000000.00');
  await m.reconcile.assertInvariant('unactivatable refund, with gym');
  assert.equal((await txnRow(m, c)).activationStatus, 'ACTIVATION_FAILED');
});

test('the same PT running ANOTHER contract: that contract\'s pending is untouched', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const other = await checkout(m, { id: 'c-other', pt: 'pt-shared', gym: 'gym-shared', price: 3_000_000 });
  responder = () => ({ status: 200, body: { success: true } });
  await gatewayConfirms(m, other);
  assert.equal((await txnRow(m, other)).activationStatus, 'ACTIVATED');
  const ptBefore = await bal(m, 'PT', 'pt-shared');
  const gymBefore = await bal(m, 'GYM', 'gym-shared');
  assert.equal(ptBefore.pending, '1650000.00');

  const dead = await checkout(m, { id: 'c-dead', pt: 'pt-shared', gym: 'gym-shared', price: 1_000_000 });
  responder = () => NOT_ACTIVATABLE('CANCELLED');
  await gatewayConfirms(m, dead);

  assert.deepEqual(await bal(m, 'PT', 'pt-shared'), ptBefore, 'PT: only the other contract\'s money is left, to the dong');
  assert.deepEqual(await bal(m, 'GYM', 'gym-shared'), gymBefore, 'gym: same');
  assert.deepEqual(await bal(m, 'CLIENT', dead.parties.clientUserId), { available: '1000000.00', pending: '0.00' });
  assert.deepEqual(await bal(m, 'CLIENT', other.parties.clientUserId), { available: '0.00', pending: '0.00' });
  assert.equal(await escrow(m), '4000000.00');
  await m.reconcile.assertInvariant('refund beside a running contract');
});

test('second, different payment for a contract already ACTIVE under another transaction: only the second is refunded', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const first = await checkout(m, { id: 'c-double', pt: 'pt-d', price: 1_000_000, client: 'client-double' });
  await gatewayConfirms(m, first);
  assert.equal((await txnRow(m, first)).activationStatus, 'ACTIVATED');

  const second = await checkout(m, { id: 'c-double', pt: 'pt-d', price: 1_000_000, client: 'client-double' });
  responder = () => NOT_ACTIVATABLE('ACTIVE');
  await gatewayConfirms(m, second);

  assert.equal((await txnRow(m, first)).activationStatus, 'ACTIVATED', 'the first payment is untouched');
  assert.equal((await txnRow(m, second)).activationStatus, 'ACTIVATION_FAILED');
  assert.deepEqual(await bal(m, 'CLIENT', 'client-double'), { available: '1000000.00', pending: '0.00' }, 'exactly one price refunded');
  assert.deepEqual(await bal(m, 'PT', 'pt-d'), { available: '0.00', pending: '900000.00' }, 'the first payment still backs the live contract');
  assert.equal(await escrow(m), '2000000.00');
  await m.reconcile.assertInvariant('second payment refunded');
});

// ── exactly once ────────────────────────────────────────────────────────────────────────────

test('duplicate webhook, a reconcile run and a replay of the refund: no second refund', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const c = await checkout(m, { id: 'c-dup', pt: 'pt-dup', price: 1_000_000 });
  responder = () => NOT_ACTIVATABLE('CANCELLED');

  // Event ids are unique per run: payment_webhook_events is not truncated between runs.
  const evt = `evt_${randomUUID()}`;
  await gatewayConfirms(m, c, evt);
  await gatewayConfirms(m, c, evt);                   // same provider event
  await gatewayConfirms(m, c, `evt_${randomUUID()}`); // a different delivery of the same payment
  await m.recon.runReconciliation();                  // sweep: nothing PENDING any more
  assert.equal(activateCalls(c).length, 1, 'later deliveries/sweeps never even re-ask user-service');

  // The refund itself, replayed directly (what a concurrent or crashed-then-retried caller does).
  const again = await m.ledger.refundUnactivatedContractPayment({
    transactionId: c.txnId,
    parties: c.parties,
    label: `PT_CONTRACT ${c.contractId}`,
    reason: 'CONTRACT_NOT_ACTIVATABLE',
    contractStatus: 'CANCELLED',
  });
  assert.equal(again.refunded, '1000000.00', 'a replay reports the original result');

  assert.deepEqual(await bal(m, 'CLIENT', c.parties.clientUserId), { available: '1000000.00', pending: '0.00' }, 'refunded exactly once');
  const ops = await m.prisma.ledgerOperation.findMany({ where: { key: `CONTRACT_UNACTIVATED_REFUND:${c.txnId}` } });
  assert.equal(ops.length, 1);
  await m.reconcile.assertInvariant('duplicate deliveries');
});

test('two payments for one contract are two refunds (key is per transaction, not per contract)', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const a = await checkout(m, { id: 'c-two', pt: 'pt-two', price: 500_000, client: 'client-two' });
  const b = await checkout(m, { id: 'c-two', pt: 'pt-two', price: 700_000, client: 'client-two' });
  responder = () => NOT_ACTIVATABLE('CANCELLED');
  await gatewayConfirms(m, a);
  await gatewayConfirms(m, b);
  assert.deepEqual(await bal(m, 'CLIENT', 'client-two'), { available: '1200000.00', pending: '0.00' });
  assert.equal(await escrow(m), '1200000.00');
  await m.reconcile.assertInvariant('two refunds');
});

// ── failure handling ────────────────────────────────────────────────────────────────────────

test('refund itself fails: nothing half-done, transaction stays PENDING, the reconcile sweep retries and refunds once', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const c = await checkout(m, { id: 'c-fail', pt: 'pt-fail', price: 1_000_000 });
  responder = () => NOT_ACTIVATABLE('CANCELLED');

  // Fail the SECOND wallet-locked operation of the webhook (the first is the settlement).
  const real = m.wallet.withWallets.bind(m.wallet);
  let n = 0;
  (m.wallet as any).withWallets = (...args: any[]) => {
    n++;
    if (n === 2) return Promise.reject(new Error('simulated ledger failure'));
    return (real as any)(...args);
  };
  try {
    await gatewayConfirms(m, c);
  } finally {
    (m.wallet as any).withWallets = real;
  }

  let t = await txnRow(m, c);
  assert.equal(t.status, 'PAID');
  assert.equal(t.activationStatus, 'PENDING', 'left for the sweep, not closed and not ACTIVATED');
  assert.equal((t.metadata as any).unactivatedRefund, undefined, 'no marker without a refund');
  assert.deepEqual(await bal(m, 'CLIENT', c.parties.clientUserId), { available: '0.00', pending: '0.00' }, 'no partial credit');
  assert.deepEqual(await bal(m, 'PT', 'pt-fail'), { available: '0.00', pending: '900000.00' }, 'money still in escrow bookkeeping, unharmed');
  await m.reconcile.assertInvariant('after failed refund');

  await m.recon.runReconciliation();

  t = await txnRow(m, c);
  assert.equal(t.activationStatus, 'ACTIVATION_FAILED');
  assert.ok((t.metadata as any).unactivatedRefund);
  assert.deepEqual(await bal(m, 'CLIENT', c.parties.clientUserId), { available: '1000000.00', pending: '0.00' });
  assert.deepEqual(await bal(m, 'PT', 'pt-fail'), { available: '0.00', pending: '0.00' });
  await m.reconcile.assertInvariant('after retried refund');

  await m.recon.runReconciliation();
  assert.deepEqual(await bal(m, 'CLIENT', c.parties.clientUserId), { available: '1000000.00', pending: '0.00' }, 'a further sweep refunds nothing more');
});

test('transport failure / 5xx from user-service: no refund, stays PENDING, a later success activates normally', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const c = await checkout(m, { id: 'c-5xx', pt: 'pt-5xx', price: 1_000_000 });

  responder = () => ({ status: 500, body: { success: false, error: { message: 'boom' } } });
  await gatewayConfirms(m, c);
  let t = await txnRow(m, c);
  assert.equal(t.activationStatus, 'PENDING');
  assert.deepEqual(await bal(m, 'CLIENT', c.parties.clientUserId), { available: '0.00', pending: '0.00' });

  responder = () => 'DROP';
  await m.recon.runReconciliation();
  t = await txnRow(m, c);
  assert.equal(t.activationStatus, 'PENDING');
  assert.equal(t.activationRetryCount, 1, 'the sweep counted the failed retry');
  assert.deepEqual(await bal(m, 'CLIENT', c.parties.clientUserId), { available: '0.00', pending: '0.00' });

  // A 409 with some OTHER code (e.g. a gateway in front answering conflict) is not the definite answer.
  responder = () => ({ status: 409, body: { success: false, error: { message: 'something else' } } });
  await m.recon.runReconciliation();
  t = await txnRow(m, c);
  assert.equal(t.activationStatus, 'PENDING');
  assert.deepEqual(await bal(m, 'CLIENT', c.parties.clientUserId), { available: '0.00', pending: '0.00' });

  responder = () => ({ status: 200, body: { success: true } });
  await m.recon.runReconciliation();
  t = await txnRow(m, c);
  assert.equal(t.activationStatus, 'ACTIVATED');
  assert.deepEqual(await bal(m, 'PT', 'pt-5xx'), { available: '0.00', pending: '900000.00' }, 'normal settlement intact');
  await m.reconcile.assertInvariant('5xx then success');
});

test('normal successful activation is unchanged', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const c = await checkout(m, { id: 'c-ok', pt: 'pt-ok', gym: 'gym-ok', price: 1_000_000 });
  await gatewayConfirms(m, c);
  const t = await txnRow(m, c);
  assert.equal(t.activationStatus, 'ACTIVATED');
  assert.equal((t.metadata as any).unactivatedRefund, undefined);
  assert.deepEqual(await bal(m, 'PT', 'pt-ok'), { available: '0.00', pending: '550000.00' });
  assert.deepEqual(await bal(m, 'GYM', 'gym-ok'), { available: '0.00', pending: '350000.00' });
  assert.deepEqual(await bal(m, 'CLIENT', c.parties.clientUserId), { available: '0.00', pending: '0.00' });
  await m.reconcile.assertInvariant('normal activation');
});

// ── the refund is real money the client can withdraw ────────────────────────────────────────

test('the refunded credit counts as withdrawable for the client', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const c = await checkout(m, { id: 'c-wd', pt: 'pt-wd', price: 1_000_000 });
  responder = () => NOT_ACTIVATABLE('REJECTED');
  await gatewayConfirms(m, c);
  const wallet = await m.wallet.getOrCreateWallet('CLIENT', c.parties.clientUserId);
  const refundSourced = await m.withdrawals.sumRefundSourcedCredits(wallet.id);
  assert.equal(refundSourced.toFixed(2), '1000000.00', 'the whole refund is withdrawable like any other refund');
  const entry = await m.prisma.walletLedgerEntry.findFirstOrThrow({ where: { walletId: wallet.id, entryType: 'CREDIT' } });
  assert.match(entry.description ?? '', /refund/i);
  assert.equal(entry.transactionId, c.txnId, 'traceable to the payment it returns');
});

// ── every other caller of the activate endpoint ─────────────────────────────────────────────

test('re-driving a PENDING transaction through activateOrRefund (reconcile, admin retry) handles the answer the same way', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const c = await checkout(m, { id: 'c-redrive', pt: 'pt-rd', price: 1_000_000 });
  // Settle the money but leave activation undone (user-service was down at webhook time).
  responder = () => ({ status: 503, body: {} });
  await gatewayConfirms(m, c);
  assert.equal((await txnRow(m, c)).activationStatus, 'PENDING');

  responder = () => NOT_ACTIVATABLE('CANCELLED');
  const outcome = await m.recon.activateOrRefund((await txnRow(m, c)));
  assert.equal(outcome, 'REFUNDED');
  assert.deepEqual(await bal(m, 'CLIENT', c.parties.clientUserId), { available: '1000000.00', pending: '0.00' });

  // An admin re-drive of the already-refunded transaction asks nobody and moves nothing.
  const before = activateCalls(c).length;
  responder = () => ({ status: 200, body: { success: true } });
  const again = await m.recon.activateOrRefund((await txnRow(m, c)));
  assert.equal(again, 'REFUNDED');
  assert.equal(activateCalls(c).length, before, 'a refunded payment is never activated afterwards');
  assert.equal((await txnRow(m, c)).activationStatus, 'ACTIVATION_FAILED');
  assert.deepEqual(await bal(m, 'CLIENT', c.parties.clientUserId), { available: '1000000.00', pending: '0.00' });
  await m.reconcile.assertInvariant('re-drive');
});
