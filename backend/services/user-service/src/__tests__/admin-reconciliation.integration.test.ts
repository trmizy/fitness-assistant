/**
 * FH-4 part 1 - GET /admin/sessions/reconciliation (read-only admin reconciliation report).
 *
 * Evidence labels: REAL HTTP/API for the HTTP half (the real user-service Express app on a random port, called with fetch) and
 * BACKEND INTEGRATION against an isolated *_test PostgreSQL database. TEST FIXTURE: auth-service is not running, so
 * authServiceClient.verifyToken is replaced at the client boundary by a token -> identity table; the rows are seeded through the
 * real repositories (upsertPending / park / claim) plus raw SQL ONLY to age a timestamp that @updatedAt would otherwise reset.
 *   DATABASE_URL="postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_user_fh4_test?schema=public" \
 *     ./node_modules/.bin/tsx --test src/__tests__/admin-reconciliation.integration.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { randomUUID } from "node:crypto";
import { prisma } from "../repositories/profile.repository";
import { authServiceClient } from "../clients/auth-service.client";
import { sessionSettlementRepository, NEEDS_RECONCILIATION_PREFIX, CONFLICT_PREFIX } from "../repositories/session-settlement.repository";
import { disputeSlaState, errorCodeOf } from "../services/admin-reconciliation.service";
import { DAY, HOUR, addSession, cleanup, makeContract, makePt, patch, skip } from "./pt-restriction.test-helpers";

const identities = new Map<string, { id: string; email: string; role: string }>();
function tokenFor(id: string, role: string): string {
  const token = `tok-${id}`;
  identities.set(token, { id, email: `${id}@test.local`, role });
  return token;
}

let server: http.Server;
let base = "";
let restoreAuth: () => void = () => {};

test.before(async () => {
  if (skip) return;
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
  if (server) {
    (server as any).closeAllConnections?.();
    await new Promise((r) => server.close(r));
  }
});

async function get(path: string, token: string | null) {
  const res = await fetch(base + path, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body, text, headers: res.headers };
}

/** Everything the report could possibly touch, as plain JSON - compared before / after to prove nothing was written. */
async function snapshotTables() {
  const [settlements, sessions, contracts, audit, notifications] = await Promise.all([
    prisma.sessionSettlement.findMany({ orderBy: { id: "asc" } }),
    prisma.session.findMany({ orderBy: { id: "asc" } }),
    prisma.contract.findMany({ orderBy: { id: "asc" } }),
    prisma.auditLog.count(),
    prisma.notification.count(),
  ]);
  return JSON.stringify({ settlements, sessions, contracts, audit, notifications });
}

/** Ages a row's timestamps (the Prisma @updatedAt would reset them on any ORM update). */
async function age(table: "session_settlements" | "contracts", id: string, ms: number, cols: string[]) {
  const at = new Date(Date.now() - ms);
  for (const col of cols) await prisma.$executeRawUnsafe(`UPDATE ${table} SET ${col} = $1 WHERE id = $2`, at, id);
}

test("pure helpers: D61 SLA thresholds (10 / 14 days) and the safe error code", () => {
  assert.equal(disputeSlaState(0), "WITHIN_SLA");
  assert.equal(disputeSlaState(9), "WITHIN_SLA");
  assert.equal(disputeSlaState(10), "DUE_SOON");
  assert.equal(disputeSlaState(13), "DUE_SOON");
  assert.equal(disputeSlaState(14), "OVERDUE");
  assert.equal(disputeSlaState(40), "OVERDUE");
  assert.equal(errorCodeOf(null), null);
  assert.equal(errorCodeOf("NEEDS_RECONCILIATION: 12 failed attempts; last error: payment-service 503 for user a@b.c"), "NEEDS_RECONCILIATION");
  assert.equal(errorCodeOf("CONFLICT: other reason"), "CONFLICT");
  assert.equal(errorCodeOf("connect ECONNREFUSED 10.0.0.1:3004"), "ERROR");
});

test("the report: each group lists exactly the right rows, without PII, and writes NOTHING (403 for non-admins)", { skip }, async () => {
  await prisma.sessionSettlement.deleteMany({});
  const pt = await makePt();
  const secretName = "Nguyen Van Secret";
  const secretReason = "khach hang noi so dien thoai 0901234567";

  // Contracts: price 5.000.000 / 10 sessions => 500.000 per session.
  const cParked = await makeContract(pt);
  const cConflict = await makeContract(pt);
  const cCap = await makeContract(pt);
  const cStuck = await makeContract(pt);
  const cControl = await makeContract(pt);
  const cEnding = await makeContract(pt);
  const cEndingFresh = await makeContract(pt);
  const cEndingSettled = await makeContract(pt);
  const cEndedNoRow = await makeContract(pt, { status: "COMPLETED" });
  const cEndedPending = await makeContract(pt, { status: "CANCELLED" });
  const cEndedSettled = await makeContract(pt, { status: "COMPLETED" });
  const cDisputes = await makeContract(pt);
  const all = [cParked, cConflict, cCap, cStuck, cControl, cEnding, cEndingFresh, cEndingSettled, cEndedNoRow, cEndedPending, cEndedSettled, cDisputes];

  try {
    // ── needsAttention ──────────────────────────────────────────────────────────────────────────
    const sParked = await addSession(cParked, "COMPLETED", new Date(Date.now() - DAY), { sessionDeducted: true });
    const rowParked = await sessionSettlementRepository.upsertPending({ kind: "SESSION_RELEASE", idempotencyKey: `SESSION_RELEASE:${sParked.id}`, sessionId: sParked.id, contractId: cParked.id, reason: null });
    await sessionSettlementRepository.park(rowParked.id, NEEDS_RECONCILIATION_PREFIX, `12 failed attempts; last error: payment-service 503 for ${secretName}`);

    const sConflict = await addSession(cConflict, "COMPLETED", new Date(Date.now() - DAY), { sessionDeducted: true });
    const rowConflict = await sessionSettlementRepository.upsertPending({ kind: "SESSION_RELEASE", idempotencyKey: `SESSION_RELEASE:${sConflict.id}`, sessionId: sConflict.id, contractId: cConflict.id, reason: null });
    await sessionSettlementRepository.park(rowConflict.id, CONFLICT_PREFIX, "payment-service answered another reason");

    const sCap = await addSession(cCap, "COMPLETED", new Date(Date.now() - DAY), { sessionDeducted: true });
    const rowCap = await sessionSettlementRepository.upsertPending({ kind: "SESSION_RELEASE", idempotencyKey: `SESSION_RELEASE:${sCap.id}`, sessionId: sCap.id, contractId: cCap.id, reason: null });
    await prisma.sessionSettlement.update({ where: { id: rowCap.id }, data: { status: "FAILED", attempts: 12, lastError: `raw failure for ${secretName}` } });

    const sStuck = await addSession(cStuck, "COMPLETED", new Date(Date.now() - DAY), { sessionDeducted: true });
    const rowStuck = await sessionSettlementRepository.upsertPending({ kind: "SESSION_RELEASE", idempotencyKey: `SESSION_RELEASE:${sStuck.id}`, sessionId: sStuck.id, contractId: cStuck.id, reason: null });
    assert.ok(await sessionSettlementRepository.claim(rowStuck.id, { staleBefore: new Date(Date.now() + HOUR) }));
    await age("session_settlements", rowStuck.id, 30 * 60_000, ["updated_at"]);

    // Controls that must NOT be listed: a fresh PENDING row, a freshly claimed PROCESSING row (in flight), a SETTLED row, an orphan.
    const sControl = await addSession(cControl, "COMPLETED", new Date(Date.now() - DAY), { sessionDeducted: true });
    const rowPending = await sessionSettlementRepository.upsertPending({ kind: "SESSION_RELEASE", idempotencyKey: `SESSION_RELEASE:${sControl.id}`, sessionId: sControl.id, contractId: cControl.id, reason: null });
    const sInFlight = await addSession(cControl, "COMPLETED", new Date(Date.now() - DAY), { sessionDeducted: true });
    const rowInFlight = await sessionSettlementRepository.upsertPending({ kind: "SESSION_RELEASE", idempotencyKey: `SESSION_RELEASE:${sInFlight.id}`, sessionId: sInFlight.id, contractId: cControl.id, reason: null });
    await sessionSettlementRepository.claim(rowInFlight.id, { staleBefore: new Date(Date.now() - 2 * 60_000) });
    const sSettled = await addSession(cControl, "COMPLETED", new Date(Date.now() - DAY), { sessionDeducted: true });
    const rowSettled = await sessionSettlementRepository.upsertPending({ kind: "SESSION_RELEASE", idempotencyKey: `SESSION_RELEASE:${sSettled.id}`, sessionId: sSettled.id, contractId: cControl.id, reason: null });
    await prisma.$transaction((tx) => sessionSettlementRepository.settleOnce(rowSettled.id, tx));
    const sOrphan = await addSession(cControl, "COMPLETED", new Date(Date.now() - DAY), { sessionDeducted: true });
    const rowOrphan = await sessionSettlementRepository.upsertPending({ kind: "SESSION_RELEASE", idempotencyKey: `SESSION_RELEASE:${sOrphan.id}`, sessionId: sOrphan.id, contractId: cControl.id, reason: null });
    await prisma.sessionSettlement.update({ where: { id: rowOrphan.id }, data: { status: "FAILED", attempts: 20, lastError: "ENDED_UNSETTLED:NO_PAYMENT nothing owed" } });

    // ── endingsUnconfirmed ──────────────────────────────────────────────────────────────────────
    const endingOld = await sessionSettlementRepository.upsertPending({ kind: "CONTRACT_TERMINATION", idempotencyKey: `CONTRACT_TERMINATE:${cEnding.id}`, sessionId: null, contractId: cEnding.id, reason: "CLIENT_CANCELLED" });
    await prisma.sessionSettlement.update({ where: { id: endingOld.id }, data: { status: "FAILED", attempts: 3, lastError: "payment-service timeout" } });
    await age("session_settlements", endingOld.id, 3 * HOUR, ["created_at", "updated_at"]);
    const endingFresh = await sessionSettlementRepository.upsertPending({ kind: "CONTRACT_TERMINATION", idempotencyKey: `CONTRACT_TERMINATE:${cEndingFresh.id}`, sessionId: null, contractId: cEndingFresh.id, reason: "EXPIRED" });
    const endingSettled = await sessionSettlementRepository.upsertPending({ kind: "CONTRACT_TERMINATION", idempotencyKey: `CONTRACT_TERMINATE:${cEndingSettled.id}`, sessionId: null, contractId: cEndingSettled.id, reason: "EXPIRED" });
    await prisma.$transaction((tx) => sessionSettlementRepository.settleOnce(endingSettled.id, tx));
    await age("session_settlements", endingSettled.id, 3 * HOUR, ["created_at"]);

    // ── endedWithoutSettledEnding ───────────────────────────────────────────────────────────────
    await age("contracts", cEndedNoRow.id, 2 * HOUR, ["updated_at"]);
    await age("contracts", cEndedPending.id, 5 * HOUR, ["updated_at"]);
    const pendingEnd = await sessionSettlementRepository.upsertPending({ kind: "CONTRACT_TERMINATION", idempotencyKey: `CONTRACT_TERMINATE:${cEndedPending.id}`, sessionId: null, contractId: cEndedPending.id, reason: "CLIENT_CANCELLED" });
    await age("contracts", cEndedSettled.id, 2 * HOUR, ["updated_at"]);
    const settledEnd = await sessionSettlementRepository.upsertPending({ kind: "CONTRACT_TERMINATION", idempotencyKey: `CONTRACT_TERMINATE:${cEndedSettled.id}`, sessionId: null, contractId: cEndedSettled.id, reason: "EXPIRED" });
    await prisma.$transaction((tx) => sessionSettlementRepository.settleOnce(settledEnd.id, tx));

    // ── disputes ────────────────────────────────────────────────────────────────────────────────
    const d3 = await addSession(cDisputes, "DISPUTED", new Date(Date.now() - 20 * DAY), { disputedAt: new Date(Date.now() - 3 * DAY - HOUR), disputeReason: secretReason, disputeType: "PT_NO_SHOW_CLAIM" });
    const d11 = await addSession(cDisputes, "DISPUTED", new Date(Date.now() - 20 * DAY), { disputedAt: new Date(Date.now() - 11 * DAY - HOUR), disputeReason: secretReason });
    const d15 = await addSession(cDisputes, "DISPUTED", new Date(Date.now() - 30 * DAY), { disputedAt: new Date(Date.now() - 15 * DAY - HOUR), disputeReason: secretReason });
    await addSession(cDisputes, "CONFIRMED", new Date(Date.now() + DAY));

    const admin = tokenFor(randomUUID(), "ADMIN");
    const before = await snapshotTables();

    // ── authorisation ───────────────────────────────────────────────────────────────────────────
    assert.equal((await get("/admin/sessions/reconciliation", null)).status, 401);
    for (const role of ["CUSTOMER", "PT", "GYM_OWNER"]) {
      const r = await get("/admin/sessions/reconciliation", tokenFor(randomUUID(), role));
      assert.equal(r.status, 403, `${role} is refused`);
      assert.equal(r.body.needsAttention, undefined, "no report data in a refusal");
    }

    const res = await get("/admin/sessions/reconciliation", admin);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "no-store");
    const r = res.body;

    // needsAttention: exactly the 4 rows, CONFLICT first, then by amount / attempts; none of the controls.
    const att = r.needsAttention.items;
    assert.deepEqual(new Set(att.map((x: any) => x.id)), new Set([rowParked.id, rowConflict.id, rowCap.id, rowStuck.id]));
    assert.equal(att[0].id, rowConflict.id, "CONFLICT ranks first");
    const by = (id: string) => att.find((x: any) => x.id === id);
    assert.equal(by(rowParked.id).reason, "NEEDS_HUMAN");
    assert.equal(by(rowParked.id).errorCode, "NEEDS_RECONCILIATION");
    assert.equal(by(rowConflict.id).reason, "CONFLICT");
    assert.equal(by(rowCap.id).reason, "ATTEMPTS_AT_CAP");
    assert.equal(by(rowCap.id).errorCode, "ERROR");
    assert.equal(by(rowCap.id).attempts, 12);
    assert.equal(by(rowStuck.id).reason, "STUCK_PROCESSING");
    assert.equal(by(rowStuck.id).status, "PROCESSING");
    assert.equal(by(rowParked.id).amountAtStake, 500_000, "a session-level step: price / sessions");
    assert.equal(by(rowParked.id).contractId, cParked.id);
    assert.equal(by(rowParked.id).sessionId, sParked.id);
    for (const ctl of [rowPending.id, rowInFlight.id, rowSettled.id, rowOrphan.id]) assert.ok(!att.some((x: any) => x.id === ctl), "control row not listed");
    assert.equal(r.needsAttention.truncated, false);

    // endingsUnconfirmed: only the old, unsettled one.
    assert.deepEqual(r.endingsUnconfirmed.items.map((x: any) => x.id), [endingOld.id], "the PENDING ending of cEndedPending was recorded a moment ago: in flight");
    assert.ok(pendingEnd.id);
    const eo = r.endingsUnconfirmed.items.find((x: any) => x.id === endingOld.id);
    assert.equal(eo.contractId, cEnding.id);
    assert.equal(eo.status, "FAILED");
    assert.equal(eo.endingReason, "CLIENT_CANCELLED");
    assert.equal(eo.attempts, 3);
    assert.equal(eo.errorCode, "ERROR");
    assert.equal(eo.amountAtStake, 5_000_000, "an ending: the contract price");
    assert.ok(eo.ageMinutes >= 179 && eo.ageMinutes <= 185, `age ${eo.ageMinutes}`);
    assert.ok(!r.endingsUnconfirmed.items.some((x: any) => x.id === endingFresh.id), "an ending recorded a moment ago is in flight");
    assert.ok(!r.endingsUnconfirmed.items.some((x: any) => x.id === endingSettled.id), "a SETTLED ending is not unconfirmed");

    // endedWithoutSettledEnding: the two ended contracts without a SETTLED ending (one has no row at all, one has a PENDING row).
    const ended = r.endedWithoutSettledEnding.items;
    assert.deepEqual(ended.map((x: any) => x.contractId), [cEndedPending.id, cEndedNoRow.id], "oldest first");
    const noRow = ended.find((x: any) => x.contractId === cEndedNoRow.id);
    assert.equal(noRow.hasIntent, false);
    assert.equal(noRow.settlementStatus, null);
    assert.equal(noRow.contractStatus, "COMPLETED");
    assert.equal(noRow.amountAtStake, 5_000_000);
    const pend = ended.find((x: any) => x.contractId === cEndedPending.id);
    assert.equal(pend.hasIntent, true);
    assert.equal(pend.settlementStatus, "PENDING");
    assert.equal(pend.contractStatus, "CANCELLED");

    // disputes: oldest first, with age and SLA state.
    const disp = r.disputes.items;
    assert.deepEqual(disp.map((x: any) => x.sessionId), [d15.id, d11.id, d3.id]);
    assert.deepEqual(disp.map((x: any) => [x.ageDays, x.slaState]), [[15, "OVERDUE"], [11, "DUE_SOON"], [3, "WITHIN_SLA"]]);
    assert.equal(disp[2].disputeType, "PT_NO_SHOW_CLAIM");
    assert.equal(disp[0].sessionValue, 500_000);
    assert.equal(disp[0].contractId, cDisputes.id);
    assert.deepEqual(r.disputes.sla, { warnDays: 10, breachDays: 14 });
    assert.equal(r.params.maxAttempts, 12);

    // ── NO PII / no raw text anywhere in the payload ────────────────────────────────────────────
    for (const forbidden of [secretName, secretReason, "0901234567", "payment-service 503", "raw failure", "payment-service timeout", cParked.clientUserId, pt, "@test.local"]) {
      assert.ok(!res.text.includes(forbidden), `payload leaks ${forbidden}`);
    }
    for (const key of ["clientUserId", "ptUserId", "disputeReason", "lastError", "email", "phone", "name"]) {
      assert.ok(!new RegExp(`"${key}"`, "i").test(res.text), `payload has a ${key} field`);
    }

    // ── limit cap + truncated flag ──────────────────────────────────────────────────────────────
    const one = (await get("/admin/sessions/reconciliation?limit=1", admin)).body;
    assert.equal(one.params.limit, 1);
    assert.equal(one.needsAttention.items.length, 1);
    assert.equal(one.needsAttention.truncated, true);
    assert.equal(one.disputes.items.length, 1);
    assert.equal(one.disputes.truncated, true);
    assert.equal(one.disputes.items[0].sessionId, d15.id);
    const huge = (await get("/admin/sessions/reconciliation?limit=999999&endingMinAgeMinutes=abc", admin)).body;
    assert.equal(huge.params.limit, 200, "capped");
    assert.equal(huge.params.endingMinAgeMinutes, 15, "garbage falls back to the default");
    const zeroAge = (await get("/admin/sessions/reconciliation?endingMinAgeMinutes=0&endedMinAgeMinutes=0", admin)).body;
    assert.ok(zeroAge.endingsUnconfirmed.items.some((x: any) => x.id === endingFresh.id), "min age 0 includes the fresh ending");

    // ── the existing disputed listing still works, and nothing was written by any of the calls ──
    const legacy = await get("/admin/sessions/disputed", admin);
    assert.equal(legacy.status, 200);
    assert.equal(legacy.body.length, 3);
    assert.equal(await snapshotTables(), before, "NO row of settlements / sessions / contracts changed and no audit / notification was written");
  } finally {
    await cleanup([pt], all.map((c) => c.id));
  }
});
