/**
 * D4 / M12 - pure model of the party-side screens (no React, no I/O): form validation (the exact limits of schemas.ts), sha256 text rules,
 * server error -> form feedback, and the view models of the list (B1) and the detail (B2).
 */
import { GYM_CHECKIN_NOTE } from "../admin/disputes/disputeCaseLabels";
import { parseDisputeErrorBody, type DisputeErrorView } from "../admin/disputes/disputeCaseErrors";
import { describeMoneyGroup } from "../admin/disputes/disputeFinancial";
import type { CaseStatus, PartyCaseDetail, PartyCaseListItem } from "../admin/disputes/disputeCaseTypes";
import { GYM_CHECKIN_SUBJECTS, subjectTitle } from "../admin/disputes/workspace/evidenceModel";
import { asRecord, formatDateTime } from "../admin/disputes/workspace/format";
import {
  MINE_LABEL,
  MONEY_STATUS_NOTE,
  OWN_DOC_UNVERIFIED,
  ROLE_RECORDED_LABEL,
  SHARED_LABEL,
  UNREADABLE_SOURCE,
  claimMoveLabel,
  claimantLabel,
  partyProvenanceLabel,
  partyRoleLabel,
  partyStatusLabel,
  partyStatusNote,
  partyTypeLabel,
  statementSourceLabel,
} from "./partyLabels";

export const APPEAL_REASON_MAX = 4000;
export const APPEAL_NOTICE_TEXT =
  "Mỗi bên chỉ được yêu cầu xem xét lại một lần, trong 14 ngày kể từ khi được báo kết luận.";
export const APPEAL_SUCCESS_TEXT =
  "Đã gửi yêu cầu xem xét lại. Kết quả hiện tại chưa thay đổi.";

export function canRequestPartyAppeal(
  status: string,
  appeal?: { canFile?: boolean; closesAt?: string | null } | null,
): boolean {
  if (appeal && typeof appeal.canFile === "boolean") {
    return appeal.canFile;
  }
  return status === "DECISION_APPROVED" || status === "CLOSED";
}

export function validateAppealReason(reason: string): { ok: boolean; message?: string } {
  const trimmed = reason.trim();
  if (trimmed.length < 1) {
    return { ok: false, message: "Vui lòng nhập lý do xem xét lại (tối thiểu 1 ký tự)." };
  }
  if (trimmed.length > APPEAL_REASON_MAX) {
    return { ok: false, message: `Lý do không được vượt quá ${APPEAL_REASON_MAX} ký tự.` };
  }
  return { ok: true };
}

// ───────────────────────────────────────────────────────────── limits ──
export const STATEMENT_MAX = 5000;
export const REASON_MAX = 2000;
export const DESCRIPTION_MAX = 2000;
export const TITLE_MAX = 200;
export const FILE_NAME_MAX = 255;
export const SHA256_RE = /^[0-9a-f]{64}$/;
/** crypto.subtle needs the whole file in memory: above this the user pastes the hash instead. */
export const MAX_HASH_FILE_BYTES = 100 * 1024 * 1024;

// ───────────────────────────────────────────────────────────── forms ──
export interface FieldErrors {
  [field: string]: string | undefined;
}

export const FIELD_MESSAGE = {
  text: `Nhập nội dung lời khai (1 đến ${STATEMENT_MAX} ký tự).`,
  supplementReason: `Nhập lý do bổ sung (1 đến ${REASON_MAX} ký tự). Từ lời khai thứ hai trở đi lý do này là bắt buộc.`,
  description: `Nhập mô tả tài liệu (1 đến ${DESCRIPTION_MAX} ký tự).`,
  title: `Tiêu đề tối đa ${TITLE_MAX} ký tự.`,
  fileName: `Tên tệp tối đa ${FILE_NAME_MAX} ký tự.`,
  sha256: "Mã sha256 phải gồm đúng 64 ký tự 0-9 và a-f.",
} as const;

const clean = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

export interface StatementInputValues {
  text: string;
  supplementReason: string;
}
export interface StatementBody {
  text: string;
  supplementReason?: string;
}

/** Version rule of the server: versions are counted per PARTY ROLE, so any statement of my role makes the next one a supplement. */
export function nextStatementVersion(detail: Pick<PartyCaseDetail, "case" | "statements">): number {
  const mine = detail.statements.filter((s) => s.partyRole === detail.case.role);
  return mine.reduce((max, s) => Math.max(max, Number.isFinite(s.version) ? s.version : 0), 0) + 1;
}
export const statementNeedsReason = (detail: Pick<PartyCaseDetail, "case" | "statements">) => nextStatementVersion(detail) > 1;

export function validateStatement(values: StatementInputValues, needsReason: boolean): { ok: true; body: StatementBody } | { ok: false; errors: FieldErrors } {
  const text = clean(values.text);
  const reason = clean(values.supplementReason);
  const errors: FieldErrors = {};
  if (text.length < 1 || text.length > STATEMENT_MAX) errors.text = FIELD_MESSAGE.text;
  if (needsReason) {
    if (reason.length < 1 || reason.length > REASON_MAX) errors.supplementReason = FIELD_MESSAGE.supplementReason;
  } else if (reason.length > REASON_MAX) errors.supplementReason = FIELD_MESSAGE.supplementReason;
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, body: needsReason || reason ? { text, supplementReason: reason } : { text } };
}

/** "<hash>  file.txt" (output of sha256sum), spaces and upper case are tolerated: the first token, lower-cased. */
export function normalizeSha256(raw: unknown): string {
  const first = clean(raw).split(/\s+/)[0] ?? "";
  return first.toLowerCase();
}
export const isSha256 = (v: string) => SHA256_RE.test(v);

export interface DocumentInputValues {
  description: string;
  title: string;
  fileName: string;
  sha256: string;
}
export interface DocumentBody {
  description: string;
  sha256: string;
  title?: string;
  fileName?: string;
}
export function validateDocument(values: DocumentInputValues): { ok: true; body: DocumentBody } | { ok: false; errors: FieldErrors } {
  const description = clean(values.description);
  const title = clean(values.title);
  const fileName = clean(values.fileName);
  const sha256 = normalizeSha256(values.sha256);
  const errors: FieldErrors = {};
  if (description.length < 1 || description.length > DESCRIPTION_MAX) errors.description = FIELD_MESSAGE.description;
  if (title.length > TITLE_MAX) errors.title = FIELD_MESSAGE.title;
  if (fileName.length > FILE_NAME_MAX) errors.fileName = FIELD_MESSAGE.fileName;
  if (!isSha256(sha256)) errors.sha256 = FIELD_MESSAGE.sha256;
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, body: { description, sha256, ...(title ? { title } : {}), ...(fileName ? { fileName } : {}) } };
}

// ───────────────────────────────────────────────────────── errors ──
export interface FormFeedback {
  message: string;
  fieldErrors: FieldErrors;
  /** The case moved under the form: reload it first, then send again. */
  mustReload: boolean;
  /** SUPPLEMENT_REASON_REQUIRED: show (and focus) the reason field. */
  showReasonField: boolean;
  /** 404: say "not found" and offer the list; never reveal whether the case exists. */
  notFound: boolean;
  /** No answer / 5xx: the write may have been saved. A resend with the SAME key replays, it can not duplicate. */
  outcomeUnknown: boolean;
  code: string | null;
}

const FORM_FIELDS = ["text", "supplementReason", "description", "title", "fileName", "sha256"] as const;

/** The server's `fields[].path` may be "text" or "body.text": the last segment decides. Messages are OUR Vietnamese, never the server's. */
export function fieldErrorsOf(view: Pick<DisputeErrorView, "fields">): { errors: FieldErrors; unmatched: number } {
  const errors: FieldErrors = {};
  let unmatched = 0;
  for (const f of view.fields) {
    const last = String(f.path).split(".").pop() ?? "";
    if ((FORM_FIELDS as readonly string[]).includes(last)) errors[last] = FIELD_MESSAGE[last as keyof typeof FIELD_MESSAGE];
    else unmatched += 1;
  }
  return { errors, unmatched };
}

/** CASE_STATE_NOT_ALLOWED in party words (the D1 text names the admin step). */
function stateRefusal(details: Record<string, unknown> | null): string {
  const s = details?.status;
  return typeof s === "string"
    ? `Hồ sơ đang ở bước «${partyStatusLabel(s)}» nên hiện chưa nhận thêm thông tin từ bạn. Hãy tải lại hồ sơ để xem bước hiện tại.`
    : "Ở bước hiện tại hồ sơ chưa nhận thêm thông tin từ bạn. Hãy tải lại hồ sơ để xem bước hiện tại.";
}

export function describeFormFailure(view: DisputeErrorView): FormFeedback {
  const { errors } = fieldErrorsOf(view);
  const base: FormFeedback = {
    message: view.message,
    fieldErrors: errors,
    mustReload: view.kind === "conflictReload" || view.code === "CASE_STATE_NOT_ALLOWED",
    showReasonField: false,
    notFound: view.kind === "notFound",
    outcomeUnknown: view.outcomeUnknown,
    code: view.code,
  };
  if (view.code === "SUPPLEMENT_REASON_REQUIRED") {
    base.showReasonField = true;
    base.fieldErrors = { ...errors, supplementReason: FIELD_MESSAGE.supplementReason };
    base.message = "Từ lời khai thứ hai trở đi cần nhập lý do bổ sung. Hãy điền ô «Lý do bổ sung» rồi gửi lại.";
  } else if (view.code === "CASE_STATE_NOT_ALLOWED") {
    base.message = stateRefusal(view.details);
  } else if (view.code === "INVALID_INPUT") {
    base.message = Object.keys(errors).length ? "Một số ô chưa hợp lệ. Hãy kiểm tra các ô được đánh dấu." : view.message;
  } else if (view.code === "STATEMENT_VERSION_CONFLICT") {
    base.message = "Lời khai của bạn vừa được ghi từ nơi khác. Hãy tải lại hồ sơ để xem rồi gửi lại nếu vẫn cần.";
  }
  return base;
}

/** Same as `parseDisputeError` but for a body already in hand (tests). */
export const feedbackFromBody = (status: number | null, body: unknown, write = true) => describeFormFailure(parseDisputeErrorBody(status, body, { action: write ? "write" : "read" }));

// ───────────────────────────────────────────────────────────── list (B1) ──
export type PillTone = "info" | "neutral" | "pending" | "success" | "warning" | "danger";

const OPEN_FOR_PARTY: readonly CaseStatus[] = ["COLLECTING", "AWAITING_PARTIES", "ASSESSING", "POLICY_PENDING"];
export function statusTone(status: unknown): PillTone {
  if (typeof status !== "string") return "neutral";
  if (OPEN_FOR_PARTY.includes(status as CaseStatus)) return "info";
  if (status === "DECISION_APPROVED" || status === "REJECTED_INTAKE") return "neutral";
  return "pending";
}

export interface ListRow {
  id: string;
  title: string;
  statusLabel: string;
  tone: PillTone;
  roleLabel: string;
  createdLabel: string;
  createdAt: string;
}
export function listRows(items: readonly PartyCaseListItem[] | null | undefined): ListRow[] {
  const rows = (items ?? []).map((i) => ({
    id: i.id,
    title: partyTypeLabel(i.type),
    statusLabel: partyStatusLabel(i.status),
    tone: statusTone(i.status),
    roleLabel: i.role ? partyRoleLabel(i.role) : "Chưa rõ vai trò",
    createdLabel: formatDateTime(i.createdAt),
    createdAt: i.createdAt,
  }));
  // newest first, stable for equal dates
  return rows
    .map((r, idx) => ({ r, idx }))
    .sort((a, b) => (Date.parse(b.r.createdAt) || 0) - (Date.parse(a.r.createdAt) || 0) || a.idx - b.idx)
    .map((x) => x.r);
}

// ─────────────────────────────────────────────────────────── detail (B2) ──
export interface EvidenceFact {
  label: string;
  value: string;
}
export interface EvidenceView {
  id: string;
  title: string;
  sourceLine: string;
  badges: Array<{ label: string; tone: PillTone }>;
  times: string[];
  facts: EvidenceFact[];
  caveat: string | null;
  mine: boolean;
}

type PartyEvidence = PartyCaseDetail["evidence"][number];
const isPartyDoc = (e: PartyEvidence) => e.source.startsWith("party.") || e.subject.startsWith("PARTY_DOC:") || e.subject.startsWith("PARTY_FILE:");

function evidenceTitle(e: PartyEvidence): string {
  if (isPartyDoc(e)) return e.mine ? "Tài liệu do bạn khai" : "Tài liệu được chia sẻ cho bạn";
  return subjectTitle(e.subject);
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** What an own document row shows from its `payload`. A stored-file key / storage path is never read. */
function ownDocFacts(payload: unknown): EvidenceFact[] {
  const p = asRecord(payload);
  if (!p) return [];
  const facts: EvidenceFact[] = [];
  const title = str(p.title);
  const description = str(p.description);
  const fileName = str(p.fileName);
  const sha = str(p.declaredSha256);
  if (title) facts.push({ label: "Tiêu đề", value: title });
  if (description) facts.push({ label: "Mô tả", value: description });
  if (fileName) facts.push({ label: "Tên tệp bạn ghi", value: fileName });
  if (sha) facts.push({ label: "Mã sha256 bạn khai", value: sha });
  return facts;
}

export function evidenceViews(detail: Pick<PartyCaseDetail, "evidence">): EvidenceView[] {
  return detail.evidence.map((e) => {
    const party = isPartyDoc(e);
    const unreadable = e.provenanceType === "TECH_GAP" || e.captureStatus === "UNAVAILABLE" || e.captureStatus === "TECH_GAP_SUSPECTED";
    const badges: EvidenceView["badges"] = [];
    if (e.mine) badges.push({ label: MINE_LABEL, tone: "info" });
    else if (party) badges.push({ label: SHARED_LABEL, tone: "neutral" });
    if (e.verificationStatus === "CLIENT_CLAIMED_UNVERIFIED" || (e.mine && party && e.verificationStatus !== "SERVER_VERIFIED")) {
      badges.push({ label: e.mine ? OWN_DOC_UNVERIFIED : "Bên nộp tự khai, chưa xác minh", tone: "warning" });
    }
    if (unreadable) badges.push({ label: "Không đọc được nguồn", tone: "danger" });
    const times: string[] = [];
    if (e.eventAt) times.push(`Xảy ra lúc ${formatDateTime(e.eventAt)}`);
    if (e.capturedAt) times.push(`Hệ thống ghi nhận lúc ${formatDateTime(e.capturedAt)}`);
    const gym = GYM_CHECKIN_SUBJECTS.includes(e.subject);
    return {
      id: e.id,
      title: evidenceTitle(e),
      sourceLine: party ? (e.mine ? "Do bạn khai trong hồ sơ này" : "Tài liệu do một bên nộp") : partyProvenanceLabel(e.provenanceType),
      badges,
      times,
      facts: e.mine && party ? ownDocFacts(e.payload) : [],
      caveat: gym ? GYM_CHECKIN_NOTE : unreadable ? UNREADABLE_SOURCE : null,
      mine: e.mine,
    };
  });
}

export interface StatementView {
  id: string;
  heading: string;
  who: string;
  sourceLine: string | null;
  when: string;
  text: string;
  supplementReason: string | null;
  mine: boolean;
}
export function statementViews(detail: Pick<PartyCaseDetail, "case" | "statements">): StatementView[] {
  const sorted = [...detail.statements].sort((a, b) => (Date.parse(a.createdAt) || 0) - (Date.parse(b.createdAt) || 0) || a.version - b.version);
  return sorted.map((s) => ({
    id: s.id,
    heading: `Lời khai lần ${s.version}`,
    who: s.mine ? MINE_LABEL : s.partyRole === detail.case.role ? ROLE_RECORDED_LABEL : SHARED_LABEL,
    sourceLine: statementSourceLabel(s.source),
    when: formatDateTime(s.createdAt),
    text: s.text,
    supplementReason: s.supplementReason && s.supplementReason.trim() ? s.supplementReason : null,
    mine: s.mine,
  }));
}

export interface AccusationView {
  id: string;
  who: string;
  text: string;
  moves: string | null;
}
export function accusationViews(detail: Pick<PartyCaseDetail, "accusations">): AccusationView[] {
  return detail.accusations.map((a) => ({
    id: a.id,
    who: claimantLabel(a.claimantRole),
    text: a.text,
    moves: a.moves && a.moves.length ? a.moves.map(claimMoveLabel).join(", ") : null,
  }));
}

/** An amount in a label would break "parties never see amounts": such a label is replaced by the plain group wording. */
const AMOUNT_IN_TEXT = /\d[\d.,\s]*\s*(₫|đ\b|vnd|vnđ)/i;

export interface MoneyView {
  label: string;
  tone: PillTone;
  note: string;
}
export function moneyView(financial: PartyCaseDetail["financial"] | null | undefined): MoneyView {
  const d = describeMoneyGroup(financial ?? {});
  const label = AMOUNT_IN_TEXT.test(d.label) ? describeMoneyGroup({ group: financial?.group, groupLabel: "" }).label : d.label;
  const tone: PillTone = d.tone === "success" ? "success" : d.tone === "danger" ? "danger" : d.tone === "warning" ? "warning" : d.tone === "info" ? "info" : "neutral";
  return { label, tone, note: MONEY_STATUS_NOTE };
}

export interface CaseHeaderView {
  title: string;
  statusLabel: string;
  statusNote: string;
  tone: PillTone;
  roleLabel: string;
  createdLabel: string;
  canSubmit: boolean;
}
export function caseHeader(detail: Pick<PartyCaseDetail, "case">): CaseHeaderView {
  const c = detail.case;
  return {
    title: partyTypeLabel(c.type),
    statusLabel: partyStatusLabel(c.status),
    statusNote: partyStatusNote(c.status),
    tone: statusTone(c.status),
    roleLabel: partyRoleLabel(c.role),
    createdLabel: formatDateTime(c.createdAt),
    canSubmit: c.canSubmit === true,
  };
}

/** A case id in the path is a UUID; anything else is "not found" with NO request (so a typo leaks nothing and costs nothing). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const parseCaseId = (raw: string | undefined): string | null => (raw && UUID_RE.test(raw) ? raw : null);
