import { useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Handshake, Search } from "lucide-react-native";

import { Badge, Card, EmptyState, Input, ScreenHeader, Tappable, inputPlaceholderColor } from "../../../src/components/ui";
import { adminService } from "../../../src/services/api";
import { useWorkspaceAccent } from "../../../src/theme/workspace";
import { designTokens } from "../../../src/theme/colors";
import {
  PARTNER_FILTERS,
  nb,
  opensApplication,
  partnerCardMeta,
  partnerRows,
  partnerStatus,
  queueItems,
  searchPartners,
} from "../../../src/features/admin/adminPartners";

/**
 * 14B.8 (PG-D1) — web AdminPartnersPage's "Đối tác" view: what needs doing ("Cần bạn xử lý"), search
 * by name / email / tax code, a status filter, and the partner list. A self-registered partner still
 * being vetted opens in the application review (WB-17), exactly as on web.
 */
export default function AdminPartnersScreen() {
  const insets = useSafeAreaInsets();
  const accent = useWorkspaceAccent();
  const [filter, setFilter] = useState("ALL");
  const [search, setSearch] = useState("");

  const queueQuery = useQuery({ queryKey: ["admin-partner-queue"], queryFn: () => adminService.getPartnerQueue() });
  const partnersQuery = useQuery({
    queryKey: ["admin-partners", filter],
    queryFn: () => adminService.listPartners(filter === "ALL" ? undefined : filter),
  });

  const queue = queueItems(queueQuery.data);
  const rows = searchPartners(partnerRows(partnersQuery.data), search);
  const back = () => (router.canGoBack() ? router.back() : router.replace("/admin/dashboard"));
  const refresh = () => {
    void queueQuery.refetch();
    void partnersQuery.refetch();
  };

  // A queue line jumps to where that work is done: prospects filter this list; branches and brand
  // names live in the branch review; expiring licences have no list of their own on web either.
  const openQueue = (item: (typeof queue)[number]) => {
    if (item.filter) setFilter(item.filter);
    else if (item.key === "pendingGyms" || item.key === "pendingBrandRenames") router.push("/admin/gyms");
  };

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title="Đối tác" onBack={back} />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 32, gap: 14 }}
        refreshControl={
          <RefreshControl refreshing={partnersQuery.isRefetching} onRefresh={refresh} tintColor={accent.primary} colors={[accent.primary]} />
        }
      >
        <Card className="gap-2 p-4">
          <Text className="font-body-semibold text-sm text-foreground">Cần bạn xử lý</Text>
          {queueQuery.isLoading ? (
            <ActivityIndicator className="self-start" color={accent.primary} />
          ) : queue.length === 0 ? (
            <Text className="font-body text-xs text-muted-foreground">Không có việc nào chờ xử lý.</Text>
          ) : (
            queue.map((item) => (
              <Tappable
                key={item.key}
                accessibilityLabel={item.label}
                onPress={() => openQueue(item)}
                disabled={!item.filter && item.key === "expiringDocs"}
                className="flex-row items-center gap-2 py-1.5"
              >
                <View className="h-2 w-2 rounded-full bg-warning" />
                <Text className="flex-1 font-body text-sm text-foreground">
                  <Text className="font-body-semibold text-warning">{item.count}</Text> {item.label}
                </Text>
                {item.key !== "expiringDocs" ? <ChevronRight size={16} color={designTokens.mutedForeground} /> : null}
              </Tappable>
            ))
          )}
        </Card>

        <Input
          icon={Search}
          value={search}
          onChangeText={setSearch}
          placeholder="Tìm tên, email, mã số thuế…"
          placeholderTextColor={inputPlaceholderColor}
          autoCapitalize="none"
        />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {PARTNER_FILTERS.map((f) => {
            const on = f.value === filter;
            return (
              <Tappable
                key={f.value}
                accessibilityLabel={f.label}
                onPress={() => setFilter(f.value)}
                className={`rounded-full border px-3 py-1.5 ${on ? "border-primary bg-primary/15" : "border-border bg-panel"}`}
              >
                <Text numberOfLines={1} className={`font-body text-xs ${on ? "text-primary" : "text-muted-foreground"}`}>{nb(f.label)}</Text>
              </Tappable>
            );
          })}
        </ScrollView>

        {partnersQuery.isLoading ? (
          <ActivityIndicator className="mt-6" color={accent.primary} />
        ) : partnersQuery.isError ? (
          <Text className="font-body text-sm text-destructive">Không tải được danh sách đối tác. Kéo xuống để thử lại.</Text>
        ) : rows.length === 0 ? (
          <EmptyState icon={Handshake} title="Không có đối tác nào khớp bộ lọc" />
        ) : (
          rows.map((p) => {
            const st = partnerStatus(p.status);
            const meta = partnerCardMeta(p);
            return (
              <Tappable
                key={p.id}
                accessibilityLabel={p.legalName}
                onPress={() => router.push((opensApplication(p) ? `/admin/applications/${p.id}` : `/admin/partners/${p.id}`) as never)}
              >
                <Card className="flex-row items-center gap-3 p-4">
                  <View className="min-w-0 flex-1 gap-0.5">
                    <Text className="font-body-semibold text-sm text-foreground" numberOfLines={1}>
                      {p.legalName}
                    </Text>
                    <Text className="font-body text-xs text-muted-foreground" numberOfLines={1}>
                      {p.contactEmail ?? "—"}
                      {p.rejectedAt ? " · đã từ chối" : ""}
                    </Text>
                    {meta ? <Text className="font-body text-[11px] text-muted-foreground">{meta}</Text> : null}
                  </View>
                  <Badge tone={st.tone}>{st.label}</Badge>
                  <ChevronRight size={16} color={designTokens.mutedForeground} />
                </Card>
              </Tappable>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}
