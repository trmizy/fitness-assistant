/**
 * Listing Management D2 - the pure half of the Gym Owner "Tin đăng & tiện ích" page, the wizard's amenity step and the
 * application's amenity step. CODE/UNIT only (no server, no browser).
 * Run: npx tsx --test src/app/utils/__tests__/gymListing.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_GYM_LIMITS,
  DESCRIPTION_MAX,
  GYM_LISTING_ERROR_VI,
  MAX_DRAFT_BRANCH_PHOTOS,
  MAX_INLINE_PROPOSALS,
  addInlineProposal,
  addPhoto,
  amenityPool,
  amenitySelectionError,
  amenitySelectionPayload,
  amenityTotal,
  applyProposeOutcome,
  branchAvailability,
  buildGymDraftPayload,
  disabledAmenitiesOf,
  disabledAmenityNotices,
  findCatalogMatch,
  formFromGymPayload,
  groupAmenitiesByCategory,
  gymFormSignature,
  gymListingErrorMessage,
  gymListingStatusView,
  initialDraftSelection,
  interpretProposeResponse,
  isAmenitiesRequired,
  isUploadRouteRetired,
  normalizeAmenityName,
  normalizeGymListing,
  normalizeGymPreview,
  pendingReenableFor,
  pickInitialGymId,
  proposalFormError,
  proposalsOfGym,
  proposeOutcomeMessage,
  normalizeBranchSelection,
  selectableAmenities,
  toggleId,
  validateGymForm,
  type CatalogAmenity,
  type GymForm,
  type OwnerProposal,
} from "../gymListing";

const amenity = (id: string, over: Partial<CatalogAmenity> = {}): CatalogAmenity => ({
  id,
  slug: id,
  name: `Tiện ích ${id}`,
  category: "FACILITY",
  iconKey: "wifi",
  sortOrder: 10,
  status: "ACTIVE",
  source: "SYSTEM",
  ...over,
});

const proposal = (id: string, over: Partial<OwnerProposal> = {}): OwnerProposal => ({
  id,
  gymId: "g1",
  kind: "NEW",
  targetAmenityId: null,
  name: `Đề xuất ${id}`,
  suggestedCategory: "SERVICE",
  note: null,
  status: "PENDING",
  resultingAmenityId: null,
  rejectReason: null,
  createdAt: null,
  ...over,
});

/** The shape axios gives for a gym-service refusal. */
const refusal = (status: number, code: string, extra: Record<string, unknown> = {}) => ({
  response: { status, data: { success: false, error: { code, message: "server" }, message: "server", ...extra } },
});

const emptyForm = (over: Partial<GymForm> = {}): GymForm => ({ description: "", amenityIds: [], proposalIds: [], photoIds: [], coverPhotoId: null, ...over });

describe("amenity selection helpers", () => {
  it("toggleId adds and removes without mutating", () => {
    const base = ["a"];
    assert.deepEqual(toggleId(base, "b"), ["a", "b"]);
    assert.deepEqual(toggleId(base, "a"), []);
    assert.deepEqual(base, ["a"]);
  });

  it("amenityTotal counts catalogue amenities + pending proposals, de-duplicated", () => {
    assert.equal(amenityTotal({ amenityIds: ["a", "a", "b"], proposalIds: ["p"] }), 3);
    assert.equal(amenityTotal({ amenityIds: [], proposalIds: [] }), 0);
  });

  it("submit needs >= 1 amenity or proposal; saving does not", () => {
    assert.equal(validateGymForm(emptyForm(), DEFAULT_GYM_LIMITS, false), null);
    assert.equal(validateGymForm(emptyForm(), DEFAULT_GYM_LIMITS, true), GYM_LISTING_ERROR_VI.AMENITIES_REQUIRED);
    assert.equal(validateGymForm(emptyForm({ proposalIds: ["p"] }), DEFAULT_GYM_LIMITS, true), null);
    assert.equal(validateGymForm(emptyForm({ amenityIds: ["a"] }), DEFAULT_GYM_LIMITS, true), null);
  });

  it("description is capped at 300 characters", () => {
    assert.ok(validateGymForm(emptyForm({ description: "x".repeat(DESCRIPTION_MAX + 1) })));
    assert.equal(validateGymForm(emptyForm({ description: "x".repeat(DESCRIPTION_MAX) })), null);
  });

  it("selectableAmenities keeps ACTIVE ones and a selected DISABLED one (so it can be removed)", () => {
    const pool = [amenity("on"), amenity("off", { status: "DISABLED" }), amenity("off2", { status: "DISABLED" })];
    assert.deepEqual(selectableAmenities(pool, ["off"]).map((a) => a.id), ["on", "off"]);
  });

  it("amenityPool de-duplicates by id and keeps the catalogue's order", () => {
    const pool = amenityPool([amenity("a"), amenity("b")], [amenity("b", { name: "dup" }), amenity("c")]);
    assert.deepEqual(pool.map((a) => a.id), ["a", "b", "c"]);
    assert.equal(pool[1].name, "Tiện ích b");
  });

  it("groups by the four categories in a fixed order, unknown category -> Cơ sở vật chất, empty groups dropped", () => {
    const groups = groupAmenitiesByCategory([
      amenity("1", { category: "RECOVERY", name: "Xông hơi" }),
      amenity("2", { category: "FACILITY", name: "Wifi" }),
      amenity("3", { category: "WEIRD", name: "Lạ" }),
      amenity("4", { category: "TRAINING_ZONE", name: "Tạ", sortOrder: 5 }),
    ]);
    assert.deepEqual(groups.map((g) => g.category), ["FACILITY", "TRAINING_ZONE", "RECOVERY"]);
    assert.deepEqual(groups[0].items.map((a) => a.id).sort(), ["2", "3"]);
  });

  it("the draft body is normalized like the server does (trim, unique, cover inside the photos)", () => {
    const body = buildGymDraftPayload(emptyForm({ description: "  Xin chào ", amenityIds: ["a", "a", " b "], photoIds: ["p1", "p1", "p2"], coverPhotoId: "gone" }));
    assert.equal(body.description, "Xin chào");
    assert.deepEqual(body.amenityIds, ["a", "b"]);
    assert.deepEqual(body.photoIds, ["p1", "p2"]);
    assert.equal(body.coverPhotoId, "p1");
    assert.equal(buildGymDraftPayload(emptyForm()).coverPhotoId, null);
    assert.equal(buildGymDraftPayload(emptyForm({ description: "   " })).description, null);
  });

  it("the form signature ignores what the server ignores (blank description, duplicate ids) and sees real edits", () => {
    const a = gymFormSignature(emptyForm({ amenityIds: ["a"] }));
    assert.equal(gymFormSignature(emptyForm({ amenityIds: ["a", "a"], description: " " })), a);
    assert.notEqual(gymFormSignature(emptyForm({ amenityIds: ["a", "b"] })), a);
    assert.equal(gymFormSignature(formFromGymPayload({ description: null, amenityIds: ["a"], proposalIds: [], photoIds: [], coverPhotoId: null })), a);
  });
});

describe("branch eligibility (who has a listing to edit)", () => {
  it("only APPROVED and SUSPENDED branches are editable, each other status says why", () => {
    assert.equal(branchAvailability({ status: "APPROVED", operationalStatus: "OPEN" }).editable, true);
    assert.equal(branchAvailability({ status: "SUSPENDED", operationalStatus: "OPEN" }).editable, true);
    assert.equal(branchAvailability({ status: "APPROVED", operationalStatus: "TEMPORARILY_CLOSED" }).editable, true);
    for (const status of ["DRAFT", "PENDING_REVIEW", "REJECTED", "WHATEVER"]) {
      const a = branchAvailability({ status, operationalStatus: "OPEN" });
      assert.equal(a.editable, false, status);
      assert.ok(a.reason && a.reason.length > 10, status);
    }
  });

  it("a permanently closed branch is never editable, even when approved", () => {
    const a = branchAvailability({ status: "APPROVED", operationalStatus: "PERMANENTLY_CLOSED" });
    assert.equal(a.editable, false);
    assert.match(a.reason ?? "", /đóng cửa vĩnh viễn/);
  });

  it("?gymId= is honoured only for an editable branch of the owner, else the first editable one, else none", () => {
    const gyms = [
      { id: "d", status: "DRAFT", operationalStatus: "OPEN" },
      { id: "a", status: "APPROVED", operationalStatus: "OPEN" },
      { id: "s", status: "SUSPENDED", operationalStatus: "OPEN" },
    ];
    assert.equal(pickInitialGymId(gyms, "s"), "s");
    assert.equal(pickInitialGymId(gyms, "d"), "a", "a draft cannot be opened");
    assert.equal(pickInitialGymId(gyms, "someone-elses"), "a", "an unknown id is not trusted");
    assert.equal(pickInitialGymId(gyms, null), "a");
    assert.equal(pickInitialGymId([gyms[0]], "d"), null);
    assert.equal(pickInitialGymId([], null), null);
  });
});

describe("proposal result handling (plan 12.3)", () => {
  it("200 { matchedAmenity }: nothing created, the amenity is selected", () => {
    const o = interpretProposeResponse({ matchedAmenity: { id: "x", name: "Phòng boxing", category: "TRAINING_ZONE", iconKey: "dumbbell", status: "ACTIVE" } });
    assert.equal(o?.kind, "matched");
    const sel = applyProposeOutcome({ amenityIds: ["a"], proposalIds: [] }, o!);
    assert.deepEqual(sel.amenityIds, ["a", "x"]);
    assert.deepEqual(applyProposeOutcome(sel, o!).amenityIds, ["a", "x"], "idempotent");
    assert.match(proposeOutcomeMessage(o!), /đã có sẵn/);
  });

  it("201 NEW proposal joins proposalIds and is announced as sent", () => {
    const o = interpretProposeResponse({ proposal: { id: "p1", name: "Spa", kind: "NEW", suggestedCategory: "RECOVERY", status: "PENDING", gymId: "g1" }, kind: "NEW", created: true });
    assert.ok(o && o.kind === "proposal");
    assert.equal(o.kind === "proposal" && o.reenable, false);
    assert.deepEqual(applyProposeOutcome({ amenityIds: [], proposalIds: [] }, o).proposalIds, ["p1"]);
    assert.match(proposeOutcomeMessage(o), /Đã gửi đề xuất "Spa"/);
  });

  it("REENABLE: a DISABLED amenity's name becomes a request to switch it back on", () => {
    const o = interpretProposeResponse({ proposal: { id: "p2", name: "Hồ bơi", kind: "REENABLE", targetAmenityId: "pool", status: "PENDING" }, kind: "REENABLE", created: true });
    assert.equal(o?.kind === "proposal" && o.reenable, true);
    assert.match(proposeOutcomeMessage(o!), /tạm ngưng.*bật lại/);
  });

  it("the owner's own PENDING proposal comes back (created:false) and is not re-added twice", () => {
    const o = interpretProposeResponse({ proposal: { id: "p1", name: "Spa", kind: "NEW", status: "PENDING" }, kind: "NEW", created: false });
    assert.ok(o && o.kind === "proposal" && o.created === false);
    assert.match(proposeOutcomeMessage(o!), /đã gửi đề xuất "Spa" rồi/);
    const once = applyProposeOutcome({ amenityIds: [], proposalIds: ["p1"] }, o!);
    assert.deepEqual(once.proposalIds, ["p1"]);
  });

  it("an unreadable answer is null, never a crash", () => {
    assert.equal(interpretProposeResponse(null), null);
    assert.equal(interpretProposeResponse({}), null);
    assert.equal(interpretProposeResponse({ proposal: { name: "no id" } }), null);
  });

  it("proposal form: name 2-40, a category, note <= 500", () => {
    assert.ok(proposalFormError({ name: "a", category: "SERVICE" }));
    assert.ok(proposalFormError({ name: "x".repeat(41), category: "SERVICE" }));
    assert.ok(proposalFormError({ name: "Spa", category: null }));
    assert.ok(proposalFormError({ name: "Spa", category: "NOPE" }));
    assert.ok(proposalFormError({ name: "Spa", category: "SERVICE", note: "n".repeat(501) }));
    assert.equal(proposalFormError({ name: " Spa ", category: "RECOVERY", note: "ok" }), null);
  });

  it("name matching ignores accents, case and spacing (đ -> d), only ACTIVE rows match", () => {
    assert.equal(normalizeAmenityName("  Phòng   BOXING "), "phong boxing");
    assert.equal(normalizeAmenityName("Đấm bốc"), "dam boc");
    const catalog = [amenity("1", { name: "Phòng boxing" }), amenity("2", { name: "Hồ bơi", status: "DISABLED" })];
    assert.equal(findCatalogMatch(catalog, "phong BOXING")?.id, "1");
    assert.equal(findCatalogMatch(catalog, "ho boi"), null, "a DISABLED name is not a match: it is a REENABLE request");
    assert.equal(findCatalogMatch(catalog, "  "), null);
  });

  it("only this branch's proposals are listed, and a waiting REENABLE for a disabled amenity is found", () => {
    const list = [proposal("1"), proposal("2", { gymId: "other" }), proposal("3", { kind: "REENABLE", targetAmenityId: "pool" }), proposal("4", { kind: "REENABLE", targetAmenityId: "pool", status: "REJECTED" })];
    assert.deepEqual(proposalsOfGym(list, "g1").map((p) => p.id), ["1", "3", "4"]);
    assert.equal(pendingReenableFor(list, "pool")?.id, "3");
    assert.equal(pendingReenableFor(list, "sauna"), null);
  });
});

describe("inline proposals (application / wizard)", () => {
  const catalog = [amenity("1", { name: "Phòng boxing" })];
  it("a name already in the catalogue is selected instead of proposed", () => {
    const r = addInlineProposal(catalog, [], [], { name: "phong boxing", suggestedCategory: "SERVICE" });
    assert.equal(r.outcome, "matched");
  });
  it("an own earlier or already-pending name is a duplicate; the cap of 10 holds", () => {
    const first = addInlineProposal(catalog, [], [], { name: "Spa", suggestedCategory: "RECOVERY", note: " hi " });
    assert.ok(first.outcome === "added" && first.proposals[0].note === "hi");
    const list = first.outcome === "added" ? first.proposals : [];
    assert.equal(addInlineProposal(catalog, list, [], { name: "SPA", suggestedCategory: "RECOVERY" }).outcome, "duplicate");
    assert.equal(addInlineProposal(catalog, [], [{ name: "Spa" }], { name: "spa", suggestedCategory: "RECOVERY" }).outcome, "duplicate");
    const full = Array.from({ length: MAX_INLINE_PROPOSALS }, (_, i) => ({ name: `P${i}`, suggestedCategory: "SERVICE" as const }));
    assert.equal(addInlineProposal(catalog, full, [], { name: "One more", suggestedCategory: "SERVICE" }).outcome, "duplicate");
  });
  it("the body always carries amenityIds (empty replaces); proposals / proposalIds only when present", () => {
    assert.deepEqual(amenitySelectionPayload({ amenityIds: ["a", "a"], proposals: [] }), { amenityIds: ["a"] });
    assert.deepEqual(amenitySelectionPayload({ amenityIds: [], proposals: [{ name: " Spa ", suggestedCategory: "RECOVERY" }], proposalIds: ["p"] }), {
      amenityIds: [],
      proposals: [{ name: "Spa", suggestedCategory: "RECOVERY" }],
      proposalIds: ["p"],
    });
  });
  it("0 choices is refused before the round trip; any one is enough", () => {
    assert.ok(amenitySelectionError({ amenityIds: [], proposals: [] }));
    assert.equal(amenitySelectionError({ amenityIds: [], proposals: [], proposalIds: ["p"] }), null);
    assert.equal(amenitySelectionError({ amenityIds: ["a"], proposals: [] }), null);
  });
});

describe("re-opened DRAFT branch (GET /owner/gyms/:id read-back)", () => {
  const branch = {
    id: "g1",
    facilities: ["WIFI"],
    amenities: [
      { id: "amenity-sys-wifi", name: "Wifi", category: "FACILITY", iconKey: "wifi", status: "ACTIVE", source: "SYSTEM" },
      { id: "custom-1", name: "Phòng boxing", category: "TRAINING_ZONE", iconKey: "dumbbell", status: "ACTIVE", source: "CUSTOM" },
      { id: "custom-off", name: "Spa", category: "RECOVERY", iconKey: "sparkles", status: "DISABLED", source: "CUSTOM" },
    ],
    amenityProposals: [
      { id: "p1", name: "Sân tennis", kind: "NEW", suggestedCategory: "TRAINING_ZONE", status: "PENDING", gymId: "g1" },
      { id: "p2", name: "Cũ", kind: "NEW", suggestedCategory: "SERVICE", status: "REJECTED", gymId: "g1" },
    ],
  };
  it("the starting selection is the branch's real amenities - custom ones included - and its PENDING proposals", () => {
    assert.deepEqual(initialDraftSelection(branch), { amenityIds: ["amenity-sys-wifi", "custom-1"], proposalIds: ["p1"] });
  });
  it("a DISABLED amenity is not selected (the next save would be a 422 AMENITY_DISABLED)", () => {
    assert.ok(!initialDraftSelection(branch).amenityIds.includes("custom-off"));
  });
  it("normalizeBranchSelection keeps the DTOs; a response without the fields (manager, older server) is empty, never a crash", () => {
    const sel = normalizeBranchSelection(branch);
    assert.equal(sel.amenities.length, 3);
    assert.equal(sel.proposals[0].name, "Sân tennis");
    assert.deepEqual(normalizeBranchSelection({ id: "g1", facilities: ["WIFI"] }), { amenities: [], proposals: [] });
    assert.deepEqual(initialDraftSelection(null), { amenityIds: [], proposalIds: [] });
  });
});

describe("photo limit (20 per branch)", () => {
  it("the 21st photo is refused, never silently dropped", () => {
    let ids: string[] = [];
    let cover: string | null = null;
    for (let i = 0; i < DEFAULT_GYM_LIMITS.maxPhotos; i++) {
      const r = addPhoto(ids, cover, `p${i}`, DEFAULT_GYM_LIMITS.maxPhotos);
      assert.equal(r.outcome, "added");
      ids = r.ids;
      cover = r.cover;
    }
    assert.equal(ids.length, 20);
    assert.equal(cover, "p0", "the first photo becomes the cover");
    assert.equal(addPhoto(ids, cover, "p20", 20).outcome, "limit");
    assert.equal(addPhoto(ids, cover, "p3", 20).outcome, "duplicate");
  });
  it("limits: 20 public / 40 staged, the wizard's draft branch holds 20", () => {
    assert.deepEqual(DEFAULT_GYM_LIMITS, { maxPhotos: 20, maxStagedPhotos: 40 });
    assert.equal(MAX_DRAFT_BRANCH_PHOTOS, 20);
  });
  it("a form with 21 photos fails validation with the 20-photo message", () => {
    const f = emptyForm({ photoIds: Array.from({ length: 21 }, (_, i) => `p${i}`) });
    assert.match(validateGymForm(f) ?? "", /tối đa 20 ảnh/);
    assert.equal(validateGymForm({ ...f, photoIds: f.photoIds.slice(0, 20) }), null);
  });
  it("the server's own limits override the defaults", () => {
    const v = normalizeGymListing({ limits: { maxPhotos: 12, maxStagedPhotos: 30 } });
    assert.deepEqual(v.limits, { maxPhotos: 12, maxStagedPhotos: 30 });
    assert.deepEqual(normalizeGymListing({}).limits, DEFAULT_GYM_LIMITS);
  });
});

describe("error codes -> Vietnamese", () => {
  it("gym codes win; shared codes fall through to the listing table", () => {
    assert.match(gymListingErrorMessage(refusal(422, "AMENITIES_REQUIRED")), /ít nhất một tiện ích/);
    assert.match(gymListingErrorMessage(refusal(409, "LISTING_REVIEW_REQUIRED")), /Tin đăng & tiện ích/);
    assert.match(gymListingErrorMessage(refusal(409, "GYM_IS_DRAFT")), /bước nháp/);
    assert.match(gymListingErrorMessage(refusal(409, "LISTING_NOT_AVAILABLE")), /chưa có tin đăng/);
    assert.match(gymListingErrorMessage(refusal(409, "GYM_NOT_DRAFT")), /bản sửa tin đăng/);
    assert.match(gymListingErrorMessage(refusal(422, "PHOTO_LIMIT")), /tối đa 20 ảnh/);
    assert.match(gymListingErrorMessage(refusal(409, "DRAFT_STALE")), /thay đổi ở nơi khác/);
    assert.match(gymListingErrorMessage(refusal(409, "PROPOSAL_ALREADY_DECIDED")), /đã được Gymini xử lý/);
    assert.match(gymListingErrorMessage(refusal(409, "PHOTO_IN_REVIEW")), /chờ duyệt/);
  });
  it("no refusal ever shows a raw code or English text", () => {
    for (const [code, text] of Object.entries(GYM_LISTING_ERROR_VI)) assert.match(text, /[À-ỹ]|\s/, code);
    assert.equal(gymListingErrorMessage(refusal(500, "SOMETHING_NEW")), "Có lỗi xảy ra. Vui lòng thử lại.");
    assert.match(gymListingErrorMessage(refusal(403, "FORBIDDEN")), /không có quyền/);
    assert.match(gymListingErrorMessage({ response: undefined }), /kết nối/);
  });
  it("410 (retired disk route) and 422 AMENITIES_REQUIRED are recognised", () => {
    assert.equal(isUploadRouteRetired(refusal(410, "UPLOAD_ROUTE_RETIRED")), true);
    assert.equal(isUploadRouteRetired({ response: { status: 410, data: {} } }), true);
    assert.equal(isUploadRouteRetired(refusal(409, "OTHER")), false);
    assert.equal(isAmenitiesRequired(refusal(422, "AMENITIES_REQUIRED")), true);
    assert.equal(isAmenitiesRequired(refusal(422, "NO_CHANGES")), false);
    assert.match(gymListingErrorMessage({ response: { status: 410, data: { code: "UPLOAD_ROUTE_RETIRED" } } }), /không còn dùng nữa/);
  });
  it("AMENITY_DISABLED names the switched-off amenities (listing: amenities[], wizard: amenityIds[])", () => {
    assert.deepEqual(disabledAmenitiesOf(refusal(409, "AMENITY_DISABLED", { amenities: [{ id: "x", name: "Sauna" }, { nope: 1 }] })), [{ id: "x", name: "Sauna" }]);
    assert.deepEqual(disabledAmenitiesOf(refusal(422, "AMENITY_DISABLED", { amenityIds: ["y"] })), [{ id: "y", name: "" }]);
    assert.deepEqual(disabledAmenitiesOf(refusal(409, "OTHER")), []);
  });
});

describe("normalization and status", () => {
  it("normalizes the listing GET (missing pieces become empty, never undefined)", () => {
    const v = normalizeGymListing({
      gym: { id: "g1", name: "Chi nhánh 1", status: "APPROVED", operationalStatus: "OPEN" },
      listingVersion: 3,
      published: { payload: { description: " Giới thiệu ", amenityIds: ["a", 7, "a"], proposalIds: [], photoIds: ["p"], coverPhotoId: "p" }, photos: [{ id: "p", status: "PUBLISHED", url: "/media/gym-photos/p", isCover: true, sortOrder: 0 }] },
      openRevision: { id: "r", gymId: "g1", status: "DRAFT", draftVersion: 4, baseVersion: 3, payload: { description: null, amenityIds: ["a"], proposalIds: [], photoIds: [], coverPhotoId: null }, systemAdjustments: [{ type: "PROPOSAL_RESOLVED", name: "Spa" }, { bad: true }] },
      photos: [{ id: "s", status: "STAGED", url: "https://s3/x", expiresAt: "2026-10-23T00:00:00Z" }],
      amenities: [{ id: "a", name: "Wifi", category: "FACILITY", iconKey: "wifi", status: "ACTIVE" }, { id: 1 }],
      proposals: [{ id: "p1", name: "Spa", kind: "REENABLE", suggestedCategory: "BOGUS" }],
      history: [{ id: "h", status: "APPROVED" }, { nope: true }],
    });
    assert.equal(v.listingVersion, 3);
    assert.equal(v.published.payload.description, "Giới thiệu");
    assert.deepEqual(v.published.payload.amenityIds, ["a"]);
    assert.equal(v.openRevision?.draftVersion, 4);
    assert.equal(v.openRevision?.systemAdjustments.length, 1);
    assert.equal(v.photos[0].status, "STAGED");
    assert.equal(v.amenities.length, 1);
    assert.equal(v.proposals[0].suggestedCategory, "FACILITY", "an unknown category falls back");
    assert.equal(v.proposals[0].kind, "REENABLE");
    assert.equal(v.history.length, 1);
    const empty = normalizeGymListing(null);
    assert.equal(empty.openRevision, null);
    assert.deepEqual(empty.amenities, []);
  });

  it("status card: draft / changes requested / pending / rejected, gym notices from the server's adjustments", () => {
    const rev = (over: object) => normalizeGymListing({ openRevision: { id: "r", status: "DRAFT", payload: {}, ...over }, history: [] }).openRevision;
    assert.equal(gymListingStatusView({ openRevision: rev({}), history: [] }).key, "DRAFT");
    const cr = gymListingStatusView({ openRevision: rev({ reviewNote: "Thiếu ảnh" }), history: [] });
    assert.equal(cr.key, "CHANGES_REQUESTED");
    assert.equal(cr.adminNote, "Thiếu ảnh");
    assert.equal(gymListingStatusView({ openRevision: rev({ status: "PENDING" }), history: [] }).key, "PENDING");
    const withNotice = gymListingStatusView({ openRevision: rev({ systemAdjustments: [{ type: "PROPOSAL_REJECTED_REMOVED", name: "Spa" }, { type: "AMENITY_DISABLED_REMOVED", name: "Sauna", amenityId: "s" }] }), history: [] });
    assert.equal(withNotice.notices.length, 1, "the disabled-amenity adjustment has its own block, not a plain notice");
    assert.match(withNotice.notices[0], /Spa/);
    const rejected = gymListingStatusView({ openRevision: null, history: [{ id: "h", status: "REJECTED", reviewNote: "Ảnh mờ", parentRevisionId: null, submittedAt: null, reviewedAt: null, closedAt: null, createdAt: null }] });
    assert.equal(rejected.key, "REJECTED");
    assert.equal(rejected.adminNote, "Ảnh mờ");
  });

  it("disabled-amenity notices: removed from the draft + still on the published listing but DISABLED, each once", () => {
    const view = normalizeGymListing({
      published: { payload: { amenityIds: ["pool", "wifi"] } },
      openRevision: { id: "r", status: "DRAFT", payload: {}, systemAdjustments: [{ type: "AMENITY_DISABLED_REMOVED", amenityId: "sauna", name: "Xông hơi" }, { type: "AMENITY_DISABLED_REMOVED", amenityId: "pool", name: "Hồ bơi" }] },
      amenities: [
        { id: "pool", name: "Hồ bơi", category: "TRAINING_ZONE", iconKey: "waves", status: "DISABLED" },
        { id: "wifi", name: "Wifi", category: "FACILITY", iconKey: "wifi", status: "ACTIVE" },
        { id: "sauna", name: "Xông hơi", category: "RECOVERY", iconKey: "flame", status: "DISABLED" },
      ],
    });
    const notices = disabledAmenityNotices(view);
    assert.deepEqual(notices.map((n) => n.amenityId).sort(), ["pool", "sauna"]);
    assert.equal(notices.find((n) => n.amenityId === "sauna")?.category, "RECOVERY");
  });

  it("normalizes the preview, including pending custom amenities and STAGED photos", () => {
    assert.equal(normalizeGymPreview({ isPreview: false }), null);
    const p = normalizeGymPreview({
      isPreview: true,
      revisionStatus: "PENDING",
      name: "A",
      address: "1 Lê Lợi",
      amenities: [{ id: "a", name: "Wifi", iconKey: "wifi", category: "FACILITY" }],
      pendingAmenities: [{ proposalId: "p1", name: "Spa", suggestedCategory: "RECOVERY", kind: "NEW" }],
      photos: [{ id: "x", url: "https://s3/x", isCover: true, status: "STAGED" }, { id: "y", url: null }],
      coverPhotoUrl: "https://s3/x",
    });
    assert.equal(p?.pendingAmenities[0].name, "Spa");
    assert.equal(p?.photos[1].url, null);
    assert.equal(p?.coverPhotoUrl, "https://s3/x");
  });
});
