import { Request, Response, NextFunction } from 'express';
import axios from 'axios';
import { logger } from '@gym-coach/shared';

export interface AuthUser {
  userId: string;
  role: string;
  email: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser | null;
    }
  }
}

const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://localhost:3001';

/**
 * Verifies the caller's JWT directly against auth-service — the same
 * pattern fitness-service/user-service/chat-service already use for their
 * public, gateway-facing routes (see fitness-service's authMiddleware).
 *
 * This REPLACES the previous behavior of trusting x-user-id/x-user-role
 * headers directly off the incoming request. Those are ordinary HTTP
 * headers any caller can set, and payment-service's port is published
 * directly on the host in docker-compose.dev.yml — combined with the
 * wallet top-up endpoint's MOCK provider, bypassing the gateway and setting
 * x-user-id by hand would previously have let anyone credit ANY wallet with
 * fake money. Verifying the JWT independently means an attacker needs a
 * real, valid token for the specific identity they want to act as — not
 * just knowledge of a header name — regardless of how the request reached
 * this service.
 *
 * Every call site in this service chains `extractUser` immediately with
 * `requireAuth` (never used for "optional auth" alone), so combining
 * identity-extraction and verification into one network call here doesn't
 * change any route's externally-visible behavior.
 */
export async function extractUser(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    req.user = null;
    next();
    return;
  }

  const token = authHeader.substring(7);
  try {
    const { data } = await axios.post(
      `${AUTH_SERVICE_URL}/auth/verify`,
      {},
      { headers: { Authorization: `Bearer ${token}` }, timeout: 5000 },
    );
    const payload = data?.user;
    req.user = payload?.id
      ? { userId: payload.id, role: payload.role ?? '', email: payload.email ?? '' }
      : null;
    next();
  } catch (error) {
    logger.warn({ err: (error as Error).message }, '[payment-service] token verification failed');
    req.user = null;
    next();
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.user?.userId) {
    res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
    return;
  }
  next();
}

export function requireRoles(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user?.userId || !roles.includes(req.user.role)) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } });
      return;
    }
    next();
  };
}
