import { Response } from 'express';
import { logger } from '@gym-coach/shared';
import { InsufficientBalanceError, WalletNotActiveError } from '../services/wallet.service';

/**
 * G-13 - one mapping from a thrown error to the withdrawal write endpoints' error envelope
 * `{ success:false, error:{ code, message? } }` (web and mobile parse exactly this shape).
 *
 *   InsufficientBalanceError  -> 409 INSUFFICIENT_BALANCE (fixed Vietnamese message)
 *   WalletNotActiveError      -> 409 WALLET_NOT_ACTIVE    (fixed Vietnamese message)
 *   service error {status 4xx, code} -> that status and code, with the service's own (Vietnamese) message
 *   anything else (Prisma, TypeError, 5xx...) -> 500 INTERNAL_ERROR with a fixed message.
 *     err.message is NEVER sent to the client; it is logged instead.
 */
export const ADMIN_INTERNAL_ERROR_MESSAGE = 'Hệ thống gặp lỗi khi xử lý. Hãy tải lại trạng thái để kiểm tra trước khi thử lại.';
export const ADMIN_INSUFFICIENT_BALANCE_MESSAGE = 'Số dư khả dụng của ví không đủ để thực hiện thao tác này.';
export const ADMIN_WALLET_NOT_ACTIVE_MESSAGE = 'Ví hiện không hoạt động nên không thể thực hiện thao tác này.';

export interface AdminErrorBody {
  success: false;
  error: { code: string; message?: string };
}

export function mapAdminWriteError(e: unknown): { status: number; body: AdminErrorBody } {
  const name = (e as { name?: string } | null)?.name;
  if (e instanceof InsufficientBalanceError || name === 'InsufficientBalanceError') {
    return { status: 409, body: { success: false, error: { code: 'INSUFFICIENT_BALANCE', message: ADMIN_INSUFFICIENT_BALANCE_MESSAGE } } };
  }
  if (e instanceof WalletNotActiveError || name === 'WalletNotActiveError') {
    return { status: 409, body: { success: false, error: { code: 'WALLET_NOT_ACTIVE', message: ADMIN_WALLET_NOT_ACTIVE_MESSAGE } } };
  }
  const known = e as { status?: unknown; code?: unknown; message?: unknown } | null;
  if (
    known &&
    typeof known.status === 'number' &&
    known.status >= 400 &&
    known.status < 500 &&
    typeof known.code === 'string' &&
    known.code.length > 0
  ) {
    return {
      status: known.status,
      body: { success: false, error: { code: known.code, ...(typeof known.message === 'string' ? { message: known.message } : {}) } },
    };
  }
  return { status: 500, body: { success: false, error: { code: 'INTERNAL_ERROR', message: ADMIN_INTERNAL_ERROR_MESSAGE } } };
}

/** Sends the mapped error; an unknown error's real message goes to the log only. */
export function sendAdminWriteError(res: Response, e: unknown, context: string): Response {
  const mapped = mapAdminWriteError(e);
  if (mapped.status >= 500) {
    logger.error({ err: (e as Error | null)?.message, context }, '[payment-service] admin withdrawal write failed');
  }
  return res.status(mapped.status).json(mapped.body);
}
