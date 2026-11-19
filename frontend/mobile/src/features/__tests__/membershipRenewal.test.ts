/**
 * Membership renewal ("Gia hạn", owner rule 19/11/2026): the display projection, the PT-contract hint and the
 * non-blocking coverage warning read from `gym-options`. Evidence: TEST FIXTURE (pure functions, no server).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  PLAN_COVERS_CONTRACT_LABEL,
  RENEWAL_DAY_MS,
  SESSION_NOT_COVERED_BY_MEMBERSHIP,
  latestMembershipEnd,
  planCoversContract,
  projectRenewal,
  readMembershipNotCovered,
  renewalCaption,
  renewalDate,
  sortPlansCoveringFirst,
} from "../services/membershipRenewal";
import { coverageWarningCopy, normalizeGymOptions } from "../services/contractGymOptions";

const now = new Date("2026-11-19T05:00:00Z");
const at = (days: number) => new Date(now.getTime() + days * RENEWAL_DAY_MS);

describe("latestMembershipEnd", () => {
  it("takes the latest still-running ACTIVE membership among the brand's branches, current or queued", () => {
    const rows = [
      { gymId: "a", status: "ACTIVE", endDate: at(10).toISOString() },
      { gymId: "b", status: "ACTIVE", endDate: at(40).toISOString() }, // queued renewal at a sibling branch
      { gymId: "c", status: "ACTIVE", endDate: at(99).toISOString() }, // another brand
      { gymId: "a", status: "EXPIRED", endDate: at(200).toISOString() },
      { gymId: "a", status: "CANCELLED", endDate: at(200).toISOString() },
      { gymId: "a", status: "ACTIVE", endDate: at(-1).toISOString() }, // already over
      { gymId: "a", status: "ACTIVE", endDate: null },
    ];
    assert.equal(latestMembershipEnd(rows, ["a", "b"], now)!.getTime(), at(40).getTime());
    assert.equal(latestMembershipEnd(rows, ["zzz"], now), null);
    assert.equal(latestMembershipEnd(null, ["a"], now), null);
  });
});

describe("projectRenewal / renewalCaption", () => {
  it("a renewal starts when the running membership ends; nothing running starts now", () => {
    const r = projectRenewal(at(10), 30, now);
    assert.equal(r.isRenewal, true);
    assert.equal(r.startsAt.getTime(), at(10).getTime());
    assert.equal(r.endsAt.getTime(), at(40).getTime());
    assert.match(renewalCaption(r), /^Gia hạn: dùng tiếp từ \d\d\/\d\d\/2026, hết hạn \d\d\/\d\d\/2026$/);
    const first = projectRenewal(null, 30, now);
    assert.equal(first.isRenewal, false);
    assert.equal(first.startsAt.getTime(), now.getTime());
    assert.equal(first.endsAt.getTime(), at(30).getTime());
    assert.match(renewalCaption(first), /^Hết hạn dự kiến /);
    assert.equal(projectRenewal(at(-3), 30, now).isRenewal, false, "an ended membership is not a renewal");
  });
  it("renewalDate is dd/MM/yyyy", () => {
    assert.match(renewalDate(new Date(2026, 11, 9)), /^09\/12\/2026$/);
  });
});

describe("PT-contract hint: plans that are enough come first, nothing is required", () => {
  const plans = [
    { id: "1m", durationDays: 30 },
    { id: "3m", durationDays: 90 },
    { id: "6m", durationDays: 180 },
  ];
  it("with 10 days left and a contract ending in 60 days, 3m and 6m cover it (10+90, 10+180) and sort first; 1m (10+30=40) does not", () => {
    const sorted = sortPlansCoveringFirst(plans, at(10), at(60), now);
    assert.deepEqual(sorted.map((p) => p.id), ["3m", "6m", "1m"]);
    assert.equal(planCoversContract(projectRenewal(at(10), 30, now), at(60)), false);
    assert.equal(planCoversContract(projectRenewal(at(10), 90, now), at(60)), true);
    assert.equal(PLAN_COVERS_CONTRACT_LABEL, "Đủ cho hợp đồng PT");
  });
  it("without a contract date nothing is reordered or marked", () => {
    assert.deepEqual(sortPlansCoveringFirst(plans, at(10), null, now).map((p) => p.id), ["1m", "3m", "6m"]);
    assert.equal(planCoversContract(projectRenewal(null, 30, now), null), false);
  });
  it("a first purchase (no membership) is judged from today", () => {
    assert.deepEqual(sortPlansCoveringFirst(plans, null, at(60), now).map((p) => p.id), ["3m", "6m", "1m"]);
  });
});

describe("gym-options coverage warning (pickable, not blocked)", () => {
  const gym = (eligibility: unknown) => ({
    gymId: "g1", name: "Mekong", membership: { hasActiveMembership: true, planName: "Gói 1 tháng", endDate: "2026-12-19T00:00:00.000Z" }, eligibility,
  });
  it("coversContract false: still selectable, warning with the end date, offers renewal, carries the contract end", () => {
    const view = normalizeGymOptions({ gyms: [gym({ canRequest: true, reason: null, coverage: { coversContract: false, membershipEndsAt: "2026-12-19T12:00:00.000Z", contractEndsAt: "2027-01-30T00:00:00.000Z" } })] });
    const g = view.gyms[0];
    assert.equal(g.selectable, true);
    assert.equal(g.blockedCopy, null);
    assert.equal(g.offersRenewal, true);
    assert.equal(g.offersMembershipPurchase, false);
    assert.equal(g.contractEndsAt, "2027-01-30T00:00:00.000Z");
    assert.match(g.coverageWarning!, /^Gói hội viên hết hạn 19\/12, cần gia hạn để tập các buổi sau ngày này$/);
    assert.equal(coverageWarningCopy("2026-12-19T12:00:00.000Z"), g.coverageWarning);
  });
  it("coversContract true or no coverage field: no warning, no renewal offer", () => {
    const covers = normalizeGymOptions({ gyms: [gym({ canRequest: true, reason: null, coverage: { coversContract: true, membershipEndsAt: null, contractEndsAt: "2027-01-30T00:00:00.000Z" } })] }).gyms[0];
    assert.equal(covers.coverageWarning, null);
    assert.equal(covers.offersRenewal, false);
    const old = normalizeGymOptions({ gyms: [gym({ canRequest: true, reason: null })] }).gyms[0];
    assert.equal(old.coverageWarning, null);
    assert.equal(old.selectable, true);
  });
  it("a blocked branch (membership required) never shows the renewal warning", () => {
    const g = normalizeGymOptions({ gyms: [gym({ canRequest: false, reason: "MEMBERSHIP_REQUIRED" })] }).gyms[0];
    assert.equal(g.selectable, false);
    assert.equal(g.offersRenewal, false);
    assert.equal(g.offersMembershipPurchase, true);
  });
});

describe("readMembershipNotCovered (SESSION_NOT_COVERED_BY_MEMBERSHIP 422)", () => {
  const axiosErr = (data: unknown) => ({ response: { status: 422, data } });
  it("single booking / reschedule shape: message + gymId from details", () => {
    const r = readMembershipNotCovered(axiosErr({ error: "Hãy gia hạn", code: SESSION_NOT_COVERED_BY_MEMBERSHIP, details: { gymId: "g1" } }));
    assert.deepEqual(r, { message: "Hãy gia hạn", gymId: "g1" });
  });
  it("falls back to the contract's gym when the body has none", () => {
    const r = readMembershipNotCovered(axiosErr({ error: "x", code: SESSION_NOT_COVERED_BY_MEMBERSHIP }), "g2");
    assert.equal(r?.gymId, "g2");
  });
  it("batch shape: first slot row carrying the code", () => {
    const r = readMembershipNotCovered(
      axiosErr({ error: "Chưa đặt được", code: "BATCH_BOOKING_REJECTED", slotErrors: [{ error: "trùng" }, { error: "Hết gói", code: SESSION_NOT_COVERED_BY_MEMBERSHIP, details: { gymId: "g3" } }] }),
    );
    assert.deepEqual(r, { message: "Hết gói", gymId: "g3" });
  });
  it("any other error is not a membership refusal", () => {
    assert.equal(readMembershipNotCovered(axiosErr({ error: "boom", code: "OTHER" })), null);
    assert.equal(readMembershipNotCovered(new Error("net")), null);
    assert.equal(readMembershipNotCovered(null), null);
  });
});
