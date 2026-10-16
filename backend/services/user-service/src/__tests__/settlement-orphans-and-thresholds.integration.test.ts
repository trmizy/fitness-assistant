/**
 * D64-A (orphan settlement rows precisely identified; parked ONLY when SETTLEMENT_SWEEP_PARK_ORPHANS="true" - OFF by default since D65) and D64-C (attempt thresholds, attention ordering).
 *
 * Evidence label: BACKEND INTEGRATION against the isolated *_test database (real sweep, real SQL, real contract / session rows, the
 * real scripts/orphan-settlement-rows.ts run as a child process in the dry-run test). ONLY payment-service is stubbed at the
 * paymentClient boundary (TEST FIXTURE), and it records every call so "no ledger call for a parked row" is asserted, not assumed.
 * Run:
 *   DATABASE_URL="postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_user_d64_test?schema=public" \
 *     ./node_modules/.bin/tsx --test --test-concurrency=1 src/__tests__/settlement-orphans-and-thresholds.integration.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { logger } from "@gym-coach/shared";
import { prisma } from "../repositories/profile.repository";
import { paymentClient } from "../clients/payment.client";
import { sessionSettlementRepository } from "../repositories/session-settlement.repository";
import { runSettlementSweep } from "../services/session-settlement-sweep.service";
import { settlementAttemptLevel, settlementMaxAttempts, settlementWarnAttempts } from "../services/session-settlement.service";
import { classifySettlementContract, parkOrphansEnabled } from "../services/settlement-orphan";
import { terminateContractMoney } from "../services/contract-payout.service";
import { addSession, cleanup, makeContract, makePt, patch, skip, stubs } from "./pt-restriction.test-helpers";

const OLD = new Date("2026-08-01T00:00:00Z");

async function orphanRow(kind: "SESSION_RELEASE" | "PT_NO_SHOW_COMPENSATION" | "CONTRACT_TERMINATION", i: number, extra: Record<string, unknown> = {}) {
  const contractId = (extra.contractId as string) ?? randomUUID();
  return prisma.sessionSettlement.create({
    data: {
      id: randomUUID(),
      kind,
      idempotencyKey: kind === "CONTRACT_TERMINATION" ? `CONTRACT_TERMINATE:${contractId}` : `${kind}:orphan-${i}-${randomUUID()}`,
      contractId,
      sessionId: kind === "CONTRACT_TERMINATION" ? null : randomUUID(),
      reason: kind === "CONTRACT_TERMINATION" ? "COMPLETED" : null,
      status: "FAILED",
      attempts: 1,
      lastError: "payment-service unreachable",
      createdAt: new Date(OLD.getTime() + i * 1000),
      ...extra,
    },
  });
}

/** Runs fn with SETTLEMENT_SWEEP_PARK_ORPHANS set to `value` (undefined = unset), always restoring the previous value. */
async function withParkFlag<T>(value: string | undefined, fn: () => Promise<T>): Promise<T> {
  const keep = process.env.SETTLEMENT_SWEEP_PARK_ORPHANS;
  if (value === undefined) delete process.env.SETTLEMENT_SWEEP_PARK_ORPHANS;
  else process.env.SETTLEMENT_SWEEP_PARK_ORPHANS = value;
  try {
    return await fn();
  } finally {
    if (keep === undefined) delete process.env.SETTLEMENT_SWEEP_PARK_ORPHANS;
    else process.env.SETTLEMENT_SWEEP_PARK_ORPHANS = keep;
  }
}

const makeOld = () => prisma.$executeRaw`UPDATE session_settlements SET updated_at = ${OLD}`;
const snapshot = async () =>
  (await prisma.sessionSettlement.findMany({ orderBy: { id: "asc" } })).map((r) => ({ id: r.id, status: r.status, attempts: r.attempts, lastError: r.lastError, updatedAt: r.updatedAt.getTime(), settledAt: r.settledAt }));

/** A live, processable row: a delivered session whose release failed once. */
async function liveRow() {
  const pt = await makePt();
  const contract = await makeContract(pt, { usedSessions: 1 });
  const session = await addSession(contract, "COMPLETED", new Date(Date.now() - 86_400_000), { sessionDeducted: true });
  const row = await prisma.sessionSettlement.create({
    data: { kind: "SESSION_RELEASE", idempotencyKey: `SESSION_RELEASE:${session.id}`, contractId: contract.id, sessionId: session.id, status: "FAILED", attempts: 1, lastError: "payment-service unreachable" },
  });
  return { pt, contract, session, row };
}

// ── pure rules ───────────────────────────────────────────────────────────────────────────────────────────────────────

test("orphan rule (pure): a missing contract and a never-paid contract are orphans; a paid-but-unpriceable one is NOT (needs reconciliation); a contract awaiting payment waits", () => {
  assert.deepEqual(
    [classifySettlementContract("c", null).kind, (classifySettlementContract("c", null) as any).code],
    ["ORPHAN", "CONTRACT_MISSING"],
  );
  const noPay = classifySettlementContract("c", { paymentTransactionId: null, price: 5_000_000, totalSessions: 10, status: "ACTIVE" }) as any;
  assert.deepEqual([noPay.kind, noPay.code], ["ORPHAN", "NO_PAYMENT"]);
  assert.equal(classifySettlementContract("c", { paymentTransactionId: null, price: 5_000_000, totalSessions: 10, status: "PENDING_PAYMENT" }).kind, "WAIT");
  const unpriced = classifySettlementContract("c", { paymentTransactionId: "txn-1", price: null, totalSessions: 10, status: "ACTIVE" }) as any;
  assert.deepEqual([unpriced.kind, unpriced.code], ["NEEDS_RECONCILIATION", "UNPAYABLE_TERMS"]);
  assert.equal(classifySettlementContract("c", { paymentTransactionId: "txn-1", price: 5_000_000, totalSessions: 0, status: "ACTIVE" }).kind, "NEEDS_RECONCILIATION");
  assert.equal(classifySettlementContract("c", { paymentTransactionId: "txn-1", price: 5_000_000, totalSessions: 10, status: "ACTIVE" }).kind, "LIVE");
});

test("D65 parkOrphansEnabled (pure): OFF unless the variable is explicitly \"true\" - unset, empty, false, 1, yes, on, garbage are all OFF", () => {
  const cases: Array<[string | undefined, boolean]> = [
    [undefined, false], ["", false], ["  ", false], ["false", false], ["0", false], ["1", false], ["yes", false], ["on", false], ["truee", false], ["garbage", false],
    ["true", true], ["TRUE", true], [" True ", true],
  ];
  for (const [value, expected] of cases) {
    const keep = process.env.SETTLEMENT_SWEEP_PARK_ORPHANS;
    if (value === undefined) delete process.env.SETTLEMENT_SWEEP_PARK_ORPHANS;
    else process.env.SETTLEMENT_SWEEP_PARK_ORPHANS = value;
    try {
      assert.equal(parkOrphansEnabled(), expected, `SETTLEMENT_SWEEP_PARK_ORPHANS=${JSON.stringify(value)}`);
    } finally {
      if (keep === undefined) delete process.env.SETTLEMENT_SWEEP_PARK_ORPHANS;
      else process.env.SETTLEMENT_SWEEP_PARK_ORPHANS = keep;
    }
  }
});

test("thresholds (pure): defaults 8 / 12, early warning always below the cap, invalid env falls back, all configurable", () => {
  const keep = { w: process.env.SETTLEMENT_WARN_ATTEMPTS, m: process.env.SETTLEMENT_MAX_ATTEMPTS };
  try {
    delete process.env.SETTLEMENT_WARN_ATTEMPTS;
    delete process.env.SETTLEMENT_MAX_ATTEMPTS;
    assert.deepEqual([settlementWarnAttempts(), settlementMaxAttempts()], [8, 12]);
    assert.deepEqual([7, 8, 11, 12, 30].map(settlementAttemptLevel), ["OK", "WARN", "WARN", "CAP", "CAP"]);
    process.env.SETTLEMENT_MAX_ATTEMPTS = "5";
    assert.equal(settlementWarnAttempts(), 4, "a warning of 8 cannot sit at or above a cap of 5: it is pulled to cap-1");
    process.env.SETTLEMENT_WARN_ATTEMPTS = "2";
    assert.deepEqual([1, 2, 4, 5].map(settlementAttemptLevel), ["OK", "WARN", "WARN", "CAP"]);
    process.env.SETTLEMENT_MAX_ATTEMPTS = "garbage";
    process.env.SETTLEMENT_WARN_ATTEMPTS = "-3";
    assert.deepEqual([settlementWarnAttempts(), settlementMaxAttempts()], [8, 12], "invalid values fall back to the defaults");
    process.env.SETTLEMENT_MAX_ATTEMPTS = "1";
    assert.equal(settlementAttemptLevel(0), "OK");
    assert.equal(settlementAttemptLevel(1), "CAP", "with a cap of 1 there is no warning level");
  } finally {
    for (const [k, v] of [["SETTLEMENT_WARN_ATTEMPTS", keep.w], ["SETTLEMENT_MAX_ATTEMPTS", keep.m]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

// ── D64-A ────────────────────────────────────────────────────────────────────────────────────────────────────────────

test("D64-A (SETTLEMENT_SWEEP_PARK_ORPHANS=true): 65 orphans of three kinds sit in front of 3 valid rows - the valid rows are retried, the orphans are parked with an explicit reason, nothing deleted/settled/paid, and a re-run changes nothing", { skip }, () => withParkFlag("true", async () => {
  await prisma.sessionSettlement.deleteMany({});
  const kinds = ["SESSION_RELEASE", "PT_NO_SHOW_COMPENSATION", "CONTRACT_TERMINATION"] as const;
  for (let i = 0; i < 65; i++) await orphanRow(kinds[i % 3], i);
  await makeOld();
  const lives = [await liveRow(), await liveRow(), await liveRow()];
  const s = stubs();
  try {
    const orphanIds = (await prisma.sessionSettlement.findMany({ where: { id: { notIn: lives.map((l) => l.row.id) } }, select: { id: true } })).map((r) => r.id);
    assert.equal(orphanIds.length, 65);

    for (let tick = 0; tick < 3; tick++) await runSettlementSweep();

    // valid rows were retried behind 65 orphans: three release calls, nothing else reached payment-service
    assert.deepEqual(s.payments.map((p) => p.method), ["releaseSession", "releaseSession", "releaseSession"], "no ledger call was made for any parked row");
    for (const l of lives) assert.equal((await prisma.sessionSettlement.findUniqueOrThrow({ where: { id: l.row.id } })).status, "SETTLED");

    const orphans = await prisma.sessionSettlement.findMany({ where: { id: { in: orphanIds } } });
    assert.equal(orphans.length, 65, "nothing deleted");
    for (const o of orphans) {
      assert.equal(o.status, "FAILED", "never SETTLED / never paid");
      assert.equal(o.settledAt, null);
      assert.match(o.lastError ?? "", /^ENDED_UNSETTLED:CONTRACT_MISSING contract [0-9a-f-]+ no longer exists.*; previous error: payment-service unreachable$/);
    }
    // idempotent: the same state after one more tick, byte for byte (no updated_at churn, no attempt increments)
    const before = await snapshot();
    assert.deepEqual(await runSettlementSweep(), { scanned: 0, retried: 0 });
    assert.deepEqual(await snapshot(), before, "re-running the sweep changes nothing");
    assert.equal(s.payments.length, 3);
  } finally {
    s.restore();
    for (const l of lives) await cleanup([l.pt], [l.contract.id]);
    await prisma.sessionSettlement.deleteMany({});
  }
}));

test("D65 DEFAULT OFF (variable UNSET): 65 orphans of three kinds + a never-paid contract's row sit in front of 3 valid rows - the valid rows are retried, every orphan row is byte-identical afterwards (not parked, deleted or SETTLED), zero payment calls for orphans, and re-runs change nothing", { skip }, () => withParkFlag(undefined, async () => {
  await prisma.sessionSettlement.deleteMany({});
  const kinds = ["SESSION_RELEASE", "PT_NO_SHOW_COMPENSATION", "CONTRACT_TERMINATION"] as const;
  for (let i = 0; i < 65; i++) await orphanRow(kinds[i % 3], i);
  const ptNoPay = await makePt();
  const unpaid = await makeContract(ptNoPay, { paymentTransactionId: null });
  await orphanRow("SESSION_RELEASE", 66, { contractId: unpaid.id }); // NO_PAYMENT orphan: the contract exists
  await makeOld();
  const lives = [await liveRow(), await liveRow(), await liveRow()];
  const s = stubs();
  try {
    const liveIds = lives.map((l) => l.row.id);
    const orphanSnap = async () =>
      (await prisma.sessionSettlement.findMany({ where: { id: { notIn: liveIds } }, orderBy: { id: "asc" } })).map((r) => JSON.stringify({ ...r, updatedAt: r.updatedAt.toISOString(), createdAt: r.createdAt.toISOString() }));
    const before = await orphanSnap();
    assert.equal(before.length, 66);

    for (let tick = 0; tick < 3; tick++) await runSettlementSweep();

    assert.deepEqual(s.payments.map((p) => p.method), ["releaseSession", "releaseSession", "releaseSession"], "only the 3 valid rows reached payment-service: no ledger call for any orphan");
    for (const l of lives) assert.equal((await prisma.sessionSettlement.findUniqueOrThrow({ where: { id: l.row.id } })).status, "SETTLED", "valid rows were retried behind the orphans");
    assert.deepEqual(await orphanSnap(), before, "all 66 orphan rows are byte-identical: nothing parked, deleted, SETTLED, no attempt/updated_at churn");
    assert.ok(before.every((j) => !JSON.parse(j).lastError.startsWith("ENDED_UNSETTLED:")), "no orphan marker was written");
    assert.ok((await prisma.contract.findUnique({ where: { id: unpaid.id } })), "the contract itself is untouched");
  } finally {
    s.restore();
    for (const l of lives) await cleanup([l.pt], [l.contract.id]);
    await cleanup([ptNoPay], [unpaid.id]);
    await prisma.sessionSettlement.deleteMany({});
  }
}));

test("D64-A (SETTLEMENT_SWEEP_PARK_ORPHANS=true): a row whose contract EXISTS is never parked as an orphan; a contract that was never paid is (NO_PAYMENT); a contract still awaiting payment is left alone", { skip }, () => withParkFlag("true", async () => {
  await prisma.sessionSettlement.deleteMany({});
  const live = await liveRow();
  const ptNoPay = await makePt();
  const unpaid = await makeContract(ptNoPay, { paymentTransactionId: null });
  const unpaidSession = await addSession(unpaid, "COMPLETED", new Date(Date.now() - 86_400_000), { sessionDeducted: true });
  const unpaidRow = await prisma.sessionSettlement.create({
    data: { kind: "SESSION_RELEASE", idempotencyKey: `SESSION_RELEASE:${unpaidSession.id}`, contractId: unpaid.id, sessionId: unpaidSession.id, status: "FAILED", attempts: 1, lastError: "x" },
  });
  const ptWait = await makePt();
  const waiting = await makeContract(ptWait, { paymentTransactionId: null, status: "PENDING_PAYMENT" });
  const waitingSession = await addSession(waiting, "COMPLETED", new Date(Date.now() - 86_400_000), { sessionDeducted: true });
  const waitingRow = await prisma.sessionSettlement.create({
    data: { kind: "SESSION_RELEASE", idempotencyKey: `SESSION_RELEASE:${waitingSession.id}`, contractId: waiting.id, sessionId: waitingSession.id, status: "FAILED", attempts: 1, lastError: "y" },
  });
  const s = stubs();
  try {
    await runSettlementSweep();
    assert.deepEqual(s.payments.map((p) => p.method), ["releaseSession"], "only the live contract's row reached payment-service");
    assert.equal((await prisma.sessionSettlement.findUniqueOrThrow({ where: { id: live.row.id } })).status, "SETTLED", "a live contract's row is run, not parked");
    const u = await prisma.sessionSettlement.findUniqueOrThrow({ where: { id: unpaidRow.id } });
    assert.equal(u.status, "FAILED");
    assert.match(u.lastError ?? "", /^ENDED_UNSETTLED:NO_PAYMENT contract .* has no payment transaction.*previous error: x$/);
    const w = await prisma.sessionSettlement.findUniqueOrThrow({ where: { id: waitingRow.id } });
    assert.deepEqual([w.status, w.lastError, w.attempts], ["FAILED", "y", 1], "a contract still awaiting its payment is not provably unpaid: the row is left exactly as it is");
    assert.ok((await prisma.contract.findUnique({ where: { id: unpaid.id } })), "the contract itself is untouched");
  } finally {
    s.restore();
    await cleanup([live.pt], [live.contract.id]);
    await cleanup([ptNoPay], [unpaid.id]);
    await cleanup([ptWait], [waiting.id]);
  }
}));

test("D64-A: a PAID contract that cannot be priced is NEEDS_RECONCILIATION (visible, an ending stays refused, no payment call) - not silently dropped as an orphan (flag UNSET: this protection does not depend on orphan parking)", { skip }, () => withParkFlag(undefined, async () => {
  await prisma.sessionSettlement.deleteMany({});
  const pt = await makePt();
  const c = await makeContract(pt, { price: null, usedSessions: 1 });
  const session = await addSession(c, "COMPLETED", new Date(Date.now() - 86_400_000), { sessionDeducted: true });
  const row = await prisma.sessionSettlement.create({
    data: { kind: "SESSION_RELEASE", idempotencyKey: `SESSION_RELEASE:${session.id}`, contractId: c.id, sessionId: session.id, status: "FAILED", attempts: 1, lastError: "z" },
  });
  const s = stubs();
  try {
    await runSettlementSweep();
    assert.equal(s.payments.length, 0);
    const after = await prisma.sessionSettlement.findUniqueOrThrow({ where: { id: row.id } });
    assert.equal(after.status, "FAILED");
    assert.match(after.lastError ?? "", /^NEEDS_RECONCILIATION: UNPAYABLE_TERMS: contract .* has a payment transaction but no price.*previous error: z$/);
    assert.ok((await sessionSettlementRepository.findNeedingAttention(1000)).some((r) => r.id === row.id), "still visible to a human");
    await assert.rejects(
      () => terminateContractMoney(c.id, "CLIENT_CANCELLED", { cancelledBy: c.clientUserId }),
      (e: any) => e.status === 409 && e.code === "SESSION_SETTLEMENT_PENDING",
    );
  } finally {
    s.restore();
    await cleanup([pt], [c.id]);
  }
}));

test("D64-A (SETTLEMENT_SWEEP_PARK_ORPHANS=true): the dry-run script lists EXACTLY the rows the sweep then parks, writes nothing, and --apply writes the same last_error the sweep writes", { skip }, () => withParkFlag("true", async () => {
  await prisma.sessionSettlement.deleteMany({});
  const live = await liveRow();
  const ptNoPay = await makePt();
  const unpaid = await makeContract(ptNoPay, { paymentTransactionId: null });
  const ptRec = await makePt();
  const unpriced = await makeContract(ptRec, { price: null });
  const orphans = [
    await orphanRow("SESSION_RELEASE", 1),
    await orphanRow("CONTRACT_TERMINATION", 2),
    await orphanRow("SESSION_RELEASE", 3, { contractId: unpaid.id, sessionId: randomUUID() }),
    await orphanRow("PT_NO_SHOW_COMPENSATION", 4, { contractId: unpriced.id, sessionId: randomUUID() }),
  ];
  await makeOld();
  const urlOf = () => process.env.DATABASE_URL!;
  const script = path.join(__dirname, "..", "scripts", "orphan-settlement-rows.ts");
  const run = (...args: string[]) => {
    const out = path.join(os.tmpdir(), `d64-orphans-${randomUUID()}.json`);
    const text = execFileSync(process.execPath, ["--import", "tsx", script, "--json", out, ...args], {
      env: { ...process.env, USER_DATABASE_URL: urlOf() },
      cwd: path.join(__dirname, "..", ".."),
      encoding: "utf8",
    });
    const json = JSON.parse(fs.readFileSync(out, "utf8"));
    fs.unlinkSync(out);
    return { text, json };
  };
  const s = stubs();
  try {
    const before = await snapshot();
    const dry = run();
    assert.deepEqual(await snapshot(), before, "the dry-run wrote nothing");
    assert.match(dry.text, /DRY RUN ONLY/);
    const listed = (dry.json.preImage as Array<{ id: string }>).map((r) => r.id).sort();
    assert.deepEqual(listed, orphans.map((o) => o.id).sort(), "the dry-run lists the 4 rows (2 missing-contract, 1 never-paid, 1 unpriceable) and not the live one");
    assert.equal(dry.json.counts.leftToSweep, 1);

    // Apply on a copy of the state via the script, remember what it wrote, put the state back, then let the SWEEP do it.
    run("--apply", "--expect-rows", "4");
    const scriptWrote = new Map((await prisma.sessionSettlement.findMany({ where: { id: { in: listed } } })).map((r) => [r.id, r.lastError]));
    for (const o of orphans) await prisma.$executeRaw`UPDATE session_settlements SET last_error = ${o.lastError}, updated_at = ${OLD} WHERE id = ${o.id}`;
    await runSettlementSweep();
    for (const o of orphans) {
      const swept = (await prisma.sessionSettlement.findUniqueOrThrow({ where: { id: o.id } })).lastError;
      assert.equal(swept, scriptWrote.get(o.id), "script and sweep write the identical reason for the identical row");
    }
    assert.equal((await prisma.sessionSettlement.findUniqueOrThrow({ where: { id: live.row.id } })).status, "SETTLED", "the live row was left to the sweep and settled");
    const again = run();
    assert.equal(again.json.counts.sweepWouldPark, 0, "after the sweep the dry-run finds nothing more to park");
  } finally {
    s.restore();
    await cleanup([live.pt], [live.contract.id]);
    await cleanup([ptNoPay], [unpaid.id]);
    await cleanup([ptRec], [unpriced.id]);
    await prisma.sessionSettlement.deleteMany({});
  }
}));

// ── D64-C ────────────────────────────────────────────────────────────────────────────────────────────────────────────

test("D64-C: early warning BEFORE the cap, then at the cap the step is parked NEEDS_RECONCILIATION with an immediate [MoneyAttention] alert; nothing is retried after", { skip }, async () => {
  await prisma.sessionSettlement.deleteMany({});
  const live = await liveRow();
  const lines: Array<{ level: string; text: string }> = [];
  const restoreWarn = patch(logger, "warn", (...a: unknown[]) => lines.push({ level: "warn", text: JSON.stringify(a) }));
  const restoreErr = patch(logger, "error", (...a: unknown[]) => lines.push({ level: "error", text: JSON.stringify(a) }));
  let calls = 0;
  const restorePay = patch(paymentClient, "releaseSession", async () => {
    calls++;
    throw new Error("payment-service 503");
  });
  process.env.SETTLEMENT_WARN_ATTEMPTS = "3";
  process.env.SETTLEMENT_MAX_ATTEMPTS = "5";
  process.env.SETTLEMENT_BACKOFF_BASE_MS = "0";
  try {
    await prisma.sessionSettlement.update({ where: { id: live.row.id }, data: { attempts: 0, lastError: "first failure" } });
    for (let i = 0; i < 8; i++) await runSettlementSweep();
    assert.equal(calls, 5, "retried up to the cap, never after");
    const attention = lines.filter((l) => l.text.includes("[MoneyAttention]"));
    const early = attention.filter((l) => l.text.includes("early warning"));
    assert.deepEqual(early.map((l) => /has failed (\d+) times/.exec(l.text)?.[1]), ["3", "4"], "warned at attempt 3 and 4 - before the cap of 5");
    assert.ok(early.every((l) => l.level === "warn"));
    const alert = attention.filter((l) => l.text.includes("needs a human"));
    assert.equal(alert.length, 1, "exactly one immediate alert, at the cap");
    assert.equal(alert[0].level, "error");
    assert.match(alert[0].text, /parked NEEDS_RECONCILIATION after 5 failed attempts \(cap 5\)/);
    const row = await prisma.sessionSettlement.findUniqueOrThrow({ where: { id: live.row.id } });
    assert.equal(row.status, "FAILED");
    assert.match(row.lastError ?? "", /^NEEDS_RECONCILIATION: 5 failed attempts \(cap 5\)/);
    assert.ok((await sessionSettlementRepository.findNeedingAttention(1000)).some((r) => r.id === live.row.id));
  } finally {
    delete process.env.SETTLEMENT_WARN_ATTEMPTS;
    delete process.env.SETTLEMENT_MAX_ATTEMPTS;
    delete process.env.SETTLEMENT_BACKOFF_BASE_MS;
    restorePay();
    restoreErr();
    restoreWarn();
    await cleanup([live.pt], [live.contract.id]);
    await prisma.sessionSettlement.deleteMany({});
  }
});

test("D64-C: the attention list is ordered CONFLICT first, then the larger amount, then more attempts - and terminal orphans are not 'attention'", { skip }, async () => {
  await prisma.sessionSettlement.deleteMany({});
  const pt = await makePt();
  const small = await makeContract(pt, { price: 1_000_000, totalSessions: 10 }); // 100.000 per session
  const big = await makeContract(pt, { price: 20_000_000, totalSessions: 10 }); // 2.000.000 per session
  const mk = (contractId: string, lastError: string, attempts: number, i: number) =>
    prisma.sessionSettlement.create({
      data: { kind: "SESSION_RELEASE", idempotencyKey: `SESSION_RELEASE:att-${i}-${randomUUID()}`, contractId, sessionId: randomUUID(), status: "FAILED", attempts, lastError },
    });
  const smallOld = await mk(small.id, "NEEDS_RECONCILIATION: small, oldest", 12, 1);
  const bigRec = await mk(big.id, "NEEDS_RECONCILIATION: big", 12, 2);
  const smallConflict = await mk(small.id, "CONFLICT: terminate disagrees", 1, 3);
  const bigMoreAttempts = await mk(big.id, "NEEDS_RECONCILIATION: big, more attempts", 15, 4);
  const orphan = await mk(randomUUID(), "ENDED_UNSETTLED:CONTRACT_MISSING contract x no longer exists", 40, 5);
  const orphan2 = await mk(small.id, "ENDED_UNSETTLED:NO_PAYMENT contract y has no payment transaction", 40, 6);
  await prisma.$executeRaw`UPDATE session_settlements SET updated_at = ${OLD} WHERE id = ${smallOld.id}`;
  try {
    const list = await sessionSettlementRepository.findNeedingAttention(5);
    assert.deepEqual(
      list.map((r) => r.id),
      [smallConflict.id, bigMoreAttempts.id, bigRec.id, smallOld.id],
      "CONFLICT first even though it is the smallest amount with the fewest attempts; then 2.000.000 before 100.000; then more attempts first",
    );
    assert.ok(!list.some((r) => r.id === orphan.id || r.id === orphan2.id), "terminal orphans (nothing owed) are not listed however many attempts they had");
    assert.equal((await sessionSettlementRepository.findNeedingAttention(5, 2)).length, 2, "limit applies after ranking");
  } finally {
    await prisma.sessionSettlement.deleteMany({});
    await cleanup([pt], [small.id, big.id]);
  }
});
