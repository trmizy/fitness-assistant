/**
 * D77 OPEN late-arrival obligation (L) - THE PAYMENT-SIDE HARD BOUNDARY. BACKEND INTEGRATION on the real ledger (and its real internal HTTP routes) in an isolated *_test database.
 *
 * Fact under test: `settleLateOpen` (contract-ledger.service.ts) is the ONLY place past which OPEN L money moves. A body boolean `settleLateOpen: true` is not enough: the ledger also asks its own
 * fail-closed switch (services/late-open-settlement-flag.ts: DISPUTE_CASE_LATE_OPEN_RECONCILIATION_ENABLED === "true" AND NODE_ENV === "test" AND DATABASE_URL names a *_test database).
 * Refused with the SAME code the callers already park on: 409 LATE_OPEN_FLAG_REQUIRED, nothing written.
 *
 * Numbers (hand computed, as the neighbours): 1.000.000 / 4 sessions: V = 250.000 per session, L = half a session = 125.000. No gym: PT 90% / platform 10%.
 *   L paid to the client out of the session's own money  -> client 125.000, PT 112.500, platform 12.500, pending 750.000 (the 3 other sessions).
 *   an ordinary release                                  -> PT 225.000 / platform 25.000 for the session.
 *
 *   G1  flag OFF + OPEN L + settleLateOpen:true: release / no-show are refused, repeated with the SAME key (replay) they are refused again - no ledger operation, no wallet entry, no event, the obligation stays OPEN
 *   G2  CONTROL (so G1 can fail): the same scenario with the flag ON pays L (PAID_VIA_LEDGER, one SETTLE_VIA_LEDGER event) - exact money above
 *   G3  flag OFF does NOT block the ordinary money: L paid in cash (SETTLED), L WAIVED, L already PAID_VIA_LEDGER, no L at all - the normal V-L / V is released
 *   G4  bypass through the REAL internal HTTP routes: release-session, no-show and resolve-unresolved-session with a body settleLateOpen:true and the flag OFF -> 409 LATE_OPEN_FLAG_REQUIRED, nothing written;
 *       the same requests with the flag ON pay (control)
 *   G5  NODE_ENV !== "test" and a DATABASE_URL that does not name a *_test database make the boundary refuse even with the value "true" (through the real ledger); unit table of the function
 *
 * Run THIS FILE ALONE (it TRUNCATEs the ledger tables):
 *   DATABASE_URL="postgresql://<user>:<password>@localhost:55433/gymcoach_payment_<x>_test?schema=public" FITNESS_DISABLE_REDIS=true \
 *     ./node_modules/.bin/tsx --test --test-concurrency=1 src/__tests__/fh-late-open-settle-flag-guard.integration.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { isTestDatabaseUrl } from './support/test-db-guard';

const FLAG = 'DISPUTE_CASE_LATE_OPEN_RECONCILIATION_ENABLED';
const SECRET = process.env.INTERNAL_SERVICE_SECRET || 'dev_internal_service_secret_change_in_production';
const databaseUrl = process.env.DATABASE_URL || '';
const skipOpts = { skip: isTestDatabaseUrl(databaseUrl) ? false : 'Requires DATABASE_URL pointing at a *_test database.' };

process.env.NODE_ENV = 'test';
const flagOn = () => {
  process.env[FLAG] = 'true';
};
const flagOff = () => {
  delete process.env[FLAG];
};
flagOff();

type Mods = {
  prisma: (typeof import('../repositories/prisma'))['prisma'];
  Prisma: (typeof import('../generated/prisma'))['Prisma'];
  ledger: typeof import('../services/contract-ledger.service');
  reconcile: typeof import('../services/reconcile.service');
  wallet: (typeof import('../services/wallet.service'))['walletService'];
  flag: typeof import('../services/late-open-settlement-flag');
};
let mods: Mods | undefined;
async function load(): Promise<Mods> {
  if (!mods) {
    mods = {
      prisma: (await import('../repositories/prisma')).prisma,
      Prisma: (await import('../generated/prisma')).Prisma,
      ledger: await import('../services/contract-ledger.service'),
      reconcile: await import('../services/reconcile.service'),
      wallet: (await import('../services/wallet.service')).walletService,
      flag: await import('../services/late-open-settlement-flag'),
    };
  }
  return mods;
}
test.after(async () => {
  flagOff();
  if (mods) await mods.prisma.$disconnect();
});
test.beforeEach(() => {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = databaseUrl;
  flagOff();
});

type Dec = InstanceType<Mods['Prisma']['Decimal']>;
type Rates = import('../services/contract-money').RateTable;
type OwnerType = 'CLIENT' | 'PT' | 'GYM' | 'PLATFORM';

async function reset(m: Mods) {
  await m.prisma.$executeRawUnsafe(
    'TRUNCATE wallet_ledger_entries, platform_commissions, partner_receivables, payment_transactions, wallets, ledger_operations, contract_unpaid_obligations RESTART IDENTITY CASCADE',
  );
}

interface Contract {
  id: string;
  txnId: string;
  parties: { ptUserId: string; gymId: string | null; clientUserId: string };
  price: Dec;
  total: number;
  rates: Rates;
}

async function paidContract(m: Mods, id: string): Promise<Contract> {
  const D = (v: string) => new m.Prisma.Decimal(v);
  const clientUserId = `client-${id}`;
  const parties = { ptUserId: 'pt-lo', gymId: null, clientUserId };
  const rates: Rates = { platformRate: D('0.10'), ptRate: D('0.90'), gymRate: D('0') };
  const price = 1_000_000;
  const txn = await m.prisma.paymentTransaction.create({
    data: {
      payerId: clientUserId, purpose: 'PT_CONTRACT', amount: price, currency: 'VND', status: 'PENDING', provider: 'VNPAY',
      providerTransactionId: `vnpay_${randomUUID()}`, idempotencyKey: `checkout-${id}-${randomUUID()}`, relatedEntityType: 'PT_CONTRACT',
      relatedEntityId: id, activationStatus: 'PENDING', sourceService: 'integration-test',
    },
  });
  const c: Contract = { id, txnId: txn.id, parties, price: D(String(price)), total: 4, rates };
  await m.ledger.settleContractPayment({ transactionId: c.txnId, price: c.price, rates: c.rates, parties: c.parties, label: `PT_CONTRACT ${id}` });
  return c;
}

const base = (c: Contract) => ({ transactionId: c.txnId, price: c.price, totalSessions: c.total, rates: c.rates, parties: c.parties });
const late = (m: Mods, c: Contract, s: string) => m.ledger.compensateLateArrival({ ...base(c), label: `late ${s}`, idempotencyKey: `PT_LATE_ARRIVAL:${c.id}:${s}` });
const recordLate = (m: Mods, c: Contract, s: string) =>
  m.ledger.recordLateArrivalObligation({ ...base(c), label: `late ${s}`, idempotencyKey: `PT_LATE_ARRIVAL:${c.id}:${s}`, reason: 'ending: D77 never performed' });
const noShow = (m: Mods, c: Contract, s: string, flag = true) =>
  m.ledger.compensateNoShow({ ...base(c), label: `no-show ${s}`, idempotencyKey: `PT_NO_SHOW:${c.id}:${s}`, settleLateOpen: flag });
const release = (m: Mods, c: Contract, s: string, flag = true) =>
  m.ledger.releaseSession({ ...base(c), label: `session ${s}`, idempotencyKey: `SESSION_RELEASE:${c.id}:${s}`, settleLateOpen: flag });
const lkey = (c: Contract, s: string) => `PT_LATE_ARRIVAL:${c.id}:${s}`;

async function wallet(m: Mods, t: OwnerType, id: string) {
  const w = await m.wallet.getOrCreateWallet(t, id);
  return { pending: Number(w.pendingBalance), available: Number(w.availableBalance) };
}
async function money(m: Mods, c: Contract) {
  const pt = await wallet(m, 'PT', c.parties.ptUserId);
  const plat = await wallet(m, 'PLATFORM', 'REVENUE');
  const client = (await wallet(m, 'CLIENT', c.parties.clientUserId)).available;
  const pending = pt.pending + plat.pending;
  return { client, pt: pt.available, platform: plat.available, pending, sum: client + pt.available + plat.available + pending };
}
async function oblig(m: Mods, key: string) {
  const r = await m.prisma.contractUnpaidObligation.findUnique({ where: { key } });
  return r ? { id: r.id, status: r.status as string, owed: Number(r.owed), paid: Number(r.paid), unpaid: Number(r.unpaid) } : null;
}
async function rowsCount(m: Mods) {
  return {
    entries: await m.prisma.walletLedgerEntry.count(),
    ops: await m.prisma.ledgerOperation.count(),
    events: await m.prisma.contractUnpaidObligationEvent.count(),
    obligations: await m.prisma.contractUnpaidObligation.count(),
    wallets: await m.prisma.wallet.count(),
  };
}
async function booksSound(m: Mods, context: string) {
  const report = await m.reconcile.assertInvariant(context);
  assert.equal(report.drift, '0.00', `${context}: no drift`);
  assert.equal(report.negativeWallets.length, 0, `${context}: no negative wallet`);
  assert.equal(await m.prisma.partnerReceivable.count(), 0, `${context}: no PT debt`);
}
const refusedOff = (e: any) => {
  assert.equal(e?.code, 'LATE_OPEN_FLAG_REQUIRED', String(e?.message));
  assert.equal(e?.status, 409);
  return true;
};
const OPEN_L = { status: 'OPEN', owed: 125_000, paid: 0, unpaid: 125_000 };
const UNTOUCHED = { client: 0, pt: 0, platform: 0, pending: 1_000_000, sum: 1_000_000 };

// ═════════ G1 ═════════

test('G1 flag OFF + OPEN L + settleLateOpen:true: release and no-show are REFUSED 409 LATE_OPEN_FLAG_REQUIRED (also a replay with the same key); nothing is written; the obligation stays OPEN', skipOpts, async () => {
  const m = await load();
  await reset(m);
  const A = await paidContract(m, 'A');
  await recordLate(m, A, 's1');
  const rows = await rowsCount(m);
  assert.deepEqual(await money(m, A), UNTOUCHED);
  const ob0 = await oblig(m, lkey(A, 's1'));
  assert.deepEqual({ ...ob0, id: undefined }, { ...OPEN_L, id: undefined });

  for (let attempt = 1; attempt <= 3; attempt++) {
    await assert.rejects(release(m, A, 's1', true), (e: any) => refusedOff(e) && /disabled/.test(e.message), `release attempt ${attempt}`);
    await assert.rejects(noShow(m, A, 's1', true), (e: any) => refusedOff(e) && /disabled/.test(e.message), `no-show attempt ${attempt}`);
  }
  assert.deepEqual(await rowsCount(m), rows, 'no ledger operation, no wallet entry, no event, no obligation, no wallet created');
  assert.deepEqual(await money(m, A), UNTOUCHED, 'the whole 1.000.000 is still PENDING; client / PT / platform have 0');
  assert.deepEqual(await oblig(m, lkey(A, 's1')), ob0, 'OPEN, paid 0, unpaid 125.000');
  assert.equal(await m.prisma.contractUnpaidObligationEvent.count({ where: { action: 'SETTLE_VIA_LEDGER' } }), 0, 'no PAID_VIA_LEDGER settlement event');
  assert.equal(await m.prisma.ledgerOperation.count({ where: { key: { startsWith: 'SESSION_RELEASE:' } } }), 0, 'no SESSION_RELEASE result stored (so a later retry is not a replay of a refusal)');
  assert.equal(await m.prisma.ledgerOperation.count({ where: { key: { startsWith: 'PT_NO_SHOW:' } } }), 0);
  await booksSound(m, 'G1');
});

// ═════════ G2 control ═════════

test('G2 CONTROL: the same scenario with the flag ON pays L inside the release (client 125.000 / PT 112.500 / platform 12.500 / pending 750.000, PAID_VIA_LEDGER, one event) - and the flag back OFF replays it unchanged', skipOpts, async () => {
  const m = await load();
  await reset(m);
  const A = await paidContract(m, 'A');
  await recordLate(m, A, 's1');
  await assert.rejects(release(m, A, 's1', true), refusedOff);
  assert.deepEqual(await money(m, A), UNTOUCHED);

  flagOn();
  const r = await release(m, A, 's1', true);
  const li = (r as any).lateOpenSettled;
  assert.deepEqual([li.amount, li.fromStatus, li.toStatus], ['125000.00', 'OPEN', 'PAID_VIA_LEDGER']);
  assert.deepEqual(await money(m, A), { client: 125_000, pt: 112_500, platform: 12_500, pending: 750_000, sum: 1_000_000 });
  const ob = await oblig(m, lkey(A, 's1'));
  assert.deepEqual([ob!.status, ob!.owed, ob!.paid, ob!.unpaid], ['PAID_VIA_LEDGER', 125_000, 125_000, 0]);
  assert.equal(await m.prisma.contractUnpaidObligationEvent.count({ where: { action: 'SETTLE_VIA_LEDGER' } }), 1);
  await booksSound(m, 'G2 on');

  // the stored result is replayed with the flag OFF again: no second payment, nothing else moves
  flagOff();
  const rows = await rowsCount(m);
  assert.deepEqual(await release(m, A, 's1', true), r);
  assert.deepEqual(await rowsCount(m), rows);
  assert.deepEqual(await money(m, A), { client: 125_000, pt: 112_500, platform: 12_500, pending: 750_000, sum: 1_000_000 });
});

test('G2b CONTROL (no-show): flag ON, OPEN L + no-show -> the client gets V 250.000 (L 125.000 + the rest 125.000), PT / platform 0, pending 750.000', skipOpts, async () => {
  const m = await load();
  await reset(m);
  const A = await paidContract(m, 'A');
  await recordLate(m, A, 's1');
  await assert.rejects(noShow(m, A, 's1', true), refusedOff);
  assert.deepEqual(await money(m, A), UNTOUCHED);
  flagOn();
  const r = await noShow(m, A, 's1', true);
  assert.deepEqual([r.owed, r.paid, r.unpaid], ['250000.00', '250000.00', '0.00']);
  assert.deepEqual(await money(m, A), { client: 250_000, pt: 0, platform: 0, pending: 750_000, sum: 1_000_000 });
  assert.equal((await oblig(m, lkey(A, 's1')))!.status, 'PAID_VIA_LEDGER');
  await booksSound(m, 'G2b');
});

// ═════════ G3: flag OFF must not block the ordinary money ═════════

test('G3a flag OFF, D77 SETTLED in cash (compensateLateArrival charged L 125.000 to the client): the release still pays the normal V-L = 125.000 to PT 112.500 / platform 12.500, no obligation', skipOpts, async () => {
  const m = await load();
  await reset(m);
  const A = await paidContract(m, 'A');
  await late(m, A, 's1');
  assert.equal(await oblig(m, lkey(A, 's1')), null, 'paid in cash: no obligation row');
  assert.deepEqual(await money(m, A), { client: 125_000, pt: 0, platform: 0, pending: 875_000, sum: 1_000_000 });
  for (const flag of [true, false]) {
    // a different session id per variant is not needed: the second call is the replay
    const r = await release(m, A, 's1', flag);
    assert.deepEqual(r.released, { pt: '112500.00', gym: '0.00', platform: '12500.00' }, `flag in body ${flag}`);
  }
  assert.deepEqual(await money(m, A), { client: 125_000, pt: 112_500, platform: 12_500, pending: 750_000, sum: 1_000_000 });
  assert.equal(await m.prisma.contractUnpaidObligation.count(), 0);
  await booksSound(m, 'G3a');
});

test('G3b flag OFF, L WAIVED: nothing is paid, nothing is deducted - the release pays the whole V = PT 225.000 / platform 25.000', skipOpts, async () => {
  const m = await load();
  await reset(m);
  const A = await paidContract(m, 'A');
  await recordLate(m, A, 's1');
  await m.prisma.contractUnpaidObligation.update({ where: { key: lkey(A, 's1') }, data: { status: 'WAIVED' } }); // TEST FIXTURE: the FH-8 waive, set directly as the neighbouring suite does
  const r = await release(m, A, 's1', true);
  assert.deepEqual(r.released, { pt: '225000.00', gym: '0.00', platform: '25000.00' });
  assert.deepEqual(await money(m, A), { client: 0, pt: 225_000, platform: 25_000, pending: 750_000, sum: 1_000_000 });
  assert.equal((await oblig(m, lkey(A, 's1')))!.status, 'WAIVED');
  const n = await noShow(m, A, 's2', true); // an ordinary no-show next to it: the client gets V in cash from the parties' pending
  assert.deepEqual([n.paid, n.unpaid], ['250000.00', '0.00']);
  await booksSound(m, 'G3b');
});

test('G3c flag OFF, L already PAID_VIA_LEDGER (paid earlier while the flag was ON): the replay is identical and an ordinary session of the same contract is released normally (PT 225.000 / platform 25.000)', skipOpts, async () => {
  const m = await load();
  await reset(m);
  const A = await paidContract(m, 'A');
  await recordLate(m, A, 's1');
  flagOn();
  const r1 = await release(m, A, 's1', true);
  assert.equal((await oblig(m, lkey(A, 's1')))!.status, 'PAID_VIA_LEDGER');
  assert.deepEqual(await money(m, A), { client: 125_000, pt: 112_500, platform: 12_500, pending: 750_000, sum: 1_000_000 });
  flagOff();
  const rows = await rowsCount(m);
  assert.deepEqual(await release(m, A, 's1', true), r1, 'replay of the paid session');
  assert.deepEqual(await rowsCount(m), rows);
  const r2 = await release(m, A, 's2', true); // an ordinary session, no D77
  assert.deepEqual(r2.released, { pt: '225000.00', gym: '0.00', platform: '25000.00' });
  assert.equal((r2 as any).lateOpenSettled, undefined);
  assert.deepEqual(await money(m, A), { client: 125_000, pt: 337_500, platform: 37_500, pending: 500_000, sum: 1_000_000 });
  assert.equal(await m.prisma.contractUnpaidObligationEvent.count({ where: { action: 'SETTLE_VIA_LEDGER' } }), 1, 'still exactly one settlement event');
  await booksSound(m, 'G3c');
});

test('G3d flag OFF, no D77 at all: release and no-show are exactly what they always were, with settleLateOpen true or absent', skipOpts, async () => {
  const m = await load();
  await reset(m);
  const A = await paidContract(m, 'A');
  assert.deepEqual((await release(m, A, 's1', true)).released, { pt: '225000.00', gym: '0.00', platform: '25000.00' });
  assert.deepEqual((await release(m, A, 's2', false)).released, { pt: '225000.00', gym: '0.00', platform: '25000.00' });
  const n = await noShow(m, A, 's3', true);
  assert.deepEqual([n.owed, n.paid], ['250000.00', '250000.00']);
  assert.deepEqual(await money(m, A), { client: 250_000, pt: 450_000, platform: 50_000, pending: 250_000, sum: 1_000_000 });
  assert.equal(await m.prisma.contractUnpaidObligationEvent.count(), 0);
  await booksSound(m, 'G3d');
});

// ═════════ G4: the REAL internal HTTP routes ═════════

async function startServer() {
  const express = (await import('express')).default;
  const router = (await import('../routes/internal.routes')).default;
  const app = express();
  app.use(express.json());
  app.use('/internal', router);
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;
  const call = async (path: string, body: unknown) => {
    const res = await fetch(`http://127.0.0.1:${port}/internal${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-service-secret': SECRET },
      body: JSON.stringify(body),
    });
    return { status: res.status, json: (await res.json().catch(() => null)) as any };
  };
  return {
    call,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections(); // fetch keeps its connection alive: without this close() waits for it
      }),
  };
}
const httpBody = (c: Contract, key: string, extra: Record<string, unknown> = {}) => ({
  transactionId: c.txnId,
  price: c.price.toFixed(2),
  totalSessions: c.total,
  rates: { platformRate: '0.10', ptRate: '0.90', gymRate: '0' },
  parties: c.parties,
  label: key,
  idempotencyKey: key,
  ...extra,
});
async function endWithHeldSession(m: Mods, c: Contract, s: string) {
  const zero = () => new m.Prisma.Decimal(0);
  const t = await m.ledger.terminateContract({
    ...base(c), usedSessions: 0, compensatedSessions: 0, unresolvedSessions: 1, unresolvedSessionIds: [`${c.id}:${s}`], reason: 'MUTUAL',
    alreadyReleased: { pt: zero(), gym: zero(), platform: zero() }, label: 'end', idempotencyKey: `CONTRACT_TERMINATE:${c.id}`,
  });
  assert.equal(t.refund, '750000.00');
}

test('G4 BYPASS: direct HTTP to release-session / no-show / resolve-unresolved-session with a body settleLateOpen:true and the flag OFF -> 409 LATE_OPEN_FLAG_REQUIRED, nothing written (also a repeat); CONTROL: flag ON pays', skipOpts, async () => {
  const m = await load();
  await reset(m);
  const srv = await startServer();
  try {
    // ── release-session + no-show on a running contract (two different OPEN L, two sessions) ──
    const A = await paidContract(m, 'A');
    await recordLate(m, A, 's1');
    await recordLate(m, A, 's2');
    const rows = await rowsCount(m);
    for (let i = 0; i < 2; i++) {
      const rel = await srv.call('/contracts/release-session', httpBody(A, `SESSION_RELEASE:${A.id}:s1`, { settleLateOpen: true }));
      assert.deepEqual([rel.status, rel.json?.success, rel.json?.error?.code], [409, false, 'LATE_OPEN_FLAG_REQUIRED'], JSON.stringify(rel.json));
      const ns = await srv.call('/contracts/no-show', httpBody(A, `PT_NO_SHOW:${A.id}:s2`, { settleLateOpen: true }));
      assert.deepEqual([ns.status, ns.json?.success, ns.json?.error?.code], [409, false, 'LATE_OPEN_FLAG_REQUIRED'], JSON.stringify(ns.json));
    }
    assert.deepEqual(await rowsCount(m), rows, 'release / no-show: nothing written');
    assert.deepEqual(await money(m, A), UNTOUCHED);

    // ── resolve-unresolved-session on an ENDED contract with a held session ──
    await reset(m);
    const B = await paidContract(m, 'B');
    await recordLate(m, B, 's1');
    await endWithHeldSession(m, B, 's1');
    const rowsB = await rowsCount(m);
    const moneyB = await money(m, B);
    assert.deepEqual(moneyB, { client: 750_000, pt: 0, platform: 0, pending: 250_000, sum: 1_000_000 }, 'ended: the client has the 3 refunded sessions, the held session keeps its whole value');
    for (const outcome of ['DELIVERED', 'NOT_DELIVERED'] as const) {
      const r = await srv.call('/contracts/resolve-unresolved-session', httpBody(B, `UNRESOLVED_SESSION:${B.id}:s1`, { outcome, settleLateOpen: true }));
      assert.deepEqual([outcome, r.status, r.json?.error?.code], [outcome, 409, 'LATE_OPEN_FLAG_REQUIRED'], JSON.stringify(r.json));
    }
    assert.deepEqual(await rowsCount(m), rowsB, 'resolve: nothing written');
    assert.deepEqual(await money(m, B), moneyB);
    assert.deepEqual({ ...(await oblig(m, lkey(B, 's1'))), id: undefined }, { ...OPEN_L, id: undefined });

    // ── CONTROL: flag ON, same requests -> the HTTP routes do pay ──
    flagOn();
    const ok = await srv.call('/contracts/resolve-unresolved-session', httpBody(B, `UNRESOLVED_SESSION:${B.id}:s1`, { outcome: 'DELIVERED', settleLateOpen: true }));
    assert.equal(ok.status, 200, JSON.stringify(ok.json));
    assert.deepEqual(ok.json.data.moved, { pt: '112500.00', gym: '0.00', platform: '12500.00', client: '125000.00' });
    assert.deepEqual(await money(m, B), { client: 875_000, pt: 112_500, platform: 12_500, pending: 0, sum: 1_000_000 });
    assert.equal((await oblig(m, lkey(B, 's1')))!.status, 'PAID_VIA_LEDGER');
    await booksSound(m, 'G4 resolve');

    await reset(m);
    const C = await paidContract(m, 'C');
    await recordLate(m, C, 's1');
    const rel = await srv.call('/contracts/release-session', httpBody(C, `SESSION_RELEASE:${C.id}:s1`, { settleLateOpen: true }));
    assert.equal(rel.status, 200, JSON.stringify(rel.json));
    assert.deepEqual(await money(m, C), { client: 125_000, pt: 112_500, platform: 12_500, pending: 750_000, sum: 1_000_000 });
    await booksSound(m, 'G4 release');
  } finally {
    flagOff();
    await srv.close();
  }
});

// ═════════ G5: the rule of the flag ═════════

test('G5a (unit) the payment-side flag is effective only for exactly "true" + NODE_ENV test + a *_test database name; every other combination is OFF; a refused ask warns once per reason', async () => {
  const f = await import('../services/late-open-settlement-flag');
  const url = 'postgresql://gymcoach_test:pw@localhost:55433/gymcoach_payment_x_test?schema=public';
  const ok = { [FLAG]: 'true', NODE_ENV: 'test', DATABASE_URL: url } as NodeJS.ProcessEnv;
  assert.equal(f.lateOpenSettlementEnabled(ok), true);
  const warnings: string[] = [];
  const realWarn = console.warn;
  console.warn = (...a: unknown[]) => void warnings.push(a.join(' '));
  try {
    f.__resetLateOpenFlagWarnings();
    const off: Array<[string, NodeJS.ProcessEnv]> = [
      ['unset', { ...ok, [FLAG]: undefined }],
      ['TRUE', { ...ok, [FLAG]: 'TRUE' }],
      ['1', { ...ok, [FLAG]: '1' }],
      ["'true '", { ...ok, [FLAG]: 'true ' }],
      ['yes', { ...ok, [FLAG]: 'yes' }],
      ['empty', { ...ok, [FLAG]: '' }],
      ['NODE_ENV production', { ...ok, NODE_ENV: 'production' }],
      ['NODE_ENV development', { ...ok, NODE_ENV: 'development' }],
      ['NODE_ENV unset', { ...ok, NODE_ENV: undefined }],
      ['database without _test', { ...ok, DATABASE_URL: 'postgresql://gymcoach_test:pw@localhost:55433/gymcoach_payment?schema=public' }],
      ['_test only in the user name', { ...ok, DATABASE_URL: 'postgresql://gymcoach_test:pw@localhost:55433/gymcoach_payment?schema=public' }],
      ['_test only in the query', { ...ok, DATABASE_URL: 'postgresql://u:pw@localhost:5432/gymcoach_payment?schema=x_test' }],
      ['_test in the middle of the name', { ...ok, DATABASE_URL: 'postgresql://u:pw@localhost:5432/gymcoach_test_payment' }],
      ['DATABASE_URL unset', { ...ok, DATABASE_URL: undefined }],
      ['DATABASE_URL garbage', { ...ok, DATABASE_URL: 'not a url' }],
    ];
    for (const [label, env] of off) assert.equal(f.lateOpenSettlementEnabled(env), false, label);
    assert.equal(f.lateOpenSettlementVerdict({ ...ok, NODE_ENV: 'production' }).refusedBecause, 'NOT_TEST_ENV');
    assert.equal(f.lateOpenSettlementVerdict({ ...ok, DATABASE_URL: 'postgresql://u:pw@h/gymcoach_payment' }).refusedBecause, 'DATABASE_NOT_TEST');
    assert.equal(f.lateOpenSettlementVerdict({ ...ok, [FLAG]: 'TRUE' }).refusedBecause, undefined, 'a value that does not ask for on is not a "refusal"');
    // warn once per reason: many refused asks, exactly two lines (NOT_TEST_ENV, DATABASE_NOT_TEST)
    f.__resetLateOpenFlagWarnings();
    warnings.length = 0;
    for (let i = 0; i < 5; i++) {
      f.lateOpenSettlementEnabled({ ...ok, NODE_ENV: 'production' });
      f.lateOpenSettlementEnabled({ ...ok, DATABASE_URL: 'postgresql://u:pw@h/gymcoach_payment' });
    }
    assert.equal(warnings.length, 2, warnings.join('\n'));
    assert.match(warnings[0], /IGNORED/);
  } finally {
    console.warn = realWarn;
  }
  // reads the real environment on every call
  process.env.NODE_ENV = 'test';
  process.env[FLAG] = 'true';
  assert.equal(f.lateOpenSettlementEnabled(), isTestDatabaseUrl(process.env.DATABASE_URL));
  delete process.env[FLAG];
  assert.equal(f.lateOpenSettlementEnabled(), false);
});

test('G5b through the REAL ledger: the value "true" with NODE_ENV=production, or with a DATABASE_URL that does not name a *_test database, still refuses LATE_OPEN_FLAG_REQUIRED and writes nothing', skipOpts, async () => {
  const m = await load();
  await reset(m);
  const A = await paidContract(m, 'A');
  await recordLate(m, A, 's1');
  const rows = await rowsCount(m);
  const realWarn = console.warn;
  console.warn = () => {};
  try {
    flagOn();
    process.env.NODE_ENV = 'production';
    await assert.rejects(release(m, A, 's1', true), refusedOff, 'NODE_ENV=production');
    process.env.NODE_ENV = 'development';
    await assert.rejects(noShow(m, A, 's1', true), refusedOff, 'NODE_ENV=development');
    delete process.env.NODE_ENV;
    await assert.rejects(release(m, A, 's1', true), refusedOff, 'NODE_ENV unset');
    process.env.NODE_ENV = 'test';
    // the prisma client is already connected to the test database; only the NAME the guard reads changes
    process.env.DATABASE_URL = 'postgresql://gymcoach_test:pw@localhost:55433/gymcoach_payment?schema=public';
    await assert.rejects(release(m, A, 's1', true), refusedOff, 'database name without _test');
    process.env.DATABASE_URL = 'postgresql://gymcoach_test:pw@localhost:55433/gymcoach_payment?schema=x_test';
    await assert.rejects(release(m, A, 's1', true), refusedOff, '_test only in the query');
    delete process.env.DATABASE_URL;
    await assert.rejects(release(m, A, 's1', true), refusedOff, 'DATABASE_URL unset');
  } finally {
    console.warn = realWarn;
  }
  assert.deepEqual(await rowsCount(m), rows);
  assert.deepEqual(await money(m, A), UNTOUCHED);
  // control: restore the environment -> the same call pays
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = databaseUrl;
  flagOn();
  await release(m, A, 's1', true);
  assert.equal((await oblig(m, lkey(A, 's1')))!.status, 'PAID_VIA_LEDGER');
});

// ═════════ G6: CODE AUDIT - the boundary is the only door ═════════

test('G6 (CODE AUDIT of src) settleLateOpen is called from exactly 3 places (release, no-show, resolve) and the flag check sits between the body flag and the first wallet write', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'services', 'contract-ledger.service.ts'), 'utf8');
  assert.equal((src.match(/await settleLateOpen\(/g) ?? []).length, 3, 'three callers');
  const i = src.indexOf("return refuse('LATE_OPEN_FLAG_REQUIRED', 'the late-arrival obligation is OPEN but the caller did not");
  const j = src.indexOf('if (!lateOpenSettlementEnabled())');
  const k = src.indexOf('const want = Prisma.Decimal.min(unpaid');
  assert.ok(i > 0 && j > i && k > j, 'order: body flag check, then the payment-side switch, then the first amount computation / debit');
});
