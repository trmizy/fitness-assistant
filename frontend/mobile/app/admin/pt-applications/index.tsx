import { ActivityIndicator, FlatList, RefreshControl, Text, View } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Dumbbell } from "lucide-react-native";

import { Badge, Button, Card, EmptyState, ScreenHeader, Tappable } from "../../../src/components/ui";
import { adminPtApplications } from "../../../src/services/api";
import { useWorkspaceAccent } from "../../../src/theme/workspace";
import { designTokens } from "../../../src/theme/colors";
import {
  applicantEmail,
  applicantName,
  ptAppStatus,
  ptApplicationRows,
  sortPtQueue,
} from "../../../src/features/admin/adminModeration";

/**
 * AD-02 — đơn ứng tuyển huấn luyện viên. Một danh sách, việc cần làm lên đầu (mới nộp → đang xem →
 * chờ bổ sung → đã xong), thay cho bảng + bộ lọc của web; quyết định làm ở màn chi tiết.
 */
export default function AdminPtApplicationsScreen() {
  const insets = useSafeAreaInsets();
  const accent = useWorkspaceAccent();
  const query = useQuery({ queryKey: ["admin-pt-applications"], queryFn: () => adminPtApplications.list() });
  // Bản nháp chưa nộp không phải việc của quản trị viên.
  const rows = sortPtQueue(ptApplicationRows(query.data).filter((a) => a.status !== "DRAFT"));
  const back = () => (router.canGoBack() ? router.back() : router.replace("/admin/approvals"));

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title="Đơn ứng tuyển huấn luyện viên" onBack={back} />
      {query.isLoading ? (
        <ActivityIndicator className="mt-10" color={accent.primary} />
      ) : query.isError ? (
        <View className="items-center gap-3 p-8">
          <Text className="text-center font-body text-sm text-destructive">Không tải được danh sách đơn.</Text>
          <Button variant="secondary" onPress={() => void query.refetch()}>
            Thử lại
          </Button>
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(a) => a.id}
          contentContainerStyle={{ padding: 20, gap: 10, paddingBottom: insets.bottom + 32 }}
          refreshControl={
            <RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={accent.primary} colors={[accent.primary]} />
          }
          ListEmptyComponent={<EmptyState icon={Dumbbell} title="Chưa có đơn ứng tuyển nào" />}
          renderItem={({ item: a }) => {
            const st = ptAppStatus(a.status);
            const when = a.submittedAt ? new Date(a.submittedAt).toLocaleDateString("vi-VN") : "";
            return (
              <Tappable accessibilityLabel={applicantName(a)} onPress={() => router.push(`/admin/pt-applications/${a.id}`)}>
                <Card className="flex-row items-center gap-3 p-4">
                  <View className="min-w-0 flex-1">
                    <Text className="font-body-semibold text-sm text-foreground" numberOfLines={1}>
                      {applicantName(a)}
                    </Text>
                    <Text className="font-body text-xs text-muted-foreground" numberOfLines={1}>
                      {[applicantEmail(a), when ? `nộp ${when}` : ""].filter(Boolean).join(" · ")}
                    </Text>
                  </View>
                  <Badge tone={st.tone}>{st.label}</Badge>
                  <ChevronRight size={16} color={designTokens.mutedForeground} />
                </Card>
              </Tappable>
            );
          }}
        />
      )}
    </View>
  );
}
