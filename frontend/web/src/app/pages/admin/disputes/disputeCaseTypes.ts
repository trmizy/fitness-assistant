/**
 * Dispute V2.1 admin UI (D1) - response types of the real endpoints A1-A18, B1-B4, C1, C2.
 *
 * Source of truth is the code (user-service `services/dispute-case/{schemas,rules,financial}.ts`, `dispute-case.service.ts`,
 * the Prisma enums), NOT the documents. Dates arrive as ISO strings; money arrives as decimal STRINGS (never do arithmetic on them).
 * Pure types: no runtime code except the `as const` enum lists (so a test can check every value is labelled).
 *
 * F3 - `decision.execution` and `proposals[].execution` (and `execution` in A13/A14 answers) are a HARD-CODED constant
 * ("BLOCKED: SLICE_2_NOT_ENABLED") that stays the same even after a decision was executed. They are deliberately NOT typed here and
 * must never be read or shown. The real execution state (`execStatus`, block reason) is not returned by any GET yet (request R-01),
 * so those fields are OPTIONAL below and the UI must treat "absent" as "not readable", never as "NOT_STARTED".
 */

// ───────────────────────────────────────────────────────────── enums (unions) ──
export const CASE_STATUSES = [
  "INTAKE",
  "COLLECTING",
  "AWAITING_PARTIES",
  "ASSESSING",
  "TECH_RECONCILIATION",
  "FINDING_RECORDED",
  "POLICY_PENDING",
  "PROPOSED",
  "AWAITING_APPROVAL",
  "DECISION_APPROVED",
  "REJECTED_INTAKE",
] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

export const CASE_TYPES = ["PT_DELIVERY", "PT_CLIENT_NO_SHOW_CLAIM", "PT_NO_SHOW_CLAIM", "LEGACY_UNCLASSIFIED"] as const;
export type CaseType = (typeof CASE_TYPES)[number];
/** The only targets of `classify` (LEGACY_UNCLASSIFIED is never a target). */
export const CLASSIFIABLE_TYPES = ["PT_DELIVERY", "PT_CLIENT_NO_SHOW_CLAIM", "PT_NO_SHOW_CLAIM"] as const;
export type ClassifiableType = (typeof CLASSIFIABLE_TYPES)[number];

export const FINDING_KINDS = [
  "VERIFIED_DELIVERED",
  "VERIFIED_CLIENT_ABSENT",
  "VERIFIED_PT_ABSENT",
  "VERIFIED_NOT_DELIVERED_NO_FAULT",
  "INSUFFICIENT_EVIDENCE",
  "NOT_A_DISPUTE",
] as const;
export type FindingKind = (typeof FINDING_KINDS)[number];

export const OUTCOMES = ["COMPLETED", "CANCELLED", "PT_NO_SHOW_CONFIRMED"] as const;
export type Outcome = (typeof OUTCOMES)[number];

export const CLAIMANT_ROLES = ["CLIENT", "PT", "SYSTEM"] as const;
export type ClaimantRole = (typeof CLAIMANT_ROLES)[number];

export const CLAIM_MOVES = ["MONEY", "QUOTA", "PT_AT_FAULT"] as const;
export type ClaimMove = (typeof CLAIM_MOVES)[number];

export const CLAIM_RESULTS = ["ESTABLISHED", "NOT_ESTABLISHED", "REFUTED"] as const;
export type ClaimResult = (typeof CLAIM_RESULTS)[number];

export const PT_LATE_FINDINGS = ["LATE_CONFIRMED_BY_ROOM_DATA", "LATE_CONTESTED", "NOT_LATE", "UNDETERMINED"] as const;
export type PtLateFinding = (typeof PT_LATE_FINDINGS)[number];
export type IssueKind = "PT_LATE";

export const PROVENANCE_TYPES = [
  "SERVER_OBSERVED",
  "USER_REPORTED_STORED",
  "DERIVED",
  "EXTERNAL_DOCUMENT",
  "TECH_GAP",
  "NOT_APPLICABLE",
  "ADMIN_RECEIVED_ON_BEHALF",
  "LEGACY_FIELD",
  "SELF_REPORTED_SERVER_RECORDED",
  "STAFF_ATTESTED_SERVER_RECORDED",
] as const;
export type ProvenanceType = (typeof PROVENANCE_TYPES)[number];

export const CAPTURE_STATUSES = ["OK", "UNAVAILABLE", "NOT_APPLICABLE", "TECH_GAP_SUSPECTED"] as const;
export type CaptureStatus = (typeof CAPTURE_STATUSES)[number];

export const VERIFICATION_STATUSES = ["CLIENT_CLAIMED_UNVERIFIED", "SERVER_VERIFIED", "NOT_APPLICABLE"] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export const SENSITIVITIES = ["NORMAL", "SENSITIVE", "RESTRICTED"] as const;
export type Sensitivity = (typeof SENSITIVITIES)[number];

export type PartyRole = "CLIENT" | "PT" | "ADMIN_ON_BEHALF";
export type ShareRole = "CLIENT" | "PT";
export type ApprovalResult = "APPROVED" | "REJECTED";

export const POLICY_RESULTS = ["ELIGIBLE_CURRENT_POLICY", "EXCEPTION_APPLIES"] as const;
export type PolicyResult = (typeof POLICY_RESULTS)[number];

/** Execution axis. NOT returned by any GET today (R-01): every use is optional. */
export const EXEC_STATUSES = ["NOT_STARTED", "EXECUTING", "BUSINESS_DONE", "EXEC_BLOCKED", "NEEDS_HUMAN"] as const;
export type ExecStatus = (typeof EXEC_STATUSES)[number];

export const EXEC_BLOCK_REASONS = [
  "PT_NO_SHOW_REPORTED_NOT_SUPPORTED",
  "CONTRACT_ENDING",
  "LEDGER_UNREADABLE",
  "D77_COMBINATION_UNRESOLVED",
  "CANCELLED_BLOCKED_BY_D77",
] as const;
export type ExecBlockReason = (typeof EXEC_BLOCK_REASONS)[number];

/** Why a proposal cannot be executed (set at proposal time; the only block reason a GET returns today). */
export type ProposalBlockedReason = "D77_COMBINATION_UNRESOLVED";

// Money axis (financial.ts / rules.ts)
export const FINANCIAL_STATES = [
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
export type FinancialState = (typeof FINANCIAL_STATES)[number];
export type FinancialGroup = "F1" | "F2" | "F3" | "UNAVAILABLE";
export type CaseFinancialGroup = FinancialGroup | "NO_RECORDED_SETTLEMENT";
export type F3Kind = "OUTSTANDING" | "VERIFICATION_REQUIRED";

// ──────────────────────────────────────────────────────────────── A1 / A2 ──
export interface DisputeCaseSummary {
  id: string;
  sessionId: string;
  contractId: string;
  type: CaseType;
  status: CaseStatus;
  /** Always false today (no code writes it). Do not build an "escalated" chip. */
  escalated: boolean;
  investigatorId: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  // Not returned today (R-01 / R-04): optional so the UI never assumes them.
  execStatus?: ExecStatus;
  clientUserId?: string;
  ptUserId?: string;
}

export interface OpenCaseResult {
  /** false = the session already had an open case (HTTP 200): navigate into it, do not show an error. */
  created: boolean;
  case: DisputeCaseSummary;
}

export interface ListCasesQuery {
  status?: CaseStatus;
  limit?: number;
  offset?: number;
}
export interface ListCasesResult {
  total: number;
  items: DisputeCaseSummary[];
}

// ──────────────────────────────────────────────────────────────────── A3 ──
export interface DisputeClaim {
  id: string;
  caseId: string;
  claimantRole: ClaimantRole;
  text: string;
  moves: ClaimMove[];
  createdBy: string;
  createdAt: string;
}

export interface DisputeIssue {
  id: string;
  caseId: string;
  kind: IssueKind;
  finding: PtLateFinding;
  note: string;
  recordedBy: string;
  createdAt: string;
}

export interface DisputeEvidence {
  id: string;
  caseId: string;
  provenanceType: ProvenanceType;
  source: string;
  subject: string;
  scopeSessionId: string;
  scopeContractId: string;
  eventAt: string | null;
  capturedAt: string;
  submittedBy: string | null;
  submittedRole: string | null;
  captureStatus: CaptureStatus;
  snapshotVersion: number;
  contentHash: string;
  /** Opaque JSON per source. `storedFile.key` (internal storage key) may be present for party files (R-15): never display it. */
  payload: unknown;
  sensitivity: Sensitivity;
  /** The EFFECTIVE status (server overrides the column for party-submitted rows). */
  verificationStatus: VerificationStatus;
  supersedesId: string | null;
  createdAt: string;
  partySubmitted: boolean;
  /** Server-written Vietnamese sentence about how the system came to hold the row. */
  provenanceLabel: string;
}

export interface DisputeStatement {
  id: string;
  caseId: string;
  partyRole: PartyRole;
  authorUserId: string;
  version: number;
  /** "SUBMITTED" or "LEGACY_FIELD". */
  source: string;
  text: string;
  supplementReason: string | null;
  supersedesId: string | null;
  contentHash: string;
  createdAt: string;
}

export interface DisputeShare {
  id: string;
  caseId: string;
  evidenceId: string | null;
  statementId: string | null;
  sharedWithRole: ShareRole;
  sharedBy: string;
  reason: string;
  createdAt: string;
}

export interface EvidenceSnapshotEntry {
  id: string;
  hash: string;
  version: number;
}

export interface DisputeAssessment {
  id: string;
  caseId: string;
  claimId: string;
  assessorId: string;
  directEvidenceIds: string[];
  indirectEvidenceIds: string[];
  rebuttalEvidenceIds: string[];
  relevanceNote: string;
  verifiabilityNote: string;
  consistencyNote: string;
  result: ClaimResult;
  reasoning: string;
  evidenceSnapshot: EvidenceSnapshotEntry[];
  createdAt: string;
}

export interface DisputeFinding {
  id: string;
  caseId: string;
  finding: FindingKind;
  reasoning: string;
  recordedBy: string;
  supersedesId: string | null;
  createdAt: string;
}

export interface DisputeApproval {
  id: string;
  proposalId: string;
  approverId: string;
  result: ApprovalResult;
  reason: string;
  conflictOfInterestDeclaredNone: boolean;
  evidenceChangeAcknowledged: boolean;
  createdAt: string;
}

/**
 * NOTE (F3): the raw row also carries a constant `execution` string. It is intentionally absent from this type; never read it.
 */
export interface DisputeProposal {
  id: string;
  caseId: string;
  findingId: string;
  /** Computed by the server from the finding; never sent by the client. */
  outcome: Outcome;
  proposerId: string;
  executionBlockedReason: ProposalBlockedReason | null;
  evidenceSnapshot: EvidenceSnapshotEntry[];
  createdAt: string;
  approvals: DisputeApproval[];
}

/** NOTE (F3): the raw `decision.execution` is the same constant lie; intentionally not typed. */
export interface DisputeDecision {
  proposalId: string;
  outcome: Outcome;
  executionBlockedReason: ProposalBlockedReason | null;
  // Real execution state: not returned yet (R-01).
  execStatus?: ExecStatus;
  execBlockReason?: ExecBlockReason;
}

/** The payload column is stripped by the server. */
export interface DisputeEvent {
  id: string;
  caseId: string;
  actorUserId: string;
  actorRole: string;
  action: string;
  fromStatus: CaseStatus | null;
  toStatus: CaseStatus | null;
  note: string | null;
  idempotencyKey: string | null;
  createdAt: string;
}

export type LedgerView =
  | { status: "UNAVAILABLE"; error: string }
  | { status: "ABSENT" }
  | {
      status: "FOUND";
      kind: string | null;
      transactionId: string | null;
      createdAt: string;
      /** Opaque JSON stored by payment-service. Never read, never build logic on it. */
      result: unknown;
      obligation: { id: string; status: string; owed: string; paid: string; unpaid: string } | null;
    };

export interface FinancialItem {
  key: string;
  settlementId: string;
  settlementKind: string;
  settlementStatus: string;
  state: FinancialState;
  group: FinancialGroup;
  f3Kind?: F3Kind;
  /** Server Vietnamese label, present only for states that need their own wording. */
  label?: string;
  ledger: LedgerView;
  /** RESOLVED_OTHER only: the lookup carries no reason (R-13). */
  resolutionReason?: { available: false; note: string };
}

export interface FinancialView {
  derived: true;
  observedAt: string;
  group: CaseFinancialGroup;
  groupLabel: string;
  f3Kind?: F3Kind;
  items: FinancialItem[];
}

export interface DisputeCaseDetail {
  case: DisputeCaseSummary;
  claims: DisputeClaim[];
  issues: DisputeIssue[];
  evidence: DisputeEvidence[];
  statements: DisputeStatement[];
  shares: DisputeShare[];
  assessments: DisputeAssessment[];
  findings: DisputeFinding[];
  proposals: DisputeProposal[];
  decision: DisputeDecision | null;
  /** At most the newest 200 (no `truncated` flag, R-14). */
  events: DisputeEvent[];
  financial: FinancialView;
}

// ───────────────────────────────────────────────────── A4 - A12 results ──
export interface AssignResult {
  investigatorId: string;
  version: number;
}
export interface RecollectResult {
  added: number;
  unchanged: number;
}
export interface MoveResult {
  from: CaseStatus | CaseType;
  to: CaseStatus | CaseType;
  version: number;
}
export interface CreatedId {
  id: string;
}
export interface RecordFindingResult {
  id: string;
  finding: FindingKind;
  caseStatus: CaseStatus;
  proposalPossible: boolean;
  blocked?: "DESIGN_REQUIRED";
}

// ─────────────────────────────────────────────────────────────────── A13 ──
export interface ProposalCreated {
  id: string;
  outcome: Outcome;
  executionBlockedReason: ProposalBlockedReason | null;
  caseStatus: CaseStatus;
}
/**
 * HTTP 201 with NO proposal: the finding would cancel a session that has a late-arrival compensation. The case went to POLICY_PENDING.
 * `reason`/`nextStep` are server sentences that mention internal codes: the UI shows its own wording (disputeCaseLabels), not these.
 */
export interface ProposalPolicyPending {
  blocked: "CANCELLED_BLOCKED_BY_D77";
  caseStatus: CaseStatus;
  reason: string;
  nextStep: string;
}
export type ProposeResult =
  | { kind: "PROPOSED"; proposal: ProposalCreated }
  | { kind: "POLICY_PENDING"; policyPending: ProposalPolicyPending };

// ─────────────────────────────────────────────────────────── A14 - A18 ──
export interface DecideResult {
  approvalId: string;
  result: ApprovalResult;
  caseStatus: CaseStatus;
  outcome: Outcome;
  /** Real (set at proposal time). The sibling constant `execution` of the raw answer is not typed (F3). */
  executionBlockedReason?: ProposalBlockedReason | null;
}
export interface AckEvidenceChangeResult {
  acknowledged: true;
  changedIds: string[];
  staleLive: string[];
}
export interface PolicyReviewResult {
  reviewId: string;
  result: PolicyResult;
  contractId: string;
  approved: boolean;
}

// ───────────────────────────────────────────────────────────── B1 - B4 ──
export interface PartyCaseListItem {
  id: string;
  sessionId: string;
  type: CaseType;
  status: CaseStatus;
  role: "CLIENT" | "PT" | null;
  createdAt: string;
}
export interface PartyCaseList {
  items: PartyCaseListItem[];
}
export interface PartyCaseDetail {
  case: {
    id: string;
    sessionId: string;
    type: CaseType;
    status: CaseStatus;
    role: "CLIENT" | "PT";
    createdAt: string;
    canSubmit: boolean;
  };
  accusations: Array<{ id: string; claimantRole: ClaimantRole; text: string; moves: ClaimMove[] }>;
  evidence: Array<{
    id: string;
    provenanceType: ProvenanceType;
    source: string;
    subject: string;
    eventAt: string | null;
    capturedAt: string;
    captureStatus: CaptureStatus;
    snapshotVersion: number;
    payload: unknown;
    verificationStatus: VerificationStatus;
    mine: boolean;
  }>;
  statements: Array<{
    id: string;
    partyRole: PartyRole;
    version: number;
    source: string;
    text: string;
    supplementReason: string | null;
    createdAt: string;
    mine: boolean;
  }>;
  /** Group + server label only: parties never see amounts. */
  financial: { group: CaseFinancialGroup; groupLabel: string };
}
export interface StatementCreated {
  id: string;
  version: number;
}

// ───────────────────────────────────────────────────────────── C1 / C2 ──
/** Raw `Session` row with its contract, as the legacy list returns it (status DISPUTED only; tiers are strings or Decimal strings). */
export interface DisputedSessionRow {
  id: string;
  contractId: string;
  clientUserId: string;
  ptUserId: string;
  status: string;
  scheduledStartAt: string;
  disputeReason: string | null;
  disputeType: string | null;
  disputedAt: string | null;
  ptNotes?: string | null;
  contract?: { packageName?: string | null } & Record<string, unknown>;
}

export type SlaState = "WITHIN_SLA" | "DUE_SOON" | "OVERDUE";
export interface SessionsReconciliationDisputeItem {
  sessionId: string;
  contractId: string;
  disputeType: string | null;
  disputedAt: string;
  ageDays: number;
  slaState: SlaState;
  /** JS number or null (not a string, unlike payment-service money). */
  sessionValue: number | null;
}

// ───────────────────────────────────────────────────── error body shapes ──
/** user-service Dispute Case + late-open. */
export interface CaseErrorBody {
  error: string;
  code?: string;
  details?: Record<string, unknown>;
  fields?: Array<{ path: string; message: string }>;
}
/** Gateway auth / payment-service. */
export interface GatewayErrorBody {
  success: false;
  error: { code?: string; message?: string };
}
