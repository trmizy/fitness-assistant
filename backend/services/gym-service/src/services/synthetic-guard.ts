/**
 * Seed-discovery Dot X — shared financial/mutation guard for SYNTHETIC gym & membership records.
 * Reads `dataOrigin` from trusted DB rows (`Gym` / `GymMembershipContract` / `GymReview`),
 * failing closed with HTTP 409 `SYNTHETIC_RECORD_NOT_TRANSACTABLE` before any write,
 * payment-service call, or complaint submission.
 */

export const SYNTHETIC_RECORD_NOT_TRANSACTABLE = 'SYNTHETIC_RECORD_NOT_TRANSACTABLE';

export type EntityOrigin = 'REAL' | 'SYNTHETIC';

type WithDataOrigin = { dataOrigin?: string | null } | null | undefined;

/** Returns canonical `'REAL'` or `'SYNTHETIC'` from a DB row (absent/null defaults to `'REAL'`). */
export function originOf(record: WithDataOrigin): EntityOrigin {
  return record?.dataOrigin === 'SYNTHETIC' ? 'SYNTHETIC' : 'REAL';
}

/** True when a gym, membership, or review row is marked `SYNTHETIC`. */
export function isSynthetic(record: WithDataOrigin): boolean {
  return record?.dataOrigin === 'SYNTHETIC';
}

/** Builds a coded 409 Error for controller serialization. */
export function syntheticNotTransactableError(
  message = 'Dữ liệu mẫu (SYNTHETIC) chỉ dùng để hiển thị, không thể thực hiện giao dịch hoặc thay đổi trạng thái',
): Error & { status: number; code: string } {
  return Object.assign(new Error(message), {
    status: 409,
    code: SYNTHETIC_RECORD_NOT_TRANSACTABLE,
  });
}

/** Throws `409 SYNTHETIC_RECORD_NOT_TRANSACTABLE` if the provided record has `dataOrigin === 'SYNTHETIC'`. */
export function assertNotSynthetic(record: WithDataOrigin, message?: string): void {
  if (isSynthetic(record)) {
    throw syntheticNotTransactableError(message);
  }
}
