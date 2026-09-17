/**
 * CL-09 logic. The shapes are real ones taken from the running gateway on 2026-09-17, including the
 * detail that a plan's price arrives as a STRING and that plans hang off the BRAND.
 *
 * Runs with: npx tsx --test src/features/__tests__/gymDirectory.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  daysRemaining,
  groupByBrand,
  gymBlockedReason,
  membershipStatusLabel,
  multiGymWarningText,
  normalizeGym,
  normalizeGyms,
  normalizeMemberships,
  normalizePlans,
  planDurationLabel,
  planOnSale,
  planVisitsLabel,
  purchaseBlockedReason,
  searchGyms,
  normalizeWarnings,
  type GymRow,
  type PlanRow,
} from "../services/gymDirectory";

const RAW_GYM = {
  id: "5ca16678-988f-4803-bbc6-53ae0dc2a652",
  brandId: "dad58a17-e6eb-4e81-891c-8a4d525539d3",
  name: "Complaint Gym",
  approvedName: "Complaint Gym",
  address: "9 Complaint Street",
  approvedAddress: "9 Complaint Street",
  city: "Test City",
  facilities: [],
  status: "APPROVED",
  operationalStatus: "OPEN",
  averageRating: 0,
  reviewCount: 0,
  fromPrice: 300000,
  brand: { id: "dad58a17-e6eb-4e81-891c-8a4d525539d3", name: "Chain X Premium", approvedName: "Chain X Premium" },
};

const RAW_PLANS = [
  {
    id: "6bf5fd47-bb5f-4b11-a779-81355d7c4641",
    brandId: "dad58a17-e6eb-4e81-891c-8a4d525539d3",
    name: "Monthly Plan",
    description: null,
    price: "300000",
    durationDays: 30,
    visitLimit: null,
    status: "ACTIVE",
    saleStartAt: null,
    saleEndAt: null,
  },
  { id: "p2", name: "Gói ngừng bán", price: "500000", durationDays: 90, status: "INACTIVE" },
];

describe("normalizeGym", () => {
  it("reads a real row, brand included", () => {
    const gym = normalizeGym(RAW_GYM);
    assert.equal(gym.id, RAW_GYM.id);
    assert.equal(gym.brandName, "Chain X Premium");
    assert.equal(gym.city, "Test City");
    assert.equal(gym.fromPrice, 300000);
  });

  it("shows no rating at all rather than a zero-star gym", () => {
    // averageRating 0 with reviewCount 0 means "nobody has rated this", not "rated 0".
    assert.equal(normalizeGym(RAW_GYM).rating, null);
    assert.equal(normalizeGym({ ...RAW_GYM, averageRating: 4.5, reviewCount: 12 }).rating, 4.5);
  });

  it("prefers the approved name over one still awaiting approval", () => {
    const gym = normalizeGym({ ...RAW_GYM, name: "Tên vừa sửa", approvedName: "Tên đã duyệt" });
    assert.equal(gym.name, "Tên đã duyệt");
  });

  it("reads the list envelope", () => {
    assert.equal(normalizeGyms({ success: true, data: [RAW_GYM] }).length, 1);
    assert.deepEqual(normalizeGyms(null), []);
  });
});

describe("the two status axes", () => {
  const gym = normalizeGym(RAW_GYM);

  it("lets an approved, open gym through", () => {
    assert.equal(gymBlockedReason(gym), null);
  });

  it("stops a gym that fails EITHER axis, and says which", () => {
    assert.match(gymBlockedReason({ ...gym, status: "PENDING" })!, /chưa được duyệt/);
    assert.match(
      gymBlockedReason({ ...gym, operationalStatus: "TEMPORARILY_CLOSED", closureReason: "Sửa chữa" })!,
      /Sửa chữa/,
    );
    assert.match(gymBlockedReason({ ...gym, operationalStatus: "PERMANENTLY_CLOSED" })!, /vĩnh viễn/);
  });
});

describe("grouping and search", () => {
  const gyms: GymRow[] = [
    normalizeGym({ ...RAW_GYM, id: "a", name: "Chi nhánh 1" }),
    normalizeGym({ ...RAW_GYM, id: "b", name: "Chi nhánh 2" }),
    normalizeGym({
      ...RAW_GYM,
      id: "c",
      name: "California Nguyễn Văn Cừ",
      city: "TP.HCM",
      brandId: "brand-2",
      brand: { id: "brand-2", name: "California Fitness" },
    }),
  ];

  it("gathers branches under their brand", () => {
    const groups = groupByBrand(gyms);
    assert.equal(groups.length, 2);
    const chain = groups.find((g) => g.brandName === "Chain X Premium")!;
    assert.equal(chain.branches.length, 2);
  });

  it("searches name, brand and city alike", () => {
    assert.equal(searchGyms(gyms, "california").length, 1);
    assert.equal(searchGyms(gyms, "chain x").length, 2);
    assert.equal(searchGyms(gyms, "tp.hcm").length, 1);
    assert.equal(searchGyms(gyms, "  ").length, 3);
  });
});

describe("plans", () => {
  const plans = normalizePlans({ data: RAW_PLANS });

  it("turns the Decimal string into a number", () => {
    assert.equal(plans[0].price, 300000);
    assert.equal(typeof plans[0].price, "number");
  });

  it("treats a non-ACTIVE plan as not on sale", () => {
    assert.equal(planOnSale(plans[0]), true);
    assert.equal(planOnSale(plans[1]), false);
  });

  it("honours the sale window, with both dates null meaning always on sale", () => {
    const base = plans[0];
    const now = new Date("2026-09-17T00:00:00.000Z");
    assert.equal(planOnSale({ ...base, saleStartAt: "2026-09-20T00:00:00.000Z" }, now), false);
    assert.equal(planOnSale({ ...base, saleEndAt: "2026-09-10T00:00:00.000Z" }, now), false);
    assert.equal(
      planOnSale({ ...base, saleStartAt: "2026-09-01T00:00:00.000Z", saleEndAt: "2026-09-30T00:00:00.000Z" }, now),
      true,
    );
  });

  it("labels duration in months when it divides cleanly, days otherwise", () => {
    assert.equal(planDurationLabel(plans[0]), "1 tháng");
    assert.equal(planDurationLabel({ ...plans[0], durationDays: 90 }), "3 tháng");
    assert.equal(planDurationLabel({ ...plans[0], durationDays: 45 }), "45 ngày");
    assert.equal(planVisitsLabel(plans[0]), "Không giới hạn lượt tập");
    assert.equal(planVisitsLabel({ ...plans[0], visitLimit: 12 }), "12 lượt tập");
  });
});

describe("memberships", () => {
  const raw = {
    data: [
      {
        id: "m1",
        gymId: "g1",
        planId: "p1",
        status: "ACTIVE",
        priceAtPurchase: "300000",
        durationDaysSnapshot: 30,
        usedVisits: 3,
        totalVisits: null,
        startDate: "2026-09-01T00:00:00.000Z",
        endDate: "2026-10-01T00:00:00.000Z",
        createdAt: "2026-09-01T00:00:00.000Z",
      },
      {
        id: "m2",
        gymId: "g2",
        status: "PENDING_PAYMENT",
        priceAtPurchase: "500000",
        durationDaysSnapshot: 90,
        createdAt: "2026-09-16T00:00:00.000Z",
      },
    ],
  };

  it("reads prices as numbers and sorts newest first", () => {
    const rows = normalizeMemberships(raw);
    assert.deepEqual(rows.map((m) => m.id), ["m2", "m1"]);
    assert.equal(rows[1].price, 300000);
  });

  it("names every status the backend can produce, PENDING_ISSUE included", () => {
    assert.equal(membershipStatusLabel("ACTIVE").label, "Đang hiệu lực");
    assert.equal(membershipStatusLabel("PENDING_PAYMENT").label, "Chờ thanh toán");
    // Not "đã huỷ": the money moved and an admin still has to resolve it.
    assert.equal(membershipStatusLabel("PENDING_ISSUE").tone, "danger");
    assert.equal(membershipStatusLabel("SOMETHING_NEW").label, "SOMETHING_NEW");
  });

  it("counts days left, and none for a membership never activated", () => {
    const rows = normalizeMemberships(raw);
    const active = rows.find((m) => m.id === "m1")!;
    assert.equal(daysRemaining(active, new Date("2026-09-21T00:00:00.000Z")), 10);
    // Past its end date reads as 0, never a negative number.
    assert.equal(daysRemaining(active, new Date("2026-10-10T00:00:00.000Z")), 0);
    assert.equal(daysRemaining(rows.find((m) => m.id === "m2")!), null);
  });
});

describe("purchaseBlockedReason", () => {
  const gym = normalizeGym(RAW_GYM);
  const plan: PlanRow = normalizePlans({ data: RAW_PLANS })[0];

  it("lets a clean purchase through", () => {
    assert.equal(purchaseBlockedReason(gym, plan, []), null);
  });

  it("stops what the server's unique index would stop, per status", () => {
    const active = normalizeMemberships({
      data: [{ id: "m", gymId: gym.id, status: "ACTIVE", priceAtPurchase: "1" }],
    });
    assert.match(purchaseBlockedReason(gym, plan, active)!, /còn hiệu lực/);

    const pending = normalizeMemberships({
      data: [{ id: "m", gymId: gym.id, status: "PENDING_PAYMENT", priceAtPurchase: "1" }],
    });
    assert.match(purchaseBlockedReason(gym, plan, pending)!, /chờ thanh toán/);

    // A membership at a DIFFERENT gym is not a blocker — that is the warning's job, not a refusal.
    const elsewhere = normalizeMemberships({
      data: [{ id: "m", gymId: "other", status: "ACTIVE", priceAtPurchase: "1" }],
    });
    assert.equal(purchaseBlockedReason(gym, plan, elsewhere), null);
  });

  it("stops a closed gym before it ever looks at the plan", () => {
    assert.match(
      purchaseBlockedReason({ ...gym, operationalStatus: "TEMPORARILY_CLOSED" }, plan, [])!,
      /tạm đóng cửa/,
    );
  });
});

describe("the multi-gym warning", () => {
  it("reads the endpoint's list and speaks in the user's terms", () => {
    const warnings = normalizeWarnings({
      data: [{ gymId: "g9", gymName: "California Quận 1", endDate: "2026-12-01T00:00:00.000Z" }],
    });
    assert.equal(warnings.length, 1);
    const text = multiGymWarningText(warnings);
    assert.match(text, /California Quận 1/);
    // It warns, it does not forbid — the wording must not read like a refusal.
    assert.match(text, /vẫn được/);
  });
});
