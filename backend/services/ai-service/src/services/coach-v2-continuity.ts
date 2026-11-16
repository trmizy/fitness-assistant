/**
 * AI Coach V1/V2 bridge — CONTINUITY CONTRACT (M9.2-T2): idempotency + conversation history. DEFAULT OFF, NOT MOUNTED.
 *
 * Wraps services/coach-v2-bridge.ts. Everything stateful is behind injected PORTS (CoachIdempotencyStore, CoachHistoryPort);
 * this file contains no database / Redis / network / model code and ships NO in-memory store (tests supply fakes), so it
 * cannot be mistaken for a production implementation. Real adapters are a later task (T3+) and need owner decisions
 * D-P11..D-P13. PRODUCTION NOT VERIFIED.
 *
 * V1 contract being honoured (services/request-identity.ts, rag.service.ts, conversation.repository.ts):
 *   - clientRequestId names ONE user action inside the verified caller's own namespace; it is not authorization.
 *   - the same (user, key) may only ever mean the same action (same question; the session when the retry names one),
 *     otherwise the retry is REFUSED (V1: 409 IDEMPOTENCY_KEY_CONFLICT) — never answered with another turn.
 *   - a retry is answered from the stored turn: no second model call, no second session, no duplicate message.
 *   - history = ChatSession (user-owned) + Conversation rows; GET /ai/sessions/:id/messages reads them by (userId, sessionId).
 *
 * Rules implemented here (each has a test in __tests__/coach-v2-continuity.test.ts):
 *  I1  Key = (authenticated userId, clientRequestId) + a fingerprint of the action. userId and key are never concatenated
 *      into one string by this file; another user's record is unreachable by construction.
 *  I2  clientRequestId stops at this boundary. The V2 executor input never contains it.
 *  I3  The claim is atomic. Concurrent duplicates: exactly one runs V2; the others get IN_PROGRESS. A claimed-but-unfinished
 *      record is NEVER taken over (no lease/steal): execution state is unknown → V2 is never run a second time for the key.
 *  I4  An error thrown mid-turn marks the key IN_DOUBT (V2 may have written session / minor-restriction state). Retries get
 *      IN_DOUBT; the user must send a new action (new key). V2 is not re-run.
 *  I5  Any store failure fails CLOSED: no V2 call and no V1 hand-off (a concurrent duplicate might already be running).
 *      The only V1 hand-offs are "V2 provably never started" cases (bridge) and "continuity ports not configured".
 *  H1  History is written ONLY for a completed answer: ANSWERED (and PARTIAL only when persistPartial is set — default
 *      OFF, open decision D-P12). Blocked / unavailable / thrown / not-started turns are never written: a blocked turn's
 *      question may hold a sensitive disclosure, and V1 later reads history as chat context, so writing it could feed a
 *      withheld turn back into a V1 answer.
 *  H2  Nothing is invented: no structuredBlocks / evidenceUsed / routeIntent / responseLanguage / relevance. Required columns V2
 *      does not measure are written as honest zero/default (tokens 0 = NOT MEASURED; schema fix proposed in D-P13).
 *      modelUsed = "multi-agent-v2" marks the engine; traceId = V2's real supervisorTraceId.
 *  H3  Link: ChatSession.id == the sessionId handed to V2 (a V1 UUID, accepted by V2's id pattern) == Conversation.sessionId,
 *      always under the authenticated userId. A supplied sessionId must be a live, own, non-archived session (else
 *      SESSION_NOT_FOUND, same answer for "missing" and "someone else's"). A new conversation gets a fresh UUID; its
 *      ChatSession row is created only when the first turn is actually persisted (no empty sessions from blocked turns).
 *  H4  Retry never duplicates: the history write is idempotent on (userId, clientRequestId), and a COMPLETED record whose
 *      history write failed is re-driven on replay (HISTORY_UNAVAILABLE → same key retried → recorded once).
 *  H5  A conversation already holding V1 turns stays on V1 (affinity), and one holding only V2 turns stays on V2.
 *  H6  V2 does not support memory (UserMemory) or SSE: neither is written/emitted here.
 */
import { createHash, randomUUID } from "node:crypto";
import {
  decideCoachRoute, dispatchV2,
  type CoachBridgeDeps, type CoachRequestFacts, type V1Handoff, type V2Outcome,
} from "./coach-v2-bridge";

export const V2_ENGINE_MARKER = "multi-agent-v2" as const;

// ── idempotency port ─────────────────────────────────────────────────────────────────────────────────────────────────────
/** What is replayed for a finished turn: only fields V2 actually returned plus the session link. */
export interface StoredOutcome {
  kind: V2Outcome["kind"];
  status: string;
  block?: V2Outcome["block"];
  answer: string;
  executedAgents: string[];
  turnId?: string;
  traceId?: string;
  sessionId: string;
  /** Seconds the V2 turn took (needed to re-drive a failed history write on replay). */
  responseTimeSec: number;
}
export type IdempotencyRecord =
  | { state: "IN_PROGRESS"; fingerprint: string }
  | { state: "IN_DOUBT"; fingerprint: string }
  | { state: "COMPLETED"; fingerprint: string; outcome: StoredOutcome };

/**
 * Required semantics of a real store: `claim` is an ATOMIC create-if-absent keyed by (userId, clientRequestId) — two
 * concurrent claims can never both win (SETNX / conditional put / unique insert). Records must outlive the longest client
 * retry window; expiry must only ever remove COMPLETED records, never turn IN_PROGRESS into "claimable".
 */
export interface CoachIdempotencyStore {
  claim(userId: string, clientRequestId: string, fingerprint: string): Promise<{ claimed: true } | { claimed: false; record: IdempotencyRecord }>;
  complete(userId: string, clientRequestId: string, fingerprint: string, outcome: StoredOutcome): Promise<void>;
  markInDoubt(userId: string, clientRequestId: string, fingerprint: string): Promise<void>;
  /** Only for "V2 provably never started": removes this attempt's IN_PROGRESS claim so V1 / a later attempt is not blocked. */
  release(userId: string, clientRequestId: string, fingerprint: string): Promise<void>;
}

/** Stable identity of the action: a different question / session / capability under the same key is a different action. */
export function coachActionFingerprint(f: Pick<CoachRequestFacts, "question" | "sessionId" | "capability">): string {
  return createHash("sha256").update(JSON.stringify(["coach-action-v1", f.capability, f.question.trim(), f.sessionId ?? null])).digest("hex");
}

// ── history port ─────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface HistorySession { id: string; userId: string; archivedAt: Date | string | null }
export interface HistoryTurn { id: string; userId?: string | null; sessionId?: string | null; question: string }
export interface V2HistoryTurnInput {
  userId: string; sessionId: string; clientRequestId: string; question: string; answer: string;
  modelUsed: typeof V2_ENGINE_MARKER; responseTime: number;
  promptTokens: 0; completionTokens: 0; totalTokens: 0; cost: 0;
  traceId?: string; usedFallback: false; usedDeterministicFallback: false; warningCount: 0;
}
/** Mirrors the V1 conversationRepository operations the bridge needs; a real adapter maps these 1:1 (T3). */
export interface CoachHistoryPort {
  findSession(sessionId: string): Promise<HistorySession | null>;
  /** `modelUsed` of the session's existing turns (for affinity). */
  listSessionTurnEngines(userId: string, sessionId: string): Promise<string[]>;
  findTurnByClientRequestId(userId: string, clientRequestId: string): Promise<HistoryTurn | null>;
  /** Explicit id: ChatSession.id must equal the sessionId V2 used (V1's createSession lets the DB pick it — T3 adds `id`). */
  createSession(data: { id: string; userId: string; title: string }): Promise<unknown>;
  /** A unique-violation must surface as an error carrying `code: "P2002"` (Prisma), exactly like V1's create. */
  createTurn(data: V2HistoryTurnInput): Promise<unknown>;
  touchSession(sessionId: string): Promise<unknown>;
}

/** H1: the whole write policy in one place. */
export function shouldRecordHistory(o: Pick<V2Outcome, "kind" | "answer" | "thrown">, persistPartial: boolean): boolean {
  if (o.thrown || !o.answer.trim()) return false;
  return o.kind === "answered" || (o.kind === "partial" && persistPartial);
}

type EnsureResult = "recorded" | "already_recorded" | "conflict";
const isUniqueViolation = (e: unknown) => (e as { code?: string } | null)?.code === "P2002";

/** Idempotent on (userId, clientRequestId). Throws only on a store failure (the caller maps it to HISTORY_UNAVAILABLE). */
async function ensureHistory(h: CoachHistoryPort, a: { userId: string; clientRequestId: string; question: string; outcome: StoredOutcome }): Promise<EnsureResult> {
  const { userId, clientRequestId, question, outcome } = a;
  const same = (t: HistoryTurn) => t.question.trim() === question.trim() && (!t.sessionId || t.sessionId === outcome.sessionId) && (!t.userId || t.userId === userId);
  const prior = await h.findTurnByClientRequestId(userId, clientRequestId);
  if (prior) return same(prior) ? "already_recorded" : "conflict";
  let session = await h.findSession(outcome.sessionId);
  if (!session) {
    try { await h.createSession({ id: outcome.sessionId, userId, title: question.trim().slice(0, 60) }); }
    catch (e) { if (!isUniqueViolation(e)) throw e; }
    session = await h.findSession(outcome.sessionId);
  }
  if (!session || session.userId !== userId || session.archivedAt) return "conflict";
  try {
    await h.createTurn({
      userId, sessionId: outcome.sessionId, clientRequestId, question, answer: outcome.answer,
      modelUsed: V2_ENGINE_MARKER, responseTime: outcome.responseTimeSec,
      promptTokens: 0, completionTokens: 0, totalTokens: 0, cost: 0,
      ...(outcome.traceId ? { traceId: outcome.traceId } : {}),
      usedFallback: false, usedDeterministicFallback: false, warningCount: 0,
    });
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    const winner = await h.findTurnByClientRequestId(userId, clientRequestId);
    if (!winner) throw e;
    return same(winner) ? "already_recorded" : "conflict";
  }
  await h.touchSession(outcome.sessionId).catch(() => undefined); // best effort, like V1
  return "recorded";
}

// ── orchestrator ─────────────────────────────────────────────────────────────────────────────────────────────────────────
export type CoachTurnInput = Omit<CoachRequestFacts, "sessionAffinity">;
export interface CoachTurnDeps extends CoachBridgeDeps {
  idempotency?: CoachIdempotencyStore;
  history?: CoachHistoryPort;
  /** H1 / D-P12: also persist PARTIAL answers. Default false. */
  persistPartial?: boolean;
  newSessionId?: () => string;
  now?: () => number;
}

export type BoundaryOutcome =
  | "SESSION_NOT_FOUND"     // supplied sessionId missing / not own / archived (same answer for all)
  | "IN_PROGRESS"           // a concurrent duplicate is being processed
  | "KEY_CONFLICT"          // same key, different action
  | "IN_DOUBT"              // a previous attempt of this key failed mid-turn; execution state unknown
  | "STORE_UNAVAILABLE"     // idempotency / history read could not be done; nothing was run
  | "STATE_RECORD_FAILED"   // V2 ran but its result could not be recorded; retry gets IN_DOUBT, V2 is never re-run
  | "HISTORY_UNAVAILABLE";  // V2 answered and the result is stored, but history could not be written; retry with the SAME key re-drives it
export interface BoundaryResult { handler: "boundary"; outcome: BoundaryOutcome; fallbackAllowed: false; sessionId?: string }
export type V2TurnResult = V2Outcome & { sessionId?: string; replayed: boolean; historyRecorded: boolean };
export type CoachTurnResult = V1Handoff | BoundaryResult | V2TurnResult;

const boundary = (outcome: BoundaryOutcome, sessionId?: string): BoundaryResult => ({ handler: "boundary", outcome, fallbackAllowed: false, ...(sessionId ? { sessionId } : {}) });
const toStored = (o: V2Outcome, sessionId: string, responseTimeSec: number): StoredOutcome => ({
  kind: o.kind, status: o.status, ...(o.block ? { block: o.block } : {}), answer: o.answer, executedAgents: [...o.executedAgents],
  ...(o.turnId ? { turnId: o.turnId } : {}), ...(o.traceId ? { traceId: o.traceId } : {}), sessionId, responseTimeSec,
});
const validRecord = (r: IdempotencyRecord | undefined | null): r is IdempotencyRecord =>
  !!r && typeof r.fingerprint === "string" && (r.state === "IN_PROGRESS" || r.state === "IN_DOUBT" || (r.state === "COMPLETED" && typeof r.outcome?.answer === "string" && typeof r.outcome?.sessionId === "string" && !!r.outcome.kind));

export async function runCoachTurn(input: CoachTurnInput, deps: CoachTurnDeps = {}): Promise<CoachTurnResult> {
  const now = deps.now ?? Date.now;
  // 1. cheap pre-decision with NO I/O: flag off / not an end user / V1-only capability / no valid key … → V1 untouched
  const pre = decideCoachRoute({ ...input, sessionAffinity: "none" }, deps);
  if (pre.route === "v1") { deps.trace?.({ route: "v1", reason: pre.reason }); return { handler: "v1", reason: pre.reason, v2Attempted: false }; }
  const { idempotency, history, executor } = deps;
  if (!idempotency || !history) { deps.trace?.({ route: "v1", reason: "CONTINUITY_NOT_CONFIGURED" }); return { handler: "v1", reason: "CONTINUITY_NOT_CONFIGURED", v2Attempted: false }; }
  if (!executor) { deps.trace?.({ route: "v1", reason: "V2_NOT_STARTED" }); return { handler: "v1", reason: "V2_NOT_STARTED", v2Attempted: false }; }
  const clientRequestId = input.clientRequestId as string; // validated by decideCoachRoute
  const userId = input.userId;
  const fingerprint = coachActionFingerprint(input);

  // 2. session ownership + affinity (read-only; nothing is claimed or run yet)
  let affinity: CoachRequestFacts["sessionAffinity"] = "none";
  if (input.sessionId) {
    try {
      const s = await history.findSession(input.sessionId);
      if (!s || s.userId !== userId || s.archivedAt) return boundary("SESSION_NOT_FOUND");
      const engines = await history.listSessionTurnEngines(userId, input.sessionId);
      affinity = engines.length === 0 ? "none" : engines.every((m) => m === V2_ENGINE_MARKER) ? "v2" : "v1";
    } catch { return boundary("STORE_UNAVAILABLE"); }
  }
  const final = decideCoachRoute({ ...input, sessionAffinity: affinity }, deps);
  if (final.route === "v1") { deps.trace?.({ route: "v1", reason: final.reason }); return { handler: "v1", reason: final.reason, v2Attempted: false }; }

  // 3. atomic claim (I3 / I5)
  let claim: Awaited<ReturnType<CoachIdempotencyStore["claim"]>>;
  try { claim = await idempotency.claim(userId, clientRequestId, fingerprint); } catch { return boundary("STORE_UNAVAILABLE"); }
  if (!claim.claimed) {
    const rec = claim.record;
    if (!validRecord(rec)) return boundary("STORE_UNAVAILABLE"); // corrupt / unknown state: never guess
    if (rec.fingerprint !== fingerprint) return boundary("KEY_CONFLICT");
    if (rec.state === "IN_PROGRESS") return boundary("IN_PROGRESS");
    if (rec.state === "IN_DOUBT") return boundary("IN_DOUBT");
    // COMPLETED: replay the stored result. V2 is NOT called. A history write that did not finish is re-driven (H4).
    const out = rec.outcome;
    const v2: V2Outcome = { handler: "v2", kind: out.kind, status: out.status, ...(out.block ? { block: out.block } : {}), answer: out.answer, executedAgents: [...out.executedAgents], ...(out.turnId ? { turnId: out.turnId } : {}), ...(out.traceId ? { traceId: out.traceId } : {}), fallbackAllowed: false };
    return finishWithHistory(v2, out, { userId, clientRequestId, question: input.question, suppliedSessionId: input.sessionId }, history, deps, true);
  }

  // 4. run V2 exactly once (clientRequestId is NOT passed on; the bridge builds the strict V2 input from question/session only)
  const sessionId = input.sessionId ?? (deps.newSessionId ?? randomUUID)();
  const started = now();
  const { clientRequestId: _omitted, ...v2Facts } = input;
  void _omitted;
  const res = await dispatchV2({ ...v2Facts, sessionId, sessionAffinity: affinity }, deps);
  const elapsed = Math.max(0, (now() - started) / 1000);

  if (res.handler === "v1") {
    // V2 provably did not process anything: free the claim so V1 / a later attempt is not blocked by it
    await idempotency.release(userId, clientRequestId, fingerprint).catch(() => undefined);
    return res;
  }
  if (res.thrown) {
    await idempotency.markInDoubt(userId, clientRequestId, fingerprint).catch(() => undefined); // best effort; IN_PROGRESS is equally non-retryable
    return { ...res, ...(input.sessionId ? { sessionId: input.sessionId } : {}), replayed: false, historyRecorded: false };
  }
  const stored = toStored(res, sessionId, elapsed);
  try { await idempotency.complete(userId, clientRequestId, fingerprint, stored); } catch { return boundary("STATE_RECORD_FAILED"); }
  return finishWithHistory(res, stored, { userId, clientRequestId, question: input.question, suppliedSessionId: input.sessionId }, history, deps, false);
}

async function finishWithHistory(
  v2: V2Outcome, stored: StoredOutcome, a: { userId: string; clientRequestId: string; question: string; suppliedSessionId?: string },
  history: CoachHistoryPort, deps: CoachTurnDeps, replayed: boolean,
): Promise<CoachTurnResult> {
  // the session id is exposed only when it denotes a real conversation: the one the client already owned, or one just persisted
  if (!shouldRecordHistory(v2, deps.persistPartial === true)) {
    return { ...v2, ...(a.suppliedSessionId ? { sessionId: a.suppliedSessionId } : {}), replayed, historyRecorded: false };
  }
  try {
    const r = await ensureHistory(history, { userId: a.userId, clientRequestId: a.clientRequestId, question: a.question, outcome: stored });
    if (r === "conflict") return boundary("HISTORY_UNAVAILABLE");
    return { ...v2, sessionId: stored.sessionId, replayed, historyRecorded: true };
  } catch {
    return boundary("HISTORY_UNAVAILABLE");
  }
}
