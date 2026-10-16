/**
 * PT-suspension slice 4, part 2 — the two notices a temporary suspension owes: "your contract is
 * paused" (CONTRACT_PAUSED_PT_SUSPENDED) and "your contract is running again"
 * (CONTRACT_RESUMED_PT_REINSTATED).
 *
 * Evidence label: BACKEND INTEGRATION against the isolated gymcoach_user_test database; payment-service
 * and the notification push are stubbed at the client boundary (TEST FIXTURE) — notificationService.create
 * is replaced by stubs() in pt-restriction.test-helpers.ts, which records every call, so these tests read
 * exactly what would have been stored and pushed. Run with:
 *   DATABASE_URL="postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_user_test?schema=public" \
 *     ./node_modules/.bin/tsx --test src/__tests__/pt-suspension-notifications.integration.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../repositories/profile.repository";
import { paymentClient } from "../clients/payment.client";
import { ptRestrictionService } from "../services/pt-restriction.service";
import { terminateAsClient } from "../services/client-exit.service";
import { ptDeactivationService } from "../services/pt-deactivation.service";
import { DAY, HOUR, addSession, cleanup, makeContract, makePt, patch, skip, stubs } from "./pt-restriction.test-helpers";

const ADMIN = "admin-1";
const REASON_TEXT = "Khiếu nại đang được xem xét";
const PUBLIC_REASON = "Đang xem xét một phản ánh";
const PAUSED = "CONTRACT_PAUSED_PT_SUSPENDED";
const RESUMED = "CONTRACT_RESUMED_PT_REINSTATED";
/** Words that would state or imply the PT did something wrong, or leak the complaint. */
const MISCONDUCT = /khiếu nại|phản ánh|tố cáo|vi phạm|sai phạm|gian lận|kỷ luật|lỗi|bị phạt vì|sai trái|điều tra|báo cáo|nghi ngờ|tạm khoá|bị khoá|bị cấm/i;

const suspendInput = (ptUserId: string, at?: Date) => ({
  ptUserId,
  adminId: ADMIN,
  reasonCategory: "COMPLAINT_REVIEW" as const,
  reasonText: REASON_TEXT,
  publicReason: PUBLIC_REASON,
  at,
});

function fakeLedger() {
  const applied = new Map<string, unknown>();
  const restore = patch(paymentClient, "terminate", async (body: any) => {
    if (!applied.has(body.idempotencyKey)) applied.set(body.idempotencyKey, { refund: "5000000.00" });
    return applied.get(body.idempotencyKey);
  });
  return { applied, restore };
}

const to = (notified: any[], userId: string, eventType?: string) =>
  notified.filter((n) => n.userId === userId && (eventType ? n.eventType === eventType : true));

test("suspension: the PT and EVERY client with an ACTIVE paid contract are told, once per contract, with the new type and neutral wording; contracts that are not live are not", { skip }, async () => {
  const T = Date.now();
  const pt = await makePt();
  const clientB = randomUUID();
  const clientC = randomUUID();
  const B = await makeContract(pt, { clientUserId: clientB, packageName: "Gói B" });
  const B2 = await makeContract(pt, { clientUserId: clientB, packageName: "Gói B2" }); // same client, second contract → second notice
  const C = await makeContract(pt, { clientUserId: clientC, packageName: "Gói C" }); // no upcoming session at all
  const pending = await makeContract(pt, { status: "PENDING_PAYMENT", paymentTransactionId: null, startDate: null, endDate: null });
  const unpaid = await makeContract(pt, { paymentTransactionId: null });
  const ended = await makeContract(pt, { status: "CANCELLED", terminationReason: "CLIENT_CANCELLED", terminatedAt: new Date(T - DAY) });
  const sB = await addSession(B, "CONFIRMED", new Date(T + 2 * DAY));
  const sB2a = await addSession(B2, "REQUESTED", new Date(T + 3 * DAY));
  const sB2b = await addSession(B2, "CONFIRMED", new Date(T + 4 * DAY));
  const contracts = [B, B2, C, pending, unpaid, ended];
  const s = stubs();
  try {
    const result = await ptRestrictionService.suspend(suspendInput(pt));
    assert.equal(result.changed, true);
    assert.deepEqual(result.notified, { clients: 3, pt: true });

    assert.ok(s.notified.every((n) => n.eventType === PAUSED), "only the new type — no SESSION_CANCELLED stopgap alongside it");
    assert.equal(s.notified.length, 4, "three live contracts + the PT, once each");
    const forContract = (c: { id: string }) => s.notified.filter((n) => n.entityId === c.id);
    for (const c of [B, B2, C]) {
      const mine = forContract(c);
      assert.equal(mine.length, 1);
      assert.equal(mine[0].userId, c.clientUserId);
      assert.equal(mine[0].entityType, "CONTRACT");
      assert.equal(mine[0].link, "/client/contracts");
    }
    assert.equal(to(s.notified, clientB).length, 2, "one per contract");
    for (const c of [pending, unpaid, ended]) assert.equal(forContract(c).length, 0, "a contract that is not ACTIVE-and-paid is not paused by this");

    // the PT
    const ptNotes = to(s.notified, pt);
    assert.equal(ptNotes.length, 1);
    assert.equal(ptNotes[0].link, "/pt/contracts");
    assert.match(ptNotes[0].text, /3 hợp đồng/);
    assert.match(ptNotes[0].text, /3 buổi sắp tới đã được tạm hoãn/);

    // wording: plain, neutral, says what happens to the contract and the way out
    for (const n of s.notified) {
      assert.doesNotMatch(n.text, MISCONDUCT, `no accusation or complaint in: ${n.text}`);
      assert.ok(!n.text.includes(REASON_TEXT) && !n.text.includes(PUBLIC_REASON), "the admin's reason is never copied in");
      assert.match(n.text, /tạm ngưng hoạt động để rà soát|chế độ hạn chế để quản trị viên rà soát/);
    }
    for (const c of [B, B2, C]) {
      const text = forContract(c)[0].text;
      assert.match(text, /được giữ nguyên/);
      assert.match(text, /không mất buổi nào/);
      assert.match(text, /cộng bù/);
      assert.match(text, /chờ, hoặc/);
      assert.match(text, /hoàn lại toàn bộ giá trị các buổi chưa tập, không mất phí/);
    }
    assert.match(forContract(B)[0].text, /1 buổi sắp tới đã được tạm hoãn/);
    assert.match(forContract(B2)[0].text, /2 buổi sắp tới đã được tạm hoãn/);
    assert.doesNotMatch(forContract(C)[0].text, /buổi sắp tới đã được tạm hoãn/, "no sessions were called off for C, so the text does not claim any");

    // repeating the request: nothing new — and nothing is sent when the call is a no-op
    const before = s.notified.length;
    const again = await ptRestrictionService.suspend(suspendInput(pt));
    assert.equal(again.changed, false);
    assert.deepEqual(again.notified, { clients: 0, pt: false });
    assert.equal(s.notified.length, before, "a repeated suspend sends nothing");
  } finally {
    s.restore();
    await prisma.auditLog.deleteMany({ where: { entityId: { in: [sB.id, sB2a.id, sB2b.id] } } }).catch(() => {});
    await cleanup([pt], contracts.map((c) => c.id));
  }
});

test("concurrent identical suspend requests: exactly one episode opens and each person is told exactly once", { skip }, async () => {
  const pt = await makePt();
  const C = await makeContract(pt);
  const s = stubs();
  try {
    const results = await Promise.all([1, 2, 3].map(() => ptRestrictionService.suspend(suspendInput(pt)).catch((e) => e)));
    assert.equal(results.filter((r: any) => r.changed === true).length, 1);
    assert.equal(to(s.notified, C.clientUserId, PAUSED).length, 1);
    assert.equal(to(s.notified, pt, PAUSED).length, 1);
  } finally {
    s.restore();
    await cleanup([pt], [C.id]);
  }
});

test("lift: the PT and every client whose contract is STILL ACTIVE are told once, with how far the end date moved; a client who left meanwhile (B) and ended contracts are not; a repeated or late lift sends nothing", { skip }, async () => {
  const T = Date.now();
  const pt = await makePt();
  const [B, C, D] = await Promise.all([makeContract(pt, { packageName: "Gói B" }), makeContract(pt, { packageName: "Gói C" }), makeContract(pt, { packageName: "Gói D", endDate: null })]);
  const E = await makeContract(pt, { status: "COMPLETED", terminationReason: "COMPLETED", terminatedAt: new Date(T - DAY) });
  const s = stubs();
  const ledger = fakeLedger();
  const suspendedAt = new Date(T - 6 * DAY);
  const liftAt = new Date(suspendedAt.getTime() + 5 * DAY + 3 * HOUR);
  try {
    await ptRestrictionService.suspend(suspendInput(pt, suspendedAt));
    const paused = s.notified.length;
    assert.equal(paused, 4, "B, C, D and the PT");

    const exit = await terminateAsClient(B.id, B.clientUserId);
    assert.equal(exit.mode, "EXIT_DUE_TO_PT_RESTRICTION");

    const lifted = await ptRestrictionService.lift({ ptUserId: pt, adminId: ADMIN, reason: "ok", at: liftAt });
    assert.equal(lifted.changed, true);
    assert.deepEqual(lifted.notified, { clients: 2, pt: true });

    // B's exit told the PT once (existing CONTRACT_CANCELLED type, neutral wording) - not a 'resumed' notice
    const exitNotice = s.notified[paused];
    assert.equal(exitNotice.userId, pt);
    assert.equal(exitNotice.eventType, "CONTRACT_CANCELLED");
    assert.equal(exitNotice.entityId, B.id);
    assert.doesNotMatch(exitNotice.text, MISCONDUCT);
    const sent = s.notified.slice(paused + 1);
    assert.equal(sent.length, 3, "C, D and the PT");
    assert.ok(sent.every((n) => n.eventType === RESUMED), "no 'reinstated' wording for anything but a lift, and nothing else is sent");
    assert.equal(to(sent, B.clientUserId).length, 0, "B left: never told the contract resumed");
    assert.equal(sent.filter((n) => n.entityId === E.id).length, 0, "an ended contract is not told");
    for (const n of sent) assert.doesNotMatch(n.text, MISCONDUCT);

    const cText = to(sent, C.clientUserId)[0].text;
    assert.match(cText, /đã hoạt động trở lại/);
    assert.match(cText, /đặt lịch lại được ngay/);
    assert.match(cText, /Thời hạn hợp đồng được cộng thêm 5 ngày 3 giờ, từ \d{2}\/\d{2}\/\d{4} sang \d{2}\/\d{2}\/\d{4}\./);
    const newEnd = (await prisma.contract.findUniqueOrThrow({ where: { id: C.id } })).endDate!;
    const vn = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", year: "numeric" });
    assert.ok(cText.includes(`sang ${vn.format(newEnd)}`), "the date in the text is the contract's real new end date");
    assert.match(to(sent, D.clientUserId)[0].text, /Thời hạn hợp đồng giữ nguyên\./, "a contract with no end date is not claimed to have moved");
    assert.match(to(sent, pt)[0].text, /2 hợp đồng đang hoạt động của bạn tiếp tục/);

    // repeat and late lift: nothing
    const again = await ptRestrictionService.lift({ ptUserId: pt, adminId: ADMIN, reason: "again" });
    assert.equal(again.changed, false);
    assert.equal(s.notified.length, paused + 1 + 3, "a repeated lift sends nothing");
    assert.equal(ledger.applied.size, 1);
  } finally {
    ledger.restore();
    s.restore();
    await cleanup([pt], [B.id, C.id, D.id, E.id]);
  }
});

test("concurrent lifts tell each person once", { skip }, async () => {
  const pt = await makePt();
  const C = await makeContract(pt);
  const s = stubs();
  try {
    await ptRestrictionService.suspend(suspendInput(pt, new Date(Date.now() - DAY)));
    const results = await Promise.all([1, 2, 3].map(() => ptRestrictionService.lift({ ptUserId: pt, adminId: ADMIN, reason: "ok" })));
    assert.equal(results.filter((r) => r.changed).length, 1);
    assert.equal(to(s.notified, C.clientUserId, RESUMED).length, 1);
    assert.equal(to(s.notified, pt, RESUMED).length, 1);
  } finally {
    s.restore();
    await cleanup([pt], [C.id]);
  }
});

test("a suspension converted to a permanent ban sends NO 'reinstated' notice — the unwind's per-contract CONTRACT_CANCELLED_PT_DEACTIVATED is what each client gets; neither does a plain permanent lock or its unlock", { skip }, async () => {
  const pt = await makePt();
  const pt2 = await makePt();
  const C = await makeContract(pt);
  const C2 = await makeContract(pt2);
  const s = stubs();
  const ledger = fakeLedger();
  const cmd = (ptUserId: string, seq: number) => ({ ptUserId, adminId: "admin-9", reason: "khoá" as string | null, seq: BigInt(seq) });
  try {
    await ptRestrictionService.suspend(suspendInput(pt));
    assert.equal(to(s.notified, C.clientUserId, PAUSED).length, 1);
    const afterSuspend = s.notified.length;

    const lock = await ptDeactivationService.deactivatePT(cmd(pt, 1));
    assert.equal(lock.complete, true);
    const sent = s.notified.slice(afterSuspend);
    assert.ok(sent.every((n) => n.eventType !== RESUMED), "conversion is not a reinstatement");
    assert.deepEqual(
      sent.filter((n) => n.userId === C.clientUserId).map((n) => n.eventType),
      ["CONTRACT_CANCELLED_PT_DEACTIVATED"],
      "the client is told the contract ended and what they got back",
    );
    assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: C.id } })).terminationReason, "PT_BANNED");

    // a permanent lock of a PT that was never suspended, and its unlock: no 'reinstated' either
    await ptDeactivationService.deactivatePT(cmd(pt2, 1));
    await ptDeactivationService.reactivatePT(cmd(pt2, 2));
    await ptDeactivationService.reactivatePT(cmd(pt, 2));
    assert.equal(s.notified.filter((n) => n.eventType === RESUMED).length, 0);
    assert.equal(s.notified.filter((n) => n.eventType === PAUSED && n.userId === C2.clientUserId).length, 0, "a permanent lock is not announced as a pause");
  } finally {
    ledger.restore();
    s.restore();
    await cleanup([pt, pt2], [C.id, C2.id]);
  }
});
