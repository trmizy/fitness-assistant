/**
 * D3 - pure model of the Case Workspace write forms: who sees which form, field limits (copied from user-service
 * `services/dispute-case/schemas.ts`), validators, exact request bodies, evidence/statement pickers, the approval summary.
 * No React, no I/O (runs under `tsx --test`).
 *
 * Hard rules kept here:
 *  - the server stays the authority: every gate below only HIDES a control the server would refuse, never grants one;
 *  - bodies carry only the documented fields (the server is `.strict()`): no userId / adminId / amount / outcome ever;
 *  - limits are measured on the TRIMMED text, exactly like `z.string().trim().min(1).max(n)`;
 *  - nothing is derived from `decision.execution` / `proposals[].execution` (a constant lie) or from `ledger.result`.
 */
import type { ApprovalInput, AssessmentInput, ClaimInput, FindingInput, IssueInput, RequestMoreInput, ShareInput, TransitionInput } from "../disputeCaseApi";
import type { DisputeErrorView } from "../disputeCaseErrors";
import { FINDING_CONSEQUENCE, FINDING_LABEL, OUTCOME_LABEL, isTerminalStatus, manualTransitions } from "../disputeCaseLabels";
import type {
  CaseStatus,
  ClaimMove,
  ClaimResult,
  ClaimantRole,
  DisputeCaseDetail,
  DisputeEvidence,
  DisputeProposal,
  DisputeStatement,
  FindingKind,
  PtLateFinding,
  ShareRole,
} from "../disputeCaseTypes";
import { CLAIM_MOVES, CLAIM_RESULTS, CLAIMANT_ROLES, CLASSIFIABLE_TYPES, FINDING_KINDS, PT_LATE_FINDINGS } from "../disputeCaseTypes";
import { buildEvidenceGroups } from "../workspace/evidenceModel";
import { shortRef } from "../workspace/format";
import { FINDING_TO_OUTCOME, blockedText, latestFinding, outcomeConsequence } from "../workspace/workspaceModel";
import {
  CANNOT_APPROVE_INVESTIGATOR,
  CANNOT_APPROVE_PROPOSER,
  FIELD_FALLBACK,
  NOT_INVESTIGATOR_PREFIX,
  NO_INVESTIGATOR_LINE,
  REQUIRED,
  TERMINAL_LINE,
  tooLong,
} from "./actionText";

// ───────────────────────────────────────────────────────────── limits ──
/** schemas.ts, one entry per text field. */
export const LIMITS = {
  investigatorId: 64,
  transitionReason: 2000,
  transitionNote: 2000,
  requestMoreNote: 2000,
  claimText: 4000,
  issueNote: 4000,
  assessmentNote: 4000,
  assessmentReasoning: 8000,
  findingReasoning: 8000,
  proposalNote: 2000,
  approvalReason: 4000,
  ackNote: 2000,
  shareReason: 2000,
  groupMax: 100,
  movesMax: 3,
} as const;

// ───────────────────────────────────────────────────────── permissions ──
export const CLAIM_PHASE: readonly CaseStatus[] = ["COLLECTING", "AWAITING_PARTIES", "ASSESSING", "TECH_RECONCILIATION", "POLICY_PENDING"];
export const REQUEST_MORE_FROM: readonly CaseStatus[] = ["ASSESSING", "TECH_RECONCILIATION", "POLICY_PENDING"];

export const sameId = (a: string | null | undefined, b: string | null | undefined): boolean => !!a && !!b && a === b;

export function isInvestigator(detail: Pick<DisputeCaseDetail, "case">, userId: string | null | undefined): boolean {
  return sameId(detail.case?.investigatorId, userId);
}

export function newestProposal(proposals: DisputeProposal[] | null | undefined): DisputeProposal | null {
  const list = [...(proposals ?? [])];
  if (list.length === 0) return null;
  return list.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || (a.id < b.id ? 1 : -1))[0];
}

export interface Availability {
  signedIn: boolean;
  terminal: boolean;
  investigator: boolean;
  assign: boolean;
  recollect: boolean;
  transition: boolean;
  requestMore: boolean;
  classify: boolean;
  addClaim: boolean;
  addIssue: boolean;
  assess: boolean;
  recordFinding: boolean;
  propose: boolean;
  ack: boolean;
  share: boolean;
  decide: boolean;
}

/** Which forms to show. Investigator-only forms need `case.investigatorId === currentUserId`; the server re-checks every one. */
export function availability(detail: DisputeCaseDetail, userId: string | null | undefined): Availability {
  const c = detail.case;
  const status = c?.status as CaseStatus | undefined;
  const signedIn = !!userId;
  const terminal = !status || isTerminalStatus(status);
  const inv = signedIn && isInvestigator(detail, userId);
  const live = signedIn && !terminal;
  const proposal = newestProposal(detail.proposals);
  return {
    signedIn,
    terminal,
    investigator: inv,
    assign: live,
    recollect: live,
    transition: live && !!status && manualTransitions(status).length > 0 && (status === "INTAKE" || inv),
    requestMore: inv && !!status && REQUEST_MORE_FROM.includes(status),
    classify: inv && !terminal && c?.type === "LEGACY_UNCLASSIFIED",
    addClaim: inv && !!status && CLAIM_PHASE.includes(status),
    addIssue: inv && !!status && CLAIM_PHASE.includes(status),
    assess: inv && status === "ASSESSING" && (detail.claims ?? []).length > 0,
    recordFinding: inv && status === "ASSESSING",
    propose: inv && status === "FINDING_RECORDED",
    ack: inv && status === "AWAITING_APPROVAL" && !!proposal,
    share: inv && !!status && status !== "INTAKE" && !terminal,
    decide: signedIn && status === "AWAITING_APPROVAL" && !!proposal && !sameId(proposal.proposerId, userId) && !sameId(c?.investigatorId, userId),
  };
}

/** The muted line for someone who may not run the investigator-only forms. `null` = they may (or nothing to say). */
export function investigatorOnlyLine(detail: DisputeCaseDetail, userId: string | null | undefined): string | null {
  const a = availability(detail, userId);
  if (a.terminal) return TERMINAL_LINE;
  if (a.investigator) return null;
  const inv = detail.case?.investigatorId ?? null;
  if (!inv) return NO_INVESTIGATOR_LINE;
  return `${NOT_INVESTIGATOR_PREFIX} (mã ${shortRef(inv)}). Máy chủ vẫn kiểm lại từng thao tác.`;
}

export interface DecideGate {
  show: boolean;
  /** why the decide buttons are hidden (shown as a muted line) */
  reason: string | null;
}
export function decideGate(detail: DisputeCaseDetail, userId: string | null | undefined): DecideGate {
  if (detail.case?.status !== "AWAITING_APPROVAL") return { show: false, reason: null };
  const p = newestProposal(detail.proposals);
  if (!p) return { show: false, reason: null };
  if (!userId) return { show: false, reason: null };
  if (sameId(p.proposerId, userId)) return { show: false, reason: CANNOT_APPROVE_PROPOSER };
  if (sameId(detail.case.investigatorId, userId)) return { show: false, reason: CANNOT_APPROVE_INVESTIGATOR };
  return { show: true, reason: null };
}

// ──────────────────────────────────────────────────────────── validators ──
export type Errors = Record<string, string>;
const len = (s: string) => s.trim().length;

export function textError(value: string, max: number, required = true): string | null {
  const n = len(value);
  if (n === 0) return required ? REQUIRED : null;
  if (n > max) return tooLong(max, n);
  return null;
}
function put(errors: Errors, key: string, message: string | null) {
  if (message) errors[key] = message;
}
export const hasErrors = (e: Errors) => Object.keys(e).length > 0;

export interface AssignForm {
  /** empty = take the case yourself */
  investigatorId: string;
}
export function validateAssign(f: AssignForm): Errors {
  const e: Errors = {};
  if (f.investigatorId.trim().length > LIMITS.investigatorId) e.investigatorId = tooLong(LIMITS.investigatorId, f.investigatorId.trim().length);
  return e;
}
/** The target id is always an entry of the real ADMIN list or empty (= self); never typed. */
export function assignBody(f: AssignForm): { investigatorId?: string } {
  const id = f.investigatorId.trim();
  return id ? { investigatorId: id } : {};
}

export interface TransitionForm {
  to: TransitionInput["to"] | "";
  reason: string;
  note: string;
}
export const transitionNeedsReason = (to: string) => to === "REJECTED_INTAKE";
export function validateTransition(f: TransitionForm, status: CaseStatus): Errors {
  const e: Errors = {};
  if (!f.to) e.to = "Chọn bước muốn chuyển tới.";
  else if (!manualTransitions(status).includes(f.to as CaseStatus)) e.to = "Hồ sơ không chuyển được tới bước này từ trạng thái hiện tại.";
  if (transitionNeedsReason(f.to)) put(e, "reason", textError(f.reason, LIMITS.transitionReason, true));
  else put(e, "note", textError(f.note, LIMITS.transitionNote, false));
  return e;
}
/** `reason` only for a rejection (required there); `note` only otherwise. */
export function transitionBody(f: TransitionForm): TransitionInput {
  const to = f.to as TransitionInput["to"];
  if (transitionNeedsReason(to)) return { to, reason: f.reason.trim() };
  const note = f.note.trim();
  return note ? { to, note } : { to };
}

export interface RequestMoreForm {
  to: "COLLECTING" | "AWAITING_PARTIES";
  note: string;
}
export function validateRequestMore(f: RequestMoreForm): Errors {
  const e: Errors = {};
  put(e, "note", textError(f.note, LIMITS.requestMoreNote, true));
  return e;
}
export const requestMoreBody = (f: RequestMoreForm): RequestMoreInput => ({ to: f.to, note: f.note.trim() });

export function validateClassify(type: string): Errors {
  return (CLASSIFIABLE_TYPES as readonly string[]).includes(type) ? {} : { type: "Chọn loại khiếu nại." };
}

export interface ClaimForm {
  claimantRole: ClaimantRole | "";
  text: string;
  moves: ClaimMove[];
}
export function validateClaim(f: ClaimForm): Errors {
  const e: Errors = {};
  if (!(CLAIMANT_ROLES as readonly string[]).includes(f.claimantRole)) e.claimantRole = "Chọn bên đưa ra khẳng định.";
  put(e, "text", textError(f.text, LIMITS.claimText, true));
  if (f.moves.length > LIMITS.movesMax) e.moves = "Tối đa 3 nội dung.";
  if (f.moves.some((m) => !(CLAIM_MOVES as readonly string[]).includes(m))) e.moves = "Nội dung không hợp lệ.";
  return e;
}
export const claimBody = (f: ClaimForm): ClaimInput => ({ claimantRole: f.claimantRole as ClaimantRole, text: f.text.trim(), moves: [...new Set(f.moves)] });

export interface IssueForm {
  finding: PtLateFinding | "";
  note: string;
}
export function validateIssue(f: IssueForm): Errors {
  const e: Errors = {};
  if (!(PT_LATE_FINDINGS as readonly string[]).includes(f.finding)) e.finding = "Chọn một kết quả.";
  put(e, "note", textError(f.note, LIMITS.issueNote, false));
  return e;
}
export function issueBody(f: IssueForm): IssueInput {
  const note = f.note.trim();
  return note ? { finding: f.finding as PtLateFinding, note } : { finding: f.finding as PtLateFinding };
}

// ───────────────────────────────────────────────── evidence assessment ──
export type EvidenceGroupKey = "direct" | "indirect" | "rebuttal";
export const EVIDENCE_GROUP_LABEL: Record<EvidenceGroupKey | "none", string> = {
  none: "Không dùng",
  direct: "Trực tiếp",
  indirect: "Gián tiếp",
  rebuttal: "Phản bác",
};
/** evidence id -> the ONE group it sits in (absent = not used). One value per id, so an id can not be in two groups. */
export type GroupAssignment = Record<string, EvidenceGroupKey>;

export function splitGroups(a: GroupAssignment): { direct: string[]; indirect: string[]; rebuttal: string[] } {
  const out = { direct: [] as string[], indirect: [] as string[], rebuttal: [] as string[] };
  for (const [id, g] of Object.entries(a)) if (g === "direct" || g === "indirect" || g === "rebuttal") out[g].push(id);
  return out;
}
/** The first id found in two groups, or null. Used on the final body as a belt-and-braces check of the UI invariant. */
export function duplicatedEvidenceId(direct: string[], indirect: string[], rebuttal: string[]): string | null {
  const seen = new Set<string>();
  for (const id of [...direct, ...indirect, ...rebuttal]) {
    if (seen.has(id)) return id;
    seen.add(id);
  }
  return null;
}

export interface AssessmentForm {
  claimId: string;
  groups: GroupAssignment;
  relevanceNote: string;
  verifiabilityNote: string;
  consistencyNote: string;
  result: ClaimResult | "";
  reasoning: string;
}
export function validateAssessment(f: AssessmentForm, claimIds: readonly string[]): Errors {
  const e: Errors = {};
  if (!f.claimId || !claimIds.includes(f.claimId)) e.claimId = "Chọn khẳng định cần đánh giá.";
  const g = splitGroups(f.groups);
  for (const k of ["direct", "indirect", "rebuttal"] as const) if (g[k].length > LIMITS.groupMax) e.groups = "Mỗi nhóm tối đa 100 bằng chứng.";
  if (duplicatedEvidenceId(g.direct, g.indirect, g.rebuttal)) e.groups = "Một bằng chứng chỉ được ở một nhóm.";
  put(e, "relevanceNote", textError(f.relevanceNote, LIMITS.assessmentNote, true));
  put(e, "verifiabilityNote", textError(f.verifiabilityNote, LIMITS.assessmentNote, true));
  put(e, "consistencyNote", textError(f.consistencyNote, LIMITS.assessmentNote, true));
  if (!(CLAIM_RESULTS as readonly string[]).includes(f.result)) e.result = "Chọn kết quả đánh giá.";
  put(e, "reasoning", textError(f.reasoning, LIMITS.assessmentReasoning, true));
  return e;
}
export function assessmentBody(f: AssessmentForm): AssessmentInput {
  const g = splitGroups(f.groups);
  return {
    claimId: f.claimId,
    directEvidenceIds: g.direct,
    indirectEvidenceIds: g.indirect,
    rebuttalEvidenceIds: g.rebuttal,
    relevanceNote: f.relevanceNote.trim(),
    verifiabilityNote: f.verifiabilityNote.trim(),
    consistencyNote: f.consistencyNote.trim(),
    result: f.result as ClaimResult,
    reasoning: f.reasoning.trim(),
  };
}

export interface EvidenceChoice {
  id: string;
  label: string;
  unreadable: boolean;
}
/** The evidence an assessment can cite: the current row of every slot (older versions are history). */
export function evidenceChoices(detail: Pick<DisputeCaseDetail, "evidence">): EvidenceChoice[] {
  const out: EvidenceChoice[] = [];
  for (const g of buildEvidenceGroups(detail.evidence)) {
    for (const item of g.items) {
      const e = item.current;
      const unreadable = e.provenanceType === "TECH_GAP" || e.captureStatus === "UNAVAILABLE" || e.captureStatus === "TECH_GAP_SUSPECTED";
      out.push({ id: e.id, label: `${g.title}: ${item.title} (mã ${shortRef(e.id)})${unreadable ? " - không đọc được nguồn" : ""}`, unreadable });
    }
  }
  return out;
}

/** Claims that still have no assessment (the server refuses a finding while any exists, except NOT_A_DISPUTE). */
export function unassessedClaims(detail: Pick<DisputeCaseDetail, "claims" | "assessments">) {
  const done = new Set((detail.assessments ?? []).map((a) => a.claimId));
  return (detail.claims ?? []).filter((c) => !done.has(c.id));
}

// ───────────────────────────────────────────────────────── findings ──
export interface FindingForm {
  finding: FindingKind | "";
  reasoning: string;
}
export function validateFinding(f: FindingForm): Errors {
  const e: Errors = {};
  if (!(FINDING_KINDS as readonly string[]).includes(f.finding)) e.finding = "Chọn một kết luận.";
  put(e, "reasoning", textError(f.reasoning, LIMITS.findingReasoning, true));
  return e;
}
export const findingBody = (f: FindingForm): FindingInput => ({ finding: f.finding as FindingKind, reasoning: f.reasoning.trim() });

export interface ConsequenceView {
  finding: FindingKind;
  outcomeLabel: string;
  consequence: string;
  /** false = no proposal can follow this finding */
  proposalPossible: boolean;
}
/** The consequence shown with the selected finding (illustration; the server recomputes at proposal time). */
export function consequenceFor(finding: FindingKind): ConsequenceView {
  const o = FINDING_TO_OUTCOME[finding];
  return {
    finding,
    outcomeLabel: o ? OUTCOME_LABEL[o] : "Chưa có kết quả",
    consequence: FINDING_CONSEQUENCE[finding],
    proposalPossible: o !== null,
  };
}

export interface ProposalForm {
  note: string;
}
export function validateProposal(f: ProposalForm): Errors {
  const e: Errors = {};
  put(e, "note", textError(f.note, LIMITS.proposalNote, false));
  return e;
}
/** Note only. No outcome, no amount. */
export function proposalBody(f: ProposalForm): { note?: string } {
  const note = f.note.trim();
  return note ? { note } : {};
}

// ───────────────────────────────────────────────────────── approvals ──
export interface ApprovalForm {
  result: "APPROVED" | "REJECTED";
  reason: string;
  coi: boolean;
  evidenceChangeAcknowledged: boolean;
}
export function validateApproval(f: ApprovalForm): Errors {
  const e: Errors = {};
  put(e, "reason", textError(f.reason, LIMITS.approvalReason, true));
  if (!f.coi) e.conflictOfInterestDeclaredNone = "Cần tích khai báo không có xung đột lợi ích.";
  return e;
}
export function approvalBody(f: ApprovalForm): ApprovalInput {
  return {
    result: f.result,
    reason: f.reason.trim(),
    conflictOfInterestDeclaredNone: f.coi === true,
    evidenceChangeAcknowledged: f.evidenceChangeAcknowledged === true,
  };
}

export interface ApprovalSummary {
  findingTitle: string;
  findingReasoning: string | null;
  outcomeTitle: string;
  consequence: string;
  /** the "will be approved but can not be executed yet" sentence, from the proposal's own blocked reason */
  blocked: string | null;
  proposerRef: string;
}
/** Read-only summary of what the approver is deciding. Nothing here is editable. */
export function approvalSummary(detail: DisputeCaseDetail): ApprovalSummary | null {
  const p = newestProposal(detail.proposals);
  if (!p) return null;
  const finding = (detail.findings ?? []).find((f) => f.id === p.findingId) ?? latestFinding(detail.findings);
  return {
    findingTitle: finding ? findingTitleOf(finding.finding) : "Kết luận không còn trong hồ sơ",
    findingReasoning: finding?.reasoning ?? null,
    outcomeTitle: OUTCOME_LABEL[p.outcome] ?? "Kết quả khác",
    consequence: outcomeConsequence(p.outcome),
    blocked: p.executionBlockedReason ? blockedText(p.executionBlockedReason, false) : null,
    proposerRef: shortRef(p.proposerId),
  };
}
const findingTitleOf = (f: string) => (f in FINDING_LABEL ? FINDING_LABEL[f as FindingKind] : "Kết luận khác");

/** The two branches of EVIDENCE_CHANGED (handoff M3). */
export type EvidenceChangeBranch = "recollect" | "acknowledge";
export function evidenceChangeBranch(view: DisputeErrorView | null | undefined): EvidenceChangeBranch | null {
  if (!view || view.code !== "EVIDENCE_CHANGED" || !view.evidenceChange) return null;
  return view.evidenceChange.needsRecollect || view.evidenceChange.staleLive.length > 0 ? "recollect" : "acknowledge";
}

// ───────────────────────────────────────────────────────── ack (A15) ──
export function validateAck(note: string): Errors {
  const e: Errors = {};
  put(e, "note", textError(note, LIMITS.ackNote, true));
  return e;
}

// ───────────────────────────────────────────────────────────── share ──
export interface ShareFormState {
  targetId: string;
  role: ShareRole | "";
  reason: string;
}
export function validateShare(f: ShareFormState, allowedIds: readonly string[]): Errors {
  const e: Errors = {};
  if (!f.targetId || !allowedIds.includes(f.targetId)) e.target = "Chọn mục cần chia sẻ.";
  if (f.role !== "CLIENT" && f.role !== "PT") e.sharedWithRole = "Chọn bên nhận.";
  put(e, "reason", textError(f.reason, LIMITS.shareReason, true));
  return e;
}
/** Exactly one of evidenceId / statementId. */
export function shareBody(kind: "evidence" | "statement", f: ShareFormState): ShareInput {
  const base = { sharedWithRole: f.role as ShareRole, reason: f.reason.trim() };
  return kind === "evidence" ? { ...base, evidenceId: f.targetId } : { ...base, statementId: f.targetId };
}

/**
 * Mirror of `shareRefusalReason` (user-service rules.ts): a row that the server would refuse is never offered.
 * Party-submitted, not (SERVER_VERIFIED | NOT_APPLICABLE), or sensitivity other than NORMAL -> not shareable.
 * Also not offered: a row whose source could not be read (sharing "we could not read it" proves nothing).
 */
export function isShareableEvidence(e: Pick<DisputeEvidence, "partySubmitted" | "verificationStatus" | "sensitivity" | "captureStatus" | "provenanceType">): boolean {
  if (e.partySubmitted) return false;
  if (e.verificationStatus !== "SERVER_VERIFIED" && e.verificationStatus !== "NOT_APPLICABLE") return false;
  if (e.sensitivity !== "NORMAL") return false;
  if (e.captureStatus !== "OK" || e.provenanceType === "TECH_GAP") return false;
  return true;
}
export interface ShareChoice {
  id: string;
  label: string;
}
export function shareableEvidenceChoices(detail: Pick<DisputeCaseDetail, "evidence">): ShareChoice[] {
  const out: ShareChoice[] = [];
  for (const g of buildEvidenceGroups(detail.evidence)) {
    for (const item of g.items) {
      if (isShareableEvidence(item.current)) out.push({ id: item.current.id, label: `${item.title} (mã ${shortRef(item.current.id)})` });
    }
  }
  return out;
}
const PARTY_TEXT: Record<string, string> = { CLIENT: "Khách", PT: "PT", ADMIN_ON_BEHALF: "Quản trị viên nhập hộ" };
export function statementChoices(statements: DisputeStatement[] | null | undefined): ShareChoice[] {
  return [...(statements ?? [])]
    .sort((a, b) => (a.partyRole < b.partyRole ? -1 : a.partyRole > b.partyRole ? 1 : b.version - a.version))
    .map((s) => ({ id: s.id, label: `${PARTY_TEXT[s.partyRole] ?? "Bên khác"}, phiên bản ${s.version} (mã ${shortRef(s.id)})` }));
}

// ─────────────────────────────────────────────────── server field errors ──
const VIETNAMESE = /[àáâãăạảấầẩẫậắằẳẵặèéêẹẻẽếềểễệìíĩỉịòóôõơọỏốồổỗộớờởỡợùúũưụủứừửữựỳỵỷỹđ]/i;
/** `fields[]` of a 400 INVALID_INPUT -> { firstPathSegment: Vietnamese message }. English Zod text is never shown. */
export function fieldErrorsFromView(view: DisputeErrorView | null | undefined): Errors {
  const out: Errors = {};
  for (const f of view?.fields ?? []) {
    const key = String(f.path ?? "").split(".")[0] || "_";
    if (out[key]) continue;
    out[key] = f.message && VIETNAMESE.test(f.message) ? f.message : FIELD_FALLBACK;
  }
  return out;
}

// ───────────────────────────────────────────────────── admin directory ──
export interface AdminOption {
  id: string;
  label: string;
}
/**
 * `GET /admin/users?role=ADMIN` -> `{ success, data: { users: [{ id, name, email, role, status }] } }` (gateway shape).
 * Only real, active ADMIN rows; the signed-in admin is left out (they use "Nhận cho mình"). Anything malformed -> [].
 */
export function parseAdminOptions(raw: unknown, selfId: string | null | undefined): AdminOption[] {
  const root = raw as { data?: { users?: unknown }; users?: unknown } | null;
  const users = root?.data?.users ?? root?.users;
  if (!Array.isArray(users)) return [];
  const out: AdminOption[] = [];
  const seen = new Set<string>();
  for (const u of users) {
    const r = u as { id?: unknown; name?: unknown; email?: unknown; role?: unknown; status?: unknown } | null;
    if (!r || typeof r.id !== "string" || !r.id || r.id.length > LIMITS.investigatorId || seen.has(r.id)) continue;
    if (r.id === selfId) continue;
    if (r.role !== "Admin" && r.role !== "ADMIN") continue;
    if (r.status === "Inactive") continue;
    seen.add(r.id);
    const name = typeof r.name === "string" && r.name.trim() ? r.name.trim() : "Quản trị viên";
    const email = typeof r.email === "string" && r.email.trim() ? ` (${r.email.trim()})` : "";
    out.push({ id: r.id, label: `${name}${email}` });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label, "vi"));
}
