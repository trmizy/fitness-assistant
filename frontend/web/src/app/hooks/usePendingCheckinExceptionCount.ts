import { useQuery } from "@tanstack/react-query";
import { gymService } from "../services/api";
import { useApp } from "../context/AppContext";
import { countPendingExceptions } from "../utils/assistedCheckin";
import type { Gym } from "../types";

/**
 * Item 6: huy hiệu "yêu cầu ngoại lệ check-in đang chờ duyệt" ở menu Quầy lễ tân của chủ / quản lý.
 * Dùng đúng endpoint có sẵn GET /owner/gyms/:id/front-desk/exceptions cho từng chi nhánh đã duyệt (server tự lọc theo phạm vi của quản lý);
 * không thêm endpoint mới. Chỉ bật khi người dùng có quyền duyệt (`checkin.exception.approve`), poll 30s — thấp hơn nhiều so với panel 8s.
 * Khoá theo userId để đổi tài khoản không còn thấy số của người trước (và AppContext.logout cũng queryClient.clear()).
 */
export function usePendingCheckinExceptionCount(enabled: boolean): number {
  const { user } = useApp();
  const uid = user?.id ?? "guest";
  const q = useQuery<number>({
    queryKey: ["frontdesk-pending-exception-count", uid],
    queryFn: async () => {
      const gyms: Gym[] = await gymService.listOwnedGyms();
      const live = (gyms ?? []).filter((g) => g.status !== "DRAFT");
      const settled = await Promise.allSettled(live.map((g) => gymService.listCheckinExceptions(g.id)));
      return countPendingExceptions(settled.map((r) => (r.status === "fulfilled" ? r.value : null)));
    },
    enabled,
    refetchInterval: 30000,
    staleTime: 15000,
  });
  return q.data ?? 0;
}
