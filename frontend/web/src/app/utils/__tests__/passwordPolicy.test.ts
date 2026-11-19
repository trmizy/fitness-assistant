/**
 * CODE/UNIT - N-A-07 / ND-05 web helpers. Run: npx tsx --test src/app/utils/__tests__/passwordPolicy.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isPasswordPolicyMet, passwordPolicyError, PASSWORD_POLICY_HINT } from "../passwordPolicy";
import { licenseLabelVi, licenseSummaryVi } from "../catalogLicense";

describe("passwordPolicy", () => {
  it("rejects what auth-service rejects", () => {
    for (const pw of ["alllowercase1", "ALLUPPERCASE1", "NoDigitsHere", "Sh0rt", "12345678", ""]) {
      assert.equal(isPasswordPolicyMet(pw), false, pw);
      assert.match(passwordPolicyError(pw) ?? "", /^Mật khẩu cần có ít nhất 8 ký tự/);
    }
  });
  it("accepts a strong password", () => {
    assert.equal(isPasswordPolicyMet("GoodPass123"), true);
    assert.equal(passwordPolicyError("GoodPass123"), null);
  });
  it("hint names every requirement", () => {
    assert.match(PASSWORD_POLICY_HINT, /8 ký tự.*chữ hoa.*chữ thường.*chữ số/);
  });
});

describe("catalogLicense (ND-05)", () => {
  it("never prints the raw importer codes", () => {
    assert.equal(licenseLabelVi("UNDOCUMENTED_DO_NOT_RELY_ON"), "chưa xác định giấy phép");
    assert.doesNotMatch(licenseSummaryVi("Unlicense", "UNDOCUMENTED_DO_NOT_RELY_ON"), /UNDOCUMENTED|DO_NOT/);
    assert.equal(licenseLabelVi("some_new_code"), "chưa rõ");
  });
  it("keeps real licence names and the empty-media sentence", () => {
    assert.equal(licenseLabelVi("CC0"), "CC0");
    assert.equal(licenseLabelVi("CC-BY-4.0"), "CC-BY-4.0");
    assert.equal(licenseSummaryVi("CC0", null), "CC0 / chưa có giấy phép hình/video");
    assert.equal(licenseSummaryVi(null, null), "— / chưa có giấy phép hình/video");
  });
});
