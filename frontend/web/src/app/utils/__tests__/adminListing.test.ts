/**
 * Listing Management D1 - admin request bodies (all `.strict()` on the server), reason rules, amenity catalogue
 * and proposal helpers.
 * Run: npx tsx --test src/app/utils/__tests__/adminListing.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  adminReasonError,
  amenityFormError,
  amenityFormFrom,
  buildAmenityCreateBody,
  buildAmenityPatchBody,
  buildGymApproveBody,
  buildGymDirectEditBody,
  buildProposalApproveBody,
  buildProposalMergeBody,
  buildProposalRejectBody,
  buildPtDirectEditBody,
  buildQueueParams,
  buildRetireBody,
  dominantCategory,
  groupAmenitiesByCategory,
  gymDirectEditError,
  noteRequiredError,
  ownerCountLabel,
  proposalOutcomeMessage,
  proposalRejectReasonError,
  ptAdminPhotoCandidates,
  revisionStatusView,
} from "../adminListing";
import { AMENITY_CATEGORIES } from "../amenityIcons";
import { normalizePayload } from "../ptListing";
import type { Amenity } from "../../types";

const published = normalizePayload({
  profile: { professionalBio: "Bio", mainSpecialties: ["Tăng cơ"], languages: ["Tiếng Việt"] },
  packages: [{ id: "p1", name: "Gói 10", price: 2000000, sessionCount: 10, sessionMode: "ONLINE", sessionDurationMinutes: 60, validityDays: null, isActive: true }],
  photoIds: ["a", "b", "c"],
  coverPhotoId: "a",
});
const ptInput = (over: Record<string, unknown> = {}) => ({
  published,
  profile: published.profile,
  packages: published.packages,
  photoIds: published.photoIds,
  coverPhotoId: published.coverPhotoId,
  reason: "Ảnh bị khách báo cáo",
  expectedListingVersion: 4,
  ...over,
});

describe("reasons and notes", () => {
  it("direct-edit / retire reason needs >= 10 characters (trimmed)", () => {
    assert.match(adminReasonError("ngắn") ?? "", /ít nhất 10/);
    assert.match(adminReasonError("         x         ") ?? "", /ít nhất 10/);
    assert.equal(adminReasonError("Đủ mười ký tự"), null);
    assert.match(adminReasonError("x".repeat(1001)) ?? "", /1000/);
  });

  it("reject / request-changes need a non-empty note", () => {
    assert.ok(noteRequiredError("   "));
    assert.equal(noteRequiredError("Thiếu ảnh bìa"), null);
  });

  it("a proposal rejection needs a reason of at least 3 characters", () => {
    assert.ok(proposalRejectReasonError("ab"));
    assert.equal(proposalRejectReasonError("Trùng"), null);
  });
});

describe("queue params and status view", () => {
  it("sends only the filters that are set; PENDING is the default the page passes", () => {
    assert.deepEqual(buildQueueParams({ status: "PENDING" }), { status: "PENDING" });
    assert.deepEqual(buildQueueParams({ status: "APPROVED", q: " An ", brandId: "b1", gymId: "g1", page: 3 }), { status: "APPROVED", q: "An", brandId: "b1", gymId: "g1", page: 3 });
    assert.equal("page" in buildQueueParams({ status: "PENDING", page: 1 }), false);
  });

  it("every revision status has a Vietnamese label; an unknown one never leaks the enum", () => {
    for (const s of ["DRAFT", "PENDING", "APPROVED", "REJECTED", "CHANGES_REQUESTED", "WITHDRAWN", "STALE"]) {
      assert.doesNotMatch(revisionStatusView(s).label, /^[A-Z_]+$/);
    }
    assert.equal(revisionStatusView("WHATEVER").label, "Không rõ");
  });
});

describe("gym approve body", () => {
  it("sends only the keys that are set (the schema is strict)", () => {
    assert.deepEqual(buildGymApproveBody({}), {});
    assert.deepEqual(buildGymApproveBody({ note: "  ok  ", dropDisabledAmenities: true }), { note: "ok", dropDisabledAmenities: true });
    assert.deepEqual(buildGymApproveBody({ dropRejectedAmenities: true, dropDisabledAmenities: false }), { dropRejectedAmenities: true });
  });
});

describe("PT direct edit body", () => {
  it("returns null when nothing differs (the server would answer 422 NO_CHANGES)", () => {
    assert.equal(buildPtDirectEditBody(ptInput()), null);
  });

  it("sends only the changed part + reason + expectedListingVersion", () => {
    const body = buildPtDirectEditBody(ptInput({ profile: { ...published.profile, professionalBio: "Bio mới" } }));
    assert.deepEqual(body, { profile: { professionalBio: "Bio mới" }, reason: "Ảnh bị khách báo cáo", expectedListingVersion: 4 });
  });

  it("photo order and cover are sent; a cover that left the list falls back to the first photo", () => {
    const body = buildPtDirectEditBody(ptInput({ photoIds: ["c", "b"], coverPhotoId: "zz" }))!;
    assert.deepEqual(body.photoIds, ["c", "b"]);
    assert.equal(body.coverPhotoId, "c");
    assert.equal("profile" in body, false);
    assert.equal("packages" in body, false);
  });

  it("a package price change sends the whole wanted package list, with the id", () => {
    const body = buildPtDirectEditBody(ptInput({ packages: [{ ...published.packages[0], price: 2500000 }] }))!;
    assert.equal((body.packages as any[])[0].id, "p1");
    assert.equal((body.packages as any[])[0].price, 2500000);
  });

  it("archiving the only package is a change (packages sent with archive:true)", () => {
    const body = buildPtDirectEditBody(ptInput({ packages: [{ ...published.packages[0], archive: true }] }))!;
    assert.equal((body.packages as any[])[0].archive, true);
  });

  it("an admin can only keep photos that are already public", () => {
    assert.deepEqual(ptAdminPhotoCandidates(["a", "b"], ["b", "STAGED", "a"]), ["b", "a"]);
  });
});

describe("gym direct edit body", () => {
  const pub = { description: "Mô tả", amenityIds: ["a1", "a2"], proposalIds: [], photoIds: ["x", "y"], coverPhotoId: "x" };
  const gymInput = (over: Record<string, unknown> = {}) => ({
    published: pub,
    description: "Mô tả",
    amenityIds: ["a2", "a1"],
    photoIds: ["x", "y"],
    coverPhotoId: "x",
    reason: "Gỡ ảnh vi phạm",
    expectedListingVersion: 7,
    ...over,
  });

  it("amenity order alone is not a change", () => {
    assert.equal(buildGymDirectEditBody(gymInput()), null);
  });

  it("sends description / amenities / photos / cover only when they differ", () => {
    assert.deepEqual(buildGymDirectEditBody(gymInput({ description: "  Mô tả mới " })), { description: "Mô tả mới", reason: "Gỡ ảnh vi phạm", expectedListingVersion: 7 });
    const b = buildGymDirectEditBody(gymInput({ amenityIds: ["a1"], photoIds: ["y", "x", "new"], coverPhotoId: "new" }))!;
    assert.deepEqual(b.amenityIds, ["a1"]);
    assert.deepEqual(b.photoIds, ["y", "x", "new"]);
    assert.equal(b.coverPhotoId, "new");
  });

  it("clearing the description sends null", () => {
    assert.equal(buildGymDirectEditBody(gymInput({ description: "  " }))!.description, null);
  });

  it("caps: 300-char description and 20 photos", () => {
    assert.match(gymDirectEditError({ description: "x".repeat(301), photoIds: [] }) ?? "", /300/);
    assert.match(gymDirectEditError({ description: "", photoIds: Array.from({ length: 21 }, (_, i) => String(i)) }) ?? "", /20/);
    assert.equal(gymDirectEditError({ description: "ok", photoIds: ["a"] }), null);
  });
});

describe("retire body", () => {
  it("purge is sent only when ticked", () => {
    assert.deepEqual(buildRetireBody("  Ảnh vi phạm quy định ", false), { reason: "Ảnh vi phạm quy định" });
    assert.deepEqual(buildRetireBody("Ảnh vi phạm quy định", true), { reason: "Ảnh vi phạm quy định", purge: true });
  });
});

describe("amenity catalogue", () => {
  const am = (over: Partial<Amenity> = {}): Amenity => ({ id: "am1", slug: "wifi", name: "Wifi miễn phí", category: "FACILITY", iconKey: "wifi", sortOrder: 140, source: "SYSTEM", status: "ACTIVE", ...over });

  it("create body: name trimmed, optional sortOrder only when typed", () => {
    assert.deepEqual(buildAmenityCreateBody({ name: " Phòng boxing ", category: "TRAINING_ZONE", iconKey: "trophy", sortOrder: "" }), { name: "Phòng boxing", category: "TRAINING_ZONE", iconKey: "trophy" });
    assert.equal(buildAmenityCreateBody({ name: "A B", category: "SERVICE", iconKey: "star", sortOrder: "30" }).sortOrder, 30);
  });

  it("form validation: name 2..40, icon on the allowlist (the server's list wins), sort order an integer", () => {
    const f = { name: "Phòng boxing", category: "FACILITY" as const, iconKey: "star", sortOrder: "" };
    assert.equal(amenityFormError(f), null);
    assert.ok(amenityFormError({ ...f, name: "A" }));
    assert.ok(amenityFormError({ ...f, name: "x".repeat(41) }));
    assert.ok(amenityFormError({ ...f, iconKey: "not-an-icon" }));
    assert.equal(amenityFormError({ ...f, iconKey: "new-server-key" }, ["new-server-key"]), null);
    assert.ok(amenityFormError({ ...f, sortOrder: "1.5" }));
    assert.ok(amenityFormError({ ...f, sortOrder: "-1" }));
  });

  it("patch body: only changed fields; nothing changed → null (no pointless request)", () => {
    const a = am();
    assert.equal(buildAmenityPatchBody(a, amenityFormFrom(a)), null);
    assert.deepEqual(buildAmenityPatchBody(a, { ...amenityFormFrom(a), name: "Wifi tốc độ cao", iconKey: "zap" }), { name: "Wifi tốc độ cao", iconKey: "zap" });
    assert.deepEqual(buildAmenityPatchBody(a, { ...amenityFormFrom(a), category: "SERVICE", sortOrder: "5" }), { category: "SERVICE", sortOrder: 5 });
  });

  it("groups by category in the given order, sorted by sortOrder, hiding empty categories", () => {
    const list = [am({ id: "1", name: "B", category: "SERVICE", sortOrder: 2 }), am({ id: "2", name: "A", category: "SERVICE", sortOrder: 1 }), am({ id: "3", category: "FACILITY" })];
    const g = groupAmenitiesByCategory(list, AMENITY_CATEGORIES);
    assert.deepEqual(g.map((x) => x.category), ["FACILITY", "SERVICE"]);
    assert.deepEqual(g[1].items.map((x) => x.id), ["2", "1"]);
  });
});

describe("proposal decisions", () => {
  const group = { kind: "NEW" as const, proposalIds: ["p1", "p2"], suggestedCategories: { SERVICE: 1, RECOVERY: 2 } };

  it("dominantCategory picks the most suggested; owner count wording", () => {
    assert.equal(dominantCategory(group), "RECOVERY");
    assert.equal(dominantCategory({ suggestedCategories: {} }), null);
    assert.equal(ownerCountLabel(1), "1 chủ gym đề xuất");
    assert.equal(ownerCountLabel(3), "3 chủ gym cùng đề xuất");
  });

  it("approve NEW sends category / icon / sort defaults; REENABLE sends ids only", () => {
    const form = { category: "RECOVERY" as const, iconKey: "flame", sortOrder: "" };
    assert.deepEqual(buildProposalApproveBody(group, form), { proposalIds: ["p1", "p2"], category: "RECOVERY", iconKey: "flame" });
    assert.deepEqual(buildProposalApproveBody({ kind: "REENABLE", proposalIds: ["p9"] }, form), { proposalIds: ["p9"] });
    assert.equal(buildProposalApproveBody(group, { ...form, sortOrder: "12" }).sortOrder, 12);
    // no icon picked = the category default chosen by the server
    assert.equal("iconKey" in buildProposalApproveBody(group, { ...form, iconKey: "" }), false);
  });

  it("'Bật lại và gộp' is an explicit flag, never implied", () => {
    const form = { category: "FACILITY" as const, iconKey: "star", sortOrder: "" };
    assert.equal("reenableAndMerge" in buildProposalApproveBody(group, form), false);
    assert.equal(buildProposalApproveBody(group, form, { reenableAndMerge: true }).reenableAndMerge, true);
    assert.equal("reenableAndMerge" in buildProposalMergeBody(group, "am1"), false);
    assert.deepEqual(buildProposalMergeBody(group, "am1", { reenableAndMerge: true }), { proposalIds: ["p1", "p2"], targetAmenityId: "am1", reenableAndMerge: true });
  });

  it("reject body carries the trimmed reason; outcome sentences", () => {
    assert.deepEqual(buildProposalRejectBody(group, "  Trùng lặp "), { proposalIds: ["p1", "p2"], reason: "Trùng lặp" });
    assert.match(proposalOutcomeMessage("APPROVED", "Phòng boxing"), /Phòng boxing/);
    assert.match(proposalOutcomeMessage("MERGED", "Wifi"), /gộp/);
    assert.match(proposalOutcomeMessage("REJECTED"), /từ chối/);
  });
});
