/**
 * D7 - the ADMIN list a handover chooses from (never a typed id), and the names behind the admin ids the two APIs return.
 * `GET /admin/users?role=ADMIN` answers `{ success, data: { total, users: [{ id, name, email, role, status }] } }` (gateway -> auth-service).
 * The server re-checks that the chosen person is a real, active ADMIN (`ASSIGNEE_NOT_FOUND` / `ASSIGNEE_NOT_ADMIN`), so this list is only a convenience.
 */
export interface AdminDirectoryEntry {
  id: string;
  /** "Tên (email)" - what the select shows */
  label: string;
  /** just the name, for sentences like "Người phụ trách: ..." */
  name: string;
}

const MAX_ID = 128;

export function parseAdminDirectory(raw: unknown): AdminDirectoryEntry[] {
  const root = raw as { data?: { users?: unknown }; users?: unknown } | null;
  const users = root?.data?.users ?? root?.users;
  if (!Array.isArray(users)) return [];
  const out: AdminDirectoryEntry[] = [];
  const seen = new Set<string>();
  for (const u of users) {
    const r = u as { id?: unknown; name?: unknown; email?: unknown; role?: unknown; status?: unknown } | null;
    if (!r || typeof r.id !== "string" || !r.id || r.id.length > MAX_ID || seen.has(r.id)) continue;
    if (r.role !== "Admin" && r.role !== "ADMIN") continue;
    if (r.status === "Inactive") continue;
    seen.add(r.id);
    const name = typeof r.name === "string" && r.name.trim() ? r.name.trim() : "Quản trị viên";
    const email = typeof r.email === "string" && r.email.trim() ? ` (${r.email.trim()})` : "";
    out.push({ id: r.id, name, label: `${name}${email}` });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label, "vi"));
}

/** Handover candidates: every admin except the caller and the current person in charge. */
export function handoverOptions(all: AdminDirectoryEntry[], selfId: string | null, currentAssignee: string | null): AdminDirectoryEntry[] {
  return all.filter((a) => a.id !== selfId && a.id !== currentAssignee);
}

/** "Bạn" for the caller, the admin's name when known, otherwise "quản trị viên mã xxxxxxxx" (the API gives ids only). */
export function adminName(id: string | null | undefined, all: AdminDirectoryEntry[] | undefined, selfId: string | null): string {
  if (!id) return "—";
  if (id === selfId) return "Bạn";
  const hit = all?.find((a) => a.id === id);
  return hit ? hit.name : `quản trị viên mã ${id.slice(0, 8)}`;
}
