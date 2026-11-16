/**
 * AI Coach V1/V2 bridge — HTTP boundary for POST /ai/ask (M9.2-T3). DEFAULT OFF.
 *
 * Mounted ONCE, as one extra handler inside the existing POST /ai/ask chain (routes/ai.routes.ts), i.e. after requireAuth, the
 * shared per-user ask rate limiter, AskRequestSchema validation and bindRequestIdentity. So a V2-served request has already
 * passed authentication, rate limiting and validation exactly like a V1 one; nothing here re-implements them. POST
 * /ai/ask/stream is NOT bridged (V2 has no SSE): it stays V1 with no code path to this file.
 *
 *   flag OFF (default)            → next() on the first line: V1 runs byte-for-byte as before, nothing is read or loaded.
 *   flag ON, request not eligible → next(): V1 (see coach-v2-bridge.ts decideCoachRoute for the full list).
 *   flag ON, eligible             → coach-v2-continuity.ts runCoachTurn: idempotency claim → V2 executor (the SAME runtime as
 *                                   POST /ai/v2/ask) → history. The response is built here; V1's controller is NOT run.
 *   V2 started but gave a block / failure → the response says so; V1 is NEVER used to obtain another answer (safety invariant).
 *
 * Wiring that does not exist in production on purpose (so enabling the flag alone can never reach V2):
 *   - `seam.ports` (idempotency store + history repository): no production implementation exists yet (D-P11 / D-P13). Absent →
 *     CONTINUITY_NOT_CONFIGURED → V1. Tests inject fakes here.
 *   - `seam.loadExecutor`: registered by routes/ai-v2.routes.ts; loads the V2 runtime lazily, only after every gate passed.
 *
 * Capability selection uses V1's own deterministic classifiers (no model): a question goes to V2 only when it is a plain QUESTION
 * (classifyAgentTurnAct) AND V1's fitness agent would not recognise an action intent (parseFitnessAgentIntent). Commands,
 * requests, confirmations, statements of intent and anything the V1 agent parses stay on V1 — so confirmed-write workflows
 * and their continuations are never turned into V2 operations. This is a conservative gate, not a proof of read-only: any
 * doubt leaves the request on V1.
 */
import type { NextFunction, Request, Response } from "express";
import { logger } from "@gym-coach/shared";
import { formatErrorResponse } from "../errors/api-error";
import { classifyAgentTurnAct } from "./agent-turn-act";
import { isMealLogQuestion, isWorkoutHistoryPeriodQuestion } from "./coach-capability-preflight";
import { parseFitnessAgentIntent } from "./fitness-agent-intent";
import { isCoachBridgeEnabled, type CoachCapability, type V2Executor } from "./coach-v2-bridge";
import {
  runCoachTurn, type BoundaryResult, type CoachHistoryPort, type CoachIdempotencyStore, type CoachTurnDeps, type CoachTurnInput, type V2TurnResult,
} from "./coach-v2-continuity";

export interface CoachBridgeSeam {
  /** Registered by routes/ai-v2.routes.ts. Null → V2 unreachable → V1. */
  loadExecutor: (() => Promise<V2Executor>) | null;
  /** No production implementation (D-P11 idempotency store, D-P13 history adapter). Null → CONTINUITY_NOT_CONFIGURED → V1. */
  ports: { idempotency: CoachIdempotencyStore; history: CoachHistoryPort } | null;
  /** TEST ONLY (never set by production code): replaces enabled / allowlist / clock / ids / persistPartial / trace. */
  overrides: Partial<Pick<CoachTurnDeps, "enabled" | "userAllowed" | "now" | "newSessionId" | "persistPartial" | "trace">>;
}
export const coachBridgeSeam: CoachBridgeSeam = { loadExecutor: null, ports: null, overrides: {} };

/** Cheap, synchronous, no I/O. V2-eligible only for a plain information-seeking question (everything else → V1). */
export function classifyCoachCapability(question: string): CoachCapability {
  try {
    if (parseFitnessAgentIntent(question).kind) return "AGENT_WRITE_WORKFLOW";
    if (classifyAgentTurnAct(question) !== "QUESTION") return "AGENT_WRITE_WORKFLOW";
    // capabilities V2 is KNOWN to lack (M9.4-T2 preflight): decided here, before any V2 work
    if (isMealLogQuestion(question)) return "MEAL_HISTORY";
    if (isWorkoutHistoryPeriodQuestion(question)) return "WORKOUT_HISTORY_PERIOD";
    return "CHAT_READONLY_QA";
  } catch {
    return "UNKNOWN";
  }
}

// ── response mapping: V2 states are preserved, never coerced into an answer ─────────────────────────────────────────────
export interface CoachHttpResponse { status: number; body: unknown; headers?: Record<string, string> }

const err = (status: number, code: Parameters<typeof formatErrorResponse>[0], message: string, headers?: Record<string, string>): CoachHttpResponse =>
  ({ status, body: formatErrorResponse(code, message), ...(headers ? { headers } : {}) });
const UNAVAILABLE = "The assistant is temporarily unavailable. Please try again shortly.";

export function mapBoundary(b: BoundaryResult, sessionId?: string): CoachHttpResponse {
  switch (b.outcome) {
    case "SESSION_NOT_FOUND": return err(404, "SESSION_NOT_FOUND", `Session ${sessionId ?? ""} not found`.replace("  ", " "));
    case "IN_PROGRESS": return err(409, "OPERATION_IN_PROGRESS", "This message is already being processed.", { "Retry-After": "2" });
    case "KEY_CONFLICT": return err(409, "IDEMPOTENCY_KEY_CONFLICT", "This request id was already used for a different message.");
    // a previous attempt of this exact action failed part-way: it is never re-run, the user must send the message again (new id)
    case "IN_DOUBT": return err(409, "IDEMPOTENCY_KEY_CONFLICT", "This request could not be completed. Please send your message again.");
    default: return err(503, "SERVICE_UNAVAILABLE", UNAVAILABLE); // STORE_UNAVAILABLE / STATE_RECORD_FAILED / HISTORY_UNAVAILABLE
  }
}

export function mapV2(r: V2TurnResult, question: string): CoachHttpResponse {
  // an error thrown mid-turn carries no answer: never invent one
  if (r.thrown || (r.kind === "unavailable" && !r.answer)) return err(503, "SERVICE_UNAVAILABLE", UNAVAILABLE);
  const v2: Record<string, unknown> = {
    status: r.status, kind: r.kind, ...(r.block ? { block: r.block } : {}), agents: r.executedAgents,
    ...(r.turnId ? { turnId: r.turnId } : {}), ...(r.traceId ? { traceId: r.traceId } : {}),
    replayed: r.replayed, historyRecorded: r.historyRecorded,
  };
  return {
    status: 200,
    body: { success: true, data: { question, answer: r.answer, ...(r.sessionId ? { sessionId: r.sessionId } : {}), engine: "multi-agent-v2", v2 } },
  };
}

export function coachBridgeAsk(req: Request, res: Response, next: NextFunction): void {
  const { overrides } = coachBridgeSeam;
  // OFF by default: the first statement, synchronous, reads nothing from the request and loads nothing.
  if (!(overrides.enabled ?? (() => isCoachBridgeEnabled()))()) { next(); return; }
  void handleEnabled(req, res, next, overrides);
}

async function handleEnabled(req: Request, res: Response, next: NextFunction, overrides: CoachBridgeSeam["overrides"]): Promise<void> {
  const body = (req.body ?? {}) as { question?: unknown; sessionId?: unknown; clientRequestId?: unknown };
  const question = typeof body.question === "string" ? body.question : "";
  let result: Awaited<ReturnType<typeof runCoachTurn>>;
  try {
    const ctx = req.context;
    const input: CoachTurnInput = {
      capability: classifyCoachCapability(question), transport: "json",
      userId: ctx?.userId ?? "", callerKind: ctx?.callerKind,
      hasUserBearer: typeof ctx?.authorizationHeader === "string" && ctx.authorizationHeader.startsWith("Bearer "),
      question,
      ...(typeof body.sessionId === "string" ? { sessionId: body.sessionId } : {}),
      ...(typeof body.clientRequestId === "string" ? { clientRequestId: body.clientRequestId } : {}),
      ...(typeof ctx?.authorizationHeader === "string" ? { authorizationHeader: ctx.authorizationHeader } : {}),
    };
    const loader = coachBridgeSeam.loadExecutor;
    let executor: Promise<V2Executor> | null = null;
    const deps: CoachTurnDeps = {
      ...overrides,
      trace: overrides.trace ?? ((e) => logger.info({ coachBridge: e }, "coach_bridge_decision")), // codes only: no user id / text / bearer
      // lazy: the runtime is imported only when runCoachTurn actually dispatches (after every gate and the idempotency claim)
      ...(loader ? { executor: { ask: async (i) => (await (executor ??= loader())).ask(i) } } : {}),
      ...(coachBridgeSeam.ports ?? {}),
    };
    result = await runCoachTurn(input, deps);
  } catch {
    // an unexpected failure at the boundary: we cannot know whether V2 ran → fail closed (no V1 retry, no detail)
    res.status(503).json(formatErrorResponse("SERVICE_UNAVAILABLE", UNAVAILABLE));
    return;
  }
  if (result.handler === "v1") { next(); return; }
  const http = result.handler === "boundary"
    ? mapBoundary(result, typeof body.sessionId === "string" ? body.sessionId : undefined)
    : mapV2(result, question);
  for (const [k, v] of Object.entries(http.headers ?? {})) res.setHeader(k, v);
  res.status(http.status).json(http.body);
}
