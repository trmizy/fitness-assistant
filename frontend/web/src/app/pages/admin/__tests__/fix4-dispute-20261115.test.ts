/**
 * FIX4-DISPUTE 15/11/2026 - N15B-01/02/03/04/05/06/08. CODE AUDIT-level unit tests of the pure helpers (+ source guards for wiring); no browser.
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { adminNameOf, adminWhoLabel, clearAdminNames, rememberAdminNames } from "../disputes/workspace/adminNames";
import { eventActor, eventNote } from "../disputes/workspace/workspaceModel";
import { investigatorText } from "../disputes/queue/queueModel";
import { describePolicyReviews } from "../disputes/workspace/policyModel";
import {
  buildSuspendBody,
  LIFT_EFFECT,
  ptAccountState,
  ptSuspensionError,
  publicReasonError,
  SUSPEND_CATEGORY_OPTIONS,
  SUSPEND_EFFECT,
  suspensionReasonError,
} from "../ptSuspension";
import { partyAppealStatusView } from "../../disputes/partyModel";
import { sessionsToClose, sessionWhenLabel } from "../../pt/sessionsToClose";
import { optionLabel, TARGET_GROUP_OPTIONS, TRAINING_GOAL_OPTIONS } from "../../../utils/ptListing";
import { CONTRACT_STATUS_VI, SESSION_STATUS_VI, viLabel } from "../../../utils/labels.vi";
import { parseUserRole, parseUserStatus } from "../shared/b9bUrlState";

const ROOT = join(process.cwd(), "src");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const UUID = "d0d00000-1111-4222-8333-444444444444";

describe("N15B-01: admins are shown by name, never as a code", () => {
  beforeEach(() => clearAdminNames());

  it("history/overview actor: self -> Bạn, directory name, otherwise a neutral phrase (no 'mã')", () => {
    rememberAdminNames([{ id: UUID, displayName: "Lê Quản Trị" }]);
    assert.equal(eventActor({ actorUserId: "me", actorRole: "ADMIN" }, "me"), "Bạn");
    assert.equal(eventActor({ actorUserId: UUID, actorRole: "ADMIN" }, "me"), "Lê Quản Trị");
    clearAdminNames();
    const unknown = eventActor({ actorUserId: UUID, actorRole: "ADMIN" }, "me");
    assert.equal(unknown, "Quản trị viên khác");
    assert.ok(!/mã|d0d00000/i.test(unknown));
    assert.equal(eventActor({ actorUserId: "c1", actorRole: "CLIENT" }, "me"), "Khách");
  });

  it("directory shapes: bare array, {items}, {data}", () => {
    rememberAdminNames({ items: [{ id: "a", displayName: "An" }] });
    rememberAdminNames({ data: [{ id: "b", name: "Bình" }] });
    assert.equal(adminNameOf("a"), "An");
    assert.equal(adminNameOf("b"), "Bình");
    assert.equal(adminNameOf("zzz"), null);
    rememberAdminNames(null);
    rememberAdminNames("x");
  });

  it("approvals / policy / assignment helpers use the same label", () => {
    rememberAdminNames([{ id: UUID, displayName: "Lê Quản Trị" }]);
    assert.equal(adminWhoLabel(UUID, "me"), "Lê Quản Trị");
    assert.equal(adminWhoLabel(UUID, UUID), "Bạn");
    assert.equal(adminWhoLabel(null, "me"), "—");
    assert.equal(investigatorText(UUID, "me"), "Người phụ trách: Lê Quản Trị");
    const v = describePolicyReviews({ policyReviews: { items: [] } as never, case: { id: "c" } }, [], "me");
    assert.ok(v);
  });

  it("an old event note 'reviewer <uuid>' is shown in words, other uuid notes are dropped", () => {
    assert.equal(eventNote({ note: `reviewer ${UUID}` }), "Đã giao người xem xét lại yêu cầu");
    assert.equal(eventNote({ note: `obligation ${UUID} OPEN` }), null);
    assert.equal(eventNote({ note: "Đã giao người xem xét lại yêu cầu" }), "Đã giao người xem xét lại yêu cầu");
  });

  it("source guards: no 'mã <id>' left for admins on the three tabs; the workspace page loads the directory", () => {
    assert.ok(!/mã \$\{shortRef\(p\.proposerId\)\}|Mã \$\{shortRef\(a\.approverId\)\}/.test(read("app/pages/admin/disputes/workspace/tabs/ApprovalsTab.tsx")));
    assert.match(read("app/pages/admin/disputes/workspace/AdminDisputeCasePage.tsx"), /listAdminOptions\(userId\)/);
    assert.match(read("app/pages/admin/disputes/actions/adminDirectory.ts"), /rememberAdminNames\(data\)/);
  });

  it("backend note carries no uuid (id stays in the event detail)", () => {
    const src = readFileSync(join(process.cwd(), "..", "..", "backend", "services", "user-service", "src", "services", "dispute-case", "process.service.ts"), "utf8");
    assert.ok(!/note: `reviewer \$\{/.test(src));
    assert.match(src, /note: "Đã giao người xem xét lại yêu cầu", detail: \{ appealId: ap\.id, reviewerId: b\.reviewerId \}/);
  });
});

describe("N15B-04: admin suspend / lift a PT", () => {
  it("state comes from the open ACCOUNT-scope episode only", () => {
    assert.equal(ptAccountState([]).kind, "ACTIVE");
    assert.equal(ptAccountState(null).kind, "ACTIVE");
    assert.equal(ptAccountState([{ id: "1", scope: "ACCOUNT", type: "TEMPORARY_SUSPENSION", endedAt: "2026-11-01T00:00:00Z" }]).kind, "ACTIVE", "an ended episode is history");
    assert.equal(ptAccountState([{ id: "2", scope: "CONTRACT", type: "TEMPORARY_SUSPENSION", endedAt: null }]).kind, "ACTIVE", "a contract-only restriction leaves the PT active");
    assert.equal(ptAccountState([{ id: "3", scope: "ACCOUNT", type: "TEMPORARY_SUSPENSION", endedAt: null }]).kind, "SUSPENDED");
    assert.equal(ptAccountState([{ id: "4", scope: "ACCOUNT", type: "PERMANENT_BAN", endedAt: null }]).kind, "BANNED");
  });

  it("body follows the backend contract (category, reason<=1000, optional publicReason<=500)", () => {
    assert.deepEqual(buildSuspendBody("OTHER", "  lý do  ", "  "), { category: "OTHER", reason: "lý do" });
    assert.deepEqual(buildSuspendBody("PAYMENT_REVIEW", "x", " nhắn "), { category: "PAYMENT_REVIEW", reason: "x", publicReason: "nhắn" });
    assert.ok(suspensionReasonError(""));
    assert.ok(suspensionReasonError("   "));
    assert.equal(suspensionReasonError("ok"), null);
    assert.ok(suspensionReasonError("x".repeat(1001)));
    assert.equal(publicReasonError("x".repeat(500)), null);
    assert.ok(publicReasonError("x".repeat(501)));
    assert.ok(SUSPEND_CATEGORY_OPTIONS.every((o) => o.value !== ("UNSPECIFIED" as string)));
  });

  it("effect text names search, sessions and contracts; errors are Vietnamese", () => {
    assert.match(SUSPEND_EFFECT, /ẩn khỏi tìm kiếm/);
    assert.match(SUSPEND_EFFECT, /Hợp đồng đang chạy được giữ nguyên/);
    assert.match(LIFT_EFFECT, /cộng bù/);
    assert.match(ptSuspensionError({ response: { data: { code: "PT_ALREADY_BANNED", error: "x" } } }), /khoá vĩnh viễn/);
    assert.equal(ptSuspensionError({ response: { data: { error: "Lý do là bắt buộc" } } }), "Lý do là bắt buộc");
    assert.match(ptSuspensionError(new Error("Network Error")), /Không thực hiện được/);
  });

  it("PT page: the APPROVED note points at the real action, the card is wired, only for APPROVED with a user id", () => {
    const src = read("app/pages/admin/PTManagement.tsx");
    assert.ok(!/tạm khóa hoặc ngừng hoạt động/.test(src));
    assert.match(src, /Trạng thái hoạt động/);
    assert.match(src, /app\.status === "APPROVED" && app\.user\?\.userId/);
    const svc = read("app/services/adminPtRestrictionService.ts");
    assert.match(svc, /\/suspend`/);
    assert.match(svc, /\/lift-suspension`/);
  });
});

describe("N15B-02: the party sees its own appeal", () => {
  it("no appeal -> nothing; requested / under review -> 'Đang xem xét lại'", () => {
    assert.equal(partyAppealStatusView(undefined), null);
    assert.equal(partyAppealStatusView({ used: false }), null);
    const req = partyAppealStatusView({ used: true, status: "REQUESTED", requestedAt: "2026-11-10T03:00:00Z" });
    assert.equal(req?.badge, "Đang xem xét lại");
    assert.match(req?.detail ?? "", /chưa thay đổi/);
    assert.equal(partyAppealStatusView({ used: true, status: "UNDER_REVIEW" })?.badge, "Đang xem xét lại");
  });

  it("decided -> the result in words (no enum, no reasoning)", () => {
    const kept = partyAppealStatusView({ used: true, status: "DECIDED", result: "UPHELD", decidedAt: "2026-11-12T03:00:00Z" });
    assert.equal(kept?.badge, "Đã có kết quả");
    assert.match(kept?.headline ?? "", /giữ nguyên/);
    const changed = partyAppealStatusView({ used: true, status: "DECIDED", result: "NEW_FINDING" });
    assert.match(changed?.headline ?? "", /kết luận mới/);
    for (const v of [kept, changed]) assert.ok(!/UPHELD|NEW_FINDING|DECIDED/.test(JSON.stringify(v)));
  });

  it("the page shows the panel when the form is gone; the form also toasts", () => {
    assert.match(read("app/pages/disputes/DisputeCasePartyPage.tsx"), /partyAppealStatusView\(detail\.appeal\)/);
    assert.match(read("app/pages/disputes/PartyAppealForm.tsx"), /toast\.success\(APPEAL_SUCCESS_TEXT\)/);
  });
});

describe("N15B-03: approval snapshot shows Vietnamese statuses", () => {
  it("DISPUTED / PT_NO_SHOW_REPORTED / contract statuses are labelled", () => {
    assert.equal(viLabel(SESSION_STATUS_VI, "DISPUTED"), "Đang khiếu nại");
    assert.equal(viLabel(SESSION_STATUS_VI, "PT_NO_SHOW_REPORTED"), "PT bị báo vắng mặt");
    assert.equal(viLabel(CONTRACT_STATUS_VI, "ACTIVE"), "Đang hoạt động");
    const src = read("app/pages/admin/disputes/actions/ReplacementPanel.tsx");
    assert.match(src, /viLabel\(SESSION_STATUS_VI, String\(item\.checksAtApproval\.sessionStatus\)\)/);
    assert.ok(!/\(snapshot\)/.test(src));
  });
});

describe("N15B-05: admin Users", () => {
  it("filters that can never match are gone (list excludes admins, no Pending status)", () => {
    assert.equal(parseUserRole("Admin"), "All");
    assert.equal(parseUserStatus("Pending"), "All");
    const src = read("app/pages/admin/UserManagement.tsx");
    assert.ok(!/<option value="Admin">/.test(src));
    assert.ok(!/<option value="Pending">/.test(src));
  });

  it("dialog buttons are 40px (size lg) and CUSTOMER is 'Hội viên'", () => {
    const src = read("app/pages/admin/UserManagement.tsx");
    assert.ok(!/label: "Khách hàng"/.test(src));
    assert.match(src, /\{ value: "CUSTOMER", label: "Hội viên" \}/);
    assert.equal((src.match(/size="lg"/g) ?? []).length >= 4, true);
    assert.match(read("app/components/ui/button.tsx"), /lg: "h-10/);
  });
});

describe("N15B-06: PT schedule 'Cần chốt buổi'", () => {
  const now = Date.parse("2026-11-15T12:00:00Z");
  const row = (id: string, status: string, mode: string, startH: number, endH: number) => ({
    id,
    status,
    sessionMode: mode,
    scheduledStartAt: new Date(now + startH * 3600_000).toISOString(),
    scheduledEndAt: new Date(now + endH * 3600_000).toISOString(),
  });
  it("only CONFIRMED in-person sessions already over, newest first", () => {
    const rows = [row("a", "CONFIRMED", "OFFLINE", -5, -4), row("b", "CONFIRMED", "ONLINE", -5, -4), row("c", "CONFIRMED", "OFFLINE", -1, 1), row("d", "REQUESTED", "OFFLINE", -9, -8), row("e", "CONFIRMED", "OFFLINE", -30, -29)];
    assert.deepEqual(sessionsToClose(rows, now).map((s) => s.id), ["a", "e"]);
    assert.deepEqual(sessionsToClose(null, now), []);
  });
  it("label shows time range and date; page wiring + 40px action", () => {
    assert.match(sessionWhenLabel({ scheduledStartAt: "2026-11-12T11:30:00Z", scheduledEndAt: "2026-11-12T12:30:00Z" }), /\d{2}:\d{2} – \d{2}:\d{2}, \d{2}\/\d{2}\/2026/);
    const src = read("app/pages/pt/PTSchedulePage.tsx");
    assert.match(src, /listAwaitingCompletion/);
    assert.match(src, /Cần chốt buổi/);
    assert.match(src, /min-h-10[^"]*"[\s\S]{0,200}Hoàn thành/);
    assert.match(read("app/services/api.ts"), /\/sessions\/awaiting-completion/);
  });
});

describe("N15B-08: admin PT detail labels + register labels", () => {
  it("stored English goal / audience values read in Vietnamese; unknown values stay as typed", () => {
    assert.equal(optionLabel(TRAINING_GOAL_OPTIONS, "Fat Loss & Body Recomposition"), "Giảm mỡ & tái cấu trúc cơ thể");
    assert.equal(optionLabel(TARGET_GROUP_OPTIONS, "Seniors"), "Người cao tuổi");
    assert.equal(optionLabel(TARGET_GROUP_OPTIONS, "Người chạy bộ"), "Người chạy bộ");
    const src = read("app/pages/admin/PTManagement.tsx");
    assert.match(src, /optionLabel\(TARGET_GROUP_OPTIONS, t\)/);
    assert.match(src, /optionLabel\(TRAINING_GOAL_OPTIONS, g\)/);
  });
  it("register page: every field has a visible label bound with htmlFor", () => {
    const src = read("app/pages/auth/RegisterPage.tsx");
    for (const id of ["register-full-name", "register-email", "register-password"]) {
      assert.match(src, new RegExp(`htmlFor="${id}"`));
      assert.match(src, new RegExp(`id="${id}"`));
    }
    assert.match(src, /htmlFor="register-otp"/);
  });
});
