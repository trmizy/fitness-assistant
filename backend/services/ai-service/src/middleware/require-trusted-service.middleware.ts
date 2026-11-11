import { Request, Response, NextFunction } from "express";
import { logger } from "@gym-coach/shared";
import { ApiError } from "../errors/api-error";

/**
 * Restricts a route to genuine service-to-service callers (fitness-service).
 *
 * MUST be mounted after `requireAuth`. The decision reads only `req.context.callerKind`, which
 * requireAuth derives from material a client cannot forge: a request is "service" only if it
 * proved INTERNAL_SERVICE_SECRET AND carries no end-user bearer. A header such as
 * `x-internal-token: <guess>` or `x-user-role: ADMIN` sent by a browser either fails the secret
 * comparison (then needs a valid JWT, making the caller "user") or, when it travels through the
 * Express gateway, arrives with the user's bearer attached ("gateway_user"). Neither is accepted
 * here. Comparing the secret alone would not work: the gateway stamps the same secret on every
 * /ai/* request it proxies for logged-in users.
 */
export function requireTrustedService(req: Request, _res: Response, next: NextFunction): void {
  if (req.context?.callerKind === "service") {
    next();
    return;
  }
  logger.warn(
    { path: req.path, callerKind: req.context?.callerKind ?? "unknown", userId: req.context?.userId },
    "[ai-service] service-only route refused a non-service caller",
  );
  next(new ApiError("FORBIDDEN", "This endpoint is restricted to internal services", 403));
}
