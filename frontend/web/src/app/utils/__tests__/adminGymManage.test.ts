/**
 * FIX2-ADMIN (15/11/2026): the admin branch edit sends only changed fields (N14A-01) and the lifecycle actions (Q5).
 * TEST FIXTURE: pure functions, no DOM. Run: npx tsx --test src/app/utils/__tests__/adminGymManage.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  LIFECYCLE,
  adminReasonError,
  buildGymEditPatch,
  buildLifecycleBody,
  gymEditFormFrom,
  lifecycleActionsFor,
  lifecycleError,
  validateGymEdit,
} from "../adminGymManage";

const GYM = { name: "Old", approvedName: "Gym A", address: "1 X", approvedAddress: "1 X St", city: "HCM", phone: "0901234567", email: "a@b.vn", description: "Phòng tập đẹp" };

describe("N14A-01: admin branch edit", () => {
  const initial = gymEditFormFrom(GYM);

  it("starts from the approved name / address (what the public sees)", () => {
    assert.equal(initial.name, "Gym A");
    assert.equal(initial.address, "1 X St");
    assert.equal(gymEditFormFrom({ name: "N", address: "A" }).description, "");
  });

  it("changing only the phone sends ONLY the phone - no description, no reason needed", () => {
    const v = validateGymEdit(initial, { ...initial, phone: "0987654321" }, "");
    assert.equal(v.ok, true);
    if (v.ok) assert.deepEqual(v.body, { phone: "0987654321" });
  });

  it("an untouched form sends nothing (nothingChanged), whitespace-only edits are not changes", () => {
    const v = validateGymEdit(initial, { ...initial, city: "HCM  " }, "");
    assert.deepEqual(v, { ok: false, reasonError: null, nothingChanged: true });
    assert.deepEqual(buildGymEditPatch(initial, initial), { patch: {}, descriptionChanged: false });
  });

  it("changing the public introduction needs a reason of at least 10 characters; the reason rides with the description", () => {
    const next = { ...initial, description: "Phòng tập mới" };
    for (const reason of ["", "   ", "ngắn quá"]) {
      const v = validateGymEdit(initial, next, reason);
      assert.equal(v.ok, false);
      if (!v.ok) assert.match(v.reasonError ?? "", /tối thiểu 10 ký tự/);
    }
    const ok = validateGymEdit(initial, next, "  Sửa lại cho đúng thực tế  ");
    assert.equal(ok.ok, true);
    if (ok.ok) assert.deepEqual(ok.body, { description: "Phòng tập mới", reason: "Sửa lại cho đúng thực tế" });
  });

  it("phone + description together: both sent, reason included", () => {
    const v = validateGymEdit(initial, { ...initial, phone: "0911111111", description: "" }, "Gỡ phần giới thiệu sai sự thật");
    assert.equal(v.ok, true);
    if (v.ok) assert.deepEqual(v.body, { phone: "0911111111", description: "", reason: "Gỡ phần giới thiệu sai sự thật" });
  });

  it("name and address can never be saved empty", () => {
    const v = validateGymEdit(initial, { ...initial, name: "  " }, "");
    assert.equal(v.ok, false);
  });

  it("adminReasonError matches the server limits", () => {
    assert.equal(adminReasonError("x".repeat(9)) !== null, true);
    assert.equal(adminReasonError("x".repeat(10)), null);
    assert.equal(adminReasonError("x".repeat(501)) !== null, true);
    assert.equal(adminReasonError("", false), null);
  });
});

describe("Q5: branch lifecycle actions", () => {
  const actions = (status: string, op = "OPEN") => lifecycleActionsFor({ status, operationalStatus: op }).map((a) => a.action);

  it("offers only what the state allows", () => {
    assert.deepEqual(actions("APPROVED"), ["SUSPEND", "CLOSE_TEMPORARILY"]);
    assert.deepEqual(actions("SUSPENDED"), ["LIFT_SUSPENSION", "CLOSE_TEMPORARILY"]);
    assert.deepEqual(actions("APPROVED", "TEMPORARILY_CLOSED"), ["SUSPEND", "REOPEN"]);
    assert.deepEqual(actions("SUSPENDED", "TEMPORARILY_CLOSED"), ["LIFT_SUSPENSION", "REOPEN"]);
    assert.deepEqual(actions("PENDING_REVIEW"), [], "a branch still in review is approved or rejected, not suspended");
    assert.deepEqual(actions("REJECTED"), []);
    assert.deepEqual(actions("DRAFT"), []);
    assert.deepEqual(actions("APPROVED", "PERMANENTLY_CLOSED"), [], "permanent closure is the owner's one-way decision");
  });

  it("a missing operationalStatus counts as OPEN", () => {
    assert.deepEqual(lifecycleActionsFor({ status: "APPROVED" }).map((a) => a.action), ["SUSPEND", "CLOSE_TEMPORARILY"]);
  });

  it("every action explains its effect in Vietnamese and only the restrictive ones need a reason", () => {
    for (const m of Object.values(LIFECYCLE)) {
      assert.ok(m.effect.length > 40, m.action);
      assert.ok(m.label && m.confirmLabel && m.reasonLabel);
    }
    assert.equal(LIFECYCLE.SUSPEND.reasonRequired, true);
    assert.equal(LIFECYCLE.CLOSE_TEMPORARILY.reasonRequired, true);
    assert.equal(LIFECYCLE.LIFT_SUSPENSION.reasonRequired, false);
    assert.equal(LIFECYCLE.REOPEN.reasonRequired, false);
    assert.match(LIFECYCLE.SUSPEND.effect, /check-in được/);
    assert.match(LIFECYCLE.SUSPEND.effect, /không tự hoàn tiền/);
  });

  it("validation: reason required >= 10 for suspend/close, optional otherwise; the reopen date must be in the future", () => {
    assert.notEqual(lifecycleError(LIFECYCLE.SUSPEND, "ngắn").reason, null);
    assert.equal(lifecycleError(LIFECYCLE.SUSPEND, "Nhiều báo cáo vệ sinh").reason, null);
    assert.equal(lifecycleError(LIFECYCLE.REOPEN, "").reason, null);
    const now = new Date(2026, 10, 15, 10, 0);
    assert.notEqual(lifecycleError(LIFECYCLE.CLOSE_TEMPORARILY, "Sửa chữa hệ thống điện", "2026-11-14", now).date, null);
    assert.equal(lifecycleError(LIFECYCLE.CLOSE_TEMPORARILY, "Sửa chữa hệ thống điện", "2026-11-20", now).date, null);
    assert.equal(lifecycleError(LIFECYCLE.CLOSE_TEMPORARILY, "Sửa chữa hệ thống điện", "", now).date, null);
    assert.equal(lifecycleError(LIFECYCLE.SUSPEND, "Nhiều báo cáo vệ sinh", "2020-01-01", now).date, null, "only the temporary close asks for a date");
  });

  it("request body: action + trimmed reason; the date only for the temporary close", () => {
    assert.deepEqual(buildLifecycleBody(LIFECYCLE.SUSPEND, "  Nhiều báo cáo vệ sinh  ", "2026-12-01"), { action: "SUSPEND", reason: "Nhiều báo cáo vệ sinh" });
    assert.deepEqual(buildLifecycleBody(LIFECYCLE.REOPEN, ""), { action: "REOPEN" });
    const close = buildLifecycleBody(LIFECYCLE.CLOSE_TEMPORARILY, "Sửa chữa hệ thống điện", "2026-12-01") as { expectedReopenAt: string };
    assert.equal(new Date(close.expectedReopenAt).getFullYear(), 2026);
    assert.equal(buildLifecycleBody(LIFECYCLE.CLOSE_TEMPORARILY, "Sửa chữa hệ thống điện").expectedReopenAt, undefined);
  });
});
