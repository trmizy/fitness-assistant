/**
 * N15B-01: tabs Tổng quan / Lịch sử / Phê duyệt printed "mã d0d00000" for another admin. The workspace page loads the admin directory
 * (`/admin/dispute-cases/admins`) once; the names are remembered here so the pure label builders can show a person, not an id.
 * Unknown ids (a deactivated admin, directory not loaded yet) fall back to a neutral phrase - never a code.
 */
const names = new Map<string, string>();

export function rememberAdminNames(raw: unknown): void {
  const rows = Array.isArray(raw) ? raw : (raw as { items?: unknown; data?: unknown } | null)?.items ?? (raw as { data?: unknown } | null)?.data;
  if (!Array.isArray(rows)) return;
  for (const r of rows) {
    const u = r as { id?: unknown; displayName?: unknown; name?: unknown } | null;
    const shown = typeof u?.displayName === "string" ? u.displayName : u?.name;
    if (u && typeof u.id === "string" && typeof shown === "string" && shown.trim()) names.set(u.id, shown.trim());
  }
}

export function clearAdminNames(): void {
  names.clear();
}

export const adminNameOf = (id: string | null | undefined): string | null => (id ? names.get(id) ?? null : null);

/** "Bạn" for the signed-in admin, the directory name for another admin, otherwise a neutral phrase. */
export function adminWhoLabel(id: string | null | undefined, currentUserId: string | null | undefined, fallback = "Quản trị viên khác"): string {
  if (!id) return "—";
  if (currentUserId && id === currentUserId) return "Bạn";
  return names.get(id) ?? fallback;
}
