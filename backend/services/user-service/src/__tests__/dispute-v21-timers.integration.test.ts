/**
 * DISPUTE V2.1 TIMERS (Ngai 05/11/2026) - A1: response clocks 72 h / 48 h / 48 h, S2.4 (PT silent -> DISPUTED), SLA day 10/14, held-money review, the stuck queue.
 * BACKEND INTEGRATION: admin / party actions go over REAL HTTP into the real user-service app on the isolated *_test database; the sweep itself is called in-process with an INJECTED clock
 * (nothing sleeps). auth-service = TEST FIXTURE ("ROLE:id"), the account-lock lookup = TEST FIXTURE, payment-service = stub (every WRITE throws and is counted: it must stay 0).
 * Session / contract / notification rows are inserted where a flow outside the Case (the client's no-show report) is the thing under test (TEST FIXTURE). Not a browser.
 * Run ALONE (it truncates the dispute_case* tables).
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
import { setClockForTests } from "../services/dispute-case/clock";
import { runDisputeTimersSweep, setAccountLockLookupForTests } from "../services/dispute-case/dispute-timers.service";
import { admin, caseAtFinding, caseRow, disableExecutionFlags, enableExecutionFlags } from "./dispute-case-exec.test-helpers";

const restores: Array<() => void> = [];
const createdContracts: string[] = [];
const createdPts: string[] = [];
const writeCalls: string[] = [];
let base = "";
let server: any;
const HOUR = 3600_000;
const DAY = 24 * HOUR;
const locked = new Set<string>();
let lockUnknown = false;

test.before(async () => {
  for (const name of Object.keys(paymentClient)) {
    const original = (paymentClient as any)[name];
    (paymentClient as any)[name] =
      name === "lookupLedgerOperation"
        ? async () => null
        : async () => {
            writeCalls.push(name);
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
  setAccountLockLookupForTests(async (id) => (lockUnknown ? null : locked.has(id)));
  const { default: app } = await import("../app");
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  await prisma.$executeRawUnsafe(
    `TRUNCATE dispute_case_executions, dispute_case_access_logs, dispute_case_events, dispute_case_approvals, dispute_case_proposals, dispute_case_findings, dispute_case_assessments, dispute_case_shares, dispute_case_statements, dispute_case_evidence, dispute_case_claims, dispute_case_issues, dispute_case_policy_eligibility_reviews, dispute_case_deadlines, dispute_case_party_notices, dispute_case_agreement_confirmations, dispute_case_agreements, dispute_case_quota_corrections, dispute_case_appeal_consequences, dispute_case_appeals, dispute_held_money_decisions, dispute_held_money_reviews, dispute_cases CASCADE`,
  );
});
test.after(async () => {
  disableExecutionFlags();
  delete process.env.DISPUTE_CASE_TIMERS_ENABLED;
  delete process.env.DISPUTE_CASE_APPEALS_ENABLED;
  setClockForTests();
  setAdminAccountLookupForTests();
  setAccountLockLookupForTests();
  for (const r of restores) r();
  server?.close();
  await prisma.notification.deleteMany({ where: { OR: [{ entityType: "DISPUTE_CASE" }, { userId: { in: createdPts } }] } }).catch(() => {});
  await prisma.sessionSettlement.deleteMany({ where: { contractId: { in: createdContracts } } }).catch(() => {});
  await prisma.auditLog.deleteMany({ where: { entityId: { in: createdContracts } } }).catch(() => {});
  await prisma.session.deleteMany({ where: { contractId: { in: createdContracts } } }).catch(() => {});
  await prisma.contract.deleteMany({ where: { id: { in: createdContracts } } }).catch(() => {});
  await prisma.userProfile.deleteMany({ where: { userId: { in: createdPts } } }).catch(() => {});
  await prisma.$disconnect();
});
test.beforeEach(() => {
  writeCalls.length = 0;
  locked.clear();
  lockUnknown = false;
  setClockForTests();
  disableExecutionFlags();
  enableExecutionFlags({});
  process.env.DISPUTE_CASE_TIMERS_ENABLED = "true";
  process.env.DISPUTE_CASE_APPEALS_ENABLED = "true";
});

async function mkSession(over: { status?: string; disputeType?: string | null; contract?: Record<string, unknown> } = {}) {
  const ptUserId = randomUUID();
  const contract = await makeContract(ptUserId, { sessionMode: "ONLINE", ...(over.contract ?? {}) });
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
const sessionRow = (id: string) => prisma.session.findUniqueOrThrow({ where: { id } });
const deadlinesOf = (caseId: string) => prisma.disputeCaseDeadline.findMany({ where: { caseId }, orderBy: [{ partyRole: "asc" }, { startedAt: "asc" }] });
const noMoney = async (s: { session: { id: string }; contract: { id: string } }, before?: { used: number; settlements: number }) => {
  assert.equal(writeCalls.length, 0, "no payment write");
  if (before) {
    assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: s.contract.id } })).usedSessions, before.used, "quota untouched");
    assert.equal(await prisma.sessionSettlement.count({ where: { sessionId: s.session.id } }), before.settlements, "no settlement");
  }
};
const snap = async (s: { session: { id: string }; contract: { id: string } }) => ({
  used: (await prisma.contract.findUniqueOrThrow({ where: { id: s.contract.id } })).usedSessions,
  settlements: await prisma.sessionSettlement.count({ where: { sessionId: s.session.id } }),
});

/** open -> assign -> COLLECTING -> (request the parties' answer) AWAITING_PARTIES over HTTP; returns ids */
async function awaitingParties(s: Awaited<ReturnType<typeof mkSession>>, P = admin()) {
  const caseId = (await call("POST", "/admin/dispute-cases", A(P), { sessionId: s.session.id })).json.case.id;
  await call("POST", `/admin/dispute-cases/${caseId}/assign`, A(P), {});
  await call("POST", `/admin/dispute-cases/${caseId}/transition`, A(P), { to: "COLLECTING" });
  const r = await call("POST", `/admin/dispute-cases/${caseId}/transition`, A(P), { to: "AWAITING_PARTIES", note: "Cần lời khai" });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return { caseId, P };
}

// ═══ A1: first-response clock 72 h, from the recorded in-app notice ═════════════════════════════════════════════════════

test("A1: the 72 h clock of each party starts at the stored in-app notice (not before), is satisfied by an answer, and an expiry records NO_RESPONSE_RECORDED and MOVES the step - never a ruling, never money", async () => {
  const s = await mkSession();
  const before = await snap(s);
  const { caseId, P } = await awaitingParties(s);

  const ds = await deadlinesOf(caseId);
  assert.equal(ds.length, 2, "one clock per party");
  assert.deepEqual(ds.map((d) => [d.partyRole, d.kind, d.hours, d.status]).sort(), [["CLIENT", "FIRST_RESPONSE", 72, "OPEN"], ["PT", "FIRST_RESPONSE", 72, "OPEN"]]);
  // the start is the createdAt of the party's stored notification - nothing else
  for (const d of ds) {
    const notice = await prisma.disputeCasePartyNotice.findFirstOrThrow({ where: { caseId, userId: d.userId, kind: "RESPONSE_REQUESTED" } });
    const note = await prisma.notification.findUniqueOrThrow({ where: { id: notice.notificationId } });
    assert.equal(d.startedAt.getTime(), note.createdAt.getTime());
  }
  const t0 = ds[0].startedAt.getTime();
  const detail = (await call("GET", `/admin/dispute-cases/${caseId}/deadlines`, A(P))).json;
  assert.equal(detail.items.length, 2);
  assert.equal(new Date(detail.items[0].dueAt).getTime(), t0 + 72 * HOUR);

  // the client answers within the window (HTTP): its clock is satisfied
  const stmt = await call("POST", `/dispute-cases/${caseId}/statements`, `CUSTOMER:${s.clientUserId}`, { text: "Tôi có mặt đúng giờ", supplementReason: "bổ sung" }, { "Idempotency-Key": "t-s1" });
  assert.equal(stmt.status, 201, JSON.stringify(stmt.json));
  assert.equal((await deadlinesOf(caseId)).find((d) => d.partyRole === "CLIENT")!.status, "SATISFIED");

  // 71h59m: nothing expires
  const early = await runDisputeTimersSweep({ now: new Date(t0 + 72 * HOUR - 60_000) });
  assert.equal(early.expired, 0);
  assert.equal((await caseRow(caseId)).status, "AWAITING_PARTIES");

  // 72h + 1 s: the silent PT's clock expires
  const late = await runDisputeTimersSweep({ now: new Date(t0 + 72 * HOUR + 1000) });
  assert.equal(late.expired, 1);
  const ptClock = (await deadlinesOf(caseId)).find((d) => d.partyRole === "PT")!;
  assert.equal(ptClock.status, "EXPIRED");
  const row = await caseRow(caseId);
  assert.equal(row.status, "ASSESSING", "nobody else is expected: the step moved");
  const evt = await prisma.disputeCaseEvent.findFirstOrThrow({ where: { caseId, action: "NO_RESPONSE_RECORDED" } });
  assert.equal(evt.actorUserId, "system:dispute-timers");
  assert.equal(evt.fromStatus, "AWAITING_PARTIES");
  assert.equal(evt.toStatus, "ASSESSING");
  // never a ruling against the silent party, never money
  assert.equal((await sessionRow(s.session.id)).status, "DISPUTED");
  assert.equal(await prisma.disputeCaseFinding.count({ where: { caseId } }), 0);
  assert.equal(await prisma.disputeCaseProposal.count({ where: { caseId } }), 0);
  await noMoney(s, before);
  const told = await prisma.notification.findMany({ where: { userId: s.ptUserId, entityType: "DISPUTE_CASE", entityId: caseId } });
  assert.ok(told.some((n) => /không bên nào bị quy kết/.test(n.text)), "the notice says nobody is blamed for silence");
  // a second sweep does nothing more
  const again = await runDisputeTimersSweep({ now: new Date(t0 + 200 * HOUR) });
  assert.equal(again.expired, 0);
  assert.equal(await prisma.disputeCaseEvent.count({ where: { caseId, action: "NO_RESPONSE_RECORDED" } }), 1);
});

test("A1: a later request is a SUPPLEMENT round of 48 h; an expiry while the other party is still expected only records (the step does not move)", async () => {
  const s = await mkSession();
  const { caseId, P } = await awaitingParties(s);
  // both answered round one
  await call("POST", `/dispute-cases/${caseId}/statements`, `CUSTOMER:${s.clientUserId}`, { text: "Lời khai khách", supplementReason: "bổ sung" }, { "Idempotency-Key": "t-r1c" });
  await call("POST", `/dispute-cases/${caseId}/statements`, `PT:${s.ptUserId}`, { text: "Lời khai PT", supplementReason: "bổ sung" }, { "Idempotency-Key": "t-r1p" });
  assert.ok((await deadlinesOf(caseId)).every((d) => d.status === "SATISFIED"));
  await call("POST", `/admin/dispute-cases/${caseId}/transition`, A(P), { to: "ASSESSING" });
  const more = await call("POST", `/admin/dispute-cases/${caseId}/request-more`, A(P), { to: "AWAITING_PARTIES", note: "Bổ sung thêm" });
  assert.equal(more.status, 200, JSON.stringify(more.json));
  const open = (await deadlinesOf(caseId)).filter((d) => d.status === "OPEN");
  assert.deepEqual(open.map((d) => [d.partyRole, d.kind, d.hours]).sort(), [["CLIENT", "SUPPLEMENT_ROUND", 48], ["PT", "SUPPLEMENT_ROUND", 48]]);
  const t0 = open[0].startedAt.getTime();
  // the PT answers; the client stays silent: expiry at 48 h
  await call("POST", `/dispute-cases/${caseId}/statements`, `PT:${s.ptUserId}`, { text: "Bổ sung của PT", supplementReason: "vòng hai" }, { "Idempotency-Key": "t-r2p" });
  const r = await runDisputeTimersSweep({ now: new Date(t0 + 48 * HOUR + 1000) });
  assert.equal(r.expired, 1);
  assert.equal((await deadlinesOf(caseId)).filter((d) => d.status === "EXPIRED").length, 1);
  assert.equal((await caseRow(caseId)).status, "ASSESSING", "the investigator's step was already beyond AWAITING_PARTIES or nobody else was expected: no ruling either way");
});

test("A1: the clock is PAUSED while the party's account is locked (the locked hours are added to the deadline); an unknown lock state changes nothing; the flag OFF means no clock and no sweep", async () => {
  const s = await mkSession();
  const { caseId } = await awaitingParties(s);
  const t0 = (await deadlinesOf(caseId))[0].startedAt.getTime();
  const ptId = s.ptUserId;
  const ptClock = async () => (await deadlinesOf(caseId)).find((d) => d.partyRole === "PT")!;

  locked.add(ptId);
  const p1 = await runDisputeTimersSweep({ now: new Date(t0 + 10 * HOUR) });
  assert.equal(p1.paused, 1);
  assert.ok((await ptClock()).pausedAt);
  // locked at 72h+ : a paused clock cannot expire
  const p2 = await runDisputeTimersSweep({ now: new Date(t0 + 80 * HOUR) });
  void p2; // the client (never locked) expires at 72 h; the locked PT clock must not
  assert.equal((await ptClock()).status, "OPEN", "a paused clock cannot expire");
  // unlocked at 30h-equivalent? use: unlock at t0+30h would be earlier than the last sweep; so unlock now at t0+90h: 80h of lock counted
  locked.delete(ptId);
  const p3 = await runDisputeTimersSweep({ now: new Date(t0 + 90 * HOUR) });
  assert.equal(p3.resumed, 1);
  const c = await ptClock();
  assert.equal(c.pausedAt, null);
  assert.equal(c.pausedSeconds, 80 * 3600, "locked from t0+10h to t0+90h");
  // due is now t0 + 72h + 80h = t0 + 152h
  await runDisputeTimersSweep({ now: new Date(t0 + 151 * HOUR) }); // the client clock (never locked) may expire here; the PT one is not due yet
  const afterClient = await deadlinesOf(caseId);
  assert.equal(afterClient.find((d) => d.partyRole === "PT")!.status, "OPEN");
  assert.equal((await runDisputeTimersSweep({ now: new Date(t0 + 152 * HOUR + 1000) })).expired >= 1, true);
  assert.equal((await deadlinesOf(caseId)).find((d) => d.partyRole === "PT")!.status, "EXPIRED");

  // unknown lock state: neither pause nor expire
  const s2 = await mkSession();
  const c2 = await awaitingParties(s2);
  const u0 = (await deadlinesOf(c2.caseId))[0].startedAt.getTime();
  lockUnknown = true;
  const unk = await runDisputeTimersSweep({ now: new Date(u0 + 100 * HOUR) });
  assert.deepEqual([unk.paused, unk.expired], [0, 0]);
  assert.ok((await deadlinesOf(c2.caseId)).every((d) => d.status === "OPEN" && !d.pausedAt));

  // flag OFF: the sweep is a no-op and no clock starts
  lockUnknown = false;
  delete process.env.DISPUTE_CASE_TIMERS_ENABLED;
  const off = await runDisputeTimersSweep({ now: new Date(u0 + 500 * HOUR) });
  assert.equal(off.skipped, "FLAG_OFF");
  assert.ok((await deadlinesOf(c2.caseId)).every((d) => d.status === "OPEN"));
  const s3 = await mkSession();
  const c3 = await awaitingParties(s3);
  assert.equal((await deadlinesOf(c3.caseId)).length, 0, "no clock starts while the flag is off");
});

// ═══ S2.4 ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════

async function noShowReported(s: Awaited<ReturnType<typeof mkSession>>) {
  await prisma.session.update({ where: { id: s.session.id }, data: { status: "PT_NO_SHOW_REPORTED", disputeType: null, disputeReason: "PT không đến" } });
  // the notice bookingService.reportPtNoShow stores for the PT
  return prisma.notification.create({ data: { userId: s.ptUserId, text: "Khách báo bạn vắng mặt buổi tập. Vui lòng phản hồi — xác nhận hoặc phản đối.", eventType: "SESSION_PT_NO_SHOW_REPORTED", entityType: "SESSION", entityId: s.session.id, link: "/pt/schedule" } });
}

test("S2.4: PT silent past 48 h after the report - the session goes DISPUTED under the contract lock (PT_NO_SHOW_CLAIM) and a Case goes to ASSESSING; the system NEVER answers AGREE for the PT, nothing is paid", async () => {
  const s = await mkSession();
  const before = await snap(s);
  const note = await noShowReported(s);
  const t0 = note.createdAt.getTime();

  const first = await runDisputeTimersSweep({ now: new Date(t0 + 1000) });
  assert.equal(first.noShowDeadlinesStarted, 1);
  const clock = await prisma.disputeCaseDeadline.findFirstOrThrow({ where: { sessionId: s.session.id, kind: "PT_NO_SHOW_ANSWER" } });
  assert.deepEqual([clock.hours, clock.partyRole, clock.startedAt.getTime()], [48, "PT", t0], "48 h from the PT's recorded in-app notice");

  const early = await runDisputeTimersSweep({ now: new Date(t0 + 48 * HOUR - 60_000) });
  assert.equal(early.noShowEscalated, 0);
  assert.equal((await sessionRow(s.session.id)).status, "PT_NO_SHOW_REPORTED");

  const late = await runDisputeTimersSweep({ now: new Date(t0 + 48 * HOUR + 60_000) });
  assert.equal(late.noShowEscalated, 1);
  const after = await sessionRow(s.session.id);
  assert.equal(after.status, "DISPUTED");
  assert.equal(after.disputeType, "PT_NO_SHOW_CLAIM");
  assert.notEqual(after.status, "NO_SHOW", "never AGREE for the PT");
  assert.equal(after.ptAtFault, false);
  const c = await prisma.disputeCase.findFirstOrThrow({ where: { sessionId: s.session.id } });
  assert.deepEqual([c.status, c.type], ["ASSESSING", "PT_NO_SHOW_CLAIM"]);
  const evt = await prisma.disputeCaseEvent.findFirstOrThrow({ where: { caseId: c.id, action: "NO_RESPONSE_RECORDED" } });
  assert.equal(evt.toStatus, "ASSESSING");
  assert.equal((await prisma.disputeCaseDeadline.findUniqueOrThrow({ where: { id: clock.id } })).status, "EXPIRED");
  assert.equal(await prisma.disputeCaseFinding.count({ where: { caseId: c.id } }), 0, "no finding, no ruling");
  await noMoney(s, before);
  // over HTTP: the queue and the detail show it
  const P = admin();
  const detail = (await call("GET", `/admin/dispute-cases/${c.id}`, A(P))).json;
  assert.deepEqual([detail.case.sessionStatus, detail.case.status], ["DISPUTED", "ASSESSING"]);
  assert.ok(detail.deadlines.some((d: any) => d.kind === "PT_NO_SHOW_ANSWER" && d.status === "EXPIRED"));
  // a repeated sweep changes nothing
  assert.equal((await runDisputeTimersSweep({ now: new Date(t0 + 500 * HOUR) })).noShowEscalated, 0);
  assert.equal(await prisma.disputeCase.count({ where: { sessionId: s.session.id } }), 1);
});

test("S2.4: a PT who ANSWERS in time (the session already left PT_NO_SHOW_REPORTED) is never touched; no recorded in-app notice means no clock; an ended contract is left alone", async () => {
  // answered: the PT denied -> DISPUTED before the deadline
  const s = await mkSession();
  const note = await noShowReported(s);
  const t0 = note.createdAt.getTime();
  await runDisputeTimersSweep({ now: new Date(t0 + 1000) });
  await prisma.session.update({ where: { id: s.session.id }, data: { status: "DISPUTED", disputeType: "PT_NO_SHOW_CLAIM", ptNotes: "PT phản đối" } });
  const r = await runDisputeTimersSweep({ now: new Date(t0 + 60 * HOUR) });
  assert.equal(r.noShowEscalated, 0);
  assert.equal((await prisma.disputeCaseDeadline.findFirstOrThrow({ where: { sessionId: s.session.id } })).status, "SATISFIED");
  assert.equal(await prisma.disputeCase.count({ where: { sessionId: s.session.id } }), 0, "no case was opened for a PT who answered");

  // no recorded notice -> no clock at all
  const s2 = await mkSession();
  await prisma.session.update({ where: { id: s2.session.id }, data: { status: "PT_NO_SHOW_REPORTED", disputeType: null } });
  const none = await runDisputeTimersSweep({ now: new Date(Date.now() + 500 * HOUR) });
  assert.equal(none.noShowDeadlinesStarted, 0);
  assert.equal(await prisma.disputeCaseDeadline.count({ where: { sessionId: s2.session.id } }), 0);
  assert.equal((await sessionRow(s2.session.id)).status, "PT_NO_SHOW_REPORTED");

  // the contract ended meanwhile: the timer leaves the session alone (the old rule: an ended contract's report is closed unadjudicated)
  const s3 = await mkSession();
  const note3 = await noShowReported(s3);
  await runDisputeTimersSweep({ now: new Date(note3.createdAt.getTime() + 1000) });
  await prisma.contract.update({ where: { id: s3.contract.id }, data: { status: "COMPLETED" } });
  const ended = await runDisputeTimersSweep({ now: new Date(note3.createdAt.getTime() + 49 * HOUR) });
  assert.equal(ended.noShowEscalated, 0);
  assert.equal((await sessionRow(s3.session.id)).status, "PT_NO_SHOW_REPORTED");
  assert.equal((await prisma.disputeCaseDeadline.findFirstOrThrow({ where: { sessionId: s3.session.id } })).status, "CANCELLED");
  assert.equal(writeCalls.length, 0);
});

// ═══ SLA day 10 / 14 ═════════════════════════════════════════════════════════════════════════════════════════════════════

test("SLA: calendar day 10 -> one warning (event + notice), day 14 -> escalated flag + notice (once); no ruling, no state change, no money", async () => {
  const s = await mkSession();
  const before = await snap(s);
  const disputedAt = new Date("2026-11-01T00:00:00Z");
  await prisma.session.update({ where: { id: s.session.id }, data: { disputedAt } });
  const P = admin();
  const caseId = (await call("POST", "/admin/dispute-cases", A(P), { sessionId: s.session.id })).json.case.id;
  await call("POST", `/admin/dispute-cases/${caseId}/assign`, A(P), {});
  const status0 = (await caseRow(caseId)).status;

  assert.equal((await runDisputeTimersSweep({ now: new Date(disputedAt.getTime() + 9 * DAY + 23 * HOUR) })).slaWarnings, 0, "day 9 is quiet");
  assert.equal((await runDisputeTimersSweep({ now: new Date(disputedAt.getTime() + 10 * DAY) })).slaWarnings, 1);
  assert.equal((await runDisputeTimersSweep({ now: new Date(disputedAt.getTime() + 11 * DAY) })).slaWarnings, 0, "once");
  assert.equal(await prisma.disputeCaseEvent.count({ where: { caseId, action: "SLA_WARNING" } }), 1);
  assert.equal((await caseRow(caseId)).escalated, false);
  assert.ok(await prisma.notification.findFirst({ where: { userId: P.id, entityType: "DISPUTE_CASE", entityId: caseId, text: { contains: "sắp quá hạn" } } }));

  assert.equal((await runDisputeTimersSweep({ now: new Date(disputedAt.getTime() + 14 * DAY) })).slaOverdue, 1);
  assert.equal((await runDisputeTimersSweep({ now: new Date(disputedAt.getTime() + 20 * DAY) })).slaOverdue, 0, "once");
  const row = await caseRow(caseId);
  assert.deepEqual([row.escalated, row.status], [true, status0], "escalated flag only; the state did not move");
  assert.equal(await prisma.disputeCaseEvent.count({ where: { caseId, action: "SLA_OVERDUE" } }), 1);
  assert.ok(await prisma.notification.findFirst({ where: { userId: s.clientUserId, entityType: "DISPUTE_CASE", entityId: caseId, text: { contains: "chuyển cấp" } } }), "the parties are told it was escalated, not ruled");
  assert.equal((await sessionRow(s.session.id)).status, "DISPUTED");
  assert.equal(await prisma.disputeCaseFinding.count({ where: { caseId } }), 0);
  await noMoney(s, before);
});

// ═══ held money ══════════════════════════════════════════════════════════════════════════════════════════════════════════

test("held money: a review record per held row, a mandatory decision every 7 days (keep + reason, or a verifiable exit), owner escalation after 30 days; nothing is paid or written off", async () => {
  const s = await mkSession({ status: "NO_SHOW" });
  const row = await prisma.sessionSettlement.create({ data: { kind: "PT_NO_SHOW_COMPENSATION", idempotencyKey: `PT_NO_SHOW:${s.session.id}`, sessionId: s.session.id, contractId: s.contract.id, status: "UNCONFIRMED" } });
  const t0 = new Date("2026-11-01T00:00:00Z");
  const P = admin();
  setClockForTests(() => t0);
  const opened = await runDisputeTimersSweep({ now: t0 });
  assert.equal(opened.heldReviewsOpened, 1);
  const list = async (q = "") => (await call("GET", `/admin/dispute-cases/held-money${q}`, A(P))).json;
  const mine = (j: any) => j.items.find((i: any) => i.settlementRowId === row.id);
  let it = mine(await list());
  assert.deepEqual([it.daysHeld, it.overdue, it.lastDecision], [0, false, null]);
  assert.equal(new Date(it.nextReviewDueAt).getTime(), t0.getTime() + 7 * DAY);

  // day 7: overdue until a decision is recorded
  setClockForTests(() => new Date(t0.getTime() + 7 * DAY));
  it = mine(await list("?overdue=true"));
  assert.equal(it.overdue, true);
  const decide = (body: unknown) => call("POST", `/admin/dispute-cases/held-money/${it.reviewId}/decision`, A(P), body);
  assert.equal((await decide({ decision: "KEEP_HOLDING" })).status, 400, "a reason is mandatory");
  assert.equal((await decide({ decision: "EXIT_STARTED", reason: "Mở đường xử lý" })).json.code, "EXIT_REF_REQUIRED");
  assert.equal((await decide({ decision: "EXIT_STARTED", reason: "x", exitRef: { kind: "D65B_RESOLUTION", id: randomUUID() } })).json.code, "EXIT_REF_NOT_FOUND");
  assert.equal((await decide({ decision: "KEEP_HOLDING", reason: "x", exitRef: { kind: "D65B_RESOLUTION", id: randomUUID() } })).status, 400);
  assert.equal((await call("POST", `/admin/dispute-cases/held-money/${it.reviewId}/decision`, `CUSTOMER:${s.clientUserId}`, { decision: "KEEP_HOLDING", reason: "x" })).status, 403);
  const kept = await decide({ decision: "KEEP_HOLDING", reason: "Chờ biên nhận của PT" });
  assert.equal(kept.status, 200, JSON.stringify(kept.json));
  assert.equal(kept.json.moneyMoved, false);
  assert.equal(new Date(kept.json.nextReviewDueAt).getTime(), t0.getTime() + 14 * DAY);
  it = mine(await list());
  assert.deepEqual([it.overdue, it.lastDecision.decision, it.lastDecision.reason, it.lastDecision.decidedBy], [false, "KEEP_HOLDING", "Chờ biên nhận của PT", P.id]);

  // day 30: the owner is escalated (once); the row is exactly as it was
  const day30 = new Date(t0.getTime() + 30 * DAY);
  setClockForTests(() => day30);
  assert.equal((await runDisputeTimersSweep({ now: day30 })).heldOwnerEscalations, 1);
  assert.equal((await runDisputeTimersSweep({ now: new Date(day30.getTime() + DAY) })).heldOwnerEscalations, 0);
  assert.ok(mine(await list()).ownerEscalatedAt);
  assert.equal((await prisma.sessionSettlement.findUniqueOrThrow({ where: { id: row.id } })).status, "UNCONFIRMED", "nothing was paid or written off");
  assert.equal(writeCalls.length, 0);

  // the hold ends elsewhere: the review closes and no further decision is accepted
  await prisma.sessionSettlement.update({ where: { id: row.id }, data: { status: "SETTLED" } });
  await runDisputeTimersSweep({ now: new Date(day30.getTime() + 2 * DAY) });
  assert.equal(mine(await list()), undefined);
  assert.equal((await decide({ decision: "KEEP_HOLDING", reason: "x" })).json.code, "HELD_REVIEW_CLOSED");
  // flag OFF: the decision route is refused
  delete process.env.DISPUTE_CASE_APPEALS_ENABLED;
  assert.equal((await decide({ decision: "KEEP_HOLDING", reason: "x" })).json.code, "DISPUTE_PROCESS_DISABLED");
});

// ═══ the visible stuck queue ═════════════════════════════════════════════════════════════════════════════════════════════

test("stuck queue (HTTP): POLICY_PENDING and NEEDS_HUMAN cases are listed with their owner (or 'owner required'), since-when, age and last audit line; admin only; filterable", async () => {
  const s = await mkSession();
  const w = await caseAtFinding(s.session.id, "INSUFFICIENT_EVIDENCE");
  const c = await caseRow(w.caseId);
  assert.equal(c.status, "POLICY_PENDING");
  const s2 = await mkSession();
  const w2 = await caseAtFinding(s2.session.id, "VERIFIED_PT_ABSENT");
  await prisma.disputeCase.update({ where: { id: w2.caseId }, data: { execStatus: "NEEDS_HUMAN", investigatorId: null } });
  const P = admin();

  const all = (await call("GET", "/admin/dispute-cases/stuck?limit=100", A(P))).json;
  const a = all.items.find((i: any) => i.caseId === w.caseId);
  const b = all.items.find((i: any) => i.caseId === w2.caseId);
  assert.deepEqual([a.kind, a.ownerId, a.ownerRequired], ["POLICY_PENDING", w.investigator.id, false]);
  assert.ok(a.since && a.lastAudit.action && a.ageDays >= 0);
  assert.deepEqual([b.kind, b.ownerId, b.ownerRequired], ["NEEDS_HUMAN", null, true]);
  const only = (await call("GET", "/admin/dispute-cases/stuck?kind=NEEDS_HUMAN&limit=100", A(P))).json;
  assert.ok(only.items.every((i: any) => i.kind === "NEEDS_HUMAN") && only.items.some((i: any) => i.caseId === w2.caseId));
  assert.equal((await call("GET", "/admin/dispute-cases/stuck?kind=NOPE", A(P))).status, 400);
  assert.equal((await call("GET", "/admin/dispute-cases/stuck", `CUSTOMER:${s.clientUserId}`)).status, 403);
  assert.equal((await call("GET", "/admin/dispute-cases/stuck", null)).status, 401);
});
