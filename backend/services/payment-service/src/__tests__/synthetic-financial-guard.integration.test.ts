import { guardedTest as test } from './support/test-db-guard';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { prisma } from '../repositories/prisma';
import internalRoutes from '../routes/internal.routes';

/**
 * Seed-discovery Dot X — defense-in-depth SYNTHETIC guard in `payment-service`.
 * BACKEND INTEGRATION against isolated `*_test` database over real Express HTTP routes (`/internal/*`).
 * Verifies:
 *  1) Every money/ledger/checkout/withdrawal/personalized-service internal endpoint with `entityOrigin: 'SYNTHETIC'`
 *     fails closed with `409 SYNTHETIC_RECORD_NOT_TRANSACTABLE` and writes 0 rows anywhere.
 *  2) Legacy behavior is unchanged when `entityOrigin` is omitted vs `'REAL'`.
 */

const SECRET = process.env.INTERNAL_SERVICE_SECRET || 'dev_internal_service_secret_change_in_production';
const HEADERS = {
  'content-type': 'application/json',
  'x-service-secret': SECRET,
};

let server: http.Server | undefined;
let baseUrl = '';

async function startServer() {
  if (server) return;
  const app = express();
  app.use(express.json());
  app.use('/internal', internalRoutes);
  server = await new Promise<http.Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

test.after(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  await prisma.$disconnect();
});

async function callInternal(path: string, body: unknown) {
  await startServer();
  const res = await fetch(`${baseUrl}/internal${path}`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(body),
  });
  const json = await res.json();
  return { status: res.status, body: json as any };
}

async function financialRowCounts() {
  const [txns, wallets, ledger, withdrawals, ops, obligations, commissions, receivables] = await Promise.all([
    prisma.paymentTransaction.count(),
    prisma.wallet.count(),
    prisma.walletLedgerEntry.count(),
    prisma.withdrawalRequest.count(),
    prisma.ledgerOperation.count(),
    prisma.contractUnpaidObligation.count(),
    prisma.platformCommission.count(),
    prisma.partnerReceivable.count(),
  ]);
  return { txns, wallets, ledger, withdrawals, ops, obligations, commissions, receivables };
}

test('Dot X: every /internal money endpoint refuses entityOrigin=SYNTHETIC with 409 and writes zero rows', async () => {
  const before = await financialRowCounts();

  const u1 = randomUUID();
  const u2 = randomUUID();
  const gymId = randomUUID();
  const entityId = randomUUID();
  const txnId = randomUUID();
  const rates = { platformRate: '0.10', ptRate: '0.90', gymRate: '0.00' };
  const parties = { ptUserId: u1, gymId: null, clientUserId: u2 };

  const cases: Array<[string, Record<string, unknown>]> = [
    ['/payments/checkout', {
      purpose: 'PT_CONTRACT',
      relatedEntityType: 'PT_CONTRACT',
      relatedEntityId: entityId,
      amount: 500000,
      rates,
      parties,
      idempotencyKey: `chk:${entityId}`,
      initiatedBy: u2,
      sourceService: 'user-service',
      entityOrigin: 'SYNTHETIC',
    }],
    ['/payments/wallet-transfer', {
      payerOwnerType: 'CLIENT',
      payerOwnerId: u2,
      receiverOwnerType: 'PT',
      receiverOwnerId: u1,
      amount: 500000,
      purpose: 'PT_CONTRACT',
      relatedEntityType: 'PT_CONTRACT',
      relatedEntityId: entityId,
      idempotencyKey: `wt:${entityId}`,
      initiatedBy: u2,
      sourceService: 'user-service',
      entityOrigin: 'SYNTHETIC',
    }],
    [`/payments/${txnId}/refund`, {
      refundAmount: 100000,
      initiatedBy: randomUUID(),
      reason: 'synthetic guard test',
      idempotencyKey: `rf:${entityId}`,
      entityOrigin: 'SYNTHETIC',
    }],
    ['/contracts/release-session', {
      transactionId: txnId,
      price: '1000000',
      totalSessions: 10,
      rates,
      parties,
      label: 'Release session',
      idempotencyKey: `SESSION_RELEASE:${entityId}`,
      entityOrigin: 'SYNTHETIC',
    }],
    ['/contracts/no-show', {
      transactionId: txnId,
      price: '1000000',
      totalSessions: 10,
      rates,
      parties,
      label: 'No show',
      idempotencyKey: `PT_NO_SHOW:${entityId}`,
      entityOrigin: 'SYNTHETIC',
    }],
    ['/contracts/late-arrival', {
      transactionId: txnId,
      price: '1000000',
      totalSessions: 10,
      rates,
      parties,
      label: 'Late arrival',
      idempotencyKey: `PT_LATE_ARRIVAL:${entityId}`,
      entityOrigin: 'SYNTHETIC',
    }],
    ['/contracts/no-show-obligation', {
      transactionId: txnId,
      price: '1000000',
      totalSessions: 10,
      rates,
      parties,
      label: 'No show obligation',
      idempotencyKey: `PT_NO_SHOW:${entityId}`,
      reason: 'Recorded synthetic no-show check',
      entityOrigin: 'SYNTHETIC',
    }],
    ['/contracts/late-arrival-obligation', {
      transactionId: txnId,
      price: '1000000',
      totalSessions: 10,
      rates,
      parties,
      label: 'Late arrival obligation',
      idempotencyKey: `PT_LATE_ARRIVAL:${entityId}`,
      reason: 'Recorded synthetic late-arrival check',
      entityOrigin: 'SYNTHETIC',
    }],
    ['/contracts/late-open-state', {
      transactionId: txnId,
      lateKey: `PT_LATE_ARRIVAL:${entityId}`,
      parties,
      entityOrigin: 'SYNTHETIC',
    }],
    ['/contracts/terminate', {
      transactionId: txnId,
      price: '1000000',
      totalSessions: 10,
      usedSessions: 0,
      rates,
      reason: 'CLIENT_CANCELLED',
      alreadyReleased: { pt: '0', gym: '0', platform: '0' },
      parties,
      label: 'Terminate',
      idempotencyKey: `CONTRACT_TERMINATE:${entityId}`,
      entityOrigin: 'SYNTHETIC',
    }],
    ['/contracts/appeal-obligation', {
      transactionId: txnId,
      contractId: entityId,
      consequenceId: randomUUID(),
      caseId: randomUUID(),
      appealId: randomUUID(),
      amount: '100000',
      responsibleParty: 'PT',
      decidedBy: randomUUID(),
      reason: 'Appeal award synthetic check text',
      entityOrigin: 'SYNTHETIC',
    }],
    ['/contracts/resolve-unresolved-session', {
      transactionId: txnId,
      price: '1000000',
      totalSessions: 10,
      rates,
      parties,
      label: 'Resolve unresolved',
      idempotencyKey: `UNRESOLVED_SESSION:${entityId}`,
      outcome: 'DELIVERED',
      entityOrigin: 'SYNTHETIC',
    }],
    ['/contracts/release-holdback', {
      transactionId: txnId,
      parties,
      label: 'Release holdback',
      idempotencyKey: `HOLDBACK_RELEASE:${entityId}`,
      entityOrigin: 'SYNTHETIC',
    }],
    ['/contracts/money-breakdown', {
      price: '1000000',
      totalSessions: 10,
      usedSessions: 2,
      rates,
      entityOrigin: 'SYNTHETIC',
    }],
    ['/contracts/referral', {
      transactionId: txnId,
      gymId,
      ptUserId: u1,
      amount: '50000',
      label: 'Referral settle',
      idempotencyKey: `MEMBERSHIP_REFERRAL:${entityId}`,
      entityOrigin: 'SYNTHETIC',
    }],
    ['/contracts/referral/clawback', {
      transactionId: txnId,
      gymId,
      ptUserId: u1,
      amount: '25000',
      label: 'Referral clawback',
      idempotencyKey: `REFERRAL_CLAWBACK:${entityId}`,
      entityOrigin: 'SYNTHETIC',
    }],
    ['/contracts/membership-release', {
      transactionId: txnId,
      gymId,
      clientId: u2,
      membershipStatus: 'EXPIRED',
      label: 'Membership release',
      idempotencyKey: `MEMBERSHIP_RELEASE:${entityId}`,
      entityOrigin: 'SYNTHETIC',
    }],
    ['/contracts/membership-cancel-forfeit', {
      transactionId: txnId,
      gymId,
      clientId: u2,
      membershipStatus: 'CANCELLED',
      label: 'Membership forfeit',
      idempotencyKey: `MEMBERSHIP_RELEASE:${entityId}`,
      entityOrigin: 'SYNTHETIC',
    }],
    [`/withdrawals/gym/${gymId}`, {
      amount: '100000',
      payoutInfo: 'VCB 0123456789',
      entityOrigin: 'SYNTHETIC',
    }],
    ['/personalized-service/release', {
      transactionId: txnId,
      price: '500000',
      rates: { platformRate: '0.10', ptRate: '0.90' },
      parties: { ptUserId: u1, clientUserId: u2 },
      label: 'PS release',
      idempotencyKey: `PERSONALIZED_RELEASE:${entityId}`,
      entityOrigin: 'SYNTHETIC',
    }],
    ['/personalized-service/refund', {
      transactionId: txnId,
      refundAmount: '500000',
      rates: { platformRate: '0.10', ptRate: '0.90' },
      parties: { ptUserId: u1, clientUserId: u2 },
      label: 'PS refund',
      idempotencyKey: `PERSONALIZED_REFUND:${entityId}:500000`,
      entityOrigin: 'SYNTHETIC',
    }],
  ];

  for (const [path, body] of cases) {
    const res = await callInternal(path, body);
    assert.equal(res.status, 409, `${path} expected 409, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body?.error?.code, 'SYNTHETIC_RECORD_NOT_TRANSACTABLE', `${path} missing expected code`);
  }

  const after = await financialRowCounts();
  assert.deepEqual(after, before, 'financial tables must remain completely untouched');
});

test('Dot X: money-breakdown with entityOrigin=REAL matches legacy request omitting entityOrigin', async () => {
  const payload = {
    price: '1000000',
    totalSessions: 10,
    usedSessions: 2,
    rates: { platformRate: '0.10', ptRate: '0.90', gymRate: '0.00' },
  };
  const legacy = await callInternal('/contracts/money-breakdown', payload);
  const explicitReal = await callInternal('/contracts/money-breakdown', { ...payload, entityOrigin: 'REAL' });
  assert.equal(legacy.status, 200);
  assert.equal(explicitReal.status, 200);
  assert.deepEqual(explicitReal.body.data, legacy.body.data);
});
