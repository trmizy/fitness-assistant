/**
 * Listing Management D1 - the PT "Tin đăng" pure model (reorder / limit helpers, payload builder, status view,
 * validation, draft sync). node:test like the sibling tests.
 * Run: npx tsx --test src/app/utils/__tests__/ptListing.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_LIMITS,
  EMPTY_PACKAGE,
  LANGUAGE_OPTIONS,
  TARGET_GROUP_OPTIONS,
  addCustomLanguage,
  addPhoto,
  applyPackageForm,
  archivePackageItem,
  buildDraftPayload,
  copyableRejected,
  customLanguages,
  decideDraftSync,
  formFromPayload,
  formSignature,
  listingPackageError,
  listingStatusView,
  movePhoto,
  normalizeListing,
  normalizePayload,
  normalizePreview,
  optionsWithSaved,
  packageFormFrom,
  payloadSignature,
  photoFileError,
  photoRoom,
  ptListingInvalidationKeys,
  ptListingKey,
  removePhoto,
  restorePackageItem,
  setCover,
  toggleListValue,
  validateListingForm,
  versionAfterPhotoDelete,
} from "../ptListing";

const basePayload = () =>
  normalizePayload({
    profile: { professionalBio: "  Xin chào  ", mainSpecialties: ["Tăng cơ", "Tăng cơ"], languages: ["Tiếng Việt"], websiteUrl: "" },
    packages: [{ id: "p1", name: "Gói 10 buổi", price: 2000000, sessionCount: 10, sessionMode: "ONLINE", sessionDurationMinutes: 60, validityDays: null, isActive: true }],
    photoIds: ["a", "b", "c"],
    coverPhotoId: "b",
  });

describe("photo helpers (↑↓, limit, cover)", () => {
  it("movePhoto moves one step and is a no-op at the ends / for an unknown id", () => {
    assert.deepEqual(movePhoto(["a", "b", "c"], "b", -1), ["b", "a", "c"]);
    assert.deepEqual(movePhoto(["a", "b", "c"], "b", 1), ["a", "c", "b"]);
    assert.deepEqual(movePhoto(["a", "b", "c"], "a", -1), ["a", "b", "c"]);
    assert.deepEqual(movePhoto(["a", "b", "c"], "c", 1), ["a", "b", "c"]);
    assert.deepEqual(movePhoto(["a", "b"], "zzz", 1), ["a", "b"]);
  });

  it("movePhoto never mutates its input", () => {
    const ids = ["a", "b", "c"];
    movePhoto(ids, "a", 1);
    assert.deepEqual(ids, ["a", "b", "c"]);
  });

  it("addPhoto refuses the 6th photo, refuses a duplicate, and makes the first photo the cover", () => {
    const five = ["1", "2", "3", "4", "5"];
    const sixth = addPhoto(five, "1", "6", 5);
    assert.equal(sixth.outcome, "limit");
    assert.deepEqual(sixth.ids, five);
    assert.equal(addPhoto(["1"], "1", "1", 5).outcome, "duplicate");
    const first = addPhoto([], null, "x", 5);
    assert.deepEqual(first, { ids: ["x"], cover: "x", outcome: "added" });
    assert.equal(addPhoto(["x"], "x", "y", 5).cover, "x");
  });

  it("removePhoto re-points the cover to the first remaining photo, and clears it when none is left", () => {
    assert.deepEqual(removePhoto(["a", "b", "c"], "a", "a"), { ids: ["b", "c"], cover: "b" });
    assert.deepEqual(removePhoto(["a", "b", "c"], "b", "c"), { ids: ["a", "b"], cover: "b" });
    assert.deepEqual(removePhoto(["a"], "a", "a"), { ids: [], cover: null });
  });

  it("setCover only accepts a photo that is in the list; photoRoom never goes negative", () => {
    assert.equal(setCover(["a", "b"], "a", "b"), "b");
    assert.equal(setCover(["a", "b"], "a", "zzz"), "a");
    assert.equal(photoRoom(3, 5), 2);
    assert.equal(photoRoom(7, 5), 0);
  });

  it("photoFileError checks type and the 8 MB cap before any request", () => {
    assert.equal(photoFileError({ type: "image/jpeg", size: 1000 }), null);
    assert.match(photoFileError({ type: "image/gif", size: 1000 }) ?? "", /JPEG, PNG hoặc WebP/);
    assert.match(photoFileError({ type: "image/png", size: 9 * 1024 * 1024 }) ?? "", /8 MB/);
    assert.match(photoFileError({ type: "image/png", size: 0 }) ?? "", /rỗng/);
  });
});

describe("payload builder (what PUT .../draft sends)", () => {
  it("normalizes like the server: trims, drops empties, dedups, and keeps ids", () => {
    const form = formFromPayload(basePayload());
    form.profile.websiteUrl = "   ";
    const p = buildDraftPayload(form);
    assert.equal(p.profile.professionalBio, "Xin chào");
    assert.deepEqual(p.profile.mainSpecialties, ["Tăng cơ"]);
    assert.equal(p.profile.websiteUrl, null);
    assert.equal(p.packages[0].id, "p1");
    assert.equal("key" in p.packages[0], false);
    assert.deepEqual(p.photoIds, ["a", "b", "c"]);
    assert.equal(p.coverPhotoId, "b");
  });

  it("falls back to the first photo as cover when the cover is not in the list, and to null with no photos", () => {
    const form = formFromPayload(basePayload());
    form.coverPhotoId = "gone";
    assert.equal(buildDraftPayload(form).coverPhotoId, "a");
    form.photoIds = [];
    assert.equal(buildDraftPayload(form).coverPhotoId, null);
  });

  it("emits `archive: true` only for a dropped existing package; a new package is simply removed", () => {
    const form = formFromPayload(basePayload());
    form.packages = [...form.packages, applyPackageForm({ ...EMPTY_PACKAGE, name: "Mới", sessionCount: "5", price: "900000" }, undefined, "new-1")];
    const dropped = archivePackageItem(form.packages, "p1");
    assert.equal(dropped.find((p) => p.key === "p1")?.archive, true);
    const droppedNew = archivePackageItem(form.packages, "new-1");
    assert.equal(droppedNew.some((p) => p.key === "new-1"), false);
    const payload = buildDraftPayload({ ...form, packages: dropped });
    assert.equal(payload.packages.find((p) => p.id === "p1")?.archive, true);
    assert.equal("archive" in (payload.packages.find((p) => !p.id) ?? {}), false);
    // restoring undoes the mark
    assert.equal(restorePackageItem(dropped, "p1").find((p) => p.key === "p1")?.archive, undefined);
  });

  it("a payload round-trips to an identical signature (no false 'dirty')", () => {
    const p = basePayload();
    assert.equal(payloadSignature(p), formSignature(formFromPayload(p)));
    const form = formFromPayload(p);
    form.profile.professionalBio = "Khác";
    assert.notEqual(payloadSignature(p), formSignature(form));
  });
});

describe("options, languages and saved unknown values", () => {
  it("shows a saved value that is not in the known list, after the known ones", () => {
    const opts = optionsWithSaved(TARGET_GROUP_OPTIONS, ["Beginners", "Dân chạy bộ", "Dân chạy bộ"]);
    assert.equal(opts.length, TARGET_GROUP_OPTIONS.length + 1);
    assert.deepEqual(opts[opts.length - 1], { value: "Dân chạy bộ", label: "Dân chạy bộ" });
  });

  it("the fixed language chips are the five agreed ones, and a custom language is detected", () => {
    assert.deepEqual([...LANGUAGE_OPTIONS], ["Tiếng Việt", "English", "中文", "한국어", "日本語"]);
    assert.deepEqual(customLanguages(["Tiếng Việt", "Français"]), ["Français"]);
  });

  it("addCustomLanguage trims, rejects duplicates (any case), >30 chars and the 11th entry", () => {
    assert.deepEqual(addCustomLanguage(["Tiếng Việt"], "  Français "), { languages: ["Tiếng Việt", "Français"], outcome: "added" });
    assert.equal(addCustomLanguage(["English"], "english").outcome, "duplicate");
    assert.equal(addCustomLanguage([], "   ").outcome, "empty");
    assert.equal(addCustomLanguage([], "x".repeat(31)).outcome, "too_long");
    assert.equal(addCustomLanguage(Array.from({ length: 10 }, (_, i) => `L${i}`), "Mới").outcome, "limit");
  });

  it("toggleListValue adds, removes and respects the 10-item cap", () => {
    assert.deepEqual(toggleListValue(["a"], "b"), ["a", "b"]);
    assert.deepEqual(toggleListValue(["a", "b"], "a"), ["b"]);
    const ten = Array.from({ length: 10 }, (_, i) => String(i));
    assert.deepEqual(toggleListValue(ten, "x"), ten);
  });
});

describe("validation (mirror of the server schema)", () => {
  const ok = () => formFromPayload(basePayload());

  it("accepts a clean form", () => {
    assert.equal(validateListingForm(ok()), null);
  });

  it("rejects a bad URL, an over-long bio and > 5 photos", () => {
    const f = ok();
    f.profile.websiteUrl = "example.com";
    assert.match(validateListingForm(f) ?? "", /http/);
    const g = ok();
    g.profile.professionalBio = "x".repeat(2001);
    assert.match(validateListingForm(g) ?? "", /2000/);
    const h = ok();
    h.photoIds = ["1", "2", "3", "4", "5", "6"];
    assert.match(validateListingForm(h, DEFAULT_LIMITS) ?? "", /tối đa 5 ảnh/);
  });

  it("rejects an invalid package and names it", () => {
    const f = ok();
    f.packages[0] = { ...f.packages[0], sessionCount: 0 };
    assert.match(validateListingForm(f) ?? "", /Gói "Gói 10 buổi"/);
  });

  it("an archived package is not validated and does not count against the 10-package cap", () => {
    const f = ok();
    f.packages = Array.from({ length: 11 }, (_, i) => ({ ...f.packages[0], id: `p${i}`, key: `p${i}`, archive: i === 0 ? true : undefined }));
    assert.equal(validateListingForm(f), null);
    f.packages[0] = { ...f.packages[0], archive: undefined };
    assert.match(validateListingForm(f) ?? "", /tối đa 10 gói/);
  });

  it("listingPackageError covers each field", () => {
    const valid = packageFormFrom({ name: "A", description: null, price: 1000, sessionCount: 1, sessionMode: "ONLINE", sessionDurationMinutes: 60, validityDays: null, isActive: true });
    assert.equal(listingPackageError(valid), null);
    assert.match(listingPackageError({ ...valid, name: " " }) ?? "", /Đặt tên/);
    assert.match(listingPackageError({ ...valid, price: "0" }) ?? "", /giá/);
    assert.match(listingPackageError({ ...valid, sessionDurationMinutes: "10" }) ?? "", /15 đến 240/);
    assert.match(listingPackageError({ ...valid, validityDays: "0" }) ?? "", /Hạn dùng/);
    assert.match(listingPackageError({ ...valid, sessionCount: "201" }) ?? "", /1 đến 200/);
  });
});

describe("status view (one status, not seven enums)", () => {
  const rev = (over: any) => ({ id: "r", status: "DRAFT", draftVersion: 1, baseVersion: 1, payload: basePayload(), systemAdjustments: [], ownerNote: null, reviewNote: null, stale: false, source: "OWNER", parentRevisionId: null, submittedAt: null, reviewedAt: null, createdAt: null, updatedAt: null, ...over });

  it("maps the open revision to Đang soạn / Chờ duyệt / Cần chỉnh sửa", () => {
    assert.equal(listingStatusView({ openRevision: rev({}), history: [] }).label, "Đang soạn");
    assert.equal(listingStatusView({ openRevision: rev({ status: "PENDING" }), history: [] }).label, "Chờ duyệt");
    const changes = listingStatusView({ openRevision: rev({ reviewNote: "Bổ sung ảnh" }), history: [] });
    assert.equal(changes.label, "Cần chỉnh sửa");
    assert.equal(changes.adminNote, "Bổ sung ảnh");
  });

  it("maps the last closed revision to Bị từ chối / Đã duyệt, and to nothing when there is no history", () => {
    const h = (status: string) => ({ id: "h", status, reviewNote: "ghi chú", parentRevisionId: null, submittedAt: null, reviewedAt: null, closedAt: null, createdAt: null } as any);
    assert.equal(listingStatusView({ openRevision: null, history: [h("REJECTED")] }).label, "Bị từ chối");
    assert.equal(listingStatusView({ openRevision: null, history: [h("APPROVED")] }).label, "Đã duyệt");
    assert.equal(listingStatusView({ openRevision: null, history: [] }).key, "NONE");
  });

  it("turns the server's system adjustments into sentences, ignoring unknown ones", () => {
    const v = listingStatusView({ openRevision: rev({ systemAdjustments: [{ type: "REBASED_AFTER_ADMIN_EDIT" }, { type: "PHOTO_NO_LONGER_AVAILABLE" }, { type: "SOMETHING_ELSE" }] }), history: [] });
    assert.equal(v.notices.length, 2);
  });

  it("copyableRejected: only a REJECTED last revision closed within 30 days", () => {
    const now = Date.parse("2026-10-22T00:00:00Z");
    const h = (status: string, closedAt: string) => ({ id: "h", status, reviewNote: null, parentRevisionId: null, submittedAt: null, reviewedAt: null, closedAt, createdAt: null } as any);
    assert.equal(copyableRejected([h("REJECTED", "2026-10-10T00:00:00Z")], now)?.id, "h");
    assert.equal(copyableRejected([h("REJECTED", "2026-09-01T00:00:00Z")], now), null);
    assert.equal(copyableRejected([h("APPROVED", "2026-10-10T00:00:00Z")], now), null);
    assert.equal(copyableRejected([], now), null);
  });
});

describe("draft sync (B7: never overwrite another tab's draft silently)", () => {
  const s = (over: any) => ({ formRevisionId: "r1", lastSeenVersion: 2, version: 2, dirty: false, ...over });

  it("clear / reset / none", () => {
    assert.equal(decideDraftSync(s({}), null), "clear");
    assert.equal(decideDraftSync(s({}), { id: "r2", draftVersion: 1 }), "reset");
    assert.equal(decideDraftSync(s({}), { id: "r1", draftVersion: 2 }), "none");
  });

  it("own: the server moved to exactly the version this tab expects", () => {
    assert.equal(decideDraftSync(s({ version: 3, dirty: true }), { id: "r1", draftVersion: 3 }), "own");
  });

  it("conflict only when the server moved by someone else AND there are unsaved edits", () => {
    assert.equal(decideDraftSync(s({ dirty: true }), { id: "r1", draftVersion: 5 }), "conflict");
    assert.equal(decideDraftSync(s({ dirty: false }), { id: "r1", draftVersion: 5 }), "reset");
  });

  it("deleting a photo that is in the SAVED draft bumps the expected version once", () => {
    assert.equal(versionAfterPhotoDelete(2, ["a", "b"], "a"), 3);
    assert.equal(versionAfterPhotoDelete(2, ["a", "b"], "zzz"), 2);
  });
});

describe("wire normalizers and cache keys", () => {
  it("normalizeListing survives a sparse / odd body and keeps the limits default", () => {
    const v = normalizeListing({ listingVersion: "3", published: { payload: {}, packages: [{ id: "p", version: 4, name: "G" }] }, photos: [{ id: "x", url: "/media/pt-physique/x", status: "PUBLISHED", isCover: true }, { nope: 1 }] });
    assert.equal(v.listingVersion, 3);
    assert.equal(v.published.packages[0].version, 4);
    assert.equal(v.photos.length, 1);
    assert.deepEqual(v.limits, DEFAULT_LIMITS);
    assert.equal(v.openRevision, null);
  });

  it("normalizePreview only accepts a body marked isPreview and reads the two 'from' prices", () => {
    assert.equal(normalizePreview({ firstName: "A" }), null);
    const p = normalizePreview({ isPreview: true, firstName: "An", lastName: "Nguyễn", fromPricePerSession: 200000, fromPackagePrice: 0, servicePackages: [{ name: "G", isNew: true }], physiquePhotos: [{ id: "a", url: "/media/pt-physique/a", isCover: true }] });
    assert.equal(p?.name, "An Nguyễn");
    assert.equal(p?.fromPricePerSession, 200000);
    assert.equal(p?.fromPackagePrice, null);
    assert.equal(p?.packages[0].isNew, true);
  });

  it("every cache key that carries the trainer's listing is scoped by user id", () => {
    assert.deepEqual(ptListingKey("u1"), ["pt-listing", "u1"]);
    assert.notDeepEqual(ptListingKey("u1"), ptListingKey("u2"));
    const keys = ptListingInvalidationKeys("u1");
    assert.ok(keys.some((k) => k[0] === "pt-listing" && k[1] === "u1"));
    assert.ok(keys.some((k) => k[0] === "pts-list"));
  });
});
