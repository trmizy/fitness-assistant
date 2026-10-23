/**
 * Listing Management, Phase M1 — the pure half of the PT "Tin đăng" screen.
 *
 * Shapes are the ones user-service really answers (pt-listing.service.ts / pt-listing.schemas.ts /
 * pt-listing-preview.ts), copied by hand into the fixtures below.
 *
 * Runs with: npx tsx --test src/features/__tests__/ptListing.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_LIMITS,
  LISTING_ERROR_VI,
  addPhoto,
  applyPackageForm,
  archivePackageItem,
  buildDraftPayload,
  copyableRejected,
  decideDraftSync,
  formFromPayload,
  formSignature,
  isDraftStale,
  isListingStale,
  isReviewRequired,
  listingErrorInfo,
  listingErrorMessage,
  listingPackageError,
  listingStatusView,
  livePackages,
  movePhoto,
  needsReload,
  normalizeListing,
  normalizePayload,
  normalizePreview,
  packageFormFromItem,
  LANGUAGE_OPTIONS,
  addCustomLanguage,
  payloadSignature,
  photoLimitMessage,
  photoRoom,
  ptListingInvalidationKeys,
  removePhoto,
  restorePackageItem,
  revisionFromResponse,
  setCover,
  staleRevisionOf,
  togglePackageActive,
  validateListingForm,
  versionAfterPhotoDelete,
  type ListingForm,
} from "../ptListing/ptListing";
import { EMPTY_PACKAGE } from "../pt/pt";
import { notificationMeta, notificationRoute } from "../notifications/notifications";
import { queryKeysForEvent } from "../notifications/eventRefresh";
import { pushTapRoute, readPushData } from "../push/pushRouting";

const PHOTO = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;

const payloadRaw = (over: Record<string, unknown> = {}) => ({
  profile: {
    professionalBio: "Huấn luyện viên 6 năm kinh nghiệm",
    mainSpecialties: ["Tăng cơ"],
    trainingMethodsApproach: null,
    targetClientGroups: ["Beginners"],
    primaryTrainingGoals: [],
    languages: ["Tiếng Việt"],
    websiteUrl: null,
    linkedinUrl: null,
  },
  packages: [
    {
      id: "pkg-1",
      name: "Gói 10 buổi",
      description: null,
      price: 2000000,
      sessionCount: 10,
      sessionMode: "OFFLINE",
      sessionDurationMinutes: 60,
      validityDays: 90,
      isActive: true,
    },
  ],
  photoIds: [PHOTO(1), PHOTO(2)],
  coverPhotoId: PHOTO(1),
  ...over,
});

const revisionRaw = (over: Record<string, unknown> = {}) => ({
  id: "rev-1",
  status: "DRAFT",
  source: "OWNER",
  parentRevisionId: null,
  baseVersion: 3,
  draftVersion: 2,
  payload: payloadRaw(),
  systemAdjustments: [],
  ownerNote: null,
  reviewNote: null,
  submittedAt: null,
  reviewedAt: null,
  createdAt: "2026-10-20T00:00:00.000Z",
  updatedAt: "2026-10-20T00:00:00.000Z",
  stale: false,
  ...over,
});

const listingRaw = (over: Record<string, unknown> = {}) => ({
  listingVersion: 3,
  listingPublishedAt: "2026-10-01T00:00:00.000Z",
  published: {
    payload: payloadRaw(),
    // Decimal columns arrive as strings in JSON.
    packages: [{ id: "pkg-1", name: "Gói 10 buổi", description: null, price: "2000000", sessionCount: 10, sessionMode: "OFFLINE", sessionDurationMinutes: 60, validityDays: 90, isActive: true, version: 4 }],
    photos: [{ id: PHOTO(1), url: `/media/pt-physique/${PHOTO(1)}`, isCover: true, sortOrder: 0 }],
  },
  openRevision: null,
  photos: [],
  history: [],
  limits: { maxPhotos: 5, maxPackages: 10, maxStagedPhotos: 15 },
  ...over,
});

const axiosError = (status: number, body: unknown) => ({ response: { status, data: body } });
const listingError = (status: number, code: string, message: string, extra: Record<string, unknown> = {}) =>
  axiosError(status, { success: false, error: { code, message }, message, ...extra });

describe("normalizeListing", () => {
  it("reads the published listing: Decimal prices as numbers, package versions kept", () => {
    const l = normalizeListing(listingRaw());
    assert.equal(l.listingVersion, 3);
    assert.equal(l.published.packages[0].price, 2000000);
    assert.equal(l.published.packages[0].version, 4);
    assert.equal(l.published.photos[0].url, `/media/pt-physique/${PHOTO(1)}`);
    assert.deepEqual(l.limits, DEFAULT_LIMITS);
    assert.equal(l.openRevision, null);
  });

  it("reads the open revision's payload and the server's stale flag", () => {
    const l = normalizeListing(listingRaw({ openRevision: revisionRaw({ stale: true }) }));
    assert.equal(l.openRevision?.draftVersion, 2);
    assert.equal(l.openRevision?.stale, true);
    assert.deepEqual(l.openRevision?.payload.photoIds, [PHOTO(1), PHOTO(2)]);
  });

  it("falls back to the default limits, never to zero", () => {
    assert.equal(normalizeListing(listingRaw({ limits: { maxPhotos: 0 } })).limits.maxPhotos, 5);
    assert.equal(normalizeListing({}).limits.maxPackages, 10);
  });

  it("survives a nearly empty answer", () => {
    const l = normalizeListing({});
    assert.equal(l.published.packages.length, 0);
    assert.equal(l.photos.length, 0);
    assert.equal(l.history.length, 0);
  });
});

describe("listingStatusView — the five states a trainer sees", () => {
  const base = normalizeListing(listingRaw());

  it("no open revision and nothing decided: just the published listing, no badge", () => {
    const v = listingStatusView(base);
    assert.equal(v.key, "NONE");
    assert.equal(v.label, null);
  });

  it("DRAFT → Đang soạn", () => {
    const v = listingStatusView(normalizeListing(listingRaw({ openRevision: revisionRaw() })));
    assert.equal(v.label, "Đang soạn");
    assert.equal(v.adminNote, null);
  });

  it("PENDING → Chờ duyệt", () => {
    const v = listingStatusView(normalizeListing(listingRaw({ openRevision: revisionRaw({ status: "PENDING" }) })));
    assert.equal(v.label, "Chờ duyệt");
    assert.match(v.description, /vẫn thấy tin đăng hiện tại/);
  });

  it("a DRAFT that carries the admin's note → Cần chỉnh sửa, with the note", () => {
    const v = listingStatusView(
      normalizeListing(listingRaw({ openRevision: revisionRaw({ parentRevisionId: "rev-0", reviewNote: "Ảnh số 2 chưa phù hợp" }) })),
    );
    assert.equal(v.key, "CHANGES_REQUESTED");
    assert.equal(v.label, "Cần chỉnh sửa");
    assert.equal(v.adminNote, "Ảnh số 2 chưa phù hợp");
  });

  it("latest closed revision REJECTED, nothing open → Bị từ chối, with the note", () => {
    const v = listingStatusView(
      normalizeListing(listingRaw({ history: [{ id: "rev-9", status: "REJECTED", reviewNote: "Nội dung quảng cáo quá đà", reviewedAt: "2026-10-19T00:00:00.000Z", closedAt: "2026-10-19T00:00:00.000Z" }] })),
    );
    assert.equal(v.label, "Bị từ chối");
    assert.equal(v.adminNote, "Nội dung quảng cáo quá đà");
  });

  it("latest closed revision APPROVED → Đã duyệt", () => {
    const v = listingStatusView(normalizeListing(listingRaw({ history: [{ id: "rev-9", status: "APPROVED", reviewedAt: "2026-10-19T00:00:00.000Z" }] })));
    assert.equal(v.label, "Đã duyệt");
  });

  it("a withdrawn / stale revision is not announced as a decision", () => {
    assert.equal(listingStatusView(normalizeListing(listingRaw({ history: [{ id: "r", status: "WITHDRAWN" }] }))).key, "NONE");
    assert.equal(listingStatusView(normalizeListing(listingRaw({ history: [{ id: "r", status: "STALE" }] }))).key, "NONE");
  });

  it("system adjustments become plain sentences; unknown ones are dropped", () => {
    const v = listingStatusView(
      normalizeListing(
        listingRaw({
          openRevision: revisionRaw({
            systemAdjustments: [
              { type: "REBASED_AFTER_ADMIN_EDIT", fromRevisionId: "x" },
              { type: "PACKAGE_NO_LONGER_AVAILABLE", name: "Gói 5 buổi" },
              { type: "PHOTO_NO_LONGER_AVAILABLE", photoId: PHOTO(2) },
              { type: "SOMETHING_NEW" },
            ],
          }),
        }),
      ),
    );
    assert.equal(v.notices.length, 3);
    assert.match(v.notices[1], /Gói 5 buổi/);
  });

  it("the stale flag follows the open revision", () => {
    assert.equal(listingStatusView(normalizeListing(listingRaw({ openRevision: revisionRaw({ stale: true }) }))).stale, true);
  });
});

describe("copyableRejected", () => {
  const now = Date.parse("2026-10-20T00:00:00.000Z");
  const rejected = (closedAt: string) => [{ id: "r", status: "REJECTED" as const, parentRevisionId: null, reviewNote: "x", submittedAt: null, reviewedAt: closedAt, closedAt, createdAt: closedAt }];

  it("offers 'soạn lại từ bản bị từ chối' within 30 days", () => {
    assert.equal(copyableRejected(rejected("2026-10-10T00:00:00.000Z"), now)?.id, "r");
  });
  it("not after 30 days (the server would answer 409 REVISION_TOO_OLD_TO_COPY), nor for other statuses", () => {
    assert.equal(copyableRejected(rejected("2026-09-01T00:00:00.000Z"), now), null);
    assert.equal(copyableRejected([{ ...rejected("2026-10-19T00:00:00.000Z")[0], status: "APPROVED" as const }], now), null);
    assert.equal(copyableRejected([], now), null);
  });
});

describe("photo helpers", () => {
  it("movePhoto moves one step and never past the ends", () => {
    const ids = ["a", "b", "c"];
    assert.deepEqual(movePhoto(ids, "b", -1), ["b", "a", "c"]);
    assert.deepEqual(movePhoto(ids, "b", 1), ["a", "c", "b"]);
    assert.deepEqual(movePhoto(ids, "a", -1), ids);
    assert.deepEqual(movePhoto(ids, "c", 1), ids);
    assert.deepEqual(movePhoto(ids, "zzz", 1), ids);
    assert.deepEqual(ids, ["a", "b", "c"], "the input is never mutated");
  });

  it("addPhoto accepts up to the limit and REFUSES the 6th instead of dropping it silently", () => {
    let ids: string[] = [];
    let cover: string | null = null;
    for (const id of ["1", "2", "3", "4", "5"]) {
      const r = addPhoto(ids, cover, id, 5);
      assert.equal(r.outcome, "added");
      ids = r.ids;
      cover = r.cover;
    }
    assert.equal(cover, "1", "the first photo becomes the cover");
    const sixth = addPhoto(ids, cover, "6", 5);
    assert.equal(sixth.outcome, "limit");
    assert.deepEqual(sixth.ids, ids);
    assert.equal(addPhoto(ids, cover, "3", 5).outcome, "duplicate");
  });

  it("removePhoto hands the cover to the first remaining photo, and clears it with the last", () => {
    assert.deepEqual(removePhoto(["a", "b", "c"], "a", "a"), { ids: ["b", "c"], cover: "b" });
    assert.deepEqual(removePhoto(["a", "b", "c"], "b", "c"), { ids: ["a", "b"], cover: "b" });
    assert.deepEqual(removePhoto(["a"], "a", "a"), { ids: [], cover: null });
  });

  it("setCover only accepts a photo that is in the list", () => {
    assert.equal(setCover(["a", "b"], "a", "b"), "b");
    assert.equal(setCover(["a", "b"], "a", "zzz"), "a");
  });

  it("photoRoom and the limit sentence", () => {
    assert.equal(photoRoom(3, 5), 2);
    assert.equal(photoRoom(7, 5), 0);
    assert.match(photoLimitMessage(5), /tối đa 5 ảnh/);
  });
});

describe("draft payload ↔ form", () => {
  it("round-trips: a payload read from the server is not 'dirty' until the trainer changes something", () => {
    const payload = normalizePayload(payloadRaw());
    const form = formFromPayload(payload);
    assert.equal(formSignature(form), payloadSignature(payload));
    assert.deepEqual(buildDraftPayload(form), payload);
  });

  it("builds the exact body the server's strict schema accepts: trimmed, empty → null, deduped", () => {
    const form = formFromPayload(normalizePayload(payloadRaw()));
    form.profile.professionalBio = "  Xin chào  ";
    form.profile.trainingMethodsApproach = "   ";
    form.profile.websiteUrl = "";
    form.profile.languages = ["Tiếng Việt", "English", "tiếng việt", " English ", ""];
    form.profile.mainSpecialties = ["Yoga", "Yoga", " "];
    const body = buildDraftPayload(form);
    assert.equal(body.profile.professionalBio, "Xin chào");
    assert.equal(body.profile.trainingMethodsApproach, null);
    assert.equal(body.profile.websiteUrl, null);
    assert.deepEqual(body.profile.languages, ["Tiếng Việt", "English", "tiếng việt"]);
    assert.deepEqual(body.profile.mainSpecialties, ["Yoga"]);
    assert.deepEqual(Object.keys(body).sort(), ["coverPhotoId", "packages", "photoIds", "profile"]);
    assert.deepEqual(Object.keys(body.profile).sort(), [
      "languages",
      "linkedinUrl",
      "mainSpecialties",
      "primaryTrainingGoals",
      "professionalBio",
      "targetClientGroups",
      "trainingMethodsApproach",
      "websiteUrl",
    ]);
  });

  it("never sends the client-side key, and sends `archive` only when true", () => {
    const form = formFromPayload(normalizePayload(payloadRaw()));
    form.packages = archivePackageItem(form.packages, form.packages[0].key);
    const [pkg] = buildDraftPayload(form).packages;
    assert.equal("key" in pkg, false);
    assert.equal(pkg.archive, true);
    assert.equal(pkg.id, "pkg-1");
    const restored = buildDraftPayload({ ...form, packages: restorePackageItem(form.packages, form.packages[0].key) }).packages[0];
    assert.equal("archive" in restored, false);
  });

  it("the cover follows the server's rule: a photo of the list, the first one by default, null with no photo", () => {
    const form = formFromPayload(normalizePayload(payloadRaw()));
    assert.equal(buildDraftPayload({ ...form, coverPhotoId: PHOTO(2) }).coverPhotoId, PHOTO(2));
    assert.equal(buildDraftPayload({ ...form, coverPhotoId: "gone" }).coverPhotoId, PHOTO(1));
    assert.equal(buildDraftPayload({ ...form, coverPhotoId: null }).coverPhotoId, PHOTO(1));
    assert.equal(buildDraftPayload({ ...form, photoIds: [], coverPhotoId: PHOTO(1) }).coverPhotoId, null);
  });

  it("reordering photos is a change; a duplicate id is dropped from the body", () => {
    const form = formFromPayload(normalizePayload(payloadRaw()));
    const moved: ListingForm = { ...form, photoIds: movePhoto(form.photoIds, PHOTO(2), -1) };
    assert.notEqual(formSignature(moved), formSignature(form));
    assert.deepEqual(buildDraftPayload({ ...form, photoIds: [PHOTO(1), PHOTO(1), PHOTO(2)] }).photoIds, [PHOTO(1), PHOTO(2)]);
  });

  it("the language chips are the fixed five; a custom one is added through 'Khác'", () => {
    assert.deepEqual([...LANGUAGE_OPTIONS], ["Tiếng Việt", "English", "中文", "한국어", "日本語"]);
    assert.deepEqual(addCustomLanguage(["English"], "  Français "), { languages: ["English", "Français"], outcome: "added" });
    assert.equal(addCustomLanguage(["English"], "english").outcome, "duplicate");
    assert.equal(addCustomLanguage(["English"], "   ").outcome, "empty");
    assert.equal(addCustomLanguage([], "x".repeat(31)).outcome, "too_long");
    assert.equal(addCustomLanguage(Array.from({ length: 10 }, (_, i) => `l${i}`), "Thêm").outcome, "limit");
  });

  it("a saved language outside the fixed list survives the round trip", () => {
    const p = normalizePayload(payloadRaw({ profile: { ...payloadRaw().profile, languages: ["Tiếng Việt", "Français"] } }));
    assert.deepEqual(buildDraftPayload(formFromPayload(p)).profile.languages, ["Tiếng Việt", "Français"]);
  });
});

describe("packages inside the draft", () => {
  it("archiving an EXISTING package marks it (so it can be undone); a NEW one just disappears", () => {
    const form = formFromPayload(normalizePayload(payloadRaw()));
    const fresh = applyPackageForm({ ...EMPTY_PACKAGE, name: "Gói mới", price: "500000" }, undefined, "new-1");
    const items = [...form.packages, fresh];
    const next = archivePackageItem(items, "new-1");
    assert.equal(next.length, 1);
    const marked = archivePackageItem(next, next[0].key);
    assert.equal(marked[0].archive, true);
    assert.equal(livePackages(marked).length, 0);
  });

  it("toggle flips only isActive", () => {
    const items = formFromPayload(normalizePayload(payloadRaw())).packages;
    const toggled = togglePackageActive(items, items[0].key);
    assert.equal(toggled[0].isActive, false);
    assert.equal(toggled[0].price, items[0].price);
  });

  it("editing keeps the package id (the server edits that package, it does not add one)", () => {
    const [item] = formFromPayload(normalizePayload(payloadRaw())).packages;
    const form = { ...packageFormFromItem(item), price: "2500000" };
    const edited = applyPackageForm(form, item);
    assert.equal(edited.id, "pkg-1");
    assert.equal(edited.price, 2500000);
    assert.equal(edited.isActive, true);
  });

  it("a new package gets no id", () => {
    const created = applyPackageForm({ ...EMPTY_PACKAGE, name: "Gói thử", price: "300000", sessionCount: "1" }, undefined, "new-9");
    assert.equal("id" in created, false);
    assert.equal(created.sessionMode, "OFFLINE");
    assert.equal(created.validityDays, null);
  });

  it("package limits follow pt-listing.schemas.ts", () => {
    const ok = { ...EMPTY_PACKAGE, name: "Gói", price: "100000" };
    assert.equal(listingPackageError(ok), null);
    assert.match(listingPackageError({ ...ok, name: " " })!, /tên/i);
    assert.match(listingPackageError({ ...ok, name: "x".repeat(81) })!, /80/);
    assert.match(listingPackageError({ ...ok, sessionCount: "201" })!, /1 đến 200/);
    assert.match(listingPackageError({ ...ok, sessionDurationMinutes: "10" })!, /15 đến 240/);
    assert.match(listingPackageError({ ...ok, sessionDurationMinutes: "241" })!, /15 đến 240/);
    assert.match(listingPackageError({ ...ok, price: "0" })!, /lớn hơn 0/);
    assert.match(listingPackageError({ ...ok, price: "1000000001" })!, /1\.000\.000\.000/);
    assert.match(listingPackageError({ ...ok, validityDays: "3651" })!, /3650/);
    assert.equal(listingPackageError({ ...ok, validityDays: "" }), null);
  });
});

describe("validateListingForm", () => {
  const good = () => formFromPayload(normalizePayload(payloadRaw()));

  it("accepts a normal draft", () => {
    assert.equal(validateListingForm(good()), null);
  });

  it("refuses over-long text, bad URLs and too many items — the same limits as the server", () => {
    const f = good();
    assert.match(validateListingForm({ ...f, profile: { ...f.profile, professionalBio: "x".repeat(2001) } })!, /2000/);
    assert.match(validateListingForm({ ...f, profile: { ...f.profile, websiteUrl: "example.com" } })!, /http/);
    assert.match(validateListingForm({ ...f, profile: { ...f.profile, linkedinUrl: "ftp://x" } })!, /http/);
    assert.equal(validateListingForm({ ...f, profile: { ...f.profile, websiteUrl: "https://gymini.vn/pt" } }), null);
    assert.match(validateListingForm({ ...f, profile: { ...f.profile, mainSpecialties: Array.from({ length: 11 }, (_, i) => `s${i}`) } })!, /tối đa 10/);
    assert.match(validateListingForm({ ...f, profile: { ...f.profile, languages: ["x".repeat(31)] } })!, /30/);
  });

  it("refuses a 6th photo and an 11th live package (an archived one does not count)", () => {
    const f = good();
    assert.match(validateListingForm({ ...f, photoIds: ["1", "2", "3", "4", "5", "6"] })!, /tối đa 5 ảnh/);
    const pkg = f.packages[0];
    const eleven = Array.from({ length: 11 }, (_, i) => ({ ...pkg, id: undefined, key: `n${i}`, name: `Gói ${i}` }));
    assert.match(validateListingForm({ ...f, packages: eleven })!, /tối đa 10 gói/);
    const tenPlusArchived = [...eleven.slice(0, 10), { ...eleven[10], archive: true as const }];
    assert.equal(validateListingForm({ ...f, packages: tenPlusArchived }), null);
  });

  it("names the package whose field is wrong", () => {
    const f = good();
    const bad = { ...f, packages: [{ ...f.packages[0], price: 0 }] };
    assert.match(validateListingForm(bad)!, /Gói 10 buổi/);
  });
});

describe("errors → Vietnamese", () => {
  it("every code the PT listing routes can answer has a sentence", () => {
    for (const code of [
      "VALIDATION_FAILED", "NOT_A_PT", "PT_NOT_APPROVED", "OPEN_REVISION_EXISTS", "REVISION_CLOSED", "REVISION_UNDER_REVIEW",
      "REVISION_NOT_PENDING", "REVISION_CONFLICT", "REVISION_NOT_FOUND", "REVISION_NOT_CLOSED", "REVISION_TOO_OLD_TO_COPY",
      "NO_OPEN_REVISION", "NO_CHANGES", "DRAFT_STALE", "LISTING_STALE", "PHOTO_LIMIT", "PHOTO_DUPLICATE", "PHOTO_NOT_OWNED",
      "PHOTO_NOT_FOUND", "PHOTO_PUBLISHED", "PHOTO_IN_REVIEW", "COVER_NOT_IN_PHOTOS", "PACKAGE_LIMIT", "PACKAGE_DUPLICATE",
      "PACKAGE_NOT_OWNED", "UPLOADS_UNAVAILABLE", "STAGED_LIMIT", "TOO_MANY_UPLOADS", "UPLOAD_NOT_FOUND", "INTENT_EXPIRED",
      "INTENT_ALREADY_USED", "UPLOAD_CONFLICT", "IMAGE_MISSING", "IMAGE_TOO_LARGE", "IMAGE_INVALID", "LISTING_REVIEW_REQUIRED",
      "PACKAGE_CHANGED",
    ]) {
      assert.ok(LISTING_ERROR_VI[code], code);
      assert.match(LISTING_ERROR_VI[code], /[ăâđêôơưàáạảãèéẹẻẽìíịỉĩòóọỏõùúụủũỳýỵỷỹ]/i, `${code} is Vietnamese`);
    }
  });

  it("maps by code first, ignoring whatever English the server sent", () => {
    assert.equal(listingErrorMessage(listingError(409, "DRAFT_STALE", "english")), LISTING_ERROR_VI.DRAFT_STALE);
    assert.equal(listingErrorMessage(listingError(422, "PHOTO_LIMIT", "x")), LISTING_ERROR_VI.PHOTO_LIMIT);
    assert.equal(listingErrorMessage(listingError(409, "LISTING_REVIEW_REQUIRED", "x")), LISTING_ERROR_VI.LISTING_REVIEW_REQUIRED);
  });

  it("reads the code from the legacy flat body too (`code` beside `error`)", () => {
    assert.equal(listingErrorInfo(axiosError(409, { code: "PACKAGE_CHANGED", error: "msg" })).code, "PACKAGE_CHANGED");
    assert.equal(listingErrorInfo(axiosError(409, { error: { code: "LISTING_REVIEW_REQUIRED" } })).code, "LISTING_REVIEW_REQUIRED");
  });

  it("without a known code: HTTP class, then the server's own Vietnamese sentence, then the fallback", () => {
    assert.match(listingErrorMessage(axiosError(401, {})), /đăng nhập lại/);
    assert.match(listingErrorMessage(axiosError(403, {})), /không có quyền/);
    assert.match(listingErrorMessage(axiosError(429, {})), /quá nhanh/);
    assert.match(listingErrorMessage(axiosError(503, {})), /bận/);
    assert.equal(listingErrorMessage(axiosError(400, { message: "Dữ liệu không hợp lệ (profile): sai định dạng" })), "Dữ liệu không hợp lệ (profile): sai định dạng");
    assert.equal(listingErrorMessage(axiosError(500, { message: "Internal error" }), "Lỗi tạm thời"), "Lỗi tạm thời");
    assert.match(listingErrorMessage(new Error("Network Error")), /kết nối/);
  });

  it("unwraps the upload error: a presign/confirm refusal keeps its server code", () => {
    const wrapped = Object.assign(new Error("Chưa xin được quyền tải ảnh."), { step: "presign", original: listingError(422, "STAGED_LIMIT", "x") });
    assert.equal(listingErrorMessage(wrapped), LISTING_ERROR_VI.STAGED_LIMIT);
    const network = Object.assign(new Error("Không gửi được ảnh lên — kiểm tra kết nối rồi thử lại."), { step: "upload" });
    assert.match(listingErrorMessage(network), /kiểm tra kết nối/);
  });

  it("classifies the two stale 409s and carries the server's current draft", () => {
    const stale = listingError(409, "DRAFT_STALE", "x", { revision: revisionRaw({ draftVersion: 7 }), listingVersion: 3 });
    assert.equal(isDraftStale(stale), true);
    assert.equal(isListingStale(stale), false);
    assert.equal(staleRevisionOf(stale)?.draftVersion, 7);
    assert.equal(isListingStale(listingError(409, "LISTING_STALE", "x")), true);
    assert.equal(staleRevisionOf(listingError(409, "LISTING_STALE", "x", { revision: null })), null);
  });

  it("knows which 409s just mean 'read it again'", () => {
    for (const code of ["OPEN_REVISION_EXISTS", "REVISION_CLOSED", "REVISION_UNDER_REVIEW", "REVISION_NOT_PENDING", "REVISION_CONFLICT", "NO_OPEN_REVISION"]) {
      assert.equal(needsReload(listingError(409, code, "x")), true, code);
    }
    assert.equal(needsReload(listingError(409, "DRAFT_STALE", "x")), false);
    assert.equal(needsReload(listingError(422, "PHOTO_LIMIT", "x")), false);
  });

  it("recognises the old package write routes' 409", () => {
    assert.equal(isReviewRequired(axiosError(409, { success: false, error: { code: "LISTING_REVIEW_REQUIRED", message: "x" }, message: "x" })), true);
    assert.equal(isReviewRequired(axiosError(409, { error: "other" })), false);
  });

  it("revisionFromResponse reads { revision } and nothing else", () => {
    assert.equal(revisionFromResponse({ revision: revisionRaw() })?.id, "rev-1");
    assert.equal(revisionFromResponse({ withdrawnRevisionId: "x" }), null);
    assert.equal(revisionFromResponse(undefined), null);
  });
});

describe("keeping the editor in step with the server (B7)", () => {
  const rev = { id: "r1", draftVersion: 3 };
  const state = (over = {}) => ({ formRevisionId: "r1", lastSeenVersion: 3, version: 3, dirty: false, ...over });

  it("no open DRAFT → drop the form", () => {
    assert.equal(decideDraftSync(state(), null), "clear");
  });
  it("a different revision, or no form yet → rebuild", () => {
    assert.equal(decideDraftSync(state({ formRevisionId: null }), rev), "reset");
    assert.equal(decideDraftSync(state({ formRevisionId: "other" }), rev), "reset");
  });
  it("nothing moved → nothing to do", () => {
    assert.equal(decideDraftSync(state(), rev), "none");
  });
  it("the server moved to exactly the version this phone caused (own save / own photo delete) → only refresh the baseline", () => {
    assert.equal(decideDraftSync(state({ lastSeenVersion: 2, version: 3, dirty: true }), rev), "own");
  });
  it("the server moved elsewhere: silent rebuild when the trainer has no edits, a question when they do", () => {
    assert.equal(decideDraftSync(state({ lastSeenVersion: 2, version: 2, dirty: false }), rev), "reset");
    assert.equal(decideDraftSync(state({ lastSeenVersion: 2, version: 2, dirty: true }), rev), "conflict");
  });
  it("deleting a photo bumps the version only when that photo is in the SAVED draft", () => {
    assert.equal(versionAfterPhotoDelete(4, [PHOTO(1), PHOTO(2)], PHOTO(2)), 5);
    assert.equal(versionAfterPhotoDelete(4, [PHOTO(1)], PHOTO(2)), 4);
  });
});

describe("caches", () => {
  it("a listing decision reaches the trainer's own screen AND every public read of this trainer", () => {
    const keys = ptListingInvalidationKeys("pt-1");
    const flat = keys.map((k) => JSON.stringify(k));
    for (const expected of [
      '["pt-listing","pt-1"]',
      '["pt-listing-preview","pt-1"]',
      '["pts-list"]',
      '["pts-list-pages"]',
      '["pt-detail","pt-1"]',
      '["pt-packages","pt-1"]',
      '["pt-service-packages","pt-1"]',
      '["pt-public-profile","pt-1"]',
    ]) {
      assert.ok(flat.includes(expected), expected);
    }
  });
  it("own keys carry the user id, so an account switch can never read the previous user's draft", () => {
    assert.notDeepEqual(ptListingInvalidationKeys("a")[0], ptListingInvalidationKeys("b")[0]);
  });
});

describe("preview", () => {
  const raw = {
    isPreview: true,
    viewer: "OWNER",
    revisionId: "rev-1",
    revisionStatus: "DRAFT",
    firstName: "Nguyễn",
    lastName: "Huy",
    specialties: ["Tăng cơ"],
    ptApplication: { ...payloadRaw().profile, fromPricePerSession: 200000, fromPackagePrice: 2000000 },
    servicePackages: [
      { id: "pkg-1", name: "Gói 10", price: 2000000, sessionCount: 10, sessionMode: "OFFLINE", sessionDurationMinutes: 60, validityDays: null, isActive: true, isNew: false },
      { name: "Gói mới", price: 300000, sessionCount: 1, sessionMode: "ONLINE", sessionDurationMinutes: 45, validityDays: null, isActive: true, isNew: true },
    ],
    fromPricePerSession: 200000,
    fromPackagePrice: 300000,
    physiquePhotos: [{ id: PHOTO(1), url: "https://s3.example/x?sig=1", expiresAt: "2026-10-20T01:00:00.000Z", isCover: true, sortOrder: 0, status: "STAGED" }],
    coverPhotoUrl: "https://s3.example/x?sig=1",
    photoUrlsExpireAt: "2026-10-20T01:00:00.000Z",
  };

  it("reads the server's preview DTO", () => {
    const v = normalizePreview(raw)!;
    assert.equal(v.name, "Nguyễn Huy");
    assert.equal(v.fromPricePerSession, 200000);
    assert.equal(v.fromPackagePrice, 300000);
    assert.equal(v.packages.length, 2);
    assert.equal(v.packages[1].isNew, true);
    assert.equal(v.photos[0].isCover, true);
    assert.equal(v.photoUrlsExpireAt, "2026-10-20T01:00:00.000Z");
  });

  it("refuses anything that is not flagged as a preview — a public DTO must never render as one", () => {
    assert.equal(normalizePreview({ ...raw, isPreview: undefined }), null);
    assert.equal(normalizePreview(null), null);
  });
});

describe("notifications for the PT listing (M1)", () => {
  const types = ["PT_LISTING_APPROVED", "PT_LISTING_REJECTED", "PT_LISTING_CHANGES_REQUESTED", "PT_LISTING_INVALIDATED"];

  it("each of the four has its own title, not the generic 'Thông báo'", () => {
    const titles = types.map((t) => notificationMeta(t).title);
    for (const title of titles) assert.notEqual(title, "Thông báo");
    assert.equal(new Set(titles).size, 4);
    assert.equal(notificationMeta("PT_LISTING_REJECTED").tone, "danger");
    assert.equal(notificationMeta("PT_LISTING_CHANGES_REQUESTED").tone, "warning");
  });

  it("opens /pt/listing — by the link the server sends, or by the entity type", () => {
    assert.equal(notificationRoute({ link: "/pt/listing", entityType: "PT_LISTING" }), "/pt/listing");
    assert.equal(notificationRoute({ link: null, entityType: "PT_LISTING" }), "/pt/listing");
  });

  it("a tapped push opens it for the PT it was written for, and for nobody else", () => {
    const push = readPushData({ notificationId: "n", userId: "u1", link: "/pt/listing", entityType: "PT_LISTING", eventType: "PT_LISTING_APPROVED" });
    assert.equal(pushTapRoute(push, "u1", "pt"), "/pt/listing");
    assert.equal(pushTapRoute(push, "u2", "pt"), null, "another account on the same phone");
    assert.equal(pushTapRoute(push, "u1", "client"), "/client/notifications");
  });

  it("a decision refreshes the trainer's screen and every public read of the trainer", () => {
    for (const type of types) {
      const keys = queryKeysForEvent(type, "PT_LISTING").map((k) => k[0]);
      for (const name of ["notifications", "pt-listing", "pt-listing-preview", "pts-list", "pts-list-pages", "pt-detail", "pt-packages", "pt-service-packages", "pt-public-profile"]) {
        assert.ok(keys.includes(name), `${type}: ${name}`);
      }
    }
  });
});
