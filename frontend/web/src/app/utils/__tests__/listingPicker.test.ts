/**
 * Listing Management D1 - the "Chọn huấn luyện viên / chi nhánh để sửa" picker: eligibility and search.
 * Run: npx tsx --test src/app/utils/__tests__/listingPicker.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { eligibleGymTargets, eligiblePtTargets, filterTargets, foldText } from "../listingPicker";

const app = (over: any = {}, profile: any = {}) => ({
  id: "a1",
  status: "APPROVED",
  userProfile: { userId: "u1", firstName: "Nguyễn", lastName: "Đức An", email: "an@x.vn", isPT: true, ...profile },
  ...over,
});

describe("PT eligibility", () => {
  it("only isPT profiles with an APPROVED application", () => {
    const list = eligiblePtTargets([
      app(),
      app({ status: "SUBMITTED" }, { userId: "u2" }),
      app({}, { userId: "u3", isPT: false }),
      app({ status: "REJECTED" }, { userId: "u4" }),
      app({}, { userId: "u5", firstName: "Bình", lastName: "Lê" }),
    ]);
    assert.deepEqual(list.map((t) => t.id), ["u1", "u5"]);
  });

  it("ignores malformed rows and non-arrays; de-duplicates by user", () => {
    assert.deepEqual(eligiblePtTargets(null), []);
    assert.deepEqual(eligiblePtTargets({ not: "an array" }), []);
    assert.equal(eligiblePtTargets([app(), app(), { status: "APPROVED" }, null]).length, 1);
  });

  it("title is the name (never a raw id); email is the subtitle", () => {
    const [t] = eligiblePtTargets([app()]);
    assert.equal(t.title, "Nguyễn Đức An");
    assert.equal(t.subtitle, "an@x.vn");
    assert.equal(eligiblePtTargets([app({}, { firstName: null, lastName: null })])[0].title, "Huấn luyện viên");
  });
});

describe("Gym eligibility", () => {
  const gym = (over: any = {}) => ({ id: "g1", name: "CityFit Q1", status: "APPROVED", operationalStatus: "OPEN", address: "1 Lê Lợi", brand: { name: "CityFit" }, ...over });

  it("APPROVED and SUSPENDED only; pending / rejected excluded", () => {
    const list = eligibleGymTargets([
      gym(),
      gym({ id: "g2", status: "SUSPENDED" }),
      gym({ id: "g3", status: "PENDING_REVIEW" }),
      gym({ id: "g4", status: "REJECTED" }),
    ]);
    assert.deepEqual(list.map((t) => t.id), ["g1", "g2"]);
  });

  it("a permanently closed branch is excluded; a temporarily closed one is not", () => {
    const list = eligibleGymTargets([gym({ id: "g5", operationalStatus: "PERMANENTLY_CLOSED" }), gym({ id: "g6", operationalStatus: "TEMPORARILY_CLOSED" })]);
    assert.deepEqual(list.map((t) => t.id), ["g6"]);
  });

  it("uses the approved name / address and shows the brand in the subtitle", () => {
    const [t] = eligibleGymTargets([gym({ approvedName: "CityFit Quận 1", approvedAddress: "2 Nguyễn Huệ", brand: { name: "x", approvedName: "CityFit VN" } })]);
    assert.equal(t.title, "CityFit Quận 1");
    assert.equal(t.subtitle, "CityFit VN · 2 Nguyễn Huệ");
  });
});

describe("search", () => {
  const targets = eligiblePtTargets([
    app({}, { userId: "u1", firstName: "Nguyễn", lastName: "Đức An" }),
    app({}, { userId: "u2", firstName: "Đặng", lastName: "Bình", email: "binh@gmail.com" }),
    app({}, { userId: "u3", firstName: "Lê", lastName: "An" }),
  ]);

  it("ignores accents and case, and matches Đ as d", () => {
    assert.equal(foldText("  Đức   AN "), "duc an");
    assert.deepEqual(filterTargets(targets, "duc an").map((t) => t.id), ["u1"]);
    assert.deepEqual(filterTargets(targets, "DANG").map((t) => t.id), ["u2"]);
  });

  it("every word must match, in any order; the email counts", () => {
    assert.deepEqual(filterTargets(targets, "an nguyen").map((t) => t.id), ["u1"]);
    assert.deepEqual(filterTargets(targets, "gmail").map((t) => t.id), ["u2"]);
    assert.deepEqual(filterTargets(targets, "le an").map((t) => t.id), ["u3"]);
  });

  it("an empty search shows nothing (the list is long); no match shows nothing; the limit applies", () => {
    assert.deepEqual(filterTargets(targets, ""), []);
    assert.deepEqual(filterTargets(targets, "   "), []);
    assert.deepEqual(filterTargets(targets, "zzz"), []);
    assert.equal(filterTargets(targets, "an", 1).length, 1);
  });
});
