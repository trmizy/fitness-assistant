/**
 * DISPUTE CASE slice 1 - BACKEND INTEGRATION against the isolated *_test user database (real rows, real triggers, real constraints, real
 * transactions). payment-service is a TEST FIXTURE at the client boundary: the read-only ledger lookup is a stub; every OTHER paymentClient
 * method throws, which is how this suite proves the case code never calls a money WRITE. The HTTP block drives the real express app with
 * authServiceClient.verifyToken stubbed (REAL HTTP on a local ephemeral port, but the auth-service half is a TEST FIXTURE).
 * None of this is a browser or cross-service end-to-end.
 *
 * Run ALONE (it truncates the dispute_case* tables). The DB is chosen ONLY by TEST_DATABASE_URL (localhost/127.0.0.1, port 55433, name ending
 * _test, not the .env URL); the preload src/__tests__/setup/db-isolation.ts turns it into DATABASE_URL, any other value makes the suite SKIP:
 *   TEST_DATABASE_URL="postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_user_dispute_test?schema=public" \
 *   FITNESS_DISABLE_REDIS=true npx tsx --import ./src/__tests__/setup/db-isolation.ts --test --test-concurrency=1 src/__tests__/dispute-case.integration.test.ts
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { guardedTest as test } from "./test-db-guard";
import { paymentClient } from "../clients/payment.client";
import { authServiceClient } from "../clients/auth-service.client";
import { prisma } from "../repositories/profile.repository";
import { disputeCaseService as svc, type Actor } from "../services/dispute-case/dispute-case.service";
import { addSession, makeContract } from "./pt-restriction.test-helpers";
import type { FindingKind } from "../services/dispute-case/rules";
// Slice 2 / S2.3: this suite must not open sockets to chat-service / gym-service; the collector keeps its Slice 1 placeholders here.
process.env.DISPUTE_CASE_EXTERNAL_EVIDENCE_DISABLED ??= "true";

const admin = (): Actor => ({ id: randomUUID(), role: "ADMIN" });
const A1 = admin(); // investigator / proposer
const A2 = admin(); // approver
const A3 = admin(); // another admin
const A4 = admin(); // second approver (race)

const APPEND_ONLY_TABLES = [
  "dispute_case_evidence",
  "dispute_case_statements",
  "dispute_case_shares",
  "dispute_case_assessments",
  "dispute_case_findings",
  "dispute_case_proposals",
  "dispute_case_approvals",
  "dispute_case_events",
  "dispute_case_access_logs",
];

// ── ledger / payment fixture ────────────────────────────────────────────────────────────────────────────────────────
const ledger = { ops: new Map<string, any>(), down: false, lookups: [] as string[] };
const writeCalls: string[] = [];
const restores: Array<() => void> = [];
const createdContracts: string[] = [];
const createdPts: string[] = [];

function stubPayments() {
  for (const name of Object.keys(paymentClient)) {
    const original = (paymentClient as any)[name];
    if (name === "lookupLedgerOperation") {
      (paymentClient as any)[name] = async (key: string) => {
        ledger.lookups.push(key);
        if (ledger.down) throw Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
        return ledger.ops.get(key) ?? null;
      };
    } else {
      (paymentClient as any)[name] = async () => {
        writeCalls.push(name);
        throw new Error(`MONEY WRITE FROM CASE CODE: paymentClient.${name}`);
      };
    }
    restores.push(() => ((paymentClient as any)[name] = original));
  }
}

test.before(async () => {
  stubPayments();
  await prisma.$executeRawUnsafe(
    `TRUNCATE dispute_case_access_logs, dispute_case_events, dispute_case_approvals, dispute_case_proposals, dispute_case_findings, dispute_case_assessments, dispute_case_shares, dispute_case_statements, dispute_case_evidence, dispute_case_claims, dispute_case_issues, dispute_cases CASCADE`,
  );
});
test.after(async () => {
  for (const r of restores) r();
  await prisma.sessionSettlement.deleteMany({ where: { contractId: { in: createdContracts } } }).catch(() => {});
  await prisma.auditLog.deleteMany({ where: { entityId: { in: createdContracts } } }).catch(() => {});
  await prisma.session.deleteMany({ where: { contractId: { in: createdContracts } } }).catch(() => {});
  await prisma.contract.deleteMany({ where: { id: { in: createdContracts } } }).catch(() => {});
  await prisma.ptRestriction.deleteMany({ where: { ptUserId: { in: createdPts } } }).catch(() => {});
  await prisma.userProfile.deleteMany({ where: { userId: { in: createdPts } } }).catch(() => {});
  await prisma.$disconnect();
});

async function mkSession(
  over: { status?: string; disputeType?: string | null; mode?: "ONLINE" | "OFFLINE"; ptNotes?: string | null; disputeReason?: string | null; roomPtJoinedAt?: Date | null; roomClientJoinedAt?: Date | null } = {},
) {
  const ptUserId = randomUUID();
  const contract = await makeContract(ptUserId, { sessionMode: over.mode ?? "ONLINE" });
  createdContracts.push(contract.id);
  createdPts.push(ptUserId);
  const session = await addSession(contract, over.status ?? "DISPUTED", new Date(Date.now() - 3 * 3600_000), {
    sessionMode: over.mode ?? "ONLINE",
    disputeType: over.disputeType === undefined ? "DELIVERY_DISPUTE" : over.disputeType,
    disputedAt: new Date(Date.now() - 3600_000),
    disputeReason: over.disputeReason === undefined ? "Buổi tập không diễn ra như đã hẹn" : over.disputeReason,
    ptNotes: over.ptNotes === undefined ? "PT báo đã dạy đủ giờ" : over.ptNotes,
    roomPtJoinedAt: over.roomPtJoinedAt ?? null,
    roomClientJoinedAt: over.roomClientJoinedAt ?? null,
  });
  return { contract, session, ptUserId, clientUserId: contract.clientUserId };
}

async function toAwaitingApproval(o: { finding?: FindingKind; sessionOver?: Parameters<typeof mkSession>[0]; prepare?: (s: Awaited<ReturnType<typeof mkSession>>) => Promise<void> } = {}) {
  const s = await mkSession(o.sessionOver);
  if (o.prepare) await o.prepare(s);
  const caseId = (await svc.openCase(A1, s.session.id)).result.case.id;
  await svc.assign(A1, caseId, undefined);
  await svc.transition(A1, caseId, "COLLECTING", {});
  const claim = await svc.addClaim(A1, caseId, { claimantRole: "CLIENT", text: "PT không có mặt đủ giờ", moves: ["MONEY", "QUOTA"] });
  await svc.transition(A1, caseId, "ASSESSING", {});
  const ev = await prisma.disputeCaseEvidence.findFirstOrThrow({ where: { caseId, subject: "SESSION_ROW" } });
  await svc.addAssessment(A1, caseId, {
    claimId: claim.result.id,
    directEvidenceIds: [ev.id],
    indirectEvidenceIds: [],
    rebuttalEvidenceIds: [],
    relevanceNote: "Đúng buổi, đúng khung giờ",
    verifiabilityNote: "Dữ liệu máy chủ",
    consistencyNote: "Khớp các nguồn còn lại",
    result: "ESTABLISHED",
    reasoning: "Dữ liệu phòng và lời khai khớp nhau",
  });
  await svc.recordFinding(A1, caseId, { finding: o.finding ?? "VERIFIED_PT_ABSENT", reasoning: "Đã xác minh" });
  const proposal = (await svc.propose(A1, caseId, undefined)).result;
  return { ...s, caseId, proposal };
}

const approveBody = (over: Record<string, unknown> = {}) => ({ result: "APPROVED" as const, reason: "Đồng ý", conflictOfInterestDeclaredNone: true, evidenceChangeAcknowledged: false, ...over });
const rejects = (p: Promise<unknown>, status: number, code: string) =>
  assert.rejects(p, (e: any) => {
    assert.equal(e.status, status, `${e.code}: ${e.message}`);
    assert.equal(e.code, code);
    assert.match(e.message, /[À-ỹ]|[a-z]/); // non-empty message
    return true;
  });

// ═══ Intake ═════════════════════════════════════════════════════════════════════════════════════════════════════════

test("intake from a DISPUTED session: PT_DELIVERY, every source collected read-only, legacy fields become statement v1, cross-service sources UNAVAILABLE", async () => {
  const s = await mkSession({ mode: "ONLINE", roomPtJoinedAt: null, roomClientJoinedAt: new Date() });
  await prisma.auditLog.create({ data: { actorUserId: s.clientUserId, action: "SESSION_BOOKED", entityType: "SESSION", entityId: s.session.id, metadata: { a: 1 }, ipAddress: "203.0.113.9", userAgent: "UA-secret" } });
  await prisma.auditLog.create({ data: { actorUserId: s.ptUserId, action: "CONTRACT_ACCEPTED", entityType: "CONTRACT", entityId: s.contract.id } });
  await prisma.sessionSettlement.create({ data: { kind: "SESSION_RELEASE", idempotencyKey: `SESSION_RELEASE:${s.session.id}`, sessionId: s.session.id, contractId: s.contract.id, status: "PENDING" } });
  await prisma.sessionRescheduleRequest.create({
    data: { sessionId: s.session.id, requestedBy: "CLIENT", originalStartAt: s.session.scheduledStartAt, originalEndAt: s.session.scheduledEndAt, proposedStartAt: new Date(), proposedEndAt: new Date(), reason: "Bận" },
  });

  const out = await svc.openCase(A1, s.session.id);
  assert.equal(out.result.created, true);
  const c = out.result.case;
  assert.equal(c.type, "PT_DELIVERY");
  assert.equal(c.status, "INTAKE");
  assert.equal((c as any).clientUserId, undefined, "summary does not leak ids it does not need");

  const row = await prisma.disputeCase.findUniqueOrThrow({ where: { id: c.id } });
  assert.equal(row.clientUserId, s.clientUserId);
  assert.equal(row.ptUserId, s.ptUserId);
  assert.equal(row.contractId, s.contract.id);
  assert.equal(row.createdBy, A1.id);

  const ev = await prisma.disputeCaseEvidence.findMany({ where: { caseId: c.id } });
  assert.equal(ev.length, 13);
  const by = (subject: string) => ev.find((e) => e.subject === subject)!;
  for (const e of ev) {
    assert.equal(e.snapshotVersion, 1);
    assert.equal(e.scopeSessionId, s.session.id);
    assert.equal(e.scopeContractId, s.contract.id);
    assert.match(e.contentHash, /^[0-9a-f]{64}$/);
  }
  // NULL room join is "not recorded", never absence
  const ptJoin = by("ROOM_PT_JOINED_AT");
  assert.equal(ptJoin.captureStatus, "OK");
  assert.equal(ptJoin.provenanceType, "SERVER_OBSERVED");
  assert.deepEqual(ptJoin.payload, { value: null, note: "NULL không phải bằng chứng vắng mặt" });
  assert.ok((by("ROOM_CLIENT_JOINED_AT").payload as any).value);
  // financial parts are SENSITIVE, plain facts NORMAL
  assert.equal(by("CONTRACT_FINANCIAL_SNAPSHOT").sensitivity, "SENSITIVE");
  assert.equal(by("CONTRACT_SNAPSHOT").sensitivity, "NORMAL");
  assert.equal(by("SETTLEMENTS").sensitivity, "SENSITIVE");
  assert.equal((by("SETTLEMENTS").payload as any).rows.length, 1);
  assert.equal((by("RESCHEDULE_REQUESTS").payload as any).rows.length, 1);
  // audit trail copied WITHOUT ip / user agent
  const audit = by("AUDIT_LOG:SESSION");
  assert.equal((audit.payload as any).rows.length, 1);
  assert.doesNotMatch(JSON.stringify(ev.map((e) => e.payload)), /203\.0\.113\.9|UA-secret|ipAddress|userAgent/);
  assert.equal((by("AUDIT_LOG:CONTRACT").payload as any).rows.length, 1);
  assert.ok(Array.isArray((by("PT_TERMS_ACCEPTANCES").payload as any).rows));
  // cross-service sources: recorded, not read
  for (const subject of ["CALL_SESSIONS", "GYM_PT_CHECK_INS", "GYM_CHECK_INS"]) {
    const e = by(subject);
    assert.equal(e.captureStatus, "UNAVAILABLE");
    assert.equal(e.provenanceType, "TECH_GAP");
    assert.match((e.payload as any).note, /SOURCE_NOT_INTEGRATED — DESIGN_REQUIRED \(Slice 2\)/);
  }
  // legacy free text -> statement v1 with source LEGACY_FIELD
  const st = await prisma.disputeCaseStatement.findMany({ where: { caseId: c.id }, orderBy: { partyRole: "asc" } });
  assert.deepEqual(st.map((x) => [x.partyRole, x.version, x.source, x.authorUserId]), [["CLIENT", 1, "LEGACY_FIELD", s.clientUserId], ["PT", 1, "LEGACY_FIELD", s.ptUserId]]);
  assert.equal(st[0].text, "Buổi tập không diễn ra như đã hẹn");
  // the INTAKE event exists
  const events = await prisma.disputeCaseEvent.findMany({ where: { caseId: c.id } });
  assert.deepEqual(events.map((e) => e.action), ["INTAKE"]);
  assert.equal(writeCalls.length, 0);
});

test("OFFLINE session: room join evidence is NOT_APPLICABLE; PT_NO_SHOW_REPORTED -> PT_NO_SHOW_CLAIM; CLIENT_NO_SHOW_CLAIM -> PT_CLIENT_NO_SHOW_CLAIM", async () => {
  const off = await mkSession({ mode: "OFFLINE" });
  const caseOff = (await svc.openCase(A1, off.session.id)).result.case;
  const rows = await prisma.disputeCaseEvidence.findMany({ where: { caseId: caseOff.id, subject: { in: ["ROOM_PT_JOINED_AT", "ROOM_CLIENT_JOINED_AT"] } } });
  assert.equal(rows.length, 2);
  for (const r of rows) {
    assert.equal(r.captureStatus, "NOT_APPLICABLE");
    assert.equal(r.provenanceType, "NOT_APPLICABLE");
  }
  const reported = await mkSession({ status: "PT_NO_SHOW_REPORTED", disputeType: null });
  assert.equal((await svc.openCase(A1, reported.session.id)).result.case.type, "PT_NO_SHOW_CLAIM");
  const deny = await mkSession({ disputeType: "PT_NO_SHOW_CLAIM" });
  assert.equal((await svc.openCase(A1, deny.session.id)).result.case.type, "PT_NO_SHOW_CLAIM");
  const clientNs = await mkSession({ disputeType: "CLIENT_NO_SHOW_CLAIM" });
  assert.equal((await svc.openCase(A1, clientNs.session.id)).result.case.type, "PT_CLIENT_NO_SHOW_CLAIM");
});

test("intake refuses other session statuses (409), a missing session (404), a non-admin (403) and an admin who is a party (403)", async () => {
  for (const status of ["REQUESTED", "CONFIRMED", "PENDING_CLIENT_CONFIRMATION", "COMPLETED", "CANCELLED", "NO_SHOW"]) {
    const s = await mkSession({ status });
    await rejects(svc.openCase(A1, s.session.id), 409, "SESSION_NOT_DISPUTED");
    assert.equal(await prisma.disputeCase.count({ where: { sessionId: s.session.id } }), 0);
  }
  await rejects(svc.openCase(A1, randomUUID()), 404, "SESSION_NOT_FOUND");
  const s = await mkSession();
  await rejects(svc.openCase({ id: randomUUID(), role: "CUSTOMER" }, s.session.id), 403, "ADMIN_ONLY");
  await rejects(svc.openCase({ id: s.clientUserId, role: "ADMIN" }, s.session.id), 403, "CONFLICT_OF_INTEREST");
});

test("intake is idempotent: an open case is returned, never duplicated; two concurrent intakes make exactly one case", async () => {
  const s = await mkSession();
  const first = await svc.openCase(A1, s.session.id);
  const second = await svc.openCase(A3, s.session.id);
  assert.equal(first.result.created, true);
  assert.equal(second.result.created, false);
  assert.equal(second.result.case.id, first.result.case.id);
  assert.equal(await prisma.disputeCase.count({ where: { sessionId: s.session.id } }), 1);

  const race = await mkSession();
  const [x, y] = await Promise.all([svc.openCase(A1, race.session.id), svc.openCase(A3, race.session.id)]);
  assert.equal(x.result.case.id, y.result.case.id);
  assert.equal(await prisma.disputeCase.count({ where: { sessionId: race.session.id } }), 1);
  assert.equal([x, y].filter((r) => r.result.created).length, 1);
});

test("the database itself allows only one open case per session (partial unique index); a terminal case frees the slot", async () => {
  const s = await mkSession();
  const base = { sessionId: s.session.id, contractId: s.contract.id, clientUserId: s.clientUserId, ptUserId: s.ptUserId, type: "PT_DELIVERY" as const, createdBy: A1.id };
  const a = await prisma.disputeCase.create({ data: base });
  await assert.rejects(prisma.disputeCase.create({ data: base }), (e: any) => e.code === "P2002");
  await prisma.disputeCase.update({ where: { id: a.id }, data: { status: "REJECTED_INTAKE" } });
  await prisma.disputeCase.create({ data: base }); // a rejected case no longer blocks
});

// ═══ Idempotency-Key ════════════════════════════════════════════════════════════════════════════════════════════════

test("Idempotency-Key: a replay returns the stored result without a second effect; the same key with a different body is 409", async () => {
  const s = await mkSession();
  const caseId = (await svc.openCase(A1, s.session.id)).result.case.id;
  const key = `assign-${randomUUID()}`;
  const first = await svc.assign(A1, caseId, undefined, key);
  const again = await svc.assign(A1, caseId, undefined, key);
  assert.equal(first.replayed, false);
  assert.equal(again.replayed, true);
  assert.deepEqual(again.result, JSON.parse(JSON.stringify(first.result)));
  assert.equal(await prisma.disputeCaseEvent.count({ where: { caseId, action: "ASSIGN" } }), 1);
  assert.equal((await prisma.disputeCase.findUniqueOrThrow({ where: { id: caseId } })).version, 2, "the replay did not bump the version");
  await rejects(svc.assign(A1, caseId, A3.id, key), 409, "IDEMPOTENCY_KEY_REUSED");

  // intake with a key replays too
  const s2 = await mkSession();
  const k2 = `intake-${randomUUID()}`;
  const i1 = await svc.openCase(A1, s2.session.id, k2);
  const i2 = await svc.openCase(A1, s2.session.id, k2);
  assert.equal(i2.replayed, true);
  assert.equal(i2.result.case.id, i1.result.case.id);
  assert.equal(await prisma.disputeCase.count({ where: { sessionId: s2.session.id } }), 1);
});

test("concurrent requests with the SAME key and body produce one effect", async () => {
  const s = await mkSession();
  const caseId = (await svc.openCase(A1, s.session.id)).result.case.id;
  await svc.assign(A1, caseId, undefined);
  const key = `claim-${randomUUID()}`;
  const body = { claimantRole: "CLIENT" as const, text: "Khẳng định", moves: ["MONEY" as const] };
  await svc.transition(A1, caseId, "COLLECTING", {});
  const results = await Promise.allSettled([svc.addClaim(A1, caseId, body, key), svc.addClaim(A1, caseId, body, key), svc.addClaim(A1, caseId, body, key)]);
  assert.ok(results.every((r) => r.status === "fulfilled"), JSON.stringify(results.map((r) => (r as any).reason?.code ?? r.status)));
  assert.equal(await prisma.disputeCaseClaim.count({ where: { caseId } }), 1);
});

// ═══ Roles & status machine ═════════════════════════════════════════════════════════════════════════════════════════

test("only the assigned investigator may record claims, assessments, findings, proposals, shares, request-more; others get 403", async () => {
  const s = await mkSession();
  const caseId = (await svc.openCase(A1, s.session.id)).result.case.id;
  await svc.assign(A1, caseId, undefined);
  await svc.transition(A1, caseId, "COLLECTING", {});
  const claim = await svc.addClaim(A1, caseId, { claimantRole: "CLIENT", text: "x", moves: [] });
  const ev = await prisma.disputeCaseEvidence.findFirstOrThrow({ where: { caseId } });
  const stranger = A3; // an ADMIN, but not the assigned investigator
  await rejects(svc.addClaim(stranger, caseId, { claimantRole: "PT", text: "x", moves: [] }), 403, "NOT_ASSIGNED_INVESTIGATOR");
  await rejects(svc.addIssue(stranger, caseId, { kind: "PT_LATE", finding: "UNDETERMINED" }), 403, "NOT_ASSIGNED_INVESTIGATOR");
  await rejects(svc.transition(stranger, caseId, "ASSESSING", {}), 403, "NOT_ASSIGNED_INVESTIGATOR");
  await rejects(svc.share(stranger, caseId, { evidenceId: ev.id, sharedWithRole: "PT", reason: "x" }), 403, "NOT_ASSIGNED_INVESTIGATOR");
  await svc.transition(A1, caseId, "ASSESSING", {});
  await rejects(svc.addAssessment(stranger, caseId, { claimId: claim.result.id, directEvidenceIds: [], indirectEvidenceIds: [], rebuttalEvidenceIds: [], relevanceNote: "a", verifiabilityNote: "a", consistencyNote: "a", result: "ESTABLISHED", reasoning: "a" }), 403, "NOT_ASSIGNED_INVESTIGATOR");
  await rejects(svc.recordFinding(stranger, caseId, { finding: "VERIFIED_DELIVERED", reasoning: "x" }), 403, "NOT_ASSIGNED_INVESTIGATOR");
  await rejects(svc.requestMore(stranger, caseId, "COLLECTING", "x"), 403, "NOT_ASSIGNED_INVESTIGATOR");
  await rejects(svc.propose(stranger, caseId, undefined), 403, "NOT_ASSIGNED_INVESTIGATOR");
  // not even an admin without an assignment on a case that has none
  const s2 = await mkSession();
  const c2 = (await svc.openCase(A1, s2.session.id)).result.case.id;
  await svc.transition(A1, c2, "COLLECTING", {}); // before assignment any admin may move the case out of INTAKE
  await rejects(svc.addClaim(A1, c2, { claimantRole: "PT", text: "x", moves: [] }), 403, "NOT_ASSIGNED_INVESTIGATOR");
  // a non-admin is refused outright
  await rejects(svc.assign({ id: randomUUID(), role: "CUSTOMER" }, caseId, undefined), 403, "ADMIN_ONLY");
  // a party cannot be the investigator
  await rejects(svc.assign(A1, caseId, s.clientUserId), 403, "CONFLICT_OF_INTEREST");
});

test("status machine: illegal moves are 409; every real move writes exactly one event and bumps the version; REJECTED_INTAKE needs a reason and a terminal case accepts nothing", async () => {
  const s = await mkSession();
  const caseId = (await svc.openCase(A1, s.session.id)).result.case.id;
  await svc.assign(A1, caseId, undefined);
  await rejects(svc.transition(A1, caseId, "ASSESSING", {}), 409, "CASE_STATE_NOT_ALLOWED"); // INTAKE -> ASSESSING
  await rejects(svc.transition(A1, caseId, "REJECTED_INTAKE", {}), 400, "REASON_REQUIRED");
  await svc.transition(A1, caseId, "COLLECTING", {});
  await svc.transition(A1, caseId, "AWAITING_PARTIES", { note: "chờ các bên" });
  await svc.transition(A1, caseId, "ASSESSING", {});
  await svc.transition(A1, caseId, "TECH_RECONCILIATION", {});
  await svc.transition(A1, caseId, "ASSESSING", {});
  await rejects(svc.transition(A1, caseId, "REJECTED_INTAKE", { reason: "x" }), 409, "CASE_STATE_NOT_ALLOWED"); // only from INTAKE
  const c = await prisma.disputeCase.findUniqueOrThrow({ where: { id: caseId } });
  assert.equal(c.version, 7, "1 + assign + 5 moves");
  const moves = await prisma.disputeCaseEvent.findMany({ where: { caseId, action: "TRANSITION" }, orderBy: { createdAt: "asc" } });
  assert.deepEqual(moves.map((m) => `${m.fromStatus}>${m.toStatus}`), ["INTAKE>COLLECTING", "COLLECTING>AWAITING_PARTIES", "AWAITING_PARTIES>ASSESSING", "ASSESSING>TECH_RECONCILIATION", "TECH_RECONCILIATION>ASSESSING"]);
  assert.equal(moves[1].note, "chờ các bên");

  const r = await mkSession();
  const rc = (await svc.openCase(A1, r.session.id)).result.case.id;
  await svc.transition(A3, rc, "REJECTED_INTAKE", { reason: "Không phải khiếu nại hợp lệ" });
  await rejects(svc.transition(A3, rc, "COLLECTING", {}), 409, "CASE_STATE_NOT_ALLOWED");
  await rejects(svc.assign(A3, rc, undefined), 409, "CASE_STATE_NOT_ALLOWED");
  await rejects(svc.recollect(A3, rc), 409, "CASE_STATE_NOT_ALLOWED");
  const ev = await prisma.disputeCaseEvent.findFirstOrThrow({ where: { caseId: rc, action: "TRANSITION" } });
  assert.equal(ev.note, "Không phải khiếu nại hợp lệ");
  // the rejected case frees the session for a fresh case
  assert.equal((await svc.openCase(A1, r.session.id)).result.created, true);
});

test("the CAS refuses a stale version: a concurrent writer that read the old version loses (409 CASE_VERSION_CONFLICT)", async () => {
  const s = await mkSession();
  const caseId = (await svc.openCase(A1, s.session.id)).result.case.id;
  const stale = await prisma.disputeCase.findUniqueOrThrow({ where: { id: caseId } });
  await svc.assign(A1, caseId, undefined); // version 1 -> 2
  const r = await prisma.disputeCase.updateMany({ where: { id: caseId, version: stale.version, status: stale.status }, data: { status: "COLLECTING", version: { increment: 1 } } });
  assert.equal(r.count, 0, "an update carrying the old version changes nothing");
});

// ═══ Findings, proposals ════════════════════════════════════════════════════════════════════════════════════════════

test("a finding needs every claim assessed; the proposal outcome is computed from the finding (never from the request); INSUFFICIENT_EVIDENCE -> POLICY_PENDING, NOT_A_DISPUTE -> no proposal", async () => {
  const s = await mkSession();
  const caseId = (await svc.openCase(A1, s.session.id)).result.case.id;
  await svc.assign(A1, caseId, undefined);
  await svc.transition(A1, caseId, "COLLECTING", {});
  const claim = await svc.addClaim(A1, caseId, { claimantRole: "CLIENT", text: "PT vắng", moves: ["PT_AT_FAULT"] });
  await svc.transition(A1, caseId, "ASSESSING", {});
  await rejects(svc.recordFinding(A1, caseId, { finding: "VERIFIED_PT_ABSENT", reasoning: "x" }), 409, "ASSESSMENT_REQUIRED");
  await rejects(
    svc.addAssessment(A1, caseId, { claimId: claim.result.id, directEvidenceIds: [randomUUID()], indirectEvidenceIds: [], rebuttalEvidenceIds: [], relevanceNote: "a", verifiabilityNote: "a", consistencyNote: "a", result: "ESTABLISHED", reasoning: "a" }),
    404,
    "EVIDENCE_NOT_FOUND",
  );
  const ev = await prisma.disputeCaseEvidence.findFirstOrThrow({ where: { caseId } });
  await rejects(
    svc.addAssessment(A1, caseId, { claimId: claim.result.id, directEvidenceIds: [ev.id], indirectEvidenceIds: [ev.id], rebuttalEvidenceIds: [], relevanceNote: "a", verifiabilityNote: "a", consistencyNote: "a", result: "ESTABLISHED", reasoning: "a" }),
    400,
    "EVIDENCE_LISTED_TWICE",
  );
  const a = await svc.addAssessment(A1, caseId, { claimId: claim.result.id, directEvidenceIds: [ev.id], indirectEvidenceIds: [], rebuttalEvidenceIds: [], relevanceNote: "a", verifiabilityNote: "a", consistencyNote: "a", result: "NOT_ESTABLISHED", reasoning: "a" });
  const stored = await prisma.disputeCaseAssessment.findUniqueOrThrow({ where: { id: a.result.id } });
  assert.ok(Array.isArray(stored.evidenceSnapshot) && (stored.evidenceSnapshot as any[]).length >= 13, "snapshot of every evidence row and statement");
  assert.deepEqual(Object.keys((stored.evidenceSnapshot as any[])[0]).sort(), ["hash", "id", "version"]);

  const f = await svc.recordFinding(A1, caseId, { finding: "INSUFFICIENT_EVIDENCE", reasoning: "Không đủ căn cứ" });
  assert.equal(f.result.caseStatus, "POLICY_PENDING");
  assert.equal(f.result.proposalPossible, false);
  assert.equal(await prisma.disputeCaseProposal.count({ where: { caseId } }), 0);
  await rejects(svc.propose(A1, caseId, undefined), 409, "CASE_STATE_NOT_ALLOWED");
  const trail = await prisma.disputeCaseEvent.findMany({ where: { caseId, action: "TRANSITION" }, orderBy: { createdAt: "asc" } });
  assert.ok(trail.some((t) => t.fromStatus === "ASSESSING" && t.toStatus === "FINDING_RECORDED"));
  assert.ok(trail.some((t) => t.fromStatus === "FINDING_RECORDED" && t.toStatus === "POLICY_PENDING"));

  // NOT_A_DISPUTE: recorded, no proposal (DESIGN_REQUIRED)
  const n = await toAwaitingApprovalStopAtFinding("NOT_A_DISPUTE");
  await rejects(svc.propose(A1, n, undefined), 409, "DESIGN_REQUIRED");
  assert.equal(await prisma.disputeCaseProposal.count({ where: { caseId: n } }), 0);
  assert.equal((await prisma.disputeCase.findUniqueOrThrow({ where: { id: n } })).status, "FINDING_RECORDED");

  // outcome mapping on real rows (the strict body schema keeps an `outcome` out; the service signature has no outcome at all)
  const expected: Array<[FindingKind, string]> = [
    ["VERIFIED_DELIVERED", "COMPLETED"],
    ["VERIFIED_CLIENT_ABSENT", "COMPLETED"],
    ["VERIFIED_PT_ABSENT", "PT_NO_SHOW_CONFIRMED"],
    ["VERIFIED_NOT_DELIVERED_NO_FAULT", "CANCELLED"],
  ];
  for (const [finding, outcome] of expected) {
    const w = await toAwaitingApproval({ finding });
    const p = await prisma.disputeCaseProposal.findUniqueOrThrow({ where: { id: w.proposal.id } });
    assert.equal(p.outcome, outcome, finding);
    assert.equal(p.proposerId, A1.id);
    assert.equal(p.executionBlockedReason, null);
    assert.equal(w.proposal.execution, "BLOCKED: SLICE_2_NOT_ENABLED");
  }
});

async function toAwaitingApprovalStopAtFinding(finding: FindingKind) {
  const s = await mkSession();
  const caseId = (await svc.openCase(A1, s.session.id)).result.case.id;
  await svc.assign(A1, caseId, undefined);
  await svc.transition(A1, caseId, "COLLECTING", {});
  await svc.transition(A1, caseId, "ASSESSING", {});
  await svc.recordFinding(A1, caseId, { finding, reasoning: "x" });
  return caseId;
}

test("B-1: a PT_LATE_ARRIVAL step on the session (settlement row of ANY status, or a ledger operation) sets executionBlockedReason for ALL three outcomes; the case still goes on", async () => {
  // POLICY CHANGE I6 = A (Ngai, 31/10/2026): the CANCELLED outcome is no longer proposed over a D77 (it goes to POLICY_PENDING, see the I6 block below).
  const cases: Array<[FindingKind, string, string]> = [
    ["VERIFIED_DELIVERED", "COMPLETED", "PENDING"],
    ["VERIFIED_PT_ABSENT", "PT_NO_SHOW_CONFIRMED", "NEEDS_HUMAN"],
  ];
  for (const [finding, outcome, status] of cases) {
    const w = await toAwaitingApproval({
      finding,
      prepare: async (s) => {
        await prisma.sessionSettlement.create({ data: { kind: "PT_LATE_ARRIVAL_COMPENSATION", idempotencyKey: `PT_LATE_ARRIVAL:${s.session.id}`, sessionId: s.session.id, contractId: s.contract.id, status: status as any } });
      },
    });
    const p = await prisma.disputeCaseProposal.findUniqueOrThrow({ where: { id: w.proposal.id } });
    assert.equal(p.outcome, outcome);
    assert.equal(p.executionBlockedReason, "D77_COMBINATION_UNRESOLVED", `${finding} / ${status}`);
    assert.equal((await prisma.disputeCase.findUniqueOrThrow({ where: { id: w.caseId } })).status, "AWAITING_APPROVAL", "investigation and approval are not blocked");
    const done = await svc.decide(A2, w.caseId, approveBody());
    assert.equal(done.result.caseStatus, "DECISION_APPROVED");
    assert.equal(done.result.execution, "BLOCKED: SLICE_2_NOT_ENABLED");
    assert.equal(done.result.executionBlockedReason, "D77_COMBINATION_UNRESOLVED");
  }
  // I6 = A: a CANCELLED finding on a session with a D77 step (a settlement row of ANY status, or only a ledger operation) creates NO proposal and parks the case in POLICY_PENDING
  for (const status of ["SETTLED", "PENDING", "NEEDS_HUMAN"]) {
    const w = await toAwaitingApproval({
      finding: "VERIFIED_NOT_DELIVERED_NO_FAULT",
      prepare: async (s) => {
        await prisma.sessionSettlement.create({ data: { kind: "PT_LATE_ARRIVAL_COMPENSATION", idempotencyKey: `PT_LATE_ARRIVAL:${s.session.id}`, sessionId: s.session.id, contractId: s.contract.id, status: status as any } });
      },
    });
    assert.equal((w.proposal as any).policyPending, true, status);
    assert.equal((w.proposal as any).blocked, "CANCELLED_BLOCKED_BY_D77", status);
    assert.equal(await prisma.disputeCaseProposal.count({ where: { caseId: w.caseId } }), 0, `${status}: no proposal`);
    assert.equal((await prisma.disputeCase.findUniqueOrThrow({ where: { id: w.caseId } })).status, "POLICY_PENDING", status);
  }
  const cancelledLedgerOnly = await toAwaitingApproval({
    finding: "VERIFIED_NOT_DELIVERED_NO_FAULT",
    prepare: async (s) => {
      ledger.ops.set(`PT_LATE_ARRIVAL:${s.session.id}`, { key: `PT_LATE_ARRIVAL:${s.session.id}`, kind: "LATE_ARRIVAL", transactionId: "t", result: {}, createdAt: new Date().toISOString(), fingerprinted: true });
    },
  });
  assert.equal((cancelledLedgerOnly.proposal as any).policyPending, true, "ledger-only trace");
  assert.equal(await prisma.disputeCaseProposal.count({ where: { caseId: cancelledLedgerOnly.caseId } }), 0);
  // only a ledger trace, no settlement row
  const ledgerOnly = await toAwaitingApproval({
    prepare: async (s) => {
      ledger.ops.set(`PT_LATE_ARRIVAL:${s.session.id}`, { key: `PT_LATE_ARRIVAL:${s.session.id}`, kind: "LATE_ARRIVAL", transactionId: "t", result: {}, createdAt: new Date().toISOString(), fingerprinted: true });
    },
  });
  assert.equal(ledgerOnly.proposal.executionBlockedReason, "D77_COMBINATION_UNRESOLVED");
  // no trace anywhere: no block
  const clean = await toAwaitingApproval({});
  assert.equal(clean.proposal.executionBlockedReason, null);
  // the ledger cannot be read and no row exists: refuse to build the proposal (503), never guess "no"
  ledger.down = true;
  try {
    const pre = await mkSession();
    const cid = (await svc.openCase(A1, pre.session.id)).result.case.id;
    await svc.assign(A1, cid, undefined);
    await svc.transition(A1, cid, "COLLECTING", {});
    const claim = await svc.addClaim(A1, cid, { claimantRole: "CLIENT", text: "x", moves: [] });
    await svc.transition(A1, cid, "ASSESSING", {});
    const ev = await prisma.disputeCaseEvidence.findFirstOrThrow({ where: { caseId: cid } });
    await svc.addAssessment(A1, cid, { claimId: claim.result.id, directEvidenceIds: [ev.id], indirectEvidenceIds: [], rebuttalEvidenceIds: [], relevanceNote: "a", verifiabilityNote: "a", consistencyNote: "a", result: "ESTABLISHED", reasoning: "a" });
    await svc.recordFinding(A1, cid, { finding: "VERIFIED_DELIVERED", reasoning: "x" });
    await rejects(svc.propose(A1, cid, undefined), 503, "PAYMENT_UNAVAILABLE");
    assert.equal((await prisma.disputeCase.findUniqueOrThrow({ where: { id: cid } })).status, "FINDING_RECORDED");
  } finally {
    ledger.down = false;
  }
});

// ═══ Four eyes ══════════════════════════════════════════════════════════════════════════════════════════════════════

test("approval: the proposer, the investigator, the client, the PT and a non-admin are refused with a code; a missing declaration is refused; a different admin approves", async () => {
  const w = await toAwaitingApproval({});
  await rejects(svc.decide(A1, w.caseId, approveBody()), 403, "SELF_APPROVAL_FORBIDDEN"); // proposer = investigator
  await rejects(svc.decide({ id: w.clientUserId, role: "ADMIN" }, w.caseId, approveBody()), 403, "CONFLICT_OF_INTEREST");
  await rejects(svc.decide({ id: w.ptUserId, role: "ADMIN" }, w.caseId, approveBody()), 403, "CONFLICT_OF_INTEREST");
  await rejects(svc.decide({ id: w.clientUserId, role: "CUSTOMER" }, w.caseId, approveBody()), 403, "ADMIN_ONLY");
  await rejects(svc.decide(A2, w.caseId, approveBody({ conflictOfInterestDeclaredNone: false })), 403, "CONFLICT_OF_INTEREST");
  // the investigator was replaced after the proposal: the NEW investigator is still not an approver
  await svc.assign(A1, w.caseId, A3.id);
  await rejects(svc.decide(A3, w.caseId, approveBody()), 403, "SELF_APPROVAL_FORBIDDEN");
  await rejects(svc.decide(A1, w.caseId, approveBody()), 403, "SELF_APPROVAL_FORBIDDEN"); // proposer
  assert.equal((await prisma.disputeCase.findUniqueOrThrow({ where: { id: w.caseId } })).status, "AWAITING_APPROVAL");
  assert.equal(await prisma.disputeCaseApproval.count({ where: { proposalId: w.proposal.id } }), 0);

  const done = await svc.decide(A2, w.caseId, approveBody({ reason: "Đã xem xét" }));
  assert.equal(done.result.result, "APPROVED");
  assert.equal(done.result.caseStatus, "DECISION_APPROVED");
  assert.equal(done.result.execution, "BLOCKED: SLICE_2_NOT_ENABLED");
  const approval = await prisma.disputeCaseApproval.findFirstOrThrow({ where: { proposalId: w.proposal.id } });
  assert.equal(approval.approverId, A2.id);
  assert.equal(approval.conflictOfInterestDeclaredNone, true);
  const ev = await prisma.disputeCaseEvent.findFirstOrThrow({ where: { caseId: w.caseId, action: "DECISION_APPROVED" } });
  assert.equal(ev.fromStatus, "AWAITING_APPROVAL");
  assert.equal(ev.toStatus, "DECISION_APPROVED");
  assert.equal(ev.actorUserId, A2.id);
  // terminal: nothing more is accepted, and the session cannot get a second case while the decision waits for Slice 2
  await rejects(svc.decide(A4, w.caseId, approveBody()), 409, "CASE_STATE_NOT_ALLOWED");
  await rejects(svc.openCase(A1, w.session.id), 409, "CASE_DECISION_PENDING_EXECUTION");
});

test("a rejection needs the same independence, requires a reason and sends the case back to ASSESSING; a new finding supersedes the old one", async () => {
  const w = await toAwaitingApproval({ finding: "VERIFIED_DELIVERED" });
  await rejects(svc.decide(A1, w.caseId, approveBody({ result: "REJECTED" })), 403, "SELF_APPROVAL_FORBIDDEN");
  const r = await svc.decide(A2, w.caseId, approveBody({ result: "REJECTED", reason: "Thiếu đối chiếu dữ liệu phòng" }));
  assert.equal(r.result.caseStatus, "ASSESSING");
  assert.equal((r.result as any).execution, undefined);
  await svc.recordFinding(A1, w.caseId, { finding: "VERIFIED_PT_ABSENT", reasoning: "Sau khi đối chiếu" });
  const findings = await prisma.disputeCaseFinding.findMany({ where: { caseId: w.caseId }, orderBy: { createdAt: "asc" } });
  assert.equal(findings.length, 2);
  assert.equal(findings[1].supersedesId, findings[0].id);
  const p2 = await svc.propose(A1, w.caseId, undefined);
  assert.equal(p2.result.outcome, "PT_NO_SHOW_CONFIRMED");
  assert.equal(await prisma.disputeCaseProposal.count({ where: { caseId: w.caseId } }), 2, "the old proposal stays on record");
  const done = await svc.decide(A4, w.caseId, approveBody());
  assert.equal(done.result.caseStatus, "DECISION_APPROVED");
});

test("concurrent approvals by two approvers: exactly one APPROVED, the other gets 409", async () => {
  const w = await toAwaitingApproval({});
  const results = await Promise.allSettled([svc.decide(A2, w.caseId, approveBody()), svc.decide(A4, w.caseId, approveBody())]);
  const ok = results.filter((r) => r.status === "fulfilled");
  const bad = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
  assert.equal(ok.length, 1, JSON.stringify(results.map((r) => (r as any).reason?.code ?? r.status)));
  assert.equal(bad.length, 1);
  assert.equal(bad[0].reason.status, 409);
  assert.ok(["CASE_STATE_NOT_ALLOWED", "CASE_VERSION_CONFLICT"].includes(bad[0].reason.code), bad[0].reason.code);
  assert.equal(await prisma.disputeCaseApproval.count({ where: { proposalId: w.proposal.id, result: "APPROVED" } }), 1);
  assert.equal(await prisma.disputeCaseApproval.count({ where: { proposalId: w.proposal.id } }), 1, "the loser left no approval row");
  assert.equal((await prisma.disputeCase.findUniqueOrThrow({ where: { id: w.caseId } })).status, "DECISION_APPROVED");
  assert.equal(await prisma.disputeCaseEvent.count({ where: { caseId: w.caseId, action: "DECISION_APPROVED" } }), 1);
});

test("approve with an Idempotency-Key replays the stored answer: one approval, same result; the same key with another body is 409", async () => {
  const w = await toAwaitingApproval({});
  const key = `approve-${randomUUID()}`;
  const a = await svc.decide(A2, w.caseId, approveBody(), key);
  const b = await svc.decide(A2, w.caseId, approveBody(), key);
  assert.equal(a.replayed, false);
  assert.equal(b.replayed, true);
  assert.deepEqual(b.result, JSON.parse(JSON.stringify(a.result)));
  assert.equal(await prisma.disputeCaseApproval.count({ where: { proposalId: w.proposal.id } }), 1);
  await rejects(svc.decide(A2, w.caseId, approveBody({ reason: "Lý do khác" }), key), 409, "IDEMPOTENCY_KEY_REUSED");
});

// ═══ Evidence change guard ══════════════════════════════════════════════════════════════════════════════════════════

test("evidence written after the proposal blocks the approval (409 EVIDENCE_CHANGED) until the approver flags it AND the investigator acknowledges it", async () => {
  const w = await toAwaitingApproval({});
  // nothing changed: the guard stays silent
  const quiet = await svc.recollect(A3, w.caseId);
  assert.deepEqual(quiet.result, { added: 0, unchanged: 13 });

  // something about the session changes (a new audit row) and somebody re-collects: new evidence version after the snapshot
  await prisma.auditLog.create({ data: { actorUserId: w.ptUserId, action: "SESSION_NOTE", entityType: "SESSION", entityId: w.session.id } });
  const re = await svc.recollect(A3, w.caseId);
  assert.deepEqual(re.result, { added: 1, unchanged: 12 });
  const chain = await prisma.disputeCaseEvidence.findMany({ where: { caseId: w.caseId, subject: "AUDIT_LOG:SESSION" }, orderBy: { snapshotVersion: "asc" } });
  assert.equal(chain.length, 2);
  assert.equal(chain[1].snapshotVersion, 2);
  assert.equal(chain[1].supersedesId, chain[0].id);
  assert.notEqual(chain[1].contentHash, chain[0].contentHash);

  await rejects(svc.decide(A2, w.caseId, approveBody()), 409, "EVIDENCE_CHANGED");
  await rejects(svc.decide(A2, w.caseId, approveBody({ evidenceChangeAcknowledged: true })), 409, "EVIDENCE_CHANGED"); // no investigator ACK yet
  await rejects(svc.acknowledgeEvidenceChange(A3, w.caseId, "tôi không phải điều tra viên"), 403, "NOT_ASSIGNED_INVESTIGATOR");
  const ack = await svc.acknowledgeEvidenceChange(A1, w.caseId, "Đã xem bằng chứng mới");
  assert.equal(ack.result.changedIds.length, 1);
  await rejects(svc.decide(A2, w.caseId, approveBody()), 409, "EVIDENCE_CHANGED"); // the approver has not flagged it
  assert.equal((await prisma.disputeCase.findUniqueOrThrow({ where: { id: w.caseId } })).status, "AWAITING_APPROVAL");
  const done = await svc.decide(A2, w.caseId, approveBody({ evidenceChangeAcknowledged: true }));
  assert.equal(done.result.caseStatus, "DECISION_APPROVED");
  const approval = await prisma.disputeCaseApproval.findFirstOrThrow({ where: { proposalId: w.proposal.id } });
  assert.equal(approval.evidenceChangeAcknowledged, true);
});

test("a change in a LIVE source that nobody re-collected cannot be acknowledged away: it must be re-collected first", async () => {
  const w = await toAwaitingApproval({});
  await prisma.auditLog.create({ data: { actorUserId: w.clientUserId, action: "SESSION_NOTE", entityType: "SESSION", entityId: w.session.id } });
  await svc.acknowledgeEvidenceChange(A1, w.caseId, "ack trước khi thu thập lại");
  const err: any = await svc.decide(A2, w.caseId, approveBody({ evidenceChangeAcknowledged: true })).catch((e) => e);
  assert.equal(err.code, "EVIDENCE_CHANGED");
  assert.equal(err.details.needsRecollect, true);
  await svc.recollect(A3, w.caseId);
  await svc.acknowledgeEvidenceChange(A1, w.caseId, "ack sau khi thu thập lại");
  assert.equal((await svc.decide(A2, w.caseId, approveBody({ evidenceChangeAcknowledged: true }))).result.caseStatus, "DECISION_APPROVED");
});

test("a statement or document written after the proposal is a change as well", async () => {
  const w = await toAwaitingApproval({});
  // a party cannot write in AWAITING_APPROVAL; fixture: insert as the table would receive it from an earlier window
  const hash = "a".repeat(64);
  await prisma.disputeCaseStatement.create({ data: { caseId: w.caseId, partyRole: "CLIENT", authorUserId: w.clientUserId, version: 2, text: "bổ sung muộn", supplementReason: "x", contentHash: hash } });
  await rejects(svc.decide(A2, w.caseId, approveBody()), 409, "EVIDENCE_CHANGED");
});

// ═══ Parties ════════════════════════════════════════════════════════════════════════════════════════════════════════

test("parties: statements are versioned (v>1 needs a supplement reason), allowed only in the collecting window; a restricted PT can still submit", async () => {
  const s = await mkSession({ ptNotes: null });
  const caseId = (await svc.openCase(A1, s.session.id)).result.case.id;
  const client: Actor = { id: s.clientUserId, role: "CUSTOMER" };
  const pt: Actor = { id: s.ptUserId, role: "PT" };
  await rejects(svc.submitStatement(client, caseId, { text: "x" }), 409, "CASE_STATE_NOT_ALLOWED"); // INTAKE
  await svc.assign(A1, caseId, undefined);
  await svc.transition(A1, caseId, "COLLECTING", {});

  // the client has the legacy v1; the next one is v2 and needs a reason
  await rejects(svc.submitStatement(client, caseId, { text: "Lời khai mới" }), 400, "SUPPLEMENT_REASON_REQUIRED");
  const v2 = await svc.submitStatement(client, caseId, { text: "Lời khai mới", supplementReason: "Nhớ thêm chi tiết" });
  assert.equal(v2.result.version, 2);
  const rows = await prisma.disputeCaseStatement.findMany({ where: { caseId, partyRole: "CLIENT" }, orderBy: { version: "asc" } });
  assert.deepEqual(rows.map((r) => r.version), [1, 2]);
  assert.equal(rows[1].supersedesId, rows[0].id);
  assert.equal(rows[1].supplementReason, "Nhớ thêm chi tiết");

  // PT under an ACCOUNT suspension AND a CONTRACT restriction (TEST FIXTURE rows): still allowed to answer
  await prisma.userProfile.create({ data: { userId: s.ptUserId, isPT: true, ptSuspended: true } });
  await prisma.ptRestriction.create({ data: { ptUserId: s.ptUserId, type: "TEMPORARY_SUSPENSION", imposedBy: A3.id, reasonText: "đang xem xét" } });
  await prisma.ptRestriction.create({ data: { ptUserId: s.ptUserId, type: "TEMPORARY_SUSPENSION", scope: "CONTRACT", contractId: s.contract.id, imposedBy: A3.id, reasonText: "hợp đồng này" } });
  const ptStmt = await svc.submitStatement(pt, caseId, { text: "PT trình bày" });
  assert.equal(ptStmt.result.version, 1, "the PT had no legacy note here");
  const doc = await svc.submitEvidence(pt, caseId, { description: "Biên bản của phòng gym", sha256: "B".repeat(64), fileName: "bienban.pdf" });
  const stored = await prisma.disputeCaseEvidence.findUniqueOrThrow({ where: { id: doc.result.id } });
  assert.equal(stored.provenanceType, "EXTERNAL_DOCUMENT");
  assert.equal(stored.submittedBy, s.ptUserId);
  assert.equal(stored.submittedRole, "PT");
  assert.equal(stored.sensitivity, "RESTRICTED");
  assert.equal(stored.verificationStatus, "CLIENT_CLAIMED_UNVERIFIED");
  assert.equal((stored.payload as any).hashStatus, "CLIENT_CLAIMED_UNVERIFIED");
  assert.equal((stored.payload as any).fileStored, false);
  assert.equal((stored.payload as any).declaredSha256, "b".repeat(64));
  assert.equal((stored.payload as any).fileStorage, "DESIGN_REQUIRED");

  // strangers and admins who are not a party do not exist for the case
  await rejects(svc.submitStatement({ id: randomUUID(), role: "CUSTOMER" }, caseId, { text: "x" }), 404, "CASE_NOT_FOUND");
  await rejects(svc.submitStatement(A3, caseId, { text: "x" }), 404, "CASE_NOT_FOUND");
  await rejects(svc.submitEvidence(A3, caseId, { description: "x", sha256: "c".repeat(64) }), 404, "CASE_NOT_FOUND");

  // the window closes at AWAITING_APPROVAL / FINDING_RECORDED
  await svc.transition(A1, caseId, "ASSESSING", {});
  await svc.submitStatement(client, caseId, { text: "vẫn nộp được khi đang đánh giá", supplementReason: "bổ sung" });
  const w = await toAwaitingApproval({});
  await rejects(svc.submitStatement({ id: w.clientUserId, role: "CUSTOMER" }, w.caseId, { text: "muộn", supplementReason: "x" }), 409, "CASE_STATE_NOT_ALLOWED");
  await rejects(svc.submitEvidence({ id: w.ptUserId, role: "PT" }, w.caseId, { description: "muộn", sha256: "d".repeat(64) }), 409, "CASE_STATE_NOT_ALLOWED");
});

test("parties see their own items, NORMAL system evidence and what was shared - never the other side's unshared items nor the financial split; every read is logged", async () => {
  const s = await mkSession();
  const caseId = (await svc.openCase(A1, s.session.id)).result.case.id;
  await svc.assign(A1, caseId, undefined);
  await svc.transition(A1, caseId, "COLLECTING", {});
  const client: Actor = { id: s.clientUserId, role: "CUSTOMER" };
  const pt: Actor = { id: s.ptUserId, role: "PT" };
  const cDoc = await svc.submitEvidence(client, caseId, { description: "Ảnh chụp tin nhắn của khách", sha256: "1".repeat(64) });
  const pDoc = await svc.submitEvidence(pt, caseId, { description: "Ảnh chụp lịch của PT", sha256: "2".repeat(64) });
  await svc.addClaim(A1, caseId, { claimantRole: "CLIENT", text: "PT không đến", moves: ["MONEY", "PT_AT_FAULT"] });

  const cView = await svc.getForParty(client, caseId);
  const pView = await svc.getForParty(pt, caseId);
  const idsC = cView.evidence.map((e) => e.id);
  const idsP = pView.evidence.map((e) => e.id);
  assert.ok(idsC.includes(cDoc.result.id) && !idsC.includes(pDoc.result.id));
  assert.ok(idsP.includes(pDoc.result.id) && !idsP.includes(cDoc.result.id));
  for (const v of [cView, pView]) {
    const subjects = v.evidence.map((e) => e.subject);
    for (const hidden of ["CONTRACT_FINANCIAL_SNAPSHOT", "SETTLEMENTS", "AUDIT_LOG:SESSION", "AUDIT_LOG:CONTRACT"]) assert.ok(!subjects.includes(hidden), `${hidden} is not for parties`);
    for (const shown of ["SESSION_ROW", "CONTRACT_SNAPSHOT", "ROOM_PT_JOINED_AT"]) assert.ok(subjects.includes(shown), shown);
    assert.doesNotMatch(JSON.stringify(v), /platformRate|ptRate|gymRate|ptHoldbackRate|releasedTo/);
    assert.deepEqual(Object.keys(v.financial).sort(), ["group", "groupLabel"]);
    assert.equal(v.accusations.length, 1);
    assert.equal(v.case.canSubmit, true);
  }
  // statements: each side sees its own legacy statement, not the other's
  assert.deepEqual(cView.statements.map((x) => x.partyRole), ["CLIENT"]);
  assert.deepEqual(pView.statements.map((x) => x.partyRole), ["PT"]);
  assert.ok(!JSON.stringify(cView).includes("PT báo đã dạy đủ giờ"), "the PT's legacy note is not shown to the client");

  // the investigator shares the PT's document and the PT's statement with the client; SENSITIVE evidence cannot be shared
  const ptStatement = await prisma.disputeCaseStatement.findFirstOrThrow({ where: { caseId, partyRole: "PT" } });
  // hardening P0: a document a party submitted about itself is NEVER handed to the other side
  await rejects(svc.share(A1, caseId, { evidenceId: pDoc.result.id, sharedWithRole: "CLIENT", reason: "để khách phản biện" }), 409, "PARTY_EVIDENCE_SHARE_DESIGN_REQUIRED");
  await rejects(svc.share(A1, caseId, { evidenceId: cDoc.result.id, sharedWithRole: "PT", reason: "để PT phản biện" }), 409, "PARTY_EVIDENCE_SHARE_DESIGN_REQUIRED");
  await svc.share(A1, caseId, { statementId: ptStatement.id, sharedWithRole: "CLIENT", reason: "để khách phản biện" });
  const sensitive = await prisma.disputeCaseEvidence.findFirstOrThrow({ where: { caseId, subject: "SETTLEMENTS" } });
  await rejects(svc.share(A1, caseId, { evidenceId: sensitive.id, sharedWithRole: "CLIENT", reason: "x" }), 409, "PARTY_EVIDENCE_SHARE_DESIGN_REQUIRED");
  await rejects(svc.share(A1, caseId, { evidenceId: randomUUID(), sharedWithRole: "CLIENT", reason: "x" }), 404, "EVIDENCE_NOT_FOUND");
  const cView2 = await svc.getForParty(client, caseId);
  assert.ok(!cView2.evidence.some((e) => e.id === pDoc.result.id), "the PT's document is still hidden from the client");
  assert.ok(cView2.statements.some((x) => x.partyRole === "PT"), "shared statement is visible to the client");
  assert.ok(!(await svc.getForParty(pt, caseId)).evidence.some((e) => e.id === cDoc.result.id), "the client's document stays hidden from the PT");

  // list: a party sees only its own cases; a stranger sees none and cannot open the case (404)
  assert.ok((await svc.listForParty(client)).items.some((i) => i.id === caseId && i.role === "CLIENT"));
  assert.ok((await svc.listForParty(pt)).items.some((i) => i.id === caseId && i.role === "PT"));
  assert.equal((await svc.listForParty({ id: randomUUID(), role: "CUSTOMER" })).items.length, 0);
  await rejects(svc.getForParty({ id: randomUUID(), role: "CUSTOMER" }, caseId), 404, "CASE_NOT_FOUND");
  await rejects(svc.getForParty(A3, caseId), 404, "CASE_NOT_FOUND");
  await rejects(svc.getForParty(client, "not-a-uuid"), 404, "CASE_NOT_FOUND");

  // access log: every read above wrote rows (case + each evidence row seen)
  const logs = await prisma.disputeCaseAccessLog.findMany({ where: { caseId } });
  assert.ok(logs.some((l) => l.viewerUserId === s.clientUserId && l.action === "VIEW_CASE"));
  assert.ok(logs.some((l) => l.viewerUserId === s.ptUserId && l.action === "VIEW_EVIDENCE" && l.evidenceId === pDoc.result.id));
  assert.ok(!logs.some((l) => l.viewerUserId === s.clientUserId && l.evidenceId === sensitive.id), "the client never read the settlements row");

  // the admin read sees everything, including the derived financial view, and is logged too
  const before = await prisma.disputeCaseAccessLog.count({ where: { caseId, viewerUserId: A3.id } });
  const adminView = await svc.getForAdmin(A3, caseId);
  assert.equal(adminView.evidence.length, 13 + 2);
  assert.equal(adminView.financial.derived, true);
  assert.equal(adminView.financial.group, "NO_RECORDED_SETTLEMENT");
  assert.equal(adminView.financial.groupLabel, "Chưa có bước quyết toán được ghi nhận");
  const hardenedRow = adminView.evidence.find((e) => e.id === cDoc.result.id)!;
  assert.equal(hardenedRow.verificationStatus, "CLIENT_CLAIMED_UNVERIFIED");
  assert.equal(hardenedRow.sensitivity, "RESTRICTED");
  assert.equal((await prisma.disputeCaseAccessLog.count({ where: { caseId, viewerUserId: A3.id } })) - before, 1 + adminView.evidence.length);
  await rejects(svc.getForAdmin({ id: randomUUID(), role: "CUSTOMER" }, caseId), 403, "ADMIN_ONLY");
  const list = await svc.list(A3, { status: "COLLECTING", limit: 50, offset: 0 });
  assert.ok(list.items.some((i) => i.id === caseId));
});

test("the admin financial view reads settlements + the ledger: F3 while anything is open, UNAVAILABLE when the ledger is down", async () => {
  const s = await mkSession();
  await prisma.sessionSettlement.create({ data: { kind: "SESSION_RELEASE", idempotencyKey: `SESSION_RELEASE:${s.session.id}`, sessionId: s.session.id, contractId: s.contract.id, status: "SETTLED" } });
  await prisma.sessionSettlement.create({ data: { kind: "PT_NO_SHOW_COMPENSATION", idempotencyKey: `PT_NO_SHOW:${s.session.id}`, sessionId: s.session.id, contractId: s.contract.id, status: "SETTLED" } });
  const rec = (key: string, obligation?: object) => ({ key, kind: "X", transactionId: "t", result: { owed: "250000.00" }, createdAt: new Date().toISOString(), fingerprinted: true, ...(obligation ? { obligation } : {}) });
  ledger.ops.set(`SESSION_RELEASE:${s.session.id}`, rec(`SESSION_RELEASE:${s.session.id}`, { id: "o1", status: "WAIVED", owed: "250000.00", paid: "0.00", unpaid: "250000.00" }));
  ledger.ops.set(`PT_NO_SHOW:${s.session.id}`, rec(`PT_NO_SHOW:${s.session.id}`, { id: "o2", status: "OPEN", owed: "250000.00", paid: "100000.00", unpaid: "150000.00" }));
  const caseId = (await svc.openCase(A1, s.session.id)).result.case.id;
  let view = (await svc.getForAdmin(A3, caseId)).financial;
  assert.equal(view.group, "F3");
  assert.deepEqual(view.items.map((i) => i.state).sort(), ["LEDGER_POSTED_PARTIAL", "OBLIGATION_WAIVED"]);
  assert.equal((view.items.find((i) => i.state === "LEDGER_POSTED_PARTIAL")!.ledger as any).obligation.unpaid, "150000.00");
  // the parties get the label only
  const party = await svc.getForParty({ id: s.clientUserId, role: "CUSTOMER" }, caseId);
  assert.equal(party.financial.group, "F3");
  assert.doesNotMatch(JSON.stringify(party), /150000|obligation|PT_NO_SHOW:/);
  ledger.down = true;
  try {
    view = (await svc.getForAdmin(A3, caseId)).financial;
    assert.equal(view.group, "UNAVAILABLE");
  } finally {
    ledger.down = false;
  }
  ledger.ops.clear();
});

// ═══ Append-only, immutability of everything else ═══════════════════════════════════════════════════════════════════

test("append-only trigger rejects UPDATE and DELETE on every append-only table", async () => {
  const w = await toAwaitingApproval({});
  await svc.getForAdmin(A3, w.caseId);
  const ev = await prisma.disputeCaseEvidence.findFirstOrThrow({ where: { caseId: w.caseId, subject: "SESSION_ROW" } });
  await svc.share(A1, w.caseId, { evidenceId: ev.id, sharedWithRole: "CLIENT", reason: "kiểm thử" }).catch(() => {}); // fine either way; a share row is needed below
  await svc.decide(A2, w.caseId, approveBody());
  const sharedCount = await prisma.disputeCaseShare.count({});
  assert.ok(sharedCount >= 1, "a share row exists");
  for (const table of APPEND_ONLY_TABLES) {
    const n = Number((await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT count(*) AS n FROM ${table}`))[0].n);
    assert.ok(n > 0, `${table} has rows to attack`);
    await assert.rejects(prisma.$executeRawUnsafe(`UPDATE ${table} SET id = id WHERE id = (SELECT id FROM ${table} LIMIT 1)`), /append-only/, `UPDATE ${table}`);
    await assert.rejects(prisma.$executeRawUnsafe(`DELETE FROM ${table} WHERE id = (SELECT id FROM ${table} LIMIT 1)`), /append-only/, `DELETE ${table}`);
    assert.equal(Number((await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT count(*) AS n FROM ${table}`))[0].n), n, `${table} unchanged`);
  }
  // the Prisma client cannot get around it either
  await assert.rejects(prisma.disputeCaseFinding.updateMany({ where: { caseId: w.caseId }, data: { reasoning: "đổi" } }), /append-only/);
  await assert.rejects(prisma.disputeCaseEvent.deleteMany({ where: { caseId: w.caseId } }), /append-only/);
  // DisputeCase itself is NOT append-only (it changes through the CAS)
  await prisma.$executeRawUnsafe(`UPDATE dispute_cases SET escalated = escalated WHERE id = '${w.caseId}'::uuid`);
});

test("DB constraints back the rules: a share needs exactly one target; an approval needs the declaration and a reason; one APPROVED per proposal; statement versions are unique", async () => {
  const w = await toAwaitingApproval({});
  await assert.rejects(prisma.disputeCaseShare.create({ data: { caseId: w.caseId, sharedWithRole: "CLIENT", sharedBy: A1.id, reason: "x" } }), /dispute_case_shares_exactly_one_target|check constraint/);
  await assert.rejects(
    prisma.disputeCaseApproval.create({ data: { proposalId: w.proposal.id, approverId: A2.id, result: "APPROVED", reason: "x", conflictOfInterestDeclaredNone: false } }),
    /dispute_case_approvals_declaration_true|check constraint/,
  );
  await prisma.disputeCaseApproval.create({ data: { proposalId: w.proposal.id, approverId: A2.id, result: "APPROVED", reason: "x", conflictOfInterestDeclaredNone: true } });
  await assert.rejects(
    prisma.disputeCaseApproval.create({ data: { proposalId: w.proposal.id, approverId: A4.id, result: "APPROVED", reason: "y", conflictOfInterestDeclaredNone: true } }),
    (e: any) => e.code === "P2002" || /unique/i.test(String(e.message)),
  );
  const st = { caseId: w.caseId, partyRole: "PT" as const, authorUserId: w.ptUserId, version: 5, text: "t", supplementReason: "r", contentHash: "e".repeat(64) };
  await prisma.disputeCaseStatement.create({ data: st });
  await assert.rejects(prisma.disputeCaseStatement.create({ data: st }), (e: any) => e.code === "P2002");
  await assert.rejects(prisma.disputeCaseStatement.create({ data: { ...st, version: 6, supplementReason: null } }), /dispute_case_statements_supplement_required|check constraint/);
});

test("a full case flow to DECISION_APPROVED leaves session, contract, quota and settlement rows UNCHANGED, and makes no payment-service write", async () => {
  const s = await mkSession();
  await prisma.sessionSettlement.create({ data: { kind: "SESSION_RELEASE", idempotencyKey: `SESSION_RELEASE:${s.session.id}`, sessionId: s.session.id, contractId: s.contract.id, status: "PENDING" } });
  const snap = async () => ({
    session: await prisma.session.findUniqueOrThrow({ where: { id: s.session.id } }),
    contract: await prisma.contract.findUniqueOrThrow({ where: { id: s.contract.id } }),
    settlements: await prisma.sessionSettlement.findMany({ where: { contractId: s.contract.id }, orderBy: { id: "asc" } }),
    otherSessions: await prisma.session.count({ where: { contractId: s.contract.id } }),
    audit: await prisma.auditLog.count({ where: { entityId: { in: [s.session.id, s.contract.id] } } }),
  });
  const before = JSON.stringify(await snap());
  const writesBefore = writeCalls.length;

  const caseId = (await svc.openCase(A1, s.session.id)).result.case.id;
  await svc.assign(A1, caseId, undefined);
  await svc.transition(A1, caseId, "COLLECTING", {});
  const claim = await svc.addClaim(A1, caseId, { claimantRole: "CLIENT", text: "PT vắng", moves: ["MONEY", "QUOTA", "PT_AT_FAULT"] });
  await svc.addIssue(A1, caseId, { kind: "PT_LATE", finding: "LATE_CONFIRMED_BY_ROOM_DATA", note: "Chỉ ghi nhận" });
  await svc.recollect(A3, caseId);
  await svc.transition(A1, caseId, "ASSESSING", {});
  const ev = await prisma.disputeCaseEvidence.findFirstOrThrow({ where: { caseId, subject: "SESSION_ROW" } });
  await svc.addAssessment(A1, caseId, { claimId: claim.result.id, directEvidenceIds: [ev.id], indirectEvidenceIds: [], rebuttalEvidenceIds: [], relevanceNote: "a", verifiabilityNote: "a", consistencyNote: "a", result: "ESTABLISHED", reasoning: "a" });
  await svc.recordFinding(A1, caseId, { finding: "VERIFIED_PT_ABSENT", reasoning: "Đã xác minh" });
  await svc.propose(A1, caseId, undefined);
  await svc.getForAdmin(A3, caseId);
  const done = await svc.decide(A2, caseId, approveBody());
  assert.equal(done.result.caseStatus, "DECISION_APPROVED");

  assert.equal(JSON.stringify(await snap()), before, "no session / contract / quota / settlement / audit row changed");
  const c = await prisma.contract.findUniqueOrThrow({ where: { id: s.contract.id } });
  assert.equal(c.usedSessions, 0);
  assert.equal(c.compensatedSessions, 0);
  assert.equal((await prisma.session.findUniqueOrThrow({ where: { id: s.session.id } })).status, "DISPUTED", "the session is still DISPUTED: execution is Slice 2");
  assert.equal(writeCalls.length, writesBefore, "no paymentClient write method was called");
  assert.equal(await prisma.disputeCase.count({ where: { sessionId: s.session.id } }), 1);
  // only ledger READS happened
  assert.ok(ledger.lookups.length > 0);
});

// ═══ Real HTTP (express app on an ephemeral port; auth-service is a fixture) ═════════════════════════════════════════

test("HTTP: route wiring, role gates, strict bodies, Vietnamese errors, Idempotency-Key header", async () => {
  const original = authServiceClient.verifyToken;
  (authServiceClient as any).verifyToken = async (header: string) => {
    const token = header.replace(/^Bearer /, "");
    if (token === "bad") throw Object.assign(new Error("401"), { response: { status: 401, data: { error: "x" } } });
    const [role, id] = token.split(":");
    return { status: 200, data: { user: { id, email: `${id}@t.test`, role } } };
  };
  const { default: app } = await import("../app");
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (method: string, path: string, token: string | null, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, headers: res.headers, json: (await res.json().catch(() => null)) as any };
  };
  try {
    const s = await mkSession();
    const adminTok = `ADMIN:${A1.id}`;
    const approverTok = `ADMIN:${A2.id}`;
    const clientTok = `CUSTOMER:${s.clientUserId}`;
    const ptTok = `PT:${s.ptUserId}`;

    // gates
    assert.equal((await call("GET", "/admin/dispute-cases", null)).status, 401);
    assert.equal((await call("GET", "/admin/dispute-cases", clientTok)).status, 403);
    assert.equal((await call("POST", "/admin/dispute-cases", clientTok, { sessionId: s.session.id })).status, 403);
    assert.equal((await call("GET", "/dispute-cases", null)).status, 401);

    // intake: strict body, then created (201), then idempotent (200)
    const bad = await call("POST", "/admin/dispute-cases", adminTok, { sessionId: s.session.id, status: "DECISION_APPROVED" });
    assert.equal(bad.status, 400);
    assert.equal(bad.json.code, "INVALID_INPUT");
    assert.equal(bad.json.error, "Dữ liệu gửi lên không hợp lệ");
    const created = await call("POST", "/admin/dispute-cases", adminTok, { sessionId: s.session.id }, { "Idempotency-Key": "k-intake-1" });
    assert.equal(created.status, 201);
    assert.equal(created.json.created, true);
    const caseId = created.json.case.id;
    const replay = await call("POST", "/admin/dispute-cases", adminTok, { sessionId: s.session.id }, { "Idempotency-Key": "k-intake-1" });
    assert.equal(replay.status, 201);
    assert.equal(replay.headers.get("idempotent-replay"), "true");
    assert.equal((await call("POST", "/admin/dispute-cases", adminTok, { sessionId: s.session.id })).status, 200);
    assert.equal((await call("POST", "/admin/dispute-cases", adminTok, { sessionId: s.session.id }, { "Idempotency-Key": "bad key!" })).json.code, "INVALID_IDEMPOTENCY_KEY");
    const notDisputed = await mkSession({ status: "COMPLETED" });
    const refused = await call("POST", "/admin/dispute-cases", adminTok, { sessionId: notDisputed.session.id });
    assert.equal(refused.status, 409);
    assert.equal(refused.json.code, "SESSION_NOT_DISPUTED");
    assert.match(refused.json.error, /khiếu nại/);

    // identity is the token, never the body
    const assign = await call("POST", `/admin/dispute-cases/${caseId}/assign`, adminTok, {});
    assert.equal(assign.status, 200);
    assert.equal(assign.json.investigatorId, A1.id);
    assert.equal((await call("POST", `/admin/dispute-cases/${caseId}/assign`, adminTok, { investigatorId: A3.id, approverId: A2.id })).status, 400);
    assert.equal((await call("POST", `/admin/dispute-cases/${caseId}/transition`, adminTok, { to: "COLLECTING" })).status, 200);
    const claim = await call("POST", `/admin/dispute-cases/${caseId}/claims`, adminTok, { claimantRole: "CLIENT", text: "PT vắng", moves: ["MONEY"] });
    assert.equal(claim.status, 201);
    assert.equal((await call("POST", `/admin/dispute-cases/${caseId}/transition`, adminTok, { to: "FINDING_RECORDED" })).status, 400, "not a manual target");
    assert.equal((await call("POST", `/admin/dispute-cases/${caseId}/transition`, adminTok, { to: "ASSESSING" })).status, 200);

    // the party side over HTTP, a restricted-or-not PT alike
    const partyList = await call("GET", "/dispute-cases", clientTok);
    assert.equal(partyList.status, 200);
    assert.ok(partyList.json.items.some((i: any) => i.id === caseId));
    assert.equal((await call("GET", `/dispute-cases/${caseId}`, `CUSTOMER:${randomUUID()}`)).status, 404);
    const stmt = await call("POST", `/dispute-cases/${caseId}/statements`, ptTok, { text: "PT trình bày", supplementReason: "bổ sung" });
    assert.equal(stmt.status, 201);
    assert.equal((await call("POST", `/dispute-cases/${caseId}/statements`, ptTok, { text: "x", userId: "someone" })).status, 400);
    assert.equal((await call("POST", `/dispute-cases/${caseId}/evidence`, clientTok, { description: "Ảnh", sha256: "not-hex" })).status, 400);
    for (const extra of [{ sensitivity: "NORMAL" }, { verificationStatus: "SERVER_VERIFIED" }]) {
      const refused = await call("POST", `/dispute-cases/${caseId}/evidence`, ptTok, { description: "Ảnh", sha256: "e".repeat(64), ...extra });
      assert.equal(refused.status, 400);
      assert.equal(refused.json.code, "INVALID_INPUT");
    }
    const doc = await call("POST", `/dispute-cases/${caseId}/evidence`, clientTok, { description: "Ảnh", sha256: "f".repeat(64) });
    assert.equal(doc.status, 201);
    const detail = await call("GET", `/dispute-cases/${caseId}`, clientTok);
    assert.equal(detail.status, 200);
    assert.equal(detail.json.case.role, "CLIENT");
    assert.ok(detail.json.evidence.some((e: any) => e.id === doc.json.id));

    // investigator-only over HTTP, proposals refuse an outcome in the body
    const ev = await prisma.disputeCaseEvidence.findFirstOrThrow({ where: { caseId, subject: "SESSION_ROW" } });
    assert.equal((await call("POST", `/admin/dispute-cases/${caseId}/assessments`, approverTok, { claimId: claim.json.id, relevanceNote: "a", verifiabilityNote: "a", consistencyNote: "a", result: "ESTABLISHED", reasoning: "a" })).json.code, "NOT_ASSIGNED_INVESTIGATOR");
    assert.equal((await call("POST", `/admin/dispute-cases/${caseId}/assessments`, adminTok, { claimId: claim.json.id, directEvidenceIds: [ev.id], relevanceNote: "a", verifiabilityNote: "a", consistencyNote: "a", result: "ESTABLISHED", reasoning: "a" })).status, 201);
    assert.equal((await call("POST", `/admin/dispute-cases/${caseId}/findings`, adminTok, { finding: "VERIFIED_DELIVERED", reasoning: "x" })).status, 201);
    const withOutcome = await call("POST", `/admin/dispute-cases/${caseId}/proposals`, adminTok, { outcome: "PT_NO_SHOW_CONFIRMED" });
    assert.equal(withOutcome.status, 400);
    const proposal = await call("POST", `/admin/dispute-cases/${caseId}/proposals`, adminTok, {});
    assert.equal(proposal.status, 201);
    assert.equal(proposal.json.outcome, "COMPLETED");
    assert.equal(proposal.json.execution, "BLOCKED: SLICE_2_NOT_ENABLED");

    // four eyes over HTTP
    const self = await call("POST", `/admin/dispute-cases/${caseId}/approvals`, adminTok, approveBody());
    assert.equal(self.status, 403);
    assert.equal(self.json.code, "SELF_APPROVAL_FORBIDDEN");
    assert.equal((await call("POST", `/admin/dispute-cases/${caseId}/approvals`, `ADMIN:${s.clientUserId}`, approveBody())).json.code, "CONFLICT_OF_INTEREST");
    assert.equal((await call("POST", `/admin/dispute-cases/${caseId}/approvals`, approverTok, { result: "APPROVED", reason: "ok" })).status, 400, "the declaration is mandatory in the body");
    const ok = await call("POST", `/admin/dispute-cases/${caseId}/approvals`, approverTok, approveBody());
    assert.equal(ok.status, 200);
    assert.equal(ok.json.caseStatus, "DECISION_APPROVED");
    assert.equal(ok.json.execution, "BLOCKED: SLICE_2_NOT_ENABLED");

    const full = await call("GET", `/admin/dispute-cases/${caseId}`, adminTok);
    assert.equal(full.status, 200);
    assert.equal(full.json.decision.execution, "BLOCKED: SLICE_2_NOT_ENABLED");
    assert.ok(full.json.financial.derived);
    assert.equal((await call("GET", "/admin/dispute-cases?status=DECISION_APPROVED", adminTok)).json.items.some((i: any) => i.id === caseId), true);
    assert.equal((await call("GET", "/admin/dispute-cases?status=NOPE", adminTok)).status, 400);
    assert.equal((await call("GET", "/admin/dispute-cases/not-a-uuid", adminTok)).status, 404);
  } finally {
    (authServiceClient as any).verifyToken = original;
    await new Promise((r) => server.close(r));
  }
});

// ═══ Hardening ══════════════════════════════════════════════════════════════════════════════════════════════════════

test("hardening P0: self-submitted evidence is RESTRICTED + CLIENT_CLAIMED_UNVERIFIED, cannot be shared, is invisible to the other side (also through a forced share row) and plainly labelled for the admin", async () => {
  const s = await mkSession({ ptNotes: null, disputeReason: null });
  const caseId = (await svc.openCase(A1, s.session.id)).result.case.id;
  await svc.assign(A1, caseId, undefined);
  await svc.transition(A1, caseId, "COLLECTING", {});
  const client: Actor = { id: s.clientUserId, role: "CUSTOMER" };
  const pt: Actor = { id: s.ptUserId, role: "PT" };

  const cDoc = await svc.submitEvidence(client, caseId, { description: "BI-MAT-KHACH-123", sha256: "a1".repeat(32) });
  const pDoc = await svc.submitEvidence(pt, caseId, { description: "BI-MAT-PT-456", sha256: "b2".repeat(32) });
  for (const [doc, role, user] of [[cDoc, "CLIENT", s.clientUserId], [pDoc, "PT", s.ptUserId]] as const) {
    const row = await prisma.disputeCaseEvidence.findUniqueOrThrow({ where: { id: doc.result.id } });
    assert.equal(row.sensitivity, "RESTRICTED");
    assert.equal(row.verificationStatus, "CLIENT_CLAIMED_UNVERIFIED");
    assert.equal(row.provenanceType, "EXTERNAL_DOCUMENT");
    assert.equal(row.submittedRole, role);
    assert.equal(row.submittedBy, user);
    assert.equal((row.payload as any).hashStatus, "CLIENT_CLAIMED_UNVERIFIED");
    assert.equal((row.payload as any).fileStored, false);
  }
  // system-collected rows are NOT_APPLICABLE
  const sys = await prisma.disputeCaseEvidence.findMany({ where: { caseId, submittedBy: null } });
  assert.ok(sys.length >= 13 && sys.every((e) => e.verificationStatus === "NOT_APPLICABLE"));

  // the database refuses a party row that is not RESTRICTED + unverified
  const base = { caseId, provenanceType: "EXTERNAL_DOCUMENT" as const, source: "party.external_document", scopeSessionId: s.session.id, scopeContractId: s.contract.id, captureStatus: "OK" as const, contentHash: "c".repeat(64), payload: {} };
  await assert.rejects(
    prisma.disputeCaseEvidence.create({ data: { ...base, subject: "PARTY_DOC:x1", submittedBy: s.clientUserId, submittedRole: "CLIENT", sensitivity: "NORMAL", verificationStatus: "CLIENT_CLAIMED_UNVERIFIED" } }),
    /dispute_case_evidence_party_submission_restricted|check constraint/,
  );
  await assert.rejects(
    prisma.disputeCaseEvidence.create({ data: { ...base, subject: "PARTY_DOC:x2", submittedBy: s.ptUserId, submittedRole: "PT", sensitivity: "RESTRICTED", verificationStatus: "SERVER_VERIFIED" } }),
    /dispute_case_evidence_party_submission_restricted|check constraint/,
  );

  // share: refused in both directions, with the reason
  for (const [doc, to] of [[cDoc, "PT"], [pDoc, "CLIENT"]] as const) {
    const err: any = await svc.share(A1, caseId, { evidenceId: doc.result.id, sharedWithRole: to, reason: "để phản biện" }).catch((e) => e);
    assert.equal(err.status, 409);
    assert.equal(err.code, "PARTY_EVIDENCE_SHARE_DESIGN_REQUIRED");
    assert.equal(err.details.reason, "PARTY_SUBMITTED");
  }
  assert.equal(await prisma.disputeCaseShare.count({ where: { caseId } }), 0);
  // also not through the other refusal branches: a RESTRICTED system row and an unverified admin-received row
  const restrictedSys = await prisma.disputeCaseEvidence.create({ data: { ...base, subject: "SYS:restricted", provenanceType: "SERVER_OBSERVED", sensitivity: "RESTRICTED" } });
  const unverifiedAdmin = await prisma.disputeCaseEvidence.create({ data: { ...base, subject: "ADMIN:unverified", provenanceType: "ADMIN_RECEIVED_ON_BEHALF", submittedBy: A3.id, submittedRole: "ADMIN", verificationStatus: "CLIENT_CLAIMED_UNVERIFIED" } });
  assert.equal(((await svc.share(A1, caseId, { evidenceId: restrictedSys.id, sharedWithRole: "PT", reason: "x" }).catch((e) => e)) as any).details.reason, "NOT_NORMAL_SENSITIVITY");
  assert.equal(((await svc.share(A1, caseId, { evidenceId: unverifiedAdmin.id, sharedWithRole: "PT", reason: "x" }).catch((e) => e)) as any).details.reason, "UNVERIFIED");

  // simulate data written before the hardening: a share row forced straight into the table (TEST FIXTURE)
  await prisma.disputeCaseShare.create({ data: { caseId, evidenceId: cDoc.result.id, sharedWithRole: "PT", sharedBy: A1.id, reason: "dữ liệu cũ" } });
  await prisma.disputeCaseShare.create({ data: { caseId, evidenceId: pDoc.result.id, sharedWithRole: "CLIENT", sharedBy: A1.id, reason: "dữ liệu cũ" } });

  const cView = await svc.getForParty(client, caseId);
  const pView = await svc.getForParty(pt, caseId);
  const cText = JSON.stringify(cView);
  const pText = JSON.stringify(pView);
  // the author sees its own row, labelled unverified
  assert.ok(cView.evidence.some((e) => e.id === cDoc.result.id && e.verificationStatus === "CLIENT_CLAIMED_UNVERIFIED"));
  assert.ok(cText.includes("BI-MAT-KHACH-123"));
  // the other side sees NOTHING of it: not the row, the description, the hash, the id
  for (const [text, forbidden] of [[pText, [cDoc.result.id, "BI-MAT-KHACH-123", "a1".repeat(32)]], [cText, [pDoc.result.id, "BI-MAT-PT-456", "b2".repeat(32)]]] as const) {
    for (const f of forbidden) assert.equal(text.includes(f), false, `leaked ${f.slice(0, 12)}`);
  }
  // restricted / unverified system-side rows are hidden from both as well
  assert.ok(![...cView.evidence, ...pView.evidence].some((e) => e.id === restrictedSys.id || e.id === unverifiedAdmin.id));

  // the admin sees both, plainly marked
  const admin = await svc.getForAdmin(A3, caseId);
  for (const id of [cDoc.result.id, pDoc.result.id]) {
    const row = admin.evidence.find((e) => e.id === id)!;
    assert.equal(row.verificationStatus, "CLIENT_CLAIMED_UNVERIFIED");
    assert.equal(row.sensitivity, "RESTRICTED");
    assert.equal(row.partySubmitted, true);
    assert.equal((row.payload as any).hashStatus, "CLIENT_CLAIMED_UNVERIFIED");
  }
  assert.equal(admin.evidence.find((e) => e.subject === "SESSION_ROW")!.verificationStatus, "NOT_APPLICABLE");
});

test("hardening 5A: a DISPUTED session with NULL dispute_type is taken in as LEGACY_UNCLASSIFIED; no finding / proposal until the investigator classifies it; sessions.dispute_type is never written", async () => {
  const s = await mkSession({ disputeType: null });
  const opened = await svc.openCase(A1, s.session.id);
  assert.equal(opened.result.created, true);
  assert.equal(opened.result.case.type, "LEGACY_UNCLASSIFIED");
  const caseId = opened.result.case.id;
  const intake = await prisma.disputeCaseEvent.findFirstOrThrow({ where: { caseId, action: "INTAKE" } });
  assert.match(intake.note ?? "", /Phân loại tạm/);
  assert.equal((intake.payload as any).detail.provisionalClassification, "LEGACY_UNCLASSIFIED");

  await svc.assign(A1, caseId, undefined);
  await rejects(svc.classify(A3, caseId, "PT_DELIVERY"), 403, "NOT_ASSIGNED_INVESTIGATOR");
  await rejects(svc.classify({ id: randomUUID(), role: "CUSTOMER" }, caseId, "PT_DELIVERY"), 403, "ADMIN_ONLY");
  await rejects(svc.classify(A1, caseId, "LEGACY_UNCLASSIFIED" as any), 400, "TYPE_NOT_ALLOWED");
  await svc.transition(A1, caseId, "COLLECTING", {});
  const claim = await svc.addClaim(A1, caseId, { claimantRole: "CLIENT", text: "PT vắng", moves: ["MONEY"] });
  await svc.transition(A1, caseId, "ASSESSING", {});
  const ev = await prisma.disputeCaseEvidence.findFirstOrThrow({ where: { caseId, subject: "SESSION_ROW" } });
  await svc.addAssessment(A1, caseId, { claimId: claim.result.id, directEvidenceIds: [ev.id], indirectEvidenceIds: [], rebuttalEvidenceIds: [], relevanceNote: "a", verifiabilityNote: "a", consistencyNote: "a", result: "ESTABLISHED", reasoning: "a" });
  await rejects(svc.recordFinding(A1, caseId, { finding: "VERIFIED_PT_ABSENT", reasoning: "x" }), 409, "CLASSIFICATION_REQUIRED");
  await rejects(svc.recordFinding(A1, caseId, { finding: "NOT_A_DISPUTE", reasoning: "x" }), 409, "CLASSIFICATION_REQUIRED");
  assert.equal(await prisma.disputeCaseFinding.count({ where: { caseId } }), 0);

  // a proposal is blocked as well (fixture: a legacy case that somehow stands at FINDING_RECORDED)
  const f = await mkSession({ disputeType: null });
  const fixture = await prisma.disputeCase.create({
    data: { sessionId: f.session.id, contractId: f.contract.id, clientUserId: f.clientUserId, ptUserId: f.ptUserId, type: "LEGACY_UNCLASSIFIED", status: "FINDING_RECORDED", investigatorId: A1.id, createdBy: A1.id },
  });
  await prisma.disputeCaseFinding.create({ data: { caseId: fixture.id, finding: "VERIFIED_DELIVERED", reasoning: "fixture", recordedBy: A1.id } });
  await rejects(svc.propose(A1, fixture.id, undefined), 409, "CLASSIFICATION_REQUIRED");
  assert.equal(await prisma.disputeCaseProposal.count({ where: { caseId: fixture.id } }), 0);

  // classify, then the flow goes on
  const c1 = await svc.classify(A1, caseId, "PT_NO_SHOW_CLAIM");
  assert.deepEqual({ from: c1.result.from, to: c1.result.to }, { from: "LEGACY_UNCLASSIFIED", to: "PT_NO_SHOW_CLAIM" });
  assert.equal((await prisma.disputeCase.findUniqueOrThrow({ where: { id: caseId } })).type, "PT_NO_SHOW_CLAIM");
  const ev2 = await prisma.disputeCaseEvent.findFirstOrThrow({ where: { caseId, action: "CLASSIFIED" } });
  assert.equal(ev2.actorUserId, A1.id);
  await rejects(svc.classify(A1, caseId, "PT_DELIVERY"), 409, "ALREADY_CLASSIFIED");
  await svc.recordFinding(A1, caseId, { finding: "VERIFIED_PT_ABSENT", reasoning: "Đã xác minh" });
  assert.equal((await svc.propose(A1, caseId, undefined)).result.outcome, "PT_NO_SHOW_CONFIRMED");

  // sessions.dispute_type stays NULL (and nothing else of the session changed)
  const session = await prisma.session.findUniqueOrThrow({ where: { id: s.session.id } });
  assert.equal(session.disputeType, null);
  assert.equal(session.status, "DISPUTED");
  // a typed case cannot be re-classified, and a real-typed intake is not provisional
  const typed = await mkSession({ disputeType: "DELIVERY_DISPUTE" });
  assert.equal((await svc.openCase(A1, typed.session.id)).result.case.type, "PT_DELIVERY");
});

test("hardening 5B/5C: a historical obligation shows as LEGACY_NEEDS_VERIFICATION (F3, VERIFICATION_REQUIRED) with no ledger write; a session without settlements is NO_RECORDED_SETTLEMENT", async () => {
  const s = await mkSession();
  await prisma.sessionSettlement.create({ data: { kind: "SESSION_RELEASE", idempotencyKey: `SESSION_RELEASE:${s.session.id}`, sessionId: s.session.id, contractId: s.contract.id, status: "SETTLED" } });
  await prisma.sessionSettlement.create({ data: { kind: "PT_NO_SHOW_COMPENSATION", idempotencyKey: `PT_NO_SHOW:${s.session.id}`, sessionId: s.session.id, contractId: s.contract.id, status: "SETTLED" } });
  const rec = (key: string, status: string) => ({ key, kind: "X", transactionId: "t", result: {}, createdAt: new Date().toISOString(), fingerprinted: true, obligation: { id: "o", status, owed: "250000.00", paid: "0.00", unpaid: "250000.00" } });
  ledger.ops.set(`SESSION_RELEASE:${s.session.id}`, rec(`SESSION_RELEASE:${s.session.id}`, "RESOLVED"));
  ledger.ops.set(`PT_NO_SHOW:${s.session.id}`, rec(`PT_NO_SHOW:${s.session.id}`, "PAID_EXTERNALLY"));
  const caseId = (await svc.openCase(A1, s.session.id)).result.case.id;
  const writesBefore = writeCalls.length;
  const settlementsBefore = JSON.stringify(await prisma.sessionSettlement.findMany({ where: { contractId: s.contract.id }, orderBy: { id: "asc" } }));
  const admin = (await svc.getForAdmin(A3, caseId)).financial;
  assert.equal(admin.group, "F3");
  assert.equal(admin.f3Kind, "VERIFICATION_REQUIRED");
  assert.deepEqual(admin.items.map((i) => [i.state, i.f3Kind]), [["LEGACY_NEEDS_VERIFICATION", "VERIFICATION_REQUIRED"], ["LEGACY_NEEDS_VERIFICATION", "VERIFICATION_REQUIRED"]]);
  assert.equal(admin.groupLabel, "Cần xác minh — không phải nợ đang mở, cũng chưa xác minh đã trả");
  const party = await svc.getForParty({ id: s.clientUserId, role: "CUSTOMER" }, caseId);
  assert.equal(party.financial.groupLabel, admin.groupLabel);
  assert.doesNotMatch(JSON.stringify(party), /250000|PAID_EXTERNALLY|obligation/);
  assert.equal(writeCalls.length, writesBefore);
  assert.equal(JSON.stringify(await prisma.sessionSettlement.findMany({ where: { contractId: s.contract.id }, orderBy: { id: "asc" } })), settlementsBefore);
  ledger.ops.clear();

  const none = await mkSession();
  const noneCase = (await svc.openCase(A1, none.session.id)).result.case.id;
  const v = (await svc.getForAdmin(A3, noneCase)).financial;
  assert.equal(v.group, "NO_RECORDED_SETTLEMENT");
  assert.equal(v.groupLabel, "Chưa có bước quyết toán được ghi nhận");
  assert.notEqual(v.group, "NO_MONEY_EFFECT");
  assert.deepEqual((await svc.getForParty({ id: none.clientUserId, role: "CUSTOMER" }, noneCase)).financial, { group: "NO_RECORDED_SETTLEMENT", groupLabel: "Chưa có bước quyết toán được ghi nhận" });
});

test("hardening C1: a LEGACY_UNCLASSIFIED case cannot be approved or rejected either (409 CLASSIFICATION_REQUIRED), even if a proposal row exists", async () => {
  const f = await mkSession({ disputeType: null });
  const kase = await prisma.disputeCase.create({
    data: { sessionId: f.session.id, contractId: f.contract.id, clientUserId: f.clientUserId, ptUserId: f.ptUserId, type: "LEGACY_UNCLASSIFIED", status: "AWAITING_APPROVAL", investigatorId: A1.id, createdBy: A1.id },
  });
  const finding = await prisma.disputeCaseFinding.create({ data: { caseId: kase.id, finding: "VERIFIED_DELIVERED", reasoning: "fixture", recordedBy: A1.id } });
  await prisma.disputeCaseProposal.create({ data: { caseId: kase.id, findingId: finding.id, outcome: "COMPLETED", proposerId: A1.id, evidenceSnapshot: [] } });
  await rejects(svc.decide(A2, kase.id, approveBody()), 409, "CLASSIFICATION_REQUIRED");
  await rejects(svc.decide(A2, kase.id, approveBody({ result: "REJECTED" })), 409, "CLASSIFICATION_REQUIRED");
  assert.equal(await prisma.disputeCaseApproval.count({ where: { proposal: { caseId: kase.id } } }), 0);
  assert.equal((await prisma.disputeCase.findUniqueOrThrow({ where: { id: kase.id } })).status, "AWAITING_APPROVAL");
});
