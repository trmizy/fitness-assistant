import { Request, Response, NextFunction } from "express";
import { logger, readGatewayVerifiedUser } from "@gym-coach/shared";
import { verifyToken } from "../clients/auth-service.client";

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

    const token = authHeader.substring(7);
    const data = await verifyToken(token);

    // Fail closed: only a verified identity continues. A 2xx answer that carries no user (a malformed or
    // misbehaving auth-service) is NOT "authenticated" - without this, req.user stayed undefined and the request
    // went on to the handler.
    if (!data?.user?.id) {
      return res.status(401).json({ error: "Invalid or expired token" });
    }

    req.user = data.user;
    return next();
  } catch (error) {
    // auth-service ANSWERED with a client error (invalid / expired token, disabled account): that is a verdict on
    // the token, so pass it on. Anything else - unreachable, timeout, DNS, 5xx, Lambda failure - means the token
    // could not be verified: refuse with 503 (never continue as authenticated).
    const status = (error as any)?.response?.status;
    if (typeof status === "number" && status >= 400 && status < 500) {
      const message = (error as any)?.response?.data?.error;
      return res.status(status === 403 ? 403 : 401).json({
        error: typeof message === "string" && message ? message : "Invalid or expired token",
      });
    }
    logger.error(error, "Auth middleware error: token could not be verified");
    return res.status(503).json({ error: "Auth service unavailable" });
  }
}
