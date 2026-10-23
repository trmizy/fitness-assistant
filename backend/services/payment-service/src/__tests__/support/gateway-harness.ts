/**
 * Shared scaffolding for the per-gateway callback tests (zalopay / payos / momo / vnpay-querydr).
 *
 * BACKEND INTEGRATION: the real Express webhook routes are served over real HTTP, backed by the isolated *_test
 * database, with the real ledger. The GATEWAY itself and the owning services (user/gym/ai activation endpoints) are a
 * local stub HTTP server - nothing here talks to a real payment gateway, so what is proven is OUR handling of
 * callbacks shaped like the gateway's documented ones, not the gateway's own behaviour.
 *
 * Provider modules read their credentials at import time, so each test file sets process.env BEFORE its first call to
 * `load()`; `load()` is the only thing that imports the application.
 */
import http from 'node:http';
import { randomUUID } from 'crypto';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { isTestDatabaseUrl } from './test-db-guard'; // D57-6-5 / D64: the database NAME must end with _test (the old /_test/i on the whole URL also matched the user name gymcoach_test)

export const databaseUrl = process.env.DATABASE_URL || '';
export const canUseIntegrationDb = isTestDatabaseUrl(databaseUrl);
export const skipOpts = { skip: canUseIntegrationDb ? false : 'Requires DATABASE_URL pointing at a *_test database.' };

export type Answer = { status: number; body: unknown };
export const calls: Array<{ path: string; method: string; body: any }> = [];

/** Answers for the stub. Reset by resetLedger(). */
export const stub = {
  /** user/gym/ai-service activation endpoints. */
  activation: ((_path: string): Answer => ({ status: 200, body: { success: true } })) as (path: string) => Answer,
  /** Gateway query/create endpoints, keyed by the path under the stub (e.g. '/zp/v2/query'). */
  gateway: ((_path: string, _body: any): Answer => ({ status: 200, body: {} })) as (path: string, body: any) => Answer,
};

const gatewayServer = http.createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const raw = Buffer.concat(chunks).toString('utf8');
    let body: any = {};
    if (raw) {
      try {
        body = JSON.parse(raw);
      } catch {
        body = Object.fromEntries(new URLSearchParams(raw));
      }
    }
    const url = req.url ?? '';
    calls.push({ path: url, method: req.method ?? 'GET', body });
    const isGateway = /^\/(zp|payos|momo|querydr)/.test(url);
    const answer = isGateway ? stub.gateway(url, body) : stub.activation(url);
    res.writeHead(answer.status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(answer.body));
  });
});

export const NOT_ACTIVATABLE = (currentStatus: string): Answer => ({
  status: 409,
  body: { success: false, error: { code: 'CONTRACT_NOT_ACTIVATABLE', message: `Contract cannot be activated (status ${currentStatus})`, currentStatus } },
});

export type Mods = {
  prisma: (typeof import('../../repositories/prisma'))['prisma'];
  webhook: typeof import('../../services/webhook.service');
  reconcile: typeof import('../../services/reconcile.service');
  paymentService: typeof import('../../services/payment.service');
  wallet: (typeof import('../../services/wallet.service'))['walletService'];
  txnRepo: (typeof import('../../repositories/transaction.repository'))['transactionRepository'];
  base: string;
  gw: string;
};
let mods: Mods | undefined;
let appServer: http.Server | undefined;

export async function load(): Promise<Mods> {
  if (mods) return mods;
  await new Promise<void>((resolve) => gatewayServer.listen(0, '127.0.0.1', resolve));
  const gw = `http://127.0.0.1:${(gatewayServer.address() as AddressInfo).port}`;
  process.env.USER_SERVICE_URL = gw;
  process.env.GYM_SERVICE_URL = gw;
  process.env.AI_SERVICE_URL = gw;
  process.env.VNPAY_API_URL = `${gw}/querydr`;
  process.env.ZALOPAY_ENDPOINT = `${gw}/zp`;
  process.env.PAYOS_BASE_URL = `${gw}/payos`;
  process.env.MOMO_ENDPOINT = `${gw}/momo/create`;
  delete process.env.USER_LAMBDA_NAME;
  delete process.env.GYM_LAMBDA_NAME;
  delete process.env.AI_LAMBDA_NAME;
  delete process.env.VNPAY_SIMULATE;

  const express = (await import('express')).default;
  const webhookRoutes = (await import('../../routes/webhook.routes')).default;
  const returnRoutes = (await import('../../routes/vnpay-return.routes')).default;
  const app = express();
  app.use('/payments/webhook', express.raw({ type: '*/*' }), webhookRoutes);
  app.use('/payments', returnRoutes);
  appServer = await new Promise<http.Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });

  mods = {
    prisma: (await import('../../repositories/prisma')).prisma,
    webhook: await import('../../services/webhook.service'),
    reconcile: await import('../../services/reconcile.service'),
    paymentService: await import('../../services/payment.service'),
    wallet: (await import('../../services/wallet.service')).walletService,
    txnRepo: (await import('../../repositories/transaction.repository')).transactionRepository,
    base: `http://127.0.0.1:${(appServer.address() as AddressInfo).port}`,
    gw,
  };
  return mods;
}

export async function shutdown() {
  appServer?.close();
  gatewayServer.close();
  if (mods) await mods.prisma.$disconnect();
}

export async function resetLedger(m: Mods) {
  await m.prisma.$executeRawUnsafe(
    'TRUNCATE wallet_ledger_entries, platform_commissions, partner_receivables, payment_transactions, payment_webhook_events, wallets, ledger_operations RESTART IDENTITY CASCADE',
  );
  calls.length = 0;
  stub.activation = () => ({ status: 200, body: { success: true } });
  stub.gateway = () => ({ status: 200, body: {} });
}

export type Purpose = 'PT_CONTRACT' | 'GYM_MEMBERSHIP' | 'PERSONALIZED_SERVICE_PURCHASE' | 'TRAINING_PACKAGE_PURCHASE' | 'WALLET_TOPUP';
export type Provider = 'VNPAY' | 'ZALOPAY' | 'PAYOS' | 'MOMO';

export interface Checkout {
  txnId: string;
  /** What the gateway calls this order (app_trans_id / orderCode / orderId / vnp_TxnRef). */
  ref: string;
  entityId: string;
  price: number;
  purpose: Purpose;
  provider: Provider;
  parties: { ptUserId: string; gymId: string | null; clientUserId: string };
}

/** A checkout the client has started: a PENDING transaction carrying the frozen rate/party snapshot. */
export async function checkout(
  m: Mods,
  provider: Provider,
  o: {
    purpose?: Purpose;
    price?: number;
    status?: 'PENDING' | 'FAILED' | 'CANCELLED' | 'REFUNDED';
    ref?: string;
    metadata?: Record<string, unknown>;
  } = {},
): Promise<Checkout> {
  const purpose = o.purpose ?? 'PT_CONTRACT';
  const price = o.price ?? 5_000_000;
  const id = randomUUID();
  const ref = o.ref ?? id;
  const entityId = `ent-${id.slice(0, 8)}`;
  const withGym = purpose === 'GYM_MEMBERSHIP';
  const parties = { ptUserId: `pt-${id.slice(0, 8)}`, gymId: withGym ? `gym-${id.slice(0, 8)}` : null, clientUserId: `client-${id.slice(0, 8)}` };
  const rates = withGym ? { platformRate: '0.10', ptRate: '0.55', gymRate: '0.35' } : { platformRate: '0.10', ptRate: '0.90', gymRate: '0' };

  if (purpose === 'WALLET_TOPUP') {
    const wallet = await m.wallet.getOrCreateWallet('CLIENT', parties.clientUserId);
    await m.prisma.paymentTransaction.create({
      data: {
        id, payerId: parties.clientUserId, purpose, amount: price, currency: 'VND', status: o.status ?? 'PENDING',
        provider, providerTransactionId: ref, idempotencyKey: `topup-${id}`,
        payerWalletId: wallet.id, receiverWalletId: wallet.id, relatedEntityType: 'WALLET_TOPUP',
        activationStatus: 'NOT_APPLICABLE', sourceService: 'integration-test', metadata: (o.metadata ?? {}) as any,
      },
    });
  } else {
    await m.prisma.paymentTransaction.create({
      data: {
        id, payerId: parties.clientUserId, purpose, amount: price, currency: 'VND', status: o.status ?? 'PENDING',
        provider, providerTransactionId: ref, idempotencyKey: `checkout-${id}`,
        relatedEntityType: purpose, relatedEntityId: entityId, activationStatus: 'PENDING', sourceService: 'integration-test',
        metadata: { rates, parties, platform: 'web', ...(o.metadata ?? {}) } as any,
      },
    });
  }
  return { txnId: id, ref, entityId, price, purpose, provider, parties };
}

export const txnRow = (m: Mods, c: Checkout) => m.prisma.paymentTransaction.findUniqueOrThrow({ where: { id: c.txnId } });
export const ledgerRows = (m: Mods, c: Checkout) => m.prisma.walletLedgerEntry.count({ where: { transactionId: c.txnId } });
export const activations = () => calls.filter((x) => x.path.endsWith('/activate') || x.path.endsWith('/activate-after-payment'));
export const discrepancy = async (m: Mods, c: Checkout) => ((await txnRow(m, c)).metadata as any)?.gatewayDiscrepancy;

/** Net escrow credit booked for THIS transaction (CREDIT - DEBIT on the escrow wallet), in whole VND. */
export async function escrowCredit(m: Mods, c: Checkout): Promise<bigint> {
  const escrow = await m.wallet.getEscrowWallet();
  const rows = await m.prisma.walletLedgerEntry.findMany({ where: { transactionId: c.txnId, walletId: escrow.id, bucket: 'AVAILABLE' } });
  return rows.reduce((sum, r) => sum + (r.entryType === 'CREDIT' ? 1n : -1n) * BigInt(r.amount.toFixed(0)), 0n);
}

export async function clientAvailable(m: Mods, c: Checkout): Promise<string> {
  const w = await m.wallet.getOrCreateWallet('CLIENT', c.parties.clientUserId);
  return (await m.prisma.wallet.findUniqueOrThrow({ where: { id: w.id } })).availableBalance.toFixed(2);
}

/** Every wallet's three buckets, for a before/after comparison of the whole ledger. */
export async function ledgerSnapshot(m: Mods): Promise<string> {
  const wallets = await m.prisma.wallet.findMany({ orderBy: [{ ownerType: 'asc' }, { ownerId: 'asc' }] });
  const entries = await m.prisma.walletLedgerEntry.count();
  return JSON.stringify({
    entries,
    wallets: wallets.map((w) => `${w.ownerType}:${w.ownerId}:${w.availableBalance.toFixed(2)}/${w.pendingBalance.toFixed(2)}/${w.lockedBalance.toFixed(2)}`),
  });
}

/** Nothing about the money moved for this transaction, and the global invariant still holds. */
export async function assertNothingMoved(m: Mods, c: Checkout, why: string) {
  assert.equal(await ledgerRows(m, c), 0, `${why}: no ledger entry may exist`);
  assert.equal(await escrowCredit(m, c), 0n, `${why}: escrow credit is zero`);
  assert.equal(activations().length, 0, `${why}: nothing may be activated`);
  await m.reconcile.assertInvariant(why);
}

/** A fixed expectation for what one settlement writes: escrow + pt + platform (+ gym). */
export const settlementRows = (purpose: Purpose) => (purpose === 'WALLET_TOPUP' ? 1 : purpose === 'GYM_MEMBERSHIP' ? 4 : 3);

export async function post(m: Mods, path: string, body: string | object, contentType = 'application/json'): Promise<{ status: number; json: any; text: string }> {
  const res = await fetch(`${m.base}${path}`, {
    method: 'POST',
    headers: { 'content-type': contentType },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* not JSON */
  }
  return { status: res.status, json, text };
}

/** Waits (polling the DB) until `predicate` is true - for MoMo, whose IPN is acknowledged before it is processed. */
export async function waitFor(predicate: () => Promise<boolean>, what: string, timeoutMs = 8000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, 40));
  }
  assert.fail(`timed out waiting for: ${what}`);
}

/** Counts error-level log lines the money code raises as an admin alert, while `fn` runs. */
export async function captureAlerts<T>(fn: () => Promise<T>): Promise<{ result: T; alerts: number; warns: number }> {
  const { logger } = await import('@gym-coach/shared');
  const origError = logger.error.bind(logger);
  const origWarn = logger.warn.bind(logger);
  let alerts = 0;
  let warns = 0;
  const isGatewayAmount = (a: unknown[]) => JSON.stringify(a[0] ?? '').includes('[GatewayAmount]');
  (logger as any).error = (...a: unknown[]) => {
    if (isGatewayAmount(a)) alerts += 1;
    return (origError as any)(...a);
  };
  (logger as any).warn = (...a: unknown[]) => {
    if (isGatewayAmount(a)) warns += 1;
    return (origWarn as any)(...a);
  };
  try {
    const result = await fn();
    return { result, alerts, warns };
  } finally {
    (logger as any).error = origError;
    (logger as any).warn = origWarn;
  }
}
