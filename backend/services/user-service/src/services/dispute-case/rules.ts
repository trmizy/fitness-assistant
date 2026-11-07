/**
 * DISPUTE CASE slice 1 - the PURE rules (no database, no network). docs/DISPUTE_CASE_DESIGN_V2_1.md §1.2, §1.2.3, §1.4.1, §1.5.
 * Everything that decides something lives here so a unit test can pin it; the service only wires it to rows.
 */

// ── Finding -> outcome (§1.4.1 item 8: derived by a rule, never typed by a person) ────────────────────────────────

export type FindingKind =
  | "VERIFIED_DELIVERED"
  | "VERIFIED_CLIENT_ABSENT"
  | "VERIFIED_PT_ABSENT"
  | "VERIFIED_NOT_DELIVERED_NO_FAULT"
  | "INSUFFICIENT_EVIDENCE"
  | "NOT_A_DISPUTE";
export type Outcome = "COMPLETED" | "CANCELLED" | "PT_NO_SHOW_CONFIRMED";

/**
 * The only mapping from a finding to a ruling outcome. `null` = the finding produces NO proposal:
 *  - INSUFFICIENT_EVIDENCE: the case goes to POLICY_PENDING and nothing is decided on its own (§1.4.4);
 *  - NOT_A_DISPUTE: DESIGN_REQUIRED (no outcome of the three fits; the owner has not decided what happens to such a session).
 */
export function outcomeForFinding(finding: FindingKind): Outcome | null {
  switch (finding) {
    case "VERIFIED_DELIVERED":
    case "VERIFIED_CLIENT_ABSENT":
      return "COMPLETED";
    case "VERIFIED_PT_ABSENT":
      return "PT_NO_SHOW_CONFIRMED";
    case "VERIFIED_NOT_DELIVERED_NO_FAULT":
      return "CANCELLED";
    default:
      return null;
  }
}

// ── Case status machine (§1.2.1) ──────────────────────────────────────────────────────────────────────────────────

export type CaseStatus =
  | "INTAKE"
  | "COLLECTING"
  | "AWAITING_PARTIES"
  | "ASSESSING"
  | "TECH_RECONCILIATION"
  | "FINDING_RECORDED"
  | "POLICY_PENDING"
  | "PROPOSED"
  | "AWAITING_APPROVAL"
  | "DECISION_APPROVED"
  | "REJECTED_INTAKE"
  /** A5: a real end (closeReason + audit). Never releases money, never changes the session, never reopens. */
  | "CLOSED";

/** A5: closeReason values of a CLOSED case. */
export const CLOSE_REASONS = ["ORPHAN_SESSION_LEFT_DISPUTE", "NOT_A_DISPUTE", "EXECUTED", "APPEAL_CONCLUDED"] as const;
export const TERMINAL_STATUSES: readonly CaseStatus[] = ["DECISION_APPROVED", "REJECTED_INTAKE", "CLOSED"];
export const isTerminal = (s: CaseStatus) => TERMINAL_STATUSES.includes(s);

/** Every transition the code can ever perform. Anything else is refused. */
export const TRANSITIONS: Readonly<Record<CaseStatus, readonly CaseStatus[]>> = {
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
  CLOSED: [],
};

export function canTransition(from: CaseStatus, to: CaseStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/**
 * The targets the generic `transition` endpoint accepts. The others are reached only by the action that earns them:
 * FINDING_RECORDED / POLICY_PENDING by recording a finding, PROPOSED / AWAITING_APPROVAL by a proposal, DECISION_APPROVED and the
 * return from AWAITING_APPROVAL to ASSESSING by a four-eyes approval or rejection.
 */
export const MANUAL_TARGETS: readonly CaseStatus[] = ["COLLECTING", "AWAITING_PARTIES", "ASSESSING", "TECH_RECONCILIATION", "REJECTED_INTAKE"];
export const MANUAL_FROM_BLOCKED: readonly CaseStatus[] = ["PROPOSED", "AWAITING_APPROVAL"];

export function canTransitionManually(from: CaseStatus, to: CaseStatus): boolean {
  return MANUAL_TARGETS.includes(to) && !MANUAL_FROM_BLOCKED.includes(from) && canTransition(from, to);
}

/** States in which a party (client / PT) may add a statement or an evidence record (§1.6.1 collecting window). */
/** the appeal (review request) window, from the recorded CONCLUSION notice to the party */
export const APPEAL_WINDOW_DAYS = 14;
export const PARTY_SUBMIT_STATUSES: readonly CaseStatus[] = ["COLLECTING", "AWAITING_PARTIES", "ASSESSING", "POLICY_PENDING"];
/** States in which the investigator may record claims / issues / shares. */
export const INVESTIGATION_STATUSES: readonly CaseStatus[] = ["COLLECTING", "AWAITING_PARTIES", "ASSESSING", "TECH_RECONCILIATION", "POLICY_PENDING"];

// ── Case type from the session (§intake) ──────────────────────────────────────────────────────────────────────────

export type CaseType = "PT_DELIVERY" | "PT_CLIENT_NO_SHOW_CLAIM" | "PT_NO_SHOW_CLAIM" | "LEGACY_UNCLASSIFIED";
/** The types an investigator may classify a LEGACY_UNCLASSIFIED case into. */
export const CLASSIFIABLE_TYPES: readonly CaseType[] = ["PT_DELIVERY", "PT_CLIENT_NO_SHOW_CLAIM", "PT_NO_SHOW_CLAIM"];

/**
 * PT_NO_SHOW_REPORTED -> PT_NO_SHOW_CLAIM. DISPUTED follows Session.disputeType. A DISPUTED session with NO disputeType (a row from before
 * the column existed) has no derivable type: it becomes the PROVISIONAL LEGACY_UNCLASSIFIED (never a guessed real type); the investigator
 * classifies it later and no finding / proposal exists until then. Any other session status returns null (intake refuses).
 */
export function deriveCaseType(sessionStatus: string, disputeType: string | null | undefined): CaseType | null {
  if (sessionStatus === "PT_NO_SHOW_REPORTED") return "PT_NO_SHOW_CLAIM";
  if (sessionStatus !== "DISPUTED") return null;
  switch (disputeType) {
    case "DELIVERY_DISPUTE":
      return "PT_DELIVERY";
    case "PT_NO_SHOW_CLAIM":
      return "PT_NO_SHOW_CLAIM";
    case "CLIENT_NO_SHOW_CLAIM":
      return "PT_CLIENT_NO_SHOW_CLAIM";
    case null:
    case undefined:
      return "LEGACY_UNCLASSIFIED";
    default:
      return null;
  }
}

// ── Financial view (§1.2.3), derived and read-only ────────────────────────────────────────────────────────────────

export type FinancialState =
  | "LEDGER_POSTED_FULL"
  | "OBLIGATION_PAID_VERIFIED"
  /** D77 final: the obligation was paid to the client by a real ledger entry inside the session's own settlement (PAID_VIA_LEDGER). Group F1. NOT a bank transfer. */
  | "OBLIGATION_PAID_VIA_LEDGER"
  | "NO_MONEY_EFFECT"
  | "OBLIGATION_WAIVED"
  | "OBLIGATION_RESOLVED_OTHER"
  | "LEDGER_PENDING"
  | "LEDGER_POSTED_PARTIAL"
  | "OBLIGATION_IN_PAYMENT"
  | "NEEDS_RECONCILIATION"
  /** A historical obligation status (RESOLVED / PAID_EXTERNALLY / an unknown one): neither an open debt nor verified as paid. */
  | "LEGACY_NEEDS_VERIFICATION"
  | "UNAVAILABLE";
export type FinancialGroup = "F1" | "F2" | "F3" | "UNAVAILABLE";
/** NO_RECORDED_SETTLEMENT = the session has no settlement row for any of the four money steps. It is NEVER NO_MONEY_EFFECT (that needs a decision that has no money step). */
export type CaseFinancialGroup = FinancialGroup | "NO_RECORDED_SETTLEMENT";
/** Inside the F3 queue: a real debt / step in progress (OUTSTANDING) versus a historical record that only needs a person to verify (VERIFICATION_REQUIRED). */
export type F3Kind = "OUTSTANDING" | "VERIFICATION_REQUIRED";

const F1: readonly FinancialState[] = ["LEDGER_POSTED_FULL", "OBLIGATION_PAID_VERIFIED", "OBLIGATION_PAID_VIA_LEDGER"];

/** The wording for people of the states that need one apart from their code. PAID_VIA_LEDGER is "paid into the Gymini wallet" - it never says a bank transferred it. */
export const FINANCIAL_STATE_LABEL_VI: Partial<Record<FinancialState, string>> = {
  OBLIGATION_PAID_VIA_LEDGER: "Đã trả vào ví Gymini",
};
const F2: readonly FinancialState[] = ["NO_MONEY_EFFECT", "OBLIGATION_WAIVED", "OBLIGATION_RESOLVED_OTHER"];
const F3: readonly FinancialState[] = ["LEDGER_PENDING", "LEDGER_POSTED_PARTIAL", "OBLIGATION_IN_PAYMENT", "NEEDS_RECONCILIATION", "LEGACY_NEEDS_VERIFICATION"];

/** Only meaningful for an F3 state; undefined otherwise. */
export function f3KindOf(state: FinancialState): F3Kind | undefined {
  if (groupOf(state) !== "F3") return undefined;
  return state === "LEGACY_NEEDS_VERIFICATION" ? "VERIFICATION_REQUIRED" : "OUTSTANDING";
}

export function groupOf(state: FinancialState): FinancialGroup {
  if (F1.includes(state)) return "F1";
  if (F2.includes(state)) return "F2";
  if (F3.includes(state)) return "F3";
  return "UNAVAILABLE";
}

/** What payment-service's ledger lookup said about one key. `obligation.status` is the live status of the unpaid obligation, if any. */
export type LedgerLookup =
  | { status: "UNAVAILABLE" }
  | { status: "ABSENT" }
  | { status: "FOUND"; obligation?: { status: string } | null };

/**
 * One money step (one session_settlements row + what the ledger knows about its key) -> one FinancialState.
 * The settlement row alone decides every state in which the step is not done yet; only a SETTLED row needs the ledger (to see the
 * obligation). An obligation status this table does not know (historical RESOLVED / PAID_EXTERNALLY, or a new one) is LEGACY_NEEDS_VERIFICATION:
 * it stays in the F3 queue as VERIFICATION_REQUIRED (not an open debt, not verified as paid) and the view never calls it paid.
 */
export function classifyFinancialItem(settlementStatus: string, ledger: LedgerLookup): FinancialState {
  switch (settlementStatus) {
    case "PENDING":
    case "PROCESSING":
    case "FAILED":
      return "LEDGER_PENDING";
    case "NEEDS_HUMAN":
    case "CONFLICT":
    case "UNCONFIRMED":
      return "NEEDS_RECONCILIATION";
    case "SETTLED":
      break;
    default:
      return "NEEDS_RECONCILIATION";
  }
  if (ledger.status === "UNAVAILABLE") return "UNAVAILABLE";
  if (ledger.status === "ABSENT") return "NEEDS_RECONCILIATION"; // settled here, yet the ledger has no record of the key
  const ob = ledger.obligation;
  if (!ob) return "LEDGER_POSTED_FULL";
  switch (ob.status) {
    case "OPEN":
    case "UNDER_REVIEW":
      return "LEDGER_POSTED_PARTIAL";
    case "APPROVED_FOR_PAYMENT":
    case "AWAITING_EVIDENCE":
      return "OBLIGATION_IN_PAYMENT";
    case "PAID_VERIFIED":
      return "OBLIGATION_PAID_VERIFIED";
    case "PAID_VIA_LEDGER":
      return "OBLIGATION_PAID_VIA_LEDGER";
    case "WAIVED":
      return "OBLIGATION_WAIVED";
    case "RESOLVED_OTHER":
      return "OBLIGATION_RESOLVED_OTHER";
    default:
      return "LEGACY_NEEDS_VERIFICATION";
  }
}

/**
 * The case's group = the worst over ALL items. F3 (still owed / to reconcile) outranks everything, even UNAVAILABLE: F3 is already the
 * worst a known item can be. UNAVAILABLE (the ledger could not be read, never "0") outranks F2 and F1, because an unreadable item may
 * be anything. No item at all -> NO_RECORDED_SETTLEMENT (no settlement recorded for the session), never a group and never NO_MONEY_EFFECT.
 */
export function worstGroup(states: readonly FinancialState[]): CaseFinancialGroup {
  if (states.length === 0) return "NO_RECORDED_SETTLEMENT";
  const groups = states.map(groupOf);
  if (groups.includes("F3")) return "F3";
  if (groups.includes("UNAVAILABLE")) return "UNAVAILABLE";
  if (groups.includes("F2")) return "F2";
  return "F1";
}

/** The only money fact a party sees: a label. */
export const GROUP_LABEL_VI: Readonly<Record<CaseFinancialGroup, string>> = {
  F1: "Đã ghi sổ đủ",
  F2: "Đã giải quyết, không chi trả",
  F3: "Còn phải thanh toán hoặc đối soát",
  UNAVAILABLE: "Chưa xác định được (không đọc được sổ cái)",
  NO_RECORDED_SETTLEMENT: "Chưa có bước quyết toán được ghi nhận",
};

/** Label of an item / of an F3 queue that holds ONLY historical records to verify. */
export const VERIFICATION_REQUIRED_LABEL_VI = "Cần xác minh — không phải nợ đang mở, cũng chưa xác minh đã trả";

/** Case-level F3 kind: OUTSTANDING when any item is a real step / debt, VERIFICATION_REQUIRED when the F3 queue holds only historical records. */
export function caseF3Kind(states: readonly FinancialState[]): F3Kind | undefined {
  const kinds = states.map(f3KindOf).filter((k): k is F3Kind => !!k);
  if (kinds.length === 0) return undefined;
  return kinds.includes("OUTSTANDING") ? "OUTSTANDING" : "VERIFICATION_REQUIRED";
}

// ── Four eyes (§1.5.2) ────────────────────────────────────────────────────────────────────────────────────────────

export interface ApproverCheckInput {
  approverId: string;
  approverRole: string;
  proposerId: string;
  investigatorId: string | null;
  clientUserId: string;
  ptUserId: string;
  conflictOfInterestDeclaredNone: boolean;
}

export type ApproverVerdict = { ok: true } | { ok: false; status: 403; code: "ADMIN_ONLY" | "SELF_APPROVAL_FORBIDDEN" | "CONFLICT_OF_INTEREST"; message: string };

export function checkApprover(i: ApproverCheckInput): ApproverVerdict {
  if (i.approverRole !== "ADMIN") return { ok: false, status: 403, code: "ADMIN_ONLY", message: "Chỉ quản trị viên được duyệt đề xuất" };
  if (i.approverId === i.proposerId) {
    return { ok: false, status: 403, code: "SELF_APPROVAL_FORBIDDEN", message: "Người đề xuất không được tự duyệt đề xuất của mình" };
  }
  if (i.investigatorId && i.approverId === i.investigatorId) {
    return { ok: false, status: 403, code: "SELF_APPROVAL_FORBIDDEN", message: "Điều tra viên của hồ sơ không được duyệt đề xuất của chính hồ sơ đó" };
  }
  if (i.approverId === i.clientUserId || i.approverId === i.ptUserId) {
    return { ok: false, status: 403, code: "CONFLICT_OF_INTEREST", message: "Người duyệt là một bên của vụ việc nên không được duyệt" };
  }
  if (i.conflictOfInterestDeclaredNone !== true) {
    return { ok: false, status: 403, code: "CONFLICT_OF_INTEREST", message: "Người duyệt phải khai báo không có xung đột lợi ích" };
  }
  return { ok: true };
}

// ── Evidence snapshot & change guard (§1.6.4) ─────────────────────────────────────────────────────────────────────

export interface SnapshotEntry {
  id: string;
  hash: string;
  version: number;
}

export interface ChangeCheckInput {
  snapshot: readonly SnapshotEntry[];
  /** every evidence row and statement of the case now, with the moment each was written */
  current: ReadonlyArray<{ id: string; hash: string; createdAt: Date }>;
  /** (source, subject) slots whose live source no longer hashes to the latest stored row and that nobody has re-collected yet */
  staleLive: readonly string[];
  /**
   * F5: (source, subject) slots whose LIVE source cannot be read right now although the stored head holds real data. That is neither "unchanged" nor "changed": it is
   * unknown, so an approval/execution is refused (fail-closed) with a retryable code and nothing needs an acknowledgement; it clears when the source answers again.
   */
  unreadableLive?: readonly string[];
}

export interface ChangeCheckResult {
  changed: boolean;
  /** rows written after the snapshot */
  newIds: string[];
  /** hash differs for an id that was in the snapshot (a stored row cannot change; reported defensively) */
  mutatedIds: string[];
  /** latest write time among the new rows (null if none) */
  lastChangeAt: Date | null;
  staleLive: string[];
  /** see ChangeCheckInput.unreadableLive; NOT part of `changed` */
  unreadableLive: string[];
}

export function diffAgainstSnapshot(i: ChangeCheckInput): ChangeCheckResult {
  const snap = new Map(i.snapshot.map((s) => [s.id, s.hash]));
  const newRows = i.current.filter((r) => !snap.has(r.id));
  const mutatedIds = i.current.filter((r) => snap.has(r.id) && snap.get(r.id) !== r.hash).map((r) => r.id);
  const lastChangeAt = newRows.length ? new Date(Math.max(...newRows.map((r) => r.createdAt.getTime()))) : null;
  return {
    changed: newRows.length > 0 || mutatedIds.length > 0 || i.staleLive.length > 0,
    newIds: newRows.map((r) => r.id),
    mutatedIds,
    lastChangeAt,
    staleLive: [...i.staleLive],
    unreadableLive: [...(i.unreadableLive ?? [])],
  };
}

/**
 * Is a recorded change acknowledged? Needs the approver's flag AND an investigator ACK event written at/after the last change. A live
 * source change that is not stored yet (staleLive) can never be acknowledged: it must be re-collected first so it has a write time.
 */
export function changeAcknowledged(
  r: ChangeCheckResult,
  approverAcknowledged: boolean,
  ackEventTimes: readonly Date[],
): boolean {
  if (!r.changed) return true;
  if (!approverAcknowledged) return false;
  if (r.staleLive.length > 0) return false;
  if (!r.lastChangeAt) return false; // a change with no write time cannot be shown to precede an ACK
  const last = r.lastChangeAt.getTime();
  return ackEventTimes.some((t) => t.getTime() >= last);
}

// ── Party redaction (§1.5.4) ──────────────────────────────────────────────────────────────────────────────────────

export type PartyRole = "CLIENT" | "PT";

/** The party role of a user in a case, or null when the user is neither the client nor the PT of it. */
export function partyRoleOf(userId: string, c: { clientUserId: string; ptUserId: string }): PartyRole | null {
  if (userId === c.clientUserId) return "CLIENT";
  if (userId === c.ptUserId) return "PT";
  return null;
}

export interface EvidenceVisibilityRow {
  id: string;
  sensitivity: string;
  submittedBy: string | null;
  submittedRole: string | null;
  /** absent on a row written before the column existed */
  verificationStatus?: string | null;
}

const PARTY_ROLES = ["CLIENT", "PT"] as const;
/** Slice 2 / S2.3: what the admin reads next to an evidence row about HOW the system came to hold it (it never says "observed" for something the server did not witness). */
export const PROVENANCE_LABEL_VI: Readonly<Record<string, string>> = {
  SERVER_OBSERVED: "Máy chủ chứng kiến / đọc trực tiếp từ hệ thống",
  SELF_REPORTED_SERVER_RECORDED: "Người dùng tự quét/khai, máy chủ chỉ ghi lại — check-in gym không chứng minh buổi dạy PT đã diễn ra",
  STAFF_ATTESTED_SERVER_RECORDED: "Nhân viên phòng tập check-in hộ và tự xác nhận danh tính — check-in gym không chứng minh buổi dạy PT đã diễn ra",
  USER_REPORTED_STORED: "Bên liên quan tự khai, máy chủ lưu lại",
  DERIVED: "Dữ liệu dẫn xuất (không phải nguồn độc lập)",
  EXTERNAL_DOCUMENT: "Tài liệu ngoài hệ thống do bên liên quan nộp",
  TECH_GAP: "Không đọc được nguồn (không phải bằng chứng vắng mặt)",
  NOT_APPLICABLE: "Không áp dụng",
  ADMIN_RECEIVED_ON_BEHALF: "Quản trị viên nhận hộ",
  LEGACY_FIELD: "Trường cũ của buổi tập",
};
export const provenanceLabelVi = (p: string): string => PROVENANCE_LABEL_VI[p] ?? p;

/** Slice 2 / S2.8: the row is an evidence FILE that evidence-storage wrote and hashed (column SERVER_VERIFIED AND the storedFile marker the service writes). */
export function isServerStoredFile(row: { verificationStatus?: string | null; payload?: unknown }): boolean {
  const f = (row.payload as { storedFile?: { serverVerified?: unknown; scope?: unknown; sha256?: unknown } } | null | undefined)?.storedFile;
  return row.verificationStatus === "SERVER_VERIFIED" && !!f && f.serverVerified === true && f.scope === "FILE_BYTES_ONLY" && typeof f.sha256 === "string";
}
export const isPartySubmitted = (row: { submittedRole: string | null }) => !!row.submittedRole && (PARTY_ROLES as readonly string[]).includes(row.submittedRole);

/**
 * The verification status a row really has: whatever a Client/PT submitted is CLIENT_CLAIMED_UNVERIFIED even if the column (default on an
 * old row) says otherwise - the hash they declare is their own claim, no file reached the server.
 */
export function effectiveVerificationStatus(row: { submittedRole: string | null; verificationStatus?: string | null; payload?: unknown }): string {
  // Slice 2 / S2.8: a file the SERVER stored and hashed is SERVER_VERIFIED - for the FILE BYTES only (payload.storedFile.scope), never for what the party says about it.
  if (isPartySubmitted(row)) return isServerStoredFile(row) ? "SERVER_VERIFIED" : "CLIENT_CLAIMED_UNVERIFIED";
  return row.verificationStatus ?? "NOT_APPLICABLE";
}

/**
 * Hardening P0. May the investigator hand this evidence row to the other side? NEVER when a Client/PT submitted it, when it is not
 * server-verified (CLIENT_CLAIMED_UNVERIFIED), or when its sensitivity is not NORMAL. Returns the refusal reason, or null when sharing is allowed.
 */
export function shareRefusalReason(row: EvidenceVisibilityRow): "PARTY_SUBMITTED" | "UNVERIFIED" | "NOT_NORMAL_SENSITIVITY" | null {
  if (isPartySubmitted(row)) return "PARTY_SUBMITTED";
  const v = effectiveVerificationStatus(row);
  if (v !== "SERVER_VERIFIED" && v !== "NOT_APPLICABLE") return "UNVERIFIED";
  if (row.sensitivity !== "NORMAL") return "NOT_NORMAL_SENSITIVITY";
  return null;
}
export interface StatementVisibilityRow {
  id: string;
  authorUserId: string;
  partyRole: string;
}
export interface ShareRow {
  evidenceId: string | null;
  statementId: string | null;
  sharedWithRole: string;
}

/**
 * What a party may read of one evidence row:
 *  - its OWN submissions, and only they: a Client/PT-submitted row is never visible to the other side (not its payload, its metadata, nor its
 *    hash) and a share row pointing at it, from whenever, changes nothing;
 *  - system-collected evidence marked NORMAL;
 *  - any other row only if it is shareable (shareRefusalReason null) AND was shared with the viewer's role.
 * Never SENSITIVE / RESTRICTED system evidence (financial split, settlements, audit trail).
 */
export function evidenceVisibleToParty(row: EvidenceVisibilityRow, viewer: { userId: string; role: PartyRole }, shares: readonly ShareRow[]): boolean {
  if (isPartySubmitted(row)) return row.submittedBy === viewer.userId || row.submittedRole === viewer.role;
  if (row.submittedBy === viewer.userId) return true;
  if (shareRefusalReason(row) !== null) return false;
  if (row.submittedBy === null && row.submittedRole === null) return true; // system-collected, NORMAL, not unverified
  return shares.some((s) => s.evidenceId === row.id && s.sharedWithRole === viewer.role);
}

export function statementVisibleToParty(row: StatementVisibilityRow, viewer: { userId: string; role: PartyRole }, shares: readonly ShareRow[]): boolean {
  if (row.authorUserId === viewer.userId) return true;
  if (row.partyRole === viewer.role) return true;
  return shares.some((s) => s.statementId === row.id && s.sharedWithRole === viewer.role);
}

// ── Misc ──────────────────────────────────────────────────────────────────────────────────────────────────────────

/** B-1 (§1.3.3): the reason every proposal of a session that has (had) a PT_LATE_ARRIVAL step carries for its execution step. */
export const D77_BLOCK_REASON = "D77_COMBINATION_UNRESOLVED";
/** @deprecated Slice 1 constant. No read or write answer uses it any more: the real execution axis (execStatus / history) is returned instead. Kept only so old imports compile. */
export const EXECUTION_BLOCKED_SLICE1 = "BLOCKED: SLICE_2_NOT_ENABLED";
/** Cross-service evidence sources that Slice 1 does not read. */
export const SOURCE_NOT_INTEGRATED = "SOURCE_NOT_INTEGRATED — DESIGN_REQUIRED (Slice 2)";

export const CLAIM_MOVES = ["MONEY", "QUOTA", "PT_AT_FAULT"] as const;

/** The four idempotency keys of the session-level money steps the financial view reads (§1.2.3). */
export function financialKeysFor(sessionId: string): string[] {
  return [`PT_NO_SHOW:${sessionId}`, `SESSION_RELEASE:${sessionId}`, `PT_LATE_ARRIVAL:${sessionId}`, `UNRESOLVED_SESSION:${sessionId}`];
}
