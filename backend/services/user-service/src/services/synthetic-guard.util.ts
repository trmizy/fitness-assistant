/**
 * Seed-discovery Dot X — shared financial/mutation guard for SYNTHETIC records.
 * Reads `dataOrigin` directly from trusted DB rows (`UserProfile` / `Contract`),
 * failing closed with HTTP 409 and stable code `SYNTHETIC_RECORD_NOT_TRANSACTABLE`
 * before any DB mutation, payment-service call, or notification side effect.
 */

export const SYNTHETIC_RECORD_NOT_TRANSACTABLE = "SYNTHETIC_RECORD_NOT_TRANSACTABLE";

export type EntityOrigin = "REAL" | "SYNTHETIC";

type WithDataOrigin = { dataOrigin?: string | null } | null | undefined;

/** Returns canonical `"REAL"` or `"SYNTHETIC"` from a DB row (absent/null defaults to `"REAL"`). */
export function originOf(record: WithDataOrigin): EntityOrigin {
  return record?.dataOrigin === "SYNTHETIC" ? "SYNTHETIC" : "REAL";
}

/** True when a profile or contract row is marked `SYNTHETIC`. */
export function isSynthetic(record: WithDataOrigin): boolean {
  return record?.dataOrigin === "SYNTHETIC";
}

/** Builds a coded 409 Error for controller serialization via `errorCodeBody`. */
export function syntheticNotTransactableError(
  message = "Dữ liệu mẫu (SYNTHETIC) chỉ dùng để hiển thị, không thể thực hiện giao dịch hoặc thay đổi trạng thái",
): Error & { status: number; code: string } {
  return Object.assign(new Error(message), {
    status: 409,
    code: SYNTHETIC_RECORD_NOT_TRANSACTABLE,
  });
}

/** Throws `409 SYNTHETIC_RECORD_NOT_TRANSACTABLE` if any provided record has `dataOrigin === "SYNTHETIC"`. */
export function assertNotSynthetic(record: WithDataOrigin, message?: string): void {
  if (isSynthetic(record)) {
    throw syntheticNotTransactableError(message);
  }
}

/** Throws `409 SYNTHETIC_RECORD_NOT_TRANSACTABLE` if any party/contract record in the list is `SYNTHETIC`. */
export function assertAllNotSynthetic(records: readonly WithDataOrigin[], message?: string): void {
  for (const record of records) {
    if (isSynthetic(record)) {
      throw syntheticNotTransactableError(message);
    }
  }
}
