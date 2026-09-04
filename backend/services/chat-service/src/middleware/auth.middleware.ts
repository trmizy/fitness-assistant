import { Request, Response, NextFunction } from "express";
import axios from "axios";
import { logger, readGatewayVerifiedUser } from "@gym-coach/shared";

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
    const authServiceUrl =
      process.env.AUTH_SERVICE_URL || "http://localhost:3001";

    const { data } = await axios.post(
      `${authServiceUrl}/auth/verify`,
      {},
      { headers: { Authorization: `Bearer ${token}` }, timeout: 5000 },
    );

    req.user = data.user;
    return next();
  } catch (error) {
    if (axios.isAxiosError(error) && error.code === "ECONNREFUSED") {
      return res.status(503).json({ error: "Auth service unavailable" });
    }
    logger.error(error, "Auth middleware error");
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}
