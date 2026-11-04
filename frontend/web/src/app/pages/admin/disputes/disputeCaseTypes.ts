/**
 * Dispute V2.1 admin UI (D1, adapted in D5) - response types of the FINAL backend contract (branch `dispute-backend-completion`,
 * `_warroom/sessions/DISPUTE_V21_API_CONTRACT_FINAL.md`).
 *
 * Source of truth is the code (user-service `services/dispute-case/{schemas,rules,allowed-actions,financial}.ts`, `dispute-case.service.ts`,
 * the Prisma enums), NOT the documents. Dates arrive as ISO strings; money arrives as decimal STRINGS (never do arithmetic on them).
 * Pure types: no runtime code except the `as const` enum lists (so a test can check every value is labelled).
 *
 * The old hard-coded `execution: "BLOCKED: SLICE_2_NOT_ENABLED"` constant is GONE from the server (breaking change 2): the execution axis
 * is `case.execStatus` and the `execution` block of the detail. A payload that still carries the constant is simply not read.
 * `execStatus` stays optional where a stale or partial answer could lack it, so "absent" is never read as "NOT_STARTED".
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

/** Why a case was closed WITHOUT a decision (`REJECTED_INTAKE` + `closeReason`; never call it "bị từ chối" without looking at this). */
export const CLOSE_REASONS = ["INTAKE_REJECTED", "ORPHAN_SESSION_LEFT_DISPUTE", "NOT_A_DISPUTE"] as const;
export type CloseReason = (typeof CLOSE_REASONS)[number];

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

/** Execution axis (`case.execStatus`, `execution.status`). */
export const EXEC_STATUSES = ["NOT_STARTED", "EXECUTING", "BUSINESS_DONE", "EXEC_BLOCKED", "NEEDS_HUMAN"] as const;
export type ExecStatus = (typeof EXEC_STATUSES)[number];

export const EXEC_BLOCK_REASONS = [
  "PT_NO_SHOW_REPORTED_NOT_SUPPORTED",
  "CONTRACT_ENDING",
  "LEDGER_UNREADABLE",
  "D77_COMBINATION_UNRESOLVED",
  "CANCELLED_BLOCKED_BY_D77",
  // readable BEFORE executing (`execution.blockers[].code`)
  "POLICY_ELIGIBILITY_UNVERIFIED",
  "POLICY_EXCEPTION_APPLIES",
  "EXECUTION_DISABLED",
  "SESSION_ALREADY_PROCESSED",
] as const;
export type ExecBlockReason = (typeof EXEC_BLOCK_REASONS)[number];

/** Why a proposal cannot be executed (set at proposal time). */
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
/** `Summary` of the contract (section 1). Names come with the list / detail / queue reads (null = no profile or lookup failed; never an e-mail). */
export interface DisputeCaseSummary {
  id: string;
  sessionId: string;
  contractId: string;
  clientUserId: string;
  ptUserId: string;
  type: CaseType;
  status: CaseStatus;
  /** Always false today (no code writes it). Do not build an "escalated" chip. */
  escalated: boolean;
  investigatorId: string | null;
  execStatus: ExecStatus;
  execDecisionId: string | null;
  /** null while the case is open or decided; set when it was closed without a decision. */
  closeReason: CloseReason | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  clientName?: string | null;
  ptName?: string | null;
  investigatorName?: string | null;
}

/** A9 answer: carries ids only (no names). */
export interface OpenCaseResult {
  /** false = the session already had an open case (HTTP 200): navigate into it, do not show an error. */
  created: boolean;
  case: DisputeCaseSummary;
}

export const CASE_SORTS = ["createdAt", "updatedAt"] as const;
export type CaseSort = (typeof CASE_SORTS)[number];
export interface ListCasesQuery {
  status?: CaseStatus;
  execStatus?: ExecStatus;
  type?: CaseType;
  investigatorId?: string;
  unassigned?: boolean;
  sessionId?: string;
  contractId?: string;
  /** ISO instants (createdTo is inclusive on the server). */
  createdFrom?: string;
  createdTo?: string;
  sort?: CaseSort;
  order?: "asc" | "desc";
  limit?: number;
  offset?: number;
}
export interface Paged<T> {
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
  items: T[];
}
export type ListCasesResult = Paged<DisputeCaseSummary>;

/** A3 (queue): one row per session in dispute or waiting for the PT's answer. */
export type QueueSessionStatus = "DISPUTED" | "PT_NO_SHOW_REPORTED";
export interface QueueQuery {
  sessionStatus?: QueueSessionStatus;
  hasCase?: boolean;
  contractId?: string;
  limit?: number;
  offset?: number;
}
export interface QueueItem {
  sessionId: string;
  contractId: string;
  sessionStatus: QueueSessionStatus;
  disputeType: string | null;
  disputedAt: string | null;
  scheduledStartAt: string | null;
  clientUserId: string;
  ptUserId: string;
  clientName: string | null;
  ptName: string | null;
  hasCase: boolean;
  needsCase: boolean;
  caseId: string | null;
  caseStatus: CaseStatus | null;
  caseType: CaseType | null;
  execStatus: ExecStatus | null;
  investigatorId: string | null;
}
export type QueueResult = Paged<QueueItem>;

/** A1 (capabilities): read-only verdicts of the five server flags in THIS process. */
export const CAPABILITY_FLAGS = ["execution", "t0", "evidenceStorage", "lateOpenReconciliation", "d65bResolution"] as const;
export type CapabilityFlag = (typeof CAPABILITY_FLAGS)[number];
export interface Capabilities {
  execution: boolean;
  t0: boolean;
  evidenceStorage: boolean;
  lateOpenReconciliation: boolean;
  d65bResolution: boolean;
  details: Partial<Record<CapabilityFlag, { effective: boolean; refusedBecause?: string }>>;
}

/** A5 access log. */
export interface AccessLogItem {
  id: string;
  viewerUserId: string;
  viewerName: string | null;
  viewerRole: string;
  action: string;
  evidenceId: string | null;
  createdAt: string;
}
export type AccessLogResult = Paged<AccessLogItem>;

/** S3 `GET /admin/sessions/:id` (no contract money, no split ratios). */
export interface AdminSessionCaseRef {
  id: string;
  status: CaseStatus;
  type: CaseType;
  execStatus: ExecStatus;
  investigatorId: string | null;
  closeReason: CloseReason | null;
  createdAt: string;
}
export interface AdminSessionDetail {
  session: {
    id: string;
    contractId: string;
    clientUserId: string;
    clientName: string | null;
    ptUserId: string;
    ptName: string | null;
    status: string;
    sessionMode: string | null;
    scheduledStartAt: string | null;
    scheduledEndAt: string | null;
    disputeType: string | null;
    disputeReason: string | null;
    ptNotes: string | null;
    disputedAt: string | null;
    completedAt: string | null;
    sessionDeducted: boolean | null;
    ptAtFault: boolean | null;
    clientConfirmDeadline: string | null;
    autoConfirmed: boolean | null;
    cancelledBy: string | null;
    resolvedBy: string | null;
    resolvedAt: string | null;
    resolvedByCaseDecisionId: string | null;
    roomPtJoinedAt: string | null;
    roomClientJoinedAt: string | null;
  };
  contract: { id: string; status: string; packageName: string | null; sessionMode: string | null; totalSessions: number | null; usedSessions: number | null } | null;
  openCase: AdminSessionCaseRef | null;
  cases: AdminSessionCaseRef[];
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

/** The approved decision (null until an APPROVED approval exists). Its execution state is `execution` / `case.execStatus`. */
export interface DisputeDecision {
  proposalId: string;
  approvalId: string;
  outcome: Outcome;
  approvedBy: string;
  approvedAt: string;
  executionBlockedReason: ProposalBlockedReason | null;
}

/** `latestProposal` / `latestApproval` of the detail (the newest ones, not the whole history). */
export interface LatestProposal {
  id: string;
  outcome: Outcome;
  proposerId: string;
  executionBlockedReason: ProposalBlockedReason | null;
  createdAt: string;
}
export interface LatestApproval {
  id: string;
  proposalId: string;
  approverId: string;
  result: ApprovalResult;
  reason: string;
  createdAt: string;
}

// ── execution block (R-01) ──
export interface ExecutionBlocker {
  code: string;
  message: string;
}
export interface ExecutionHistoryItem {
  id: string;
  /** STARTED | BLOCKED | NEEDS_HUMAN | BUSINESS_DONE */
  state: string;
  attempt: number;
  outcome: Outcome | null;
  blockedReason: string | null;
  note: string | null;
  actorUserId: string;
  /** Opaque JSON of the executor's answer. Never displayed raw. */
  response: unknown;
  createdAt: string;
}
export interface ExecutionView {
  status: ExecStatus;
  decisionId: string | null;
  outcome: Outcome | null;
  blockedReason: string | null;
  blockedReasonText: string | null;
  blockers: ExecutionBlocker[];
  needsHuman: { reason: string | null; detail: unknown; sessionStatus: string | null } | null;
  history: ExecutionHistoryItem[];
  acknowledgements: Array<{ actorUserId: string; note: string | null; createdAt: string }>;
  moneyNote: string;
}

// ── policy eligibility reviews (A6 / A7, D-NEW-12) ──
export interface PolicyReviewItem {
  reviewId: string;
  caseId: string;
  contractId: string;
  result: PolicyResult;
  status: "PENDING" | "APPROVED";
  /** true = the review in force for the contract. */
  current: boolean;
  evidenceIds: string[];
  reasoning: string;
  proposedBy: string;
  proposedAt: string;
  approvedBy: string | null;
  approvedAt: string | null;
  supersedesId: string | null;
}
export interface PolicyReviewList {
  contractId: string;
  currentReviewId: string | null;
  currentResult: PolicyResult | null;
  items: PolicyReviewItem[];
}

// ── allowedActions (contract 3.3): the server says what the viewer may do RIGHT NOW ──
export const ACTION_NAMES = [
  "assign",
  "recollect",
  "transition",
  "requestMore",
  "classify",
  "addClaim",
  "addIssue",
  "addAssessment",
  "recordFinding",
  "propose",
  "decide",
  "acknowledgeEvidenceChange",
  "proposePolicyEligibility",
  "approvePolicyEligibility",
  "share",
  "execute",
  "reconcileExecution",
  "acknowledgeNeedsHuman",
  "closeNotADispute",
  "closeOrphan",
  "readEvidenceFile",
] as const;
export type ActionName = (typeof ACTION_NAMES)[number];
export interface ActionVerdict {
  allowed: boolean;
  /** stable machine code of the reason it is not allowed */
  code?: string;
  /** Vietnamese, no internal enum */
  message?: string;
  /** transition: the target states; decide: APPROVED / REJECTED; approvePolicyEligibility: the reviewIds the viewer may approve */
  options?: string[];
}

/** R-14: no payload, no idempotency key. `summary` holds only the SHORT scalar facts the action recorded (ids, counts, results). */
export interface DisputeEvent {
  id: string;
  actorUserId: string;
  actorRole: string;
  action: string;
  fromStatus: CaseStatus | null;
  toStatus: CaseStatus | null;
  note: string | null;
  createdAt: string;
  summary?: Record<string, unknown> | null;
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
  /** RESOLVED_OTHER only (R-13): `available:true` carries the note payment-service stored; `available:false` = older ledger rows, no reason. */
  resolutionReason?: { available: false; note: string } | { available: true; note: string; resolvedAt?: string | null };
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
  case: DisputeCaseSummary & {
    /** the REAL status of the case's session */
    sessionStatus?: string | null;
    /** a case still open whose session left the dispute */
    orphan?: boolean;
  };
  claims: DisputeClaim[];
  issues: DisputeIssue[];
  evidence: DisputeEvidence[];
  statements: DisputeStatement[];
  shares: DisputeShare[];
  assessments: DisputeAssessment[];
  findings: DisputeFinding[];
  proposals: DisputeProposal[];
  latestProposal?: LatestProposal | null;
  latestApproval?: LatestApproval | null;
  decision: DisputeDecision | null;
  execution?: ExecutionView;
  policyReviews?: PolicyReviewList;
  /** Names of the actions allowed right now (server computed; four-eyes and conflict of interest aware). */
  allowedActions?: ActionName[] | string[];
  actions?: Partial<Record<ActionName, ActionVerdict>>;
  /** newest first, at most `eventsLimit` */
  events: DisputeEvent[];
  eventsLimit?: number;
  eventsTruncated?: boolean;
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
  /** Sources that could not be read this time: the previous good copy was NOT overwritten. */
  skippedUnavailable?: string[];
}
export interface CloseResult {
  closed: boolean;
  from: CaseStatus;
  to: CaseStatus;
  closeReason: CloseReason;
  version: number;
  moneyMoved: false;
  sessionStatus?: string;
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
  execStatus?: ExecStatus;
}
/**
 * F4: HTTP 200 `{proposalCreated:false, proposal:null, policyPending:true, ...}` - NO proposal exists: the finding would cancel a session that has a
 * late-arrival compensation. The case went to POLICY_PENDING. A proposal exists only when `proposalCreated === true` (HTTP 201).
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
  /** Only on APPROVED. An approval NEVER executes: `NOT_STARTED` here means "approved, not executed yet". */
  execStatus?: ExecStatus;
  executionBlockedReason?: ProposalBlockedReason | null;
}

// ──────────────────────────────────────────────────────── A27 - A29 (flag `execution`) ──
/** A27 - HTTP 200. `BUSINESS_DONE` is the business answer of the session; it is NOT "money arrived". */
export interface ExecuteResult {
  replayed: boolean;
  executionState: "BUSINESS_DONE";
  outcome: Outcome;
  decisionId: string;
  session?: { id: string; status: string; sessionDeducted?: boolean | null; ptAtFault?: boolean | null; resolvedByCaseDecisionId?: string | null };
  /** derived money axis (group only) - never summed or shown as "paid" from here */
  money?: unknown;
}
export type ReconcileAction = "NOTHING_TO_RECONCILE" | "RERAN_CORE" | "BUSINESS_DONE" | "NEEDS_HUMAN";
export interface ReconcileResult {
  action: ReconcileAction;
  execStatus?: ExecStatus;
  reason?: string;
}
export type AckNeedsHumanAction = "BUSINESS_DONE" | "STAYS_LOCKED";
export interface AckNeedsHumanResult {
  action: AckNeedsHumanAction;
  execStatus?: ExecStatus;
  /** STAYS_LOCKED only */
  reason?: string;
  sessionStatus?: string;
  message?: string;
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
