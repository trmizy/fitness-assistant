import { useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardCheck } from "lucide-react-native";

import { Badge, Button, Card, EmptyState, Input, ScreenHeader, useToast } from "../../src/components/ui";
import { useApp } from "../../src/context/AppContext";
import { useWorkspaceAccent } from "../../src/theme/workspace";
import { planReviewApi } from "../../src/features/planReview/planReviewApi";
import {
  NOTE_MAX,
  STATUS_META,
  canSendNegativeDecision,
  planReviewErrorMessage,
  ptCanDecide,
  snapshotDays,
  snapshotTitle,
  type PlanReviewItem,
} from "../../src/features/planReview/planReview";

const when = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
};

/**
 * PT inbox for plans a CLIENT submitted ("Duyệt kế hoạch"), one screen: the queue, and the selected plan's detail + decision bar below.
 * Authorization is entirely server-side (the list only holds clients with an ACTIVE contract; every action re-checks it, so an ended
 * contract answers 403 and the item disappears on refetch). A decision is bound to the exact revision + content hash on screen: if the
 * client changed the plan meanwhile the server answers 409 and nothing is decided. Query keys carry the user id (account-switch safe).
 */
export default function PtPlanReviewsScreen() {
  const insets = useSafeAreaInsets();
  const accent = useWorkspaceAccent();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { user } = useApp();
  const uid = user?.id ?? "guest";

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const inbox = useQuery({ queryKey: ["plan-reviews", uid, "inbox"], queryFn: () => planReviewApi.inbox(), retry: false });
  const items = inbox.data ?? [];
  const selectedSummary: PlanReviewItem | null = items.find((r) => r.id === selectedId) ?? items[0] ?? null;
  const detail = useQuery({
    queryKey: ["plan-reviews", uid, "detail", selectedSummary?.id],
    queryFn: () => planReviewApi.get(selectedSummary!.id),
    enabled: !!selectedSummary,
    retry: false,
  });
  const item = detail.data;

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["plan-reviews", uid] });
  const onError = (e: unknown) => {
    toast.show(planReviewErrorMessage(e), "danger");
    void refresh();
  };

  const start = useMutation({ mutationFn: (id: string) => planReviewApi.start(id), onSuccess: () => void refresh(), onError });
  const decide = useMutation({
    mutationFn: (decision: "APPROVE" | "REQUEST_CHANGES" | "REJECT") =>
      planReviewApi.decide(item!.id, {
        decision,
        note: note.trim() || undefined,
        expectedRevision: item!.revision,
        expectedContentHash: item!.contentHash,
      }),
    onSuccess: () => {
      toast.show("Đã ghi nhận quyết định.", "success");
      setNote("");
      setSelectedId(null);
      void refresh();
    },
    onError,
  });

  const back = () => (router.canGoBack() ? router.back() : router.replace("/pt/dashboard"));
  const canDecide = !!item && ptCanDecide(item);
  const negativeOk = canSendNegativeDecision(note);
  const days = snapshotDays(item?.snapshot);

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title="Duyệt kế hoạch" onBack={back} />
      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 32, gap: 16 }}
        refreshControl={
          <RefreshControl refreshing={inbox.isRefetching} onRefresh={() => void refresh()} tintColor={accent.primary} colors={[accent.primary]} />
        }
      >
        {inbox.isLoading ? (
          <ActivityIndicator className="mt-10" color={accent.primary} />
        ) : inbox.isError ? (
          <Text className="font-body text-sm text-destructive">{planReviewErrorMessage(inbox.error)} Kéo xuống để thử lại.</Text>
        ) : items.length === 0 ? (
          <EmptyState icon={ClipboardCheck} title="Chưa có kế hoạch nào chờ duyệt" description="Kế hoạch học viên gửi cho bạn sẽ xuất hiện ở đây." />
        ) : (
          <>
            <Card className="overflow-hidden">
              {items.map((r, i) => (
                <Card
                  key={r.id}
                  className={`flex-row items-center justify-between rounded-none border-0 p-4 ${i > 0 ? "border-t border-border" : ""} ${selectedSummary?.id === r.id ? "bg-primary/10" : ""}`}
                  onPress={() => {
                    setSelectedId(r.id);
                    setNote("");
                  }}
                >
                  <View className="min-w-0 flex-1">
                    <Text className="font-body-semibold text-sm text-foreground">Học viên · {when(r.submittedAt)}</Text>
                  </View>
                  <Badge tone={STATUS_META[r.status].tone}>{r.status === "IN_REVIEW" ? "Đang xem xét" : "Mới gửi"}</Badge>
                </Card>
              ))}
            </Card>

            {detail.isLoading ? <ActivityIndicator color={accent.primary} /> : null}
            {detail.isError ? <Text className="font-body text-sm text-destructive">{planReviewErrorMessage(detail.error)}</Text> : null}

            {item ? (
              <View className="gap-3">
                {item.isOutdated && canDecide ? (
                  <Card className="border-warning/30 bg-warning/10 p-3">
                    <Text className="font-body text-xs leading-5 text-warning">
                      Học viên đã chỉnh sửa kế hoạch sau khi gửi. Quyết định sẽ bị từ chối nếu kế hoạch đã đổi — hãy kéo xuống để tải bản mới.
                    </Text>
                  </Card>
                ) : null}
                {item.clientNote ? (
                  <Card className="p-3">
                    <Text className="mb-1 font-body-semibold text-xs text-muted-foreground">Lời nhắn của học viên</Text>
                    <Text className="font-body text-sm leading-5 text-foreground">{item.clientNote}</Text>
                  </Card>
                ) : null}
                <Text className="font-display text-lg text-foreground">{snapshotTitle(item.snapshot)}</Text>
                {days.map((d) => (
                  <Card key={d.dayNumber} className="gap-1 p-3">
                    <Text className="font-body-semibold text-sm text-foreground">
                      Buổi {d.dayNumber} · {d.title}
                    </Text>
                    {d.exercises.map((ex, idx) => (
                      <Text key={idx} className="font-body text-xs text-muted-foreground">
                        {ex.name} — {ex.detail}
                      </Text>
                    ))}
                  </Card>
                ))}

                {canDecide ? (
                  <View className="gap-3">
                    <Input
                      value={note}
                      onChangeText={setNote}
                      maxLength={NOTE_MAX}
                      multiline
                      numberOfLines={3}
                      placeholder="Nhận xét (bắt buộc khi yêu cầu chỉnh sửa hoặc từ chối)"
                    />
                    {item.status === "PENDING_REVIEW" ? (
                      <Button variant="secondary" size="sm" disabled={start.isPending} onPress={() => start.mutate(item.id)}>
                        Bắt đầu xem xét
                      </Button>
                    ) : null}
                    <Button disabled={decide.isPending} onPress={() => decide.mutate("APPROVE")}>
                      Duyệt
                    </Button>
                    <Button variant="secondary" disabled={decide.isPending || !negativeOk} onPress={() => decide.mutate("REQUEST_CHANGES")}>
                      Yêu cầu chỉnh sửa
                    </Button>
                    <Button variant="destructive" disabled={decide.isPending || !negativeOk} onPress={() => decide.mutate("REJECT")}>
                      Từ chối
                    </Button>
                  </View>
                ) : (
                  <Text className="font-body text-xs text-muted-foreground">Yêu cầu này đã được xử lý.</Text>
                )}
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
    </View>
  );
}
