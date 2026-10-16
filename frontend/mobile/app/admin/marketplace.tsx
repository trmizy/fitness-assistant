import { useState } from "react";
import { ActivityIndicator, Alert, RefreshControl, ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, ChevronUp, Store, TriangleAlert, X } from "lucide-react-native";

import {
  Badge,
  BottomSheet,
  Button,
  Card,
  EmptyState,
  Input,
  ScreenHeader,
  Tappable,
  inputPlaceholderColor,
  useToast,
} from "../../src/components/ui";
import { marketplaceService } from "../../src/services/api";
import { useWorkspaceAccent } from "../../src/theme/workspace";
import { designTokens } from "../../src/theme/colors";
import { QUERY_GOAL_LABELS } from "../../src/features/plans/aiPlans";
import { friendlyError } from "../../src/features/partnerApplication/partnerApplication";
import {
  LISTING_FILTERS,
  listingAnalysis,
  listingRejectError,
  listingRows,
  listingSchedule,
  type Listing,
} from "../../src/features/admin/adminModeration";

/**
 * AD-02 — kế hoạch tập người dùng đăng lên chợ (web `MarketplaceModeration`). Mỗi kế hoạch kèm bản phân
 * tích tự động (cờ luật + gợi ý AI + kế hoạch có thể trùng) — hiện để người duyệt tham khảo, không tự
 * quyết định thay họ.
 */
export default function AdminMarketplaceScreen() {
  const insets = useSafeAreaInsets();
  const accent = useWorkspaceAccent();
  const toast = useToast();
  const qc = useQueryClient();
  const [filter, setFilter] = useState("SUBMITTED");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<Listing | null>(null);
  const [note, setNote] = useState("");

  const query = useQuery({
    queryKey: ["admin-marketplace", filter],
    queryFn: () => marketplaceService.adminListForModeration(filter),
    placeholderData: keepPreviousData,
  });
  const rows = listingRows(query.data);

  const review = useMutation({
    mutationFn: (v: { id: string; action: "APPROVE" | "REJECT"; note?: string }) =>
      marketplaceService.adminReviewAction(v.id, v.action, v.note),
    onSuccess: async (_r, v) => {
      toast.show(v.action === "APPROVE" ? "Đã duyệt kế hoạch" : "Đã từ chối kế hoạch", "success");
      setRejecting(null);
      setNote("");
      await qc.invalidateQueries({ queryKey: ["admin-marketplace"] });
    },
    onError: (e) => toast.show(friendlyError(e, "Không cập nhật được"), "danger"),
  });

  const back = () => (router.canGoBack() ? router.back() : router.replace("/admin/approvals"));

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title="Kế hoạch trên chợ" onBack={back} />
      <ScrollView
        contentContainerStyle={{ padding: 20, gap: 12, paddingBottom: insets.bottom + 32 }}
        refreshControl={
          <RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={accent.primary} colors={[accent.primary]} />
        }
      >
        <View className="flex-row gap-1.5">
          {LISTING_FILTERS.map((f) => {
            const on = f.value === filter;
            return (
              <Tappable
                key={f.value}
                accessibilityLabel={f.label}
                onPress={() => setFilter(f.value)}
                className={`rounded-full border px-3 py-1.5 ${on ? "border-primary bg-primary/15" : "border-border bg-panel"}`}
              >
                <Text className={`font-body text-xs ${on ? "text-primary" : "text-muted-foreground"}`}>{f.label}</Text>
              </Tappable>
            );
          })}
        </View>

        {query.isLoading ? (
          <ActivityIndicator className="mt-8" color={accent.primary} />
        ) : query.isError ? (
          <Card className="items-center gap-3 p-6">
            <Text className="text-center font-body text-sm text-destructive">Không tải được danh sách kế hoạch.</Text>
            <Button variant="secondary" onPress={() => void query.refetch()}>
              Thử lại
            </Button>
          </Card>
        ) : rows.length === 0 ? (
          <EmptyState icon={Store} title="Không có kế hoạch nào ở trạng thái này" />
        ) : (
          rows.map((l) => {
            const an = listingAnalysis(l);
            const schedule = listingSchedule(l);
            const open = expanded === l.id;
            return (
              <Card key={l.id} className="gap-3 p-4">
                <View className="gap-0.5">
                  <Text className="font-body-semibold text-sm text-foreground">{l.title}</Text>
                  {l.goal ? (
                    <Text className="font-body text-xs text-muted-foreground">{QUERY_GOAL_LABELS[String(l.goal)] ?? l.goal}</Text>
                  ) : null}
                  <Text className="font-body text-[11px] text-muted-foreground">
                    {l.publisherIsVerifiedPt ? "Người đăng: huấn luyện viên đã xác minh" : "Người đăng: người dùng thường"}
                  </Text>
                </View>

                {an ? (
                  <View className="gap-1.5 rounded-xl border border-border bg-panel p-3">
                    <View className="flex-row flex-wrap items-center gap-1.5">
                      <Badge tone={an.recommendation.tone}>{an.recommendation.label}</Badge>
                      {an.usedFallback ? <Badge tone="neutral">Chỉ theo luật</Badge> : null}
                    </View>
                    {an.flags.map((f) => (
                      <View key={f} className="flex-row items-start gap-1.5">
                        <TriangleAlert size={12} color={designTokens.warning} />
                        <Text className="flex-1 font-body text-xs text-muted-foreground">{f}</Text>
                      </View>
                    ))}
                    {an.similar.length > 0 ? (
                      <Text className="font-body text-xs text-warning">Có thể trùng với: {an.similar.join(", ")}</Text>
                    ) : null}
                  </View>
                ) : null}

                {l.description ? <Text className="font-body text-xs leading-5 text-muted-foreground">{l.description}</Text> : null}

                <Tappable
                  accessibilityLabel="Xem lịch tập"
                  onPress={() => setExpanded(open ? null : l.id)}
                  className="flex-row items-center gap-1"
                >
                  <Text className="font-body-semibold text-xs text-primary">
                    {open ? "Ẩn lịch tập" : `Xem lịch tập (${schedule.length} buổi)`}
                  </Text>
                  {open ? <ChevronUp size={13} color={accent.primary} /> : <ChevronDown size={13} color={accent.primary} />}
                </Tappable>
                {open ? (
                  schedule.length === 0 ? (
                    <Text className="font-body text-xs text-muted-foreground">Lịch tập trống.</Text>
                  ) : (
                    <View className="gap-2">
                      {schedule.map((d, i) => (
                        <View key={i} className="gap-0.5">
                          <Text className="font-body-semibold text-xs text-foreground">{d.title}</Text>
                          {d.exercises.map((e, j) => (
                            <Text key={j} className="font-body text-xs text-muted-foreground">
                              • {e}
                            </Text>
                          ))}
                        </View>
                      ))}
                    </View>
                  )
                ) : null}

                {l.moderationStatus === "REJECTED" && l.moderationNote ? (
                  <Text className="font-body text-xs text-destructive">Lý do từ chối: {l.moderationNote}</Text>
                ) : null}

                {l.moderationStatus === "SUBMITTED" ? (
                  <View className="flex-row gap-2">
                    <Button
                      size="sm"
                      icon={Check}
                      disabled={review.isPending}
                      onPress={() =>
                        Alert.alert("Duyệt kế hoạch?", `“${l.title}” sẽ hiển thị công khai trên chợ.`, [
                          { text: "Không", style: "cancel" },
                          { text: "Duyệt", onPress: () => review.mutate({ id: l.id, action: "APPROVE" }) },
                        ])
                      }
                    >
                      Duyệt
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      icon={X}
                      onPress={() => {
                        setNote("");
                        setRejecting(l);
                      }}
                    >
                      Từ chối
                    </Button>
                  </View>
                ) : null}
              </Card>
            );
          })
        )}
      </ScrollView>

      <BottomSheet open={!!rejecting} onClose={() => setRejecting(null)} title="Từ chối kế hoạch">
        {rejecting ? (
          <View className="gap-3 pb-2">
            <Text className="font-body text-xs leading-5 text-muted-foreground">Người đăng đọc được lý do này.</Text>
            <Input
              label="Lý do"
              value={note}
              onChangeText={setNote}
              multiline
              numberOfLines={3}
              placeholder="VD: Lịch tập 7/7 ngày không có ngày nghỉ"
              placeholderTextColor={inputPlaceholderColor}
            />
            <Button
              variant="destructive"
              disabled={!!listingRejectError(note) || review.isPending}
              onPress={() => review.mutate({ id: rejecting.id, action: "REJECT", note: note.trim() })}
            >
              {review.isPending ? "Đang gửi…" : "Xác nhận từ chối"}
            </Button>
          </View>
        ) : null}
      </BottomSheet>
    </View>
  );
}
