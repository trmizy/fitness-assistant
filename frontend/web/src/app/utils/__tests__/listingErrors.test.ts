/**
 * Listing Management D1 - error-code → Vietnamese map and the 409 readers (PT page, admin page, contract request).
 * Run: npx tsx --test src/app/utils/__tests__/listingErrors.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ADMIN_REFETCH_CODES,
  LISTING_ERROR_VI,
  adminNeedsRefetch,
  errorCodeOf,
  isDraftStale,
  isListingStale,
  isPtGone,
  isReviewRequired,
  listingErrorInfo,
  listingErrorMessage,
  needsReload,
  readAmenityExistsDisabled,
  readApproveBlock,
  readPackageChanged,
  staleRevisionOf,
} from "../listingErrors";

/** The shape both services send: { success:false, error:{ code, message }, message, ...extra }. */
const listingErr = (status: number, code: string, extra: Record<string, unknown> = {}) => ({
  response: { status, data: { success: false, error: { code, message: "máy chủ nói" }, message: "máy chủ nói", ...extra } },
});
/** The contract route's own shape: { code, error: "<message>" }. */
const contractErr = (status: number, code: string, extra: Record<string, unknown> = {}) => ({ response: { status, data: { code, error: "Gói dịch vụ đã thay đổi.", ...extra } } });

describe("listingErrorInfo", () => {
  it("reads code and message from both body shapes, and never throws", () => {
    assert.equal(listingErrorInfo(listingErr(409, "DRAFT_STALE")).code, "DRAFT_STALE");
    assert.equal(listingErrorInfo(contractErr(409, "PACKAGE_CHANGED")).code, "PACKAGE_CHANGED");
    assert.equal(listingErrorInfo(contractErr(409, "PACKAGE_CHANGED")).serverMessage, "Gói dịch vụ đã thay đổi.");
    assert.deepEqual(listingErrorInfo(undefined), { status: null, code: null, serverMessage: null, body: undefined });
    assert.equal(listingErrorInfo(new Error("x")).status, null);
  });
});

describe("listingErrorMessage - the codes the task calls out", () => {
  const codes = [
    "REVISION_NOT_PENDING",
    "ALREADY_DECIDED",
    "LISTING_STALE",
    "DRAFT_STALE",
    "PROPOSAL_ALREADY_DECIDED",
    "AMENITY_EXISTS_DISABLED",
    "CUSTOM_AMENITY_PENDING",
    "AMENITY_DISABLED",
    "PACKAGE_CHANGED",
    "PHOTO_NOT_PUBLISHED",
    "LISTING_REVIEW_REQUIRED",
    "REVISION_TOO_OLD_TO_COPY",
  ];
  for (const code of codes) {
    it(`${code} has a Vietnamese sentence (not the raw server text, not the English fallback)`, () => {
      const msg = listingErrorMessage(listingErr(409, code));
      assert.equal(msg, LISTING_ERROR_VI[code]);
      assert.notEqual(msg, "máy chủ nói");
      assert.match(msg, /[ăâđêôơưàáạảãèéẹẻẽìíịỉĩòóọỏõùúụủũỳýỵỷỹ]/i);
    });
  }

  it("every mapped message is Vietnamese text (has a Vietnamese letter or is a short Vietnamese phrase)", () => {
    for (const [code, msg] of Object.entries(LISTING_ERROR_VI)) {
      assert.ok(msg.length > 10, code);
      assert.doesNotMatch(msg, /\b(error|failed|invalid|not found)\b/i, code);
    }
  });

  it("falls back by HTTP status, then to the server sentence only when it is Vietnamese", () => {
    assert.match(listingErrorMessage({ response: { status: 403, data: {} } }), /không có quyền/);
    assert.match(listingErrorMessage({ response: { status: 404, data: {} } }), /Không tìm thấy/);
    assert.match(listingErrorMessage({ response: { status: 429, data: {} } }), /quá nhanh/);
    assert.match(listingErrorMessage({ response: { status: 500, data: { message: "Lỗi hệ thống" } } }), /Lỗi hệ thống/);
    assert.equal(listingErrorMessage({ response: { status: 500, data: { message: "boom" } } }, "Thử lại sau"), "Thử lại sau");
    assert.match(listingErrorMessage(new Error("Network Error")), /Không kết nối được máy chủ/);
  });
});

describe("409 readers", () => {
  it("isDraftStale / isListingStale / isReviewRequired match their own code only", () => {
    assert.equal(isDraftStale(listingErr(409, "DRAFT_STALE")), true);
    assert.equal(isDraftStale(listingErr(409, "LISTING_STALE")), false);
    assert.equal(isListingStale(listingErr(409, "LISTING_STALE")), true);
    assert.equal(isReviewRequired(listingErr(409, "LISTING_REVIEW_REQUIRED")), true);
    assert.equal(errorCodeOf(null), null);
  });

  it("needsReload covers the owner-side moves of the revision", () => {
    for (const c of ["OPEN_REVISION_EXISTS", "REVISION_CLOSED", "REVISION_UNDER_REVIEW", "REVISION_NOT_PENDING", "REVISION_CONFLICT", "NO_OPEN_REVISION"]) {
      assert.equal(needsReload(listingErr(409, c)), true, c);
    }
    assert.equal(needsReload(listingErr(409, "DRAFT_STALE")), false);
  });

  it("adminNeedsRefetch: every 409 that makes the on-screen queue/detail wrong", () => {
    for (const c of ADMIN_REFETCH_CODES) assert.equal(adminNeedsRefetch(listingErr(409, c)), true, c);
    assert.equal(adminNeedsRefetch(listingErr(409, "REVISION_NOT_PENDING")), true);
    assert.equal(adminNeedsRefetch(listingErr(409, "LISTING_STALE")), true);
    assert.equal(adminNeedsRefetch(listingErr(409, "PROPOSAL_ALREADY_DECIDED")), true);
    assert.equal(adminNeedsRefetch(listingErr(422, "NO_CHANGES")), false);
  });

  it("readAmenityExistsDisabled returns the catalogue row so the 'Bật lại và gộp' option can name it", () => {
    const e = listingErr(409, "AMENITY_EXISTS_DISABLED", { amenity: { id: "am1", name: "Phòng boxing", status: "DISABLED" } });
    assert.deepEqual(readAmenityExistsDisabled(e), { id: "am1", name: "Phòng boxing" });
    assert.equal(readAmenityExistsDisabled(listingErr(409, "PROPOSAL_ALREADY_DECIDED")), null);
    assert.equal(readAmenityExistsDisabled(listingErr(422, "AMENITY_EXISTS_DISABLED")), null);
  });

  it("readApproveBlock recognises the three gym approve refusals (checkbox / link instead of retry)", () => {
    assert.equal(readApproveBlock(listingErr(409, "CUSTOM_AMENITY_PENDING")), "CUSTOM_AMENITY_PENDING");
    assert.equal(readApproveBlock(listingErr(409, "AMENITY_DISABLED")), "AMENITY_DISABLED");
    assert.equal(readApproveBlock(listingErr(409, "AMENITY_PROPOSAL_DEAD")), "AMENITY_PROPOSAL_DEAD");
    assert.equal(readApproveBlock(listingErr(409, "ALREADY_DECIDED")), null);
  });
});

describe("409 bodies that carry the current draft", () => {
  it("staleRevisionOf reads the server's current draft out of DRAFT_STALE / LISTING_STALE", () => {
    const e = listingErr(409, "DRAFT_STALE", { revision: { id: "r1", status: "DRAFT", draftVersion: 7, baseVersion: 2, payload: {}, stale: true } });
    const rev = staleRevisionOf(e);
    assert.equal(rev?.id, "r1");
    assert.equal(rev?.draftVersion, 7);
    assert.equal(rev?.stale, true);
    assert.equal(staleRevisionOf(listingErr(409, "DRAFT_STALE", { revision: null })), null);
    assert.equal(staleRevisionOf(new Error("x")), null);
  });
});

describe("client contract request", () => {
  it("readPackageChanged: 409 PACKAGE_CHANGED carries the package as it is now; a body without one still means 'changed'", () => {
    const withPkg = readPackageChanged(contractErr(409, "PACKAGE_CHANGED", { package: { id: "p1", version: 2, price: "2500000" } }));
    assert.equal(withPkg?.current?.version, 2);
    assert.deepEqual(readPackageChanged(contractErr(409, "PACKAGE_CHANGED")), { current: null });
    assert.equal(readPackageChanged(contractErr(409, "LOW_AVAILABILITY")), null);
    assert.equal(readPackageChanged(contractErr(400, "PACKAGE_CHANGED")), null);
    assert.equal(readPackageChanged(undefined), null);
  });

  it("isPtGone is exactly a 404", () => {
    assert.equal(isPtGone({ response: { status: 404 } }), true);
    assert.equal(isPtGone({ response: { status: 500 } }), false);
    assert.equal(isPtGone(new Error("x")), false);
  });
});
