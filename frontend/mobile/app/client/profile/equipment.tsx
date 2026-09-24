import { useMemo, useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button, Card, ScreenHeader, useToast } from "../../../src/components/ui";
import { EquipmentPicker, TrainingLocationPresetRow, preselectFromLegacyEquipment } from "../../../src/components/EquipmentPicker";
import { equipmentService, profileService, type EquipmentCatalogItem } from "../../../src/services/api";
import { useApp } from "../../../src/context/AppContext";
import { useWorkspaceAccent } from "../../../src/theme/workspace";

/**
 * SH-08 — "Thiết bị tập luyện" (web's TrainingEquipmentSettingsPage; the design's
 * EquipmentSettings). Same picker the onboarding step uses, same `PUT` of equipment ids. Changing
 * it never rewrites workout history — it applies to plans generated from now on.
 */
export default function EquipmentSettingsScreen() {
  const insets = useSafeAreaInsets();
  const accent = useWorkspaceAccent();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { user } = useApp();
  const userId = user?.id ?? "guest";

  const catalogQuery = useQuery({ queryKey: ["equipment", "catalog"], queryFn: () => equipmentService.getCatalog() });
  const mineQuery = useQuery({ queryKey: ["equipment", "mine", userId], queryFn: () => equipmentService.getMyEquipment() });
  const profileQuery = useQuery({
    queryKey: ["profile", userId],
    queryFn: async () => (await profileService.getProfile())?.profile ?? null,
    enabled: !!user?.id,
  });
  const catalog: EquipmentCatalogItem[] = catalogQuery.data ?? [];

  // What the account has saved (or, never having saved granular equipment, its legacy free-text
  // answers mapped through the strict alias table); the user's own edits take over once made.
  const initial = useMemo(() => {
    if (!catalogQuery.data || !mineQuery.data || profileQuery.isLoading) return null;
    const idToSlug = new Map(catalogQuery.data.map((eq) => [eq.id, eq.slug]));
    const slugs = mineQuery.data.map((id) => idToSlug.get(id)).filter((s): s is string => !!s);
    if (slugs.length > 0) return { set: new Set(slugs), fromLegacy: false };
    const legacy = (profileQuery.data as any)?.availableEquipment;
    const pre = Array.isArray(legacy) ? preselectFromLegacyEquipment(legacy) : new Set<string>();
    return { set: pre, fromLegacy: pre.size > 0 };
  }, [catalogQuery.data, mineQuery.data, profileQuery.data, profileQuery.isLoading]);
  const [edited, setEdited] = useState<Set<string> | null>(null);
  const selected = edited ?? initial?.set ?? new Set<string>();
  const fromLegacy = edited === null && !!initial?.fromLegacy;

  const save = useMutation({
    mutationFn: () => equipmentService.setMyEquipment(catalog.filter((eq) => selected.has(eq.slug)).map((eq) => eq.id)),
    onSuccess: () => {
      toast.show("Đã cập nhật thiết bị — áp dụng cho các kế hoạch mới từ giờ trở đi.", "success");
      void queryClient.invalidateQueries({ queryKey: ["equipment", "mine", userId] });
    },
    onError: (e: any) => toast.show(e?.response?.data?.error ?? "Không thể lưu thiết bị", "danger"),
  });

  const loading = catalogQuery.isLoading || mineQuery.isLoading || profileQuery.isLoading;
  const change = (next: Set<string>) => setEdited(next);

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title="Thiết bị tập luyện" onBack={() => (router.canGoBack() ? router.back() : router.replace("/client/profile"))} />
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: insets.bottom + 32 }} keyboardShouldPersistTaps="handled">
        <Text className="font-body text-sm leading-5 text-muted-foreground">
          Đổi phòng gym hoặc cập nhật thiết bị bạn có. Không ảnh hưởng lịch sử tập đã ghi — chỉ áp dụng cho các kế hoạch tạo mới từ bây giờ.
        </Text>
        <Card className="gap-4 p-4">
          {loading ? (
            <ActivityIndicator className="py-8" color={accent.primary} />
          ) : catalogQuery.isError || mineQuery.isError ? (
            <Text className="font-body text-sm text-destructive">Không tải được danh sách thiết bị. Kéo lại sau.</Text>
          ) : (
            <>
              {fromLegacy ? (
                <Text className="rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 font-body text-xs text-muted-foreground">
                  Đã đánh dấu sẵn theo lựa chọn cũ của bạn — kiểm tra lại rồi bấm “Lưu thiết bị” để xác nhận.
                </Text>
              ) : null}
              <TrainingLocationPresetRow onApply={(slugs) => change(new Set(slugs))} />
              <EquipmentPicker catalog={catalog} selectedSlugs={selected} onChange={change} />
              <Text className="font-body text-[11px] text-muted-foreground">
                {selected.size === 0 ? "Không chọn gì = hệ thống giả định phòng gym đầy đủ thiết bị." : `Đã chọn ${selected.size} thiết bị.`}
              </Text>
            </>
          )}
        </Card>
        <Button full size="lg" disabled={loading || save.isPending} onPress={() => save.mutate()}>
          {save.isPending ? "Đang lưu…" : "Lưu thiết bị"}
        </Button>
      </ScrollView>
    </View>
  );
}
