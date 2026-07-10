import { Request, Response, NextFunction } from "express";
import { ZodSchema, ZodError, ZodTypeAny } from "zod";
import { formatErrorResponse } from "../errors/api-error";

/**
 * Returns an Express middleware that validates `req.body` against the given Zod schema.
 * On success the parsed (coerced) value replaces req.body.
 * On failure a structured 400 is returned immediately.
 */
export function validateBody<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      res
        .status(400)
        .json(
          formatErrorResponse("VALIDATION_ERROR", formatZodError(result.error)),
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
export function validateQuery(schema: ZodTypeAny) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      res
        .status(400)
        .json(
          formatErrorResponse("VALIDATION_ERROR", formatZodError(result.error)),
        );
      return;
    }
    // Cast: callers access validated query through req.query after this middleware.
    (req as any).query = result.data;
    next();
  };
}

function formatZodError(err: ZodError): string {
  return err.errors
    .map((e) => `${e.path.join(".") || "body"}: ${e.message}`)
    .join("; ");
}
