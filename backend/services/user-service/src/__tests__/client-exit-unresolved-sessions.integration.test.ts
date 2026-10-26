/**
 * PT-suspension slice 4 (bổ sung 11/10, A + B + D) - what happens to the sessions that are NOT called off when a
 * client leaves a restricted PT's contract (awaiting confirmation / disputed), the "accepted request keeps its
 * terms" rule, preview == execution, and notices that survive a crash.
 *
 * Evidence labels: BACKEND INTEGRATION - the real user-service Express app runs on a random port and is called
 * over HTTP (terminate, money-breakdown) or the real services are called directly (confirm / dispute ruling /
 * auto-confirm / sweep), all against the isolated gymcoach_user_test database. TEST FIXTURE - payment-service is
 * NOT running: paymentClient.terminate / resolveUnresolvedSession / moneyBreakdown are replaced at the client
 * boundary by a fake ledger that keeps ONE result per idempotency key (as payment-service's idempotent ledger
 * ops do - CODE AUDIT of contract-ledger.service.ts), and every body user-service SENDS is asserted exactly.
 * The real payment-service ledger is not exercised here. auth-service is replaced by a token table. Run with:
 *   DATABASE_URL="postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_user_test?schema=public" \
 *     ./node_modules/.bin/tsx --test src/__tests__/client-exit-unresolved-sessions.integration.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { prisma } from "../repositories/profile.repository";
import { authServiceClient } from "../clients/auth-service.client";
import { paymentClient } from "../clients/payment.client";
import { sessionSettlementRepository } from "../repositories/session-settlement.repository";
import { ptRestrictionService } from "../services/pt-restriction.service";
import { terminateAsClient } from "../services/client-exit.service";
import { bookingService } from "../services/booking.service";
import { notificationService } from "../services/notification.service";
import { runSettlementSweep } from "../services/session-settlement-sweep.service";
import { runAutoConfirm } from "../services/session-autoconfirm.service";
import { DAY, HOUR, addSession, cleanup, makeContract, makePt, patch, skip, stubs } from "./pt-restriction.test-helpers";

const EXIT = "CLIENT_EXIT_DUE_TO_PT_RESTRICTION";
const ADMIN = "admin-1";

const identities = new Map<string, { id: string; email: string; role: string }>();
function tokenFor(id: string, role = "CUSTOMER"): string {
  const token = `tok-${id}`;
  identities.set(token, { id, email: `${id}@test.local`, role });
  return token;
}

let server: http.Server;
let base = "";
let restoreAuth: () => void = () => {};

test.before(async () => {
  restoreAuth = patch(authServiceClient, "verifyToken", async (header: string) => {
    const user = identities.get(String(header).replace(/^Bearer /, ""));
    if (!user) throw Object.assign(new Error("bad token"), { response: { status: 401, data: { error: "Invalid or expired token" } } });
    return { status: 200, data: { user } };
  });
  const { default: app } = await import("../app");
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as any).port}`;
});

test.after(async () => {
  restoreAuth();
  (server as any).closeAllConnections?.();
  await new Promise((r) => server.close(r));
  await prisma.$disconnect();
});

async function call(method: string, path: string, token: string | null, body?: unknown) {
  const res = await fetch(base + path, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, body: json };
}

/** A fake payment-service ledger: terminate, resolve-unresolved-session and money-breakdown. One result per key. */
function fakeLedger(opts: { failTerminate?: number; failResolve?: number } = {}) {
  const terminateCalls: any[] = [];
  const resolveCalls: any[] = [];
  const breakdownCalls: any[] = [];
  const applied = new Map<string, any>();
  const resolved = new Map<string, any>();
  let terminateFailures = opts.failTerminate ?? 0;
  let resolveFailures = opts.failResolve ?? 0;
  const restores = [
    patch(paymentClient, "terminate", async (body: any) => {
      terminateCalls.push(body);
      if (terminateFailures > 0) {
        terminateFailures--;
        throw new Error("payment-service unavailable");
      }
      if (!applied.has(body.idempotencyKey)) {
        applied.set(body.idempotencyKey, {
          refund: body.reason === "CLIENT_CANCELLED" ? "4500000.00" : "5000000.00",
          reason: body.reason,
          ...(body.unresolvedSessions ? { unresolved: { sessions: body.unresolvedSessions, amountHeld: String(body.unresolvedSessions * 500000) } } : {}),
        });
      }
      return applied.get(body.idempotencyKey);
    }),
    patch(paymentClient, "resolveUnresolvedSession", async (body: any) => {
      resolveCalls.push(body);
      if (resolveFailures > 0) {
        resolveFailures--;
        throw new Error("payment-service unavailable");
      }
      if (!resolved.has(body.idempotencyKey)) {
        resolved.set(body.idempotencyKey, {
          outcome: body.outcome,
          unit: "500000.00",
          moved: body.outcome === "DELIVERED" ? { pt: "450000.00", gym: "0.00", platform: "50000.00" } : { client: "500000.00" },
        });
      }
      return resolved.get(body.idempotencyKey);
    }),
    patch(paymentClient, "moneyBreakdown", async (body: any) => {
      breakdownCalls.push(body);
      return {
        remaining: "5000000.00",
        refundIfCancelledNow: body.reason === "CLIENT_CANCELLED" ? "4500000.00" : "5000000.00",
        reasonUsed: body.reason ?? "CLIENT_CANCELLED",
        unresolvedAmountHeld: String((body.unresolvedSessions ?? 0) * 500000),
      };
    }),
  ];
  return { terminateCalls, resolveCalls, breakdownCalls, applied, resolved, restore: () => restores.reverse().forEach((r) => r()) };
}

const suspendInput = (ptUserId: string, at?: Date) => ({
  ptUserId,
  adminId: ADMIN,
  reasonCategory: "COMPLAINT_REVIEW" as const,
  reasonText: "Khiếu nại đang được xem xét",
  publicReason: "Đang xem xét một phản ánh",
  at,
});

/** The exact body user-service sends payment-service to terminate a contract with `used` finished sessions. */
function expectedTerminateBody(c: Awaited<ReturnType<typeof makeContract>>, reason: string, used: number, unresolved?: number) {
  return {
    transactionId: c.paymentTransactionId,
    price: c.price!.toString(),
    totalSessions: c.totalSessions,
    usedSessions: used,
    compensatedSessions: 0,
    rates: { platformRate: c.platformRate.toString(), ptRate: c.ptRate.toString(), gymRate: c.gymRate.toString() },
    reason,
    alreadyReleased: { pt: "0", gym: "0", platform: "0" },
    parties: { ptUserId: c.ptUserId, gymId: c.gymId, clientUserId: c.clientUserId },
    label: `Contract ${c.id} termination`,
    idempotencyKey: `CONTRACT_TERMINATE:${c.id}`,
    ...(unresolved ? { unresolvedSessions: unresolved } : {}),
  };
}

function expectedResolveBody(c: Awaited<ReturnType<typeof makeContract>>, sessionId: string, outcome: "DELIVERED" | "NOT_DELIVERED") {
  return {
    transactionId: c.paymentTransactionId,
    price: c.price!.toString(),
    totalSessions: c.totalSessions,
    rates: { platformRate: c.platformRate.toString(), ptRate: c.ptRate.toString(), gymRate: c.gymRate.toString() },
    parties: { ptUserId: c.ptUserId, gymId: c.gymId, clientUserId: c.clientUserId },
    label: `Contract ${c.id} unresolved session ${sessionId}`,
    idempotencyKey: `UNRESOLVED_SESSION:${sessionId}`,
    outcome,
  };
}

/** 4 used, 1 awaiting confirmation, 1 disputed, 4 not yet happened - on a 10-session contract. */
async function scenario() {
  const T = Date.now();
  const pt = await makePt();
  const c = await makeContract(pt, { usedSessions: 4 });
  const ids = {
    used: [] as string[],
    pending: (await addSession(c, "PENDING_CLIENT_CONFIRMATION", new Date(T - 1 * DAY), { clientConfirmDeadline: new Date(T + 2 * DAY) })).id,
    disputed: (await addSession(c, "DISPUTED", new Date(T - 2 * DAY), { disputeReason: "x", disputedAt: new Date(T - DAY), disputeType: "DELIVERY_DISPUTE" })).id,
    future: [] as string[],
  };
  for (let i = 0; i < 4; i++) ids.used.push((await addSession(c, "COMPLETED", new Date(T - (10 + i) * DAY), { sessionDeducted: true })).id);
  ids.future.push((await addSession(c, "CONFIRMED", new Date(T + 1 * DAY))).id);
  ids.future.push((await addSession(c, "CONFIRMED", new Date(T + 2 * DAY))).id);
  ids.future.push((await addSession(c, "REQUESTED", new Date(T + 3 * DAY))).id);
  ids.future.push((await addSession(c, "REQUESTED", new Date(T + 4 * DAY))).id);
  const all = () => [ids.pending, ids.disputed, ...ids.used, ...ids.future];
  return { pt, c, ids, all, tok: tokenFor(c.clientUserId) };
}

async function scrubAudit(sessionIds: string[]) {
  await prisma.auditLog.deleteMany({ where: { entityId: { in: sessionIds } } }).catch(() => {});
}

const statusOf = async (id: string) => (await prisma.session.findUniqueOrThrow({ where: { id } })).status;
const used = async (contractId: string) => (await prisma.contract.findUniqueOrThrow({ where: { id: contractId } })).usedSessions;

// ── (1) the exit itself ───────────────────────────────────────────────────────────────────────

test("exit with 4 used, 1 awaiting confirmation, 1 disputed, 4 future: neutral reason, used 4, 2 sessions held with NO amount in the body; the two keep their state, the four future are called off; the PT is told once", { skip }, async () => {
  const { pt, c, ids, all, tok } = await scenario();
  const s = stubs(undefined, { realNotifications: true });
  const ledger = fakeLedger();
  try {
    await ptRestrictionService.suspend(suspendInput(pt));
    const res = await call("POST", `/contracts/${c.id}/terminate`, tok, { reason: "CLIENT_CANCELLED" });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.reason, EXIT);
    assert.equal(res.body.unresolvedSessions, 2);

    assert.deepEqual(ledger.terminateCalls, [expectedTerminateBody(c, EXIT, 4, 2)], "exact terminate body: neutral reason, used 4, unresolvedSessions 2");
    const sent = ledger.terminateCalls[0];
    assert.ok(!("amount" in sent) && !("refund" in sent) && !("fee" in sent), "no amount");
    assert.equal(ledger.resolveCalls.length, 0, "nothing is resolved by the exit itself");

    assert.equal(await statusOf(ids.pending), "PENDING_CLIENT_CONFIRMATION");
    assert.equal(await statusOf(ids.disputed), "DISPUTED");
    for (const f of ids.future) assert.equal(await statusOf(f), "CANCELLED");
    const after = await prisma.contract.findUniqueOrThrow({ where: { id: c.id } });
    assert.equal(after.status, "CANCELLED");
    assert.equal(after.terminationReason, EXIT);
    assert.equal(after.usedSessions, 4);
    assert.ok(after.clientExitAcceptedAt, "acceptance recorded");

    // the PT is told, once, with an existing type and neutral wording - and the row is really stored
    const rows = await prisma.notification.findMany({ where: { userId: pt, entityId: c.id, eventType: "CONTRACT_CANCELLED" } });
    assert.equal(rows.length, 1);
    assert.match(rows[0].text, /2 buổi đang chờ khách xác nhận hoặc phân xử/);
    assert.doesNotMatch(rows[0].text, /khiếu nại|phản ánh|vi phạm|sai phạm|lỗi/i);
    assert.equal(s.pushed.length >= 1, true, "and pushed after commit");

    // a repeat changes nothing and tells nobody again
    const again = await call("POST", `/contracts/${c.id}/terminate`, tok, { reason: "CLIENT_CANCELLED" });
    assert.equal(again.status, 200);
    assert.equal(again.body.alreadyTerminated, true);
    assert.equal(ledger.applied.size, 1);
    assert.equal(await prisma.notification.count({ where: { userId: pt, entityId: c.id, eventType: "CONTRACT_CANCELLED" } }), 1);
  } finally {
    ledger.restore();
    s.restore();
    await scrubAudit(all());
    await prisma.notification.deleteMany({ where: { userId: pt } }).catch(() => {});
    await cleanup([pt], [c.id]);
  }
});

// ── (2) post-exit resolution paths ────────────────────────────────────────────────────────────

test("after the exit: the client confirms the awaiting session -> ONE DELIVERED resolution and used 5; an admin rules the disputed one NOT delivered -> ONE NOT_DELIVERED resolution and used stays 5; repeats do nothing", { skip }, async () => {
  const { pt, c, ids, all } = await scenario();
  const s = stubs();
  const ledger = fakeLedger();
  try {
    await ptRestrictionService.suspend(suspendInput(pt));
    await terminateAsClient(c.id, c.clientUserId);

    // the client can still confirm while the PT is restricted
    const confirmed: any = await bookingService.clientConfirmSession(ids.pending, c.clientUserId);
    assert.equal(confirmed.quotaDeducted, true);
    assert.equal(await statusOf(ids.pending), "COMPLETED");
    assert.equal(await used(c.id), 5, "DELIVERED counts");
    assert.deepEqual(ledger.resolveCalls, [expectedResolveBody(c, ids.pending, "DELIVERED")]);
    assert.equal(s.payments.filter((p) => p.method === "releaseSession").length, 0, "no ordinary release on an exit-ended contract");
    const afterDelivered = await prisma.contract.findUniqueOrThrow({ where: { id: c.id } });
    assert.equal(afterDelivered.releasedToPt.toString(), "450000", "what the ledger really released is tracked");
    assert.equal(afterDelivered.status, "CANCELLED", "the contract stays ended");
    assert.equal(afterDelivered.terminationReason, EXIT);

    await assert.rejects(() => bookingService.clientConfirmSession(ids.pending, c.clientUserId), /Không thể xác nhận buổi tập/);

    await bookingService.resolveDispute(ids.disputed, ADMIN, "CANCELLED", "không dạy");
    assert.equal(await statusOf(ids.disputed), "CANCELLED");
    assert.equal(await used(c.id), 5, "NOT_DELIVERED does not count");
    assert.equal(ledger.resolveCalls.length, 2);
    assert.deepEqual(ledger.resolveCalls[1], expectedResolveBody(c, ids.disputed, "NOT_DELIVERED"));
    await assert.rejects(() => bookingService.resolveDispute(ids.disputed, ADMIN, "COMPLETED", "lại"), /không ở trạng thái đang khiếu nại/);

    assert.equal(ledger.resolved.size, 2, "exactly once per session");
    assert.equal(ledger.applied.size, 1, "and the termination was not repeated");
    const rows = await prisma.sessionSettlement.findMany({ where: { contractId: c.id, kind: "UNRESOLVED_SESSION_RESOLUTION" } });
    assert.deepEqual(rows.map((r) => `${r.reason}:${r.status}`).sort(), ["DELIVERED:SETTLED", "NOT_DELIVERED:SETTLED"]);
  } finally {
    ledger.restore();
    s.restore();
    await scrubAudit(all());
    await prisma.notification.deleteMany({ where: { userId: { in: [pt, c.clientUserId] } } }).catch(() => {});
    await cleanup([pt], [c.id]);
  }
});

test("admin rulings on a held disputed session: COMPLETED -> DELIVERED and used+1; PT_NO_SHOW_CONFIRMED -> NOT_DELIVERED (no separate no-show compensation), used unchanged, session NO_SHOW", { skip }, async () => {
  const a = await scenario();
  const b = await scenario();
  const s = stubs();
  const ledger = fakeLedger();
  try {
    for (const x of [a, b]) {
      await ptRestrictionService.suspend(suspendInput(x.pt)).catch(() => {});
      await terminateAsClient(x.c.id, x.c.clientUserId);
    }
    await bookingService.resolveDispute(a.ids.disputed, ADMIN, "COMPLETED", "đã dạy");
    assert.equal(await statusOf(a.ids.disputed), "COMPLETED");
    assert.equal(await used(a.c.id), 5);
    assert.deepEqual(ledger.resolveCalls.map((r) => `${r.idempotencyKey}:${r.outcome}`), [`UNRESOLVED_SESSION:${a.ids.disputed}:DELIVERED`]);

    await bookingService.resolveDispute(b.ids.disputed, ADMIN, "PT_NO_SHOW_CONFIRMED", "PT vắng");
    assert.equal(await statusOf(b.ids.disputed), "NO_SHOW");
    assert.equal(await used(b.c.id), 4);
    assert.equal(ledger.resolveCalls.length, 2);
    assert.equal(ledger.resolveCalls[1].outcome, "NOT_DELIVERED");
    assert.equal(s.payments.filter((p) => p.method === "noShow").length, 0, "the held value is refunded once - no second compensation");
    assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: b.c.id } })).compensatedSessions, 0);
  } finally {
    ledger.restore();
    s.restore();
    for (const x of [a, b]) {
      await scrubAudit(x.all());
      await prisma.notification.deleteMany({ where: { userId: { in: [x.pt, x.c.clientUserId] } } }).catch(() => {});
      await cleanup([x.pt], [x.c.id]);
    }
  }
});

test("concurrency: two simultaneous confirms of the held session, and two admins ruling the same disputed one two ways, produce exactly one resolution each", { skip }, async () => {
  const { pt, c, ids, all } = await scenario();
  const s = stubs();
  const ledger = fakeLedger();
  try {
    await ptRestrictionService.suspend(suspendInput(pt));
    await terminateAsClient(c.id, c.clientUserId);

    await Promise.allSettled([bookingService.clientConfirmSession(ids.pending, c.clientUserId), bookingService.clientConfirmSession(ids.pending, c.clientUserId)]);
    const rulings = await Promise.allSettled([
      bookingService.resolveDispute(ids.disputed, ADMIN, "COMPLETED", "a"),
      bookingService.resolveDispute(ids.disputed, "admin-2", "CANCELLED", "b"),
    ]);
    assert.equal(rulings.filter((r) => r.status === "fulfilled").length, 1, "only one ruling wins");

    for (const id of [ids.pending, ids.disputed]) {
      assert.equal(ledger.resolveCalls.filter((r) => r.idempotencyKey === `UNRESOLVED_SESSION:${id}`).length, 1, `session ${id} resolved once`);
    }
    const disputedRows = await prisma.sessionSettlement.findMany({ where: { sessionId: ids.disputed, kind: "UNRESOLVED_SESSION_RESOLUTION" } });
    assert.equal(disputedRows.length, 1);
    const finalStatus = await statusOf(ids.disputed);
    assert.equal(disputedRows[0].reason, finalStatus === "COMPLETED" ? "DELIVERED" : "NOT_DELIVERED", "the money matches the ruling that won");
    assert.equal(await used(c.id), finalStatus === "COMPLETED" ? 6 : 5);
  } finally {
    ledger.restore();
    s.restore();
    await scrubAudit(all());
    await prisma.notification.deleteMany({ where: { userId: { in: [pt, c.clientUserId] } } }).catch(() => {});
    await cleanup([pt], [c.id]);
  }
});

test("a failed resolution is recorded FAILED and retried by the settlement sweep with the same key - settled once, never twice", { skip }, async () => {
  const { pt, c, ids, all } = await scenario();
  const s = stubs();
  const ledger = fakeLedger({ failResolve: 1 });
  let restoreFind = () => {};
  try {
    await ptRestrictionService.suspend(suspendInput(pt));
    await terminateAsClient(c.id, c.clientUserId);
    await bookingService.clientConfirmSession(ids.pending, c.clientUserId);
    assert.equal(await statusOf(ids.pending), "COMPLETED", "the business status is not blocked by the money failure");
    assert.equal(await used(c.id), 5);

    const row = await prisma.sessionSettlement.findUniqueOrThrow({ where: { idempotencyKey: `UNRESOLVED_SESSION:${ids.pending}` } });
    assert.equal(row.status, "FAILED");
    assert.equal(row.kind, "UNRESOLVED_SESSION_RESOLUTION");
    assert.equal(row.reason, "DELIVERED");
    assert.equal(ledger.resolved.size, 0);

    // only this row, so the sweep does not touch other suites' rows in the shared test database
    restoreFind = patch(sessionSettlementRepository, "findRetryable", async () => [row]);
    const swept = await runSettlementSweep();
    assert.deepEqual(swept, { scanned: 1, retried: 1 });
    assert.equal(ledger.resolveCalls.length, 2);
    assert.deepEqual(ledger.resolveCalls[1], expectedResolveBody(c, ids.pending, "DELIVERED"));
    assert.equal(ledger.resolved.size, 1);
    assert.equal((await prisma.sessionSettlement.findUniqueOrThrow({ where: { id: row.id } })).status, "SETTLED");

    await runSettlementSweep(); // a second pass over the same (now settled) row re-enters settleTracked and skips it
    assert.equal(ledger.resolveCalls.length, 2);
    assert.equal(await used(c.id), 5, "the retry does not count the session again");
  } finally {
    restoreFind();
    ledger.restore();
    s.restore();
    await scrubAudit(all());
    await prisma.notification.deleteMany({ where: { userId: { in: [pt, c.clientUserId] } } }).catch(() => {});
    await cleanup([pt], [c.id]);
  }
});

test("auto-confirm stays suspended while the PT is restricted (the held session waits); after the lift it auto-confirms and resolves DELIVERED once", { skip }, async () => {
  const { pt, c, ids, all } = await scenario();
  const s = stubs();
  const ledger = fakeLedger();
  try {
    await ptRestrictionService.suspend(suspendInput(pt, new Date(Date.now() - 6 * DAY)));
    await terminateAsClient(c.id, c.clientUserId);
    // its window has run out
    await prisma.session.update({ where: { id: ids.pending }, data: { clientConfirmDeadline: new Date(Date.now() - HOUR) } });
    const row = await prisma.session.findUniqueOrThrow({ where: { id: ids.pending } });
    const deps = {
      findExpiredPendingConfirmation: async () => [row],
      isPtRestricted: async (id: string) => (await prisma.userProfile.findUnique({ where: { userId: id } }))?.ptSuspended === true,
      deductQuotaOnce: async (sid: string, cid: string, transition: any) => (await import("../services/booking.service")).deductQuotaOnce(sid, cid, undefined, transition),
      notify: async () => undefined,
    };
    const restricted = await runAutoConfirm(deps as any);
    assert.equal(restricted.confirmed, 0);
    assert.equal(await statusOf(ids.pending), "PENDING_CLIENT_CONFIRMATION");
    assert.equal(ledger.resolveCalls.length, 0);

    await ptRestrictionService.lift({ ptUserId: pt, adminId: ADMIN, reason: "ok" });
    // lifted: the frozen window was given back at the lift; let it run out again for this test
    await prisma.session.update({ where: { id: ids.pending }, data: { clientConfirmDeadline: new Date(Date.now() - HOUR) } });
    const row2 = await prisma.session.findUniqueOrThrow({ where: { id: ids.pending } });
    const resumed = await runAutoConfirm({ ...deps, findExpiredPendingConfirmation: async () => [row2] } as any);
    assert.equal(resumed.confirmed, 1);
    assert.equal(await statusOf(ids.pending), "COMPLETED");
    assert.equal(await used(c.id), 5);
    assert.deepEqual(ledger.resolveCalls, [expectedResolveBody(c, ids.pending, "DELIVERED")]);
    assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: c.id } })).status, "CANCELLED", "the lift does not revive the ended contract");
  } finally {
    ledger.restore();
    s.restore();
    await scrubAudit(all());
    await prisma.notification.deleteMany({ where: { userId: { in: [pt, c.clientUserId] } } }).catch(() => {});
    await cleanup([pt], [c.id]);
  }
});

test("Decision A (D52): PT_NO_SHOW_REPORTED at the exit is HELD like a disputed session (DISPUTED / PT_NO_SHOW_CLAIM, no fault, no compensation, one session held) - not cancelled and refunded with the rest", { skip }, async () => {
  const pt = await makePt();
  const c = await makeContract(pt);
  const rep = await addSession(c, "PT_NO_SHOW_REPORTED", new Date(Date.now() - 3 * DAY), { disputeReason: "PT không đến" });
  const s = stubs();
  const ledger = fakeLedger();
  try {
    await ptRestrictionService.suspend(suspendInput(pt));
    await terminateAsClient(c.id, c.clientUserId);
    const after = await prisma.session.findUniqueOrThrow({ where: { id: rep.id } });
    assert.equal(after.status, "DISPUTED");
    assert.equal(after.disputeType, "PT_NO_SHOW_CLAIM");
    assert.equal(after.ptAtFault, false);
    assert.equal(after.sessionDeducted, false);
    assert.equal(after.disputeReason, "PT không đến", "the client's report stays on the row");
    assert.deepEqual(ledger.terminateCalls, [expectedTerminateBody(c, EXIT, 0, 1)], "its value is held, not refunded");
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: rep.id, action: "SESSION_NO_SHOW_REPORT_HELD_CONTRACT_ENDED" } });
    assert.equal((audit.metadata as any).decision, "HELD_FOR_ADMIN_RULING");
  } finally {
    ledger.restore();
    s.restore();
    await scrubAudit([rep.id]);
    await prisma.notification.deleteMany({ where: { userId: { in: [pt, c.clientUserId] } } }).catch(() => {});
    await cleanup([pt], [c.id]);
  }
});

// ── (3) B: never silently 100% -> 90% ─────────────────────────────────────────────────────────

test("expectNoPenalty + the PT was lifted first: 409 PT_RESTRICTION_LIFTED with a fresh preview of the ordinary terms, nothing cancelled, contract still ACTIVE, no money call", { skip }, async () => {
  const { pt, c, ids, all, tok } = await scenario();
  const s = stubs();
  const ledger = fakeLedger();
  try {
    await ptRestrictionService.suspend(suspendInput(pt, new Date(Date.now() - DAY)));
    await ptRestrictionService.lift({ ptUserId: pt, adminId: ADMIN, reason: "ok" });

    const before = await Promise.all(all().map(statusOf)); // (the suspension itself already called off the upcoming ones)
    const res = await call("POST", `/contracts/${c.id}/terminate`, tok, { reason: "CLIENT_CANCELLED", expectNoPenalty: true });
    assert.equal(res.status, 409, JSON.stringify(res.body));
    assert.equal(res.body.code, "PT_RESTRICTION_LIFTED");
    assert.equal(res.body.currentTerms.exitReasonIfCancelledNow, "CLIENT_CANCELLED");
    assert.equal(res.body.currentTerms.canExitWithoutPenalty, false);
    assert.equal(res.body.currentTerms.refundIfCancelledNow, "4500000.00", "the terms that apply now, with the fee");
    assert.equal(ledger.terminateCalls.length, 0);
    const after = await prisma.contract.findUniqueOrThrow({ where: { id: c.id } });
    assert.equal(after.status, "ACTIVE");
    assert.equal(after.terminationReason, null);
    assert.equal(after.clientExitAcceptedAt, null);
    assert.deepEqual(await Promise.all(all().map(statusOf)), before, "no session changed by the refused request");
    assert.equal(await statusOf(ids.pending), "PENDING_CLIENT_CONFIRMATION");

    // the same request WITHOUT the flag is the ordinary cancellation, exactly as before
    const plain = await call("POST", `/contracts/${c.id}/terminate`, tok, { reason: "CLIENT_CANCELLED" });
    assert.equal(plain.status, 200);
    assert.equal(plain.body.reason, "CLIENT_CANCELLED");
  } finally {
    ledger.restore();
    s.restore();
    await scrubAudit(all());
    await cleanup([pt], [c.id]);
  }
});

test("expectNoPenalty while the PT is restricted is ACCEPTED durably BEFORE the money call: money fails -> PT lifted -> retry completes with the neutral reason, one refund", { skip }, async () => {
  const { pt, c, ids, all, tok } = await scenario();
  const s = stubs();
  const ledger = fakeLedger({ failTerminate: 1 });
  try {
    await ptRestrictionService.suspend(suspendInput(pt, new Date(Date.now() - DAY)));
    const failed = await call("POST", `/contracts/${c.id}/terminate`, tok, { reason: "CLIENT_CANCELLED", expectNoPenalty: true });
    // D59: the ending is accepted and RECORDED but not confirmed - the client is told so (409 CONTRACT_ENDING), never "ended", never a bare 500.
    assert.equal(failed.status, 409);
    assert.equal(failed.body.code, "CONTRACT_ENDING");
    const mid = await prisma.contract.findUniqueOrThrow({ where: { id: c.id } });
    assert.equal(mid.status, "ACTIVE", "not ended: the money step failed");
    assert.ok(mid.clientExitAcceptedAt, "but the acceptance was written before the money call");
    assert.ok(mid.clientExitRestrictionId);
    const recorded = await prisma.sessionSettlement.findUniqueOrThrow({ where: { idempotencyKey: `CONTRACT_TERMINATE:${c.id}` } });
    assert.equal(recorded.reason, EXIT, "the exit's terms were recorded durably before the money call");
    assert.equal(recorded.status, "FAILED");

    await ptRestrictionService.lift({ ptUserId: pt, adminId: ADMIN, reason: "ok" });

    // the contract reads still say the accepted terms stand (one rule)
    const read = await call("GET", `/contracts/${c.id}/money-breakdown`, tok);
    assert.equal(read.body.canExitWithoutPenalty, true);
    assert.equal(read.body.exitReasonIfCancelledNow, EXIT);

    const retry = await call("POST", `/contracts/${c.id}/terminate`, tok, { reason: "CLIENT_CANCELLED", expectNoPenalty: true });
    assert.equal(retry.status, 200, JSON.stringify(retry.body));
    assert.equal(retry.body.reason, EXIT);
    assert.equal(ledger.terminateCalls.length, 2);
    assert.equal(ledger.terminateCalls[1].reason, EXIT);
    assert.deepEqual(ledger.terminateCalls[1], expectedTerminateBody(c, EXIT, 4, 2));
    assert.equal(ledger.applied.size, 1, "one refund");
    const end = await prisma.contract.findUniqueOrThrow({ where: { id: c.id } });
    assert.equal(end.terminationReason, EXIT);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: c.id, action: "CONTRACT_TERMINATED" } });
    assert.equal((audit.metadata as any).acceptedBeforeRelease, true);
    for (const f of ids.future) assert.equal(await statusOf(f), "CANCELLED");

    // and a flagless retry after the lift also keeps the accepted terms (covered by the same stored acceptance)
  } finally {
    ledger.restore();
    s.restore();
    await scrubAudit(all());
    await prisma.notification.deleteMany({ where: { userId: pt } }).catch(() => {});
    await cleanup([pt], [c.id]);
  }
});

test("an acceptance older than its time limit no longer protects the terms: after the lift the request is refused (expectNoPenalty) / ordinary", { skip }, async () => {
  const { pt, c, all, tok } = await scenario();
  const s = stubs();
  const ledger = fakeLedger();
  try {
    await ptRestrictionService.suspend(suspendInput(pt, new Date(Date.now() - DAY)));
    await ptRestrictionService.lift({ ptUserId: pt, adminId: ADMIN, reason: "ok" });
    await prisma.contract.update({ where: { id: c.id }, data: { clientExitAcceptedAt: new Date(Date.now() - 3 * DAY) } });
    const res = await call("POST", `/contracts/${c.id}/terminate`, tok, { reason: "CLIENT_CANCELLED", expectNoPenalty: true });
    assert.equal(res.status, 409);
    assert.equal(res.body.code, "PT_RESTRICTION_LIFTED");
  } finally {
    ledger.restore();
    s.restore();
    await scrubAudit(all());
    await cleanup([pt], [c.id]);
  }
});

// ── (4) preview == execution ──────────────────────────────────────────────────────────────────

test("preview equals execution: the money-breakdown asks payment-service with the same reason and held-session count the terminate then sends - restricted (neutral, 2 held) and not restricted (ordinary, ALSO 2 held - F2: every ending holds them)", { skip }, async () => {
  const restricted = await scenario();
  const free = await scenario();
  const s = stubs();
  const ledger = fakeLedger();
  try {
    await ptRestrictionService.suspend(suspendInput(restricted.pt));

    const p1 = await call("GET", `/contracts/${restricted.c.id}/money-breakdown`, restricted.tok);
    assert.equal(p1.status, 200, JSON.stringify(p1.body));
    assert.equal(p1.body.canExitWithoutPenalty, true);
    assert.equal(p1.body.exitReasonIfCancelledNow, EXIT);
    assert.equal(p1.body.unresolvedSessions, 2);
    assert.equal(p1.body.reasonUsed, EXIT, "payment-service's reasonUsed passes through");
    assert.equal(p1.body.unresolvedAmountHeld, "1000000", "payment-service's unresolvedAmountHeld passes through");
    assert.equal(p1.body.refundIfCancelledNow, "5000000.00", "existing field kept");
    await call("POST", `/contracts/${restricted.c.id}/terminate`, restricted.tok, { reason: "CLIENT_CANCELLED" });

    const p2 = await call("GET", `/contracts/${free.c.id}/money-breakdown`, free.tok);
    assert.equal(p2.body.canExitWithoutPenalty, false);
    assert.equal(p2.body.exitReasonIfCancelledNow, "CLIENT_CANCELLED");
    assert.equal(p2.body.unresolvedSessions, 2, "F2 / D45-L3: an ordinary cancellation holds the awaiting + disputed sessions too");
    assert.equal(p2.body.refundIfCancelledNow, "4500000.00");
    await call("POST", `/contracts/${free.c.id}/terminate`, free.tok, { reason: "CLIENT_CANCELLED" });

    const [b1, b2] = ledger.breakdownCalls;
    const [t1, t2] = ledger.terminateCalls;
    assert.equal(b1.reason, t1.reason);
    assert.equal(b1.unresolvedSessions, t1.unresolvedSessions);
    assert.equal(b1.usedSessions, t1.usedSessions);
    assert.equal(b2.reason, t2.reason);
    assert.equal(b2.unresolvedSessions, t2.unresolvedSessions, "the same held count in the preview and in the execution");
    assert.deepEqual(t2, expectedTerminateBody(free.c, "CLIENT_CANCELLED", 4, 2), "ordinary cancel: the usual body plus the 2 held sessions (F2)");
    assert.equal(await statusOf(free.ids.pending), "PENDING_CLIENT_CONFIRMATION", "an ordinary cancel keeps the awaiting session (held), it does not cancel it");
    assert.equal(await statusOf(free.ids.disputed), "DISPUTED");
  } finally {
    ledger.restore();
    s.restore();
    for (const x of [restricted, free]) {
      await scrubAudit(x.all());
      await prisma.notification.deleteMany({ where: { userId: { in: [x.pt, x.c.clientUserId] } } }).catch(() => {});
      await cleanup([x.pt], [x.c.id]);
    }
  }
});

// ── (5) notices survive a crash ───────────────────────────────────────────────────────────────

test("exit notice: a failure inside the status-write transaction stores nothing and leaves the contract open; the retry stores exactly one; a crash AFTER commit (push throws) loses only the push", { skip }, async () => {
  const { pt, c, all, tok } = await scenario();
  const s = stubs(undefined, { realNotifications: true });
  const ledger = fakeLedger();
  try {
    await ptRestrictionService.suspend(suspendInput(pt));

    // crash BEFORE commit: the notice insert fails inside the transaction that writes the status
    const original = notificationService.createInTx;
    (notificationService as any).createInTx = async () => {
      throw new Error("simulated crash");
    };
    try {
      await assert.rejects(() => terminateAsClient(c.id, c.clientUserId));
    } finally {
      (notificationService as any).createInTx = original;
    }
    assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: c.id } })).status, "ACTIVE", "status and notice commit together or not at all");
    assert.equal(await prisma.notification.count({ where: { userId: pt, entityId: c.id, eventType: "CONTRACT_CANCELLED" } }), 0);

    // crash AFTER commit: the push throws (the status and the notice are already committed; the push is the only thing lost)
    const restorePublish = patch(notificationService, "publish", () => {
      throw new Error("simulated crash after commit");
    });
    try {
      await assert.rejects(() => terminateAsClient(c.id, c.clientUserId), /simulated crash after commit/);
    } finally {
      restorePublish();
    }
    assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: c.id } })).status, "CANCELLED");
    assert.equal(await prisma.notification.count({ where: { userId: pt, entityId: c.id, eventType: "CONTRACT_CANCELLED" } }), 1, "the notice is already in the PT's list");

    // the client's retry finds the ended contract: no second notice
    await call("POST", `/contracts/${c.id}/terminate`, tok, { reason: "CLIENT_CANCELLED" });
    assert.equal(await prisma.notification.count({ where: { userId: pt, entityId: c.id, eventType: "CONTRACT_CANCELLED" } }), 1);
  } finally {
    ledger.restore();
    s.restore();
    await scrubAudit(all());
    await prisma.notification.deleteMany({ where: { userId: pt } }).catch(() => {});
    await cleanup([pt], [c.id]);
  }
});

test("suspension / lift notices are stored in the same transaction as the state change: a failing notice rolls the suspension back; a crash after commit loses only the push; a retry never doubles", { skip }, async () => {
  const pt = await makePt();
  const c = await makeContract(pt);
  const s = stubs(undefined, { realNotifications: true });
  const ledger = fakeLedger();
  const count = (type: string) => prisma.notification.count({ where: { entityId: c.id, eventType: type as any } });
  try {
    const original = notificationService.createInTx;
    let calls = 0;
    (notificationService as any).createInTx = async (tx: any, n: any) => {
      if (++calls === 2) throw new Error("simulated crash"); // the client's row went in, the PT's did not
      return original(tx, n);
    };
    try {
      await assert.rejects(() => ptRestrictionService.suspend(suspendInput(pt)), /simulated crash/);
    } finally {
      (notificationService as any).createInTx = original;
    }
    assert.equal(await prisma.ptRestriction.count({ where: { ptUserId: pt, endedAt: null } }), 0, "no suspension without its notices");
    assert.equal(await count("CONTRACT_PAUSED_PT_SUSPENDED"), 0, "and no notice without its suspension");

    // retry; then crash right after commit (push throws)
    const restorePublish = patch(notificationService, "publish", () => {
      throw new Error("simulated crash after commit");
    });
    try {
      await assert.rejects(() => ptRestrictionService.suspend(suspendInput(pt)), /simulated crash after commit/);
    } finally {
      restorePublish();
    }
    assert.equal(await prisma.ptRestriction.count({ where: { ptUserId: pt, endedAt: null } }), 1);
    assert.equal(await count("CONTRACT_PAUSED_PT_SUSPENDED"), 1, "the client's notice survived the crash");
    assert.equal(await prisma.notification.count({ where: { userId: pt, eventType: "CONTRACT_PAUSED_PT_SUSPENDED" } }), 1, "and the PT's");

    const again = await ptRestrictionService.suspend(suspendInput(pt));
    assert.equal(again.changed, false);
    assert.equal(await count("CONTRACT_PAUSED_PT_SUSPENDED"), 1, "a repeat never doubles");

    await ptRestrictionService.lift({ ptUserId: pt, adminId: ADMIN, reason: "ok" });
    await ptRestrictionService.lift({ ptUserId: pt, adminId: ADMIN, reason: "again" });
    assert.equal(await count("CONTRACT_RESUMED_PT_REINSTATED"), 1);
  } finally {
    ledger.restore();
    s.restore();
    await prisma.notification.deleteMany({ where: { userId: pt } }).catch(() => {});
    await cleanup([pt], [c.id]);
  }
});
