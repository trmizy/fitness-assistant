/**
 * Phase 12 — Gym Owner helpers. The access-state contract is gym-service's
 * `deriveAccessState` (partner-application.state.ts); the one-owner-one-brand invariant is
 * `GymBrand.@@unique([ownerId])` plus `createGym` resolving the brand from ownership.
 *
 * Runs with: npx tsx --test src/features/__tests__/gymOwner.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  APPLICANT_STATES,
  accessStateText,
  acceptedCollabCount,
  attentionItems,
  branchAddress,
  branchFormError,
  branchName,
  branchPayload,
  branchStatus,
  branchesOfBrand,
  brandDisplayName,
  brandNameError,
  brandPendingName,
  canOperate,
  checkinTrend,
  countByStatus,
  draftGyms,
  EMPTY_BRANCH_FORM,
  isApplicant,
  isBrandOwner,
  isManagerAccount,
  memberLabel,
  membershipMix,
  needsBrandFirst,
  operationalStatus,
  ownedGyms,
  ownerLanding,
  pendingCollabCount,
  recentMemberships,
  showsBranchStats,
  standaloneGyms,
  theBrand,
  todayCheckinCount,
} from "../gymOwner/gymOwner";
import { geocodeAttempts, stripHouseNumber } from "../gymOwner/geocode";
import type { PartnerAccessState } from "../../services/api";

const ALL_STATES: PartnerAccessState[] = [
  "LEGACY",
  "SETUP_INCOMPLETE",
  "RESTRICTED",
  "ONBOARDING",
  "UNDER_REVIEW",
  "CHANGES_REQUESTED",
  "REJECTED",
  "APPROVED_PAYOUT_PENDING",
  "ACTIVE",
  "SUSPENDED",
  "TERMINATED",
];

describe("access state gate", () => {
  it("only ACTIVE and LEGACY may operate — everything else is closed", () => {
    for (const s of ALL_STATES) {
      assert.equal(canOperate(s), s === "ACTIVE" || s === "LEGACY", s);
    }
    assert.equal(canOperate(null), false);
    assert.equal(canOperate(undefined), false);
  });

  it("every real state lands somewhere explicit — nothing falls through to operational", () => {
    const expected: Record<PartnerAccessState, string> = {
      LEGACY: "operational",
      ACTIVE: "operational",
      APPROVED_PAYOUT_PENDING: "payout",
      SETUP_INCOMPLETE: "application",
      ONBOARDING: "application",
      UNDER_REVIEW: "application",
      CHANGES_REQUESTED: "application",
      REJECTED: "application",
      RESTRICTED: "blocked",
      SUSPENDED: "blocked",
      TERMINATED: "blocked",
    };
    for (const s of ALL_STATES) assert.equal(ownerLanding(s), expected[s], s);
  });

  it("an unknown or missing state never opens the workspace", () => {
    assert.equal(ownerLanding(null), "application");
    assert.equal(ownerLanding("SOMETHING_NEW" as PartnerAccessState), "blocked");
    assert.equal(canOperate("SOMETHING_NEW" as PartnerAccessState), false);
  });

  it("the applicant set matches web's APPLICANT_STATES exactly", () => {
    for (const s of ALL_STATES) {
      assert.equal(isApplicant(s), APPLICANT_STATES.includes(s), s);
    }
  });

  it("every state has Vietnamese wording, and an unknown one degrades safely", () => {
    for (const s of ALL_STATES) {
      assert.ok(accessStateText(s).title.length > 0, s);
      assert.notEqual(accessStateText(s).title, s);
    }
    assert.match(accessStateText(null).title, /Chưa xác định/);
  });

  it("only a MANAGER loses the brand controls — anything else is treated as the owner", () => {
    assert.equal(isBrandOwner({ role: "OWNER" }), true);
    assert.equal(isBrandOwner({ role: "MANAGER" }), false);
    // Status not loaded yet: web shows the owner controls, and the server refuses a manager
    // anyway — so the default must match web rather than hiding a real owner's own buttons.
    assert.equal(isBrandOwner(undefined), true);
  });

  it("isManagerAccount is only true once the status says MANAGER (owner-only money/collab surfaces)", () => {
    assert.equal(isManagerAccount({ role: "MANAGER" }), true);
    assert.equal(isManagerAccount({ role: "OWNER" }), false);
    assert.equal(isManagerAccount(undefined), false);
  });
});

describe("branches", () => {
  const gyms = [
    { id: "g1", name: "CN Quận 1", address: "1 Lê Lợi", city: "TP.HCM", status: "APPROVED", operationalStatus: "OPEN", brandId: "b1" },
    { id: "g2", name: "Tên cũ", pendingName: "Tên mới", address: "Cũ", pendingAddress: "Mới", status: "PENDING_REVIEW", brandId: "b1" },
    { id: "g3", status: "DRAFT", brandId: "b1" },
    { id: "g4", name: "Cũ không thương hiệu", address: "x", status: "APPROVED" },
    { nope: true },
  ];

  it("reads every envelope shape and drops rows without an id", () => {
    assert.equal(ownedGyms(gyms).length, 4);
    assert.equal(ownedGyms({ gyms }).length, 4);
    assert.equal(ownedGyms({ data: gyms }).length, 4);
    assert.equal(ownedGyms(null).length, 0);
  });

  it("a branch under review shows what the owner submitted, not the old approved value", () => {
    const [g1, g2, g3] = ownedGyms(gyms);
    assert.equal(branchName(g1), "CN Quận 1");
    assert.equal(branchAddress(g1), "1 Lê Lợi, TP.HCM");
    assert.equal(branchName(g2), "Tên mới");
    assert.equal(branchAddress(g2), "Mới");
    assert.equal(branchName(g3), "Chi nhánh chưa đặt tên");
    assert.equal(branchAddress(g3), "Chưa có địa chỉ");
  });

  it("status labels cover the real GymStatus enum and nothing invented", () => {
    for (const s of ["DRAFT", "PENDING_REVIEW", "APPROVED", "REJECTED", "SUSPENDED"]) {
      assert.notEqual(branchStatus(s).label, s, s);
    }
    // There is no bare "PENDING" in the enum — if one ever appears it must show as unknown,
    // not be quietly mapped to "chờ duyệt".
    assert.equal(branchStatus("PENDING").label, "PENDING");
    assert.equal(operationalStatus("OPEN")?.label, "Đang mở cửa");
    assert.equal(operationalStatus(null), null, "chi nhánh chưa duyệt thì không có trạng thái mở cửa");
  });

  it("stats only show for a branch the public can already see", () => {
    const rows = ownedGyms(gyms);
    assert.equal(showsBranchStats(rows[0]), true);
    assert.equal(showsBranchStats(rows[1]), false, "PENDING_REVIEW chưa từng có hội viên — số 0 đọc như thất bại");
  });

  it("drafts, brand branches and legacy standalone gyms never mix", () => {
    const rows = ownedGyms(gyms);
    assert.deepEqual(draftGyms(rows).map((g) => g.id), ["g3"]);
    assert.deepEqual(branchesOfBrand(rows, "b1").map((g) => g.id), ["g1", "g2"]);
    assert.deepEqual(standaloneGyms(rows).map((g) => g.id), ["g4"]);
  });

  it("branch form asks for the two things the server requires — and never a brand", () => {
    assert.equal(branchFormError({ name: "CN 2", address: "12 Trần Hưng Đạo" }), null);
    assert.ok(branchFormError({ name: " ", address: "x" }));
    assert.ok(branchFormError({ name: "x", address: " " }));
  });

  it("the payload carries no brandId, and drops fields the owner left empty", () => {
    const bare = branchPayload({ ...EMPTY_BRANCH_FORM, name: " CN 3 ", address: " 5 Hai Bà Trưng " });
    assert.deepEqual(bare, { name: "CN 3", address: "5 Hai Bà Trưng" });
    assert.ok(!("brandId" in bare));

    const full = branchPayload({
      name: "CN 4",
      address: "7 Nguyễn Huệ",
      city: "TP.HCM",
      description: "x".repeat(400),
      provinceCode: "79",
      wardCode: "26734",
      latitude: 10.77,
      longitude: 106.7,
    });
    assert.equal(full.provinceCode, 79);
    assert.equal(full.wardCode, 26734);
    assert.equal(full.description!.length, 300, "giới thiệu bị cắt đúng trần 300 ký tự");
    assert.equal(full.latitude, 10.77);
  });

  it("a half-placed pin is never sent — one coordinate alone is not a location", () => {
    const half = branchPayload({ ...EMPTY_BRANCH_FORM, name: "a", address: "b", latitude: 10.77, longitude: null });
    assert.ok(!("latitude" in half));
  });
});

describe("cần chú ý", () => {
  it("lists branches waiting for first review and branches sent back, with the admin's note", () => {
    const rows = ownedGyms([
      { id: "a", name: "A", status: "PENDING_REVIEW" },
      { id: "b", name: "B", status: "APPROVED", changesRequestedAt: "2026-09-20", pendingNameNote: "Tên trùng" },
      { id: "c", name: "C", status: "APPROVED", changesRequestedAt: "2026-09-20", pendingAddressNote: "Sai phường" },
      { id: "d", name: "D", status: "APPROVED", changesRequestedAt: "2026-09-20", pendingNameNote: "x", pendingAddressNote: "y" },
      { id: "e", name: "E", status: "APPROVED", changesRequestedAt: "2026-09-20" },
      { id: "f", name: "F", status: "APPROVED" },
    ]);
    const items = attentionItems(rows);
    assert.deepEqual(items.map((i) => i.gymId), ["a", "b", "c", "d", "e"]);
    assert.match(items[0].detail, /xét duyệt lần đầu/);
    assert.match(items[1].detail, /Tên trùng/);
    assert.match(items[2].detail, /Sai phường/);
    assert.match(items[3].detail, /tên và địa chỉ/);
    assert.match(items[4].detail, /chỉnh sửa/, "yêu cầu sửa không kèm ghi chú vẫn phải hiện");
  });

  it("nothing to act on means an empty list, not a reassuring card", () => {
    assert.equal(attentionItems(ownedGyms([{ id: "x", status: "APPROVED" }])).length, 0);
  });
});

describe("dashboard figures", () => {
  const iso = (d: Date) => d.toISOString();
  const now = new Date("2026-09-25T10:00:00Z");
  const daysAgo = (n: number) => {
    const d = new Date(now);
    d.setDate(now.getDate() - n);
    return iso(d);
  };

  it("today's check-ins count only today, in local time", () => {
    const rows = [{ createdAt: iso(now) }, { createdAt: iso(now) }, { createdAt: daysAgo(1) }, { createdAt: null }];
    assert.equal(todayCheckinCount(rows, now), 2);
  });

  it("the trend is seven days ending today, oldest first", () => {
    const rows = [{ createdAt: iso(now) }, { createdAt: daysAgo(3) }, { createdAt: daysAgo(3) }, { createdAt: daysAgo(30) }];
    const t = checkinTrend(rows, now);
    assert.equal(t.length, 7);
    assert.equal(t[6].count, 1, "hôm nay ở cuối");
    assert.equal(t[3].count, 2);
    assert.equal(
      t.reduce((s, d) => s + d.count, 0),
      3,
      "lượt của 30 ngày trước không lọt vào cửa sổ 7 ngày",
    );
  });

  it("the membership mix keeps every status the server sent, including PENDING_ISSUE", () => {
    const mix = membershipMix([
      { status: "ACTIVE" },
      { status: "ACTIVE" },
      { status: "PENDING_ISSUE" },
      { status: "EXPIRED" },
      { status: null },
    ]);
    assert.deepEqual(mix, [
      { status: "ACTIVE", count: 2 },
      { status: "PENDING_ISSUE", count: 1 },
      { status: "EXPIRED", count: 1 },
    ]);
  });

  it("counts by status, and a collaboration belongs to one branch not the whole brand", () => {
    assert.equal(countByStatus([{ status: "ACTIVE" }, { status: "INACTIVE" }], "ACTIVE"), 1);
    const collabs = [
      { gymId: "g1", status: "ACCEPTED" },
      { gymId: "g2", status: "ACCEPTED" },
      { gymId: "g1", status: "PENDING" },
      { gymId: "g1", status: "COUNTERED" },
    ];
    assert.equal(acceptedCollabCount(collabs, "g1"), 1);
    assert.equal(pendingCollabCount(collabs), 2);
  });

  it("a member is shown by a short id — the owner is never handed an invented name", () => {
    assert.equal(memberLabel("1234567890abcdef"), "Khách #12345678");
    assert.equal(memberLabel(null), "Khách");
  });

  it("recent memberships are newest first and capped", () => {
    const rows = [
      { id: "a", createdAt: "2026-09-01" },
      { id: "b", createdAt: "2026-09-20" },
      { id: "c", createdAt: "2026-09-10" },
    ];
    assert.deepEqual(recentMemberships(rows, 2).map((r) => r.id), ["b", "c"]);
  });
});

describe("the one brand", () => {
  it("returns the single brand; a second row would be a data fault, not a choice to offer", () => {
    assert.equal(theBrand([{ id: "b1", name: "Gymini Fitness" }])?.name, "Gymini Fitness");
    assert.equal(theBrand({ brands: [{ id: "b1" }] })?.id, "b1");
    assert.equal(theBrand([]), null);
    assert.equal(theBrand(null), null);
  });

  it("no brand means the branch form must wait — createGym throws otherwise", () => {
    assert.equal(needsBrandFirst([]), true);
    assert.equal(needsBrandFirst([{ id: "b1" }]), false);
  });

  it("shows the approved name while a rename waits, and says the rename is waiting", () => {
    const pending = { id: "b1", name: "Tên mới", approvedName: "Tên đã duyệt", pendingName: "Tên mới" };
    assert.equal(brandDisplayName(pending), "Tên đã duyệt");
    assert.equal(brandPendingName(pending), "Tên mới");

    const settled = { id: "b2", name: "Gymini", approvedName: "Gymini", pendingName: null };
    assert.equal(brandPendingName(settled), null);

    // updateBrand writes pendingName on every save, so re-saving the approved name leaves a
    // pending rename to that same name. That is not a change worth announcing.
    const noop = { id: "b4", name: "Gymini", approvedName: "Gymini", pendingName: "Gymini" };
    assert.equal(brandPendingName(noop), null);

    // Brand-new brand: approvedName is null until an admin approves its first branch.
    assert.equal(brandDisplayName({ id: "b3", name: "Vừa tạo" }), "Vừa tạo");
    assert.equal(brandDisplayName(null), "Thương hiệu của bạn");
  });

  it("brand name validation", () => {
    assert.equal(brandNameError("Gymini"), null);
    assert.ok(brandNameError("   "));
    assert.ok(brandNameError("A"));
  });
});

describe("geocoding the address into a pin", () => {
  it("strips a house number so a failed exact lookup can retry at street level", () => {
    assert.equal(stripHouseNumber("123/4 Lê Lợi"), "Lê Lợi");
    assert.equal(stripHouseNumber("Lê Lợi"), "Lê Lợi");
  });

  it("always includes the ward — without it Nominatim finds the wrong street of that name", () => {
    const { attempts, area } = geocodeAttempts({ street: "123 Phan Xích Long", ward: "Phường Cầu Kiệu", province: "Hồ Chí Minh" });
    assert.equal(area, "Phường Cầu Kiệu, Hồ Chí Minh");
    assert.deepEqual(attempts, [
      "123 Phan Xích Long, Phường Cầu Kiệu, Hồ Chí Minh",
      "Phan Xích Long, Phường Cầu Kiệu, Hồ Chí Minh",
      "Phường Cầu Kiệu, Hồ Chí Minh",
    ]);
  });

  it("an address with no house number does not retry the identical query twice", () => {
    const { attempts } = geocodeAttempts({ street: "Phan Xích Long", ward: "P. Cầu Kiệu", province: "HCM" });
    assert.equal(attempts.length, 2);
  });
});
