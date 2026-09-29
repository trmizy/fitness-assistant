import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Animated, { FadeInRight, FadeOutLeft, ZoomIn } from "react-native-reanimated";
import {
  AlertTriangle,
  CalendarDays,
  Check,
  Dumbbell,
  Info,
  Loader,
  RotateCcw,
  Sparkles,
  Target,
  Wand2,
} from "lucide-react-native";

import { Badge, Button, Card, Input, ProgressRing, ScreenHeader, useToast } from "../../../src/components/ui";
import { equipmentService, planService, type PlanStatusBackend } from "../../../src/services/api";
import { useApp } from "../../../src/context/AppContext";
import { useWorkspaceAccent } from "../../../src/theme/workspace";
import { chartSeries, darkColors } from "../../../src/theme/colors";
import {
  apiErrorMessage,
  DEFAULT_GOAL,
  EQUIPMENT_OPTIONS,
  friendlyPlanFailReason,
  GOAL_PRESETS,
  JOB_PHASES,
  jobProgress,
  LLM_NOT_READY_MESSAGE,
  LOCATION_OPTIONS,
  parseAdjustInput,
  QUERY_GOAL_LABELS,
  validateGenerate,
  type EquipmentPreference,
  type TrainingLocation,
} from "../../../src/features/plans/aiPlans";
import { Chip, FieldLabel, OptionCard, Stepper, TextArea } from "../../../src/features/plans/PlanWidgets";
import { planQueryKey } from "../../../src/features/plans/AiPlansTab";

type Phase = "form" | "running" | "done" | "error";
const ADJUST_CHIPS = ["Tăng cường độ", "Giảm khối lượng chân", "Thêm cardio", "Ít thời gian hơn"];
const STEPS = [
  { icon: Target, label: "Mục tiêu" },
  { icon: CalendarDays, label: "Lịch tập" },
  { icon: Dumbbell, label: "Thiết bị" },
];

/**
 * CL-23 — the design's `AIPlanWizard` (3-step create, or adjust), carrying exactly the inputs the
 * server takes: goal, durationWeeks 1-52, daysPerWeek 1-7, exercisesPerDay 1-8, trainingLocation,
 * equipmentPreference (web's AIPlansPage form). The design's "thời lượng buổi", "trình độ" and
 * "chấn thương" chips have no field in `/plans/workout/generate` — level and injuries come from the
 * profile server-side — so they are not drawn rather than collected and silently dropped.
 *
 * The running view follows the REAL job (`GET /plans/job/:id`): the server reports QUEUED →
 * PROCESSING → COMPLETED/FAILED with no percentage, so the ring moves with elapsed time but only
 * reaches 100% when the server says COMPLETED. Leaving mid-run is safe — the job keeps going and
 * the plan list polls it.
 */
export default function PlanWizardScreen() {
  const insets = useSafeAreaInsets();
  const accent = useWorkspaceAccent();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { user } = useApp();
  const params = useLocalSearchParams<{ mode?: string; planId?: string; goal?: string }>();
  const mode = params.mode === "adjust" ? "adjust" : "create";
  const adjustPlanId = typeof params.planId === "string" ? params.planId : null;

  const [step, setStep] = useState(1);
  const [phase, setPhase] = useState<Phase>("form");
  const [goal, setGoal] = useState(() => {
    const q = typeof params.goal === "string" ? params.goal : "";
    return q ? QUERY_GOAL_LABELS[q] ?? q : DEFAULT_GOAL;
  });
  const [durationWeeks, setDurationWeeks] = useState(8);
  const [daysPerWeek, setDaysPerWeek] = useState(4);
  const [exercisesPerDay, setExercisesPerDay] = useState(4);
  const [location, setLocation] = useState<TrainingLocation>("GYM");
  const [equipment, setEquipment] = useState<EquipmentPreference>("MIXED_GYM");
  const [adjustNote, setAdjustNote] = useState("");
  const [adjustDays, setAdjustDays] = useState<number | null>(null);
  const [adjustExercises, setAdjustExercises] = useState<number | null>(null);

  const [job, setJob] = useState<{ jobId: string; planId: string; status: PlanStatusBackend } | null>(null);
  const [startedAt, setStartedAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const lastRun = useRef<(() => void) | null>(null);

  const equipmentQuery = useQuery({ queryKey: ["equipment", "mine"], queryFn: () => equipmentService.getMyEquipment() });
  const hasGranularEquipment = (equipmentQuery.data?.length ?? 0) > 0;
  const healthQuery = useQuery({ queryKey: ["ai-plans", "llm-health"], queryFn: () => planService.getLlmHealth(), retry: false });
  const adjustPlanQuery = useQuery({
    queryKey: ["ai-plan", adjustPlanId],
    queryFn: () => planService.getPlanById(adjustPlanId!),
    enabled: mode === "adjust" && !!adjustPlanId,
  });

  // Poll the real job while it runs; a 1s tick only animates the ring between polls. The view is
  // DERIVED from the latest job status (no state copied out of the query), and polling stops once
  // the server reports a terminal status.
  const jobQuery = useQuery({
    queryKey: ["ai-plan-job", job?.jobId],
    queryFn: () => planService.getJobStatus(job!.jobId),
    enabled: phase === "running" && !!job,
    refetchInterval: (q) => {
      const st = (q.state.data as { status?: PlanStatusBackend } | undefined)?.status;
      return st === "COMPLETED" || st === "FAILED" ? false : 3000;
    },
  });
  const jobStatus: PlanStatusBackend | null = jobQuery.data?.status ?? job?.status ?? null;
  const failReason = jobQuery.data?.failReason ?? null;
  const view: Phase =
    phase === "running" && jobStatus === "COMPLETED" ? "done" : phase === "running" && jobStatus === "FAILED" ? "error" : phase;

  useEffect(() => {
    if (view !== "running") return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [view]);
  // A finished job changes the plan list — refresh it (a cache side effect only, no local state).
  useEffect(() => {
    if (view === "done" || view === "error") void queryClient.invalidateQueries({ queryKey: planQueryKey(user?.id) });
  }, [view, queryClient, user?.id]);

  const onStarted = (res: { jobId: string; planId: string; status: PlanStatusBackend }) => {
    setJob({ jobId: res.jobId, planId: res.planId, status: res.status });
    setStartedAt(Date.now());
    setNow(Date.now());
    setPhase("running");
    void queryClient.invalidateQueries({ queryKey: planQueryKey(user?.id) });
  };

  const generateMutation = useMutation({
    mutationFn: () =>
      planService.generateWorkoutPlan({
        goal: goal.trim(),
        durationWeeks,
        daysPerWeek,
        exercisesPerDay,
        trainingLocation: location,
        equipmentPreference: equipment,
      }),
    onSuccess: onStarted,
    onError: (e) => toast.show(apiErrorMessage(e, "Không thể tạo kế hoạch AI"), "danger"),
  });

  const adjustMutation = useMutation({
    mutationFn: (body: { adjustments: string; daysPerWeek?: number; exercisesPerDay?: number }) =>
      planService.adjustPlan(adjustPlanId!, body.adjustments, body.daysPerWeek, body.exercisesPerDay),
    onSuccess: onStarted,
    onError: (e) => toast.show(apiErrorMessage(e, "Không thể điều chỉnh kế hoạch"), "danger"),
  });

  const ensureLlmReady = async () => {
    const health = await healthQuery.refetch();
    if (health.isError || !health.data?.llmAvailable) {
      toast.show(LLM_NOT_READY_MESSAGE, "danger");
      return false;
    }
    return true;
  };

  const runCreate = async () => {
    const error = validateGenerate({ goal, durationWeeks, daysPerWeek, exercisesPerDay });
    if (error) {
      toast.show(error, "danger");
      return;
    }
    if (!(await ensureLlmReady())) return;
    lastRun.current = () => void runCreate();
    generateMutation.mutate();
  };

  const runAdjust = async () => {
    if (!adjustPlanId) return;
    const parsed = parseAdjustInput({
      adjustments: adjustNote,
      daysPerWeek: adjustDays == null ? "" : String(adjustDays),
      exercisesPerDay: adjustExercises == null ? "" : String(adjustExercises),
    });
    if (!parsed.ok) {
      toast.show(parsed.error, "danger");
      return;
    }
    if (!(await ensureLlmReady())) return;
    lastRun.current = () => void runAdjust();
    adjustMutation.mutate(parsed);
  };

  const title = mode === "adjust" ? "Điều chỉnh giáo án" : "Tạo giáo án AI";
  const back = () => (router.canGoBack() ? router.back() : router.replace("/client/plans"));
  const busy = generateMutation.isPending || adjustMutation.isPending;

  const bottomBar = (children: React.ReactNode) => (
    <View className="border-t border-border bg-glass px-5 pt-3" style={{ paddingBottom: insets.bottom + 12 }}>
      {children}
    </View>
  );

  // ── Running ──
  if (view === "running") {
    const { progress, activePhase } = jobProgress(jobStatus, now - startedAt);
    return (
      <View className="flex-1 bg-background">
        <ScreenHeader title={title} onBack={back} />
        <ScrollView contentContainerStyle={{ alignItems: "center", paddingHorizontal: 20, paddingTop: 40, paddingBottom: 24 }}>
          <Badge tone="info">
            <Loader size={12} color={chartSeries[2]} />
            <Text className="font-body-semibold text-xs text-chart-3">
              {jobStatus === "QUEUED" ? "Đang xếp hàng" : "Đang chạy"}
            </Text>
          </Badge>
          <View className="mt-8">
            <ProgressRing progress={progress} size={140} stroke={12}>
              <Text className="font-display text-3xl text-foreground">{`${Math.round(progress * 100)}%`}</Text>
            </ProgressRing>
          </View>
          <Text className="mt-8 font-display text-lg text-foreground">AI đang soạn giáo án…</Text>
          <View className="mt-6 w-full gap-2">
            {JOB_PHASES.map((p, i) => {
              const state = i < activePhase ? "done" : i === activePhase ? "active" : "idle";
              return (
                <View key={p} className="flex-row items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
                  <View
                    className={`h-6 w-6 items-center justify-center rounded-full ${state === "done" ? "bg-primary" : state === "active" ? "bg-primary/15" : "bg-panel"}`}
                  >
                    {state === "done" ? (
                      <Check size={14} strokeWidth={3} color={accent.onPrimary} />
                    ) : state === "active" ? (
                      <ActivityIndicator size="small" color={accent.primary} />
                    ) : (
                      <Text className="font-body-semibold text-xs text-muted-foreground">{i + 1}</Text>
                    )}
                  </View>
                  <Text className={`font-body-semibold text-sm ${state === "idle" ? "text-muted-foreground" : "text-foreground"}`}>{p}</Text>
                </View>
              );
            })}
          </View>
          <Text className="mt-6 text-center font-body text-xs text-muted-foreground">
            Việc này có thể mất vài phút. Bạn có thể rời màn này — kế hoạch vẫn tiếp tục được tạo và hiện trong danh sách khi xong.
          </Text>
        </ScrollView>
        {bottomBar(
          <Button full variant="secondary" onPress={() => router.replace("/client/plans")}>
            Để AI chạy nền
          </Button>,
        )}
      </View>
    );
  }

  // ── Error ──
  if (view === "error") {
    return (
      <View className="flex-1 bg-background">
        <ScreenHeader title={title} onBack={back} />
        <View className="flex-1 items-center px-5 pt-16">
          <View className="h-24 w-24 items-center justify-center rounded-full bg-destructive/15">
            <AlertTriangle size={44} color={darkColors.destructive} />
          </View>
          <Text className="mt-6 font-display text-xl text-foreground">Tạo giáo án thất bại</Text>
          <Text className="mt-2 text-center font-body text-sm text-muted-foreground">{friendlyPlanFailReason(failReason)}</Text>
        </View>
        {bottomBar(
          <Button full size="lg" icon={RotateCcw} disabled={busy} onPress={() => lastRun.current?.()}>
            Thử lại
          </Button>,
        )}
      </View>
    );
  }

  // ── Done ──
  if (view === "done") {
    return (
      <View className="flex-1 bg-background">
        <ScreenHeader title={title} onBack={back} />
        <View className="flex-1 items-center px-5 pt-16">
          <Animated.View entering={ZoomIn.springify().stiffness(300).damping(16)} className="h-24 w-24 items-center justify-center rounded-full bg-primary">
            <Check size={48} strokeWidth={3} color={accent.onPrimary} />
          </Animated.View>
          <Text className="mt-6 font-display text-xl text-foreground">Giáo án đã sẵn sàng</Text>
          <Text className="mt-2 text-center font-body text-sm text-muted-foreground">
            {mode === "adjust"
              ? "AI đã tạo phiên bản mới theo yêu cầu của bạn."
              : `Mục tiêu ${goal.trim()} · ${daysPerWeek} buổi/tuần · ${durationWeeks} tuần`}
          </Text>
        </View>
        {bottomBar(
          <Button
            full
            size="lg"
            icon={Sparkles}
            onPress={() => job && router.replace(`/client/plans/ai/${job.planId}`)}
          >
            Xem giáo án
          </Button>,
        )}
      </View>
    );
  }

  // ── Adjust form ──
  if (mode === "adjust") {
    const plan = adjustPlanQuery.data;
    return (
      <View className="flex-1 bg-background">
        <ScreenHeader title={title} onBack={back} />
        <ScrollView contentContainerStyle={{ padding: 20, gap: 20 }} keyboardShouldPersistTaps="handled">
          <Card className="flex-row items-start gap-3 border-primary/30 bg-primary/5 p-4">
            <Wand2 size={18} color={accent.primary} />
            <Text className="flex-1 font-body text-sm text-muted-foreground">
              {`Mô tả điều bạn muốn thay đổi — AI tạo phiên bản mới${plan?.name ? ` của "${plan.name}"` : ""}, phần còn lại giữ nguyên.`}
            </Text>
          </Card>
          <View>
            <Text className="mb-2 font-display text-base text-foreground">Bạn muốn điều chỉnh gì?</Text>
            <TextArea
              value={adjustNote}
              onChangeText={setAdjustNote}
              placeholder="VD: tăng bài chân, giảm cardio, ưu tiên ngực vai tay sau…"
            />
          </View>
          <View>
            <FieldLabel>Gợi ý nhanh</FieldLabel>
            <View className="flex-row flex-wrap gap-2">
              {ADJUST_CHIPS.map((c) => (
                <Chip
                  key={c}
                  label={c}
                  active={adjustNote.includes(c)}
                  onPress={() => setAdjustNote((s) => (s.includes(c) ? s : (s ? `${s} · ` : "") + c))}
                />
              ))}
            </View>
          </View>
          <View>
            <FieldLabel>Số buổi mỗi tuần (không bắt buộc)</FieldLabel>
            <View className="flex-row flex-wrap gap-2">
              <Chip label="Giữ nguyên" active={adjustDays == null} onPress={() => setAdjustDays(null)} />
              {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                <Chip key={d} label={`${d}`} active={adjustDays === d} onPress={() => setAdjustDays(d)} />
              ))}
            </View>
          </View>
          <View>
            <FieldLabel>Số bài mỗi buổi (không bắt buộc)</FieldLabel>
            <View className="flex-row flex-wrap gap-2">
              <Chip label="Giữ nguyên" active={adjustExercises == null} onPress={() => setAdjustExercises(null)} />
              {[1, 2, 3, 4, 5, 6, 7, 8].map((d) => (
                <Chip key={d} label={`${d}`} active={adjustExercises === d} onPress={() => setAdjustExercises(d)} />
              ))}
            </View>
          </View>
        </ScrollView>
        {bottomBar(
          <Button full size="lg" icon={Wand2} disabled={!adjustNote.trim() || busy || !adjustPlanId} onPress={() => void runAdjust()}>
            {busy ? "Đang gửi…" : "Áp dụng điều chỉnh"}
          </Button>,
        )}
      </View>
    );
  }

  // ── Create wizard ──
  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title={title} onBack={step === 1 ? back : () => setStep((s) => s - 1)} />
      <View className="flex-row gap-2 px-5 pt-4">
        {STEPS.map((m, i) => {
          const n = i + 1;
          const lit = n <= step;
          return (
            <View key={m.label} className="flex-1 items-center gap-1.5">
              <View className={`h-1.5 w-full rounded-full ${lit ? "bg-primary" : "bg-panel"}`} />
              <Text className={`font-body-semibold text-xs ${lit ? "text-primary" : "text-muted-foreground"}`}>{m.label}</Text>
            </View>
          );
        })}
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
        <Animated.View key={step} entering={FadeInRight.duration(200)} exiting={FadeOutLeft.duration(200)} className="px-5 pt-6">
          {step === 1 ? (
            <View className="gap-4">
              <Text className="font-display text-xl text-foreground">Mục tiêu của bạn là gì?</Text>
              <View className="flex-row flex-wrap gap-2">
                {GOAL_PRESETS.map((g) => (
                  <Chip key={g} label={g} active={goal === g} onPress={() => setGoal(g)} />
                ))}
              </View>
              <Input label="Hoặc tự mô tả mục tiêu" value={goal} onChangeText={setGoal} placeholder="VD: giảm mỡ bụng, tăng sức bền chạy bộ" />
            </View>
          ) : step === 2 ? (
            <View className="gap-6">
              <View>
                <Text className="font-display text-xl text-foreground">Số buổi mỗi tuần</Text>
                <View className="mt-3 flex-row flex-wrap gap-2">
                  {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                    <Chip key={d} label={`${d} buổi`} active={daysPerWeek === d} onPress={() => setDaysPerWeek(d)} />
                  ))}
                </View>
              </View>
              <View>
                <Text className="font-display text-base text-foreground">Kéo dài bao lâu</Text>
                <View className="mt-3">
                  <Stepper value={durationWeeks} min={1} max={52} onChange={setDurationWeeks} suffix="tuần" />
                </View>
              </View>
              <View>
                <Text className="font-display text-base text-foreground">Số bài mỗi buổi</Text>
                <View className="mt-3">
                  <Stepper value={exercisesPerDay} min={1} max={8} onChange={setExercisesPerDay} suffix="bài" />
                </View>
              </View>
            </View>
          ) : (
            <View className="gap-6">
              <View>
                <Text className="font-display text-xl text-foreground">Bạn tập ở đâu?</Text>
                <View className="mt-3 flex-row gap-2">
                  {LOCATION_OPTIONS.map((o) => (
                    <OptionCard key={o.value} label={o.label} desc={o.desc} active={location === o.value} onPress={() => setLocation(o.value)} />
                  ))}
                </View>
              </View>
              {location === "GYM" ? (
                <View>
                  <Text className="font-display text-base text-foreground">Nguồn thiết bị</Text>
                  <View className="mt-3 flex-row gap-2">
                    {EQUIPMENT_OPTIONS.map((o) => (
                      <OptionCard key={o.value} label={o.label} desc={o.desc} active={equipment === o.value} onPress={() => setEquipment(o.value)} />
                    ))}
                  </View>
                </View>
              ) : null}
              {hasGranularEquipment ? (
                <Card className="flex-row items-start gap-3 p-4">
                  <Info size={16} color={accent.primary} />
                  <Text className="flex-1 font-body text-xs text-muted-foreground">
                    Bạn đã lưu danh sách thiết bị chi tiết — AI sẽ ưu tiên dùng đúng danh sách đó thay cho lựa chọn chung ở trên.
                  </Text>
                </Card>
              ) : null}
            </View>
          )}
        </Animated.View>
      </ScrollView>

      {bottomBar(
        step < STEPS.length ? (
          <Button full size="lg" disabled={step === 1 && !goal.trim()} onPress={() => setStep((s) => s + 1)}>
            Tiếp tục
          </Button>
        ) : (
          <Button full size="lg" icon={Sparkles} disabled={busy} onPress={() => void runCreate()}>
            {busy ? "Đang gửi…" : "Tạo giáo án"}
          </Button>
        ),
      )}
    </View>
  );
}
