/**
 * Duyệt / Từ chối ngoại lệ check-in trên điện thoại (Quầy lễ tân): quy tắc thuần.
 * Backend: gym-service `POST /owner/gyms/:gymId/front-desk/exceptions/:id/(approve|reject)` + `{ reason }` (5-300),
 * quyền `checkin.exception.approve` (chủ + quản lý), bốn mắt, hết hạn cuối ngày.
 * Evidence label: TEST FIXTURE (node:test, pure functions).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  DECISION_TEXT,
  REASON_MAX,
  canDecideRow,
  decisionRefusal,
  decisionTitle,
  isOpenPending,
  normalizeExceptions,
  reasonProblem,
} from "../gymOwner/frontDesk";
import { hasPartnerPermission } from "../gymOwner/permissions";

const NOW = Date.parse("2026-11-23T05:00:00.000Z");
const FUTURE = "2026-11-23T16:59:59.999Z";
const PAST = "2026-11-22T16:59:59.999Z";
const row = (over: Record<string, unknown> = {}) => ({ status: "PENDING" as const, expiresAt: FUTURE, mine: false, ...over });

describe("normalizeExceptions keeps expiresAt", () => {
  it("reads the end-of-day expiry the server sends, null when absent", () => {
    const r = normalizeExceptions({ canApprove: true, exceptions: [{ id: "e1", status: "PENDING", expiresAt: FUTURE }, { id: "e2", status: "PENDING" }] });
    assert.equal(r.exceptions[0].expiresAt, FUTURE);
    assert.equal(r.exceptions[1].expiresAt, null);
  });
});

describe("isOpenPending", () => {
  it("only a PENDING request not past its expiry is open", () => {
    assert.equal(isOpenPending(row(), NOW), true);
    assert.equal(isOpenPending(row({ expiresAt: null }), NOW), true);
    assert.equal(isOpenPending(row({ expiresAt: PAST }), NOW), false);
    assert.equal(isOpenPending(row({ status: "APPROVED" }), NOW), false);
    assert.equal(isOpenPending(row({ status: "REJECTED" }), NOW), false);
    assert.equal(isOpenPending(row({ status: "EXPIRED" }), NOW), false);
  });
});

describe("canDecideRow: who is offered Duyệt / Từ chối", () => {
  const base = { canApprovePermission: true, listCanApprove: true, nowMs: NOW };
  it("owner / manager on someone else's open request: yes", () => {
    assert.equal(canDecideRow({ ...base, row: row() }), true);
  });
  it("needs the permission in permissions[] (fail-closed)", () => {
    assert.equal(canDecideRow({ ...base, canApprovePermission: false, row: row() }), false);
  });
  it("needs the server's own canApprove on the list", () => {
    assert.equal(canDecideRow({ ...base, listCanApprove: false, row: row() }), false);
  });
  it("never on the viewer's own request (four-eyes), an expired one, or one already decided", () => {
    assert.equal(canDecideRow({ ...base, row: row({ mine: true }) }), false);
    assert.equal(canDecideRow({ ...base, row: row({ expiresAt: PAST }) }), false);
    assert.equal(canDecideRow({ ...base, row: row({ status: "APPROVED" }) }), false);
  });
  it("by role, using the real permissions[] the server returns (partner-permissions.ts)", () => {
    const status = (role: string, permissions: string[]) => ({ role, permissions });
    const can = (st: unknown) => hasPartnerPermission(st, "checkin.exception.approve");
    const owner = status("OWNER", ["checkin.exception.request", "checkin.exception.approve"]);
    const manager = status("MANAGER", ["checkin.exception.request", "checkin.exception.approve"]);
    const receptionist = status("RECEPTIONIST", ["checkin.exception.request"]);
    const accountant = status("ACCOUNTANT", ["finance.wallet.view"]);
    assert.equal(canDecideRow({ ...base, canApprovePermission: can(owner), row: row() }), true);
    assert.equal(canDecideRow({ ...base, canApprovePermission: can(manager), row: row() }), true);
    assert.equal(canDecideRow({ ...base, canApprovePermission: can(receptionist), row: row() }), false);
    assert.equal(canDecideRow({ ...base, canApprovePermission: can(accountant), row: row() }), false);
    assert.equal(canDecideRow({ ...base, canApprovePermission: can({ role: "OWNER" }), row: row() }), false); // old server, no permissions[]
    assert.equal(canDecideRow({ ...base, canApprovePermission: can(undefined), row: row() }), false);
  });
});

describe("reasonProblem: 5-300 characters, as the server checks", () => {
  it("accepts 5..300 after trimming", () => {
    assert.equal(reasonProblem("Đã đối chiếu ảnh"), null);
    assert.equal(reasonProblem("abcde"), null);
    assert.equal(reasonProblem("a".repeat(REASON_MAX)), null);
  });
  it("refuses short, blank and too long", () => {
    assert.match(reasonProblem("") ?? "", /ít nhất 5/);
    assert.match(reasonProblem("   ab  ") ?? "", /ít nhất 5/);
    assert.match(reasonProblem("a".repeat(REASON_MAX + 1)) ?? "", /tối đa 300/);
  });
});

describe("confirmation text", () => {
  it("names the action, member and branch", () => {
    assert.equal(decisionTitle("approve", "Nguyễn An", "Q1"), "Duyệt ngoại lệ check-in cho Nguyễn An tại Q1");
    assert.equal(decisionTitle("reject", "Nguyễn An", "Q1"), "Từ chối ngoại lệ check-in cho Nguyễn An tại Q1");
    assert.equal(DECISION_TEXT.approve.confirm, "Xác nhận duyệt");
    assert.equal(DECISION_TEXT.reject.confirm, "Xác nhận từ chối");
  });
});

describe("decisionRefusal: stable server codes -> readable Vietnamese, never the code", () => {
  const err = (status: number, code?: string) => ({ response: { status, data: { success: false, error: code ? { code } : {} } } });
  it("maps every code the decide route can answer", () => {
    const cases: Record<string, { reload: boolean; retry: boolean }> = {
      EXCEPTION_SELF_APPROVAL: { reload: false, retry: false },
      EXCEPTION_ALREADY_DECIDED: { reload: true, retry: false },
      EXCEPTION_EXPIRED: { reload: true, retry: false },
      EXCEPTION_NOT_FOUND: { reload: true, retry: false },
      REASON_REQUIRED: { reload: false, retry: true },
      VALIDATION_ERROR: { reload: false, retry: true },
      PERMISSION_DENIED: { reload: false, retry: false },
      OWNER_ROLE_REQUIRED: { reload: false, retry: false },
      GYM_OUT_OF_SCOPE: { reload: false, retry: false },
    };
    for (const [code, flags] of Object.entries(cases)) {
      const r = decisionRefusal(err(400, code));
      assert.equal(r.reload, flags.reload, code);
      assert.equal(r.retry, flags.retry, code);
      assert.equal(r.text.includes(code), false, code);
      assert.ok(r.text.length > 10, code);
    }
  });
  it("falls back by HTTP status, then to a plain sentence", () => {
    assert.equal(decisionRefusal(err(410)).reload, true);
    assert.equal(decisionRefusal(err(409)).reload, true);
    assert.match(decisionRefusal(err(403)).text, /không có quyền/);
    assert.equal(decisionRefusal(err(429)).retry, true);
    assert.match(decisionRefusal(err(500)).text, /Có lỗi xảy ra/);
    assert.match(decisionRefusal(new Error("Network Error")).text, /Không kết nối được máy chủ/);
  });
});
