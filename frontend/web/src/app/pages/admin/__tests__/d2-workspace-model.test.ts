/**
 * D2 / M2, M5, M6 - workspace model. Evidence label: TEST FIXTURE (pure functions + fixtures copied from real shapes; no server, no browser).
 * Run: npx tsx --test src/app/pages/admin/__tests__/d2-workspace-model.test.ts (from frontend/web)
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import * as W from "../disputes/workspace/workspaceModel";
import * as S from "../disputes/workspace/actionSlots";
import { parseDisputeError, parseDisputeErrorBody } from "../disputes/disputeCaseErrors";
import { CASE_STATUSES, EXEC_STATUSES, FINDING_KINDS, type DisputeCaseDetail } from "../disputes/disputeCaseTypes";
import { ALL_FINANCIAL_STATES, EXECUTION_LIE, IDS, decisionRaw, detailFixture, errBodies, financialItem, financialViewFixture } from "../disputes/__fixtures__/disputeCaseFixtures";

const withCase = (over: Record<string, unknown>, d: DisputeCaseDetail = detailFixture()): DisputeCaseDetail => ({ ...d, case: { ...d.case, ...over } as never });

describe("D2 workspace - tabs in the URL", () => {
  it("nine tabs in the briefed order and wording", () => {
    assert.deepEqual(
      W.WORKSPACE_TABS.map((t) => t.label),
      ["Tổng quan", "Bằng chứng", "Lời khai", "Đánh giá", "Kết luận & đề xuất", "Phê duyệt", "Tiền", "Thực thi", "Lịch sử"],
    );
  });
  it("parseTab is total; the default tab leaves the URL clean", () => {
    for (const t of W.WORKSPACE_TABS) assert.equal(W.parseTab(t.id), t.id);
    for (const bad of ["", "nope", "OVERVIEW", "money;x", null, undefined]) assert.equal(W.parseTab(bad as string), "overview");
    assert.equal(W.tabParamOf("overview"), null);
    assert.equal(W.tabParamOf("money"), "money");
  });
  it("case id from the path is a plain token", () => {
    assert.equal(W.parseCaseIdParam("11111111-1111-4111-8111-111111111111"), "11111111-1111-4111-8111-111111111111");
    for (const bad of ["", "a/b", "a b", "../x", "x".repeat(65), null, undefined]) assert.equal(W.parseCaseIdParam(bad as string), null);
  });
  it("counts are numbers, not verdicts", () => {
    const c = W.tabCounts(detailFixture());
    assert.deepEqual(c, { evidence: 3, statements: 1, assessments: 1, findings: 1, approvals: 1, history: 1 });
  });
});

describe("D2 workspace - 'Đang chờ' note by status", () => {
  it("every one of the 11 statuses has a note", () => {
    for (const s of CASE_STATUSES) assert.ok(W.WAITING_NOTE[s].length > 10, s);
    assert.match(W.waitingNote("WHATEVER"), /Chưa rõ/);
  });
  it("AWAITING_PARTIES says the parties are not notified and there is no deadline (R-12)", () => {
    assert.match(W.WAITING_NOTE.AWAITING_PARTIES, /chưa được hệ thống tự báo/);
    assert.match(W.AWAITING_PARTIES_NOTE, /chưa tự báo cho các bên/);
  });
  it("no note shows an internal code", () => {
    for (const s of CASE_STATUSES) assert.doesNotMatch(W.WAITING_NOTE[s], /D77|B-1|[A-Z]{4,}_[A-Z]{2,}/);
  });
});

describe("D2 workspace - stuck states say who decides and offer no close action", () => {
  it("POLICY_PENDING, FINDING_RECORDED with NOT_A_DISPUTE, DECISION_APPROVED", () => {
    const pp = W.stuckState(withCase({ status: "POLICY_PENDING" }));
    assert.match(pp!.owner, /chủ dự án/);
    const nad = detailFixture();
    nad.findings = [{ ...nad.findings[0], finding: "NOT_A_DISPUTE" }];
    const stuck = W.stuckState({ ...withCase({ status: "FINDING_RECORDED" }, nad) });
    assert.match(stuck!.title, /Không phải khiếu nại/);
    const approved = W.stuckState(withCase({ status: "DECISION_APPROVED" }));
    assert.match(approved!.body, /thực thi/);
    for (const s of [pp, stuck, approved]) assert.doesNotMatch(JSON.stringify(s), /đóng hồ sơ ngay|nút đóng/i);
  });
  it("other states, and FINDING_RECORDED with a normal finding, are not stuck", () => {
    for (const s of ["INTAKE", "COLLECTING", "AWAITING_PARTIES", "ASSESSING", "AWAITING_APPROVAL", "REJECTED_INTAKE"]) assert.equal(W.stuckState(withCase({ status: s })), null, s);
    assert.equal(W.stuckState(withCase({ status: "FINDING_RECORDED" })), null);
  });
  it("latestFinding is by time", () => {
    const f = detailFixture().findings[0];
    const older = { ...f, id: "x", createdAt: "2026-10-01T00:00:00.000Z", finding: "NOT_A_DISPUTE" as const };
    assert.equal(W.latestFinding([older, f])!.id, f.id);
    assert.equal(W.latestFinding([]), null);
  });
});

describe("D2 workspace - execution-blocked banner", () => {
  it("decision.executionBlockedReason gives business wording, never the code", () => {
    const d = { ...withCase({ status: "DECISION_APPROVED" }), decision: { proposalId: IDS.proposal, outcome: "COMPLETED", executionBlockedReason: "D77_COMBINATION_UNRESOLVED" } } as DisputeCaseDetail;
    const b = W.blockedBanner(d)!;
    assert.match(b, /khoản đền đến muộn/);
    assert.doesNotMatch(b, /D77|UNRESOLVED/);
  });
  it("unknown reason -> neutral sentence", () => {
    const d = { ...detailFixture(), decision: { proposalId: "p", outcome: "COMPLETED", executionBlockedReason: "SOMETHING_NEW" } } as unknown as DisputeCaseDetail;
    assert.equal(W.blockedBanner(d), W.BLOCKED_BANNER_UNKNOWN);
  });
  it("no reason -> no banner; an open proposal with a reason warns 'sẽ được duyệt'", () => {
    assert.equal(W.blockedBanner(detailFixture()), null);
    const d = detailFixture();
    d.proposals = [{ ...d.proposals[0], executionBlockedReason: "D77_COMBINATION_UNRESOLVED" }];
    assert.match(W.blockedBanner(d)!, /sẽ được duyệt/);
  });
});

describe("D2 workspace - Thực thi tab", () => {
  const constantLie = (): DisputeCaseDetail => {
    const d = withCase({ status: "DECISION_APPROVED" });
    return { ...d, decision: { ...decisionRaw } as never, proposals: d.proposals.map((p) => ({ ...p, execution: EXECUTION_LIE })) as never };
  };
  it("execStatus absent -> 'Chưa đọc được trạng thái thực thi' and, for DECISION_APPROVED, 'Đã duyệt. Chưa đọc được trạng thái thực thi.' (never 'Chưa thực thi')", () => {
    const v = W.describeExecution(constantLie());
    assert.equal(v.readable, false);
    assert.equal(v.headline, "Chưa đọc được trạng thái thực thi");
    assert.ok(v.lines.includes("Đã duyệt. Chưa đọc được trạng thái thực thi."));
    assert.ok(!v.lines.some((l) => /Chưa thực thi/.test(l)), "absent execStatus must not claim 'not executed'");
    assert.equal(v.showTable, false);
    const other = W.describeExecution(withCase({ status: "AWAITING_APPROVAL" }));
    assert.equal(other.readable, false);
    assert.ok(!other.lines.includes("Đã duyệt. Chưa đọc được trạng thái thực thi."));
  });
  it("never derives anything from the constant `execution` (BLOCKED: SLICE_2_NOT_ENABLED)", () => {
    const text = JSON.stringify(W.describeExecution(constantLie()));
    assert.doesNotMatch(text, /SLICE_2|BLOCKED:/);
  });
  it("execStatus present (forward compatible): all five states and the reason of EXEC_BLOCKED", () => {
    for (const status of EXEC_STATUSES) {
      const v = W.describeExecution(withCase({ status: "DECISION_APPROVED", execStatus: status }));
      assert.equal(v.readable, true, status);
      assert.equal(v.status, status);
      assert.equal(v.showTable, true);
    }
    const blocked = W.describeExecution(withCase({ status: "DECISION_APPROVED", execStatus: "EXEC_BLOCKED", execBlockReason: "CONTRACT_ENDING" }));
    assert.match(blocked.lines[0], /Hợp đồng đang kết thúc/);
    const unknownReason = W.describeExecution(withCase({ status: "DECISION_APPROVED", execStatus: "EXEC_BLOCKED", execBlockReason: "NEW_THING" }));
    assert.equal(unknownReason.lines[0], "Lý do chưa rõ.");
    const done = W.describeExecution(withCase({ status: "DECISION_APPROVED", execStatus: "BUSINESS_DONE" }));
    assert.match(done.lines.join(" "), /không phải xác nhận tiền đã về/);
    assert.doesNotMatch(done.lines.join(" "), /ngân hàng đã chuyển/i);
  });
  it("execStatus can also come from the decision; an unknown value is treated as unreadable", () => {
    const d = { ...withCase({ status: "DECISION_APPROVED" }), decision: { proposalId: "p", outcome: "COMPLETED", executionBlockedReason: null, execStatus: "NEEDS_HUMAN" } } as DisputeCaseDetail;
    assert.equal(W.describeExecution(d).status, "NEEDS_HUMAN");
    assert.equal(W.describeExecution(withCase({ execStatus: "BOGUS" })).readable, false);
  });
  it("the state table covers the five states, NEEDS_HUMAN has no exit action", () => {
    assert.deepEqual(W.EXEC_TABLE.map((r) => r.status).sort(), [...EXEC_STATUSES].sort());
    assert.match(W.EXEC_TABLE.find((r) => r.status === "NEEDS_HUMAN")!.next, /Chưa có thao tác thoát/);
  });
});

describe("D2 workspace - Tiền tab", () => {
  it("every one of the 12 financial states produces a described item without arithmetic", () => {
    for (const state of ALL_FINANCIAL_STATES) {
      const d = { ...detailFixture(), financial: financialViewFixture({ items: [financialItem(state)] }) };
      const v = W.describeMoneyTab(d)!;
      assert.equal(v.items.length, 1, state);
      assert.ok(v.items[0].description.label.length > 3, state);
    }
  });
  it("amounts come from ledger.obligation strings, only formatted; ledger.result is never read", () => {
    const item = financialItem("LEDGER_POSTED_PARTIAL");
    (item.ledger as { result: unknown }).result = { owed: "999999999.00", poison: true };
    const v = W.describeMoneyTab({ ...detailFixture(), financial: financialViewFixture({ items: [item] }) })!;
    assert.deepEqual(v.items[0].amounts.map((a) => a.label), ["Nghĩa vụ", "Đã ghi sổ", "Còn lại"]);
    assert.ok(v.items[0].amounts.every((a) => !/999/.test(a.value)));
    assert.match(v.items[0].amounts[2].value, /150\.000/);
  });
  it("UNAVAILABLE is flagged and never shows 0", () => {
    const v = W.describeMoneyTab({ ...detailFixture(), financial: financialViewFixture({ group: "UNAVAILABLE", groupLabel: "Chưa xác định được (không đọc được sổ cái)", items: [financialItem("UNAVAILABLE")] }) })!;
    assert.equal(v.unavailableGroup, true);
    assert.equal(v.items[0].unavailable, true);
    assert.deepEqual(v.items[0].amounts, []);
    assert.match(v.items[0].unavailableText!, /không phải 0/);
  });
  it("NO_RECORDED_SETTLEMENT is its own thing, not 'no money effect'", () => {
    const v = W.describeMoneyTab({ ...detailFixture(), financial: financialViewFixture({ group: "NO_RECORDED_SETTLEMENT", groupLabel: "Chưa có bước quyết toán được ghi nhận", items: [], f3Kind: undefined }) })!;
    assert.equal(v.noRecordedSettlement, true);
    assert.match(W.NO_SETTLEMENT_TEXT, /khác với «không phát sinh tiền»/);
    assert.equal(v.group.group, "NO_RECORDED_SETTLEMENT");
  });
  it("WAIVED / RESOLVED_OTHER never say paid; PAID_VIA_LEDGER says wallet, not bank", () => {
    for (const state of ["OBLIGATION_WAIVED", "OBLIGATION_RESOLVED_OTHER"] as const) {
      const v = W.describeMoneyTab({ ...detailFixture(), financial: financialViewFixture({ items: [financialItem(state)] }) })!;
      const text = JSON.stringify(v.items[0]);
      assert.doesNotMatch(text, /đã trả|đã hoàn|hoàn tất/i, state);
    }
    const w = W.describeMoneyTab({ ...detailFixture(), financial: financialViewFixture({ items: [financialItem("OBLIGATION_PAID_VIA_LEDGER")] }) })!;
    assert.match(w.items[0].description.label, /ví Gymini/);
    assert.doesNotMatch(JSON.stringify(w), /ngân hàng/i);
  });
  it("step titles are business words", () => {
    assert.equal(W.moneyStepTitle("SESSION_RELEASE:x"), "Nhả tiền buổi tập");
    assert.equal(W.moneyStepTitle("PT_NO_SHOW:x"), "Hoàn tiền do PT vắng");
    assert.equal(W.moneyStepTitle("PT_LATE_ARRIVAL:x"), "Khoản đền do PT đến muộn");
    assert.equal(W.moneyStepTitle("UNRESOLVED_SESSION:x"), "Giải quyết buổi bị giữ");
    assert.equal(W.moneyStepTitle("NEW:x"), "Bước tiền khác");
  });
  it("a missing financial block is null (the page says 'chưa đọc được'), not an empty view", () => {
    assert.equal(W.describeMoneyTab({ ...detailFixture(), financial: undefined as never }), null);
  });
});

describe("D2 workspace - finding -> outcome -> consequence table", () => {
  it("six rows, outcome per finding, labelled as illustration", () => {
    const rows = W.findingTable();
    assert.equal(rows.length, FINDING_KINDS.length);
    assert.equal(rows.find((r) => r.finding === "VERIFIED_PT_ABSENT")!.outcomeLabel, "Xác nhận PT vắng mặt");
    assert.equal(rows.find((r) => r.finding === "INSUFFICIENT_EVIDENCE")!.outcomeLabel, "Chưa có kết quả");
    assert.match(W.FINDING_TABLE_CAPTION, /Minh hoạ, máy chủ tính lại/);
  });
  it("DQ-2(a) is kept: PT absent loses the session right, and the wrong sentence is absent everywhere", () => {
    const pt = W.findingTable().find((r) => r.finding === "VERIFIED_PT_ABSENT")!.consequence;
    assert.match(pt, /vẫn mất 1 quyền buổi/);
    for (const r of W.findingTable()) assert.doesNotMatch(r.consequence, /buổi tập không bị trừ/i);
  });
});

describe("D2 workspace - events", () => {
  it("known actions are labelled, unknown ones are neutral (never the raw action)", () => {
    assert.equal(W.eventLabel("INTAKE"), "Mở hồ sơ");
    assert.equal(W.eventLabel("DECISION_APPROVED"), "Duyệt quyết định");
    assert.equal(W.eventLabel("SOMETHING_NEW"), "Thao tác khác");
  });
  it("actor: you / role + short ref", () => {
    assert.equal(W.eventActor({ actorUserId: "me", actorRole: "ADMIN" }, "me"), "Bạn");
    assert.equal(W.eventActor({ actorUserId: "abcdef1234", actorRole: "ADMIN" }, "me"), "Quản trị viên (mã abcdef12)");
  });
  it("notes: people's words are shown, internal codes are mapped or dropped", () => {
    assert.equal(W.eventNote({ note: "Cần thêm ảnh" }), "Cần thêm ảnh");
    assert.equal(W.eventNote({ note: "CONTRACT_ENDING" }), "Hợp đồng đang kết thúc, thử lại sau.");
    assert.equal(W.eventNote({ note: "attempt 2" }), null);
    assert.equal(W.eventNote({ note: "LEDGER_UNREADABLE_X" }), null);
    assert.equal(W.eventNote({ note: null }), null);
  });
  it("newest first and the 200 limit is stated", () => {
    const e = (id: string, t: string) => ({ id, createdAt: t }) as never;
    assert.deepEqual(W.sortedEvents([e("a", "2026-01-01T00:00:00Z"), e("b", "2026-02-01T00:00:00Z")]).map((x) => x.id), ["b", "a"]);
    assert.match(W.HISTORY_LIMIT_NOTE, /Tối đa 200 sự kiện gần nhất/);
  });
});

describe("D2 workspace - statements by party and version", () => {
  it("v1 from the old fields is labelled; newest version first; client before PT", () => {
    const base = detailFixture().statements[0];
    const list = [
      { ...base, id: "pt1", partyRole: "PT", version: 1, source: "LEGACY_FIELD" },
      { ...base, id: "c2", partyRole: "CLIENT", version: 2, source: "SUBMITTED", supplementReason: "Thêm" },
      base,
    ] as never;
    const threads = W.statementThreads(list);
    assert.deepEqual(threads.map((t) => t.partyRole), ["CLIENT", "PT"]);
    assert.deepEqual(threads[0].versions.map((v) => v.version), [2, 1]);
    assert.match(W.statementSourceText(base), /trường cũ/);
    assert.equal(W.statementSourceText({ source: "SUBMITTED", version: 2 }), "Nộp qua hệ thống (phiên bản 2)");
  });
});

describe("D2 workspace - load failures (a failed load is never an empty case)", () => {
  it("404 -> back to the queue with a note", () => {
    const f = W.describeLoadFailure(parseDisputeErrorBody(404, { error: "x", code: "CASE_NOT_FOUND" }));
    assert.equal(f.kind, "notFound");
    assert.equal(f.backToQueue, true);
    assert.equal(f.canReload, false);
  });
  it("403 -> no reload, back to the queue", () => {
    const f = W.describeLoadFailure(parseDisputeErrorBody(403, errBodies.gatewayForbidden));
    assert.equal(f.kind, "forbidden");
    assert.equal(f.canReload, false);
  });
  it("CASE_VERSION_CONFLICT -> reload", () => {
    const f = W.describeLoadFailure(parseDisputeErrorBody(409, errBodies.versionConflict));
    assert.equal(f.kind, "conflict");
    assert.equal(f.canReload, true);
  });
  it("network / 500 -> reload, and the text says it is not an empty case", () => {
    const net = W.describeLoadFailure(parseDisputeError(new Error("Network Error")));
    assert.equal(net.kind, "network");
    assert.match(net.body, /không phải là hồ sơ trống/);
    const srv = W.describeLoadFailure(parseDisputeErrorBody(500, errBodies.internal));
    assert.equal(srv.canReload, true);
    assert.match(srv.body, /không phải là hồ sơ trống/);
  });
  it("401 -> sign in again", () => {
    assert.equal(W.describeLoadFailure(parseDisputeErrorBody(401, errBodies.gatewayUnauthorized)).kind, "auth");
  });
});

describe("D2 workspace - action slots (filled by D3, except Execution)", () => {
  const props = { detail: detailFixture(), currentUserId: "me", onChanged: () => undefined };
  const call = (name: string) => (S as unknown as Record<string, (p: typeof props) => unknown>)[name](props);
  it("each write-capable tab still has its named slot", () => {
    for (const name of ["OverviewActionsSlot", "EvidenceActionsSlot", "StatementsActionsSlot", "AssessmentsActionsSlot", "FindingsActionsSlot", "ApprovalsActionsSlot", "ExecutionActionsSlot"] as const) {
      assert.equal(typeof (S as unknown as Record<string, unknown>)[name], "function", name);
    }
  });
  it("the six D3 slots return a component element (the forms); the props pass through untouched", () => {
    for (const name of ["OverviewActionsSlot", "EvidenceActionsSlot", "StatementsActionsSlot", "AssessmentsActionsSlot", "FindingsActionsSlot", "ApprovalsActionsSlot"]) {
      const el = call(name) as { type?: unknown; props?: unknown } | null;
      assert.ok(el && typeof el.type === "function", `${name} must return an element`);
      assert.deepEqual(el!.props, props, name);
    }
  });
  it("the Execution slot STILL renders nothing: no execute button (executor is off outside tests, no execStatus in any GET: R-01, R-02)", () => {
    assert.equal(call("ExecutionActionsSlot"), null);
  });
  it("money and history have no slot on purpose", () => {
    assert.equal("MoneyActionsSlot" in S, false);
    assert.equal("HistoryActionsSlot" in S, false);
  });
});
