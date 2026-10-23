import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  AMENITY_CATEGORIES,
  AMENITY_ICON_KEYS,
  AMENITY_ICON_LUCIDE,
  GENERIC_AMENITY_ICON,
  amenityCategoryLabel,
  amenityIconName,
  groupAmenities,
  isKnownAmenityIcon,
} from "../gymListing/amenityIcons";
import {
  DEFAULT_GYM_LIMITS,
  GYM_LISTING_ERROR_VI,
  addPhoto,
  amenityPool,
  amenitySelectionError,
  amenitySelectionPayload,
  amenityTotal,
  branchAvailability,
  buildGymDraftPayload,
  disabledAmenitiesOf,
  disabledAmenityNotices,
  findCatalogMatch,
  formFromGymPayload,
  gymFormSignature,
  gymListingErrorMessage,
  gymListingInvalidationKeys,
  applicationAmenityCatalogKey,
  gymListingKey,
  gymListingStatusView,
  gymPayloadSignature,
  gymRevisionFromResponse,
  interpretProposeResponse,
  isAmenitiesRequired,
  isAmenityDisabled,
  isReviewRequired,
  isUploadRouteRetired,
  normalizeAmenityName,
  normalizeCatalog,
  normalizeGymListing,
  normalizeGymPreview,
  pendingReenableFor,
  proposalFormError,
  proposalsOfGym,
  proposeOutcomeMessage,
  selectableAmenities,
  staleGymRevisionOf,
  toggleId,
  validateGymForm,
  type Amenity,
  type GymForm,
  type Proposal,
} from "../gymListing/gymListing";
import { CLIENT_HEADER, LISTING_FLOW_HEADER, clientHeaderValue, isListingFlowRequest, listingFlowHeaders } from "../../services/listingFlow";
import { STEPS, applicationAmenityIds, applicationPendingProposals, firstIncompleteStep, missingForStep, stepDone, type ApplicationView } from "../partnerApplication/partnerApplication";
import { amenityChips, isGymGone, normalizeAmenities, normalizeGym } from "../services/gymDirectory";
import { gymListingRoute, notificationMeta, notificationRoute } from "../notifications/notifications";
import { queryKeysForEvent } from "../notifications/eventRefresh";
import { pushTapRoute, readPushData } from "../push/pushRouting";

/**
 * Phase M2 — the pure half of the Gym Owner listing, the application's amenity step and the client gym side.
 * Shapes are the ones in gym-service (gym-listing.service.ts, gym-listing.helpers.ts, gym-amenity-catalog.service.ts,
 * gym-public.ts, partner-application.service.ts). Evidence label: TEST FIXTURE (node:test) — not a real-device or HTTP run.
 */

const G = "11111111-1111-4111-8111-111111111111";
const P = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const err = (status: number, code: string, extra: Record<string, unknown> = {}) => ({
  response: { status, data: { success: false, error: { code, message: "msg" }, message: "msg", ...extra } },
});

const amenity = (id: string, name: string, category = "FACILITY", iconKey = "wifi", status = "ACTIVE"): Amenity => ({
  id,
  slug: id,
  name,
  category,
  iconKey,
  sortOrder: 10,
  status,
  source: "SYSTEM",
});

const proposal = (over: Partial<Proposal> = {}): Proposal => ({
  id: P(5),
  gymId: G,
  kind: "NEW",
  targetAmenityId: null,
  name: "Phòng boxing",
  suggestedCategory: "TRAINING_ZONE",
  note: null,
  status: "PENDING",
  resultingAmenityId: null,
  rejectReason: null,
  createdAt: null,
  ...over,
});

describe("amenity icons (30-key allowlist)", () => {
  it("has exactly the 30 keys of gym-service, each mapped to a lucide name, none twice", () => {
    assert.equal(AMENITY_ICON_KEYS.length, 30);
    assert.equal(new Set(AMENITY_ICON_KEYS).size, 30);
    assert.deepEqual(Object.keys(AMENITY_ICON_LUCIDE).sort(), [...AMENITY_ICON_KEYS].sort());
    for (const key of AMENITY_ICON_KEYS) {
      assert.ok(isKnownAmenityIcon(key), key);
      const name = amenityIconName(key);
      assert.match(name, /^[A-Z][A-Za-z]+$/, key);
      assert.notEqual(name, "", key);
    }
  });

  it("the 18 SYSTEM keys come first, the 12 general ones after", () => {
    assert.deepEqual(AMENITY_ICON_KEYS.slice(0, 3), ["dumbbell", "heart-pulse", "activity"]);
    assert.deepEqual(AMENITY_ICON_KEYS.slice(18, 20), ["bike", "coffee"]);
    assert.equal(AMENITY_ICON_KEYS[29], "utensils");
  });

  it("an unknown or missing key draws the generic icon, never a crash", () => {
    assert.equal(amenityIconName("not-an-icon"), GENERIC_AMENITY_ICON);
    assert.equal(amenityIconName(null), GENERIC_AMENITY_ICON);
    assert.equal(amenityIconName(undefined), GENERIC_AMENITY_ICON);
    assert.equal(amenityIconName("DUMBBELL"), GENERIC_AMENITY_ICON);
  });

  it("categories: four groups in a fixed order with the web wording, unknown goes last under Khác", () => {
    assert.deepEqual([...AMENITY_CATEGORIES], ["FACILITY", "TRAINING_ZONE", "SERVICE", "RECOVERY"]);
    assert.equal(amenityCategoryLabel("TRAINING_ZONE"), "Khu tập luyện");
    assert.equal(amenityCategoryLabel("???"), "Khác");
    const groups = groupAmenities([
      amenity("a", "Sauna", "RECOVERY", "flame"),
      amenity("b", "Wifi", "FACILITY"),
      amenity("c", "Lạ", "WEIRD"),
      amenity("d", "Tạ", "TRAINING_ZONE", "dumbbell"),
    ]);
    assert.deepEqual(groups.map((g) => g.category), ["FACILITY", "TRAINING_ZONE", "RECOVERY", "OTHER"]);
    assert.deepEqual(groups.map((g) => g.items.length), [1, 1, 1, 1]);
  });
});

describe("new-client headers (listingFlow)", () => {
  it("are attached to the application and the compat branch routes only", () => {
    for (const [m, u] of [
      ["get", "/owner/application"],
      ["put", "/owner/application/amenities"],
      ["post", "/owner/application/submit"],
      ["post", "/owner/application/resubmit"],
      ["put", "/owner/application/branch"],
      ["post", "/owner/gyms"],
      ["post", "/owner/gyms/draft"],
      ["patch", `/owner/gyms/${G}/draft`],
      ["post", `/owner/gyms/${G}/submit`],
      ["post", "https://api.example.com/owner/application/submit?x=1"],
    ] as const) {
      assert.ok(isListingFlowRequest(m, u), `${m} ${u}`);
    }
  });

  it("are NOT attached to anything else", () => {
    for (const [m, u] of [
      ["get", "/owner/gyms"],
      ["get", `/owner/gyms/${G}`],
      ["patch", `/owner/gyms/${G}`],
      ["get", `/owner/gyms/${G}/listing`],
      ["put", `/owner/gyms/${G}/listing/draft`],
      ["get", "/owner/amenities"],
      ["get", "/gyms"],
      ["post", "/auth/login"],
      ["get", "/profile/me/listing"],
    ] as const) {
      assert.equal(isListingFlowRequest(m, u), false, `${m} ${u}`);
    }
  });

  it("carry flow version 2 and mobile/<version>/<build>", () => {
    const h = listingFlowHeaders("put", "/owner/application/amenities", { version: "1.0.0", build: 42 });
    assert.deepEqual(h, { [LISTING_FLOW_HEADER]: "2", [CLIENT_HEADER]: "mobile/1.0.0/42" });
    assert.equal(listingFlowHeaders("get", "/gyms", { version: "1.0.0", build: 1 }), null);
    assert.equal(clientHeaderValue(undefined, undefined), "mobile/0/0");
    assert.equal(clientHeaderValue("1.2.3", "7"), "mobile/1.2.3/7");
  });
});

describe("normalizeGymListing", () => {
  const raw = {
    gym: { id: G, name: "Gymini Q1", status: "APPROVED", operationalStatus: "OPEN" },
    listingVersion: 3,
    listingPublishedAt: "2026-10-01T00:00:00.000Z",
    published: {
      payload: { description: "Mô tả", amenityIds: ["a", "b"], proposalIds: [], photoIds: [P(1)], coverPhotoId: P(1) },
      photos: [{ id: P(1), url: `/media/gym-photos/${P(1)}`, isCover: true, sortOrder: 0 }],
    },
    openRevision: {
      id: "rev-1",
      gymId: G,
      status: "DRAFT",
      source: "OWNER",
      baseVersion: 3,
      draftVersion: 2,
      payload: { description: null, amenityIds: ["a"], proposalIds: [P(5)], photoIds: [], coverPhotoId: null },
      systemAdjustments: [{ type: "AMENITY_DISABLED_REMOVED", amenityId: "b", name: "Sauna" }, { nope: 1 }],
      reviewNote: "Cần ảnh rõ hơn",
      stale: true,
    },
    photos: [
      { id: P(1), status: "PUBLISHED", url: `/media/gym-photos/${P(1)}`, isCover: true, sortOrder: 0 },
      { id: P(2), status: "STAGED", url: null, expiresAt: null, isCover: false, sortOrder: 0 },
    ],
    amenities: [{ id: "a", slug: "WIFI", name: "Wifi", category: "FACILITY", iconKey: "wifi", status: "ACTIVE", source: "SYSTEM" }, { id: "b", slug: "SAUNA", name: "Sauna", category: "RECOVERY", iconKey: "flame", status: "DISABLED", source: "SYSTEM" }],
    proposals: [{ id: P(5), gymId: G, kind: "REENABLE", targetAmenityId: "b", name: "Sauna", suggestedCategory: "RECOVERY", status: "PENDING" }],
    history: [{ id: "old", status: "REJECTED", reviewNote: "Không phù hợp", closedAt: "2026-10-10T00:00:00.000Z" }],
    limits: { maxPhotos: 20, maxStagedPhotos: 40 },
  };

  it("reads the real GET /owner/gyms/:id/listing shape", () => {
    const v = normalizeGymListing(raw);
    assert.equal(v.gym.status, "APPROVED");
    assert.equal(v.listingVersion, 3);
    assert.deepEqual(v.published.payload.amenityIds, ["a", "b"]);
    assert.equal(v.openRevision?.draftVersion, 2);
    assert.equal(v.openRevision?.stale, true);
    assert.equal(v.openRevision?.systemAdjustments.length, 1, "an adjustment without a type is dropped");
    assert.equal(v.photos.length, 2);
    assert.equal(v.photos[1].url, null, "a STAGED photo the server could not link keeps a null url");
    assert.equal(v.amenities[1].status, "DISABLED");
    assert.equal(v.proposals[0].kind, "REENABLE");
    assert.equal(v.limits.maxPhotos, 20);
  });

  it("survives an empty / malformed answer with the documented defaults", () => {
    const v = normalizeGymListing(null);
    assert.equal(v.openRevision, null);
    assert.deepEqual(v.limits, DEFAULT_GYM_LIMITS);
    assert.deepEqual(v.published.payload.amenityIds, []);
  });

  it("revision bodies: { revision } on 200/201 and on a 409", () => {
    assert.equal(gymRevisionFromResponse({ revision: raw.openRevision })?.id, "rev-1");
    assert.equal(gymRevisionFromResponse({}), null);
    assert.equal(staleGymRevisionOf(err(409, "DRAFT_STALE", { revision: raw.openRevision }))?.draftVersion, 2);
  });

  it("the catalogue answer holds the ACTIVE amenities and the owner's proposals", () => {
    const c = normalizeCatalog({ amenities: raw.amenities, proposals: raw.proposals });
    assert.equal(c.amenities.length, 2);
    assert.equal(c.proposals[0].id, P(5));
  });
});

describe("branch picker availability", () => {
  it("only APPROVED and SUSPENDED branches are editable", () => {
    assert.deepEqual(branchAvailability({ status: "APPROVED", operationalStatus: "OPEN" }), { editable: true, reason: null });
    assert.equal(branchAvailability({ status: "SUSPENDED", operationalStatus: "OPEN" }).editable, true);
    assert.equal(branchAvailability({ status: "APPROVED", operationalStatus: "TEMPORARILY_CLOSED" }).editable, true);
  });

  it("every other status is disabled WITH a reason, and a permanently closed branch too", () => {
    for (const status of ["DRAFT", "PENDING_REVIEW", "REJECTED", "WHATEVER"]) {
      const a = branchAvailability({ status, operationalStatus: "OPEN" });
      assert.equal(a.editable, false, status);
      assert.ok(a.reason && a.reason.length > 10, status);
    }
    const closed = branchAvailability({ status: "APPROVED", operationalStatus: "PERMANENTLY_CLOSED" });
    assert.equal(closed.editable, false);
    assert.match(closed.reason!, /đóng cửa vĩnh viễn/);
  });
});

describe("the editable form", () => {
  const base: GymForm = { description: "  Phòng tập  ", amenityIds: ["a", "a", " b "], proposalIds: [P(5)], photoIds: [P(1), P(2), P(1)], coverPhotoId: P(9) };

  it("builds the payload the way the server normalizes it", () => {
    const p = buildGymDraftPayload(base);
    assert.equal(p.description, "Phòng tập");
    assert.deepEqual(p.amenityIds, ["a", "b"]);
    assert.deepEqual(p.photoIds, [P(1), P(2)]);
    assert.equal(p.coverPhotoId, P(1), "a cover that is not among the photos falls back to the first photo");
    assert.equal(buildGymDraftPayload({ ...base, description: "   ", photoIds: [] }).coverPhotoId, null);
    assert.equal(buildGymDraftPayload({ ...base, description: "   " }).description, null);
  });

  it("signatures: a saved payload compares clean against its own form, and an edit changes it", () => {
    const payload = { description: "x", amenityIds: ["a"], proposalIds: [], photoIds: [P(1)], coverPhotoId: P(1) };
    assert.equal(gymPayloadSignature(payload), gymFormSignature(formFromGymPayload(payload)));
    assert.notEqual(gymPayloadSignature(payload), gymFormSignature({ ...formFromGymPayload(payload), amenityIds: ["a", "b"] }));
  });

  it("validation: 300-char description, 20 photos, and at least one amenity at submit", () => {
    const ok: GymForm = { description: "x".repeat(300), amenityIds: ["a"], proposalIds: [], photoIds: [], coverPhotoId: null };
    assert.equal(validateGymForm(ok, DEFAULT_GYM_LIMITS, true), null);
    assert.match(validateGymForm({ ...ok, description: "x".repeat(301) })!, /300/);
    const twenty = Array.from({ length: 20 }, (_, i) => `p${i}`);
    assert.equal(validateGymForm({ ...ok, photoIds: twenty }), null);
    assert.match(validateGymForm({ ...ok, photoIds: [...twenty, "p20"] })!, /20 ảnh/);
    const empty: GymForm = { ...ok, amenityIds: [], proposalIds: [] };
    assert.equal(validateGymForm(empty), null, "saving a draft may be empty");
    assert.equal(validateGymForm(empty, DEFAULT_GYM_LIMITS, true), GYM_LISTING_ERROR_VI.AMENITIES_REQUIRED);
    assert.equal(validateGymForm({ ...empty, proposalIds: [P(5)] }, DEFAULT_GYM_LIMITS, true), null, "a pending proposal counts");
    assert.equal(amenityTotal({ amenityIds: ["a", "a"], proposalIds: [] }), 1);
  });

  it("the 21st photo is refused, not dropped; the first photo becomes the cover", () => {
    const twenty = Array.from({ length: 20 }, (_, i) => `p${i}`);
    assert.equal(addPhoto(twenty, "p0", "p20", 20).outcome, "limit");
    assert.equal(addPhoto([], null, "p0", 20).cover, "p0");
    assert.deepEqual(toggleId(["a"], "b"), ["a", "b"]);
    assert.deepEqual(toggleId(["a", "b"], "a"), ["b"]);
  });
});

describe("amenity pool and chips", () => {
  const catalog = [amenity("a", "Wifi"), amenity("c", "Tạ", "TRAINING_ZONE", "dumbbell")];
  const refs = [amenity("a", "Wifi"), amenity("b", "Sauna", "RECOVERY", "flame", "DISABLED")];

  it("the pool is the catalogue plus what the payloads mention, once each", () => {
    assert.deepEqual(amenityPool(catalog, refs).map((a) => a.id), ["a", "c", "b"]);
  });

  it("a DISABLED amenity is only drawn while selected, so it can be taken out", () => {
    const pool = amenityPool(catalog, refs);
    assert.deepEqual(selectableAmenities(pool, ["a"]).map((a) => a.id), ["a", "c"]);
    assert.deepEqual(selectableAmenities(pool, ["a", "b"]).map((a) => a.id), ["a", "c", "b"]);
  });
});

describe("disabled-amenity notice (plan 12.3)", () => {
  const view = (adjustments: any[], published: string[] = []) => ({
    openRevision: { systemAdjustments: adjustments } as any,
    amenities: [amenity("b", "Sauna", "RECOVERY", "flame", "DISABLED"), amenity("d", "Hồ bơi", "TRAINING_ZONE", "waves", "DISABLED")],
    published: { payload: { description: null, amenityIds: published, proposalIds: [], photoIds: [], coverPhotoId: null }, photos: [] },
  });

  it("lists amenities removed from the draft, with the amenity's own category", () => {
    const n = disabledAmenityNotices(view([{ type: "AMENITY_DISABLED_REMOVED", amenityId: "b", name: "Sauna" }]));
    assert.deepEqual(n, [{ amenityId: "b", name: "Sauna", category: "RECOVERY" }]);
  });

  it("adds published amenities that are DISABLED, once, and ignores other adjustments", () => {
    const n = disabledAmenityNotices(view([{ type: "AMENITY_DISABLED_REMOVED", amenityId: "b", name: "Sauna" }, { type: "PHOTO_NO_LONGER_AVAILABLE" }], ["b", "d"]));
    assert.deepEqual(n.map((x) => x.amenityId), ["b", "d"]);
  });

  it("a REENABLE proposal already waiting replaces the button", () => {
    assert.equal(pendingReenableFor([proposal({ kind: "REENABLE", targetAmenityId: "b" })], "b")?.id, P(5));
    assert.equal(pendingReenableFor([proposal({ kind: "REENABLE", targetAmenityId: "b", status: "APPROVED" })], "b"), null);
    assert.equal(pendingReenableFor([proposal({ kind: "NEW" })], "b"), null);
  });

  it("the status card words every system adjustment, and the PT-only ones do not leak", () => {
    const s = gymListingStatusView({
      openRevision: normalizeGymListing({
        openRevision: { id: "r", status: "DRAFT", payload: {}, draftVersion: 1, systemAdjustments: [{ type: "PROPOSAL_RESOLVED", name: "Boxing" }, { type: "AMENITY_DISABLED_REMOVED", name: "Sauna" }, { type: "PACKAGE_NO_LONGER_AVAILABLE" }] },
      }).openRevision,
      history: [],
    });
    assert.equal(s.key, "DRAFT");
    assert.equal(s.notices.length, 1, "AMENITY_DISABLED_REMOVED has its own block; a PT adjustment is not shown");
    assert.match(s.notices[0], /Boxing/);
  });

  it("DRAFT with a review note is 'Cần chỉnh sửa' with the admin's words", () => {
    const open = normalizeGymListing({ openRevision: { id: "r", status: "DRAFT", payload: {}, draftVersion: 1, reviewNote: "Thêm ảnh" } }).openRevision;
    const s = gymListingStatusView({ openRevision: open, history: [] });
    assert.equal(s.key, "CHANGES_REQUESTED");
    assert.equal(s.adminNote, "Thêm ảnh");
  });
});

describe("amenity proposals (plan 12.3)", () => {
  it("matched: 200 { matchedAmenity } selects the existing one and creates nothing", () => {
    const o = interpretProposeResponse({ matchedAmenity: { id: "a", slug: "WIFI", name: "Wifi miễn phí", category: "FACILITY", iconKey: "wifi", status: "ACTIVE" } });
    assert.equal(o?.kind, "matched");
    assert.match(proposeOutcomeMessage(o!), /đã có sẵn.*đã chọn giúp/);
  });

  it("REENABLE: the name belongs to a DISABLED amenity", () => {
    const o = interpretProposeResponse({ kind: "REENABLE", created: true, proposal: proposal({ kind: "REENABLE", targetAmenityId: "b", name: "Sauna" }) });
    assert.equal(o?.kind === "proposal" && o.reenable, true);
    assert.match(proposeOutcomeMessage(o!), /tạm ngưng.*bật lại/);
  });

  it("NEW (201) and idempotent (created:false) are told apart", () => {
    const created = interpretProposeResponse({ kind: "NEW", created: true, proposal: proposal() });
    assert.match(proposeOutcomeMessage(created!), /Đã gửi đề xuất/);
    const again = interpretProposeResponse({ kind: "NEW", created: false, proposal: proposal() });
    assert.match(proposeOutcomeMessage(again!), /rồi/);
  });

  it("an unreadable answer is null, never a made-up outcome", () => {
    assert.equal(interpretProposeResponse({}), null);
    assert.equal(interpretProposeResponse(null), null);
  });

  it("only this branch's proposals are shown (the listing answer spans all the owner's branches)", () => {
    const list = [proposal({ id: "1", gymId: G }), proposal({ id: "2", gymId: "other" })];
    assert.deepEqual(proposalsOfGym(list, G).map((p) => p.id), ["1"]);
  });

  it("form check mirrors the schema: name 2–40, a category, note <= 500", () => {
    assert.match(proposalFormError({ name: "a", category: "FACILITY" })!, /tối thiểu 2/);
    assert.match(proposalFormError({ name: "x".repeat(41), category: "FACILITY" })!, /tối đa 40/);
    assert.match(proposalFormError({ name: "Boxing", category: null })!, /nhóm/);
    assert.match(proposalFormError({ name: "Boxing", category: "FACILITY", note: "x".repeat(501) })!, /500/);
    assert.equal(proposalFormError({ name: "Phòng boxing", category: "TRAINING_ZONE" }), null);
  });

  it("local match: accents and case do not matter (same normalization as the catalogue)", () => {
    assert.equal(normalizeAmenityName("  PHÒNG  Đấm Bốc "), "phong dam boc");
    const hit = findCatalogMatch([amenity("a", "Phòng Đấm Bốc")], "phong dam boc");
    assert.equal(hit?.id, "a");
    assert.equal(findCatalogMatch([amenity("a", "Phòng Đấm Bốc", "FACILITY", "wifi", "DISABLED")], "phong dam boc"), null, "a DISABLED name is not a match");
    assert.equal(findCatalogMatch([], "  "), null);
  });
});

describe("errors → Vietnamese; 409 / 410 / 422", () => {
  it("409 stale answers and review-required", () => {
    assert.match(gymListingErrorMessage(err(409, "DRAFT_STALE")), /Bản nháp/);
    assert.match(gymListingErrorMessage(err(409, "LISTING_STALE")), /Tin đăng công khai/);
    assert.equal(isReviewRequired(err(409, "LISTING_REVIEW_REQUIRED")), true);
    assert.match(gymListingErrorMessage(err(409, "LISTING_REVIEW_REQUIRED")), /gửi duyệt/);
    assert.match(gymListingErrorMessage(err(409, "LISTING_NOT_AVAILABLE")), /chưa có tin đăng/);
    assert.match(gymListingErrorMessage(err(409, "GYM_IS_DRAFT")), /nháp/);
  });

  it("410 UPLOAD_ROUTE_RETIRED, by status or by code", () => {
    assert.equal(isUploadRouteRetired(err(410, "UPLOAD_ROUTE_RETIRED")), true);
    assert.equal(isUploadRouteRetired({ response: { status: 410, data: {} } }), true);
    assert.equal(isUploadRouteRetired(err(409, "LISTING_REVIEW_REQUIRED")), false);
    assert.match(gymListingErrorMessage(err(410, "UPLOAD_ROUTE_RETIRED")), /cập nhật ứng dụng/);
  });

  it("422 AMENITIES_REQUIRED and AMENITY_DISABLED with the list", () => {
    assert.equal(isAmenitiesRequired(err(422, "AMENITIES_REQUIRED")), true);
    assert.match(gymListingErrorMessage(err(422, "AMENITIES_REQUIRED")), /ít nhất một tiện ích/);
    const e = err(409, "AMENITY_DISABLED", { amenities: [{ id: "b", name: "Sauna" }, { name: "no id" }] });
    assert.equal(isAmenityDisabled(e), true);
    assert.deepEqual(disabledAmenitiesOf(e), [{ id: "b", name: "Sauna" }]);
    assert.deepEqual(disabledAmenitiesOf(err(409, "DRAFT_STALE")), []);
  });

  it("photo and upload codes use the gym's 20-photo wording, not the PT's 5", () => {
    assert.match(gymListingErrorMessage(err(422, "PHOTO_LIMIT")), /20 ảnh/);
    assert.match(gymListingErrorMessage(err(422, "STAGED_LIMIT")), /xóa bớt/);
    assert.match(gymListingErrorMessage(err(422, "IMAGE_TOO_LARGE")), /8 MB/);
  });

  it("proposal codes, transport failures, 403 for a manager", () => {
    assert.match(gymListingErrorMessage(err(409, "PROPOSAL_ALREADY_DECIDED")), /đã được Gymini xử lý/);
    assert.match(gymListingErrorMessage(err(409, "PROPOSAL_IN_REVIEW")), /rút lại bản sửa/);
    assert.match(gymListingErrorMessage({ response: { status: 403, data: {} } }), /không có quyền/);
    assert.match(gymListingErrorMessage(new Error("Network Error")), /kết nối/);
  });
});

describe("selection for a branch with no listing (quick create / application)", () => {
  it("needs at least one amenity or proposal", () => {
    assert.match(amenitySelectionError({ amenityIds: [], proposals: [] })!, /ít nhất một tiện ích/);
    assert.equal(amenitySelectionError({ amenityIds: ["a"], proposals: [] }), null);
    assert.equal(amenitySelectionError({ amenityIds: [], proposals: [{ name: "Boxing", suggestedCategory: "TRAINING_ZONE" }] }), null);
    assert.equal(amenitySelectionError({ amenityIds: [], proposals: [], proposalIds: [P(5)] }), null);
  });

  it("the payload: amenityIds always, proposals / proposalIds only when there are any", () => {
    assert.deepEqual(amenitySelectionPayload({ amenityIds: ["a", "a", "b"], proposals: [] }), { amenityIds: ["a", "b"] });
    assert.deepEqual(
      amenitySelectionPayload({ amenityIds: [], proposals: [{ name: " Boxing ", suggestedCategory: "TRAINING_ZONE", note: " ghi chú " }], proposalIds: [P(5)] }),
      { amenityIds: [], proposals: [{ name: "Boxing", suggestedCategory: "TRAINING_ZONE", note: "ghi chú" }], proposalIds: [P(5)] },
    );
    assert.deepEqual(amenitySelectionPayload({ amenityIds: ["a"], proposals: [], proposalIds: [] }), { amenityIds: ["a"], proposalIds: [] });
  });
});

describe("preview", () => {
  it("reads ListingPreviewDto and refuses anything that is not a preview", () => {
    assert.equal(normalizeGymPreview({ name: "x" }), null);
    const v = normalizeGymPreview({
      isPreview: true,
      revisionStatus: "DRAFT",
      name: "Gymini Q1",
      address: "1 Lê Lợi",
      amenities: [{ id: "a", slug: "WIFI", name: "Wifi", category: "FACILITY", iconKey: "wifi", disabled: false }],
      pendingAmenities: [{ proposalId: P(5), name: "Boxing", suggestedCategory: "TRAINING_ZONE", kind: "NEW" }],
      photos: [{ id: P(1), url: null, isCover: true }],
      coverPhotoUrl: null,
      photoUrlsExpireAt: "2026-10-20T00:15:00.000Z",
    });
    assert.equal(v?.amenities.length, 1);
    assert.equal(v?.pendingAmenities[0].name, "Boxing");
    assert.equal(v?.photos[0].url, null);
  });
});

describe("cache keys are scoped to the signed-in account", () => {
  it("includes the uid in the screen's key and invalidates the public gym keys", () => {
    assert.deepEqual(gymListingKey("u1", G), ["gym-listing", "u1", G]);
    assert.notDeepEqual(gymListingKey("u1", G), gymListingKey("u2", G));
    const names = gymListingInvalidationKeys("u1", G).map((k) => k[0]);
    for (const n of ["gym-listing", "gym-listing-preview", "owner-amenities", "owned-gym", "owned-gyms", "gyms", "gym"]) assert.ok(names.includes(n), n);
  });
});

describe("application wizard: the applicant's catalogue", () => {
  it("has its own cache key under the application key, scoped to the account", () => {
    assert.deepEqual(applicationAmenityCatalogKey("u1"), ["partner-application", "u1", "catalog"]);
    assert.notDeepEqual(applicationAmenityCatalogKey("u1"), applicationAmenityCatalogKey("u2"));
  });
});

describe("application wizard: the amenity step (10 steps)", () => {
  const view = (missing: { section: any; message: string }[], extra: Partial<ApplicationView> = {}): ApplicationView => ({ missing, ...extra });

  it("sits right after the location step, before the photos", () => {
    const ids = STEPS.map((s) => s.id);
    assert.equal(STEPS.length, 10);
    assert.equal(ids.indexOf("amenities"), ids.indexOf("location") + 1);
    assert.equal(ids.indexOf("photos"), ids.indexOf("amenities") + 1);
    assert.deepEqual(STEPS.find((s) => s.id === "amenities")!.sections, ["AMENITIES"]);
  });

  it("the server's missing key AMENITIES maps to the step, so a resume lands on it", () => {
    const v = view([{ section: "AMENITIES", message: "Chưa chọn tiện ích nào cho chi nhánh" }]);
    const step = STEPS.find((s) => s.id === "amenities")!;
    assert.equal(stepDone(v, step), false);
    assert.equal(STEPS[firstIncompleteStep(v)].id, "amenities");
    assert.equal(missingForStep(v, step).length, 1);
    assert.equal(stepDone(view([]), step), true);
  });

  it("resumes at the EARLIEST gap, whichever order the server lists them", () => {
    const v = view([{ section: "PHOTOS", message: "a" }, { section: "AMENITIES", message: "b" }, { section: "LEGAL", message: "c" }]);
    assert.equal(STEPS[firstIncompleteStep(v)].id, "amenities");
    assert.equal(STEPS[firstIncompleteStep(view([{ section: "LOCATION", message: "x" }, { section: "AMENITIES", message: "y" }]))].id, "location");
  });

  it("reads the amenities and proposals the application already holds", () => {
    const v = view([], {
      amenities: [{ id: "a", name: "Wifi" }, { id: "b", name: "Tạ" }, null as any],
      amenityProposals: [
        { id: P(5), name: "Boxing", status: "PENDING", kind: "NEW", suggestedCategory: "TRAINING_ZONE", gymId: G },
        { id: P(6), name: "Cũ", status: "REJECTED", kind: "NEW", suggestedCategory: "FACILITY" },
      ],
    });
    assert.deepEqual(applicationAmenityIds(v), ["a", "b"]);
    assert.deepEqual(applicationPendingProposals(v).map((p) => p.id), [P(5)]);
    assert.deepEqual(applicationAmenityIds(null), []);
  });
});

describe("client gym side: amenities[] replace facilities[]", () => {
  const raw = { id: "g1", name: "Q1", status: "APPROVED", operationalStatus: "OPEN", brand: { name: "B" } };

  it("reads amenities[] (slug, name, category, iconKey) and coverPhotoUrl", () => {
    const g = normalizeGym({
      ...raw,
      facilities: ["WIFI"],
      amenities: [{ slug: "custom-boxing-1", name: "Phòng boxing", category: "TRAINING_ZONE", iconKey: "trophy" }],
      coverPhotoUrl: "/media/gym-photos/p1",
    });
    assert.deepEqual(g.amenities, [{ slug: "custom-boxing-1", name: "Phòng boxing", category: "TRAINING_ZONE", iconKey: "trophy" }]);
    assert.equal(g.coverPhotoUrl, "/media/gym-photos/p1");
  });

  it("falls back to facilities ONLY when amenities is missing altogether", () => {
    const g = normalizeGym({ ...raw, facilities: ["WIFI", "SAUNA", "UNKNOWN_CODE"] });
    assert.deepEqual(g.amenities.map((a) => a.name), ["Wifi miễn phí", "Xông hơi"]);
    assert.equal(g.amenities[0].iconKey, "wifi");
    assert.equal(g.amenities[1].category, "RECOVERY");
    // an empty array IS an answer: no amenities, no fallback
    assert.deepEqual(normalizeGym({ ...raw, facilities: ["WIFI"], amenities: [] }).amenities, []);
  });

  it("drops nameless entries and tolerates garbage", () => {
    assert.deepEqual(normalizeAmenities({ amenities: [{ slug: "x" }, null, "str", { name: "  " }] }), []);
    assert.deepEqual(normalizeAmenities(null), []);
    assert.equal(normalizeGym(raw).coverPhotoUrl, null);
  });

  it("the card shows up to four chips and counts the rest", () => {
    const mk = (n: number) => ({ amenities: Array.from({ length: n }, (_, i) => ({ slug: `s${i}`, name: `A${i}`, category: "FACILITY", iconKey: "wifi" })) });
    assert.deepEqual([amenityChips(mk(6)).shown.length, amenityChips(mk(6)).more], [4, 2]);
    assert.deepEqual([amenityChips(mk(3)).shown.length, amenityChips(mk(3)).more], [3, 0]);
    assert.deepEqual([amenityChips(mk(0)).shown.length, amenityChips(mk(0)).more], [0, 0]);
  });

  it("404 on a public gym route means hidden, not broken", () => {
    assert.equal(isGymGone({ response: { status: 404 } }), true);
    assert.equal(isGymGone({ response: { status: 500 } }), false);
    assert.equal(isGymGone(new Error("x")), false);
  });
});

describe("notifications: gym listing events", () => {
  const types = ["GYM_LISTING_APPROVED", "GYM_LISTING_REJECTED", "GYM_LISTING_CHANGES_REQUESTED", "GYM_LISTING_INVALIDATED", "GYM_AMENITY_PROPOSAL_REVIEWED"];

  it("has a title and tone for each of the five", () => {
    for (const t of types) assert.notEqual(notificationMeta(t).title, "Thông báo", t);
    assert.equal(notificationMeta("GYM_LISTING_REJECTED").tone, "danger");
    assert.equal(notificationMeta("GYM_LISTING_CHANGES_REQUESTED").tone, "warning");
  });

  it("opens /gym-owner/listing on the right branch — the server links to the plural web path", () => {
    assert.equal(gymListingRoute(`/gym-owner/listings?gymId=${G}`), `/gym-owner/listing?gymId=${G}`);
    assert.equal(notificationRoute({ link: `/gym-owner/listings?gymId=${G}`, entityType: "GYM_BRANCH" }), `/gym-owner/listing?gymId=${G}`);
    assert.equal(notificationRoute({ link: "/gym-owner/listing?gymId=abc", entityType: null }), "/gym-owner/listing?gymId=abc");
    assert.equal(notificationRoute({ link: "/gym-owner/listings", entityType: null }), "/gym-owner/listing");
    assert.equal(gymListingRoute("/gym-owner/plans"), null);
    assert.equal(notificationRoute({ link: "/pt/listing", entityType: "PT_LISTING" }), "/pt/listing", "the PT route is untouched");
  });

  it("a push tap routes a gym owner there, and never sends a client or PT to the owner workspace", () => {
    const push = readPushData({ notificationId: "n", userId: "u1", link: `/gym-owner/listings?gymId=${G}`, entityType: "GYM_BRANCH", eventType: "GYM_LISTING_APPROVED" });
    assert.equal(pushTapRoute(push, "u1", "gym_owner"), `/gym-owner/listing?gymId=${G}`);
    assert.equal(pushTapRoute(push, "u1", "client"), "/client/notifications");
    assert.equal(pushTapRoute(push, "u1", "pt"), "/pt/dashboard");
    assert.equal(pushTapRoute(push, "someone-else", "gym_owner"), null);
  });

  it("each event refreshes the owner's screens and the public gym lists", () => {
    for (const t of types) {
      const keys = queryKeysForEvent(t, "GYM_BRANCH").map((k) => k[0]);
      for (const n of ["notifications", "gym-listing", "owner-amenities", "owned-gyms", "partner-application", "gyms", "gym"]) assert.ok(keys.includes(n), `${t} → ${n}`);
    }
    assert.ok(!queryKeysForEvent("PT_LISTING_APPROVED", "PT_LISTING").map((k) => k[0]).includes("gym-listing"));
  });
});
