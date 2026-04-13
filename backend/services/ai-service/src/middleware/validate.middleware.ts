import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';
import { formatErrorResponse } from '../errors/api-error';

/**
 * Returns an Express middleware that validates `req.body` against the given Zod schema.
 * On success the parsed (coerced) value replaces req.body.
 * On failure a structured 400 is returned immediately.
 */
export function validateBody<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json(
        formatErrorResponse('VALIDATION_ERROR', formatZodError(result.error)),
      );
      return;
    }
    req.body = result.data;
    next();
  };
}

/**
 * Returns an Express middleware that validates `req.query` against the given Zod schema.
 */
export function validateQuery<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      res.status(400).json(
        formatErrorResponse('VALIDATION_ERROR', formatZodError(result.error)),
      );
      return;
    }
    // Cast: callers access validated query through req.query after this middleware.
    (req as Request & { query: T }).query = result.data as unknown as typeof req.query;
    next();
  };
}

function formatZodError(err: ZodError): string {
  return err.errors
    .map((e) => `${e.path.join('.') || 'body'}: ${e.message}`)
    .join('; ');
}
