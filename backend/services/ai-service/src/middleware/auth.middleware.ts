/**
 * Auth middleware for ai-service.
 *
 * Trust model — two accepted callers, in this order:
 * ──────────────────────────────────────────────────────────────────────────────
 * 1. TRUSTED SERVICE / GATEWAY  (proves knowledge of INTERNAL_SERVICE_SECRET)
 *    Header `x-internal-token` matching INTERNAL_SERVICE_SECRET. Only then are
 *    `x-user-id` / `x-user-role` trusted as the caller's claim of identity.
 *    This keeps working for:
 *      - the Express gateway (docker/local deployments), and
 *      - genuine service-to-service calls that carry no end-user JWT at all,
 *        e.g. fitness-service calling POST /ai/analyze-cycle, /ai/assess-cycle,
 *        /ai/analyze-feedback, /ai/generate-client-plan-draft.
 *
 * 2. END USER  (proves possession of a real JWT)
 *    Header `Authorization: Bearer <JWT>`, verified against auth-service via
 *    AUTH_LAMBDA_NAME (direct Lambda Invoke) or AUTH_SERVICE_URL. Identity and
 *    role come from the VERIFIED token payload — never from `x-user-id` /
 *    `x-user-role`, which any caller can set. This is the path API Gateway
 *    uses when it invokes this Lambda directly, with no Express gateway in
 *    front to inject headers.
 *
 * A request presenting neither is rejected with 401. `x-user-id` on its own is
 * accepted ONLY when INTERNAL_SERVICE_SECRET is unset AND NODE_ENV is not
 * production — the pre-existing local-dev convenience, unchanged.
 *
 * When INTERNAL_SERVICE_SECRET is unset in production the service still fails
 * closed: `/internal/*` has no other gate, so a misconfigured deployment must
 * not be reachable.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import { Request, Response, NextFunction } from "express";
import { ApiError } from "../errors/api-error";
import { logger } from "@gym-coach/shared";
import { verifyToken } from "../clients/auth-service.client";

// Augment Express Request so every handler has strongly-typed context.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      context: {
        userId: string;
        /**
         * Caller's role. From the verified JWT on the Bearer path; from the
         * `x-user-role` header on the trusted-service path.
         */
        role: string;
        /** Original Authorization header — forwarded to profile/fitness calls */
        authorizationHeader?: string;
      };
    }
  }
}

function extractHeader(req: Request, name: string): string | undefined {
  const value = req.headers[name];
  if (Array.isArray(value)) return value[0];
  return value;
}

function bearerToken(req: Request): string | null {
  const header = extractHeader(req, "authorization");
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  return token || null;
}

export async function requireAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const secret = process.env.INTERNAL_SERVICE_SECRET;
  const isDev = process.env.NODE_ENV !== "production";
  const authorizationHeader = extractHeader(req, "authorization");

  // ── 1. Trusted service / gateway ────────────────────────────────────────
  if (secret && extractHeader(req, "x-internal-token") === secret) {
    const rawUserId = extractHeader(req, "x-user-id");
    if (!rawUserId || rawUserId.trim() === "") {
      return next(
        new ApiError(
          "UNAUTHORIZED",
          "Missing user identity in gateway headers",
          401,
        ),
      );
    }
    req.context = {
      userId: rawUserId.trim(),
      role: (extractHeader(req, "x-user-role") ?? "").trim(),
      authorizationHeader,
    };
    return next();
  }

  // ── 2. End user Bearer JWT, verified independently ──────────────────────
  const token = bearerToken(req);
  if (token) {
    try {
      const user = await verifyToken(token);
      if (!user?.id) {
        return next(new ApiError("UNAUTHORIZED", "Invalid or expired token", 401));
      }
      req.context = {
        userId: user.id,
        role: (user.role ?? "").trim(),
        authorizationHeader,
      };
      return next();
    } catch (error) {
      logger.warn(
        { err: (error as Error).message, path: req.path },
        "[ai-service] token verification failed",
      );
      return next(new ApiError("UNAUTHORIZED", "Invalid or expired token", 401));
    }
  }

  // ── 3. Local dev convenience (no secret configured, non-production) ─────
  if (!secret) {
    if (!isDev) {
      // Misconfigured production service — fail safe.
      return next(
        new ApiError(
          "INTERNAL_ERROR",
          "Service authentication is not configured",
          500,
        ),
      );
    }
    const rawUserId = extractHeader(req, "x-user-id");
    if (!rawUserId) {
      return next(
        new ApiError("UNAUTHORIZED", "Missing x-user-id header", 401),
      );
    }
    logger.warn(
      { path: req.path },
      "INTERNAL_SERVICE_SECRET not set — trusting x-user-id without token validation (dev mode only)",
    );
    req.context = {
      userId: rawUserId,
      role: (extractHeader(req, "x-user-role") ?? "").trim(),
      authorizationHeader,
    };
    return next();
  }

  return next(
    new ApiError(
      "UNAUTHORIZED",
      "Request must carry a valid Bearer token or originate from the API gateway",
      401,
    ),
  );
}
