/**
 * D2 - small pure helpers shared by the queue and the workspace (dates, short refs, text guards). No React, no I/O.
 */

/** "02/11/2026 10:00" in the browser locale (vi-VN); "—" for a missing or unreadable date. */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return (
    d.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" }) +
    " " +
    d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })
  );
}

/** Whole span between two instants as words ("2 giờ", "3 ngày 4 giờ"); null when either is unreadable. Display only, never used for money. */
export function formatSpan(fromIso: string | null | undefined, toIso: string | null | undefined): string | null {
  if (!fromIso || !toIso) return null;
  const a = Date.parse(fromIso);
  const b = Date.parse(toIso);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  const mins = Math.floor(Math.abs(b - a) / 60_000);
  if (mins < 1) return "dưới 1 phút";
  if (mins < 60) return `${mins} phút`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return mins % 60 ? `${hours} giờ ${mins % 60} phút` : `${hours} giờ`;
  const days = Math.floor(hours / 24);
  return hours % 24 ? `${days} ngày ${hours % 24} giờ` : `${days} ngày`;
}

/** Copyable short form of an id (admins quote it, never read it). Same rule as b9aUrlState.shortRef. */
export function shortRef(id: string | null | undefined): string {
  if (!id) return "—";
  return id.length <= 8 ? id : id.slice(0, 8);
}

/** A string that is only an internal code/token ("CONTRACT_ENDING", "attempt 2", "SERVER_OBSERVED"): never shown as prose. */
export function looksLikeInternalCode(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (/^[A-Z0-9_:.\- ]+$/.test(t)) return true;
  if (/^attempt\s+\d+$/i.test(t)) return true;
  return false;
}

/** Free text that is safe to show as a sentence, or null. */
export function proseOrNull(text: unknown): string | null {
  if (typeof text !== "string") return null;
  const t = text.trim();
  return t && !looksLikeInternalCode(t) ? t : null;
}

export const asRecord = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
export const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
