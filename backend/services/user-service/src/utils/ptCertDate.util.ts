/**
 * Certificate issue/expiry dates arrive from the web `<input type="date">` and the mobile
 * "YYYY-MM-DD" field as a bare calendar date, but the Prisma columns are DateTime and reject
 * anything short of full ISO-8601 — every draft save with a certificate date failed with a raw
 * PrismaClientValidationError (6/10, found on a real phone over the tunnel).
 *
 * Accepts null/"" (cleared), a bare date (stored as UTC midnight, which is what the clients
 * read back with `.slice(0, 10)`), or a full ISO timestamp (what the server itself returns).
 */
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

export function normalizeCertDate(value: unknown, label: string): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value === "string") {
    const m = DATE_ONLY.exec(value.trim());
    const d = m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : new Date(value);
    // Date.UTC rolls 2024-02-31 over to March — reject instead of storing a different day.
    const exact = !m || (d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3]);
    if (!Number.isNaN(d.getTime()) && exact) return d;
  }
  throw new Error(`${label} không hợp lệ (định dạng YYYY-MM-DD)`);
}
