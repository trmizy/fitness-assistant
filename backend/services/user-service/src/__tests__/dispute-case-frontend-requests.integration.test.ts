/**
 * DISPUTE V2.1 - answers to the frontend requests R-02, R-03, R-04, R-05, R-10, R-13, R-14, R-16, R-19 (DISPUTE_V21_FRONTEND_BACKEND_REQUESTS.md).
 * BACKEND INTEGRATION: every route is driven over REAL HTTP into the real user-service express app on an ephemeral port, on the isolated *_test database
 * (authServiceClient.verifyToken is a TEST FIXTURE: token "ROLE:id"; the ledger lookup is a stub and every payment WRITE throws). Session / contract rows are inserted (TEST FIXTURE).
 * Not a browser. Run ALONE (it truncates the dispute_case* tables), command as in dispute-case.integration.test.ts.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { guardedTest as test } from "./test-db-guard";
import { paymentClient } from "../clients/payment.client";
import { authServiceClient } from "../clients/auth-service.client";
import { prisma } from "../repositories/profile.repository";
import { addSession, makeContract } from "./pt-restriction.test-helpers";
import { setAdminAccountLookupForTests } from "../services/dispute-case/admin-account";
import { __resetFlagWarnings } from "../services/dispute-case/flags";
import { admin, approvedCaseFor, caseAtFinding, disableExecutionFlags, enableExecutionFlags, FINDING_FOR } from "./dispute-case-exec.test-helpers";

const ledger = { ops: new Map<string, any>() };
const restores: Array<() => void> = [];
const createdContracts: string[] = [];
const createdPts: string[] = [];
const createdProfiles: string[] = [];
let base = "";
let server: any;

test.before(async () => {
  for (const name of Object.keys(paymentClient)) {
    const original = (paymentClient as any)[name];
    (paymentClient as any)[name] =
      name === "lookupLedgerOperation"
        ? async (key: string) => ledger.ops.get(key) ?? null
        : async () => {
            throw new Error(`payment write refused by the test stub: ${name}`);
          };
    restores.push(() => ((paymentClient as any)[name] = original));
  }
  const originalVerify = authServiceClient.verifyToken;
  (authServiceClient as any).verifyToken = async (header: string) => {
    const [role, id] = header.replace(/^Bearer /, "").split(":");
    return { status: 200, data: { user: { id, email: `${id}@t.test`, role } } };
  };
  restores.push(() => ((authServiceClient as any).verifyToken = originalVerify));
  setAdminAccountLookupForTests(async () => ({ role: "ADMIN", isActive: true }));
  const { default: app } = await import("../app");
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  await prisma.$executeRawUnsafe(
    `TRUNCATE dispute_case_executions, dispute_case_access_logs, dispute_case_events, dispute_case_approvals, dispute_case_proposals, dispute_case_findings, dispute_case_assessments, dispute_case_shares, dispute_case_statements, dispute_case_evidence, dispute_case_claims, dispute_case_issues, dispute_case_policy_eligibility_reviews, dispute_cases CASCADE`,
  );
});
test.after(async () => {
  disableExecutionFlags();
  setAdminAccountLookupForTests();
  for (const r of restores) r();
  server?.close();
  await prisma.userProfile.deleteMany({ where: { userId: { in: [...createdProfiles, ...createdPts] } } }).catch(() => {});
  await prisma.notification.deleteMany({ where: { entityType: "DISPUTE_CASE" } }).catch(() => {});
  await prisma.sessionSettlement.deleteMany({ where: { contractId: { in: createdContracts } } }).catch(() => {});
  await prisma.auditLog.deleteMany({ where: { entityId: { in: createdContracts } } }).catch(() => {});
  await prisma.session.deleteMany({ where: { contractId: { in: createdContracts } } }).catch(() => {});
  await prisma.contract.deleteMany({ where: { id: { in: createdContracts } } }).catch(() => {});
  await prisma.$disconnect();
});
test.beforeEach(() => {
  ledger.ops.clear();
  disableExecutionFlags();
  enableExecutionFlags({});
});

async function mkSession(over: { status?: string; disputeType?: string | null } = {}) {
  const ptUserId = randomUUID();
  const contract = await makeContract(ptUserId, { sessionMode: "ONLINE" });
  createdContracts.push(contract.id);
  createdPts.push(ptUserId);
  const session = await addSession(contract, over.status ?? "DISPUTED", new Date(Date.now() - 3 * 3600_000), {
    sessionMode: "ONLINE",
    disputeType: over.disputeType === undefined ? "DELIVERY_DISPUTE" : over.disputeType,
    disputedAt: new Date(Date.now() - 3600_000),
    disputeReason: "Buổi tập không diễn ra như đã hẹn",
    ptNotes: "PT báo đã dạy đủ giờ",
  });
  return { contract, session, ptUserId, clientUserId: contract.clientUserId };
}
async function call(method: string, path: string, token: string | null, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, headers: res.headers, json: (await res.json().catch(() => null)) as any };
}
const A = (a: { id: string }) => `ADMIN:${a.id}`;

// ═══ R-02 capabilities ═══════════════════════════════════════════════════════════════════════════════════════════════

test("R-02: GET /admin/dispute-cases/capabilities returns the REAL verdict of each flag (read-only), with the reason a flag asked for on is still off; admin only", async () => {
  const keys = ["execution", "t0", "evidenceStorage", "lateOpenReconciliation", "d65bResolution"];
  const caps = async () => (await call("GET", "/admin/dispute-cases/capabilities", A(admin()))).json;

  const off = await caps();
  for (const k of keys) assert.equal(off[k], false, `${k} is off when nothing asks for it`);
  assert.deepEqual(Object.keys(off.details).sort(), [...keys].sort());
  assert.equal(off.details.execution.refusedBecause, undefined);

  enableExecutionFlags({ execution: true, t0: true, evidence: true });
  const savedEnv = { late: process.env.DISPUTE_CASE_LATE_OPEN_RECONCILIATION_ENABLED, d65b: process.env.DISPUTE_CASE_D65B_RESOLUTION_ENABLED };
  process.env.DISPUTE_CASE_LATE_OPEN_RECONCILIATION_ENABLED = "true";
  process.env.DISPUTE_CASE_D65B_RESOLUTION_ENABLED = "true";
  try {
    const on = await caps();
    for (const k of keys) assert.equal(on[k], true, k);

    // the variable says true but the process is not the isolated test one: OFF, with the reason (the same fail-closed rule the guards use)
    const realWarn = console.warn;
    console.warn = () => {};
    process.env.NODE_ENV = "production";
    __resetFlagWarnings();
    try {
      const prod = await caps();
      for (const k of keys) {
        assert.equal(prod[k], false, k);
        assert.equal(prod.details[k].refusedBecause, "NOT_TEST_ENV", k);
      }
    } finally {
      process.env.NODE_ENV = "test";
      console.warn = realWarn;
    }
  } finally {
    for (const [k, v] of [["DISPUTE_CASE_LATE_OPEN_RECONCILIATION_ENABLED", savedEnv.late], ["DISPUTE_CASE_D65B_RESOLUTION_ENABLED", savedEnv.d65b]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
  assert.equal((await call("GET", "/admin/dispute-cases/capabilities", null)).status, 401);
  assert.equal((await call("GET", "/admin/dispute-cases/capabilities", `CUSTOMER:${randomUUID()}`)).status, 403);
  // the route does not shadow a case id lookup
  assert.equal((await call("GET", `/admin/dispute-cases/${randomUUID()}`, A(admin()))).json.code, "CASE_NOT_FOUND");
});

// ═══ R-04 names ══════════════════════════════════════════════════════════════════════════════════════════════════════

test("R-04: summary (list), detail, queue and access log carry the display names of both parties from the profile source; a missing name is null; a failing lookup never fails the read; no e-mail leaks", async () => {
  const s = await mkSession();
  await prisma.userProfile.upsert({ where: { userId: s.clientUserId }, update: { firstName: "An", lastName: "Nguyễn", email: "secret-client@example.com" }, create: { userId: s.clientUserId, firstName: "An", lastName: "Nguyễn", email: "secret-client@example.com" } });
  await prisma.userProfile.upsert({ where: { userId: s.ptUserId }, update: { firstName: "Bình", lastName: null, email: "secret-pt@example.com" }, create: { userId: s.ptUserId, firstName: "Bình", email: "secret-pt@example.com" } });
  createdProfiles.push(s.clientUserId);
  const inv = admin();
  const caseId = (await call("POST", "/admin/dispute-cases", A(inv), { sessionId: s.session.id })).json.case.id;
  await call("POST", `/admin/dispute-cases/${caseId}/assign`, A(inv), {});

  const list = (await call("GET", `/admin/dispute-cases?sessionId=${s.session.id}`, A(inv))).json.items[0];
  assert.deepEqual([list.clientName, list.ptName, list.investigatorName], ["An Nguyễn", "Bình", null]);
  const detail = (await call("GET", `/admin/dispute-cases/${caseId}`, A(inv))).json;
  assert.deepEqual([detail.case.clientName, detail.case.ptName, detail.case.clientUserId, detail.case.ptUserId], ["An Nguyễn", "Bình", s.clientUserId, s.ptUserId]);
  const queue = (await call("GET", `/admin/dispute-cases/queue?contractId=${s.contract.id}`, A(inv))).json.items[0];
  assert.deepEqual([queue.clientName, queue.ptName], ["An Nguyễn", "Bình"]);
  const sess = (await call("GET", `/admin/sessions/${s.session.id}`, A(inv))).json;
  assert.deepEqual([sess.session.clientName, sess.session.ptName], ["An Nguyễn", "Bình"]);
  assert.ok(!JSON.stringify([list, detail, queue, sess]).includes("secret-"), "no e-mail in any answer");

  // a person with no profile: null, the read still succeeds
  const s2 = await mkSession();
  const c2 = (await call("POST", "/admin/dispute-cases", A(inv), { sessionId: s2.session.id })).json.case.id;
  const d2 = await call("GET", `/admin/dispute-cases/${c2}`, A(inv));
  assert.deepEqual([d2.status, d2.json.case.clientName, d2.json.case.ptName], [200, null, null]);

  // the profile source breaks: 200 everywhere, names null
  const original = (prisma.userProfile as any).findMany;
  (prisma.userProfile as any).findMany = async () => {
    throw new Error("profile source down");
  };
  try {
    for (const path of [`/admin/dispute-cases?sessionId=${s.session.id}`, `/admin/dispute-cases/${caseId}`, `/admin/dispute-cases/queue?contractId=${s.contract.id}`, `/admin/sessions/${s.session.id}`, `/admin/dispute-cases/${caseId}/access-log`]) {
      const r = await call("GET", path, A(inv));
      assert.equal(r.status, 200, path);
    }
    assert.equal((await call("GET", `/admin/dispute-cases/${caseId}`, A(inv))).json.case.clientName, null);
  } finally {
    (prisma.userProfile as any).findMany = original;
  }
});

// ═══ R-10 details.allowed ════════════════════════════════════════════════════════════════════════════════════════════

test("R-10: CASE_STATE_NOT_ALLOWED always carries the REAL details.allowed (+ allowedKind): the targets of a refused transition, the statuses of every other action", async () => {
  const s = await mkSession();
  const inv = admin();
  const caseId = (await call("POST", "/admin/dispute-cases", A(inv), { sessionId: s.session.id })).json.case.id;
  const bad = await call("POST", `/admin/dispute-cases/${caseId}/transition`, A(inv), { to: "ASSESSING" });
  assert.equal(bad.status, 409);
  assert.equal(bad.json.code, "CASE_STATE_NOT_ALLOWED");
  assert.deepEqual(bad.json.details, { status: "INTAKE", allowed: ["COLLECTING", "REJECTED_INTAKE"], allowedKind: "TARGETS" });

  const share = await call("POST", `/admin/dispute-cases/${caseId}/shares`, A(inv), { evidenceId: randomUUID(), sharedWithRole: "CLIENT", reason: "x" });
  assert.equal(share.json.code, "NOT_ASSIGNED_INVESTIGATOR"); // not the investigator yet: the investigator rule comes first
  await call("POST", `/admin/dispute-cases/${caseId}/assign`, A(inv), {});
  const shareIntake = await call("POST", `/admin/dispute-cases/${caseId}/shares`, A(inv), { evidenceId: randomUUID(), sharedWithRole: "CLIENT", reason: "x" });
  assert.equal(shareIntake.json.details.allowedKind, "STATUSES");
  assert.ok(shareIntake.json.details.allowed.length > 0 && !shareIntake.json.details.allowed.includes("INTAKE") && !shareIntake.json.details.allowed.includes("REJECTED_INTAKE"));

  await call("POST", `/admin/dispute-cases/${caseId}/transition`, A(inv), { to: "REJECTED_INTAKE", reason: "Không đủ căn cứ" });
  for (const [path, body] of [
    [`/admin/dispute-cases/${caseId}/assign`, {}],
    [`/admin/dispute-cases/${caseId}/recollect`, {}],
    [`/admin/dispute-cases/${caseId}/transition`, { to: "COLLECTING" }],
  ] as const) {
    const r = await call("POST", path, A(inv), body);
    assert.equal(r.json.code, "CASE_STATE_NOT_ALLOWED", path);
    assert.ok(Array.isArray(r.json.details.allowed) && r.json.details.allowed.length > 0, `${path}: ${JSON.stringify(r.json.details)}`);
    assert.ok(!r.json.details.allowed.includes("REJECTED_INTAKE") && !r.json.details.allowed.includes("DECISION_APPROVED"), path);
  }
  // the executor's own refusal
  const s2 = await mkSession();
  const w = await caseAtFinding(s2.session.id, "VERIFIED_PT_ABSENT");
  enableExecutionFlags({ execution: true });
  const ex = await call("POST", `/admin/dispute-cases/${w.caseId}/execute`, A(admin()), {});
  assert.equal(ex.status, 409);
  assert.equal(ex.json.code === "DECISION_NOT_APPROVED" || ex.json.code === "CASE_STATE_NOT_ALLOWED", true, JSON.stringify(ex.json));
  const s3 = await mkSession();
  const ap = await approvedCaseFor(s3.session.id, FINDING_FOR.CANCELLED);
  await call("POST", `/admin/dispute-cases/${ap.caseId}/execute`, A(admin()), {}); // runs it
  await (prisma as any).disputeCase.update({ where: { id: ap.caseId }, data: { status: "AWAITING_APPROVAL" } });
  const ex2 = await call("POST", `/admin/dispute-cases/${ap.caseId}/execute`, A(admin()), {});
  assert.equal(ex2.json.code, "CASE_STATE_NOT_ALLOWED");
  assert.deepEqual(ex2.json.details, { status: "AWAITING_APPROVAL", allowed: ["DECISION_APPROVED"], allowedKind: "STATUSES" });
});

// ═══ R-13 resolutionReason ═══════════════════════════════════════════════════════════════════════════════════════════

test("R-13: financial.items[].resolutionReason is passed through when the ledger lookup carries resolvedNote, and says plainly 'not available' (naming the missing dependency) when it does not", async () => {
  const s = await mkSession();
  const key = `SESSION_RELEASE:${s.session.id}`;
  await prisma.sessionSettlement.create({ data: { kind: "SESSION_RELEASE", idempotencyKey: key, sessionId: s.session.id, contractId: s.contract.id, status: "SETTLED" } });
  const op = (extra: Record<string, unknown> = {}) => ({
    key,
    kind: "RELEASE_SESSION",
    transactionId: randomUUID(),
    result: {},
    createdAt: new Date().toISOString(),
    fingerprinted: true,
    obligation: { id: randomUUID(), status: "RESOLVED_OTHER", owed: "100.00", paid: "0.00", unpaid: "100.00", ...extra },
  });
  const inv = admin();
  const caseId = (await call("POST", "/admin/dispute-cases", A(inv), { sessionId: s.session.id })).json.case.id;
  ledger.ops.set(key, op());
  let item = (await call("GET", `/admin/dispute-cases/${caseId}`, A(inv))).json.financial.items[0];
  assert.equal(item.state, "OBLIGATION_RESOLVED_OTHER");
  assert.equal(item.group, "F2");
  assert.equal(item.resolutionReason.available, false);
  assert.match(item.resolutionReason.note, /payment-service/);
  ledger.ops.set(key, op({ resolvedNote: "Đã hoàn tiền mặt tại quầy, biên nhận 123", resolvedAt: "2026-11-01T03:00:00.000Z" }));
  item = (await call("GET", `/admin/dispute-cases/${caseId}`, A(inv))).json.financial.items[0];
  assert.deepEqual(item.resolutionReason, { available: true, note: "Đã hoàn tiền mặt tại quầy, biên nhận 123", resolvedAt: "2026-11-01T03:00:00.000Z" });
  // the reason is only ever shown for RESOLVED_OTHER
  ledger.ops.set(key, op({ status: "OPEN", resolvedNote: "không được hiện" }));
  item = (await call("GET", `/admin/dispute-cases/${caseId}`, A(inv))).json.financial.items[0];
  assert.equal(item.resolutionReason, undefined);
});

// ═══ R-14 events ═════════════════════════════════════════════════════════════════════════════════════════════════════

test("R-14: events are a filtered summary (no payload, no idempotency key, no request hash) with eventsLimit and eventsTruncated", async () => {
  const s = await mkSession();
  const inv = admin();
  const caseId = (await call("POST", "/admin/dispute-cases", A(inv), { sessionId: s.session.id })).json.case.id;
  await call("POST", `/admin/dispute-cases/${caseId}/assign`, A(inv), {}, { "Idempotency-Key": "secret-key-xyz" });
  const d = (await call("GET", `/admin/dispute-cases/${caseId}`, A(inv))).json;
  assert.equal(d.eventsLimit, 200);
  assert.equal(d.eventsTruncated, false);
  const assign = d.events.find((e: any) => e.action === "ASSIGN");
  assert.ok(assign);
  assert.deepEqual(Object.keys(assign).sort(), ["action", "actorRole", "actorUserId", "createdAt", "fromStatus", "id", "note", "summary", "toStatus"]);
  assert.equal(assign.summary.investigatorId, inv.id);
  const raw = JSON.stringify(d.events);
  for (const leak of ["secret-key-xyz", "requestHash", "idempotencyKey", "payload"]) assert.ok(!raw.includes(leak), leak);
  // newest first
  assert.ok(new Date(d.events[0].createdAt).getTime() >= new Date(d.events[d.events.length - 1].createdAt).getTime());

  const rows = Array.from({ length: 205 }, (_, i) => ({ caseId, actorUserId: inv.id, actorRole: "ADMIN", action: "NOTE_FOR_TEST", note: `n${i}` }));
  await prisma.disputeCaseEvent.createMany({ data: rows });
  const big = (await call("GET", `/admin/dispute-cases/${caseId}`, A(inv))).json;
  assert.equal(big.events.length, 200);
  assert.equal(big.eventsTruncated, true);
  assert.equal(big.eventsLimit, 200);
});

// ═══ R-16 admin reads a session ══════════════════════════════════════════════════════════════════════════════════════

test("R-16: GET /admin/sessions/:id (admin) returns the session, its contract headline and its cases; 404 unknown; non-admin 403; the party route is untouched", async () => {
  const s = await mkSession();
  const inv = admin();
  assert.equal((await call("GET", `/admin/sessions/${s.session.id}`, A(inv))).json.openCase, null);
  const caseId = (await call("POST", "/admin/dispute-cases", A(inv), { sessionId: s.session.id })).json.case.id;
  const r = await call("GET", `/admin/sessions/${s.session.id}`, A(inv));
  assert.equal(r.status, 200);
  assert.equal(r.json.session.id, s.session.id);
  assert.deepEqual([r.json.session.status, r.json.session.disputeType, r.json.session.clientUserId, r.json.session.ptUserId], ["DISPUTED", "DELIVERY_DISPUTE", s.clientUserId, s.ptUserId]);
  assert.equal(r.json.session.disputeReason, "Buổi tập không diễn ra như đã hẹn");
  assert.equal(r.json.contract.id, s.contract.id);
  assert.equal(r.json.openCase.id, caseId);
  assert.equal(r.json.cases.length, 1);
  assert.ok(!("price" in r.json.contract) && !("platformRate" in r.json.contract), "no contract money / split in this read");
  assert.equal((await call("GET", `/admin/sessions/${randomUUID()}`, A(inv))).json.code, "SESSION_NOT_FOUND");
  assert.equal((await call("GET", `/admin/sessions/${s.session.id}`, `CUSTOMER:${s.clientUserId}`)).status, 403);
  assert.equal((await call("GET", `/admin/sessions/${s.session.id}`, null)).status, 401);
  // the fixed admin paths are still served by their own handlers
  assert.equal((await call("GET", "/admin/sessions/disputed", A(inv))).status, 200);
});

// ═══ R-19 access log ═════════════════════════════════════════════════════════════════════════════════════════════════

test("R-19: GET /admin/dispute-cases/:id/access-log (ADMIN only) lists who read the case, paginated and filterable; reading it writes nothing", async () => {
  const s = await mkSession();
  const inv = admin();
  const caseId = (await call("POST", "/admin/dispute-cases", A(inv), { sessionId: s.session.id })).json.case.id;
  const reader = admin();
  await call("GET", `/admin/dispute-cases/${caseId}`, A(reader));
  await call("GET", `/admin/dispute-cases/${caseId}`, A(reader));
  const countRows = () => prisma.disputeCaseAccessLog.count({ where: { caseId } });
  const before = await countRows();
  const log = await call("GET", `/admin/dispute-cases/${caseId}/access-log`, A(inv));
  assert.equal(log.status, 200);
  assert.equal(await countRows(), before, "reading the log does not add to it");
  assert.equal(log.json.total, before);
  assert.deepEqual(Object.keys(log.json.items[0]).sort(), ["action", "createdAt", "evidenceId", "id", "viewerName", "viewerRole", "viewerUserId"]);
  assert.ok(log.json.items.some((i: any) => i.viewerUserId === reader.id && i.action === "VIEW_CASE" && i.viewerRole === "ADMIN"));
  assert.ok(new Date(log.json.items[0].createdAt).getTime() >= new Date(log.json.items[log.json.items.length - 1].createdAt).getTime());
  const page = await call("GET", `/admin/dispute-cases/${caseId}/access-log?limit=1&offset=1`, A(inv));
  assert.equal(page.json.items.length, 1);
  assert.equal(page.json.limit, 1);
  assert.equal(page.json.hasMore, before > 2);
  assert.notEqual(page.json.items[0].id, log.json.items[0].id);
  assert.equal((await call("GET", `/admin/dispute-cases/${caseId}/access-log?action=VIEW_EVIDENCE`, A(inv))).json.items.every((i: any) => i.action === "VIEW_EVIDENCE"), true);
  assert.equal((await call("GET", `/admin/dispute-cases/${caseId}/access-log?action=NOPE`, A(inv))).status, 400);
  assert.equal((await call("GET", `/admin/dispute-cases/${caseId}/access-log?x=1`, A(inv))).status, 400);
  assert.equal((await call("GET", `/admin/dispute-cases/${caseId}/access-log`, `CUSTOMER:${s.clientUserId}`)).status, 403);
  assert.equal((await call("GET", `/admin/dispute-cases/${caseId}/access-log`, `PT:${s.ptUserId}`)).status, 403);
  assert.equal((await call("GET", `/admin/dispute-cases/${caseId}/access-log`, null)).status, 401);
  assert.equal((await call("GET", `/admin/dispute-cases/${randomUUID()}/access-log`, A(inv))).json.code, "CASE_NOT_FOUND");
});

// ═══ R-03 / R-05 re-check ════════════════════════════════════════════════════════════════════════════════════════════

test("R-03 + R-05: policy review rows carry evidenceIds, reasoning, supersedesId; the queue pages with limit/offset/total/hasMore and names the case of each session", async () => {
  const s = await mkSession();
  const w = await caseAtFinding(s.session.id, "VERIFIED_DELIVERED");
  const ev = await prisma.disputeCaseEvidence.findFirstOrThrow({ where: { caseId: w.caseId, subject: "SESSION_ROW" } });
  const first = await call("POST", `/admin/dispute-cases/${w.caseId}/policy-eligibility`, A(w.investigator), { result: "ELIGIBLE_CURRENT_POLICY", evidenceIds: [ev.id], reasoning: "Lý do một" });
  const second = await call("POST", `/admin/dispute-cases/${w.caseId}/policy-eligibility`, A(w.investigator), { result: "EXCEPTION_APPLIES", evidenceIds: [ev.id], reasoning: "Lý do hai", supersedesId: first.json.reviewId });
  const items = (await call("GET", `/admin/dispute-cases/${w.caseId}/policy-eligibility`, A(admin()))).json.items;
  const row = items.find((i: any) => i.reviewId === second.json.reviewId);
  assert.deepEqual([row.evidenceIds, row.reasoning, row.supersedesId, row.result], [[ev.id], "Lý do hai", first.json.reviewId, "EXCEPTION_APPLIES"]);

  await mkSession();
  await mkSession();
  const p0 = (await call("GET", "/admin/dispute-cases/queue?limit=1&offset=0", A(admin()))).json;
  const p1 = (await call("GET", "/admin/dispute-cases/queue?limit=1&offset=1", A(admin()))).json;
  assert.equal(p0.items.length, 1);
  assert.equal(p1.items.length, 1);
  assert.notEqual(p0.items[0].sessionId, p1.items[0].sessionId);
  assert.equal(p0.total, p1.total);
  assert.ok(p0.total >= 3 && p0.hasMore === true);
  const mine = (await call("GET", `/admin/dispute-cases/queue?contractId=${s.contract.id}`, A(admin()))).json.items[0];
  assert.equal(mine.caseId, w.caseId);
});

// ═══ HTTP coverage of the case routes no other suite drove over HTTP ═════════════════════════════════════════════════

test("HTTP: classify, request-more, evidence-change-ack, shares and reconcile-execution answer over HTTP with their documented shapes and codes", async () => {
  // classify (LEGACY_UNCLASSIFIED -> a real type), investigator only
  const sL = await mkSession({ disputeType: null });
  const inv = admin();
  const legacyId = (await call("POST", "/admin/dispute-cases", A(inv), { sessionId: sL.session.id })).json.case.id;
  await call("POST", `/admin/dispute-cases/${legacyId}/assign`, A(inv), {});
  assert.equal((await call("POST", `/admin/dispute-cases/${legacyId}/classify`, A(admin()), { type: "PT_DELIVERY" })).json.code, "NOT_ASSIGNED_INVESTIGATOR");
  assert.equal((await call("POST", `/admin/dispute-cases/${legacyId}/classify`, A(inv), { type: "LEGACY_UNCLASSIFIED" })).status, 400);
  const cls = await call("POST", `/admin/dispute-cases/${legacyId}/classify`, A(inv), { type: "PT_DELIVERY" });
  assert.deepEqual([cls.status, cls.json.from, cls.json.to], [200, "LEGACY_UNCLASSIFIED", "PT_DELIVERY"]);
  assert.equal((await call("POST", `/admin/dispute-cases/${legacyId}/classify`, A(inv), { type: "PT_DELIVERY" })).json.code, "ALREADY_CLASSIFIED");

  // request-more: ASSESSING -> AWAITING_PARTIES with a note
  const s = await mkSession();
  const w = await caseAtFinding(s.session.id, "VERIFIED_PT_ABSENT");
  await call("POST", `/admin/dispute-cases/${w.caseId}/transition`, A(w.investigator), { to: "ASSESSING" }).catch(() => null);
  const bad = await call("POST", `/admin/dispute-cases/${w.caseId}/request-more`, A(w.investigator), { to: "AWAITING_PARTIES", note: "x" });
  assert.equal(bad.json.code, "CASE_STATE_NOT_ALLOWED"); // FINDING_RECORDED: not a state that asks for more
  assert.deepEqual(bad.json.details.allowed, ["ASSESSING", "TECH_RECONCILIATION", "POLICY_PENDING"]);

  // shares: a system NORMAL row to the client; the same body twice is two shares (no key needed), a party row can never be shared
  const ev = await prisma.disputeCaseEvidence.findFirstOrThrow({ where: { caseId: w.caseId, subject: "SESSION_ROW" } });
  const sh = await call("POST", `/admin/dispute-cases/${w.caseId}/shares`, A(w.investigator), { evidenceId: ev.id, sharedWithRole: "CLIENT", reason: "Cho khách xem dữ liệu buổi" });
  assert.equal(sh.status, 201, JSON.stringify(sh.json));
  assert.ok(sh.json.id);
  assert.equal((await call("POST", `/admin/dispute-cases/${w.caseId}/shares`, A(w.investigator), { evidenceId: ev.id, statementId: randomUUID(), sharedWithRole: "CLIENT", reason: "x" })).status, 400);

  // evidence-change-ack: only while AWAITING_APPROVAL
  assert.equal((await call("POST", `/admin/dispute-cases/${w.caseId}/evidence-change-ack`, A(w.investigator), { note: "đã xem" })).json.code, "CASE_STATE_NOT_ALLOWED");
  const prop = await call("POST", `/admin/dispute-cases/${w.caseId}/proposals`, A(w.investigator), {});
  assert.equal(prop.status, 201, JSON.stringify(prop.json));
  const ack = await call("POST", `/admin/dispute-cases/${w.caseId}/evidence-change-ack`, A(w.investigator), { note: "đã xem thay đổi" });
  assert.deepEqual([ack.status, ack.json.acknowledged, Array.isArray(ack.json.changedIds)], [200, true, true]);

  // request-more on a case that can: reject the proposal -> ASSESSING, then ask the parties
  const rej = await call("POST", `/admin/dispute-cases/${w.caseId}/approvals`, A(admin()), { result: "REJECTED", reason: "Cần thêm lời khai", conflictOfInterestDeclaredNone: true });
  assert.equal(rej.status, 200, JSON.stringify(rej.json));
  const more = await call("POST", `/admin/dispute-cases/${w.caseId}/request-more`, A(w.investigator), { to: "AWAITING_PARTIES", note: "Mời hai bên bổ sung" });
  assert.deepEqual([more.status, more.json.from, more.json.to], [200, "ASSESSING", "AWAITING_PARTIES"]);

  // reconcile-execution: flag off -> 409; flag on and nothing running -> NOTHING_TO_RECONCILE
  const s2 = await mkSession();
  const ap = await approvedCaseFor(s2.session.id, FINDING_FOR.CANCELLED);
  assert.equal((await call("POST", `/admin/dispute-cases/${ap.caseId}/reconcile-execution`, A(admin()), {})).json.code, "EXECUTION_DISABLED");
  enableExecutionFlags({ execution: true });
  const rec = await call("POST", `/admin/dispute-cases/${ap.caseId}/reconcile-execution`, A(admin()), {});
  assert.deepEqual([rec.status, rec.json.action, rec.json.execStatus], [200, "NOTHING_TO_RECONCILE", "NOT_STARTED"]);
  assert.equal((await call("POST", `/admin/dispute-cases/${ap.caseId}/reconcile-execution`, `CUSTOMER:${s2.clientUserId}`, {})).status, 403);
});
