/**
 * DQ-2(a) wording in the room-close sweep. Evidence label: TEST FIXTURE (fake deps, no DB, no HTTP) - the sweep's own
 * ordering and the text it hands to notify are real; the money answer is a stand-in for what payment-service returns.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { SessionStatus } from "../generated/prisma";
import { runRoomCloseResolution, type RoomCloseDeps } from "../services/room-close-resolution.service";

const start = new Date(Date.now() - 2 * 60 * 60 * 1000);
const session = (over: Record<string, unknown>) => ({
  id: "s1",
  contractId: "c1",
  clientUserId: "client-1",
  ptUserId: "pt-1",
  scheduledStartAt: start,
  roomPtJoinedAt: null as Date | null,
  roomClientJoinedAt: null as Date | null,
  ...over,
});

function harness(due: ReturnType<typeof session>, answers: { noShow?: unknown; late?: unknown }) {
  const events: string[] = [];
  const notices: Array<{ userId: string; text: string }> = [];
  const deps: RoomCloseDeps = {
    findDue: async () => [due],
    transitionStatus: async () => true,
    compensateNoShowMoney: async () => {
      events.push("money:no-show");
      return answers.noShow;
    },
    compensateLateArrivalMoney: async () => {
      events.push("money:late");
      return answers.late;
    },
    checkAndCompleteContract: async () => {
      events.push("complete-check");
    },
    notify: async (p) => {
      events.push(`notify:${p.userId}`);
      notices.push({ userId: p.userId, text: p.text });
    },
  };
  return { deps, events, notices };
}

const ptNoShow = () => session({ roomClientJoinedAt: new Date(start.getTime() + 60_000) });

test("PT never entered the room, fully refunded: states the amount, closes + counts the session, notices come AFTER the money call", async () => {
  const h = harness(ptNoShow(), { noShow: { state: "SETTLED", applied: true, result: { paid: "250000.00", owed: "250000.00", unpaid: "0.00" } } });
  const r = await runRoomCloseResolution(h.deps);
  assert.deepEqual(r, { scanned: 1, resolved: 1 });
  assert.ok(h.events.indexOf("money:no-show") < h.events.indexOf("notify:client-1"));
  const client = h.notices.find((n) => n.userId === "client-1")!.text;
  assert.match(client, /Đã hoàn 250\.000đ vào ví\./);
  assert.match(client, /vẫn tính vào số buổi đã dùng/);
  assert.match(client, /không có buổi bù/);
  assert.doesNotMatch(client, /không bị trừ/);
  const pt = h.notices.find((n) => n.userId === "pt-1")!.text;
  assert.match(pt, /bạn không được thanh toán buổi này/);
});

test("PT never entered the room, only part available: never claims a full refund", async () => {
  const h = harness(ptNoShow(), { noShow: { state: "SETTLED", applied: true, result: { paid: "100000", owed: "250000", unpaid: "150000" } } });
  await runRoomCloseResolution(h.deps);
  const client = h.notices.find((n) => n.userId === "client-1")!.text;
  assert.match(client, /Đã hoàn 100\.000đ vào ví; 150\.000đ còn lại đang được đối soát\./);
  assert.doesNotMatch(client, /Đã hoàn 250/);
});

test("older payment-service (no paid fields) or a failed/duplicate step: neutral sentence, no amount", async () => {
  for (const noShow of [{ compensation: "250000", shortfall: "0" }, undefined, { state: "FAILED", error: "x" }, { state: "ALREADY_SETTLED" }]) {
    const h = harness(ptNoShow(), { noShow });
    await runRoomCloseResolution(h.deps);
    const client = h.notices.find((n) => n.userId === "client-1")!.text;
    assert.doesNotMatch(client, /Đã hoàn/);
    assert.doesNotMatch(client, /\d+\.\d{3}đ/);
    assert.match(client, /được hoàn vào ví/);
    assert.match(client, /vẫn tính vào số buổi đã dùng/);
  }
});

test("PT late (both joined): the session still counts, the money is a compensation, never 'không bị trừ'", async () => {
  const joinedLate = new Date(start.getTime() + 40 * 60_000);
  const h = harness(session({ roomPtJoinedAt: joinedLate, roomClientJoinedAt: new Date(start.getTime() + 60_000) }), {
    late: { state: "SETTLED", applied: true, result: { paid: "125000", owed: "125000", unpaid: "0" } },
  });
  await runRoomCloseResolution(h.deps);
  assert.ok(h.events.indexOf("money:late") < h.events.indexOf("notify:client-1"));
  const client = h.notices.find((n) => n.userId === "client-1")!.text;
  assert.match(client, /Đã bồi thường 125\.000đ vào ví\./);
  assert.match(client, /vẫn được tính là đã diễn ra/);
  assert.doesNotMatch(client, /không bị trừ/);
  assert.equal(SessionStatus.PENDING_CLIENT_CONFIRMATION, "PENDING_CLIENT_CONFIRMATION");
});
