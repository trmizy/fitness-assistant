/**
 * Dispute V2.1 admin UI (D1, adapted in D5) - typed client of the FINAL contract: A1-A29 (admin Case Workspace), S3, B1-B4 (party side),
 * on the app's `api` axios instance.
 *
 * Rules enforced HERE (not left to callers):
 *  - every write requires an `idempotencyKey` and sends it as the `Idempotency-Key` header (checked against the server regex). The six
 *    row-creating routes (claims, issues, assessments, party statements, party evidence, evidence files) REQUIRE it on the server
 *    (`400 IDEMPOTENCY_KEY_REQUIRED`); the client sends it on every write, so a missing key can never reach the wire;
 *  - bodies are built by picking the documented fields one by one, so a stray `userId` / `adminId` / `amount` / `outcome`
 *    on a caller's object can never reach the wire (the server is `.strict()` and would answer 400 anyway);
 *  - no function takes the actor's id: identity comes from the token. `investigatorId` of `assign` is the TARGET of the action;
 *  - nothing is retried here; a failed write is the caller's decision (see useIdempotentAction + disputeCaseErrors).
 *
 * Routes behind a server flag (execute / reconcile / acknowledge-needs-human) are built here, but the screens show them only
 * when `capabilities` says the flag is effective AND `allowedActions` lists the action.
 * NOT built on purpose: A8 / B5 / B6 evidence files (flag `evidenceStorage`; the web still declares a hash only), D65-B and late-open
 * (other batches). C1 (`listDisputedSessions`) and C3 (`resolveSessionDispute`) are re-exported unchanged from `adminService`.
 */
import { adminService, api } from "../../../services/api";
import type {
  AccessLogResult,
  AckEvidenceChangeResult,
  AckNeedsHumanResult,
  AdminSessionDetail,
  AssignResult,
  Capabilities,
  CloseResult,
  ExecuteResult,
  PolicyReviewList,
  ContractPolicyClassification,
  QueueQuery,
  QueueResult,
  ReconcileResult,
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
  ReplacementList,
  ReplacementProposeResult,
  ReplacementDecideResult,
  AppealList,
  AppealRequestResult,
  AssignReviewerResult,
  AppealDecisionInput,
  AppealDecisionResult,
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
export interface ContractPolicyInput {
  result: PolicyResult;
  evidenceRefs: Array<{ kind: "PT_TERMS_ACCEPTANCE" | "CONTRACT_AUDIT_LOG"; id: string }>;
  reasoning: string;
  supersedesId?: string;
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
    /** A9. 201 created / 200 existing open case (`created:false`). */
    openCase: (sessionId: string, idempotencyKey: string) =>
      postData<OpenCaseResult>(A, { sessionId }, idempotencyKey, SLOW_MS),
    /** A2. Every call writes an access-log row per returned case: never poll. Strict query: only the documented filters are sent. */
    listCases: (query: ListCasesQuery = {}) =>
      get<ListCasesResult>(
        A,
        compact({
          status: query.status,
          execStatus: query.execStatus,
          type: query.type,
          investigatorId: query.unassigned ? undefined : query.investigatorId,
          unassigned: query.unassigned ? true : undefined,
          sessionId: query.sessionId,
          contractId: query.contractId,
          createdFrom: query.createdFrom,
          createdTo: query.createdTo,
          sort: query.sort,
          order: query.order,
          limit: query.limit,
          offset: query.offset,
        }),
      ),
    /** A3 (queue, R-05). Both DISPUTED and PT_NO_SHOW_REPORTED sessions, with `hasCase` / `caseId`. Reads no case (writes no access log). */
    getQueue: (query: QueueQuery = {}) =>
      get<QueueResult>(`${A}/queue`, compact({ sessionStatus: query.sessionStatus, hasCase: query.hasCase, contractId: query.contractId, limit: query.limit, offset: query.offset })),
    /** A1 (capabilities, R-02). Read-only verdicts of the five server flags in this process. */
    getCapabilities: () => get<Capabilities>(`${A}/capabilities`),
    /** A5 (R-19). Reading the log writes nothing. */
    getAccessLog: (caseId: string, query: { action?: "VIEW_CASE" | "VIEW_EVIDENCE"; limit?: number; offset?: number } = {}) =>
      get<AccessLogResult>(`${A}/${enc(caseId)}/access-log`, compact({ action: query.action, limit: query.limit, offset: query.offset })),
    /** A6 (R-03). The policy-eligibility reviews of the case's contract. */
    getPolicyReviews: (caseId: string) => get<PolicyReviewList>(`${A}/${enc(caseId)}/policy-eligibility`),
    /** A7. Same, by contract (empty `items` when the contract has no review). */
    getContractPolicyReviews: (contractId: string) => get<PolicyReviewList>(`${A}/contracts/${enc(contractId)}/policy-eligibility`),
    getContractPolicyClassification: (contractId: string) => get<ContractPolicyClassification>(`${A}/contracts/${enc(contractId)}/policy-classification`),
    proposeContractPolicy: (contractId: string, input: ContractPolicyInput, key: string) => postData<PolicyReviewResult>(`${A}/contracts/${enc(contractId)}/policy-eligibility`, compact({ result: input.result, evidenceRefs: input.evidenceRefs.map((ref) => ({ kind: ref.kind, id: ref.id })), reasoning: input.reasoning, supersedesId: input.supersedesId }), key),
    approveContractPolicy: (contractId: string, reviewId: string, input: PolicyApproveInput, key: string) => postData<PolicyReviewResult>(`${A}/contracts/${enc(contractId)}/policy-eligibility/${enc(reviewId)}/approve`, { reason: input.reason, conflictOfInterestDeclaredNone: input.conflictOfInterestDeclaredNone }, key),
    /** S3 (R-16). One session for an admin (GET /sessions/:id is refused to admins). */
    getAdminSession: (sessionId: string) => get<AdminSessionDetail>(`/admin/sessions/${enc(sessionId)}`),
    /** A4. Calls the ledger for every money step (slow). */
    getCase: (caseId: string) => get<DisputeCaseDetail>(`${A}/${enc(caseId)}`, undefined, SLOW_MS),
    /** A10. `investigatorId` is the only target id; omit it to take the case yourself. */
    assign: (caseId: string, input: { investigatorId?: string }, idempotencyKey: string) =>
      postData<AssignResult>(`${A}/${enc(caseId)}/assign`, compact({ investigatorId: input.investigatorId }), idempotencyKey),
    /** A11. Re-collects the evidence sources. Sources that could not be read come back in `skippedUnavailable`. */
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
     * A19 (F4). `201 {proposalCreated:true, ...}` = a proposal exists. `200 {proposalCreated:false, proposal:null, policyPending:true, ...}` = NO proposal
     * (cancel on a session with a late-arrival compensation); the case moved to POLICY_PENDING. A proposal is only believed when `proposalCreated === true`
     * (never from the HTTP status alone). No outcome / amount is sent.
     */
    propose: async (caseId: string, input: { note?: string }, idempotencyKey: string): Promise<ProposeResult> => {
      const raw = await postData<Record<string, unknown>>(`${A}/${enc(caseId)}/proposals`, compact({ note: input.note }), idempotencyKey, SLOW_MS);
      if (raw && raw.proposalCreated === true) {
        return {
          kind: "PROPOSED",
          proposal: {
            id: raw.id as string,
            outcome: raw.outcome as ProposalCreated["outcome"],
            executionBlockedReason: (raw.executionBlockedReason ?? null) as ProposalCreated["executionBlockedReason"],
            caseStatus: raw.caseStatus as ProposalCreated["caseStatus"],
            ...(typeof raw.execStatus === "string" ? { execStatus: raw.execStatus as ProposalCreated["execStatus"] } : {}),
          },
        };
      }
      if (raw && (raw.proposalCreated === false || raw.policyPending === true)) {
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
      // Neither flag present: an answer we do not understand is never "a proposal was created".
      throw Object.assign(new Error("UNREADABLE_PROPOSAL_ANSWER"), { response: { status: 502, data: { error: "", code: "INTERNAL_ERROR" } } });
    },
    /** A20. Four-eyes: the server re-checks the approver. */
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
      return {
        approvalId: raw.approvalId as string,
        result: raw.result as DecideResult["result"],
        caseStatus: raw.caseStatus as DecideResult["caseStatus"],
        outcome: raw.outcome as DecideResult["outcome"],
        ...(typeof raw.execStatus === "string" ? { execStatus: raw.execStatus as DecideResult["execStatus"] } : {}),
        ...(raw.executionBlockedReason !== undefined ? { executionBlockedReason: raw.executionBlockedReason as DecideResult["executionBlockedReason"] } : {}),
      };
    },
    /** A21. */
    acknowledgeEvidenceChange: (caseId: string, input: { note: string }, idempotencyKey: string) =>
      postData<AckEvidenceChangeResult>(`${A}/${enc(caseId)}/evidence-change-ack`, { note: input.note }, idempotencyKey),
    /** A22. HTTP 200. Read the reviews back with `getPolicyReviews`. */
    proposePolicyEligibility: (caseId: string, input: PolicyEligibilityInput, idempotencyKey: string) =>
      postData<PolicyReviewResult>(
        `${A}/${enc(caseId)}/policy-eligibility`,
        compact({ result: input.result, evidenceIds: input.evidenceIds, reasoning: input.reasoning, supersedesId: input.supersedesId }),
        idempotencyKey,
      ),
    /** A23. Four-eyes: the server re-checks the approver. */
    approvePolicyEligibility: (caseId: string, reviewId: string, input: PolicyApproveInput, idempotencyKey: string) =>
      postData<PolicyReviewResult>(
        `${A}/${enc(caseId)}/policy-eligibility/${enc(reviewId)}/approve`,
        { reason: input.reason, conflictOfInterestDeclaredNone: input.conflictOfInterestDeclaredNone },
        idempotencyKey,
      ),
    /** A24. Exactly one of evidenceId / statementId. */
    share: (caseId: string, input: ShareInput, idempotencyKey: string) =>
      postData<CreatedId>(
        `${A}/${enc(caseId)}/shares`,
        compact({ evidenceId: input.evidenceId, statementId: input.statementId, sharedWithRole: input.sharedWithRole, reason: input.reason }),
        idempotencyKey,
      ),

    // ── closing WITHOUT a decision (never touches the session, the quota or money) ──
    /** A25. Only when the case's session left the dispute (`allowedActions` lists `closeOrphan`). */
    closeOrphan: (caseId: string, input: { reason: string }, idempotencyKey: string) =>
      postData<CloseResult>(`${A}/${enc(caseId)}/close-orphan`, { reason: input.reason }, idempotencyKey),
    /** A26. Investigator only, `FINDING_RECORDED` with a `NOT_A_DISPUTE` finding. The session stays DISPUTED and goes back to the queue. */
    closeNotADispute: (caseId: string, input: { reason: string }, idempotencyKey: string) =>
      postData<CloseResult>(`${A}/${enc(caseId)}/close-not-a-dispute`, { reason: input.reason }, idempotencyKey),
    /** A50. Admin only, not a party; `DECISION_APPROVED` + `BUSINESS_DONE`; `allowedActions` must list `closeExecuted`. Never moves money. */
    closeExecuted: (caseId: string, input: { reason: string }, idempotencyKey: string) =>
      postData<CloseResult>(`${A}/${enc(caseId)}/close-executed`, { reason: input.reason }, idempotencyKey),

    // ── A33-A36: Decision replacement ──
    /** A33. List replacements. Always open even when flag off. */
    listReplacements: (caseId: string) =>
      get<ReplacementList>(`${A}/${enc(caseId)}/replacements`),
    /** A34. Propose replacement. Body {reason} (1..2000). */
    proposeReplacement: (caseId: string, input: { reason: string }, idempotencyKey: string) =>
      postData<ReplacementProposeResult>(`${A}/${enc(caseId)}/replacements`, { reason: input.reason }, idempotencyKey),
    /** A35. Approve replacement. Body {reason, conflictOfInterestDeclaredNone: true}. */
    approveReplacement: (caseId: string, replacementId: string, input: { reason: string; conflictOfInterestDeclaredNone: boolean }, idempotencyKey: string) =>
      postData<ReplacementDecideResult>(`${A}/${enc(caseId)}/replacements/${enc(replacementId)}/approve`, { reason: input.reason, conflictOfInterestDeclaredNone: input.conflictOfInterestDeclaredNone }, idempotencyKey),
    /** A36. Reject replacement. Body {reason, conflictOfInterestDeclaredNone: true}. */
    rejectReplacement: (caseId: string, replacementId: string, input: { reason: string; conflictOfInterestDeclaredNone: boolean }, idempotencyKey: string) =>
      postData<ReplacementDecideResult>(`${A}/${enc(caseId)}/replacements/${enc(replacementId)}/reject`, { reason: input.reason, conflictOfInterestDeclaredNone: input.conflictOfInterestDeclaredNone }, idempotencyKey),

    // ── A45-A47, A52: Appeals ──
    /** A45. List appeals. */
    listAppeals: (caseId: string) =>
      get<AppealList>(`${A}/${enc(caseId)}/appeals`),
    /** A46. Assign appeal reviewer. */
    assignAppealReviewer: (caseId: string, appealId: string, input: { reviewerId: string }, idempotencyKey: string) =>
      postData<AssignReviewerResult>(`${A}/${enc(caseId)}/appeals/${enc(appealId)}/assign-reviewer`, { reviewerId: input.reviewerId }, idempotencyKey),
    /** A47. Decide appeal. Assigned reviewer only. */
    decideAppeal: (caseId: string, appealId: string, input: AppealDecisionInput, idempotencyKey: string) =>
      postData<AppealDecisionResult>(
        `${A}/${enc(caseId)}/appeals/${enc(appealId)}/decision`,
        compact({
          result: input.result,
          reasoning: input.reasoning,
          finding: input.finding,
          consequences: input.consequences,
        }),
        idempotencyKey,
      ),
    /** A52. Sync obligation status. */
    syncAppealObligation: (caseId: string, consequenceId: string, idempotencyKey: string) =>
      postData<{ consequenceId: string; status: string; obligation: unknown }>(`${A}/${enc(caseId)}/appeal-consequences/${enc(consequenceId)}/sync-obligation`, {}, idempotencyKey),

    // ── execution (server flag `execution`; `409 EXECUTION_DISABLED` when off) ──
    /** A27. `decisionId` only CHOOSES among the case's approvals; the executor re-reads and re-checks everything. Changes the session, the quota and money. */
    execute: (caseId: string, input: { decisionId?: string }, idempotencyKey: string) =>
      postData<ExecuteResult>(`${A}/${enc(caseId)}/execute`, compact({ decisionId: input.decisionId }), idempotencyKey, SLOW_MS),
    /** A28. Reads the real state of an execution left half-way, then finishes it or hands it to a person. */
    reconcileExecution: (caseId: string, idempotencyKey: string) =>
      postData<ReconcileResult>(`${A}/${enc(caseId)}/reconcile-execution`, {}, idempotencyKey, SLOW_MS),
    /** A29. One admin, no four-eyes, MOVES NO MONEY. `STAYS_LOCKED` is a normal answer, not an error. */
    acknowledgeNeedsHuman: (caseId: string, input: { note: string }, idempotencyKey: string) =>
      postData<AckNeedsHumanResult>(`${A}/${enc(caseId)}/acknowledge-needs-human`, { note: input.note }, idempotencyKey),

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
    /** B8. Request appeal. Idempotency-Key mandatory. */
    requestPartyAppeal: (caseId: string, input: { reason: string }, idempotencyKey: string) =>
      postData<AppealRequestResult>(`/dispute-cases/${enc(caseId)}/appeals`, { reason: input.reason }, idempotencyKey),
  };
}

export type DisputeCaseApi = ReturnType<typeof createDisputeCaseApi>;

/** The app instance (token, refresh, session guard, 401 handling all live in `api`'s interceptors). */
export const disputeCaseApi: DisputeCaseApi = createDisputeCaseApi(api as unknown as DisputeHttpClient);

// ── C1 / C3 / C2: the existing legacy routes, unchanged ──
export const listDisputedSessions = adminService.listDisputedSessions;
export const resolveSessionDispute = adminService.resolveSessionDispute;
/** C2 stays `adminService.getSessionsReconciliation` (read-only report). */
