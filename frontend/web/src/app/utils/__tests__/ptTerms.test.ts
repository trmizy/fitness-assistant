/**
 * D25 - PT terms view-model (pure logic, node:test like the sibling tests).
 * Run: npx tsx --test src/app/utils/__tests__/ptTerms.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isPtTermsRefusal, isPtTermsVersionStale, ptTermsBannerState } from "../ptTerms";

const axiosErr = (status: number, code?: string) => ({ response: { status, data: { code } } });

describe("isPtTermsRefusal", () => {
  it("recognises the 409 PT_TERMS_NOT_ACCEPTED answer only", () => {
    assert.equal(isPtTermsRefusal(axiosErr(409, "PT_TERMS_NOT_ACCEPTED")), true);
    assert.equal(isPtTermsRefusal(axiosErr(409, "PT_TEMPORARILY_UNAVAILABLE")), false);
    assert.equal(isPtTermsRefusal(axiosErr(400, "PT_TERMS_NOT_ACCEPTED")), false);
    assert.equal(isPtTermsRefusal(new Error("boom")), false);
    assert.equal(isPtTermsRefusal(undefined), false);
  });
});

describe("isPtTermsVersionStale", () => {
  it("recognises a stale confirmation", () => {
    assert.equal(isPtTermsVersionStale(axiosErr(409, "PT_TERMS_VERSION_MISMATCH")), true);
    assert.equal(isPtTermsVersionStale(axiosErr(409, "PT_TERMS_NOT_ACCEPTED")), false);
  });
});

describe("ptTermsBannerState", () => {
  it("is hidden for a new applicant, a PT who confirmed, and while the terms are loading", () => {
    assert.deepEqual(ptTermsBannerState(undefined), { show: false });
    assert.deepEqual(ptTermsBannerState(null), { show: false });
    assert.deepEqual(ptTermsBannerState({ mustReconfirm: false, previouslyAcceptedVersion: null }), { show: false });
  });
  it("asks an existing PT who never confirmed to confirm", () => {
    const s = ptTermsBannerState({ mustReconfirm: true, previouslyAcceptedVersion: null });
    assert.equal(s.show && s.kind, "confirm");
  });
  it("tells a PT who confirmed an older text that the terms were updated", () => {
    const s = ptTermsBannerState({ mustReconfirm: true, previouslyAcceptedVersion: "2026-01-pt-v0" });
    assert.equal(s.show && s.kind, "updated");
    assert.ok(s.show && /cập nhật/.test(s.title));
  });
  it("never shows an internal code or version string to the user", () => {
    const s = ptTermsBannerState({ mustReconfirm: true, previouslyAcceptedVersion: "2026-01-pt-v0" });
    assert.ok(s.show);
    if (s.show) assert.doesNotMatch(JSON.stringify(s), /2026|PT_TERMS|v0/);
  });
});
