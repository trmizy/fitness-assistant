/**
 * D1 - Vietnamese labels, finding consequences, state-machine hint and the money axis of a dispute case.
 * Evidence label of everything here: TEST FIXTURE (pure functions + fixtures copied from real shapes; no server was called).
 * Run: npx tsx --test src/app/pages/admin/__tests__/d1-labels-financial.test.ts (from frontend/web)
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import * as T from "../disputes/disputeCaseTypes";
import * as L from "../disputes/disputeCaseLabels";
import * as F from "../disputes/disputeFinancial";
import { ALL_FINANCIAL_STATES, financialItem, financialViewFixture } from "../disputes/__fixtures__/disputeCaseFixtures";

const dir = dirname(fileURLToPath(import.meta.url));
const keys = (o: object) => Object.keys(o).sort();
const sorted = (a: readonly string[]) => [...a].sort();

describe("D1 labels - every enum value has a Vietnamese label (exhaustive against the unions)", () => {
  it("case status: all 11 including PROPOSED, each with a label and a waiting note", () => {
    assert.equal(T.CASE_STATUSES.length, 11);
    assert.deepEqual(keys(L.CASE_STATUS_LABEL), sorted(T.CASE_STATUSES));
    assert.deepEqual(keys(L.CASE_STATUS_NOTE), sorted(T.CASE_STATUSES));
    assert.ok(L.CASE_STATUS_LABEL.PROPOSED.length > 3);
  });
  it("type, finding, outcome, claim result, claimant role, moves, PT-late findings", () => {
    assert.deepEqual(keys(L.CASE_TYPE_LABEL), sorted(T.CASE_TYPES));
    assert.deepEqual(keys(L.FINDING_LABEL), sorted(T.FINDING_KINDS));
    assert.deepEqual(keys(L.OUTCOME_LABEL), sorted(T.OUTCOMES));
    assert.deepEqual(keys(L.CLAIM_RESULT_LABEL), sorted(T.CLAIM_RESULTS));
    assert.deepEqual(keys(L.CLAIMANT_ROLE_LABEL), sorted(T.CLAIMANT_ROLES));
    assert.deepEqual(keys(L.CLAIM_MOVE_LABEL), sorted(T.CLAIM_MOVES));
    assert.deepEqual(keys(L.PT_LATE_FINDING_LABEL), sorted(T.PT_LATE_FINDINGS));
  });
  it("provenance, capture status, verification status, sensitivity", () => {
    assert.deepEqual(keys(L.PROVENANCE_LABEL), sorted(T.PROVENANCE_TYPES));
    assert.deepEqual(keys(L.CAPTURE_STATUS_LABEL), sorted(T.CAPTURE_STATUSES));
    assert.deepEqual(keys(L.VERIFICATION_STATUS_LABEL), sorted(T.VERIFICATION_STATUSES));
    assert.deepEqual(keys(L.SENSITIVITY_LABEL), sorted(T.SENSITIVITIES));
  });
  it("execution axis (typed optional, not returned by the API yet) and the other small tables", () => {
    assert.deepEqual(keys(L.EXEC_STATUS_LABEL), sorted(T.EXEC_STATUSES));
    assert.deepEqual(keys(L.EXEC_BLOCK_REASON_LABEL), sorted(T.EXEC_BLOCK_REASONS));
    assert.deepEqual(keys(L.POLICY_RESULT_LABEL), sorted(T.POLICY_RESULTS));
    assert.deepEqual(keys(L.APPROVAL_RESULT_LABEL), ["APPROVED", "REJECTED"]);
    assert.deepEqual(keys(L.PARTY_ROLE_LABEL), ["ADMIN_ON_BEHALF", "CLIENT", "PT"]);
    assert.deepEqual(keys(L.SHARE_REFUSAL_LABEL), ["NOT_NORMAL_SENSITIVITY", "PARTY_SUBMITTED", "UNVERIFIED"]);
    assert.deepEqual(keys(L.PROPOSAL_BLOCKED_LABEL), ["D77_COMBINATION_UNRESOLVED"]);
  });
  it("the unions match the real Prisma enums when the main tree is reachable (code is authoritative)", (t) => {
    const prisma = "D:/FitnessAssistant/backend/services/user-service/prisma/schema.prisma";
    if (!existsSync(prisma)) return t.skip("main-tree schema.prisma not reachable");
    const text = readFileSync(prisma, "utf8");
    const enumValues = (name: string) => {
      const m = text.match(new RegExp(`enum ${name} \\{([\\s\\S]*?)\\n\\}`));
      assert.ok(m, name);
      return m![1]
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("//"))
        .map((l) => l.split(/\s+/)[0]);
    };
    assert.deepEqual(sorted(enumValues("DisputeCaseStatus")), sorted(T.CASE_STATUSES));
    assert.deepEqual(sorted(enumValues("DisputeCaseType")), sorted(T.CASE_TYPES));
    assert.deepEqual(sorted(enumValues("DisputeCaseFindingKind")), sorted(T.FINDING_KINDS));
    assert.deepEqual(sorted(enumValues("DisputeCaseOutcome")), sorted(T.OUTCOMES));
    assert.deepEqual(sorted(enumValues("DisputeCaseProvenance")), sorted(T.PROVENANCE_TYPES));
    assert.deepEqual(sorted(enumValues("DisputeCaseCaptureStatus")), sorted(T.CAPTURE_STATUSES));
    assert.deepEqual(sorted(enumValues("DisputeCaseVerificationStatus")), sorted(T.VERIFICATION_STATUSES));
    assert.deepEqual(sorted(enumValues("DisputeCaseSensitivity")), sorted(T.SENSITIVITIES));
    assert.deepEqual(sorted(enumValues("DisputeCaseAssessmentResult")), sorted(T.CLAIM_RESULTS));
    assert.deepEqual(sorted(enumValues("DisputeCaseClaimantRole")), sorted(T.CLAIMANT_ROLES));
    assert.deepEqual(sorted(enumValues("DisputeCaseIssueFinding")), sorted(T.PT_LATE_FINDINGS));
    assert.deepEqual(sorted(enumValues("DisputeCaseExecStatus")), sorted(T.EXEC_STATUSES));
    assert.deepEqual(sorted(enumValues("DisputeCasePolicyEligibilityResult")), sorted(T.POLICY_RESULTS));
  });
  it("unknown values get a generic Vietnamese fallback, never the raw enum", () => {
    for (const fn of [L.caseStatusLabel, L.caseTypeLabel, L.findingLabel, L.outcomeLabel, L.provenanceLabel, L.captureStatusLabel, L.verificationStatusLabel, L.sensitivityLabel]) {
      const out = fn("SOMETHING_NEW");
      assert.ok(!out.includes("SOMETHING_NEW") && !/^[A-Z_]+$/.test(out), out);
      assert.ok(!fn(null).includes("null") && !fn(undefined).includes("undefined"));
    }
    assert.ok(typeof L.caseStatusLabel("constructor") === "string" && L.caseStatusLabel("constructor") === "Chưa rõ trạng thái");
  });
});

describe("D1 labels - forbidden words", () => {
  const allVisible = (): string[] => {
    const tables: object[] = [
      L.CASE_STATUS_LABEL, L.CASE_STATUS_NOTE, L.CASE_TYPE_LABEL, L.FINDING_LABEL, L.OUTCOME_LABEL, L.CLAIM_RESULT_LABEL, L.CLAIMANT_ROLE_LABEL,
      L.CLAIM_MOVE_LABEL, L.PT_LATE_FINDING_LABEL, L.PROVENANCE_LABEL, L.CAPTURE_STATUS_LABEL, L.VERIFICATION_STATUS_LABEL, L.SENSITIVITY_LABEL,
      L.PARTY_ROLE_LABEL, L.APPROVAL_RESULT_LABEL, L.POLICY_RESULT_LABEL, L.SHARE_REFUSAL_LABEL, L.EXEC_STATUS_LABEL, L.EXEC_BLOCK_REASON_LABEL,
      L.PROPOSAL_BLOCKED_LABEL, L.FINDING_CONSEQUENCE, L.OUTCOME_CONSEQUENCE, F.GROUP_LABEL_FALLBACK,
    ];
    const out = tables.flatMap((tb) => Object.values(tb) as string[]);
    out.push(L.PT_LATE_ISSUE_NOTE, L.GYM_CHECKIN_NOTE, L.POLICY_PENDING_NO_PROPOSAL, L.DISPUTE_PAGE_PENDING_SENTENCE, L.COMPLAINT_NO_AUTO_REFUND_SENTENCE, L.EXEC_STATUS_UNREADABLE, F.NEEDS_VERIFICATION_LABEL);
    for (const s of ALL_FINANCIAL_STATES) out.push(F.describeMoneyState({ state: s, ledger: financialItem(s).ledger }).label);
    return out;
  };
  it("no visible text contains an internal code (D77, B-1, FH-8, I6) or a bare enum", () => {
    for (const text of allVisible()) {
      assert.ok(!/\bD77\b|\bB-1\b|\bFH-\d|\bI6\b|DESIGN_REQUIRED|SLICE_2/.test(text), text);
      assert.ok(!/\b[A-Z]{3,}_[A-Z_]{2,}\b/.test(text), `raw enum in: ${text}`);
    }
  });
  it("no label says 'Ngân hàng' / bank (other than 'không phải chuyển khoản ngân hàng')", () => {
    for (const text of allVisible()) assert.ok(!/ngân hàng/i.test(text), text);
  });
  it("WAIVED / RESOLVED_OTHER never say paid, refunded or completed (label, group and detail)", () => {
    for (const state of ["OBLIGATION_WAIVED", "OBLIGATION_RESOLVED_OTHER"] as const) {
      const d = F.describeMoneyState(financialItem(state));
      for (const text of [d.label, d.detail ?? ""]) assert.ok(!/đã trả|đã hoàn|hoàn tất/i.test(text), `${state}: ${text}`);
      assert.equal(d.group, "F2");
    }
    assert.ok(!/đã trả|đã hoàn|hoàn tất/i.test(F.GROUP_LABEL_FALLBACK.F2));
  });
  it("a server label that claims 'đã trả' for WAIVED, or names a bank, is ignored", () => {
    const d = F.describeMoneyState(financialItem("OBLIGATION_WAIVED", { label: "Đã trả đủ, hoàn tất" }));
    assert.ok(!/đã trả|hoàn tất/i.test(d.label));
    const bank = F.describeMoneyState(financialItem("LEDGER_POSTED_FULL", { label: "Ngân hàng đã chuyển" }));
    assert.ok(!/ngân hàng/i.test(bank.label));
  });
});

describe("D1 finding consequence (DQ-2(a))", () => {
  it("covers all six findings", () => assert.deepEqual(keys(L.FINDING_CONSEQUENCE), sorted(T.FINDING_KINDS)));
  it("PT absent: refund one session's value AND still consumes one session right, no make-up, PT not paid", () => {
    const s = L.FINDING_CONSEQUENCE.VERIFIED_PT_ABSENT;
    assert.match(s, /Hoàn cho khách giá trị một buổi/);
    assert.match(s, /vẫn mất 1 quyền buổi/);
    assert.match(s, /không có buổi bù/);
    assert.match(s, /PT không nhận tiền buổi đó/);
    assert.equal(L.OUTCOME_CONSEQUENCE.PT_NO_SHOW_CONFIRMED, s);
  });
  it("never the sentence 'buổi tập không bị trừ' for PT absence (nor on the page header)", () => {
    for (const s of [L.FINDING_CONSEQUENCE.VERIFIED_PT_ABSENT, L.OUTCOME_CONSEQUENCE.PT_NO_SHOW_CONFIRMED, L.DISPUTE_PAGE_PENDING_SENTENCE]) {
      assert.ok(!/không bị trừ/i.test(s), s);
    }
    assert.match(L.DISPUTE_PAGE_PENDING_SENTENCE, /tiền chưa được quyết toán/);
    assert.match(L.DISPUTE_PAGE_PENDING_SENTENCE, /quyền buổi tập tuỳ theo kết luận/);
  });
  it("the page fixes are wired into the two pages", () => {
    const src = (f: string) => readFileSync(join(dir, "..", f), "utf8");
    assert.ok(src("AdminDisputes.tsx").includes("DISPUTE_PAGE_PENDING_SENTENCE"));
    assert.ok(!/buổi tập không bị trừ/.test(src("AdminDisputes.tsx")));
    assert.ok(src("AdminDisputes.tsx").includes("parseDisputeError(error"));
    assert.ok(src("AdminComplaintsPage.tsx").includes("COMPLAINT_RESOLVE_NOT_REFUND"));
    assert.equal(L.COMPLAINT_NO_AUTO_REFUND_SENTENCE, "Xử lý khiếu nại không tự hoàn tiền.");
  });
});

describe("D1 allowedTransitions (state-machine hint copied from rules.ts)", () => {
  it("matches the TRANSITIONS table exactly", () => {
    const expected: Record<string, string[]> = {
      INTAKE: ["COLLECTING", "REJECTED_INTAKE"],
      COLLECTING: ["AWAITING_PARTIES", "ASSESSING", "TECH_RECONCILIATION"],
      AWAITING_PARTIES: ["COLLECTING", "ASSESSING"],
      ASSESSING: ["COLLECTING", "AWAITING_PARTIES", "TECH_RECONCILIATION", "FINDING_RECORDED"],
      TECH_RECONCILIATION: ["COLLECTING", "ASSESSING"],
      FINDING_RECORDED: ["PROPOSED", "POLICY_PENDING", "TECH_RECONCILIATION"],
      POLICY_PENDING: ["COLLECTING", "ASSESSING"],
      PROPOSED: ["AWAITING_APPROVAL"],
      AWAITING_APPROVAL: ["DECISION_APPROVED", "ASSESSING"],
      DECISION_APPROVED: [],
      REJECTED_INTAKE: [],
    };
    assert.deepEqual(keys(expected), sorted(T.CASE_STATUSES));
    for (const s of T.CASE_STATUSES) assert.deepEqual(L.allowedTransitions(s), expected[s], s);
  });
  it("returns a copy and the manual subset excludes states earned by an action", () => {
    L.allowedTransitions("INTAKE").push("ASSESSING");
    assert.deepEqual(L.allowedTransitions("INTAKE"), ["COLLECTING", "REJECTED_INTAKE"]);
    assert.deepEqual(L.manualTransitions("FINDING_RECORDED"), ["TECH_RECONCILIATION"]);
    assert.deepEqual(L.manualTransitions("AWAITING_APPROVAL"), []);
    assert.deepEqual(L.manualTransitions("PROPOSED"), []);
    assert.deepEqual(L.manualTransitions("ASSESSING"), ["COLLECTING", "AWAITING_PARTIES", "TECH_RECONCILIATION"]);
    assert.ok(L.isTerminalStatus("DECISION_APPROVED") && L.isTerminalStatus("REJECTED_INTAKE") && !L.isTerminalStatus("POLICY_PENDING"));
  });
});

describe("D1 money axis - all 12 states", () => {
  it("fixture covers exactly the 12 financial states of the type", () => {
    assert.equal(ALL_FINANCIAL_STATES.length, 12);
    assert.deepEqual(sorted(ALL_FINANCIAL_STATES), sorted(T.FINANCIAL_STATES));
  });
  const expectedGroup: Record<string, string> = {
    LEDGER_POSTED_FULL: "F1", OBLIGATION_PAID_VERIFIED: "F1", OBLIGATION_PAID_VIA_LEDGER: "F1",
    NO_MONEY_EFFECT: "F2", OBLIGATION_WAIVED: "F2", OBLIGATION_RESOLVED_OTHER: "F2",
    LEDGER_PENDING: "F3", LEDGER_POSTED_PARTIAL: "F3", OBLIGATION_IN_PAYMENT: "F3", NEEDS_RECONCILIATION: "F3", LEGACY_NEEDS_VERIFICATION: "F3",
    UNAVAILABLE: "UNAVAILABLE",
  };
  it("each state maps to its group with a non-empty label and a tone", () => {
    for (const s of ALL_FINANCIAL_STATES) {
      const d = F.describeMoneyState(financialItem(s));
      assert.equal(d.group, expectedGroup[s], s);
      assert.ok(d.label.length > 3, s);
      assert.ok(["success", "neutral", "warning", "danger", "info"].includes(d.tone), s);
    }
  });
  it("ledger wallet states say 'ví Gymini', never a bank", () => {
    assert.equal(F.describeMoneyState(financialItem("LEDGER_POSTED_FULL")).label, "Đã ghi vào ví Gymini");
    assert.equal(F.describeMoneyState(financialItem("OBLIGATION_PAID_VIA_LEDGER")).label, "Đã trả vào ví Gymini");
    for (const s of ["LEDGER_POSTED_FULL", "OBLIGATION_PAID_VIA_LEDGER"] as const) {
      const d = F.describeMoneyState(financialItem(s));
      assert.ok(/ví Gymini/.test(d.label) && !/ngân hàng|chuyển khoản/i.test(`${d.label} ${d.detail ?? ""}`));
    }
  });
  it("UNAVAILABLE is 'could not read the ledger', never 0", () => {
    const d = F.describeMoneyState(financialItem("UNAVAILABLE"));
    assert.equal(d.label, "Chưa đọc được sổ cái");
    assert.ok(!/\b0\b|0 ₫/.test(`${d.label} ${d.detail ?? ""}`));
    assert.equal(d.tone, "danger");
    const g = F.describeMoneyGroup({ group: "UNAVAILABLE", groupLabel: "Chưa xác định được (không đọc được sổ cái)" });
    assert.ok(!/\b0\b/.test(g.label));
  });
  it("waived shows the amount NOT paid; resolved-other points to the report for the reason", () => {
    const w = F.describeMoneyState(financialItem("OBLIGATION_WAIVED"));
    assert.match(w.detail ?? "", /Số tiền không chi trả: 250\.000/);
    const r = F.describeMoneyState(financialItem("OBLIGATION_RESOLVED_OTHER"));
    assert.match(r.detail ?? "", /báo cáo đối soát/);
  });
  it("partial and in-payment: not paid yet, amounts only formatted from strings", () => {
    const p = F.describeMoneyState(financialItem("LEDGER_POSTED_PARTIAL"));
    assert.match(p.detail ?? "", /Đã ghi vào ví: 100\.000/);
    assert.match(p.detail ?? "", /Còn thiếu: 150\.000.*\(chưa trả\)/);
    const i = F.describeMoneyState(financialItem("OBLIGATION_IN_PAYMENT"));
    assert.match(i.label, /chờ xác minh/);
    assert.ok(!/đã trả/i.test(i.label));
    const bad = F.describeMoneyState(
      financialItem("LEDGER_POSTED_PARTIAL", {
        ledger: { status: "FOUND", kind: null, transactionId: null, createdAt: "", result: {}, obligation: { id: "x", status: "OPEN", owed: "abc", paid: "", unpaid: "NaN" } },
      }),
    );
    assert.equal(bad.detail, undefined, "an unreadable amount is omitted, never shown as 0");
  });
  it("server label wins for the legacy state; unknown state becomes 'Cần xác minh'", () => {
    const legacy = F.describeMoneyState(financialItem("LEGACY_NEEDS_VERIFICATION"));
    assert.equal(legacy.label, "Cần xác minh — không phải nợ đang mở, cũng chưa xác minh đã trả");
    const unknown = F.describeMoneyState({ state: "BRAND_NEW_STATE", group: "F1" });
    assert.match(unknown.label, /^Cần xác minh/);
    assert.equal(unknown.group, "F1");
    assert.match(F.describeMoneyState({ state: undefined }).label, /^Cần xác minh/);
    assert.match(F.describeMoneyGroup({ group: "ZZZ", groupLabel: "x" }).label, /^Cần xác minh/);
  });
  it("group view: server groupLabel wins, fallback sentence otherwise, all five groups", () => {
    assert.equal(F.describeMoneyGroup({ group: "F3", groupLabel: "Nhãn máy chủ" }).label, "Nhãn máy chủ");
    for (const g of ["F1", "F2", "F3", "UNAVAILABLE", "NO_RECORDED_SETTLEMENT"] as const) {
      const d = F.describeMoneyGroup({ group: g });
      assert.equal(d.label, F.GROUP_LABEL_FALLBACK[g]);
      assert.equal(d.group, g);
    }
    const view = F.describeFinancialView(financialViewFixture({ items: ALL_FINANCIAL_STATES.map((s) => financialItem(s, { key: `K:${s}` })) }));
    assert.equal(view!.items.length, 12);
    assert.equal(F.describeFinancialView(null), null);
  });
  it("never reads `ledger.result` (opaque) and does no arithmetic on money", () => {
    const src = readFileSync(join(dir, "..", "disputes", "disputeFinancial.ts"), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    assert.ok(!/\.result\b/.test(src), "ledger.result must not be read");
    assert.ok(!/Number\(|parseFloat|parseInt|BigInt/.test(src));
  });
  it("the old decision/proposal execution constant is absent; the final case execution block is typed", () => {
    const types = readFileSync(join(dir, "..", "disputes", "disputeCaseTypes.ts"), "utf8");
    assert.ok(!/decision\s*:\s*\{[^}]*execution\s*:/s.test(types), "no old decision execution constant");
    assert.match(types, /execution\??:\s*Execution/);
  });
});
