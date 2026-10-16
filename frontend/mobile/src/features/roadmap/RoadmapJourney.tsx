import { useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { router } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRight,
  Ban,
  ChevronDown,
  ChevronRight,
  Map as MapIcon,
  PencilRuler,
  Sparkles,
  Trophy,
  XCircle,
} from "lucide-react-native";

import { Badge, BottomSheet, Button, Card, EmptyState, Tappable, useToast } from "../../components/ui";
import {
  fitnessRoadmapService,
  type CurrentForecastResult,
  type FitnessDiagnosisResult,
  type FitnessRoadmapProjection,
  type RoadmapPhaseForecastResult,
  type RoadmapPhaseWithCycles,
} from "../../services/api";
import { useWorkspaceAccent } from "../../theme/workspace";
import { darkColors, designTokens } from "../../theme/colors";
import {
  ADAPTIVE_NOTE,
  ASSESSMENT_DECISION_LABEL,
  CONFIDENCE_TIER_LABEL,
  CREATOR_ROLE_LABEL,
  formatDate,
  getPhaseReadiness,
  GOAL_OPTIONS,
  isNotFound,
  PHASE_TYPE_LABEL,
  RECONCILIATION_STATUS_LABEL,
  roadmapErrorMessage,
  ROADMAP_STATUS_LABEL,
  trendLabel,
  type PhaseReadiness,
} from "./roadmap";
import { EnergyBreakdownCard, PhaseForecastCard, PhaseTimeline, StrategyGroups } from "./RoadmapCards";

export const ROADMAP_KEY = ["fitness-roadmap"];

/**
 * WB-11 — the long-term journey (web's RoadmapJourneyPage), rendered inline in Tập luyện's
 * "Lộ trình" segment and as its own screen. Every state the server can be in has a surface:
 * none (create via the guided wizard or the advanced form), DRAFT (review → Bắt đầu / Bỏ bản nháp),
 * ACTIVE (current phase + its cycle, readiness, advance, pending rebuild, adaptive forecast,
 * timeline), COMPLETED (final summary), ARCHIVED.
 *
 * Every state change is one of the CLIENT's own calls (activate/advance/activatePhase/rebuild/
 * archive) — the server decides the outcome; the UI shows whatever projection comes back.
 * No own ScrollView: the host (the Tập luyện tab or the roadmap screen) scrolls.
 */
export function RoadmapJourney({ onOpenCycle }: { onOpenCycle?: () => void }) {
  const accent = useWorkspaceAccent();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [confirmArchive, setConfirmArchive] = useState(false);

  const activeQuery = useQuery({
    queryKey: [...ROADMAP_KEY, "current"],
    queryFn: fitnessRoadmapService.getCurrent,
    retry: false,
  });
  const noActive = activeQuery.isError && isNotFound(activeQuery.error);
  const draftQuery = useQuery({
    queryKey: [...ROADMAP_KEY, "draft-current"],
    queryFn: fitnessRoadmapService.getCurrentDraft,
    retry: false,
    enabled: noActive,
  });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ROADMAP_KEY });
    void queryClient.invalidateQueries({ queryKey: ["training-cycle"] });
    void queryClient.invalidateQueries({ queryKey: ["workout-schedules"] });
  };

  const advance = useMutation({
    mutationFn: (id: string) => fitnessRoadmapService.advance(id),
    onSuccess: () => {
      toast.show("Đã kiểm tra tiến độ lộ trình", "success");
      refresh();
    },
    onError: (e) => toast.show(roadmapErrorMessage(e, "Không thể cập nhật lộ trình"), "danger"),
  });
  const restartPhase = useMutation({
    mutationFn: (v: { roadmapId: string; phaseId: string }) => fitnessRoadmapService.activatePhase(v.roadmapId, v.phaseId),
    onSuccess: () => {
      toast.show("Đã bắt đầu chu kỳ mới", "success");
      refresh();
    },
    onError: (e) => toast.show(roadmapErrorMessage(e, "Không thể bắt đầu chu kỳ mới"), "danger"),
  });
  const archive = useMutation({
    mutationFn: (id: string) => fitnessRoadmapService.archive(id),
    onSuccess: () => {
      setConfirmArchive(false);
      toast.show("Đã lưu trữ lộ trình", "success");
      refresh();
    },
    onError: (e) => toast.show(roadmapErrorMessage(e, "Không thể lưu trữ lộ trình"), "danger"),
  });

  if (activeQuery.isLoading || (noActive && draftQuery.isPending)) {
    return (
      <View className="items-center py-16">
        <ActivityIndicator color={accent.primary} />
      </View>
    );
  }

  if (noActive) {
    if (draftQuery.data) return <DraftRoadmap data={draftQuery.data} onChanged={refresh} />;
    if (draftQuery.isError && !isNotFound(draftQuery.error)) {
      return <LoadError onRetry={() => void draftQuery.refetch()} />;
    }
    return <NoRoadmap />;
  }
  if (activeQuery.isError || !activeQuery.data) return <LoadError onRetry={() => void activeQuery.refetch()} />;

  const data = activeQuery.data;
  const { roadmap, phases, activePhase, pendingRebuild } = data;
  const readiness = activePhase ? getPhaseReadiness(activePhase, pendingRebuild) : null;
  const closed = roadmap.status === "COMPLETED" || roadmap.status === "CANCELLED";

  return (
    <View className="gap-4">
      <Card className="p-5">
        <View className="flex-row items-center gap-2">
          <MapIcon size={18} color={accent.primary} />
          <Text className="flex-1 font-display text-lg text-foreground" numberOfLines={2}>
            {roadmap.name}
          </Text>
        </View>
        <View className="mt-1 flex-row flex-wrap items-center gap-2">
          <Badge tone={roadmap.status === "ACTIVE" ? "success" : "neutral"}>{ROADMAP_STATUS_LABEL[roadmap.status]}</Badge>
          <Text className="font-body text-xs text-muted-foreground">{`Bắt đầu ${formatDate(roadmap.plannedStartAt)}`}</Text>
          {roadmap.createdByRole !== "CLIENT" ? <Badge tone="info">{CREATOR_ROLE_LABEL[roadmap.createdByRole]}</Badge> : null}
        </View>
      </Card>

      {pendingRebuild && roadmap.status === "ACTIVE" ? (
        <PendingRebuild
          roadmapId={roadmap.id}
          assessmentId={pendingRebuild.assessmentId}
          currentPhaseId={pendingRebuild.phaseId}
          phases={phases}
          onApplied={refresh}
        />
      ) : null}

      {activePhase && roadmap.status === "ACTIVE" && readiness ? (
        <ActivePhase
          data={data}
          phase={activePhase}
          readiness={readiness}
          onAdvance={() => advance.mutate(roadmap.id)}
          advancing={advance.isPending}
          onRestart={() => restartPhase.mutate({ roadmapId: roadmap.id, phaseId: activePhase.id })}
          restarting={restartPhase.isPending}
          onOpenCycle={onOpenCycle}
        />
      ) : null}

      {roadmap.status === "ACTIVE" ? <AdaptiveForecast roadmapId={roadmap.id} /> : null}
      {roadmap.status === "COMPLETED" ? <CompletedSummary data={data} /> : null}
      {roadmap.status === "ARCHIVED" ? (
        <Card className="flex-row items-center gap-3 p-4">
          <Ban size={18} color={darkColors.mutedForeground} />
          <Text className="font-body text-sm text-muted-foreground">Lộ trình này đã được lưu trữ.</Text>
        </Card>
      ) : null}

      <Card className="p-4">
        <Text className="mb-3 font-body-semibold text-sm text-foreground">Toàn bộ hành trình</Text>
        <PhaseTimeline phases={phases} />
      </Card>

      {closed ? (
        <Button variant="secondary" full disabled={archive.isPending} onPress={() => setConfirmArchive(true)}>
          Lưu trữ lộ trình này
        </Button>
      ) : null}
      {closed || roadmap.status === "ARCHIVED" ? <NoRoadmap compact /> : null}

      <BottomSheet open={confirmArchive} onClose={() => setConfirmArchive(false)} title="Lưu trữ lộ trình?">
        <Text className="mb-4 text-center font-body text-sm text-muted-foreground">
          Lộ trình được cất đi; lịch sử tập luyện, dinh dưỡng và đánh giá của bạn vẫn giữ nguyên.
        </Text>
        <Button full size="lg" disabled={archive.isPending} onPress={() => archive.mutate(roadmap.id)}>
          {archive.isPending ? "Đang lưu trữ…" : "Lưu trữ"}
        </Button>
      </BottomSheet>
    </View>
  );
}

function LoadError({ onRetry }: { onRetry: () => void }) {
  return <EmptyState icon={XCircle} title="Không thể tải lộ trình" description="Vui lòng thử lại." actionLabel="Thử lại" onAction={onRetry} />;
}

function NoRoadmap({ compact }: { compact?: boolean }) {
  const accent = useWorkspaceAccent();
  return (
    <Card className={`items-center p-6 ${compact ? "" : ""}`}>
      {compact ? null : (
        <>
          <View className="mb-3 h-14 w-14 items-center justify-center rounded-2xl bg-panel">
            <MapIcon size={26} color={accent.primary} />
          </View>
          <Text className="text-center font-display text-base text-foreground">Bạn chưa có lộ trình dài hạn nào</Text>
          <Text className="mb-4 mt-1 text-center font-body text-xs text-muted-foreground">
            Lộ trình chia mục tiêu dài hạn thành các giai đoạn (giảm mỡ, nghỉ giữa kỳ, duy trì…) để bạn luôn biết mình đang ở
            đâu và tiếp theo là gì. Gymini hỏi vài thông tin rồi cùng bạn xây dựng lộ trình phù hợp.
          </Text>
        </>
      )}
      <Button full icon={Sparkles} onPress={() => router.push("/client/roadmap/wizard")}>
        {compact ? "Bắt đầu lộ trình mới" : "Tạo lộ trình cùng Gymini"}
      </Button>
      <Tappable className="mt-3 flex-row items-center gap-1" onPress={() => router.push("/client/roadmap/create")}>
        <PencilRuler size={13} color={darkColors.mutedForeground} />
        <Text className="font-body-semibold text-xs text-muted-foreground underline">Tạo lộ trình nâng cao (tự chọn từng giai đoạn)</Text>
      </Tappable>
    </Card>
  );
}

// ── DRAFT ────────────────────────────────────────────────────────────────

type AiMeta = { summary: string; reasoningSummary: string; confidence: number; warnings: string[]; assumptions: string[] };

function DraftRoadmap({ data, onChanged }: { data: FitnessRoadmapProjection; onChanged: () => void }) {
  const toast = useToast();
  const { roadmap, phases } = data;
  const aiMeta = (roadmap.configuration as any)?.aiDraft as AiMeta | undefined;
  const snapshot = (roadmap.configuration as any)?.roadmapProjectionSnapshot as RoadmapPhaseForecastResult | null | undefined;
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const activate = useMutation({
    mutationFn: () => fitnessRoadmapService.activate(roadmap.id),
    onSuccess: () => {
      toast.show("Đã bắt đầu lộ trình", "success");
      onChanged();
    },
    onError: (e) => toast.show(roadmapErrorMessage(e, "Không thể kích hoạt lộ trình"), "danger"),
  });
  const discard = useMutation({
    mutationFn: () => fitnessRoadmapService.archive(roadmap.id),
    onSuccess: () => {
      setConfirmDiscard(false);
      toast.show("Đã bỏ bản nháp", "success");
      onChanged();
    },
    onError: (e) => toast.show(roadmapErrorMessage(e, "Không thể bỏ bản nháp"), "danger"),
  });

  return (
    <View className="gap-4">
      <Card className="p-5">
        <View className="flex-row items-start justify-between gap-2">
          <View className="flex-1">
            <Badge tone="warning">Bản nháp lộ trình</Badge>
            <Text className="mt-2 font-display text-lg text-foreground">{roadmap.name}</Text>
            <Text className="font-body text-xs text-muted-foreground">
              {`${GOAL_OPTIONS.find((g) => g.key === roadmap.goalType)?.label ?? roadmap.goalType} · Dự kiến bắt đầu ${formatDate(roadmap.plannedStartAt)}`}
            </Text>
          </View>
          <Badge tone="info">{CREATOR_ROLE_LABEL[roadmap.createdByRole]}</Badge>
        </View>
        {aiMeta ? (
          <View className="mt-3 gap-1">
            <Text className="font-body text-sm text-foreground">{aiMeta.summary}</Text>
            <Text className="font-body text-xs text-muted-foreground">{aiMeta.reasoningSummary}</Text>
          </View>
        ) : null}
      </Card>

      {snapshot ? (
        <StrategyGroups result={snapshot} />
      ) : (
        <Card className="gap-3 p-4">
          {phases.map((p, i) => (
            <View key={p.id} className="flex-row items-center gap-3">
              <View className="h-7 w-7 items-center justify-center rounded-full bg-panel">
                <Text className="font-body-semibold text-xs text-primary">{i + 1}</Text>
              </View>
              <View className="flex-1">
                <Text className="font-body-semibold text-sm text-foreground">{`${p.name} · ${PHASE_TYPE_LABEL[p.phaseType]}`}</Text>
                <Text className="font-body text-xs text-muted-foreground">{`${formatDate(p.plannedStartAt)} → ${formatDate(p.plannedEndAt)}`}</Text>
              </View>
            </View>
          ))}
        </Card>
      )}

      {aiMeta?.warnings?.length ? (
        <Card className="gap-2 border-warning/40 bg-warning/5 p-4">
          {aiMeta.warnings.map((w, i) => (
            <View key={i} className="flex-row gap-2">
              <AlertTriangle size={14} color={designTokens.warning} />
              <Text className="flex-1 font-body text-xs text-foreground">{w}</Text>
            </View>
          ))}
        </Card>
      ) : null}
      {aiMeta?.assumptions?.length ? (
        <View className="px-1">
          <Text className="font-body-semibold text-xs text-muted-foreground">Giả định đã dùng:</Text>
          {aiMeta.assumptions.map((a, i) => (
            <Text key={i} className="font-body text-xs text-muted-foreground">{`• ${a}`}</Text>
          ))}
        </View>
      ) : null}

      <Card className="border-primary/30 bg-primary/5 p-4">
        <Text className="font-body text-xs text-muted-foreground">{ADAPTIVE_NOTE}</Text>
      </Card>

      <Button full size="lg" icon={ArrowRight} disabled={activate.isPending} onPress={() => activate.mutate()}>
        {activate.isPending ? "Đang bắt đầu…" : "Bắt đầu lộ trình"}
      </Button>
      <Button variant="ghost" full onPress={() => setConfirmDiscard(true)}>
        Bỏ bản nháp
      </Button>

      <BottomSheet open={confirmDiscard} onClose={() => setConfirmDiscard(false)} title="Bỏ bản nháp?">
        <Text className="mb-4 text-center font-body text-sm text-muted-foreground">Bản nháp lộ trình sẽ được cất đi. Bạn có thể tạo lộ trình mới bất cứ lúc nào.</Text>
        <Button variant="destructive" full size="lg" disabled={discard.isPending} onPress={() => discard.mutate()}>
          {discard.isPending ? "Đang bỏ…" : "Bỏ bản nháp"}
        </Button>
      </BottomSheet>
    </View>
  );
}

// ── ACTIVE ───────────────────────────────────────────────────────────────

function ActivePhase({
  data,
  phase,
  readiness,
  onAdvance,
  advancing,
  onRestart,
  restarting,
  onOpenCycle,
}: {
  data: FitnessRoadmapProjection;
  phase: RoadmapPhaseWithCycles;
  readiness: PhaseReadiness;
  onAdvance: () => void;
  advancing: boolean;
  onRestart: () => void;
  restarting: boolean;
  onOpenCycle?: () => void;
}) {
  const accent = useWorkspaceAccent();
  const [showOriginal, setShowOriginal] = useState(false);
  const config = data.roadmap.configuration as any;
  const snapshot = config?.roadmapProjectionSnapshot as RoadmapPhaseForecastResult | null | undefined;
  const diagnosis = config?.diagnosisSnapshot as FitnessDiagnosisResult | null | undefined;
  const cycle: any = phase.trainingCycles.find((c) => c.status === "ACTIVE");
  const goal = cycle?.nutritionGoals?.find((g: any) => g.status === "ACTIVE") ?? cycle?.nutritionGoals?.[0];
  const total = cycle?.schedules?.length ?? 0;
  const done = cycle?.schedules?.filter((s: any) => s.status === "COMPLETED").length ?? 0;
  const metrics: any = cycle?.latestAssessment?.computedMetrics ?? null;
  const weightTrend = trendLabel(metrics?.bodyWeightTrend, "kg");
  const original = snapshot?.phaseForecasts.find((f) => f.phaseIndex === phase.phaseIndex) ?? null;
  const tr = data.trainingReadiness;
  const nr = data.nutritionReadiness;

  const stats: [string, string][] = [];
  if (cycle) {
    stats.push(["Bắt đầu chu kỳ", formatDate(cycle.startDate)], ["Dự kiến kết thúc", formatDate(cycle.endDate)]);
    if (goal) stats.push(["Dinh dưỡng hiện tại", `${goal.calories} kcal · ${goal.protein}g đạm`]);
    if (total > 0) stats.push(["Buổi tập", `${done}/${total} hoàn thành`]);
    if (metrics?.hasScheduledSessions) stats.push(["Tuân thủ lịch tập", `${Math.round(metrics.adherenceRate * 100)}%`]);
    if (weightTrend) stats.push(["Xu hướng cân nặng", weightTrend]);
    if (metrics?.strengthProgressScore != null) stats.push(["Tiến bộ sức mạnh", `${Math.round(metrics.strengthProgressScore * 100)}%`]);
  }

  return (
    <Card className="gap-3 p-4">
      <View className="flex-row items-start justify-between gap-2">
        <View className="flex-1">
          <Text className="font-body text-[11px] text-muted-foreground">Giai đoạn hiện tại</Text>
          <Text className="font-display text-base text-foreground">{phase.name}</Text>
          <Text className="font-body text-xs text-muted-foreground">{PHASE_TYPE_LABEL[phase.phaseType]}</Text>
        </View>
        <Badge tone="success">{`Chu kỳ ${phase.progress.cycleCount}${phase.objective?.maxCycles ? ` / ${phase.objective.maxCycles}` : ""}`}</Badge>
      </View>

      {cycle ? (
        <>
          <View className="flex-row flex-wrap gap-2">
            {stats.map(([k, v]) => (
              <View key={k} className="w-[48%] rounded-xl bg-panel p-3">
                <Text className="font-body text-[10px] text-muted-foreground">{k}</Text>
                <Text className="font-body-semibold text-xs text-foreground">{v}</Text>
              </View>
            ))}
          </View>
          {goal && original && original.projectedCalories !== goal.calories ? (
            <Text className="font-body text-[11px] text-muted-foreground">
              {`Dự kiến ban đầu ~${original.projectedCalories.toLocaleString("vi-VN")} kcal/ngày — đã điều chỉnh theo dữ liệu thực tế.`}
            </Text>
          ) : null}
          {onOpenCycle ? (
            <Tappable className="flex-row items-center gap-1" onPress={onOpenCycle}>
              <Text className="font-body-semibold text-xs text-primary">Xem chi tiết chu kỳ</Text>
              <ArrowRight size={13} color={accent.primary} />
            </Tappable>
          ) : null}
          {tr?.status === "NEEDS_GENERATION" ? (
            <View className="gap-2 rounded-xl bg-warning/10 p-3">
              <Text className="font-body-semibold text-sm text-foreground">Chu kỳ mới đã sẵn sàng</Text>
              <Text className="font-body text-xs text-muted-foreground">Lịch tập cho chu kỳ mới chưa được tạo.</Text>
              {tr.lastAssessmentDecision ? (
                <Text className="font-body text-xs text-muted-foreground">
                  {`Đánh giá gần nhất: ${ASSESSMENT_DECISION_LABEL[tr.lastAssessmentDecision] ?? tr.lastAssessmentDecision}`}
                </Text>
              ) : null}
              <View className="flex-row flex-wrap gap-2">
                <Button size="sm" onPress={() => router.push("/client/plans")}>
                  Tạo lịch tập bằng AI
                </Button>
                {tr.canReuseLastProgram ? (
                  <Button size="sm" variant="secondary" onPress={() => router.push("/client/plans")}>
                    Dùng lại chương trình trước
                  </Button>
                ) : null}
              </View>
            </View>
          ) : tr?.status === "READY" ? (
            <Text className="font-body text-xs text-primary">✓ Lịch tập cho chu kỳ này đã sẵn sàng</Text>
          ) : null}
          {nr?.status === "NEEDS_GENERATION" ? (
            <View className="flex-row items-center justify-between gap-2 rounded-xl bg-panel p-3">
              <Text className="flex-1 font-body text-xs text-foreground">Chưa có mục tiêu dinh dưỡng</Text>
              <Button size="sm" variant="secondary" onPress={() => router.push("/client/workout/nutrition/goals")}>
                Thiết lập dinh dưỡng
              </Button>
            </View>
          ) : null}
        </>
      ) : readiness.kind === "ANALYZING" ? (
        <View className="flex-row items-center gap-2">
          <ActivityIndicator color={accent.primary} />
          <Text className="font-body text-xs text-muted-foreground">Đang đánh giá chu kỳ vừa hoàn thành…</Text>
        </View>
      ) : readiness.kind === "INSUFFICIENT_DATA" ? (
        <View className="rounded-xl bg-warning/10 p-3">
          <Text className="font-body-semibold text-sm text-foreground">Chu kỳ vừa qua chưa đủ dữ liệu để đánh giá</Text>
          <Text className="font-body text-xs text-muted-foreground">
            Có thể do chu kỳ kết thúc quá sớm hoặc quá ít buổi tập được hoàn thành. Hãy tiếp tục lịch tập — Gymini sẽ đánh giá lại khi có đủ dữ liệu.
          </Text>
        </View>
      ) : readiness.kind === "CYCLE_CANCELLED" ? (
        <View className="gap-2 rounded-xl bg-panel p-3">
          <Text className="font-body-semibold text-sm text-foreground">Chu kỳ trước của giai đoạn này đã bị huỷ</Text>
          <Text className="font-body text-xs text-muted-foreground">Bắt đầu một chu kỳ mới để tiếp tục giai đoạn này.</Text>
          <Button size="sm" icon={ArrowRight} disabled={restarting} onPress={onRestart}>
            Bắt đầu chu kỳ mới
          </Button>
        </View>
      ) : readiness.kind === "PENDING_REBUILD" ? (
        <Text className="font-body text-xs text-muted-foreground">Gymini đã có đề xuất điều chỉnh lộ trình phía trên — xem và áp dụng để tiếp tục.</Text>
      ) : readiness.kind === "READY_TO_ADVANCE" ? (
        <View className="gap-2 rounded-xl bg-primary/10 p-3">
          <Text className="font-body text-xs text-foreground">
            {`Chu kỳ trước đã được đánh giá (${ASSESSMENT_DECISION_LABEL[readiness.lastDecision] ?? readiness.lastDecision}) — sẵn sàng chuyển tiếp.`}
          </Text>
          <Button size="sm" icon={ArrowRight} disabled={advancing} onPress={onAdvance}>
            {advancing ? "Đang kiểm tra…" : "Kiểm tra tiến độ"}
          </Button>
        </View>
      ) : (
        <Text className="font-body text-xs text-muted-foreground">Giai đoạn này chưa có chu kỳ tập nào đang diễn ra.</Text>
      )}

      {original || diagnosis ? (
        <View>
          <Tappable className="flex-row items-center gap-1" onPress={() => setShowOriginal((v) => !v)}>
            {showOriginal ? <ChevronDown size={14} color="#8b9299" /> : <ChevronRight size={14} color="#8b9299" />}
            <Text className="font-body-semibold text-xs text-muted-foreground">Xem chẩn đoán & báo cáo lộ trình ban đầu</Text>
          </Tappable>
          {showOriginal ? (
            <View className="mt-2 gap-2">
              {diagnosis?.energyBreakdown ? <EnergyBreakdownCard breakdown={diagnosis.energyBreakdown} /> : null}
              {diagnosis?.reasoning ? (
                <View className="rounded-xl bg-panel p-3">
                  <Text className="font-body-semibold text-xs text-muted-foreground">Nhận định lộ trình</Text>
                  <Text className="font-body text-xs text-foreground">{diagnosis.reasoning}</Text>
                </View>
              ) : null}
              {original ? <PhaseForecastCard forecast={original} /> : null}
            </View>
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}

function PendingRebuild({
  roadmapId,
  assessmentId,
  currentPhaseId,
  phases,
  onApplied,
}: {
  roadmapId: string;
  assessmentId: string;
  currentPhaseId: string;
  phases: RoadmapPhaseWithCycles[];
  onApplied: () => void;
}) {
  const toast = useToast();
  const accent = useWorkspaceAccent();
  const [open, setOpen] = useState(false);
  const preview = useQuery({
    queryKey: [...ROADMAP_KEY, "rebuild-preview", roadmapId, assessmentId],
    queryFn: () => fitnessRoadmapService.previewRebuild(roadmapId),
    enabled: open,
    retry: false,
  });
  const apply = useMutation({
    mutationFn: () => fitnessRoadmapService.applyRebuild(roadmapId, { assessmentId }),
    onSuccess: () => {
      toast.show("Đã cập nhật lại lộ trình phía trước", "success");
      onApplied();
    },
    onError: (e) => toast.show(roadmapErrorMessage(e, "Không thể cập nhật lộ trình"), "danger"),
  });
  const idx = phases.findIndex((p) => p.id === currentPhaseId);
  const affected = idx >= 0 ? phases.slice(idx) : [];

  return (
    <Card className="gap-3 border-warning/40 bg-warning/5 p-4">
      <View className="flex-row gap-2">
        <AlertTriangle size={16} color={designTokens.warning} />
        <View className="flex-1">
          <Text className="font-body-semibold text-sm text-foreground">Gymini gợi ý xây dựng lại phần còn lại của lộ trình</Text>
          <Text className="font-body text-xs text-muted-foreground">
            Dựa trên đánh giá chu kỳ gần nhất, các giai đoạn phía trước cần điều chỉnh. Lịch sử tập luyện, dinh dưỡng và đánh giá không bị xoá — chỉ các giai đoạn CHƯA diễn ra được thay thế.
          </Text>
        </View>
      </View>
      {!open ? (
        <Button size="sm" variant="secondary" onPress={() => setOpen(true)}>
          Xem đề xuất
        </Button>
      ) : preview.isLoading ? (
        <ActivityIndicator color={accent.primary} />
      ) : preview.data ? (
        <View className="gap-2">
          <Text className="font-body-semibold text-xs text-muted-foreground">Hiện tại</Text>
          {affected.map((p, i) => (
            <View key={p.id} className="rounded-lg bg-panel p-2.5">
              <Text className="font-body-semibold text-xs text-foreground">{`${p.name} · ${PHASE_TYPE_LABEL[p.phaseType]}`}</Text>
              <Text className="font-body text-[11px] text-muted-foreground">{i === 0 ? "Sẽ đánh dấu hoàn thành" : "Sẽ bị bỏ qua (thay bằng đề xuất mới)"}</Text>
            </View>
          ))}
          <Text className="mt-1 font-body-semibold text-xs text-primary">Đề xuất mới</Text>
          {preview.data.proposedPhases.map((p, i) => (
            <View key={i} className="rounded-lg bg-primary/10 p-2.5">
              <Text className="font-body-semibold text-xs text-foreground">{`${p.name} · ${PHASE_TYPE_LABEL[p.phaseType]}`}</Text>
              <Text className="font-body text-[11px] text-muted-foreground">{`${formatDate(p.plannedStartAt)} → ${formatDate(p.plannedEndAt)}`}</Text>
            </View>
          ))}
          <Button size="sm" disabled={apply.isPending} onPress={() => apply.mutate()}>
            {apply.isPending ? "Đang áp dụng…" : "Áp dụng đề xuất này"}
          </Button>
        </View>
      ) : (
        <Text className="font-body text-xs text-destructive">{roadmapErrorMessage(preview.error, "Không tải được đề xuất.")}</Text>
      )}
    </Card>
  );
}

function AdaptiveForecast({ roadmapId }: { roadmapId: string }) {
  const accent = useWorkspaceAccent();
  const [showOriginal, setShowOriginal] = useState(false);
  const q = useQuery({
    queryKey: [...ROADMAP_KEY, "current-forecast", roadmapId],
    queryFn: fitnessRoadmapService.getCurrentForecast,
    retry: false,
  });
  if (q.isLoading) return <ActivityIndicator color={accent.primary} />;
  if (!q.data) return null;
  const { originalForecast, currentForecast, reconciliations, changeExplanation } = q.data as CurrentForecastResult;
  const latest = reconciliations[reconciliations.length - 1] ?? null;
  const near = currentForecast?.phaseForecasts[0] ?? null;
  if (!latest && !near && !originalForecast) return null;

  return (
    <Card className="gap-3 p-4">
      {latest ? (
        <View className="gap-2">
          <Text className="font-body-semibold text-sm text-foreground">Chu kỳ vừa qua</Text>
          <View className="flex-row gap-2">
            {[
              ["Dự kiến", latest.weight ? `${latest.weight.expected} kg` : "—"],
              ["Thực tế", latest.weight ? `${latest.weight.actual} kg` : "Chưa đủ dữ liệu"],
              ["Chênh lệch", latest.weight ? `${latest.weight.delta > 0 ? "+" : ""}${latest.weight.delta} kg` : "—"],
            ].map(([k, v]) => (
              <View key={k} className="flex-1 rounded-xl bg-panel p-2.5">
                <Text className="font-body text-[10px] text-muted-foreground">{k}</Text>
                <Text className="font-body-semibold text-xs text-foreground">{v}</Text>
              </View>
            ))}
          </View>
          {latest.adherenceRate != null || latest.strengthProgressScore != null ? (
            <Text className="font-body text-xs text-muted-foreground">
              {[
                latest.adherenceRate != null ? `Tuân thủ: ${Math.round(latest.adherenceRate * 100)}%` : null,
                latest.strengthProgressScore != null
                  ? `Sức mạnh: ${latest.strengthProgressScore >= 0 ? "+" : ""}${Math.round(latest.strengthProgressScore * 100)}%`
                  : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </Text>
          ) : null}
          <Text className="font-body-semibold text-xs text-primary">{`Gymini: ${RECONCILIATION_STATUS_LABEL[latest.status] ?? latest.status}`}</Text>
        </View>
      ) : null}
      {near ? (
        <View className="gap-1">
          <Text className="font-body-semibold text-sm text-foreground">Dự báo đã cập nhật</Text>
          <Text className="font-body text-xs text-foreground">
            {`Khoảng dự báo tham khảo: ${near.projectedEndWeightRangeKg.low}–${near.projectedEndWeightRangeKg.high} kg (kỳ vọng ~${near.projectedEndWeightRangeKg.expected} kg)`}
          </Text>
          <Text className="font-body text-xs text-muted-foreground">{`Độ tin cậy dữ liệu cho dự báo: ${CONFIDENCE_TIER_LABEL[near.confidence.tier] ?? near.confidence.tier}`}</Text>
          {changeExplanation ? <Text className="font-body text-xs text-muted-foreground">{changeExplanation}</Text> : null}
          <Text className="font-body text-[11px] italic text-muted-foreground">Đây là dự báo, không phải cam kết kết quả.</Text>
        </View>
      ) : null}
      {originalForecast ? (
        <View>
          <Tappable className="flex-row items-center gap-1" onPress={() => setShowOriginal((v) => !v)}>
            {showOriginal ? <ChevronDown size={14} color="#8b9299" /> : <ChevronRight size={14} color="#8b9299" />}
            <Text className="font-body-semibold text-xs text-muted-foreground">{showOriginal ? "Ẩn dự kiến ban đầu" : "Xem dự kiến ban đầu"}</Text>
          </Tappable>
          {showOriginal ? (
            <View className="mt-2">
              <StrategyGroups result={originalForecast} />
            </View>
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}

function CompletedSummary({ data }: { data: FitnessRoadmapProjection }) {
  const accent = useWorkspaceAccent();
  const s = data.finalSummary;
  const [showOriginal, setShowOriginal] = useState(false);
  const snapshot = (data.roadmap.configuration as any)?.roadmapProjectionSnapshot as RoadmapPhaseForecastResult | undefined;
  const kg = (w: number | null, bf: number | null) => (w != null ? `${w} kg${bf != null ? ` · ${bf}% mỡ` : ""}` : "Không đủ dữ liệu");
  const rows: [string, string][] = s
    ? [
        ["Bắt đầu", kg(s.startWeightKg, s.startBodyFatPct)],
        ["Dự kiến ban đầu", kg(s.originalProjectedEndWeightKg, s.originalProjectedEndBodyFatPct)],
        ["Kết quả thực tế", kg(s.actualFinalWeightKg, s.actualFinalBodyFatPct)],
        ...(s.totalWeeks != null ? ([["Thời gian", `${s.totalWeeks} tuần`]] as [string, string][]) : []),
        ["Giai đoạn", `${s.completedPhaseCount}/${s.totalPhaseCount} hoàn thành`],
        ["Chu kỳ", `${s.cycleCount} chu kỳ`],
        ...(s.rebuildCount > 0 ? ([["Điều chỉnh chiến lược", `${s.rebuildCount} lần`]] as [string, string][]) : []),
      ]
    : [];
  return (
    <Card className="gap-3 p-4">
      <View className="flex-row items-center gap-2">
        <Trophy size={18} color={accent.primary} />
        <Text className="font-display text-base text-foreground">Hoàn thành lộ trình</Text>
      </View>
      {s ? (
        <View className="flex-row flex-wrap gap-2">
          {rows.map(([k, v]) => (
            <View key={k} className="w-[48%] rounded-xl bg-panel p-2.5">
              <Text className="font-body text-[10px] text-muted-foreground">{k}</Text>
              <Text className="font-body-semibold text-xs text-foreground">{v}</Text>
            </View>
          ))}
        </View>
      ) : (
        <Text className="font-body text-xs text-muted-foreground">Không đủ dữ liệu để tổng kết chi tiết lộ trình này.</Text>
      )}
      {snapshot ? (
        <View>
          <Tappable onPress={() => setShowOriginal((v) => !v)}>
            <Text className="font-body-semibold text-xs text-primary">{showOriginal ? "Ẩn lộ trình ban đầu" : "Xem lộ trình ban đầu"}</Text>
          </Tappable>
          {showOriginal ? (
            <View className="mt-2">
              <StrategyGroups result={snapshot} />
            </View>
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}
