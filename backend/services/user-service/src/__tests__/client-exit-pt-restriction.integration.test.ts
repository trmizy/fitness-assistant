/**
 * PT-suspension slice 4, part 1 — the client's no-penalty exit from a contract whose PT is restricted.
 *
 * Evidence labels: BACKEND INTEGRATION — the real user-service Express app is started on a random port
 * and called over HTTP against the isolated gymcoach_user_test database (auth-service is NOT running:
 * verifyToken is replaced at the client boundary by a token → identity table, TEST FIXTURE). payment-service
 * is NOT running either: paymentClient.terminate is replaced by a fake LEDGER that keeps one result per
 * idempotency key (as payment-service's withIdempotentLedgerOp does — read in contract-ledger.service.ts,
 * CODE AUDIT), so "one money call's effect" is asserted on `ledger.applied`, and the exact body user-service
 * SENDS is asserted with deepEqual. Run with:
 *   DATABASE_URL="postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_user_test?schema=public" \
 *     ./node_modules/.bin/tsx --test src/__tests__/client-exit-pt-restriction.integration.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { randomUUID } from "node:crypto";
import { prisma } from "../repositories/profile.repository";
import { authServiceClient } from "../clients/auth-service.client";
import { paymentClient } from "../clients/payment.client";
import { ptRestrictionService, openEpisode, syncPtSuspendedFlag } from "../services/pt-restriction.service";
import { terminateAsClient } from "../services/client-exit.service";
import { ptDeactivationService } from "../services/pt-deactivation.service";
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

/** A fake payment-service ledger for POST /internal/contracts/terminate: one result per idempotency key. */
function fakeLedger(gate?: Promise<void>) {
  const calls: any[] = [];
  const applied = new Map<string, { refund: string; reason: string }>();
  const restore = patch(paymentClient, "terminate", async (body: any) => {
    calls.push(body);
    if (gate) await gate;
    if (!applied.has(body.idempotencyKey)) {
      applied.set(body.idempotencyKey, {
        refund: body.reason === "CLIENT_CANCELLED" ? "4500000.00" : "5000000.00",
        reason: body.reason,
        // like the real ledger: it reports how many sessions' value it HELD (user-service checks the answer against what it recorded)
        ...(body.unresolvedSessions > 0 ? { unresolved: { sessions: body.unresolvedSessions } } : {}),
      });
    }
    return applied.get(body.idempotencyKey);
  });
  return { calls, applied, restore };
}

const suspendInput = (ptUserId: string, at?: Date) => ({
  ptUserId,
  adminId: ADMIN,
  reasonCategory: "COMPLAINT_REVIEW" as const,
  reasonText: "Khiếu nại đang được xem xét",
  publicReason: "Đang xem xét một phản ánh",
  at,
});

/** The exact body user-service must send payment-service for a never-used, never-compensated contract. */
function expectedTerminateBody(c: Awaited<ReturnType<typeof makeContract>>, reason: string) {
  return {
    transactionId: c.paymentTransactionId,
    price: c.price!.toString(),
    totalSessions: c.totalSessions,
    usedSessions: 0,
    compensatedSessions: 0,
    rates: { platformRate: c.platformRate.toString(), ptRate: c.ptRate.toString(), gymRate: c.gymRate.toString() },
    reason,
    alreadyReleased: { pt: "0", gym: "0", platform: "0" },
    parties: { ptUserId: c.ptUserId, gymId: c.gymId, clientUserId: c.clientUserId },
    label: `Contract ${c.id} termination`,
    idempotencyKey: `CONTRACT_TERMINATE:${c.id}`,
  };
}

async function scrub(sessionIds: string[]) {
  await prisma.auditLog.deleteMany({ where: { entityId: { in: sessionIds } } }).catch(() => {});
}

// ── (a) substitution and its guards ──────────────────────────────────────────────────────────

test("the client of a suspended PT ends the contract with the plain CLIENT_CANCELLED the apps send: the SERVER records the neutral exit reason, sends it to payment-service with no amount, and writes one audit row with the episode", { skip }, async () => {
  const pt = await makePt();
  const c = await makeContract(pt);
  const tok = tokenFor(c.clientUserId);
  const s = stubs();
  const ledger = fakeLedger();
  try {
    const { restriction } = await ptRestrictionService.suspend(suspendInput(pt));
    const res = await call("POST", `/contracts/${c.id}/terminate`, tok, { reason: "CLIENT_CANCELLED" });

    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.reason, EXIT);
    assert.equal(res.body.requestedReason, "CLIENT_CANCELLED");
    assert.equal(res.body.exitWithoutPenalty, true);
    assert.equal(res.body.alreadyTerminated, false);
    assert.equal(res.body.settlement.refund, "5000000.00", "the ledger (not user-service) priced the full unused value");

    // exactly the body every termination sends — and no amount, fee or refund of user-service's making
    assert.equal(ledger.calls.length, 1);
    assert.deepEqual(ledger.calls[0], expectedTerminateBody(c, EXIT));
    assert.ok(!("amount" in ledger.calls[0]) && !("refund" in ledger.calls[0]) && !("fee" in ledger.calls[0]));
    assert.notEqual(ledger.calls[0].reason, "CLIENT_CANCELLED", "the fee path is never entered");

    const after = await prisma.contract.findUniqueOrThrow({ where: { id: c.id } });
    assert.equal(after.status, "CANCELLED");
    assert.equal(after.terminationReason, EXIT);
    assert.ok(after.terminatedAt);
    assert.equal(after.cancelledBy, c.clientUserId, "recorded who");
    assert.match(after.cancellationReason ?? "", /huấn luyện viên đang tạm ngưng hoạt động/);

    const audits = await prisma.auditLog.findMany({ where: { entityId: c.id, action: "CONTRACT_TERMINATED" } });
    assert.equal(audits.length, 1);
    assert.equal(audits[0].actorUserId, c.clientUserId);
    const meta = audits[0].metadata as any;
    assert.equal(meta.reason, EXIT);
    assert.equal(meta.restrictionId, restriction.id);
    assert.equal(meta.restrictionType, "TEMPORARY_SUSPENSION");
    assert.equal(meta.requestedReason, "CLIENT_CANCELLED");

    // the PT is not marked at fault anywhere: still just paused, no strike, no money to/from them
    assert.equal((await prisma.userProfile.findUniqueOrThrow({ where: { userId: pt } })).ptSuspended, true);
    assert.equal(after.compensatedSessions, 0);
    assert.equal(s.payments.filter((p) => p.method !== "terminate").length, 0, "no release / no-show / late-arrival compensation");
  } finally {
    ledger.restore();
    s.restore();
    await cleanup([pt], [c.id]);
  }
});

test("regression: the same request while the PT is NOT restricted is the ordinary client cancellation, exactly as before (same reason sent, same response shape, same audit row)", { skip }, async () => {
  const pt = await makePt();
  const c = await makeContract(pt);
  const tok = tokenFor(c.clientUserId);
  const s = stubs();
  const ledger = fakeLedger();
  try {
    const res = await call("POST", `/contracts/${c.id}/terminate`, tok, { reason: "CLIENT_CANCELLED" });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(Object.keys(res.body).sort(), ["contractId", "reason", "settlement"], "no new keys on the ordinary path");
    assert.equal(res.body.reason, "CLIENT_CANCELLED");
    assert.deepEqual(ledger.calls, [expectedTerminateBody(c, "CLIENT_CANCELLED")]);
    const after = await prisma.contract.findUniqueOrThrow({ where: { id: c.id } });
    assert.equal(after.status, "CANCELLED");
    assert.equal(after.terminationReason, "CLIENT_CANCELLED");
    const audits = await prisma.auditLog.findMany({ where: { entityId: c.id, action: "CONTRACT_TERMINATED" } });
    assert.equal(audits.length, 1);
    assert.equal((audits[0].metadata as any).reason, "CLIENT_CANCELLED");
    assert.equal((audits[0].metadata as any).restrictionId, undefined);
  } finally {
    ledger.restore();
    s.restore();
    await cleanup([pt], [c.id]);
  }
});

test("only the contract's client gets the exit: the PT, another client, an anonymous caller and a caller who sends the neutral reason themselves all get nothing; an admin's explicit reasons keep their own formulas", { skip }, async () => {
  const pt = await makePt();
  const c = await makeContract(pt);
  const clientTok = tokenFor(c.clientUserId);
  const ptTok = tokenFor(pt, "PT");
  const strangerTok = tokenFor(randomUUID());
  const adminTok = tokenFor(randomUUID(), "ADMIN");
  const s = stubs();
  const ledger = fakeLedger();
  try {
    await ptRestrictionService.suspend(suspendInput(pt));

    assert.equal((await call("POST", `/contracts/${c.id}/terminate`, null, { reason: "CLIENT_CANCELLED" })).status, 401, "anonymous");
    assert.equal((await call("POST", `/contracts/${c.id}/terminate`, strangerTok, { reason: "CLIENT_CANCELLED" })).status, 403, "another client");
    assert.equal((await call("POST", `/contracts/${c.id}/terminate`, strangerTok, { reason: EXIT })).status, 400, "the neutral reason is not a request value");
    const ptTry = await call("POST", `/contracts/${c.id}/terminate`, ptTok, { reason: "CLIENT_CANCELLED" });
    assert.equal(ptTry.status, 403, "the PT cannot declare the client's cancellation");
    const ptExit = await call("POST", `/contracts/${c.id}/terminate`, ptTok, { reason: EXIT });
    assert.equal(ptExit.status, 400, "…nor the neutral reason");
    const clientDirect = await call("POST", `/contracts/${c.id}/terminate`, clientTok, { reason: EXIT });
    assert.equal(clientDirect.status, 400, "the client cannot ask for the neutral reason by name either — the server substitutes it");
    const ptCancel = await call("POST", `/contracts/${c.id}/terminate`, ptTok, { reason: "PT_CANCELLED" });
    assert.equal(ptCancel.status, 409, "a restricted PT still cannot end a contract as PT_CANCELLED");
    assert.equal(ptCancel.body.code, "PT_TEMPORARILY_UNAVAILABLE");
    assert.equal(ledger.calls.length, 0, "none of the above reached payment-service");
    assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: c.id } })).status, "ACTIVE");

    // an admin acting for the client keeps the ordinary reason: nothing is substituted for an admin
    const admin = await call("POST", `/contracts/${c.id}/terminate`, adminTok, { reason: "CLIENT_CANCELLED" });
    assert.equal(admin.status, 200, JSON.stringify(admin.body));
    assert.equal(admin.body.reason, "CLIENT_CANCELLED");
    assert.equal(ledger.calls.length, 1);
    assert.equal(ledger.calls[0].reason, "CLIENT_CANCELLED");
    assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: c.id } })).terminationReason, "CLIENT_CANCELLED");
  } finally {
    ledger.restore();
    s.restore();
    await cleanup([pt], [c.id]);
  }
});

test("terminateAsClient itself refuses a caller who is not the contract's client", { skip }, async () => {
  const pt = await makePt();
  const c = await makeContract(pt);
  const s = stubs();
  const ledger = fakeLedger();
  try {
    await ptRestrictionService.suspend(suspendInput(pt));
    await assert.rejects(() => terminateAsClient(c.id, pt), (e: any) => e.status === 403);
    await assert.rejects(() => terminateAsClient(c.id, randomUUID()), (e: any) => e.status === 403);
    assert.equal(ledger.calls.length, 0);
  } finally {
    ledger.restore();
    s.restore();
    await cleanup([pt], [c.id]);
  }
});

test("a contract that is not ACTIVE-and-paid keeps today's behaviour even while its PT is restricted", { skip }, async () => {
  const pt = await makePt();
  const pending = await makeContract(pt, { status: "PENDING_PAYMENT", paymentTransactionId: null, startDate: null, endDate: null });
  const unpaidActive = await makeContract(pt, { paymentTransactionId: null });
  const done = await makeContract(pt, { status: "COMPLETED", terminationReason: "COMPLETED", terminatedAt: new Date(Date.now() - DAY) });
  const s = stubs();
  const ledger = fakeLedger();
  try {
    await ptRestrictionService.suspend(suspendInput(pt));

    const r1 = await call("POST", `/contracts/${pending.id}/terminate`, tokenFor(pending.clientUserId), { reason: "CLIENT_CANCELLED" });
    assert.equal(r1.status, 200);
    assert.equal(r1.body.reason, "CLIENT_CANCELLED");
    assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: pending.id } })).terminationReason, "CLIENT_CANCELLED");

    const r2 = await call("POST", `/contracts/${unpaidActive.id}/terminate`, tokenFor(unpaidActive.clientUserId), { reason: "CLIENT_CANCELLED" });
    assert.equal(r2.status, 200);
    assert.equal(r2.body.reason, "CLIENT_CANCELLED");
    assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: unpaidActive.id } })).terminationReason, "CLIENT_CANCELLED");

    const r3 = await call("POST", `/contracts/${done.id}/terminate`, tokenFor(done.clientUserId), { reason: "CLIENT_CANCELLED" });
    assert.equal(r3.status, 200);
    assert.equal(r3.body.reason, "CLIENT_CANCELLED");
    const doneAfter = await prisma.contract.findUniqueOrThrow({ where: { id: done.id } });
    assert.equal(doneAfter.status, "COMPLETED", "an ended contract is not rewritten");
    assert.equal(doneAfter.terminationReason, "COMPLETED");

    // The two unpaid contracts have no money behind them: no ledger call at all. The paid-but-already-COMPLETED one is replayed
    // with the reason RECORDED on it (D59: an ending is never re-priced with the reason of whoever asks again - sending
    // CLIENT_CANCELLED there would charge a completed contract a cancellation fee if the ledger had no result for it yet).
    assert.ok(ledger.calls.every((b) => b.reason !== EXIT), "the neutral reason was never sent for these");
    assert.deepEqual(ledger.calls.map((b) => b.reason), ["COMPLETED"]);
  } finally {
    ledger.restore();
    s.restore();
    await cleanup([pt], [pending.id, unpaidActive.id, done.id]);
  }
});

test("a PERMANENT_BAN whose unwind has not reached the contract also qualifies; the unwind afterwards finds the contract already ended and does not touch it", { skip }, async () => {
  const pt = await makePt();
  const c = await makeContract(pt);
  const s = stubs();
  const ledger = fakeLedger();
  try {
    const ban = await prisma.$transaction(async (tx) => {
      const e = await openEpisode(tx, {
        ptUserId: pt,
        type: "PERMANENT_BAN",
        reasonCategory: "UNSPECIFIED",
        reasonText: "lock",
        imposedBy: ADMIN,
        startedAt: new Date(),
        lockSeq: 1n,
      });
      await syncPtSuspendedFlag(tx, pt);
      return e;
    });
    const res = await call("POST", `/contracts/${c.id}/terminate`, tokenFor(c.clientUserId), { reason: "CLIENT_CANCELLED" });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.reason, EXIT);
    const meta = (await prisma.auditLog.findFirstOrThrow({ where: { entityId: c.id, action: "CONTRACT_TERMINATED" } })).metadata as any;
    assert.equal(meta.restrictionId, ban.id);
    assert.equal(meta.restrictionType, "PERMANENT_BAN");

    const unwound = await ptDeactivationService.unwindContract(c, "Tài khoản huấn luyện viên bị khoá");
    assert.equal(unwound.status, "ALREADY_ENDED");
    const after = await prisma.contract.findUniqueOrThrow({ where: { id: c.id } });
    assert.equal(after.terminationReason, EXIT, "the unwind did not rewrite the exit into PT_BANNED");
    assert.equal(ledger.applied.size, 1, "one money effect, whichever path ran");
  } finally {
    ledger.restore();
    s.restore();
    await cleanup([pt], [c.id]);
  }
});

// ── (b) idempotency and the race with a lift ─────────────────────────────────────────────────

test("a repeated request gets the already-terminated state: one status change, one audit row, one money effect; concurrent requests the same", { skip }, async () => {
  const pt = await makePt();
  const c = await makeContract(pt);
  const c2 = await makeContract(pt);
  const tok = tokenFor(c.clientUserId);
  const tok2 = tokenFor(c2.clientUserId);
  const s = stubs();
  const ledger = fakeLedger();
  try {
    await ptRestrictionService.suspend(suspendInput(pt));

    // sequential
    const first = await call("POST", `/contracts/${c.id}/terminate`, tok, { reason: "CLIENT_CANCELLED" });
    const terminatedAt = (await prisma.contract.findUniqueOrThrow({ where: { id: c.id } })).terminatedAt!.getTime();
    const second = await call("POST", `/contracts/${c.id}/terminate`, tok, { reason: "CLIENT_CANCELLED" });
    assert.equal(first.status, 200);
    assert.equal(second.status, 200, "never a confusing error");
    assert.equal(first.body.alreadyTerminated, false);
    assert.equal(second.body.alreadyTerminated, true);
    assert.equal(second.body.reason, EXIT);
    assert.deepEqual(second.body.settlement, first.body.settlement, "the same ledger result is replayed");
    assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: c.id } })).terminatedAt!.getTime(), terminatedAt, "status written once");
    assert.equal(await prisma.auditLog.count({ where: { entityId: c.id, action: "CONTRACT_TERMINATED" } }), 1);
    assert.ok(ledger.calls.every((b) => b.idempotencyKey === `CONTRACT_TERMINATE:${c.id}` && b.reason === EXIT));
    assert.equal(ledger.applied.size, 1);

    // concurrent
    const results = await Promise.all([1, 2, 3, 4].map(() => call("POST", `/contracts/${c2.id}/terminate`, tok2, { reason: "CLIENT_CANCELLED" })));
    assert.ok(results.every((r) => r.status === 200), JSON.stringify(results.map((r) => r.body)));
    assert.ok(results.every((r) => r.body.reason === EXIT));
    assert.equal(results.filter((r) => r.body.alreadyTerminated === false).length, 1, "exactly one request did the work");
    assert.equal(await prisma.auditLog.count({ where: { entityId: c2.id, action: "CONTRACT_TERMINATED" } }), 1);
    assert.equal(ledger.applied.size, 2, "one ledger effect per contract (c and c2), none doubled");
    // the losers saw the ended contract under the lock and replayed the idempotent call: identical body, same key
    const forC2 = ledger.calls.filter((b) => b.idempotencyKey === `CONTRACT_TERMINATE:${c2.id}`);
    assert.ok(forC2.length >= 1);
    assert.ok(forC2.every((b) => JSON.stringify(b) === JSON.stringify(expectedTerminateBody(c2, EXIT))));
  } finally {
    ledger.restore();
    s.restore();
    await cleanup([pt], [c.id, c2.id]);
  }
});

test("race, lift FIRST: a lift that lands between the unlocked look and the lock turns the request into an ordinary CLIENT_CANCELLED (the PT is running again)", { skip }, async () => {
  const pt = await makePt();
  const c = await makeContract(pt, { clientUserId: randomUUID() });
  const s = stubs();
  const ledger = fakeLedger();
  try {
    await ptRestrictionService.suspend(suspendInput(pt, new Date(Date.now() - 2 * DAY)));
    const out = await terminateAsClient(c.id, c.clientUserId, {
      beforeLock: async () => {
        const lifted = await ptRestrictionService.lift({ ptUserId: pt, adminId: ADMIN, reason: "ok" });
        assert.equal(lifted.changed, true);
      },
    });
    assert.equal(out.mode, "ORDINARY");
    assert.equal(out.reason, "CLIENT_CANCELLED");
    assert.deepEqual(ledger.calls.map((b) => b.reason), ["CLIENT_CANCELLED"]);
    const after = await prisma.contract.findUniqueOrThrow({ where: { id: c.id } });
    assert.equal(after.terminationReason, "CLIENT_CANCELLED");
    assert.equal(await prisma.auditLog.count({ where: { entityId: c.id, action: "CONTRACT_TERMINATED", actorUserId: c.clientUserId } }), 0, "the controller writes the ordinary audit row, not the service");
  } finally {
    ledger.restore();
    s.restore();
    await cleanup([pt], [c.id]);
  }
});

test("race, EXIT first (D58): once the exit is RECORDED the PT lock is free - a lift requested while the money call is in flight is not queued behind it and changes nothing about the exit: same terms, contract not extended, not revived, no 'resumed' notice", { skip }, async () => {
  const pt = await makePt();
  const c = await makeContract(pt, { clientUserId: randomUUID() });
  const endBefore = c.endDate!.getTime();
  const s = stubs();
  let open!: () => void;
  const gate = new Promise<void>((r) => (open = r));
  const ledger = fakeLedger(gate);
  try {
    const { restriction } = await ptRestrictionService.suspend(suspendInput(pt, new Date(Date.now() - 2 * DAY)));
    const exit = terminateAsClient(c.id, c.clientUserId);
    for (let i = 0; i < 100 && ledger.calls.length === 0; i++) await new Promise((r) => setTimeout(r, 20));
    assert.equal(ledger.calls.length, 1, "the exit is inside its money call");

    // The ending is RECORDED, durably, with the exit's terms - and not yet confirmed (the contract is still ACTIVE, i.e. ENDING).
    const recorded = await prisma.sessionSettlement.findUniqueOrThrow({ where: { idempotencyKey: `CONTRACT_TERMINATE:${c.id}` } });
    assert.equal(recorded.kind, "CONTRACT_TERMINATION");
    assert.equal(recorded.reason, EXIT, "the recorded reason is the exit's - a retry never recomputes it");
    assert.notEqual(recorded.status, "SETTLED");
    assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: c.id } })).status, "ACTIVE", "never reported as ended while the money is unconfirmed");

    // The lift is NOT held up by the exit's network call any more (it used to wait for it under the PT lock).
    const lifted = await Promise.race([
      ptRestrictionService.lift({ ptUserId: pt, adminId: ADMIN, reason: "ok" }),
      new Promise<null>((r) => setTimeout(() => r(null), 5000)),
    ]);
    assert.ok(lifted, "the lift completes while the exit's money call is still in flight");
    assert.equal(lifted!.changed, true);
    assert.notEqual((await prisma.ptRestriction.findUniqueOrThrow({ where: { id: restriction.id } })).endedAt, null, "the PT is lifted now…");
    // …yet the ending is on its way out: it is neither extended nor told "resumed".
    assert.deepEqual(lifted!.summary!.extendedContracts.filter((e) => e.contractId === c.id), []);
    assert.equal(await prisma.ptRestrictionContractExtension.count({ where: { contractId: c.id } }), 0);
    assert.equal(s.notified.filter((n) => n.eventType === "CONTRACT_RESUMED_PT_REINSTATED" && n.entityId === c.id).length, 0);

    open();
    const out = await exit;
    assert.equal(out.mode, "EXIT_DUE_TO_PT_RESTRICTION", "the exit keeps the terms it was recorded with, although the PT was lifted meanwhile");
    assert.equal(ledger.calls[0].reason, EXIT);
    const after = await prisma.contract.findUniqueOrThrow({ where: { id: c.id } });
    assert.equal(after.status, "CANCELLED");
    assert.equal(after.terminationReason, EXIT);
    assert.equal(after.endDate!.getTime(), endBefore, "not extended");
    assert.equal(ledger.applied.size, 1, "one refund");
  } finally {
    open();
    ledger.restore();
    s.restore();
    await cleanup([pt], [c.id]);
  }
});

// ── (c) sessions ─────────────────────────────────────────────────────────────────────────────

test("sessions still open when the client leaves are closed as administrative: CANCELLED, no no-show, no quota, no fault, cancelledBy a non-PT value; finished sessions and the counters are untouched", { skip }, async () => {
  const T = Date.now();
  const pt = await makePt();
  const c = await makeContract(pt, { usedSessions: 2 });
  const s = stubs();
  const ledger = fakeLedger();
  const sessionIds: string[] = [];
  try {
    await ptRestrictionService.suspend(suspendInput(pt)); // nothing open yet — these appear afterwards (race / seed data)
    const done = await addSession(c, "COMPLETED", new Date(T - 5 * DAY), { sessionDeducted: true });
    const confirmed = await addSession(c, "CONFIRMED", new Date(T + 2 * DAY));
    const requested = await addSession(c, "REQUESTED", new Date(T + 3 * DAY));
    const pending = await addSession(c, "PENDING_CLIENT_CONFIRMATION", new Date(T - 1 * DAY), { clientConfirmDeadline: new Date(T + HOUR) });
    const disputed = await addSession(c, "DISPUTED", new Date(T - 2 * DAY), { disputeReason: "x", disputedAt: new Date(T - DAY) });
    const noShowRep = await addSession(c, "PT_NO_SHOW_REPORTED", new Date(T - 3 * DAY), { disputeReason: "y" });
    sessionIds.push(done.id, confirmed.id, requested.id, pending.id, disputed.id, noShowRep.id);

    const res = await call("POST", `/contracts/${c.id}/terminate`, tokenFor(c.clientUserId), { reason: "CLIENT_CANCELLED" });
    assert.equal(res.status, 200, JSON.stringify(res.body));

    // bổ sung 11/10, A: the sessions awaiting confirmation / disputed are NOT called off (their value is held and
    // they continue through confirm / dispute / ruling - see client-exit-unresolved-sessions.integration.test.ts)
    for (const id of [pending.id, disputed.id]) {
      const kept = await prisma.session.findUniqueOrThrow({ where: { id } });
      assert.ok(["PENDING_CLIENT_CONFIRMATION", "DISPUTED"].includes(kept.status), "held, not cancelled");
    }
    // Decision A (D52): the client's unanswered PT-no-show report is HELD too (DISPUTED / PT_NO_SHOW_CLAIM), not cancelled
    const heldReport = await prisma.session.findUniqueOrThrow({ where: { id: noShowRep.id } });
    assert.deepEqual([heldReport.status, heldReport.disputeType, heldReport.ptAtFault, heldReport.sessionDeducted], ["DISPUTED", "PT_NO_SHOW_CLAIM", false, false]);
    for (const id of [confirmed.id, requested.id]) {
      const after = await prisma.session.findUniqueOrThrow({ where: { id } });
      assert.equal(after.status, "CANCELLED");
      assert.equal(after.cancelledBy, "SYSTEM");
      assert.notEqual(after.cancelledBy, pt, "the idle-holdback 'PT cancelled counts as activity' rule is not triggered");
      assert.equal(after.ptAtFault, false);
      assert.equal(after.sessionDeducted, false);
      assert.match(after.cancellationReason ?? "", /không bị tính vắng/);
    }
    const doneAfter = await prisma.session.findUniqueOrThrow({ where: { id: done.id } });
    assert.equal(doneAfter.status, "COMPLETED");
    assert.equal(doneAfter.sessionDeducted, true);
    const contract = await prisma.contract.findUniqueOrThrow({ where: { id: c.id } });
    assert.equal(contract.usedSessions, 2, "quota untouched");
    assert.equal(contract.compensatedSessions, 0, "no compensation counted");
    assert.equal(s.payments.filter((p) => p.method !== "terminate").length, 0, "no no-show / late-arrival / release money call");
    const audits = await prisma.auditLog.findMany({ where: { action: "SESSION_CANCELLED_CLIENT_EXIT_PT_RESTRICTED", entityId: { in: sessionIds } } });
    assert.equal(audits.length, 2);
    const restrictionId = (await prisma.ptRestriction.findFirstOrThrow({ where: { ptUserId: pt } })).id;
    assert.ok(audits.every((a) => (a.metadata as any).restrictionId === restrictionId && a.actorUserId === c.clientUserId));
  } finally {
    ledger.restore();
    s.restore();
    await scrub(sessionIds);
    await cleanup([pt], [c.id]);
  }
});

// ── (d) B, C, D, E ───────────────────────────────────────────────────────────────────────────

test("four clients of one suspended PT: B exits; C, D and E are untouched and still get their time back at the lift; B's contract is never revived or extended", { skip }, async () => {
  const T = Date.now();
  const pt = await makePt();
  const [B, C, D, E] = await Promise.all([makeContract(pt), makeContract(pt), makeContract(pt), makeContract(pt)]);
  const s = stubs();
  const ledger = fakeLedger();
  const suspendedAt = new Date(T - 5 * DAY);
  const liftAt = new Date(T);
  try {
    const { restriction } = await ptRestrictionService.suspend(suspendInput(pt, suspendedAt));
    const exit = await call("POST", `/contracts/${B.id}/terminate`, tokenFor(B.clientUserId), { reason: "CLIENT_CANCELLED" });
    assert.equal(exit.body.reason, EXIT);

    for (const other of [C, D, E]) {
      const mid = await prisma.contract.findUniqueOrThrow({ where: { id: other.id } });
      assert.equal(mid.status, "ACTIVE");
      assert.equal(mid.terminationReason, null);
    }
    assert.equal(ledger.calls.length, 1, "only B's money moved");

    const lifted = await ptRestrictionService.lift({ ptUserId: pt, adminId: ADMIN, reason: "xong", at: liftAt });
    assert.equal(lifted.changed, true);
    const blocked = liftAt.getTime() - suspendedAt.getTime();
    for (const other of [C, D, E]) {
      const after = await prisma.contract.findUniqueOrThrow({ where: { id: other.id } });
      assert.equal(after.status, "ACTIVE");
      assert.equal(after.endDate!.getTime(), other.endDate!.getTime() + blocked, "still extended by exactly the blocked time");
    }
    const bAfter = await prisma.contract.findUniqueOrThrow({ where: { id: B.id } });
    assert.equal(bAfter.status, "CANCELLED", "not revived");
    assert.equal(bAfter.terminationReason, EXIT);
    assert.equal(bAfter.endDate!.getTime(), B.endDate!.getTime(), "not extended");
    const extended = await prisma.ptRestrictionContractExtension.findMany({ where: { restrictionId: restriction.id } });
    assert.deepEqual(extended.map((e) => e.contractId).sort(), [C.id, D.id, E.id].sort());
    assert.equal(await prisma.auditLog.count({ where: { entityId: B.id, action: "CONTRACT_END_DATE_EXTENDED_PT_RESTRICTION" } }), 0);

    // a second episode does not bring B back either
    await ptRestrictionService.suspend(suspendInput(pt, new Date(T + HOUR)));
    await ptRestrictionService.lift({ ptUserId: pt, adminId: ADMIN, reason: "again", at: new Date(T + 3 * HOUR) });
    const bAgain = await prisma.contract.findUniqueOrThrow({ where: { id: B.id } });
    assert.equal(bAgain.status, "CANCELLED");
    assert.equal(bAgain.endDate!.getTime(), B.endDate!.getTime());
  } finally {
    ledger.restore();
    s.restore();
    await cleanup([pt], [B.id, C.id, D.id, E.id]);
  }
});

// ── (e) what the client can read ─────────────────────────────────────────────────────────────

test("the contract reads carry canExitWithoutPenalty from the same central rule (true only for a paid ACTIVE contract of a restricted PT)", { skip }, async () => {
  const pt = await makePt();
  const otherPt = await makePt();
  const client = randomUUID();
  const live = await makeContract(pt, { clientUserId: client });
  const unpaid = await makeContract(pt, { clientUserId: client, paymentTransactionId: null });
  const free = await makeContract(otherPt, { clientUserId: client });
  const tok = tokenFor(client);
  const s = stubs();
  const restoreBreakdown = patch(paymentClient, "moneyBreakdown", async () => ({ remaining: "5000000.00", refundIfCancelledNow: "4500000.00" }));
  try {
    const before = await call("GET", `/contracts/client`, tok);
    assert.ok(before.body.every((x: any) => x.canExitWithoutPenalty === false));

    await ptRestrictionService.suspend(suspendInput(pt));
    const list = await call("GET", `/contracts/client`, tok);
    const byId = new Map<string, any>(list.body.map((x: any) => [x.id, x]));
    assert.equal(byId.get(live.id).effectiveStatus, "PAUSED_BY_ADMIN");
    assert.equal(byId.get(live.id).canExitWithoutPenalty, true);
    assert.equal(byId.get(unpaid.id).canExitWithoutPenalty, false);
    assert.equal(byId.get(free.id).canExitWithoutPenalty, false);
    assert.equal((await call("GET", `/contracts/${live.id}`, tok)).body.canExitWithoutPenalty, true);
    const breakdown = await call("GET", `/contracts/${live.id}/money-breakdown`, tok);
    assert.equal(breakdown.body.canExitWithoutPenalty, true);

    await ptRestrictionService.lift({ ptUserId: pt, adminId: ADMIN, reason: "ok" });
    assert.equal((await call("GET", `/contracts/${live.id}`, tok)).body.canExitWithoutPenalty, false);
  } finally {
    restoreBreakdown();
    s.restore();
    await cleanup([pt, otherPt], [live.id, unpaid.id, free.id]);
  }
});
