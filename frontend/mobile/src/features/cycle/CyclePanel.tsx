import { useState, type ReactNode } from "react";
import { ActivityIndicator, Alert, ScrollView, Text, View } from "react-native";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import Animated, { FadeIn } from "react-native-reanimated";
import {
  AlertTriangle,
  ArrowRight,
  Ban,
  CalendarClock,
  CheckCircle2,
  Dumbbell,
  Flag,
  Info,
  MessageSquare,
  RotateCw,
  Scale,
  ShieldAlert,
  Sparkles,
  Trash2,
  TrendingDown,
  TrendingUp,
  Utensils,
} from "lucide-react-native";

import { Badge, Button, BottomSheet, Card, EmptyState, ProgressRing, Skeleton, Tappable, useToast } from "../../components/ui";
import { trainingCycleService, workoutService, type CycleAlert, type CycleAssessment, type TrainingCycle } from "../../services/api";
import { useWorkspaceAccent } from "../../theme/workspace";
import { apiErrorMessage } from "../plans/aiPlans";
import {
  ADAPTIVE_DECISION,
  CONFIDENCE_TIER_LABEL,
  FEEDBACK_FLAG,
  FEEDBACK_SENTIMENT,
  FORMULA,
  LEGACY_ANALYSIS_STUCK_MS,
  LEGACY_DECISION,
  NUTRITION_DECISION,
  REPORT_FLAG,
  TREND_LABEL,
  confidenceTier,
  cycleDecisionLabel,
  elapsedPercent,
  fieldTrendLabel,
  formatCycleDate,
  nutritionHasProposal,
  pct,
  pickRelevantCycle,
  plannedVsActualLine,
  rpeTrendLabel,
  type NutritionDecision,
} from "./cycle";

/**
 * 14B.1 (PG-A1) — "Chu kỳ" segment of the Training tab: web's `TrainingCyclePage` on a phone.
 *
 * Same blocks in the same order as web — active cycle, the legacy "start next cycle" proposal, cycle
 * progress, session-feedback summary, the adaptive assessment (training + nutrition decisions) and
 * the history with each closed cycle's report. Every decision shown here comes from fitness-service
 * (`CycleAssessment` owns adaptation decisions, `NutritionGoal` owns calories) — this screen only
 * triggers the existing evaluate / accept / reject endpoints and renders what they return.
 */
export function CyclePanel() {
  const historyQuery = useQuery({
    queryKey: ["training-cycle", "history"],
    queryFn: () => trainingCycleService.list(20),
  });
  const [reportCycleId, setReportCycleId] = useState<string | null>(null);

  const { active, recentClosed, relevantId, history } = pickRelevantCycle(historyQuery.data ?? []);

  return (
    <View className="gap-4">
      <ActiveCycleCard />

      {/* A stale proposal from an older closed cycle is never offered once a newer cycle is running. */}
      {!active && recentClosed ? <DecisionCard cycle={recentClosed} /> : null}

      {relevantId ? <ProgressSection cycleId={relevantId} /> : null}
      {relevantId ? <FeedbackSummaryCard cycleId={relevantId} /> : null}
      {relevantId ? <AssessmentCards cycleId={relevantId} /> : null}

      <View>
        <Text className="mb-2 px-1 font-display text-lg text-foreground">Lịch sử chu kỳ</Text>
        {historyQuery.isLoading ? (
          <View className="gap-2">
            {[0, 1].map((i) => (
              <Skeleton key={i} className="h-[72px] rounded-2xl" />
            ))}
          </View>
        ) : history.length > 0 ? (
          <View className="gap-2">
            {history.map((cycle) => (
              <HistoryRow key={cycle.id} cycle={cycle} onOpenReport={() => setReportCycleId(cycle.id)} />
            ))}
          </View>
        ) : (
          <EmptyState icon={CalendarClock} title="Chưa có chu kỳ nào được hoàn thành." />
        )}
      </View>

      {/* Room for the floating AI Coach button, which otherwise covers the last row's delete button. */}
      <View className="h-20" />

      <BottomSheet open={reportCycleId != null} onClose={() => setReportCycleId(null)} title="Báo cáo chu kỳ">
        {reportCycleId ? <CycleReport cycleId={reportCycleId} /> : null}
      </BottomSheet>
    </View>
  );
}

// ── shared bits ──────────────────────────────────────────────────────────────

function useInvalidateCycles() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ["training-cycle"] });
}

function confirm(title: string, message: string, confirmLabel: string, onConfirm: () => void) {
  Alert.alert(title, message, [
    { text: "Không", style: "cancel" },
    { text: confirmLabel, style: "destructive", onPress: onConfirm },
  ]);
}

function Warn({ children, tone = "warning" }: { children: ReactNode; tone?: "warning" | "danger" | "muted" }) {
  const color = tone === "danger" ? "#ef4444" : tone === "muted" ? "#8b9299" : "#f59e0b";
  const box =
    tone === "danger"
      ? "border-destructive/40 bg-destructive/10"
      : tone === "muted"
        ? "border-border bg-panel"
        : "border-warning/30 bg-warning/10";
  const Icon = tone === "danger" ? ShieldAlert : AlertTriangle;
  return (
    <View className={`flex-row items-start gap-2 rounded-xl border p-3 ${box}`}>
      <Icon size={15} color={color} style={{ marginTop: 1 }} />
      <Text className={`flex-1 font-body text-xs leading-5 ${tone === "muted" ? "text-muted-foreground" : "text-foreground"}`}>
        {children}
      </Text>
    </View>
  );
}

function SectionTitle({ icon: Icon, children, right }: { icon: typeof Flag; children: ReactNode; right?: ReactNode }) {
  const accent = useWorkspaceAccent();
  return (
    <View className="flex-row items-center justify-between gap-2">
      <View className="flex-1 flex-row items-center gap-2">
        <Icon size={16} color={accent.primary} />
        <Text className="flex-1 font-body-semibold text-sm text-foreground">{children}</Text>
      </View>
      {right}
    </View>
  );
}

/** Every number on this screen is a computed score, not a measurement — its formula is one tap away. */
function StatTile({ label, value, sub, formula }: { label: string; value: string; sub?: string; formula: string }) {
  return (
    <Tappable
      className="w-[48.5%] rounded-xl border border-border bg-panel p-3"
      onPress={() => Alert.alert(`Cách tính — ${label}`, formula)}
      accessibilityLabel={`${label}: ${value}. Bấm để xem cách tính`}
    >
      <View className="flex-row items-center gap-1">
        <Text className="font-body text-xs text-muted-foreground" numberOfLines={1}>
          {label}
        </Text>
        <Info size={12} color="#8b9299" />
      </View>
      <Text className="mt-1 font-display text-lg text-foreground">{value}</Text>
      {sub ? <Text className="mt-0.5 font-body text-[11px] text-muted-foreground">{sub}</Text> : null}
    </Tappable>
  );
}

function TrendBadge({ trend }: { trend: string | null | undefined }) {
  const cfg = trend ? TREND_LABEL[trend] : undefined;
  return cfg ? <Badge tone={cfg.tone}>{cfg.label}</Badge> : null;
}

function Loading() {
  return <Skeleton className="h-28 rounded-2xl" />;
}

// ── active cycle ─────────────────────────────────────────────────────────────

function ActiveCycleCard() {
  const accent = useWorkspaceAccent();
  const toast = useToast();
  const invalidate = useInvalidateCycles();
  // Read the clock once per mount: elapsed % is day-grained.
  const [now] = useState(() => Date.now());

  const activeQuery = useQuery({
    queryKey: ["training-cycle", "active"],
    queryFn: trainingCycleService.getActive,
    // No active cycle answers 404 — a normal state, not an outage.
    retry: false,
  });

  const onDone = (message: string) => {
    toast.show(message, "success");
    invalidate();
  };
  const onFail = (fallback: string) => (e: unknown) => toast.show(apiErrorMessage(e, fallback), "danger");

  const start = useMutation({
    mutationFn: () => trainingCycleService.start(),
    onSuccess: () => onDone("Đã bắt đầu chu kỳ tập luyện mới"),
    onError: onFail("Không thể bắt đầu chu kỳ mới"),
  });
  // Closing runs the Decision Engine + AI explanation synchronously — the result exists when this resolves.
  const complete = useMutation({
    mutationFn: (id: string) => trainingCycleService.complete(id),
    onSuccess: () => onDone("Đã đóng chu kỳ và có kết quả đánh giá"),
    onError: onFail("Không thể đóng chu kỳ"),
  });
  // Cancelling is not completing: never evaluated, never calls the AI.
  const cancel = useMutation({
    mutationFn: (id: string) => trainingCycleService.cancel(id),
    onSuccess: () => onDone("Đã huỷ chu kỳ tập luyện"),
    onError: onFail("Không thể huỷ chu kỳ"),
  });
  const remove = useMutation({
    mutationFn: (id: string) => trainingCycleService.remove(id),
    onSuccess: () => onDone("Đã xoá chu kỳ tập luyện"),
    onError: onFail("Không thể xoá chu kỳ"),
  });

  if (activeQuery.isLoading) return <Skeleton className="h-48 rounded-2xl" />;

  if (!activeQuery.data?.cycle) {
    return (
      <Card className="items-center gap-3 p-5">
        <CalendarClock size={22} color={accent.primary} />
        <Text className="text-center font-body text-sm text-muted-foreground">
          Bạn chưa có chu kỳ tập luyện nào đang diễn ra.
        </Text>
        <Button className="self-center" disabled={start.isPending} onPress={() => start.mutate()}>
          {start.isPending ? "Đang bắt đầu..." : "Bắt đầu chu kỳ mới"}
        </Button>
      </Card>
    );
  }

  const { cycle, summary } = activeQuery.data;
  const elapsed = elapsedPercent(cycle, now);
  const busy = complete.isPending || cancel.isPending || remove.isPending;

  return (
    <Card className="gap-4 p-5">
      <View className="flex-row items-center gap-4">
        <View className="flex-1">
          <Badge tone="success">{`Đang diễn ra (${elapsed}%)`}</Badge>
          <Text className="mt-2 font-display text-xl text-foreground">Chu kỳ #{cycle.cycleIndex}</Text>
          <Text className="mt-0.5 font-body text-sm text-muted-foreground">
            {formatCycleDate(cycle.startDate)} – {formatCycleDate(cycle.endDate)}
          </Text>
        </View>
        <ProgressRing progress={elapsed / 100} size={68} stroke={7} color={accent.chart3}>
          <Text className="font-display text-base text-foreground">{elapsed}%</Text>
        </ProgressRing>
      </View>

      <View>
        <View className="mb-1.5 flex-row items-center justify-between">
          <Text className="font-body text-xs text-muted-foreground">Tuân thủ lịch tập</Text>
          <Text className="font-body-semibold text-xs text-foreground">
            {summary.adherence.total > 0
              ? `${summary.adherence.completed}/${summary.adherence.total} buổi (${summary.adherence.percent}%)`
              : "Chưa có buổi nào được lên lịch"}
          </Text>
        </View>
        <View className="h-2 w-full overflow-hidden rounded-full bg-panel">
          <View className="h-full rounded-full bg-primary" style={{ width: `${summary.adherence.percent ?? 0}%` }} />
        </View>
      </View>

      {summary.volumeChangePct != null ? (
        <Text className="font-body text-xs text-muted-foreground">
          Volume tập luyện: {summary.volumeChangePct > 0 ? "+" : ""}
          {summary.volumeChangePct}% so với tuần đầu
        </Text>
      ) : null}
      {summary.newPRs.length > 0 ? (
        <Text className="font-body text-xs text-primary">🏆 PR mới: {summary.newPRs.join(", ")}</Text>
      ) : null}
      {summary.alerts.map((a: CycleAlert) => (
        <Warn key={a.code}>{a.message}</Warn>
      ))}
      {summary.adherence.total === 0 ? (
        <Text className="font-body text-[11px] leading-4 text-warning">
          Chưa có buổi tập nào được lên lịch — kết thúc chu kỳ ngay bây giờ sẽ không tạo ra đánh giá tiến triển đáng tin
          cậy (đánh dấu “Chưa đủ dữ liệu”).
        </Text>
      ) : null}

      <View className="flex-row gap-2">
        <Button variant="secondary" className="flex-1" disabled={busy} onPress={() => complete.mutate(cycle.id)}>
          {complete.isPending ? "Đang đóng chu kỳ..." : "Kết thúc chu kỳ"}
        </Button>
        <IconAction
          icon={Ban}
          label="Huỷ chu kỳ mà không đánh giá"
          pending={cancel.isPending}
          disabled={busy}
          onPress={() =>
            confirm(
              "Huỷ chu kỳ?",
              "Huỷ chu kỳ tập luyện này? Sẽ KHÔNG có đánh giá tiến triển nào được thực hiện — dùng khi bạn muốn bỏ chu kỳ này hẳn, không phải để xem kết quả.",
              "Huỷ chu kỳ",
              () => cancel.mutate(cycle.id),
            )
          }
        />
        <IconAction
          icon={Trash2}
          label="Xoá chu kỳ"
          pending={remove.isPending}
          disabled={busy}
          onPress={() =>
            confirm(
              "Xoá chu kỳ?",
              "Xoá chu kỳ tập luyện này? Bạn có thể bắt đầu một chu kỳ mới sau khi xoá.",
              "Xoá",
              () => remove.mutate(cycle.id),
            )
          }
        />
      </View>
      {complete.isPending ? (
        <Text className="font-body text-[11px] text-muted-foreground">
          Đang chạy đánh giá cuối chu kỳ — có thể mất đến 1–2 phút.
        </Text>
      ) : null}
    </Card>
  );
}

function IconAction({
  icon: Icon,
  label,
  pending,
  disabled,
  onPress,
}: {
  icon: typeof Ban;
  label: string;
  pending: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Tappable
      className={`h-12 w-12 items-center justify-center rounded-xl border border-border bg-panel ${disabled ? "opacity-40" : ""}`}
      disabled={disabled}
      onPress={onPress}
      accessibilityLabel={label}
    >
      {pending ? <ActivityIndicator size="small" color="#8b9299" /> : <Icon size={18} color="#8b9299" />}
    </Tappable>
  );
}

// ── legacy proposal for the most recent closed cycle ─────────────────────────

function DecisionCard({ cycle }: { cycle: TrainingCycle }) {
  const toast = useToast();
  const invalidate = useInvalidateCycles();
  const [now] = useState(() => Date.now());

  // Poll while the old fire-and-forget analysis is still running (COMPLETED, not yet ANALYZED).
  const cycleQuery = useQuery({
    queryKey: ["training-cycle", "detail", cycle.id],
    queryFn: () => trainingCycleService.get(cycle.id),
    initialData: cycle,
    refetchInterval: (query) => (query.state.data?.status === "COMPLETED" ? 4000 : false),
  });
  // Same key as AssessmentCards — a real assessment supersedes this card entirely.
  const latestQuery = useQuery({
    queryKey: ["training-cycle", "assessment", "latest", cycle.id],
    queryFn: () => trainingCycleService.getLatestAssessment(cycle.id),
    retry: false,
  });

  // Record the approval on the analysed cycle before opening the next one (KEEP/ADJUST only —
  // the current plan genuinely carries forward).
  const startNext = useMutation({
    mutationFn: async (planId: string | null) => {
      if (planId) await trainingCycleService.approve(cycle.id, planId);
      return trainingCycleService.start(planId ? { planId } : undefined);
    },
    onSuccess: () => {
      toast.show("Đã mở chu kỳ tiếp theo", "success");
      invalidate();
    },
    onError: (e) => toast.show(apiErrorMessage(e, "Không thể mở chu kỳ mới"), "danger"),
  });

  const current = cycleQuery.data ?? cycle;

  if (current.status === "COMPLETED") {
    if (latestQuery.data) return null;
    const stuck = now - new Date(current.updatedAt).getTime() > LEGACY_ANALYSIS_STUCK_MS;
    return (
      <Card className="flex-row items-center gap-3 p-4">
        <ActivityIndicator color="#22c55e" />
        <View className="flex-1">
          <Text className="font-body-semibold text-sm text-foreground">AI đang phân tích chu kỳ #{current.cycleIndex}...</Text>
          <Text className="mt-0.5 font-body text-xs text-muted-foreground">
            {stuck
              ? 'Quá trình này đang lâu hơn dự kiến — bạn có thể dùng "Đánh giá chu kỳ (nâng cao)" bên dưới để nhận đề xuất ngay.'
              : "Quá trình này có thể mất khoảng 1 phút."}
          </Text>
        </View>
      </Card>
    );
  }
  if (current.status === "ANALYZED" && latestQuery.data) return null;
  if (current.status !== "ANALYZED" || !current.decision) return null;

  const decision = current.decision;
  const cfg = LEGACY_DECISION[decision];
  // PROGRESS/DELOAD/REBUILD with no assessment fetched (race/fetch failure) — defer, never crash.
  if (!cfg) return null;
  const analysis = current.aiAnalysis;
  const review = analysis?.cycleReview;
  const reasonCodes = (analysis as any)?.reasonCodes;

  return (
    <Card className="gap-3 p-5">
      <SectionTitle icon={Sparkles} right={review ? <TrendBadge trend={current.summary?.progressSignals?.overallTrend} /> : null}>
        Đề xuất cho chu kỳ #{current.cycleIndex + 1}
      </SectionTitle>
      <View>
        <Badge tone={cfg.tone}>{cfg.label}</Badge>
        {review ? (
          <>
            <Text className="mt-2 font-body text-sm text-foreground">{review.bodyCompositionTrend}</Text>
            <Text className="mt-1 font-body text-sm text-muted-foreground">{review.trainingNote}</Text>
            {review.confidence === "low" ? (
              <Text className="mt-2 font-body text-xs text-warning">
                ⚠ Độ tin cậy thấp {current.lowConfidence ? "(thiếu dữ liệu InBody đóng chu kỳ)" : ""}
              </Text>
            ) : null}
          </>
        ) : null}
        {analysis?.aiFallback ? (
          <Text className="mt-2 font-body text-xs text-muted-foreground">
            (AI không phản hồi được — áp dụng quy tắc mặc định theo xu hướng tổng thể)
          </Text>
        ) : null}
        {decision === "INSUFFICIENT_DATA" && Array.isArray(reasonCodes) ? (
          <Text className="mt-2 font-body text-xs text-muted-foreground">
            Lý do: {reasonCodes.join(", ")} — chu kỳ chưa đủ thời gian/số buổi tập để đưa ra đánh giá đáng tin cậy.
          </Text>
        ) : null}
      </View>

      {decision === "KEEP" && analysis?.keepDetails ? (
        <DetailBox>
          <Text className="font-body text-sm text-foreground">Tăng tải: +{analysis.keepDetails.overloadIncreasePct}%</Text>
          {analysis.keepDetails.calorieDelta !== 0 ? (
            <Text className="font-body text-sm text-foreground">
              Điều chỉnh calo: {analysis.keepDetails.calorieDelta > 0 ? "+" : ""}
              {analysis.keepDetails.calorieDelta} kcal
            </Text>
          ) : null}
          <Text className="font-body text-xs text-muted-foreground">{analysis.keepDetails.notes}</Text>
        </DetailBox>
      ) : null}
      {decision === "ADJUST" && analysis?.adjustDetails ? (
        <DetailBox>
          {analysis.adjustDetails.pumpSetTargets.length > 0 ? (
            <Text className="font-body text-sm text-foreground">
              Thêm pump-set cho: {analysis.adjustDetails.pumpSetTargets.join(", ")} (tối đa{" "}
              {analysis.adjustDetails.maxPumpSessionsPerWeek} buổi/tuần)
            </Text>
          ) : null}
          {analysis.adjustDetails.calorieDeltaPct !== 0 ? (
            <Text className="font-body text-sm text-foreground">
              Điều chỉnh calo: {analysis.adjustDetails.calorieDeltaPct > 0 ? "+" : ""}
              {analysis.adjustDetails.calorieDeltaPct}%
            </Text>
          ) : null}
          <Text className="font-body text-xs text-muted-foreground">{analysis.adjustDetails.notes}</Text>
        </DetailBox>
      ) : null}
      {decision === "NEW_PLAN" && analysis?.newPlanDraft ? (
        <DetailBox>
          <Text className="font-body text-sm text-foreground">Mục tiêu mới: {analysis.newPlanDraft.goal}</Text>
          <Text className="font-body text-sm text-foreground">
            {analysis.newPlanDraft.daysPerWeek} buổi/tuần — {analysis.newPlanDraft.splitSuggestion}
          </Text>
          {analysis.newPlanDraft.deloadWeekFirst ? (
            <Text className="font-body text-sm text-warning">Bắt đầu bằng 1 tuần deload</Text>
          ) : null}
          <Text className="font-body text-xs text-muted-foreground">{analysis.newPlanDraft.notes}</Text>
        </DetailBox>
      ) : null}
      {analysis?.mealPlanDraft ? (
        <DetailBox>
          <Text className="font-body-semibold text-sm text-foreground">Dinh dưỡng ước tính lại</Text>
          <Text className="font-body text-sm text-foreground">
            TDEE: {analysis.mealPlanDraft.estimatedTDEE} kcal · Mục tiêu: {analysis.mealPlanDraft.calorieTarget} kcal
          </Text>
          <Text className="font-body text-xs text-muted-foreground">
            P{analysis.mealPlanDraft.macros.proteinG}g · C{analysis.mealPlanDraft.macros.carbG}g · F
            {analysis.mealPlanDraft.macros.fatG}g
          </Text>
        </DetailBox>
      ) : null}

      {decision === "NEW_PLAN" ? (
        // No pipeline turns newPlanDraft into a real program — reusing the old plan would make
        // "Đồng ý" a lie, so the action is blocked with an honest explanation (as web).
        <View className="rounded-xl border border-dashed border-border p-3">
          <Text className="font-body text-xs leading-5 text-muted-foreground">
            Đề xuất này cần một chương trình tập mới. Hãy tạo chương trình mới (qua AI Plans hoặc PT) trước, sau đó quay
            lại đây để bắt đầu chu kỳ tiếp theo với chương trình đó — hệ thống không tự tạo hoặc áp dụng chương trình
            thay bạn.
          </Text>
        </View>
      ) : (
        <Button
          full
          icon={ArrowRight}
          disabled={startNext.isPending}
          onPress={() => startNext.mutate(decision === "INSUFFICIENT_DATA" ? null : current.planId)}
        >
          {startNext.isPending
            ? "Đang mở chu kỳ..."
            : decision === "INSUFFICIENT_DATA"
              ? "Bắt đầu chu kỳ mới"
              : "Đồng ý — mở chu kỳ tiếp theo"}
        </Button>
      )}
      {decision !== "NEW_PLAN" && decision !== "INSUFFICIENT_DATA" ? (
        <Text className="-mt-1 text-center font-body text-[11px] text-muted-foreground">Giữ chương trình hiện tại</Text>
      ) : null}
    </Card>
  );
}

function DetailBox({ children }: { children: ReactNode }) {
  return <View className="gap-1 rounded-xl border border-border bg-panel p-3.5">{children}</View>;
}

// ── progress ─────────────────────────────────────────────────────────────────

function ProgressSection({ cycleId }: { cycleId: string }) {
  const progressQuery = useQuery({
    queryKey: ["training-cycle", "progress", cycleId],
    queryFn: () => trainingCycleService.getProgress(cycleId),
  });

  if (progressQuery.isLoading) return <Loading />;
  if (!progressQuery.data) return null;
  const { metrics } = progressQuery.data;

  return (
    <Card className="gap-4 p-5">
      <SectionTitle icon={TrendingUp}>Tiến độ chu kỳ</SectionTitle>

      <View className="flex-row flex-wrap justify-between gap-y-2.5">
        <StatTile
          label="Tuân thủ buổi tập"
          value={metrics.hasScheduledSessions ? `${pct(metrics.adherenceRate)}%` : "Chưa có dữ liệu"}
          formula={FORMULA.adherence}
        />
        <StatTile label="Buổi/tuần" value={String(metrics.workoutsPerWeek)} formula={FORMULA.workoutsPerWeek} />
        <StatTile
          label="Sức mạnh"
          value={metrics.strengthProgressScore != null ? `${pct(metrics.strengthProgressScore)}%` : "—"}
          formula={FORMULA.strength}
        />
        <StatTile
          label="Chất lượng dữ liệu"
          value={`${pct(metrics.dataQualityScore)}%`}
          sub={!metrics.inBodyQuality.hasSufficientData ? "Cần thêm số liệu InBody" : undefined}
          formula={FORMULA.dataQuality}
        />
      </View>

      <View className="flex-row flex-wrap gap-y-1.5">
        {[
          ["Cân nặng", fieldTrendLabel(metrics.bodyWeightTrend)],
          ["Khối cơ", fieldTrendLabel(metrics.skeletalMuscleTrend)],
          ["Mỡ cơ thể", fieldTrendLabel(metrics.bodyFatTrend)],
          ["Đau/khó chịu", fieldTrendLabel(metrics.painTrend)],
          ["RPE", rpeTrendLabel(metrics.rpeTrend)],
          ["Hồi phục", metrics.recoveryScore != null ? `${pct(metrics.recoveryScore)}%` : "—"],
        ].map(([label, value]) => (
          <Text key={label} className="w-1/2 font-body text-xs text-muted-foreground">
            {label}: <Text className="text-foreground">{value}</Text>
          </Text>
        ))}
      </View>

      {metrics.weeklyVolumeByMuscleGroup.length > 0 ? (
        <View>
          <Text className="mb-2 font-body text-xs text-muted-foreground">Volume tập luyện theo tuần (kg)</Text>
          <VolumeBars weeks={metrics.weeklyVolumeByMuscleGroup.map((w) => ({ week: w.week, kg: Math.round(w.totalVolumeKg) }))} />
        </View>
      ) : null}

      {metrics.inBodyQuality.qualityFlags.map((flag, i) => (
        <Warn key={i} tone="muted">
          {flag}
        </Warn>
      ))}
    </Card>
  );
}

/** Web draws this with recharts; mobile draws bars with Views like the InBody trend (no chart lib). */
function VolumeBars({ weeks }: { weeks: { week: number; kg: number }[] }) {
  const accent = useWorkspaceAccent();
  const shown = weeks.slice(-8);
  const max = Math.max(1, ...shown.map((w) => w.kg));
  return (
    <View className="flex-row items-end justify-between gap-2">
      {shown.map((w, index) => (
        <View key={w.week} className="flex-1 items-center gap-1">
          <Text className="font-body text-[10px] text-muted-foreground">{w.kg}</Text>
          <View className="h-24 w-full justify-end">
            <Animated.View
              entering={FadeIn.delay(index * 60).duration(260)}
              className="w-full rounded-md"
              style={{ height: `${w.kg > 0 ? Math.max(6, (w.kg / max) * 100) : 0}%`, backgroundColor: accent.primary }}
            />
          </View>
          <Text className="font-body text-[10px] text-muted-foreground">T{w.week + 1}</Text>
        </View>
      ))}
    </View>
  );
}

// ── session-feedback summary (rule-based, no AI) ─────────────────────────────

function FeedbackSummaryCard({ cycleId }: { cycleId: string }) {
  const summaryQuery = useQuery({
    queryKey: ["training-cycle", "session-feedback-summary", cycleId],
    queryFn: () => trainingCycleService.getSessionFeedbackSummary(cycleId),
  });

  if (summaryQuery.isLoading) return <Loading />;
  const s = summaryQuery.data;
  if (!s || s.totalSessions === 0) return null;

  const sentiment = FEEDBACK_SENTIMENT[s.feedbackSentimentByRules] ?? FEEDBACK_SENTIMENT.insufficient_feedback;
  const flags = [...s.safetyFlags, ...s.equipmentMismatchFlags, ...s.adherenceRelatedComplaintFlags, ...s.motivationOrBoredomFlags];

  return (
    <Card className="gap-4 p-5">
      <SectionTitle icon={MessageSquare} right={<Badge tone={sentiment.tone}>{sentiment.label}</Badge>}>
        Cảm nhận buổi tập
      </SectionTitle>

      <View className="flex-row flex-wrap justify-between gap-y-2.5">
        <StatTile
          label="Đã phản hồi"
          value={`${s.feedbackSubmittedCount}/${s.totalSessions}`}
          sub={`${pct(s.feedbackCompletionRate)}% buổi`}
          formula={FORMULA.feedbackCount}
        />
        <StatTile
          label="Đánh giá TB"
          value={s.averageSessionRating != null ? s.averageSessionRating.toFixed(1) : "—"}
          sub="/5 sao"
          formula={FORMULA.avgRating}
        />
        <StatTile
          label="Đau TB"
          value={s.averagePain != null ? s.averagePain.toFixed(1) : "—"}
          sub="/10"
          formula={FORMULA.avgPain}
        />
        <StatTile label="Chất lượng dữ liệu" value={`${pct(s.dataQualityScore)}%`} formula={FORMULA.feedbackQuality} />
      </View>

      <View className="flex-row flex-wrap gap-y-1.5">
        <Text className="w-1/2 font-body text-xs text-muted-foreground">Quá nặng: {s.sessionsMarkedTooHard} buổi</Text>
        <Text className="w-1/2 font-body text-xs text-muted-foreground">Quá nhẹ: {s.sessionsMarkedTooEasy} buổi</Text>
        <Text className="w-full font-body text-xs text-muted-foreground">
          Không muốn lặp lại: {s.sessionsUserWouldNotRepeat} buổi
        </Text>
      </View>

      {s.mostLikedExercises.length > 0 ? (
        <View>
          <Text className="mb-0.5 font-body text-xs text-muted-foreground">Bài tập được thích</Text>
          <ExerciseNames ids={s.mostLikedExercises} />
        </View>
      ) : null}
      {s.mostDislikedExercises.length > 0 ? (
        <View>
          <Text className="mb-0.5 font-body text-xs text-muted-foreground">Bài tập ít được thích</Text>
          <ExerciseNames ids={s.mostDislikedExercises} />
        </View>
      ) : null}

      {flags.map((flag) => (
        <Warn key={flag}>{FEEDBACK_FLAG[flag] ?? flag}</Warn>
      ))}

      {s.feedbackSentimentByRules === "insufficient_feedback" ? (
        <Text className="font-body text-[11px] italic text-muted-foreground">
          Chưa đủ phản hồi để đưa ra nhận định đáng tin cậy — hãy điền cảm nhận sau mỗi buổi tập.
        </Text>
      ) : null}
    </Card>
  );
}

/**
 * The summary lists liked/disliked exercises by Exercise.id (web prints the raw ids). Names come from
 * the catalog — same query key as the exercise detail screen — and an id that cannot be resolved
 * is left out rather than shown.
 */
function ExerciseNames({ ids }: { ids: string[] }) {
  const results = useQueries({
    queries: ids.map((id) => ({
      queryKey: ["exercise", id],
      queryFn: () => workoutService.getExercise(id),
      staleTime: 10 * 60_000,
    })),
  });
  const names = results.map((r) => (r.data as { exerciseName?: string } | undefined)?.exerciseName).filter(Boolean);
  const loading = results.some((r) => r.isLoading);
  return (
    <Text className="font-body text-xs text-foreground">
      {names.length > 0 ? names.join(", ") : loading ? "…" : "—"}
    </Text>
  );
}

// ── adaptive assessment: training decision + independent nutrition decision ──

function AssessmentCards({ cycleId }: { cycleId: string }) {
  const accent = useWorkspaceAccent();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [showDetails, setShowDetails] = useState(false);
  const latestKey = ["training-cycle", "assessment", "latest", cycleId];

  const latestQuery = useQuery({
    queryKey: latestKey,
    queryFn: () => trainingCycleService.getLatestAssessment(cycleId),
    retry: false,
  });
  // "How close am I to the next diet-break proposal" — shown only while nothing is proposed.
  const dietBreakQuery = useQuery({
    queryKey: ["training-cycle", "diet-break-status", cycleId],
    queryFn: () => trainingCycleService.getDietBreakStatus(cycleId),
    retry: false,
  });

  const evaluate = useMutation({
    mutationFn: () => trainingCycleService.evaluate(cycleId),
    onSuccess: () => {
      toast.show("Đang đánh giá chu kỳ — AI sẽ giải thích kết quả trong giây lát", "success");
      queryClient.invalidateQueries({ queryKey: latestKey });
    },
    onError: (e) => toast.show(apiErrorMessage(e, "Không thể đánh giá chu kỳ"), "danger"),
  });
  // Accepting only marks the recommendation reviewed — it does not itself change any plan.
  const review = useMutation({
    mutationFn: (choice: "accept" | "reject") =>
      choice === "accept"
        ? trainingCycleService.acceptRecommendation(cycleId)
        : trainingCycleService.rejectRecommendation(cycleId),
    onSuccess: (_d, choice) => {
      toast.show(choice === "accept" ? "Đã chấp nhận đề xuất" : "Đã giữ lịch tập hiện tại", "success");
      queryClient.invalidateQueries({ queryKey: latestKey });
    },
    onError: (e) => toast.show(apiErrorMessage(e, "Không thể lưu lựa chọn"), "danger"),
  });
  // Accepting a nutrition proposal makes fitness-service write a new NutritionGoal version.
  const nutritionReview = useMutation({
    mutationFn: (choice: "accept" | "reject") =>
      choice === "accept"
        ? trainingCycleService.acceptNutritionRecommendation(cycleId)
        : trainingCycleService.rejectNutritionRecommendation(cycleId),
    onSuccess: (_d, choice) => {
      // "Đã hiểu" on a decision with nothing to apply also goes through accept — web shows the
      // "applied a new goal" toast for it too, which is untrue (no NutritionGoal is written).
      const applied = choice === "accept" && nutritionHasProposal(latestQuery.data?.nutritionDecision);
      toast.show(
        applied
          ? "Đã áp dụng đề xuất dinh dưỡng — tạo phiên bản mục tiêu calo/macro mới"
          : choice === "accept"
            ? "Đã ghi nhận"
            : "Đã giữ mục tiêu dinh dưỡng hiện tại",
        "success",
      );
      queryClient.invalidateQueries({ queryKey: latestKey });
      queryClient.invalidateQueries({ queryKey: ["nutrition-goal"] });
      queryClient.invalidateQueries({ queryKey: ["nutrition-goal-history"] });
    },
    onError: (e) => toast.show(apiErrorMessage(e, "Không thể lưu lựa chọn dinh dưỡng"), "danger"),
  });

  if (latestQuery.isLoading) return <Loading />;
  const assessment: CycleAssessment | undefined = latestQuery.data;

  if (!assessment) {
    return (
      <Card className="items-center gap-3 p-5">
        <Sparkles size={20} color={accent.primary} />
        <Text className="text-center font-body text-sm text-muted-foreground">
          Đánh giá nâng cao dùng Decision Engine + AI giải thích (6 mức quyết định).
        </Text>
        <Button className="self-center" disabled={evaluate.isPending} onPress={() => evaluate.mutate()}>
          {evaluate.isPending ? "Đang đánh giá..." : "Đánh giá chu kỳ (nâng cao)"}
        </Button>
        {evaluate.isPending ? (
          <Text className="text-center font-body text-[11px] text-muted-foreground">
            Quá trình này có thể mất đến 1-2 phút do cần gọi AI để giải thích kết quả.
          </Text>
        ) : null}
      </Card>
    );
  }

  if (assessment.status === "PENDING") {
    return (
      <Card className="flex-row items-center gap-3 p-4">
        <ActivityIndicator color={accent.primary} />
        <Text className="font-body text-sm text-foreground">Đang đánh giá chu kỳ...</Text>
      </Card>
    );
  }

  const cfg = ADAPTIVE_DECISION[assessment.decision ?? "INSUFFICIENT_DATA"];
  const critical = assessment.safetyFlags?.find((f) => f.severity === "critical");
  const nutritionDecision = assessment.nutritionDecision as NutritionDecision | null;
  const nutritionCfg = nutritionDecision ? NUTRITION_DECISION[nutritionDecision] : null;
  const diet = dietBreakQuery.data;
  const proposed = assessment.nutritionProposedChanges;

  return (
    <>
      <Card className="gap-3 p-5">
        <View className="flex-row flex-wrap items-center justify-between gap-2">
          <Badge tone={cfg.tone}>{cfg.label}</Badge>
          <Text className="font-body text-[11px] text-muted-foreground">Đánh giá lần {assessment.assessmentVersion}</Text>
        </View>
        {assessment.confidenceScore != null ? (
          <Text className="font-body text-xs text-muted-foreground">
            Độ tin cậy dữ liệu: {confidenceTier(assessment.confidenceScore)}
          </Text>
        ) : null}
        {critical ? <Warn tone="danger">{critical.message}</Warn> : null}
        {assessment.aiSummary ? <Text className="font-body text-sm leading-6 text-foreground">{assessment.aiSummary}</Text> : null}

        {showDetails ? (
          <View className="gap-3 rounded-xl border border-border bg-panel p-3.5">
            {assessment.reasonCodes && assessment.reasonCodes.length > 0 ? (
              <View>
                <Text className="mb-1 font-body-semibold text-xs text-muted-foreground">Lý do (từ Decision Engine)</Text>
                {assessment.reasonCodes.map((r) => (
                  <Text key={r} className="font-body text-xs text-muted-foreground">
                    • {r}
                  </Text>
                ))}
              </View>
            ) : null}
            {assessment.proposedChanges && assessment.proposedChanges.length > 0 ? (
              <View className="gap-1">
                <Text className="font-body-semibold text-xs text-muted-foreground">Đề xuất thay đổi</Text>
                {assessment.proposedChanges.map((c, i) => (
                  <Text key={i} className="font-body text-xs text-foreground">
                    <Text className="font-body-semibold">{c.target}</Text>: {c.currentValue} → {c.proposedValue}
                    <Text className="text-muted-foreground"> — {c.reason}</Text>
                  </Text>
                ))}
              </View>
            ) : null}
            {assessment.conflictingSignals && assessment.conflictingSignals.length > 0 ? (
              <View>
                <Text className="mb-1 font-body-semibold text-xs text-warning">Tín hiệu mâu thuẫn</Text>
                {assessment.conflictingSignals.map((s, i) => (
                  <Text key={i} className="font-body text-xs text-muted-foreground">
                    • {s}
                  </Text>
                ))}
              </View>
            ) : null}
          </View>
        ) : null}

        {assessment.userDecision === "PENDING" ? (
          <View className="gap-2">
            <View className="flex-row gap-2">
              <Button className="flex-1" size="sm" icon={CheckCircle2} disabled={review.isPending} onPress={() => review.mutate("accept")}>
                Chấp nhận
              </Button>
              <Button
                className="flex-1"
                size="sm"
                variant="secondary"
                icon={Ban}
                disabled={review.isPending}
                onPress={() => review.mutate("reject")}
              >
                Giữ lịch hiện tại
              </Button>
            </View>
            <View className="flex-row gap-2">
              <Button className="flex-1" size="sm" variant="ghost" onPress={() => setShowDetails((v) => !v)}>
                {showDetails ? "Ẩn chi tiết" : "Xem chi tiết"}
              </Button>
              <Button
                className="flex-1"
                size="sm"
                variant="ghost"
                icon={RotateCw}
                disabled={evaluate.isPending}
                onPress={() => evaluate.mutate()}
              >
                {evaluate.isPending ? "Đang tạo lại..." : "Tạo lại đề xuất"}
              </Button>
            </View>
          </View>
        ) : (
          <>
            <Text className="font-body text-xs text-muted-foreground">
              {assessment.userDecision === "ACCEPTED" ? "✓ Bạn đã chấp nhận đề xuất này." : "Bạn đã chọn giữ lịch tập hiện tại."}
            </Text>
            <Button size="sm" variant="ghost" onPress={() => setShowDetails((v) => !v)}>
              {showDetails ? "Ẩn chi tiết" : "Xem chi tiết"}
            </Button>
          </>
        )}
      </Card>

      {/* Nutrition is its own decision space with its own accept/reject — never merged into the card above. */}
      {nutritionCfg ? (
        <Card className="gap-3 p-5">
          <SectionTitle icon={Utensils} right={<Badge tone={nutritionCfg.tone}>{nutritionCfg.label}</Badge>}>
            Đề xuất dinh dưỡng
          </SectionTitle>
          {assessment.nutritionConfidence ? (
            <Text className="font-body text-xs text-muted-foreground">
              Độ tin cậy dữ liệu: {CONFIDENCE_TIER_LABEL[assessment.nutritionConfidence] ?? assessment.nutritionConfidence}
            </Text>
          ) : null}
          {nutritionDecision === "ESCALATE" || nutritionDecision === "EARLY_REVIEW" ? (
            <Warn tone="danger">
              Có dấu hiệu cần chú ý (đau/khó chịu). Vui lòng tham khảo chuyên gia y tế/PT trước khi tiếp tục — hệ thống
              không tự động giảm calo hay tăng cường độ trong tình huống này.
            </Warn>
          ) : null}
          {assessment.nutritionAiExplanation ? (
            <Text className="font-body text-sm leading-6 text-foreground">{assessment.nutritionAiExplanation}</Text>
          ) : assessment.nutritionReasonCodes && assessment.nutritionReasonCodes.length > 0 ? (
            <Text className="font-body text-xs text-muted-foreground">Lý do: {assessment.nutritionReasonCodes.join(", ")}</Text>
          ) : null}

          {proposed ? (
            <DetailBox>
              <Text className="font-body-semibold text-xs text-muted-foreground">Mục tiêu dinh dưỡng đề xuất</Text>
              <Text className="font-body text-sm text-foreground">
                {[
                  proposed.calories != null ? `${proposed.calories} kcal` : null,
                  proposed.protein != null ? `P ${proposed.protein}g` : null,
                  proposed.carbs != null ? `C ${proposed.carbs}g` : null,
                  proposed.fat != null ? `F ${proposed.fat}g` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </Text>
              <Text className="font-body text-[11px] text-muted-foreground">
                Chưa áp dụng — cần bạn xác nhận bên dưới trước khi mục tiêu dinh dưỡng thay đổi.
              </Text>
            </DetailBox>
          ) : null}

          {assessment.nutritionUserDecision === "PENDING" ? (
            nutritionHasProposal(nutritionDecision) ? (
              <View className="gap-2">
                <Button
                  full
                  size="sm"
                  icon={CheckCircle2}
                  disabled={nutritionReview.isPending}
                  onPress={() => nutritionReview.mutate("accept")}
                >
                  {nutritionDecision === "PROPOSE_DIET_BREAK" ? "Bắt đầu nghỉ diet break" : "Áp dụng mục tiêu mới"}
                </Button>
                <Button
                  full
                  size="sm"
                  variant="secondary"
                  icon={Ban}
                  disabled={nutritionReview.isPending}
                  onPress={() => nutritionReview.mutate("reject")}
                >
                  Giữ mục tiêu hiện tại
                </Button>
              </View>
            ) : (
              <Button size="sm" variant="ghost" disabled={nutritionReview.isPending} onPress={() => nutritionReview.mutate("accept")}>
                Đã hiểu
              </Button>
            )
          ) : (
            <Text className="font-body text-xs text-muted-foreground">
              {assessment.nutritionUserDecision === "ACCEPTED"
                ? assessment.appliedNutritionGoalId
                  ? "✓ Đã áp dụng mục tiêu dinh dưỡng mới."
                  : "✓ Đã xác nhận."
                : "Bạn đã chọn giữ mục tiêu dinh dưỡng hiện tại."}
            </Text>
          )}
        </Card>
      ) : null}

      {!nutritionCfg && diet?.applicable && !diet.eligible && diet.weeksRemaining != null ? (
        <View className="flex-row items-center gap-2 rounded-xl border border-border bg-card p-3">
          <Text className="text-lg">🧊</Text>
          <Text className="flex-1 font-body text-xs leading-5 text-muted-foreground">
            Còn khoảng <Text className="font-body-semibold text-foreground">{diet.weeksRemaining} tuần</Text> nữa đến lần đề
            xuất nghỉ diet break tiếp theo (sau {diet.thresholdWeeks} tuần cắt calo liên tục).
          </Text>
        </View>
      ) : null}
    </>
  );
}

// ── history + report ─────────────────────────────────────────────────────────

function HistoryRow({ cycle, onOpenReport }: { cycle: TrainingCycle; onOpenReport: () => void }) {
  const toast = useToast();
  const invalidate = useInvalidateCycles();
  const isClosed = cycle.status === "COMPLETED" || cycle.status === "ANALYZED";

  // Adherence from whichever flow has real data: the legacy summary, else the latest assessment
  // (same cache key as the assessment card). Never shown as 0% just because neither ran.
  const latestQuery = useQuery({
    queryKey: ["training-cycle", "assessment", "latest", cycle.id],
    queryFn: () => trainingCycleService.getLatestAssessment(cycle.id),
    retry: false,
    enabled: isClosed && cycle.summary?.adherence == null,
  });
  const adherence =
    cycle.summary?.adherence?.percent ??
    (latestQuery.data?.computedMetrics ? pct(latestQuery.data.computedMetrics.adherenceRate) : null);

  const remove = useMutation({
    mutationFn: () => trainingCycleService.remove(cycle.id),
    onSuccess: () => {
      toast.show("Đã xoá chu kỳ tập luyện", "success");
      invalidate();
    },
    onError: (e) => toast.show(apiErrorMessage(e, "Không thể xoá chu kỳ"), "danger"),
  });

  const decisionLabel = cycleDecisionLabel(cycle.decision);
  const up = cycle.decision === "KEEP" || cycle.decision === "PROGRESS";
  const down = cycle.decision === "NEW_PLAN" || cycle.decision === "REBUILD";

  return (
    <Card className="flex-row items-center gap-3 p-3.5" onPress={isClosed ? onOpenReport : undefined}>
      <View className="flex-1 gap-1">
        <Text className="font-body-semibold text-sm text-foreground">
          Chu kỳ #{cycle.cycleIndex}: {formatCycleDate(cycle.startDate)} – {formatCycleDate(cycle.endDate)}
        </Text>
        <Text className="font-body text-xs text-muted-foreground">
          Tuân thủ buổi tập: {adherence != null ? `${adherence}%` : "Chưa có dữ liệu"}
        </Text>
        <View className="flex-row flex-wrap items-center gap-2">
          {cycle.status === "CANCELLED" ? <Badge>Đã huỷ</Badge> : null}
          {decisionLabel ? (
            <View className="flex-row items-center gap-1">
              {up ? <TrendingUp size={13} color="#22c55e" /> : down ? <TrendingDown size={13} color="#ef4444" /> : null}
              <Text className="font-body text-xs text-muted-foreground">{decisionLabel}</Text>
            </View>
          ) : null}
          <TrendBadge trend={cycle.summary?.progressSignals?.overallTrend} />
        </View>
      </View>
      <IconAction
        icon={Trash2}
        label="Xoá chu kỳ"
        pending={remove.isPending}
        disabled={remove.isPending}
        onPress={() => confirm("Xoá chu kỳ?", "Xoá chu kỳ tập luyện này khỏi lịch sử?", "Xoá", () => remove.mutate())}
      />
    </Card>
  );
}

function CycleReport({ cycleId }: { cycleId: string }) {
  const accent = useWorkspaceAccent();
  const reportQuery = useQuery({
    queryKey: ["training-cycle", "report", cycleId],
    queryFn: () => trainingCycleService.getReport(cycleId),
  });

  if (reportQuery.isLoading) {
    return (
      <View className="items-center py-10">
        <ActivityIndicator color={accent.primary} />
      </View>
    );
  }
  if (reportQuery.isError || !reportQuery.data) {
    return <Text className="py-6 text-center font-body text-sm text-destructive">Không thể tải báo cáo chu kỳ.</Text>;
  }
  const r = reportQuery.data;
  const b = r.workouts.breakdown;
  const n = r.nutrition;

  return (
    <ScrollView contentContainerStyle={{ gap: 18, paddingBottom: 8 }} showsVerticalScrollIndicator={false}>
      <Text className="text-center font-body text-xs text-muted-foreground">
        Chu kỳ #{r.cycle.cycleIndex} · {formatCycleDate(r.window.startDate)} – {formatCycleDate(r.window.endDate)}
      </Text>

      {r.flags.map((flag) => (
        <Warn key={flag}>{REPORT_FLAG[flag] ?? flag}</Warn>
      ))}

      <View className="gap-2">
        <SectionTitle icon={Dumbbell}>Buổi tập</SectionTitle>
        <View className="flex-row gap-1.5">
          {[
            [b.adherencePct != null ? `${b.adherencePct}%` : "—", "Tuân thủ", "text-primary"],
            [String(b.completed), "Hoàn thành", "text-foreground"],
            [String(b.rescheduled), "Đã dời lịch", "text-chart-3"],
            [String(b.missed), "Bỏ lỡ", "text-destructive"],
            [String(b.planned), "Sắp tới", "text-foreground"],
          ].map(([value, label, color]) => (
            <View key={label} className="flex-1 items-center rounded-lg bg-panel px-1 py-2.5">
              <Text className={`font-display text-base ${color}`}>{value}</Text>
              <Text className="text-center font-body text-[10px] text-muted-foreground">{label}</Text>
            </View>
          ))}
        </View>
        {r.workouts.missedSessions.length > 0 ? (
          <Text className="font-body text-xs text-muted-foreground">
            Ngày bỏ lỡ: {r.workouts.missedSessions.map((s) => formatCycleDate(s.date)).join(", ")}
          </Text>
        ) : null}
        {r.workouts.rescheduledSessions.length > 0 ? (
          <Text className="font-body text-xs text-chart-3">
            Đã dời lịch: {r.workouts.rescheduledSessions.map((s) => `${formatCycleDate(s.from)} → ${formatCycleDate(s.to)}`).join(", ")}
          </Text>
        ) : null}
        {r.workouts.highPainSessions.length > 0 ? (
          <Text className="font-body text-xs text-destructive">
            {r.workouts.highPainSessions.length} buổi tập ghi nhận đau đáng kể
          </Text>
        ) : null}
      </View>

      {r.plannedVsActual.byExercise.length > 0 ? (
        <View className="gap-2">
          <SectionTitle icon={Scale}>Kế hoạch so với thực tế</SectionTitle>
          {r.plannedVsActual.totals.volumeAdherencePct != null ? (
            <Text className="font-body text-xs text-muted-foreground">
              Khối lượng tạ: {r.plannedVsActual.totals.totalActualVolumeKg} / {r.plannedVsActual.totals.totalPlannedVolumeKg} kg (
              {r.plannedVsActual.totals.volumeAdherencePct}%)
            </Text>
          ) : null}
          {r.plannedVsActual.byExercise.map((ex) => {
            const line = plannedVsActualLine(ex);
            if (!line) return null;
            return (
              <View key={ex.exerciseId} className="flex-row items-center justify-between gap-3 rounded-lg bg-panel px-3 py-2">
                <Text className="flex-1 font-body text-xs text-foreground" numberOfLines={2}>
                  {ex.exerciseName}
                </Text>
                <Text className="font-body text-xs text-muted-foreground">{line}</Text>
              </View>
            );
          })}
        </View>
      ) : null}

      <View className="gap-1.5">
        <SectionTitle icon={Utensils}>Dinh dưỡng</SectionTitle>
        {n.daysLogged > 0 ? (
          <>
            <Text className="font-body text-xs text-muted-foreground">
              Protein trung bình: <Text className="font-body-semibold text-foreground">{Math.round(n.avgProtein ?? 0)}g</Text>
              {n.targetProtein != null ? ` / mục tiêu ${n.targetProtein}g (${n.proteinAdherencePct}%)` : ""}
            </Text>
            <Text className="font-body text-xs text-muted-foreground">
              Calories trung bình:{" "}
              <Text className="font-body-semibold text-foreground">{Math.round(n.avgCalories ?? 0)} kcal</Text>
              {n.targetCalories != null ? ` / mục tiêu ${n.targetCalories} kcal (${n.caloriesAdherencePct}%)` : ""}
            </Text>
            {n.proteinPerKgBodyWeight != null ? (
              <Text className="font-body text-xs text-muted-foreground">
                Protein/kg thể trọng: <Text className="font-body-semibold text-foreground">{n.proteinPerKgBodyWeight}g/kg</Text>{" "}
                (khuyến nghị khoa học: {n.proteinEvidenceRangeGPerKg.min}–{n.proteinEvidenceRangeGPerKg.max}g/kg cho tăng cơ)
              </Text>
            ) : null}
            <Text className="font-body text-xs text-muted-foreground">
              Số ngày ghi log: {n.daysLogged}/{n.totalDaysInWindow}, bỏ bữa: {n.skippedMeals}
            </Text>
          </>
        ) : (
          <Text className="font-body text-xs text-muted-foreground">Không có dữ liệu dinh dưỡng được ghi log trong chu kỳ này.</Text>
        )}
      </View>

      {r.trainingLoad.hasData ? (
        <View className="gap-1">
          <SectionTitle icon={ShieldAlert}>Tải trọng & biến thiên tập luyện</SectionTitle>
          {r.trainingLoad.weeklyLoad.map((w) => (
            <Text key={w.week} className="font-body text-xs text-muted-foreground">
              Tuần {w.week}: tải {w.totalLoad}
              {w.monotony != null ? (
                <>
                  {" "}
                  · monotony{" "}
                  <Text className={w.monotony >= r.trainingLoad.monotonyThreshold ? "font-body-semibold text-warning" : "text-foreground"}>
                    {w.monotony}
                  </Text>
                </>
              ) : null}
            </Text>
          ))}
        </View>
      ) : null}

      {r.newPRs.length > 0 ? <Text className="font-body text-xs text-primary">🏆 PR mới: {r.newPRs.join(", ")}</Text> : null}
    </ScrollView>
  );
}
