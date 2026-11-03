/**
 * TEST FIXTURE - shapes copied from the real responses of user-service (`getForAdmin`, `summary()`, `buildFinancialView`, the
 * `propose`/`decide`/`recordFinding` results and the error bodies of `dispute-case.controller.ts` / the gateway), commit fd199953.
 * These are NOT answers from a running server. Raw rows keep the F3 constant `execution` on purpose, to prove the types/UI ignore it.
 */
import type { DisputeCaseDetail, DisputeCaseSummary, FinancialItem, FinancialView, PartyCaseDetail } from "../disputeCaseTypes";

export const IDS = {
  case: "11111111-1111-4111-8111-111111111111",
  session: "sess-0001",
  contract: "contract-0001",
  claim: "22222222-2222-4222-8222-222222222221",
  ev1: "33333333-3333-4333-8333-333333333331",
  ev2: "33333333-3333-4333-8333-333333333332",
  ev3: "33333333-3333-4333-8333-333333333333",
  stmt: "44444444-4444-4444-8444-444444444441",
  finding: "55555555-5555-4555-8555-555555555551",
  proposal: "66666666-6666-4666-8666-666666666661",
  approval: "77777777-7777-4777-8777-777777777771",
  review: "88888888-8888-4888-8888-888888888881",
  admin1: "admin-0001",
  admin2: "admin-0002",
} as const;

export const EXECUTION_LIE = "BLOCKED: SLICE_2_NOT_ENABLED";

export function summaryFixture(over: Partial<DisputeCaseSummary> = {}): DisputeCaseSummary {
  return {
    id: IDS.case,
    sessionId: IDS.session,
    contractId: IDS.contract,
    type: "PT_NO_SHOW_CLAIM",
    status: "AWAITING_APPROVAL",
    escalated: false,
    investigatorId: IDS.admin1,
    version: 9,
    createdAt: "2026-11-01T03:00:00.000Z",
    updatedAt: "2026-11-02T03:00:00.000Z",
    ...over,
  };
}

const ledgerFound = (obligation: Extract<FinancialItem["ledger"], { status: "FOUND" }>["obligation"]): FinancialItem["ledger"] => ({
  status: "FOUND",
  kind: "SESSION_RELEASE",
  transactionId: "tx-0001",
  createdAt: "2026-11-01T05:00:00.000Z",
  result: { opaque: true },
  obligation,
});

export function financialItem(state: FinancialItem["state"], over: Partial<FinancialItem> = {}): FinancialItem {
  const base: Record<FinancialItem["state"], Partial<FinancialItem> & Pick<FinancialItem, "group" | "ledger">> = {
    LEDGER_POSTED_FULL: { group: "F1", ledger: ledgerFound(null) },
    OBLIGATION_PAID_VERIFIED: { group: "F1", ledger: ledgerFound({ id: "ob-1", status: "PAID_VERIFIED", owed: "250000.00", paid: "250000.00", unpaid: "0.00" }) },
    OBLIGATION_PAID_VIA_LEDGER: {
      group: "F1",
      label: "Đã trả vào ví Gymini",
      ledger: ledgerFound({ id: "ob-2", status: "PAID_VIA_LEDGER", owed: "250000.00", paid: "250000.00", unpaid: "0.00" }),
    },
    NO_MONEY_EFFECT: { group: "F2", ledger: ledgerFound(null) },
    OBLIGATION_WAIVED: { group: "F2", ledger: ledgerFound({ id: "ob-3", status: "WAIVED", owed: "250000.00", paid: "0.00", unpaid: "250000.00" }) },
    OBLIGATION_RESOLVED_OTHER: {
      group: "F2",
      ledger: ledgerFound({ id: "ob-4", status: "RESOLVED_OTHER", owed: "250000.00", paid: "0.00", unpaid: "250000.00" }),
      resolutionReason: { available: false, note: "Sổ cái không trả lý do xử lý khác qua đường tra cứu này (DESIGN_REQUIRED)" },
    },
    LEDGER_PENDING: { group: "F3", f3Kind: "OUTSTANDING", ledger: { status: "ABSENT" } },
    LEDGER_POSTED_PARTIAL: {
      group: "F3",
      f3Kind: "OUTSTANDING",
      ledger: ledgerFound({ id: "ob-5", status: "OPEN", owed: "250000.00", paid: "100000.00", unpaid: "150000.00" }),
    },
    OBLIGATION_IN_PAYMENT: {
      group: "F3",
      f3Kind: "OUTSTANDING",
      ledger: ledgerFound({ id: "ob-6", status: "APPROVED_FOR_PAYMENT", owed: "250000.00", paid: "0.00", unpaid: "250000.00" }),
    },
    NEEDS_RECONCILIATION: { group: "F3", f3Kind: "OUTSTANDING", ledger: { status: "ABSENT" } },
    LEGACY_NEEDS_VERIFICATION: {
      group: "F3",
      f3Kind: "VERIFICATION_REQUIRED",
      label: "Cần xác minh — không phải nợ đang mở, cũng chưa xác minh đã trả",
      ledger: ledgerFound({ id: "ob-7", status: "PAID_EXTERNALLY", owed: "250000.00", paid: "0.00", unpaid: "250000.00" }),
    },
    UNAVAILABLE: { group: "UNAVAILABLE", ledger: { status: "UNAVAILABLE", error: "ECONNREFUSED" } },
  };
  return {
    key: `SESSION_RELEASE:${IDS.session}`,
    settlementId: "settle-1",
    settlementKind: "SESSION_RELEASE",
    settlementStatus: "SETTLED",
    state,
    ...base[state],
    ...over,
  } as FinancialItem;
}

export const ALL_FINANCIAL_STATES = [
  "LEDGER_POSTED_FULL",
  "OBLIGATION_PAID_VERIFIED",
  "OBLIGATION_PAID_VIA_LEDGER",
  "NO_MONEY_EFFECT",
  "OBLIGATION_WAIVED",
  "OBLIGATION_RESOLVED_OTHER",
  "LEDGER_PENDING",
  "LEDGER_POSTED_PARTIAL",
  "OBLIGATION_IN_PAYMENT",
  "NEEDS_RECONCILIATION",
  "LEGACY_NEEDS_VERIFICATION",
  "UNAVAILABLE",
] as const;

export function financialViewFixture(over: Partial<FinancialView> = {}): FinancialView {
  return {
    derived: true,
    observedAt: "2026-11-02T04:00:00.000Z",
    group: "F3",
    groupLabel: "Còn phải thanh toán hoặc đối soát",
    f3Kind: "OUTSTANDING",
    items: [financialItem("LEDGER_POSTED_PARTIAL")],
    ...over,
  };
}

/** Real A3 shape. The raw rows carry the constant `execution` (F3). */
export function detailFixture(): DisputeCaseDetail {
  const detail = {
    case: summaryFixture(),
    claims: [{ id: IDS.claim, caseId: IDS.case, claimantRole: "CLIENT", text: "PT không đến buổi tập", moves: ["MONEY", "QUOTA"], createdBy: IDS.admin1, createdAt: "2026-11-01T04:00:00.000Z" }],
    issues: [{ id: "99999999-9999-4999-8999-999999999991", caseId: IDS.case, kind: "PT_LATE", finding: "UNDETERMINED", note: "", recordedBy: IDS.admin1, createdAt: "2026-11-01T04:10:00.000Z" }],
    evidence: [
      {
        id: IDS.ev1, caseId: IDS.case, provenanceType: "SERVER_OBSERVED", source: "user-service.sessions", subject: "SESSION_ROW", scopeSessionId: IDS.session, scopeContractId: IDS.contract,
        eventAt: null, capturedAt: "2026-11-01T03:00:01.000Z", submittedBy: null, submittedRole: null, captureStatus: "OK", snapshotVersion: 1, contentHash: "a".repeat(64),
        payload: { status: "DISPUTED" }, sensitivity: "NORMAL", verificationStatus: "NOT_APPLICABLE", supersedesId: null, createdAt: "2026-11-01T03:00:01.000Z",
        partySubmitted: false, provenanceLabel: "Máy chủ chứng kiến / đọc trực tiếp từ hệ thống",
      },
      {
        id: IDS.ev2, caseId: IDS.case, provenanceType: "SELF_REPORTED_SERVER_RECORDED", source: "gym-service.pt-check-ins", subject: "GYM_PT_CHECK_INS", scopeSessionId: IDS.session, scopeContractId: IDS.contract,
        eventAt: "2026-11-01T01:00:00.000Z", capturedAt: "2026-11-01T03:00:02.000Z", submittedBy: null, submittedRole: null, captureStatus: "OK", snapshotVersion: 1, contentHash: "b".repeat(64),
        payload: { found: false, notProven: "Check-in gym không chứng minh buổi dạy PT đã diễn ra" }, sensitivity: "NORMAL", verificationStatus: "NOT_APPLICABLE", supersedesId: null, createdAt: "2026-11-01T03:00:02.000Z",
        partySubmitted: false, provenanceLabel: "Người dùng tự quét/khai, máy chủ chỉ ghi lại — check-in gym không chứng minh buổi dạy PT đã diễn ra",
      },
      {
        id: IDS.ev3, caseId: IDS.case, provenanceType: "EXTERNAL_DOCUMENT", source: "party", subject: "EXTERNAL_DOCUMENT", scopeSessionId: IDS.session, scopeContractId: IDS.contract,
        eventAt: null, capturedAt: "2026-11-01T06:00:00.000Z", submittedBy: "client-1", submittedRole: "CLIENT", captureStatus: "OK", snapshotVersion: 1, contentHash: "c".repeat(64),
        payload: { description: "Ảnh chụp màn hình", sha256: "d".repeat(64) }, sensitivity: "RESTRICTED", verificationStatus: "CLIENT_CLAIMED_UNVERIFIED", supersedesId: null, createdAt: "2026-11-01T06:00:00.000Z",
        partySubmitted: true, provenanceLabel: "Tài liệu ngoài hệ thống do bên liên quan nộp",
      },
    ],
    statements: [{ id: IDS.stmt, caseId: IDS.case, partyRole: "CLIENT", authorUserId: "client-1", version: 1, source: "LEGACY_FIELD", text: "PT vắng", supplementReason: null, supersedesId: null, contentHash: "e".repeat(64), createdAt: "2026-11-01T03:00:03.000Z" }],
    shares: [],
    assessments: [
      {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", caseId: IDS.case, claimId: IDS.claim, assessorId: IDS.admin1, directEvidenceIds: [IDS.ev1], indirectEvidenceIds: [IDS.ev2], rebuttalEvidenceIds: [],
        relevanceNote: "Liên quan", verifiabilityNote: "Kiểm chứng được", consistencyNote: "Nhất quán", result: "ESTABLISHED", reasoning: "Không có dấu vết PT",
        evidenceSnapshot: [{ id: IDS.ev1, hash: "a".repeat(64), version: 1 }], createdAt: "2026-11-01T07:00:00.000Z",
      },
    ],
    findings: [{ id: IDS.finding, caseId: IDS.case, finding: "VERIFIED_PT_ABSENT", reasoning: "PT vắng", recordedBy: IDS.admin1, supersedesId: null, createdAt: "2026-11-01T08:00:00.000Z" }],
    proposals: [
      {
        id: IDS.proposal, caseId: IDS.case, findingId: IDS.finding, outcome: "PT_NO_SHOW_CONFIRMED", proposerId: IDS.admin1, executionBlockedReason: null,
        evidenceSnapshot: [{ id: IDS.ev1, hash: "a".repeat(64), version: 1 }], createdAt: "2026-11-01T09:00:00.000Z", execution: EXECUTION_LIE,
        approvals: [
          { id: IDS.approval, proposalId: IDS.proposal, approverId: IDS.admin2, result: "REJECTED", reason: "Cần thêm bằng chứng", conflictOfInterestDeclaredNone: true, evidenceChangeAcknowledged: false, createdAt: "2026-11-01T10:00:00.000Z" },
        ],
      },
    ],
    decision: null,
    events: [{ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1", caseId: IDS.case, actorUserId: IDS.admin1, actorRole: "ADMIN", action: "CASE_OPENED", fromStatus: null, toStatus: "INTAKE", note: null, idempotencyKey: null, createdAt: "2026-11-01T03:00:00.000Z" }],
    financial: financialViewFixture(),
  };
  return detail as unknown as DisputeCaseDetail;
}

/** A decision as the API returns it, including the lying constant. */
export const decisionRaw = { proposalId: IDS.proposal, outcome: "PT_NO_SHOW_CONFIRMED", execution: EXECUTION_LIE, executionBlockedReason: null };

export function partyDetailFixture(): PartyCaseDetail {
  return {
    case: { id: IDS.case, sessionId: IDS.session, type: "PT_NO_SHOW_CLAIM", status: "COLLECTING", role: "PT", createdAt: "2026-11-01T03:00:00.000Z", canSubmit: true },
    accusations: [{ id: IDS.claim, claimantRole: "CLIENT", text: "PT không đến", moves: ["MONEY"] }],
    evidence: [],
    statements: [],
    financial: { group: "NO_RECORDED_SETTLEMENT", groupLabel: "Chưa có bước quyết toán được ghi nhận" },
  };
}

// ── answers of the write routes (as the controller sends them) ──
export const proposeCreatedRaw = { id: IDS.proposal, outcome: "COMPLETED", executionBlockedReason: null, caseStatus: "AWAITING_APPROVAL", execution: EXECUTION_LIE };
export const proposePolicyPendingRaw = {
  policyPending: true,
  blocked: "CANCELLED_BLOCKED_BY_D77",
  caseStatus: "POLICY_PENDING",
  reason: "I6: buổi có khoản đền đến muộn (D77) không thể phán quyết HUỶ. Chờ xác minh khoản đền đến muộn / chính sách, chưa tạo đề xuất",
  nextStep: "Xác minh khoản đền đến muộn của buổi rồi ghi kết luận khác, hoặc chờ quyết định chính sách",
};
export const decideApprovedRaw = { approvalId: IDS.approval, result: "APPROVED", caseStatus: "DECISION_APPROVED", outcome: "COMPLETED", execution: EXECUTION_LIE, executionBlockedReason: "D77_COMBINATION_UNRESOLVED" };

// ── error bodies ──
export const errBodies = {
  versionConflict: { error: "Hồ sơ vừa được cập nhật bởi người khác. Vui lòng tải lại rồi thử lại", code: "CASE_VERSION_CONFLICT" },
  stateNotAllowed: { error: "Trạng thái hiện tại của hồ sơ không cho phép thao tác này", code: "CASE_STATE_NOT_ALLOWED", details: { status: "ASSESSING", allowed: [] } },
  evidenceChanged: { error: "Bằng chứng đã đổi", code: "EVIDENCE_CHANGED", details: { changedIds: [IDS.ev3], staleLive: [], needsRecollect: false } },
  evidenceChangedStale: { error: "Bằng chứng đã đổi", code: "EVIDENCE_CHANGED", details: { changedIds: [IDS.ev3], staleLive: ["gym-service.pt-check-ins:GYM_PT_CHECK_INS"], needsRecollect: true } },
  zod: { error: "Dữ liệu gửi lên không hợp lệ", code: "INVALID_INPUT", fields: [{ path: "reason", message: "Required" }] },
  paymentUnavailable: { error: "Không đọc được sổ cái", code: "PAYMENT_UNAVAILABLE" },
  gatewayUnauthorized: { success: false, error: { code: "UNAUTHORIZED", message: "Unauthorized" } },
  gatewayForbidden: { success: false, error: { code: "FORBIDDEN", message: "Forbidden" } },
  noTokenNoCode: { error: "No token provided" },
  internal: { error: "Không xử lý được yêu cầu về hồ sơ khiếu nại. Vui lòng thử lại.", code: "INTERNAL_ERROR" },
  unknownCodeVi: { error: "Một lý do rất mới của máy chủ", code: "SOMETHING_NEW_FROM_SERVER" },
  unknownCodeEn: { error: "Something odd happened", code: "SOMETHING_NEW_FROM_SERVER" },
  shareRefused: { error: "Không chia sẻ được", code: "PARTY_EVIDENCE_SHARE_DESIGN_REQUIRED", details: { reason: "PARTY_SUBMITTED" } },
  execBlocked: { error: "Bị chặn", code: "EXEC_BLOCKED", details: { reason: "CONTRACT_ENDING" } },
};
