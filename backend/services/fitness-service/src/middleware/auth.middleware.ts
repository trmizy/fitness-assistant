import { Request, Response, NextFunction } from "express";
import { logger, readGatewayVerifiedUser } from "@gym-coach/shared";
import { authServiceClient } from "../clients/auth-service.client";

export interface AuthRequest extends Request {
  user?: { id: string; email: string; role: string };
}

function extractHeader(req: Request, name: string): string | undefined {
  const value = req.headers[name];
  if (Array.isArray(value)) return value[0];
  return value;
}

function assignInternalUser(req: AuthRequest): boolean {
  const rawUserId = extractHeader(req, "x-user-id");
  if (!rawUserId || rawUserId.trim() === "") {
    return false;
  }

  req.user = {
    id: rawUserId.trim(),
    email: extractHeader(req, "x-user-email") || "",
    role: extractHeader(req, "x-user-role") || "CUSTOMER",
  };
  return true;
}

export async function authMiddleware(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) {
  // Security review 2026-09-03 (H1) — fast path: skip the auth-service round-trip entirely
  // when the gateway already verified this request (see gatewayTrust.ts's own docstring for
  // the full reasoning). Falls through to the original HTTP-verify below for anything not
  // carrying a valid gateway secret — local dev hitting this service's own published port
  // directly, tests, or a misconfigured deployment all still work exactly as before.
  const verified = readGatewayVerifiedUser(req.headers);
  if (verified) {
    req.user = verified;
    return next();
  }

  try {
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (!token) {
      return res.status(401).json({ error: "No token provided" });
    }

    // authServiceClient (not a raw axios call) so this keeps working under the Lambda-invoke
    // path too, not just plain HTTP — see auth-service.client.ts.
    const response = await authServiceClient.verifyToken(`Bearer ${token}`);
    req.user = response.user;
    return next();
  } catch (error) {
    logger.error("Auth verification failed:", error);
    return res.status(401).json({ error: "Invalid token" });
  }
}

export function internalAuthMiddleware(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) {
  const secret = process.env.INTERNAL_SERVICE_SECRET;
  const isDev = process.env.NODE_ENV !== "production";

  if (!secret) {
    if (!isDev) {
      return res
        .status(500)
        .json({ error: "Service authentication is not configured" });
    }

    if (!assignInternalUser(req)) {
      return res.status(401).json({ error: "Missing x-user-id header" });
    }

    logger.warn(
      { path: req.path },
      "INTERNAL_SERVICE_SECRET not set — trusting x-user-id without token validation (dev mode only)",
    );
    return next();
  }

  const internalToken = extractHeader(req, "x-internal-token");
  if (internalToken !== secret) {
    return res.status(401).json({
      error: "Request must originate from a trusted internal service",
    });
  }

  if (!assignInternalUser(req)) {
    return res
      .status(401)
      .json({ error: "Missing user identity in internal headers" });
  }

  return next();
}
