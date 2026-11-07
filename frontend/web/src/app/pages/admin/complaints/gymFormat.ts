/** D6 - small pure helpers (dates, short refs, record guard). Same behaviour as the D2 helpers, kept here so this folder has no dependency on another worker's files. */

/** "02/11/2026 10:00" in the browser locale (vi-VN); "—" for a missing or unreadable date. */
export function formatDateTimeSafe(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return (
    d.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" }) +
    " " +
    d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })
  );
}
export function formatDateSafe(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/** Copyable short form of an id (people quote it, never read it). */
export function shortRefSafe(id: string | null | undefined): string {
  if (!id) return "—";
  return id.length <= 8 ? id : id.slice(0, 8);
}

export const asRecord = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
