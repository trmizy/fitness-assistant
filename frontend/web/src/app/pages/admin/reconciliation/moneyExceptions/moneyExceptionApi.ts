/**
 * D7 - typed client of the two money-exception APIs (all behind the gateway, ADMIN only), on the app's `api` axios instance.
 *
 *   A1  GET  /admin/dispute-cases/capabilities
 *   P1-P3 GET  /admin/unconfirmed-session-resolutions[/sessions/:sessionId | /:id]       P4 POST …/sessions/:sessionId/proposals   P5 POST …/:id/approve
 *   L1-L2 GET  /admin/late-open-reconciliations[/:rowId]                                 L3-L11 writes
 *
 * Rules enforced HERE (not left to callers), like the D1 client:
 *  - bodies are built field by field from the documented schemas: a stray `userId` / `amount` / `outcome` / `approvedBy` can never reach the wire
 *    (the server is `.strict()`); no function takes the actor's id; there is no amount parameter anywhere;
 *  - every write that reads `Idempotency-Key` requires one and checks it against the server regex; L8 `retry` does NOT read it (the server ignores it),
 *    so it takes none - the caller's one-flight lock is its only guard;
 *  - nothing is retried here.
 */
import { api } from "../../../../services/api";

export interface MoneyHttpClient {
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
/** A ledger read is ~10 s per step server-side; L1 reads the ledger once per row. */
const SLOW_MS = 40_000;

function assertKey(key: string): string {
  if (typeof key !== "string" || !IDEMPOTENCY_KEY_PATTERN.test(key)) throw new Error("INVALID_IDEMPOTENCY_KEY");
  return key;
}

const D65B = "/admin/unconfirmed-session-resolutions";
const LATE = "/admin/late-open-reconciliations";
const seg = (id: string) => encodeURIComponent(id);

export interface Answer<T = unknown> {
  status: number;
  data: T;
}

export interface ProposeD65bInput {
  reason: string;
  evidenceRefs: Array<{ type: "EVIDENCE"; id: string; contentHash: string } | { type: "LEDGER_OP"; key: string }>;
}
export interface ApproveInput {
  reason: string;
  /** the screen only sends `true` (the box must be ticked) */
  conflictOfInterestDeclaredNone: boolean;
}
export interface ProposeLateInput {
  reason: string;
  verificationNote: string;
  evidenceRefs: string[];
  policyBasis: string;
}
export interface HandoverInput {
  newAssigneeId: string;
  reason: string;
}

export function createMoneyExceptionApi(http: MoneyHttpClient) {
  const get = async <T = unknown>(url: string, params?: Record<string, unknown>): Promise<Answer<T>> => {
    const r = await http.request<T>({ method: "GET", url, params, timeout: SLOW_MS });
    return { status: r.status, data: r.data };
  };
  const post = async <T = unknown>(url: string, body: unknown, key?: string): Promise<Answer<T>> => {
    const headers: Record<string, string> = {};
    if (key !== undefined) headers["Idempotency-Key"] = assertKey(key);
    const r = await http.request<T>({ method: "POST", url, data: body, headers, timeout: SLOW_MS });
    return { status: r.status, data: r.data };
  };

  return {
    // ── capabilities (A1)
    capabilities: () => get("/admin/dispute-cases/capabilities"),

    // ── D65-B
    d65bList: (limit = 50) => get(D65B, { limit }),
    d65bGet: (id: string) => get(`${D65B}/${seg(id)}`),
    d65bBySession: (sessionId: string) => get(`${D65B}/sessions/${seg(sessionId)}`),
    d65bPropose: (sessionId: string, b: ProposeD65bInput, key: string) =>
      post(`${D65B}/sessions/${seg(sessionId)}/proposals`, { reason: b.reason, evidenceRefs: [...b.evidenceRefs] }, key),
    d65bApprove: (id: string, b: ApproveInput, key: string) => post(`${D65B}/${seg(id)}/approve`, { reason: b.reason, conflictOfInterestDeclaredNone: b.conflictOfInterestDeclaredNone }, key),
    d65bReject: (id: string, b: ApproveInput, key: string) => post(`${D65B}/${seg(id)}/reject`, { reason: b.reason, conflictOfInterestDeclaredNone: b.conflictOfInterestDeclaredNone }, key),
    d65bHandover: (id: string, b: ApproveInput, key: string) => post(`${D65B}/${seg(id)}/handover`, { reason: b.reason, conflictOfInterestDeclaredNone: b.conflictOfInterestDeclaredNone }, key),

    // ── late-open reads
    lateList: (limit = 50) => get(LATE, { limit }),
    lateGet: (rowId: string) => get(`${LATE}/${seg(rowId)}`),

    // ── late-open writes
    lateClaim: (rowId: string, key: string) => post(`${LATE}/${seg(rowId)}/claim`, {}, key),
    lateHandover: (rowId: string, b: HandoverInput, key: string) => post(`${LATE}/${seg(rowId)}/handover`, { newAssigneeId: b.newAssigneeId, reason: b.reason }, key),
    latePropose: (rowId: string, b: ProposeLateInput, key: string) =>
      post(`${LATE}/${seg(rowId)}/proposals`, { reason: b.reason, verificationNote: b.verificationNote, evidenceRefs: [...b.evidenceRefs], policyBasis: b.policyBasis }, key),
    lateApprove: (proposalId: string, b: ApproveInput, key: string) =>
      post(`${LATE}/proposals/${seg(proposalId)}/approve`, { reason: b.reason, conflictOfInterestDeclaredNone: b.conflictOfInterestDeclaredNone }, key),
    lateReject: (proposalId: string, b: { reason: string }, key: string) => post(`${LATE}/proposals/${seg(proposalId)}/reject`, { reason: b.reason }, key),
    /** L8: the server reads NO Idempotency-Key here (it re-runs the approved step, which the ledger de-duplicates on its own key). */
    lateRetry: (proposalId: string) => post(`${LATE}/proposals/${seg(proposalId)}/retry`, {}),
    lateOpenRecovery: (proposalId: string, b: { reason: string }, key: string) => post(`${LATE}/proposals/${seg(proposalId)}/recoveries`, { reason: b.reason }, key),
    lateApproveRecovery: (recoveryId: string, b: ApproveInput, key: string) =>
      post(`${LATE}/recoveries/${seg(recoveryId)}/approve`, { reason: b.reason, conflictOfInterestDeclaredNone: b.conflictOfInterestDeclaredNone }, key),
    lateRejectRecovery: (recoveryId: string, b: { reason: string }, key: string) => post(`${LATE}/recoveries/${seg(recoveryId)}/reject`, { reason: b.reason }, key),

    // ── the ADMIN list a handover chooses from (never a typed id)
    adminUsers: () => get("/admin/users", { role: "ADMIN" }),
  };
}

export type MoneyExceptionApi = ReturnType<typeof createMoneyExceptionApi>;

export const moneyExceptionApi: MoneyExceptionApi = createMoneyExceptionApi({
  request: <T>(config: Parameters<MoneyHttpClient["request"]>[0]) => api.request<T>(config),
});
