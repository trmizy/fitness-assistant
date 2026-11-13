/**
 * POST /ai/v2/ask — the experimental Multi-Agent V2 endpoint (M7-P1, LOCAL INTEGRATION ONLY).
 *
 * Separate from /ai/ask: V1 routes, controllers and behaviour are untouched; nothing is forwarded, shadowed or
 * falls back between V1 and V2.
 *  1. Flag gate FIRST: agent-v2/flag isAgentV2HttpEnabled (flag exactly "on", and on NODE_ENV=production a second explicit
 *     owner approval). OFF → 404 as if the route did not exist; the Multi-Agent runtime is never imported or created.
 *  2. requireAuth (the same middleware as every /ai/* route).
 *  3. End users only: callerKind "user" (JWT verified by auth-service) or "gateway_user" (gateway secret + user bearer).
 *     A bare service call and the local-dev "trust x-user-id" convenience (callerKind "service") are refused — V2 reads
 *     the user's own data and needs a verified end-user identity plus the user's bearer for the profile read.
 *  4. Body: { question, sessionId? } only (strict). The user id always comes from req.context, never from the body.
 *  5. The runtime (agent-v2-integration/multi-agent-runtime.ts) is loaded with a dynamic import() after these gates.
 */
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.middleware";
import { askRateLimiter } from "../middleware/ai-rate-limiters";
import { validateBody } from "../middleware/validate.middleware";
import { ApiError, formatErrorResponse } from "../errors/api-error";

const AskV2Schema = z.object({
  question: z.string().trim().min(1).max(2_000),
  sessionId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).optional(),
}).strict();

async function v2FlagGate(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { isAgentV2HttpEnabled } = await import("../agent-v2/flag");
    if (!isAgentV2HttpEnabled()) {
      res.status(404).json(formatErrorResponse("NOT_FOUND", "Not found"));
      return;
    }
    next();
  } catch (err) {
    next(err);
  }
}

function requireVerifiedEndUser(req: Request, _res: Response, next: NextFunction): void {
  const kind = req.context?.callerKind;
  const bearer = typeof req.context?.authorizationHeader === "string" && req.context.authorizationHeader.startsWith("Bearer ");
  if ((kind !== "user" && kind !== "gateway_user") || !bearer) {
    next(new ApiError("FORBIDDEN", "This endpoint requires a signed-in user session", 403));
    return;
  }
  next();
}

async function askV2(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { getMultiAgentRuntime } = await import("../agent-v2-integration/multi-agent-runtime");
    const body = req.body as z.infer<typeof AskV2Schema>;
    const result = await getMultiAgentRuntime().ask({
      question: body.question,
      identity: { userId: req.context.userId, authorizationHeader: req.context.authorizationHeader },
      ...(body.sessionId ? { sessionId: body.sessionId } : {}),
    });
    res.status(200).json({
      success: true,
      data: {
        status: result.status,
        answer: result.answer,
        // M7-P5A.2.2: the agents that ACTUALLY RAN — never the planned / selected / deferred ones (a blocked turn lists none)
        agents: result.executedAgents ?? [],
        turnId: result.turnId,
        traceId: result.supervisorTraceId,
      },
    });
  } catch (err) {
    next(err);
  }
}

export function createAiV2Router(): Router {
  const router = Router();
  router.post("/ask", v2FlagGate, requireAuth, requireVerifiedEndUser, askRateLimiter, validateBody(AskV2Schema), askV2);
  return router;
}

export default createAiV2Router();
