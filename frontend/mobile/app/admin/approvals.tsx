import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Building2, ChevronRight, Dumbbell } from "lucide-react-native";

import { Badge, Card, Stagger, StaggerItem, Tappable } from "../../src/components/ui";
import { adminPartnerApplications } from "../../src/services/api";
import { useWorkspaceAccent } from "../../src/theme/workspace";
import { designTokens } from "../../src/theme/colors";
import { applicationCounts } from "../../src/features/adminApplications/adminApplications";

/**
 * AD-04 "Duyệt" — hub của các hàng chờ duyệt.
 *
 * Phase 13 dựng hàng chờ đầu tiên: **hồ sơ đối tác (WB-17)**, vì đó là đường DUY NHẤT để một chủ
 * phòng gym tồn tại (luồng admin tự tạo tài khoản đã bị gỡ, trả 410). Các hàng chờ còn lại của AD-04
 * (đơn ứng tuyển huấn luyện viên, bài tập người dùng tạo) nối vào đây khi tới lượt — và màn này nói
 * thẳng là chúng chưa có, thay vì im lặng.
 */
export default function AdminApprovalsScreen() {
  const insets = useSafeAreaInsets();
  const accent = useWorkspaceAccent();

  const pending = useQuery({
    queryKey: ["admin-partner-applications", "IN_REVIEW"],
    queryFn: () => adminPartnerApplications.list("IN_REVIEW"),
  });
  const counts = applicationCounts(pending.data);
  const waiting = counts.IN_REVIEW;

  return (
    <View className="flex-1 bg-background">
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: insets.bottom + 32 }}
        refreshControl={
          <RefreshControl
            refreshing={pending.isRefetching}
            onRefresh={() => void pending.refetch()}
            tintColor={accent.primary}
            colors={[accent.primary]}
          />
        }
      >
        <View className="px-5">
          <Text className="font-display text-xl text-foreground">Duyệt</Text>
          <Text className="mt-0.5 font-body text-xs text-muted-foreground">Các hàng chờ cần quản trị viên xử lý</Text>
        </View>

        <Stagger className="gap-3 px-5 pt-5">
          <StaggerItem>
            <Tappable accessibilityLabel="Duyệt hồ sơ đối tác" onPress={() => router.push("/admin/applications")}>
              <Card className="flex-row items-center gap-3 p-4">
                <View className="h-10 w-10 items-center justify-center rounded-xl bg-primary/15">
                  <Building2 size={18} color={accent.primary} />
                </View>
                <View className="min-w-0 flex-1">
                  <Text className="font-body-semibold text-sm text-foreground">Hồ sơ đối tác</Text>
                  <Text className="font-body text-xs text-muted-foreground">
                    Đường duy nhất để một chủ phòng gym tồn tại
                  </Text>
                </View>
                {pending.isLoading ? (
                  <ActivityIndicator color={accent.primary} />
                ) : typeof waiting === "number" && waiting > 0 ? (
                  <Badge tone="warning">{`${waiting} chờ`}</Badge>
                ) : null}
                <ChevronRight size={16} color={designTokens.mutedForeground} />
              </Card>
            </Tappable>
          </StaggerItem>

          <StaggerItem>
            <Card className="flex-row items-center gap-3 p-4 opacity-60">
              <View className="h-10 w-10 items-center justify-center rounded-xl bg-panel">
                <Dumbbell size={18} color={designTokens.mutedForeground} />
              </View>
              <View className="min-w-0 flex-1">
                <Text className="font-body-semibold text-sm text-foreground">Đơn ứng tuyển huấn luyện viên</Text>
                <Text className="font-body text-xs text-muted-foreground">Sẽ nối vào đây ở phần còn lại của Phase 13</Text>
              </View>
            </Card>
          </StaggerItem>
        </Stagger>
      </ScrollView>
    </View>
  );
}
