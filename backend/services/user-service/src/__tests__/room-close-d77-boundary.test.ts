/**
 * D77 boundary of the room-close sweep (room-close-resolution.service.ts) - when is a PT "late", and what happens to everything that is not a
 * late arrival. Evidence label: TEST FIXTURE (fake deps, no DB, no HTTP): the sweep's own decision order, its status changes, the intents it
 * records and the money calls it makes are the real code; the session rows, the status CAS and the payment answers are stand-ins. The money
 * arithmetic and the one-compensation guarantee on the real ledger / database are in cross-service-money-d77-boundary.e2e.test.ts.
 *
 * The rule (PT terms Dieu 5): the PT joined the room STRICTLY more than the grace (NO_SHOW_GRACE_MINUTES, default 15) after the scheduled start,
 * while the client was in the room.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { SessionStatus } from "../generated/prisma";
import { runRoomCloseResolution, type RoomCloseDeps } from "../services/room-close-resolution.service";

const GRACE_MS = Number(process.env.NO_SHOW_GRACE_MINUTES ?? "15") * 60 * 1000;
const START = new Date("2027-03-01T09:00:00.000Z");
const at = (offsetMs: number) => new Date(START.getTime() + offsetMs);
const FAKE_TX = { fake: "tx" } as any;

type Row = {
  id: string;
  contractId: string;
  clientUserId: string;
  ptUserId: string;
  scheduledStartAt: Date;
  roomPtJoinedAt: Date | null;
  roomClientJoinedAt: Date | null;
};
const row = (over: Partial<Row>): Row => ({
  id: "s1",
  contractId: "c1",
  clientUserId: "client-1",
  ptUserId: "pt-1",
  scheduledStartAt: START,
  roomPtJoinedAt: null,
  roomClientJoinedAt: null,
  ...over,
});

function harness(due: Row[]) {
  const transitions: Array<{ id: string; next: SessionStatus; extra?: Record<string, unknown>; tx: unknown }> = [];
  const intents: Array<{ kind: string; sessionId: string; tx: unknown }> = [];
  const money: string[] = [];
  const notices: Array<{ userId: string; text: string }> = [];
  const won = new Set<string>(); // the status CAS: the first transition of a session wins, any later one finds it already moved
  const deps: RoomCloseDeps = {
    findDue: async () => due, // always the same (possibly stale) list - what a second instance / a re-run would read
    transitionStatus: async (id, _expected, next, extra, tx) => {
      if (won.has(id)) return false;
      won.add(id);
      transitions.push({ id, next, extra, tx });
      return true;
    },
    recordIntent: async (tx, kind, _contractId, sessionId) => {
      intents.push({ kind, sessionId, tx });
    },
    compensateNoShowMoney: async (_c, s) => {
      money.push(`no-show:${s}`);
    },
    compensateLateArrivalMoney: async (_c, s) => {
      money.push(`late:${s}`);
    },
    checkAndCompleteContract: async () => undefined,
    exclusive: (_contractId, fn) => fn(FAKE_TX),
    notify: async (p) => {
      notices.push({ userId: p.userId, text: p.text });
    },
  };
  return { deps, transitions, intents, money, notices };
}

/** PT joined at `ptOffsetMs` from the start, client joined 1 minute in. */
const bothJoined = (ptOffsetMs: number) => row({ roomPtJoinedAt: at(ptOffsetMs), roomClientJoinedAt: at(60_000) });

const isLate = (h: ReturnType<typeof harness>) => h.intents.some((i) => i.kind === "LATE_ARRIVAL");

// ── the boundary ──────────────────────────────────────────────────────────────────────────────────────────────────────────

test("D77 boundary: the PT joins at EXACTLY start + grace -> NOT late (no intent, no compensation, plain completion notice)", async () => {
  const h = harness([bothJoined(GRACE_MS)]);
  assert.deepEqual(await runRoomCloseResolution(h.deps), { scanned: 1, resolved: 1 });
  assert.equal(h.transitions.length, 1);
  assert.equal(h.transitions[0].next, SessionStatus.PENDING_CLIENT_CONFIRMATION);
  assert.equal(h.transitions[0].extra?.ptNotes, undefined, "not marked late");
  assert.equal(isLate(h), false);
  assert.deepEqual(h.money, [], "no money call at all");
  assert.equal(h.notices.length, 1);
  assert.match(h.notices[0].text, /^Buổi tập đã kết thúc\. Vui lòng xác nhận trước /);
  assert.doesNotMatch(h.notices[0].text, /muộn|bồi thường/i);
});

for (const [label, offsetMs] of [
  ["start + grace + 1 ms (15:00.001)", GRACE_MS + 1],
  ["start + grace + 1 s", GRACE_MS + 1_000],
  ["start + grace + 1 min (15:01)", GRACE_MS + 60_000],
  ["start + 1 h", 60 * 60 * 1000],
] as const) {
  test(`D77 boundary: the PT joins at ${label} -> LATE: the late-arrival intent is recorded inside the decision's transaction, then the compensation runs once`, async () => {
    const h = harness([bothJoined(offsetMs)]);
    assert.deepEqual(await runRoomCloseResolution(h.deps), { scanned: 1, resolved: 1 });
    assert.equal(h.transitions.length, 1);
    assert.equal(h.transitions[0].next, SessionStatus.PENDING_CLIENT_CONFIRMATION, "still completes (the client keeps the dispute window); not a no-show");
    assert.equal(h.transitions[0].extra?.ptNotes, "PT vào phòng học muộn");
    assert.equal(h.transitions[0].extra?.ptAtFault, undefined, "a late arrival is deliberately NOT ptAtFault (does not feed the 3-strikes right)");
    assert.equal(h.transitions[0].extra?.sessionDeducted, undefined);
    assert.deepEqual(h.intents, [{ kind: "LATE_ARRIVAL", sessionId: "s1", tx: FAKE_TX }], "intent written in the same transaction as the status change");
    assert.equal(h.transitions[0].tx, FAKE_TX);
    assert.deepEqual(h.money, ["late:s1"]);
  });
}

for (const [label, offsetMs] of [
  ["1 ms before the grace ends (14:59.999)", GRACE_MS - 1],
  ["1 s before the grace ends", GRACE_MS - 1_000],
  ["exactly at the scheduled start", 0],
  ["10 minutes BEFORE the scheduled start", -10 * 60 * 1000],
] as const) {
  test(`D77 boundary: the PT joins ${label} -> not late`, async () => {
    const h = harness([bothJoined(offsetMs)]);
    await runRoomCloseResolution(h.deps);
    assert.equal(isLate(h), false);
    assert.deepEqual(h.money, []);
    assert.equal(h.transitions[0].next, SessionStatus.PENDING_CLIENT_CONFIRMATION);
  });
}

// ── the late rule needs the client in the room ───────────────────────────────────────────────────────────────────────────

test("D77 case 3: the client never joined -> NO compensation, however late the PT was; parked for the client's confirm/dispute window", async () => {
  for (const ptOffsetMs of [0, GRACE_MS, GRACE_MS + 1, 2 * 60 * 60 * 1000]) {
    const h = harness([row({ roomPtJoinedAt: at(ptOffsetMs), roomClientJoinedAt: null })]);
    assert.deepEqual(await runRoomCloseResolution(h.deps), { scanned: 1, resolved: 1 });
    assert.equal(h.transitions.length, 1, `ptOffset ${ptOffsetMs}`);
    assert.equal(h.transitions[0].next, SessionStatus.PENDING_CLIENT_CONFIRMATION);
    assert.equal(h.transitions[0].extra?.ptNotes, "Client không vào phòng học");
    assert.ok(h.transitions[0].extra?.clientConfirmDeadline instanceof Date);
    assert.equal(isLate(h), false, `no late-arrival intent (ptOffset ${ptOffsetMs})`);
    assert.deepEqual(h.intents, [], "no money intent of any kind here - the quota/PT payout run when the client confirms or the auto-confirm sweep fires");
    assert.deepEqual(h.money, []);
  }
});

// ── the PT never joined ───────────────────────────────────────────────────────────────────────────────────────────────────

test("D77: the PT never joined, the client did -> the NO-SHOW path (NO_SHOW + ptAtFault + no-show intent/compensation), never the late path", async () => {
  const h = harness([row({ roomPtJoinedAt: null, roomClientJoinedAt: at(60_000) })]);
  assert.deepEqual(await runRoomCloseResolution(h.deps), { scanned: 1, resolved: 1 });
  assert.equal(h.transitions.length, 1);
  assert.equal(h.transitions[0].next, SessionStatus.NO_SHOW);
  assert.equal(h.transitions[0].extra?.ptAtFault, true);
  assert.equal(h.transitions[0].extra?.sessionDeducted, false);
  assert.deepEqual(h.intents, [{ kind: "NO_SHOW", sessionId: "s1", tx: FAKE_TX }]);
  assert.equal(isLate(h), false);
  assert.deepEqual(h.money, ["no-show:s1"], "the full no-show compensation, and no late-arrival one");
});

test("D77: nobody joined -> CANCELLED by the system, no money, no intent (the session goes back to the client)", async () => {
  const h = harness([row({})]);
  assert.deepEqual(await runRoomCloseResolution(h.deps), { scanned: 1, resolved: 1 });
  assert.equal(h.transitions[0].next, SessionStatus.CANCELLED);
  assert.equal(h.transitions[0].extra?.cancelledBy, "SYSTEM");
  assert.deepEqual(h.intents, []);
  assert.deepEqual(h.money, []);
});

// ── run twice / at once ───────────────────────────────────────────────────────────────────────────────────────────────────

test("D77: the sweep run twice over the same (stale) list compensates the late PT exactly once - the second run loses the status CAS and does nothing", async () => {
  const h = harness([bothJoined(GRACE_MS + 60_000)]);
  const first = await runRoomCloseResolution(h.deps);
  const second = await runRoomCloseResolution(h.deps);
  assert.deepEqual(first, { scanned: 1, resolved: 1 });
  assert.deepEqual(second, { scanned: 1, resolved: 0 });
  assert.deepEqual(h.money, ["late:s1"]);
  assert.equal(h.intents.length, 1);
  assert.equal(h.transitions.length, 1);
  assert.equal(h.notices.length, 1, "the client is told once");
});

test("D77: two sweeps started at the same moment in one process -> the second is skipped by the in-process guard; one compensation", async () => {
  const h = harness([bothJoined(GRACE_MS + 60_000)]);
  const slow = h.deps.findDue;
  h.deps.findDue = async (b, l) => {
    await new Promise((r) => setTimeout(r, 20));
    return slow(b, l);
  };
  const [a, b] = await Promise.all([runRoomCloseResolution(h.deps), runRoomCloseResolution(h.deps)]);
  assert.deepEqual([a, b].sort((x, y) => x.scanned - y.scanned), [{ scanned: 0, resolved: 0 }, { scanned: 1, resolved: 1 }]);
  assert.deepEqual(h.money, ["late:s1"]);
  assert.equal(h.intents.length, 1);
});
