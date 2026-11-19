import { useMemo } from "react";
import { Text, View } from "react-native";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";

import { Button } from "../../components/ui";
import { Notice } from "../../components/payment/PaymentMethodSheet";
import { gymService } from "../../services/api";
import { normalizeGym, normalizeMemberships } from "./gymDirectory";
import { coverageWarningCopy } from "./contractGymOptions";
import { latestMembershipEnd, renewalDate } from "./membershipRenewal";

/**
 * Hợp đồng PT gắn với một chi nhánh gym: ngày hết hạn gói hội viên của khách ở thương hiệu đó + nút "Gia hạn gói hội viên"
 * (mở danh sách gói của chi nhánh; gói mới được cộng dồn, bắt đầu ngay khi gói cũ hết). Chỉ hiển thị — máy chủ quyết định ngày thật
 * khi thanh toán xong. Giống web: components/gym/ContractMembershipRenewal.tsx.
 */
export function ContractMembershipRenewal({
  gymId,
  contractEndIso,
}: {
  gymId: string;
  /** Ngày kết thúc hợp đồng PT (ISO) nếu đã có. */
  contractEndIso: string | null;
}) {
  const gymQuery = useQuery({
    queryKey: ["gym", gymId],
    queryFn: () => gymService.getGym(gymId),
    retry: 1,
  });
  const membershipsQuery = useQuery({
    queryKey: ["my-memberships"],
    queryFn: () => gymService.listMyMemberships(),
  });
  const latestEnd = useMemo(() => {
    const gym = gymQuery.data ? normalizeGym(gymQuery.data) : null;
    const ids = [gymId, ...(gym?.brandBranches ?? []).map((b) => b.id)];
    return latestMembershipEnd(normalizeMemberships(membershipsQuery.data), ids);
  }, [gymId, gymQuery.data, membershipsQuery.data]);
  const contractEnd = contractEndIso && !Number.isNaN(new Date(contractEndIso).getTime()) ? new Date(contractEndIso) : null;
  const notEnough = !!latestEnd && !!contractEnd && latestEnd.getTime() < contractEnd.getTime();

  return (
    <View className="gap-2 rounded-xl border border-border bg-panel p-3" testID="contract-membership-renewal">
      <Text className="font-body-semibold text-xs uppercase tracking-wider text-muted-foreground">Gói hội viên phòng gym</Text>
      <Text className="font-body text-xs text-foreground">
        {latestEnd
          ? `Gói hội viên của bạn hết hạn ${renewalDate(latestEnd)}.`
          : "Bạn chưa có gói hội viên còn hiệu lực tại phòng gym này."}
      </Text>
      {notEnough ? <Notice tone="warning" text={coverageWarningCopy(latestEnd!.toISOString())} /> : null}
      <Button
        variant="secondary"
        size="sm"
        className="self-start"
        onPress={() =>
          router.push({
            pathname: "/client/services/gyms/[id]",
            params: { id: gymId, ...(contractEnd ? { coverUntil: contractEnd.toISOString() } : {}) },
          })
        }
      >
        Gia hạn gói hội viên
      </Button>
    </View>
  );
}
