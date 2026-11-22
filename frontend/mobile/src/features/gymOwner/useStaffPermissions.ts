import { useQuery } from "@tanstack/react-query";

import { useApp } from "../../context/AppContext";
import { gymService } from "../../services/api";
import { permissionChecker, type PartnerPermission } from "./permissions";

/**
 * Quyền của người đang đăng nhập trong đối tác gym. Cùng query key với mọi màn khác
 * (`["partner-onboarding-status", uid]` — khoá theo userId nên đổi tài khoản không còn thấy quyền của người trước),
 * nên chỉ là đọc cache, không thêm request. `can()` là fail-closed: đang tải / lỗi / thiếu `permissions` → false.
 */
export function useStaffPermissions() {
  const { user } = useApp();
  const query = useQuery({
    queryKey: ["partner-onboarding-status", user?.id ?? "guest"],
    queryFn: () => gymService.getOnboardingStatus(),
  });
  const can: (permission: PartnerPermission) => boolean = permissionChecker(query.data);
  return { can, status: query.data, isLoading: query.isLoading, isError: query.isError };
}
