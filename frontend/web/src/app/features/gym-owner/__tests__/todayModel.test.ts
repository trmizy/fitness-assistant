/**
 * TEST FIXTURE - G1 "Hôm nay" model (pure functions, fake API answers; no browser, no backend).
 * Run: npx tsx --test src/app/features/gym-owner/__tests__/todayModel.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  LOADING,
  branchRows,
  brandLevelVisible,
  buildToday,
  clockLabel,
  coverageNotice,
  freshnessLine,
  limitRows,
  ratingLabel,
  relativeAge,
  sourcesForRole,
  todayTitle,
  type Source,
  type TodayGym,
  type TodayInput,
} from "../today/todayModel";
import { canOf } from "./permFixture";
import { makeCan } from "../../../utils/gymStaffRole";

// 2026-11-22 09:41 in Ho Chi Minh time (UTC+7) = 02:41Z, a Sunday.
const NOW = Date.UTC(2026, 10, 22, 2, 41, 0);
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;

const q1: TodayGym = { id: "g1", name: "Gym Quận 1", status: "APPROVED", activeMemberCount: 412, averageRating: 4.6, reviewCount: 128 };
const q7: TodayGym = { id: "g7", name: "Gym Quận 7", status: "APPROVED", activeMemberCount: 287, averageRating: 4.4, reviewCount: 76 };
const bt: TodayGym = { id: "gb", name: "Gym Bình Thạnh", status: "PENDING_REVIEW", activeMemberCount: 0, averageRating: 0, reviewCount: 0, updatedAt: ago(20 * HOUR) };
const codes = { g1: "Q1", g7: "Q7", gb: "BT" };

const ok = <T,>(data: T, at = NOW): Source<T> => ({ state: "ok", data, at });
const err: Source<never> = { state: "error" };

const exc = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  membershipId: "m" + id,
  status: "PENDING",
  displayName: "Trần Bảo Ngọc",
  requestedByName: "Mai Anh",
  createdAt: ago(35 * MIN),
  expiresAt: new Date(NOW + 5 * HOUR).toISOString(),
  mine: false,
  ...over,
});

function input(over: Partial<TodayInput> = {}): TodayInput {
  return {
    role: "OWNER",
    can: canOf("OWNER"),
    nowMs: NOW,
    gyms: [q1, q7],
    drafts: [],
    scopeGymId: "ALL",
    codes,
    exceptions: { g1: ok({ canApprove: true, exceptions: [exc("e1")] }), g7: ok({ canApprove: true, exceptions: [] }) },
    withdrawals: { g1: ok([]), g7: ok([{ id: "w1", status: "PENDING", amount: "12000000", createdAt: ago(3 * HOUR) }]) },
    reviewIssues: {},
    complaints: ok([]),
    collaborations: ok([]),
    ptNames: {},
    ...over,
  };
}

describe("dates and ages (Asia/Ho_Chi_Minh)", () => {
  it("title carries weekday and date", () => assert.equal(todayTitle(NOW), "Hôm nay, Chủ nhật 22/11"));
  it("a late-evening UTC time rolls to the next HCM day", () => assert.equal(todayTitle(Date.UTC(2026, 10, 22, 18, 0)), "Hôm nay, Thứ hai 23/11"));
  it("clock label is HCM time", () => assert.equal(clockLabel(NOW), "09:41"));
  it("relative ages", () => {
    assert.equal(relativeAge(NOW - 10_000, NOW), "Vừa xong");
    assert.equal(relativeAge(NOW + 5 * MIN, NOW), "Vừa xong");
    assert.equal(relativeAge(NOW - 35 * MIN, NOW), "35 phút trước");
    assert.equal(relativeAge(NOW - 5 * HOUR, NOW), "5 giờ trước");
    assert.equal(relativeAge(NOW - 26 * HOUR, NOW), "1 ngày trước");
    assert.equal(relativeAge(NOW - 10 * 24 * HOUR, NOW), "12/11/2026");
    assert.equal(relativeAge(null, NOW), "");
    assert.equal(relativeAge(Number.NaN, NOW), "");
  });
});

describe("which sources a role reads", () => {
  it("OWNER reads everything; MANAGER only exceptions + complaints; others nothing; unknown fails closed", () => {
    assert.deepEqual(Object.values(sourcesForRole(canOf("OWNER"), "OWNER")), [true, true, true, true, true]);
    assert.deepEqual(sourcesForRole(canOf("MANAGER"), "MANAGER"), { exceptions: true, withdrawals: false, reviewIssues: false, complaints: true, collaborations: false });
    assert.ok(Object.values(sourcesForRole(canOf("RECEPTIONIST"), "RECEPTIONIST")).every((v) => !v));
    // The accountant holds finance.withdrawals.view (so the permission table says yes), but no route sends an accountant to Hôm nay.
    assert.deepEqual(sourcesForRole(canOf("ACCOUNTANT"), "ACCOUNTANT"), { exceptions: false, withdrawals: true, reviewIssues: false, complaints: false, collaborations: false });
    assert.ok(Object.values(sourcesForRole(makeCan("OWNER", undefined), "OWNER")).every((v) => !v), "a known role without permissions[] reads nothing");
    assert.ok(Object.values(sourcesForRole(canOf(undefined), undefined)).every((v) => !v));
  });
  it("brand-level rows show on ALL or a one-branch brand only", () => {
    assert.equal(brandLevelVisible("ALL", 3), true);
    assert.equal(brandLevelVisible("g1", 3), false);
    assert.equal(brandLevelVisible("g1", 1), true);
  });
});

describe("buildToday", () => {
  it("builds exception + withdrawal rows with real names, branch, age and the existing-screen href", () => {
    const m = buildToday(input());
    const e = m.tasks.find((t) => t.kind === "exception")!;
    assert.equal(e.text, "Ngoại lệ check-in của Trần Bảo Ngọc chờ duyệt");
    assert.equal(e.sub, "Người xin: Mai Anh");
    assert.equal(e.gymId, "g1");
    assert.equal(e.group, "decide");
    assert.equal(e.href, "/gym-owner/front-desk?gymId=g1&tab=exceptions&exception=e1");
    const w = m.tasks.find((t) => t.kind === "withdrawal")!;
    assert.equal(w.group, "wait");
    assert.match(w.text, /^Lệnh rút .*12\.000\.000.* ở Gym Quận 7 đang chờ Gymini duyệt$/);
    assert.equal(w.href, "/gym-owner/finance?gymId=g7");
    assert.deepEqual(m.counts, { decide: 1, wait: 1 });
    assert.equal(m.complete, true);
  });

  it("an exception the viewer asked for is a wait row; non-pending and expired ones are not tasks", () => {
    const m = buildToday(
      input({
        exceptions: {
          g1: ok({ canApprove: true, exceptions: [exc("a", { mine: true }), exc("b", { status: "APPROVED" }), exc("c", { expiresAt: new Date(NOW - MIN).toISOString() }), exc("d", { status: "USED" })] }),
          g7: ok({ canApprove: true, exceptions: [] }),
        },
        withdrawals: { g1: ok([]), g7: ok([]) },
      }),
    );
    assert.equal(m.tasks.length, 1);
    assert.equal(m.tasks[0].group, "wait");
    assert.match(m.tasks[0].text, /do bạn xin, chờ người khác duyệt/);
  });

  it("a viewer who cannot approve sees only their own pending requests", () => {
    const m = buildToday(input({ exceptions: { g1: ok({ canApprove: false, exceptions: [exc("a"), exc("b", { mine: true })] }), g7: ok({ canApprove: false, exceptions: [] }) }, withdrawals: { g1: ok([]), g7: ok([]) } }));
    assert.deepEqual(m.tasks.map((t) => t.id), ["exception:b"]);
  });

  it("withdrawals: only PENDING; APPROVED / PAID / REJECTED are not waiting for Gymini", () => {
    const m = buildToday(input({ exceptions: { g1: ok({ canApprove: true, exceptions: [] }), g7: ok({ canApprove: true, exceptions: [] }) }, withdrawals: { g1: ok([{ id: "x", status: "APPROVED", amount: "1" }, { id: "y", status: "PAID", amount: "1" }, { id: "z", status: "REJECTED", amount: "1" }]), g7: ok([]) } }));
    assert.equal(m.tasks.length, 0);
    assert.equal(m.complete, true);
  });

  it("one failing branch: coverage reported, the branch is never counted as 0, no total", () => {
    const m = buildToday(input({ exceptions: { g1: ok({ canApprove: true, exceptions: [exc("e1")] }), g7: err } }));
    assert.deepEqual(m.failedGymIds, ["g7"]);
    assert.equal(m.counts, null);
    assert.equal(m.complete, false);
    assert.deepEqual(m.coverage, { loaded: 1, total: 2 });
    const n = coverageNotice(m, codes)!;
    assert.match(n.text, /Đã tải 1\/2 chi nhánh, Q7 lỗi/);
    assert.equal(freshnessLine(m, false), "Cập nhật 09:41, 1/2 chi nhánh");
    const rows = branchRows([q1, q7], m, codes, () => "x");
    assert.equal(rows.find((r) => r.id === "g7")!.openTasks, null, "failed branch has unknown open tasks, not 0");
    assert.equal(rows.find((r) => r.id === "g1")!.openTasks, 1);
  });

  it("a failed brand source blocks the total and is named", () => {
    const m = buildToday(input({ complaints: err, collaborations: err }));
    assert.deepEqual(m.failedBrandSources, ["complaints", "collaborations"]);
    assert.equal(m.counts, null);
    assert.match(coverageNotice(m, codes)!.text, /Chưa tải được khiếu nại, thỏa thuận PT/);
  });

  it("still loading: no total, no empty claim, freshness says loading", () => {
    const m = buildToday(input({ exceptions: { g1: LOADING, g7: ok({ canApprove: true, exceptions: [] }) }, withdrawals: { g1: LOADING, g7: LOADING }, complaints: LOADING, collaborations: LOADING }));
    assert.equal(m.loading, true);
    assert.equal(m.counts, null);
    assert.equal(m.complete, false);
    assert.equal(freshnessLine(m, false), "Cập nhật 09:41, đang tải thêm");
    assert.equal(freshnessLine(buildToday(input({ exceptions: {}, withdrawals: {}, complaints: LOADING, collaborations: LOADING })), false), "Đang tải");
  });

  it("all loaded and nothing to do: empty, counts are real zeros, line says đủ n/n", () => {
    const m = buildToday(input({ exceptions: { g1: ok({ canApprove: true, exceptions: [] }), g7: ok({ canApprove: true, exceptions: [] }) }, withdrawals: { g1: ok([]), g7: ok([]) } }));
    assert.equal(m.tasks.length, 0);
    assert.deepEqual(m.counts, { decide: 0, wait: 0 });
    assert.equal(freshnessLine(m, false), "Cập nhật 09:41, đủ 2/2 chi nhánh");
  });

  it("complaints: awaiting the gym is decide (with deadline), other open ones are wait with the server's own sentence", () => {
    const items = [
      { id: "c1", gymId: "g7", issueType: "CLEANLINESS", progress: "Đang xử lý", canSubmit: true, awaitingYou: true, respondBy: new Date(NOW + 2 * 24 * HOUR).toISOString(), createdAt: ago(26 * HOUR) },
      { id: "c2", gymId: "g1", issueType: "CLEANLINESS", progress: "Gymini đang xem xét", canSubmit: true, awaitingYou: false, respondBy: null, createdAt: ago(2 * HOUR) },
      { id: "c3", gymId: "g1", issueType: "CLEANLINESS", progress: "Đã đóng", canSubmit: false, awaitingYou: false, respondBy: null, createdAt: ago(2 * HOUR) },
    ];
    const m = buildToday(input({ complaints: ok(items), exceptions: { g1: ok({ canApprove: true, exceptions: [] }), g7: ok({ canApprove: true, exceptions: [] }) }, withdrawals: { g1: ok([]), g7: ok([]) } }));
    const c1 = m.tasks.find((t) => t.id === "complaint:c1")!;
    assert.equal(c1.group, "decide");
    assert.equal(c1.href, "/gym-owner/complaint-cases/c1");
    assert.equal(c1.sub, "Hạn phản hồi 24/11");
    const c2 = m.tasks.find((t) => t.id === "complaint:c2")!;
    assert.equal(c2.group, "wait");
    assert.equal(c2.sub, "Gymini đang xem xét");
    assert.equal(m.tasks.find((t) => t.id === "complaint:c3"), undefined, "closed case is not a task");
  });

  it("single-branch scope keeps only that branch's rows and drops brand-level rows", () => {
    const collab = [{ id: "a1", scope: "BRAND", brandId: "b", ptUserId: "pt1", status: "COUNTERED", proposedBy: "PT", round: 2, brand: { id: "b", name: "Brand" }, updatedAt: ago(5 * HOUR) }];
    const m = buildToday(input({ scopeGymId: "g1", collaborations: ok(collab), complaints: ok([{ id: "c9", gymId: "g7", issueType: "OTHER", progress: "x", canSubmit: true, awaitingYou: true, respondBy: null, createdAt: ago(HOUR) }]) }));
    assert.deepEqual(m.tasks.map((t) => t.kind), ["exception"]);
    assert.deepEqual(m.coverage, { loaded: 1, total: 1 });
  });

  it("PT agreement waiting for the gym: named, round, brand-level, link to collaborations", () => {
    const collab = [
      { id: "a1", scope: "BRAND", brandId: "b", ptUserId: "pt1", status: "COUNTERED", proposedBy: "PT", round: 2, brand: { id: "b", name: "Brand" }, updatedAt: ago(5 * HOUR) },
      { id: "a2", scope: "BRAND", brandId: "b", ptUserId: "pt2", status: "PENDING", proposedBy: "GYM", round: 1, brand: { id: "b", name: "Brand" } },
      { id: "a3", scope: "BRAND", brandId: "b", ptUserId: "pt3", status: "ACCEPTED", proposedBy: "PT", round: 1, brand: { id: "b", name: "Brand" } },
    ];
    const m = buildToday(input({ collaborations: ok(collab), ptNames: { pt1: "Đỗ Minh Quân" }, exceptions: { g1: ok({ canApprove: true, exceptions: [] }), g7: ok({ canApprove: true, exceptions: [] }) }, withdrawals: { g1: ok([]), g7: ok([]) } }));
    assert.equal(m.tasks.length, 1);
    assert.equal(m.tasks[0].text, "PT Đỗ Minh Quân đề xuất lại tỷ lệ chia, vòng 2");
    assert.equal(m.tasks[0].gymId, null);
    assert.equal(m.tasks[0].href, "/gym-owner/collaborations");
    const noName = buildToday(input({ collaborations: ok(collab) }));
    assert.match(noName.tasks.find((t) => t.kind === "collaboration")!.text, /^Một PT đề xuất lại/);
  });

  it("branches: pending review is a wait row, rejected is decide; drafts with open issues are decide (brand level)", () => {
    const m = buildToday(
      input({
        gyms: [q1, bt, { ...q7, status: "REJECTED", updatedAt: ago(HOUR) }],
        drafts: [{ id: "d1", name: "Gym Thủ Đức", status: "DRAFT", updatedAt: ago(30 * HOUR) }],
        reviewIssues: { d1: ok([{ id: "i1", resolvedAt: null, createdAt: ago(3 * HOUR) }, { id: "i2", resolvedAt: null, createdAt: ago(4 * HOUR) }, { id: "i3", resolvedAt: ago(HOUR), createdAt: ago(9 * HOUR) }]) },
        exceptions: { g1: ok({ canApprove: true, exceptions: [] }) },
        withdrawals: { g1: ok([]) },
      }),
    );
    const byId = Object.fromEntries(m.tasks.map((t) => [t.id, t]));
    assert.equal(byId["branch-pending:gb"].group, "wait");
    assert.equal(byId["branch-rejected:g7"].group, "decide");
    assert.equal(byId["branch-issues:d1"].text, "Hồ sơ Gym Thủ Đức còn 2 mục cần bổ sung");
    assert.equal(byId["branch-issues:d1"].href, "/gym-owner/gyms/wizard/d1");
    assert.equal(byId["branch-pending:gb"].href, "/gym-owner/gyms/gb");
    assert.equal(m.complete, true, "branches that are not live are not fetched, so they cannot fail");
  });

  it("MANAGER: no withdrawals, collaborations or branch-paperwork rows even when passed in", () => {
    const m = buildToday(
      input({
        role: "MANAGER",
        can: canOf("MANAGER"),
        gyms: [q1, bt],
        withdrawals: { g1: ok([{ id: "w", status: "PENDING", amount: "5" }]) },
        collaborations: ok([{ id: "a1", scope: "BRAND", brandId: "b", ptUserId: "p", status: "PENDING", proposedBy: "PT" }]),
        exceptions: { g1: ok({ canApprove: true, exceptions: [exc("e1")] }) },
        complaints: ok([]),
      }),
    );
    assert.deepEqual(m.tasks.map((t) => t.kind), ["exception"]);
  });

  it("RECEPTIONIST / ACCOUNTANT / unknown role build nothing (fail-closed)", () => {
    for (const role of ["RECEPTIONIST", undefined] as const) {
      const m = buildToday(input({ role, can: canOf(role) }));
      assert.equal(m.tasks.length, 0);
    }
    // The accountant holds finance.withdrawals.view only (no route reaches Hôm nay for them): no exception, complaint or PT task.
    const a = buildToday(input({ role: "ACCOUNTANT", can: canOf("ACCOUNTANT") }));
    assert.deepEqual([...new Set(a.tasks.map((t) => t.kind))].filter((k) => k !== "withdrawal"), []);
  });

  it("sorted newest first inside each group; ties are stable by id", () => {
    const m = buildToday(
      input({
        exceptions: { g1: ok({ canApprove: true, exceptions: [exc("old", { createdAt: ago(5 * HOUR) }), exc("new", { createdAt: ago(MIN) }), exc("mid", { createdAt: ago(HOUR) })] }), g7: ok({ canApprove: true, exceptions: [] }) },
        withdrawals: { g1: ok([]), g7: ok([]) },
      }),
    );
    assert.deepEqual(m.decide.map((t) => t.id), ["exception:new", "exception:mid", "exception:old"]);
  });
});

describe("limits, ratings and branch rows", () => {
  it("limitRows caps at the limit and reports the hidden count", () => {
    const rows = Array.from({ length: 11 }, (_, i) => i);
    assert.deepEqual(limitRows(rows, 8, false), { shown: rows.slice(0, 8), hidden: 3 });
    assert.deepEqual(limitRows(rows, 8, true), { shown: rows, hidden: 0 });
    assert.deepEqual(limitRows([1, 2], 8, false), { shown: [1, 2], hidden: 0 });
  });
  it("rating: no review reads 'Chưa có đánh giá', never 0,0", () => {
    assert.equal(ratingLabel(0, 0), "Chưa có đánh giá");
    assert.equal(ratingLabel(undefined, undefined), "Chưa có đánh giá");
    assert.equal(ratingLabel(4.6, 128), "4,6 (128 đánh giá)");
    assert.equal(ratingLabel(4, 3), "4,0 (3 đánh giá)");
  });
  it("branch rows carry code, members and open-task counts; members unknown stays null", () => {
    const m = buildToday(input());
    const rows = branchRows([q1, { ...q7, activeMemberCount: undefined }], m, codes, (g) => g.name);
    assert.deepEqual(rows.map((r) => [r.code, r.members, r.openTasks]), [["Q1", 412, 1], ["Q7", null, 1]]);
    assert.equal(rows[0].href, "/gym-owner/gyms/g1");
  });
  it("branch row open-task counts are unknown while loading", () => {
    const m = buildToday(input({ complaints: LOADING }));
    assert.ok(branchRows([q1], m, codes, () => "").every((r) => r.openTasks === null));
  });
});
