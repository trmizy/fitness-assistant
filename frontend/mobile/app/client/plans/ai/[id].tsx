import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Linking, ScrollView, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Dumbbell,
  Info,
  RotateCcw,
  Sparkles,
  Wand2,
} from "lucide-react-native";

import { Badge, BottomSheet, Button, Card, EmptyState, Input, ScreenHeader, Tappable, useToast } from "../../../../src/components/ui";
import { planService, workoutService, type PlanExplanationResponse } from "../../../../src/services/api";
import { useApp } from "../../../../src/context/AppContext";
import { useWorkspaceAccent } from "../../../../src/theme/workspace";
import { designTokens } from "../../../../src/theme/colors";
import {
  apiErrorMessage,
  countInvalidExerciseIds,
  extractPlanWarnings,
  formatEvidenceSourceType,
  friendlyPlanFailReason,
  getPlanEvidence,
  hasValidExerciseId,
  isPending,
  isSafeHttpUrl,
  LLM_NOT_READY_MESSAGE,
  locationLabel,
  localizeDayGoal,
  localizePlanNote,
  parseRepeatWeeks,
  planExerciseIds,
  planLocation,
  replacesOtherProgram,
  retryPayload,
  saveDaysPerWeek,
  statusLabel,
  statusTone,
  suggestedWeekdays,
  toExerciseList,
  toggleWeekday,
  toPlanContent,
  toWeeklySchedule,
  WEEKDAY_LABEL_BY_VALUE,
  WEEKDAY_OPTIONS,
} from "../../../../src/features/plans/aiPlans";
import { FieldLabel, OptionCard, StartDateStrip, WeekdayPicker } from "../../../../src/features/plans/PlanWidgets";
import { formatPlanDate, planQueryKey } from "../../../../src/features/plans/AiPlansTab";
import { toDateInputValue } from "../../../../src/utils/date";
import { planReviewApi } from "../../../../src/features/planReview/planReviewApi";
import { AiRevisionSheet } from "../../../../src/features/planRevision/AiRevisionSheet";
import { PlanSyncCard } from "../../../../src/features/planRevision/PlanSyncCard";
import {
  canRevertPlan,
  deriveSyncState,
  mapRevertError,
  PT_OUTDATED_HINT,
  REVERT_CONFIRM,
  saveOutcomeFrom,
  saveSheetTitles,
  showPtOutdatedHint,
  type SyncActionId,
} from "../../../../src/features/planRevision/planRevision";

type SaveOutcome = {
  /** Which plan version this save was made for: a later revision / undo makes the banner stale (K9). */
  planVersion: number;
  message: string;
  createdScheduleCount: number;
  selectedWeekdays?: number[];
};

/**
 * CL-18 — one AI workout plan (web's AIPlansPage right-hand panel): stats, AI warnings and the
 * "why the AI adjusted" evidence, explain / adjust / save-to-log / hide, then the weekly schedule
 * with muscle group + equipment resolved from the exercise catalog (plan content stores only ids),
 * and progression / recovery / nutrition notes.
 *
 * Explanation: web streams tokens over SSE; RN's fetch has no streaming body, so this calls the
 * non-streaming `POST /plans/explain` — the same endpoint web itself falls back to.
 */
export default function AiPlanDetailScreen() {
  const accent = useWorkspaceAccent();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { user } = useApp();
  const { id } = useLocalSearchParams<{ id: string }>();
  const planId = String(id ?? "");

  const [expandedDay, setExpandedDay] = useState<string | null>(null);
  const [showEvidence, setShowEvidence] = useState(false);
  const [explanation, setExplanation] = useState<PlanExplanationResponse | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [confirmReplace, setConfirmReplace] = useState<string | null>(null);
  const [startDate, setStartDate] = useState(() => toDateInputValue(new Date()));
  const [repeatWeeks, setRepeatWeeks] = useState("");
  const [weekdays, setWeekdays] = useState<number[] | null>(null);
  const [weekdayWarning, setWeekdayWarning] = useState<string | null>(null);
  const [replaceExisting, setReplaceExisting] = useState(true);
  const [outcome, setOutcome] = useState<SaveOutcome | null>(null);
  const [saveFailure, setSaveFailure] = useState<{ planId: string; message: string } | null>(null);
  const [checking, setChecking] = useState(false);
  const [reviseOpen, setReviseOpen] = useState(false);
  const [revertOpen, setRevertOpen] = useState(false);
  const uid = user?.id ?? "guest";

  const planQuery = useQuery({
    queryKey: ["ai-plan", planId],
    queryFn: () => planService.getPlanById(planId),
    enabled: !!planId,
    // Seeded from the list so the screen paints at once, then kept fresh while the job runs.
    initialData: () =>
      (queryClient.getQueryData(planQueryKey(user?.id)) as any[] | undefined)?.find((p) => p.id === planId),
    refetchInterval: (q) => (q.state.data && isPending((q.state.data as any).status) ? 4000 : false),
  });
  const healthQuery = useQuery({ queryKey: ["ai-plans", "llm-health"], queryFn: () => planService.getLlmHealth(), retry: false });
  // The CURRENT PROGRAM is the source of truth for "is this plan in my schedule, at which version" (K9). Keyed by user id; the
  // shared ["current-workout-program"] prefix is still what every save/revert invalidates.
  const programQuery = useQuery({
    queryKey: ["current-workout-program", uid],
    queryFn: () => workoutService.getCurrentProgram(),
    refetchOnMount: "always",
  });

  const plan = planQuery.data ?? null;
  const content = toPlanContent(plan?.plan);
  const schedule = useMemo(() => toWeeklySchedule(content?.weeklySchedule), [content]);
  const warnings = extractPlanWarnings(content);
  const evidence = getPlanEvidence(content);
  const hasEvidence = evidence.adjustmentReason.length + evidence.evidenceUsed.length + evidence.safetyNotes.length > 0;
  const missingIds = countInvalidExerciseIds(schedule);
  const daysForSave = saveDaysPerWeek(plan);
  const selectedWeekdays = weekdays ?? suggestedWeekdays(daysForSave);
  const ids = useMemo(() => planExerciseIds(schedule), [schedule]);
  const completed = plan?.status === "COMPLETED";
  const llmDown = Boolean(healthQuery.data && !healthQuery.data.llmAvailable);
  const applied = (programQuery.data as any)?.sourcePlanId === planId;
  const planVersion = Number(plan?.version) > 0 ? Number(plan?.version) : 1;

  // PT approval hint: same query (and cache entry) as the program screen's PlanReviewCard; we only read the newest request's state.
  const program = programQuery.data as { id?: unknown; version?: unknown; sourcePlanId?: unknown } | null | undefined;
  const reviewQuery = useQuery({
    queryKey: ["plan-reviews", uid, "mine", program?.id ? String(program.id) : null, typeof program?.version === "number" ? program.version : null],
    queryFn: () => planReviewApi.mine(String(program!.id)),
    enabled: completed && applied && !!program?.id,
    retry: false,
  });
  const showPtHint = showPtOutdatedHint(program, planId, reviewQuery.data?.[0]);

  const canRevert = canRevertPlan(plan as any);

  // A new plan version changes how many training days the save needs: forget a selection made for the old one.
  useEffect(() => {
    setWeekdays(null);
    setWeekdayWarning(null);
  }, [planVersion]);

  const catalogQuery = useQuery({
    queryKey: ["exercises-by-ids", ids],
    queryFn: () => workoutService.getExercisesByIds(ids),
    enabled: ids.length > 0,
    staleTime: 5 * 60_000,
  });
  const catalog = useMemo(() => {
    const map = new Map<string, any>();
    for (const ex of (catalogQuery.data as any[]) ?? []) if (ex?.id) map.set(ex.id, ex);
    return map;
  }, [catalogQuery.data]);

  const invalidateAll = () => {
    void queryClient.invalidateQueries({ queryKey: planQueryKey(user?.id) });
    void queryClient.invalidateQueries({ queryKey: ["ai-plan", planId] });
  };

  const explainMutation = useMutation({
    mutationFn: () => planService.explainPlan(planId, "vi"),
    onSuccess: (res) => setExplanation(res),
    onError: (e) => toast.show(apiErrorMessage(e, "Không thể giải thích kế hoạch lúc này"), "danger"),
  });

  const archiveMutation = useMutation({
    mutationFn: () => planService.archivePlan(planId),
    onSuccess: () => {
      setArchiveOpen(false);
      toast.show("Đã ẩn kế hoạch khỏi danh sách", "success");
      invalidateAll();
      router.back();
    },
    onError: (e) => toast.show(apiErrorMessage(e, "Không thể ẩn kế hoạch"), "danger"),
  });

  const retryMutation = useMutation({
    mutationFn: () => planService.generateWorkoutPlan(retryPayload(plan!)),
    onSuccess: () => {
      toast.show("Đã gửi yêu cầu tạo lại — kế hoạch mới sẽ hiện trong danh sách", "success");
      invalidateAll();
      router.back();
    },
    onError: (e) => toast.show(apiErrorMessage(e, "Không thể tạo lại kế hoạch"), "danger"),
  });

  const saveMutation = useMutation({
    // `version` = the plan version this save is made for (the screen can move on before the answer arrives).
    mutationFn: (input: { repeat?: number; version: number }) =>
      planService.savePlanToWorkoutLog(planId, {
        startDate,
        repeatWeeks: input.repeat,
        selectedWeekdays,
        replaceExisting,
      }),
    onSuccess: (res, input) => {
      setSaveFailure(null);
      setSaveOpen(false);
      setConfirmReplace(null);
      setRepeatWeeks("");
      void queryClient.invalidateQueries({ queryKey: ["current-workout-program"] });
      void queryClient.invalidateQueries({ queryKey: ["workout-schedules"] });
      void queryClient.invalidateQueries({ queryKey: ["workout-stats"] });
      void queryClient.invalidateQueries({ queryKey: ["training-cycle"] });
      // K9: `alreadyExists` is true for every re-save onto an existing program, so the message comes from what the server says
      // actually happened (contentSynced / previousAiPlanVersion), never from alreadyExists alone.
      const verdict = saveOutcomeFrom(res, input.version);
      setOutcome({
        planVersion: input.version,
        message: verdict.message,
        createdScheduleCount: res.createdScheduleCount,
        selectedWeekdays: res.selectedWeekdays,
      });
      toast.show(verdict.message, "success");
    },
    onError: (e) => {
      const message = apiErrorMessage(e, "Không thể lưu kế hoạch vào lịch tập");
      setSaveFailure({ planId, message });
      toast.show(message, "danger");
      void queryClient.invalidateQueries({ queryKey: ["current-workout-program"] });
    },
  });

  const revertMutation = useMutation({
    mutationFn: () => planService.revertPlanAdjustment(planId),
    onSuccess: (res) => {
      setRevertOpen(false);
      setOutcome(null);
      setSaveFailure(null);
      invalidateAll();
      // Undo moves the plan version FORWARD (same id), so the program may now be behind it: re-read it, the sync card follows.
      void queryClient.invalidateQueries({ queryKey: ["current-workout-program"] });
      void queryClient.invalidateQueries({ queryKey: ["plan-reviews"] });
      toast.show(REVERT_CONFIRM.done, "success");
      // A plan adjusted before in-place revisions existed returns the plan it replaced (another id).
      if (res.planId && res.planId !== planId) router.replace(`/client/plans/ai/${res.planId}`);
    },
    onError: (e) => {
      const mapped = mapRevertError(e);
      setRevertOpen(false);
      toast.show(mapped.message, "danger");
      if (mapped.reload) invalidateAll();
    },
  });

  const sheetTitles = saveSheetTitles(
    completed && applied ? (deriveSyncState({ program, planId, planVersion })?.kind ?? null) : null,
  );

  const reloadPlan = () => {
    invalidateAll();
    void queryClient.invalidateQueries({ queryKey: ["current-workout-program"] });
  };

  const onSyncAction = (id: SyncActionId) => {
    // "Áp dụng bản mới" re-saves through the SAME save-to-workout-log (same sheet as web's panel): the server finds the program by
    // sourcePlanId and updates it in place, so no second WorkoutProgram is created. "Thử lại" reopens the sheet to confirm the choices.
    if (id === "retry") setSaveFailure(null);
    setSaveOpen(true);
  };

  const syncModel = completed
    ? deriveSyncState({
        program: programQuery.isLoading ? undefined : programQuery.isError ? null : (program ?? null),
        planId,
        planVersion,
        saving: saveMutation.isPending,
        failedMessage: saveFailure?.planId === planId ? saveFailure.message : null,
      })
    : null;

  const requireLlm = async () => {
    const h = await healthQuery.refetch();
    if (h.isError || !h.data?.llmAvailable) {
      toast.show(LLM_NOT_READY_MESSAGE, "danger");
      return false;
    }
    return true;
  };

  const submitSave = async () => {
    const repeat = parseRepeatWeeks(repeatWeeks);
    if (!repeat.ok) {
      toast.show(repeat.error, "danger");
      return;
    }
    if (selectedWeekdays.length !== daysForSave) {
      toast.show(`Vui lòng chọn đủ ${daysForSave} ngày tập trong tuần.`, "danger");
      return;
    }
    setChecking(true);
    try {
      const active = await workoutService.getCurrentProgram();
      if (replacesOtherProgram(active, planId) && !confirmReplace) {
        // Same question web asks with window.confirm — here as an explicit second step.
        setConfirmReplace(typeof (active as any)?.name === "string" ? (active as any).name : "chương trình hiện tại");
        return;
      }
    } catch (e) {
      toast.show(apiErrorMessage(e, "Không thể kiểm tra chương trình hiện tại"), "danger");
      return;
    } finally {
      setChecking(false);
    }
    saveMutation.mutate({ repeat: repeat.value, version: planVersion });
  };

  if (planQuery.isLoading && !plan) {
    return (
      <View className="flex-1 bg-background">
        <ScreenHeader title="Kế hoạch AI" onBack={() => router.back()} />
        <View className="items-center py-16">
          <ActivityIndicator color={accent.primary} />
        </View>
      </View>
    );
  }
  if (!plan) {
    return (
      <View className="flex-1 bg-background">
        <ScreenHeader title="Kế hoạch AI" onBack={() => router.back()} />
        <EmptyState icon={CircleAlert} title="Không tìm thấy kế hoạch" description="Kế hoạch có thể đã bị ẩn." />
      </View>
    );
  }

  const stats: [string, string][] = [
    ["Mục tiêu", plan.goal || content?.goal || "--"],
    ["Thời lượng", `${content?.durationWeeks ?? plan.duration ?? "--"} tuần`],
    ["Buổi/tuần", `${content?.daysPerWeek ?? plan.daysPerWeek ?? "--"} buổi`],
    ["Bài/buổi", `${content?.exercisesPerDay ?? "--"} bài`],
    ["Nơi tập", locationLabel(planLocation(plan))],
    ["Phiên bản", `v${plan.version ?? 1}`],
    ["Ngày tạo", formatPlanDate(plan.createdAt)],
    ["Cập nhật", formatPlanDate(plan.updatedAt)],
  ];

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title={plan.name || "Kế hoạch AI"} onBack={() => router.back()} />
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 48, gap: 16 }}>
        <Card className="p-5">
          {applied ? <Badge tone="success">Đang áp dụng</Badge> : <Badge tone={statusTone(plan.status)}>{statusLabel(plan.status)}</Badge>}
          <Text className="mt-2 font-display text-xl text-foreground">{plan.name || "Kế hoạch AI"}</Text>
          <Text className="font-body text-sm text-muted-foreground">{plan.description || "Kế hoạch được tạo bởi AI"}</Text>
          <View className="mt-4 flex-row flex-wrap gap-2">
            {stats.map(([k, v]) => (
              <View key={k} className="w-[48%] rounded-xl bg-panel p-3">
                <Text className="font-body text-[11px] text-muted-foreground">{k}</Text>
                <Text className="mt-0.5 font-body-semibold text-sm text-foreground" numberOfLines={1}>
                  {v}
                </Text>
              </View>
            ))}
          </View>
        </Card>

        {isPending(plan.status) ? (
          <Card className="flex-row items-center gap-3 p-4">
            <ActivityIndicator color={accent.primary} />
            <Text className="flex-1 font-body text-sm text-muted-foreground">
              AI đang soạn kế hoạch này. Màn hình tự cập nhật khi xong.
            </Text>
          </Card>
        ) : null}

        {plan.status === "FAILED" ? (
          <Card className="border-destructive/40 bg-destructive/5 p-4">
            <Text className="font-body-semibold text-sm text-destructive">Kế hoạch này tạo thất bại</Text>
            <Text className="mt-1 font-body text-sm text-muted-foreground">{friendlyPlanFailReason(plan.failReason)}</Text>
            <View className="mt-3 flex-row gap-2">
              <Button
                size="sm"
                icon={RotateCcw}
                disabled={retryMutation.isPending || llmDown || !plan.goal || !plan.duration || !plan.daysPerWeek}
                onPress={async () => (await requireLlm()) && retryMutation.mutate()}
              >
                Tạo lại
              </Button>
              <Button size="sm" variant="ghost" icon={Archive} onPress={() => setArchiveOpen(true)}>
                Ẩn kế hoạch
              </Button>
            </View>
          </Card>
        ) : null}

        {warnings.length > 0 ? (
          <Card className="border-warning/40 bg-warning/5 p-4">
            <Text className="mb-2 font-body-semibold text-sm text-warning">Cảnh báo từ AI</Text>
            {warnings.map((w, i) => (
              <Text key={`${w}-${i}`} className="font-body text-sm text-foreground">{`• ${w}`}</Text>
            ))}
          </Card>
        ) : null}

        {hasEvidence ? (
          <Card className="p-4">
            <Tappable className="flex-row items-center justify-between" onPress={() => setShowEvidence((v) => !v)}>
              <Text className="font-body-semibold text-sm text-foreground">Vì sao AI điều chỉnh kế hoạch</Text>
              {showEvidence ? <ChevronDown size={16} color="#8b9299" /> : <ChevronRight size={16} color="#8b9299" />}
            </Tappable>
            {showEvidence ? (
              <View className="mt-3 gap-3">
                {evidence.adjustmentReason.map((item, i) => (
                  <View key={`adj-${i}`} className="rounded-xl bg-panel p-3">
                    <Text className="font-body-semibold text-sm text-foreground">
                      {`${item.metric || "Chỉ số"}: ${String(item.observed_value ?? "--")}`}
                    </Text>
                    {item.interpretation ? <Text className="mt-1 font-body text-xs text-muted-foreground">{item.interpretation}</Text> : null}
                    {item.plan_adjustment ? <Text className="mt-1 font-body text-xs text-primary">{item.plan_adjustment}</Text> : null}
                  </View>
                ))}
                {evidence.evidenceUsed.map((item, i) => (
                  <View key={`ev-${i}`} className="rounded-xl bg-panel p-3">
                    <View className="flex-row flex-wrap items-center gap-2">
                      <Text className="font-body-semibold text-sm text-foreground">{item.title || "Nguồn tham khảo"}</Text>
                      {item.source_type ? <Badge tone="info">{formatEvidenceSourceType(item.source_type)}</Badge> : null}
                    </View>
                    {item.summary ? <Text className="mt-1 font-body text-xs text-muted-foreground">{item.summary}</Text> : null}
                    {isSafeHttpUrl(item.source_url) ? (
                      <Tappable onPress={() => void Linking.openURL(item.source_url!.trim())}>
                        <Text className="mt-1 font-body text-xs text-primary" numberOfLines={1}>
                          {item.source_url}
                        </Text>
                      </Tappable>
                    ) : null}
                  </View>
                ))}
                {evidence.safetyNotes.map((n, i) => (
                  <Text key={`safe-${i}`} className="font-body text-xs text-muted-foreground">{`• ${n}`}</Text>
                ))}
              </View>
            ) : null}
          </Card>
        ) : null}

        {completed ? (
          <View className="gap-3">
            <View className="flex-row gap-3">
              <View className="flex-1">
                <Button variant="secondary" full icon={Sparkles} disabled={explainMutation.isPending} onPress={() => explainMutation.mutate()}>
                  {explainMutation.isPending ? "Đang giải thích…" : "Giải thích"}
                </Button>
              </View>
            </View>
            <Button variant="secondary" full icon={Wand2} disabled={llmDown || isPending(plan.status)} onPress={() => setReviseOpen(true)}>
              Nhờ AI chỉnh kế hoạch
            </Button>
            {syncModel ? <PlanSyncCard model={syncModel} onAction={onSyncAction} /> : null}
            {showPtHint ? (
              <Tappable
                className="flex-row items-center gap-2 rounded-xl border border-warning/40 bg-warning/5 p-3"
                onPress={() => router.push("/client/workout/programs")}
              >
                <Info size={16} color={designTokens.warning} />
                <Text className="flex-1 font-body text-xs text-foreground">{PT_OUTDATED_HINT}</Text>
                <ChevronRight size={16} color="#8b9299" />
              </Tappable>
            ) : null}
            {canRevert ? (
              <Button variant="ghost" full icon={RotateCcw} disabled={revertMutation.isPending || saveMutation.isPending} onPress={() => setRevertOpen(true)}>
                Khôi phục bản trước
              </Button>
            ) : null}
            <Button variant="ghost" full icon={Archive} onPress={() => setArchiveOpen(true)}>
              Ẩn kế hoạch
            </Button>
          </View>
        ) : null}

        {explanation ? (
          <Card className="flex-row items-start gap-3 border-primary/30 bg-primary/5 p-4">
            <Sparkles size={18} color={accent.primary} />
            <View className="flex-1">
              <Text className="mb-1 font-body-semibold text-xs text-primary">
                {explanation.source === "fallback" ? "Giải thích tự động (AI phản hồi chậm)" : "AI giải thích"}
              </Text>
              <Text className="font-body text-sm leading-5 text-muted-foreground">
                {typeof explanation.explanation === "string" ? explanation.explanation : JSON.stringify(explanation.explanation)}
              </Text>
            </View>
          </Card>
        ) : null}

        {outcome && outcome.planVersion === planVersion ? (
          <Card className="border-primary/40 bg-primary/5 p-4">
            <Text className="font-body-semibold text-sm text-foreground">{outcome.message}</Text>
            <Text className="mt-1 font-body text-xs text-muted-foreground">
              {outcome.createdScheduleCount > 0
                ? `Đã tạo ${outcome.createdScheduleCount} buổi trong lịch.`
                : "Không có buổi mới được tạo thêm."}
              {outcome.selectedWeekdays?.length
                ? ` Ngày tập: ${outcome.selectedWeekdays.map((d) => WEEKDAY_LABEL_BY_VALUE[d] ?? `Ngày ${d}`).join(", ")}.`
                : ""}
            </Text>
            <View className="mt-3">
              <Button size="sm" onPress={() => router.replace("/client/workout")}>
                Đi tới lịch tập
              </Button>
            </View>
          </Card>
        ) : null}

        <Text className="mt-2 px-1 font-display text-base text-foreground">Lịch tập theo tuần</Text>
        {isPending(plan.status) ? null : !schedule ? (
          <Text className="px-1 font-body text-sm text-muted-foreground">Kế hoạch chưa có dữ liệu lịch tập hợp lệ.</Text>
        ) : schedule.length === 0 ? (
          <Text className="px-1 font-body text-sm text-muted-foreground">Chưa có buổi tập nào.</Text>
        ) : (
          schedule.map((day, i) => {
            const key = `${day.day ?? i}`;
            const open = expandedDay === key;
            const exercises = toExerciseList(day.exercises);
            const invalid = exercises.filter((e) => !hasValidExerciseId(e)).length;
            return (
              <Card key={key} className={`overflow-hidden ${invalid > 0 ? "border-warning/40" : ""}`}>
                <Tappable className="flex-row items-center gap-3 p-4" onPress={() => setExpandedDay(open ? null : key)}>
                  <View className="h-11 w-11 items-center justify-center rounded-xl bg-panel">
                    <Text className="font-display text-sm text-primary">{typeof day.day === "number" ? String(day.day) : String(i + 1)}</Text>
                  </View>
                  <View className="flex-1">
                    <Text className="font-body-semibold text-sm text-foreground">{localizeDayGoal(day.goal || day.focus, i)}</Text>
                    <Text className="font-body text-xs text-muted-foreground">
                      {`${exercises.length} bài tập${invalid > 0 ? ` · ${invalid} bài chưa khớp thư viện` : ""}`}
                    </Text>
                  </View>
                  {open ? <ChevronDown size={16} color="#8b9299" /> : <ChevronRight size={16} color="#8b9299" />}
                </Tappable>
                {open ? (
                  <View className="gap-2 border-t border-border p-4">
                    {day.notes ? <Text className="font-body text-xs text-muted-foreground">{`Ghi chú: ${localizePlanNote(day.notes)}`}</Text> : null}
                    {day.cardio ? <Text className="font-body text-xs text-muted-foreground">{`Cardio: ${localizePlanNote(day.cardio)}`}</Text> : null}
                    {invalid > 0 ? (
                      <Text className="font-body text-xs text-warning">
                        Một số bài chưa khớp bài tập trong thư viện; khi lưu, hệ thống sẽ tìm theo tên và bỏ qua bài không tìm thấy.
                      </Text>
                    ) : null}
                    {exercises.map((ex, j) => {
                      const cat = ex.exerciseId ? catalog.get(ex.exerciseId.trim()) : undefined;
                      const muscles = Array.isArray(cat?.muscleGroupsActivated) ? cat.muscleGroupsActivated.join(", ") : null;
                      return (
                        <View key={`${ex.name ?? "ex"}-${j}`} className="rounded-xl bg-panel p-3">
                          <View className="flex-row items-center gap-2">
                            <Dumbbell size={14} color={accent.primary} />
                            <Text className="flex-1 font-body-semibold text-sm text-foreground">
                              {`${ex.order ?? j + 1}. ${ex.name ?? "Bài tập"}`}
                            </Text>
                          </View>
                          <Text className="mt-1 font-body text-xs text-muted-foreground">
                            {`${ex.sets ?? "--"} hiệp × ${ex.reps ?? "--"} · nghỉ ${ex.restSeconds ?? "--"}s`}
                          </Text>
                          {muscles || cat?.typeOfEquipment ? (
                            <Text className="font-body text-xs text-muted-foreground">
                              {[muscles, cat?.typeOfEquipment].filter(Boolean).join(" · ")}
                            </Text>
                          ) : null}
                          {ex.note ? <Text className="mt-1 font-body text-xs text-muted-foreground">{localizePlanNote(ex.note)}</Text> : null}
                        </View>
                      );
                    })}
                  </View>
                ) : null}
              </Card>
            );
          })
        )}

        {completed ? (
          <Card className="gap-3 p-4">
            <NoteList title="Ghi chú tăng tiến" notes={content?.progressionNotes} color={accent.primary} empty="Chưa có ghi chú tăng tiến." />
            <NoteList title="Ghi chú phục hồi" notes={content?.recoveryNotes} color={accent.primary} empty="Chưa có ghi chú phục hồi." />
            <View>
              <Text className="mb-1 font-body-semibold text-xs text-muted-foreground">Tóm tắt dinh dưỡng</Text>
              <Text className="font-body text-sm text-foreground">
                {content?.nutritionSummary ? localizePlanNote(content.nutritionSummary) : "Chưa có tóm tắt dinh dưỡng."}
              </Text>
            </View>
          </Card>
        ) : null}
      </ScrollView>

      <BottomSheet
        open={saveOpen}
        onClose={() => {
          setSaveOpen(false);
          setConfirmReplace(null);
        }}
        title={sheetTitles.title}
      >
        {confirmReplace ? (
          <View>
            <View className="mb-4 rounded-xl bg-warning/10 p-3.5">
              <Text className="font-body text-sm text-foreground">
                {`Bạn đang có "${confirmReplace}" trong nhật ký tập. Lưu kế hoạch AI này sẽ ẩn chương trình cũ và dùng kế hoạch này làm chương trình hiện tại.`}
              </Text>
            </View>
            <Button full size="lg" disabled={saveMutation.isPending} onPress={() => {
                const r = parseRepeatWeeks(repeatWeeks);
                saveMutation.mutate({ repeat: r.ok ? r.value : undefined, version: planVersion });
              }}>
              {saveMutation.isPending ? "Đang lưu…" : "Thay thế và lưu"}
            </Button>
            <View className="mt-1">
              <Button variant="ghost" full onPress={() => setConfirmReplace(null)}>
                Quay lại
              </Button>
            </View>
          </View>
        ) : (
          <View className="gap-4">
            {missingIds > 0 ? (
              <View className="flex-row gap-2 rounded-xl bg-warning/10 p-3">
                <Info size={16} color={designTokens.warning} />
                <Text className="flex-1 font-body text-xs text-foreground">
                  {`Còn ${missingIds} bài chưa khớp thư viện bài tập — hãy tạo lại kế hoạch trước khi lưu.`}
                </Text>
              </View>
            ) : null}
            <View>
              <FieldLabel>Lịch tập hiện tại</FieldLabel>
              <View className="flex-row gap-2">
                <OptionCard label="Thay thế lịch cũ" desc="Huỷ buổi cũ chưa hoàn thành" active={replaceExisting} onPress={() => setReplaceExisting(true)} />
                <OptionCard label="Thêm vào lịch" desc="Giữ lịch cũ, thêm mới" active={!replaceExisting} onPress={() => setReplaceExisting(false)} />
              </View>
            </View>
            <View>
              <FieldLabel>Ngày bắt đầu</FieldLabel>
              <StartDateStrip value={startDate} onChange={setStartDate} />
            </View>
            <View>
              <FieldLabel>{`Chọn ngày tập trong tuần (${selectedWeekdays.length}/${daysForSave})`}</FieldLabel>
              <WeekdayPicker
                options={WEEKDAY_OPTIONS}
                selected={selectedWeekdays}
                limit={daysForSave}
                onToggle={(w) => {
                  const r = toggleWeekday(selectedWeekdays, w, daysForSave);
                  setWeekdays(r.selected);
                  setWeekdayWarning(r.warning);
                }}
              />
              <Text className="mt-2 font-body text-[11px] text-muted-foreground">
                {`Buổi 1 đến buổi ${daysForSave} được xếp theo thứ tự các ngày đã chọn.`}
              </Text>
              {weekdayWarning ? <Text className="mt-1 font-body text-xs text-warning">{weekdayWarning}</Text> : null}
            </View>
            <Input
              label="Số tuần áp dụng (không bắt buộc)"
              keyboardType="number-pad"
              value={repeatWeeks}
              onChangeText={setRepeatWeeks}
              placeholder={String(content?.durationWeeks ?? plan.duration ?? 1)}
            />
            <Button
              full
              size="lg"
              icon={CalendarDays}
              disabled={saveMutation.isPending || checking || missingIds > 0 || selectedWeekdays.length !== daysForSave}
              onPress={() => void submitSave()}
            >
              {checking ? "Đang kiểm tra…" : saveMutation.isPending ? "Đang lưu…" : sheetTitles.confirm}
            </Button>
          </View>
        )}
      </BottomSheet>

      <AiRevisionSheet
        open={reviseOpen}
        onClose={() => setReviseOpen(false)}
        planId={planId}
        currentVersion={planVersion}
        onRevised={() => {
          setOutcome(null);
          reloadPlan();
          void queryClient.invalidateQueries({ queryKey: ["plan-reviews"] });
        }}
        onReload={reloadPlan}
      />

      <BottomSheet open={revertOpen} onClose={() => (revertMutation.isPending ? undefined : setRevertOpen(false))} title={REVERT_CONFIRM.title}>
        <Text className="mb-4 text-center font-body text-sm text-muted-foreground">{REVERT_CONFIRM.body}</Text>
        <Button full size="lg" disabled={revertMutation.isPending} onPress={() => revertMutation.mutate()}>
          {revertMutation.isPending ? "Đang khôi phục…" : REVERT_CONFIRM.confirm}
        </Button>
        <View className="mt-1">
          <Button variant="ghost" full disabled={revertMutation.isPending} onPress={() => setRevertOpen(false)}>
            {REVERT_CONFIRM.cancel}
          </Button>
        </View>
      </BottomSheet>

      <BottomSheet open={archiveOpen} onClose={() => setArchiveOpen(false)} title="Ẩn kế hoạch?">
        <Text className="mb-4 text-center font-body text-sm text-muted-foreground">
          Kế hoạch sẽ không còn trong danh sách. Lịch tập đã lưu từ kế hoạch này không bị xoá.
        </Text>
        <Button variant="destructive" full size="lg" disabled={archiveMutation.isPending} onPress={() => archiveMutation.mutate()}>
          {archiveMutation.isPending ? "Đang ẩn…" : "Ẩn kế hoạch"}
        </Button>
        <View className="mt-1">
          <Button variant="ghost" full onPress={() => setArchiveOpen(false)}>
            Giữ lại
          </Button>
        </View>
      </BottomSheet>
    </View>
  );
}

function NoteList({ title, notes, color, empty }: { title: string; notes?: string[]; color: string; empty: string }) {
  const list = Array.isArray(notes) ? notes : [];
  return (
    <View>
      <Text className="mb-1 font-body-semibold text-xs text-muted-foreground">{title}</Text>
      {list.length === 0 ? (
        <Text className="font-body text-sm text-muted-foreground">{empty}</Text>
      ) : (
        list.map((n, i) => (
          <View key={`${title}-${i}`} className="mb-1 flex-row gap-2">
            <CircleCheck size={14} color={color} style={{ marginTop: 3 }} />
            <Text className="flex-1 font-body text-sm text-foreground">{localizePlanNote(n)}</Text>
          </View>
        ))
      )}
    </View>
  );
}

