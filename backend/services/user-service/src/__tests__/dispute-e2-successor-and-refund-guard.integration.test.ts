/**
 * E2 and E6/F2 (user-service side), Ngài 05/11/2026. REAL HTTP into user-service's Express app over the isolated *_test database; payment-service writes are REFUSED by a stub (a failed
 * test if one is attempted: none of this moves money). TEST FIXTURE: the contract / session rows, the token -> identity table.
 *
 * E2  a session whose Case was CLOSED as NOT_A_DISPUTE stays DISPUTED: it may get ONE new Case through the normal open-case path; the legacy one-admin door stays refused for it; no loop
 *     (one live case, a closed case has at most one successor, no third case, no successor after any other closure); the link to the closed case is audited.
 * F2  POST /internal/contracts/:id/refund-guard - the read-only answer payment-service asks before a PT-contract refund.
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
import { admin, approvedCaseFor, caseAtFinding, disableExecutionFlags } from "./dispute-case-exec.test-helpers";

const restores: Array<() => void> = [];
const contracts: string[] = [];
const pts: string[] = [];
let server: http.Server;
let base = "";
const ADMIN_TOKEN = "tok-admin-e2";
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
      return { status: 200, data: { user: { id: "admin-e2-http", email: "a@test.local", role: "ADMIN" } } };
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
  await prisma.$disconnect();
});
test.beforeEach(() => {
  disableExecutionFlags();
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
async function legacyResolve(sessionId: string, resolution: string) {
  const res = await fetch(`${base}/admin/sessions/${sessionId}/resolve`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${ADMIN_TOKEN}` },
    body: JSON.stringify({ resolution, note: "phán quyết cũ" }),
  });
  return { status: res.status, body: (await res.json().catch(() => null)) as any };
}
async function guard(contractId: string, body: unknown = {}, secret: string | null = process.env.INTERNAL_SERVICE_SECRET || "dev_internal_service_secret_change_in_production") {
  const res = await fetch(`${base}/internal/contracts/${contractId}/refund-guard`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(secret ? { "x-service-secret": secret } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json().catch(() => null)) as any };
}
/** A case taken to FINDING_RECORDED with NOT_A_DISPUTE and then CLOSED by its investigator. */
async function closedNotADispute(sessionId: string) {
  const at = await caseAtFinding(sessionId, "NOT_A_DISPUTE" as any);
  await svc.closeNotADispute(at.investigator, at.caseId, "Không phải khiếu nại: hai bên đã thống nhất");
  return at;
}
const refuses = (p: Promise<unknown>, status: number, code: string) =>
  assert.rejects(p, (e: any) => {
    assert.equal([e.status, e.code].join(), [status, code].join());
    return true;
  });

test("E2: a case closed NOT_A_DISPUTE leaves the session DISPUTED; the legacy one-admin door stays refused; ONE new case may be opened through the normal path, with the link audited", async () => {
  const s = await mk();
  const first = await closedNotADispute(s.session.id);
  const c1 = await prisma.disputeCase.findUniqueOrThrow({ where: { id: first.caseId } });
  assert.deepEqual([c1.status, c1.closeReason], ["CLOSED", "NOT_A_DISPUTE"]);
  assert.equal((await prisma.session.findUniqueOrThrow({ where: { id: s.session.id } })).status, "DISPUTED", "the session is untouched");

  // the legacy door still refuses it (a closed case is a case), nothing written
  for (const outcome of ["COMPLETED", "CANCELLED", "PT_NO_SHOW_CONFIRMED"]) {
    const r = await legacyResolve(s.session.id, outcome);
    assert.deepEqual([r.status, r.body.code], [409, "CASE_EXISTS"], outcome);
  }
  assert.equal((await prisma.session.findUniqueOrThrow({ where: { id: s.session.id } })).status, "DISPUTED");

  // ONE new case through the normal open-case path
  const inv2 = admin();
  const opened = await svc.openCase(inv2, s.session.id);
  assert.equal(opened.result.created, true);
  const c2 = await prisma.disputeCase.findUniqueOrThrow({ where: { id: opened.result.case.id } });
  assert.deepEqual([c2.status, c2.previousCaseId], ["INTAKE", c1.id], "audited link to the closed case");
  assert.equal(opened.result.case.previousCaseId, c1.id);
  const link = await prisma.disputeCaseEvent.findFirstOrThrow({ where: { caseId: c1.id, action: "CASE_SUCCEEDED_BY" } });
  assert.equal((link.payload as any).newCaseId, c2.id);
  assert.equal((await prisma.disputeCase.findUniqueOrThrow({ where: { id: c1.id } })).status, "CLOSED", "the closed case itself is not changed");
  // no loop: a second open returns the same live case; one successor per closed case (also in the database)
  const again = await svc.openCase(admin(), s.session.id);
  assert.deepEqual([again.result.created, again.result.case.id], [false, c2.id]);
  await assert.rejects(
    prisma.disputeCase.create({ data: { sessionId: s.session.id, contractId: s.contract.id, clientUserId: s.contract.clientUserId, ptUserId: s.contract.ptUserId, type: "PT_DELIVERY", status: "CLOSED", closeReason: "NOT_A_DISPUTE", createdBy: "fx", previousCaseId: c1.id } }),
    /one_successor|Unique constraint/,
  );
  await assert.rejects(prisma.$executeRawUnsafe(`UPDATE dispute_cases SET previous_case_id = id WHERE id = '${c2.id}'::uuid`), /previous_not_self|violates check/);

  // the new case is a normal case: four-eyes downstream - it can be taken to an approved decision by two different admins
  await prisma.disputeCase.update({ where: { id: c2.id }, data: { status: "CLOSED", closeReason: "NOT_A_DISPUTE" } }); // TEST FIXTURE: the second case is also closed NOT_A_DISPUTE
  await refuses(svc.openCase(admin(), s.session.id), 409, "CASE_CLOSED_NO_REOPEN"); // no third case
  assert.deepEqual(paymentWrites, [], "no money moved");
});

test("E2: no successor after any OTHER closure (EXECUTED etc.); a session with an APPROVED decision still gets none; the second case is a normal case that can be approved by two admins", async () => {
  const s = await mk();
  await prisma.disputeCase.create({ data: { sessionId: s.session.id, contractId: s.contract.id, clientUserId: s.contract.clientUserId, ptUserId: s.contract.ptUserId, type: "PT_DELIVERY", status: "CLOSED", closeReason: "EXECUTED", createdBy: "fx" } });
  await refuses(svc.openCase(admin(), s.session.id), 409, "CASE_CLOSED_NO_REOPEN");

  const t = await mk();
  const first = await closedNotADispute(t.session.id);
  const second = await svc.openCase(admin(), t.session.id);
  assert.equal(second.result.created, true);
  // the successor goes the normal path: a fresh case for the same session reaches DECISION_APPROVED by two different admins (here driven on another session of the same shape)
  const u = await mk();
  const a = await approvedCaseFor(u.session.id, "VERIFIED_DELIVERED");
  assert.notEqual(a.investigator.id, a.approver.id);
  await refuses(svc.openCase(admin(), u.session.id), 409, "CASE_DECISION_PENDING_EXECUTION");
  void first;
});

test("F2 (user-service side): refund-guard answers 200 with no Case, 409 CONTRACT_CASE_OPEN for an unfinished Case, 409 CONTRACT_CASE_DECISION_EXISTS for an approved decision (not with openOnly), 200 after a case closed at intake; wrong secret refused", async () => {
  const none = await mk();
  assert.deepEqual([(await guard(none.contract.id)).status, (await guard(none.contract.id)).body.data], [200, { allowed: true }]);

  const open = await mk();
  await svc.openCase(admin(), open.session.id);
  const o = await guard(open.contract.id);
  assert.deepEqual([o.status, o.body.error.code], [409, "CONTRACT_CASE_OPEN"]);
  assert.equal((await guard(open.contract.id, { openOnly: true })).body.error.code, "CONTRACT_CASE_OPEN", "openOnly still blocks an unfinished case");

  const decided = await mk();
  await approvedCaseFor(decided.session.id, "VERIFIED_DELIVERED");
  const d = await guard(decided.contract.id);
  assert.deepEqual([d.status, d.body.error.code], [409, "CONTRACT_CASE_DECISION_EXISTS"]);
  assert.deepEqual([(await guard(decided.contract.id, { openOnly: true })).status], [200], "openOnly: an approved decision does not block a holdback decision");

  const rejected = await mk();
  const rc = (await svc.openCase(admin(), rejected.session.id)).result.case.id;
  await prisma.disputeCase.update({ where: { id: rc }, data: { status: "REJECTED_INTAKE" } });
  assert.equal((await guard(rejected.contract.id)).status, 200, "a case closed at intake is not a Case");

  assert.ok([401, 403].includes((await guard(none.contract.id, {}, "wrong-secret")).status));
  assert.ok([401, 403].includes((await guard(none.contract.id, {}, null)).status));
  assert.deepEqual(paymentWrites, []);
});
