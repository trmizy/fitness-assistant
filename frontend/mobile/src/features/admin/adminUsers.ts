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

export function isLocked(u: AdminUserRow): boolean {
  return u.status === "Inactive";
}

export function userRows(raw: unknown): AdminUserRow[] {
  const d = (raw as any)?.data ?? raw;
  const list = Array.isArray(d) ? d : (d?.users ?? []);
  return (Array.isArray(list) ? list : []).filter((u: any) => u?.id && u?.email);
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
