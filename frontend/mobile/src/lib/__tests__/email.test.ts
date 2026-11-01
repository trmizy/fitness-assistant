import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { emailInputProps, normalizeEmail } from "../email";

describe("normalizeEmail", () => {
  it("trims and lowercases", () => {
    assert.equal(normalizeEmail("  Khach.Hang@Gmail.COM \n"), "khach.hang@gmail.com");
  });
  it("leaves an already clean address alone", () => {
    assert.equal(normalizeEmail("a@b.vn"), "a@b.vn");
  });
  it("is safe on empty / missing values", () => {
    assert.equal(normalizeEmail(""), "");
    assert.equal(normalizeEmail(null), "");
    assert.equal(normalizeEmail(undefined), "");
  });
});

describe("emailInputProps", () => {
  it("asks the keyboard for an email layout with no auto-capital / auto-correct", () => {
    assert.equal(emailInputProps.keyboardType, "email-address");
    assert.equal(emailInputProps.autoCapitalize, "none");
    assert.equal(emailInputProps.autoCorrect, false);
  });
});

import { gymEditPayload } from "../../features/admin/adminGyms";
import { partnerFormPayload, type PartnerForm } from "../../features/admin/adminPartners";

describe("emails leaving the pure payload builders", () => {
  const gym = { name: "A", address: "B", city: "", phone: "", email: "Old@X.vn", description: "" };

  it("admin gym edit sends the normalised email, and a capital alone is not a change", () => {
    assert.deepEqual(gymEditPayload(gym, { ...gym, email: "  New@X.VN " }), { email: "new@x.vn" });
    assert.deepEqual(gymEditPayload(gym, { ...gym, email: "old@x.vn" }), {});
  });

  it("admin partner form lowercases contactEmail", () => {
    const form = {
      legalName: "Cty", contactEmail: " Chu@Phong.Gym ", contactPhone: "", taxCode: "", businessLicenseNo: "",
      commissionPercent: "", expectedBranchCount: "", negotiationNotes: "",
    } as PartnerForm;
    assert.equal(partnerFormPayload(form).contactEmail, "chu@phong.gym");
  });
});
