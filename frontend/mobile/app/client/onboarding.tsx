import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Animated, {
  FadeInRight,
  FadeOutLeft,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import {
  ArrowRight,
  CalendarDays,
  Check,
  ChevronLeft,
  Dumbbell,
  ListChecks,
  Ruler,
  ShieldAlert,
  Target,
  type LucideIcon,
} from "lucide-react-native";

import { Button, Input, Tappable, useToast } from "../../src/components/ui";
import { EquipmentPicker, TrainingLocationPresetRow } from "../../src/components/EquipmentPicker";
import { useApp } from "../../src/context/AppContext";
import {
  equipmentService,
  profileService,
  type EquipmentCatalogItem,
} from "../../src/services/api";
import { ROLE_HOME } from "../../src/config/landing";
import { haptics } from "../../src/lib/haptics";
import { cmFromFeetInches, feetInchesFromCm, kgFromLb, lbFromKg } from "../../src/utils/units";
import { useWorkspaceAccent } from "../../src/theme/workspace";
import {
  buildOnboardingPayload,
  canAdvanceOnboardingStep,
  normalizeDecimal,
} from "../../src/features/onboarding/onboardingPayload";

/**
 * SH-03 — first-run onboarding wizard (Phase 5, per Ngài's decision 2026-09-15).
 *
 * Two sources, split the way the migration plan orders authority:
 * - **Visual:** `New Frontend/src/screens/SetupWizard.tsx` — segmented progress bar with "Bỏ qua",
 *   an icon tile + large title per step, full-width option cards with a check circle, one bottom
 *   action, and a 220ms slide between steps.
 * - **Behaviour and data:** web's `OnboardingWizardPage.tsx`. The reference's four quick questions
 *   ("Tăng sức mạnh", "2 buổi/tuần", "Bạn tập ở đâu?") are not what the backend stores — the plan
 *   generator and nutrition math read experienceLevel/goal enums, real weekday lists, catalog
 *   equipment ids, a safety screening and body metrics. Mobile keeps all six of web's steps and every
 *   field, dressed in the reference's layout; the reference's "where do you train" question survives
 *   as the equipment step's location presets.
 *
 * Carried over from web deliberately:
 * - Writes through the SAME `PUT /profile/me` Profile uses, and equipment only through
 *   `PUT /equipment/me` (which syncs the legacy free-text field server-side) — one write path each.
 * - "Bỏ qua" saves whatever was filled and sets `hasCompletedOnboarding`, otherwise RequireOnboarding
 *   would bounce the user straight back here and skipping would be a dead end.
 * - The fresh profile goes into the query cache SYNCHRONOUSLY before navigating — RequireOnboarding
 *   reads that key immediately on the next route and would otherwise see the stale `false`.
 * - activityLevel is required on the body step and never defaulted (a silent default defeated the
 *   nutrition safety net once on web). Safety screening is recorded only if the step was reached.
 * - A per-user draft survives the app being closed mid-wizard: AsyncStorage here, localStorage on web.
 *
 * "Đăng xuất" stays on the first step even though the reference has none: until the Profile screen
 * is built (Phase 9) this is the only place in the app a signed-in client can log out.
 */

type StepKey = "level" | "schedule" | "equipment" | "safety" | "body" | "review";

const STEPS: { key: StepKey; title: string; subtitle: string; icon: LucideIcon }[] = [
  {
    key: "level",
    title: "Trình độ & mục tiêu",
    subtitle: "Để lịch tập bắt đầu đúng sức của bạn.",
    icon: Target,
  },
  {
    key: "schedule",
    title: "Lịch tập của bạn",
    subtitle: "Bạn tập được những ngày nào, mỗi buổi bao lâu?",
    icon: CalendarDays,
  },
  {
    key: "equipment",
    title: "Bạn tập ở đâu?",
    subtitle: "Chọn nơi tập để gợi ý sẵn thiết bị, rồi chỉnh lại nếu cần.",
    icon: Dumbbell,
  },
  {
    key: "safety",
    title: "Sức khoẻ & thi đấu",
    subtitle: "Giúp hệ thống đưa lời khuyên thận trọng khi cần.",
    icon: ShieldAlert,
  },
  {
    key: "body",
    title: "Chỉ số cơ thể",
    subtitle: "Dùng để tính nhu cầu năng lượng chính xác hơn.",
    icon: Ruler,
  },
  {
    key: "review",
    title: "Xem lại",
    subtitle: "Kiểm tra lại thông tin trước khi hoàn tất.",
    icon: ListChecks,
  },
];

const EXPERIENCE_LEVELS = [
  { key: "BEGINNER", label: "Mới bắt đầu", desc: "Dưới 6 tháng tập luyện có hệ thống" },
  { key: "INTERMEDIATE", label: "Đã biết tập", desc: "6 tháng - 2 năm, đã quen kỹ thuật cơ bản" },
  { key: "ADVANCED", label: "Nâng cao", desc: "2+ năm, tập luyện có chu kỳ" },
];

const GOAL_OPTIONS = [
  { key: "WEIGHT_LOSS", label: "Giảm mỡ", emoji: "🔥" },
  { key: "MUSCLE_GAIN", label: "Tăng cơ", emoji: "💪" },
  { key: "MAINTENANCE", label: "Duy trì vóc dáng", emoji: "⚖️" },
  { key: "ATHLETIC_PERFORMANCE", label: "Hiệu suất thể thao", emoji: "🏆" },
];

const WEEKDAY_OPTIONS = [
  { value: 1, label: "T2" },
  { value: 2, label: "T3" },
  { value: 3, label: "T4" },
  { value: 4, label: "T5" },
  { value: 5, label: "T6" },
  { value: 6, label: "T7" },
  { value: 0, label: "CN" },
];

const SPLIT_OPTIONS = ["Full Body", "Upper/Lower", "Push/Pull/Legs", "Bro Split", "Chưa xác định"];

const ACTIVITY_LEVELS = [
  { key: "SEDENTARY", label: "Ít vận động", desc: "Công việc/sinh hoạt ít di chuyển" },
  { key: "LIGHTLY_ACTIVE", label: "Vận động nhẹ", desc: "Đi lại, đứng nhiều nhưng không gắng sức" },
  { key: "MODERATELY_ACTIVE", label: "Vận động vừa", desc: "Đi bộ/công việc chân tay mức trung bình" },
  { key: "VERY_ACTIVE", label: "Năng động", desc: "Công việc/sinh hoạt đòi hỏi thể lực đều đặn" },
  { key: "EXTREMELY_ACTIVE", label: "Cực kỳ năng động", desc: "Lao động chân tay nặng hoặc vận động viên" },
];

const GENDER_OPTIONS = [
  { key: "MALE", label: "Nam" },
  { key: "FEMALE", label: "Nữ" },
  { key: "OTHER", label: "Khác" },
];

// Product wording inspired by PAR-Q's five risk themes — NOT a copy of the clinical tool. `key` is
// what gets stored (safetyScreeningFlags), never the label, so a copy edit cannot make old data lie.
const SAFETY_QUESTIONS = [
  { key: "heart_condition", label: "Bạn từng được bác sĩ chẩn đoán mắc bệnh tim mạch, hoặc được khuyến cáo chỉ nên vận động theo chỉ định của bác sĩ?" },
  { key: "chest_pain", label: "Bạn có từng thấy đau tức ngực khi vận động thể chất không?" },
  { key: "dizziness_fainting", label: "Bạn có hay mất thăng bằng do chóng mặt, hoặc từng ngất xỉu không?" },
  { key: "bone_joint", label: "Bạn có vấn đề xương khớp mà việc tăng cường độ tập luyện có thể khiến nặng hơn không?" },
  { key: "doctor_medication", label: "Bạn có đang dùng thuốc theo chỉ định của bác sĩ liên quan đến tim mạch/huyết áp không?" },
];

const REVIEW_STEP = STEPS.length - 1;

export default function ClientOnboardingScreen() {
  const { user, logout } = useApp();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const [step, setStep] = useState(0);

  // Every step starts at its top. The ScrollView is shared across steps, so without this a long step
  // (body metrics) left the next one scrolled down with its icon tile under the progress bar.
  const scrollRef = useRef<ScrollView>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [step]);

  const profileQuery = useQuery({
    queryKey: ["profile", user?.id],
    queryFn: () => profileService.getProfile().then((res: any) => res.profile),
    enabled: !!user?.id,
  });
  const catalogQuery = useQuery({
    queryKey: ["equipment", "catalog"],
    queryFn: () => equipmentService.getCatalog(),
  });
  const myEquipmentQuery = useQuery({
    queryKey: ["equipment", "mine"],
    queryFn: () => equipmentService.getMyEquipment(),
    enabled: !!user?.id,
  });
  const catalog: EquipmentCatalogItem[] = catalogQuery.data ?? [];

  const [experienceLevel, setExperienceLevel] = useState("");
  const [goal, setGoal] = useState("");
  const [trainingDays, setTrainingDays] = useState<number[]>([]);
  const [sessionDurationMinutes, setSessionDurationMinutes] = useState("60");
  // "auto" sends preferredSplit: null — nobody sees split jargon unless they ask for manual control.
  const [splitMode, setSplitMode] = useState<"auto" | "manual">("auto");
  const [preferredSplit, setPreferredSplit] = useState("");
  const [equipment, setEquipment] = useState<Set<string>>(new Set());
  const [injuriesText, setInjuriesText] = useState("");
  const [competesInSport, setCompetesInSport] = useState(false);
  // Distinguishes "screened, no concerns" (CLEARED) from "never reached the step" — an empty Set
  // alone cannot tell those apart.
  const [safetyFlags, setSafetyFlags] = useState<Set<string>>(new Set());
  const [safetyStepReached, setSafetyStepReached] = useState(false);
  const [activityLevel, setActivityLevel] = useState("");
  const [age, setAge] = useState("");
  const [gender, setGender] = useState("");
  const [heightCm, setHeightCm] = useState(""); // canonical cm
  const [currentWeight, setCurrentWeight] = useState(""); // canonical kg
  const [targetWeight, setTargetWeight] = useState(""); // canonical kg
  const [heightUnit, setHeightUnit] = useState<"cm" | "ftin">("cm");
  const [weightUnit, setWeightUnit] = useState<"kg" | "lb">("kg");
  const [heightFt, setHeightFt] = useState("");
  const [heightIn, setHeightIn] = useState("");

  // ── Draft: restore once, then persist every change ───────────────────────────────────────
  const draftKey = user?.id ? `onboarding-draft-${user.id}` : null;
  const [draftRestored, setDraftRestored] = useState(false);
  const [draftLoadAttempted, setDraftLoadAttempted] = useState(false);

  useEffect(() => {
    if (!draftKey || draftLoadAttempted) return;
    let cancelled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(draftKey);
        if (cancelled || !raw) return;
        const d = JSON.parse(raw);
        if (typeof d !== "object" || d === null) return;
        if (d.experienceLevel) setExperienceLevel(d.experienceLevel);
        if (d.goal) setGoal(d.goal);
        if (Array.isArray(d.trainingDays)) setTrainingDays(d.trainingDays);
        if (d.sessionDurationMinutes) setSessionDurationMinutes(d.sessionDurationMinutes);
        if (d.splitMode === "manual" || d.splitMode === "auto") setSplitMode(d.splitMode);
        if (d.preferredSplit) setPreferredSplit(d.preferredSplit);
        if (Array.isArray(d.equipment)) setEquipment(new Set(d.equipment));
        if (typeof d.injuriesText === "string") setInjuriesText(d.injuriesText);
        if (typeof d.competesInSport === "boolean") setCompetesInSport(d.competesInSport);
        if (Array.isArray(d.safetyFlags)) setSafetyFlags(new Set(d.safetyFlags));
        if (typeof d.safetyStepReached === "boolean") setSafetyStepReached(d.safetyStepReached);
        if (d.activityLevel) setActivityLevel(d.activityLevel);
        if (d.age) setAge(d.age);
        if (d.gender) setGender(d.gender);
        if (d.heightCm) setHeightCm(d.heightCm);
        if (d.currentWeight) setCurrentWeight(d.currentWeight);
        if (d.targetWeight) setTargetWeight(d.targetWeight);
        if (d.heightUnit === "cm" || d.heightUnit === "ftin") setHeightUnit(d.heightUnit);
        if (d.weightUnit === "kg" || d.weightUnit === "lb") setWeightUnit(d.weightUnit);
        if (d.heightFt) setHeightFt(d.heightFt);
        if (d.heightIn) setHeightIn(d.heightIn);
        if (typeof d.step === "number" && d.step >= 0 && d.step <= REVIEW_STEP) setStep(d.step);
        setDraftRestored(true);
        toast.show("Đã khôi phục tiến trình thiết lập trước đó của bạn");
      } catch {
        // Corrupt or unreadable draft — start fresh.
      } finally {
        if (!cancelled) setDraftLoadAttempted(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // toast is stable for the provider's lifetime; restoring must run once per user.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey, draftLoadAttempted]);

  useEffect(() => {
    // Wait for the restore attempt, so initial empty state never overwrites an unread draft.
    if (!draftKey || !draftLoadAttempted) return;
    const draft = {
      experienceLevel, goal, trainingDays, sessionDurationMinutes, splitMode, preferredSplit,
      equipment: Array.from(equipment), injuriesText, competesInSport,
      safetyFlags: Array.from(safetyFlags), safetyStepReached, activityLevel, age, gender,
      heightCm, currentWeight, targetWeight, heightUnit, weightUnit, heightFt, heightIn, step,
    };
    AsyncStorage.setItem(draftKey, JSON.stringify(draft)).catch(() => {
      // Best-effort only; never blocks the wizard.
    });
  }, [
    draftKey, draftLoadAttempted, experienceLevel, goal, trainingDays, sessionDurationMinutes,
    splitMode, preferredSplit, equipment, injuriesText, competesInSport, safetyFlags,
    safetyStepReached, activityLevel, age, gender, heightCm, currentWeight, targetWeight,
    heightUnit, weightUnit, heightFt, heightIn, step,
  ]);

  // The stepper only ever moves forward through "Tiếp tục", so reaching step 3 means the safety
  // questions were genuinely shown.
  useEffect(() => {
    if (step >= 3) setSafetyStepReached(true);
  }, [step]);

  // Pre-fill from a partially saved profile — skipped once a draft was restored, since the draft
  // is strictly newer than what was last submitted.
  useEffect(() => {
    if (draftRestored) return;
    const p = profileQuery.data;
    if (!p) return;
    if (p.experienceLevel) setExperienceLevel(p.experienceLevel);
    if (p.goal) setGoal(p.goal);
    if (Array.isArray(p.preferredTrainingDays)) setTrainingDays(p.preferredTrainingDays);
    if (p.sessionDurationMinutes) setSessionDurationMinutes(String(p.sessionDurationMinutes));
    if (p.preferredSplit) {
      setPreferredSplit(p.preferredSplit);
      setSplitMode("manual");
    }
    if (Array.isArray(p.injuries)) setInjuriesText(p.injuries.join(", "));
    if (typeof p.competesInSport === "boolean") setCompetesInSport(p.competesInSport);
    if (Array.isArray(p.safetyScreeningFlags) && p.safetyScreeningFlags.length > 0) {
      setSafetyFlags(new Set(p.safetyScreeningFlags));
    }
    if (p.safetyScreeningStatus && p.safetyScreeningStatus !== "UNKNOWN") setSafetyStepReached(true);
    if (p.activityLevel) setActivityLevel(p.activityLevel);
    if (p.age) setAge(String(p.age));
    if (p.gender) setGender(p.gender);
    if (p.heightCm) setHeightCm(String(p.heightCm));
    if (p.currentWeight) setCurrentWeight(String(p.currentWeight));
    if (p.targetWeight) setTargetWeight(String(p.targetWeight));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileQuery.data]);

  // Pre-fill equipment once both the catalog and the saved ids have loaded.
  useEffect(() => {
    if (!catalogQuery.data || !myEquipmentQuery.data) return;
    const idToSlug = new Map(catalogQuery.data.map((eq) => [eq.id, eq.slug]));
    const slugs = myEquipmentQuery.data
      .map((id) => idToSlug.get(id))
      .filter((s): s is string => !!s);
    if (slugs.length > 0) setEquipment(new Set(slugs));
  }, [catalogQuery.data, myEquipmentQuery.data]);

  // The payload rules (explicit null split, no default activityLevel, safety screening only when
  // reached, always hasCompletedOnboarding) live in buildOnboardingPayload, where they are tested.
  function buildPayload() {
    return buildOnboardingPayload({
      experienceLevel,
      goal,
      trainingDays,
      sessionDurationMinutes,
      splitMode,
      preferredSplit,
      injuriesText,
      competesInSport,
      safetyFlags,
      safetyStepReached,
      activityLevel,
      age,
      gender,
      heightCm,
      currentWeight,
      targetWeight,
    });
  }

  const submitMutation = useMutation({
    mutationFn: async (finishedAllSteps: boolean) => {
      const equipmentIds = catalog.filter((eq) => equipment.has(eq.slug)).map((eq) => eq.id);
      const [profileResult] = await Promise.all([
        profileService.updateProfile(buildPayload()),
        // Best-effort: an equipment save failure must not block the rest of onboarding.
        equipmentService.setMyEquipment(equipmentIds).catch(() => null),
      ]);
      return { profile: (profileResult as any)?.profile, finishedAllSteps };
    },
    onSuccess: ({ profile, finishedAllSteps }) => {
      queryClient.setQueryData(["profile", user?.id], profile);
      if (draftKey) AsyncStorage.removeItem(draftKey).catch(() => {});
      haptics.success();
      toast.show(
        finishedAllSteps
          ? "Đã lưu hồ sơ tập luyện"
          : "Đã bỏ qua — bạn có thể cập nhật lại trong Hồ sơ",
      );
      router.replace(ROLE_HOME.client);
    },
    onError: (error: any) => {
      toast.show(error?.response?.data?.error ?? "Không thể lưu hồ sơ", "danger");
    },
  });

  const isLastStep = step === REVIEW_STEP;
  const canGoNext = canAdvanceOnboardingStep(step, { experienceLevel, goal, activityLevel });
  const nextHint =
    step === 0 && !canGoNext
      ? "Chọn trình độ và mục tiêu để tiếp tục"
      : step === 4 && !canGoNext
        ? "Chọn mức độ vận động để tiếp tục"
        : null;

  const toggleDay = (d: number) => {
    setTrainingDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort()));
  };

  const switchHeightUnit = (unit: "cm" | "ftin") => {
    if (unit === "ftin" && heightCm) {
      const { feet, inches } = feetInchesFromCm(parseFloat(heightCm));
      setHeightFt(String(feet));
      setHeightIn(String(inches));
    }
    setHeightUnit(unit);
  };
  const updateHeightFtIn = (ft: string, inches: string) => {
    setHeightFt(ft);
    setHeightIn(inches);
    const ftNum = parseFloat(ft);
    const inNum = parseFloat(inches);
    if (Number.isFinite(ftNum) || Number.isFinite(inNum)) {
      setHeightCm(
        String(
          cmFromFeetInches(Number.isFinite(ftNum) ? ftNum : 0, Number.isFinite(inNum) ? inNum : 0),
        ),
      );
    }
  };
  const displayWeight = (kgValue: string) => {
    if (weightUnit === "kg" || !kgValue) return kgValue;
    const kg = parseFloat(kgValue);
    return Number.isFinite(kg) ? String(lbFromKg(kg)) : "";
  };
  const updateWeightFromDisplay = (displayValue: string, setter: (v: string) => void) => {
    const value = normalizeDecimal(displayValue);
    if (weightUnit === "kg") {
      setter(value);
      return;
    }
    const lb = parseFloat(value);
    setter(Number.isFinite(lb) ? String(kgFromLb(lb)) : value ? "0" : "");
  };

  const goNext = () => {
    if (!canGoNext) return;
    setStep((s) => Math.min(REVIEW_STEP, s + 1));
  };

  if (profileQuery.isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator />
      </View>
    );
  }

  const current = STEPS[step];
  const StepIcon = current.icon;

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-background"
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      {/* progress + skip */}
      <View className="flex-row items-center gap-3 px-6" style={{ paddingTop: insets.top + 20 }}>
        <View className="flex-1 flex-row gap-1.5">
          {STEPS.map((s, i) => (
            <ProgressSegment key={s.key} filled={i <= step} />
          ))}
        </View>
        <Text
          className="font-body-semibold text-sm text-muted-foreground"
          onPress={submitMutation.isPending ? undefined : () => submitMutation.mutate(false)}
        >
          Bỏ qua
        </Text>
      </View>

      <ScrollView
        ref={scrollRef}
        className="flex-1"
        contentContainerClassName="px-6 pb-8"
        contentContainerStyle={{ paddingTop: 32 }}
        keyboardShouldPersistTaps="handled"
      >
        <Animated.View
          key={current.key}
          entering={FadeInRight.duration(220)}
          exiting={FadeOutLeft.duration(220)}
        >
          <View className="mb-5 h-14 w-14 items-center justify-center rounded-2xl bg-primary/15">
            <StepIconTile icon={StepIcon} />
          </View>
          <Text className="font-display text-3xl text-foreground">{current.title}</Text>
          <Text className="mt-2 font-body text-sm leading-5 text-muted-foreground">
            Bước {step + 1}/{STEPS.length} · {current.subtitle}
          </Text>

          <View className="mt-8 gap-6">
            {step === 0 ? (
              <>
                <Field label="Trình độ tập luyện *">
                  <View className="gap-3">
                    {EXPERIENCE_LEVELS.map((lvl) => (
                      <OptionCard
                        key={lvl.key}
                        label={lvl.label}
                        description={lvl.desc}
                        active={experienceLevel === lvl.key}
                        onPress={() => setExperienceLevel(lvl.key)}
                      />
                    ))}
                  </View>
                </Field>
                <Field label="Mục tiêu chính *">
                  <View className="gap-3">
                    {GOAL_OPTIONS.map((g) => (
                      <OptionCard
                        key={g.key}
                        label={`${g.emoji}  ${g.label}`}
                        active={goal === g.key}
                        onPress={() => setGoal(g.key)}
                      />
                    ))}
                  </View>
                </Field>
              </>
            ) : null}

            {step === 1 ? (
              <>
                <Field label="Ngày tập trong tuần" hint={`Đã chọn ${trainingDays.length} ngày/tuần`}>
                  <View className="flex-row flex-wrap gap-2">
                    {WEEKDAY_OPTIONS.map((d) => (
                      <Chip
                        key={d.value}
                        label={d.label}
                        active={trainingDays.includes(d.value)}
                        onPress={() => toggleDay(d.value)}
                        square
                      />
                    ))}
                  </View>
                </Field>
                <Field label="Thời lượng mỗi buổi (phút)">
                  <Input
                    keyboardType="number-pad"
                    value={sessionDurationMinutes}
                    onChangeText={(v) => setSessionDurationMinutes(v.replace(/\D/g, ""))}
                    placeholder="60"
                  />
                </Field>
                <Field label="Kiểu chia lịch tập">
                  <View className="gap-3">
                    <OptionCard
                      label="Đề xuất cho tôi"
                      description="Hệ thống tự chọn kiểu chia lịch phù hợp"
                      active={splitMode === "auto"}
                      onPress={() => setSplitMode("auto")}
                    />
                    <OptionCard
                      label="Tôi tự chọn"
                      description="Bạn đã biết mình muốn tập theo kiểu nào"
                      active={splitMode === "manual"}
                      onPress={() => setSplitMode("manual")}
                    />
                  </View>
                  {splitMode === "manual" ? (
                    <View className="mt-3 flex-row flex-wrap gap-2">
                      <Chip
                        label="Chưa có ý kiến"
                        active={!preferredSplit}
                        onPress={() => setPreferredSplit("")}
                      />
                      {SPLIT_OPTIONS.map((s) => (
                        <Chip
                          key={s}
                          label={s}
                          active={preferredSplit === s}
                          onPress={() => setPreferredSplit(s)}
                        />
                      ))}
                    </View>
                  ) : null}
                </Field>
              </>
            ) : null}

            {step === 2 ? (
              <>
                <Field label="Nơi bạn thường tập (gợi ý sẵn thiết bị, vẫn chỉnh được)">
                  <TrainingLocationPresetRow onApply={(slugs) => setEquipment(new Set(slugs))} />
                </Field>
                <Field label="Thiết bị bạn có thể sử dụng">
                  {catalogQuery.isLoading ? (
                    <ActivityIndicator className="py-8" />
                  ) : catalogQuery.isError ? (
                    <Text className="font-body text-xs text-destructive">
                      Không tải được danh sách thiết bị. Bạn vẫn có thể tiếp tục và chọn sau trong Hồ sơ.
                    </Text>
                  ) : (
                    <EquipmentPicker
                      catalog={catalog}
                      selectedSlugs={equipment}
                      onChange={setEquipment}
                    />
                  )}
                </Field>
                <Text className="font-body text-[11px] leading-4 text-muted-foreground">
                  Không chọn gì nghĩa là hệ thống sẽ giả định phòng gym đầy đủ thiết bị. Bạn có thể
                  chỉnh lại bất cứ lúc nào trong Hồ sơ → Thiết lập tập luyện.
                </Text>
              </>
            ) : null}

            {step === 3 ? (
              <>
                <Field
                  label="Chấn thương hoặc hạn chế cần lưu ý"
                  hint="Cách nhau bằng dấu phẩy. Để trống nếu không có."
                >
                  <Input
                    placeholder="Ví dụ: đau vai trái, đau lưng dưới"
                    value={injuriesText}
                    onChangeText={setInjuriesText}
                  />
                </Field>
                <CheckRow
                  label="Tôi đang thi đấu thể hình/thể thao chuyên nghiệp"
                  description="Hệ thống sẽ áp dụng ngưỡng kiểm tra dữ liệu chặt chẽ hơn, không đưa lời khuyên đơn giản hoá."
                  checked={competesInSport}
                  onPress={() => setCompetesInSport((v) => !v)}
                />
                <Field
                  label="Sàng lọc an toàn trước khi tập"
                  hint='Đây không phải công cụ chẩn đoán y tế — chỉ giúp hệ thống đưa lời khuyên thận trọng hơn. Chọn những mục đúng với bạn.'
                >
                  <View className="gap-2">
                    {SAFETY_QUESTIONS.map((q) => (
                      <CheckRow
                        key={q.key}
                        label={q.label}
                        checked={safetyFlags.has(q.key)}
                        onPress={() => {
                          setSafetyFlags((prev) => {
                            const next = new Set(prev);
                            if (next.has(q.key)) next.delete(q.key);
                            else next.add(q.key);
                            return next;
                          });
                          setSafetyStepReached(true);
                        }}
                      />
                    ))}
                  </View>
                  {safetyFlags.size > 0 ? (
                    <Text className="mt-3 font-body text-xs leading-5 text-warning">
                      Bạn nên hỏi ý kiến bác sĩ trước khi bắt đầu hoặc thay đổi cường độ tập luyện.
                      Bạn vẫn dùng ứng dụng bình thường — AI sẽ đưa khuyến nghị thận trọng hơn.
                    </Text>
                  ) : null}
                </Field>
              </>
            ) : null}

            {step === 4 ? (
              <>
                <View className="flex-row gap-3">
                  <Field label="Tuổi" className="flex-1">
                    <Input
                      keyboardType="number-pad"
                      value={age}
                      onChangeText={(v) => setAge(v.replace(/\D/g, ""))}
                      placeholder="25"
                    />
                  </Field>
                  <Field label="Giới tính" className="flex-[1.4]">
                    <View className="flex-row gap-2">
                      {GENDER_OPTIONS.map((g) => (
                        <Chip
                          key={g.key}
                          label={g.label}
                          active={gender === g.key}
                          onPress={() => setGender(gender === g.key ? "" : g.key)}
                        />
                      ))}
                    </View>
                  </Field>
                </View>

                <Field
                  label="Mức độ vận động hằng ngày (ngoài giờ tập) *"
                  hint="Hoạt động NGOÀI buổi tập (công việc, đi lại...) — dùng để tính nhu cầu calo chính xác hơn."
                >
                  <View className="gap-3">
                    {ACTIVITY_LEVELS.map((a) => (
                      <OptionCard
                        key={a.key}
                        label={a.label}
                        description={a.desc}
                        active={activityLevel === a.key}
                        onPress={() => setActivityLevel(a.key)}
                      />
                    ))}
                  </View>
                </Field>

                <Field
                  label="Chiều cao"
                  accessory={
                    <UnitToggle
                      options={[
                        { key: "cm", label: "cm" },
                        { key: "ftin", label: "ft/in" },
                      ]}
                      value={heightUnit}
                      onChange={(u) => switchHeightUnit(u as "cm" | "ftin")}
                    />
                  }
                >
                  {heightUnit === "cm" ? (
                    <Input
                      keyboardType="decimal-pad"
                      value={heightCm}
                      onChangeText={(v) => setHeightCm(normalizeDecimal(v))}
                      placeholder="175"
                    />
                  ) : (
                    <View className="flex-row gap-3">
                      <Input
                        className="flex-1"
                        keyboardType="number-pad"
                        value={heightFt}
                        onChangeText={(v) => updateHeightFtIn(v, heightIn)}
                        placeholder="ft"
                      />
                      <Input
                        className="flex-1"
                        keyboardType="decimal-pad"
                        value={heightIn}
                        onChangeText={(v) => updateHeightFtIn(heightFt, normalizeDecimal(v))}
                        placeholder="in"
                      />
                    </View>
                  )}
                </Field>

                <Field
                  label="Cân nặng"
                  accessory={
                    <UnitToggle
                      options={[
                        { key: "kg", label: "kg" },
                        { key: "lb", label: "lb" },
                      ]}
                      value={weightUnit}
                      onChange={(u) => setWeightUnit(u as "kg" | "lb")}
                    />
                  }
                >
                  <View className="flex-row gap-3">
                    <Input
                      className="flex-1"
                      label="Hiện tại"
                      keyboardType="decimal-pad"
                      value={displayWeight(currentWeight)}
                      onChangeText={(v) => updateWeightFromDisplay(v, setCurrentWeight)}
                    />
                    <Input
                      className="flex-1"
                      label="Mục tiêu (nếu có)"
                      keyboardType="decimal-pad"
                      value={displayWeight(targetWeight)}
                      onChangeText={(v) => updateWeightFromDisplay(v, setTargetWeight)}
                    />
                  </View>
                </Field>
              </>
            ) : null}

            {isLastStep ? (
              <View className="gap-2">
                <ReviewRow
                  label="Trình độ"
                  value={EXPERIENCE_LEVELS.find((l) => l.key === experienceLevel)?.label}
                  onEdit={() => setStep(0)}
                />
                <ReviewRow
                  label="Mục tiêu"
                  value={GOAL_OPTIONS.find((g) => g.key === goal)?.label}
                  onEdit={() => setStep(0)}
                />
                <ReviewRow
                  label="Ngày tập/tuần"
                  value={`${trainingDays.length} ngày`}
                  onEdit={() => setStep(1)}
                />
                <ReviewRow
                  label="Kiểu chia lịch"
                  value={
                    splitMode === "manual" ? preferredSplit || "Chưa có ý kiến" : "Hệ thống tự đề xuất"
                  }
                  onEdit={() => setStep(1)}
                />
                <ReviewRow
                  label="Thiết bị"
                  value={
                    equipment.size ? `${equipment.size} thiết bị đã chọn` : "Phòng gym đầy đủ (mặc định)"
                  }
                  onEdit={() => setStep(2)}
                />
                <ReviewRow
                  label="Chấn thương"
                  value={injuriesText || "Không có"}
                  onEdit={() => setStep(3)}
                />
                <ReviewRow
                  label="Thi đấu chuyên nghiệp"
                  value={competesInSport ? "Có" : "Không"}
                  onEdit={() => setStep(3)}
                />
                <ReviewRow
                  label="Sàng lọc an toàn"
                  value={
                    !safetyStepReached
                      ? "Chưa thực hiện"
                      : safetyFlags.size > 0
                        ? `${safetyFlags.size} lưu ý cần thận trọng`
                        : "Không có lưu ý nào"
                  }
                  onEdit={() => setStep(3)}
                />
                <ReviewRow
                  label="Mức độ vận động"
                  value={ACTIVITY_LEVELS.find((a) => a.key === activityLevel)?.label || "Chưa chọn"}
                  onEdit={() => setStep(4)}
                />
                <ReviewRow
                  label="Chỉ số cơ thể"
                  value={
                    [age && `${age} tuổi`, heightCm && `${heightCm}cm`, currentWeight && `${currentWeight}kg`]
                      .filter(Boolean)
                      .join(", ") || "Chưa nhập"
                  }
                  onEdit={() => setStep(4)}
                />
              </View>
            ) : null}
          </View>

          {step === 0 ? (
            <Text
              className="mt-8 text-center font-body-medium text-sm text-muted-foreground"
              onPress={logout}
            >
              Đăng xuất
            </Text>
          ) : null}
        </Animated.View>
      </ScrollView>

      <View className="px-6 pt-3" style={{ paddingBottom: insets.bottom + 28 }}>
        {nextHint ? (
          <Text className="mb-2 text-center font-body text-xs text-muted-foreground">{nextHint}</Text>
        ) : null}
        <View className="flex-row gap-3">
          {step > 0 ? (
            <Button
              variant="secondary"
              size="lg"
              icon={ChevronLeft}
              disabled={submitMutation.isPending}
              onPress={() => setStep((s) => Math.max(0, s - 1))}
            >
              Quay lại
            </Button>
          ) : null}
          <View className="flex-1">
            <Button
              full
              size="lg"
              icon={isLastStep ? Check : ArrowRight}
              disabled={isLastStep ? submitMutation.isPending : !canGoNext}
              onPress={isLastStep ? () => submitMutation.mutate(true) : goNext}
            >
              {isLastStep
                ? submitMutation.isPending
                  ? "Đang lưu..."
                  : "Hoàn tất thiết lập"
                : "Tiếp tục"}
            </Button>
          </View>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

// ── pieces ─────────────────────────────────────────────────────────────────────────────────

/** One bar of the reference's segmented progress: fills over 300ms as the step is reached. */
function ProgressSegment({ filled }: { filled: boolean }) {
  const progress = useSharedValue(filled ? 1 : 0);

  useEffect(() => {
    progress.value = withTiming(filled ? 1 : 0, { duration: 300 });
  }, [filled, progress]);

  const fillStyle = useAnimatedStyle(() => ({ width: `${progress.value * 100}%` }));

  return (
    <View className="h-1.5 flex-1 overflow-hidden rounded-full bg-panel">
      <Animated.View className="h-full rounded-full bg-primary" style={fillStyle} />
    </View>
  );
}

function StepIconTile({ icon: Icon }: { icon: LucideIcon }) {
  const accent = useWorkspaceAccent();
  return <Icon size={26} color={accent.primary} />;
}

function Field({
  label,
  hint,
  accessory,
  className = "",
  children,
}: {
  label: string;
  hint?: string;
  accessory?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <View className={className}>
      <View className="mb-2.5 flex-row items-center justify-between gap-3">
        <Text className="flex-1 font-body-semibold text-xs uppercase text-muted-foreground">
          {label}
        </Text>
        {accessory}
      </View>
      {children}
      {hint ? (
        <Text className="mt-2 font-body text-[11px] leading-4 text-muted-foreground">{hint}</Text>
      ) : null}
    </View>
  );
}

/** The reference's option row: full-width card, label left, check circle right. */
function OptionCard({
  label,
  description,
  active,
  onPress,
}: {
  label: string;
  description?: string;
  active: boolean;
  onPress: () => void;
}) {
  const accent = useWorkspaceAccent();
  return (
    <Tappable
      onPress={onPress}
      scaleTo={0.98}
      className={`flex-row items-center justify-between gap-3 rounded-2xl border p-4 ${
        active ? "border-primary bg-primary/5" : "border-border bg-card"
      }`}
    >
      <View className="flex-1">
        <Text className="font-body-semibold text-base text-foreground">{label}</Text>
        {description ? (
          <Text className="mt-0.5 font-body text-xs text-muted-foreground">{description}</Text>
        ) : null}
      </View>
      <View
        className={`h-6 w-6 items-center justify-center rounded-full ${
          active ? "bg-primary" : "border-2 border-border"
        }`}
      >
        {active ? <Check size={14} strokeWidth={3} color={accent.onPrimary} /> : null}
      </View>
    </Tappable>
  );
}

function Chip({
  label,
  active,
  onPress,
  square = false,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  square?: boolean;
}) {
  return (
    <Tappable
      onPress={onPress}
      className={`items-center justify-center rounded-xl border ${
        square ? "h-12 w-12" : "px-3.5 py-2.5"
      } ${active ? "border-primary bg-primary/10" : "border-border bg-card"}`}
    >
      <Text
        className={`font-body-semibold text-sm ${active ? "text-primary" : "text-muted-foreground"}`}
      >
        {label}
      </Text>
    </Tappable>
  );
}

function CheckRow({
  label,
  description,
  checked,
  onPress,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onPress: () => void;
}) {
  const accent = useWorkspaceAccent();
  return (
    <Tappable onPress={onPress} className="flex-row items-start gap-3 rounded-xl bg-panel px-3.5 py-3">
      <View
        className={`mt-0.5 h-5 w-5 items-center justify-center rounded-md border ${
          checked ? "border-primary bg-primary" : "border-border"
        }`}
      >
        {checked ? <Check size={13} strokeWidth={3} color={accent.onPrimary} /> : null}
      </View>
      <View className="flex-1">
        <Text className="font-body text-sm leading-5 text-foreground">{label}</Text>
        {description ? (
          <Text className="mt-1 font-body text-[11px] leading-4 text-muted-foreground">
            {description}
          </Text>
        ) : null}
      </View>
    </Tappable>
  );
}

function UnitToggle({
  options,
  value,
  onChange,
}: {
  options: { key: string; label: string }[];
  value: string;
  onChange: (key: string) => void;
}) {
  return (
    <View className="flex-row overflow-hidden rounded-lg border border-border">
      {options.map((o) => {
        const active = o.key === value;
        return (
          <Tappable
            key={o.key}
            onPress={() => onChange(o.key)}
            scaleTo={1}
            className={`px-2.5 py-1 ${active ? "bg-primary" : "bg-panel"}`}
          >
            <Text
              className={`font-body-semibold text-[11px] ${
                active ? "text-on-primary" : "text-muted-foreground"
              }`}
            >
              {o.label}
            </Text>
          </Tappable>
        );
      })}
    </View>
  );
}

function ReviewRow({ label, value, onEdit }: { label: string; value?: string; onEdit: () => void }) {
  return (
    <View className="flex-row items-center justify-between gap-3 rounded-xl bg-panel px-3.5 py-3">
      <View className="flex-1">
        <Text className="font-body text-[11px] uppercase text-muted-foreground">{label}</Text>
        <Text className="mt-0.5 font-body text-sm text-foreground">{value || "—"}</Text>
      </View>
      <Text className="font-body-semibold text-xs text-primary" onPress={onEdit}>
        Sửa
      </Text>
    </View>
  );
}
