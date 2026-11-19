import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, RefreshControl, ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";
import { ChevronRight, Dumbbell } from "lucide-react-native";

import { Badge, Button, Card, EmptyState, Input, ScreenHeader, Tappable, inputPlaceholderColor } from "../../../src/components/ui";
import { adminPtApplications } from "../../../src/services/api";
import { useWorkspaceAccent } from "../../../src/theme/workspace";
import { designTokens } from "../../../src/theme/colors";
import {
  applicantEmail,
  applicantName,
  PT_PAGE_SIZE,
  PT_QUEUE_FILTERS,
  mergePtPages,
  nextPtPage,
  ptAppStatus,
  ptListParams,
} from "../../../src/features/admin/adminModeration";

/**
 * AD-02 — đơn ứng tuyển huấn luyện viên. Một danh sách theo từng nhóm trạng thái (mặc định "Mới nộp", nộp sớm
 * nhất lên đầu), thay cho bảng của web; quyết định làm ở màn chi tiết. Máy chủ chia trang + tìm kiếm theo tên /
 * email (FIX5-ADMIN-PERF: 10 nghìn đơn); màn cuộn vô hạn, mỗi lần 20 đơn.
 */
export default function AdminPtApplicationsScreen() {
  const insets = useSafeAreaInsets();
  const accent = useWorkspaceAccent();
  const [status, setStatus] = useState("SUBMITTED");
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 350);
    return () => clearTimeout(t);
  }, [q]);
  // Bản nháp chưa nộp không phải việc của quản trị viên nên không có nhóm "Bản nháp".
  const query = useInfiniteQuery({
    queryKey: ["admin-pt-applications", "list", status, debouncedQ],
    initialPageParam: 1,
    placeholderData: keepPreviousData,
    getNextPageParam: (last: unknown, _all: unknown, lastPage: unknown) => nextPtPage(last as { rows?: unknown[]; total?: number }, lastPage as number, PT_PAGE_SIZE),
    queryFn: ({ pageParam }) => adminPtApplications.list(ptListParams({ status, q: debouncedQ, page: pageParam as number })),
  });
  const pages = (query.data?.pages ?? []) as Array<{ rows: unknown[]; total: number }>;
  const rows = useMemo(() => mergePtPages(pages), [pages]);
  const total = pages[0]?.total ?? 0;
  const back = () => (router.canGoBack() ? router.back() : router.replace("/admin/approvals"));

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title="Đơn ứng tuyển huấn luyện viên" onBack={back} />
      <View className="gap-3 pb-1 pt-3">
        <View className="px-5">
          <Input
            value={q}
            onChangeText={setQ}
            placeholder="Tìm theo tên hoặc email người nộp"
            placeholderTextColor={inputPlaceholderColor}
            autoCorrect={false}
            autoCapitalize="none"
          />
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingHorizontal: 20 }}>
          {PT_QUEUE_FILTERS.map((o) => {
            const on = o.value === status;
            return (
              <Tappable
                key={o.value}
                accessibilityLabel={o.label}
                onPress={() => setStatus(o.value)}
                className={`min-h-10 justify-center rounded-full border px-4 ${on ? "border-primary bg-primary/15" : "border-border bg-panel"}`}
              >
                <Text className={`font-body text-xs ${on ? "text-primary" : "text-muted-foreground"}`}>{o.label}</Text>
              </Tappable>
            );
          })}
        </ScrollView>
        <Text className="px-5 font-body text-xs text-muted-foreground">
          {`${total} đơn`}
          {query.isFetching && !query.isFetchingNextPage ? " · đang tải…" : ""}
        </Text>
      </View>
      {query.isLoading && rows.length === 0 ? (
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
          keyboardShouldPersistTaps="handled"
          onEndReachedThreshold={0.6}
          onEndReached={() => {
            if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
          }}
          ListFooterComponent={query.isFetchingNextPage ? <ActivityIndicator className="my-4" color={accent.primary} /> : null}
          contentContainerStyle={{ padding: 20, gap: 10, paddingBottom: insets.bottom + 32 }}
          refreshControl={
            <RefreshControl refreshing={query.isRefetching && !query.isFetchingNextPage} onRefresh={() => void query.refetch()} tintColor={accent.primary} colors={[accent.primary]} />
          }
          ListEmptyComponent={<EmptyState icon={Dumbbell} title={debouncedQ ? "Không có đơn nào khớp" : "Chưa có đơn nào ở nhóm này"} />}
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
