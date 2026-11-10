/**
 * D6 - typed client for the gym complaint-case routes (G1-G23) and the paged old complaint list (H1 + R-18), on the app's `api` axios instance.
 *
 * Rules enforced HERE (same as the D1 client):
 *  - every write that is not `execute`/`reconcile` requires an `idempotencyKey` and sends it as `Idempotency-Key` (validated against the server regex);
 *  - bodies are built by picking the documented fields one by one, so a stray `userId` / `amount` / `outcome` on a caller's object can never reach
 *    the wire (the server is `.strict()` and would answer 400 `INVALID_INPUT`). There is no field for an amount or an outcome at all;
 *  - no function takes the actor's id: identity comes from the token. `investigatorId` of `assign` is the TARGET of the action;
 *  - `execute` and `reconcile` carry no key: the server keys the money step itself (`GYM_CASE_DECISION:<approvalId>`), so a second call can not refund twice;
 *  - nothing is retried here.
 *
 * Gateway paths: `/admin/complaint-cases*`, `/admin/complaints/:id/case`, `/me/complaint-cases*`. Envelope `{ success:true, data }` is unwrapped.
 */
import { api } from "../../../services/api";
import type {
  ComplaintPageMeta,
  GymAckResult,
  GymAssessmentResult,
  GymAssignResult,
  GymCaseClass,
  GymCaseDetail,
  GymCaseList,
  GymCaseStatus,
  GymClaimantRole,
  GymCreatedId,
  GymDecideResult,
  GymExecuteResult,
  GymFinding,
  GymFindingResult,
  GymHistoryPage,
  GymOpenCaseResult,
  GymProposalResult,
  GymReconcileResult,
  GymRecollectResult,
  GymRequestMoreResult,
  GymStatementResult,
  GymTransitionResult,
  MemberCaseDetail,
  MemberCaseList,
  OwnerCaseDetail,
  OwnerCaseList,
  GymCapabilities,
  GymReplacementResult,
  GymAppealReviewerResult,
} from "./gymCaseTypes";
import type { MembershipOption } from "./membershipOptions";

export interface GymHttpClient {
  request<T = unknown>(config: {
    method: "GET" | "POST";
    url: string;
    data?: unknown;
    params?: Record<string, unknown>;
    headers?: Record<string, string>;
    timeout?: number;
  }): Promise<{ data: T; status: number; headers?: Record<string, unknown> }>;
}

export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;
/** `execute` calls payment-service (a refund + a commission clawback): longer than the default 10 s. */
const MONEY_MS = 40_000;

function assertKey(key: string): string {
  if (typeof key !== "string" || !IDEMPOTENCY_KEY_PATTERN.test(key)) throw new Error("INVALID_IDEMPOTENCY_KEY");
  return key;
}

// ── body shapes: exactly the fields of gym-service `schemas.ts` ──
export interface OpenCaseInput {
  caseClass: GymCaseClass;
  membershipId?: string;
}
export interface AssignInput {
  investigatorId?: string;
}
export interface TransitionInput {
  to: "COLLECTING" | "AWAITING_PARTIES" | "ASSESSING" | "REJECTED_INTAKE";
  reason?: string;
}
export interface RequestMoreInput {
  to?: "COLLECTING" | "AWAITING_PARTIES";
  note: string;
}
export interface ClaimInput {
  claimantRole: GymClaimantRole;
  text: string;
}
export interface AssessmentInput {
  claimId: string;
  directEvidenceIds?: string[];
  indirectEvidenceIds?: string[];
  rebuttalEvidenceIds?: string[];
  relevanceNote: string;
  verifiabilityNote: string;
  consistencyNote: string;
  result: GymAssessmentResult;
  reasoning: string;
}
export interface FindingInput {
  finding: GymFinding;
  reasoning: string;
}
export interface DecisionInput {
  result: "APPROVED" | "REJECTED";
  reason: string;
  conflictOfInterestDeclaredNone: boolean;
  evidenceChangeAcknowledged?: boolean;
}
export type ShareInput = { reason: string } & ({ evidenceId: string; statementId?: never } | { statementId: string; evidenceId?: never });
export interface StatementInput {
  text: string;
  supplementReason?: string;
}
export interface DocumentInput {
  description: string;
  sha256: string;
  title?: string;
  fileName?: string;
}

function compact<T extends Record<string, unknown>>(o: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v;
  return out as T;
}
const enc = (id: string) => encodeURIComponent(id);

export interface ComplaintPage<T> {
  items: T[];
  meta: ComplaintPageMeta;
}

export function createGymCaseApi(client: GymHttpClient) {
  const unwrap = <T>(body: unknown): T => {
    const b = body as { success?: boolean; data?: T } | null;
    return (b && typeof b === "object" && "data" in b ? (b as { data: T }).data : (body as T)) as T;
  };
  const get = async <T>(url: string, params?: Record<string, unknown>, timeout?: number): Promise<T> => unwrap<T>((await client.request({ method: "GET", url, params, timeout })).data);
  const post = async <T>(url: string, body: Record<string, unknown>, key: string | null, timeout?: number) => {
    const res = await client.request({ method: "POST", url, data: body, headers: key === null ? undefined : { "Idempotency-Key": assertKey(key) }, timeout });
    return { data: unwrap<T>(res.data), status: res.status };
  };
  const postData = async <T>(url: string, body: Record<string, unknown>, key: string | null, timeout?: number): Promise<T> => (await post<T>(url, body, key, timeout)).data;

  const A = "/admin/complaint-cases";
  const M = "/me/complaint-cases";
  const O = "/owner/complaint-cases";

  return {
    /**
     * G37 `GET /admin/complaint-cases/capabilities`: the gym flags as gym-service itself evaluates them
     * (`{gymCase:{effective, refusedBecause?}, decisionReplacement:{...}, gymParty:{effective:false}}`). The only trusted signal for G1.
     */
    capabilities: () => get<GymCapabilities>(`${A}/capabilities`),

    // ── old complaint list (H1) with the R-18 paging ──
    /**
     * `GET /admin/complaints?status&limit&offset`: with `limit`/`offset` the answer is `{ data:[...], meta:{ total, limit, offset } }`.
     * A malformed value is `400 INVALID_INPUT`, a bad `status` too.
     */
    listComplaintsPage: async <T = unknown>(q: { status?: string; limit: number; offset: number }): Promise<ComplaintPage<T>> => {
      const res = await client.request<{ data?: T[]; meta?: Partial<ComplaintPageMeta> }>({ method: "GET", url: "/admin/complaints", params: compact({ status: q.status, limit: q.limit, offset: q.offset }) });
      const body = res.data as { data?: T[]; meta?: Partial<ComplaintPageMeta> } | T[];
      const items = Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : [];
      const m = Array.isArray(body) ? undefined : body?.meta;
      const headerTotal = Number((res.headers as Record<string, unknown> | undefined)?.["x-total-count"]);
      const total = typeof m?.total === "number" ? m.total : Number.isFinite(headerTotal) ? headerTotal : items.length;
      return { items, meta: { total, limit: typeof m?.limit === "number" ? m.limit : q.limit, offset: typeof m?.offset === "number" ? m.offset : q.offset } };
    },

    // ── G1 ──
    /** 201 `existing:false` / 200 `existing:true` (the complaint already had a case: go there). The class is chosen from a list, the membership from the reporter's. */
    openCase: (complaintId: string, input: OpenCaseInput, key: string) =>
      postData<GymOpenCaseResult>(`/admin/complaints/${enc(complaintId)}/case`, compact({ caseClass: input.caseClass, membershipId: input.membershipId }), key),

    /** INT-15 `GET /admin/complaints/:id/membership-options`: the reporter's memberships at the complaint's gym (newest first; [] when there is no reporter). A read, no key. */
    membershipOptions: async (complaintId: string): Promise<MembershipOption[]> => {
      const d = await get<{ items?: MembershipOption[] } | null>(`/admin/complaints/${enc(complaintId)}/membership-options`);
      return Array.isArray(d?.items) ? d.items : [];
    },

    // ── G2-G4 reads (every call writes access-log rows: never poll) ──
    listCases: (q: { status?: GymCaseStatus; limit?: number; offset?: number } = {}) => get<GymCaseList>(A, compact({ status: q.status, limit: q.limit, offset: q.offset })),
    getCase: (caseId: string) => get<GymCaseDetail>(`${A}/${enc(caseId)}`),
    history: (caseId: string, q: { limit?: number; offset?: number } = {}) => get<GymHistoryPage>(`${A}/${enc(caseId)}/history`, compact({ limit: q.limit, offset: q.offset })),

    // ── G5-G17 investigation and four eyes ──
    assign: (caseId: string, input: AssignInput, key: string) => postData<GymAssignResult>(`${A}/${enc(caseId)}/assign`, compact({ investigatorId: input.investigatorId }), key),
    transition: (caseId: string, input: TransitionInput, key: string) => postData<GymTransitionResult>(`${A}/${enc(caseId)}/transition`, compact({ to: input.to, reason: input.reason }), key),
    requestMore: (caseId: string, input: RequestMoreInput, key: string) => postData<GymRequestMoreResult>(`${A}/${enc(caseId)}/request-more`, compact({ to: input.to, note: input.note }), key),
    recollect: (caseId: string, key: string) => postData<GymRecollectResult>(`${A}/${enc(caseId)}/recollect`, {}, key),
    addClaim: (caseId: string, input: ClaimInput, key: string) => postData<GymCreatedId>(`${A}/${enc(caseId)}/claims`, { claimantRole: input.claimantRole, text: input.text }, key),
    addAssessment: (caseId: string, input: AssessmentInput, key: string) =>
      postData<GymCreatedId>(
        `${A}/${enc(caseId)}/assessments`,
        compact({
          claimId: input.claimId,
          directEvidenceIds: input.directEvidenceIds,
          indirectEvidenceIds: input.indirectEvidenceIds,
          rebuttalEvidenceIds: input.rebuttalEvidenceIds,
          relevanceNote: input.relevanceNote,
          verifiabilityNote: input.verifiabilityNote,
          consistencyNote: input.consistencyNote,
          result: input.result,
          reasoning: input.reasoning,
        }),
        key,
      ),
    /** The outcome is computed by the server from (class, finding). */
    recordFinding: (caseId: string, input: FindingInput, key: string) => postData<GymFindingResult>(`${A}/${enc(caseId)}/finding`, { finding: input.finding, reasoning: input.reasoning }, key),
    /** No outcome, no amount: only an optional note. */
    propose: (caseId: string, input: { note?: string }, key: string) => postData<GymProposalResult>(`${A}/${enc(caseId)}/proposal`, compact({ note: input.note }), key),
    /** Four eyes: the server re-checks the approver. Approving executes nothing. */
    decide: (caseId: string, input: DecisionInput, key: string) =>
      postData<GymDecideResult>(
        `${A}/${enc(caseId)}/decision`,
        compact({ result: input.result, reason: input.reason, conflictOfInterestDeclaredNone: input.conflictOfInterestDeclaredNone, evidenceChangeAcknowledged: input.evidenceChangeAcknowledged }),
        key,
      ),
    acknowledgeEvidenceChange: (caseId: string, input: { note: string }, key: string) => postData<GymAckResult>(`${A}/${enc(caseId)}/ack-evidence-change`, { note: input.note }, key),
    /** Exactly one of evidenceId / statementId. Only the member can receive a share. */
    share: (caseId: string, input: ShareInput, key: string) => postData<GymCreatedId>(`${A}/${enc(caseId)}/shares`, compact({ evidenceId: input.evidenceId, statementId: input.statementId, reason: input.reason }), key),
    statementOnBehalf: (caseId: string, input: StatementInput, key: string) =>
      postData<GymStatementResult>(`${A}/${enc(caseId)}/statements`, compact({ text: input.text, supplementReason: input.supplementReason }), key),
    evidenceOnBehalf: (caseId: string, input: DocumentInput, key: string) =>
      postData<GymCreatedId>(`${A}/${enc(caseId)}/evidence`, compact({ description: input.description, sha256: input.sha256, title: input.title, fileName: input.fileName }), key),

    // ── G18 / G19: the only money exit. No key (the server keys the step), no amount, no reason. ──
    execute: (caseId: string, input: { decisionId?: string } = {}) => postData<GymExecuteResult>(`${A}/${enc(caseId)}/execute`, compact({ decisionId: input.decisionId }), null, MONEY_MS),
    reconcileExecution: (caseId: string) => postData<GymReconcileResult>(`${A}/${enc(caseId)}/reconcile-execution`, {}, null, MONEY_MS),

    // ── G26: Appeal reviewer ──
    assignAppealReviewer: (caseId: string, input: { reviewerId?: string }, key: string) =>
      postData<GymAppealReviewerResult>(`${A}/${enc(caseId)}/appeal/reviewer`, compact({ reviewerId: input.reviewerId }), key),

    // ── G33-G35: Decision replacement ──
    proposeReplacement: (caseId: string, input: { reason: string }, key: string) =>
      postData<GymReplacementResult>(`${A}/${enc(caseId)}/decision-replacement`, { reason: input.reason }, key),
    approveReplacement: (caseId: string, input: { reason: string; conflictOfInterestDeclaredNone: boolean }, key: string) =>
      postData<GymReplacementResult>(`${A}/${enc(caseId)}/decision-replacement/approve`, { reason: input.reason, conflictOfInterestDeclaredNone: input.conflictOfInterestDeclaredNone }, key),
    rejectReplacement: (caseId: string, input: { reason: string }, key: string) =>
      postData<GymReplacementResult>(`${A}/${enc(caseId)}/decision-replacement/reject`, { reason: input.reason }, key),

    // ── member side (G20-G23) ──
    listMine: () => get<MemberCaseList>(M),
    getMine: (caseId: string) => get<MemberCaseDetail>(`${M}/${enc(caseId)}`),
    submitStatement: (caseId: string, input: StatementInput, key: string) =>
      postData<GymStatementResult>(`${M}/${enc(caseId)}/statements`, compact({ text: input.text, supplementReason: input.supplementReason }), key),
    submitEvidence: (caseId: string, input: DocumentInput, key: string) =>
      postData<GymCreatedId>(`${M}/${enc(caseId)}/evidence`, compact({ description: input.description, sha256: input.sha256, title: input.title, fileName: input.fileName }), key),
    // ── gym owner / manager side (C10: reads what it is entitled to; gives an explanation and declares evidence; nothing else) ──
    listOwner: () => get<OwnerCaseList>(O),
    getOwner: (caseId: string) => get<OwnerCaseDetail>(`${O}/${enc(caseId)}`),
    submitOwnerExplanation: (caseId: string, input: StatementInput, key: string) =>
      postData<GymStatementResult>(`${O}/${enc(caseId)}/explanations`, compact({ text: input.text, supplementReason: input.supplementReason }), key),
    submitOwnerEvidence: (caseId: string, input: DocumentInput, key: string) =>
      postData<GymCreatedId>(`${O}/${enc(caseId)}/evidence`, compact({ description: input.description, sha256: input.sha256, title: input.title, fileName: input.fileName }), key),
    submitMemberAppeal: (caseId: string, input: { reason: string }, key: string) =>
      postData<{ appealId?: string; status?: string }>(`${M}/${enc(caseId)}/appeal`, { reason: input.reason }, key),
  };
}

export type GymCaseApi = ReturnType<typeof createGymCaseApi>;

/** The app instance (token, refresh, session guard and 401 handling live in `api`'s interceptors). */
export const gymCaseApi: GymCaseApi = createGymCaseApi(api as unknown as GymHttpClient);
