import { Request, Response, NextFunction } from "express";
import { logger, readGatewayVerifiedUser } from "@gym-coach/shared";
import { authServiceClient, AuthServiceUnavailableError } from "../clients/auth-service.client";

export interface AuthRequest extends Request {
  user?: { id: string; email: string; role: string };
}

export async function authMiddleware(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) {
  // Security review 2026-09-03 (H1) — fast path: skip the auth-service round-trip entirely
  // when the gateway already verified this request (see gatewayTrust.ts's own docstring for
  // the full reasoning). Falls through to the original HTTP-verify below for anything not
  // carrying a valid gateway secret.
  const verified = readGatewayVerifiedUser(req.headers);
  if (verified) {
    req.user = verified;
    return next();
  }

  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).json({ error: "No token provided" });
    }

    const { data } = await authServiceClient.verifyToken(authHeader);

    req.user = data.user;
    return next();
  } catch (error) {
    if (error instanceof AuthServiceUnavailableError) {
      return res.status(503).json({ error: "Auth service unavailable" });
    }
    // auth-service was reached and answered with a client-error status (401 today; propagate
    // whatever it says rather than collapsing it, in case that ever includes 403) — anything
    // without a recognizable status shape falls through to the same generic 401 this always
    // returned for an unrecognized failure.
    const status = (error as any)?.response?.status;
    if (typeof status === "number" && status >= 400 && status < 500) {
      const message = (error as any)?.response?.data?.error || "Invalid or expired token";
      return res.status(status).json({ error: message });
    }
    logger.error(error, "Auth middleware error");
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}
