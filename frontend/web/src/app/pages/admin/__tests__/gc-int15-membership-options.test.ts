/** INT-15. TEST FIXTURE (fake HTTP client) + CODE AUDIT (source guards): the open-case form picks the reporter's membership from a list. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createGymCaseApi, type GymHttpClient } from "../complaints/gymCaseApi";
import { gymQueryKeys } from "../complaints/gymCaseQueryKeys";
import {
  MEMBERSHIP_EMPTY_TEXT,
  MEMBERSHIP_LOADING_TEXT,
  MEMBERSHIP_PICK_PLACEHOLDER,
  membershipOptionLabel,
  membershipSelectOptions,
  type MembershipOption,
} from "../complaints/membershipOptions";

const here = dirname(fileURLToPath(import.meta.url));
const page = readFileSync(join(here, "..", "AdminComplaintsPage.tsx"), "utf8");

const GOOD: MembershipOption = {
  membershipId: "11111111-2222-3333-4444-555555555555",
  planName: "Gói 3 tháng",
  status: "ACTIVE",
  startDate: "2026-01-05T12:00:00.000Z",
  endDate: "2026-04-05T12:00:00.000Z",
  price: "300000.00",
  refundable: true,
};

describe("INT-15 membership option label", () => {
  it("refundable: plan, Vietnamese status, dd/mm/yyyy range, money - and no raw enum", () => {
    const l = membershipOptionLabel(GOOD);
    assert.match(l, /^Gói 3 tháng · Đang hoạt động · \d{2}\/\d{2}\/\d{4}–\d{2}\/\d{2}\/\d{4} · 300\.000/);
    assert.doesNotMatch(l, /ACTIVE|không hoàn được/);
  });
  it("not refundable: appends the Vietnamese reason for each server reason", () => {
    const cases: Array<[string, string]> = [
      ["STATUS_NOT_REFUNDABLE", "trạng thái gói không hoàn được"],
      ["NO_PAYMENT", "chưa có thanh toán"],
      ["PAYOUT_ALREADY_RELEASED", "tiền đã nhả cho phòng tập"],
    ];
    for (const [code, text] of cases) {
      const l = membershipOptionLabel({ ...GOOD, status: "EXPIRED", refundable: false, reasonNotRefundable: code });
      assert.ok(l.endsWith(` · không hoàn được: ${text}`), l);
      assert.ok(l.includes("Đã hết hạn"));
      assert.doesNotMatch(l, /EXPIRED|STATUS_NOT_REFUNDABLE|NO_PAYMENT|PAYOUT_ALREADY_RELEASED/);
    }
  });
  it("unknown status / reason never leak raw codes", () => {
    const l = membershipOptionLabel({ ...GOOD, status: "WEIRD_X", refundable: false, reasonNotRefundable: "NEW_CODE" });
    assert.doesNotMatch(l, /WEIRD_X|NEW_CODE/);
  });
  it("non-refundable memberships stay selectable and the value is the membership id (never shown in the label)", () => {
    const opts = membershipSelectOptions([GOOD, { ...GOOD, membershipId: "m-2", refundable: false, reasonNotRefundable: "NO_PAYMENT" }]);
    assert.deepEqual(opts.map((o) => o.value), [GOOD.membershipId, "m-2"]);
    assert.ok(!opts[0].label.includes(GOOD.membershipId));
  });
  it("copy", () => {
    assert.equal(MEMBERSHIP_PICK_PLACEHOLDER, "-- Chọn gói của người khiếu nại --");
    assert.equal(MEMBERSHIP_LOADING_TEXT, "Đang tải các gói của người khiếu nại…");
    assert.equal(MEMBERSHIP_EMPTY_TEXT, "Người khiếu nại không có gói nào tại phòng tập này.");
  });
});

describe("INT-15 api + query key", () => {
  it("GET /admin/complaints/<id>/membership-options and unwraps data.items", async () => {
    let sent: { method: string; url: string; data?: unknown } | undefined;
    const client: GymHttpClient = { request: async (config) => { sent = config; return { status: 200, data: { success: true, data: { items: [GOOD] } } as never }; } };
    const items = await createGymCaseApi(client).membershipOptions("c-1");
    assert.equal(sent?.method, "GET");
    assert.equal(sent?.url, "/admin/complaints/c-1/membership-options");
    assert.equal(sent?.data, undefined);
    assert.deepEqual(items, [GOOD]);
  });
  it("an empty or malformed body is an empty list", async () => {
    for (const data of [{ success: true, data: { items: [] } }, { success: true, data: {} }, { success: true, data: null }]) {
      const client: GymHttpClient = { request: async () => ({ status: 200, data: data as never }) };
      assert.deepEqual(await createGymCaseApi(client).membershipOptions("c-1"), []);
    }
  });
  it("the complaint id is URL-encoded", async () => {
    let url = "";
    const client: GymHttpClient = { request: async (c) => { url = c.url; return { status: 200, data: { data: { items: [] } } as never }; } };
    await createGymCaseApi(client).membershipOptions("a/b");
    assert.equal(url, "/admin/complaints/a%2Fb/membership-options");
  });
  it("the query key is user-scoped", () => {
    assert.deepEqual(gymQueryKeys("u-1").membershipOptions("c-1"), ["gym-complaint", "u-1", "membership-options", "c-1"]);
  });
});

describe("INT-15 source guards (CODE AUDIT)", () => {
  const start = page.indexOf("function OpenCaseSection");
  const end = page.indexOf("function fieldErrs");
  const section = page.slice(start, end);
  it("the section was found", () => assert.ok(start > 0 && end > start));
  it("loads the options through the api, with no polling", () => {
    assert.match(section, /gymCaseApi\.membershipOptions\(complaint\.id\)/);
    assert.match(section, /\.\.\.GYM_QUERY_OPTIONS/);
    assert.doesNotMatch(section, /refetchInterval/);
  });
  it("the free-text id input renders only when the membership is not picked from the list (manual fallback or an optional-membership class)", () => {
    const inputs = section.match(/<TextInput\b/g) ?? [];
    assert.equal(inputs.length, 1);
    assert.match(section, /opt\?\.allowsMembership && !picks/);
    assert.match(section, /const picks = !!opt\?\.needsMembership && !manual;/);
    assert.match(section, /setManual\(true\)/);
    assert.match(section, /Nhập mã gói thủ công|MEMBERSHIP_MANUAL_LABEL/);
  });
  it("the manual link lives only inside the options error block", () => {
    const err = section.indexOf("open-case-options-error");
    const manual = section.indexOf("open-case-manual");
    const empty = section.indexOf("open-case-options-empty");
    assert.ok(err > 0 && manual > err && manual < empty);
  });
  it("the body still comes from openBody and send is disabled while loading / empty", () => {
    assert.match(section, /openBody\(\{ caseClass, membershipId \}\)/);
    assert.match(section, /disabled=\{picks && \(optionsLoading \|\| optionsEmpty\)\}/);
  });
});
