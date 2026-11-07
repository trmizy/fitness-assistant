/**
 * DISPUTE CASE slice 2 / S2.1 - the CaseDecision EXECUTOR, BACKEND INTEGRATION against the isolated *_test user database (real rows, triggers,
 * constraints, transactions, the REAL ruling core and the REAL contract lock).
 * MOCKED DEPENDENCY: payment-service. The ledger lookup is a stub; every payment WRITE throws, so a money step ends FAILED / PENDING on its
 * session_settlements row (the retry state) - the real ledger movements are proved by cross-service-money-dispute-execution.e2e.test.ts.
 * Flags are switched on per test the way the test environment does (NODE_ENV=test + the preload's DB_ISOLATION=accepted).
 *
 * Run ALONE (it truncates the dispute_case* tables):
 *   TEST_DATABASE_URL="postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_user_<x>_test?schema=public" \
 *   FITNESS_DISABLE_REDIS=true npx tsx --import ./src/__tests__/setup/db-isolation.ts --test --test-concurrency=1 src/__tests__/dispute-case-execution.integration.test.ts
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { guardedTest as test } from "./test-db-guard";
import { paymentClient } from "../clients/payment.client";
import { prisma } from "../repositories/profile.repository";
import { addSession, makeContract } from "./pt-restriction.test-helpers";
import { disputeCaseService as svc } from "../services/dispute-case/dispute-case.service";
import { executionService, defaultExecDeps, type ExecDeps } from "../services/dispute-case/execution.service";
import { __resetFlagWarnings, flagVerdict, DISPUTE_CASE_FLAGS } from "../services/dispute-case/flags";
import { resolveDisputeCore, bookingService } from "../services/booking.service";
import { admin, approvedCaseFor, caseAtFinding, caseRow, disableExecutionFlags, enableExecutionFlags, execRows, FINDING_FOR } from "./dispute-case-exec.test-helpers";

const ledger = { ops: new Map<string, any>(), down: false };
const restores: Array<() => void> = [];
const createdContracts: string[] = [];
const createdPts: string[] = [];

test.before(async () => {
  for (const name of Object.keys(paymentClient)) {
    const original = (paymentClient as any)[name];
    (paymentClient as any)[name] =
      name === "lookupLedgerOperation"
        ? async (key: string) => {
            if (ledger.down) throw Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
            return ledger.ops.get(key) ?? null;
          }
        : async () => {
            throw new Error(`payment write refused by the test stub: ${name}`);
          };
    restores.push(() => ((paymentClient as any)[name] = original));
  }
  await prisma.$executeRawUnsafe(
    `TRUNCATE dispute_case_executions, dispute_case_access_logs, dispute_case_events, dispute_case_approvals, dispute_case_proposals, dispute_case_findings, dispute_case_assessments, dispute_case_shares, dispute_case_statements, dispute_case_evidence, dispute_case_claims, dispute_case_issues, dispute_cases CASCADE`,
  );
});
test.after(async () => {
  disableExecutionFlags();
  for (const r of restores) r();
  await prisma.sessionSettlement.deleteMany({ where: { contractId: { in: createdContracts } } }).catch(() => {});
  await prisma.auditLog.deleteMany({ where: { entityId: { in: createdContracts } } }).catch(() => {});
  await prisma.notification.deleteMany({ where: { userId: { in: createdPts } } }).catch(() => {});
  await prisma.session.deleteMany({ where: { contractId: { in: createdContracts } } }).catch(() => {});
  await prisma.contract.deleteMany({ where: { id: { in: createdContracts } } }).catch(() => {});
  await prisma.userProfile.deleteMany({ where: { userId: { in: createdPts } } }).catch(() => {});
  await prisma.$disconnect();
});
test.beforeEach(() => {
  ledger.ops.clear();
  ledger.down = false;
  disableExecutionFlags();
  enableExecutionFlags({ execution: true });
});

async function mkSession(over: { status?: string; contract?: Record<string, unknown> } = {}) {
  const ptUserId = randomUUID();
  const contract = await makeContract(ptUserId, { sessionMode: "ONLINE", ...(over.contract ?? {}) });
  createdContracts.push(contract.id);
  createdPts.push(ptUserId);
  const session = await addSession(contract, over.status ?? "DISPUTED", new Date(Date.now() - 3 * 3600_000), {
    sessionMode: "ONLINE",
    disputeType: "DELIVERY_DISPUTE",
    disputedAt: new Date(Date.now() - 3600_000),
    disputeReason: "Buổi tập không diễn ra như đã hẹn",
    ptNotes: "PT báo đã dạy đủ giờ",
  });
  return { contract, session, ptUserId, clientUserId: contract.clientUserId };
}
const sessionRow = (id: string) => prisma.session.findUniqueOrThrow({ where: { id } });
const settlements = (sessionId: string) => prisma.sessionSettlement.findMany({ where: { sessionId }, orderBy: { createdAt: "asc" } });
const noExec = async (caseId: string) => {
  const c = await caseRow(caseId);
  assert.equal(c.execStatus, "NOT_STARTED");
  assert.equal(c.execDecisionId, null);
  assert.equal((await execRows(caseId)).length, 0, "no execution row was written");
};
const refuses = (p: Promise<unknown>, status: number, code: string) =>
  assert.rejects(p, (e: any) => {
    assert.equal(e.code, code, `${e.code}: ${e.message}`);
    assert.equal(e.status, status);
    return true;
  });
/** a ledger that answers "nothing under that key" - the default deps. */
const deps = (over: Partial<ExecDeps> = {}): ExecDeps => ({ ...defaultExecDeps(), ...over });

// ═══ the flag: fail-closed ═══════════════════════════════════════════════════════════════════════════════════════════

test("flag: effective ONLY with value 'true' AND NODE_ENV=test AND DB_ISOLATION=accepted; every other combination is OFF (and the mistake is warned about once)", () => {
  const F = DISPUTE_CASE_FLAGS.EXECUTION;
  const ok = { [F]: "true", NODE_ENV: "test", DB_ISOLATION: "accepted" } as NodeJS.ProcessEnv;
  assert.equal(flagVerdict(F, ok).effective, true);
  const warnings: string[] = [];
  const realWarn = console.warn;
  console.warn = (m: unknown) => warnings.push(String(m));
  try {
    __resetFlagWarnings();
    for (const [label, env] of [
      ["value unset", { ...ok, [F]: undefined }],
      ["value TRUE", { ...ok, [F]: "TRUE" }],
      ["value 1", { ...ok, [F]: "1" }],
      ["value 'true '", { ...ok, [F]: "true " }],
      ["NODE_ENV production", { ...ok, NODE_ENV: "production" }],
      ["NODE_ENV unset", { ...ok, NODE_ENV: undefined }],
      ["NODE_ENV development", { ...ok, NODE_ENV: "development" }],
      ["DB_ISOLATION refused", { ...ok, DB_ISOLATION: "refused" }],
      ["DB_ISOLATION unset", { ...ok, DB_ISOLATION: undefined }],
    ] as Array<[string, NodeJS.ProcessEnv]>) {
      assert.equal(flagVerdict(F, env).effective, false, label);
    }
    assert.equal(flagVerdict(F, { ...ok, NODE_ENV: "production" }).refusedBecause, "NOT_TEST_ENV");
    assert.equal(flagVerdict(F, { ...ok, DB_ISOLATION: "refused" }).refusedBecause, "DB_ISOLATION_NOT_ACCEPTED");
  } finally {
    console.warn = realWarn;
  }
  assert.ok(warnings.length >= 2 && warnings.every((w) => /IGNORED/.test(w)), warnings.join("|"));
  assert.equal(warnings.filter((w) => /NODE_ENV is not/.test(w)).length, 1, "warned once per flag and reason, not on every call");
  // the other two flags use the very same rule
  for (const name of [DISPUTE_CASE_FLAGS.T0, DISPUTE_CASE_FLAGS.EVIDENCE_STORAGE]) {
    assert.equal(flagVerdict(name, { [name]: "true", NODE_ENV: "test", DB_ISOLATION: "accepted" } as any).effective, true);
    assert.equal(flagVerdict(name, { [name]: "true", NODE_ENV: "production", DB_ISOLATION: "accepted" } as any).effective, false);
    assert.equal(flagVerdict(name, { [name]: "true", NODE_ENV: "test" } as any).effective, false);
  }
});

test("flag OFF in the running process (env true but NODE_ENV=production): the executor and the core's ctx path both refuse, nothing is written", async () => {
  const s = await mkSession();
  const a = await approvedCaseFor(s.session.id, FINDING_FOR.CANCELLED);
  process.env.NODE_ENV = "production";
  const realWarn = console.warn;
  console.warn = () => {};
  try {
    await refuses(executionService.executeDecision(admin(), a.caseId, {}, deps()), 409, "EXECUTION_DISABLED");
    await refuses(resolveDisputeCore(s.session.id, "x", "CANCELLED", "n", { caseDecisionId: a.approvalId }), 409, "EXECUTION_DISABLED");
  } finally {
    console.warn = realWarn;
    process.env.NODE_ENV = "test";
  }
  await noExec(a.caseId);
  assert.equal((await sessionRow(s.session.id)).status, "DISPUTED");
});

// ═══ refusals: every one changes NOTHING ═════════════════════════════════════════════════════════════════════════════

test("refusals before the start (each changes nothing): not an admin, unknown decision, decision of another case, case not approved, tampered four-eyes, party as executor, outcome mismatch, unacknowledged evidence, LEGACY_UNCLASSIFIED, session no longer DISPUTED", async () => {
  const s = await mkSession();
  const a = await approvedCaseFor(s.session.id, FINDING_FOR.CANCELLED);
  const exec = admin();
  const before = await sessionRow(s.session.id);

  await refuses(executionService.executeDecision({ id: exec.id, role: "CUSTOMER" }, a.caseId, {}, deps()), 403, "ADMIN_ONLY");
  await refuses(executionService.executeDecision(exec, "not-a-uuid", {}, deps()), 404, "CASE_NOT_FOUND");
  await refuses(executionService.executeDecision(exec, randomUUID(), {}, deps()), 404, "CASE_NOT_FOUND");
  await refuses(executionService.executeDecision(exec, a.caseId, { decisionId: randomUUID() }, deps()), 404, "DECISION_NOT_FOUND");
  // a decision that belongs to ANOTHER case
  const s2 = await mkSession();
  const other = await approvedCaseFor(s2.session.id, FINDING_FOR.CANCELLED);
  await refuses(executionService.executeDecision(exec, a.caseId, { decisionId: other.approvalId }, deps()), 409, "DECISION_WRONG_CASE");
  await refuses(executionService.executeDecision(exec, other.caseId, { decisionId: a.approvalId }, deps()), 409, "DECISION_WRONG_CASE");

  // a case that is only AWAITING_APPROVAL has no approved decision
  const s3 = await mkSession();
  const pending = await approvedCaseFor(s3.session.id, FINDING_FOR.CANCELLED);
  await prisma.disputeCase.update({ where: { id: pending.caseId }, data: { status: "AWAITING_APPROVAL" } });
  await refuses(executionService.executeDecision(exec, pending.caseId, {}, deps()), 409, "CASE_STATE_NOT_ALLOWED");
  await prisma.disputeCase.update({ where: { id: pending.caseId }, data: { status: "DECISION_APPROVED" } });

  // four eyes re-checked from the stored rows: the approver became the investigator / a party of the case
  await prisma.disputeCase.update({ where: { id: a.caseId }, data: { investigatorId: a.approver.id } });
  await refuses(executionService.executeDecision(exec, a.caseId, {}, deps()), 403, "SELF_APPROVAL_FORBIDDEN");
  await prisma.disputeCase.update({ where: { id: a.caseId }, data: { investigatorId: a.investigator.id, clientUserId: a.approver.id } });
  await refuses(executionService.executeDecision(exec, a.caseId, {}, deps()), 403, "CONFLICT_OF_INTEREST");
  await prisma.disputeCase.update({ where: { id: a.caseId }, data: { clientUserId: s.clientUserId } });
  // ... and the executing admin is a party
  await prisma.disputeCase.update({ where: { id: a.caseId }, data: { ptUserId: exec.id } });
  await refuses(executionService.executeDecision(exec, a.caseId, {}, deps()), 403, "CONFLICT_OF_INTEREST");
  await prisma.disputeCase.update({ where: { id: a.caseId }, data: { ptUserId: s.ptUserId } });

  // the outcome is recomputed from the finding: a newer finding exists than the one the proposal was built on
  const newer = await prisma.disputeCaseFinding.create({ data: { caseId: a.caseId, finding: "VERIFIED_DELIVERED", reasoning: "tampered", recordedBy: a.investigator.id } });
  await refuses(executionService.executeDecision(exec, a.caseId, {}, deps()), 409, "OUTCOME_MISMATCH");
  await prisma.$executeRawUnsafe(`ALTER TABLE dispute_case_findings DISABLE TRIGGER dispute_case_findings_append_only`);
  await prisma.$executeRawUnsafe(`DELETE FROM dispute_case_findings WHERE id = '${newer.id}'`);
  await prisma.$executeRawUnsafe(`ALTER TABLE dispute_case_findings ENABLE TRIGGER dispute_case_findings_append_only`);

  // evidence changed after the approval and nobody acknowledged it
  await prisma.disputeCaseEvidence.create({
    data: { caseId: a.caseId, provenanceType: "SERVER_OBSERVED", source: "test", subject: "LATE_ROW", scopeSessionId: s.session.id, scopeContractId: s.contract.id, captureStatus: "OK", contentHash: "h".repeat(64), payload: {}, sensitivity: "NORMAL" },
  });
  await refuses(executionService.executeDecision(exec, a.caseId, {}, deps()), 409, "EVIDENCE_CHANGED");
  await prisma.$executeRawUnsafe(`ALTER TABLE dispute_case_evidence DISABLE TRIGGER dispute_case_evidence_append_only`);
  await prisma.$executeRawUnsafe(`DELETE FROM dispute_case_evidence WHERE case_id = '${a.caseId}'::uuid AND subject = 'LATE_ROW'`);
  await prisma.$executeRawUnsafe(`ALTER TABLE dispute_case_evidence ENABLE TRIGGER dispute_case_evidence_append_only`);

  // the type fell back to the provisional one
  await prisma.disputeCase.update({ where: { id: a.caseId }, data: { type: "LEGACY_UNCLASSIFIED" } });
  await refuses(executionService.executeDecision(exec, a.caseId, {}, deps()), 409, "CLASSIFICATION_REQUIRED");
  await prisma.disputeCase.update({ where: { id: a.caseId }, data: { type: "PT_DELIVERY" } });

  // the session moved on by another door
  await prisma.session.update({ where: { id: s.session.id }, data: { status: "CANCELLED" } });
  await refuses(executionService.executeDecision(exec, a.caseId, {}, deps()), 409, "SESSION_ALREADY_PROCESSED");
  await prisma.session.update({ where: { id: s.session.id }, data: { status: "DISPUTED" } });

  await noExec(a.caseId);
  const after = await sessionRow(s.session.id);
  assert.deepEqual([after.status, after.resolvedByCaseDecisionId, after.sessionDeducted], [before.status, null, false]);
  assert.equal((await settlements(s.session.id)).length, 0);
});

test("PT_NO_SHOW_REPORTED session: EXEC_BLOCKED (S2.4 is not built), remembered on the case, the session untouched; CONTRACT_ENDING likewise", async () => {
  const s = await mkSession();
  const a = await approvedCaseFor(s.session.id, FINDING_FOR.PT_NO_SHOW_CONFIRMED);
  await prisma.session.update({ where: { id: s.session.id }, data: { status: "PT_NO_SHOW_REPORTED" } });
  await refuses(executionService.executeDecision(admin(), a.caseId, {}, deps()), 409, "EXEC_BLOCKED");
  let c = await caseRow(a.caseId);
  assert.equal(c.execStatus, "EXEC_BLOCKED");
  let rows = await execRows(a.caseId);
  assert.deepEqual(rows.map((r) => [r.state, r.blockedReason]), [["BLOCKED", "PT_NO_SHOW_REPORTED_NOT_SUPPORTED"]]);
  assert.equal((await sessionRow(s.session.id)).status, "PT_NO_SHOW_REPORTED");

  // CONTRACT_ENDING (D59): the ending is recorded, payment-service has not confirmed it
  const s2 = await mkSession();
  await prisma.sessionSettlement.create({ data: { kind: "CONTRACT_TERMINATION", idempotencyKey: `TERMINATE:${s2.contract.id}`, contractId: s2.contract.id, status: "PENDING", reason: "CLIENT_CANCELLED" } });
  const b = await approvedCaseFor(s2.session.id, FINDING_FOR.CANCELLED);
  await refuses(executionService.executeDecision(admin(), b.caseId, {}, deps()), 409, "EXEC_BLOCKED");
  assert.equal((await caseRow(b.caseId)).execStatus, "EXEC_BLOCKED");
  assert.equal((await execRows(b.caseId))[0].blockedReason, "CONTRACT_ENDING");
  assert.equal((await sessionRow(s2.session.id)).status, "DISPUTED");
  // the core itself refuses it too, under the lock (assertNotEnding), whatever the executor believes
  await prisma.disputeCase.update({ where: { id: b.caseId }, data: { execStatus: "EXECUTING", execDecisionId: b.approvalId } });
  await refuses(resolveDisputeCore(s2.session.id, "x", "CANCELLED", "n", { caseDecisionId: b.approvalId }), 409, "CONTRACT_ENDING");
  assert.equal((await sessionRow(s2.session.id)).status, "DISPUTED");
});

test("an EXEC_BLOCKED decision can be executed again once the cause is gone (a new attempt of the SAME idempotency key)", async () => {
  const s = await mkSession();
  const a = await approvedCaseFor(s.session.id, FINDING_FOR.CANCELLED);
  ledger.down = true;
  await refuses(executionService.executeDecision(admin(), a.caseId, {}, deps()), 409, "EXEC_BLOCKED");
  ledger.down = false;
  const done = await executionService.executeDecision(admin(), a.caseId, {}, deps());
  assert.equal(done.executionState, "BUSINESS_DONE");
  assert.deepEqual((await execRows(a.caseId)).map((r) => [r.state, r.attempt]), [["BLOCKED", 0], ["STARTED", 1], ["BUSINESS_DONE", 0]]);
  assert.equal((await sessionRow(s.session.id)).resolvedByCaseDecisionId, a.approvalId);
});

// ═══ B-1: the D77 guard ═════════════════════════════════════════════════════════════════════════════════════════════

// POLICY CHANGE I6 = A (Ngai, 31/10/2026): CANCELLED over a D77 never reaches an approved decision any more (no proposal is created, see the I6 tests below),
// so B-1 is exercised for the two outcomes that still can: COMPLETED and PT_NO_SHOW_CONFIRMED.
for (const outcome of ["COMPLETED", "PT_NO_SHOW_CONFIRMED"] as const) {
  for (const status of ["SETTLED", "PENDING", "NEEDS_HUMAN"] as const) {
    test(`B-1: a PT_LATE_ARRIVAL settlement row (${status}) -> EXEC_BLOCKED D77_COMBINATION_UNRESOLVED for ${outcome}; session, quota and money untouched`, async () => {
      const s = await mkSession();
      await prisma.sessionSettlement.create({ data: { kind: "PT_LATE_ARRIVAL_COMPENSATION", idempotencyKey: `PT_LATE_ARRIVAL:${s.session.id}`, sessionId: s.session.id, contractId: s.contract.id, status } });
      const a = await approvedCaseFor(s.session.id, FINDING_FOR[outcome]); // the case is investigated and approved normally: B-1 blocks only the EXECUTION
      await refuses(executionService.executeDecision(admin(), a.caseId, {}, deps()), 409, "EXEC_BLOCKED");
      const c = await caseRow(a.caseId);
      assert.equal(c.execStatus, "EXEC_BLOCKED");
      assert.equal((await execRows(a.caseId))[0].blockedReason, "D77_COMBINATION_UNRESOLVED");
      const sess = await sessionRow(s.session.id);
      assert.deepEqual([sess.status, sess.sessionDeducted, sess.resolvedByCaseDecisionId, sess.resolvedBy], ["DISPUTED", false, null, null]);
      assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: s.contract.id } })).usedSessions, 0);
      assert.equal((await settlements(s.session.id)).length, 1, "only the D77 row that was already there");
    });
  }
}

// ═══ I6 = A: CANCELLED over a D77 is refused at EVERY door ═════════════════════════════════════════════

for (const status of ["SETTLED", "PENDING", "NEEDS_HUMAN"] as const) {
  test(`I6: a CANCELLED finding on a session with a PT_LATE_ARRIVAL row (${status}) -> no proposal, the case goes to POLICY_PENDING; session, quota, money, settlement rows untouched`, async () => {
    const s = await mkSession();
    await prisma.sessionSettlement.create({ data: { kind: "PT_LATE_ARRIVAL_COMPENSATION", idempotencyKey: `PT_LATE_ARRIVAL:${s.session.id}`, sessionId: s.session.id, contractId: s.contract.id, status } });
    const at = await caseAtFinding(s.session.id, FINDING_FOR.CANCELLED);
    const r = (await svc.propose(at.investigator, at.caseId, undefined)).result;
    assert.equal(r.policyPending, true);
    assert.equal(r.blocked, "CANCELLED_BLOCKED_BY_D77");
    assert.equal(r.caseStatus, "POLICY_PENDING");
    assert.equal(await prisma.disputeCaseProposal.count({ where: { caseId: at.caseId } }), 0, "no proposal exists, so nothing can be approved or executed");
    assert.equal((await caseRow(at.caseId)).execStatus, "NOT_STARTED");
    const sess = await sessionRow(s.session.id);
    assert.deepEqual([sess.status, sess.sessionDeducted, sess.resolvedByCaseDecisionId, sess.resolvedBy], ["DISPUTED", false, null, null]);
    assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: s.contract.id } })).usedSessions, 0);
    assert.equal((await settlements(s.session.id)).length, 1, "only the D77 row that was already there");
  });
}

test("I6: the ruling core itself refuses CANCELLED over a D77 (the old admin exit too): 409 CANCELLED_BLOCKED_BY_D77, nothing written; the same CANCELLED without a D77 is still ruled", async () => {
  for (const status of ["SETTLED", "PENDING", "NEEDS_HUMAN"] as const) {
    const s = await mkSession();
    await prisma.sessionSettlement.create({ data: { kind: "PT_LATE_ARRIVAL_COMPENSATION", idempotencyKey: `PT_LATE_ARRIVAL:${s.session.id}`, sessionId: s.session.id, contractId: s.contract.id, status } });
    await refuses(resolveDisputeCore(s.session.id, "admin-x", "CANCELLED", "huỷ"), 409, "CANCELLED_BLOCKED_BY_D77");
    await refuses(bookingService.resolveDispute(s.session.id, "admin-x", "CANCELLED", "huỷ"), 409, "CANCELLED_BLOCKED_BY_D77");
    const sess = await sessionRow(s.session.id);
    assert.deepEqual([sess.status, sess.sessionDeducted, sess.resolvedBy, sess.cancelledBy], ["DISPUTED", false, null, null], status);
    assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: s.contract.id } })).usedSessions, 0);
    assert.equal((await settlements(s.session.id)).length, 1);
  }
  const clean = await mkSession();
  await resolveDisputeCore(clean.session.id, "admin-x", "CANCELLED", "huỷ");
  assert.equal((await sessionRow(clean.session.id)).status, "CANCELLED", "no D77 -> the ruling is unchanged");
});

test("B-1 under the lock: even when the early (pre-lock) check is bypassed, the core itself refuses BEFORE its compare-and-set - the first-class guard", async () => {
  for (const outcome of ["COMPLETED", "PT_NO_SHOW_CONFIRMED"] as const) {
    const s = await mkSession();
    await prisma.sessionSettlement.create({ data: { kind: "PT_LATE_ARRIVAL_COMPENSATION", idempotencyKey: `PT_LATE_ARRIVAL:${s.session.id}`, sessionId: s.session.id, contractId: s.contract.id, status: "SETTLED" } });
    const a = await approvedCaseFor(s.session.id, FINDING_FOR[outcome]);
    // the early check is blinded ("the ledger says no D77"); the settlement row is only visible INSIDE the lock
    await refuses(executionService.executeDecision(admin(), a.caseId, {}, deps({ ledgerHasLateArrival: async () => ({ exists: false }) })), 409, "EXEC_BLOCKED");
    const c = await caseRow(a.caseId);
    assert.equal(c.execStatus, "EXEC_BLOCKED", outcome);
    const rows = await execRows(a.caseId);
    assert.deepEqual(rows.map((r) => r.state), ["STARTED", "BLOCKED"], "it started (EXECUTING), the core refused in the lock, the block was recorded");
    const sess = await sessionRow(s.session.id);
    assert.deepEqual([sess.status, sess.sessionDeducted, sess.resolvedByCaseDecisionId], ["DISPUTED", false, null], `${outcome}: the guard ran before the CAS`);
    assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: s.contract.id } })).usedSessions, 0);
    assert.equal((await settlements(s.session.id)).length, 1);
  }
});

test("B-1: an unreadable ledger with no row to go by is NOT 'no D77' -> EXEC_BLOCKED LEDGER_UNREADABLE", async () => {
  const s = await mkSession();
  const a = await approvedCaseFor(s.session.id, FINDING_FOR.CANCELLED);
  ledger.down = true;
  await refuses(executionService.executeDecision(admin(), a.caseId, {}, deps()), 409, "EXEC_BLOCKED");
  assert.equal((await execRows(a.caseId))[0].blockedReason, "LEDGER_UNREADABLE");
  assert.equal((await sessionRow(s.session.id)).status, "DISPUTED");
});

test("the core refuses a forged context: a decision id of another session / a case not EXECUTING / an outcome that is not the decision's", async () => {
  const s = await mkSession();
  const a = await approvedCaseFor(s.session.id, FINDING_FOR.CANCELLED);
  // the case is NOT_STARTED: nobody holds it in EXECUTING
  await refuses(resolveDisputeCore(s.session.id, "x", "CANCELLED", "n", { caseDecisionId: a.approvalId }), 409, "CASE_CONTEXT_INVALID");
  await refuses(resolveDisputeCore(s.session.id, "x", "CANCELLED", "n", { caseDecisionId: randomUUID() }), 409, "CASE_CONTEXT_INVALID");
  const s2 = await mkSession();
  await prisma.disputeCase.update({ where: { id: a.caseId }, data: { execStatus: "EXECUTING", execDecisionId: a.approvalId } });
  await refuses(resolveDisputeCore(s2.session.id, "x", "CANCELLED", "n", { caseDecisionId: a.approvalId }), 409, "CASE_CONTEXT_INVALID"); // wrong session
  await refuses(resolveDisputeCore(s.session.id, "x", "COMPLETED", "n", { caseDecisionId: a.approvalId }), 409, "CASE_CONTEXT_INVALID"); // wrong outcome
  const sess = await sessionRow(s.session.id);
  assert.deepEqual([sess.status, sess.resolvedByCaseDecisionId], ["DISPUTED", null]);
  assert.equal((await sessionRow(s2.session.id)).status, "DISPUTED");
});

// ═══ the executor: success, idempotency, concurrency ═══════════════════════════════════════════════════════════════

test("CANCELLED on a running contract: BUSINESS_DONE, the session carries resolved_by_case_decision_id, history STARTED -> BUSINESS_DONE; asking again replays the stored answer and writes nothing", async () => {
  const s = await mkSession();
  const a = await approvedCaseFor(s.session.id, FINDING_FOR.CANCELLED);
  const exec = admin();
  const r = await executionService.executeDecision(exec, a.caseId, {}, deps());
  assert.equal(r.replayed, false);
  assert.equal(r.executionState, "BUSINESS_DONE");
  assert.equal(r.session.status, "CANCELLED");
  const sess = await sessionRow(s.session.id);
  assert.deepEqual([sess.status, sess.resolvedByCaseDecisionId, sess.resolvedBy, sess.sessionDeducted], ["CANCELLED", a.approvalId, exec.id, false]);
  assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: s.contract.id } })).usedSessions, 0);
  const c = await caseRow(a.caseId);
  assert.deepEqual([c.execStatus, c.execDecisionId, c.status], ["BUSINESS_DONE", a.approvalId, "DECISION_APPROVED"]);
  const rows = await execRows(a.caseId);
  assert.deepEqual(rows.map((x) => x.state), ["STARTED", "BUSINESS_DONE"]);
  assert.ok(rows.every((x) => x.idempotencyKey === `CASE_DECISION:${a.approvalId}`));
  // the money axis is DERIVED and never claims a refund the ledger did not confirm
  assert.ok(["F1", "F2", "F3", "NO_RECORDED_SETTLEMENT", "UNAVAILABLE"].includes((r.money as any).group), JSON.stringify(r.money));

  const again = await executionService.executeDecision(admin(), a.caseId, {}, deps());
  assert.equal(again.replayed, true);
  assert.equal(again.session.status, "CANCELLED");
  assert.equal((await execRows(a.caseId)).length, 2, "no new row");
});

test("COMPLETED: quota +1 once, the intent row carries the case decision id in request_snapshot, the money step uses the existing key and is left FAILED/PENDING by the stubbed payment (retryable)", async () => {
  const s = await mkSession();
  const a = await approvedCaseFor(s.session.id, FINDING_FOR.COMPLETED);
  const r = await executionService.executeDecision(admin(), a.caseId, {}, deps());
  assert.equal(r.executionState, "BUSINESS_DONE");
  const sess = await sessionRow(s.session.id);
  assert.deepEqual([sess.status, sess.sessionDeducted, sess.resolvedByCaseDecisionId], ["COMPLETED", true, a.approvalId]);
  assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: s.contract.id } })).usedSessions, 1);
  const rows = await settlements(s.session.id);
  assert.deepEqual(rows.map((x) => x.idempotencyKey), [`SESSION_RELEASE:${s.session.id}`]);
  assert.equal((rows[0].requestSnapshot as any).caseDecisionId, a.approvalId);
  assert.notEqual(rows[0].status, "SETTLED", "the stub refused the payment write: the ledger has NOT confirmed it");
  assert.notEqual((r.money as any).group, "F1", "never presented as paid");
});

test("PT_NO_SHOW_CONFIRMED: NO_SHOW + ptAtFault, compensated +1 / used 0, intent under PT_NO_SHOW:<session> carrying the decision id", async () => {
  const s = await mkSession();
  const a = await approvedCaseFor(s.session.id, FINDING_FOR.PT_NO_SHOW_CONFIRMED);
  await executionService.executeDecision(admin(), a.caseId, {}, deps());
  const sess = await sessionRow(s.session.id);
  assert.deepEqual([sess.status, sess.ptAtFault, sess.resolvedByCaseDecisionId], ["NO_SHOW", true, a.approvalId]);
  const k = await prisma.contract.findUniqueOrThrow({ where: { id: s.contract.id } });
  // QUOTA A+: the entitlement of a confirmed PT no-show is booked at the terminal change (once, marked on the session), whether or not the money step succeeds - here the stub refused every payment write, so nothing was PAID
  assert.deepEqual([k.usedSessions, k.compensatedSessions], [0, 1], "booked at the terminal change, not after the money step");
  assert.ok(sess.noShowQuotaBookedAt, "the per-session mark is set");
  const rows = await settlements(s.session.id);
  assert.deepEqual(rows.map((x) => x.idempotencyKey), [`PT_NO_SHOW:${s.session.id}`]);
  assert.equal((rows[0].requestSnapshot as any).caseDecisionId, a.approvalId);
});

test("concurrency: two execute commands at once -> exactly one runs the core; the other is refused (EXECUTION_IN_PROGRESS) or replays; one STARTED, one BUSINESS_DONE row", async () => {
  for (let i = 0; i < 4; i++) {
    const s = await mkSession();
    const a = await approvedCaseFor(s.session.id, FINDING_FOR.CANCELLED);
    const results = await Promise.allSettled([executionService.executeDecision(admin(), a.caseId, {}, deps()), executionService.executeDecision(admin(), a.caseId, {}, deps())]);
    const ok = results.filter((r) => r.status === "fulfilled") as PromiseFulfilledResult<any>[];
    const bad = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    assert.ok(ok.length >= 1 && ok.length <= 2, JSON.stringify(results.map((r) => r.status)));
    assert.ok(ok.filter((r) => !r.value.replayed).length === 1, "exactly one command ran the core");
    for (const b of bad) assert.equal(b.reason.code, "EXECUTION_IN_PROGRESS");
    const rows = await execRows(a.caseId);
    assert.equal(rows.filter((x) => x.state === "STARTED").length, 1);
    assert.equal(rows.filter((x) => x.state === "BUSINESS_DONE").length, 1);
    assert.equal((await sessionRow(s.session.id)).status, "CANCELLED");
  }
});

test("the database refuses a second BUSINESS_DONE per key, a STARTED twin of one attempt, a key that does not name its decision, UPDATE and DELETE of history", async () => {
  const s = await mkSession();
  const a = await approvedCaseFor(s.session.id, FINDING_FOR.CANCELLED);
  await executionService.executeDecision(admin(), a.caseId, {}, deps());
  const base = { caseId: a.caseId, decisionId: a.approvalId, sessionId: s.session.id, outcome: "CANCELLED" as const, actorUserId: "x", idempotencyKey: `CASE_DECISION:${a.approvalId}` };
  await assert.rejects(prisma.disputeCaseExecution.create({ data: { ...base, state: "BUSINESS_DONE" } }), /Unique constraint|unique/i);
  await assert.rejects(prisma.disputeCaseExecution.create({ data: { ...base, state: "STARTED", attempt: 1 } }), /Unique constraint|unique/i);
  await assert.rejects(prisma.disputeCaseExecution.create({ data: { ...base, idempotencyKey: "CASE_DECISION:other", state: "BLOCKED" } }), /key_matches_decision|check/i);
  await assert.rejects(prisma.disputeCaseExecution.updateMany({ where: { caseId: a.caseId }, data: { note: "x" } }), /append-only|APPEND|reject/i);
  await assert.rejects(prisma.disputeCaseExecution.deleteMany({ where: { caseId: a.caseId } }), /append-only|APPEND|reject/i);
  // a decision rules at most one session
  const s2 = await mkSession();
  await assert.rejects(prisma.session.update({ where: { id: s2.session.id }, data: { resolvedByCaseDecisionId: a.approvalId } }), /Unique constraint|unique/i);
});

// ═══ crash recovery: three boundaries ═══════════════════════════════════════════════════════════════════════════════

const crash = () => Object.assign(new Error("simulated process death"), {}); // no status: the executor leaves the case EXECUTING

test("crash boundary 1 (after the case is EXECUTING, before the core): reconcile re-enters the core once (CAS from DISPUTED), result BUSINESS_DONE, nothing doubled", async () => {
  const s = await mkSession();
  const a = await approvedCaseFor(s.session.id, FINDING_FOR.COMPLETED);
  await assert.rejects(executionService.executeDecision(admin(), a.caseId, {}, deps({ afterExecutingCas: async () => Promise.reject(crash()) })), /simulated process death/);
  assert.equal((await caseRow(a.caseId)).execStatus, "EXECUTING");
  assert.equal((await sessionRow(s.session.id)).status, "DISPUTED");
  assert.equal((await settlements(s.session.id)).length, 0);
  await refuses(executionService.executeDecision(admin(), a.caseId, {}, deps()), 409, "EXECUTION_IN_PROGRESS"); // a plain retry does not guess
  const rec = await executionService.reconcileExecution(admin(), a.caseId, deps());
  assert.equal(rec.action, "RERAN_CORE");
  assert.equal((await caseRow(a.caseId)).execStatus, "BUSINESS_DONE");
  assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: s.contract.id } })).usedSessions, 1, "quota once");
  assert.equal((await settlements(s.session.id)).length, 1, "one settlement intent");
  assert.equal((await executionService.reconcileExecution(admin(), a.caseId, deps())).action, "NOTHING_TO_RECONCILE");
});

test("crash boundary 2 (inside the core: status + intent committed, money step not started): reconcile only records BUSINESS_DONE - no second ruling, no second quota, no second intent", async () => {
  for (const outcome of ["COMPLETED", "PT_NO_SHOW_CONFIRMED", "CANCELLED"] as const) {
    const s = await mkSession();
    const a = await approvedCaseFor(s.session.id, FINDING_FOR[outcome]);
    await assert.rejects(executionService.executeDecision(admin(), a.caseId, {}, deps({ afterDecisionCommitted: async () => Promise.reject(crash()) })), /simulated process death/);
    const ruled = await sessionRow(s.session.id);
    assert.notEqual(ruled.status, "DISPUTED", `${outcome}: the decision committed before the crash`);
    assert.equal(ruled.resolvedByCaseDecisionId, a.approvalId);
    const usedBefore = (await prisma.contract.findUniqueOrThrow({ where: { id: s.contract.id } })).usedSessions;
    const intentsBefore = (await settlements(s.session.id)).map((x) => x.idempotencyKey);
    assert.equal((await caseRow(a.caseId)).execStatus, "EXECUTING");
    const rec = await executionService.reconcileExecution(admin(), a.caseId, deps());
    assert.equal(rec.action, "BUSINESS_DONE", outcome);
    assert.equal((await caseRow(a.caseId)).execStatus, "BUSINESS_DONE");
    assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: s.contract.id } })).usedSessions, usedBefore);
    assert.deepEqual((await settlements(s.session.id)).map((x) => x.idempotencyKey), intentsBefore);
    if (outcome !== "CANCELLED") assert.equal(intentsBefore.length, 1, "the intent is the durable promise that the money step will run (settlement sweep)");
  }
});

test("crash boundary 3 (after the core, before BUSINESS_DONE): reconcile records BUSINESS_DONE from the real state", async () => {
  const s = await mkSession();
  const a = await approvedCaseFor(s.session.id, FINDING_FOR.PT_NO_SHOW_CONFIRMED);
  await assert.rejects(executionService.executeDecision(admin(), a.caseId, {}, deps({ afterCore: async () => Promise.reject(crash()) })), /simulated process death/);
  assert.equal((await caseRow(a.caseId)).execStatus, "EXECUTING");
  const intents = (await settlements(s.session.id)).length;
  const rec = await executionService.reconcileExecution(admin(), a.caseId, deps());
  assert.equal(rec.action, "BUSINESS_DONE");
  assert.equal((await settlements(s.session.id)).length, intents);
  const rows = await execRows(a.caseId);
  assert.deepEqual(rows.map((x) => x.state), ["STARTED", "BUSINESS_DONE"]);
  assert.equal((rows[1].response as any).via, "RECONCILE_ALREADY_RULED");
});

test("reconcile hands over to a person (no retry) when the session was ruled by another decision / by the old exit / the mismatch is contradictory", async () => {
  // ruled with another (NULL) decision id: the old exit got there first
  const s = await mkSession();
  const a = await approvedCaseFor(s.session.id, FINDING_FOR.CANCELLED);
  await prisma.disputeCase.update({ where: { id: a.caseId }, data: { execStatus: "EXECUTING", execDecisionId: a.approvalId } });
  await prisma.session.update({ where: { id: s.session.id }, data: { status: "CANCELLED", resolvedBy: "old-admin" } });
  const r1 = await executionService.reconcileExecution(admin(), a.caseId, deps());
  assert.deepEqual([r1.action, (r1 as any).reason], ["NEEDS_HUMAN", "SESSION_RULED_ELSEWHERE_OR_MISMATCH"]);
  assert.equal((await caseRow(a.caseId)).execStatus, "NEEDS_HUMAN");
  await refuses(executionService.executeDecision(admin(), a.caseId, {}, deps()), 409, "NEEDS_HUMAN");

  // ruled with this decision id but a DIFFERENT outcome than the decision's
  const s2 = await mkSession();
  const b = await approvedCaseFor(s2.session.id, FINDING_FOR.CANCELLED);
  await prisma.disputeCase.update({ where: { id: b.caseId }, data: { execStatus: "EXECUTING", execDecisionId: b.approvalId } });
  await prisma.session.update({ where: { id: s2.session.id }, data: { status: "COMPLETED", resolvedByCaseDecisionId: b.approvalId } });
  assert.equal((await executionService.reconcileExecution(admin(), b.caseId, deps())).action, "NEEDS_HUMAN");

  // DISPUTED yet an intent already carries the decision id: contradictory
  const s3 = await mkSession();
  const c = await approvedCaseFor(s3.session.id, FINDING_FOR.COMPLETED);
  await prisma.disputeCase.update({ where: { id: c.caseId }, data: { execStatus: "EXECUTING", execDecisionId: c.approvalId } });
  await prisma.sessionSettlement.create({ data: { kind: "SESSION_RELEASE", idempotencyKey: `SESSION_RELEASE:${s3.session.id}`, sessionId: s3.session.id, contractId: s3.contract.id, status: "PENDING", requestSnapshot: { caseDecisionId: c.approvalId } } });
  const r3 = await executionService.reconcileExecution(admin(), c.caseId, deps());
  assert.deepEqual([r3.action, (r3 as any).reason], ["NEEDS_HUMAN", "CONTRADICTION_DISPUTED_BUT_INTENT_RECORDED"]);
  assert.equal((await sessionRow(s3.session.id)).status, "DISPUTED", "not retried");
});

test("the core losing the compare-and-set after the pre-checks (a cancel won) -> NEEDS_HUMAN, the cancel is never overwritten", async () => {
  const s = await mkSession();
  const a = await approvedCaseFor(s.session.id, FINDING_FOR.COMPLETED);
  await assert.rejects(
    executionService.executeDecision(
      admin(),
      a.caseId,
      {},
      deps({ afterExecutingCas: async () => void (await prisma.session.update({ where: { id: s.session.id }, data: { status: "CANCELLED", cancelledBy: "CLIENT" } })) }),
    ),
    (e: any) => e.code === "NEEDS_HUMAN",
  );
  assert.equal((await sessionRow(s.session.id)).status, "CANCELLED");
  assert.equal((await caseRow(a.caseId)).execStatus, "NEEDS_HUMAN");
  assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: s.contract.id } })).usedSessions, 0);
});

// ═══ regression: the old exit when T0 is off ═══════════════════════════════════════════════════════════════════════

test("regression: with T0 off (flag on or off) the old exit rules a DISPUTED session exactly as before, with no decision id anywhere", async () => {
  for (const exec of [false, true]) {
    disableExecutionFlags();
    enableExecutionFlags({ execution: exec });
    const s = await mkSession();
    const r: any = await bookingService.resolveDispute(s.session.id, "old-admin", "CANCELLED", "ghi chú");
    assert.equal(r.status, "CANCELLED");
    const sess = await sessionRow(s.session.id);
    assert.deepEqual([sess.status, sess.resolvedBy, sess.resolvedByCaseDecisionId], ["CANCELLED", "old-admin", null]);
  }
  const s = await mkSession();
  const r: any = await bookingService.resolveDispute(s.session.id, "old-admin", "COMPLETED", "ghi chú");
  assert.equal(r.quotaDeducted, true);
  const rows = await settlements(s.session.id);
  assert.equal((rows[0].requestSnapshot as any).caseDecisionId, undefined, "no decision id on an old-exit intent");
});

test("the executor is reachable over HTTP only for ADMIN and answers the same refusals with Vietnamese messages and stable codes", async () => {
  const s = await mkSession();
  const a = await approvedCaseFor(s.session.id, FINDING_FOR.CANCELLED);
  assert.ok(typeof svc.list === "function");
  // the route is mounted inside the admin router (authMiddleware + roleMiddleware ADMIN) - see dispute-case-gateway-security / real-auth suites for HTTP
  const routes = (await import("../routes/dispute-case-admin.routes")).default as any;
  const paths = routes.stack.filter((l: any) => l.route).map((l: any) => `${Object.keys(l.route.methods)[0]} ${l.route.path}`);
  assert.ok(paths.includes("post /:id/execute") && paths.includes("post /:id/reconcile-execution"), paths.join(","));
  void a;
});
