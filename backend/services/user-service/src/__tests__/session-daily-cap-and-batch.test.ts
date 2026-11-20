/**
 * Daily cap (REQUESTED counts) + batch-booking rules - the PURE part (session-booking-rules.ts).
 *
 * TEST FIXTURE (no database): the rows the service reads under its locks are passed in directly.
 * The locked service path (client lock, one transaction, all-or-nothing, concurrency) is in
 * session-daily-cap-and-batch.integration.test.ts, which runs only on an isolated *_test database.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  BATCH_DUPLICATE_SLOT,
  BATCH_OVERLAPPING_SLOTS,
  CLIENT_DAILY_SESSION_LIMIT,
  MAX_CLIENT_SESSIONS_PER_DAY,
  batchInternalProblems,
  batchStatus,
  dailyCapMessage,
  localDayBounds,
  localDayKey,
  overCapSlots,
} from "../services/session-booking-rules";

const at = (y: number, m: number, d: number, h: number, min = 0) => new Date(y, m - 1, d, h, min);

test("the cap is 2 live sessions per client per local day", () => {
  assert.equal(MAX_CLIENT_SESSIONS_PER_DAY, 2);
});

test("a third session on a day that already holds two (REQUESTED + CONFIRMED rows) is refused with a Vietnamese 409", () => {
  const existing = [at(2030, 5, 10, 7), at(2030, 5, 10, 9)]; // one REQUESTED, one CONFIRMED - the repository returns both
  const refused = overCapSlots(existing, [at(2030, 5, 10, 17)]);
  const p = refused.get(0)!;
  assert.equal(p.status, 409);
  assert.equal(p.code, CLIENT_DAILY_SESSION_LIMIT);
  assert.match(p.message, /tối đa 2 buổi tập/);
  assert.match(p.message, /chờ huấn luyện viên xác nhận/);
  assert.match(p.message, /10\/05/);
});

test("one existing session leaves room for exactly one more on that day", () => {
  const existing = [at(2030, 5, 10, 7)];
  assert.equal(overCapSlots(existing, [at(2030, 5, 10, 9)]).size, 0);
  assert.equal(overCapSlots(existing, [at(2030, 5, 10, 9), at(2030, 5, 10, 11)]).has(1), true);
});

test("other days are not affected by a full day", () => {
  const existing = [at(2030, 5, 10, 7), at(2030, 5, 10, 9)];
  assert.equal(overCapSlots(existing, [at(2030, 5, 11, 7), at(2030, 5, 11, 9)]).size, 0);
});

test("the batch counts against itself: 3 slots on an empty day -> the 3rd is refused, the first two fit", () => {
  const slots = [at(2030, 5, 10, 7), at(2030, 5, 10, 9), at(2030, 5, 10, 11), at(2030, 5, 12, 7)];
  const refused = overCapSlots([], slots);
  assert.deepEqual([...refused.keys()], [2]);
  assert.equal(refused.get(2)!.code, CLIENT_DAILY_SESSION_LIMIT);
});

test("a day is the server-local calendar day: 23:30 and 00:30 are different days", () => {
  const existing = [at(2030, 5, 10, 23, 30), at(2030, 5, 10, 22, 0)];
  assert.equal(overCapSlots(existing, [at(2030, 5, 11, 0, 30)]).size, 0);
  assert.equal(localDayKey(at(2030, 5, 10, 23, 59)), "2030-05-10");
  const { from, to } = localDayBounds(at(2030, 5, 10, 15));
  assert.equal(from.getTime(), at(2030, 5, 10, 0).getTime());
  assert.equal(to.getTime(), at(2030, 5, 11, 0).getTime());
});

test("dailyCapMessage names the day", () => {
  assert.match(dailyCapMessage("2030-12-03"), /Ngày 03\/12 đã đủ 2 buổi/);
});

test("batch: the same slot picked twice -> the 2nd is flagged BATCH_DUPLICATE_SLOT", () => {
  const problems = batchInternalProblems([at(2030, 5, 10, 7), at(2030, 5, 11, 7), at(2030, 5, 10, 7)], 60);
  assert.deepEqual([...problems.keys()], [2]);
  assert.equal(problems.get(2)!.code, BATCH_DUPLICATE_SLOT);
  assert.equal(problems.get(2)!.status, 400);
});

test("batch: overlapping picks are flagged, touching ends are not", () => {
  const overlap = batchInternalProblems([at(2030, 5, 10, 7), at(2030, 5, 10, 7, 30)], 60);
  assert.equal(overlap.get(1)!.code, BATCH_OVERLAPPING_SLOTS);
  const touching = batchInternalProblems([at(2030, 5, 10, 7), at(2030, 5, 10, 8)], 60);
  assert.equal(touching.size, 0);
});

test("batchStatus: 409 when any slot is a conflict / cap, otherwise 400", () => {
  assert.equal(batchStatus([{ status: 400 }, { status: 409 }]), 409);
  assert.equal(batchStatus([{ status: 400 }]), 400);
});
