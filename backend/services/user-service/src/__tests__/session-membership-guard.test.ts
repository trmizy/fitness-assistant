/**
 * Booking guard (owner rule 19/11/2026, item 4) - session-membership-guard.ts.
 *
 * Evidence: TEST FIXTURE + BACKEND INTEGRATION-style unit tests: gym-service is replaced by patching `gymClient.getClientMembershipAtGym`;
 * no database, no network. Covers the pure day rule (Asia/Ho_Chi_Minh days, active + queued memberships, open-ended, unreadable
 * dates, only-queued) and the guard itself (no gym / ONLINE exempt, covered, uncovered -> 422 with the code + details, gym-service
 * down -> 503 fail closed).
 */
import test from "node:test";
import assert from "node:assert/strict";

import { gymClient, GymServiceUnavailableError } from "../clients/gym.client";
import {
  SESSION_NOT_COVERED_BY_MEMBERSHIP,
  assertGymMembershipCoversSession,
  membershipCoversDay,
} from "../services/session-membership-guard";

const DAY = 24 * 60 * 60 * 1000;
const iso = (ms: number) => new Date(ms).toISOString();
const base = Date.parse("2026-11-19T03:00:00.000Z"); // 10:00 on 19/11 in Vietnam

const mem = (startMs: number | null, endMs: number | null, id = "m") => ({
  membershipId: id, planName: "Plan", purchaseGymId: "g1", startDate: startMs === null ? null : iso(startMs), endDate: endMs === null ? null : iso(endMs),
});
const lookup = (o: { active?: any[]; upcoming?: any[] }) => ({
  hasActiveMembership: (o.active ?? []).length > 0,
  brandId: "b1",
  membership: (o.active ?? [])[0] ?? null,
  memberships: o.active ?? [],
  upcoming: o.upcoming ?? [],
});

function withLookup<T>(answer: unknown | Error, fn: () => Promise<T>): Promise<T> {
  const original = gymClient.getClientMembershipAtGym;
  (gymClient as any).getClientMembershipAtGym = async () => {
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return fn().finally(() => {
    (gymClient as any).getClientMembershipAtGym = original;
  });
}

test("membershipCoversDay: whole local days, start and end day inclusive", () => {
  // membership from 10/11 14:23 (VN) to 19/12 14:23 (VN)
  const start = Date.parse("2026-11-10T07:23:00.000Z");
  const end = Date.parse("2026-12-19T07:23:00.000Z");
  const l = lookup({ active: [mem(start, end)] });
  assert.equal(membershipCoversDay(l as any, new Date("2026-11-10T00:30:00.000Z")), true, "start day (even before the purchase hour)");
  assert.equal(membershipCoversDay(l as any, new Date("2026-12-19T15:00:00.000Z")), true, "last day, after the expiry hour (22:00 VN)");
  assert.equal(membershipCoversDay(l as any, new Date("2026-12-19T16:59:00.000Z")), true, "23:59 VN on the last day");
  assert.equal(membershipCoversDay(l as any, new Date("2026-12-19T17:00:00.000Z")), false, "00:00 VN on 20/12 is the next day");
  assert.equal(membershipCoversDay(l as any, new Date("2026-11-09T16:59:00.000Z")), false, "23:59 VN on 09/11");
});

test("membershipCoversDay: a queued renewal covers its own days; a gap day is not covered; open-ended covers everything after start; null lookup covers nothing", () => {
  const end1 = Date.parse("2026-12-01T03:00:00.000Z");
  const l = lookup({ active: [mem(base - 10 * DAY, end1, "cur")], upcoming: [mem(end1 + 5 * DAY, end1 + 35 * DAY, "up")] });
  assert.equal(membershipCoversDay(l as any, new Date(end1 - DAY)), true);
  assert.equal(membershipCoversDay(l as any, new Date(end1 + 2 * DAY)), false, "gap between the two");
  assert.equal(membershipCoversDay(l as any, new Date(end1 + 10 * DAY)), true, "inside the queued one");
  assert.equal(membershipCoversDay(l as any, new Date(end1 + 40 * DAY)), false, "after everything");
  const open = lookup({ active: [mem(base - DAY, null)] });
  assert.equal(membershipCoversDay(open as any, new Date(base + 900 * DAY)), true);
  assert.equal(membershipCoversDay(null, new Date(base)), false);
  // queued-only client (nothing active today): covers only from the queued start
  const queuedOnly = lookup({ upcoming: [mem(base + 3 * DAY, base + 33 * DAY)] });
  assert.equal(membershipCoversDay(queuedOnly as any, new Date(base + DAY)), false);
  assert.equal(membershipCoversDay(queuedOnly as any, new Date(base + 10 * DAY)), true);
  // unreadable dates can prove nothing
  assert.equal(membershipCoversDay(lookup({ active: [{ ...mem(base, base + DAY), endDate: "not-a-date" }] }) as any, new Date(base)), false);
});

test("guard: no gym or an ONLINE session is never asked about a membership", async () => {
  await withLookup(new Error("must not be called"), async () => {
    await assertGymMembershipCoversSession({ gymId: null, clientUserId: "c" }, new Date(base + 30 * DAY), "OFFLINE");
    await assertGymMembershipCoversSession({ gymId: "g1", clientUserId: "c" }, new Date(base + 30 * DAY), "ONLINE");
  });
});

test("guard: covered date passes; a date after the membership ends is refused 422 with a Vietnamese message, the code and details", async () => {
  const end = base + 20 * DAY;
  const answer = lookup({ active: [mem(base - 10 * DAY, end)] });
  await withLookup(answer, async () => {
    await assertGymMembershipCoversSession({ gymId: "g1", clientUserId: "c" }, new Date(base + 5 * DAY), "OFFLINE");
    await assert.rejects(
      () => assertGymMembershipCoversSession({ gymId: "g1", clientUserId: "c" }, new Date(base + 25 * DAY), "OFFLINE"),
      (e: any) => {
        assert.equal(e.status, 422);
        assert.equal(e.code, SESSION_NOT_COVERED_BY_MEMBERSHIP);
        assert.match(e.message, /không có hiệu lực vào ngày \d\d\/\d\d/);
        assert.match(e.message, /gói hết hạn \d\d\/\d\d/);
        assert.match(e.message, /gia hạn gói hội viên/i);
        assert.equal(e.details.gymId, "g1");
        assert.equal(e.details.membershipEndsAt, iso(end));
        return true;
      },
    );
  });
});

test("guard: a renewal queued right behind the current membership covers the later date (stacking)", async () => {
  const end1 = base + 20 * DAY;
  const answer = lookup({ active: [mem(base - 10 * DAY, end1, "cur")], upcoming: [mem(end1, end1 + 30 * DAY, "up")] });
  await withLookup(answer, async () => {
    await assertGymMembershipCoversSession({ gymId: "g1", clientUserId: "c" }, new Date(end1 + 10 * DAY), "OFFLINE");
    await assert.rejects(
      () => assertGymMembershipCoversSession({ gymId: "g1", clientUserId: "c" }, new Date(end1 + 31 * DAY), "OFFLINE"),
      (e: any) => e.code === SESSION_NOT_COVERED_BY_MEMBERSHIP,
    );
  });
});

test("guard: no membership at all -> 422 'chưa có gói hội viên' ; unknown branch (null lookup) -> refused too", async () => {
  for (const answer of [lookup({}), null]) {
    await withLookup(answer, async () => {
      await assert.rejects(
        () => assertGymMembershipCoversSession({ gymId: "g1", clientUserId: "c" }, new Date(base + 2 * DAY), "OFFLINE"),
        (e: any) => e.status === 422 && e.code === SESSION_NOT_COVERED_BY_MEMBERSHIP && /chưa có gói hội viên/.test(e.message) && e.details.membershipEndsAt === null,
      );
    });
  }
});

test("guard: gym-service down -> 503, never 'covered' and never 'not covered' (fail closed)", async () => {
  await withLookup(new GymServiceUnavailableError(new Error("down")), async () => {
    await assert.rejects(
      () => assertGymMembershipCoversSession({ gymId: "g1", clientUserId: "c" }, new Date(base + DAY), "OFFLINE"),
      (e: any) => e.status === 503 && !e.code,
    );
  });
});
