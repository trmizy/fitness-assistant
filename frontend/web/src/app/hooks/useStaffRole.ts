import { useQuery } from "@tanstack/react-query";
import { gymService } from "../services/api";
import { useApp } from "../context/AppContext";
import { normalizePartnerRole } from "../utils/gymStaffRole";

/** Cùng query key với Sidebar / AppShell (["partner-onboarding-status"]) nên chỉ là đọc cache, không thêm request. */
export function useStaffRole() {
  const { role: appRole } = useApp();
  const q = useQuery({
    queryKey: ["partner-onboarding-status"],
    queryFn: () => gymService.getOnboardingStatus(),
    enabled: appRole === "gym_owner",
  });
  return {
    role: normalizePartnerRole(q.data?.role),
    isLoading: q.isLoading,
    isError: q.isError,
    refetch: q.refetch,
  };
}
