import { NextFunction, Request, Response } from 'express';
import { ZodSchema } from 'zod';

/**
 * Vòng 4 / Phase B — brand/gym/plan create-update routes forwarded req.body straight to the
 * service layer with little to no validation (see brand/gym/plan.schemas.ts for what each one
 * was missing). This runs a Zod schema at the route layer, before any controller/service code
 * sees the body: on failure, responds 400 with the schema's own Vietnamese, field-naming
 * message instead of letting bad data (price=-100000, durationDays=0, blank name, ...) reach
 * Prisma; on success, req.body is replaced with the parsed data (trimmed strings, coerced
 * types) so downstream code gets exactly what the schema validated.
 */
export function validateBody(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0];
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: firstIssue?.message ?? 'Dữ liệu không hợp lệ' },
      });
    }
    req.body = parsed.data;
    return next();
  };
}
