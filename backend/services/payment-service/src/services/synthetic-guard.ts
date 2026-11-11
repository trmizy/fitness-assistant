import type { Response } from 'express';
import { z } from 'zod';

/**
 * Seed-discovery Dot X — defense-in-depth internal guard for `payment-service`.
 * Trusted service callers (`user-service`, `gym-service`) forward `entityOrigin`
 * read from their authoritative DB rows; any `'SYNTHETIC'` payload is refused
 * with `409 SYNTHETIC_RECORD_NOT_TRANSACTABLE` before any ledger or gateway write.
 * Callers omitting `entityOrigin` keep legacy behaviour so isolated tests remain unchanged.
 */

export const SYNTHETIC_RECORD_NOT_TRANSACTABLE = 'SYNTHETIC_RECORD_NOT_TRANSACTABLE';

export const entityOriginSchema = z.enum(['REAL', 'SYNTHETIC']).optional();

export function rejectIfSyntheticOrigin(entityOrigin: string | undefined, res: Response): boolean {
  if (entityOrigin === 'SYNTHETIC') {
    res.status(409).json({
      success: false,
      error: {
        code: SYNTHETIC_RECORD_NOT_TRANSACTABLE,
        message: 'Dữ liệu mẫu (SYNTHETIC) không được phép thực hiện giao dịch tài chính',
      },
    });
    return true;
  }
  return false;
}
