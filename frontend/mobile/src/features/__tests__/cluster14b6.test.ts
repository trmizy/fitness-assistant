import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { canReviewGym } from "../services/reviewRules";
import { shareContacts } from "../workout/templateShare";
import { packageFormError, packagePayload } from "../plans/packageForm";
import { foodFilterOptions, foodFormLabel, foodSourceLabel } from "../library/foodLibrary";
import { extractInviteToken, inviteFormError } from "../partnerApplication/partnerApplication";

/**
 * 14B.6 — the rules behind review/template-share/sell-package/food-filter/manager-invite, pinned to what web and the services enforce.
 *
 * Chạy: npx tsx --test src/features/__tests__/cluster14b6.test.ts
 */

describe("PG-B2 gym review eligibility (server NOT_A_MEMBER rule)", () => {
  it("ACTIVE or EXPIRED membership at this gym may review; cancelled / other gyms may not", () => {
    assert.equal(canReviewGym([{ gymId: "g", status: "ACTIVE" }], "g"), true);
    assert.equal(canReviewGym([{ gymId: "g", status: "EXPIRED" }], "g"), true);
    assert.equal(canReviewGym([{ gymId: "g", status: "CANCELLED" }, { gymId: "x", status: "ACTIVE" }], "g"), false);
    assert.equal(canReviewGym({ data: [{ gymId: "g", status: "ACTIVE" }] }, "g"), true);
    assert.equal(canReviewGym(null, "g"), false);
  });
});

describe("PG-B5 template share contacts (active contracts only)", () => {
  it("merges clients (as PT) and PTs (as client), deduplicated, never yourself", () => {
    const pt = [
      { clientUserId: "u1", clientProfile: { firstName: "An", lastName: "Lê" } },
      { clientUserId: "u2", clientProfile: {} },
    ];
    const client = { contracts: [{ ptUserId: "p1", ptProfile: { firstName: "Bình" } }, { ptUserId: "u1" }] };
    const list = shareContacts(pt, client, "u2");
    assert.deepEqual(
      list.map((c) => [c.userId, c.name, c.role]),
      [
        ["u1", "An Lê", "client"],
        ["p1", "Bình", "pt"],
      ],
    );
  });
  it("a side that failed (403 for a customer) contributes nothing", () => {
    assert.deepEqual(shareContacts(undefined, [{ ptUserId: "p1" }]).map((c) => c.userId), ["p1"]);
  });
});

describe("PG-B7 paid package form (ai-service createPackageSchema)", () => {
  const ok = { name: "Gói 8 tuần", price: "499000", durationWeeks: "8", description: "" };
  it("accepts a valid form and builds the body", () => {
    assert.equal(packageFormError(ok), null);
    assert.deepEqual(packagePayload("pp", ok), { publishedPlanId: "pp", name: "Gói 8 tuần", price: 499000, durationWeeks: 8, description: undefined });
  });
  it("rejects short names, non-positive prices and bad weeks", () => {
    assert.equal(packageFormError({ ...ok, name: "ab" }), "Tên gói cần ít nhất 3 ký tự");
    assert.equal(packageFormError({ ...ok, price: "0" }), "Nhập giá lớn hơn 0");
    assert.equal(packageFormError({ ...ok, durationWeeks: "0" }), "Số tuần phải là số nguyên dương");
    assert.equal(packageFormError({ ...ok, durationWeeks: "" }), null);
  });
});

describe("PG-B8 food filter options", () => {
  it("reads sources / forms from the endpoint, ignoring junk", () => {
    assert.deepEqual(foodFilterOptions({ sources: ["sr_legacy", null, ""], foodForms: ["oil"], supplementValues: [true] }), {
      sources: ["sr_legacy"],
      foodForms: ["oil"],
    });
    assert.deepEqual(foodFilterOptions(undefined), { sources: [], foodForms: [] });
  });
  it("names codes for people and falls back to the code", () => {
    assert.equal(foodSourceLabel("survey_fndds"), "USDA khảo sát (FNDDS)");
    assert.equal(foodFormLabel("nuts_seeds"), "Hạt");
    assert.equal(foodFormLabel("frozen_meal"), "frozen meal");
  });
});

describe("PG-B9 manager invitation", () => {
  const token = "a1b2c3d4e5f6a7b8c9d0";
  it("finds the token in the emailed web link, the app deep link, or bare", () => {
    assert.equal(extractInviteToken(`https://gymini.vn/partner/invite/${token}`), token);
    assert.equal(extractInviteToken(`fitnessassistant://partner/invite?token=${token}`), token);
    assert.equal(extractInviteToken(` ${token} `), token);
    assert.equal(extractInviteToken("xin chào"), null);
  });
  it("needs a first name and a confirmed password of 8+", () => {
    assert.equal(inviteFormError({ firstName: "", password: "12345678", confirm: "12345678" }), "Nhập họ của bạn");
    assert.equal(inviteFormError({ firstName: "An", password: "1234567", confirm: "1234567" }), "Mật khẩu tối thiểu 8 ký tự");
    assert.equal(inviteFormError({ firstName: "An", password: "12345678", confirm: "12345679" }), "Mật khẩu nhập lại không khớp");
    assert.equal(inviteFormError({ firstName: "An", password: "12345678", confirm: "12345678" }), null);
  });
});
