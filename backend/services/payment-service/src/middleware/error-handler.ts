import { NextFunction, Request, Response } from 'express';
import { logger } from '@gym-coach/shared';
import { GENERIC_FAILURE_MESSAGE } from '../utils/safe-error';

/**
 * N13F-05 - the last-resort error middleware (mounted at the end of app.ts). Anything a route throws or rejects with
 * lands here (see utils/async-route-errors.ts) instead of crashing the process.
 *
 *   Prisma "database is out of connections / unreachable" (P1001, P1017, P2024, P2037)
 *                                   -> 503 SERVICE_BUSY (fixed Vietnamese message, Retry-After: 5)
 *   a service-owned 4xx { status, code, message }  -> that status / code / message (the Vietnamese text the service chose)
 *   a request-parsing 4xx (bad JSON, too large)    -> that status, code REQUEST_ERROR
 *   anything else                                  -> 500 INTERNAL_ERROR with a fixed message
 * err.message is NEVER sent to the client; it is logged. Envelope: { success:false, error:{ code, message } } - the one
 * the admin / wallet routes already answer with.
 */
export const SERVICE_BUSY_MESSAGE = 'Hệ thống đang quá tải, vui lòng thử lại sau ít giây.';
export const REQUEST_ERROR_MESSAGE = 'Yêu cầu không hợp lệ.';

const CONNECTION_CODES = new Set(['P1001', 'P1002', 'P1008', 'P1017', 'P2024', 'P2037']);

/** True for a Prisma error that means "the database could not be reached / has no free connection right now". */
export function isPrismaConnectionError(err: unknown): boolean {
  const e = err as { code?: unknown; errorCode?: unknown; name?: unknown } | null;
  if (!e || typeof e !== 'object') return false;
  // PrismaClientInitializationError = the client could not reach / start against the database (its errorCode is not always set, e.g. an unresolvable host).
  if (e.name === 'PrismaClientInitializationError') return true;
  return (
    (typeof e.code === 'string' && CONNECTION_CODES.has(e.code)) ||
    (typeof e.errorCode === 'string' && CONNECTION_CODES.has(e.errorCode))
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function apiErrorHandler(err: unknown, req: Request, res: Response, next: NextFunction): void {
  if (res.headersSent) {
    next(err);
    return;
  }
  const e = (err ?? {}) as { status?: unknown; statusCode?: unknown; code?: unknown; message?: unknown; type?: unknown };

  if (isPrismaConnectionError(err)) {
    logger.error(
      { err: String(e.message ?? ''), prismaCode: String(e.code ?? (err as { errorCode?: unknown }).errorCode ?? ''), method: req.method, path: req.path },
      '[payment-service] database unavailable',
    );
    res.set('Retry-After', '5');
    res.status(503).json({ success: false, error: { code: 'SERVICE_BUSY', message: SERVICE_BUSY_MESSAGE } });
    return;
  }

  const status = typeof e.status === 'number' ? e.status : typeof e.statusCode === 'number' ? e.statusCode : 500;
  if (status >= 400 && status < 500) {
    const serviceOwned = typeof e.code === 'string' && e.code.length > 0 && typeof e.message === 'string';
    res.status(status).json({
      success: false,
      error: serviceOwned
        ? { code: e.code as string, message: e.message as string }
        : { code: 'REQUEST_ERROR', message: REQUEST_ERROR_MESSAGE },
    });
    return;
  }

  logger.error({ err: String(e.message ?? ''), method: req.method, path: req.path }, '[payment-service] unhandled route error');
  res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: GENERIC_FAILURE_MESSAGE } });
}
