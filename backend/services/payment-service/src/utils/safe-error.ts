import { logger } from '@gym-coach/shared';

/**
 * W12 - payment-service never puts a raw `err.message` (Prisma text, host names, SQL, stack hints) into an HTTP body.
 * Every failure code the internal / payment / wallet routes can answer with maps to ONE fixed Vietnamese sentence here;
 * the real message goes to the log only. HTTP status, `code` and the `{ success:false, error:{ code, message } }`
 * envelope are decided by the route and are not touched by this file.
 */
export const GENERIC_FAILURE_MESSAGE = 'Hệ thống gặp lỗi khi xử lý. Hãy thử lại sau.';

const MESSAGES: Record<string, string> = {
  GATEWAY_ERROR: 'Cổng thanh toán đang gặp sự cố, vui lòng thử lại hoặc chọn cổng khác.',
  PROVIDER_NOT_CONFIGURED: 'Cổng thanh toán này chưa sẵn sàng - hãy chọn cổng thanh toán khác.',
  SYNC_FAILED: 'Chưa kiểm tra được trạng thái giao dịch với cổng thanh toán. Hãy thử lại sau.',
  INVALID_RATE_TABLE: 'Bảng tỷ lệ chia tiền không hợp lệ.',
  INVALID_INPUT: 'Dữ liệu tính tiền không hợp lệ.',
  RELEASE_FAILED: 'Không giải ngân được khoản tiền. Hãy thử lại sau.',
  REFUND_FAILED: 'Không hoàn được khoản tiền. Hãy thử lại sau.',
  COMPENSATION_FAILED: 'Không ghi nhận được khoản bồi thường. Hãy thử lại sau.',
  OBLIGATION_RECORD_FAILED: 'Không ghi nhận được khoản nghĩa vụ. Hãy thử lại sau.',
  LATE_OPEN_STATE_FAILED: 'Không đọc được trạng thái buổi tập mở muộn. Hãy thử lại sau.',
  TERMINATION_FAILED: 'Không kết thúc được hợp đồng về phần tiền. Hãy thử lại sau.',
  APPEAL_OBLIGATION_FAILED: 'Không ghi nhận được khoản nghĩa vụ sau khiếu nại. Hãy thử lại sau.',
  APPEAL_OBLIGATION_READ_FAILED: 'Không đọc được khoản nghĩa vụ sau khiếu nại. Hãy thử lại sau.',
  RESOLVE_UNRESOLVED_FAILED: 'Không xử lý được buổi tập chưa xác định. Hãy thử lại sau.',
  HOLDBACK_RELEASE_FAILED: 'Không giải ngân được khoản giữ lại. Hãy thử lại sau.',
  REFERRAL_SETTLE_FAILED: 'Không ghi nhận được hoa hồng giới thiệu. Hãy thử lại sau.',
  REFERRAL_CLAWBACK_FAILED: 'Không thu hồi được hoa hồng giới thiệu. Hãy thử lại sau.',
  MEMBERSHIP_RELEASE_FAILED: 'Không giải ngân được tiền gói tập. Hãy thử lại sau.',
  INTERNAL_ERROR: GENERIC_FAILURE_MESSAGE,
};

/** The fixed client-facing sentence for a failure code (generic sentence for an unknown code). */
export function failureMessage(code: string): string {
  return MESSAGES[code] ?? GENERIC_FAILURE_MESSAGE;
}

/** Message of a service-owned 4xx error (a thrown `{ status 400..499 }` with its own Vietnamese text) is kept; anything else gets the fixed sentence. */
export function withdrawalErrorResponse(e: unknown, context: string): { status: number; body: { success: false; error: { code: string; message: string } } } {
  const err = (e ?? {}) as { status?: unknown; code?: unknown; message?: unknown };
  const status = typeof err.status === 'number' ? err.status : 500;
  const code = typeof err.code === 'string' && err.code ? err.code : 'INTERNAL_ERROR';
  const serviceOwned = status >= 400 && status < 500 && typeof err.message === 'string';
  if (!serviceOwned) {
    logger.error({ err: (e as Error | null)?.message, context }, '[payment-service] withdrawal request failed');
  }
  return {
    status,
    body: { success: false, error: { code, message: serviceOwned ? (err.message as string) : failureMessage(code) } },
  };
}
