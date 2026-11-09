/**
 * B9a — URL-state parsing for Hồ sơ PT / Chi nhánh / Đối tác phòng gym.
 * Chạy: npx tsx --test src/app/pages/admin/__tests__/b9a-url-state.test.ts (từ frontend/web)
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildPartnerParams,
  parseGymTab,
  parseIdParam,
  parsePartnerDetailTab,
  parsePartnerStatus,
  parsePartnerView,
  parsePtFilter,
  shortRef,
} from "../shared/b9aUrlState";

describe("b9a parseIdParam", () => {
  it("accepts uuid/cuid tokens", () => {
    assert.equal(parseIdParam("0b9e3c1a-1111-4222-8333-444455556666"), "0b9e3c1a-1111-4222-8333-444455556666");
    assert.equal(parseIdParam("  clx123ABC  "), "clx123ABC");
  });
  it("rejects empty, too long and hostile values", () => {
    for (const v of [null, undefined, "", "   ", "a".repeat(65), "../../etc", "<script>", "a b", "x?y=1"]) assert.equal(parseIdParam(v as string), null);
  });
});

describe("b9a PT filter", () => {
  it("keeps known statuses, everything else is 'all'", () => {
    assert.equal(parsePtFilter("APPROVED"), "APPROVED");
    assert.equal(parsePtFilter("NEEDS_MORE_INFO"), "NEEDS_MORE_INFO");
    for (const v of [null, "", "approved", "DRAFT", "all?", "__proto__"]) assert.equal(parsePtFilter(v), "all");
  });
});

describe("b9a gym moderation tab", () => {
  it("parses the five tabs and defaults to pending", () => {
    for (const t of ["pending", "gym-renames", "brand-renames", "closed", "all-gyms"]) assert.equal(parseGymTab(t), t);
    for (const v of [null, "", "PENDING", "nope", "constructor"]) assert.equal(parseGymTab(v), "pending");
  });
});

describe("b9a partners page", () => {
  it("view / detail tab / status fall back to defaults", () => {
    assert.equal(parsePartnerView("partners"), "partners");
    assert.equal(parsePartnerView("x"), "applications");
    assert.equal(parsePartnerView(null), "applications");
    for (const t of ["overview", "accounts", "gyms", "documents", "money", "audit", "notes", "complaints"]) assert.equal(parsePartnerDetailTab(t), t);
    assert.equal(parsePartnerDetailTab("billing"), "overview");
    assert.equal(parsePartnerStatus("SUSPENDED"), "SUSPENDED");
    assert.equal(parsePartnerStatus("active"), "ALL");
  });

  it("buildPartnerParams omits defaults so the plain URL stays /admin/partners", () => {
    assert.deepEqual(buildPartnerParams({}), {});
    assert.deepEqual(buildPartnerParams({ view: "applications" }), {});
    assert.deepEqual(buildPartnerParams({ view: "partners" }), { view: "partners" });
    assert.deepEqual(buildPartnerParams({ view: "applications", id: "app1" }), { id: "app1" });
    assert.deepEqual(buildPartnerParams({ view: "partners", id: "p1" }), { view: "partners", id: "p1" });
    assert.deepEqual(buildPartnerParams({ view: "partners", id: "p1", tab: "money" }), { view: "partners", id: "p1", tab: "money" });
    assert.deepEqual(buildPartnerParams({ view: "partners", id: "p1", tab: "overview" }), { view: "partners", id: "p1" });
  });

  it("tab only travels with a partner id; status only on the partner list", () => {
    assert.deepEqual(buildPartnerParams({ view: "applications", id: "a1", tab: "money" }), { id: "a1" });
    assert.deepEqual(buildPartnerParams({ view: "partners", tab: "money" }), { view: "partners" });
    assert.deepEqual(buildPartnerParams({ view: "partners", status: "ACTIVE" }), { view: "partners", status: "ACTIVE" });
    assert.deepEqual(buildPartnerParams({ view: "partners", status: "ALL" }), { view: "partners" });
    assert.deepEqual(buildPartnerParams({ view: "partners", id: "p1", status: "ACTIVE" }), { view: "partners", id: "p1" });
  });

  it("build -> parse round-trips", () => {
    const q = new URLSearchParams(buildPartnerParams({ view: "partners", id: "p-9", tab: "audit" }));
    assert.equal(parsePartnerView(q.get("view")), "partners");
    assert.equal(parseIdParam(q.get("id")), "p-9");
    assert.equal(parsePartnerDetailTab(q.get("tab")), "audit");
  });
});

describe("b9a shortRef", () => {
  it("shows an 8-char copyable ref, never the whole uuid", () => {
    assert.equal(shortRef("0b9e3c1a-1111-4222-8333-444455556666"), "0b9e3c1a");
    assert.equal(shortRef("abc"), "abc");
    assert.equal(shortRef(null), "—");
  });
});
