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
  PT_PAGE_SIZE,
  activeFilterCount,
  buildContractRequestPayload,
  buildListParams,
  filterError,
  lowAvailabilityMessage,
  hasMorePts,
  isPtGone,
  lowestPerSessionPrice,
  matchesSpecialty,
  mergePtPages,
  mergePtSources,
  nextPtPage,
  normalizePackages,
  normalizePartnerGyms,
  normalizePt,
  normalizePts,
  pricePerSession,
  ratesLabel,
  readLowAvailability,
  readPackageChanged,
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

  it("falls back to a generic name, never to an e-mail address, rather than rendering blank", () => {
    // Listing Management: the public DTO no longer carries an e-mail; an old server that still does must not leak it onto a card.
    assert.equal(normalizePt({ userId: "u", email: "a@b.c" }).name, "Huấn luyện viên");
    assert.equal(normalizePt({ userId: "u" }).name, "Huấn luyện viên");
    assert.equal(normalizePt({ userId: "u", firstName: "Huy" }).name, "Huy");
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

describe("paging the trainer list", () => {
  const page = (from: number, count: number) => ({
    pts: Array.from({ length: count }, (_, i) => ({ ...REAL_ROW, userId: `pt-${from + i}`, firstName: `PT ${from + i}` })),
  });

  // Regression (7/10): the server held 107 trainers and the screen showed the first 50, with no
  // way to reach the rest — a newly approved trainer sat at position 51.
  it("a full page means there may be more; a short or empty one is the end", () => {
    assert.equal(hasMorePts(page(0, PT_PAGE_SIZE)), true);
    assert.equal(hasMorePts(page(0, PT_PAGE_SIZE - 1)), false);
    assert.equal(hasMorePts({ pts: [] }), false);
    assert.equal(hasMorePts(undefined), false);
  });

  it("asks for the next page after a full one, and stops when a page brings nothing new", () => {
    assert.equal(nextPtPage([page(0, PT_PAGE_SIZE)]), 2);
    assert.equal(nextPtPage([page(0, PT_PAGE_SIZE), page(PT_PAGE_SIZE, 7)]), undefined);
    // A server that ignores paging answers the same full list again — that is the end, not page 3.
    assert.equal(nextPtPage([page(0, PT_PAGE_SIZE), page(0, PT_PAGE_SIZE)]), undefined);
  });

  it("merges pages in order and drops a trainer who shows up on two of them", () => {
    const rows = mergePtPages([page(0, 3), { pts: [...page(2, 1).pts, ...page(3, 2).pts] }]);
    assert.deepEqual(rows.map((r) => r.userId), ["pt-0", "pt-1", "pt-2", "pt-3", "pt-4"]);
    assert.deepEqual(mergePtPages(undefined), []);
  });
});

// ── Listing Management (M1): the DTO user-service's toPublicPtDto now answers ───────────────────────
// Trimmed from pt-public-dto.ts: no e-mail, derived legacy prices, fromPricePerSession / fromPackagePrice,
// physiquePhotos with /media paths, coverPhotoUrl.
const NEW_DTO_ROW = {
  userId: "pt-new",
  firstName: "Lan",
  lastName: "Trần",
  photoUrl: null,
  specialties: ["Tăng cơ"],
  isAcceptingClients: true,
  notAcceptingReason: null,
  ptSuspended: false,
  avgRating: 4.5,
  ratingCount: 12,
  availableSlotsNext28Days: 10,
  ptApplication: {
    serviceMode: "HYBRID",
    professionalBio: "Bio",
    // derived (deprecated) legacy fields — min over packages, floored to 1.000đ
    desiredSessionPrice: 200000,
    onlinePricePerSession: 250000,
    offlinePricePerSession: 200000,
    onlinePackagePrice: 1250000,
    offlinePackagePrice: 2000000,
    monthlyProgramPrice: null,
    packagePrice: null,
    sessionsPerPackage: null,
    additionalPricingNotes: null,
    fromPricePerSession: 200000,
    fromPackagePrice: 300000,
  },
  servicePackages: [],
  fromPricePerSession: 200000,
  fromPackagePrice: 300000,
  physiquePhotos: [
    { id: "ph-2", url: "/media/pt-physique/ph-2", isCover: false, sortOrder: 1 },
    { id: "ph-1", url: "/media/pt-physique/ph-1", isCover: true, sortOrder: 0 },
  ],
  coverPhotoUrl: "/media/pt-physique/ph-1",
};

describe("normalizePt — the new public DTO", () => {
  it("reads the card price from fromPricePerSession and the package price from fromPackagePrice", () => {
    const pt = normalizePt(NEW_DTO_ROW);
    assert.equal(pt.lowestPrice, 200000);
    assert.equal(pt.fromPackagePrice, 300000);
  });

  it("prefers fromPricePerSession over the (derived) legacy fields", () => {
    const row = { ...NEW_DTO_ROW, ptApplication: { ...NEW_DTO_ROW.ptApplication, fromPricePerSession: 150000, onlinePricePerSession: 250000, offlinePricePerSession: 200000 } };
    assert.equal(normalizePt(row).lowestPrice, 150000);
  });

  it("works from the top-level field alone, and from the legacy fields alone (an older server)", () => {
    assert.equal(normalizePt({ userId: "u", fromPricePerSession: 180000, ptApplication: {} }).lowestPrice, 180000);
    assert.equal(normalizePt({ userId: "u", ptApplication: { offlinePricePerSession: 300000, onlinePricePerSession: 250000 } }).lowestPrice, 250000);
  });

  it("a trainer with no package on sale shows no price — null, never zero", () => {
    const pt = normalizePt({ ...NEW_DTO_ROW, fromPricePerSession: null, fromPackagePrice: null, ptApplication: { serviceMode: "ONLINE", fromPricePerSession: null, fromPackagePrice: null, onlinePricePerSession: null, offlinePricePerSession: null, desiredSessionPrice: null } });
    assert.equal(pt.lowestPrice, null);
    assert.equal(pt.fromPackagePrice, null);
    assert.equal(normalizePt({ userId: "u", fromPricePerSession: 0, ptApplication: {} }).lowestPrice, null);
  });

  it("reads the cover and the physique photos in display order", () => {
    const pt = normalizePt(NEW_DTO_ROW);
    assert.equal(pt.coverPhotoUrl, "/media/pt-physique/ph-1");
    assert.deepEqual(pt.physiquePhotos.map((p) => p.id), ["ph-1", "ph-2"]);
    assert.equal(pt.physiquePhotos[0].isCover, true);
  });

  it("a row from an older server has no photos and no cover", () => {
    const pt = normalizePt(REAL_ROW);
    assert.equal(pt.coverPhotoUrl, null);
    assert.deepEqual(pt.physiquePhotos, []);
  });

  it("drops photo entries without an id or url instead of rendering a broken image", () => {
    const pt = normalizePt({ userId: "u", physiquePhotos: [{ id: "a" }, { url: "/x" }, { id: "b", url: "/media/pt-physique/b" }] });
    assert.deepEqual(pt.physiquePhotos.map((p) => p.id), ["b"]);
  });

  it("the card never carries an e-mail address, even if an old server sent one", () => {
    const pt = normalizePt({ ...NEW_DTO_ROW, firstName: null, lastName: null, email: "private@example.com" });
    assert.equal(pt.name, "Huấn luyện viên");
    assert.equal(JSON.stringify(pt).includes("private@example.com"), false);
  });

  it("photos and the package price come from the DETAIL, not from a cached list row that may still show a removed photo", () => {
    const listRow = normalizePt(NEW_DTO_ROW);
    const detail = { ...NEW_DTO_ROW, physiquePhotos: [], coverPhotoUrl: null, fromPackagePrice: null, ptApplication: { ...NEW_DTO_ROW.ptApplication, fromPackagePrice: null } };
    const merged = mergePtSources(detail, listRow)!;
    assert.deepEqual(merged.physiquePhotos, []);
    assert.equal(merged.coverPhotoUrl, null);
    assert.equal(merged.fromPackagePrice, null);
  });
});

describe("packages with a version", () => {
  const pkg = { id: "p1", name: "Gói 10 buổi", sessionCount: 10, price: "2000000", sessionMode: "OFFLINE", sessionDurationMinutes: 60, validityDays: 90, isActive: true, archivedAt: null, version: 3 };

  it("keeps the version the server showed (Decimal price arrives as a string)", () => {
    const [p] = normalizePackages({ packages: [pkg] });
    assert.equal(p.version, 3);
    assert.equal(p.price, 2000000);
    assert.equal(p.sessionDurationMinutes, 60);
  });

  it("an older server (no version) gives null, not 0", () => {
    const { version: _v, ...old } = pkg;
    assert.equal(normalizePackages({ packages: [old] })[0].version, null);
  });

  it("the contract request echoes the version as expectedPackageVersion", () => {
    const [p] = normalizePackages({ packages: [pkg] });
    const body = buildContractRequestPayload({ ptUserId: "pt-1", pkg: p });
    assert.equal(body.expectedPackageVersion, 3);
    assert.equal(body.packageId, "p1");
    assert.equal("price" in body, false, "still never a price");
  });

  it("no version known → the field is omitted (there is nothing to echo)", () => {
    const { version: _v, ...old } = pkg;
    const [p] = normalizePackages({ packages: [old] });
    assert.equal("expectedPackageVersion" in buildContractRequestPayload({ ptUserId: "pt-1", pkg: p }), false);
  });
});

describe("the PACKAGE_CHANGED 409", () => {
  const err = (data: any, status = 409) => ({ response: { status, data } });
  const current = { id: "p1", name: "Gói 10 buổi", sessionCount: 10, price: "2500000", sessionMode: "OFFLINE", isActive: true, version: 4 };

  it("reads the package as it is NOW (new price, new version)", () => {
    const changed = readPackageChanged(err({ code: "PACKAGE_CHANGED", error: "msg", package: current }))!;
    assert.equal(changed.current?.price, 2500000);
    assert.equal(changed.current?.version, 4);
  });

  it("still means 'changed' when the body carries no usable package", () => {
    assert.deepEqual(readPackageChanged(err({ code: "PACKAGE_CHANGED" })), { current: null });
  });

  it("is not confused with another 409 or another status", () => {
    assert.equal(readPackageChanged(err({ code: "LOW_AVAILABILITY" })), null);
    assert.equal(readPackageChanged(err({ code: "PACKAGE_CHANGED" }, 422)), null);
    assert.equal(readPackageChanged(new Error("network")), null);
  });
});

describe("a hidden / suspended trainer", () => {
  it("404 on the detail is 'gone', not a retryable error", () => {
    assert.equal(isPtGone({ response: { status: 404, data: { error: "PT not found" } } }), true);
    assert.equal(isPtGone({ response: { status: 500 } }), false);
    assert.equal(isPtGone(new Error("Network Error")), false);
    assert.equal(isPtGone(null), false);
  });
});
