import { useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Building2, ChevronRight, Clock } from "lucide-react-native";

import { Badge, Card, EmptyState, ScreenHeader, Stagger, StaggerItem, Tappable } from "../../../src/components/ui";
import { adminPartnerApplications } from "../../../src/services/api";
import { useWorkspaceAccent } from "../../../src/theme/workspace";
import { designTokens } from "../../../src/theme/colors";
import {
  REVIEW_TABS,
  applicationCounts,
  applicationRows,
  applicationSubtitle,
  applicationTitle,
  sortByWaiting,
  verificationStatus,
  waitingLabel,
} from "../../../src/features/adminApplications/adminApplications";

/**
 * WB-17 — hàng chờ "Duyệt hồ sơ đối tác".
 *
 * Đây là **đường duy nhất** để một chủ phòng gym tồn tại: luồng admin tự tạo tài khoản đã bị gỡ
 * (`POST /admin/partners` trả 410). Không có màn này thì không ai duyệt được ai.
 *
 * Xếp hồ sơ nộp lâu nhất lên đầu, không theo thứ tự máy chủ trả: một hàng chờ mà không thấy cái nào
 * để lâu nhất thì không phải hàng chờ.
 */
export default function AdminApplicationsScreen() {
  const insets = useSafeAreaInsets();
  const accent = useWorkspaceAccent();
  const [tab, setTab] = useState(REVIEW_TABS[0].value);

  const query = useQuery({
    queryKey: ["admin-partner-applications", tab],
    queryFn: () => adminPartnerApplications.list(tab),
  });

  const rows = sortByWaiting(applicationRows(query.data));
  const counts = applicationCounts(query.data);
  const back = () => (router.canGoBack() ? router.back() : router.replace("/admin/approvals"));

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title="Duyệt hồ sơ đối tác" onBack={back} />

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        className="max-h-14"
        contentContainerStyle={{ gap: 8, paddingHorizontal: 20, paddingVertical: 10 }}
      >
        {REVIEW_TABS.map((t) => {
          const on = t.value === tab;
          const n = counts[t.value];
          return (
            <Tappable
              key={t.value}
              accessibilityLabel={t.label}
              onPress={() => setTab(t.value)}
              className={`h-9 flex-row items-center gap-1.5 rounded-full border px-3.5 ${on ? "border-primary bg-primary/15" : "border-border bg-panel"}`}
            >
              <Text className={`font-body-semibold text-xs ${on ? "text-primary" : "text-muted-foreground"}`}>
                {t.label}
              </Text>
              {typeof n === "number" && n > 0 ? (
                <Text className="font-body-semibold text-[11px] text-muted-foreground">{n}</Text>
              ) : null}
            </Tappable>
          );
        })}
      </ScrollView>

      <ScrollView
        contentContainerStyle={{ padding: 20, paddingTop: 4, paddingBottom: insets.bottom + 32 }}
        refreshControl={
          <RefreshControl
            refreshing={query.isRefetching}
            onRefresh={() => void query.refetch()}
            tintColor={accent.primary}
            colors={[accent.primary]}
          />
        }
      >
        {query.isLoading ? (
          <ActivityIndicator className="mt-8" color={accent.primary} />
        ) : query.isError ? (
          <Text className="font-body text-sm text-destructive">Không tải được hàng chờ. Kéo xuống để thử lại.</Text>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Building2}
            title="Không có hồ sơ nào"
            description="Hồ sơ ở trạng thái này sẽ hiện tại đây."
          />
        ) : (
          <Stagger className="gap-3">
            {rows.map((r) => {
              const st = verificationStatus(r.verificationStatus);
              return (
                <StaggerItem key={r.id}>
                  <Tappable
                    accessibilityLabel={applicationTitle(r)}
                    onPress={() => router.push(`/admin/applications/${r.id}`)}
                  >
                    <Card className="gap-2 p-4">
                      <View className="flex-row items-start gap-3">
                        <View className="h-10 w-10 items-center justify-center rounded-xl bg-panel">
                          <Building2 size={18} color={designTokens.mutedForeground} />
                        </View>
                        <View className="min-w-0 flex-1">
                          <Text className="font-body-semibold text-sm text-foreground" numberOfLines={1}>
                            {applicationTitle(r)}
                          </Text>
                          <Text className="font-body text-xs text-muted-foreground" numberOfLines={1}>
                            {applicationSubtitle(r)}
                          </Text>
                        </View>
                        <ChevronRight size={16} color={designTokens.mutedForeground} />
                      </View>
                      <View className="flex-row items-center justify-between border-t border-border pt-2">
                        <Badge tone={st.tone}>{st.label}</Badge>
                        <View className="flex-row items-center gap-1.5">
                          <Clock size={12} color={designTokens.mutedForeground} />
                          <Text className="font-body text-[11px] text-muted-foreground">{waitingLabel(r)}</Text>
                        </View>
                      </View>
                    </Card>
                  </Tappable>
                </StaggerItem>
              );
            })}
          </Stagger>
        )}
      </ScrollView>
    </View>
  );
}
