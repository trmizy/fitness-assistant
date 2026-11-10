/**
 * BE-2 — "hai người" cho khoản rút lớn: phần thuần của UI (cổng hiển thị nút "Đã chi trả", câu chữ, chuẩn hoá hàng đợi,
 * ánh xạ mã lỗi FOUR_EYES_REQUIRED). Máy chủ vẫn là bên quyết định — UI chỉ gợi ý.
 *
 * Chạy: npx tsx --test src/app/pages/admin/__tests__/be2-four-eyes.test.ts (từ frontend/web)
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { adminLabel, canOfferMarkPaid, fourEyesGate, normalizeQueue } from "../withdrawals/withdrawalQueue";
import { describeAdminError } from "../shared/useAdminError";
import { formatMoneyExact } from "../adminFinanceOverview.utils";

const ME = "11111111-aaaa-4aaa-8aaa-111111111111";
const OTHER = "22222222-bbbb-4bbb-8bbb-222222222222";
const MIN = "5000000.00";
const http = (status: number, data?: unknown) => ({ response: { status, data }, message: "Request failed" });

const row = (over: Record<string, unknown> = {}) => ({
  id: "00000000-0000-4000-8000-000000000001",
  ownerType: "PT",
  ownerId: "bbbbbbbb-0000-4000-8000-000000000001",
  amount: "6000000.00",
  status: "APPROVED",
  payoutInfo: "VCB 001",
  createdAt: "2026-11-10T03:00:00Z",
  fourEyesRequired: true,
  approvedBy: OTHER,
  fourEyesMinAmount: MIN,
  ...over,
});

describe("normalizeQueue keeps the BE-2 fields", () => {
  it("reads fourEyesRequired / approvedBy / fourEyesMinAmount", () => {
    const { rows } = normalizeQueue([row()]);
    assert.equal(rows[0].fourEyesRequired, true);
    assert.equal(rows[0].approvedBy, OTHER);
    assert.equal(rows[0].fourEyesMinAmount, MIN);
  });

  it("an older server without the fields -> no gate (false / null), nothing invented", () => {
    const old = row();
    delete (old as Record<string, unknown>).fourEyesRequired;
    delete (old as Record<string, unknown>).approvedBy;
    delete (old as Record<string, unknown>).fourEyesMinAmount;
    const { rows } = normalizeQueue([old]);
    assert.equal(rows[0].fourEyesRequired, false);
    assert.equal(rows[0].approvedBy, null);
    assert.equal(rows[0].fourEyesMinAmount, null);
    assert.equal(fourEyesGate(rows[0], ME, formatMoneyExact).kind, "none");
  });

  it("a non-boolean flag is not treated as true", () => {
    assert.equal(normalizeQueue([row({ fourEyesRequired: "true" })]).rows[0].fourEyesRequired, false);
  });
});

describe("fourEyesGate", () => {
  const gate = (over: Record<string, unknown>, me: string | null = ME) => fourEyesGate(normalizeQueue([row(over)]).rows[0], me, formatMoneyExact);

  it("below the threshold (flag false): nothing changes, button offered", () => {
    const g = gate({ fourEyesRequired: false, approvedBy: ME, amount: "100000.00" });
    assert.equal(g.kind, "none");
    assert.equal(canOfferMarkPaid(g), true);
  });

  it("large + approved by the current admin: no mark-paid button, the exact Vietnamese sentence with the exact threshold", () => {
    const g = gate({ approvedBy: ME });
    assert.equal(g.kind, "blocked-same-admin");
    assert.equal(canOfferMarkPaid(g), false);
    assert.ok(g.kind === "blocked-same-admin");
    assert.equal(g.message, `Khoản từ ${formatMoneyExact(MIN)} cần một quản trị viên khác xác nhận đã chi. Bạn là người đã duyệt.`);
    assert.match(g.message, /5\.000\.000/);
  });

  it("large + approved by someone else: button offered with the 'second admin' line naming a short id", () => {
    const g = gate({ approvedBy: OTHER });
    assert.equal(g.kind, "second-admin");
    assert.equal(canOfferMarkPaid(g), true);
    assert.ok(g.kind === "second-admin");
    assert.equal(g.note, "Đã được mã 22222222 duyệt; bạn là người thứ hai xác nhận đã chi.");
  });

  it("large + still PENDING: no mark-paid button (needs approval first, then a second admin)", () => {
    const g = gate({ status: "PENDING", approvedBy: null });
    assert.equal(g.kind, "needs-approval");
    assert.equal(canOfferMarkPaid(g), false);
    assert.ok(g.kind === "needs-approval");
    assert.match(g.message, /cần được duyệt trước, rồi một quản trị viên khác xác nhận đã chi/);
  });

  it("current admin unknown (not loaded): never claims 'you approved' — the server decides", () => {
    assert.equal(gate({ approvedBy: OTHER }, null).kind, "second-admin");
    assert.equal(gate({ approvedBy: ME }, null).kind, "second-admin");
  });

  it("no threshold from the server: neutral wording, no made-up number", () => {
    const g = gate({ approvedBy: ME, fourEyesMinAmount: null });
    assert.ok(g.kind === "blocked-same-admin");
    assert.match(g.message, /^Khoản từ mức quy định cần/);
  });

  it("a custom exact threshold is shown exactly, not rounded", () => {
    const g = gate({ approvedBy: ME, fourEyesMinAmount: "5000000.50" });
    assert.ok(g.kind === "blocked-same-admin");
    assert.ok(g.message.includes(formatMoneyExact("5000000.50")));
    assert.notEqual(formatMoneyExact("5000000.50"), formatMoneyExact("5000000"));
  });
});

describe("adminLabel", () => {
  it("'bạn' for me, short id otherwise, dash for nobody", () => {
    assert.equal(adminLabel(ME, ME), "bạn");
    assert.equal(adminLabel(OTHER, ME), "mã 22222222");
    assert.equal(adminLabel(null, ME), "—");
  });
});

describe("error code FOUR_EYES_REQUIRED", () => {
  it("maps to a Vietnamese message, stale (re-read the queue), not ambiguous, no raw code", () => {
    const v = describeAdminError(http(409, { success: false, error: { code: "FOUR_EYES_REQUIRED", message: "x" } }), { action: "write" });
    assert.equal(v.code, "FOUR_EYES_REQUIRED");
    assert.equal(v.stale, true);
    assert.equal(v.ambiguous, false);
    assert.match(v.message, /quản trị viên khác với người đã duyệt xác nhận đã chi/);
    assert.ok(!v.message.includes("FOUR_EYES"));
  });
});
