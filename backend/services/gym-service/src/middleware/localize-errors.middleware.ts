import type { NextFunction, Request, Response } from 'express';
import { logger } from '@gym-coach/shared';
import { localizeErrorBody } from '../utils/error-messages.vi';

/**
 * N09C-02 / N-A-01: every JSON error response of gym-service passes through `localizeErrorBody` (see utils/error-messages.vi.ts) just before
 * it is written: user-facing messages are Vietnamese with the error code kept, and a 5xx never carries Prisma text, a file path or a stack line.
 * Mounted once in app.ts, right after the body parser, so it covers every router (owner, client, pt, admin, internal) and the Lambda entry.
 */
export function localizeErrors(req: Request, res: Response, next: NextFunction): void {
  const json = res.json.bind(res);
  res.json = ((body?: unknown) => {
    let out = body;
    try {
      out = localizeErrorBody(res.statusCode, body, (original) => logger.error({ path: req.path, original }, 'gym-service: 5xx message withheld from the client'));
    } catch {
      out = body;
    }
    return json(out);
  }) as Response['json'];
  next();
}
