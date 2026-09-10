import { Request, Response, NextFunction } from "express";
import { logger } from "@gym-coach/shared";
import { authServiceClient, AuthServiceUnavailableError } from "../clients/auth-service.client";

export interface AuthRequest extends Request {
  user?: { id: string; email: string; role: string };
}

function installVerifiedIdentity(
  req: AuthRequest,
  user: { id: string; email?: string | null; role?: string | null },
): boolean {
  if (!user?.id) return false;

  const verifiedUser = {
    id: user.id,
    email: user.email ?? "",
    role: user.role ?? "CUSTOMER",
  };

  req.user = verifiedUser;

  // Legacy controllers in this service still read the gateway-injected headers.
  // In AWS Lambda/API Gateway, public browser traffic must not be allowed to
  // spoof those trusted headers. Rewrite them from Auth Service verification.
  delete req.headers["x-gateway-secret"];
  delete req.headers["x-internal-token"];
  delete req.headers["x-service-secret"];
  req.headers["x-user-id"] = verifiedUser.id;
  req.headers["x-user-email"] = verifiedUser.email;
  req.headers["x-user-role"] = verifiedUser.role;

  return true;
}

export async function authMiddleware(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).json({ error: "No token provided" });
    }

    const { data } = await authServiceClient.verifyToken(authHeader);

    if (!installVerifiedIdentity(req, data?.user)) {
      return res.status(401).json({ error: "Invalid or expired token" });
    }
    return next();
  } catch (error) {
    if (error instanceof AuthServiceUnavailableError) {
      return res.status(503).json({ error: "Auth service unavailable" });
    }
    // auth-service was reached and answered with a client-error status (401/403);
    // propagate that instead of collapsing a disabled-account 403 to 401.
    const status = (error as any)?.response?.status;
    if (typeof status === "number" && status >= 400 && status < 500) {
      const message = (error as any)?.response?.data?.error || "Invalid or expired token";
      return res.status(status).json({ error: message });
    }
    logger.error(error, "Auth middleware error");
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}
