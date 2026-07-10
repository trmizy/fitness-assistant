import { Request, Response, NextFunction } from "express";
import axios from "axios";
import { logger } from "@gym-coach/shared";

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
  try {
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (!token) {
      return res.status(401).json({ error: "No token provided" });
    }

    const authServiceUrl =
      process.env.AUTH_SERVICE_URL || "http://localhost:3001";
    const response = await axios.post(
      `${authServiceUrl}/auth/verify`,
      {},
      {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 5000,
      },
    );
    req.user = response.data.user;
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
