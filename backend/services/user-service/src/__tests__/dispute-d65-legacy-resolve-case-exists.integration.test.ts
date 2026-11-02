/**
 * D65 track B - the OLD admin door POST /admin/sessions/:id/resolve must not rule independently of a Dispute Case.
 *
 * Evidence: REAL HTTP (user-service's real Express app in this process, real sockets) over the isolated *_test user database. TEST FIXTURE: session / contract rows, the
 * token -> identity table that replaces auth-service, a stub that REFUSES every payment-service write (no money may move in any case below - if one is attempted the test fails).
 * T0 is OFF in every test (that is the point: the guard works before T0). The Case executor's own context is exempt - proved in dispute-case-execution.integration.test.ts
 * (it keeps passing) and here by a core call with a verified CaseDecision under the executor.
 *
 * Run ALONE (truncates the dispute_case* tables).
 */
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { guardedTest as test } from "./test-db-guard";
import { paymentClient } from "../clients/payment.client";
import { authServiceClient } from "../clients/auth-service.client";
import { prisma } from "../repositories/profile.repository";
import { addSession, makeContract, patch } from "./pt-restriction.test-helpers";
import { disputeCaseService as svc } from "../services/dispute-case/dispute-case.service";
import { executionService } from "../services/dispute-case/execution.service";
import { admin, approvedCaseFor, caseAtFinding, disableExecutionFlags, enableExecutionFlags, FINDING_FOR } from "./dispute-case-exec.test-helpers";

const restores: Array<() => void> = [];
const contracts: string[] = [];
const pts: string[] = [];
let server: http.Server;
let base = "";
const ADMIN_TOKEN = "tok-admin-d65";
let paymentWrites: string[] = [];

test.before(async () => {
  for (const name of Object.keys(paymentClient)) {
    const original = (paymentClient as any)[name];
    (paymentClient as any)[name] =
      name === "lookupLedgerOperation"
        ? async () => null
        : async () => {
            paymentWrites.push(name);
            throw new Error(`payment write refused by the test stub: ${name}`);
          };
    restores.push(() => ((paymentClient as any)[name] = original));
  }
  restores.push(
    patch(authServiceClient, "verifyToken", async (header: string) => {
      if (String(header).replace(/^Bearer /, "") !== ADMIN_TOKEN) throw Object.assign(new Error("bad token"), { response: { status: 401, data: { error: "Invalid or expired token" } } });
      return { status: 200, data: { user: { id: "admin-d65-http", email: "a@test.local", role: "ADMIN" } } };
    }),
  );
  await prisma.$executeRawUnsafe(
    `TRUNCATE dispute_case_executions, dispute_case_access_logs, dispute_case_events, dispute_case_approvals, dispute_case_proposals, dispute_case_findings, dispute_case_assessments, dispute_case_shares, dispute_case_statements, dispute_case_evidence, dispute_case_claims, dispute_case_issues, dispute_cases CASCADE`,
  );
  const { default: app } = await import("../app");
  server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
test.after(async () => {
  disableExecutionFlags();
  for (const r of restores) r();
  if (server) await new Promise((r) => server.close(r));
  await prisma.sessionSettlement.deleteMany({ where: { contractId: { in: contracts } } }).catch(() => {});
  await prisma.auditLog.deleteMany({ where: { entityId: { in: contracts } } }).catch(() => {});
  await prisma.notification.deleteMany({ where: { userId: { in: pts } } }).catch(() => {});
  await prisma.session.deleteMany({ where: { contractId: { in: contracts } } }).catch(() => {});
  await prisma.contract.deleteMany({ where: { id: { in: contracts } } }).catch(() => {});
  await prisma.userProfile.deleteMany({ where: { userId: { in: pts } } }).catch(() => {});
  await prisma.$disconnect();
});
test.beforeEach(() => {
  disableExecutionFlags(); // T0 OFF
  paymentWrites = [];
});

async function mk() {
  const ptUserId = randomUUID();
  const contract = await makeContract(ptUserId, { sessionMode: "ONLINE" });
  contracts.push(contract.id);
  pts.push(ptUserId);
  const session = await addSession(contract, "DISPUTED", new Date(Date.now() - 3 * 3600_000), {
    sessionMode: "ONLINE",
    disputeType: "DELIVERY_DISPUTE",
    disputedAt: new Date(Date.now() - 3600_000),
    disputeReason: "Buổi tập không diễn ra như đã hẹn",
    ptNotes: "PT báo đã dạy đủ giờ",
  });
  return { contract, session };
}
async function resolve(sessionId: string, resolution: string) {
  const res = await fetch(`${base}/admin/sessions/${sessionId}/resolve`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${ADMIN_TOKEN}` },
    body: JSON.stringify({ resolution, note: "phán quyết cũ" }),
  });
  return { status: res.status, body: (await res.json().catch(() => null)) as any };
}
/** everything the ruling could have written */
async function footprint(sessionId: string, contractId: string) {
  const s = await prisma.session.findUniqueOrThrow({ where: { id: sessionId } });
  const c = await prisma.contract.findUniqueOrThrow({ where: { id: contractId } });
  return {
    status: s.status,
    sessionDeducted: s.sessionDeducted,
    resolvedBy: s.resolvedBy,
    resolvedByCaseDecisionId: s.resolvedByCaseDecisionId,
    usedSessions: c.usedSessions,
    compensatedSessions: c.compensatedSessions,
    settlements: await prisma.sessionSettlement.count({ where: { sessionId } }),
    notifications: await prisma.notification.count({ where: { entityId: sessionId } }),
  };
}

const OUTCOMES = ["COMPLETED", "CANCELLED", "PT_NO_SHOW_CONFIRMED"] as const;

test("HTTP, T0 OFF: a session with an OPEN Case (INTAKE) -> 409 CASE_EXISTS for all three outcomes, nothing written, no payment call", async () => {
  const s = await mk();
  await svc.openCase(admin(), s.session.id); // INTAKE
  const before = await footprint(s.session.id, s.contract.id);
  for (const outcome of OUTCOMES) {
    const r = await resolve(s.session.id, outcome);
    assert.equal(r.status, 409, JSON.stringify(r.body));
    assert.equal(r.body.code, "CASE_EXISTS");
  }
  assert.deepEqual(await footprint(s.session.id, s.contract.id), before);
  assert.equal(before.status, "DISPUTED");
  assert.deepEqual(paymentWrites, []);
});

test("HTTP, T0 OFF: a Case at FINDING_RECORDED (investigated, not decided) -> 409 CASE_EXISTS, nothing written", async () => {
  const s = await mk();
  await caseAtFinding(s.session.id, FINDING_FOR.CANCELLED);
  const before = await footprint(s.session.id, s.contract.id);
  const r = await resolve(s.session.id, "CANCELLED");
  assert.deepEqual([r.status, r.body.code], [409, "CASE_EXISTS"]);
  assert.deepEqual(await footprint(s.session.id, s.contract.id), before);
});

test("HTTP, T0 OFF: a Case at DECISION_APPROVED (approved, NOT executed yet) -> 409 CASE_EXISTS: the old door cannot rule ahead of the executor", async () => {
  const s = await mk();
  const a = await approvedCaseFor(s.session.id, FINDING_FOR.CANCELLED);
  assert.equal((await prisma.disputeCase.findUniqueOrThrow({ where: { id: a.caseId } })).status, "DECISION_APPROVED");
  const before = await footprint(s.session.id, s.contract.id);
  for (const outcome of OUTCOMES) {
    const r = await resolve(s.session.id, outcome);
    assert.deepEqual([r.status, r.body.code], [409, "CASE_EXISTS"], outcome);
  }
  assert.deepEqual(await footprint(s.session.id, s.contract.id), before);
  assert.deepEqual(paymentWrites, []);
});

test("HTTP, T0 OFF: a session with NO Case keeps today's behaviour (200, CANCELLED, resolvedBy = the admin from the token)", async () => {
  const s = await mk();
  const r = await resolve(s.session.id, "CANCELLED");
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const row = await prisma.session.findUniqueOrThrow({ where: { id: s.session.id } });
  assert.deepEqual([row.status, row.resolvedBy, row.resolvedByCaseDecisionId], ["CANCELLED", "admin-d65-http", null]);
});

test("HTTP, T0 OFF: a Case closed WITHOUT a decision (REJECTED_INTAKE, terminal) does not block the old door", async () => {
  const s = await mk();
  const opened = (await svc.openCase(admin(), s.session.id)).result.case.id;
  await prisma.disputeCase.update({ where: { id: opened }, data: { status: "REJECTED_INTAKE" } });
  const r = await resolve(s.session.id, "CANCELLED");
  assert.equal(r.status, 200, JSON.stringify(r.body));
});

test("core boundary: the guard sits in resolveDisputeCore, so a direct service call (any door that is not the route) is refused too", async () => {
  const { bookingService } = await import("../services/booking.service");
  const s = await mk();
  await svc.openCase(admin(), s.session.id);
  await assert.rejects(bookingService.resolveDispute(s.session.id, "someone", "CANCELLED", "ghi chú"), (e: any) => [e.status, e.code].join() === "409,CASE_EXISTS");
  assert.equal((await prisma.session.findUniqueOrThrow({ where: { id: s.session.id } })).status, "DISPUTED");
});

test("the Case executor (CaseDecision context) is exempt: the same DECISION_APPROVED Case that blocks the old door is executed by the executor", async () => {
  enableExecutionFlags({ execution: true });
  const s = await mk();
  const a = await approvedCaseFor(s.session.id, FINDING_FOR.CANCELLED);
  const blocked = await resolve(s.session.id, "CANCELLED");
  assert.deepEqual([blocked.status, blocked.body.code], [409, "CASE_EXISTS"]);
  const r = await executionService.executeDecision(admin(), a.caseId, {});
  assert.equal(r.executionState, "BUSINESS_DONE");
  const row = await prisma.session.findUniqueOrThrow({ where: { id: s.session.id } });
  assert.deepEqual([row.status, row.resolvedByCaseDecisionId], ["CANCELLED", a.approvalId]);
});
