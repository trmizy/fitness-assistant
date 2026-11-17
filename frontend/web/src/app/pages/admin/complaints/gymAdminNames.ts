/**
 * N15A-03: the gym complaint-case screens named another admin "mã d0d00000" (every admin shares the prefix) or printed a raw UUID. The admin directory
 * (`GET /admin/dispute-cases/admins` -> [{ id, displayName }]) gives the names; they are remembered here so the pure label builders in gymCaseModel can show
 * a person. An admin the directory does not list (deactivated) gets a neutral phrase, never a code. Kept in this folder on purpose (no dependency on the dispute pages).
 */
const names = new Map<string, string>();
let loaded = false;
/** Subscribers (the hook in useGymAdminNames.ts) re-render when names arrive. Kept here so this file stays free of React / axios and the pure model can import it. */
export const gymAdminNameListeners = new Set<() => void>();
export const markGymAdminNamesLoaded = (v: boolean) => {
  loaded = v;
};
export const gymAdminNamesLoaded = () => loaded;

export function rememberGymAdminNames(raw: unknown): void {
  const rows = Array.isArray(raw) ? raw : ((raw as { items?: unknown; data?: unknown; users?: unknown } | null)?.items ?? (raw as { data?: unknown } | null)?.data ?? (raw as { users?: unknown } | null)?.users);
  if (!Array.isArray(rows)) return;
  for (const r of rows) {
    const u = r as { id?: unknown; displayName?: unknown; name?: unknown } | null;
    const shown = typeof u?.displayName === "string" ? u.displayName : u?.name;
    if (u && typeof u.id === "string" && typeof shown === "string" && shown.trim()) names.set(u.id, shown.trim());
  }
}

export function clearGymAdminNames(): void {
  names.clear();
  loaded = false;
  gymAdminNameListeners.forEach((l) => l());
}

export const gymAdminNameOf = (id: string | null | undefined): string | null => (id ? names.get(id) ?? null : null);

/** "Bạn" for the signed-in admin, the directory name for another admin, otherwise a neutral phrase (never an id). */
export function adminLabel(id: string | null | undefined, currentUserId: string | null | undefined, fallback = "Quản trị viên khác"): string {
  if (!id) return "—";
  if (currentUserId && id === currentUserId) return "Bạn";
  return names.get(id) ?? fallback;
}
