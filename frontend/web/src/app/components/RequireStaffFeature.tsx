import type { ReactNode } from "react";
import { Navigate } from "react-router";
import { CircleNotchIcon as Loader2 } from "@phosphor-icons/react";
import { canUseFeature, homePathFor, type StaffFeature } from "../utils/gymStaffRole";
import { useStaffRole } from "../hooks/useStaffRole";

/**
 * D15 — chặn UX cho từng trang của /gym-owner theo vai trò nội bộ (lễ tân, kế toán, quản lý, chủ). Backend mới là
 * cổng thật; lớp này chỉ tránh cho người dùng thấy trang họ sẽ chỉ nhận lỗi 403, và đẩy họ về trang chủ của
 * chính vai trò mình. Không tải được vai trò → KHÔNG cho qua (fail-closed), kèm nút thử lại.
 */
export function RequireStaffFeature({ feature, children }: { feature: StaffFeature; children: ReactNode }) {
  const { role, isLoading, isError, refetch } = useStaffRole();
  if (isLoading) {
    return (
      <div className="min-h-[40vh] flex items-center justify-center" data-testid="staff-role-loading">
        <Loader2 className="w-6 h-6 text-green-500 animate-spin" />
      </div>
    );
  }
  if (isError || !role) {
    return (
      <div className="p-6 max-w-md mx-auto text-center space-y-3" data-testid="staff-role-error">
        <p className="text-sm text-zinc-300">Không xác định được vai trò của tài khoản.</p>
        <button onClick={() => refetch()} className="px-3 py-2 text-xs font-bold rounded-lg bg-green-500 text-black">Thử lại</button>
      </div>
    );
  }
  if (!canUseFeature(role, feature)) return <Navigate to={homePathFor(role)} replace />;
  return <>{children}</>;
}
