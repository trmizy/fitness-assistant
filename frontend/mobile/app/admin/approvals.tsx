import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, type Href } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Building2, ChevronRight, Dumbbell, Store, Warehouse, type LucideIcon } from "lucide-react-native";

import { Badge, Card, Stagger, StaggerItem, Tappable } from "../../src/components/ui";
import { adminPtApplications, adminService, marketplaceService } from "../../src/services/api";
import { useWorkspaceAccent } from "../../src/theme/workspace";
import { designTokens } from "../../src/theme/colors";
import { queueCounts } from "../../src/features/admin/adminPartners";
import { listingRows, ptApplicationRows, ptAwaitingCount } from "../../src/features/admin/adminModeration";

function QueueRow({
  icon: Icon,
  title,
  hint,
  href,
  count,
  loading,
}: {
  icon: LucideIcon;
  title: string;
  hint: string;
  href: Href;
  count: number | null;
  loading: boolean;
}) {
  const accent = useWorkspaceAccent();
  return (
    <Tappable accessibilityLabel={title} onPress={() => router.push(href)}>
      <Card className="flex-row items-center gap-3 p-4">
        <View className="h-10 w-10 items-center justify-center rounded-xl bg-primary/15">
          <Icon size={18} color={accent.primary} />
        </View>
        <View className="min-w-0 flex-1">
          <Text className="font-body-semibold text-sm text-foreground">{title}</Text>
          <Text className="font-body text-xs text-muted-foreground">{hint}</Text>
        </View>
        {loading ? (
          <ActivityIndicator color={accent.primary} />
        ) : count && count > 0 ? (
          <Badge tone="warning">{`${count} chờ`}</Badge>
        ) : null}
        <ChevronRight size={16} color={designTokens.mutedForeground} />
      </Card>
    </Tappable>
  );
}

/**
 * AD-02 "Duyệt" — hub mọi hàng chờ cần quản trị viên quyết định, mỗi hàng kèm số việc đang chờ thật.
 * Hồ sơ đối tác (WB-17) đứng đầu vì là đường duy nhất để một chủ phòng gym tồn tại.
 */
export default function AdminApprovalsScreen() {
  const insets = useSafeAreaInsets();
  const accent = useWorkspaceAccent();

  // B40 — ONE source for the three review counts: the server's own queue (canonical keys), the same numbers
  // the Partners and Branches screens show. Brand renames are a separate line, never summed into branches.
  const queue = useQuery({ queryKey: ["admin-partner-queue"], queryFn: () => adminService.getPartnerQueue() });
  const pts = useQuery({ queryKey: ["admin-pt-applications"], queryFn: () => adminPtApplications.list() });
  const plans = useQuery({
    queryKey: ["admin-marketplace", "SUBMITTED"],
    queryFn: () => marketplaceService.adminListForModeration("SUBMITTED"),
  });

  const counts = queueCounts(queue.data);

  const refresh = () => [queue, pts, plans].forEach((q) => void q.refetch());

  return (
    <View className="flex-1 bg-background">
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: insets.bottom + 32 }}
        refreshControl={
          <RefreshControl refreshing={queue.isRefetching} onRefresh={refresh} tintColor={accent.primary} colors={[accent.primary]} />
        }
      >
        <View className="px-5">
          <Text className="font-display text-xl text-foreground">Duyệt</Text>
          <Text className="mt-0.5 font-body text-xs text-muted-foreground">Các hàng chờ cần quản trị viên xử lý</Text>
        </View>

        <Stagger className="gap-3 px-5 pt-5">
          <StaggerItem>
            <QueueRow
              icon={Building2}
              title="Hồ sơ đối tác"
              hint="Chủ phòng gym mới đăng ký"
              href="/admin/applications"
              count={counts.applications}
              loading={queue.isLoading}
            />
          </StaggerItem>
          <StaggerItem>
            <QueueRow
              icon={Warehouse}
              title="Chi nhánh phòng gym"
              hint="Chi nhánh mới, đổi tên/địa chỉ"
              href="/admin/gyms"
              count={counts.branches}
              loading={queue.isLoading}
            />
          </StaggerItem>
          <StaggerItem>
            <QueueRow
              icon={Building2}
              title="Đổi tên thương hiệu"
              hint="Thương hiệu xin đổi tên hiển thị"
              href="/admin/gyms"
              count={counts.brandRenames}
              loading={queue.isLoading}
            />
          </StaggerItem>
          <StaggerItem>
            <QueueRow
              icon={Dumbbell}
              title="Đơn ứng tuyển huấn luyện viên"
              hint="Xác minh giấy tờ và chuyên môn"
              href="/admin/pt-applications"
              count={ptAwaitingCount(ptApplicationRows(pts.data))}
              loading={pts.isLoading}
            />
          </StaggerItem>
          <StaggerItem>
            <QueueRow
              icon={Store}
              title="Kế hoạch trên chợ"
              hint="Kế hoạch tập người dùng đăng bán"
              href="/admin/marketplace"
              count={listingRows(plans.data).length}
              loading={plans.isLoading}
            />
          </StaggerItem>
        </Stagger>
      </ScrollView>
    </View>
  );
}
