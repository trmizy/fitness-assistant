/**
 * FH-5 / R2 - a client who cancels a personalized-service order or a gym membership while at the bank's page and
 * then pays gets the WHOLE payment back to the wallet, once.
 *
 * Before: payment-service moved the price into escrow + partner PENDING, asked ai-service / gym-service to activate,
 * both answered 2xx for a CANCELLED target, and the transaction was marked ACTIVATED with the money stuck. Now the
 * owning services answer 409 { error: { code: 'NOT_ACTIVATABLE' } } (ai-service / gym-service tests pin their side of
 * that wire shape against their real databases) and activateOrRefund generalises the PT-contract refund.
 *
 * Here the owning services are local HTTP servers (postServiceJson reads AI_SERVICE_URL / GYM_SERVICE_URL per call),
 * so handleEvent -> settlePurchase -> callActivateEndpoint (axios) -> refund -> ledger all run for real against
 * the isolated test database.
 *
 * BACKEND INTEGRATION. Run THIS FILE ALONE (it TRUNCATEs the shared ledger tables):
 *   DATABASE_URL="postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_payment_fhc_test?schema=public" \
 *   FITNESS_DISABLE_REDIS=true ./node_modules/.bin/tsx --test src/__tests__/fh5-cancelled-target-refund.integration.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'crypto';
import type { AddressInfo } from 'node:net';
import { isTestDatabaseUrl } from './support/test-db-guard';

const canUseIntegrationDb = isTestDatabaseUrl(process.env.DATABASE_URL || '');
const skipOpts = { skip: canUseIntegrationDb ? false : 'Requires DATABASE_URL pointing at a *_test database.' };

type Answer = { status: number; body: unknown } | 'DROP';
const calls: Array<{ path: string; body: any }> = [];
let responder: (path: string, body: any) => Answer = () => ({ status: 200, body: { success: true } });

const NOT_ACTIVATABLE = (currentStatus: string, code = 'NOT_ACTIVATABLE'): Answer => ({
  status: 409,
  body: { success: false, error: { code, message: `cannot be activated (status ${currentStatus})`, currentStatus } },
});

const server = http.createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
    calls.push({ path: req.url ?? '', body });
    const answer = responder(req.url ?? '', body);
    if (answer === 'DROP') return void req.socket.destroy();
    res.writeHead(answer.status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(answer.body));
  });
});
let serverReady: Promise<void> | undefined;
function startServer(): Promise<void> {
  serverReady ??= new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      process.env.AI_SERVICE_URL = url;
      process.env.GYM_SERVICE_URL = url;
      process.env.USER_SERVICE_URL = url;
      delete process.env.AI_LAMBDA_NAME;
      delete process.env.GYM_LAMBDA_NAME;
      delete process.env.USER_LAMBDA_NAME;
      resolve();
    });
  });
  return serverReady;
}

type Mods = {
  prisma: (typeof import('../repositories/prisma'))['prisma'];
  webhook: typeof import('../services/webhook.service');
  recon: typeof import('../services/reconciliation.service');
  reconcile: typeof import('../services/reconcile.service');
  wallet: (typeof import('../services/wallet.service'))['walletService'];
  query: typeof import('../services/activated-but-cancelled-target.query');
};
let mods: Mods | undefined;
async function load(): Promise<Mods> {
  await startServer();
  if (!mods) {
    mods = {
      prisma: (await import('../repositories/prisma')).prisma,
      webhook: await import('../services/webhook.service'),
      recon: await import('../services/reconciliation.service'),
      reconcile: await import('../services/reconcile.service'),
      wallet: (await import('../services/wallet.service')).walletService,
      query: await import('../services/activated-but-cancelled-target.query'),
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

type Product = 'PERSONALIZED_SERVICE_PURCHASE' | 'GYM_MEMBERSHIP';
const PRODUCTS: Product[] = ['PERSONALIZED_SERVICE_PURCHASE', 'GYM_MEMBERSHIP'];

interface Checkout {
  product: Product;
  entityId: string;
  txnId: string;
  providerTxnId: string;
  price: number;
  client: string;
  partner: string; // seller (personalized) / gym id (membership)
}

/** A checkout the client has started, with the SAME frozen rate/party shape ai-service / gym-service send. */
async function checkout(m: Mods, product: Product, o: { id: string; partner: string; price?: number; client?: string }): Promise<Checkout> {
  const price = o.price ?? 500_000;
  const client = o.client ?? `client-${o.id}`;
  const providerTxnId = `vnpay_${randomUUID()}`;
  const isGym = product === 'GYM_MEMBERSHIP';
  const rates = isGym
    ? { platformRate: '0.1000', ptRate: '0', gymRate: '0.9000' }
    : { platformRate: '0.1000', ptRate: '0.9000', gymRate: '0' };
  const parties = isGym
    ? { ptUserId: o.partner, gymId: o.partner, clientUserId: client }
    : { ptUserId: o.partner, gymId: null, clientUserId: client };
  const txn = await m.prisma.paymentTransaction.create({
    data: {
      payerId: client,
      purpose: product,
      amount: price,
      currency: 'VND',
      status: 'PENDING',
      provider: 'VNPAY',
      providerTransactionId: providerTxnId,
      idempotencyKey: `checkout-${o.id}-${randomUUID()}`,
      relatedEntityType: product,
      relatedEntityId: o.id,
      activationStatus: 'PENDING',
      sourceService: 'integration-test',
      metadata: { rates, parties },
    },
  });
  return { product, entityId: o.id, txnId: txn.id, providerTxnId, price, client, partner: o.partner };
}

async function gatewayConfirms(m: Mods, c: Checkout, eventId = `evt_${randomUUID()}`) {
  await m.webhook.handleEvent({
    provider: 'VNPAY',
    providerEventId: eventId,
    providerTransactionId: c.providerTxnId,
    payload: {},
    status: 'PAID',
    paidAmountVnd: String(c.price),
  });
}

const txnRow = (m: Mods, c: Checkout) => m.prisma.paymentTransaction.findUniqueOrThrow({ where: { id: c.txnId } });

async function bal(m: Mods, type: 'CLIENT' | 'PT' | 'GYM' | 'PLATFORM', id: string) {
  const w = await m.wallet.getOrCreateWallet(type, id);
  const fresh = await m.prisma.wallet.findUniqueOrThrow({ where: { id: w.id } });
  return { available: fresh.availableBalance.toFixed(2), pending: fresh.pendingBalance.toFixed(2) };
}
async function escrow(m: Mods) {
  const w = await m.wallet.getEscrowWallet();
  return (await m.prisma.wallet.findUniqueOrThrow({ where: { id: w.id } })).availableBalance.toFixed(2);
}
async function revenue(m: Mods) {
  const w = await m.wallet.getRevenueWallet();
  const fresh = await m.prisma.wallet.findUniqueOrThrow({ where: { id: w.id } });
  return { available: fresh.availableBalance.toFixed(2), pending: fresh.pendingBalance.toFixed(2) };
}
const activatePath = (c: Checkout) =>
  c.product === 'GYM_MEMBERSHIP'
    ? `/internal/gym-memberships/${c.entityId}/activate`
    : `/internal/personalized-service/orders/${c.entityId}/activate-after-payment`;
const activateCalls = (c: Checkout) => calls.filter((x) => x.path === activatePath(c));
const refundKey = (c: Checkout) => `CONTRACT_UNACTIVATED_REFUND:${c.txnId}`;

async function assertPartnersHoldNothing(m: Mods, c: Checkout) {
  assert.deepEqual(await bal(m, 'PT', c.partner), { available: '0.00', pending: '0.00' }, 'partner PT wallet: nothing');
  if (c.product === 'GYM_MEMBERSHIP') assert.deepEqual(await bal(m, 'GYM', c.partner), { available: '0.00', pending: '0.00' }, 'gym wallet: nothing');
  assert.deepEqual(await revenue(m), { available: '0.00', pending: '0.00' }, 'platform keeps no cut of a refunded payment');
}

for (const product of PRODUCTS) {
  test(`${product}: cancelled then paid -> client wallet credited the full price once, partner pending not credited, escrow balanced`, skipOpts, async () => {
    const m = await load();
    await resetLedger(m);
    const c = await checkout(m, product, { id: 'target-1', partner: 'partner-1', price: 500_000 });
    responder = () => NOT_ACTIVATABLE('CANCELLED');

    await gatewayConfirms(m, c);

    assert.equal(activateCalls(c).length, 1, 'owning service asked exactly once');
    assert.deepEqual(await bal(m, 'CLIENT', c.client), { available: '500000.00', pending: '0.00' }, 'client holds the full price');
    await assertPartnersHoldNothing(m, c);
    assert.equal(await escrow(m), '500000.00', 'cash still held; the claim on it moved to the client');
    await m.reconcile.assertInvariant(`${product} cancel-then-pay`);

    const t = await txnRow(m, c);
    assert.equal(t.status, 'PAID', 'the gateway did capture the money');
    assert.equal(t.activationStatus, 'ACTIVATION_FAILED', 'NOT ACTIVATED, closed for the sweep, visible to an admin');
    const note = (t.metadata as any).unactivatedRefund;
    assert.equal(note.reason, 'NOT_ACTIVATABLE');
    assert.equal(note.contractStatus, 'CANCELLED');
    assert.equal(note.amount, '500000.00');
    assert.equal(note.idempotencyKey, refundKey(c));
    assert.ok((t.metadata as any).rates && (t.metadata as any).parties, 'frozen snapshot preserved');
    const ops = await m.prisma.ledgerOperation.findMany({ where: { key: refundKey(c) } });
    assert.equal(ops.length, 1);
  });

  test(`${product}: normal payment -> activation unchanged (partner pending credited, no refund)`, skipOpts, async () => {
    const m = await load();
    await resetLedger(m);
    const c = await checkout(m, product, { id: 'target-ok', partner: 'partner-ok', price: 1_000_000 });
    await gatewayConfirms(m, c);
    const t = await txnRow(m, c);
    assert.equal(t.activationStatus, 'ACTIVATED');
    assert.equal((t.metadata as any).unactivatedRefund, undefined);
    assert.deepEqual(await bal(m, 'CLIENT', c.client), { available: '0.00', pending: '0.00' });
    if (product === 'GYM_MEMBERSHIP') assert.deepEqual(await bal(m, 'GYM', 'partner-ok'), { available: '0.00', pending: '900000.00' });
    else assert.deepEqual(await bal(m, 'PT', 'partner-ok'), { available: '0.00', pending: '900000.00' });
    assert.deepEqual(await revenue(m), { available: '0.00', pending: '100000.00' });
    await m.reconcile.assertInvariant(`${product} normal`);
  });

  test(`${product}: retried callbacks / sweep / direct replay of the same transaction -> no second refund`, skipOpts, async () => {
    const m = await load();
    await resetLedger(m);
    const c = await checkout(m, product, { id: 'target-dup', partner: 'partner-dup' });
    responder = () => NOT_ACTIVATABLE('CANCELLED');
    const evt = `evt_${randomUUID()}`;
    await gatewayConfirms(m, c, evt);
    await gatewayConfirms(m, c, evt);
    await gatewayConfirms(m, c, `evt_${randomUUID()}`);
    await m.recon.runReconciliation();
    // An admin re-drive of the closed row asks nobody and moves nothing.
    assert.equal(await m.recon.activateOrRefund(await txnRow(m, c)), 'REFUNDED');
    assert.equal(activateCalls(c).length, 1, 'later deliveries never re-ask the owning service');
    assert.deepEqual(await bal(m, 'CLIENT', c.client), { available: '500000.00', pending: '0.00' }, 'refunded exactly once');
    assert.equal((await m.prisma.ledgerOperation.findMany({ where: { key: refundKey(c) } })).length, 1);
    await m.reconcile.assertInvariant(`${product} duplicates`);
  });

  test(`${product}: concurrent callbacks for the same cancelled target -> exactly one refund`, skipOpts, async () => {
    const m = await load();
    await resetLedger(m);
    const c = await checkout(m, product, { id: 'target-race', partner: 'partner-race' });
    responder = () => NOT_ACTIVATABLE('CANCELLED');
    await Promise.allSettled([gatewayConfirms(m, c), gatewayConfirms(m, c), gatewayConfirms(m, c)]);
    // Whatever a loser threw, the sweep converges and must not refund again.
    await m.recon.runReconciliation();
    assert.deepEqual(await bal(m, 'CLIENT', c.client), { available: '500000.00', pending: '0.00' }, 'one refund, not two or three');
    await assertPartnersHoldNothing(m, c);
    assert.equal((await m.prisma.ledgerOperation.findMany({ where: { key: refundKey(c) } })).length, 1);
    assert.equal((await txnRow(m, c)).activationStatus, 'ACTIVATION_FAILED');
    assert.equal(await escrow(m), '500000.00');
    await m.reconcile.assertInvariant(`${product} concurrent`);
  });

  test(`${product}: network error / 5xx / 404 / foreign 409 from the owning service -> NO refund, stays PENDING; a later 409 NOT_ACTIVATABLE refunds`, skipOpts, async () => {
    const m = await load();
    await resetLedger(m);
    const c = await checkout(m, product, { id: 'target-net', partner: 'partner-net' });
    const unchanged = async (label: string) => {
      const t = await txnRow(m, c);
      assert.equal(t.activationStatus, 'PENDING', label);
      assert.deepEqual(await bal(m, 'CLIENT', c.client), { available: '0.00', pending: '0.00' }, `${label}: no refund`);
    };

    responder = () => 'DROP';
    await gatewayConfirms(m, c);
    await unchanged('connection dropped');

    responder = () => ({ status: 500, body: { success: false, error: { message: 'boom' } } });
    await m.recon.runReconciliation();
    await unchanged('5xx');

    responder = () => ({ status: 404, body: { success: false, error: { message: 'not found' } } });
    await m.recon.runReconciliation();
    await unchanged('404');

    // A 409 with another code (or the PT-contract code, which these products never use) is not the definite answer.
    responder = () => NOT_ACTIVATABLE('X', 'SOMETHING_ELSE');
    await m.recon.runReconciliation();
    await unchanged('409 other code');
    responder = () => NOT_ACTIVATABLE('CANCELLED', 'CONTRACT_NOT_ACTIVATABLE');
    await m.recon.runReconciliation();
    await unchanged('409 contract code');
    assert.equal((await txnRow(m, c)).activationRetryCount >= 4, true, 'sweep counted the failed retries');
    await m.reconcile.assertInvariant(`${product} before definite answer`);

    responder = () => NOT_ACTIVATABLE('CANCELLED');
    await m.recon.runReconciliation();
    assert.equal((await txnRow(m, c)).activationStatus, 'ACTIVATION_FAILED');
    assert.deepEqual(await bal(m, 'CLIENT', c.client), { available: '500000.00', pending: '0.00' });
    await m.reconcile.assertInvariant(`${product} after definite answer`);
  });

  test(`${product}: refund itself fails -> nothing half-done, stays PENDING, the sweep retries and refunds once`, skipOpts, async () => {
    const m = await load();
    await resetLedger(m);
    const c = await checkout(m, product, { id: 'target-rfail', partner: 'partner-rfail' });
    responder = () => NOT_ACTIVATABLE('CANCELLED');
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
    assert.equal((await txnRow(m, c)).activationStatus, 'PENDING');
    assert.deepEqual(await bal(m, 'CLIENT', c.client), { available: '0.00', pending: '0.00' }, 'no partial credit');
    await m.recon.runReconciliation();
    await m.recon.runReconciliation();
    assert.deepEqual(await bal(m, 'CLIENT', c.client), { available: '500000.00', pending: '0.00' });
    await m.reconcile.assertInvariant(`${product} refund retried`);
  });
}

test('other transactions of the same partner are untouched by a refund (per-transaction, never the pooled bucket)', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  const live = await checkout(m, 'PERSONALIZED_SERVICE_PURCHASE', { id: 'live', partner: 'pt-shared', price: 1_000_000 });
  await gatewayConfirms(m, live);
  const before = await bal(m, 'PT', 'pt-shared');
  assert.equal(before.pending, '900000.00');
  const dead = await checkout(m, 'PERSONALIZED_SERVICE_PURCHASE', { id: 'dead', partner: 'pt-shared', price: 400_000 });
  responder = () => NOT_ACTIVATABLE('CANCELLED');
  await gatewayConfirms(m, dead);
  assert.deepEqual(await bal(m, 'PT', 'pt-shared'), before, 'the live order keeps exactly its own pending');
  assert.deepEqual(await bal(m, 'CLIENT', dead.client), { available: '400000.00', pending: '0.00' });
  assert.deepEqual(await bal(m, 'CLIENT', live.client), { available: '0.00', pending: '0.00' });
  await m.reconcile.assertInvariant('refund beside a live order');
});

// ── historic rows: ACTIVATED + target CANCELLED (read-only detection, no auto-fix) ───────────

test('historic rows: ACTIVATED transaction whose target is CANCELLED is DETECTED (read-only), nothing is repaired', skipOpts, async () => {
  const m = await load();
  await resetLedger(m);
  // The pre-FH-5 defect, reproduced by an owning service that (wrongly) answered 200 for a cancelled target.
  const stuckP = await checkout(m, 'PERSONALIZED_SERVICE_PURCHASE', { id: 'hist-order', partner: 'pt-h', price: 500_000 });
  const stuckG = await checkout(m, 'GYM_MEMBERSHIP', { id: 'hist-mem', partner: 'gym-h', price: 700_000 });
  // Controls: healthy target, unknown target, cancelled target whose client was already refunded.
  const healthy = await checkout(m, 'GYM_MEMBERSHIP', { id: 'hist-healthy', partner: 'gym-h2', price: 300_000 });
  const unknown = await checkout(m, 'PERSONALIZED_SERVICE_PURCHASE', { id: 'hist-unknown', partner: 'pt-u', price: 300_000 });
  const refunded = await checkout(m, 'PERSONALIZED_SERVICE_PURCHASE', { id: 'hist-refunded', partner: 'pt-r', price: 200_000 });
  const all = [stuckP, stuckG, healthy, unknown, refunded];
  for (const c of all) await gatewayConfirms(m, c); // 200 -> ACTIVATED
  for (const c of all) assert.equal((await txnRow(m, c)).activationStatus, 'ACTIVATED');
  // `refunded`: the paid-cancel path (refund through the ledger) - the client got the money back.
  {
    const w = await m.wallet.getOrCreateWallet('CLIENT', refunded.client);
    const pt = await m.wallet.getOrCreateWallet('PT', 'pt-r');
    await m.prisma.walletLedgerEntry.create({ data: { walletId: pt.id, transactionId: refunded.txnId, entryType: 'DEBIT', bucket: 'PENDING', amount: 180_000, balanceBefore: 180_000, balanceAfter: 0, description: 'pending reversed (refund)' } });
    await m.prisma.walletLedgerEntry.create({ data: { walletId: w.id, transactionId: refunded.txnId, entryType: 'CREDIT', bucket: 'AVAILABLE', amount: 200_000, balanceBefore: 0, balanceAfter: 200_000, description: 'order cancelled - refund' } });
  }

  const snapshot = async () =>
    JSON.stringify([
      await m.prisma.wallet.findMany({ orderBy: { id: 'asc' } }),
      await m.prisma.paymentTransaction.findMany({ orderBy: { id: 'asc' }, select: { id: true, status: true, activationStatus: true } }),
      await m.prisma.walletLedgerEntry.count(),
    ]);
  const before = await snapshot();

  const status: Record<string, string | null> = {
    'hist-order': 'CANCELLED',
    'hist-mem': 'CANCELLED',
    'hist-healthy': 'ACTIVE',
    'hist-unknown': null,
    'hist-refunded': 'CANCELLED',
  };
  const rows = await m.query.findActivatedButCancelledTargets(async (t) => status[t.relatedEntityId]);

  assert.deepEqual(rows.map((r) => r.relatedEntityId).sort(), ['hist-mem', 'hist-order']);
  const p = rows.find((r) => r.relatedEntityId === 'hist-order')!;
  assert.equal(p.transactionId, stuckP.txnId);
  assert.equal(p.targetStatus, 'CANCELLED');
  assert.equal(p.amount, '500000.00');
  assert.equal(p.partnerPendingRemaining, '500000.00');
  assert.equal(p.clientRefundCredited, '0.00');
  assert.equal(rows.find((r) => r.relatedEntityId === 'hist-mem')!.partnerPendingRemaining, '700000.00');

  // A throwing lookup means "unknown": skipped, never listed, never an exception.
  assert.deepEqual(await m.query.findActivatedButCancelledTargets(async () => { throw new Error('service down'); }), []);
  assert.equal(await snapshot(), before, 'read-only: no wallet, transaction or ledger row changed');
});
