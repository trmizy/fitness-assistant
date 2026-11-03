/**
 * Dispute V2.1 admin UI (D1) - typed client for A1-A18 (admin Case Workspace) and B1-B4 (party side), on the app's `api` axios instance.
 *
 * Rules enforced HERE (not left to callers):
 *  - every write requires an `idempotencyKey` and sends it as the `Idempotency-Key` header (checked against the server regex);
 *  - bodies are built by picking the documented fields one by one, so a stray `userId` / `adminId` / `amount` / `outcome`
 *    on a caller's object can never reach the wire (the server is `.strict()` and would answer 400 anyway);
 *  - no function takes the actor's id: identity comes from the token. `investigatorId` of `assign` is the TARGET of the action;
 *  - nothing is retried here; a failed write is the caller's decision (see useIdempotentAction + disputeCaseErrors).
 *
 * NOT built on purpose (flag-off or not proxied by the gateway; ask the backend, do not guess):
 *  - A19  GET  /admin/dispute-cases/:id/evidence/:evidenceId/file  - evidence-storage flag OFF outside tests (R-02).
 *  - A20  POST /admin/dispute-cases/:id/execute                    - execution flag OFF outside tests; API returns no execStatus (R-01, R-02).
 *  - A21  POST /admin/dispute-cases/:id/reconcile-execution        - same flag (R-01, R-02).
 *  - B5   POST /dispute-cases/:id/evidence-files                   - evidence-storage flag OFF (R-02).
 *  - B6   GET  /dispute-cases/:id/evidence/:evidenceId/file        - same flag (R-02).
 *  - D1-D11 /admin/late-open-reconciliations                       - gateway does not proxy it (R-11) and the writes are flag-off (R-02).
 *  - Review-list for D-NEW-12 policy reviews (R-03): A16/A17 exist, but nothing reads reviews back.
 * C1 (`listDisputedSessions`) and C3 (`resolveSessionDispute`) are re-exported unchanged from `adminService`.
 */
import { adminService, api } from "../../../services/api";
import type {
  AckEvidenceChangeResult,
  AssignResult,
  ClassifiableType,
  ClaimMove,
  ClaimantRole,
  ClaimResult,
  CreatedId,
  DecideResult,
  DisputeCaseDetail,
  ListCasesQuery,
  ListCasesResult,
  MoveResult,
  OpenCaseResult,
  PartyCaseDetail,
  PartyCaseList,
  PolicyResult,
  PolicyReviewResult,
  PtLateFinding,
  FindingKind,
  ProposalCreated,
  ProposalPolicyPending,
  ProposeResult,
  RecollectResult,
  RecordFindingResult,
  ShareRole,
  StatementCreated,
} from "./disputeCaseTypes";

// ───────────────────────────────────────────────────────────── transport ──
/** The slice of an axios instance this client uses (lets tests pass a fake). */
export interface DisputeHttpClient {
  request<T = unknown>(config: {
    method: "GET" | "POST";
    url: string;
    data?: unknown;
    params?: Record<string, unknown>;
    headers?: Record<string, string>;
    timeout?: number;
  }): Promise<{ data: T; status: number }>;
}

export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;

/** The default 10 s axios timeout is shorter than a ledger read (10 s per money step) + external evidence collection. */
const SLOW_MS = 40_000;

function assertKey(key: string): string {
  if (typeof key !== "string" || !IDEMPOTENCY_KEY_PATTERN.test(key)) throw new Error("INVALID_IDEMPOTENCY_KEY");
  return key;
}

// ─────────────────────────────────────────────────────────── body shapes ──
// Exactly the fields of schemas.ts. Anything else is not accepted by the type AND not copied at runtime.
export interface TransitionInput {
  to: "COLLECTING" | "AWAITING_PARTIES" | "ASSESSING" | "TECH_RECONCILIATION" | "REJECTED_INTAKE";
  reason?: string;
  note?: string;
}
export interface RequestMoreInput {
  to?: "COLLECTING" | "AWAITING_PARTIES";
  note: string;
}
export interface ClaimInput {
  claimantRole: ClaimantRole;
  text: string;
  moves?: ClaimMove[];
}
export interface IssueInput {
  finding: PtLateFinding;
  note?: string;
}
export interface AssessmentInput {
  claimId: string;
  directEvidenceIds?: string[];
  indirectEvidenceIds?: string[];
  rebuttalEvidenceIds?: string[];
  relevanceNote: string;
  verifiabilityNote: string;
  consistencyNote: string;
  result: ClaimResult;
  reasoning: string;
}
export interface FindingInput {
  finding: FindingKind;
  reasoning: string;
}
export interface ApprovalInput {
  result: "APPROVED" | "REJECTED";
  reason: string;
  conflictOfInterestDeclaredNone: boolean;
  evidenceChangeAcknowledged?: boolean;
}
export interface PolicyEligibilityInput {
  result: PolicyResult;
  evidenceIds: string[];
  reasoning: string;
  supersedesId?: string;
}
export interface PolicyApproveInput {
  reason: string;
  conflictOfInterestDeclaredNone: boolean;
}
export type ShareInput = { sharedWithRole: ShareRole; reason: string } & ({ evidenceId: string; statementId?: never } | { statementId: string; evidenceId?: never });
export interface StatementInput {
  text: string;
  supplementReason?: string;
}
export interface PartyEvidenceInput {
  description: string;
  sha256: string;
  title?: string;
  fileName?: string;
}

/** Drops `undefined` so optional fields are simply absent on the wire. */
function compact<T extends Record<string, unknown>>(o: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v;
  return out as T;
}

const enc = (id: string) => encodeURIComponent(id);

// ─────────────────────────────────────────────────────────────── factory ──
export function createDisputeCaseApi(client: DisputeHttpClient) {
  const get = async <T>(url: string, params?: Record<string, unknown>, timeout?: number): Promise<T> =>
    (await client.request<T>({ method: "GET", url, params, timeout })).data;

  const post = async <T>(url: string, body: Record<string, unknown>, idempotencyKey: string, timeout?: number) =>
    client.request<T>({ method: "POST", url, data: body, headers: { "Idempotency-Key": assertKey(idempotencyKey) }, timeout });

  const postData = async <T>(url: string, body: Record<string, unknown>, idempotencyKey: string, timeout?: number): Promise<T> =>
    (await post<T>(url, body, idempotencyKey, timeout)).data;

  const A = "/admin/dispute-cases";

  return {
    // ── A: admin Case Workspace ──
    /** A1. 201 created / 200 existing open case (`created:false`). */
    openCase: (sessionId: string, idempotencyKey: string) =>
      postData<OpenCaseResult>(A, { sessionId }, idempotencyKey, SLOW_MS),
    /** A2. Every call writes an access-log row per returned case: never poll. */
    listCases: (query: ListCasesQuery = {}) =>
      get<ListCasesResult>(A, compact({ status: query.status, limit: query.limit, offset: query.offset })),
    /** A3. Calls the ledger for every money step (slow). */
    getCase: (caseId: string) => get<DisputeCaseDetail>(`${A}/${enc(caseId)}`, undefined, SLOW_MS),
    /** A4. `investigatorId` is the only target id; omit it to take the case yourself. */
    assign: (caseId: string, input: { investigatorId?: string }, idempotencyKey: string) =>
      postData<AssignResult>(`${A}/${enc(caseId)}/assign`, compact({ investigatorId: input.investigatorId }), idempotencyKey),
    /** A5. Re-collects the evidence sources. */
    recollect: (caseId: string, idempotencyKey: string) =>
      postData<RecollectResult>(`${A}/${enc(caseId)}/recollect`, {}, idempotencyKey, SLOW_MS),
    /** A6. */
    transition: (caseId: string, input: TransitionInput, idempotencyKey: string) =>
      postData<MoveResult>(`${A}/${enc(caseId)}/transition`, compact({ to: input.to, reason: input.reason, note: input.note }), idempotencyKey),
    /** A7. */
    requestMore: (caseId: string, input: RequestMoreInput, idempotencyKey: string) =>
      postData<MoveResult>(`${A}/${enc(caseId)}/request-more`, compact({ to: input.to, note: input.note }), idempotencyKey),
    /** A8. */
    classify: (caseId: string, type: ClassifiableType, idempotencyKey: string) =>
      postData<MoveResult>(`${A}/${enc(caseId)}/classify`, { type }, idempotencyKey),
    /** A9. */
    addClaim: (caseId: string, input: ClaimInput, idempotencyKey: string) =>
      postData<CreatedId>(`${A}/${enc(caseId)}/claims`, compact({ claimantRole: input.claimantRole, text: input.text, moves: input.moves }), idempotencyKey),
    /** A10. Only a note: it starts no money step. */
    addIssue: (caseId: string, input: IssueInput, idempotencyKey: string) =>
      postData<CreatedId>(`${A}/${enc(caseId)}/issues`, compact({ kind: "PT_LATE", finding: input.finding, note: input.note }), idempotencyKey),
    /** A11. */
    addAssessment: (caseId: string, input: AssessmentInput, idempotencyKey: string) =>
      postData<CreatedId>(
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
        idempotencyKey,
      ),
    /** A12. The outcome is computed by the server from the finding. */
    recordFinding: (caseId: string, input: FindingInput, idempotencyKey: string) =>
      postData<RecordFindingResult>(`${A}/${enc(caseId)}/findings`, { finding: input.finding, reasoning: input.reasoning }, idempotencyKey),
    /**
     * A13. HTTP 201 in BOTH cases. No outcome / amount is sent. `execution` of the answer (a hard-coded constant, F3) is dropped here.
     * POLICY_PENDING = no proposal exists (cancel on a session with a late-arrival compensation); the case moved to POLICY_PENDING.
     */
    propose: async (caseId: string, input: { note?: string }, idempotencyKey: string): Promise<ProposeResult> => {
      const raw = await postData<Record<string, unknown>>(`${A}/${enc(caseId)}/proposals`, compact({ note: input.note }), idempotencyKey, SLOW_MS);
      if (raw && raw.policyPending === true) {
        return {
          kind: "POLICY_PENDING",
          policyPending: {
            blocked: raw.blocked as ProposalPolicyPending["blocked"],
            caseStatus: raw.caseStatus as ProposalPolicyPending["caseStatus"],
            reason: String(raw.reason ?? ""),
            nextStep: String(raw.nextStep ?? ""),
          },
        };
      }
      return {
        kind: "PROPOSED",
        proposal: {
          id: raw.id as string,
          outcome: raw.outcome as ProposalCreated["outcome"],
          executionBlockedReason: (raw.executionBlockedReason ?? null) as ProposalCreated["executionBlockedReason"],
          caseStatus: raw.caseStatus as ProposalCreated["caseStatus"],
        },
      };
    },
    /** A14. Four-eyes: the server re-checks the approver. */
    decide: async (caseId: string, input: ApprovalInput, idempotencyKey: string): Promise<DecideResult> => {
      const raw = await postData<Record<string, unknown>>(
        `${A}/${enc(caseId)}/approvals`,
        compact({
          result: input.result,
          reason: input.reason,
          conflictOfInterestDeclaredNone: input.conflictOfInterestDeclaredNone,
          evidenceChangeAcknowledged: input.evidenceChangeAcknowledged,
        }),
        idempotencyKey,
      );
      // `execution` (hard-coded constant, F3) is dropped on purpose.
      return {
        approvalId: raw.approvalId as string,
        result: raw.result as DecideResult["result"],
        caseStatus: raw.caseStatus as DecideResult["caseStatus"],
        outcome: raw.outcome as DecideResult["outcome"],
        ...(raw.executionBlockedReason !== undefined ? { executionBlockedReason: raw.executionBlockedReason as DecideResult["executionBlockedReason"] } : {}),
      };
    },
    /** A15. */
    acknowledgeEvidenceChange: (caseId: string, input: { note: string }, idempotencyKey: string) =>
      postData<AckEvidenceChangeResult>(`${A}/${enc(caseId)}/evidence-change-ack`, { note: input.note }, idempotencyKey),
    /** A16. HTTP 200. Keep `reviewId` from the answer: no route reads reviews back (R-03). */
    proposePolicyEligibility: (caseId: string, input: PolicyEligibilityInput, idempotencyKey: string) =>
      postData<PolicyReviewResult>(
        `${A}/${enc(caseId)}/policy-eligibility`,
        compact({ result: input.result, evidenceIds: input.evidenceIds, reasoning: input.reasoning, supersedesId: input.supersedesId }),
        idempotencyKey,
      ),
    /** A17. */
    approvePolicyEligibility: (caseId: string, reviewId: string, input: PolicyApproveInput, idempotencyKey: string) =>
      postData<PolicyReviewResult>(
        `${A}/${enc(caseId)}/policy-eligibility/${enc(reviewId)}/approve`,
        { reason: input.reason, conflictOfInterestDeclaredNone: input.conflictOfInterestDeclaredNone },
        idempotencyKey,
      ),
    /** A18. Exactly one of evidenceId / statementId. */
    share: (caseId: string, input: ShareInput, idempotencyKey: string) =>
      postData<CreatedId>(
        `${A}/${enc(caseId)}/shares`,
        compact({ evidenceId: input.evidenceId, statementId: input.statementId, sharedWithRole: input.sharedWithRole, reason: input.reason }),
        idempotencyKey,
      ),

    // ── B: party side (client / PT) ──
    /** B1. */
    listMyCases: () => get<PartyCaseList>("/dispute-cases"),
    /** B2. */
    getMyCase: (caseId: string) => get<PartyCaseDetail>(`/dispute-cases/${enc(caseId)}`, undefined, SLOW_MS),
    /** B3. */
    submitStatement: (caseId: string, input: StatementInput, idempotencyKey: string) =>
      postData<StatementCreated>(`/dispute-cases/${enc(caseId)}/statements`, compact({ text: input.text, supplementReason: input.supplementReason }), idempotencyKey),
    /** B4. Metadata only (no file): the sha256 is the party's own claim. */
    submitEvidence: (caseId: string, input: PartyEvidenceInput, idempotencyKey: string) =>
      postData<CreatedId>(
        `/dispute-cases/${enc(caseId)}/evidence`,
        compact({ description: input.description, sha256: input.sha256, title: input.title, fileName: input.fileName }),
        idempotencyKey,
      ),
  };
}

export type DisputeCaseApi = ReturnType<typeof createDisputeCaseApi>;

/** The app instance (token, refresh, session guard, 401 handling all live in `api`'s interceptors). */
export const disputeCaseApi: DisputeCaseApi = createDisputeCaseApi(api as unknown as DisputeHttpClient);

// ── C1 / C3 / C2: the existing legacy routes, unchanged ──
export const listDisputedSessions = adminService.listDisputedSessions;
export const resolveSessionDispute = adminService.resolveSessionDispute;
/** C2 stays `adminService.getSessionsReconciliation` (read-only report). */
