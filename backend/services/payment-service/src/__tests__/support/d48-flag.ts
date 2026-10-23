/**
 * D48 is a financial INVARIANT: the old LEDGER_STRICT_OWN_FUNDS switch was removed and nothing reads it.
 * Regression tests set it to hostile values and assert the behaviour is STILL the strict own-funds one.
 */
export const REMOVED_FLAG = 'LEDGER_STRICT_OWN_FUNDS';

/** `false` is the value that used to restore the legacy behaviour; the rest are garbage a mis-set env could hold. */
export const HOSTILE_FLAG_VALUES = ['false', 'FALSE', ' false ', '0', 'off', 'no', 'garbage', ''] as const;

export async function withRemovedFlag<T>(value: string, fn: () => Promise<T>): Promise<T> {
  const prev = process.env[REMOVED_FLAG];
  process.env[REMOVED_FLAG] = value;
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env[REMOVED_FLAG];
    else process.env[REMOVED_FLAG] = prev;
  }
}
