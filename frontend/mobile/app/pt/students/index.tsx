import { useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Search, Users } from "lucide-react-native";

import {
  Avatar,
  Badge,
  Card,
  EmptyState,
  ProgressRing,
  Stagger,
  StaggerItem,
  Tappable,
  inputPlaceholderColor,
} from "../../../src/components/ui";
import { contractService } from "../../../src/services/api";
import { useApp } from "../../../src/context/AppContext";
import { useWorkspaceAccent } from "../../../src/theme/workspace";
import { designTokens } from "../../../src/theme/colors";
import {
  STUDENT_FILTERS,
  type StudentFilterKey,
  filterStudents,
  ptContractStatus,
  studentCounts,
  studentsFromContracts,
} from "../../../src/features/pt/pt";

/**
 * PT-02 — "Học viên". Visual: the design's PTStudents (search field, segmented filter, a row per
 * student with a progress ring around the avatar). Data: web's PTClientList — one read,
 * `GET /contracts/pt`, because in Gymini a "student" IS a contract; there is no separate roster
 * model, and a client with two contracts legitimately appears twice, once per package.
 *
 * Web's five English chips collapse to four Vietnamese ones (see STUDENT_FILTERS): Completed and
 * Expired both mean "the relationship is over" to a trainer scanning a phone.
 */
export default function PtStudentsScreen() {
  const insets = useSafeAreaInsets();
  const accent = useWorkspaceAccent();
  const { user } = useApp();
  const uid = user?.id ?? "guest";

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<StudentFilterKey>("active");

  const contractsQuery = useQuery({ queryKey: ["pt-contracts", uid], queryFn: () => contractService.getByPT() });
  const rows = studentsFromContracts(contractsQuery.data);
  const counts = studentCounts(rows);
  const visible = filterStudents(rows, query, filter);

  return (
    <View className="flex-1 bg-background">
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: insets.bottom + 32 }}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={contractsQuery.isRefetching}
            onRefresh={() => void contractsQuery.refetch()}
            tintColor={accent.primary}
            colors={[accent.primary]}
          />
        }
      >
        <View className="px-5">
          <Text className="font-display text-2xl text-foreground">Học viên</Text>
          <Text className="mt-0.5 font-body text-sm text-muted-foreground">
            {contractsQuery.isLoading ? "Đang tải…" : `${rows.length} hợp đồng huấn luyện`}
          </Text>

          <View className="mt-4 h-11 flex-row items-center gap-2 rounded-xl border border-border bg-panel px-3.5">
            <Search size={17} color={designTokens.mutedForeground} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Tìm theo tên học viên hoặc gói"
              placeholderTextColor={inputPlaceholderColor}
              className="flex-1 font-body text-sm text-foreground"
              returnKeyType="search"
            />
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mt-3" contentContainerStyle={{ gap: 8 }}>
            {STUDENT_FILTERS.map((f) => {
              const active = filter === f.key;
              return (
                <Tappable
                  key={f.key}
                  accessibilityLabel={f.label}
                  onPress={() => setFilter(f.key)}
                  className={`rounded-full border px-3.5 py-2 ${active ? "border-primary bg-primary/15" : "border-border bg-panel"}`}
                >
                  <Text className={`font-body-semibold text-xs ${active ? "text-primary" : "text-muted-foreground"}`}>
                    {f.label} · {counts[f.key]}
                  </Text>
                </Tappable>
              );
            })}
          </ScrollView>
        </View>

        {contractsQuery.isLoading ? (
          <ActivityIndicator className="mt-10" color={accent.primary} />
        ) : contractsQuery.isError ? (
          <Text className="mt-6 px-5 font-body text-sm text-destructive">
            Không tải được danh sách học viên. Kéo xuống để thử lại.
          </Text>
        ) : visible.length === 0 ? (
          <View className="px-5 pt-6">
            <EmptyState
              icon={Users}
              title={rows.length === 0 ? "Chưa có học viên" : "Không có học viên khớp"}
              description={
                rows.length === 0
                  ? "Học viên sẽ xuất hiện khi có người gửi yêu cầu hợp đồng cho bạn."
                  : "Thử từ khoá khác hoặc đổi bộ lọc."
              }
            />
          </View>
        ) : (
          <Stagger className="gap-3 px-5 pt-5">
            {visible.map((s) => {
              const st = ptContractStatus(s.status);
              return (
                <StaggerItem key={s.contractId}>
                  <Card
                    className="flex-row items-center gap-3 p-4"
                    onPress={() => router.push(`/pt/students/${s.contractId}` as never)}
                  >
                    <ProgressRing progress={s.progress} size={52} stroke={4}>
                      <Avatar name={s.name} size={38} />
                    </ProgressRing>
                    <View className="min-w-0 flex-1">
                      <View className="flex-row items-center gap-2">
                        <Text className="min-w-0 flex-1 font-body-semibold text-sm text-foreground" numberOfLines={1}>
                          {s.name}
                        </Text>
                        <Badge tone={st.tone === "neutral" ? "info" : st.tone}>{st.label}</Badge>
                      </View>
                      <Text className="font-body text-xs text-muted-foreground" numberOfLines={1}>
                        {s.goal} · {s.packageName}
                      </Text>
                      <Text className="mt-0.5 font-body-semibold text-xs text-primary">
                        {s.total > 0 ? `${s.used}/${s.total} buổi` : `${s.used} buổi đã tập`}
                      </Text>
                    </View>
                    <ChevronRight size={18} color={designTokens.mutedForeground} />
                  </Card>
                </StaggerItem>
              );
            })}
          </Stagger>
        )}
      </ScrollView>
    </View>
  );
}
