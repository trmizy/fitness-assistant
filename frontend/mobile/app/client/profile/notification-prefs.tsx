import { useState } from "react";
import { ActivityIndicator, ScrollView, Switch, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Card, ScreenHeader, useToast } from "../../../src/components/ui";
import { notificationService, type NotificationPreferences } from "../../../src/services/api";
import { useApp } from "../../../src/context/AppContext";
import { useWorkspaceAccent } from "../../../src/theme/workspace";

// Web's NotificationPreferencesPage — every type defaults ON (backend: "no row yet = everything on").
const TOGGLES: { key: keyof NotificationPreferences; label: string; description: string }[] = [
  { key: "workoutUpcomingEnabled", label: "Buổi tập hôm nay", description: "Nhắc khi có buổi tập hôm nay mà bạn chưa bắt đầu" },
  { key: "workoutRescheduledEnabled", label: "Đã dời lịch", description: "Xác nhận mỗi khi bạn dời lịch một buổi tập" },
  { key: "workoutUnfinishedEnabled", label: "Buổi tập dang dở", description: "Nhắc khi một buổi tập đã bắt đầu nhưng chưa hoàn thành" },
  { key: "planUpdatedEnabled", label: "Cập nhật kế hoạch", description: "Báo khi PT gán hoặc cập nhật chương trình tập của bạn" },
  { key: "ptFeedbackEnabled", label: "Phản hồi từ PT", description: "Báo khi PT gửi phản hồi về buổi tập" },
];

/**
 * SH-08 — "Thông báo" preferences (the design's NotificationPrefs; web's
 * NotificationPreferencesPage). Each switch saves immediately (`PATCH`), optimistically, and flips
 * back if the server refuses. These govern in-app notifications; push delivery is Phase 14.
 */
export default function NotificationPrefsScreen() {
  const insets = useSafeAreaInsets();
  const accent = useWorkspaceAccent();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { user } = useApp();
  const key = ["notification-preferences", user?.id ?? "guest"];

  const query = useQuery({ queryKey: key, queryFn: () => notificationService.getPreferences() });
  // Optimistic value while a save is in flight; otherwise the server's.
  const [pending, setPending] = useState<NotificationPreferences | null>(null);
  const local = pending ?? query.data ?? null;

  const mutation = useMutation({
    mutationFn: (patch: Partial<NotificationPreferences>) => notificationService.updatePreferences(patch),
    onSuccess: (data) => {
      queryClient.setQueryData(key, data);
      setPending(null);
    },
    onError: () => {
      toast.show("Không thể cập nhật cài đặt thông báo", "danger");
      setPending(null);
    },
  });

  const toggle = (k: keyof NotificationPreferences) => {
    if (!local) return;
    const next = { ...local, [k]: !local[k] };
    setPending(next);
    mutation.mutate({ [k]: next[k] });
  };

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title="Cài đặt thông báo" onBack={() => (router.canGoBack() ? router.back() : router.replace("/client/profile"))} />
      <ScrollView contentContainerStyle={{ padding: 20, gap: 12, paddingBottom: insets.bottom + 32 }}>
        <Text className="font-body text-sm text-muted-foreground">Bật/tắt từng loại thông báo về buổi tập của bạn.</Text>
        {query.isLoading || !local ? (
          query.isError ? (
            <Text className="font-body text-sm text-destructive">Không tải được cài đặt thông báo.</Text>
          ) : (
            <ActivityIndicator className="py-10" color={accent.primary} />
          )
        ) : (
          TOGGLES.map((t) => (
            <Card key={t.key} className="flex-row items-center gap-4 p-4">
              <View className="flex-1">
                <Text className="font-body-semibold text-sm text-foreground">{t.label}</Text>
                <Text className="mt-0.5 font-body text-xs text-muted-foreground">{t.description}</Text>
              </View>
              <Switch
                accessibilityLabel={t.label}
                value={local[t.key]}
                onValueChange={() => toggle(t.key)}
                trackColor={{ true: accent.primary }}
              />
            </Card>
          ))
        )}
      </ScrollView>
    </View>
  );
}
