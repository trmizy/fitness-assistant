import { useQuery } from "@tanstack/react-query";
import { useApp } from "../context/AppContext";
import { partnerApplication } from "../services/partnerApplication";

/**
 * Trạng thái hồ sơ của chủ phòng gym đang đăng nhập — nguồn cho mọi quyết định điều hướng theo
 * hồ sơ (gốc, đăng nhập, khôi phục phiên, mở thẳng URL). Khoá cache gắn với userId nên đổi tài
 * khoản không bao giờ dùng lại kết quả của người trước; luôn refetch khi mount/focus vì trạng
 * thái đổi từ phía admin. Đây chỉ là UX: quyền thật do backend cưỡng chế.
 */
export function useGymOwnerAccessState() {
  const { user, role, isAuthenticated } = useApp();
  const userId = (user as { id?: string } | null)?.id ?? "anonymous";
  return useQuery({
    queryKey: ["gym-owner-access-state", userId],
    queryFn: partnerApplication.status,
    enabled: isAuthenticated && role === "gym_owner",
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    // 403 (vd. quyền đã bị thu hồi) là câu trả lời dứt khoát — thử lại chỉ làm màn hình treo lâu hơn.
    retry: (count, error) => (error as { response?: { status?: number } })?.response?.status !== 403 && count < 1,
  });
}
