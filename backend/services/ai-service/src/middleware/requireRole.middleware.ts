import { Request, Response, NextFunction } from "express";

/**
 * Role guard middleware for ai-service.
 *
 * Security assumption: ai-service trusts the `x-user-role` header injected by
 * the API gateway. This is safe ONLY when ai-service is not directly accessible
 * from the public internet (port should not be publicly exposed in production).
 * In dev, port 3003 is exposed for convenience — do not spoof x-user-role in prod.
 */
export function requireRole(roles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!roles.includes(req.context?.role)) {
      res.status(403).json({ error: "Insufficient role" });
      return;
    }
    next();
  };
}
