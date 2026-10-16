import { useMemo, useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  Brain,
  ChevronRight,
  CircleAlert,
  Dumbbell,
  Loader,
  RotateCcw,
  Salad,
  Sparkles,
  Wand2,
} from "lucide-react-native";

import { Badge, BottomSheet, Button, Card, EmptyState, Stagger, StaggerItem, Tappable, useToast } from "../../components/ui";
import { planService, workoutService, type WorkoutPlanRecord } from "../../services/api";
import { useWorkspaceAccent } from "../../theme/workspace";
import { chartSeries, designTokens } from "../../theme/colors";
import { useApp } from "../../context/AppContext";
import {
  apiErrorMessage,
  chooseLatestPlan,
  dayExerciseSummary,
  filterPlans,
  friendlyPlanFailReason,
  initialFilter,
  isPending,
  LLM_NOT_READY_MESSAGE,
  localizeDayGoal,
  planCounts,
  retryPayload,
  sortPlans,
  statusLabel,
  statusTone,
  toExerciseList,
  toPlanContent,
  toWeeklySchedule,
  type PlanFilter,
} from "./aiPlans";
import { NutritionAiPlans } from "./NutritionAiPlansPanel";

const KINDS = [
  { value: "workout", label: "Tập luyện", icon: Dumbbell },
  { value: "nutrition", label: "Dinh dưỡng", icon: Salad },
] as const;

export function planQueryKey(userId?: string | null) {
  return ["ai-plans", "current", userId ?? "guest"] as const;
}

export function formatPlanDate(value?: string): string {
  if (!value) return "--";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "--" : d.toLocaleDateString("vi-VN");
}

/**
 * CL-18, "Kế hoạch AI" half — the design's active-plan card + day cards + Điều chỉnh / Lưu trữ /
 * "Tạo giáo án AI mới", with web's plan list (filters Đang xử lý / Hoàn thành / Thất bại / Tất cả,
 * retry, hide) under it so nothing the web offers is lost.
 *
 * Web tracks running jobs in a persisted store (`pendingAiTasks`); here the plan RECORD is the
 * source of truth instead — its status mirrors the job — and the list simply re-polls while any
 * plan is QUEUED/PROCESSING, so a job started from the wizard keeps updating even after leaving it.
 */
export function AiPlansTab() {
  const accent = useWorkspaceAccent();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { user } = useApp();
  const [kind, setKind] = useState<"workout" | "nutrition">("workout");
  const [filter, setFilter] = useState<PlanFilter | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<WorkoutPlanRecord | null>(null);
  const key = planQueryKey(user?.id);

  const plansQuery = useQuery({
    queryKey: key,
    queryFn: () => planService.getCurrentPlans(),
    enabled: Boolean(user?.id),
    refetchInterval: (query) =>
      (query.state.data as WorkoutPlanRecord[] | undefined)?.some((p) => isPending(p.status)) ? 4000 : false,
  });
  const healthQuery = useQuery({
    queryKey: ["ai-plans", "llm-health"],
    queryFn: () => planService.getLlmHealth(),
    retry: false,
    refetchInterval: 15000,
  });
  // "Đang áp dụng" means the plan is the one actually running in the workout log.
  const programQuery = useQuery({
    queryKey: ["current-workout-program"],
    queryFn: () => workoutService.getCurrentProgram(),
  });

  const sorted = useMemo(() => sortPlans(plansQuery.data), [plansQuery.data]);
  const counts = planCounts(sorted);
  const activeFilter = filter ?? initialFilter(sorted);
  const visible = filterPlans(sorted, activeFilter);
  const featured = useMemo(() => chooseLatestPlan(filterPlans(sorted, "completed")), [sorted]);
  const featuredDays = toWeeklySchedule(toPlanContent(featured?.plan)?.weeklySchedule) ?? [];
  const appliedPlanId = (programQuery.data as any)?.sourcePlanId ?? null;
  const llmDown = Boolean(healthQuery.data && !healthQuery.data.llmAvailable);

  const archiveMutation = useMutation({
    mutationFn: (id: string) => planService.archivePlan(id),
    onSuccess: async () => {
      setArchiveTarget(null);
      toast.show("Đã ẩn kế hoạch khỏi danh sách", "success");
      await queryClient.invalidateQueries({ queryKey: key });
    },
    onError: (e) => toast.show(apiErrorMessage(e, "Không thể ẩn kế hoạch"), "danger"),
  });

  const retryMutation = useMutation({
    mutationFn: (plan: WorkoutPlanRecord) => planService.generateWorkoutPlan(retryPayload(plan)),
    onSuccess: async () => {
      setFilter("active");
      toast.show("Đã gửi yêu cầu tạo lại kế hoạch", "success");
      await queryClient.invalidateQueries({ queryKey: key });
    },
    onError: (e) => toast.show(apiErrorMessage(e, "Không thể tạo lại kế hoạch"), "danger"),
  });

  const retry = async (plan: WorkoutPlanRecord) => {
    if (!plan.goal || !plan.duration || !plan.daysPerWeek) {
      toast.show("Kế hoạch thiếu dữ liệu để tạo lại", "danger");
      return;
    }
    const health = await healthQuery.refetch();
    if (health.isError || !health.data?.llmAvailable) {
      toast.show(LLM_NOT_READY_MESSAGE, "danger");
      return;
    }
    retryMutation.mutate(plan);
  };

  const askArchive = (plan: WorkoutPlanRecord) => {
    if (plan.status === "PROCESSING") {
      toast.show("Không thể ẩn kế hoạch đang xử lý", "danger");
      return;
    }
    setArchiveTarget(plan);
  };

  return (
    <>
      <View className="flex-row gap-2 px-5 pt-3">
        {KINDS.map((k) => {
          const on = kind === k.value;
          const Icon = k.icon;
          return (
            <Tappable
              key={k.value}
              onPress={() => setKind(k.value)}
              className={`flex-row items-center gap-1.5 rounded-full border px-3.5 py-1.5 ${on ? "border-primary bg-primary/15" : "border-border bg-panel"}`}
            >
              <Icon size={14} color={on ? accent.primary : "#8b9299"} />
              <Text className={`font-body-semibold text-xs ${on ? "text-primary" : "text-muted-foreground"}`}>{k.label}</Text>
            </Tappable>
          );
        })}
      </View>

      {kind === "nutrition" ? (
        <NutritionAiPlans />
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 20, paddingBottom: 48 }}
          refreshControl={
            <RefreshControl
              refreshing={plansQuery.isRefetching}
              onRefresh={() => void plansQuery.refetch()}
              tintColor={accent.primary}
              colors={[accent.primary]}
            />
          }
        >
          {llmDown ? (
            <Card className="mb-4 flex-row items-start gap-3 border-warning/40 bg-warning/5 p-4">
              <CircleAlert size={18} color={designTokens.warning} />
              <Text className="flex-1 font-body text-sm text-foreground">{LLM_NOT_READY_MESSAGE}</Text>
            </Card>
          ) : null}

          {plansQuery.isLoading ? (
            <View className="items-center py-16">
              <ActivityIndicator color={accent.primary} />
            </View>
          ) : plansQuery.isError ? (
            <EmptyState
              icon={CircleAlert}
              title="Không tải được danh sách kế hoạch"
              description={apiErrorMessage(plansQuery.error, "Kiểm tra kết nối rồi thử lại.")}
              actionLabel="Thử lại"
              onAction={() => void plansQuery.refetch()}
            />
          ) : (
            <Stagger className="gap-4">
              {counts.active > 0 ? (
                <Card className="flex-row items-center gap-3 border-chart-3/40 bg-chart-3/5 p-4">
                  <Loader size={18} color={chartSeries[2]} />
                  <View className="flex-1">
                    <Text className="font-body-semibold text-sm text-foreground">
                      Đang tạo {counts.active} kế hoạch AI…
                    </Text>
                    <Text className="font-body text-xs text-muted-foreground">
                      Bạn có thể rời màn này — danh sách tự cập nhật khi AI soạn xong.
                    </Text>
                  </View>
                </Card>
              ) : null}

              {featured ? (
                <StaggerItem>
                  <Card className="overflow-hidden p-5" onPress={() => router.push(`/client/plans/ai/${featured.id}`)}>
                    <View className="absolute -right-6 -top-8 h-32 w-32 rounded-full bg-primary/10" />
                    {appliedPlanId === featured.id ? (
                      <Badge tone="success">Đang áp dụng</Badge>
                    ) : (
                      <Badge tone="info">Mới nhất</Badge>
                    )}
                    <Text className="mt-2 font-display text-xl text-foreground">{featured.name || "Kế hoạch AI"}</Text>
                    <Text className="font-body text-sm text-muted-foreground">
                      {`Mục tiêu ${featured.goal ?? "--"} · ${featured.duration ?? "--"} tuần · ${featured.daysPerWeek ?? "--"} buổi/tuần`}
                    </Text>
                  </Card>
                </StaggerItem>
              ) : sorted.length === 0 ? (
                <EmptyState
                  icon={Brain}
                  title="Chưa có kế hoạch AI nào"
                  description="Trả lời vài câu hỏi, AI soạn giáo án theo mục tiêu và thiết bị của bạn."
                />
              ) : null}

              {featuredDays.map((day, i) => (
                <StaggerItem key={`${day.day ?? i}`} index={i + 1}>
                  <Card className="flex-row items-center gap-3 p-4" onPress={() => router.push(`/client/plans/ai/${featured!.id}`)}>
                    <View className="h-11 w-11 items-center justify-center rounded-xl bg-panel">
                      <Text className="font-display text-sm text-primary">{typeof day.day === "number" ? String(day.day) : String(i + 1)}</Text>
                    </View>
                    <View className="flex-1">
                      <Text className="font-body-semibold text-sm text-foreground" numberOfLines={1}>
                        {localizeDayGoal(day.goal || day.focus, i)}
                      </Text>
                      <Text className="font-body text-xs text-muted-foreground" numberOfLines={1}>
                        {dayExerciseSummary(day) || "Chưa có bài tập"}
                      </Text>
                    </View>
                    <Text className="font-body text-xs text-muted-foreground">
                      {`${toExerciseList(day.exercises).length} bài`}
                    </Text>
                  </Card>
                </StaggerItem>
              ))}

              <StaggerItem>
                {featured ? (
                  <View className="flex-row gap-3">
                    <View className="flex-1">
                      <Button
                        variant="secondary"
                        full
                        icon={Wand2}
                        disabled={llmDown}
                        onPress={() => router.push({ pathname: "/client/plans/wizard", params: { mode: "adjust", planId: featured.id } })}
                      >
                        Điều chỉnh
                      </Button>
                    </View>
                    <View className="flex-1">
                      <Button variant="secondary" full icon={Archive} onPress={() => askArchive(featured)}>
                        Ẩn kế hoạch
                      </Button>
                    </View>
                  </View>
                ) : null}
                <View className="mt-3">
                  <Button full size="lg" icon={Sparkles} disabled={llmDown} onPress={() => router.push("/client/plans/wizard")}>
                    Tạo giáo án AI mới
                  </Button>
                </View>
              </StaggerItem>

              {sorted.length > 0 ? (
                <StaggerItem>
                  <Text className="mb-3 mt-2 px-1 font-display text-base text-foreground">Tất cả kế hoạch</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                    {(
                      [
                        { key: "active", label: `Đang xử lý (${counts.active})` },
                        { key: "completed", label: `Hoàn thành (${counts.completed})` },
                        { key: "failed", label: `Thất bại (${counts.failed})` },
                        { key: "all", label: `Tất cả (${counts.all})` },
                      ] as const
                    ).map((f) => {
                      const on = activeFilter === f.key;
                      return (
                        <Tappable
                          key={f.key}
                          onPress={() => setFilter(f.key)}
                          className={`rounded-full border px-3.5 py-1.5 ${on ? "border-primary bg-primary/15" : "border-border bg-panel"}`}
                        >
                          <Text className={`font-body-semibold text-xs ${on ? "text-primary" : "text-muted-foreground"}`}>{f.label}</Text>
                        </Tappable>
                      );
                    })}
                  </ScrollView>
                  <View className="mt-3 gap-2.5">
                    {visible.length === 0 ? (
                      <Text className="px-1 py-4 font-body text-sm text-muted-foreground">
                        Không có kế hoạch nào trong mục này.
                      </Text>
                    ) : (
                      visible.map((plan) => (
                        <PlanRow
                          key={plan.id}
                          plan={plan}
                          applied={appliedPlanId === plan.id}
                          onRetry={() => void retry(plan)}
                          onArchive={() => askArchive(plan)}
                          retrying={retryMutation.isPending}
                          llmDown={llmDown}
                        />
                      ))
                    )}
                  </View>
                </StaggerItem>
              ) : null}
            </Stagger>
          )}
        </ScrollView>
      )}

      <BottomSheet open={Boolean(archiveTarget)} onClose={() => setArchiveTarget(null)} title="Ẩn kế hoạch?">
        <Text className="mb-4 text-center font-body text-sm text-muted-foreground">
          Kế hoạch sẽ không còn trong danh sách. Lịch tập đã lưu từ kế hoạch này không bị xoá.
        </Text>
        <Button
          variant="destructive"
          full
          size="lg"
          disabled={archiveMutation.isPending}
          onPress={() => archiveTarget && archiveMutation.mutate(archiveTarget.id)}
        >
          {archiveMutation.isPending ? "Đang ẩn…" : "Ẩn kế hoạch"}
        </Button>
        <View className="mt-1">
          <Button variant="ghost" full onPress={() => setArchiveTarget(null)}>
            Giữ lại
          </Button>
        </View>
      </BottomSheet>
    </>
  );
}

function PlanRow({
  plan,
  applied,
  onRetry,
  onArchive,
  retrying,
  llmDown,
}: {
  plan: WorkoutPlanRecord;
  applied: boolean;
  onRetry: () => void;
  onArchive: () => void;
  retrying: boolean;
  llmDown: boolean;
}) {
  return (
    <Card className="p-4" onPress={() => router.push(`/client/plans/ai/${plan.id}`)}>
      <View className="flex-row items-center gap-2">
        <Text className="flex-1 font-body-semibold text-sm text-foreground" numberOfLines={1}>
          {plan.name || "Kế hoạch AI"}
        </Text>
        {applied ? <Badge tone="success">Đang áp dụng</Badge> : <Badge tone={statusTone(plan.status)}>{statusLabel(plan.status)}</Badge>}
        <ChevronRight size={16} color="#8b9299" />
      </View>
      <Text className="mt-1 font-body text-xs text-muted-foreground" numberOfLines={1}>
        {`${plan.goal || "--"} · phiên bản ${plan.version ?? 1} · ${formatPlanDate(plan.updatedAt || plan.createdAt)}`}
      </Text>
      {plan.status === "FAILED" ? (
        <>
          <Text className="mt-2 font-body text-xs text-destructive">{friendlyPlanFailReason(plan.failReason)}</Text>
          <View className="mt-3 flex-row gap-2">
            <Button size="sm" variant="secondary" icon={RotateCcw} disabled={retrying || llmDown} onPress={onRetry}>
              Tạo lại
            </Button>
            <Button size="sm" variant="ghost" icon={Archive} onPress={onArchive}>
              Ẩn
            </Button>
          </View>
        </>
      ) : null}
    </Card>
  );
}
