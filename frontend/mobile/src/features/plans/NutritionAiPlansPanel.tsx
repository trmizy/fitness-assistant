import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, Switch, Text, View } from "react-native";
import { router } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  Brain,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  Eye,
  Loader,
  MessageSquare,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react-native";

import { Badge, BottomSheet, Button, Card, EmptyState, Input, Tappable, useToast } from "../../components/ui";
import { nutritionService, planService } from "../../services/api";
import { useWorkspaceAccent } from "../../theme/workspace";
import { chartSeries, darkColors } from "../../theme/colors";
import { toDateInputValue } from "../../utils/date";
import { apiErrorMessage, statusLabel, statusTone } from "./aiPlans";
import {
  ACTIVITY_OPTIONS,
  APPLY_SPANS,
  BUDGET_OPTIONS,
  buildNutritionPayload,
  dayMacros,
  defaultNutritionForm,
  DIET_OPTIONS,
  endDateFor,
  EXPERIENCE_OPTIONS_NUTRITION,
  GENDER_OPTIONS_NUTRITION,
  itemName,
  mealTypeLabel,
  NUTRITION_GOALS,
  nutritionFormError,
  nutritionGoalLabel,
  PHASE_OPTIONS,
  RESTRICTION_PRESETS,
  TRAINING_TYPE_OPTIONS,
  type NutritionForm,
} from "./nutritionAiPlans";
import { Chip, FieldLabel, StartDateStrip, Stepper, TextArea } from "./PlanWidgets";

const PLANS_KEY = ["nutrition-ai-plans"];

/**
 * CL-18, "Kế hoạch AI → Dinh dưỡng" (web's CurrentNutritionProgram): the meal plan currently
 * applied, a banner while the AI works, then each generated 7-day menu with Lưu vào Dinh dưỡng /
 * Giải thích / Điều chỉnh / Xem thực đơn / Ẩn, and the generate form (basic + advanced) in a sheet.
 *
 * Web polls every 3s forever; here the list polls only while a plan is QUEUED/PROCESSING.
 */
export function NutritionAiPlans() {
  const accent = useWorkspaceAccent();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [genOpen, setGenOpen] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [form, setForm] = useState<NutritionForm>(defaultNutritionForm());
  const [expanded, setExpanded] = useState<string | null>(null);
  const [openDays, setOpenDays] = useState<Set<string>>(new Set());
  const [explanations, setExplanations] = useState<Record<string, string>>({});
  const [explaining, setExplaining] = useState<string | null>(null);
  const [adjustFor, setAdjustFor] = useState<string | null>(null);
  const [adjustText, setAdjustText] = useState("");
  const [saveFor, setSaveFor] = useState<string | null>(null);
  const [startDate, setStartDate] = useState(() => toDateInputValue(new Date()));
  const [span, setSpan] = useState(7);
  const [repeat, setRepeat] = useState(false);
  const [forceArchive, setForceArchive] = useState(true);
  const [savedPlanId, setSavedPlanId] = useState<string | null>(null);
  const [archiveFor, setArchiveFor] = useState<string | null>(null);
  const watching = useRef<string | null>(null);

  const programQuery = useQuery({ queryKey: ["nutrition-current-program"], queryFn: () => nutritionService.getCurrentProgram() });
  const plansQuery = useQuery({
    queryKey: PLANS_KEY,
    queryFn: () => planService.getCurrentNutritionAiPlans(),
    refetchInterval: (q) => ((q.state.data as any[] | undefined)?.some((p) => p.status === "QUEUED" || p.status === "PROCESSING") ? 3000 : false),
  });
  const plans = useMemo<any[]>(() => (Array.isArray(plansQuery.data) ? plansQuery.data : []), [plansQuery.data]);
  const processing = plans.find((p) => p.status === "QUEUED" || p.status === "PROCESSING");
  const completed = plans.filter((p) => p.status === "COMPLETED");
  const failed = plans.filter((p) => p.status === "FAILED");
  const program: any = programQuery.data;

  // Tell the client when the plan they were waiting for finishes (web does the same).
  useEffect(() => {
    if (processing) {
      watching.current = processing.id;
      return;
    }
    if (!watching.current) return;
    const done = plans.find((p) => p.id === watching.current);
    if (done?.status === "COMPLETED") {
      toast.show("Đã tạo kế hoạch dinh dưỡng!", "success");
      setExpanded(done.id);
    } else if (done?.status === "FAILED") {
      toast.show(done.failReason || "Tạo kế hoạch thất bại. Vui lòng thử lại.", "danger");
    }
    watching.current = null;
  }, [processing, plans, toast]);

  const generate = useMutation({
    mutationFn: (payload: Record<string, unknown>) => planService.generateNutritionPlan(payload as any),
    onSuccess: () => {
      setGenOpen(false);
      setForm(defaultNutritionForm());
      setAdvanced(false);
      toast.show("Đã bắt đầu tạo kế hoạch — AI chạy nền.", "success");
      void queryClient.invalidateQueries({ queryKey: PLANS_KEY });
    },
    onError: (e) => toast.show(apiErrorMessage(e, "Không thể tạo kế hoạch."), "danger"),
  });
  const save = useMutation({
    mutationFn: (planId: string) =>
      planService.saveNutritionPlanToNutrition(planId, {
        startDate,
        endDate: endDateFor(startDate, span),
        repeatEnabled: repeat,
        forceArchive,
      }),
    onSuccess: (res, planId) => {
      setSaveFor(null);
      queryClient.removeQueries({ queryKey: ["nutrition-daily-task"] });
      queryClient.removeQueries({ queryKey: ["nutrition-current-program"] });
      queryClient.removeQueries({ queryKey: ["nutrition-monthly-summary"] });
      void programQuery.refetch();
      if (res.alreadyExists) {
        toast.show("Kế hoạch này đã được lưu trước đó.", "success");
      } else {
        toast.show(`Đã lưu ${res.createdDayCount ?? 7} ngày, ${res.createdMealCount ?? 0} bữa vào Dinh dưỡng.`, "success");
        setSavedPlanId(planId);
      }
    },
    onError: (e) => toast.show(apiErrorMessage(e, "Lỗi khi lưu kế hoạch."), "danger"),
  });
  const archive = useMutation({
    mutationFn: (planId: string) => planService.archiveNutritionPlan(planId),
    onSuccess: () => {
      setArchiveFor(null);
      toast.show("Đã ẩn kế hoạch.", "success");
      void queryClient.invalidateQueries({ queryKey: PLANS_KEY });
    },
    onError: () => toast.show("Không thể ẩn kế hoạch.", "danger"),
  });
  const adjust = useMutation({
    mutationFn: (planId: string) => planService.adjustNutritionPlan(planId, adjustText.trim(), form.mealsPerDay),
    onSuccess: () => {
      setAdjustFor(null);
      setAdjustText("");
      toast.show("Đã gửi yêu cầu điều chỉnh — kế hoạch mới đang được tạo.", "success");
      void queryClient.invalidateQueries({ queryKey: PLANS_KEY });
    },
    onError: (e) => toast.show(apiErrorMessage(e, "Không thể điều chỉnh kế hoạch."), "danger"),
  });

  const explain = async (planId: string) => {
    if (explanations[planId]) {
      setExplanations(({ [planId]: _, ...rest }) => rest);
      return;
    }
    setExplaining(planId);
    try {
      const r = await planService.explainNutritionPlan(planId);
      setExplanations((prev) => ({ ...prev, [planId]: r.explanation }));
    } catch {
      toast.show("Không thể giải thích kế hoạch. Vui lòng thử lại.", "danger");
    } finally {
      setExplaining(null);
    }
  };

  const formError = nutritionFormError(form);
  const set = <K extends keyof NutritionForm>(k: K, v: NutritionForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  const planCard = (plan: any) => {
    const content = plan.plan ?? {};
    const open = expanded === plan.id;
    const days: any[] = Array.isArray(content.weeklySchedule) ? content.weeklySchedule : [];
    return (
      <Card key={plan.id} className="p-4">
        <Tappable className="flex-row items-start gap-3" onPress={() => setExpanded(open ? null : plan.id)}>
          <View className="flex-1">
            <View className="mb-1 flex-row items-center gap-2">
              <Badge tone={statusTone(plan.status)}>{statusLabel(plan.status)}</Badge>
              <Text className="font-body text-[11px] text-muted-foreground">{new Date(plan.createdAt).toLocaleDateString("vi-VN")}</Text>
            </View>
            <Text className="font-body-semibold text-sm text-foreground" numberOfLines={2}>
              {plan.name || `Kế hoạch dinh dưỡng - ${nutritionGoalLabel(plan.goal)}`}
            </Text>
            {plan.status === "COMPLETED" ? (
              <Text className="mt-1 font-body text-xs text-muted-foreground">
                {`${nutritionGoalLabel(plan.goal)} · ${content.dailyCaloriesTarget ?? 0} kcal/ngày · ${plan.mealsPerDay ?? 3} bữa/ngày`}
              </Text>
            ) : null}
            {plan.status === "FAILED" ? (
              <Text className="mt-1 font-body text-xs text-destructive" numberOfLines={2}>
                {plan.failReason || "Tạo thất bại."}
              </Text>
            ) : null}
          </View>
          {plan.status === "COMPLETED" ? open ? <ChevronDown size={16} color="#8b9299" /> : <ChevronRight size={16} color="#8b9299" /> : null}
        </Tappable>

        {plan.status === "COMPLETED" ? (
          <View className="mt-3 flex-row flex-wrap gap-2">
            {savedPlanId === plan.id ? (
              <Button size="sm" icon={Check} onPress={() => router.push("/client/workout/nutrition")}>
                Đi tới Dinh dưỡng
              </Button>
            ) : (
              <Button size="sm" icon={CalendarDays} onPress={() => setSaveFor(plan.id)}>
                Lưu vào Dinh dưỡng
              </Button>
            )}
            <Button size="sm" variant="secondary" icon={MessageSquare} disabled={explaining === plan.id} onPress={() => void explain(plan.id)}>
              {explaining === plan.id ? "Đang giải thích…" : explanations[plan.id] ? "Ẩn giải thích" : "Giải thích"}
            </Button>
            <Button size="sm" variant="secondary" icon={SlidersHorizontal} onPress={() => setAdjustFor(plan.id)}>
              Điều chỉnh
            </Button>
            <Button size="sm" variant="secondary" icon={Eye} onPress={() => setExpanded(open ? null : plan.id)}>
              {open ? "Ẩn thực đơn" : "Xem thực đơn"}
            </Button>
            <Button size="sm" variant="ghost" icon={Archive} onPress={() => setArchiveFor(plan.id)}>
              Ẩn
            </Button>
          </View>
        ) : plan.status === "FAILED" ? (
          <View className="mt-3 flex-row gap-2">
            <Button
              size="sm"
              variant="secondary"
              icon={RotateCcw}
              disabled={generate.isPending || !!processing}
              onPress={() => generate.mutate(buildNutritionPayload({ ...form, goal: plan.goal || form.goal }))}
            >
              Tạo lại
            </Button>
            <Button size="sm" variant="ghost" icon={Archive} onPress={() => setArchiveFor(plan.id)}>
              Ẩn
            </Button>
          </View>
        ) : null}

        {explanations[plan.id] ? (
          <View className="mt-3 rounded-xl bg-panel p-3">
            <Text className="mb-1 font-body-semibold text-[11px] text-muted-foreground">Giải thích kế hoạch</Text>
            <Text className="font-body text-xs leading-5 text-foreground">{explanations[plan.id]}</Text>
          </View>
        ) : null}

        {open && plan.status === "COMPLETED" ? (
          <View className="mt-3 gap-2">
            <Text className="font-body-semibold text-xs text-muted-foreground">Thực đơn 7 ngày</Text>
            {days.map((day, i) => {
              const key = `${plan.id}-${i}`;
              const dayOpen = openDays.has(key);
              const m = dayMacros(day);
              return (
                <View key={key} className="overflow-hidden rounded-xl bg-panel">
                  <Tappable
                    className="flex-row items-center gap-2 px-3.5 py-3"
                    onPress={() =>
                      setOpenDays((prev) => {
                        const next = new Set(prev);
                        if (next.has(key)) next.delete(key);
                        else next.add(key);
                        return next;
                      })
                    }
                  >
                    <Text className="flex-1 font-body-semibold text-sm text-foreground">{day.title || `Ngày ${day.dayNumber ?? i + 1}`}</Text>
                    <Text className="font-body text-xs text-muted-foreground">{`${m.kcal} kcal · P${m.p} C${m.c} F${m.f}`}</Text>
                    {dayOpen ? <ChevronDown size={14} color="#8b9299" /> : <ChevronRight size={14} color="#8b9299" />}
                  </Tappable>
                  {dayOpen ? (
                    <View className="gap-2 border-t border-border px-3.5 py-3">
                      {(day.meals ?? []).map((meal: any, mi: number) => (
                        <View key={meal.id ?? mi}>
                          <Text className="mb-1 font-body-semibold text-xs text-warning">
                            {`${mealTypeLabel(meal.mealType)}${meal.title ? ` · ${meal.title}` : ""} · ${meal.calories ?? 0} kcal`}
                          </Text>
                          {(meal.items ?? []).map((item: any, ii: number) => (
                            <View key={item.id ?? ii} className="flex-row justify-between py-0.5">
                              <Text className="flex-1 font-body text-xs text-foreground">{itemName(item)}</Text>
                              <Text className="font-body text-xs text-muted-foreground">{`${item.quantity ?? 100}${item.unit ?? "g"} · ${item.calories ?? 0} kcal`}</Text>
                            </View>
                          ))}
                        </View>
                      ))}
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>
        ) : null}
      </Card>
    );
  };

  return (
    <>
      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: 48, gap: 14 }}
        refreshControl={
          <RefreshControl
            refreshing={plansQuery.isRefetching}
            onRefresh={() => {
              void plansQuery.refetch();
              void programQuery.refetch();
            }}
            tintColor={accent.primary}
            colors={[accent.primary]}
          />
        }
      >
        {program ? (
          <Card className="border-primary/30 p-4">
            <View className="mb-3 flex-row items-center justify-between">
              <View className="flex-1">
                <Badge tone="success">Đang áp dụng</Badge>
                <Text className="mt-1 font-body-semibold text-sm text-foreground">{program.name}</Text>
                <Text className="font-body text-xs text-muted-foreground">
                  {`${nutritionGoalLabel(program.goal)}${program.durationWeeks ? ` · ${program.durationWeeks} tuần` : ""}`}
                </Text>
              </View>
              <Button size="sm" variant="secondary" onPress={() => router.push("/client/workout/nutrition")}>
                Xem chi tiết
              </Button>
            </View>
            <View className="flex-row gap-2">
              {[
                ["Kcal", program.dailyCaloriesTarget ?? "--"],
                ["Đạm", `${program.proteinTargetGrams ?? 0}g`],
                ["Tinh bột", `${program.carbTargetGrams ?? 0}g`],
                ["Béo", `${program.fatTargetGrams ?? 0}g`],
              ].map(([k, v]) => (
                <View key={String(k)} className="flex-1 items-center rounded-xl bg-panel py-2">
                  <Text className="font-display text-sm text-foreground">{String(v)}</Text>
                  <Text className="font-body text-[10px] text-muted-foreground">{String(k)}</Text>
                </View>
              ))}
            </View>
          </Card>
        ) : null}

        {processing ? (
          <Card className="flex-row items-center gap-3 border-chart-3/40 bg-chart-3/5 p-4">
            <Loader size={18} color={chartSeries[2]} />
            <View className="flex-1">
              <Text className="font-body-semibold text-sm text-foreground">AI đang tạo kế hoạch dinh dưỡng…</Text>
              <Text className="font-body text-xs text-muted-foreground">Bạn có thể rời màn này. Kết quả hiện khi hoàn tất.</Text>
            </View>
          </Card>
        ) : null}

        <Button full size="lg" icon={Sparkles} disabled={!!processing} onPress={() => setGenOpen(true)}>
          Tạo kế hoạch dinh dưỡng AI
        </Button>

        {plansQuery.isLoading ? (
          <ActivityIndicator color={accent.primary} />
        ) : !processing && plans.length === 0 && !program ? (
          <EmptyState icon={Brain} title="Chưa có kế hoạch dinh dưỡng AI" description='Bấm "Tạo kế hoạch dinh dưỡng AI" để bắt đầu.' />
        ) : null}

        {completed.length > 0 ? <Text className="px-1 font-body-semibold text-xs text-muted-foreground">KẾ HOẠCH ĐÃ TẠO</Text> : null}
        {completed.map(planCard)}
        {failed.length > 0 ? <Text className="px-1 font-body-semibold text-xs text-muted-foreground">TẠO THẤT BẠI</Text> : null}
        {failed.map(planCard)}
      </ScrollView>

      <BottomSheet open={genOpen} onClose={() => setGenOpen(false)} title="Tạo kế hoạch dinh dưỡng AI">
        <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ gap: 14 }} keyboardShouldPersistTaps="handled">
          <View>
            <FieldLabel>Mục tiêu</FieldLabel>
            <View className="flex-row flex-wrap gap-2">
              {NUTRITION_GOALS.map((g) => (
                <Chip key={g} label={g} active={form.goal === g} onPress={() => set("goal", g)} />
              ))}
            </View>
          </View>
          <View>
            <FieldLabel>Số bữa mỗi ngày</FieldLabel>
            <Stepper value={form.mealsPerDay} min={2} max={6} onChange={(n) => set("mealsPerDay", n)} suffix="bữa" />
          </View>
          <Input label="Calo mỗi ngày (để trống = AI tự tính)" keyboardType="number-pad" value={form.dailyCaloriesTarget} onChangeText={(v) => set("dailyCaloriesTarget", v)} />
          <ChipGroup label="Chế độ ăn" options={DIET_OPTIONS} value={form.dietPreference} onChange={(v) => set("dietPreference", v)} />
          <ChipGroup label="Ngân sách" options={BUDGET_OPTIONS} value={form.budgetLevel} onChange={(v) => set("budgetLevel", v)} />
          <View>
            <FieldLabel>Hạn chế / dị ứng</FieldLabel>
            <View className="flex-row flex-wrap gap-2">
              {RESTRICTION_PRESETS.map((r) => (
                <Chip
                  key={r}
                  label={r}
                  active={form.restrictions.includes(r)}
                  onPress={() => set("restrictions", form.restrictions.includes(r) ? form.restrictions.filter((x) => x !== r) : [...form.restrictions, r])}
                />
              ))}
            </View>
            <View className="mt-2">
              <Input value={form.customRestriction} onChangeText={(v) => set("customRestriction", v)} placeholder="Ghi thêm dị ứng/hạn chế khác…" />
            </View>
          </View>

          <Tappable className="flex-row items-center gap-1" onPress={() => setAdvanced((v) => !v)}>
            {advanced ? <ChevronDown size={14} color="#8b9299" /> : <ChevronRight size={14} color="#8b9299" />}
            <Text className="font-body-semibold text-xs text-muted-foreground">Thông tin nâng cao (không bắt buộc)</Text>
          </Tappable>
          {advanced ? (
            <View className="gap-3">
              <View className="flex-row gap-2">
                <View className="flex-1">
                  <Input label="Cân nặng (kg)" keyboardType="decimal-pad" value={form.weightKg} onChangeText={(v) => set("weightKg", v)} placeholder="70" />
                </View>
                <View className="flex-1">
                  <Input label="Chiều cao (cm)" keyboardType="decimal-pad" value={form.heightCm} onChangeText={(v) => set("heightCm", v)} placeholder="170" />
                </View>
              </View>
              <View className="flex-row gap-2">
                <View className="flex-1">
                  <Input label="Tuổi" keyboardType="number-pad" value={form.age} onChangeText={(v) => set("age", v)} placeholder="25" />
                </View>
                <View className="flex-1">
                  <Input label="% mỡ" keyboardType="decimal-pad" value={form.bodyFatPct} onChangeText={(v) => set("bodyFatPct", v)} placeholder="18" />
                </View>
              </View>
              <ChipGroup label="Giới tính" options={GENDER_OPTIONS_NUTRITION} value={form.gender} onChange={(v) => set("gender", form.gender === v ? "" : v)} />
              <ChipGroup label="Mức vận động" options={ACTIVITY_OPTIONS} value={form.activityLevel} onChange={(v) => set("activityLevel", v)} />
              <View className="flex-row gap-2">
                <View className="flex-1">
                  <Input label="Buổi tập/tuần" keyboardType="number-pad" value={form.trainingDaysPerWeek} onChangeText={(v) => set("trainingDaysPerWeek", v)} placeholder="4" />
                </View>
                <View className="flex-1">
                  <Input label="Phút/buổi" keyboardType="number-pad" value={form.trainingDurationMin} onChangeText={(v) => set("trainingDurationMin", v)} placeholder="60" />
                </View>
              </View>
              <ChipGroup label="Kiểu tập" options={TRAINING_TYPE_OPTIONS} value={form.trainingType} onChange={(v) => set("trainingType", form.trainingType === v ? "" : v)} />
              <ChipGroup label="Giai đoạn" options={PHASE_OPTIONS} value={form.trainingPhase} onChange={(v) => set("trainingPhase", form.trainingPhase === v ? "" : v)} />
              <ChipGroup label="Kinh nghiệm" options={EXPERIENCE_OPTIONS_NUTRITION} value={form.experienceLevel} onChange={(v) => set("experienceLevel", form.experienceLevel === v ? "" : v)} />
              <Input label="Ưu tiên chính" value={form.primaryPriority} onChangeText={(v) => set("primaryPriority", v)} placeholder="VD: giữ cơ khi giảm mỡ" />
              <View className="flex-row gap-2">
                <View className="flex-1">
                  <Input label="Đạm (g)" keyboardType="number-pad" value={form.proteinTargetG} onChangeText={(v) => set("proteinTargetG", v)} placeholder="AI tự tính" />
                </View>
                <View className="flex-1">
                  <Input label="Tinh bột (g)" keyboardType="number-pad" value={form.carbTargetG} onChangeText={(v) => set("carbTargetG", v)} placeholder="AI tự tính" />
                </View>
                <View className="flex-1">
                  <Input label="Béo (g)" keyboardType="number-pad" value={form.fatTargetG} onChangeText={(v) => set("fatTargetG", v)} placeholder="AI tự tính" />
                </View>
              </View>
              {(
                [
                  ["carbsAroundWorkout", "Tinh bột tập trung quanh buổi tập"],
                  ["preworkoutMeal", "Cần bữa trước tập"],
                  ["postworkoutMeal", "Cần bữa sau tập"],
                ] as const
              ).map(([k, label]) => (
                <View key={k} className="flex-row items-center justify-between">
                  <Text className="flex-1 font-body text-sm text-foreground">{label}</Text>
                  <Switch value={form[k]} onValueChange={(v) => set(k, v)} trackColor={{ true: accent.primary, false: darkColors.border }} />
                </View>
              ))}
            </View>
          ) : null}
          <View>
            <FieldLabel>Ghi chú thêm cho AI</FieldLabel>
            <TextArea value={form.notes} onChangeText={(v) => set("notes", v)} rows={2} placeholder="VD: ưu tiên món dễ nấu, ăn được cay…" />
          </View>
          {formError ? <Text className="font-body text-xs text-destructive">{formError}</Text> : null}
          <Button
            full
            size="lg"
            icon={Sparkles}
            disabled={!!formError || generate.isPending || !!processing}
            onPress={() => generate.mutate(buildNutritionPayload(form))}
          >
            {generate.isPending ? "Đang gửi…" : "Tạo kế hoạch"}
          </Button>
        </ScrollView>
      </BottomSheet>

      <BottomSheet open={Boolean(saveFor)} onClose={() => setSaveFor(null)} title="Lưu vào Dinh dưỡng">
        <View className="gap-4">
          <View>
            <FieldLabel>Ngày bắt đầu</FieldLabel>
            <StartDateStrip value={startDate} onChange={setStartDate} />
          </View>
          <View>
            <FieldLabel>Áp dụng trong</FieldLabel>
            <View className="flex-row gap-2">
              {APPLY_SPANS.map((d) => (
                <Chip key={d} label={`${d} ngày`} active={span === d} onPress={() => setSpan(d)} />
              ))}
            </View>
          </View>
          <View className="flex-row items-center justify-between">
            <View className="flex-1 pr-3">
              <Text className="font-body-semibold text-sm text-foreground">Lặp lại thực đơn 7 ngày</Text>
              <Text className="font-body text-xs text-muted-foreground">Ngày thứ 8 quay lại Ngày 1, ngày thứ 9 là Ngày 2…</Text>
            </View>
            <Switch value={repeat} onValueChange={setRepeat} trackColor={{ true: accent.primary, false: darkColors.border }} />
          </View>
          <View className="flex-row items-center justify-between">
            <Text className="flex-1 pr-3 font-body text-sm text-foreground">Thay thế kế hoạch đang áp dụng (nếu có)</Text>
            <Switch value={forceArchive} onValueChange={setForceArchive} trackColor={{ true: accent.primary, false: darkColors.border }} />
          </View>
          <Button full size="lg" icon={CalendarDays} disabled={save.isPending} onPress={() => saveFor && save.mutate(saveFor)}>
            {save.isPending ? "Đang lưu…" : "Lưu kế hoạch"}
          </Button>
        </View>
      </BottomSheet>

      <BottomSheet open={Boolean(adjustFor)} onClose={() => setAdjustFor(null)} title="Điều chỉnh kế hoạch">
        <TextArea value={adjustText} onChangeText={setAdjustText} placeholder="VD: tăng đạm, giảm tinh bột, không dùng cá biển, thêm bữa nhẹ buổi chiều…" />
        <View className="mt-4">
          <Button full size="lg" icon={SlidersHorizontal} disabled={!adjustText.trim() || adjust.isPending} onPress={() => adjustFor && adjust.mutate(adjustFor)}>
            {adjust.isPending ? "Đang gửi…" : "Gửi điều chỉnh"}
          </Button>
        </View>
      </BottomSheet>

      <BottomSheet open={Boolean(archiveFor)} onClose={() => setArchiveFor(null)} title="Ẩn kế hoạch AI?">
        <Text className="mb-4 text-center font-body text-sm text-muted-foreground">
          Kế hoạch đã lưu trong Dinh dưỡng sẽ không bị xoá.
        </Text>
        <Button variant="destructive" full size="lg" disabled={archive.isPending} onPress={() => archiveFor && archive.mutate(archiveFor)}>
          {archive.isPending ? "Đang ẩn…" : "Ẩn kế hoạch"}
        </Button>
      </BottomSheet>
    </>
  );
}

function ChipGroup({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <View>
      <FieldLabel>{label}</FieldLabel>
      <View className="flex-row flex-wrap gap-2">
        {options.map((o) => (
          <Chip key={o.value} label={o.label} active={value === o.value} onPress={() => onChange(o.value)} />
        ))}
      </View>
    </View>
  );
}
