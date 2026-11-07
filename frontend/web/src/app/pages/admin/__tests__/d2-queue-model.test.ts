/**
 * D2 / M1 - queue model. Evidence label: TEST FIXTURE (pure functions; no server, no browser).
 * Run: npx tsx --test src/app/pages/admin/__tests__/d2-queue-model.test.ts (from frontend/web)
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import * as Q from "../disputes/queue/queueModel";
import { describeAdminError } from "../shared/useAdminError";
import { parseDisputeError, parseDisputeErrorBody } from "../disputes/disputeCaseErrors";
import { CASE_STATUSES } from "../disputes/disputeCaseTypes";
import { errBodies } from "../disputes/__fixtures__/disputeCaseFixtures";

const sp = (q: string) => new URLSearchParams(q);

describe("D2 queue - URL state", () => {
  it("defaults are cases / no status / page 1 and the plain URL stays clean", () => {
    assert.deepEqual(Q.parseQueueState(sp("")), { view: "cases", status: null, page: 1 });
    assert.deepEqual(Q.buildQueueParams({ view: "cases", status: null, page: 1 }), {});
  });
  it("every one of the 11 statuses round-trips; unknown / hostile values fall back", () => {
    for (const s of CASE_STATUSES) assert.equal(Q.parseQueueState(sp(`status=${s}`)).status, s);
    for (const bad of ["escalated", "ESCALATED", "intake", "<script>", "", "DECISION_APPROVED;DROP"]) assert.equal(Q.parseStatus(bad), null, bad);
    assert.equal(Q.parseView("nope"), "cases");
  });
  it("page is a positive integer within the server offset cap, else 1", () => {
    assert.equal(Q.parsePage("3"), 3);
    for (const bad of ["0", "-1", "abc", "1.5", "999999", "2002", null, undefined, ""]) assert.equal(Q.parsePage(bad as string), 1, String(bad));
    assert.equal(Q.parsePage("2001"), 2001);
    // offset of the last page stays <= 100000 (A2 limit)
    assert.ok(Q.offsetOfPage(Q.MAX_PAGE) <= 100_000);
  });
  it("status and page only exist in the cases view", () => {
    assert.deepEqual(Q.parseQueueState(sp("view=sessions&status=INTAKE&page=4")), { view: "sessions", status: null, page: 1 });
    assert.deepEqual(Q.buildQueueParams({ view: "sessions", status: "INTAKE", page: 4 }), { view: "sessions" });
    assert.deepEqual(Q.buildQueueParams({ view: "cases", status: "INTAKE", page: 4 }), { status: "INTAKE", page: "4" });
  });
  it("no 'escalated' view exists", () => {
    assert.deepEqual([...Q.QUEUE_VIEWS], ["cases", "sessions", "stuck"]);
  });
});

describe("D2 queue - paging", () => {
  it("limit 50, offset = (page-1)*50, page count from the server total", () => {
    assert.equal(Q.PAGE_SIZE, 50);
    assert.equal(Q.offsetOfPage(1), 0);
    assert.equal(Q.offsetOfPage(3), 100);
    assert.equal(Q.pageCountOf(0), 1);
    assert.equal(Q.pageCountOf(50), 1);
    assert.equal(Q.pageCountOf(51), 2);
    assert.equal(Q.pageCountOf(230), 5);
  });
  it("range text uses the real total", () => {
    assert.equal(Q.rangeText(1, 230, 50), "1–50 trên 230");
    assert.equal(Q.rangeText(5, 230, 30), "201–230 trên 230");
    assert.equal(Q.rangeText(1, 0, 0), null);
  });
  it("normalizeCaseItems keeps the server total and counts unreadable rows", () => {
    const r = Q.normalizeCaseItems({ total: 120, items: [{ id: "a", status: "INTAKE" }, { nope: 1 }, null] });
    assert.equal(r.total, 120);
    assert.equal(r.items.length, 1);
    assert.equal(r.ignored, 2);
    assert.equal(Q.normalizeCaseItems(undefined).total, 0);
  });
});

describe("D2 queue - case row wording", () => {
  it("investigator: none / you / someone else (short ref, never a name we do not have)", () => {
    assert.equal(Q.investigatorText(null, "me"), "Chưa có người phụ trách");
    assert.equal(Q.investigatorText("me", "me"), "Bạn phụ trách");
    assert.equal(Q.investigatorText("abcdef1234567890", "me"), "Người phụ trách: mã abcdef12");
  });
  it("provisional type gets its own chip and a neutral type text", () => {
    assert.equal(Q.isProvisionalType("LEGACY_UNCLASSIFIED"), true);
    assert.equal(Q.isProvisionalType("PT_DELIVERY"), false);
    assert.equal(Q.typeColumnText("LEGACY_UNCLASSIFIED"), "Chưa phân loại");
    assert.equal(Q.typeColumnText("PT_NO_SHOW_CLAIM"), "Khách báo PT vắng, PT phản đối");
    assert.equal(Q.typeColumnText("WHATEVER"), "Loại khiếu nại khác");
  });
});

describe("D2 queue - sessions (C1) joined with SLA (C2)", () => {
  const c1 = [
    {
      id: "s2",
      disputedAt: "2026-11-01T00:00:00.000Z",
      scheduledStartAt: "2026-10-30T01:00:00.000Z",
      disputeType: "DELIVERY_DISPUTE",
      clientUserId: "client-aaaa-1111",
      ptUserId: "pt-bbbb-2222",
      disputeReason: "PT không dạy",
      ptNotes: "Đã dạy",
      contract: { packageName: "Gói A" },
    },
    { id: "s1", disputedAt: "2026-10-20T00:00:00.000Z", disputeType: null, clientUserId: "c", ptUserId: "p" },
    { id: "s3", disputedAt: "2026-10-25T00:00:00.000Z", disputeType: "CLIENT_NO_SHOW_CLAIM", clientUserId: "c", ptUserId: "p" },
    { garbage: true },
  ];
  const c2 = { disputes: { items: [{ sessionId: "s2", slaState: "OVERDUE" }, { sessionId: "s1", slaState: "WITHIN_SLA" }, { sessionId: "sx", slaState: "BOGUS" }], truncated: false } };
  it("rows are oldest-first, labelled in Vietnamese, unreadable rows are counted", () => {
    const { rows, ignored } = Q.normalizeDisputedSessions(c1);
    assert.deepEqual(rows.map((r) => r.id), ["s1", "s3", "s2"]);
    assert.equal(ignored, 1);
    assert.equal(rows[0].typeLabel, "Phân loại tạm (cần phân loại)");
    assert.equal(rows[1].typeLabel, "PT báo khách vắng, khách phản đối");
    assert.equal(rows[2].typeLabel, "Khiếu nại báo cáo hoàn thành");
    assert.equal(rows[2].packageName, "Gói A");
    assert.equal(rows[2].clientRef, "client-a");
  });
  it("SLA is joined by sessionId; a session missing from the report has NO chip (never a guess)", () => {
    const { rows } = Q.normalizeDisputedSessions(c1);
    const joined = Q.joinSla(rows, Q.buildSlaIndex(c2));
    const by = Object.fromEntries(joined.map((r) => [r.id, r.sla]));
    assert.deepEqual(by, { s1: "WITHIN_SLA", s3: null, s2: "OVERDUE" });
  });
  it("an unreadable report gives no chips at all and a null index", () => {
    assert.equal(Q.buildSlaIndex(undefined), null);
    assert.equal(Q.buildSlaIndex({ disputes: {} }), null);
    const { rows } = Q.normalizeDisputedSessions(c1);
    assert.ok(Q.joinSla(rows, null).every((r) => r.sla === null));
  });
  it("truncated report is remembered so the page can say some sessions have no chip", () => {
    assert.equal(Q.buildSlaIndex({ disputes: { items: [], truncated: true } })?.truncated, true);
  });
  it("SLA labels are plain Vietnamese", () => {
    assert.deepEqual(Object.values(Q.SLA_LABEL), ["Trong hạn xử lý", "Sắp quá hạn xử lý", "Quá hạn xử lý"]);
  });
});

describe("D2 queue - open case result (A1)", () => {
  it("created:true and created:false both give a case to navigate into", () => {
    assert.deepEqual(Q.readOpenCaseResult({ created: true, case: { id: "c1" } }), { caseId: "c1", created: true });
    assert.deepEqual(Q.readOpenCaseResult({ created: false, case: { id: "c9" } }), { caseId: "c9", created: false });
  });
  it("an answer without a case is not a success", () => {
    assert.equal(Q.readOpenCaseResult({ created: true }), null);
    assert.equal(Q.readOpenCaseResult(null), null);
  });
});

describe("D2 queue - legacy ruling wording", () => {
  it("has the disclosure label and a warning sentence", () => {
    assert.equal(Q.LEGACY_DISCLOSURE_LABEL, "Phán quyết theo đường cũ (một người duyệt, không qua hồ sơ)");
    assert.match(Q.LEGACY_WARNING, /một quản trị viên/);
    assert.match(Q.LEGACY_WARNING, /không đọc hồ sơ/);
  });
  it("same three buttons as the old page", () => {
    assert.deepEqual(Q.LEGACY_RESOLUTIONS.map((r) => Q.LEGACY_BUTTON_LABEL[r]), ["Buổi tập đã diễn ra", "Xác nhận PT vắng mặt", "Buổi tập không diễn ra"]);
  });
  it("DQ-2(a): PT absent = refund AND the session right is still used; never 'buổi tập không bị trừ'", () => {
    const pt = Q.legacyEffects("PT_NO_SHOW_CONFIRMED").join(" ");
    assert.match(pt, /vẫn mất 1 quyền buổi/);
    assert.match(pt, /không có buổi bù/);
    assert.match(pt, /Hoàn cho khách/);
    for (const r of Q.LEGACY_RESOLUTIONS) {
      const all = [...Q.legacyEffects(r), Q.LEGACY_NOTICE, Q.LEGACY_WARNING].join(" ");
      assert.doesNotMatch(all, /buổi tập không bị trừ/i);
      assert.doesNotMatch(all, /D77|B-1|FH-|I6/);
    }
  });
  it("the dialog never carries an amount field (the server computes it)", () => {
    for (const r of Q.LEGACY_RESOLUTIONS) assert.ok(Q.legacyEffects(r).some((e) => /không cho nhập số tiền/.test(e)));
  });
});

describe("D2 queue - errors reach the confirm dialog in dispute wording", () => {
  const http = (status: number, data: unknown) => ({ response: { status, data } });
  it("POLICY_ELIGIBILITY_UNVERIFIED -> 409 with the mapped sentence, blocked for a blind retry", () => {
    const mapped = describeAdminError(Q.toDialogError(http(409, { error: "Contract policy", code: "POLICY_ELIGIBILITY_UNVERIFIED" })), { action: "write" });
    assert.equal(mapped.message, parseDisputeErrorBody(409, { code: "POLICY_ELIGIBILITY_UNVERIFIED" }).message);
    assert.match(mapped.message, /chưa có kết luận áp dụng chính sách/);
    assert.equal(mapped.stale, true);
    assert.equal(mapped.ambiguous, false);
  });
  it("each refusal keeps its own sentence", () => {
    for (const code of ["POLICY_EXCEPTION_APPLIES", "CANCELLED_BLOCKED_BY_D77", "CONTRACT_ENDING", "SESSION_ALREADY_PROCESSED", "CASE_REQUIRED"]) {
      const expected = parseDisputeErrorBody(409, { code }).message;
      const mapped = describeAdminError(Q.toDialogError(http(409, { error: "x", code })), { action: "write" });
      assert.equal(mapped.message, expected, code);
    }
  });
  it("validation (400) stays retryable; forbidden keeps a Vietnamese message", () => {
    const v = describeAdminError(Q.toDialogError(http(400, { error: "bad", code: "INVALID_INPUT", fields: [] })), { action: "write" });
    assert.equal(v.stale, false);
    assert.match(v.message, /chưa hợp lệ/);
    const f = describeAdminError(Q.toDialogError(http(403, errBodies.gatewayForbidden)), { action: "write" });
    assert.match(f.message, /quyền/);
  });
  it("no answer / 5xx = outcome unknown, passed through untouched", () => {
    const net = new Error("Network Error");
    assert.equal(Q.toDialogError(net), net);
    const five = http(500, errBodies.internal);
    assert.equal(Q.toDialogError(five), five);
    assert.equal(describeAdminError(Q.toDialogError(five), { action: "write" }).ambiguous, true);
  });
});

describe("D2 queue - list failure is never an empty list", () => {
  it("network, server and forbidden each say what happened", () => {
    const net = Q.describeListFailure(parseDisputeError(new Error("Network Error")), "cases");
    assert.equal(net.kind, "network");
    assert.match(net.body, /không phải là «không có hồ sơ nào»/);
    assert.equal(net.canReload, true);
    const srv = Q.describeListFailure(parseDisputeErrorBody(500, errBodies.internal), "sessions");
    assert.match(srv.title, /danh sách buổi chưa xử lý/);
    const forbidden = Q.describeListFailure(parseDisputeErrorBody(403, errBodies.gatewayForbidden), "cases");
    assert.equal(forbidden.kind, "forbidden");
    assert.equal(forbidden.canReload, false);
  });
});

describe("D2 queue - V2.1 queue contract", () => {
  it("supports both session statuses, case ownership and server paging", () => {
    const q = Q.normalizeQueueItems({ total: 120, hasMore: true, items: [
      { sessionId: "s1", sessionStatus: "DISPUTED", clientUserId: "client-1", ptUserId: "pt-1", clientName: "An", ptName: "Bình", hasCase: true, needsCase: false, caseId: "case-1" },
      { sessionId: "s2", sessionStatus: "PT_NO_SHOW_REPORTED", clientUserId: "client-2", ptUserId: "pt-2", clientName: "Chi", ptName: "Dũng", hasCase: false, needsCase: true, caseId: null },
    ] });
    assert.equal(q.total, 120);
    assert.equal(q.hasMore, true);
    assert.equal(q.rows.length, 2);
    assert.equal(q.rows[0].caseId, "case-1");
    assert.equal(q.rows[0].clientName, "An");
    assert.equal(q.rows[1].sessionStatus, "PT_NO_SHOW_REPORTED");
    assert.equal(q.rows[1].needsCase, true);
  });
  it("keeps the honest no-polling note", () => {
    assert.match(Q.CASES_NOTE_NO_POLLING, /không tự làm mới/);
  });
});
