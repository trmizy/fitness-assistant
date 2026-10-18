/**
 * CONTRACT-scope PT restriction (owner's decision D38, Phase 2.5A), part 1 — behaviour.
 *
 * PT An has four ACTIVE contracts (Bình, Chi, Dũng, Em). The admin restricts ONLY An-Bình. The suites
 * prove, against a real database: An keeps teaching/booking/earning on the other three and can take new
 * contracts; An cannot coach Bình's contract and Bình cannot book on it; only Bình's contract is
 * extended at the lift; Bình may leave without a fee (unresolved sessions held, not refunded); the
 * combined account + contract state; the sweeps and the idle clock; who is notified.
 *
 * Evidence label: BACKEND INTEGRATION. The real user-service Express app runs on a random port against
 * the isolated gymcoach_user_test database. auth-service is NOT running (token → identity table = TEST
 * FIXTURE) and payment-service is NOT running: every paymentClient money method is replaced at the
 * client boundary by stubs() (TEST FIXTURE) - so "earns normally" means "the release call was sent with
 * the right party", not a real ledger movement. Notifications are captured, not pushed.
 *   DATABASE_URL="postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_user_test?schema=public" \
 *     ./node_modules/.bin/tsx --test src/__tests__/pt-restriction-contract-scope.integration.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../repositories/profile.repository";
import { contractRepository } from "../repositories/contract.repository";
import { paymentClient } from "../clients/payment.client";
import { bookingService } from "../services/booking.service";
import { contractService } from "../services/contract.service";
import { runAutoConfirm } from "../services/session-autoconfirm.service";
import { runRoomCloseResolution } from "../services/room-close-resolution.service";
import {
  activeRestrictedContractIds,
  activeRestrictedPtUserIds,
  assertPtAcceptsNewBusiness,
  getActiveRestriction,
  getEffectiveContractStatus,
  ptRestrictionService,
} from "../services/pt-restriction.service";
import { DAY, HOUR, addSession, approvePtApplication, cleanup, flagMatchesRecord, makeContract, makePt, patch, skip, stubs } from "./pt-restriction.test-helpers";
import {
  ACCOUNT_CODE,
  ADMIN,
  CONTRACT_CODE,
  NAMES,
  makeAn,
  openSlotFor,
  startApp,
  tokenFor,
  type App,
} from "./pt-contract-scope.test-helpers";

let app: App;
test.before(async () => {
  app = await startApp();
});
test.after(async () => {
  await app.close();
});

const LONG_AGO = new Date("2000-01-01T00:00:00.000Z");
const SECRET = "khiếu nại riêng của Bình - nội dung nhạy cảm";

const restrictBinh = (pt: string, contractId: string, at?: Date) =>
  ptRestrictionService.restrictContract({
    ptUserId: pt,
    contractId,
    adminId: ADMIN,
    reasonCategory: "COMPLAINT_REVIEW",
    reasonText: SECRET,
    publicReason: "Đang xem xét một phản ánh",
    at,
  });
const suspendAn = (pt: string, at?: Date) =>
  ptRestrictionService.suspend({ ptUserId: pt, adminId: ADMIN, reasonCategory: "CONDUCT_REVIEW", reasonText: "nội bộ", at });

async function refusedWith(promise: Promise<unknown>): Promise<any> {
  try {
    await promise;
  } catch (e) {
    return e;
  }
  assert.fail("expected a refusal");
}

// ── (1-4, 16) only An-Bình restricted ───────────────────────────────────────────────────────────

test("(1-4, 16) four contracts, only An-Bình restricted: Chi/Dũng/Em book, confirm, complete and earn normally and An takes a new contract; An cannot coach Bình and Bình cannot book; Bình's sessions are called off administratively, unresolved ones are left, only An and Bình are told", { skip }, async () => {
  const T = Date.now();
  const { pt, contracts: c, ids } = await makeAn();
  const ptTok = tokenFor(pt, "PT");
  const tok = Object.fromEntries(NAMES.map((n) => [n, tokenFor(c[n].clientUserId, "CUSTOMER")])) as Record<(typeof NAMES)[number], string>;
  const stranger = randomUUID();
  const strangerTok = tokenFor(stranger, "CUSTOMER");
  const slot = await openSlotFor(pt);
  const slot2 = await openSlotFor(pt, 31);
  const pkg = await prisma.pTServicePackage.create({
    data: { ptUserId: pt, name: "Gói mới", sessionCount: 10, price: 1_000_000, sessionMode: "OFFLINE" },
  });
  // The public package list needs the PT to be publicly visible (isPT + APPROVED application, plan §12.7).
  await approvePtApplication(pt);
  const s = stubs();
  try {
    // fixtures: every contract has an upcoming REQUESTED and CONFIRMED session
    const req = {} as Record<string, any>;
    const conf = {} as Record<string, any>;
    for (const n of NAMES) {
      req[n] = await addSession(c[n], "REQUESTED", new Date(T + 3 * DAY));
      conf[n] = await addSession(c[n], "CONFIRMED", new Date(T + 4 * DAY));
    }
    // Bình additionally has the three kinds the restriction must NOT touch
    const binhPending = await addSession(c.binh, "PENDING_CLIENT_CONFIRMATION", new Date(T - 2 * DAY), { clientConfirmDeadline: new Date(T + 1 * DAY) });
    const binhDisputed = await addSession(c.binh, "DISPUTED", new Date(T - 5 * DAY), { disputeReason: "x" });
    const binhPastConfirmed = await addSession(c.binh, "CONFIRMED", new Date(T - 3 * HOUR)); // ended; the PT would now report it done
    const binhNoShowRep = await addSession(c.binh, "PT_NO_SHOW_REPORTED", new Date(T - 2 * DAY), { disputeReason: "y" });
    const dungPastConfirmed = await addSession(c.dung, "CONFIRMED", new Date(T - 3 * HOUR));

    // ── the admin restricts An-Bình only ──
    const r = await restrictBinh(pt, c.binh.id);
    assert.equal(r.changed, true);
    assert.equal(r.restriction.scope, "CONTRACT");
    assert.equal(r.restriction.contractId, c.binh.id);
    assert.equal(r.restriction.type, "TEMPORARY_SUSPENSION");

    // An is NOT suspended: no flag, no account restriction, still in no list of restricted PTs
    assert.equal((await prisma.userProfile.findUniqueOrThrow({ where: { userId: pt } })).ptSuspended, false);
    assert.ok(await flagMatchesRecord(pt));
    assert.equal(await getActiveRestriction(pt), null);
    assert.ok(!(await activeRestrictedPtUserIds()).includes(pt));
    assert.deepEqual((await activeRestrictedContractIds()).filter((id) => ids.includes(id)), [c.binh.id]);

    // effective status: only Bình's is paused; the stored status of all four is untouched
    assert.equal(await getEffectiveContractStatus(c.binh), "PAUSED_BY_ADMIN");
    for (const n of ["chi", "dung", "em"] as const) assert.equal(await getEffectiveContractStatus(c[n]), "ACTIVE");
    let res = await app.call("GET", "/contracts/pt", ptTok);
    assert.equal(res.status, 200);
    for (const n of NAMES) {
      const row = res.body.find((x: any) => x.id === c[n].id);
      assert.equal(row.status, "ACTIVE", "the stored status never changes");
      assert.equal(row.effectiveStatus, n === "binh" ? "PAUSED_BY_ADMIN" : "ACTIVE", n);
    }

    // sessions: Bình's not-yet-happened ones are called off as an administrative interruption
    for (const id of [req.binh.id, conf.binh.id]) {
      const row = await prisma.session.findUniqueOrThrow({ where: { id } });
      assert.equal(row.status, "CANCELLED");
      assert.equal(row.cancelledBy, "SYSTEM", "never the PT's id: not a PT cancellation");
      assert.equal(row.ptAtFault, false);
      assert.equal(row.sessionDeducted, false, "quota kept");
    }
    // ... the ones awaiting confirmation / disputed / a no-show report / already ended are NOT touched
    assert.equal((await prisma.session.findUniqueOrThrow({ where: { id: binhPending.id } })).status, "PENDING_CLIENT_CONFIRMATION");
    assert.equal((await prisma.session.findUniqueOrThrow({ where: { id: binhDisputed.id } })).status, "DISPUTED");
    assert.equal((await prisma.session.findUniqueOrThrow({ where: { id: binhNoShowRep.id } })).status, "PT_NO_SHOW_REPORTED");
    assert.equal((await prisma.session.findUniqueOrThrow({ where: { id: binhPastConfirmed.id } })).status, "CONFIRMED");
    // ... and the other three contracts' sessions are exactly as they were
    for (const n of ["chi", "dung", "em"] as const) {
      assert.equal((await prisma.session.findUniqueOrThrow({ where: { id: req[n].id } })).status, "REQUESTED", n);
      assert.equal((await prisma.session.findUniqueOrThrow({ where: { id: conf[n].id } })).status, "CONFIRMED", n);
    }
    // no money, no quota, no contract change
    assert.equal(s.payments.length, 0, "no money call");
    const binhAfter = await prisma.contract.findUniqueOrThrow({ where: { id: c.binh.id } });
    assert.equal(binhAfter.usedSessions, 0);
    assert.equal(binhAfter.endDate!.getTime(), c.binh.endDate!.getTime(), "the end date moves only at the lift");

    // notifications: exactly An and Bình; neutral wording; no complaint content; nobody else
    assert.deepEqual(new Set(s.notified.map((n) => n.userId)), new Set([pt, c.binh.clientUserId]));
    for (const n of s.notified) {
      assert.equal(n.eventType, "CONTRACT_PAUSED_PT_SUSPENDED");
      assert.ok(n.text.includes("Gói binh"), "names the contract's package");
      assert.ok(!n.text.includes("nhạy cảm") && !n.text.includes("COMPLAINT") && !n.text.includes("khiếu nại"), "no complaint content");
    }
    const clientNotice = s.notified.find((n) => n.userId === c.binh.clientUserId);
    assert.match(clientNotice.text, /hoàn lại toàn bộ giá trị các buổi chưa tập, không mất phí/);
    assert.match(clientNotice.text, /2 buổi sắp tới/, "two upcoming sessions were called off");
    // the audit: who, what, why
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "PT_CONTRACT_RESTRICTED", entityId: c.binh.id } });
    assert.equal(audit.actorUserId, ADMIN);

    // ── An acts freely on the other three (HTTP, as An) ──
    res = await app.call("PATCH", `/sessions/${req.chi.id}/confirm`, ptTok);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal((await prisma.session.findUniqueOrThrow({ where: { id: req.chi.id } })).status, "CONFIRMED");

    res = await app.call("PATCH", `/sessions/${dungPastConfirmed.id}/complete`, ptTok, { ptNotes: "tốt" });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    await bookingService.clientConfirmSession(dungPastConfirmed.id, c.dung.clientUserId);
    assert.equal((await prisma.session.findUniqueOrThrow({ where: { id: dungPastConfirmed.id } })).status, "COMPLETED");
    assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: c.dung.id } })).usedSessions, 1, "Dũng's session counted");
    assert.ok(
      s.payments.some((p) => p.method === "releaseSession" && p.body.parties?.ptUserId === pt),
      "An's income from Dũng's session was released (stub of the ledger call)",
    );

    res = await app.call("POST", "/sessions", tok.em, { contractId: c.em.id, ...slot });
    assert.equal(res.status, 201, `Em books: ${JSON.stringify(res.body)}`);

    // An is still discoverable and takes a new contract
    await assertPtAcceptsNewBusiness(pt, "REQUEST_CONTRACT");
    res = await app.call("GET", `/profile/pts/${pt}/service-packages`, strangerTok);
    assert.equal(res.status, 200);
    assert.equal(res.body.packages?.length, 1, "his packages are still listed");
    res = await app.call("POST", "/contracts/request", strangerTok, { ptUserId: pt, packageId: pkg.id });
    assert.equal(res.status, 201, `a new contract request is accepted: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.status, "PENDING_REVIEW");
    ids.push(res.body.id);

    // ── An cannot coach Bình's contract (409 + the contract code) ──
    const binhReqAfter = await addSession(c.binh, "REQUESTED", new Date(T + 5 * DAY));
    const binhOnline = await addSession(c.binh, "CONFIRMED", new Date(T + 2 * HOUR), { sessionMode: "ONLINE" });
    const ptCalls: Array<[string, string, unknown?]> = [
      ["PATCH", `/sessions/${binhReqAfter.id}/confirm`],
      ["PATCH", `/sessions/${binhPastConfirmed.id}/complete`, { ptNotes: "ok" }],
      ["PATCH", `/sessions/${binhReqAfter.id}/cancel`, { reason: "bận" }],
      ["PATCH", `/sessions/${binhPastConfirmed.id}/no-show`, { noShowBy: "CLIENT" }],
      ["POST", `/sessions/${binhNoShowRep.id}/respond-no-show`, { response: "AGREE" }],
      ["POST", `/sessions/${binhOnline.id}/reschedule`, { proposedStartAt: new Date(T + 9 * DAY).toISOString(), reason: "bận" }],
      ["POST", `/sessions/${binhOnline.id}/join`],
      ["POST", `/contracts/${c.binh.id}/feedback`, { text: "xin chào" }],
      ["POST", `/contracts/${c.binh.id}/terminate`, { reason: "PT_CANCELLED" }],
    ];
    for (const [method, path, body] of ptCalls) {
      res = await app.call(method, path, ptTok, body ?? {});
      assert.deepEqual([res.status, res.body?.code], [409, CONTRACT_CODE], `${method} ${path} (got ${res.status} ${JSON.stringify(res.body)})`);
    }
    assert.equal((await prisma.session.findUniqueOrThrow({ where: { id: binhReqAfter.id } })).status, "REQUESTED", "nothing moved");
    assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: c.binh.id } })).status, "ACTIVE");

    // ... and Bình cannot book, reschedule or report on it; the message blames nobody
    res = await app.call("POST", "/sessions", tok.binh, { contractId: c.binh.id, ...slot });
    assert.deepEqual([res.status, res.body.code], [409, CONTRACT_CODE]);
    assert.match(res.body.error, /Hợp đồng của bạn đang tạm dừng/);
    assert.doesNotMatch(res.body.error, /huấn luyện viên|vi phạm|lỗi/i);
    res = await app.call("POST", `/sessions/${binhOnline.id}/reschedule`, tok.binh, { proposedStartAt: new Date(T + 9 * DAY).toISOString(), reason: "bận" });
    assert.deepEqual([res.status, res.body.code], [409, CONTRACT_CODE]);
    res = await app.call("POST", `/sessions/${binhPastConfirmed.id}/report-no-show`, tok.binh, { reason: "không thấy PT" });
    assert.deepEqual([res.status, res.body.code], [409, CONTRACT_CODE]);

    // the client of ANOTHER contract still reschedules/books (no collateral damage)
    res = await app.call("POST", "/sessions", tok.chi, { contractId: c.chi.id, ...slot2 });
    assert.equal(res.status, 201, JSON.stringify(res.body));

    // ── what each side may see ──
    res = await app.call("GET", "/contracts/client", tok.binh);
    const binhView = res.body.find((x: any) => x.id === c.binh.id);
    assert.equal(binhView.effectiveStatus, "PAUSED_BY_ADMIN");
    assert.equal(binhView.canExitWithoutPenalty, true);
    assert.ok(!JSON.stringify(res.body).includes("nhạy cảm") && !JSON.stringify(res.body).includes("COMPLAINT_REVIEW"), "the client never sees the reason");
    res = await app.call("GET", "/contracts/client", tok.chi);
    const chiView = res.body.find((x: any) => x.id === c.chi.id);
    assert.deepEqual([chiView.effectiveStatus, chiView.canExitWithoutPenalty], ["ACTIVE", false]);

    res = await app.call("GET", "/profile/me/restriction", ptTok);
    assert.equal(res.status, 200);
    assert.deepEqual([res.body.restricted, res.body.mode], [false, "NORMAL"], "An as a whole is not restricted");
    assert.equal(res.body.contractRestrictions.length, 1);
    assert.equal(res.body.contractRestrictions[0].contractId, c.binh.id);
    assert.equal(res.body.contractRestrictions[0].publicReason, "Đang xem xét một phản ánh");
    const own = JSON.stringify(res.body);
    assert.ok(!own.includes("nhạy cảm") && !own.includes(ADMIN), "the PT never sees the internal note or who imposed it");
  } finally {
    s.restore();
    await prisma.pTAvailability.deleteMany({ where: { ptUserId: pt } });
    await cleanup([pt], ids);
  }
});

// ── (5, 9) the lift: only Bình's contract is extended, and it runs again ─────────────────────────

test("(5, 9) lifting the contract restriction: ONLY Bình's end date and confirmation window are given back, Bình books again, only An and Bình hear it, a repeat changes nothing", { skip }, async () => {
  const T = Date.now();
  const { pt, contracts: c, ids } = await makeAn({ startDate: new Date(T - 40 * DAY), endDate: new Date(T + 60 * DAY) });
  const ptTok = tokenFor(pt, "PT");
  const binhTok = tokenFor(c.binh.clientUserId, "CUSTOMER");
  const slot = await openSlotFor(pt);
  const s = stubs();
  try {
    const R = new Date(T - 10 * DAY);
    const pendingBinh = await addSession(c.binh, "PENDING_CLIENT_CONFIRMATION", new Date(T - 12 * DAY), { clientConfirmDeadline: new Date(T + 2 * DAY) });
    const pendingChi = await addSession(c.chi, "PENDING_CLIENT_CONFIRMATION", new Date(T - 12 * DAY), { clientConfirmDeadline: new Date(T + 2 * DAY) });
    await restrictBinh(pt, c.binh.id, R);
    s.notified.length = 0;

    const lifted = await ptRestrictionService.liftContractRestriction({ ptUserId: pt, contractId: c.binh.id, adminId: "admin-2", reason: "Đã xem xét xong", at: new Date(T) });
    assert.equal(lifted.changed, true);
    assert.equal(lifted.stillPausedByAccount, false);
    assert.equal(lifted.summary!.extendedContracts.length, 1, "exactly one contract extended");
    assert.equal(lifted.summary!.extendedContracts[0].contractId, c.binh.id);
    assert.equal(lifted.summary!.extendedContracts[0].blockedMs, 10 * DAY);

    // Bình: +10 days. Chi/Dũng/Em: byte-for-byte what they were.
    assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: c.binh.id } })).endDate!.getTime(), c.binh.endDate!.getTime() + 10 * DAY);
    for (const n of ["chi", "dung", "em"] as const) {
      assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: c[n].id } })).endDate!.getTime(), c[n].endDate!.getTime(), `${n} is not extended`);
    }
    assert.equal(await prisma.ptRestrictionContractExtension.count({ where: { contractId: { in: ids } } }), 1);
    // the confirmation window of Bình's waiting session is given back; Chi's is not
    assert.equal((await prisma.session.findUniqueOrThrow({ where: { id: pendingBinh.id } })).clientConfirmDeadline!.getTime(), T + 12 * DAY);
    assert.equal((await prisma.session.findUniqueOrThrow({ where: { id: pendingChi.id } })).clientConfirmDeadline!.getTime(), T + 2 * DAY);

    // running again
    assert.equal(await getEffectiveContractStatus(c.binh), "ACTIVE");
    const row = await prisma.ptRestriction.findFirstOrThrow({ where: { contractId: c.binh.id } });
    assert.equal(row.endKind, "LIFTED");
    assert.equal(row.liftedBy, "admin-2");
    let res = await app.call("POST", "/sessions", binhTok, { contractId: c.binh.id, ...slot });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    res = await app.call("PATCH", `/sessions/${res.body.id ?? res.body.session?.id}/confirm`, ptTok);
    assert.equal(res.status, 200, `An confirms Bình's session again: ${JSON.stringify(res.body)}`);

    // notifications: resumed, only An and Bình, with the end-date facts, neutral
    assert.deepEqual(new Set(s.notified.filter((n) => n.eventType === "CONTRACT_RESUMED_PT_REINSTATED").map((n) => n.userId)), new Set([pt, c.binh.clientUserId]));
    const clientNotice = s.notified.find((n) => n.userId === c.binh.clientUserId && n.eventType === "CONTRACT_RESUMED_PT_REINSTATED");
    assert.match(clientNotice.text, /cộng thêm 10 ngày/);
    assert.ok(!s.notified.some((n) => [c.chi, c.dung, c.em].some((x) => x.clientUserId === n.userId)), "no other client is told anything");

    // idempotent: a repeated lift changes nothing and tells nobody
    const noticesBefore = s.notified.length;
    const again = await ptRestrictionService.liftContractRestriction({ ptUserId: pt, contractId: c.binh.id, adminId: "admin-2", reason: "lặp", at: new Date(T) });
    assert.equal(again.changed, false);
    assert.equal(s.notified.length, noticesBefore);
    assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: c.binh.id } })).endDate!.getTime(), c.binh.endDate!.getTime() + 10 * DAY);
    // restricting again is its own row (history), and a repeated restrict is a no-op
    const second = await restrictBinh(pt, c.binh.id);
    const secondAgain = await restrictBinh(pt, c.binh.id);
    assert.equal(second.changed, true);
    assert.equal(secondAgain.changed, false);
    assert.equal(secondAgain.restriction.id, second.restriction.id);
    assert.equal(await prisma.ptRestriction.count({ where: { contractId: c.binh.id } }), 2);
  } finally {
    s.restore();
    await prisma.pTAvailability.deleteMany({ where: { ptUserId: pt } });
    await cleanup([pt], ids);
  }
});

// ── (6, 7, 8) Bình leaves without a fee ─────────────────────────────────────────────────────────

test("(6, 7, 8) Bình leaves the restricted contract: the neutral no-fee reason is what payment-service gets, the unresolved sessions (awaiting confirmation, disputed) are HELD and untouched, the contract-scope episode closes; Chi's own cancellation is still the ordinary one", { skip }, async () => {
  const T = Date.now();
  const { pt, contracts: c, ids } = await makeAn();
  const binhTok = tokenFor(c.binh.clientUserId, "CUSTOMER");
  const chiTok = tokenFor(c.chi.clientUserId, "CUSTOMER");
  const s = stubs({ refund: "4000000.00" });
  const quoted: any[] = [];
  const restoreBreakdown = patch(paymentClient, "moneyBreakdown", async (body: any) => {
    quoted.push(body);
    return { remaining: "5000000.00", refundIfCancelledNow: "4500000.00" };
  });
  try {
    const pending = await addSession(c.binh, "PENDING_CLIENT_CONFIRMATION", new Date(T - 2 * DAY), { clientConfirmDeadline: new Date(T + 1 * DAY) });
    const disputed = await addSession(c.binh, "DISPUTED", new Date(T - 5 * DAY), { disputeReason: "x" });
    const future = await addSession(c.binh, "CONFIRMED", new Date(T + 4 * DAY));
    await restrictBinh(pt, c.binh.id);
    assert.equal((await prisma.session.findUniqueOrThrow({ where: { id: future.id } })).status, "CANCELLED", "called off by the restriction already");

    // the preview uses the same rule as the execution
    let res = await app.call("GET", `/contracts/${c.binh.id}/money-breakdown`, binhTok);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.canExitWithoutPenalty, true);
    assert.equal(res.body.exitReasonIfCancelledNow, "CLIENT_EXIT_DUE_TO_PT_RESTRICTION");
    assert.equal(res.body.unresolvedSessions, 2);
    assert.deepEqual([quoted[0].reason, quoted[0].unresolvedSessions], ["CLIENT_EXIT_DUE_TO_PT_RESTRICTION", 2], "priced with exactly the terms the termination sends");
    res = await app.call("GET", `/contracts/${c.chi.id}/money-breakdown`, chiTok);
    assert.equal(res.body.canExitWithoutPenalty, false, "Chi's contract is not restricted");
    assert.equal(res.body.exitReasonIfCancelledNow, "CLIENT_CANCELLED");

    // Bình exits
    res = await app.call("POST", `/contracts/${c.binh.id}/terminate`, binhTok, { reason: "CLIENT_CANCELLED", expectNoPenalty: true });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.exitWithoutPenalty, true);
    assert.equal(res.body.unresolvedSessions, 2);
    const term = s.payments.filter((p) => p.method === "terminate");
    assert.equal(term.length, 1);
    assert.equal(term[0].body.reason, "CLIENT_EXIT_DUE_TO_PT_RESTRICTION", "no 10% fee path");
    assert.equal(term[0].body.unresolvedSessions, 2, "the two unresolved sessions' value is HELD, not refunded");
    const after = await prisma.contract.findUniqueOrThrow({ where: { id: c.binh.id } });
    assert.equal(after.status, "CANCELLED");
    assert.equal(after.terminationReason, "CLIENT_EXIT_DUE_TO_PT_RESTRICTION");
    assert.equal((await prisma.session.findUniqueOrThrow({ where: { id: pending.id } })).status, "PENDING_CLIENT_CONFIRMATION", "awaiting confirmation: untouched, still goes through the normal confirm / dispute");
    assert.equal((await prisma.session.findUniqueOrThrow({ where: { id: disputed.id } })).status, "DISPUTED", "disputed: untouched, waits for the ruling");
    const episode = await prisma.ptRestriction.findFirstOrThrow({ where: { contractId: c.binh.id } });
    assert.equal(episode.endKind, "CONTRACT_ENDED", "nothing left to restrict");
    assert.ok(episode.endedAt);
    assert.equal(await getEffectiveContractStatus(after), "CANCELLED");
    // the PT is told (neutral) and nobody else; the other three contracts are untouched
    assert.ok(s.notified.some((n) => n.userId === pt && n.eventType === "CONTRACT_CANCELLED"));
    for (const n of ["chi", "dung", "em"] as const) assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: c[n].id } })).status, "ACTIVE");

    // a repeat is the same stored result, not a second refund
    res = await app.call("POST", `/contracts/${c.binh.id}/terminate`, binhTok, { reason: "CLIENT_CANCELLED" });
    assert.equal(res.status, 200);
    assert.equal(res.body.alreadyTerminated, true);

    // Chi, unrestricted, cancels: the ordinary reason, nothing rewritten
    res = await app.call("POST", `/contracts/${c.chi.id}/terminate`, chiTok, { reason: "CLIENT_CANCELLED" });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(s.payments.filter((p) => p.method === "terminate").at(-1)!.body.reason, "CLIENT_CANCELLED");
  } finally {
    restoreBreakdown();
    s.restore();
    await cleanup([pt], ids);
  }
});

test("(14, 15) the terms Bình was shown no longer hold (contract restriction lifted before the server accepted): 409 PT_RESTRICTION_LIFTED, nothing cancelled, no fee taken; a request the server ACCEPTED keeps its terms through a payment-service outage and a lift", { skip }, async () => {
  const { pt, contracts: c, ids } = await makeAn();
  const binhTok = tokenFor(c.binh.clientUserId, "CUSTOMER");
  const s = stubs({ refund: "4000000.00" });
  const restoreBreakdown = patch(paymentClient, "moneyBreakdown", async () => ({ remaining: "5000000.00", refundIfCancelledNow: "4500000.00" }));
  try {
    await restrictBinh(pt, c.binh.id);
    await ptRestrictionService.liftContractRestriction({ ptUserId: pt, contractId: c.binh.id, adminId: ADMIN, reason: "xong" });
    let res = await app.call("POST", `/contracts/${c.binh.id}/terminate`, binhTok, { reason: "CLIENT_CANCELLED", expectNoPenalty: true });
    assert.equal(res.status, 409, JSON.stringify(res.body));
    assert.equal(res.body.code, "PT_RESTRICTION_LIFTED");
    assert.equal(res.body.currentTerms.canExitWithoutPenalty, false, "the fresh terms are returned");
    assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: c.binh.id } })).status, "ACTIVE");
    assert.equal(s.payments.filter((p) => p.method === "terminate").length, 0, "no silent switch to a fee-bearing cancellation");

    // restricted again; payment-service is down on the first attempt: the server has ACCEPTED the no-fee terms
    await restrictBinh(pt, c.binh.id);
    const restoreTerminate = patch(paymentClient, "terminate", async () => {
      throw new Error("payment-service down");
    });
    res = await app.call("POST", `/contracts/${c.binh.id}/terminate`, binhTok, { reason: "CLIENT_CANCELLED", expectNoPenalty: true });
    restoreTerminate();
    assert.equal(res.status, 409, `first attempt fails (D59: recorded but unconfirmed): ${res.status}`);
    assert.equal(res.body.code, "CONTRACT_ENDING");
    const accepted = await prisma.contract.findUniqueOrThrow({ where: { id: c.binh.id } });
    assert.ok(accepted.clientExitAcceptedAt, "acceptance recorded before the money call");
    assert.equal(accepted.status, "ACTIVE");
    // the admin lifts the contract restriction before the retry
    await ptRestrictionService.liftContractRestriction({ ptUserId: pt, contractId: c.binh.id, adminId: ADMIN, reason: "xong" });
    res = await app.call("POST", `/contracts/${c.binh.id}/terminate`, binhTok, { reason: "CLIENT_CANCELLED", expectNoPenalty: true });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.exitWithoutPenalty, true, "the accepted request is finished with the accepted terms");
    assert.equal(s.payments.filter((p) => p.method === "terminate").at(-1)!.body.reason, "CLIENT_EXIT_DUE_TO_PT_RESTRICTION");
  } finally {
    restoreBreakdown();
    s.restore();
    await cleanup([pt], ids);
  }
});

// ── (10, 11, 12) the combined state ─────────────────────────────────────────────────────────────

test("(10, 11, 12) contract + account restriction together: lifting the account keeps Bình paused (and Chi resumes), lifting the contract while the account holds keeps everything paused; nobody is told 'resumed' for a contract that is still paused", { skip }, async () => {
  const T = Date.now();
  const { pt, contracts: c, ids } = await makeAn({ startDate: new Date(T - 40 * DAY), endDate: new Date(T + 60 * DAY) });
  const ptTok = tokenFor(pt, "PT");
  const binhTok = tokenFor(c.binh.clientUserId, "CUSTOMER");
  const chiTok = tokenFor(c.chi.clientUserId, "CUSTOMER");
  const slot = await openSlotFor(pt);
  const slot2 = await openSlotFor(pt, 31);
  const s = stubs();
  try {
    // Bình restricted first, then the whole account
    await restrictBinh(pt, c.binh.id, new Date(T - 20 * DAY));
    s.notified.length = 0;
    await suspendAn(pt, new Date(T - 15 * DAY));
    assert.equal(await getEffectiveContractStatus(c.binh), "PAUSED_BY_ADMIN");
    assert.equal(await getEffectiveContractStatus(c.chi), "PAUSED_BY_ADMIN");
    assert.equal((await prisma.userProfile.findUniqueOrThrow({ where: { userId: pt } })).ptSuspended, true);
    assert.ok(await flagMatchesRecord(pt));
    assert.ok(!s.notified.some((n) => n.userId === c.binh.clientUserId), "Bình is not told a second time: already paused");
    assert.ok(s.notified.some((n) => n.userId === c.chi.clientUserId), "Chi is told the account is paused");
    assert.match(s.notified.find((n) => n.userId === pt).text, /4 hợp đồng/, "An's notice counts all four contracts");
    let res = await app.call("GET", "/profile/me/restriction", ptTok);
    assert.equal(res.body.restricted, true);
    assert.equal(res.body.contractRestrictions.length, 1);

    // (11) the account restriction is lifted: Bình's contract restriction is NOT
    s.notified.length = 0;
    const liftedAccount = await ptRestrictionService.lift({ ptUserId: pt, adminId: ADMIN, reason: "xong tài khoản", at: new Date(T - 5 * DAY) });
    assert.equal(liftedAccount.changed, true);
    assert.equal((await prisma.userProfile.findUniqueOrThrow({ where: { userId: pt } })).ptSuspended, false);
    assert.equal(await getEffectiveContractStatus(c.binh), "PAUSED_BY_ADMIN", "lifting the account does not lift the contract restriction");
    assert.equal(await getEffectiveContractStatus(c.chi), "ACTIVE");
    res = await app.call("POST", "/sessions", binhTok, { contractId: c.binh.id, ...slot });
    assert.deepEqual([res.status, res.body.code], [409, CONTRACT_CODE], "Bình still cannot book, with the CONTRACT reason");
    res = await app.call("POST", "/sessions", chiTok, { contractId: c.chi.id, ...slot });
    assert.equal(res.status, 201, "Chi can");
    const resumed = s.notified.filter((n) => n.eventType === "CONTRACT_RESUMED_PT_REINSTATED");
    assert.ok(!resumed.some((n) => n.userId === c.binh.clientUserId), "no 'resumed' for the contract that is still paused");
    assert.ok(resumed.some((n) => n.userId === c.chi.clientUserId));
    assert.match(resumed.find((n) => n.userId === pt).text, /1 hợp đồng vẫn tạm dừng/);
    // the account interval was given to every contract once (days -15..-5 = 10 days); Bình's own interval is still open
    assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: c.chi.id } })).endDate!.getTime(), c.chi.endDate!.getTime() + 10 * DAY);
    // Bình: the account interval [-15,-5) is within its OPEN contract interval [-20, ...): paid for the closed part only
    assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: c.binh.id } })).endDate!.getTime(), c.binh.endDate!.getTime() + 10 * DAY);

    // (12) account restricted again; lifting the CONTRACT restriction must not go above the account one
    await suspendAn(pt, new Date(T - 4 * DAY));
    s.notified.length = 0;
    const liftedContract = await ptRestrictionService.liftContractRestriction({ ptUserId: pt, contractId: c.binh.id, adminId: ADMIN, reason: "xong hợp đồng", at: new Date(T - 2 * DAY) });
    assert.equal(liftedContract.changed, true);
    assert.equal(liftedContract.stillPausedByAccount, true);
    assert.equal(await getEffectiveContractStatus(c.binh), "PAUSED_BY_ADMIN", "still paused: the account restriction holds it");
    res = await app.call("POST", "/sessions", binhTok, { contractId: c.binh.id, ...slot });
    assert.deepEqual([res.status, res.body.code], [409, ACCOUNT_CODE], "the reason now is the account's");
    assert.equal(s.notified.length, 0, "nobody is told 'resumed' while the account restriction holds");

    // finally the account is lifted: everything runs
    await ptRestrictionService.lift({ ptUserId: pt, adminId: ADMIN, reason: "xong", at: new Date(T - 1 * DAY) });
    for (const n of NAMES) assert.equal(await getEffectiveContractStatus(c[n]), "ACTIVE", n);
    assert.equal(await prisma.ptRestriction.count({ where: { ptUserId: pt, endedAt: null } }), 0);
    res = await app.call("POST", "/sessions", binhTok, { contractId: c.binh.id, ...slot2 });
    assert.equal(res.status, 201, JSON.stringify(res.body));
  } finally {
    s.restore();
    await prisma.pTAvailability.deleteMany({ where: { ptUserId: pt } });
    await cleanup([pt], ids);
  }
});

// ── sweeps and the idle clock ───────────────────────────────────────────────────────────────────

test("expiry, auto-confirm and room-close automation skip ONLY the restricted contract (Chi, same PT, runs as the control); after the lift they resume on the original facts", { skip }, async () => {
  const T = Date.now();
  const pt = await makePt();
  const cBinh = await makeContract(pt, { endDate: new Date(T - 1 * DAY), startDate: new Date(T - 40 * DAY) });
  const cChi = await makeContract(pt, { endDate: new Date(T - 1 * DAY), startDate: new Date(T - 40 * DAY) });
  // a RUNNING contract of the same PT: the control for the room-close sweep (Chi's contract ends as EXPIRED first, and an
  // ending calls its not-started sessions off - F1 - so Chi's room session is no longer there for the sweep to decide)
  const cLive = await makeContract(pt, { startDate: new Date(T - 40 * DAY) });
  const s = stubs();
  try {
    await restrictBinh(pt, cBinh.id, new Date(T - 2 * DAY));
    // the pending sessions: a deadline that passed during the restriction (Bình) and the same fact for Chi
    const pendBinh = await addSession(cBinh, "PENDING_CLIENT_CONFIRMATION", new Date(T - 3 * DAY), { clientConfirmDeadline: new Date(T - 1 * DAY) });
    const pendChi = await addSession(cChi, "PENDING_CLIENT_CONFIRMATION", LONG_AGO, { clientConfirmDeadline: LONG_AGO });
    const roomBinh = await addSession(cBinh, "CONFIRMED", LONG_AGO, { sessionMode: "ONLINE", roomClientJoinedAt: new Date(LONG_AGO.getTime() + 60_000) });
    const roomChi = await addSession(cChi, "CONFIRMED", LONG_AGO, { sessionMode: "ONLINE", roomClientJoinedAt: new Date(LONG_AGO.getTime() + 60_000) });
    const roomLive = await addSession(cLive, "CONFIRMED", LONG_AGO, { sessionMode: "ONLINE", roomClientJoinedAt: new Date(LONG_AGO.getTime() + 60_000) });

    // expiry
    await contractService.expireContracts();
    const terms = s.payments.filter((p) => p.method === "terminate");
    assert.ok(terms.some((p) => p.body.idempotencyKey === `CONTRACT_TERMINATE:${cChi.id}` && p.body.reason === "EXPIRED"), "control: Chi's contract expired");
    assert.ok(!terms.some((p) => p.body.idempotencyKey === `CONTRACT_TERMINATE:${cBinh.id}`), "Bình's paused contract was not ended as EXPIRED");
    assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: cBinh.id } })).status, "ACTIVE");
    // F1: the expiry called Chi's not-started session off (a leftover on an ended contract must not be ruled on later)
    const calledOff = await prisma.session.findUniqueOrThrow({ where: { id: roomChi.id } });
    assert.deepEqual([calledOff.status, calledOff.cancelledBy, calledOff.ptAtFault], ["CANCELLED", "SYSTEM", false]);

    // auto-confirm
    await runAutoConfirm();
    assert.equal((await prisma.session.findUniqueOrThrow({ where: { id: pendChi.id } })).status, "COMPLETED", "control: auto-confirmed");
    assert.equal((await prisma.session.findUniqueOrThrow({ where: { id: pendBinh.id } })).status, "PENDING_CLIENT_CONFIRMATION", "paused contract: left alone");
    assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: cBinh.id } })).usedSessions, 0);

    // room-close
    await runRoomCloseResolution();
    const control = await prisma.session.findUniqueOrThrow({ where: { id: roomLive.id } });
    assert.equal(control.status, "NO_SHOW", "control: PT never joined (a running contract)");
    assert.equal(control.ptAtFault, true);
    const paused = await prisma.session.findUniqueOrThrow({ where: { id: roomBinh.id } });
    assert.equal(paused.status, "CONFIRMED");
    assert.equal(paused.ptAtFault, false, "no no-show decided against An on the paused contract");
    assert.ok(!s.payments.some((p) => p.method === "noShow" && p.body.sessionId === roomBinh.id));

    // lift: the end date is given back (so it does not expire), the window is given back
    await ptRestrictionService.liftContractRestriction({ ptUserId: pt, contractId: cBinh.id, adminId: ADMIN, reason: "xong", at: new Date(T) });
    const lifted = await prisma.contract.findUniqueOrThrow({ where: { id: cBinh.id } });
    assert.equal(lifted.endDate!.getTime(), cBinh.endDate!.getTime() + 2 * DAY, "2 blocked days given back");
    assert.ok(lifted.endDate!.getTime() > T, "it did not expire while paused and does not expire now");
    assert.equal((await prisma.session.findUniqueOrThrow({ where: { id: pendBinh.id } })).clientConfirmDeadline!.getTime(), T - 1 * DAY + 2 * DAY);
    await runRoomCloseResolution();
    assert.equal((await prisma.session.findUniqueOrThrow({ where: { id: roomBinh.id } })).status, "NO_SHOW", "resumed at the lift");
  } finally {
    s.restore();
    await cleanup([pt], [cBinh.id, cChi.id, cLive.id]);
  }
});

const holdbackContract = (ptUserId: string, over: Record<string, unknown> = {}) =>
  makeContract(ptUserId, { ptHoldbackRate: "0.1000", startDate: new Date(Date.now() - 40 * DAY), endDate: new Date(Date.now() + 50 * DAY), ...over });
const released = (s: ReturnType<typeof stubs>, contractId: string) =>
  s.payments.some((p) => p.method === "releaseHoldback" && p.body.idempotencyKey === `HOLDBACK_RELEASE:${contractId}`);

test("(17) idle-holdback clock: Bình's restricted days do not count for Bình and do not stop Chi's clock (same PT); a restricted contract is never released; administrative cancellations are not PT cancellations (D30) while a real PT cancellation on Chi still is", { skip }, async () => {
  const T = Date.now();
  const pt = await makePt();
  const bNow = await holdbackContract(pt); // restricted right now
  const bPast = await holdbackContract(pt); // 25 of the last 40 days restricted, lifted 5 days ago
  const chi = await holdbackContract(pt); // never restricted: idle for all 40 days
  const bAdmin = await holdbackContract(pt); // sessions called off administratively, lifted at once
  const chiReal = await holdbackContract(pt); // a real PT cancellation
  const s = stubs();
  try {
    await restrictBinh(pt, bNow.id, new Date(T - 1 * DAY));
    await restrictBinh(pt, bPast.id, new Date(T - 30 * DAY));
    await ptRestrictionService.liftContractRestriction({ ptUserId: pt, contractId: bPast.id, adminId: ADMIN, reason: "xong", at: new Date(T - 5 * DAY) });

    // D30: administrative cancel (SYSTEM) vs. a real PT cancel
    await addSession(bAdmin, "CONFIRMED", new Date(T + 3 * DAY));
    const real = await addSession(chiReal, "CONFIRMED", new Date(T + 3 * DAY));
    await restrictBinh(pt, bAdmin.id);
    await ptRestrictionService.liftContractRestriction({ ptUserId: pt, contractId: bAdmin.id, adminId: ADMIN, reason: "xong" });
    await bookingService.cancelSession(real.id, pt, "bận"); // An acts freely on a contract that is not restricted
    const adminSession = await prisma.session.findFirstOrThrow({ where: { contractId: bAdmin.id } });
    assert.equal(adminSession.status, "CANCELLED");
    assert.equal(adminSession.cancelledBy, "SYSTEM");
    assert.equal((await prisma.session.findUniqueOrThrow({ where: { id: real.id } })).cancelledBy, pt);
    const window = { activatedBefore: new Date(T - 30 * DAY), sessionsSince: new Date(T - 30 * DAY) };
    assert.equal((await contractRepository.findIdleHoldbackCandidates({ ...window, id: bAdmin.id })).length, 1, "an administrative cancellation is not activity");
    assert.equal((await contractRepository.findIdleHoldbackCandidates({ ...window, id: chiReal.id })).length, 0, "a real PT cancellation still counts (D30 unchanged)");

    // the sweep
    for (const x of [bNow, bPast, chi]) {
      assert.ok((await contractRepository.findIdleHoldbackCandidates({ ...window, id: x.id })).length === 1, "control: the plain idle rule would release it");
    }
    await contractService.releaseIdleHoldbacks(new Date(T));
    assert.equal(released(s, bNow.id), false, "restricted right now: never released");
    assert.equal(released(s, bPast.id), false, "only 15 non-restricted days on THIS contract: not idle yet");
    assert.equal(released(s, chi.id), true, "Chi shares the PT but not the restriction: idle for 40 days, released");
    assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: bNow.id } })).holdbackReleasedAt, null);
  } finally {
    s.restore();
    await cleanup([pt], [bNow.id, bPast.id, chi.id, bAdmin.id, chiReal.id]);
  }
});

test("an ACCOUNT-only suspension still behaves exactly as built (regression of the scope default): flag set, every live contract paused, neither a contract episode nor a scope in sight", { skip }, async () => {
  const { pt, contracts: c, ids } = await makeAn();
  const s = stubs();
  try {
    const r = await suspendAn(pt);
    assert.equal(r.restriction.scope, "ACCOUNT");
    assert.equal(r.restriction.contractId, null);
    for (const n of NAMES) assert.equal(await getEffectiveContractStatus(c[n]), "PAUSED_BY_ADMIN", n);
    assert.equal((await prisma.userProfile.findUniqueOrThrow({ where: { userId: pt } })).ptSuspended, true);
    const e = await refusedWith(assertPtAcceptsNewBusiness(pt, "REQUEST_CONTRACT"));
    assert.equal(e.code, ACCOUNT_CODE);
    await ptRestrictionService.lift({ ptUserId: pt, adminId: ADMIN, reason: "xong" });
    assert.equal((await prisma.userProfile.findUniqueOrThrow({ where: { userId: pt } })).ptSuspended, false);
  } finally {
    s.restore();
    await cleanup([pt], ids);
  }
});
