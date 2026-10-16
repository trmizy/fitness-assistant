import { useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Brain, Check, ChevronRight, MessageSquare, Sparkles, X } from "lucide-react-native";

import {
  Avatar,
  Badge,
  BottomSheet,
  Button,
  Card,
  EmptyState,
  Input,
  ScreenHeader,
  Stagger,
  StaggerItem,
  useToast,
} from "../../src/components/ui";
import { ptPlanReviewService } from "../../src/services/api";
import { useApp } from "../../src/context/AppContext";
import { useWorkspaceAccent } from "../../src/theme/workspace";
import { designTokens } from "../../src/theme/colors";
import { shortDate } from "../../src/features/wallet/wallet";
import {
  PT_NOTE_MAX,
  type PendingPlan,
  pendingPlans,
  planMeta,
  planSchedule,
  planTitle,
} from "../../src/features/pt/pt";

/**
 * PT-12 — "Duyệt giáo án". Visual: the design's PTPlanReview (the AI notice card, day cards, a
 * pinned action bar). Behaviour: web's PlanReviewPage — `GET /plans/pt/pending-review` and the one
 * write, `POST /plans/:id/pt-review` with APPROVE or REJECT plus an optional note.
 *
 * Web puts a plan list beside the plan on a two-column desktop layout. On a phone that becomes one
 * screen: the queue, and the selected plan's schedule underneath it, with the two decisions pinned
 * to the bottom so they are reachable however long the schedule runs.
 *
 * The schedule is AI-generated JSON, so it is flattened by `planSchedule` rather than read field by
 * field here — a plan missing a day name or a set count still renders.
 */
export default function PtPlanReviewScreen() {
  const insets = useSafeAreaInsets();
  const accent = useWorkspaceAccent();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { user } = useApp();
  const uid = user?.id ?? "guest";

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [noteFor, setNoteFor] = useState<"APPROVE" | "REJECT" | null>(null);
  const [note, setNote] = useState("");

  const query = useQuery({ queryKey: ["pt-pending-plans", uid], queryFn: () => ptPlanReviewService.getPendingReviews() });
  const plans = pendingPlans(query.data);
  // Derived, not an effect: the first plan is the default until the trainer picks another, and a
  // plan that leaves the queue after a decision falls back to the new first one on its own.
  const selected: PendingPlan | null = plans.find((p) => p.id === selectedId) ?? plans[0] ?? null;
  const days = planSchedule(selected);

  const review = useMutation({
    mutationFn: (action: "APPROVE" | "REJECT") =>
      ptPlanReviewService.submitReview(selected!.id, { action, note: note.trim() || undefined }),
    onSuccess: (_d, action) => {
      toast.show(action === "APPROVE" ? "Đã duyệt giáo án" : "Đã gửi góp ý — AI sẽ soạn lại", "success");
      setNoteFor(null);
      setNote("");
      setSelectedId(null);
      void queryClient.invalidateQueries({ queryKey: ["pt-pending-plans", uid] });
    },
    onError: (e: any) =>
      toast.show(e?.response?.data?.error?.message || e?.response?.data?.error || "Không gửi được quyết định", "danger"),
  });

  const back = () => (router.canGoBack() ? router.back() : router.replace("/pt/dashboard"));

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title="Duyệt giáo án" onBack={back} />
      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + (selected ? 108 : 32) }}
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
          <ActivityIndicator className="mt-10" color={accent.primary} />
        ) : query.isError ? (
          <Text className="font-body text-sm text-destructive">Không tải được giáo án chờ duyệt. Kéo xuống để thử lại.</Text>
        ) : plans.length === 0 ? (
          <EmptyState
            icon={Brain}
            title="Không có giáo án nào chờ duyệt"
            description="Giáo án AI soạn cho học viên của bạn sẽ xuất hiện ở đây."
          />
        ) : (
          <Stagger className="gap-4">
            <StaggerItem>
              <Card className="flex-row items-start gap-3 border-primary/30 bg-primary/5 p-4">
                <Sparkles size={18} color={accent.primary} />
                <Text className="flex-1 font-body text-sm leading-5 text-muted-foreground">
                  Giáo án do AI soạn. Bạn duyệt để học viên bắt đầu tập, hoặc gửi góp ý để AI soạn lại.
                </Text>
              </Card>
            </StaggerItem>

            {plans.length > 1 ? (
              <StaggerItem>
                <Text className="mb-2 px-1 font-body text-xs uppercase tracking-wider text-muted-foreground">
                  Chờ duyệt · {plans.length}
                </Text>
                <Card className="overflow-hidden">
                  {plans.map((p, i) => {
                    const active = selected?.id === p.id;
                    return (
                      <Card
                        key={p.id}
                        className={`flex-row items-center gap-3 rounded-none border-0 p-4 ${i > 0 ? "border-t border-border" : ""} ${active ? "bg-primary/10" : ""}`}
                        onPress={() => setSelectedId(p.id)}
                      >
                        <Avatar name={p.clientName || "Học viên"} size={36} />
                        <View className="min-w-0 flex-1">
                          <Text className="font-body-semibold text-sm text-foreground" numberOfLines={1}>
                            {p.clientName || "Học viên"}
                          </Text>
                          <Text className="font-body text-xs text-muted-foreground" numberOfLines={1}>
                            {planTitle(p)}
                          </Text>
                        </View>
                        {active ? (
                          <Badge tone="info">Đang xem</Badge>
                        ) : (
                          <ChevronRight size={16} color={designTokens.mutedForeground} />
                        )}
                      </Card>
                    );
                  })}
                </Card>
              </StaggerItem>
            ) : null}

            {selected ? (
              <>
                <StaggerItem>
                  <Card className="overflow-hidden p-5">
                    <View className="absolute -right-8 -top-10 h-32 w-32 rounded-full bg-primary/10" />
                    <Badge tone="warning">Chờ bạn duyệt</Badge>
                    <Text className="mt-2 font-display text-xl text-foreground">{planTitle(selected)}</Text>
                    <Text className="font-body text-sm text-muted-foreground">
                      Giáo án của {selected.clientName || "học viên"}
                      {planMeta(selected) ? ` · ${planMeta(selected)}` : ""}
                    </Text>
                    {selected.createdAt ? (
                      <Text className="mt-1 font-body text-xs text-muted-foreground">
                        AI soạn ngày {shortDate(selected.createdAt)}
                      </Text>
                    ) : null}
                  </Card>
                </StaggerItem>

                {days.length === 0 ? (
                  <StaggerItem>
                    <Card className="p-4">
                      <Text className="font-body text-sm text-muted-foreground">
                        Giáo án này không kèm lịch tập chi tiết.
                      </Text>
                    </Card>
                  </StaggerItem>
                ) : (
                  days.map((d, i) => (
                    <StaggerItem key={`${d.day}-${i}`}>
                      <Card className="gap-1 p-4">
                        <Text className="font-body-semibold text-sm text-foreground">{d.day}</Text>
                        {d.goal ? <Text className="font-body text-xs text-primary">{d.goal}</Text> : null}
                        {d.exercises.length === 0 ? (
                          <Text className="font-body text-xs text-muted-foreground">Ngày nghỉ</Text>
                        ) : (
                          d.exercises.map((ex, j) => (
                            <Text key={j} className="font-body text-xs text-muted-foreground">
                              {ex}
                            </Text>
                          ))
                        )}
                      </Card>
                    </StaggerItem>
                  ))
                )}
              </>
            ) : null}
          </Stagger>
        )}
      </ScrollView>

      {selected ? (
        <View
          className="absolute inset-x-0 bottom-0 flex-row gap-3 border-t border-border bg-background px-5 pt-3"
          style={{ paddingBottom: insets.bottom + 12 }}
        >
          <Button
            variant="secondary"
            icon={MessageSquare}
            className="flex-1"
            disabled={review.isPending}
            onPress={() => {
              setNote("");
              setNoteFor("REJECT");
            }}
          >
            Góp ý
          </Button>
          <Button
            icon={Check}
            className="flex-1"
            disabled={review.isPending}
            onPress={() => {
              setNote("");
              setNoteFor("APPROVE");
            }}
          >
            Duyệt
          </Button>
        </View>
      ) : null}

      <BottomSheet
        open={!!noteFor}
        onClose={() => setNoteFor(null)}
        title={noteFor === "APPROVE" ? "Duyệt giáo án" : "Gửi góp ý"}
      >
        <View className="gap-3 pb-2">
          <Text className="font-body text-sm text-muted-foreground">
            {noteFor === "APPROVE"
              ? "Học viên sẽ bắt đầu tập theo giáo án này. Bạn có thể kèm một lời nhắn."
              : "Giáo án sẽ không được áp dụng. Hãy nói rõ cần sửa gì để AI soạn lại sát hơn."}
          </Text>
          <Input
            label={`Ghi chú cho học viên (tuỳ chọn, tối đa ${PT_NOTE_MAX} ký tự)`}
            value={note}
            onChangeText={(t) => setNote(t.slice(0, PT_NOTE_MAX))}
            placeholder={noteFor === "APPROVE" ? "Giáo án ổn, em bám sát nhé…" : "Giảm khối lượng ngày chân, thêm bài kéo…"}
            multiline
          />
          {note.length > PT_NOTE_MAX - 100 ? (
            <Text className="font-body text-xs text-warning">
              {note.length}/{PT_NOTE_MAX} ký tự
            </Text>
          ) : null}
          <Button
            full
            icon={noteFor === "APPROVE" ? Check : X}
            disabled={review.isPending}
            onPress={() => review.mutate(noteFor!)}
          >
            {review.isPending ? "Đang gửi…" : noteFor === "APPROVE" ? "Duyệt giáo án" : "Gửi góp ý"}
          </Button>
        </View>
      </BottomSheet>
    </View>
  );
}
