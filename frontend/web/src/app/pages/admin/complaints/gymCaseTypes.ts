/**
 * D6 - response shapes of the gym complaint-case routes (Dispute V2.1 Slice 3), read from the gym-service code at `2297b659`
 * (`services/complaint-case/case.service.ts`, `rules.ts`, `execution.service.ts`) and its HTTP test `complaint-case.read-routes.test.ts`.
 * The gateway envelope is `{ success:true, data }` / `{ success:false, error:{ code, message, details? } }`; the API client unwraps `data`.
 * Every field the screens do not need is typed loosely on purpose (`unknown`) so that nothing is rendered by accident.
 */

/** G37: one flag verdict as gym-service evaluates it. `refusedBecause` is diagnostic only, never shown. */
export interface GymFlagVerdict {
  effective: boolean;
  refusedBecause?: string;
}
export interface GymCapabilities {
  gymCase: GymFlagVerdict;
  decisionReplacement: GymFlagVerdict;
  gymParty?: GymFlagVerdict;
}
/** True only when the server says the gym case flag is effective; anything missing or malformed counts as off. */
export const gymCaseEffective = (c: GymCapabilities | null | undefined): boolean => c?.gymCase?.effective === true;

export type GymCaseClass = "MEM_TXN" | "MEM_CLOSED" | "MEM_VIOLATION" | "MEM_ACCESS" | "GYM_GENERAL";
export const GYM_CASE_CLASSES: readonly GymCaseClass[] = ["MEM_TXN", "MEM_CLOSED", "MEM_VIOLATION", "MEM_ACCESS", "GYM_GENERAL"];
/** Classes that have a money exit and therefore REQUIRE a membership (`MEMBERSHIP_REQUIRED`). `GYM_GENERAL` must not carry one (`MEMBERSHIP_NOT_ALLOWED`). */
export const MONEY_CLASSES: readonly GymCaseClass[] = ["MEM_TXN", "MEM_CLOSED", "MEM_VIOLATION"];

export type GymCaseStatus = "INTAKE" | "COLLECTING" | "AWAITING_PARTIES" | "ASSESSING" | "FINDING_RECORDED" | "AWAITING_APPROVAL" | "DECISION_APPROVED" | "REJECTED_INTAKE" | "APPEAL_REVIEW";
export const GYM_CASE_STATUSES: readonly GymCaseStatus[] = [
  "INTAKE",
  "COLLECTING",
  "AWAITING_PARTIES",
  "ASSESSING",
  "FINDING_RECORDED",
  "AWAITING_APPROVAL",
  "DECISION_APPROVED",
  "REJECTED_INTAKE",
  "APPEAL_REVIEW",
];
export type GymExecStatus = "NOT_STARTED" | "EXECUTING" | "BUSINESS_DONE" | "EXEC_BLOCKED" | "NEEDS_HUMAN";
export type GymOutcome = "REFUND_TRANSACTION_ERROR" | "REFUND_GYM_CLOSED" | "REFUND_GYM_VIOLATION" | "RESOLVE_UPHELD" | "RESOLVE_INSUFFICIENT_EVIDENCE";
export type GymFinding = "ESTABLISHED" | "NOT_ESTABLISHED";
export type GymAssessmentResult = "ESTABLISHED" | "NOT_ESTABLISHED" | "REFUTED";
export type GymClaimantRole = "MEMBER" | "ADMIN_ON_BEHALF";
export type GymClosure = "OPEN" | "CLOSED" | "CLOSED_FINANCIAL_OPEN";

export interface GymCaseSummary {
  id: string;
  complaintId: string;
  gymId: string;
  membershipId: string | null;
  caseClass: GymCaseClass;
  status: GymCaseStatus;
  execStatus: GymExecStatus;
  escalated: boolean;
  investigatorId: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}
/** G1 answer: the summary plus `existing` (true = the complaint already had a case; HTTP 200). */
export type GymOpenCaseResult = GymCaseSummary & { existing: boolean };

/** G2 item. */
export interface GymCaseListItem extends GymCaseSummary {
  issueType: string;
  complaintStatus: string;
  descriptionPreview: string;
}
export interface GymCaseList {
  total: number;
  items: GymCaseListItem[];
}

export type GymFinancialState =
  | "NO_MONEY_EFFECT"
  | "NOT_EXECUTED"
  | "LEDGER_PENDING"
  | "REFUND_BLOCKED"
  | "NO_REFUNDABLE_AMOUNT"
  | "LEDGER_POSTED_FULL"
  | "LEDGER_POSTED_PARTIAL"
  | "NEEDS_RECONCILIATION";
export interface GymFinancial {
  derived: true;
  state: GymFinancialState;
  group: "F1" | "F2" | "F3" | "NONE_YET";
  /** Vietnamese sentence written by the server from what payment-service answered. */
  label: string;
  /** decimal strings; the amount payment-service says it credited to the member's Gymini wallet (internal ledger, not a bank transfer) */
  postedToMemberWallet: string | null;
  memberShortfall: string | null;
  referralClawbackShortfall: string | null;
  observedAt: string | null;
}

/** `allowedActions[]`: the server decides; `reason` is a stable code when `allowed` is false. */
export interface GymAllowedAction {
  action: string;
  allowed: boolean;
  reason?: string;
}

export interface GymComplaintInfo {
  id: string;
  status: string;
  source: string;
  issueType: string;
  description: string;
  photoTokens: string[];
  reporterUserId: string | null;
  adminResponse: string | null;
  resolvedAt: string | null;
}
export interface GymInfo {
  id: string;
  name: string | null;
  ownerId?: string | null;
  status?: string | null;
  operationalStatus?: string | null;
}
export interface GymMembershipInfo {
  id: string;
  status: string;
  startDate: string | null;
  endDate: string | null;
  priceAtPurchase: string;
  paymentTxnId: string | null;
}
export interface GymClaim {
  id: string;
  claimantRole: string;
  text: string;
  createdBy: string;
  createdAt: string;
}
export interface GymEvidence {
  id: string;
  source: string;
  subject: string;
  provenanceType: string;
  provenanceLabel: string;
  partySubmitted: boolean;
  submittedBy: string | null;
  submittedRole: string | null;
  eventAt: string | null;
  capturedAt: string;
  snapshotVersion: number;
  contentHash: string;
  scopeGymId: string;
  sensitivity: string;
  payload: unknown;
  supersedesId: string | null;
  verificationLabel?: string;
  createdAt: string;
}
export interface GymStatement {
  id: string;
  partyRole: string;
  authorUserId: string;
  version: number;
  source: string;
  text: string;
  supplementReason: string | null;
  createdAt: string;
}
export interface GymShare {
  id: string;
  evidenceId: string | null;
  statementId: string | null;
  sharedWithRole: string;
  sharedBy: string;
  reason: string;
  createdAt: string;
}
export interface GymAssessment {
  id: string;
  claimId: string;
  assessorId: string;
  directEvidenceIds: string[];
  indirectEvidenceIds: string[];
  rebuttalEvidenceIds: string[];
  relevanceNote: string;
  verifiabilityNote: string;
  consistencyNote: string;
  result: GymAssessmentResult;
  reasoning: string;
  createdAt: string;
}
export interface GymFindingRow {
  id: string;
  finding: GymFinding;
  reasoning: string;
  recordedBy: string;
  supersedesId: string | null;
  verificationLabel?: string;
  createdAt: string;
}
export interface GymApproval {
  id: string;
  approverId: string;
  result: "APPROVED" | "REJECTED";
  reason: string;
  conflictOfInterestDeclaredNone: boolean;
  evidenceChangeAcknowledged: boolean;
  createdAt: string;
}
export interface GymProposal {
  id: string;
  findingId: string;
  outcome: GymOutcome;
  outcomeLabel: string;
  proposerId: string;
  createdAt: string;
  approvals: GymApproval[];
}
export interface GymDecision {
  proposalId: string;
  outcome: GymOutcome;
  outcomeLabel: string;
  approvalId: string;
}
export interface GymExecutionRow {
  id: string;
  state: string;
  attempt: number;
  blockedReason: string | null;
  note: string | null;
  createdAt: string;
  actorUserId: string | null;
}
export interface GymExecutionBlock {
  status: GymExecStatus;
  decisionId: string | null;
  history: GymExecutionRow[];
}
export interface GymEvent {
  id: string;
  action: string;
  actorUserId: string | null;
  actorRole: string | null;
  fromStatus: string | null;
  toStatus: string | null;
  note: string | null;
  createdAt: string;
}

/** G3. */
export interface GymCaseDetail {
  case: GymCaseSummary;
  complaint: GymComplaintInfo;
  gym: GymInfo | null;
  membership: GymMembershipInfo | null;
  claims: GymClaim[];
  evidence: GymEvidence[];
  statements: GymStatement[];
  shares: GymShare[];
  assessments: GymAssessment[];
  findings: GymFindingRow[];
  proposals: GymProposal[];
  decision: GymDecision | null;
  execution: GymExecutionBlock;
  financial: GymFinancial;
  closure: GymClosure;
  allowedActions: GymAllowedAction[];
  sla?: { state: string; daysOpen?: number } | null;
  deadlines?: Array<{ kind: string; party?: string; startedAt?: string; dueAt?: string | null; status?: string }>;
  appeal?: { canFile?: boolean; closesAt?: string | null; status?: string; reviewerId?: string | null; result?: string | null } | null;
  refundQuote?: { amount: string | number; pricePaid?: string | number; quotedAt?: string } | null;
  replacement?: {
    status?: string;
    reason?: string;
    proposedBy?: string;
    proposedAt?: string;
    /** what the server actually sends for the proposal time (05/11) */
    createdAt?: string;
    approvedBy?: string;
    approvedAt?: string;
    rejectedBy?: string;
    rejectedAt?: string;
  } | null;
  /** newest first, at most 200 */
  events: GymEvent[];
}

export interface GymReplacementResult {
  id: string;
  status: string;
}
export interface GymAppealReviewerResult {
  reviewerId?: string;
  status?: string;
}

/** G4. */
export interface GymHistoryPage {
  total: number;
  items: GymEvent[];
}

// ── write answers ──
export interface GymAssignResult {
  investigatorId: string;
  status: GymCaseStatus;
}
export interface GymTransitionResult {
  status: GymCaseStatus;
}
export interface GymRequestMoreResult {
  status: GymCaseStatus;
  reporterUserId?: string;
}
export interface GymRecollectResult {
  changed: string[];
}
export interface GymCreatedId {
  id: string;
}
export interface GymFindingResult {
  id: string;
  finding: GymFinding;
  caseStatus: GymCaseStatus;
  outcome: GymOutcome;
  outcomeLabel: string;
}
export interface GymProposalResult {
  id: string;
  outcome: GymOutcome;
  outcomeLabel: string;
  caseStatus: GymCaseStatus;
}
export interface GymDecideResult {
  approvalId: string;
  result: "APPROVED" | "REJECTED";
  caseStatus: GymCaseStatus;
  outcome: GymOutcome;
  execution?: string;
}
export interface GymAckResult {
  acknowledged: boolean;
}
export interface GymStatementResult {
  id: string;
  version: number;
}
/** G18. `executionState` is only the business track; the money track is `money`. */
export interface GymExecuteResult {
  replayed: boolean;
  executionState: "BUSINESS_DONE";
  outcome: GymOutcome;
  outcomeLabel: string;
  money: GymFinancial;
  closure: GymClosure;
}
/** G19. */
export type GymReconcileResult =
  | { action: "NOTHING_TO_RECONCILE"; execStatus?: GymExecStatus }
  | { action: "NEEDS_HUMAN"; reason?: string }
  | ({ action: "BUSINESS_DONE" | "RERAN_REFUND" } & GymExecuteResult);

// ── member side (G20-G23) ──
export interface MemberCaseListItem {
  id: string;
  complaintId: string;
  /** Vietnamese progress sentence from the server ("Đã tiếp nhận" ... "Không tiếp nhận"); never an internal status */
  progress: string;
  createdAt: string;
}
export interface MemberCaseList {
  items: MemberCaseListItem[];
}
export interface MemberEvidenceRow {
  id: string;
  source: string;
  subject: string;
  capturedAt: string;
  snapshotVersion: number;
  payload: unknown;
  mine: boolean;
}
export interface MemberStatementRow {
  id: string;
  partyRole: string;
  version: number;
  text: string;
  supplementReason: string | null;
  createdAt: string;
  mine: boolean;
}
export interface MemberCaseDetail {
  case: { id: string; complaintId: string; progress: string; createdAt: string; canSubmit: boolean };
  complaint: { issueType: string; description: string };
  evidence: MemberEvidenceRow[];
  statements: MemberStatementRow[];
  /** only when the case was handled: a member-safe sentence + the amounts payment-service confirmed */
  money: { label: string; postedToWallet: string | null; stillOwed: string | null } | null;
  resolution: { text: string | null } | null;
  appeal?: { canFile?: boolean; closesAt?: string | null; used?: boolean; progress?: string } | null;
}

/** The old complaint list (H1) with the R-18 paging meta. */
export interface ComplaintPageMeta {
  total: number;
  limit: number | null;
  offset: number;
}
