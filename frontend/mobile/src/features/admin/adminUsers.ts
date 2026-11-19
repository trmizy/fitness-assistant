/**
 * AD-05 "Người dùng" — phần thuần. Dữ liệu là gateway `GET /admin/users` (sau khi sửa GAP-21 ngày
 * 28/9: vai trò có "Gym Owner", trạng thái lấy từ `isActive` của auth-service).
 *
 * Khoá / mở khoá = `PATCH /admin/users/:id/disable|enable`. Hệ quả THẬT, đọc từ code (không suy):
 * - auth-service chặn đăng nhập, chặn làm mới phiên và `/auth/verify` → phiên đang mở chết ở lần làm
 *   mới kế tiếp.
 * - Nếu là PT: auth-service relay DEACTIVATE sang user-service → **mọi hợp đồng đang mở bị huỷ và hoàn
 *   tiền theo tỉ lệ cho học viên, lịch tương lai bị huỷ, PT bị ẩn**. Mở khoá chỉ gỡ lệnh ẩn —
 *   **hợp đồng KHÔNG được khôi phục** (`internal.routes.ts`).
 * Vì vậy câu xác nhận phụ thuộc vai trò, và với PT phải nói rõ phần không đảo ngược được.
 */
import { foldVi } from "../../lib/text";

export type AdminUserRow = {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  joined?: string;
  lastActive?: string;
  contracts?: number;
};

export const ROLE_FILTERS: { value: string; label: string }[] = [
  { value: "ALL", label: "Tất cả" },
  { value: "Client", label: "Khách hàng" },
  { value: "PT", label: "Huấn luyện viên" },
  { value: "Gym Owner", label: "Chủ phòng gym" },
];

export const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: "ALL", label: "Mọi trạng thái" },
  { value: "Active", label: "Đang hoạt động" },
  { value: "Inactive", label: "Đã khoá" },
];

const ROLE_LABEL: Record<string, string> = {
  Client: "Khách hàng",
  PT: "Huấn luyện viên",
  "Gym Owner": "Chủ phòng gym",
  Admin: "Quản trị viên",
};

export function roleLabel(role: string): string {
  return ROLE_LABEL[role] ?? role;
}

export type PartnerRole = "OWNER" | "MANAGER" | "RECEPTIONIST" | "ACCOUNTANT";

const PARTNER_ROLE_LABEL: Record<PartnerRole, string> = {
  OWNER: "Chủ phòng gym",
  MANAGER: "Quản lý chi nhánh",
  RECEPTIONIST: "Lễ tân",
  ACCOUNTANT: "Kế toán",
};

/** userId -> partner role, from `GET /admin/partner-accounts/roles` (`data: [{ userId, partnerRole }]`). */
export function partnerRoleMap(raw: unknown): Map<string, PartnerRole> {
  const d: any = (raw as any)?.data ?? raw;
  const list = Array.isArray(d) ? d : [];
  const map = new Map<string, PartnerRole>();
  for (const row of list) {
    const r = row?.partnerRole;
    if (row?.userId && typeof r === "string" && r in PARTNER_ROLE_LABEL) map.set(String(row.userId), r as PartnerRole);
  }
  return map;
}

/** B41 — the account's own role label; partner staff are not "Chủ phòng gym". */
export function userRoleLabel(u: Pick<AdminUserRow, "id" | "role">, partnerRoles?: Map<string, PartnerRole>): string {
  if (u.role === "Gym Owner") {
    const pr = partnerRoles?.get(u.id);
    if (pr) return PARTNER_ROLE_LABEL[pr];
  }
  return roleLabel(u.role);
}

export function isLocked(u: AdminUserRow): boolean {
  return u.status === "Inactive";
}

export function userRows(raw: unknown): AdminUserRow[] {
  const d = (raw as any)?.data ?? raw;
  const list = Array.isArray(d) ? d : (d?.users ?? []);
  return (Array.isArray(list) ? list : []).filter((u: any) => u?.id && u?.email);
}

// ── FIX5-ADMIN-PERF: the server pages and searches (37k accounts); the screen scrolls through pages. ──

/** Rows per page of the "Người dùng" list (`limit` of GET /admin/users). */
export const USER_PAGE_SIZE = 20;

const ROLE_TO_SERVER: Record<string, string> = { Client: "CUSTOMER", PT: "PT", "Gym Owner": "GYM_OWNER" };
const STATUS_TO_SERVER: Record<string, string> = { Active: "ACTIVE", Inactive: "INACTIVE" };

/** Query string of one page: filter chips + search text (trimmed) + page number. "ALL" / empty are omitted. */
export function userListParams(f: { q?: string; role?: string; status?: string; page?: number }, limit: number = USER_PAGE_SIZE): Record<string, string | number> {
  const out: Record<string, string | number> = { page: f.page && f.page > 1 ? f.page : 1, limit };
  const role = ROLE_TO_SERVER[f.role ?? ""];
  if (role) out.role = role;
  const status = STATUS_TO_SERVER[f.status ?? ""];
  if (status) out.status = status;
  const q = (f.q ?? "").trim();
  if (q) out.search = q;
  return out;
}

/** `{ success, data: { total, page, totalPages, users } }` -> the rows and paging facts of that page. */
export function userPage(raw: unknown): { rows: AdminUserRow[]; total: number; page: number; totalPages: number } {
  const d: any = (raw as any)?.data ?? raw ?? {};
  const rows = userRows(raw);
  const total = Number.isFinite(Number(d?.total)) ? Number(d.total) : rows.length;
  const page = Number.isInteger(d?.page) && d.page >= 1 ? d.page : 1;
  const totalPages = Number.isInteger(d?.totalPages) && d.totalPages >= 1 ? d.totalPages : 1;
  return { rows, total, page, totalPages };
}

/** React-Query `getNextPageParam`: the next page number, or undefined on the last page. */
export function nextUserPage(last: unknown): number | undefined {
  const p = userPage(last);
  return p.page < p.totalPages ? p.page + 1 : undefined;
}

/** Every loaded page flattened, a row that appears twice (the list moved under the scroll) kept once. */
export function mergeUserPages(pages: unknown[] | undefined): AdminUserRow[] {
  const seen = new Set<string>();
  const out: AdminUserRow[] = [];
  for (const p of pages ?? []) {
    for (const u of userPage(p).rows) if (!seen.has(u.id)) (seen.add(u.id), out.push(u));
  }
  return out;
}

export function filterUsers(rows: AdminUserRow[], q: string, role: string, status: string): AdminUserRow[] {
  const f = foldVi(q);
  return rows.filter(
    (u) =>
      (role === "ALL" || u.role === role) &&
      (status === "ALL" || u.status === status) &&
      (!f || foldVi(u.name).includes(f) || foldVi(u.email).includes(f)),
  );
}

export function userCounts(rows: AdminUserRow[]) {
  return {
    total: rows.length,
    locked: rows.filter(isLocked).length,
    byRole: Object.fromEntries(ROLE_FILTERS.slice(1).map((r) => [r.value, rows.filter((u) => u.role === r.value).length])),
  };
}

/** Hệ quả của việc khoá, theo vai trò — đúng những gì backend thật sự làm. */
export function lockConsequences(u: AdminUserRow): { lines: string[]; irreversible: string | null } {
  const lines = ["Không đăng nhập được nữa; phiên đang mở kết thúc ở lần làm mới kế tiếp."];
  if (u.role === "PT") {
    lines.push("Mọi hợp đồng đang mở bị huỷ và học viên được hoàn tiền theo số buổi chưa tập.");
    lines.push("Các buổi tập sắp tới bị huỷ; huấn luyện viên bị ẩn khỏi tìm kiếm.");
    return {
      lines,
      irreversible: "Mở khoá sau này chỉ cho đăng nhập và hiện lại — hợp đồng đã huỷ KHÔNG được khôi phục.",
    };
  }
  if (u.role === "Gym Owner") {
    lines.push("Hồ sơ đối tác, chi nhánh và hội viên của họ không bị thay đổi — chỉ tài khoản đăng nhập bị khoá.");
  }
  return { lines, irreversible: null };
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const pick = parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[parts.length - 1][0];
  return pick.toUpperCase();
}
