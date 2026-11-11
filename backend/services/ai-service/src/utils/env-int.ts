/**
 * Reads a numeric environment setting that controls quota / lease / retry behaviour and FAILS LOUDLY on a bad value.
 * A silent NaN or non-positive number would disable a rate limit, make every lease "expired" or remove a retry budget
 * (V-T012 DEP-01), so an unset variable uses the fallback but a set-and-invalid one throws with the variable name.
 */
export function positiveIntEnv(name: string, fallback: number, opts: { allowZero?: boolean } = {}): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const text = raw.trim();
  const value = /^\d+$/.test(text) ? Number.parseInt(text, 10) : Number.NaN;
  const min = opts.allowZero ? 0 : 1;
  if (!Number.isSafeInteger(value) || value < min) {
    throw new Error(`Invalid ${name}="${raw}": expected an integer >= ${min}`);
  }
  return value;
}
