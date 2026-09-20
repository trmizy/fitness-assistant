/**
 * CL-10/CL-11 logic. Every case here mirrors something the running backend actually does — the
 * shapes come from a real `GET /profile/pts` response, not from the design's mock trainers.
 *
 * Runs with: npx tsx --test src/features/__tests__/ptDiscovery.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  EMPTY_PT_FILTERS,
  activeFilterCount,
  buildContractRequestPayload,
  buildListParams,
  filterError,
  lowAvailabilityMessage,
  lowestPerSessionPrice,
  matchesSpecialty,
  mergePtSources,
  normalizePackages,
  normalizePartnerGyms,
  normalizePt,
  normalizePts,
  pricePerSession,
  ratesLabel,
  readLowAvailability,
  requestBlockedReason,
  serviceModeLabel,
  type ServicePackage,
} from "../services/ptDiscovery";

// Trimmed from a real row returned by the gateway on 2026-09-17.
const REAL_ROW = {
  id: "fdf72d63-284d-41c9-8664-07b933aab700",
  userId: "f506697b-32d5-4d22-9bdc-728de4f8bacf",
  firstName: "E2E",
  lastName: "Trainer",
  email: "pt@example.com",
  isPT: true,
  ptSuspended: false,
  isAcceptingClients: true,
  notAcceptingReason: null,
  photoUrl: null,
  searchCity: null,
  searchDistrict: null,
  searchWard: null,
  specialties: ["Powerlifting", "Tăng cơ"],
  avgRating: 5,
  ratingCount: 1,
  availableSlotsNext28Days: 32,
  ptApplication: {
    status: "APPROVED",
    serviceMode: "HYBRID",
    gymAffiliation: "California Fitness & Yoga - Chi nhánh Nguyễn Văn Cừ",
    desiredSessionPrice: null,
    onlinePricePerSession: 200000,
    offlinePricePerSession: 300000,
    professionalBio: "Huấn luyện viên thể hình với hơn 6 năm kinh nghiệm.",
    yearsOfExperience: "5-10",
  },
};

describe("normalizePt", () => {
  it("reads a real row the way the card needs it", () => {
    const pt = normalizePt(REAL_ROW);
    assert.equal(pt.userId, "f506697b-32d5-4d22-9bdc-728de4f8bacf");
    assert.equal(pt.name, "E2E Trainer");
    assert.equal(pt.rating, 5);
    assert.equal(pt.ratingCount, 1);
    assert.equal(pt.slots28, 32);
    assert.equal(pt.serviceMode, "HYBRID");
    assert.equal(pt.acceptingClients, true);
    assert.equal(pt.suspended, false);
  });

  it("uses userId, never the profile id — the contract request is keyed by the user", () => {
    const pt = normalizePt(REAL_ROW);
    assert.notEqual(pt.userId, REAL_ROW.id);
  });

  it("takes the LOWEST per-session price, and none at all when the PT priced nothing", () => {
    assert.equal(normalizePt(REAL_ROW).lowestPrice, 200000);
    assert.equal(
      lowestPerSessionPrice({ onlinePricePerSession: null, offlinePricePerSession: null }),
      null,
    );
    // A zero is not a price: a "free" row would otherwise sort to the top of every price filter.
    assert.equal(lowestPerSessionPrice({ desiredSessionPrice: 0 }), null);
    assert.equal(
      lowestPerSessionPrice({ offlinePricePerSession: 300000, desiredSessionPrice: 150000 }),
      150000,
    );
  });

  it("translates a legacy English specialty to the label the chips use", () => {
    const pt = normalizePt({ ...REAL_ROW, specialties: ["Muscle Gain", "Yoga"] });
    assert.deepEqual(pt.specialties, ["Tăng cơ", "Yoga"]);
  });

  it("falls back to the email, then to a generic name, rather than rendering blank", () => {
    assert.equal(normalizePt({ userId: "u", email: "a@b.c" }).name, "a@b.c");
    assert.equal(normalizePt({ userId: "u" }).name, "Huấn luyện viên");
  });

  it("joins area from the parts the profile actually stores", () => {
    const pt = normalizePt({ ...REAL_ROW, searchWard: "Phường 1", searchCity: "TP.HCM" });
    assert.equal(pt.area, "Phường 1, TP.HCM");
    assert.equal(normalizePt(REAL_ROW).area, null);
  });

  it("reads the list envelope and drops rows with no user id", () => {
    const rows = normalizePts({ pts: [REAL_ROW, { firstName: "Không có id" }] });
    assert.equal(rows.length, 1);
    assert.deepEqual(normalizePts(null), []);
  });
});

describe("chips and filters", () => {
  it("matches a chip against the specialty list, case-insensitively", () => {
    const pt = normalizePt(REAL_ROW);
    assert.equal(matchesSpecialty(pt, "Tất cả"), true);
    assert.equal(matchesSpecialty(pt, "powerlifting"), true);
    assert.equal(matchesSpecialty(pt, "Yoga"), false);
  });

  it("counts only the filters hidden behind the sheet", () => {
    assert.equal(activeFilterCount(EMPTY_PT_FILTERS), 0);
    // The query is typed in plain sight, so it must not inflate the badge.
    assert.equal(activeFilterCount({ ...EMPTY_PT_FILTERS, q: "huy" }), 0);
    assert.equal(
      activeFilterCount({ ...EMPTY_PT_FILTERS, minPrice: "100000", sessionMode: "ONLINE" }),
      2,
    );
  });

  it("sends no empty parameters — the endpoint 400s on an empty minPrice", () => {
    assert.deepEqual(buildListParams(EMPTY_PT_FILTERS), {});
    assert.deepEqual(
      buildListParams({
        ...EMPTY_PT_FILTERS,
        q: "  huy  ",
        minPrice: "100000",
        maxPrice: "500000",
        sessionMode: "OFFLINE",
        provinceCode: "79",
      }),
      { q: "huy", minPrice: 100000, maxPrice: 500000, sessionMode: "OFFLINE", provinceCode: 79 },
    );
  });

  it("refuses an inverted price range locally instead of letting the server 400", () => {
    assert.equal(filterError(EMPTY_PT_FILTERS), null);
    assert.equal(filterError({ ...EMPTY_PT_FILTERS, minPrice: "500000", maxPrice: "100000" }) !== null, true);
    assert.equal(filterError({ ...EMPTY_PT_FILTERS, minPrice: "-5" }) !== null, true);
    assert.equal(filterError({ ...EMPTY_PT_FILTERS, minPrice: "100000", maxPrice: "100000" }), null);
  });

  it("labels the three service modes the way web does", () => {
    assert.equal(serviceModeLabel("ONLINE"), "Online qua video call");
    assert.equal(serviceModeLabel("OFFLINE"), "Offline tại phòng gym");
    assert.equal(serviceModeLabel("HYBRID"), "Online & Offline");
    assert.equal(serviceModeLabel(null), "Chưa cho biết hình thức");
  });
});

describe("packages", () => {
  const raw = [
    { id: "p1", name: "Gói 10 buổi", sessionCount: 10, price: 3000000, sessionMode: "OFFLINE" },
    { id: "p2", name: "Đã ngừng bán", sessionCount: 5, price: 1000000, sessionMode: "ONLINE", isActive: false },
    { id: "p3", name: "Đã lưu trữ", sessionCount: 5, price: 1000000, sessionMode: "ONLINE", archivedAt: "2026-01-01" },
  ];

  it("keeps only packages still on sale — the server rejects the others with a 422", () => {
    const packages = normalizePackages({ packages: raw });
    assert.deepEqual(packages.map((p) => p.id), ["p1"]);
  });

  it("derives the per-session price, and refuses to divide by zero sessions", () => {
    assert.equal(pricePerSession(normalizePackages(raw)[0]), 300000);
    assert.equal(pricePerSession({ id: "x", name: "", sessionCount: 0, price: 100, sessionMode: "" }), null);
  });
});

describe("buildContractRequestPayload", () => {
  const offline: ServicePackage = {
    id: "pkg-off",
    name: "Gói 10 buổi",
    sessionCount: 10,
    price: 3000000,
    sessionMode: "OFFLINE",
  };
  const online: ServicePackage = { ...offline, id: "pkg-on", sessionMode: "ONLINE" };

  it("sends the package id, never a price — the server prices the package itself", () => {
    const body = buildContractRequestPayload({ ptUserId: "pt-1", pkg: offline });
    assert.equal(body.packageId, "pkg-off");
    assert.equal("price" in body, false);
    assert.equal("totalSessions" in body, false);
    assert.equal(body.acknowledgedLowAvailability, false);
  });

  it("attaches a gym to an offline package only", () => {
    assert.equal(
      buildContractRequestPayload({ ptUserId: "pt-1", pkg: offline, gymId: "gym-1" }).gymId,
      "gym-1",
    );
    // An online package never carries a gym share, so sending one would be a share the gym
    // never earned — and the server would reject it anyway.
    assert.equal(
      "gymId" in buildContractRequestPayload({ ptUserId: "pt-1", pkg: online, gymId: "gym-1" }),
      false,
    );
  });

  it("omits an empty message instead of sending whitespace", () => {
    assert.equal("clientMessage" in buildContractRequestPayload({ ptUserId: "p", pkg: offline, message: "   " }), false);
    assert.equal(
      buildContractRequestPayload({ ptUserId: "p", pkg: offline, message: "  chào PT  " }).clientMessage,
      "chào PT",
    );
  });
});

describe("the low-availability 409", () => {
  const err = (data: any, status = 409) => ({ response: { status, data } });

  it("reads the two numbers the warning is about", () => {
    const info = readLowAvailability(
      err({ code: "LOW_AVAILABILITY", availableSlots: 3, packageSessions: 10, nearestAvailableSlot: "2026-09-20T08:00:00.000Z" }),
    );
    assert.equal(info?.availableSlots, 3);
    assert.equal(info?.packageSessions, 10);
    assert.equal(info?.nearestAvailableSlot, "2026-09-20T08:00:00.000Z");
    assert.match(lowAvailabilityMessage(info!), /3 khung giờ trống/);
    assert.match(lowAvailabilityMessage(info!), /10 buổi/);
  });

  it("is not confused with any other 409 or error", () => {
    assert.equal(readLowAvailability(err({ code: "ALREADY_PAID" })), null);
    assert.equal(readLowAvailability(err({ code: "LOW_AVAILABILITY" }, 400)), null);
    // Missing numbers: warning the user with a guessed figure would be worse than not warning.
    assert.equal(readLowAvailability(err({ code: "LOW_AVAILABILITY", availableSlots: 3 })), null);
    assert.equal(readLowAvailability(new Error("network")), null);
  });
});

describe("requestBlockedReason", () => {
  const pt = normalizePt(REAL_ROW);
  const pkg: ServicePackage = {
    id: "p",
    name: "Gói",
    sessionCount: 10,
    price: 1,
    sessionMode: "ONLINE",
  };

  it("lets a normal request through", () => {
    assert.equal(requestBlockedReason(pt, pkg), null);
  });

  it("stops a request the server would refuse with a 422, and says why", () => {
    assert.match(requestBlockedReason({ ...pt, suspended: true }, pkg)!, /tạm ngưng/);
    assert.match(
      requestBlockedReason({ ...pt, acceptingClients: false, notAcceptingReason: "Đang nghỉ phép" }, pkg)!,
      /Đang nghỉ phép/,
    );
    assert.match(requestBlockedReason({ ...pt, acceptingClients: false }, pkg)!, /không nhận khách mới/);
  });

  it("asks for a package when none is picked", () => {
    assert.match(requestBlockedReason(pt, null)!, /Chọn một gói/);
  });
});

describe("mergePtSources", () => {
  it("fills what the detail endpoint does not return from the list row", () => {
    // Exactly the split the gateway showed: the detail response has no ptApplication and no slots.
    const detail = {
      userId: REAL_ROW.userId,
      firstName: "E2E",
      lastName: "Trainer",
      specialties: ["Powerlifting"],
      avgRating: 5,
      ratingCount: 1,
      recentReviews: [{ rating: 5 }],
    };
    const listRow = normalizePt(REAL_ROW);
    const merged = mergePtSources(detail, listRow)!;

    assert.equal(merged.serviceMode, "HYBRID");
    assert.equal(merged.lowestPrice, 200000);
    assert.equal(merged.slots28, 32);
    assert.equal(merged.bio, REAL_ROW.ptApplication.professionalBio);
    assert.equal(merged.gymAffiliation, REAL_ROW.ptApplication.gymAffiliation);
  });

  it("keeps the detail's own values when it has them", () => {
    const listRow = normalizePt({ ...REAL_ROW, avgRating: 4, ratingCount: 9 });
    const merged = mergePtSources(REAL_ROW, listRow)!;
    assert.equal(merged.rating, 5);
    assert.equal(merged.ratingCount, 1);
  });

  it("works with either source missing", () => {
    assert.equal(mergePtSources(null, null), null);
    assert.equal(mergePtSources(REAL_ROW, null)?.serviceMode, "HYBRID");
    assert.equal(mergePtSources(null, normalizePt(REAL_ROW))?.serviceMode, "HYBRID");
  });
});

describe("normalizePartnerGyms", () => {
  // The exact envelope the gateway returned on 2026-09-17.
  const raw = {
    success: true,
    data: [
      {
        collaborationId: "eb9bb4ab-e31a-451a-9138-49cf36180ff7",
        gym: { id: "5a9e6025-7a54-4b80-b49c-bdbc6f92b227", name: "E2E Gym A", city: "Test City" },
        rates: { ptRate: "0.55", gymRate: "0.35", platformRate: "0.1" },
      },
      { collaborationId: "no-gym" },
    ],
  };

  it("takes the GYM's id, not the collaboration's", () => {
    const gyms = normalizePartnerGyms(raw);
    assert.equal(gyms.length, 1);
    assert.equal(gyms[0].gymId, "5a9e6025-7a54-4b80-b49c-bdbc6f92b227");
    assert.notEqual(gyms[0].gymId, "eb9bb4ab-e31a-451a-9138-49cf36180ff7");
    assert.equal(gyms[0].name, "E2E Gym A");
  });

  it("reads the agreed split as numbers and labels it", () => {
    const gym = normalizePartnerGyms(raw)[0];
    assert.equal(gym.ptRate, 0.55);
    assert.equal(gym.gymRate, 0.35);
    assert.equal(ratesLabel(gym), "PT 55% · gym 35%");
    assert.equal(ratesLabel({ gymId: "g", name: "n", city: null, ptRate: null, gymRate: null }), null);
  });
});
