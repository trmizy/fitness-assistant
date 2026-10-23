import { api } from "./api";

/** Role values auth-service accepts when an admin changes a role (ADMIN can't be assigned). */
export type AssignableRole = "CUSTOMER" | "PT" | "GYM_OWNER";

function errorMessage(err: any, fallback: string): string {
  const e = err?.response?.data?.error;
  if (typeof e === "string") return e;
  if (typeof e?.message === "string") return e.message;
  return fallback;
}

export const adminUsersApi = {
  async updateRole(userId: string, role: AssignableRole): Promise<void> {
    try {
      await api.patch(`/admin/users/${userId}/role`, { role });
    } catch (err) {
      throw new Error(errorMessage(err, "Không thể đổi vai trò"));
    }
  },
  async setActive(userId: string, active: boolean): Promise<void> {
    try {
      await api.patch(`/admin/users/${userId}/${active ? "enable" : "disable"}`, {});
    } catch (err) {
      throw new Error(errorMessage(err, active ? "Không thể mở khóa tài khoản" : "Không thể khóa tài khoản"));
    }
  },
};
