/**
 * AI Coach V1/V2 server-side bridge (M9.2-T1) — DEFAULT OFF, NOT MOUNTED ON ANY ROUTE.
 *
 * Owner decision (brief M9.2, 2026-11-16): Multi-Agent V2 upgrades the existing AI Coach through a server-side bridge in
 * ai-service. V1 stays the default. This module is only the decision + dispatch core with injected dependencies; it is not
 * wired into /ai/ask or /ai/ask/stream (that is a later, separately approved task), so V1 behaviour is untouched by
 * construction. It imports NOTHING from src/agent-v2 (V1-side isolation pins stay green): the V2 runtime is reached only
 * through the injected `V2Executor`.
 *
 * Invariants (each has a test in __tests__/coach-v2-bridge.test.ts):
 *  1. OFF by default. Only the exact value "on" enables it, and on NODE_ENV=production a second explicit approval is needed.
 *  2. The capability is selected BEFORE any runtime is touched. Only a plain read-only question over a JSON transport from a
 *     verified end user on the user allowlist may go to V2. Everything else (streaming, images, confirmed-write workflows,
 *     InBody / macro / memory / feedback / plan generation, a request without a valid clientRequestId, a conversation
 *     already on V1) stays on V1.
 *  3. At most ONE primary branch handles a request: the bridge answers "v1" (the caller runs V1 unchanged) or "v2" (V2 ran
 *     once). It never runs both and never runs V1 itself.
 *  4. SAFETY: once V2 has processed a request, its decision is FINAL. A safety / minor / auth / persistence / routing /
 *     policy block, an unavailable result, or any error thrown mid-turn is NEVER retried on V1 ("try V1 to get an answer"
 *     would bypass the Safety Guard, Minor Gate and Answer Guard). The only V1 fall-back after V2 involvement is when V2
 *     PROVABLY did not start (status DISABLED, or a `V2NotStartedError` raised before any turn) — nothing was processed.
 *  5. No metadata is fabricated: the result carries only what V2 returned (answer, status, executed agents, ids). It has no
 *     structuredBlocks / evidenceUsed / safetyNotes / history fields; a later adapter must not invent them either.
 *  6. No network, DB, Redis or model access here — all of that lives behind the injected executor.
 */

// ── enablement ────────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * The bridge's OWN switch (distinct from the V2 endpoint's flag, which only src/agent-v2 may read). Exactly "on" enables it;
 * any other value ("true", "1", "ON ", unset) is OFF. On NODE_ENV=production it additionally needs
 * AI_COACH_V2_BRIDGE_PRODUCTION_APPROVED === "yes". Deployment is on hold (owner rule 2026-11-13): never set either on a
 * deployed service before the synchronized Multi-Agent release.
 */
export function isCoachBridgeEnabled(env: Record<string, string | undefined> = process.env): boolean {
  if (env.AI_COACH_V2_BRIDGE !== "on") return false;
  return env.NODE_ENV !== "production" || env.AI_COACH_V2_BRIDGE_PRODUCTION_APPROVED === "yes";
}

/**
 * Default-deny user allowlist: AI_COACH_V2_BRIDGE_USERS = comma-separated exact user ids. Unset / empty → nobody.
 * (D-P03 "who may use V2" is still a PROPOSED decision; this default can only ever restrict, never widen.)
 */
export function defaultCoachUserAllowlist(env: Record<string, string | undefined> = process.env): (userId: string) => boolean {
  const ids = new Set((env.AI_COACH_V2_BRIDGE_USERS ?? "").split(",").map((s) => s.trim()).filter(Boolean));
  return (userId) => ids.has(userId);
}

// ── capability selection (before any runtime call) ────────────────────────────────────────────────────────────────────
export type CoachCapability =
  | "CHAT_READONLY_QA"          // a plain question answered from the user's own data + knowledge — the only V2-eligible one
  | "CHAT_STREAM"               // /ai/ask/stream (SSE). V2 has no SSE; needs an adapter that does not exist yet
  | "IMAGE_CHAT"                // vision / goal image (Gemini)
  | "AGENT_WRITE_WORKFLOW"      // propose → choose → confirm → write (fitnessAgent). V2 is read-only: never converted
  | "AGENT_WORKFLOW_CONTINUATION" // a turn inside a pending confirmation / selection
  | "INBODY_INTERPRET" | "DAY_MACRO_ESTIMATE" | "GENERATE_WORKOUT" | "MEMORY" | "FEEDBACK"
  | "UNKNOWN";

export type CoachRouteReason =
  | "BRIDGE_OFF"
  | "NOT_VERIFIED_END_USER"
  | "USER_NOT_ALLOWLISTED"
  | "CAPABILITY_V1_ONLY"
  | "NO_VALID_CLIENT_REQUEST_ID"
  | "CONTINUITY_NOT_CONFIGURED"
  | "SESSION_ON_V1"
  | "ELIGIBLE_READ_ONLY"
  | "V2_NOT_STARTED";

export interface CoachRequestFacts {
  capability: CoachCapability;
  transport: "json" | "sse";
  /** From req.context (requireAuth), never from the body. */
  userId: string;
  callerKind: string | undefined;
  hasUserBearer: boolean;
  question: string;
  sessionId?: string;
  /**
   * The client's retry-idempotency key (V1 contract: services/request-identity.ts). It lives at THIS boundary only: V2's strict
   * request never receives it (the executor input has no such field). V2 serves only requests with a VALID key, because the
   * continuity layer (coach-v2-continuity.ts) needs one to make a retry safe; none / malformed → V1's own legacy handling.
   */
  clientRequestId?: string;
  /**
   * Which version owns the conversation `sessionId` belongs to. "none" = a new conversation. A conversation already on V1
   * is never moved to V2 mid-way (history and context would split); resolving this is part of M9.2-T2, not this task.
   */
  sessionAffinity: "none" | "v1" | "v2";
}

export type CoachRouteDecision = { route: "v1"; reason: Exclude<CoachRouteReason, "ELIGIBLE_READ_ONLY" | "V2_NOT_STARTED" | "CONTINUITY_NOT_CONFIGURED"> } | { route: "v2"; reason: "ELIGIBLE_READ_ONLY" };

export interface CoachBridgeDeps {
  /** Absent → isCoachBridgeEnabled(process.env). */
  enabled?: () => boolean;
  /** Absent → defaultCoachUserAllowlist(process.env) (deny-all when unconfigured). */
  userAllowed?: (userId: string) => boolean;
  /** The ONLY way V2 is reached. Required to dispatch; never called when the decision is "v1". */
  executor?: V2Executor;
  /** Optional trace: codes only (no question, answer or user id). */
  trace?: (event: { route: "v1" | "v2"; reason: CoachRouteReason; kind?: V2Kind }) => void;
}

/** Same shape V1 accepts (request-identity.ts SAFE_ID); a malformed value is ignored by V1 (legacy), never an error. */
export function isValidClientRequestId(id: string | undefined): id is string {
  return typeof id === "string" && /^[A-Za-z0-9-]{8,64}$/.test(id);
}

/** Pure, synchronous selection — touches no runtime, no I/O. The first failing check wins. */
export function decideCoachRoute(f: CoachRequestFacts, deps: Pick<CoachBridgeDeps, "enabled" | "userAllowed"> = {}): CoachRouteDecision {
  if (!(deps.enabled ?? (() => isCoachBridgeEnabled()))()) return { route: "v1", reason: "BRIDGE_OFF" };
  // same rule as POST /ai/v2/ask: a verified end user (JWT / gateway-forwarded user) with the user's own bearer
  if ((f.callerKind !== "user" && f.callerKind !== "gateway_user") || !f.hasUserBearer || !f.userId) return { route: "v1", reason: "NOT_VERIFIED_END_USER" };
  if (!(deps.userAllowed ?? defaultCoachUserAllowlist())(f.userId)) return { route: "v1", reason: "USER_NOT_ALLOWLISTED" };
  if (f.capability !== "CHAT_READONLY_QA" || f.transport !== "json") return { route: "v1", reason: "CAPABILITY_V1_ONLY" };
  if (!isValidClientRequestId(f.clientRequestId)) return { route: "v1", reason: "NO_VALID_CLIENT_REQUEST_ID" };
  if (f.sessionAffinity === "v1") return { route: "v1", reason: "SESSION_ON_V1" };
  return { route: "v2", reason: "ELIGIBLE_READ_ONLY" };
}

// ── V2 outcome classification ─────────────────────────────────────────────────────────────────────────────────────────
/** Structural subset of V2's SupervisorResult (no import from src/agent-v2). */
export interface V2RawResult {
  status: string;
  answer: string;
  executedAgents?: readonly string[];
  turnId?: string;
  supervisorTraceId?: string;
}
export interface V2Executor {
  ask(input: { question: string; sessionId?: string; userId: string }): Promise<V2RawResult>;
}
/** Raised by an executor/adapter ONLY when it failed before V2 started any turn (e.g. runtime not constructible). Nothing was processed. */
export class V2NotStartedError extends Error {
  readonly v2NotStarted = true as const;
  constructor(message = "V2 not started") { super(message); this.name = "V2NotStartedError"; }
}

export type V2Kind = "answered" | "partial" | "blocked" | "unavailable";
export type V2BlockCategory = "SAFETY" | "MINOR" | "AUTH" | "PERSISTENCE" | "ROUTING" | "POLICY" | "INPUT";

const STATUS_TABLE: Readonly<Record<string, { kind: V2Kind; block?: V2BlockCategory }>> = Object.freeze({
  ANSWERED: { kind: "answered" },
  PARTIAL: { kind: "partial" },
  INSUFFICIENT_DATA: { kind: "partial" },
  SAFETY_BLOCKED: { kind: "blocked", block: "SAFETY" },
  MINOR_PROTECTED: { kind: "blocked", block: "MINOR" },
  PROFILE_UNVERIFIED: { kind: "blocked", block: "MINOR" },
  UNAUTHENTICATED: { kind: "blocked", block: "AUTH" },
  SESSION_UNAVAILABLE: { kind: "blocked", block: "PERSISTENCE" },
  ROUTING_UNDETERMINED: { kind: "blocked", block: "ROUTING" },
  BLOCKED: { kind: "blocked", block: "POLICY" },
  OUT_OF_SCOPE: { kind: "blocked", block: "POLICY" },
  INVALID_INPUT: { kind: "blocked", block: "INPUT" },
  FAILED: { kind: "unavailable" },
  BUDGET_EXHAUSTED: { kind: "unavailable" },
});

export interface V2Outcome {
  handler: "v2";
  kind: V2Kind;
  status: string;
  block?: V2BlockCategory;
  answer: string;
  executedAgents: string[];
  turnId?: string;
  traceId?: string;
  /** True when the outcome came from an error thrown mid-turn (V2 may have partially processed): never replayed as a clean result. */
  thrown?: true;
  /** Always false: a V2 decision is never re-run on V1. Present so callers cannot "helpfully" add a fallback unnoticed. */
  fallbackAllowed: false;
}
export interface V1Handoff {
  handler: "v1";
  reason: Exclude<CoachRouteReason, "ELIGIBLE_READ_ONLY">;
  /** True only for V2_NOT_STARTED: V2 was invoked but provably processed nothing. */
  v2Attempted: boolean;
}
export type CoachBridgeResult = V1Handoff | V2Outcome;

function classifyThrown(err: unknown): V2Outcome {
  const code = (err as { statusCode?: unknown } | null)?.statusCode;
  const authFailure = code === 401 || code === 403;
  return {
    handler: "v2", kind: authFailure ? "blocked" : "unavailable", status: authFailure ? "UNAUTHENTICATED" : "V2_ERROR",
    ...(authFailure ? { block: "AUTH" as const } : {}), thrown: true,
    // no internal detail, no error text: the caller shows a generic message; the final answer is never produced by V1
    answer: "", executedAgents: [], fallbackAllowed: false,
  };
}

/**
 * Decide, then (only for an eligible request) run V2 exactly once. Never runs V1: a "v1" result tells the caller to run
 * the existing V1 handler unchanged.
 */
export async function runCoachBridge(facts: CoachRequestFacts, deps: CoachBridgeDeps = {}): Promise<CoachBridgeResult> {
  const decision = decideCoachRoute(facts, deps);
  if (decision.route === "v1") {
    deps.trace?.({ route: "v1", reason: decision.reason });
    return { handler: "v1", reason: decision.reason, v2Attempted: false };
  }
  return dispatchV2(facts, deps);
}

/**
 * Runs V2 exactly once for a request that has ALREADY been decided "v2" (by decideCoachRoute, including the client-key rule).
 * Exported for the continuity layer, which owns the key, claims it atomically and must not hand the key to V2: `facts` here
 * may carry the key but it is never forwarded: the executor input is built from question / user / session only.
 */
export async function dispatchV2(facts: CoachRequestFacts, deps: CoachBridgeDeps = {}): Promise<CoachBridgeResult> {
  // an eligible request but no executor wired: fail to V1 — V2 was never reached, so nothing was processed
  if (!deps.executor) {
    deps.trace?.({ route: "v1", reason: "V2_NOT_STARTED" });
    return { handler: "v1", reason: "V2_NOT_STARTED", v2Attempted: false };
  }
  let raw: V2RawResult;
  try {
    raw = await deps.executor.ask({ question: facts.question, userId: facts.userId, ...(facts.sessionId ? { sessionId: facts.sessionId } : {}) });
  } catch (err) {
    if ((err as { v2NotStarted?: unknown } | null)?.v2NotStarted === true) {
      deps.trace?.({ route: "v1", reason: "V2_NOT_STARTED" });
      return { handler: "v1", reason: "V2_NOT_STARTED", v2Attempted: true };
    }
    const out = classifyThrown(err);
    deps.trace?.({ route: "v2", reason: "ELIGIBLE_READ_ONLY", kind: out.kind });
    return out;
  }
  // V2 refused to run at all (its own disabled state): nothing was processed → V1
  if (raw.status === "DISABLED") {
    deps.trace?.({ route: "v1", reason: "V2_NOT_STARTED" });
    return { handler: "v1", reason: "V2_NOT_STARTED", v2Attempted: true };
  }
  // an unknown status is never trusted as an answer (fail closed, no fallback)
  const mapped = STATUS_TABLE[raw.status] ?? { kind: "unavailable" as V2Kind };
  const out: V2Outcome = {
    handler: "v2", kind: mapped.kind, status: raw.status, ...(mapped.block ? { block: mapped.block } : {}),
    answer: typeof raw.answer === "string" ? raw.answer : "", executedAgents: [...(raw.executedAgents ?? [])],
    ...(raw.turnId ? { turnId: raw.turnId } : {}), ...(raw.supervisorTraceId ? { traceId: raw.supervisorTraceId } : {}),
    fallbackAllowed: false,
  };
  deps.trace?.({ route: "v2", reason: "ELIGIBLE_READ_ONLY", kind: out.kind });
  return out;
}
