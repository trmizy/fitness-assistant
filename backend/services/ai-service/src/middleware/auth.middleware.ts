/**
 * Auth middleware for ai-service.
 *
 * Trust model:
 * ──────────────────────────────────────────────────────────────────────────────
 * ai-service is intended to sit behind the API gateway.  The gateway:
 *   1. Validates the client's JWT.
 *   2. Extracts `sub` from the JWT and forwards it as the `x-user-id` header.
 *   3. Also forwards the original `Authorization` header so downstream services
 *      (user-service, fitness-service) can verify it for profile calls.
 *   4. Adds `x-internal-token: <INTERNAL_SERVICE_SECRET>` to prove the request
 *      originated from a trusted gateway, not a raw client.
 *
 * When INTERNAL_SERVICE_SECRET is configured:
 *   → Require x-internal-token to match; trust x-user-id from that request.
 *
 * When INTERNAL_SERVICE_SECRET is NOT configured AND NODE_ENV=development:
 *   → Trust x-user-id directly (local dev convenience).  A warning is logged.
 *
 * When INTERNAL_SERVICE_SECRET is NOT configured AND NODE_ENV=production:
 *   → Reject all requests — mis-configured service must not be reachable.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import { Request, Response, NextFunction } from 'express';
import { ApiError } from '../errors/api-error';
import { logger } from '@gym-coach/shared';

// Augment Express Request so every handler has strongly-typed context.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      context: {
        userId: string;
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

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const secret = process.env.INTERNAL_SERVICE_SECRET;
  const isDev = process.env.NODE_ENV !== 'production';

  if (!secret) {
    if (!isDev) {
      // Misconfigured production service — fail safe.
      return next(
        new ApiError('INTERNAL_ERROR', 'Service authentication is not configured', 500),
      );
    }
    // Development convenience: trust x-user-id without token validation.
    const rawUserId = extractHeader(req, 'x-user-id');
    if (!rawUserId) {
      return next(new ApiError('UNAUTHORIZED', 'Missing x-user-id header', 401));
    }
    logger.warn(
      { path: req.path },
      'INTERNAL_SERVICE_SECRET not set — trusting x-user-id without token validation (dev mode only)',
    );
    req.context = {
      userId: rawUserId,
      authorizationHeader: extractHeader(req, 'authorization'),
    };
    return next();
  }

  // Production path: validate the gateway token first.
  const internalToken = extractHeader(req, 'x-internal-token');
  if (internalToken !== secret) {
    return next(
      new ApiError('UNAUTHORIZED', 'Request must originate from the API gateway', 401),
    );
  }

  const rawUserId = extractHeader(req, 'x-user-id');
  if (!rawUserId || rawUserId.trim() === '') {
    return next(new ApiError('UNAUTHORIZED', 'Missing user identity in gateway headers', 401));
  }

  req.context = {
    userId: rawUserId.trim(),
    authorizationHeader: extractHeader(req, 'authorization'),
  };
  next();
}
