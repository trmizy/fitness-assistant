import type { NextFunction, Request, Response } from 'express';

/**
 * Owner / admin / preview responses are per-user and may carry drafts or presigned photo URLs: never cached anywhere
 * (plan §12.7: `Cache-Control: no-store, private` + `Vary: Authorization`). The gateway adds no cache of its own.
 */
export function noStorePrivate(_req: Request, res: Response, next: NextFunction): void {
  res.set('Cache-Control', 'no-store, private');
  res.set('Vary', 'Authorization');
  next();
}
