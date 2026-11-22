import { useQuery } from "@tanstack/react-query";
import { gymService } from "../services/api";
import { useApp } from "../context/AppContext";
import { hasPartnerPermission, normalizePartnerRole, type PartnerPermission } from "../utils/gymStaffRole";

/** Cùng query key với Sidebar / AppShell (["partner-onboarding-status"]) nên chỉ là đọc cache, không thêm request. */
export function useStaffRole() {
  const { role: appRole } = useApp();
  const q = useQuery({
    queryKey: ["partner-onboarding-status"],
    queryFn: () => gymService.getOnboardingStatus(),
    enabled: appRole === "gym_owner",
  });
  const role = normalizePartnerRole(q.data?.role);
  const rawRole = q.data?.role;
  const rawPermissions = q.data?.permissions;
  return {
    role,
    /** Item 5: fail-closed — false while the role/permissions are loading, unknown or missing (see hasPartnerPermission). */
    can: (permission: PartnerPermission) => hasPartnerPermission(rawRole, rawPermissions, permission),
    isLoading: q.isLoading,
    isError: q.isError,
    error: q.error,
    refetch: q.refetch,
  };
}
