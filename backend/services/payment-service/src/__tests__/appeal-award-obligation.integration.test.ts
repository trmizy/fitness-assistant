/**
 * E5 (Ngài, 05/11/2026) - the formal obligation after a won appeal: POST /internal/contracts/appeal-obligation (+ the read route).
 * Evidence label: BACKEND INTEGRATION (the real internal router + real database `*_test`). Hand-computed: a 1,000,000 contract, an established 250,000 owed by the PT -> ONE obligation
 * owed 250,000 / paid 0 / unpaid 250,000, OPEN, to the CLIENT, responsible PT; NO wallet, ledger entry or ledger operation changes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import express from 'express';
import { isTestDatabaseUrl } from './support/test-db-guard';

const skip = isTestDatabaseUrl(process.env.DATABASE_URL || '') ? false : 'Requires DATABASE_URL pointing at a *_test database.';
let server: http.Server;
let base = '';
const SECRET = process.env.INTERNAL_SERVICE_SECRET || 'dev_internal_service_secret_change_in_production';

test.before(async () => {
  if (skip) return;
  const { default: internalRoutes } = await import('../routes/internal.routes');
  const a = express();
  a.use(express.json());
  a.use('/internal', internalRoutes);
  server = http.createServer(a);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
});
test.after(async () => {
  if (skip) return;
  await new Promise<void>((r) => server.close(() => r()));
  const { prisma } = await import('../repositories/prisma');
  await prisma.$disconnect();
});

async function post(body: unknown, secret: string | null = SECRET) {
  const res = await fetch(`${base}/internal/contracts/appeal-obligation`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(secret ? { 'x-service-secret': secret } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json().catch(() => null)) as any };
}
async function fixture(over: { status?: string; amount?: number } = {}) {
  const { prisma } = await import('../repositories/prisma');
  const sfx = randomUUID();
  const contractId = `ct-${sfx}`;
  const txn = await prisma.paymentTransaction.create({
    data: { payerId: `c-${sfx}`, ptId: `p-${sfx}`, purpose: 'PT_CONTRACT', amount: over.amount ?? 1_000_000, status: (over.status ?? 'PAID') as any, provider: 'MOCK', idempotencyKey: `ao-${sfx}`, relatedEntityType: 'PT_CONTRACT', relatedEntityId: contractId } as any,
  });
  return { prisma, txn, contractId };
}
const req = (f: { txn: { id: string }; contractId: string }, over: Record<string, unknown> = {}) => ({
  transactionId: f.txn.id,
  contractId: f.contractId,
  consequenceId: randomUUID(),
  caseId: randomUUID(),
  appealId: randomUUID(),
  amount: '250000',
  responsibleParty: 'PT',
  decidedBy: 'admin-reviewer-1',
  reason: 'Kháng nghị được chấp nhận: PT vắng mặt, khách được hoàn một buổi',
  ...over,
});
async function moneyState(prisma: any) {
  return {
    wallets: (await prisma.wallet.aggregate({ _sum: { availableBalance: true, pendingBalance: true } }))._sum,
    entries: await prisma.walletLedgerEntry.count(),
    operations: await prisma.ledgerOperation.count(),
    receivables: await prisma.partnerReceivable.count(),
  };
}

test('E5: both established -> ONE obligation (owed 250,000, paid 0, unpaid 250,000, OPEN, owed to the CLIENT, responsible PT) + ONE append-only event; NO money moved; replay creates nothing', { skip }, async () => {
  const f = await fixture();
  const before = await moneyState(f.prisma);
  const body = req(f);
  const r = await post(body);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.deepEqual([r.body.data.created, r.body.data.status, r.body.data.owed, r.body.data.paid, r.body.data.unpaid, r.body.data.responsibleParty], [true, 'OPEN', '250000.00', '0.00', '250000.00', 'PT']);
  const row = await f.prisma.contractUnpaidObligation.findUniqueOrThrow({ where: { key: `APPEAL_OBLIGATION:${body.consequenceId}` } });
  assert.deepEqual([row.kind, row.party, row.status, row.sourceRef, row.contractRef], ['APPEAL_AWARD', 'CLIENT', 'OPEN', body.consequenceId, f.contractId]);
  const events = await f.prisma.contractUnpaidObligationEvent.findMany({ where: { obligationId: row.id } });
  assert.deepEqual(events.map((e: any) => [e.action, e.actor, e.approvalRef]), [['CREATE_FROM_APPEAL', 'admin-reviewer-1', body.consequenceId]]);
  assert.deepEqual(await moneyState(f.prisma), before, 'no wallet, ledger entry, operation or receivable changed');
  // replay: nothing new
  const again = await post(body);
  assert.deepEqual([again.status, again.body.data.created, again.body.data.obligationId], [200, false, r.body.data.obligationId]);
  assert.equal(await f.prisma.contractUnpaidObligation.count({ where: { sourceRef: body.consequenceId } }), 1);
  assert.equal(await f.prisma.contractUnpaidObligationEvent.count({ where: { obligationId: row.id } }), 1);
  // the same consequence with other terms is a conflict, never an overwrite
  for (const over of [{ amount: '300000' }, { responsibleParty: 'GYM' }]) {
    const c = await post({ ...body, ...over });
    assert.deepEqual([c.status, c.body.error.code], [409, 'IDEMPOTENCY_KEY_CONFLICT'], JSON.stringify(over));
  }
  const unchanged = await f.prisma.contractUnpaidObligation.findUniqueOrThrow({ where: { id: row.id } });
  assert.deepEqual([unchanged.owed.toFixed(2), unchanged.responsibleParty], ['250000.00', 'PT']);
  // the event table is append-only
  await assert.rejects(() => f.prisma.$executeRawUnsafe(`UPDATE contract_unpaid_obligation_events SET note = 'x' WHERE obligation_id = '${row.id}'`), /append-only/);
  // the read route
  const read = await fetch(`${base}/internal/contracts/appeal-obligation/${body.consequenceId}`, { headers: { 'x-service-secret': SECRET } });
  assert.deepEqual([(await read.json() as any).data.found, (await fetch(`${base}/internal/contracts/appeal-obligation/${randomUUID()}`, { headers: { 'x-service-secret': SECRET } }).then((x) => x.json() as any)).data.found], [true, false]);
});

test('E5: the contract\'s OWN context is enforced: another contract, an unpaid payment, an amount above what was paid -> refused, NOTHING created; malformed or extra fields -> 400; no service secret -> refused', { skip }, async () => {
  const f = await fixture();
  const other = await fixture();
  const cases: Array<[string, Record<string, unknown>, number, string]> = [
    ['another contract\'s payment', { transactionId: other.txn.id }, 422, 'CONTRACT_MISMATCH'],
    ['amount above the payment', { amount: '1000001' }, 422, 'AMOUNT_EXCEEDS_PAYMENT'],
  ];
  for (const [why, over, status, code] of cases) {
    const body = req(f, over);
    const r = await post(body);
    assert.deepEqual([r.status, r.body.error.code], [status, code], why);
    assert.equal(await f.prisma.contractUnpaidObligation.count({ where: { sourceRef: body.consequenceId } }), 0, why);
  }
  const unpaid = await fixture({ status: 'PENDING' });
  const ub = req(unpaid);
  assert.deepEqual([(await post(ub)).status], [409]);
  assert.equal(await f.prisma.contractUnpaidObligation.count({ where: { sourceRef: ub.consequenceId } }), 0);
  for (const bad of [{ amount: '0' }, { amount: '-5' }, { amount: '12.5' }, { amount: 'abc' }, { responsibleParty: 'CLIENT' }, { responsibleParty: 'someone' }, { extra: 1 }, { reason: 'short' }, { consequenceId: 'not-a-uuid' }]) {
    assert.equal((await post(req(f, bad))).status, 400, JSON.stringify(bad));
  }
  assert.ok([401, 403].includes((await post(req(f), null)).status), 'no service secret');
  assert.ok([401, 403].includes((await post(req(f), 'wrong')).status));
});
