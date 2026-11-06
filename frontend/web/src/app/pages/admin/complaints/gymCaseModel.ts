/**
 * D6 - pure model of the gym complaint-case screens (tabs, what the server allows, validation, evidence wording, money wording, paging).
 * No React, no I/O: tested under `npx tsx --test`. The server stays the authority: every "allowed" below comes from `allowedActions[]` of G3,
 * the rules written here only decide WHICH form to draw for an allowed action and what to say when it is refused.
 */
import { hasErrors, textError, type Errors } from "../disputes/actions/actionModel";
import { asRecord, formatDateTimeSafe, shortRefSafe } from "./gymFormat";
import {
  DECLARED_HASH_NOTE,
  GYM_EVENT_LABEL,
  PHOTO_HASH_NOTE,
  classHasMoneyExit,
  gymEventLabel,
  gymSourceLabel,
  gymStatusLabel,
  issueLabel,
  moneyChip,
  moneyTone,
  refusalText,
  type Tone,
} from "./gymCaseLabels";
import type {
  GymAllowedAction,
  GymCaseDetail,
  GymCaseListItem,
  GymCaseStatus,
  GymEvent,
  GymEvidence,
  GymFinancial,
  GymProposal,
  GymStatement,
} from "./gymCaseTypes";

export { hasErrors, textError };
export type { Errors };

// ───────────────────────────────────────────────────────────────── tabs ──
export const GYM_TABS = [
  { id: "overview", label: "Tổng quan" },
  { id: "evidence", label: "Bằng chứng" },
  { id: "statements", label: "Lời khai" },
  { id: "assessments", label: "Khẳng định & đánh giá" },
  { id: "finding", label: "Kết luận & đề xuất" },
  { id: "decision", label: "Phê duyệt" },
  { id: "execution", label: "Thực thi & tiền" },
  { id: "history", label: "Lịch sử" },
] as const;
export type GymTab = (typeof GYM_TABS)[number]["id"];
export const DEFAULT_GYM_TAB: GymTab = "overview";
const TAB_IDS: readonly string[] = GYM_TABS.map((t) => t.id);
export const parseGymTab = (raw: string | null | undefined): GymTab => (TAB_IDS.includes(raw ?? "") ? (raw as GymTab) : DEFAULT_GYM_TAB);
export const gymTabParam = (tab: GymTab): string | null => (tab === DEFAULT_GYM_TAB ? null : tab);
export const gymTabLabel = (tab: GymTab) => GYM_TABS.find((t) => t.id === tab)?.label ?? "Tổng quan";

/** A case id from the path: a plain token, else the page behaves as "not found" and sends no request. */
export function parseGymCaseId(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim();
  if (!v || v.length > 64) return null;
  return /^[A-Za-z0-9_-]+$/.test(v) ? v : null;
}

export const COMPLAINTS_PATH = "/admin/complaints";
export const casePath = (caseId: string) => `${COMPLAINTS_PATH}/cases/${encodeURIComponent(caseId)}`;
export const MEMBER_CASES_PATH = "/complaint-cases";
export const memberCasePath = (caseId: string) => `${MEMBER_CASES_PATH}/${encodeURIComponent(caseId)}`;

/** Small counts on the tabs (a number is a number, never a verdict). */
export function gymTabCounts(d: GymCaseDetail): Partial<Record<GymTab, number>> {
  return {
    evidence: d.evidence?.length ?? 0,
    statements: d.statements?.length ?? 0,
    assessments: (d.claims?.length ?? 0) + (d.assessments?.length ?? 0),
    finding: (d.findings?.length ?? 0) + (d.proposals?.length ?? 0),
    decision: d.proposals?.reduce((n, p) => n + (p.approvals?.length ?? 0), 0) ?? 0,
    history: d.events?.length ?? 0,
  };
}

// ─────────────────────────────────────────────────── what the server allows ──
export interface ActionVerdict {
  allowed: boolean;
  /** the stable server reason when refused (or `NOT_ALLOWED` when the server did not name the action at all) */
  reason: string | null;
  /** a sentence for the person who sees the disabled form */
  text: string | null;
}

export function actionOf(detail: Pick<GymCaseDetail, "allowedActions"> | null | undefined, name: string): ActionVerdict {
  const list: GymAllowedAction[] = Array.isArray(detail?.allowedActions) ? detail!.allowedActions : [];
  const a = list.find((x) => x.action === name);
  // An action the server did not list is NOT allowed: the screen never invents a permission.
  if (!a) return { allowed: false, reason: "NOT_ALLOWED", text: refusalText("NOT_ALLOWED") };
  if (a.allowed) return { allowed: true, reason: null, text: null };
  return { allowed: false, reason: a.reason ?? "NOT_ALLOWED", text: refusalText(a.reason) };
}

/**
 * The write layer is off when the server refuses EVERY action with `GYM_CASE_DISABLED` (contract: `allowedActions[i].allowed=false` with
 * `reason:"GYM_CASE_DISABLED"` while the flag is off). There is no separate capabilities route for gym; this is the only signal.
 */
export function isWriteLayerOff(detail: Pick<GymCaseDetail, "allowedActions"> | null | undefined): boolean {
  const list = Array.isArray(detail?.allowedActions) ? detail!.allowedActions : [];
  return list.length > 0 && list.every((a) => !a.allowed && a.reason === "GYM_CASE_DISABLED");
}

export const isCaseOpen = (status: string) => status !== "DECISION_APPROVED" && status !== "REJECTED_INTAKE";
export const isInvestigator = (detail: Pick<GymCaseDetail, "case">, userId: string | null | undefined) => !!userId && !!detail.case.investigatorId && detail.case.investigatorId === userId;

/** Steps the generic `transition` route accepts (rules.ts `canTransitionManually`); the others are earned by finding / proposal / decision. */
export const MANUAL_TRANSITIONS: Record<GymCaseStatus, GymCaseStatus[]> = {
  INTAKE: [],
  COLLECTING: ["AWAITING_PARTIES", "ASSESSING"],
  AWAITING_PARTIES: ["COLLECTING", "ASSESSING"],
  ASSESSING: ["COLLECTING", "AWAITING_PARTIES"],
  FINDING_RECORDED: ["ASSESSING"],
  AWAITING_APPROVAL: [],
  DECISION_APPROVED: [],
  REJECTED_INTAKE: [],
  APPEAL_REVIEW: [],
};
export type TransitionTarget = "COLLECTING" | "AWAITING_PARTIES" | "ASSESSING";
export function transitionTargets(status: string): TransitionTarget[] {
  const t = (MANUAL_TRANSITIONS as Record<string, GymCaseStatus[]>)[status] ?? [];
  return t.filter((x): x is TransitionTarget => x === "COLLECTING" || x === "AWAITING_PARTIES" || x === "ASSESSING");
}
/** Request-more is accepted from these steps (case.service `requestMore`). */
export const REQUEST_MORE_STATUSES: readonly string[] = ["COLLECTING", "AWAITING_PARTIES", "ASSESSING", "FINDING_RECORDED"];
export const STEP_VERB: Record<string, string> = {
  COLLECTING: "Quay lại thu thập bằng chứng",
  AWAITING_PARTIES: "Chờ hội viên bổ sung",
  ASSESSING: "Chuyển sang đánh giá",
};

export interface Gate {
  /** the form is drawn and usable */
  open: boolean;
  /** why it is not (shown muted) */
  why: string | null;
}
const gate = (v: ActionVerdict, extraOk = true): Gate => (v.allowed && extraOk ? { open: true, why: null } : { open: false, why: v.text });

export interface Gates {
  assign: Gate;
  rejectIntake: Gate;
  transition: Gate;
  requestMore: Gate;
  recollect: Gate;
  claim: Gate;
  statementOnBehalf: Gate;
  evidenceOnBehalf: Gate;
  share: Gate;
  assess: Gate;
  finding: Gate;
  propose: Gate;
  ack: Gate;
  decide: Gate;
  execute: Gate;
  reconcile: Gate;
  /** every gate is closed because the write layer is off */
  writeOff: boolean;
}

export function gatesOf(detail: GymCaseDetail): Gates {
  const st = detail.case.status;
  const v = (n: string) => actionOf(detail, n);
  const requestMore = v("REQUEST_MORE_INFO");
  return {
    assign: gate(v("ASSIGN")),
    rejectIntake: gate(v("ASSIGN"), st === "INTAKE"),
    transition: gate(requestMore, transitionTargets(st).length > 0),
    requestMore: gate(requestMore, REQUEST_MORE_STATUSES.includes(st)),
    recollect: gate(v("RECOLLECT_EVIDENCE")),
    claim: gate(v("ADD_CLAIM")),
    statementOnBehalf: gate(v("ADD_STATEMENT_ON_BEHALF")),
    evidenceOnBehalf: gate(v("ADD_EVIDENCE_ON_BEHALF")),
    share: gate(v("SHARE")),
    assess: gate(v("ADD_ASSESSMENT")),
    finding: gate(v("RECORD_FINDING")),
    propose: gate(v("PROPOSE")),
    ack: gate(v("ACK_EVIDENCE_CHANGE")),
    decide: gate(v("APPROVE").allowed ? v("APPROVE") : v("REJECT")),
    execute: gate(v("EXECUTE")),
    reconcile: gate(v("RECONCILE_EXECUTION")),
    writeOff: isWriteLayerOff(detail),
  };
}

// ───────────────────────────────────────────────────────── identities ──
export function personText(id: string | null | undefined, currentUserId: string | null | undefined, who: string): string {
  if (!id) return `${who}: chưa có`;
  if (currentUserId && id === currentUserId) return `${who}: bạn`;
  return `${who}: mã ${shortRefSafe(id)}`;
}
export const shortRefOf = shortRefSafe;
export function reporterText(id: string | null | undefined): string {
  return id ? `mã ${shortRefSafe(id)}` : "Chưa gắn người phản ánh";
}
export function investigatorText(id: string | null | undefined, currentUserId: string | null | undefined): string {
  if (!id) return "Chưa có người phụ trách";
  if (currentUserId && id === currentUserId) return "Bạn phụ trách";
  return `Người phụ trách: mã ${shortRefSafe(id)}`;
}

// ────────────────────────────────────────────────────────── validation ──
export const LIMITS = {
  reason: 2000,
  note: 2000,
  claim: 4000,
  assessmentNote: 4000,
  reasoning: 8000,
  decisionReason: 4000,
  statement: 5000,
  supplement: 2000,
  description: 2000,
  title: 200,
  fileName: 255,
  membershipId: 64,
  investigatorId: 64,
} as const;

const SHA256 = /^[0-9a-fA-F]{64}$/;
export const isSha256 = (v: string) => SHA256.test(v.trim());

export interface OpenForm {
  caseClass: string;
  membershipId: string;
}
export function validateOpen(f: OpenForm): Errors {
  const e: Errors = {};
  const valid = ["MEM_TXN", "MEM_CLOSED", "MEM_VIOLATION", "MEM_ACCESS", "GYM_GENERAL"];
  if (!valid.includes(f.caseClass)) {
    e.caseClass = "Chọn loại hồ sơ.";
    return e;
  }
  const money = classHasMoneyExit(f.caseClass);
  const m = f.membershipId.trim();
  if (money && !m) e.membershipId = "Loại hồ sơ này cần chọn gói hội viên của người phản ánh.";
  if (f.caseClass === "GYM_GENERAL" && m) e.membershipId = "Loại hồ sơ này không gắn với gói hội viên.";
  if (m.length > LIMITS.membershipId) e.membershipId = "Mã gói hội viên quá dài.";
  return e;
}
export const openBody = (f: OpenForm): { caseClass: OpenForm["caseClass"] & string; membershipId?: string } => {
  const m = f.membershipId.trim();
  return f.caseClass === "GYM_GENERAL" || !m ? { caseClass: f.caseClass } : { caseClass: f.caseClass, membershipId: m };
};

export function validateReason(value: string, max: number, required: boolean): Errors {
  const msg = textError(value, max, required);
  return msg ? { text: msg } : {};
}

export interface ClaimForm {
  claimantRole: string;
  text: string;
}
export function validateClaim(f: ClaimForm): Errors {
  const e: Errors = {};
  if (f.claimantRole !== "MEMBER" && f.claimantRole !== "ADMIN_ON_BEHALF") e.claimantRole = "Chọn ai là người nêu khẳng định.";
  const t = textError(f.text, LIMITS.claim, true);
  if (t) e.text = t;
  return e;
}

export interface AssessmentForm {
  claimId: string;
  groups: Record<string, "direct" | "indirect" | "rebuttal" | "none">;
  relevanceNote: string;
  verifiabilityNote: string;
  consistencyNote: string;
  result: string;
  reasoning: string;
}
export function validateAssessment(f: AssessmentForm, claimIds: readonly string[]): Errors {
  const e: Errors = {};
  if (!claimIds.includes(f.claimId)) e.claimId = "Chọn khẳng định cần đánh giá.";
  for (const k of ["relevanceNote", "verifiabilityNote", "consistencyNote"] as const) {
    const m = textError(f[k], LIMITS.assessmentNote, true);
    if (m) e[k] = m;
  }
  if (!["ESTABLISHED", "NOT_ESTABLISHED", "REFUTED"].includes(f.result)) e.result = "Chọn kết quả đánh giá.";
  const r = textError(f.reasoning, LIMITS.reasoning, true);
  if (r) e.reasoning = r;
  return e;
}
export function splitGroups(groups: AssessmentForm["groups"]): { direct: string[]; indirect: string[]; rebuttal: string[] } {
  const out = { direct: [] as string[], indirect: [] as string[], rebuttal: [] as string[] };
  for (const [id, g] of Object.entries(groups)) if (g === "direct" || g === "indirect" || g === "rebuttal") out[g].push(id);
  return out;
}

export interface FindingForm {
  finding: string;
  reasoning: string;
}
export function validateFinding(f: FindingForm): Errors {
  const e: Errors = {};
  if (f.finding !== "ESTABLISHED" && f.finding !== "NOT_ESTABLISHED") e.finding = "Chọn kết luận.";
  const r = textError(f.reasoning, LIMITS.reasoning, true);
  if (r) e.reasoning = r;
  return e;
}

export interface DecisionForm {
  result: string;
  reason: string;
  coi: boolean;
  evidenceAck: boolean;
}
export function validateDecision(f: DecisionForm): Errors {
  const e: Errors = {};
  if (f.result !== "APPROVED" && f.result !== "REJECTED") e.result = "Chọn duyệt hoặc bác.";
  const r = textError(f.reason, LIMITS.decisionReason, true);
  if (r) e.reason = r;
  if (!f.coi) e.coi = "Bạn cần khai báo không có xung đột lợi ích để gửi.";
  return e;
}

export interface StatementForm {
  text: string;
  supplementReason: string;
}
export function validateStatement(f: StatementForm, needsSupplement: boolean): Errors {
  const e: Errors = {};
  const t = textError(f.text, LIMITS.statement, true);
  if (t) e.text = t;
  const s = textError(f.supplementReason, LIMITS.supplement, needsSupplement);
  if (s) e.supplementReason = s;
  return e;
}
export const statementBody = (f: StatementForm, needsSupplement: boolean): { text: string; supplementReason?: string } => {
  const reason = f.supplementReason.trim();
  return needsSupplement && reason ? { text: f.text.trim(), supplementReason: reason } : { text: f.text.trim() };
};

export interface DocumentForm {
  description: string;
  sha256: string;
  title: string;
  fileName: string;
}
export function validateDocument(f: DocumentForm): Errors {
  const e: Errors = {};
  const d = textError(f.description, LIMITS.description, true);
  if (d) e.description = d;
  if (!f.sha256.trim()) e.sha256 = "Cần nhập mã sha256 (64 ký tự thập lục phân).";
  else if (!isSha256(f.sha256)) e.sha256 = "Mã sha256 phải gồm đúng 64 ký tự thập lục phân (0-9, a-f).";
  const t = textError(f.title, LIMITS.title, false);
  if (t) e.title = t;
  const n = textError(f.fileName, LIMITS.fileName, false);
  if (n) e.fileName = n;
  return e;
}
export const documentBody = (f: DocumentForm): { description: string; sha256: string; title?: string; fileName?: string } => {
  const out: { description: string; sha256: string; title?: string; fileName?: string } = { description: f.description.trim(), sha256: f.sha256.trim().toLowerCase() };
  if (f.title.trim()) out.title = f.title.trim();
  if (f.fileName.trim()) out.fileName = f.fileName.trim();
  return out;
};

/** The next admin statement on behalf is a supplement when one exists already (the server counts versions per party role). */
export const adminStatementNeedsSupplement = (statements: GymStatement[]) => statements.some((s) => s.partyRole === "ADMIN_ON_BEHALF");

// ───────────────────────────────────────────────── claims & evidence ──
export function unassessedClaims(d: Pick<GymCaseDetail, "claims" | "assessments">) {
  return (d.claims ?? []).filter((c) => !(d.assessments ?? []).some((a) => a.claimId === c.id));
}

export interface EvidenceChoice {
  id: string;
  kind: "evidence" | "statement";
  label: string;
}
/** Evidence AND statements can be listed in an assessment (the server accepts either id). */
export function evidenceChoices(d: Pick<GymCaseDetail, "evidence" | "statements">): EvidenceChoice[] {
  const ev = (d.evidence ?? []).map((e) => ({ id: e.id, kind: "evidence" as const, label: `${gymSourceLabel(e.source)}${e.snapshotVersion > 1 ? ` (bản ${e.snapshotVersion})` : ""}` }));
  const st = (d.statements ?? []).map((s) => ({ id: s.id, kind: "statement" as const, label: `Lời khai ${s.partyRole === "MEMBER" ? "của hội viên" : "do admin nhận hộ"} (lần ${s.version})` }));
  return [...ev, ...st];
}

export interface ShareChoice {
  id: string;
  label: string;
}
/** Not shareable: what the member already owns/sees, or sensitive rows (the server also refuses). */
export function shareableEvidence(d: Pick<GymCaseDetail, "evidence" | "shares">): ShareChoice[] {
  const shared = new Set((d.shares ?? []).map((s) => s.evidenceId).filter(Boolean) as string[]);
  return (d.evidence ?? [])
    .filter((e) => !shared.has(e.id) && !e.partySubmitted && e.sensitivity !== "SENSITIVE" && ["GYM_RECORD", "CHECKIN_SUMMARY", "PARTY_DOCUMENT"].includes(e.source))
    .map((e) => ({ id: e.id, label: gymSourceLabel(e.source) }));
}
export function shareableStatements(d: Pick<GymCaseDetail, "statements" | "shares">): ShareChoice[] {
  const shared = new Set((d.shares ?? []).map((s) => s.statementId).filter(Boolean) as string[]);
  return (d.statements ?? []).filter((s) => !shared.has(s.id) && s.partyRole !== "MEMBER").map((s) => ({ id: s.id, label: `Lời khai do admin nhận hộ (lần ${s.version})` }));
}
export function isSharedWithMember(d: Pick<GymCaseDetail, "shares">, kind: "evidence" | "statement", id: string): boolean {
  return (d.shares ?? []).some((s) => (kind === "evidence" ? s.evidenceId === id : s.statementId === id));
}

// ───────────────────────────────────────────────── evidence wording ──
export interface EvidenceField {
  label: string;
  value: string;
}
export interface EvidenceView {
  id: string;
  title: string;
  /** server `provenanceLabel` ("Hệ thống ghi nhận", "Admin nhận hộ", ...) */
  provenance: string;
  partySubmitted: boolean;
  onBehalf: boolean;
  fields: EvidenceField[];
  notes: string[];
  version: number;
  capturedAt: string;
  eventAt: string | null;
  hash: string;
  /** a declared hash (the party's claim), shown in full and labelled */
  declaredSha: string | null;
}

const MEMBERSHIP_STATUS: Record<string, string> = {
  PENDING_PAYMENT: "Chờ thanh toán",
  ACTIVE: "Đang hoạt động",
  EXPIRED: "Đã hết hạn",
  CANCELLED: "Đã huỷ",
  PENDING_ISSUE: "Có vấn đề thanh toán, đang chờ xử lý",
};
const GYM_OPERATIONAL: Record<string, string> = { OPEN: "Đang mở cửa", TEMPORARILY_CLOSED: "Tạm đóng cửa", PERMANENTLY_CLOSED: "Đã đóng cửa vĩnh viễn" };
const GYM_APPROVAL: Record<string, string> = { DRAFT: "Bản nháp", PENDING_REVIEW: "Chờ duyệt", APPROVED: "Đang được duyệt hoạt động", REJECTED: "Bị từ chối", SUSPENDED: "Bị tạm ngưng" };
const COMPLAINT_SOURCE: Record<string, string> = {
  SELF_DETECTED: "Admin tự phát hiện",
  MEMBER_REPORT: "Hội viên báo cáo",
  PT_REPORT: "PT phản ánh",
  PARTNER_DISCLOSED: "Đối tác tự khai báo",
};

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown): string | null => (typeof v === "number" && Number.isFinite(v) ? String(v) : typeof v === "string" && v.trim() && /^-?\d+(\.\d+)?$/.test(v.trim()) ? v.trim() : null);
const date = (v: unknown): string | null => {
  const t = text(v);
  return t && !Number.isNaN(Date.parse(t)) ? formatDateTimeSafe(t) : null;
};
const push = (list: EvidenceField[], label: string, value: string | null) => {
  if (value) list.push({ label, value });
};

/** One evidence row in words. Unknown payload keys are never printed; an unknown source says only its generic name. */
export function describeEvidence(e: GymEvidence): EvidenceView {
  const p = asRecord(e.payload) ?? {};
  const fields: EvidenceField[] = [];
  const notes: string[] = [];
  let declaredSha: string | null = null;
  switch (e.source) {
    case "COMPLAINT_RECORD":
      push(fields, "Nguồn phản ánh", COMPLAINT_SOURCE[String(p.source)] ?? null);
      push(fields, "Loại vấn đề", p.issueType ? issueLabel(String(p.issueType)) : null);
      push(fields, "Nội dung", text(p.description));
      push(fields, "Gửi lúc", date(p.createdAt));
      break;
    case "COMPLAINT_PHOTO":
      push(fields, "Ảnh", "Một ảnh đính kèm khiếu nại (mở ở phần chi tiết khiếu nại)");
      notes.push(PHOTO_HASH_NOTE);
      break;
    case "GYM_RECORD":
      push(fields, "Hoạt động", GYM_OPERATIONAL[String(p.operationalStatus)] ?? null);
      push(fields, "Trạng thái duyệt", GYM_APPROVAL[String(p.status)] ?? null);
      push(fields, "Đóng cửa lúc", date(p.closedAt));
      push(fields, "Lý do đóng cửa", text(p.closureReason));
      break;
    case "MEMBERSHIP_RECORD":
      push(fields, "Tình trạng gói", MEMBERSHIP_STATUS[String(p.status)] ?? null);
      push(fields, "Bắt đầu", date(p.startDate));
      push(fields, "Kết thúc", date(p.endDate));
      push(fields, "Giá lúc mua", num(p.priceAtPurchase));
      push(fields, "Thời hạn gói (ngày)", num(p.durationDaysSnapshot));
      push(fields, "Lượt tập", p.totalVisits === null || p.totalVisits === undefined ? null : `${num(p.usedVisits) ?? "0"}/${num(p.totalVisits) ?? "?"}`);
      push(fields, "Đã chuyển tiền cho phòng tập lúc", date(p.payoutReleasedAt));
      break;
    case "CHECKIN_SUMMARY":
      push(fields, "Số lượt check-in của gói", num(p.count));
      push(fields, "Lần đầu", date(p.firstAt));
      push(fields, "Lần gần nhất", date(p.lastAt));
      notes.push("Check-in chỉ cho biết hội viên đã quét, không tự chứng minh khiếu nại đúng hay sai.");
      break;
    case "PARTY_DOCUMENT":
      push(fields, "Mô tả", text(p.description));
      push(fields, "Tiêu đề", text(p.title));
      push(fields, "Tên tệp", text(p.fileName));
      declaredSha = text(p.declaredSha256);
      notes.push(DECLARED_HASH_NOTE);
      break;
    default:
      break;
  }
  return {
    id: e.id,
    title: gymSourceLabel(e.source),
    provenance: text(e.provenanceLabel) ?? "Nguồn chưa rõ",
    partySubmitted: !!e.partySubmitted,
    onBehalf: e.provenanceType === "ADMIN_RECEIVED_ON_BEHALF",
    fields,
    notes,
    version: e.snapshotVersion,
    capturedAt: e.capturedAt,
    eventAt: e.eventAt,
    hash: e.contentHash,
    declaredSha,
  };
}

/** Latest row per (source, subject) first; older versions follow (they are append-only, never edited). */
export function evidenceGroups(evidence: GymEvidence[]): Array<{ source: string; title: string; rows: GymEvidence[] }> {
  const order: string[] = [];
  const bySource = new Map<string, GymEvidence[]>();
  for (const e of evidence ?? []) {
    if (!bySource.has(e.source)) {
      bySource.set(e.source, []);
      order.push(e.source);
    }
    bySource.get(e.source)!.push(e);
  }
  const rank = ["COMPLAINT_RECORD", "COMPLAINT_PHOTO", "MEMBERSHIP_RECORD", "CHECKIN_SUMMARY", "GYM_RECORD", "PARTY_DOCUMENT"];
  order.sort((a, b) => (rank.indexOf(a) === -1 ? 99 : rank.indexOf(a)) - (rank.indexOf(b) === -1 ? 99 : rank.indexOf(b)));
  return order.map((source) => ({ source, title: gymSourceLabel(source), rows: [...bySource.get(source)!].sort((a, b) => b.snapshotVersion - a.snapshotVersion || Date.parse(b.capturedAt) - Date.parse(a.capturedAt)) }));
}

// ───────────────────────────────────────────────────────────── money ──
export interface MoneyView {
  tone: Tone;
  chip: string;
  /** the server's own sentence */
  sentence: string;
  /** amounts payment-service confirmed, decimal strings as sent */
  posted: string | null;
  shortfall: string | null;
  platformShortfall: string | null;
  /** only LEDGER_POSTED_* may be called a refund that happened */
  refundHappened: boolean;
}
export function describeMoney(f: GymFinancial | null | undefined): MoneyView {
  if (!f) {
    return { tone: "warning", chip: "Chưa đọc được thông tin tiền", sentence: "Chưa đọc được thông tin tiền của hồ sơ.", posted: null, shortfall: null, platformShortfall: null, refundHappened: false };
  }
  const posted = f.state === "LEDGER_POSTED_FULL" || f.state === "LEDGER_POSTED_PARTIAL" || (f.state === "NEEDS_RECONCILIATION" && !!f.postedToMemberWallet);
  return {
    tone: moneyTone(f.state),
    chip: moneyChip(f.state),
    sentence: typeof f.label === "string" && f.label.trim() ? f.label.trim() : moneyChip(f.state),
    posted: f.postedToMemberWallet ?? null,
    shortfall: f.memberShortfall ?? null,
    platformShortfall: f.referralClawbackShortfall ?? null,
    refundHappened: posted,
  };
}

// ─────────────────────────────────────────────────────────── execution ──
export interface ExecutionView {
  headline: string;
  /** the case is waiting for someone to run it */
  canRun: boolean;
}

/** The latest proposal, if any. */
export function newestProposal(proposals: GymProposal[] | null | undefined): GymProposal | null {
  const list = Array.isArray(proposals) ? proposals : [];
  return list.length ? list[list.length - 1] : null;
}
export const latestFinding = <T extends { id: string }>(list: T[] | null | undefined): T | null => (Array.isArray(list) && list.length ? list[list.length - 1] : null);

/** Result sentence of an `execute` / `reconcile` call. Says "đã ghi vào ví" only for the ledger states. */
export function executeResultText(money: GymFinancial | null | undefined, replayed: boolean): string {
  const m = describeMoney(money);
  const prefix = replayed ? "Quyết định này đã được thực thi trước đó, không thực thi lại. " : "Đã thực thi xong bước nghiệp vụ. ";
  return `${prefix}${m.sentence}`;
}

// ─────────────────────────────────────────────────────────── history ──
export function sortedEvents(events: GymEvent[] | null | undefined): GymEvent[] {
  return [...(events ?? [])].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}
export function eventActor(e: Pick<GymEvent, "actorUserId" | "actorRole">, currentUserId: string | null | undefined): string {
  if (e.actorRole === "SYSTEM" || !e.actorUserId) return "Hệ thống";
  if (currentUserId && e.actorUserId === currentUserId) return "Bạn";
  return `${e.actorRole === "ADMIN" ? "Quản trị viên" : e.actorRole === "CUSTOMER" || e.actorRole === "PT" ? "Hội viên" : "Người dùng"} mã ${shortRefSafe(e.actorUserId)}`;
}
export function eventStep(e: Pick<GymEvent, "fromStatus" | "toStatus">): string | null {
  if (!e.fromStatus && !e.toStatus) return null;
  if (e.fromStatus && e.toStatus && e.fromStatus !== e.toStatus) return `${gymStatusLabel(e.fromStatus)} → ${gymStatusLabel(e.toStatus)}`;
  return e.toStatus ? gymStatusLabel(e.toStatus) : null;
}
/** Free text written by a person is shown; a system code ("attempt 2", "REFUND_REFUSED:..") is not. */
export function eventNote(e: Pick<GymEvent, "note">): string | null {
  const t = text(e.note);
  if (!t) return null;
  if (/^[A-Z0-9_:.\- ]+$/.test(t) || /^attempt\s+\d+$/i.test(t) || /^class\s+[A-Z_]+$/i.test(t)) return null;
  return t;
}
export const HISTORY_LIMIT_NOTE = "Tối đa 200 sự kiện gần nhất.";
export const KNOWN_EVENT_ACTIONS = Object.keys(GYM_EVENT_LABEL);
export { gymEventLabel };

// ─────────────────────────────────────────────────────── queue / paging ──
export const PAGE_SIZE = 20;
export function parsePage(raw: string | null | undefined): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= 5000 ? n : 1;
}
export interface PageInfo {
  page: number;
  pages: number;
  from: number;
  to: number;
  total: number;
  hasPrev: boolean;
  hasNext: boolean;
  offset: number;
}
export function pageInfo(total: number, page: number, count: number, limit = PAGE_SIZE): PageInfo {
  const t = Math.max(0, Math.floor(total) || 0);
  const pages = Math.max(1, Math.ceil(t / limit));
  const offset = (page - 1) * limit;
  return { page, pages, from: count > 0 ? offset + 1 : 0, to: offset + count, total: t, hasPrev: page > 1, hasNext: page < pages, offset };
}
export const pageText = (p: PageInfo) => (p.total === 0 ? "Không có mục nào" : `${p.from}–${p.to} trên ${p.total} · Trang ${p.page}/${p.pages}`);

export type QueueView = "complaints" | "cases";
export const parseQueueView = (raw: string | null | undefined): QueueView => (raw === "cases" ? "cases" : "complaints");
const COMPLAINT_STATUSES = ["OPEN", "IN_PROGRESS", "RESOLVED"];
export function parseComplaintStatus(raw: string | null | undefined): "OPEN" | "IN_PROGRESS" | "RESOLVED" | "ALL" {
  if (raw === "ALL") return "ALL";
  return raw && COMPLAINT_STATUSES.includes(raw) ? (raw as "OPEN" | "IN_PROGRESS" | "RESOLVED") : "OPEN";
}
export function parseCaseStatusFilter(raw: string | null | undefined): GymCaseStatus | null {
  const all = ["INTAKE", "COLLECTING", "AWAITING_PARTIES", "ASSESSING", "FINDING_RECORDED", "AWAITING_APPROVAL", "DECISION_APPROVED", "REJECTED_INTAKE"];
  return raw && all.includes(raw) ? (raw as GymCaseStatus) : null;
}

export interface CaseRow {
  id: string;
  title: string;
  status: string;
  statusLabel: string;
  tone: Tone;
  issue: string;
  preview: string;
  createdLabel: string;
  investigator: string;
  hasMoney: boolean;
}
export function caseRow(i: GymCaseListItem, userId: string | null | undefined): CaseRow {
  return {
    id: i.id,
    title: `${issueLabel(i.issueType)} · ${shortGymClass(i.caseClass)}`,
    status: i.status,
    statusLabel: gymStatusLabel(i.status),
    tone: statusToneOf(i.status),
    issue: issueLabel(i.issueType),
    preview: (i.descriptionPreview ?? "").trim(),
    createdLabel: formatDateTimeSafe(i.createdAt),
    investigator: investigatorText(i.investigatorId, userId),
    hasMoney: classHasMoneyExit(i.caseClass),
  };
}
function shortGymClass(c: string): string {
  switch (c) {
    case "MEM_TXN":
      return "giao dịch gói";
    case "MEM_CLOSED":
      return "phòng đóng cửa";
    case "MEM_VIOLATION":
      return "phòng vi phạm";
    case "MEM_ACCESS":
      return "không vào được phòng";
    case "GYM_GENERAL":
      return "vấn đề chung";
    default:
      return "hồ sơ khác";
  }
}
function statusToneOf(status: string): Tone {
  switch (status) {
    case "DECISION_APPROVED":
      return "success";
    case "REJECTED_INTAKE":
      return "neutral";
    case "AWAITING_APPROVAL":
      return "pending";
    case "AWAITING_PARTIES":
      return "warning";
    default:
      return "info";
  }
}

/** A case for a complaint: find it in a list page (G2 has no complaintId filter). */
export function findCaseOfComplaint(items: GymCaseListItem[] | null | undefined, complaintId: string): GymCaseListItem | null {
  return (items ?? []).find((c) => c.complaintId === complaintId) ?? null;
}

/** Read the G1 answer defensively. */
export function readOpenResult(raw: unknown): { caseId: string; existing: boolean } | null {
  const r = asRecord(raw);
  if (!r || typeof r.id !== "string" || !r.id) return null;
  return { caseId: r.id, existing: r.existing === true };
}

/** A decision proposal may be approved only by someone else: the line shown to the proposer / investigator. */
export function approvalHint(detail: GymCaseDetail, userId: string | null | undefined): string | null {
  const p = newestProposal(detail.proposals);
  if (!p || detail.case.status !== "AWAITING_APPROVAL") return null;
  if (userId && p.proposerId === userId) return "Bạn là người lập đề xuất này nên không duyệt được. Cần một quản trị viên khác.";
  if (userId && detail.case.investigatorId === userId) return "Bạn là điều tra viên của hồ sơ này nên không duyệt được. Cần một quản trị viên khác.";
  return null;
}
