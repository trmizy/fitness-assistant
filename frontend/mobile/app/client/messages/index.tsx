import { useEffect, useMemo } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { MessageCircle, WifiOff } from "lucide-react-native";

import { Avatar, Card, EmptyState, Stagger, StaggerItem } from "../../../src/components/ui";
import { chatService } from "../../../src/services/api";
import { useApp } from "../../../src/context/AppContext";
import { useWorkspaceAccent } from "../../../src/theme/workspace";
import { designTokens } from "../../../src/theme/colors";
import { normalizeConversations, peerName, peerRoleLabel, threadTime } from "../../../src/features/chat/chat";
import { conversationsKey, useRealtimeChat } from "../../../src/features/chat/useRealtimeChat";

/**
 * SH-04/CL-21 — "Tin nhắn": the design's Messages list with the real conversations (web's ChatPage
 * list pane). Only person-to-person threads live here: AI Coach is the floating button (WB-12,
 * decided 22/9). The list stays live over the gateway socket; a 10s refetch is the fallback web
 * also uses when the socket is down.
 *
 * `?conversationId=` (from "Nhắn PT" on a 1-1 order, or any deep link) opens that thread directly.
 */
export default function MessagesScreen() {
  const insets = useSafeAreaInsets();
  const accent = useWorkspaceAccent();
  const { user } = useApp();
  const userId = user?.id ?? "guest";
  const params = useLocalSearchParams<{ conversationId?: string }>();

  const query = useQuery({
    queryKey: conversationsKey(userId),
    queryFn: chatService.listConversations,
    refetchInterval: 10_000,
    enabled: !!user?.id,
  });
  const conversations = useMemo(() => normalizeConversations(query.data), [query.data]);
  const { connected, status } = useRealtimeChat(conversations.map((c) => c.id));

  useEffect(() => {
    if (typeof params.conversationId === "string" && params.conversationId) {
      router.setParams({ conversationId: undefined });
      router.push(`/client/messages/${params.conversationId}`);
    }
  }, [params.conversationId]);

  const errorText = query.error
    ? (() => {
        const e: any = query.error;
        const code = e?.response?.status;
        return code ? `Lỗi tải hội thoại (${code}).` : "Không kết nối được máy chủ.";
      })()
    : null;

  return (
    <View className="flex-1 bg-background">
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: 32, paddingHorizontal: 20 }}
        refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={accent.primary} colors={[accent.primary]} />}
      >
        <View className="mb-4 flex-row items-center justify-between">
          <Text className="font-display text-2xl text-foreground">Tin nhắn</Text>
          {status === "error" || status === "disconnected" ? (
            <View className="flex-row items-center gap-1">
              <WifiOff size={14} color={designTokens.warning} />
              <Text className="font-body text-xs text-warning">Đang kết nối lại…</Text>
            </View>
          ) : null}
        </View>

        {query.isLoading ? (
          <View className="items-center py-16">
            <ActivityIndicator color={accent.primary} />
          </View>
        ) : errorText && conversations.length === 0 ? (
          <EmptyState
            icon={MessageCircle}
            title={errorText}
            description='Kiểm tra "Cấu hình máy chủ" ở màn đăng nhập, hoặc đăng nhập lại.'
            actionLabel="Thử lại"
            onAction={() => void query.refetch()}
          />
        ) : conversations.length === 0 ? (
          <EmptyState
            icon={MessageCircle}
            title="Chưa có cuộc trò chuyện nào"
            description="Kết nối với huấn luyện viên ở mục Dịch vụ để bắt đầu trò chuyện."
            actionLabel="Tìm huấn luyện viên"
            onAction={() => router.push("/client/services")}
          />
        ) : (
          <Stagger className="gap-2.5">
            {conversations.map((c) => {
              const name = peerName(c);
              return (
                <StaggerItem key={c.id}>
                  <Card className="flex-row items-center gap-3 p-4" onPress={() => router.push(`/client/messages/${c.id}`)}>
                    <Avatar name={name} size={48} />
                    <View className="min-w-0 flex-1">
                      <View className="flex-row items-center justify-between gap-2">
                        <Text className="flex-1 font-body-semibold text-sm text-foreground" numberOfLines={1}>
                          {name}
                        </Text>
                        <Text className="font-body text-[11px] text-muted-foreground">{threadTime(c.lastMessageAt)}</Text>
                      </View>
                      <Text className="font-body text-[11px] text-primary">{peerRoleLabel(c.otherUser?.role)}</Text>
                      <Text className="mt-0.5 font-body text-sm text-muted-foreground" numberOfLines={1}>
                        {c.lastMessage?.content || "Chưa có tin nhắn"}
                      </Text>
                    </View>
                  </Card>
                </StaggerItem>
              );
            })}
          </Stagger>
        )}
        {connected ? null : conversations.length > 0 ? (
          <Text className="mt-4 text-center font-body text-[11px] text-muted-foreground">
            Tin nhắn mới sẽ hiện khi kết nối lại — danh sách vẫn tự làm mới mỗi 10 giây.
          </Text>
        ) : null}
      </ScrollView>
    </View>
  );
}
