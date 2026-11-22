import { useQuery } from "@tanstack/react-query";

import { useApp } from "../../context/AppContext";
import { gymService } from "../../services/api";
import { countPendingExceptions } from "./frontDesk";
import { ownedGyms } from "./gymOwner";

/** Query key prefix, so a decision on the desk can invalidate the badge at once. */
export const PENDING_EXCEPTION_COUNT_KEY = "frontdesk-pending-exception-count";

/**
 * Item 6: huy hiệu "yêu cầu ngoại lệ check-in đang chờ duyệt" ở tab Quầy lễ tân của chủ / quản lý. Dùng đúng endpoint có sẵn
 * GET /owner/gyms/:id/front-desk/exceptions cho từng chi nhánh đã duyệt (server tự lọc theo phạm vi của quản lý); không thêm
 * endpoint mới. Chỉ bật khi người dùng có quyền duyệt (`checkin.exception.approve`), poll 30 giây như web. Khoá theo userId nên đổi
 * tài khoản không còn thấy số của người trước.
 */
export function usePendingCheckinExceptionCount(enabled: boolean): number {
  const { user } = useApp();
  const uid = user?.id ?? "guest";
  const q = useQuery<number>({
    queryKey: [PENDING_EXCEPTION_COUNT_KEY, uid],
    queryFn: async () => {
      const live = ownedGyms(await gymService.listOwnedGyms()).filter((g) => g.status !== "DRAFT");
      const settled = await Promise.allSettled(live.map((g) => gymService.listCheckinExceptions(g.id)));
      return countPendingExceptions(settled.map((r) => (r.status === "fulfilled" ? r.value : null)));
    },
    enabled,
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
  return enabled ? (q.data ?? 0) : 0;
}
