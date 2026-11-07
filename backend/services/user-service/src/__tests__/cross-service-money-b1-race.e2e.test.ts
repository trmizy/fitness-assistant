/**
 * B-1 RELEASE GATE - race of an OPEN-L / D77 session step against the contract ending (R1 - R8), with SYNCHRONISATION POINTS instead of random repetition.
 *
 * Evidence label: BACKEND INTEGRATION (cross-service): this process runs the real user-service app; payment-service is a real child process on an isolated *_test database.
 *
 * WHAT IS NOT ASSUMED. The user-service contract lock is an advisory lock in the USER database. It does not protect a transaction in the PAYMENT database, and the ruling's money step
 * runs AFTER that lock is released. The protection of each step is therefore proved here, step by step, from the two seams below - never from the lock:
 *
 *   SEAM A (user side, in process): `gate(method)` wraps paymentClient[method]; the FIRST call announces that it was reached and then waits until the test lets it go. It holds a
 *          step AFTER the user-service decided it and BEFORE payment-service sees it.
 *   SEAM B (payment side, real DB transaction): `pausePayment(marker)` installs a trigger on wallet_ledger_entries that blocks (pg_advisory_xact_lock on a key the test holds) the
 *          first ledger row whose description contains the marker. The operation has then locked its wallets and written nothing else - a REAL open payment transaction.
 *          The test sees "paused" by polling pg_locks, then lets it go.
 *
 * Every case ends in the SAME place whichever side wins (the "converged" state is pinned by hand, 90/10, 1,000,000 / 4, V 250k, L 125k, the client ends the contract with
 * CLIENT_CANCELLED): COMPLETED -> client 800,000 / PT 180,000 / platform 20,000; PT_NO_SHOW -> client 925,000 / PT 67,500 / platform 7,500; pending 0; L PAID_VIA_LEDGER paid 125,000
 * with exactly one SETTLE_VIA_LEDGER event; every ledger operation key written once; no REFUND_SHORT.
 *
 * Opt-in; run ALONE:  RUN_CROSS_SERVICE_MONEY=1 TEST_DATABASE_URL=...user_<x>_test... E2E_PAYMENT_DATABASE_URL=...payment_<x>_test... SETTLEMENT_INFLIGHT_WAIT_MS=300 \
 *   ./node_modules/.bin/tsx --import ./src/__tests__/setup/db-isolation.ts --test --test-concurrency=1 src/__tests__/cross-service-money-b1-race.e2e.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { HOUR, skip, startHarness, type Harness, type PaidContract } from "./cross-service-money.harness";
// Fail-closed late-open switch (DISPUTE_CASE_LATE_OPEN_RECONCILIATION_ENABLED, user-service gate AND the payment-service child it spawns): this suite PAYS an OPEN late-arrival obligation, so it is turned on in-process before the harness starts (the child inherits it at spawn).
process.env.NODE_ENV = "test";
process.env.DISPUTE_CASE_LATE_OPEN_RECONCILIATION_ENABLED = "true";

process.env.SETTLEMENT_INFLIGHT_WAIT_MS ??= "300";
const MIN = 60_000;
const GRACE_MS = Number(process.env.NO_SHOW_GRACE_MINUTES ?? "15") * MIN;
const PRICE = 1_000_000;
const L = 125_000;
const num = (v: unknown) => Number(v ?? 0);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const PAUSE_KEY = 777001;

let H: Harness;
test.before(async () => {
  if (skip) return;
  H = await startHarness({ paymentAuth: true });
});
test.after(async () => {
  if (H) await H.close();
  if (process.env.S2_B1_RACE_REPORT) fs.writeFileSync(process.env.S2_B1_RACE_REPORT, JSON.stringify(REPORT, null, 2));
});
const REPORT: Array<Record<string, unknown>> = [];

// ── seams ────────────────────────────────────────────────────────────────────

/** SEAM A. */
function gate(method: "releaseSession" | "noShow" | "lateArrival" | "terminate" | "resolveUnresolvedSession", o: { throwFirst?: boolean } = {}) {
  const pc = H.m.paymentClient as any;
  const original = pc[method];
  let calls = 0;
  let enter!: () => void;
  const entered = new Promise<void>((r) => (enter = r));
  let go!: () => void;
  const proceed = new Promise<void>((r) => (go = r));
  pc[method] = async function (...args: unknown[]) {
    calls++;
    if (calls === 1) {
      enter();
      if (o.throwFirst) throw new Error("simulated crash before payment-service saw the request");
      await proceed;
    }
    return original.apply(this, args);
  };
  return { entered, go, calls: () => calls, restore: () => (pc[method] = original) };
}

/** SEAM B. */
async function pausePayment(marker: string) {
  assert.match(marker, /^[0-9a-zA-Z -]+$/);
  let release!: () => void;
  const hold = new Promise<void>((r) => (release = r));
  let locked!: () => void;
  const lockedP = new Promise<void>((r) => (locked = r));
  const holder = H.payDb.$transaction(
    async (tx: any) => {
      await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${PAUSE_KEY})`);
      locked();
      await hold;
    },
    { timeout: 120_000, maxWait: 10_000 },
  );
  await lockedP;
  await H.payDb.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION b1_pause() RETURNS trigger AS $$ BEGIN PERFORM pg_advisory_xact_lock(${PAUSE_KEY}); RETURN NEW; END; $$ LANGUAGE plpgsql`);
  await H.payDb.$executeRawUnsafe(`DROP TRIGGER IF EXISTS b1_pause_trg ON wallet_ledger_entries`);
  await H.payDb.$executeRawUnsafe(
    `CREATE TRIGGER b1_pause_trg BEFORE INSERT ON wallet_ledger_entries FOR EACH ROW WHEN (NEW.description LIKE '%${marker}%') EXECUTE FUNCTION b1_pause()`,
  );
  return {
    /** resolves when a payment transaction is really blocked at the trigger */
    reached: async (timeoutMs = 20_000) => {
      const until = Date.now() + timeoutMs;
      while (Date.now() < until) {
        const rows: any[] = await H.payDb.$queryRawUnsafe(`SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND NOT granted AND objid = ${PAUSE_KEY}`);
        if (rows[0].n > 0) return true;
        await sleep(30);
      }
      return false;
    },
    release: async () => {
      release();
      await holder;
    },
    drop: async () => {
      release();
      await holder.catch(() => {});
      await H.payDb.$executeRawUnsafe(`DROP TRIGGER IF EXISTS b1_pause_trg ON wallet_ledger_entries`);
      await H.payDb.$executeRawUnsafe(`DROP FUNCTION IF EXISTS b1_pause()`);
    },
  };
}

// ── model ────────────────────────────────────────────────────────────────────

type Outcome = "COMPLETED" | "PT_NO_SHOW_CONFIRMED";
const OUTCOMES: Outcome[] = ["COMPLETED", "PT_NO_SHOW_CONFIRMED"];
const FINAL: Record<Outcome, { client: number; pt: number; platform: number }> = {
  COMPLETED: { client: 800_000, pt: 180_000, platform: 20_000 },
  PT_NO_SHOW_CONFIRMED: { client: 925_000, pt: 67_500, platform: 7_500 },
};

async function scenario(id: string, fn: (rec: Record<string, unknown>) => Promise<void>) {
  await H.resetPayment();
  const rec: Record<string, unknown> = { id };
  REPORT.push(rec);
  try {
    await fn(rec);
  } finally {
    await H.payDb.$executeRawUnsafe(`DROP TRIGGER IF EXISTS b1_pause_trg ON wallet_ledger_entries`).catch(() => {});
    await H.startPayment().catch(() => {});
    await H.cleanup();
  }
}

const lateSession = (c: PaidContract) => {
  const start = new Date(Date.now() - 2 * HOUR);
  return H.m.base.addSession(c, "CONFIRMED", start, { sessionMode: "ONLINE", roomPtJoinedAt: new Date(start.getTime() + GRACE_MS + MIN), roomClientJoinedAt: new Date(start.getTime() + MIN) });
};
const runSweep = async () => (await import("../services/room-close-resolution.service")).runRoomCloseResolution();
const runSettlementSweep = async () => (await import("../services/session-settlement-sweep.service")).runSettlementSweep();
async function drain(contractId: string, ticks = 3) {
  await H.m.prisma.sessionSettlement.updateMany({ where: { contractId, status: { not: "SETTLED" } }, data: { nextAttemptAt: null } });
  for (let i = 0; i < ticks; i++) await runSettlementSweep();
}
const dispute = async (c: PaidContract, sid: string) => {
  const r = await H.call("POST", `/sessions/${sid}/dispute`, c.clientToken, { reason: "Buổi tập không như đã báo" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
};
const rule = (token: string, sid: string, resolution: Outcome) => H.call("POST", `/admin/sessions/${sid}/resolve`, token, { resolution, note: `b1 race ${resolution}` });
const endContract = (c: PaidContract) => H.call("POST", `/contracts/${c.id}/terminate`, c.clientToken, { reason: "CLIENT_CANCELLED" });
async function opCount(key: string) {
  return ((await H.payDb.$queryRawUnsafe(`SELECT count(*)::int AS n FROM ledger_operations WHERE key = $1`, key)) as any[])[0].n as number;
}
async function totals(c: PaidContract) {
  const at = (t: string, b: "AVAILABLE" | "PENDING", id?: string) => H.net(c.txnId, t, b, id);
  const r = {
    client: await at("CLIENT", "AVAILABLE"),
    pt: await at("PT", "AVAILABLE"),
    platform: await at("PLATFORM", "AVAILABLE", "REVENUE"),
    pending: (await at("PT", "PENDING")) + (await at("PLATFORM", "PENDING", "REVENUE")),
  };
  return { ...r, sum: r.client + r.pt + r.platform + r.pending };
}
async function obligations(txnId: string) {
  const rows: any[] = await H.payDb.$queryRawUnsafe(
    `SELECT key, kind::text AS kind, status::text AS status, owed::text AS owed, paid::text AS paid, unpaid::text AS unpaid FROM contract_unpaid_obligations WHERE transaction_id = $1 ORDER BY created_at, key`,
    txnId,
  );
  return rows.map((r) => ({ key: r.key as string, kind: r.kind as string, status: r.status as string, owed: num(r.owed), paid: num(r.paid), unpaid: num(r.unpaid) }));
}
async function settleEvents(txnId: string) {
  return num(((await H.payDb.$queryRawUnsafe(`SELECT count(*)::text AS n FROM contract_unpaid_obligation_events e JOIN contract_unpaid_obligations o ON o.id = e.obligation_id WHERE o.transaction_id = $1 AND e.action::text = 'SETTLE_VIA_LEDGER'`, txnId)) as any[])[0].n);
}

interface Fx {
  c: PaidContract;
  S: { id: string };
  adminToken: string;
  outcome: Outcome;
}
/** A disputed session whose late-arrival compensation L is OPEN (the REAL record-only door writes it; the UNCONFIRMED status of the sweep row is the TEST FIXTURE), contract running. */
async function buildOpenL(outcome: Outcome, sessions = 4): Promise<Fx> {
  const pt = await H.makePt();
  const c = await H.paidContract(pt, { price: PRICE, totalSessions: sessions });
  const S = await lateSession(c);
  await H.stopPayment();
  assert.deepEqual(await runSweep(), { scanned: 1, resolved: 1 });
  await H.startPayment();
  const row = await H.m.prisma.sessionSettlement.findUniqueOrThrow({ where: { idempotencyKey: `PT_LATE_ARRIVAL:${S.id}` } });
  assert.notEqual(row.status, "SETTLED");
  await H.m.prisma.sessionSettlement.update({ where: { id: row.id }, data: { status: "UNCONFIRMED" } });
  assert.equal(await H.m.payout.settleEndedCompensationRow(row.id), "RECORDED");
  await dispute(c, S.id);
  return { c, S, adminToken: H.tokenFor(randomUUID(), "ADMIN"), outcome };
}

/** The converged state, identical whichever side won. */
async function assertConverged(fx: Fx, label: string, o: { sessionsSettled?: number } = {}) {
  const t = await totals(fx.c);
  const exp = FINAL[fx.outcome];
  assert.deepEqual({ client: t.client, pt: t.pt, platform: t.platform, pending: t.pending, sum: t.sum }, { ...exp, pending: 0, sum: PRICE }, `${label}: money to the right people`);
  const obs = await obligations(fx.c.txnId);
  assert.deepEqual(obs.map((x) => [x.kind, x.status, x.paid, x.unpaid]), [["LATE_ARRIVAL", "PAID_VIA_LEDGER", L, 0]], `${label}: L closed by a ledger entry, no REFUND_SHORT, no second obligation`);
  assert.equal(await settleEvents(fx.c.txnId), 1, `${label}: one SETTLE_VIA_LEDGER event`);
  const stepKey = fx.outcome === "COMPLETED" ? `SESSION_RELEASE:${fx.S.id}` : `PT_NO_SHOW:${fx.S.id}`;
  assert.equal(await opCount(stepKey), 1, `${label}: the step is in the ledger exactly once`);
  assert.equal(await opCount(`CONTRACT_TERMINATE:${fx.c.id}`), 1, `${label}: the ending is in the ledger exactly once`);
  const contract = await H.m.prisma.contract.findUniqueOrThrow({ where: { id: fx.c.id } });
  assert.equal(contract.status, "CANCELLED", `${label}: contract ended`);
  const sess = await H.m.prisma.session.findUniqueOrThrow({ where: { id: fx.S.id } });
  assert.equal(sess.status, fx.outcome === "COMPLETED" ? "COMPLETED" : "NO_SHOW", `${label}: session`);
  assert.deepEqual(fx.outcome === "COMPLETED" ? [contract.usedSessions, contract.compensatedSessions] : [contract.usedSessions, contract.compensatedSessions], fx.outcome === "COMPLETED" ? [1, 0] : [0, 1], `${label}: quota`);
  await H.invariant(label);
  void o;
}

// ═════════════════════ R1: the settlement committed, then the ending ═════════════════════
for (const outcome of OUTCOMES) {
  test(`R1 ${outcome}: settlement (L OPEN) committed at payment, THEN the ending -> converged`, { skip }, async () => {
    await scenario(`R1.${outcome}`, async (rec) => {
      const fx = await buildOpenL(outcome);
      assert.equal((await rule(fx.adminToken, fx.S.id, outcome)).status, 200);
      const mid = await totals(fx.c);
      rec.afterSettlement = mid;
      assert.equal(mid.pending, 750_000, "nothing held back for L");
      assert.equal((await endContract(fx.c)).status, 200);
      await drain(fx.c.id);
      rec.final = await totals(fx.c);
      await assertConverged(fx, "R1");
    });
  });
}

// ═════════════════════ R2: the ending committed, THEN the (held) settlement call reaches payment ═════════════════════
for (const outcome of OUTCOMES) {
  test(`R2 ${outcome}: the ruling's money call is HELD before payment (seam A); the ending runs and commits (its drain performs the step itself); THEN the held call arrives -> a replay, nothing moves`, { skip }, async () => {
    await scenario(`R2.${outcome}`, async (rec) => {
      const fx = await buildOpenL(outcome);
      const method = outcome === "COMPLETED" ? "releaseSession" : "noShow";
      const g = gate(method);
      try {
        const ruling = rule(fx.adminToken, fx.S.id, outcome);
        await g.entered; // the ruling decided (intent committed) and waits to call payment
        const ended = await endContract(fx.c); // the ending's drain runs the SAME row itself (takeover) and terminates
        assert.equal(ended.status, 200, JSON.stringify(ended.body));
        const afterEnding = await totals(fx.c);
        const opsBefore = await H.snapshot();
        g.go(); // the held call now reaches payment-service AFTER terminate
        assert.equal((await ruling).status, 200);
        await drain(fx.c.id);
        assert.deepEqual(await H.snapshot(), opsBefore, "the late arrival of the held call changed not one ledger row");
        rec.afterEnding = afterEnding;
        await assertConverged(fx, "R2");
      } finally {
        g.go();
        g.restore();
      }
    });
  });
}

// ═════════════════════ R3: the settlement HOLDS the wallet locks in an uncommitted payment transaction; the ending waits; then commit ═════════════════════
for (const outcome of OUTCOMES) {
  test(`R3 ${outcome}: settlement paused INSIDE its payment transaction (seam B, wallets locked, nothing committed); the ending runs and waits; commit -> converged`, { skip }, async () => {
    await scenario(`R3.${outcome}`, async (rec) => {
      const fx = await buildOpenL(outcome);
      const marker = outcome === "COMPLETED" ? `session ${fx.S.id}` : `no-show ${fx.S.id}`;
      const pause = await pausePayment(marker);
      try {
        const ruling = rule(fx.adminToken, fx.S.id, outcome);
        assert.ok(await pause.reached(), "the settlement is really blocked inside its payment transaction");
        assert.equal(await opCount(outcome === "COMPLETED" ? `SESSION_RELEASE:${fx.S.id}` : `PT_NO_SHOW:${fx.S.id}`), 0, "nothing of it is committed");
        const ending = endContract(fx.c);
        await sleep(1200); // the ending's drain finds the row live, waits, then calls the same key: it is blocked on the wallet locks the paused transaction holds
        assert.equal(await opCount(`CONTRACT_TERMINATE:${fx.c.id}`), 0, "the ending did not slip past the open settlement");
        await pause.release();
        assert.equal((await ruling).status, 200);
        const ended = await ending;
        assert.equal(ended.status, 200, JSON.stringify(ended.body));
        await drain(fx.c.id);
        rec.final = await totals(fx.c);
        await assertConverged(fx, "R3");
      } finally {
        await pause.drop();
      }
    });
  });
}

// ═════════════════════ R4: the ending HOLDS the wallet locks; a settlement call (same key as the intent) arrives; then commit ═════════════════════
for (const outcome of OUTCOMES) {
  test(`R4 ${outcome}: the ENDING paused inside its payment transaction (seam B); the held settlement call arrives and waits on the wallet locks; commit -> replay, converged`, { skip }, async () => {
    await scenario(`R4.${outcome}`, async (rec) => {
      const fx = await buildOpenL(outcome);
      const method = outcome === "COMPLETED" ? "releaseSession" : "noShow";
      const g = gate(method);
      const pause = await pausePayment(`Contract ${fx.c.id} termination`);
      try {
        const ruling = rule(fx.adminToken, fx.S.id, outcome);
        await g.entered;
        const ending = endContract(fx.c); // its drain performs the step itself (second, ungated call), then the terminate call blocks at the trigger
        assert.ok(await pause.reached(), "the ending is really blocked inside its payment transaction");
        g.go(); // the held settlement call arrives while terminate holds the wallets: same key, so a replay once terminate commits
        await sleep(600);
        await pause.release();
        assert.equal((await ending).status, 200);
        assert.equal((await ruling).status, 200);
        await drain(fx.c.id);
        rec.final = await totals(fx.c);
        await assertConverged(fx, "R4");
      } finally {
        g.go();
        g.restore();
        await pause.drop();
      }
    });
  });
}

// ═════════════════════ R5: the ending's snapshot is taken, the terminate call is not made yet; a DIFFERENT session step slips into the ledger ═════════════════════
for (const outcome of OUTCOMES) {
  test(`R5 ${outcome}: terminate HELD after the snapshot (seam A); a release of ANOTHER session reaches the ledger door meanwhile; terminate is REFUSED 409 TERMINATE_SNAPSHOT_STALE, writes nothing, no REFUND_SHORT`, { skip }, async () => {
    await scenario(`R5.${outcome}`, async (rec) => {
      const fx = await buildOpenL(outcome);
      assert.equal((await rule(fx.adminToken, fx.S.id, outcome)).status, 200);
      const g = gate("terminate");
      try {
        const ending = endContract(fx.c);
        await g.entered; // the snapshot (counters, alreadyReleased) was taken and is in the request body
        const before = await totals(fx.c);
        // a step the user-service never decided (another door / a stale in-flight call): a release of a second session at the ledger, with its own key
        const c = fx.c;
        const pc = H.m.paymentClient as any;
        const rel = await pc.releaseSession({
          transactionId: c.txnId, price: c.price!.toString(), totalSessions: c.totalSessions,
          rates: { platformRate: c.platformRate.toString(), ptRate: c.ptRate.toString(), gymRate: c.gymRate.toString() },
          parties: { ptUserId: c.ptUserId, gymId: c.gymId ?? null, clientUserId: c.clientUserId }, label: "b1 R5 interloper", idempotencyKey: `SESSION_RELEASE:${randomUUID()}`,
        });
        assert.equal(rel.released.pt, "225000.00", "the interloper really moved money");
        const afterInterloper = await totals(fx.c);
        g.go();
        const ended = await ending;
        rec.endingAnswer = { status: ended.status, body: JSON.stringify(ended.body).slice(0, 300) };
        assert.notEqual(ended.status, 200, "the ending cannot succeed on a stale snapshot");
        assert.equal(await opCount(`CONTRACT_TERMINATE:${c.id}`), 0, "the refused terminate wrote NO ledger operation");
        assert.deepEqual(await totals(fx.c), afterInterloper, "the refused terminate moved NO money");
        assert.equal((await obligations(c.txnId)).filter((o) => o.kind === "REFUND_SHORT").length, 0, "no REFUND_SHORT");
        const termRow = await H.m.prisma.sessionSettlement.findUniqueOrThrow({ where: { idempotencyKey: `CONTRACT_TERMINATE:${c.id}` } });
        assert.ok(["NEEDS_HUMAN", "CONFLICT", "FAILED"].includes(termRow.status as string) || /STALE/.test(termRow.lastError ?? ""), `the ending waits for a person (${termRow.status}: ${(termRow.lastError ?? "").slice(0, 120)})`);
        rec.parked = { status: termRow.status, lastError: (termRow.lastError ?? "").slice(0, 200) };
        rec.before = before;
        rec.afterInterloper = afterInterloper;
        await H.invariant("R5");
      } finally {
        g.go();
        g.restore();
      }
    });
  });
}

// ═════════════════════ R6: intent recorded, the call never made (crash); the ending starts; the sweep and the drain run at the same time ═════════════════════
for (const outcome of OUTCOMES) {
  test(`R6 ${outcome}: the ruling's money call "crashes" before payment (seam A throws); the ending, the settlement sweep and a second drain run TOGETHER -> the step is performed exactly once, converged`, { skip }, async () => {
    await scenario(`R6.${outcome}`, async (rec) => {
      const fx = await buildOpenL(outcome);
      const method = outcome === "COMPLETED" ? "releaseSession" : "noShow";
      const g = gate(method, { throwFirst: true });
      try {
        const ruled = await rule(fx.adminToken, fx.S.id, outcome);
        await g.entered;
        rec.rulingAnswer = ruled.status; // 200: the decision and the intent are committed; the money step is FAILED and retried
        const stepKey = outcome === "COMPLETED" ? `SESSION_RELEASE:${fx.S.id}` : `PT_NO_SHOW:${fx.S.id}`;
        const row = await H.m.prisma.sessionSettlement.findUniqueOrThrow({ where: { idempotencyKey: stepKey } });
        assert.notEqual(row.status, "SETTLED", "the step was not performed");
        assert.equal(await opCount(stepKey), 0);
        await H.m.prisma.sessionSettlement.updateMany({ where: { contractId: fx.c.id, status: { not: "SETTLED" } }, data: { nextAttemptAt: null } });
        const [ended] = await Promise.all([endContract(fx.c), runSettlementSweep(), runSettlementSweep()]);
        assert.equal(ended.status, 200, JSON.stringify(ended.body));
        await drain(fx.c.id);
        await assertConverged(fx, "R6");
      } finally {
        g.go();
        g.restore();
      }
    });
  });
}

// ═════════════════════ R7: D77 retry races the release and the ending ═════════════════════
for (const outcome of OUTCOMES) {
  test(`R7 ${outcome}: D77 PENDING (ledger was down at the sweep), the D77 call HELD (seam A); the ruling, the settlement sweep and the ending all arrive -> D77 first, then the step, then the ending; converged`, { skip }, async () => {
    await scenario(`R7.${outcome}`, async (rec) => {
      const pt = await H.makePt();
      const c = await H.paidContract(pt, { price: PRICE, totalSessions: 4 });
      const S = await lateSession(c);
      await H.stopPayment();
      assert.deepEqual(await runSweep(), { scanned: 1, resolved: 1 });
      await H.startPayment();
      await dispute(c, S.id);
      const fx: Fx = { c, S, adminToken: H.tokenFor(randomUUID(), "ADMIN"), outcome };
      const g = gate("lateArrival");
      try {
        const ruling = rule(fx.adminToken, S.id, outcome); // COMPLETED: the release waits for D77 and tries it (held); NO_SHOW: the no-show is performed, D77 follows
        if (outcome === "COMPLETED") await g.entered;
        await H.m.prisma.sessionSettlement.updateMany({ where: { contractId: c.id, status: { not: "SETTLED" } }, data: { nextAttemptAt: null } });
        const ending = endContract(c);
        const sweeps = Promise.all([runSettlementSweep(), runSettlementSweep()]);
        await sleep(400);
        g.go();
        await sweeps;
        const ended = await ending;
        assert.equal(ended.status, 200, JSON.stringify(ended.body));
        assert.equal((await ruling).status, 200);
        await drain(c.id);
        rec.final = await totals(c);
        // L was PAID by the real late-arrival step here (not OPEN): same converged numbers, obligation absent or closed, every key once
        const t = await totals(c);
        assert.deepEqual({ client: t.client, pt: t.pt, platform: t.platform, pending: t.pending, sum: t.sum }, { ...FINAL[outcome], pending: 0, sum: PRICE }, "R7 money");
        assert.equal((await obligations(c.txnId)).filter((o) => o.kind === "REFUND_SHORT" || (o.status === "OPEN" && o.unpaid > 0)).length, 0);
        for (const k of [`PT_LATE_ARRIVAL:${S.id}`, `CONTRACT_TERMINATE:${c.id}`, outcome === "COMPLETED" ? `SESSION_RELEASE:${S.id}` : `PT_NO_SHOW:${S.id}`]) assert.equal(await opCount(k), 1, k);
        await H.invariant("R7");
      } finally {
        g.go();
        g.restore();
      }
    });
  });
}

// ═════════════════════ R8: two sessions with L OPEN; one settled, one in flight; the ending in between ═════════════════════
for (const outcome of OUTCOMES) {
  test(`R8 ${outcome}: two sessions with L OPEN: S1 settled, S2's money call HELD (seam A), the ending runs in between and drains S2 -> both L closed once, converged for 2 sessions`, { skip }, async () => {
    await scenario(`R8.${outcome}`, async (rec) => {
      const pt = await H.makePt();
      const c = await H.paidContract(pt, { price: PRICE, totalSessions: 4 });
      const sessions = [await lateSession(c), await lateSession(c)];
      await H.stopPayment();
      assert.deepEqual(await runSweep(), { scanned: 2, resolved: 2 });
      await H.startPayment();
      for (const S of sessions) {
        const row = await H.m.prisma.sessionSettlement.findUniqueOrThrow({ where: { idempotencyKey: `PT_LATE_ARRIVAL:${S.id}` } });
        await H.m.prisma.sessionSettlement.update({ where: { id: row.id }, data: { status: "UNCONFIRMED" } });
        assert.equal(await H.m.payout.settleEndedCompensationRow(row.id), "RECORDED");
        await dispute(c, S.id);
      }
      const adminToken = H.tokenFor(randomUUID(), "ADMIN");
      assert.equal((await rule(adminToken, sessions[0].id, outcome)).status, 200); // S1 settled
      const method = outcome === "COMPLETED" ? "releaseSession" : "noShow";
      const g = gate(method);
      try {
        const second = rule(adminToken, sessions[1].id, outcome); // S2: intent committed, call held
        await g.entered;
        const ending = endContract(c);
        const ended = await ending;
        assert.equal(ended.status, 200, JSON.stringify(ended.body));
        g.go();
        assert.equal((await second).status, 200);
        await drain(c.id);
        const t = await totals(c);
        // two sessions decided: COMPLETED 2x -> client 2L + 90% of 500,000, PT 2x112,500 + 45,000, platform 2x12,500 + 5,000; NO_SHOW 2x -> client 2V + 450,000 ...
        const exp = outcome === "COMPLETED" ? { client: 250_000 + 450_000, pt: 225_000 + 45_000, platform: 25_000 + 5_000 } : { client: 500_000 + 450_000, pt: 45_000, platform: 5_000 };
        assert.deepEqual({ client: t.client, pt: t.pt, platform: t.platform, pending: t.pending, sum: t.sum }, { ...exp, pending: 0, sum: PRICE }, "R8 money");
        const obs = await obligations(c.txnId);
        assert.deepEqual(obs.map((o) => [o.kind, o.status, o.paid, o.unpaid]), [["LATE_ARRIVAL", "PAID_VIA_LEDGER", L, 0], ["LATE_ARRIVAL", "PAID_VIA_LEDGER", L, 0]]);
        assert.equal(await settleEvents(c.txnId), 2);
        for (const S of sessions) assert.equal(await opCount(outcome === "COMPLETED" ? `SESSION_RELEASE:${S.id}` : `PT_NO_SHOW:${S.id}`), 1);
        assert.equal(await opCount(`CONTRACT_TERMINATE:${c.id}`), 1);
        rec.final = t;
        await H.invariant("R8");
      } finally {
        g.go();
        g.restore();
      }
    });
  });
}

// ═════════════════════ REPRO: the 1/6 deviation of 31/10, controlled ═════════════════════
test("REPRO 1/6: a terminate priced on a snapshot that is OLDER than the ledger (a release landed first): the ledger now REFUSES it 409 TERMINATE_SNAPSHOT_STALE and writes nothing (before the fix: HTTP 500 'splitThreeWays needs a non-negative total, got -125000', pending 750,000 left, the contract half-ended)", { skip }, async () => {
  await scenario("REPRO", async (rec) => {
    const pt = await H.makePt();
    const c = await H.paidContract(pt, { price: PRICE, totalSessions: 4 });
    const pc = H.m.paymentClient as any;
    const base = {
      transactionId: c.txnId, price: c.price!.toString(), totalSessions: c.totalSessions,
      rates: { platformRate: c.platformRate.toString(), ptRate: c.ptRate.toString(), gymRate: c.gymRate.toString() },
      parties: { ptUserId: c.ptUserId, gymId: c.gymId ?? null, clientUserId: c.clientUserId },
    };
    const late = await pc.recordLateArrivalObligation({ ...base, label: "late", idempotencyKey: `PT_LATE_ARRIVAL:${c.id}:s1`, reason: "ending: D77 never performed by the ledger" });
    assert.equal(late.recordedOnly, true);
    // the caller's snapshot is taken here: used 0, alreadyReleased 0 ...
    const snapshot = { usedSessions: 0, compensatedSessions: 0, alreadyReleased: { pt: "0", gym: "0", platform: "0" } };
    // ... and the release (which pays the OPEN L from the session) reaches the ledger BEFORE the terminate does
    const rel = await pc.releaseSession({ ...base, label: "rel", idempotencyKey: `SESSION_RELEASE:${c.id}:s1`, settleLateOpen: true });
    assert.equal(rel.lateOpenSettled.toStatus, "PAID_VIA_LEDGER");
    const before = await totals(c);
    let error: any;
    try {
      await pc.terminate({ ...base, ...snapshot, reason: "MUTUAL", label: "end", idempotencyKey: `CONTRACT_TERMINATE:${c.id}` });
    } catch (e) {
      error = e;
    }
    assert.equal(error?.response?.status, 409);
    assert.equal(error?.response?.data?.error?.code, "TERMINATE_SNAPSHOT_STALE");
    assert.equal(await opCount(`CONTRACT_TERMINATE:${c.id}`), 0);
    assert.deepEqual(await totals(c), before, "nothing written");
    rec.explanation = "terminate priced the ending on used 0 -> refund 1,000,000; the release had already paid L (125,000 deducted as lateArrival) -> 1,000,000 - 125,000 - 1,000,000 < 0 -> splitThreeWays threw; the ledger rolled back, but the caller got a 500 and retried the same stale numbers forever";
    // with a FRESH snapshot (what the caller does after a refusal) the ending succeeds
    const ok = await pc.terminate({ ...base, usedSessions: 1, compensatedSessions: 0, alreadyReleased: { pt: rel.released.pt, gym: rel.released.gym, platform: rel.released.platform }, reason: "MUTUAL", label: "end", idempotencyKey: `CONTRACT_TERMINATE:${c.id}` });
    assert.equal(ok.refund, "750000.00");
    assert.deepEqual(await totals(c), { client: 875_000, pt: 112_500, platform: 12_500, pending: 0, sum: PRICE });
    await H.invariant("repro");
  });
});
