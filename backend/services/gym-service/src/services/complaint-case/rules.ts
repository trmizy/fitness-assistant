/**
 * GYM COMPLAINT CASE (Slice 3) - the PURE rules (no database, no network). docs/DISPUTE_CASE_DESIGN_V2_1.md §1.2, §1.3.4, §1.4, §1.5.
 * Everything that decides something lives here so a unit test can pin it; the service only wires it to rows.
 */

// ── Classes, findings and the ONLY mapping to an outcome (§1.4.1 item 8: derived by a rule, never typed by a person) ───────────────

export type CaseClass = 'MEM_TXN' | 'MEM_CLOSED' | 'MEM_VIOLATION' | 'MEM_ACCESS' | 'GYM_GENERAL';
export const CASE_CLASSES: readonly CaseClass[] = ['MEM_TXN', 'MEM_CLOSED', 'MEM_VIOLATION', 'MEM_ACCESS', 'GYM_GENERAL'];
export type FindingKind = 'ESTABLISHED' | 'NOT_ESTABLISHED';
export type Outcome =
  | 'REFUND_TRANSACTION_ERROR'
  | 'REFUND_GYM_CLOSED'
  | 'REFUND_GYM_VIOLATION'
  | 'RESOLVE_UPHELD'
  | 'RESOLVE_INSUFFICIENT_EVIDENCE';
export type RefundReason = 'TRANSACTION_ERROR' | 'GYM_CLOSED' | 'GYM_VIOLATION_SUSPENDED';

/** Only these three classes have a money exit (design §1.3.4). MEM_ACCESS and every GYM_* class have none. */
export const MONEY_CLASSES: readonly CaseClass[] = ['MEM_TXN', 'MEM_CLOSED', 'MEM_VIOLATION'];
export const hasMoneyExit = (c: CaseClass) => MONEY_CLASSES.includes(c);

export function outcomeFor(caseClass: CaseClass, finding: FindingKind): Outcome {
  if (finding === 'NOT_ESTABLISHED') return 'RESOLVE_INSUFFICIENT_EVIDENCE'; // "chưa đủ căn cứ": RESOLVED, never a refund
  switch (caseClass) {
    case 'MEM_TXN':
      return 'REFUND_TRANSACTION_ERROR';
    case 'MEM_CLOSED':
      return 'REFUND_GYM_CLOSED';
    case 'MEM_VIOLATION':
      return 'REFUND_GYM_VIOLATION';
    default:
      return 'RESOLVE_UPHELD'; // MEM_ACCESS / GYM_GENERAL: established, but no money exit
  }
}

export const isRefundOutcome = (o: Outcome) => o === 'REFUND_TRANSACTION_ERROR' || o === 'REFUND_GYM_CLOSED' || o === 'REFUND_GYM_VIOLATION';

/** The refundByAdmin reason that matches a refund outcome (membership.service ADMIN_REFUND_REASONS). */
export function refundReasonFor(o: Outcome): RefundReason | null {
  switch (o) {
    case 'REFUND_TRANSACTION_ERROR':
      return 'TRANSACTION_ERROR';
    case 'REFUND_GYM_CLOSED':
      return 'GYM_CLOSED';
    case 'REFUND_GYM_VIOLATION':
      return 'GYM_VIOLATION_SUSPENDED';
    default:
      return null;
  }
}

/** Plain Vietnamese label of an outcome for the admin screen (no internal enum reaches a normal user). */
export function outcomeLabelVi(o: Outcome): string {
  switch (o) {
    case 'REFUND_TRANSACTION_ERROR':
      return 'Hoàn tiền gói: giao dịch bị lỗi';
    case 'REFUND_GYM_CLOSED':
      return 'Hoàn tiền gói: phòng tập đã đóng cửa';
    case 'REFUND_GYM_VIOLATION':
      return 'Hoàn tiền gói: phòng tập vi phạm';
    case 'RESOLVE_UPHELD':
      return 'Ghi nhận khiếu nại là đúng, không phát sinh tiền';
    default:
      return 'Chưa đủ căn cứ, không hoàn tiền';
  }
}

// ── Status machine ────────────────────────────────────────────────────────────────────────────────────────────────

export type CaseStatus =
  | 'INTAKE'
  | 'COLLECTING'
  | 'AWAITING_PARTIES'
  | 'ASSESSING'
  | 'FINDING_RECORDED'
  | 'AWAITING_APPROVAL'
  | 'DECISION_APPROVED'
  | 'REJECTED_INTAKE';
export const CASE_STATUSES: readonly CaseStatus[] = [
  'INTAKE',
  'COLLECTING',
  'AWAITING_PARTIES',
  'ASSESSING',
  'FINDING_RECORDED',
  'AWAITING_APPROVAL',
  'DECISION_APPROVED',
  'REJECTED_INTAKE',
];
export const TERMINAL_STATUSES: readonly CaseStatus[] = ['DECISION_APPROVED', 'REJECTED_INTAKE'];

export const TRANSITIONS: Readonly<Record<CaseStatus, readonly CaseStatus[]>> = {
  INTAKE: ['COLLECTING', 'REJECTED_INTAKE'],
  COLLECTING: ['AWAITING_PARTIES', 'ASSESSING'],
  AWAITING_PARTIES: ['COLLECTING', 'ASSESSING'],
  ASSESSING: ['COLLECTING', 'AWAITING_PARTIES', 'FINDING_RECORDED'],
  FINDING_RECORDED: ['AWAITING_APPROVAL', 'ASSESSING'],
  AWAITING_APPROVAL: ['DECISION_APPROVED', 'ASSESSING'],
  DECISION_APPROVED: [],
  REJECTED_INTAKE: [],
};
export const canTransition = (from: CaseStatus, to: CaseStatus) => TRANSITIONS[from].includes(to);

/** Targets the generic transition endpoint accepts. The others are earned by an action (finding, proposal, four-eyes decision). */
export const MANUAL_TARGETS: readonly CaseStatus[] = ['COLLECTING', 'AWAITING_PARTIES', 'ASSESSING', 'REJECTED_INTAKE'];
export const MANUAL_FROM_BLOCKED: readonly CaseStatus[] = ['AWAITING_APPROVAL'];
export const canTransitionManually = (from: CaseStatus, to: CaseStatus) =>
  MANUAL_TARGETS.includes(to) && !MANUAL_FROM_BLOCKED.includes(from) && canTransition(from, to);

/** States in which the member may add a statement / evidence record. */
export const PARTY_SUBMIT_STATUSES: readonly CaseStatus[] = ['COLLECTING', 'AWAITING_PARTIES', 'ASSESSING'];
/** States in which the investigator may record claims, shares and on-behalf entries. */
export const INVESTIGATION_STATUSES: readonly CaseStatus[] = ['COLLECTING', 'AWAITING_PARTIES', 'ASSESSING'];

// ── Four eyes + conflict of interest ──────────────────────────────────────────────────────────────────────────────

export interface ApproverCheckInput {
  approverId: string;
  approverRole: string;
  proposerId: string;
  investigatorId: string | null;
  /** the member who filed the complaint */
  reporterUserId: string;
  /** the gym's owner (a party to the complaint's subject): an admin that IS the owner cannot decide it */
  gymOwnerId: string | null;
  conflictOfInterestDeclaredNone: boolean;
}
export type ApproverVerdict = { ok: true } | { ok: false; status: number; code: string; message: string };

export function checkApprover(i: ApproverCheckInput): ApproverVerdict {
  if (i.approverRole !== 'ADMIN') return { ok: false, status: 403, code: 'ADMIN_ONLY', message: 'Chỉ quản trị viên được duyệt đề xuất' };
  if (i.approverId === i.proposerId) {
    return { ok: false, status: 403, code: 'SELF_APPROVAL_FORBIDDEN', message: 'Người đề xuất không được tự duyệt đề xuất của mình' };
  }
  if (i.investigatorId && i.approverId === i.investigatorId) {
    return { ok: false, status: 403, code: 'SELF_APPROVAL_FORBIDDEN', message: 'Điều tra viên của hồ sơ không được duyệt đề xuất của chính hồ sơ đó' };
  }
  if (i.approverId === i.reporterUserId || (i.gymOwnerId && i.approverId === i.gymOwnerId)) {
    return { ok: false, status: 403, code: 'CONFLICT_OF_INTEREST', message: 'Người duyệt là một bên của vụ việc nên không được duyệt' };
  }
  if (i.conflictOfInterestDeclaredNone !== true) {
    return { ok: false, status: 403, code: 'CONFLICT_OF_INTEREST', message: 'Người duyệt phải khai báo không có xung đột lợi ích' };
  }
  return { ok: true };
}

// ── Roles, branch and the locked GYM party ───────────────────────────────────────────────────────────────────────

/**
 * D-NEW-9 (is the Gym a party?) and D-NEW-3 (appeal for the Gym) are OPEN POLICY decisions. This constant is the single place the lock is expressed in
 * CODE (the database refuses a GYM party row regardless). It is deliberately not read from the environment: turning it on is a code + migration change.
 */
export const GYM_PARTY_ENABLED = false;

export interface Viewer {
  userId: string;
  role: string; // ADMIN | CUSTOMER | PT | GYM_OWNER | ...
  /** branches the viewer is scoped to (owner / staff). Unused until GYM_PARTY_ENABLED. */
  gymIds?: readonly string[];
}
export type ViewerKind = 'ADMIN' | 'MEMBER' | 'GYM' | 'NONE';

export function viewerKind(v: Viewer, c: { reporterUserId: string; gymId: string }): ViewerKind {
  if (v.role === 'ADMIN') return 'ADMIN';
  if (v.userId === c.reporterUserId) return 'MEMBER';
  // The gym's own people see NOTHING while the Gym is not a party; once it is, they see only THEIR branch.
  if (GYM_PARTY_ENABLED && v.gymIds?.includes(c.gymId)) return 'GYM';
  return 'NONE';
}

/** Evidence sources a member may always see about their own complaint (they supplied or own the data). */
export const MEMBER_OWN_SOURCES: readonly string[] = ['COMPLAINT_RECORD', 'COMPLAINT_PHOTO', 'MEMBERSHIP_RECORD'];

export interface EvidenceLike {
  id: string;
  source: string;
  submittedBy: string | null;
  sensitivity: string;
  scopeGymId: string;
}
export interface ShareLike {
  evidenceId: string | null;
  statementId: string | null;
  sharedWithRole: string;
}

export function evidenceVisibleTo(e: EvidenceLike, kind: ViewerKind, viewerId: string, caseGymId: string, shares: readonly ShareLike[]): boolean {
  if (kind === 'ADMIN') return true;
  if (e.scopeGymId !== caseGymId) return false; // branch scope: evidence of another branch is never shown through this case
  if (kind === 'MEMBER') {
    if (e.submittedBy === viewerId) return true;
    if (shares.some((s) => s.evidenceId === e.id && s.sharedWithRole === 'MEMBER')) return true;
    return e.sensitivity !== 'SENSITIVE' && MEMBER_OWN_SOURCES.includes(e.source);
  }
  return false; // GYM / NONE: locked
}

export interface StatementLike {
  id: string;
  partyRole: string;
  authorUserId: string;
}
export function statementVisibleTo(s: StatementLike, kind: ViewerKind, viewerId: string, shares: readonly ShareLike[]): boolean {
  if (kind === 'ADMIN') return true;
  if (kind === 'MEMBER') return s.authorUserId === viewerId || s.partyRole === 'MEMBER' || shares.some((x) => x.statementId === s.id && x.sharedWithRole === 'MEMBER');
  return false;
}

// ── Evidence snapshot & change guard (§1.6.4) ─────────────────────────────────────────────────────────────────────

export interface SnapshotEntry {
  id: string;
  hash: string;
  version: number;
}

export interface ChangeCheckInput {
  snapshot: readonly SnapshotEntry[];
  current: ReadonlyArray<{ id: string; hash: string; createdAt: Date }>;
  /** (source, subject) slots whose live source no longer hashes to the latest stored row and nobody re-collected yet */
  staleLive: readonly string[];
}
export interface ChangeCheckResult {
  changed: boolean;
  newIds: string[];
  mutatedIds: string[];
  lastChangeAt: Date | null;
  staleLive: string[];
}

export function diffAgainstSnapshot(i: ChangeCheckInput): ChangeCheckResult {
  const was = new Map(i.snapshot.map((s) => [s.id, s.hash]));
  const newIds: string[] = [];
  const mutatedIds: string[] = [];
  let last: Date | null = null;
  for (const c of i.current) {
    const h = was.get(c.id);
    if (h === undefined) {
      newIds.push(c.id);
      if (!last || c.createdAt > last) last = c.createdAt;
    } else if (h !== c.hash) mutatedIds.push(c.id);
  }
  return { changed: newIds.length > 0 || mutatedIds.length > 0 || i.staleLive.length > 0, newIds, mutatedIds, lastChangeAt: last, staleLive: [...i.staleLive] };
}

/**
 * A change is acceptable only if the investigator acknowledged it AFTER the last change and the approver ticked the box. Live data that no longer
 * matches the stored evidence (staleLive) is never acceptable: someone must re-collect first.
 */
export function changeAcknowledged(g: ChangeCheckResult, approverTicked: boolean, ackTimes: readonly Date[]): boolean {
  if (!g.changed) return true;
  if (g.staleLive.length > 0 || g.mutatedIds.length > 0) return false;
  if (!approverTicked) return false;
  if (!g.lastChangeAt) return true;
  return ackTimes.some((t) => t.getTime() >= g.lastChangeAt!.getTime());
}

// ── Money axis (§1.2.3), DERIVED from what payment-service returned ───────────────────────────────────────────────

export type FinancialState =
  | 'NO_MONEY_EFFECT'
  | 'NOT_EXECUTED'
  | 'LEDGER_PENDING'
  | 'REFUND_BLOCKED'
  | 'NO_REFUNDABLE_AMOUNT'
  | 'LEDGER_POSTED_FULL'
  | 'LEDGER_POSTED_PARTIAL'
  | 'NEEDS_RECONCILIATION';
export type FinancialGroup = 'F1' | 'F2' | 'F3' | 'NONE_YET';

/** What the executor stored from payment-service's answers (execution row `response`). Amounts are decimal strings. */
export interface PaymentObservation {
  refundAmount?: string | null; // what the quote asked payment-service to refund
  refundedToClient?: string | null; // release.refundedToClient as returned
  releaseShortfall?: string | null; // release.shortfall as returned
  clawbackObserved?: boolean; // false when the clawback answer was not seen (e.g. replay after a crash)
  clawbackRecovered?: string | null;
  clawbackShortfall?: string | null;
  observedAt?: string | null;
}
const num = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

export interface FinancialView {
  derived: true;
  state: FinancialState;
  group: FinancialGroup;
  label: string;
  /** amount payment-service says it credited to the member's wallet (internal ledger, NOT a bank transfer) */
  postedToMemberWallet: string | null;
  /** amount still owed to the member */
  memberShortfall: string | null;
  /** referral-commission clawback not recovered: a platform-side shortfall, never the member's */
  referralClawbackShortfall: string | null;
  observedAt: string | null;
}

export function deriveFinancialView(i: {
  outcome: Outcome | null;
  execStatus: string;
  observation: PaymentObservation | null;
  blockedReason?: string | null;
}): FinancialView {
  const base = { derived: true as const, postedToMemberWallet: null, memberShortfall: null, referralClawbackShortfall: null, observedAt: i.observation?.observedAt ?? null };
  if (!i.outcome || !isRefundOutcome(i.outcome)) {
    return {
      ...base,
      state: 'NO_MONEY_EFFECT',
      group: i.outcome ? 'F2' : 'NONE_YET',
      label: i.outcome ? 'Không phát sinh tiền' : 'Chưa có quyết định',
    };
  }
  if (i.execStatus === 'NOT_STARTED') return { ...base, state: 'NOT_EXECUTED', group: 'NONE_YET', label: 'Chưa thực hiện hoàn tiền' };
  if (i.execStatus === 'EXECUTING') return { ...base, state: 'LEDGER_PENDING', group: 'F3', label: 'Đang xử lý hoàn tiền, chưa có xác nhận ghi sổ' };
  if (i.execStatus === 'EXEC_BLOCKED') {
    return { ...base, state: 'REFUND_BLOCKED', group: 'F3', label: `Chưa hoàn tiền: ${i.blockedReason ?? 'đang chờ xử lý'}` };
  }
  if (i.execStatus === 'NEEDS_HUMAN' || !i.observation) {
    return { ...base, state: 'NEEDS_RECONCILIATION', group: 'F3', label: 'Cần đối soát, chưa xác nhận khoản hoàn' };
  }
  const o = i.observation;
  const refunded = num(o.refundedToClient);
  const releaseShort = num(o.releaseShortfall);
  const clawShort = num(o.clawbackShortfall);
  const withMoney = {
    ...base,
    postedToMemberWallet: refunded > 0 ? refunded.toFixed(2) : null,
    memberShortfall: releaseShort > 0 ? releaseShort.toFixed(2) : null,
    referralClawbackShortfall: clawShort > 0 ? clawShort.toFixed(2) : null,
  };
  if (releaseShort > 0) {
    return { ...withMoney, state: 'LEDGER_POSTED_PARTIAL', group: 'F3', label: `Đã ghi vào ví Gymini ${refunded.toFixed(2)}, còn thiếu ${releaseShort.toFixed(2)} (chưa trả)` };
  }
  if (refunded <= 0) {
    return { ...withMoney, state: 'NO_REFUNDABLE_AMOUNT', group: 'F2', label: 'Không có khoản nào để hoàn (phần chưa dùng bằng 0)' };
  }
  if (clawShort > 0 || o.clawbackObserved === false) {
    return {
      ...withMoney,
      state: 'NEEDS_RECONCILIATION',
      group: 'F3',
      label: `Đã ghi vào ví Gymini ${refunded.toFixed(2)}; phần thu hồi hoa hồng giới thiệu cần đối soát`,
    };
  }
  return { ...withMoney, state: 'LEDGER_POSTED_FULL', group: 'F1', label: `Đã ghi vào ví Gymini: ${refunded.toFixed(2)}` };
}

/** What the member may read: never an internal group, never the platform-side clawback shortfall; a refund is claimed ONLY when payment confirmed it. */
export function memberFinancialView(v: FinancialView): { label: string; postedToWallet: string | null; stillOwed: string | null } {
  const posted = v.postedToMemberWallet;
  if (v.state === 'LEDGER_POSTED_FULL' || (v.state === 'NEEDS_RECONCILIATION' && posted && v.memberShortfall === null)) {
    return { label: `Khoản hoàn ${posted} đã được ghi vào ví Gymini của bạn`, postedToWallet: posted, stillOwed: null };
  }
  if (v.state === 'LEDGER_POSTED_PARTIAL') {
    return { label: `Đã ghi vào ví Gymini của bạn ${posted ?? '0.00'}; phần còn lại ${v.memberShortfall} đang được xử lý, chưa trả`, postedToWallet: posted, stillOwed: v.memberShortfall };
  }
  if (v.state === 'NO_MONEY_EFFECT') return { label: 'Khiếu nại này không phát sinh khoản tiền', postedToWallet: null, stillOwed: null };
  if (v.state === 'NO_REFUNDABLE_AMOUNT') return { label: 'Không có khoản nào để hoàn', postedToWallet: null, stillOwed: null };
  if (v.state === 'NOT_EXECUTED') return { label: 'Chưa có khoản hoàn nào', postedToWallet: null, stillOwed: null };
  return { label: 'Khoản hoàn đang được xử lý, chưa có xác nhận', postedToWallet: null, stillOwed: null };
}

export type ClosureState = 'OPEN' | 'CLOSED' | 'CLOSED_FINANCIAL_OPEN';
/** CLOSED = adjudication finished + business done + money in F1/F2; CLOSED_FINANCIAL_OPEN = done but money still F3. Closing never implies money moved. */
export function closureOf(status: CaseStatus, execStatus: string, v: FinancialView): ClosureState {
  if (status === 'REJECTED_INTAKE') return 'CLOSED';
  if (status !== 'DECISION_APPROVED' || execStatus !== 'BUSINESS_DONE') return 'OPEN';
  return v.group === 'F3' ? 'CLOSED_FINANCIAL_OPEN' : 'CLOSED';
}

// ── Messages to the member (no internal enum, never "paid" unless confirmed) ─────────────────────────────────────

export function memberResolutionText(outcome: Outcome, v: FinancialView): string {
  if (isRefundOutcome(outcome)) {
    const m = memberFinancialView(v);
    return `Báo cáo vấn đề của bạn đã được xem xét và chấp nhận. ${m.label}.`;
  }
  if (outcome === 'RESOLVE_UPHELD') return 'Báo cáo vấn đề của bạn đã được xem xét và ghi nhận. Khiếu nại này không phát sinh khoản tiền nào.';
  return 'Báo cáo vấn đề của bạn đã được xem xét nhưng hiện chưa đủ căn cứ để xử lý thêm. Không có khoản tiền nào được hoàn cho khiếu nại này.';
}

/** The coarse progress the MEMBER sees (never an internal status name). */
export function memberProgressLabel(status: CaseStatus, execStatus: string): string {
  switch (status) {
    case 'INTAKE':
      return 'Đã tiếp nhận';
    case 'AWAITING_PARTIES':
      return 'Cần bạn bổ sung thông tin';
    case 'REJECTED_INTAKE':
      return 'Không tiếp nhận';
    case 'DECISION_APPROVED':
      return execStatus === 'BUSINESS_DONE' ? 'Đã xử lý' : 'Đang xem xét';
    default:
      return 'Đang xem xét';
  }
}
