import { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * Wraps an async Express handler so a rejected promise is forwarded to
 * `next(err)` instead of becoming an unhandled promise rejection.
 *
 * Express 4 (this project's version) only auto-catches SYNCHRONOUS throws
 * inside a route handler — a rejected promise from an `async` handler with
 * no try/catch of its own is invisible to Express entirely. In modern
 * Node.js, an unhandled promise rejection terminates the process by
 * default, so a single transient DB error on an unguarded handler (several
 * existed in this service — see gym.controller.ts's listPublic, a PUBLIC,
 * unauthenticated, high-traffic endpoint) could crash the entire service
 * for every user, not just fail that one request.
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
