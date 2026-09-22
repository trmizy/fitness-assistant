import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as ImagePicker from "expo-image-picker";
import { AlertTriangle, ArrowLeft, Camera, Check, ChevronDown, ChevronRight, ImageIcon, PencilRuler, Sparkles } from "lucide-react-native";

import { Button, Card, Input, ScreenHeader, Tappable, useToast } from "../../../src/components/ui";
import {
  fitnessAgentService,
  fitnessRoadmapService,
  inbodyService,
  profileService,
  type RoadmapAiDraft,
} from "../../../src/services/api";
import { useWorkspaceAccent } from "../../../src/theme/workspace";
import { designTokens } from "../../../src/theme/colors";
import {
  ACTIVITY_OPTIONS,
  ADAPTIVE_NOTE,
  buildDiagnosisInput,
  draftTotalWeeks,
  FOCUS_LABELS,
  formatDate,
  GOAL_OPTIONS,
  hasMinimumEnergyInputs,
  LEANNESS_LABEL,
  MUSCULARITY_LABEL,
  prefillFromProfileAndInBody,
  roadmapErrorMessage,
  VISUAL_REFERENCE_OPTIONS,
  wizardStepError,
  type WizardBody,
} from "../../../src/features/roadmap/roadmap";
import { EnergyBreakdownCard, StrategyGroups } from "../../../src/features/roadmap/RoadmapCards";
import { ROADMAP_KEY } from "../../../src/features/roadmap/RoadmapJourney";
import { Chip, FieldLabel, OptionCard, Stepper } from "../../../src/features/plans/PlanWidgets";

const STEP_LABELS = ["Thông tin cơ bản", "Tập luyện & Hoạt động", "Mục tiêu", "Báo cáo & Lộ trình"];

type GoalAttrs = { muscularity: string | null; relativeLeanness: string | null; focusMuscles: string[]; confidence: number; usable: boolean };

/**
 * WB-11 — "Tạo lộ trình cùng Gymini" (web's GuidedRoadmapWizard): 4 steps, one screen.
 * Numbers come only from the server: the profile + latest InBody pre-fill step 1, the read-only
 * `POST /fitness-roadmaps/diagnosis` powers the energy breakdown (step 2) and the diagnosis
 * (step 4), `POST /fitness-roadmaps/projection` the per-phase forecast; the phase plan itself is the
 * AI draft (`/fitness-roadmaps/ai-draft`, an LLM call). Nothing here computes BMR/TDEE/calories.
 *
 * When the AI draft cannot be produced (no LLM reachable), step 4 says so and offers the
 * advanced form, which needs no AI.
 */
export default function RoadmapWizardScreen() {
  const insets = useSafeAreaInsets();
  const accent = useWorkspaceAccent();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [step, setStep] = useState(1);
  const [b, setB] = useState<WizardBody>({
    weightKg: "",
    heightCm: "",
    age: "",
    gender: "",
    bodyFatMethod: "manual",
    bodyFatPct: "",
    inbodyBodyFatPct: null,
    activityLevel: "",
    trainingDaysPerWeek: 3,
    dailyGoalSteps: 8000,
    goal: "WEIGHT_LOSS",
    targetWeightKg: "",
    targetBodyFatPercent: "",
    timeframeWeeks: 24,
  });
  const [inbodyDate, setInbodyDate] = useState<string | null>(null);
  const [prefilled, setPrefilled] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [goalAttrs, setGoalAttrs] = useState<GoalAttrs | null>(null);
  const [goalNote, setGoalNote] = useState<string | null>(null);
  const [goalImageStatus, setGoalImageStatus] = useState<"idle" | "analyzing" | "unusable">("idle");
  const [name, setName] = useState("Lộ trình của tôi");
  const [draft, setDraft] = useState<RoadmapAiDraft | null>(null);
  const set = <K extends keyof WizardBody>(k: K, v: WizardBody[K]) => setB((prev) => ({ ...prev, [k]: v }));

  const profileQuery = useQuery({
    queryKey: ["profile", "me"],
    queryFn: () => profileService.getProfile().then((r: any) => r?.profile ?? null),
    retry: false,
  });
  const inbodyQuery = useQuery({ queryKey: ["inbody-history"], queryFn: () => inbodyService.getHistory(), retry: false });

  // One-time prefill once both sources settle (success OR failure) — the client may have neither.
  const sourcesSettled = !profileQuery.isLoading && !inbodyQuery.isLoading;
  if (!prefilled && sourcesSettled) {
    const history: any = inbodyQuery.data;
    const list = Array.isArray(history) ? history : Array.isArray(history?.data) ? history.data : [];
    const { inbodyDate: d, ...rest } = prefillFromProfileAndInBody(profileQuery.data, list);
    setB((prev) => ({ ...prev, ...rest }));
    setInbodyDate(d ?? null);
    setPrefilled(true);
  }

  const diagnosisInput = useMemo(() => buildDiagnosisInput(b), [b]);
  const minimum = hasMinimumEnergyInputs(b);
  const diagnosisQuery = useQuery({
    queryKey: [...ROADMAP_KEY, "wizard-diagnosis", JSON.stringify(diagnosisInput)],
    queryFn: () => fitnessRoadmapService.getDiagnosis(diagnosisInput),
    enabled: minimum && step >= 2,
    staleTime: 15_000,
    retry: false,
  });

  const draftMutation = useMutation({
    mutationFn: () =>
      fitnessRoadmapService.generateAiDraft({
        goalType: b.goal,
        timeframeWeeks: b.timeframeWeeks,
        goalVisualAttributes: goalAttrs
          ? { muscularity: goalAttrs.muscularity, relativeLeanness: goalAttrs.relativeLeanness, focusMuscles: goalAttrs.focusMuscles }
          : undefined,
        targetWeightKg: b.targetWeightKg ? Number(b.targetWeightKg) : undefined,
        targetBodyFatPercent: b.targetBodyFatPercent ? Number(b.targetBodyFatPercent) : undefined,
        trainingDaysPerWeek: b.trainingDaysPerWeek,
      }),
    onSuccess: setDraft,
  });
  const { mutate: requestDraft, isPending: drafting, isIdle: draftIdle } = draftMutation;
  useEffect(() => {
    if (step === 4 && !draft && draftIdle) requestDraft();
  }, [step, draft, draftIdle, requestDraft]);

  const forecastPhases = draft
    ? draft.phases.map((p, i) => ({ phaseIndex: i + 1, phaseType: p.phaseType, name: p.name, plannedStartAt: p.plannedStartAt, plannedEndAt: p.plannedEndAt }))
    : null;
  const forecastQuery = useQuery({
    queryKey: [...ROADMAP_KEY, "wizard-forecast", JSON.stringify(diagnosisInput), JSON.stringify(forecastPhases)],
    queryFn: () =>
      fitnessRoadmapService.getPhaseForecast({
        weightKg: diagnosisInput.weightKg,
        heightCm: diagnosisInput.heightCm,
        age: diagnosisInput.age,
        gender: diagnosisInput.gender,
        bodyFatPct: diagnosisInput.bodyFatPct,
        bodyFatMethod: diagnosisInput.bodyFatMethod,
        activityLevel: diagnosisInput.activityLevel,
        phases: forecastPhases!,
      }),
    enabled: Boolean(forecastPhases) && minimum,
    staleTime: 15_000,
    retry: false,
  });

  const acceptPayload = () => ({
    name: name.trim() || "Lộ trình của tôi",
    goalType: draft!.goalType,
    plannedStartAt: draft!.plannedStartAt,
    phases: draft!.phases,
    configuration: {
      aiDraft: {
        summary: draft!.summary,
        reasoningSummary: draft!.reasoningSummary,
        confidence: draft!.confidence,
        warnings: draft!.warnings,
        assumptions: draft!.assumptions,
      },
      // Snapshots of what the client saw at creation — never authoritative values.
      diagnosisSnapshot: diagnosisQuery.data ?? null,
      roadmapProjectionSnapshot: forecastQuery.data ?? null,
    },
  });
  const done = (msg: string) => {
    toast.show(msg, "success");
    void queryClient.invalidateQueries({ queryKey: ROADMAP_KEY });
    router.replace("/client/roadmap");
  };
  const save = useMutation({
    mutationFn: () => fitnessRoadmapService.acceptAiDraft(acceptPayload()),
    onSuccess: () => done("Đã lưu lộ trình — xem lại và bắt đầu khi bạn sẵn sàng"),
    onError: (e) => toast.show(roadmapErrorMessage(e, "Không thể lưu lộ trình"), "danger"),
  });
  const start = useMutation({
    mutationFn: async () => {
      const accepted = await fitnessRoadmapService.acceptAiDraft(acceptPayload());
      return fitnessRoadmapService.activate(accepted.roadmap.id);
    },
    onSuccess: () => done("Đã bắt đầu lộ trình!"),
    onError: (e) => toast.show(roadmapErrorMessage(e, "Không thể bắt đầu lộ trình"), "danger"),
  });

  const pickGoalImage = async (source: "camera" | "library") => {
    const perm = source === "camera" ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      toast.show(source === "camera" ? "Cần quyền camera để chụp ảnh." : "Cần quyền truy cập ảnh.", "danger");
      return;
    }
    const options = { quality: 0.6, base64: true, allowsEditing: true } as const;
    const res = source === "camera" ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync({ ...options, mediaTypes: ["images"] });
    const asset = res.canceled ? null : res.assets?.[0];
    if (!asset?.base64) return;
    // Same 4 MB cap web enforces before upload (base64 is ~4/3 of the bytes).
    if (asset.base64.length * 0.75 > 4 * 1024 * 1024) {
      toast.show("Chọn ảnh dưới 4 MB.", "danger");
      return;
    }
    setGoalImageStatus("analyzing");
    try {
      const reply = await fitnessAgentService.image({ mediaType: asset.mimeType === "image/png" ? "image/png" : "image/jpeg", base64: asset.base64 });
      const attrs = reply?.block?.attributes;
      setGoalNote(reply?.block?.note ?? null);
      if (!attrs || attrs.usable === false) {
        setGoalAttrs(null);
        setGoalImageStatus("unusable");
        return;
      }
      setGoalAttrs(attrs);
      setGoalImageStatus("idle");
    } catch {
      setGoalAttrs(null);
      setGoalNote(null);
      setGoalImageStatus("unusable");
      toast.show("Không thể phân tích ảnh — bạn vẫn có thể tiếp tục không cần ảnh.", "danger");
    }
  };

  const next = () => {
    const err = wizardStepError(step, b);
    if (err) {
      toast.show(err, "danger");
      return;
    }
    setStep((s) => Math.min(4, s + 1));
  };
  const back = () => (step === 1 ? router.back() : setStep((s) => s - 1));
  const diag = diagnosisQuery.data;

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title="Tạo lộ trình cùng Gymini" onBack={back} />
      <View className="flex-row gap-1.5 px-5 pt-4">
        {STEP_LABELS.map((l, i) => (
          <View key={l} className={`h-1.5 flex-1 rounded-full ${i + 1 <= step ? "bg-primary" : "bg-panel"}`} />
        ))}
      </View>
      <Text className="px-5 pt-2 font-body-semibold text-xs text-muted-foreground">{`Bước ${step}/4 · ${STEP_LABELS[step - 1]}`}</Text>

      <ScrollView contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
        {step === 1 ? (
          <>
            <View className="flex-row gap-2">
              <View className="flex-1">
                <Input label="Cân nặng (kg)" keyboardType="decimal-pad" value={b.weightKg} onChangeText={(v) => set("weightKg", v)} />
              </View>
              <View className="flex-1">
                <Input label="Chiều cao (cm)" keyboardType="decimal-pad" value={b.heightCm} onChangeText={(v) => set("heightCm", v)} />
              </View>
            </View>
            <Input label="Tuổi" keyboardType="number-pad" value={b.age} onChangeText={(v) => set("age", v)} />
            <View>
              <FieldLabel>Giới tính</FieldLabel>
              <View className="flex-row gap-2">
                {(["MALE", "FEMALE", "OTHER"] as const).map((g) => (
                  <Chip key={g} label={g === "MALE" ? "Nam" : g === "FEMALE" ? "Nữ" : "Khác"} active={b.gender === g} onPress={() => set("gender", g)} />
                ))}
              </View>
            </View>
            <View>
              <FieldLabel>Tỷ lệ mỡ cơ thể (không bắt buộc)</FieldLabel>
              {b.bodyFatMethod === "inbody" && b.inbodyBodyFatPct != null ? (
                <Card className="flex-row items-center justify-between gap-2 border-primary/30 bg-primary/5 p-3">
                  <View className="flex-1">
                    <Text className="font-body-semibold text-sm text-foreground">{`${b.inbodyBodyFatPct}% (từ InBody)`}</Text>
                    <Text className="font-body text-[11px] text-muted-foreground">{`Đo lúc ${formatDate(inbodyDate)} — dữ liệu đo thật, ưu tiên hơn ước lượng`}</Text>
                  </View>
                  <Button size="sm" variant="ghost" onPress={() => set("bodyFatMethod", "manual")}>
                    Nhập khác
                  </Button>
                </Card>
              ) : (
                <View className="gap-2">
                  <View className="flex-row flex-wrap gap-2">
                    <Chip label="Nhập số liệu" active={b.bodyFatMethod === "manual"} onPress={() => set("bodyFatMethod", "manual")} />
                    <Chip label="Ước lượng qua hình tham khảo" active={b.bodyFatMethod === "visual_reference"} onPress={() => set("bodyFatMethod", "visual_reference")} />
                    {b.inbodyBodyFatPct != null ? <Chip label="Dùng lại số liệu InBody" active={false} onPress={() => set("bodyFatMethod", "inbody")} /> : null}
                  </View>
                  {b.bodyFatMethod === "manual" ? (
                    <Input keyboardType="decimal-pad" placeholder="VD: 20" value={b.bodyFatPct} onChangeText={(v) => set("bodyFatPct", v)} />
                  ) : null}
                  {b.bodyFatMethod === "visual_reference" ? (
                    <>
                      <View className="flex-row flex-wrap gap-2">
                        {VISUAL_REFERENCE_OPTIONS.map((o) => (
                          <View key={o.pct} className="w-[48%]">
                            <OptionCard label={o.label} desc={o.desc} active={Number(b.bodyFatPct) === o.pct} onPress={() => set("bodyFatPct", String(o.pct))} />
                          </View>
                        ))}
                      </View>
                      <Text className="font-body text-[11px] text-muted-foreground">Chỉ là ước lượng tham khảo, không thay thế đo InBody hoặc thiết bị chuyên dụng.</Text>
                    </>
                  ) : null}
                </View>
              )}
            </View>
          </>
        ) : step === 2 ? (
          <>
            <View>
              <FieldLabel>Mức độ vận động hằng ngày</FieldLabel>
              <View className="gap-2">
                {ACTIVITY_OPTIONS.map((o) => (
                  <OptionCard key={o.key} label={o.label} desc={o.hint} active={b.activityLevel === o.key} onPress={() => set("activityLevel", o.key)} />
                ))}
              </View>
            </View>
            <View>
              <FieldLabel>Số ngày tập mỗi tuần</FieldLabel>
              <Stepper value={b.trainingDaysPerWeek} min={0} max={7} suffix="ngày" onChange={(n) => set("trainingDaysPerWeek", n)} />
            </View>
            <View>
              <FieldLabel>Mục tiêu bước chân mỗi ngày</FieldLabel>
              <View className="flex-row flex-wrap gap-2">
                {[4000, 6000, 8000, 10000, 12000].map((s) => (
                  <Chip key={s} label={s.toLocaleString("vi-VN")} active={b.dailyGoalSteps === s} onPress={() => set("dailyGoalSteps", s)} />
                ))}
              </View>
            </View>
            <EnergyBreakdownCard breakdown={diag?.energyBreakdown ?? null} insufficientInputs={!minimum} loading={minimum && diagnosisQuery.isLoading} />
          </>
        ) : step === 3 ? (
          <>
            <View className="gap-2">
              <FieldLabel>Mục tiêu của bạn</FieldLabel>
              {GOAL_OPTIONS.map((g) => (
                <OptionCard key={g.key} label={`${g.emoji} ${g.label}`} desc={g.desc} active={b.goal === g.key} onPress={() => set("goal", g.key)} />
              ))}
            </View>
            <Input label="Cân nặng mục tiêu (kg, không bắt buộc)" keyboardType="decimal-pad" value={b.targetWeightKg} onChangeText={(v) => set("targetWeightKg", v)} />
            <View>
              <FieldLabel>Thời gian mong muốn</FieldLabel>
              <Stepper value={b.timeframeWeeks} min={1} max={104} suffix="tuần" onChange={(n) => set("timeframeWeeks", n)} />
            </View>
            <Tappable className="flex-row items-center gap-1" onPress={() => setShowAdvanced((v) => !v)}>
              {showAdvanced ? <ChevronDown size={14} color="#8b9299" /> : <ChevronRight size={14} color="#8b9299" />}
              <Text className="font-body-semibold text-xs text-muted-foreground">Tuỳ chọn nâng cao (tỷ lệ mỡ mục tiêu, FFMI)</Text>
            </Tappable>
            {showAdvanced ? (
              <View className="gap-2">
                <Input label="Tỷ lệ mỡ mục tiêu (%)" keyboardType="decimal-pad" value={b.targetBodyFatPercent} onChangeText={(v) => set("targetBodyFatPercent", v)} />
                {diag?.current.ffmi ? <Text className="font-body text-xs text-muted-foreground">{`FFMI hiện tại: ${diag.current.ffmi.normalizedFfmi}`}</Text> : null}
                {diag?.target.ffmi ? <Text className="font-body text-xs text-muted-foreground">{`FFMI mục tiêu: ${diag.target.ffmi.normalizedFfmi}`}</Text> : null}
              </View>
            ) : null}
            <View className="gap-2">
              <FieldLabel>Ảnh mục tiêu (không bắt buộc)</FieldLabel>
              <View className="flex-row gap-2">
                <Button size="sm" variant="secondary" icon={Camera} disabled={goalImageStatus === "analyzing"} onPress={() => void pickGoalImage("camera")}>
                  Chụp ảnh
                </Button>
                <Button size="sm" variant="secondary" icon={ImageIcon} disabled={goalImageStatus === "analyzing"} onPress={() => void pickGoalImage("library")}>
                  Chọn ảnh
                </Button>
              </View>
              <Text className="font-body text-[11px] text-muted-foreground">
                Ảnh chỉ để gợi ý phong cách hình thể mong muốn (mức cơ bắp, độ săn chắc) — không phải phép đo cơ thể, không dùng để chẩn đoán hay so sánh với người khác.
              </Text>
              {goalImageStatus === "analyzing" ? (
                <View className="flex-row items-center gap-2">
                  <ActivityIndicator color={accent.primary} />
                  <Text className="font-body text-xs text-muted-foreground">Đang phân tích ảnh…</Text>
                </View>
              ) : null}
              {goalImageStatus === "unusable" ? <Text className="font-body text-xs text-warning">Ảnh không dùng được — bạn vẫn có thể tiếp tục không cần ảnh.</Text> : null}
              {goalAttrs ? (
                <Card className="gap-2 p-3">
                  <Text className="font-body-semibold text-xs text-primary">Đã phân tích ảnh mục tiêu</Text>
                  <Text className="font-body text-xs text-foreground">
                    {`Mức cơ bắp: ${goalAttrs.muscularity ? MUSCULARITY_LABEL[goalAttrs.muscularity] ?? goalAttrs.muscularity : "—"} · Độ săn chắc: ${goalAttrs.relativeLeanness ? LEANNESS_LABEL[goalAttrs.relativeLeanness] ?? goalAttrs.relativeLeanness : "—"} · Tin cậy ${Math.round(goalAttrs.confidence * 100)}%`}
                  </Text>
                  {goalAttrs.focusMuscles.length ? (
                    <Text className="font-body text-xs text-muted-foreground">{`Nhóm cơ nổi bật: ${goalAttrs.focusMuscles.map((m) => FOCUS_LABELS[m] ?? m).join(", ")}`}</Text>
                  ) : null}
                  {goalNote ? <Text className="font-body text-[11px] text-muted-foreground">{goalNote}</Text> : null}
                </Card>
              ) : null}
            </View>
          </>
        ) : (
          <>
            <Card className="gap-2 p-4">
              <Text className="font-body-semibold text-sm text-foreground">Chẩn đoán thể trạng</Text>
              {!diag ? (
                diagnosisQuery.isError ? (
                  <Text className="font-body text-xs text-destructive">{roadmapErrorMessage(diagnosisQuery.error, "Không tính được chẩn đoán.")}</Text>
                ) : (
                  <ActivityIndicator color={accent.primary} />
                )
              ) : (
                <>
                  <View className="flex-row flex-wrap gap-2">
                    {(
                      [
                        ["Cân nặng", diag.current.weightKg != null ? `${diag.current.weightKg} kg` : null, diag.target.weightKg != null ? `${diag.target.weightKg} kg` : null],
                        ["Tỷ lệ mỡ", diag.current.bodyFatPct != null ? `${diag.current.bodyFatPct}%` : null, diag.target.bodyFatPct != null ? `${diag.target.bodyFatPct}%` : null],
                        ["Khối nạc (FFMI)", diag.current.ffmi ? String(diag.current.ffmi.normalizedFfmi) : null, diag.target.ffmi ? String(diag.target.ffmi.normalizedFfmi) : null],
                        ["TDEE hiện tại", diag.energyBreakdown ? `${diag.energyBreakdown.tdee.toLocaleString("vi-VN")} kcal` : null, null],
                      ] as [string, string | null, string | null][]
                    ).map(([k, cur, tgt]) => (
                      <View key={k} className="w-[48%] rounded-xl bg-panel p-2.5">
                        <Text className="font-body text-[10px] text-muted-foreground">{k}</Text>
                        <Text className="font-body-semibold text-xs text-foreground">{`${cur ?? "Không đủ dữ liệu"}${tgt ? ` → ${tgt}` : ""}`}</Text>
                      </View>
                    ))}
                  </View>
                  {diag.targetRealism.warnings.map((w, i) => (
                    <View key={i} className="flex-row gap-2">
                      <AlertTriangle size={14} color={designTokens.warning} />
                      <Text className="flex-1 font-body text-xs text-foreground">{w}</Text>
                    </View>
                  ))}
                  {diag.reasoning ? <Text className="font-body text-xs text-muted-foreground">{diag.reasoning}</Text> : null}
                </>
              )}
            </Card>

            <Card className="gap-3 p-4">
              <Text className="font-body-semibold text-sm text-foreground">Báo cáo lộ trình</Text>
              {drafting ? (
                <View className="flex-row items-center gap-2">
                  <ActivityIndicator color={accent.primary} />
                  <Text className="font-body text-xs text-muted-foreground">Gymini đang soạn lộ trình… (có thể mất tới 2 phút)</Text>
                </View>
              ) : draftMutation.isError ? (
                <View className="gap-2">
                  <Text className="font-body text-xs text-destructive">
                    {roadmapErrorMessage(draftMutation.error, "AI chưa soạn được lộ trình lúc này.")}
                  </Text>
                  <View className="flex-row flex-wrap gap-2">
                    <Button size="sm" variant="secondary" onPress={() => requestDraft()}>
                      Thử lại
                    </Button>
                    <Button size="sm" variant="ghost" icon={PencilRuler} onPress={() => router.replace("/client/roadmap/create")}>
                      Tự chọn từng giai đoạn
                    </Button>
                  </View>
                </View>
              ) : draft ? (
                <>
                  <Text className="font-body text-sm text-foreground">{draft.summary}</Text>
                  <View className="flex-row gap-2">
                    <View className="flex-1 rounded-xl bg-panel p-2.5">
                      <Text className="font-body text-[10px] text-muted-foreground">Tổng thời gian</Text>
                      <Text className="font-body-semibold text-xs text-foreground">{`${draftTotalWeeks(draft.phases)} tuần`}</Text>
                    </View>
                    <View className="flex-1 rounded-xl bg-panel p-2.5">
                      <Text className="font-body text-[10px] text-muted-foreground">Dự kiến kết thúc</Text>
                      <Text className="font-body-semibold text-xs text-foreground">{formatDate(draft.phases[draft.phases.length - 1]?.plannedEndAt)}</Text>
                    </View>
                  </View>
                  {forecastQuery.isLoading ? (
                    <ActivityIndicator color={accent.primary} />
                  ) : forecastQuery.data ? (
                    <StrategyGroups result={forecastQuery.data} />
                  ) : forecastQuery.isError ? (
                    <Text className="font-body text-xs text-muted-foreground">
                      {`Chưa tính được dự kiến từng giai đoạn: ${roadmapErrorMessage(forecastQuery.error, "lỗi không xác định")}`}
                    </Text>
                  ) : null}
                  {draft.warnings.map((w, i) => (
                    <View key={i} className="flex-row gap-2">
                      <AlertTriangle size={14} color={designTokens.warning} />
                      <Text className="flex-1 font-body text-xs text-foreground">{w}</Text>
                    </View>
                  ))}
                  <Text className="rounded-xl bg-primary/10 p-3 font-body text-xs text-muted-foreground">{ADAPTIVE_NOTE}</Text>
                  <Input label="Tên lộ trình" value={name} onChangeText={setName} />
                </>
              ) : null}
            </Card>
          </>
        )}
      </ScrollView>

      <View className="border-t border-border bg-glass px-5 pt-3" style={{ paddingBottom: insets.bottom + 12 }}>
        {step < 4 ? (
          <View className="flex-row gap-3">
            <View className="flex-1">
              <Button variant="secondary" full icon={ArrowLeft} disabled={step === 1} onPress={back}>
                Quay lại
              </Button>
            </View>
            <View className="flex-1">
              <Button full onPress={next}>
                Tiếp tục
              </Button>
            </View>
          </View>
        ) : draft ? (
          <View className="gap-2">
            <Button full size="lg" icon={Check} disabled={start.isPending || save.isPending} onPress={() => start.mutate()}>
              {start.isPending ? "Đang bắt đầu…" : "Bắt đầu lộ trình"}
            </Button>
            <Button variant="ghost" full disabled={save.isPending || start.isPending} onPress={() => save.mutate()}>
              {save.isPending ? "Đang lưu…" : "Lưu để xem sau"}
            </Button>
          </View>
        ) : (
          <Button variant="secondary" full icon={Sparkles} disabled={drafting} onPress={() => setStep(3)}>
            Quay lại chỉnh sửa mục tiêu
          </Button>
        )}
      </View>
    </View>
  );
}
