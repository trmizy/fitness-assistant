/**
 * D7 - shapes of the two money-exception APIs of Dispute V2.1, read from user-service source (`d65b-resolution.service.ts`,
 * `late-open-reconciliation.service.ts`, `contract-ledger.service.ts#readLateOpenState`) at 2297b659, plus pure normalisers.
 *
 * Money is ALWAYS a decimal string in these payloads and stays a string here: nothing in D7 adds, subtracts or multiplies it.
 * Every normaliser returns `null` for a body it cannot read (the screen then says "không đọc được", never "không có").
 */

// ───────────────────────────────────────────────────────── helpers ──
export const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
export const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

// ───────────────────────────────────────────────────── capabilities ──
/** `true` = the server says the flag is effective; `false` = off; `null` = we do not know (the read failed or was unreadable). */
export type FlagState = boolean | null;

export interface MoneyCapabilities {
  d65bResolution: FlagState;
  lateOpenReconciliation: FlagState;
}

export const UNKNOWN_CAPABILITIES: MoneyCapabilities = { d65bResolution: null, lateOpenReconciliation: null };

/** A1 `GET /admin/dispute-cases/capabilities`. Only an exact boolean counts; anything else is "unknown" (and unknown never enables a write). */
export function normalizeCapabilities(body: unknown): MoneyCapabilities {
  if (!isRecord(body)) return UNKNOWN_CAPABILITIES;
  const flag = (v: unknown): FlagState => (v === true ? true : v === false ? false : null);
  return { d65bResolution: flag(body.d65bResolution), lateOpenReconciliation: flag(body.lateOpenReconciliation) };
}

// ───────────────────────────────────────────────────────── D65-B ──
export const D65B_STATUSES = ["PROPOSED", "APPROVED_NOT_EXECUTED", "EXECUTED", "REJECTED"] as const;
export type D65bStatus = (typeof D65B_STATUSES)[number];

export interface D65bSummary {
  id: string;
  sessionId: string;
  contractId: string | null;
  status: D65bStatus;
  reason: string;
  evidenceRefs: string[];
  proposedBy: string | null;
  createdAt: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  approvalReason: string | null;
  outcome: string | null;
  outcomeAt: string | null;
  rejectedBy: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
}

export function normalizeD65bSummary(raw: unknown): D65bSummary | null {
  if (!isRecord(raw)) return null;
  const id = str(raw.id);
  const sessionId = str(raw.sessionId);
  const status = D65B_STATUSES.find((s) => s === raw.status);
  if (!id || !sessionId || !status) return null;
  return {
    id,
    sessionId,
    contractId: str(raw.contractId),
    status,
    reason: typeof raw.reason === "string" ? raw.reason : "",
    evidenceRefs: strings(raw.evidenceRefs),
    proposedBy: str(raw.proposedBy),
    createdAt: str(raw.createdAt),
    approvedBy: str(raw.approvedBy),
    approvedAt: str(raw.approvedAt),
    approvalReason: str(raw.approvalReason),
    outcome: str(raw.outcome),
    outcomeAt: str(raw.outcomeAt),
    rejectedBy: str(raw.rejectedBy),
    rejectedAt: str(raw.rejectedAt),
    rejectionReason: str(raw.rejectionReason),
  };
}

/** P1 `{items}`. One unreadable item makes the whole list unreadable (never silently dropped). */
export function normalizeD65bList(body: unknown): D65bSummary[] | null {
  if (!isRecord(body) || !Array.isArray(body.items)) return null;
  const out: D65bSummary[] = [];
  for (const it of body.items) {
    const s = normalizeD65bSummary(it);
    if (!s) return null;
    out.push(s);
  }
  return out;
}

export interface D65bLedgerReading {
  readAt: string | null;
  contractEnded: boolean | null;
  /** value of ONE session as the ledger computed it (a string; never typed by a person) */
  unit: string | null;
  /** what the contract's own pending still holds */
  pendingTotal: string | null;
  lateOperationExists: boolean | null;
}

export function normalizeLedgerReading(raw: unknown): D65bLedgerReading | null {
  if (!isRecord(raw)) return null;
  return {
    readAt: str(raw.readAt),
    contractEnded: typeof raw.contractEnded === "boolean" ? raw.contractEnded : null,
    unit: str(raw.unit),
    pendingTotal: str(raw.pendingTotal),
    lateOperationExists: typeof raw.lateOperationExists === "boolean" ? raw.lateOperationExists : null,
  };
}

export interface D65bHistoryEntry {
  at: string | null;
  action: string;
  actor: string | null;
  note: string | null;
}

export interface D65bDetail extends D65bSummary {
  ledgerBefore: D65bLedgerReading | null;
  /** `creditedToClient` comes from the server only, and only after the ledger confirmed the credit */
  creditedToClient: string | null;
  pendingBefore: string | null;
  pendingAfter: string | null;
  heldRowStatus: string | null;
  resolutionRowStatus: string | null;
  history: D65bHistoryEntry[];
}

export function normalizeD65bDetail(raw: unknown): D65bDetail | null {
  const base = normalizeD65bSummary(raw);
  if (!base || !isRecord(raw)) return null;
  const before = isRecord(raw.ledgerBefore) ? raw.ledgerBefore : null;
  const after = isRecord(raw.ledgerAfter) ? raw.ledgerAfter : null;
  const history: D65bHistoryEntry[] = [];
  if (Array.isArray(raw.history)) {
    for (const h of raw.history) {
      if (!isRecord(h) || !str(h.action)) continue;
      history.push({ at: str(h.at), action: String(h.action), actor: str(h.actor), note: str(h.note) });
    }
  }
  return {
    ...base,
    ledgerBefore: before ? normalizeLedgerReading(before.ledger) : null,
    // only an EXECUTED resolution can carry a credited amount; for any other status the field is ignored even if present
    creditedToClient: base.status === "EXECUTED" && after ? str(after.creditedToClient) : null,
    pendingBefore: base.status === "EXECUTED" && after ? str(after.pendingBefore) : null,
    pendingAfter: base.status === "EXECUTED" && after ? str(after.pendingAfter) : null,
    heldRowStatus: str(raw.heldRowStatus),
    resolutionRowStatus: str(raw.resolutionRowStatus),
    history,
  };
}

export interface Assessment {
  eligible: boolean;
  code: string | null;
}

export function normalizeAssessment(raw: unknown): Assessment | null {
  if (!isRecord(raw) || typeof raw.eligible !== "boolean") return null;
  return { eligible: raw.eligible, code: str(raw.code) };
}

export interface D65bSessionPreview {
  sessionId: string;
  sessionStatus: string | null;
  assessment: Assessment;
  ledger: D65bLedgerReading | null;
  resolution: D65bSummary | null;
}

/** P2 `…/sessions/:sessionId` */
export function normalizeD65bPreview(raw: unknown): D65bSessionPreview | null {
  if (!isRecord(raw)) return null;
  const sessionId = str(raw.sessionId);
  const assessment = normalizeAssessment(raw.assessment);
  if (!sessionId || !assessment) return null;
  const resolution = raw.resolution == null ? null : normalizeD65bSummary(raw.resolution);
  if (raw.resolution != null && !resolution) return null;
  return { sessionId, sessionStatus: str(raw.sessionStatus), assessment, ledger: normalizeLedgerReading(raw.ledger), resolution };
}

// ─────────────────────────────────────────────── execution results ──
/** What an approve answered, reduced to what may be SAID. `UNKNOWN` = the body had no usable `execution` (e.g. an idempotent replay). */
export type D65bExecutionView =
  | { kind: "EXECUTED"; creditedToClient: string | null; replayed: boolean }
  | { kind: "NOT_EXECUTED"; code: string | null }
  | { kind: "UNKNOWN" };

/**
 * P5. HTTP 200 and 202 are both "approved". Only `execution.status === "EXECUTED"` AND a server-supplied `creditedToClient` may be shown as
 * credited; 202 / NOT_EXECUTED is "approved, ledger did not confirm"; anything else is unknown.
 */
export function d65bExecutionOf(httpStatus: number, body: unknown): D65bExecutionView {
  const ex = isRecord(body) && isRecord(body.execution) ? body.execution : null;
  if (!ex) return { kind: "UNKNOWN" };
  if (ex.status === "EXECUTED" && httpStatus === 200) return { kind: "EXECUTED", creditedToClient: str(ex.creditedToClient), replayed: ex.replayed === true };
  if (ex.status === "NOT_EXECUTED" || httpStatus === 202) return { kind: "NOT_EXECUTED", code: str(ex.code) };
  return { kind: "UNKNOWN" };
}

// ─────────────────────────────────────────────────── late-open ──
export const LATE_STATUSES = ["UNCLAIMED", "CLAIMED", "BLOCKED", "PROPOSED", "APPROVED", "EXECUTION_FAILED", "EXECUTION_EXHAUSTED", "EXECUTED"] as const;
export type LateStatus = (typeof LATE_STATUSES)[number];

export interface LateAttempts {
  epoch: number;
  failures: number;
  cap: number;
  recoveriesLeft: number;
}

export interface LateObligation {
  status: string;
  owed: string | null;
  paid: string | null;
  unpaid: string | null;
}

/** The ledger OBSERVATION of one late-arrival obligation. Never an input of any action. */
export interface LateLedger {
  contractEnded: boolean | null;
  obligation: LateObligation | null;
}

export interface LateProposal {
  id: string;
  assignee: string | null;
  reason: string;
  verificationNote: string;
  evidenceRefs: string[];
  policyBasis: string;
  proposedBy: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  outcome: string | null;
  outcomeAt: string | null;
  createdAt: string | null;
}

export interface LateRecovery {
  id: string;
  reconciliationId: string | null;
  openedBy: string | null;
  reason: string;
  classification: string | null;
  haltCode: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  outcome: string | null;
  createdAt: string | null;
}

export interface LateHistoryEntry {
  at: string | null;
  action: string;
  actor: string | null;
  note: string | null;
}

export interface LateItem {
  rowId: string;
  kind: string | null;
  settlementStatus: string | null;
  sessionId: string | null;
  sessionStatus: string | null;
  contractStatus: string | null;
  status: LateStatus;
  assignee: string | null;
  attempts: LateAttempts | null;
  recoveries: LateRecovery[];
  assessment: Assessment;
  ledger: LateLedger | null;
  proposals: LateProposal[];
  history: LateHistoryEntry[];
}

function normalizeObligation(raw: unknown): LateObligation | null {
  if (!isRecord(raw)) return null;
  const status = str(raw.status);
  if (!status) return null;
  return { status, owed: str(raw.owed), paid: str(raw.paid), unpaid: str(raw.unpaid) };
}

function normalizeProposal(raw: unknown): LateProposal | null {
  if (!isRecord(raw)) return null;
  const id = str(raw.id);
  if (!id) return null;
  return {
    id,
    assignee: str(raw.assignee),
    reason: typeof raw.reason === "string" ? raw.reason : "",
    verificationNote: typeof raw.verificationNote === "string" ? raw.verificationNote : "",
    evidenceRefs: strings(raw.evidenceRefs),
    policyBasis: typeof raw.policyBasis === "string" ? raw.policyBasis : "",
    proposedBy: str(raw.proposedBy),
    approvedBy: str(raw.approvedBy),
    approvedAt: str(raw.approvedAt),
    outcome: str(raw.outcome),
    outcomeAt: str(raw.outcomeAt),
    createdAt: str(raw.createdAt),
  };
}

function normalizeRecovery(raw: unknown): LateRecovery | null {
  if (!isRecord(raw)) return null;
  const id = str(raw.id);
  if (!id) return null;
  return {
    id,
    reconciliationId: str(raw.reconciliationId),
    openedBy: str(raw.openedBy),
    reason: typeof raw.reason === "string" ? raw.reason : "",
    classification: str(raw.classification),
    haltCode: str(raw.haltCode),
    approvedBy: str(raw.approvedBy),
    approvedAt: str(raw.approvedAt),
    outcome: str(raw.outcome),
    createdAt: str(raw.createdAt),
  };
}

/** L2 `Item` (and each element of L1 `items`). */
export function normalizeLateItem(raw: unknown): LateItem | null {
  if (!isRecord(raw)) return null;
  const rowId = str(raw.rowId);
  const status = LATE_STATUSES.find((s) => s === raw.status);
  const assessment = normalizeAssessment(raw.assessment);
  if (!rowId || !status || !assessment) return null;
  const at = isRecord(raw.attempts) ? raw.attempts : null;
  const attempts =
    at && num(at.epoch) !== null && num(at.failures) !== null && num(at.cap) !== null
      ? { epoch: num(at.epoch)!, failures: num(at.failures)!, cap: num(at.cap)!, recoveriesLeft: num(at.recoveriesLeft) ?? 0 }
      : null;
  const ledgerRaw = isRecord(raw.ledger) ? raw.ledger : null;
  const history: LateHistoryEntry[] = [];
  if (Array.isArray(raw.history)) {
    for (const h of raw.history) {
      if (!isRecord(h) || !str(h.action)) continue;
      history.push({ at: str(h.at), action: String(h.action), actor: str(h.actor), note: str(h.note) });
    }
  }
  return {
    rowId,
    kind: str(raw.kind),
    settlementStatus: str(raw.settlementStatus),
    sessionId: str(raw.sessionId),
    sessionStatus: str(raw.sessionStatus),
    contractStatus: str(raw.contractStatus),
    status,
    assignee: str(raw.assignee),
    attempts,
    recoveries: (Array.isArray(raw.recoveries) ? raw.recoveries : []).map(normalizeRecovery).filter((r): r is LateRecovery => !!r),
    assessment,
    ledger: ledgerRaw ? { contractEnded: typeof ledgerRaw.contractEnded === "boolean" ? ledgerRaw.contractEnded : null, obligation: normalizeObligation(ledgerRaw.obligation) } : null,
    proposals: (Array.isArray(raw.proposals) ? raw.proposals : []).map(normalizeProposal).filter((p): p is LateProposal => !!p),
    history,
  };
}

/** L1 `{items, count}`. One unreadable item makes the whole queue unreadable. */
export function normalizeLateList(body: unknown): LateItem[] | null {
  if (!isRecord(body) || !Array.isArray(body.items)) return null;
  const out: LateItem[] = [];
  for (const it of body.items) {
    const n = normalizeLateItem(it);
    if (!n) return null;
    out.push(n);
  }
  return out;
}

/** The newest proposal that is still alive (not rejected) - the server's own rule for "the" proposal of a row. */
export function liveProposal(item: Pick<LateItem, "proposals">): LateProposal | null {
  const alive = item.proposals.filter((p) => p.outcome !== "REJECTED");
  return alive.length > 0 ? alive[alive.length - 1] : null;
}

/** A recovery that is open and not yet decided. */
export function openRecovery(item: Pick<LateItem, "recoveries">): LateRecovery | null {
  return item.recoveries.find((r) => !r.outcome && !r.approvedAt) ?? null;
}

// ─────────────────────────────────────────────── late-open execution ──
export const LATE_EXECUTION_STATUSES = ["EXECUTED", "BLOCKED", "FAILED", "IN_FLIGHT"] as const;
export type LateExecutionStatus = (typeof LATE_EXECUTION_STATUSES)[number];

/** `execution` of L6 / L8 / L10. HTTP 200 does NOT mean executed: only `status === "EXECUTED"` does. */
export type LateExecutionView =
  | { kind: "EXECUTED"; code: null; obligationAfter: LateObligation | null; replayed: boolean }
  | { kind: "BLOCKED" | "FAILED" | "IN_FLIGHT"; code: string | null; obligationAfter: null; replayed: false }
  | { kind: "UNKNOWN"; code: null; obligationAfter: null; replayed: false };

export function lateExecutionOf(execution: unknown): LateExecutionView {
  if (!isRecord(execution)) return { kind: "UNKNOWN", code: null, obligationAfter: null, replayed: false };
  const status = LATE_EXECUTION_STATUSES.find((s) => s === execution.status);
  if (!status) return { kind: "UNKNOWN", code: null, obligationAfter: null, replayed: false };
  if (status === "EXECUTED") return { kind: "EXECUTED", code: null, obligationAfter: normalizeObligation(execution.obligationAfter), replayed: execution.replayed === true };
  return { kind: status, code: str(execution.code), obligationAfter: null, replayed: false };
}

/** Result of L10 (approve recovery). */
export type RecoveryApproveView = { kind: "APPLIED"; execution: LateExecutionView } | { kind: "HALTED"; haltCode: string | null } | { kind: "UNKNOWN" };

export function recoveryApproveOf(body: unknown): RecoveryApproveView {
  if (!isRecord(body)) return { kind: "UNKNOWN" };
  if (body.status === "APPLIED") return { kind: "APPLIED", execution: lateExecutionOf(body.execution) };
  if (body.status === "HALTED") return { kind: "HALTED", haltCode: str(body.haltCode) };
  return { kind: "UNKNOWN" };
}

/** Result of L9 (open recovery). */
export interface RecoveryOpened {
  recoveryId: string;
  classification: string | null;
  haltCode: string | null;
}

export function recoveryOpenedOf(body: unknown): RecoveryOpened | null {
  if (!isRecord(body)) return null;
  const recoveryId = str(body.recoveryId);
  return recoveryId ? { recoveryId, classification: str(body.classification), haltCode: str(body.haltCode) } : null;
}
