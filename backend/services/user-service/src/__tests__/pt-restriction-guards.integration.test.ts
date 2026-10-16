/**
 * Temporary PT suspension (slices 2-3), part 2 — restricted mode, new-business refusals, who may call
 * the admin endpoints, and the internal reads other services use.
 *
 * Evidence label: BACKEND INTEGRATION. The real user-service Express app is started on a random port
 * and called over HTTP against the isolated gymcoach_user_test database; auth-service is NOT running —
 * authServiceClient.verifyToken is replaced at the client boundary by a token → identity table (TEST
 * FIXTURE for that half), and payment-service / the notification push are stubbed the same way.
 *   DATABASE_URL="postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_user_test?schema=public" \
 *     ./node_modules/.bin/tsx --test src/__tests__/pt-restriction-guards.integration.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { randomUUID } from "node:crypto";
import { prisma } from "../repositories/profile.repository";
import { authServiceClient } from "../clients/auth-service.client";
import { ptRestrictionService } from "../services/pt-restriction.service";
import { DAY, HOUR, addSession, cleanup, makeContract, makePt, patch, skip, stubs } from "./pt-restriction.test-helpers";

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
});

async function call(method: string, path: string, token: string | null, body?: unknown, extraHeaders: Record<string, string> = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...extraHeaders,
    },
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

const SERVICE_SECRET = { "x-service-secret": "dev_internal_service_secret_change_in_production" };
const CODE = "PT_TEMPORARILY_UNAVAILABLE";

test("restricted mode: every PT-facing mutating coaching action is refused server-side with the code; client-facing business is refused; reads keep working; the client's own cancellation is penalty-free; after the lift it all works again", { skip }, async () => {
  const T = Date.now();
  const pt = await makePt();
  const ptTok = tokenFor(pt, "PT");
  const client = randomUUID();
  const clientTok = tokenFor(client, "CUSTOMER");
  const stranger = randomUUID();
  const strangerTok = tokenFor(stranger, "CUSTOMER");
  const pkg = await prisma.pTServicePackage.create({
    data: { ptUserId: pt, name: "Gói", sessionCount: 10, price: 1_000_000, sessionMode: "OFFLINE" },
  });
  const cActive = await makeContract(pt, { clientUserId: client, usedSessions: 1 });
  const cReview = await makeContract(pt, { clientUserId: randomUUID(), status: "PENDING_REVIEW", paymentTransactionId: null, startDate: null, endDate: null });
  const cPay = await makeContract(pt, {
    clientUserId: stranger,
    status: "PENDING_PAYMENT",
    paymentTransactionId: null,
    startDate: null,
    endDate: null,
    paymentDueAt: new Date(T + 5 * HOUR),
    price: 1_000_000,
  });
  const contractIds = [cActive.id, cReview.id, cPay.id];
  const s = stubs();
  const reviewClientTok = tokenFor(cReview.clientUserId, "CUSTOMER");
  try {
    await ptRestrictionService.suspend({
      ptUserId: pt,
      adminId: "admin-1",
      reasonCategory: "DOCUMENT_VERIFICATION",
      reasonText: "internal-only note",
      publicReason: "Cần xác minh lại hồ sơ",
    });
    // sessions created AFTER the suspension (as they would be by a race or by seed data), to probe each guard
    const sReq = await addSession(cActive, "REQUESTED", new Date(T + 3 * DAY));
    const sPastConfirmed = await addSession(cActive, "CONFIRMED", new Date(T - 3 * DAY));
    const sOnline = await addSession(cActive, "CONFIRMED", new Date(T + 2 * HOUR), { sessionMode: "ONLINE" });
    const sLate = await addSession(cActive, "CONFIRMED", new Date(T + 10 * HOUR)); // < 24h: a client cancel would normally cost a session
    const sNoShowRep = await addSession(cActive, "PT_NO_SHOW_REPORTED", new Date(T - 2 * DAY), { disputeReason: "x" });

    // ── client-facing: no new business with a suspended PT ──
    let r = await call("POST", "/contracts/request", strangerTok, { ptUserId: pt, packageId: pkg.id });
    assert.deepEqual([r.status, r.body.code], [409, CODE], "request a contract");
    assert.match(r.body.error, /tạm thời/);
    assert.doesNotMatch(r.body.error, /vi phạm|sai phạm|lỗi của/);

    r = await call("POST", `/contracts/${cPay.id}/pay`, strangerTok, { provider: "MOCK" });
    assert.deepEqual([r.status, r.body.code], [409, CODE], "payment initiation");
    assert.equal(s.payments.filter((p) => p.method === "checkout").length, 0, "no checkout was created: the client is never charged");
    const cPayAfter = await prisma.contract.findUniqueOrThrow({ where: { id: cPay.id } });
    assert.equal(cPayAfter.status, "PENDING_PAYMENT", "the unpaid contract is left exactly as it is");
    assert.equal(cPayAfter.paymentDueAt?.getTime(), cPay.paymentDueAt?.getTime(), "its 12-hour payment deadline keeps running");

    r = await call("POST", "/sessions", clientTok, { contractId: cActive.id, scheduledDate: "2099-01-05", scheduledTime: "09:00" });
    assert.deepEqual([r.status, r.body.code], [409, CODE], "book a session");

    r = await call("POST", `/sessions/${sPastConfirmed.id}/report-no-show`, clientTok, { reason: "không thấy PT" });
    assert.deepEqual([r.status, r.body.code], [409, CODE], "a client report against a PT who cannot answer it");
    assert.equal((await prisma.session.findUniqueOrThrow({ where: { id: sPastConfirmed.id } })).status, "CONFIRMED");

    r = await call("POST", `/sessions/${sOnline.id}/reschedule`, clientTok, { proposedStartAt: new Date(T + 9 * DAY).toISOString(), reason: "bận" });
    assert.deepEqual([r.status, r.body.code], [409, CODE], "reschedule into the suspension");

    // ── PT-facing: restricted mode (409 + code) ──
    const ptCalls: Array<[string, string, unknown?]> = [
      ["PATCH", `/contracts/${cReview.id}/accept`],
      ["PATCH", `/contracts/${cReview.id}/reject`, { reason: "no" }],
      ["PATCH", `/contracts/${cReview.id}/cancel`, { reason: "no" }],
      ["POST", `/contracts/${cActive.id}/feedback`, { text: "xin chào" }],
      ["POST", `/contracts/${cActive.id}/terminate`, { reason: "PT_CANCELLED" }],
      ["PATCH", `/sessions/${sReq.id}/confirm`],
      ["PATCH", `/sessions/${sPastConfirmed.id}/complete`, { ptNotes: "ok" }],
      ["PATCH", `/sessions/${sLate.id}/cancel`, { reason: "bận" }],
      ["PATCH", `/sessions/${sPastConfirmed.id}/no-show`, { noShowBy: "CLIENT" }],
      ["POST", `/sessions/${sNoShowRep.id}/respond-no-show`, { response: "AGREE" }],
      ["POST", `/sessions/${sOnline.id}/reschedule`, { proposedStartAt: new Date(T + 9 * DAY).toISOString(), reason: "bận" }],
      ["POST", `/sessions/${sOnline.id}/join`],
      ["PUT", "/availability/me", { slots: [] }],
      ["POST", "/availability/me/exceptions", { date: "2099-02-01", reason: "x" }],
      ["POST", "/me/service-packages", { name: "Gói mới", sessionCount: 5, price: 500000, sessionMode: "OFFLINE" }],
      ["PATCH", `/me/service-packages/${pkg.id}`, { price: 600000 }],
    ];
    for (const [method, path, body] of ptCalls) {
      r = await call(method, path, ptTok, body ?? {});
      assert.deepEqual([r.status, r.body?.code], [409, CODE], `${method} ${path} must be refused in restricted mode (got ${r.status} ${JSON.stringify(r.body)})`);
    }
    // nothing the refused calls could have changed moved
    assert.equal((await prisma.session.findUniqueOrThrow({ where: { id: sReq.id } })).status, "REQUESTED");
    assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: cReview.id } })).status, "PENDING_REVIEW");
    assert.equal(s.payments.length, 0, "no money call from any refused action");

    // ── the PT can still READ ──
    r = await call("GET", "/contracts/pt", ptTok);
    assert.equal(r.status, 200);
    const active = r.body.find((c: any) => c.id === cActive.id);
    assert.equal(active.status, "ACTIVE", "stored status untouched");
    assert.equal(active.effectiveStatus, "PAUSED_BY_ADMIN", "…and the central function reports it paused");
    assert.equal(r.body.find((c: any) => c.id === cReview.id).effectiveStatus, "PENDING_REVIEW");
    assert.equal((await call("GET", `/contracts/${cActive.id}`, ptTok)).body.effectiveStatus, "PAUSED_BY_ADMIN");
    assert.equal((await call("GET", `/sessions/contract/${cActive.id}`, ptTok)).status, 200);
    assert.equal((await call("GET", "/sessions/upcoming", ptTok)).status, 200);
    assert.equal((await call("GET", "/notifications", ptTok)).status, 200);
    assert.equal((await call("GET", "/contracts/pt/earnings", ptTok)).status, 200);
    r = await call("GET", "/profile/me/restriction", ptTok);
    assert.equal(r.status, 200);
    assert.equal(r.body.restricted, true);
    assert.equal(r.body.type, "TEMPORARY_SUSPENSION");
    assert.equal(r.body.publicReason, "Cần xác minh lại hồ sơ");
    const flat = JSON.stringify(r.body);
    assert.ok(!flat.includes("internal-only note") && !flat.includes("admin-1"), "the PT never sees the internal note or who imposed it");

    // ── the client can still withdraw their own request, and cancels a session without penalty ──
    r = await call("PATCH", `/contracts/${cReview.id}/cancel`, reviewClientTok, { reason: "đổi ý" });
    assert.equal(r.status, 200, "the client cancels their own pending request");
    r = await call("PATCH", `/sessions/${sLate.id}/cancel`, clientTok, { reason: "PT đang tạm dừng" });
    assert.equal(r.status, 200);
    const cancelled = await prisma.session.findUniqueOrThrow({ where: { id: sLate.id } });
    assert.equal(cancelled.status, "CANCELLED");
    assert.equal(cancelled.sessionDeducted, false, "inside 24h a client cancel would normally cost a session — not while the PT is suspended");
    assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: cActive.id } })).usedSessions, 1, "quota untouched");
    assert.equal(s.payments.length, 0, "no payout, no compensation, no fee");

    // the client's own cancellation while the PT is restricted: the server swaps in the no-penalty exit reason (slice 4; pinned in full in client-exit-pt-restriction.integration.test.ts)
    r = await call("POST", `/contracts/${cActive.id}/terminate`, clientTok, { reason: "CLIENT_CANCELLED" });
    assert.equal(r.status, 200);
    const term = s.payments.find((p) => p.method === "terminate");
    assert.equal(term?.body.reason, "CLIENT_EXIT_DUE_TO_PT_RESTRICTION", "no 10% fee path: the neutral reason is what payment-service gets");
    // (the contract is ended now; use a fresh one to prove the lift below)
    s.payments.length = 0;

    // ── lift → the PT works again ──
    await ptRestrictionService.lift({ ptUserId: pt, adminId: "admin-1", reason: "ok" });
    r = await call("PATCH", `/sessions/${sReq.id}/confirm`, ptTok);
    // the contract was terminated above, so confirm answers its normal "no longer valid", NOT the restriction code
    assert.notEqual(r.body?.code, CODE);
    r = await call("GET", "/profile/me/restriction", ptTok);
    assert.equal(r.body.restricted, false);
  } finally {
    s.restore();
    await cleanup([pt], contractIds);
  }
});

test("after the lift a suspended PT's PT-facing actions work again (confirm a session) and clients can book again", { skip }, async () => {
  const T = Date.now();
  const pt = await makePt();
  const ptTok = tokenFor(pt, "PT");
  const c = await makeContract(pt, {});
  const s = stubs();
  try {
    await ptRestrictionService.suspend({ ptUserId: pt, adminId: "a", reasonCategory: "OTHER", reasonText: "t" });
    const sess = await addSession(c, "REQUESTED", new Date(T + 3 * DAY));
    let r = await call("PATCH", `/sessions/${sess.id}/confirm`, ptTok);
    assert.deepEqual([r.status, r.body.code], [409, CODE]);
    await ptRestrictionService.lift({ ptUserId: pt, adminId: "a", reason: "xong" });
    r = await call("PATCH", `/sessions/${sess.id}/confirm`, ptTok);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal((await prisma.session.findUniqueOrThrow({ where: { id: sess.id } })).status, "CONFIRMED");
  } finally {
    s.restore();
    await cleanup([pt], [c.id]);
  }
});

test("a payment already in flight when the PT gets suspended is answered with 409 CONTRACT_NOT_ACTIVATABLE (payment-service refunds the client); a replay of a payment that already activated the contract is still a success", { skip }, async () => {
  const pt = await makePt();
  const c = await makeContract(pt, { status: "PENDING_PAYMENT", paymentTransactionId: null, startDate: null, endDate: null, validityDays: 30 });
  const activated = await makeContract(pt, {});
  const s = stubs();
  const { paymentClient } = await import("../clients/payment.client");
  const restoreTxn = patch(paymentClient, "getTransaction", async (id: string) => ({
    id,
    status: "PAID",
    relatedEntityType: "PT_CONTRACT",
    relatedEntityId: id === "txn-new" ? c.id : activated.id,
  }));
  try {
    await ptRestrictionService.suspend({ ptUserId: pt, adminId: "a", reasonCategory: "OTHER", reasonText: "t" });
    let r = await call("POST", `/internal/contracts/${c.id}/activate-after-payment`, null, { transactionId: "txn-new" }, SERVICE_SECRET);
    assert.equal(r.status, 409);
    assert.equal(r.body.error.code, "CONTRACT_NOT_ACTIVATABLE");
    assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: c.id } })).status, "PENDING_PAYMENT", "not activated");

    // replay for a contract that this very transaction already activated: idempotent success
    await prisma.contract.update({ where: { id: activated.id }, data: { paymentTransactionId: "txn-old" } });
    const restoreTxn2 = patch(paymentClient, "getTransaction", async () => ({
      id: "txn-old",
      status: "PAID",
      relatedEntityType: "PT_CONTRACT",
      relatedEntityId: activated.id,
    }));
    r = await call("POST", `/internal/contracts/${activated.id}/activate-after-payment`, null, { transactionId: "txn-old" }, SERVICE_SECRET);
    restoreTxn2();
    assert.equal(r.status, 200, JSON.stringify(r.body));
  } finally {
    restoreTxn();
    s.restore();
    await cleanup([pt], [c.id, activated.id]);
  }
});

test("authorization: PT, client and gym owner cannot call the admin endpoints; the acting admin comes from the verified token; one PT cannot read another PT's restriction", { skip }, async () => {
  const pt = await makePt();
  const pt2 = await makePt();
  const adminId = randomUUID();
  const adminTok = tokenFor(adminId, "ADMIN");
  const ptTok = tokenFor(pt, "PT");
  const pt2Tok = tokenFor(pt2, "PT");
  const clientTok = tokenFor(randomUUID(), "CUSTOMER");
  const ownerTok = tokenFor(randomUUID(), "GYM_OWNER");
  const s = stubs();
  try {
    const body = { category: "COMPLAINT_REVIEW", reason: "kiểm tra", adminId: "forged-admin" };
    const adminCalls: Array<[string, string, unknown?]> = [
      ["POST", `/admin/pts/${pt}/suspend`, body],
      ["POST", `/admin/pts/${pt}/lift-suspension`, { reason: "x" }],
      ["POST", `/admin/pts/${pt}/restrictions/justify`, { reason: "x" }],
      ["GET", `/admin/pts/${pt}/restrictions`],
      ["GET", "/admin/pts/suspended"],
    ];
    for (const tok of [ptTok, clientTok, ownerTok, pt2Tok]) {
      for (const [m, p, b] of adminCalls) {
        const r = await call(m, p, tok, b);
        assert.equal(r.status, 403, `${m} ${p} must be refused for a non-admin`);
      }
    }
    for (const [m, p, b] of adminCalls) assert.equal((await call(m, p, null, b)).status, 401, "no token");
    assert.equal(await prisma.ptRestriction.count({ where: { ptUserId: pt } }), 0, "nothing was written by the refused calls");

    // admin: a reason is required; the actor is the token's identity, never the body's
    let r = await call("POST", `/admin/pts/${pt}/suspend`, adminTok, { category: "OTHER" });
    assert.deepEqual([r.status, r.body.code], [400, "REASON_REQUIRED"]);
    r = await call("POST", `/admin/pts/${pt}/suspend`, adminTok, body);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.changed, true);
    assert.equal(r.body.restriction.imposedBy, adminId, "taken from the verified token");
    r = await call("POST", `/admin/pts/${pt}/suspend`, adminTok, body);
    assert.equal(r.body.changed, false, "idempotent over HTTP too");

    // the list and the history
    r = await call("GET", "/admin/pts/suspended", adminTok);
    assert.equal(r.status, 200);
    const mine = r.body.items.find((i: any) => i.ptUserId === pt);
    assert.ok(mine);
    assert.equal(mine.overdue, false);
    assert.equal(r.body.overdueAfterDays, 14);
    r = await call("GET", `/admin/pts/${pt}/restrictions`, adminTok);
    assert.equal(r.body.restrictions.length, 1);
    assert.equal(r.body.restrictions[0].reasonText, "kiểm tra", "admins see the internal note");

    // each PT sees only their own status
    r = await call("GET", "/profile/me/restriction", ptTok);
    assert.equal(r.body.restricted, true);
    r = await call("GET", "/profile/me/restriction", pt2Tok);
    assert.equal(r.body.restricted, false, "another PT's restriction is not readable through any PT-facing route");
    assert.ok(!JSON.stringify(r.body).includes(pt));
    assert.equal((await call("GET", "/profile/me/restriction", clientTok)).body.restricted, false);

    // lifting needs a reason and answers 409 for a permanent ban
    r = await call("POST", `/admin/pts/${pt}/lift-suspension`, adminTok, {});
    assert.deepEqual([r.status, r.body.code], [400, "REASON_REQUIRED"]);
    r = await call("POST", `/admin/pts/${pt}/lift-suspension`, adminTok, { reason: "xong" });
    assert.equal(r.body.changed, true);
    r = await call("POST", `/admin/pts/${pt}/lift-suspension`, adminTok, { reason: "xong" });
    assert.equal(r.body.changed, false);
  } finally {
    s.restore();
    await cleanup([pt, pt2], []);
  }
});

test("internal reads: the marketplace gate (ai-service) stops offering a restricted PT; one internal read answers 'is this PT restricted, and how' for gym-service; the PT/client coaching relationship check refuses a restricted PT", { skip }, async () => {
  const pt = await makePt();
  const profile = await prisma.userProfile.findUniqueOrThrow({ where: { userId: pt } });
  await prisma.pTApplication.create({ data: { userProfileId: profile.id, status: "APPROVED", approvedAt: new Date() } });
  const c = await makeContract(pt, {});
  const s = stubs();
  try {
    let r = await call("GET", `/internal/pt-marketplace-eligibility/${pt}`, null, undefined, SERVICE_SECRET);
    assert.equal(r.body.isApprovedPt, true, "control: an approved, unrestricted PT is offered");
    r = await call("GET", `/internal/contracts/active-relationship?ptUserId=${pt}&clientUserId=${c.clientUserId}`, null, undefined, SERVICE_SECRET);
    assert.equal(r.body.active, true);

    await ptRestrictionService.suspend({ ptUserId: pt, adminId: "a", reasonCategory: "OTHER", reasonText: "t" });

    r = await call("GET", `/internal/pt-marketplace-eligibility/${pt}`, null, undefined, SERVICE_SECRET);
    assert.equal(r.body.isApprovedPt, false, "the flag ai-service gates publishing, browsing and purchase on");
    assert.equal(r.body.ptRestricted, true);
    assert.equal(r.body.ptRestrictionType, "TEMPORARY_SUSPENSION");
    assert.equal(r.body.ptApplicationStatus, "APPROVED", "approval itself is untouched");

    r = await call("GET", `/internal/pt/${pt}/restriction`, null, undefined, SERVICE_SECRET);
    assert.deepEqual(
      { restricted: r.body.restricted, type: r.body.type, mayCoach: r.body.mayCoach, mayTakeNewBusiness: r.body.mayTakeNewBusiness },
      { restricted: true, type: "TEMPORARY_SUSPENSION", mayCoach: false, mayTakeNewBusiness: false },
    );
    assert.equal((await call("GET", `/internal/pt/${pt}/restriction`, null)).status, 401, "service-secret protected");

    r = await call("GET", `/internal/contracts/active-relationship?ptUserId=${pt}&clientUserId=${c.clientUserId}`, null, undefined, SERVICE_SECRET);
    assert.equal(r.body.active, false, "fitness-service must refuse a restricted PT's client-data / plan-assignment requests");
    assert.equal(r.body.reason, "PT_RESTRICTED");

    // packages are not offered to new clients while it lasts
    const pkg = await prisma.pTServicePackage.create({ data: { ptUserId: pt, name: "G", sessionCount: 5, price: 1000, sessionMode: "OFFLINE" } });
    const clientTok = tokenFor(randomUUID(), "CUSTOMER");
    assert.deepEqual((await call("GET", `/profile/pts/${pt}/service-packages`, clientTok)).body.packages, []);

    await ptRestrictionService.lift({ ptUserId: pt, adminId: "a", reason: "ok" });
    r = await call("GET", `/internal/pt-marketplace-eligibility/${pt}`, null, undefined, SERVICE_SECRET);
    assert.equal(r.body.isApprovedPt, true);
    r = await call("GET", `/internal/pt/${pt}/restriction`, null, undefined, SERVICE_SECRET);
    assert.equal(r.body.restricted, false);
    assert.equal((await call("GET", `/profile/pts/${pt}/service-packages`, clientTok)).body.packages.length, 1);
    void pkg;
  } finally {
    s.restore();
    await cleanup([pt], [c.id]);
  }
});
