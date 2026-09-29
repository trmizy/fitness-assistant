import { useMemo } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Banknote,
  Bell,
  CalendarClock,
  CheckCircle2,
  Dumbbell,
  FileText,
  Salad,
  ShieldCheck,
  Sparkles,
  type LucideIcon,
} from "lucide-react-native";

import { Card, EmptyState, ScreenHeader, Stagger, StaggerItem, useToast } from "../../src/components/ui";
import { notificationService } from "../../src/services/api";
import { useApp } from "../../src/context/AppContext";
import { useWorkspaceAccent } from "../../src/theme/workspace";
import { darkColors, designTokens } from "../../src/theme/colors";
import {
  groupNotifications,
  normalizeNotifications,
  notificationMeta,
  notificationRoute,
  timeAgo,
  type AppNotification,
  type NotificationIcon,
  type NotificationTone,
} from "../../src/features/notifications/notifications";
import { notificationsKey, unreadCountKey, useUnreadNotifications } from "../../src/features/notifications/useNotifications";

const ICONS: Record<NotificationIcon, LucideIcon> = {
  calendar: CalendarClock,
  check: CheckCircle2,
  money: Banknote,
  sparkles: Sparkles,
  dumbbell: Dumbbell,
  shield: ShieldCheck,
  alert: AlertTriangle,
  bell: Bell,
  file: FileText,
  salad: Salad,
};

const PAGE = 20;

/**
 * CL-20 — "Thông báo". Visual: the design's Notifications.tsx (grouped by day, unread tint + dot,
 * "Đọc hết"). Data: user-service `/notifications` (web shows the same list in its top-bar
 * dropdown). Tapping marks the item read and opens the matching mobile screen; items whose web
 * link has no mobile screen yet just get marked read. New items arrive over `notification:new`.
 */
export default function ClientNotificationsScreen() {
  const insets = useSafeAreaInsets();
  const accent = useWorkspaceAccent();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { user } = useApp();
  const userId = user?.id ?? "guest";
  const unread = useUnreadNotifications();

  const query = useInfiniteQuery({
    queryKey: notificationsKey(userId),
    queryFn: async ({ pageParam }) => normalizeNotifications(await notificationService.list(pageParam, PAGE)),
    initialPageParam: 1,
    getNextPageParam: (last, pages) => (last.items.length < PAGE ? undefined : pages.length + 1),
    enabled: !!user?.id,
  });
  const items = useMemo(() => {
    const seen = new Set<string>();
    return (query.data?.pages ?? []).flatMap((p) => p.items).filter((n) => (seen.has(n.id) ? false : (seen.add(n.id), true)));
  }, [query.data]);
  const groups = useMemo(() => groupNotifications(items), [items]);

  const refreshAll = () => {
    void queryClient.invalidateQueries({ queryKey: notificationsKey(userId) });
    void queryClient.invalidateQueries({ queryKey: unreadCountKey(userId) });
  };

  const markRead = useMutation({
    mutationFn: (id: string) => notificationService.markRead(id),
    onSuccess: refreshAll,
  });
  const markAll = useMutation({
    mutationFn: () => notificationService.markAllRead(),
    onSuccess: () => {
      refreshAll();
      toast.show("Đã đánh dấu tất cả đã đọc", "success");
    },
    onError: () => toast.show("Không thể đánh dấu — thử lại sau", "danger"),
  });

  const open = (n: AppNotification) => {
    if (n.unread) markRead.mutate(n.id);
    const route = notificationRoute(n);
    if (route) router.push(route as never);
  };

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader
        title="Thông báo"
        onBack={() => (router.canGoBack() ? router.back() : router.replace("/client/dashboard"))}
        right={
          unread > 0 ? (
            <Pressable accessibilityRole="button" hitSlop={8} disabled={markAll.isPending} onPress={() => markAll.mutate()} className="pr-2">
              <Text className="font-body-semibold text-sm text-primary">Đọc hết</Text>
            </Pressable>
          ) : undefined
        }
      />
      <ScrollView
        contentContainerStyle={{ padding: 20, gap: 24, paddingBottom: insets.bottom + 32 }}
        refreshControl={<RefreshControl refreshing={query.isRefetching && !query.isFetchingNextPage} onRefresh={refreshAll} tintColor={accent.primary} colors={[accent.primary]} />}
        onScroll={({ nativeEvent: e }) => {
          if (e.layoutMeasurement.height + e.contentOffset.y >= e.contentSize.height - 400 && query.hasNextPage && !query.isFetchingNextPage) {
            void query.fetchNextPage();
          }
        }}
        scrollEventThrottle={200}
      >
        {query.isLoading ? (
          <ActivityIndicator className="py-16" color={accent.primary} />
        ) : query.isError ? (
          <EmptyState icon={Bell} title="Không tải được thông báo" description="Kéo xuống để thử lại." actionLabel="Thử lại" onAction={refreshAll} />
        ) : groups.length === 0 ? (
          <EmptyState icon={Bell} title="Chưa có thông báo" description="Nhắc lịch tập, buổi tập với PT và hoàn tiền sẽ hiện ở đây." />
        ) : (
          groups.map((g) => (
            <View key={g.label}>
              <Text className="mb-2 px-1 font-body-semibold text-xs uppercase tracking-wide text-muted-foreground">{g.label}</Text>
              <Stagger className="gap-2.5">
                {g.items.map((n) => {
                  const meta = notificationMeta(n.eventType);
                  const Icon = ICONS[meta.icon];
                  return (
                    <StaggerItem key={n.id}>
                      <Card className={`flex-row gap-3 p-4 ${n.unread ? "border-primary/30 bg-primary/5" : ""}`} onPress={() => open(n)}>
                        <View className={`h-10 w-10 items-center justify-center rounded-xl ${toneBg(meta.tone)}`}>
                          <Icon size={18} color={toneColor(meta.tone, accent.primary)} />
                        </View>
                        <View className="min-w-0 flex-1">
                          <View className="flex-row items-center gap-2">
                            <Text className="flex-shrink font-body-semibold text-sm text-foreground">{meta.title}</Text>
                            {n.unread ? <View className="h-2 w-2 rounded-full bg-primary" /> : null}
                          </View>
                          <Text className="mt-0.5 font-body text-sm leading-5 text-muted-foreground">{n.text}</Text>
                          <Text className="mt-1 font-body text-xs text-muted-foreground">{timeAgo(n.createdAt)}</Text>
                        </View>
                      </Card>
                    </StaggerItem>
                  );
                })}
              </Stagger>
            </View>
          ))
        )}
        {query.isFetchingNextPage ? <ActivityIndicator color={accent.primary} /> : null}
        {!query.isLoading && groups.length > 0 && !query.hasNextPage ? (
          <View className="items-center gap-2 pt-2">
            <Bell size={20} color={designTokens.mutedForeground} />
            <Text className="font-body text-xs text-muted-foreground">Bạn đã xem hết thông báo</Text>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

function toneBg(t: NotificationTone) {
  return t === "warning" ? "bg-warning/15" : t === "danger" ? "bg-destructive/15" : "bg-primary/15";
}
function toneColor(t: NotificationTone, primary: string) {
  return t === "warning" ? designTokens.warning : t === "danger" ? darkColors.destructive : primary;
}
