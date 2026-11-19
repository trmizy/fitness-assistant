/**
 * N13D-03 - the evidence-change guard no longer calls a contract "changed" only because ANOTHER session of it was settled meanwhile.
 *
 * BACKEND INTEGRATION on the isolated *_test user database (session / contract rows = TEST FIXTURE; the case is opened through the real service, the guard is the real
 * evidenceGuard called with the stored snapshot). The cross-service reads are handed in empty (`prefetched = []`): this test is about the two contract slots only.
 *
 * Run ALONE (truncates the dispute_case* tables).
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { guardedTest as test } from "./test-db-guard";
import { prisma } from "../repositories/profile.repository";
import { disputeCaseService as svc, evidenceGuard } from "../services/dispute-case/dispute-case.service";
import { stableSlotHash, VOLATILE_LIVE_FIELDS } from "../services/dispute-case/collector";
import { addSession, makeContract } from "./pt-restriction.test-helpers";
import { admin } from "./dispute-case-exec.test-helpers";

const contracts: string[] = [];
const pts: string[] = [];
const A1 = admin();

test.before(async () => {
  await prisma.$executeRawUnsafe(
    `TRUNCATE dispute_case_executions, dispute_case_access_logs, dispute_case_events, dispute_case_approvals, dispute_case_proposals, dispute_case_findings, dispute_case_assessments, dispute_case_shares, dispute_case_statements, dispute_case_evidence, dispute_case_claims, dispute_case_issues, dispute_cases CASCADE`,
  );
});
test.after(async () => {
  await prisma.auditLog.deleteMany({ where: { entityId: { in: contracts } } }).catch(() => {});
  await prisma.session.deleteMany({ where: { contractId: { in: contracts } } }).catch(() => {});
  await prisma.contract.deleteMany({ where: { id: { in: contracts } } }).catch(() => {});
  await prisma.userProfile.deleteMany({ where: { userId: { in: pts } } }).catch(() => {});
  await prisma.$disconnect();
});

test("stableSlotHash: only the declared volatile fields are ignored, only on their own slot", () => {
  const base = { id: "c", status: "ACTIVE", price: "100", usedSessions: 1, compensatedSessions: 0, extraSessions: 0 };
  const a = stableSlotHash("user-service.contracts", "CONTRACT_SNAPSHOT", base);
  assert.equal(a, stableSlotHash("user-service.contracts", "CONTRACT_SNAPSHOT", { ...base, usedSessions: 5, compensatedSessions: 2, extraSessions: 1 }));
  assert.notEqual(a, stableSlotHash("user-service.contracts", "CONTRACT_SNAPSHOT", { ...base, price: "200" }));
  assert.notEqual(a, stableSlotHash("user-service.contracts", "CONTRACT_SNAPSHOT", { ...base, status: "TERMINATED" }));
  // another slot: nothing is ignored
  assert.notEqual(stableSlotHash("user-service.sessions", "SESSION_ROW", base), stableSlotHash("user-service.sessions", "SESSION_ROW", { ...base, usedSessions: 5 }));
  assert.deepEqual(Object.keys(VOLATILE_LIVE_FIELDS).sort(), ["user-service.contracts#CONTRACT_FINANCIAL_SNAPSHOT", "user-service.contracts#CONTRACT_SNAPSHOT"]);
});

test("evidenceGuard: counters / released-money moved by another session do not make the contract slots stale; a real change (price, rates, status) still does", async () => {
  const ptUserId = randomUUID();
  const contract = await makeContract(ptUserId, { sessionMode: "ONLINE" });
  contracts.push(contract.id);
  pts.push(ptUserId);
  const session = await addSession(contract, "DISPUTED", new Date(Date.now() - 3 * 3600_000), { sessionMode: "ONLINE", disputeType: "DELIVERY_DISPUTE", disputedAt: new Date(), disputeReason: "Khách khiếu nại", ptNotes: "PT ghi chú" });
  const caseId = (await svc.openCase(A1, session.id)).result.case.id;
  const c = await prisma.disputeCase.findUniqueOrThrow({ where: { id: caseId } });
  const rows = await prisma.disputeCaseEvidence.findMany({ where: { caseId }, select: { id: true, contentHash: true, snapshotVersion: true } });
  const snapshot = rows.map((r) => ({ id: r.id, hash: r.contentHash, version: r.snapshotVersion }));
  const guard = () => evidenceGuard(prisma as any, c as any, snapshot, []);

  assert.deepEqual((await guard()).staleLive.filter((s) => s.includes("contracts#")), [], "nothing moved yet");

  // another case on the same contract executes: quota counters and released money move
  await prisma.contract.update({ where: { id: contract.id }, data: { usedSessions: { increment: 1 }, compensatedSessions: { increment: 1 }, releasedToPt: 1000, releasedToGym: 500, releasedToPlatform: 250 } });
  const afterOther = await guard();
  assert.deepEqual(afterOther.staleLive.filter((s) => s.includes("contracts#")), [], "volatile fields only -> not stale (N13D-03)");
  assert.equal(afterOther.changed && afterOther.staleLive.some((s) => s.includes("contracts#")), false);

  // a real change of a field a decision rests on is still detected
  await prisma.contract.update({ where: { id: contract.id }, data: { price: { increment: 1000 } } });
  const afterPrice = await guard();
  assert.ok(afterPrice.staleLive.some((s) => s.endsWith("contracts#CONTRACT_SNAPSHOT")), "price changed -> CONTRACT_SNAPSHOT stale");
  assert.ok(afterPrice.changed);
});
