/**
 * D55 / Câu D - legacy sessions left open on ended contracts: the inventory and the guarded cleanup script
 * (src/scripts/legacy-ended-contract-sessions.ts).
 *
 * Evidence label: BACKEND INTEGRATION against TWO isolated databases (this suite never touches dev):
 *   LEGACY_TEST_USER_DATABASE_URL    = .../gymcoach_user_legacy_test      (prisma migrate deploy of user-service)
 *   LEGACY_TEST_PAYMENT_DATABASE_URL = .../gymcoach_payment_legacy_test   (prisma migrate deploy of payment-service)
 * Both database names must end in `_legacy_test`, otherwise the suite skips. Run:
 *   LEGACY_TEST_USER_DATABASE_URL="postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_user_legacy_test?schema=public" \
 *   LEGACY_TEST_PAYMENT_DATABASE_URL="postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_payment_legacy_test?schema=public" \
 *     ./node_modules/.bin/tsx --test src/__tests__/legacy-ended-contract-sessions.integration.test.ts
 * TEST FIXTURE: rows are inserted directly at the state a legacy contract was left in; payment-service is not running
 * (the script must never call it) - the ledger side is rows of the real `ledger_operations` table.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  AUDIT_ACTION_CLOSED,
  AUDIT_ACTION_RESTORED,
  LEGACY_CLEANUP_REASON_PREFIX,
  applyPlan,
  buildInventory,
  buildReport,
  dbNameOf,
  main,
  makeClient,
  readOnly,
  restoreFromLog,
  type Databases,
  type Scope,
} from "../scripts/legacy-ended-contract-sessions";

const USER_URL = process.env.LEGACY_TEST_USER_DATABASE_URL ?? "";
const PAYMENT_URL = process.env.LEGACY_TEST_PAYMENT_DATABASE_URL ?? "";
const usable = /_legacy_test$/.test(USER_URL ? dbNameOf(USER_URL) : "") && /_legacy_test$/.test(PAYMENT_URL ? dbNameOf(PAYMENT_URL) : "");
const skip = usable ? false : "Requires LEGACY_TEST_USER_DATABASE_URL / LEGACY_TEST_PAYMENT_DATABASE_URL pointing at *_legacy_test databases.";

const DAY = 24 * 3600 * 1000;
const MIN = 60 * 1000;
const P = {
  user: usable ? makeClient(USER_URL) : (null as never),
  payment: usable ? makeClient(PAYMENT_URL) : (null as never),
};
const db: Databases = usable
  ? { user: P.user, payment: P.payment, userDbName: dbNameOf(USER_URL), paymentDbName: dbNameOf(PAYMENT_URL) }
  : (null as never);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "legacy-sessions-"));

interface Fixture {
  ids: Record<string, string>;
  contracts: Record<string, string>;
}

async function wipe() {
  await P.user.auditLog.deleteMany({});
  await P.user.sessionSettlement.deleteMany({});
  await P.user.session.deleteMany({});
  await P.user.contract.deleteMany({});
  await P.payment.$executeRawUnsafe("DELETE FROM ledger_operations");
}

async function ledgerOp(key: string) {
  await P.payment.$executeRawUnsafe("INSERT INTO ledger_operations (id, key, result) VALUES ($1, $2, '{}'::jsonb)", randomUUID(), key);
}

/** Every class, every exclusion reason, every scope dimension. Per-session value = 5_000_000 / 10 = 500_000 dong. */
async function seed(): Promise<Fixture> {
  await wipe();
  const now = Date.now();
  const ids: Record<string, string> = {};
  const contracts: Record<string, string> = {};
  const mkContract = async (name: string, data: Record<string, unknown>) => {
    const id = randomUUID();
    contracts[name] = id;
    await P.user.contract.create({
      data: {
        id,
        ptUserId: randomUUID(),
        clientUserId: randomUUID(),
        packageName: "Gói 10 buổi",
        totalSessions: 10,
        price: 5_000_000,
        paymentTransactionId: `txn-${randomUUID()}`,
        status: "CANCELLED",
        ...data,
      } as any,
    });
    return id;
  };
  const mkSession = async (name: string, contractId: string, status: string, extra: Record<string, unknown> = {}) => {
    const c = await P.user.contract.findUniqueOrThrow({ where: { id: contractId } });
    const id = randomUUID();
    ids[name] = id;
    const start = new Date(now + (Object.keys(ids).length + 1) * 3600_000);
    await P.user.session.create({
      data: {
        id,
        contractId,
        ptUserId: c.ptUserId,
        clientUserId: c.clientUserId,
        status: status as any,
        scheduledStartAt: start,
        scheduledEndAt: new Date(start.getTime() + 3600_000),
        ...extra,
      } as any,
    });
    return id;
  };

  // Ended 2 days ago, client cancelled. One session of every kind.
  const cEnded = await mkContract("ended", { status: "CANCELLED", terminationReason: "CLIENT_CANCELLED", terminatedAt: new Date(now - 2 * DAY) });
  await mkSession("a_eligible_confirmed", cEnded, "CONFIRMED");
  await mkSession("a_eligible_requested", cEnded, "REQUESTED", { cancelledBy: null });
  const sLedger = await mkSession("a_ledger_release", cEnded, "CONFIRMED");
  await ledgerOp(`SESSION_RELEASE:${sLedger}`);
  const sNoShowComp = await mkSession("a_ledger_ptnoshow", cEnded, "CONFIRMED");
  await ledgerOp(`PT_NO_SHOW:${sNoShowComp}`);
  await mkSession("a_deducted", cEnded, "CONFIRMED", { sessionDeducted: true });
  const sSettle = await mkSession("a_settlement_row", cEnded, "CONFIRMED");
  await P.user.sessionSettlement.create({ data: { kind: "SESSION_RELEASE", idempotencyKey: `SESSION_RELEASE:${sSettle}`, contractId: cEnded, sessionId: sSettle, status: "SETTLED" } });
  await mkSession("a_room_joined", cEnded, "CONFIRMED", { roomClientJoinedAt: new Date(now - 3 * DAY) });
  await mkSession("a_pt_at_fault", cEnded, "CONFIRMED", { ptAtFault: true });
  await mkSession("b_awaiting_deadline_passed", cEnded, "PENDING_CLIENT_CONFIRMATION", { clientConfirmDeadline: new Date(now - DAY) });
  await mkSession("b_awaiting_deadline_future", cEnded, "PENDING_CLIENT_CONFIRMATION", { clientConfirmDeadline: new Date(now + DAY) });
  await mkSession("d_disputed", cEnded, "DISPUTED", { disputedAt: new Date(now - DAY), disputeReason: "x" });
  await mkSession("d_pt_no_show_reported", cEnded, "PT_NO_SHOW_REPORTED");
  await mkSession("final_completed", cEnded, "COMPLETED", { sessionDeducted: true, completedAt: new Date(now - 3 * DAY) });
  await mkSession("final_cancelled", cEnded, "CANCELLED", { cancelledBy: "someone", cancellationReason: "r" });
  await mkSession("final_no_show", cEnded, "NO_SHOW");

  const cRecent = await mkContract("recent", { status: "EXPIRED", terminationReason: "EXPIRED", terminatedAt: new Date(now - 10 * MIN) });
  await mkSession("recent_confirmed", cRecent, "CONFIRMED");

  const cFuture = await mkContract("future", { status: "COMPLETED", completedAt: new Date(now + 30 * DAY) });
  await mkSession("future_confirmed", cFuture, "CONFIRMED");

  const cPending = await mkContract("term_pending", { status: "CANCELLED", terminationReason: "PT_CANCELLED", terminatedAt: new Date(now - 3 * DAY) });
  await mkSession("term_pending_confirmed", cPending, "CONFIRMED");
  await P.user.sessionSettlement.create({ data: { kind: "CONTRACT_TERMINATION", idempotencyKey: `CONTRACT_TERMINATE:${cPending}`, contractId: cPending, status: "FAILED", reason: "PT_CANCELLED" } });

  const cActive = await mkContract("active", { status: "ACTIVE" });
  await mkSession("active_confirmed", cActive, "CONFIRMED");

  const cOld2 = await mkContract("old_unpaid", { status: "EXPIRED", terminationReason: "EXPIRED", terminatedAt: new Date(now - 5 * DAY), price: null, paymentTransactionId: null });
  await mkSession("old_unpaid_confirmed", cOld2, "CONFIRMED");

  const cOld3 = await mkContract("old_refunded", { status: "COMPLETED", terminationReason: "COMPLETED", completedAt: new Date(now - 4 * DAY), terminatedAt: new Date(now - 4 * DAY), compensatedSessions: 1 });
  await mkSession("old_refunded_confirmed", cOld3, "CONFIRMED");
  await ledgerOp(`CONTRACT_TERMINATE:${cOld3}`);

  return { ids, contracts };
}

const ELIGIBLE = ["a_eligible_confirmed", "a_eligible_requested", "old_unpaid_confirmed", "old_refunded_confirmed"];

const newScope = (over: Partial<Scope> = {}): Scope => ({ minAgeMinutes: 60, now: new Date(), ...over });

async function sessionSnapshot() {
  const rows = await P.user.$queryRawUnsafe<any[]>("SELECT * FROM sessions ORDER BY id");
  return JSON.stringify(rows);
}
async function ledgerSnapshot() {
  return JSON.stringify(await P.payment.$queryRawUnsafe<any[]>("SELECT * FROM ledger_operations ORDER BY key"));
}
async function paymentFullSnapshot() {
  const out: Record<string, unknown> = {};
  for (const t of ["ledger_operations", "wallets", "wallet_ledger_entries", "payment_transactions"]) {
    out[t] = await P.payment.$queryRawUnsafe(`SELECT count(*)::int AS n FROM ${t}`);
  }
  out.ledger = await ledgerSnapshot();
  return JSON.stringify(out);
}
const closedIds = async () =>
  (await P.user.session.findMany({ where: { cancellationReason: { startsWith: LEGACY_CLEANUP_REASON_PREFIX } }, select: { id: true } })).map((s) => s.id).sort();

test("setup: the suite points at *_legacy_test databases only", { skip }, () => {
  assert.match(db.userDbName, /_legacy_test$/);
  assert.match(db.paymentDbName, /_legacy_test$/);
});

test("inventory classifies every session by class, flags and eligibility (and ignores final / active)", { skip }, async () => {
  const fx = await seed();
  const inv = await buildInventory(db, newScope());
  const byId = new Map(inv.rows.map((r) => [r.sessionId, r]));

  // Not inventoried: final sessions and anything on an ACTIVE contract.
  for (const n of ["final_completed", "final_cancelled", "final_no_show", "active_confirmed"]) assert.equal(byId.has(fx.ids[n]), false, n);

  const cls = (n: string) => byId.get(fx.ids[n])!;
  assert.equal(cls("a_eligible_confirmed").cls, "A_NOT_STARTED_OPEN");
  assert.equal(cls("b_awaiting_deadline_passed").cls, "B_PT_REPORTED_AWAITING");
  assert.equal(cls("b_awaiting_deadline_passed").deadlinePassed, true);
  assert.equal(cls("b_awaiting_deadline_future").deadlinePassed, false);
  assert.equal(cls("d_disputed").cls, "D_DISPUTED_OR_NOSHOW");
  // PT_NO_SHOW_REPORTED is class D, NEVER "not started" (D52).
  assert.equal(cls("d_pt_no_show_reported").cls, "D_DISPUTED_OR_NOSHOW");
  assert.equal(cls("d_pt_no_show_reported").eligible, false);

  // Exactly the four certainly-not-started sessions are eligible.
  assert.deepEqual(inv.rows.filter((r) => r.eligible).map((r) => r.sessionId).sort(), ELIGIBLE.map((n) => fx.ids[n]).sort());

  // Each exclusion reason is detected.
  assert.deepEqual(cls("a_ledger_release").exclusions, ["LEDGER_OPERATION"]);
  assert.ok(cls("a_ledger_ptnoshow").exclusions.includes("LEDGER_OPERATION"));
  assert.equal(cls("a_ledger_ptnoshow").compensationSession, true);
  assert.deepEqual(cls("a_deducted").exclusions, ["SESSION_DEDUCTED"]);
  assert.deepEqual(cls("a_settlement_row").exclusions, ["SETTLEMENT_ROW"]);
  assert.deepEqual(cls("a_room_joined").exclusions, ["ROOM_JOINED"]);
  assert.ok(cls("a_pt_at_fault").exclusions.includes("PT_AT_FAULT"));
  assert.deepEqual(cls("recent_confirmed").exclusions, ["CONTRACT_ENDED_TOO_RECENTLY"]);
  assert.deepEqual(cls("future_confirmed").exclusions, ["CONTRACT_END_DATE_IN_FUTURE"]);
  assert.deepEqual(cls("term_pending_confirmed").exclusions, ["TERMINATION_MONEY_PENDING"]);

  // Contract-level money signs and value.
  assert.equal(cls("old_refunded_confirmed").terminationMoneyExecuted, true); // F2
  assert.equal(cls("old_refunded_confirmed").contractCompensated, true); // F3
  assert.equal(cls("a_eligible_confirmed").terminationMoneyExecuted, false);
  assert.equal(cls("a_eligible_confirmed").valueVnd.toString(), "500000");
  assert.equal(cls("old_unpaid_confirmed").hasPayment, false);
  assert.equal(cls("old_unpaid_confirmed").valueVnd.toString(), "0");

  const rep = buildReport(inv, db, newScope(), "DRY_RUN", 3);
  assert.equal(rep.totalOpenOnEndedContracts, inv.rows.length);
  assert.equal(rep.autoClose.eligible, 4);
  assert.equal(rep.autoClose.eligibleWithoutPayment, 1);
  assert.equal(rep.autoClose.eligibleWithTerminationMoneyExecuted, 1);
});

test("dry-run (the default) writes nothing, to either database", { skip }, async () => {
  await seed();
  const beforeSessions = await sessionSnapshot();
  const beforePayment = await paymentFullSnapshot();
  const beforeAudit = await P.user.auditLog.count();
  const lines: string[] = [];
  const code = await main(["--user-url", USER_URL, "--payment-url", PAYMENT_URL, "--markdown", path.join(tmp, "dry.md")], {}, (s) => lines.push(s));
  assert.equal(code, 0);
  assert.match(lines.join("\n"), /DRY RUN: nothing was written/);
  assert.equal(await sessionSnapshot(), beforeSessions);
  assert.equal(await paymentFullSnapshot(), beforePayment);
  assert.equal(await P.user.auditLog.count(), beforeAudit);
  assert.ok(fs.readFileSync(path.join(tmp, "dry.md"), "utf8").includes("A_NOT_STARTED_OPEN"));
});

test("the inventory connections are READ ONLY at the database level", { skip }, async () => {
  await seed();
  await assert.rejects(
    readOnly(P.user, (tx) => tx.$executeRawUnsafe("UPDATE sessions SET notes = 'x'")),
    /read-only transaction/i,
  );
  await assert.rejects(
    readOnly(P.payment, (tx) => tx.$executeRawUnsafe("DELETE FROM ledger_operations")),
    /read-only transaction/i,
  );
});

test("--apply is refused without the exact --confirm-db name, and writes nothing", { skip }, async () => {
  await seed();
  const before = await sessionSnapshot();
  const lines: string[] = [];
  assert.equal(await main(["--user-url", USER_URL, "--payment-url", PAYMENT_URL, "--apply"], {}, (s) => lines.push(s)), 2);
  assert.equal(await main(["--user-url", USER_URL, "--payment-url", PAYMENT_URL, "--apply", "--confirm-db", "gymcoach_user"], {}, (s) => lines.push(s)), 2);
  assert.equal(await sessionSnapshot(), before);
  assert.match(lines.join("\n"), /--apply refused/);
});

test("--apply closes ONLY the certainly-not-started sessions; everything else is byte-identical; ledger untouched", { skip }, async () => {
  const fx = await seed();
  const beforeRows = new Map((await P.user.$queryRawUnsafe<any[]>("SELECT * FROM sessions")).map((r) => [r.id, JSON.stringify(r)]));
  const beforePayment = await paymentFullSnapshot();
  const log = path.join(tmp, "full.jsonl");
  const code = await main(["--user-url", USER_URL, "--payment-url", PAYMENT_URL, "--apply", "--confirm-db", db.userDbName, "--log", log], {}, () => {});
  assert.equal(code, 0);

  const eligibleIds = ELIGIBLE.map((n) => fx.ids[n]).sort();
  assert.deepEqual(await closedIds(), eligibleIds);
  for (const id of eligibleIds) {
    const s = await P.user.session.findUniqueOrThrow({ where: { id } });
    assert.equal(s.status, "CANCELLED");
    assert.equal(s.cancelledBy, "SYSTEM");
    assert.ok(s.cancellationReason!.startsWith(LEGACY_CLEANUP_REASON_PREFIX));
    assert.equal(s.sessionDeducted, false);
    assert.equal(s.ptAtFault, false); // never counted as a no-show
  }
  // Every other row is byte-identical (class B, D, flagged A, recent/future/pending contracts, final, active).
  const afterRows = await P.user.$queryRawUnsafe<any[]>("SELECT * FROM sessions");
  for (const r of afterRows) if (!eligibleIds.includes(r.id)) assert.equal(JSON.stringify(r), beforeRows.get(r.id), `session ${r.id} changed`);
  assert.equal(afterRows.length, beforeRows.size); // nothing deleted
  // The contract rows themselves were not touched either.
  assert.equal(await P.user.contract.count(), Object.keys(fx.contracts).length);
  // Ledger / payment DB: untouched.
  assert.equal(await paymentFullSnapshot(), beforePayment);
  // Audit trail: one row per closed session.
  const audit = await P.user.auditLog.findMany({ where: { action: AUDIT_ACTION_CLOSED } });
  assert.deepEqual(audit.map((a) => a.entityId).sort(), eligibleIds);
  // Journal: a before and an applied after per closed session, with the old values.
  const lines = fs.readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(lines.filter((l) => l.phase === "before").length, 4);
  assert.equal(lines.filter((l) => l.phase === "after" && l.applied === true).length, 4);
  const b = lines.find((l) => l.phase === "before" && l.sessionId === fx.ids.a_eligible_confirmed);
  assert.equal(b.oldStatus, "CONFIRMED");
  assert.equal(b.newStatus, "CANCELLED");
  assert.ok(b.ts && b.oldUpdatedAt);
});

test("--apply is idempotent: a re-run changes nothing", { skip }, async () => {
  await seed();
  const log1 = path.join(tmp, "idem1.jsonl");
  const log2 = path.join(tmp, "idem2.jsonl");
  const args = ["--user-url", USER_URL, "--payment-url", PAYMENT_URL, "--apply", "--confirm-db", db.userDbName];
  await main([...args, "--log", log1], {}, () => {});
  const sessions = await sessionSnapshot();
  const audits = await P.user.auditLog.count();
  const payment = await paymentFullSnapshot();
  const out: string[] = [];
  assert.equal(await main([...args, "--log", log2], {}, (s) => out.push(s)), 0);
  assert.equal(await sessionSnapshot(), sessions);
  assert.equal(await P.user.auditLog.count(), audits);
  assert.equal(await paymentFullSnapshot(), payment);
  assert.ok(!fs.existsSync(log2) || fs.readFileSync(log2, "utf8").trim() === "");
  assert.match(out.join("\n"), /"closed": 0/);
});

test("scope limits: --limit, --contract-id and --before bound what --apply may close", { skip }, async () => {
  let fx = await seed();
  const base = ["--user-url", USER_URL, "--payment-url", PAYMENT_URL, "--apply", "--confirm-db", db.userDbName];

  // --limit 1 closes exactly one of the four eligible.
  await main([...base, "--limit", "1", "--log", path.join(tmp, "s1.jsonl")], {}, () => {});
  assert.equal((await closedIds()).length, 1);

  // --contract-id: only that contract's session.
  fx = await seed();
  await main([...base, "--contract-id", fx.contracts.old_unpaid, "--log", path.join(tmp, "s2.jsonl")], {}, () => {});
  assert.deepEqual(await closedIds(), [fx.ids.old_unpaid_confirmed]);

  // --before: only contracts that ended before the date (old_unpaid ended 5 days ago; old_refunded 4; ended 2).
  fx = await seed();
  await main([...base, "--before", new Date(Date.now() - 4.5 * DAY).toISOString(), "--log", path.join(tmp, "s3.jsonl")], {}, () => {});
  assert.deepEqual(await closedIds(), [fx.ids.old_unpaid_confirmed]);

  // --limit 0 closes nothing.
  fx = await seed();
  await main([...base, "--limit", "0", "--log", path.join(tmp, "s4.jsonl")], {}, () => {});
  assert.deepEqual(await closedIds(), []);
});

test("a ledger operation that appears after the inventory is caught at the last look: the session is skipped, not closed", { skip }, async () => {
  const fx = await seed();
  const inv = await buildInventory(db, newScope());
  await ledgerOp(`PT_LATE_ARRIVAL:${fx.ids.a_eligible_confirmed}`); // lands between inventory and apply
  const res = await applyPlan(db, inv, path.join(tmp, "race.jsonl"));
  assert.equal(res.closed, 3);
  assert.deepEqual(res.skipped.map((s) => [s.sessionId, s.reason]), [[fx.ids.a_eligible_confirmed, "LEDGER_OPERATION_APPEARED"]]);
  assert.equal((await P.user.session.findUniqueOrThrow({ where: { id: fx.ids.a_eligible_confirmed } })).status, "CONFIRMED");
});

test("a session that moved on after the inventory (PT reported it done) is never overwritten", { skip }, async () => {
  const fx = await seed();
  const inv = await buildInventory(db, newScope());
  await P.user.session.update({ where: { id: fx.ids.a_eligible_requested }, data: { status: "PENDING_CLIENT_CONFIRMATION", clientConfirmDeadline: new Date(Date.now() + DAY) } });
  const res = await applyPlan(db, inv, path.join(tmp, "moved.jsonl"));
  assert.equal(res.closed, 3);
  assert.equal(res.skipped.length, 1);
  assert.match(res.skipped[0].reason, /^STATE_CHANGED:PENDING_CLIENT_CONFIRMATION$/);
  assert.equal((await P.user.session.findUniqueOrThrow({ where: { id: fx.ids.a_eligible_requested } })).status, "PENDING_CLIENT_CONFIRMATION");
});

test("--restore puts every closed session back exactly (status, cancelledBy, reason, updatedAt); re-restore is a no-op; moved-on sessions are left", { skip }, async () => {
  const fx = await seed();
  const original = await sessionSnapshot();
  const auditBefore = await P.user.auditLog.count();
  const log = path.join(tmp, "restore.jsonl");
  const base = ["--user-url", USER_URL, "--payment-url", PAYMENT_URL];
  await main([...base, "--apply", "--confirm-db", db.userDbName, "--log", log], {}, () => {});
  assert.notEqual(await sessionSnapshot(), original);

  // One closed session moves on after the cleanup (someone legitimately re-booked/changed it): restore must not touch it.
  await P.user.session.update({ where: { id: fx.ids.a_eligible_requested }, data: { status: "REQUESTED", cancellationReason: "reopened by hand", cancelledBy: "u1" } });

  const noConfirm = await main([...base, "--restore", log], {}, () => {});
  assert.equal(noConfirm, 2); // restore also demands --confirm-db

  const out: string[] = [];
  assert.equal(await main([...base, "--restore", log, "--confirm-db", db.userDbName], {}, (s) => out.push(s)), 0);
  const res = JSON.parse(out.join("\n"));
  assert.equal(res.candidates, 4);
  assert.equal(res.restored, 3);
  assert.deepEqual(res.skipped.map((s: any) => s.sessionId), [fx.ids.a_eligible_requested]);

  // The 3 restored sessions equal their original rows byte for byte (incl. updatedAt); the hand-edited one is unchanged.
  const orig = new Map((JSON.parse(original) as any[]).map((r) => [r.id, JSON.stringify(r)]));
  for (const n of ELIGIBLE.filter((n) => n !== "a_eligible_requested")) {
    const [row] = await P.user.$queryRawUnsafe<any[]>("SELECT * FROM sessions WHERE id = $1", fx.ids[n]);
    assert.equal(JSON.stringify(row), orig.get(fx.ids[n]), n);
  }
  assert.equal((await P.user.session.findUniqueOrThrow({ where: { id: fx.ids.a_eligible_requested } })).cancellationReason, "reopened by hand");

  // Re-restore changes nothing.
  const snap = await sessionSnapshot();
  const out2: string[] = [];
  await main([...base, "--restore", log, "--confirm-db", db.userDbName], {}, (s) => out2.push(s));
  assert.equal(JSON.parse(out2.join("\n")).restored, 0);
  assert.equal(await sessionSnapshot(), snap);

  // History is only ever added to: 4 closing audit rows + 3 restore audit rows.
  assert.equal(await P.user.auditLog.count(), auditBefore + 4 + 3);
  assert.equal(await P.user.auditLog.count({ where: { action: AUDIT_ACTION_RESTORED } }), 3);
});

test("restoreFromLog tolerates a crash journal: a 'before' with no 'after' still restores a session that was closed", { skip }, async () => {
  const fx = await seed();
  const inv = await buildInventory(db, newScope());
  const log = path.join(tmp, "crash.jsonl");
  await applyPlan(db, inv, log);
  // Simulate the process dying before it wrote the "after" lines.
  const kept = fs.readFileSync(log, "utf8").split("\n").filter((l) => l && !JSON.parse(l).phase.startsWith("after"));
  fs.writeFileSync(log, kept.join("\n") + "\n");
  const res = await restoreFromLog(db, log);
  assert.equal(res.restored, 4);
  assert.equal((await P.user.session.findUniqueOrThrow({ where: { id: fx.ids.a_eligible_confirmed } })).status, "CONFIRMED");
});

test("teardown", { skip }, async () => {
  await wipe();
  await P.user.$disconnect();
  await P.payment.$disconnect();
  fs.rmSync(tmp, { recursive: true, force: true });
});
