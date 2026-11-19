import { View } from "react-native";
import { router } from "expo-router";

import { Button } from "../../components/ui";
import { Notice } from "../../components/payment/PaymentMethodSheet";
import type { MembershipNotCovered } from "./membershipRenewal";

/**
 * Đặt / dời buổi tập bị từ chối vì gói hội viên không có hiệu lực vào ngày đó (422 SESSION_NOT_COVERED_BY_MEMBERSHIP): hiện lý do
 * của máy chủ + nút "Gia hạn gói hội viên" mở danh sách gói của đúng chi nhánh ở chế độ gia hạn (gói mới nối tiếp khi gói cũ hết).
 * `onBeforeNavigate` đóng sheet đang mở trước khi chuyển màn hình. Không có gymId thì chỉ hiện lý do. Giống web:
 * components/gym/MembershipNotCoveredNotice.tsx.
 */
export function MembershipNotCoveredNotice({
  refusal,
  coverUntil,
  onBeforeNavigate,
}: {
  refusal: MembershipNotCovered;
  /** Ngày muốn được phủ (ISO) — để gắn nhãn gói "Đủ cho hợp đồng PT". */
  coverUntil?: string | null;
  onBeforeNavigate?: () => void;
}) {
  const gymId = refusal.gymId;
  return (
    <View className="gap-2" testID="membership-not-covered-notice">
      <Notice tone="warning" text={refusal.message} />
      {gymId ? (
        <Button
          variant="secondary"
          size="sm"
          className="self-start"
          onPress={() => {
            onBeforeNavigate?.();
            router.push({
              pathname: "/client/services/gyms/[id]",
              params: { id: gymId, ...(coverUntil ? { coverUntil } : {}) },
            });
          }}
        >
          Gia hạn gói hội viên
        </Button>
      ) : null}
    </View>
  );
}
