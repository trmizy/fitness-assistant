import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Dumbbell,
  Target,
  CalendarDays,
  ShieldAlert,
  Ruler,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  Check,
  Loader2,
  Activity,
} from "lucide-react";
import { useApp } from "../../context/AppContext";
import { profileService, equipmentService, type EquipmentCatalogItem } from "../../services/api";
import { EquipmentPicker, TrainingLocationPresetRow } from "../../components/EquipmentPicker";
import { cmFromFeetInches, feetInchesFromCm, kgFromLb, lbFromKg } from "../../utils/units";
import { toast } from "sonner";

/**
 * First-run onboarding wizard — collects everything the Decision Engine and
 * plan-generation flows need but that a brand-new profile leaves null:
 * training level, goal, days/week, equipment, injury/pain limitations,
 * sport/competition status, preferred split, and a body-metric baseline.
 * Writes through the SAME PUT /profile/me endpoint ProfilePage uses (no
 * parallel write path), setting hasCompletedOnboarding=true only on the
 * final step — see RequireOnboarding for the redirect that sends users here.
 */

const inp =
  "w-full px-3 py-2.5 bg-zinc-800/60 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 focus:outline-none focus:ring-2 focus:ring-green-500/40 focus:border-green-500/50 placeholder-zinc-600 transition-all";
const lbl = "text-xs text-zinc-500 uppercase tracking-wider mb-1.5 block font-semibold";

const steps = [
  { key: "level", label: "Trình độ & Mục tiêu", icon: Target },
  { key: "schedule", label: "Lịch tập", icon: CalendarDays },
  { key: "equipment", label: "Thiết bị", icon: Dumbbell },
  { key: "safety", label: "Sức khỏe & Thi đấu", icon: ShieldAlert },
  { key: "body", label: "Chỉ số cơ thể", icon: Ruler },
  { key: "review", label: "Xem lại", icon: CheckCircle },
];

const experienceLevels = [
  { key: "BEGINNER", label: "Mới bắt đầu", desc: "Dưới 6 tháng tập luyện có hệ thống" },
  { key: "INTERMEDIATE", label: "Đã biết tập", desc: "6 tháng - 2 năm, đã quen kỹ thuật cơ bản" },
  { key: "ADVANCED", label: "Nâng cao", desc: "2+ năm, tập luyện có chu kỳ" },
];

const goalOptions = [
  { key: "WEIGHT_LOSS", label: "Giảm mỡ", emoji: "🔥" },
  { key: "MUSCLE_GAIN", label: "Tăng cơ", emoji: "💪" },
  { key: "MAINTENANCE", label: "Duy trì vóc dáng", emoji: "⚖️" },
  { key: "ATHLETIC_PERFORMANCE", label: "Hiệu suất thể thao", emoji: "🏆" },
];

const weekdayOptions = [
  { value: 1, label: "T2" },
  { value: 2, label: "T3" },
  { value: 3, label: "T4" },
  { value: 4, label: "T5" },
  { value: 5, label: "T6" },
  { value: 6, label: "T7" },
  { value: 0, label: "CN" },
];

const splitOptions = ["Full Body", "Upper/Lower", "Push/Pull/Legs", "Bro Split", "Chưa xác định"];

// Same 5-value enum/label mapping already used in ProfilePage.tsx — kept in sync manually
// (both are small, static, unlikely to drift) since ProfilePage's version isn't exported.
const activityLevels = [
  { key: "SEDENTARY", label: "Ít vận động", desc: "Công việc/sinh hoạt ít di chuyển" },
  { key: "LIGHTLY_ACTIVE", label: "Vận động nhẹ", desc: "Đi lại, đứng nhiều nhưng không gắng sức" },
  { key: "MODERATELY_ACTIVE", label: "Vận động vừa", desc: "Đi bộ/công việc chân tay mức trung bình" },
  { key: "VERY_ACTIVE", label: "Năng động", desc: "Công việc/sinh hoạt đòi hỏi thể lực đều đặn" },
  { key: "EXTREMELY_ACTIVE", label: "Cực kỳ năng động", desc: "Lao động chân tay nặng hoặc vận động viên" },
];

// Onboarding/Safety redesign — docs/ONBOARDING_PT_INTAKE_SAFETY_REDESIGN.md §3.5. Deliberately
// NOT a verbatim copy of PAR-Q/PAR-Q+ (a copyrighted clinical tool whose proper use requires a
// follow-up pathway this product doesn't have) — this is the product's own wording, inspired by
// PAR-Q's 5 risk themes (heart condition, chest pain, dizziness/fainting, bone/joint, doctor-
// prescribed medication). `key` is what actually gets stored (in safetyScreeningFlags), never
// this label text, so a future copy edit here can never make old stored data misleading.
const safetyQuestions = [
  { key: "heart_condition", label: "Bạn từng được bác sĩ chẩn đoán mắc bệnh tim mạch, hoặc được khuyến cáo chỉ nên vận động theo chỉ định của bác sĩ?" },
  { key: "chest_pain", label: "Bạn có từng thấy đau tức ngực khi vận động thể chất không?" },
  { key: "dizziness_fainting", label: "Bạn có hay mất thăng bằng do chóng mặt, hoặc từng ngất xỉu không?" },
  { key: "bone_joint", label: "Bạn có vấn đề xương khớp mà việc tăng cường độ tập luyện có thể khiến nặng hơn không?" },
  { key: "doctor_medication", label: "Bạn có đang dùng thuốc theo chỉ định của bác sĩ liên quan đến tim mạch/huyết áp không?" },
];

export function OnboardingWizardPage() {
  const { user } = useApp();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [currentStep, setCurrentStep] = useState(0);

  const profileQuery = useQuery({
    queryKey: ["profile", user?.id],
    queryFn: () => profileService.getProfile().then((r) => r.profile),
    enabled: !!user?.id,
  });

  // Gym-onboarding project — real normalized equipment catalog, replacing
  // the old flat 7-item ad-hoc list. `equipment` below holds catalog SLUGS
  // (not the old barbell/dumbbells/machines/... vocabulary). UserEquipment
  // (fitness-service) is the sole canonical source of truth the plan
  // generator/substitution filter against; saved via equipmentService.
  // setMyEquipment below, which ALSO keeps user-service's legacy
  // UserProfile.availableEquipment free-text field in sync backend-to-
  // backend (equipment.service.ts) — this page deliberately does NOT also
  // send availableEquipment through profileService.updateProfile, so there
  // is exactly one write path and no way for the two to diverge.
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
  // "auto" = don't send preferredSplit at all (same as the pre-existing "Chưa xác định"
  // default — the system/AI decides) — default for everyone, not just BEGINNER: nobody
  // should be shown Push/Pull/Legs/Bro Split jargon unless they specifically ask for manual
  // control. See docs/ONBOARDING_INTAKE_QUESTIONNAIRE_REVIEW.md §6 and
  // docs/ONBOARDING_PT_INTAKE_SAFETY_REDESIGN.md §3.7.
  const [splitMode, setSplitMode] = useState<"auto" | "manual">("auto");
  const [preferredSplit, setPreferredSplit] = useState("");
  const [equipment, setEquipment] = useState<Set<string>>(new Set());
  const [injuriesText, setInjuriesText] = useState("");
  const [competesInSport, setCompetesInSport] = useState(false);
  // §3.5/§3.6 — Safety Screening. `safetyStepReached` distinguishes "genuinely screened,
  // zero concerns" (CLEARED) from "never saw the step at all" (skipped via the wizard's
  // "Bỏ qua" escape hatch before reaching step 3) — an empty Set alone can't tell those
  // apart, and conflating them would silently record CLEARED for someone never actually
  // asked.
  const [safetyFlags, setSafetyFlags] = useState<Set<string>>(new Set());
  const [safetyStepReached, setSafetyStepReached] = useState(false);
  const [activityLevel, setActivityLevel] = useState("");
  const [age, setAge] = useState("");
  const [gender, setGender] = useState("");
  const [heightCm, setHeightCm] = useState(""); // canonical — always cm, matches backend/UserProfile.heightCm
  const [currentWeight, setCurrentWeight] = useState(""); // canonical — always kg
  const [targetWeight, setTargetWeight] = useState(""); // canonical — always kg
  // Gym-onboarding project follow-up §13 — display-unit toggles. Only these
  // two ever change; heightCm/currentWeight/targetWeight above stay the
  // single canonical cm/kg values sent to the backend either way, and the
  // rest of the app (Profile, InBody) keeps reading plain cm/kg unchanged.
  const [heightUnit, setHeightUnit] = useState<"cm" | "ftin">("cm");
  const [weightUnit, setWeightUnit] = useState<"kg" | "lb">("kg");
  const [heightFt, setHeightFt] = useState("");
  const [heightIn, setHeightIn] = useState("");

  // Gym-onboarding project follow-up §14 — resume-on-refresh. The wizard
  // only ever writes to the backend on final submit (Hoàn tất / Bỏ qua), so
  // without this, a refresh or browser close mid-wizard silently discarded
  // every field the user had already filled in. Draft is plain localStorage
  // (no backend endpoint needed for a transient, single-device draft),
  // keyed per-user so switching accounts on the same browser never leaks
  // one user's in-progress answers into another's session.
  const draftKey = user?.id ? `onboarding-draft-${user.id}` : null;
  const [draftRestored, setDraftRestored] = useState(false);
  const [draftLoadAttempted, setDraftLoadAttempted] = useState(false);

  useEffect(() => {
    if (!draftKey || draftLoadAttempted) return;
    setDraftLoadAttempted(true);
    try {
      const raw = localStorage.getItem(draftKey);
      if (!raw) return;
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
      if (d.heightUnit) setHeightUnit(d.heightUnit);
      if (d.weightUnit) setWeightUnit(d.weightUnit);
      if (d.heightFt) setHeightFt(d.heightFt);
      if (d.heightIn) setHeightIn(d.heightIn);
      if (typeof d.currentStep === "number") setCurrentStep(d.currentStep);
      setDraftRestored(true);
      toast.info("Đã khôi phục tiến trình thiết lập trước đó của bạn");
    } catch {
      // corrupt/unreadable draft — ignore, wizard just starts fresh
    }
  }, [draftKey, draftLoadAttempted]);

  // Persist on every change — cheap (localStorage, small payload), and
  // means literally any refresh/close/back-button mid-wizard is recoverable.
  useEffect(() => {
    if (!draftKey || !draftLoadAttempted) return; // wait for the restore attempt above to run first, so we never overwrite a not-yet-read draft with initial empty state
    const draft = {
      experienceLevel, goal, trainingDays, sessionDurationMinutes, splitMode, preferredSplit,
      equipment: Array.from(equipment), injuriesText, competesInSport,
      safetyFlags: Array.from(safetyFlags), safetyStepReached, activityLevel, age, gender,
      heightCm, currentWeight, targetWeight, heightUnit, weightUnit, heightFt, heightIn,
      currentStep,
    };
    try {
      localStorage.setItem(draftKey, JSON.stringify(draft));
    } catch {
      // storage full/unavailable — best-effort only, never blocks the wizard
    }
  }, [
    draftKey, draftLoadAttempted, experienceLevel, goal, trainingDays, sessionDurationMinutes,
    splitMode, preferredSplit, equipment, injuriesText, competesInSport, safetyFlags,
    safetyStepReached, activityLevel, age, gender, heightCm,
    currentWeight, targetWeight, heightUnit, weightUnit, heightFt, heightIn, currentStep,
  ]);

  // Marks the safety step as genuinely seen once the user's forward progress (via "Tiếp
  // tục" — the stepper itself can only jump BACKWARD to already-visited steps, never ahead)
  // reaches it, so a submit from any later step still correctly records CLEARED/
  // FOLLOW_UP_SUGGESTED instead of leaving safetyScreeningStatus untouched.
  useEffect(() => {
    if (currentStep >= 3) setSafetyStepReached(true);
  }, [currentStep]);

  // Pre-fill from any partial profile already saved (e.g. user filled some
  // of ProfilePage before the wizard existed, or came back after skipping).
  // Skipped once a localStorage draft was restored — the draft is strictly
  // more recent than whatever was last actually submitted to the backend.
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
  }, [profileQuery.data]);

  // Pre-fill equipment selection from the new granular UserEquipment table
  // once both the catalog and the user's saved ids have loaded (existing
  // users with nothing saved yet simply start from an empty selection —
  // see this file's header comment on the migration strategy).
  useEffect(() => {
    if (!catalogQuery.data || !myEquipmentQuery.data) return;
    const idToSlug = new Map(catalogQuery.data.map((eq) => [eq.id, eq.slug]));
    const slugs = myEquipmentQuery.data.map((id) => idToSlug.get(id)).filter((s): s is string => !!s);
    if (slugs.length > 0) setEquipment(new Set(slugs));
  }, [catalogQuery.data, myEquipmentQuery.data]);

  function buildPayload() {
    return {
      experienceLevel: experienceLevel || undefined,
      goal: goal || undefined,
      preferredTrainingDays: trainingDays,
      sessionDurationMinutes: sessionDurationMinutes ? parseInt(sessionDurationMinutes, 10) : undefined,
      // "auto" always sends an explicit null (not undefined) — profileSchema's
      // preferredSplit is .nullable() specifically so a client can clear a
      // previously-set value; omitting the key here would leave a stale manual
      // choice from an earlier visit in place after switching back to "auto".
      preferredSplit: splitMode === "manual" && preferredSplit && preferredSplit !== "Chưa xác định" ? preferredSplit : null,
      // availableEquipment deliberately omitted — equipmentService.
      // setMyEquipment (called alongside this in submitMutation) is the one
      // write path for equipment, and syncs this legacy field itself.
      injuries: injuriesText
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      competesInSport,
      // Real value only — never a fabricated default. Omitted (not sent) when the user
      // skipped past the body step without picking one; downstream nutrition calculations
      // (checkCalorieEstimationInputs) already ask the user directly for this field in-chat
      // when it's genuinely null, which is the correct behavior — a silent default here
      // would defeat that safety net exactly the way RegisterPage's old hard-coded
      // LIGHTLY_ACTIVE did (see docs/ONBOARDING_PT_INTAKE_SAFETY_REDESIGN.md §2).
      activityLevel: activityLevel || undefined,
      // §3.6 — only recorded if the user actually reached the safety step; see
      // safetyStepReached's own doc comment for why an empty Set alone isn't enough.
      ...(safetyStepReached
        ? {
            safetyScreeningStatus: safetyFlags.size > 0 ? "FOLLOW_UP_SUGGESTED" as const : "CLEARED" as const,
            safetyScreeningFlags: Array.from(safetyFlags),
          }
        : {}),
      age: age ? parseInt(age, 10) : undefined,
      gender: gender || undefined,
      heightCm: heightCm ? parseFloat(heightCm) : undefined,
      currentWeight: currentWeight ? parseFloat(currentWeight) : undefined,
      targetWeight: targetWeight ? parseFloat(targetWeight) : undefined,
      // Always true on any submission from this page — including "skip",
      // which saves whatever was filled in so far (possibly nothing) and
      // marks onboarding as seen. Otherwise RequireOnboarding would bounce
      // the user straight back here on the very next navigation, turning
      // "skip" into a dead end instead of a real escape hatch.
      hasCompletedOnboarding: true,
    };
  }

  const submitMutation = useMutation({
    mutationFn: async (finishedAllSteps: boolean) => {
      const equipmentIds = catalog.filter((eq) => equipment.has(eq.slug)).map((eq) => eq.id);
      const [profileResult] = await Promise.all([
        profileService.updateProfile(buildPayload()),
        // Best-effort — a granular-equipment save failure shouldn't block
        // the rest of onboarding from completing. This is the ONLY place
        // that writes equipment; it syncs the legacy availableEquipment
        // field on user-service itself (equipment.service.ts), so nothing
        // else in this component needs to write that field.
        equipmentService.setMyEquipment(equipmentIds).catch(() => null),
      ]);
      return { profile: profileResult.profile, finishedAllSteps };
    },
    onSuccess: ({ profile, finishedAllSteps }) => {
      // Write the fresh profile into the cache SYNCHRONOUSLY (not
      // invalidateQueries, which only schedules a background refetch) before
      // navigating — RequireOnboarding reads this same query key immediately
      // on mount at the destination route, and would otherwise still see the
      // pre-submit stale value (hasCompletedOnboarding: false) and bounce the
      // user straight back here.
      queryClient.setQueryData(["profile", user?.id], profile);
      // Submit succeeded — the draft's job is done; clearing it means a
      // future re-visit to this page (e.g. from Settings) starts from the
      // just-saved profile, not a stale draft from this completed run.
      if (draftKey) {
        try {
          localStorage.removeItem(draftKey);
        } catch {
          // best-effort
        }
      }
      toast.success(finishedAllSteps ? "Đã lưu hồ sơ tập luyện" : "Đã bỏ qua — bạn có thể cập nhật lại trong Hồ sơ");
      navigate("/client/dashboard");
    },
    onError: (error: any) => {
      toast.error(error?.response?.data?.error ?? "Không thể lưu hồ sơ");
    },
  });

  const isLastStep = currentStep === steps.length - 1;
  const canGoNext = () => {
    if (currentStep === 0) return !!experienceLevel && !!goal;
    // Body step (index 4) — activityLevel is required here, not silently defaulted (§3.2).
    // "Bỏ qua, thiết lập sau" always remains available as the real escape hatch, same as it
    // already is for experienceLevel/goal above.
    if (currentStep === 4) return !!activityLevel;
    return true;
  };

  const toggleDay = (d: number) => {
    setTrainingDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort()));
  };

  // Unit toggles — heightCm/currentWeight/targetWeight stay canonical
  // cm/kg throughout; only the ft/in split-fields need extra state since a
  // single text input can't hold two independently-typeable numbers.
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
      setHeightCm(String(cmFromFeetInches(Number.isFinite(ftNum) ? ftNum : 0, Number.isFinite(inNum) ? inNum : 0)));
    }
  };
  const displayWeight = (kgValue: string) => {
    if (weightUnit === "kg" || !kgValue) return kgValue;
    const kg = parseFloat(kgValue);
    return Number.isFinite(kg) ? String(lbFromKg(kg)) : "";
  };
  const updateWeightFromDisplay = (displayValue: string, setter: (v: string) => void) => {
    if (weightUnit === "kg") {
      setter(displayValue);
      return;
    }
    const lb = parseFloat(displayValue);
    setter(Number.isFinite(lb) ? String(kgFromLb(lb)) : displayValue ? "0" : "");
  };

  if (profileQuery.isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 text-green-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-5">
      <div>
        <h1 className="text-zinc-100 flex items-center gap-2">
          <Dumbbell className="w-5 h-5 text-green-400" /> Thiết lập hồ sơ tập luyện
        </h1>
        <p className="text-zinc-500 text-sm mt-0.5">
          Vài câu hỏi nhanh để cá nhân hoá lịch tập và các đề xuất AI cho bạn.
        </p>
      </div>

      {/* Stepper */}
      <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4">
        <div className="flex items-start gap-1 overflow-x-auto pb-1">
          {steps.map((s, i) => {
            const done = i < currentStep;
            const active = i === currentStep;
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => i < currentStep && setCurrentStep(i)}
                className="flex flex-col items-center gap-1.5 flex-1 min-w-[60px] group transition-all"
              >
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all flex-shrink-0 ${
                    done
                      ? "bg-green-500 text-black"
                      : active
                        ? "bg-green-500 text-black shadow-lg shadow-green-500/30"
                        : "bg-zinc-800 text-zinc-500 border border-zinc-700"
                  }`}
                >
                  {done ? <Check className="w-4 h-4" /> : <s.icon className="w-4 h-4" />}
                </div>
                <span
                  className={`text-[10px] text-center leading-tight hidden sm:block font-medium ${active ? "text-green-400" : done ? "text-zinc-400" : "text-zinc-600"}`}
                >
                  {s.label}
                </span>
              </button>
            );
          })}
        </div>
        <div className="mt-3 flex items-center justify-between text-xs text-zinc-500 mb-1">
          <span>Bước {currentStep + 1} / {steps.length}</span>
          <span>Hoàn thành {Math.round((currentStep / (steps.length - 1)) * 100)}%</span>
        </div>
        <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-green-500 rounded-full transition-all duration-500"
            style={{ width: `${(currentStep / (steps.length - 1)) * 100}%` }}
          />
        </div>
      </div>

      <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 overflow-hidden flex flex-col min-h-[360px]">
        <div className="p-6 flex-1 space-y-5">
          {currentStep === 0 && (
            <>
              <div>
                <label className={lbl}>Trình độ tập luyện *</label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {experienceLevels.map((lvl) => (
                    <button
                      key={lvl.key}
                      type="button"
                      onClick={() => setExperienceLevel(lvl.key)}
                      className={`text-left p-3 rounded-xl border-2 transition-all ${
                        experienceLevel === lvl.key
                          ? "border-green-500 bg-green-500/10"
                          : "border-zinc-700/60 hover:border-zinc-600"
                      }`}
                    >
                      <div className="text-sm font-semibold text-zinc-200">{lvl.label}</div>
                      <div className="text-[11px] text-zinc-500 mt-0.5">{lvl.desc}</div>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className={lbl}>Mục tiêu chính *</label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {goalOptions.map((g) => (
                    <button
                      key={g.key}
                      type="button"
                      onClick={() => setGoal(g.key)}
                      className={`flex flex-col items-center gap-1 px-3 py-3 border-2 rounded-xl text-sm transition-all ${
                        goal === g.key
                          ? "border-green-500 bg-green-500/10 text-green-400 font-semibold"
                          : "border-zinc-700/60 text-zinc-500 hover:border-zinc-600"
                      }`}
                    >
                      <span className="text-lg">{g.emoji}</span>
                      <span className="text-xs">{g.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {currentStep === 1 && (
            <>
              <div>
                <label className={lbl}>Ngày tập trong tuần</label>
                <div className="flex flex-wrap gap-2">
                  {weekdayOptions.map((d) => (
                    <button
                      key={d.value}
                      type="button"
                      onClick={() => toggleDay(d.value)}
                      className={`w-12 h-12 rounded-xl text-sm font-semibold border-2 transition-all ${
                        trainingDays.includes(d.value)
                          ? "border-green-500 bg-green-500/10 text-green-400"
                          : "border-zinc-700/60 text-zinc-500 hover:border-zinc-600"
                      }`}
                    >
                      {d.label}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-zinc-600 mt-1.5">Đã chọn {trainingDays.length} ngày/tuần</p>
              </div>
              <div>
                <label className={lbl}>Thời lượng mỗi buổi (phút)</label>
                <input
                  type="number"
                  min={15}
                  max={180}
                  value={sessionDurationMinutes}
                  onChange={(e) => setSessionDurationMinutes(e.target.value)}
                  className={inp}
                />
              </div>
              <div>
                <label className={lbl}>Kiểu chia lịch tập</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    data-testid="split-mode-auto"
                    onClick={() => setSplitMode("auto")}
                    className={`text-left p-3 rounded-xl border-2 transition-all ${
                      splitMode === "auto" ? "border-green-500 bg-green-500/10" : "border-zinc-700/60 hover:border-zinc-600"
                    }`}
                  >
                    <div className="text-sm font-semibold text-zinc-200">Đề xuất cho tôi</div>
                    <div className="text-[11px] text-zinc-500 mt-0.5">Hệ thống tự chọn kiểu chia lịch phù hợp</div>
                  </button>
                  <button
                    type="button"
                    data-testid="split-mode-manual"
                    onClick={() => setSplitMode("manual")}
                    className={`text-left p-3 rounded-xl border-2 transition-all ${
                      splitMode === "manual" ? "border-green-500 bg-green-500/10" : "border-zinc-700/60 hover:border-zinc-600"
                    }`}
                  >
                    <div className="text-sm font-semibold text-zinc-200">Tôi tự chọn</div>
                    <div className="text-[11px] text-zinc-500 mt-0.5">Bạn đã biết mình muốn tập theo kiểu nào</div>
                  </button>
                </div>
                {splitMode === "manual" && (
                  <select
                    value={preferredSplit}
                    onChange={(e) => setPreferredSplit(e.target.value)}
                    className={`${inp} mt-2`}
                  >
                    <option value="">Chưa có ý kiến</option>
                    {splitOptions.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </>
          )}

          {currentStep === 2 && (
            <div className="space-y-4">
              <TrainingLocationPresetRow onApply={(slugs) => setEquipment(new Set(slugs))} />
              <div>
                <label className={lbl}>Thiết bị bạn có thể sử dụng</label>
                {catalogQuery.isLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-5 h-5 text-green-500 animate-spin" />
                  </div>
                ) : (
                  <EquipmentPicker catalog={catalog} selectedSlugs={equipment} onChange={setEquipment} />
                )}
              </div>
              <p className="text-[11px] text-zinc-600">
                Không chọn gì nghĩa là hệ thống sẽ giả định phòng gym đầy đủ thiết bị. Bạn có thể chỉnh lại
                bất cứ lúc nào trong Hồ sơ → Thiết lập tập luyện.
              </p>
            </div>
          )}

          {currentStep === 3 && (
            <>
              <div>
                <label className={lbl}>Chấn thương hoặc hạn chế cần lưu ý</label>
                <textarea
                  rows={3}
                  placeholder="Ví dụ: đau vai trái, đau lưng dưới — cách nhau bằng dấu phẩy"
                  value={injuriesText}
                  onChange={(e) => setInjuriesText(e.target.value)}
                  className={`${inp} resize-none`}
                />
                <p className="text-[11px] text-zinc-600 mt-1">Để trống nếu không có chấn thương nào.</p>
              </div>
              <div>
                <label className="flex items-center gap-2 text-sm text-zinc-300">
                  <input
                    data-testid="competes-in-sport-checkbox"
                    type="checkbox"
                    checked={competesInSport}
                    onChange={(e) => setCompetesInSport(e.target.checked)}
                    className="h-4 w-4 rounded border-zinc-700 bg-zinc-800 accent-green-500"
                  />
                  Tôi đang thi đấu thể hình/thể thao chuyên nghiệp
                </label>
                <p className="text-[11px] text-zinc-600 mt-1">
                  Bật mục này để hệ thống áp dụng ngưỡng kiểm tra dữ liệu chặt chẽ hơn, không đưa lời khuyên đơn giản hoá.
                </p>
              </div>
              <div>
                <label className={lbl}>Sàng lọc an toàn trước khi tập</label>
                <p className="text-[11px] text-zinc-600 mb-2">
                  Đây không phải công cụ chẩn đoán y tế — chỉ giúp hệ thống đưa lời khuyên thận trọng hơn. Chọn "Có" cho bất kỳ mục nào phù hợp với bạn.
                </p>
                <div className="space-y-2">
                  {safetyQuestions.map((q) => (
                    <label
                      key={q.key}
                      className="flex items-start gap-2.5 text-sm text-zinc-300 bg-zinc-800/40 rounded-lg px-3 py-2.5"
                    >
                      <input
                        data-testid={`safety-flag-${q.key}`}
                        type="checkbox"
                        checked={safetyFlags.has(q.key)}
                        onChange={(e) => {
                          setSafetyFlags((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(q.key);
                            else next.delete(q.key);
                            return next;
                          });
                          setSafetyStepReached(true);
                        }}
                        className="h-4 w-4 mt-0.5 rounded border-zinc-700 bg-zinc-800 accent-green-500 flex-shrink-0"
                      />
                      <span>{q.label}</span>
                    </label>
                  ))}
                </div>
                {safetyFlags.size > 0 && (
                  <p className="text-[11px] text-amber-400 mt-2">
                    Bạn nên hỏi ý kiến bác sĩ trước khi bắt đầu hoặc thay đổi cường độ tập luyện. Chúng tôi vẫn cho bạn tiếp tục sử dụng ứng dụng — AI sẽ đưa khuyến nghị thận trọng hơn cho bạn.
                  </p>
                )}
              </div>
            </>
          )}

          {currentStep === 4 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={lbl}>Tuổi</label>
                <input type="number" value={age} onChange={(e) => setAge(e.target.value)} className={inp} />
              </div>
              <div>
                <label className={lbl}>Giới tính</label>
                <select value={gender} onChange={(e) => setGender(e.target.value)} className={inp}>
                  <option value="">Chưa thiết lập</option>
                  <option value="MALE">Nam</option>
                  <option value="FEMALE">Nữ</option>
                  <option value="OTHER">Khác</option>
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className={lbl}>Mức độ vận động hằng ngày (ngoài giờ tập gym) *</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {activityLevels.map((a) => (
                    <button
                      key={a.key}
                      type="button"
                      data-testid={`activity-level-${a.key}`}
                      onClick={() => setActivityLevel(a.key)}
                      className={`text-left p-2.5 rounded-xl border-2 transition-all ${
                        activityLevel === a.key ? "border-green-500 bg-green-500/10" : "border-zinc-700/60 hover:border-zinc-600"
                      }`}
                    >
                      <div className="text-sm font-semibold text-zinc-200">{a.label}</div>
                      <div className="text-[11px] text-zinc-500 mt-0.5">{a.desc}</div>
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-zinc-600 mt-1.5">
                  Đây là hoạt động NGOÀI buổi tập (công việc, đi lại...) — dùng để tính nhu cầu calo chính xác hơn.
                </p>
              </div>
              <div className="sm:col-span-2">
                <div className="flex items-center justify-between mb-1.5">
                  <label className={`${lbl} mb-0`}>Chiều cao</label>
                  <div className="flex rounded-lg border border-zinc-700/60 overflow-hidden text-[11px]">
                    {(["cm", "ftin"] as const).map((u) => (
                      <button
                        key={u}
                        type="button"
                        onClick={() => switchHeightUnit(u)}
                        className={`px-2.5 py-1 font-semibold ${heightUnit === u ? "bg-green-500 text-black" : "bg-zinc-800/60 text-zinc-400"}`}
                      >
                        {u === "cm" ? "cm" : "ft/in"}
                      </button>
                    ))}
                  </div>
                </div>
                {heightUnit === "cm" ? (
                  <input type="number" value={heightCm} onChange={(e) => setHeightCm(e.target.value)} className={inp} placeholder="175" />
                ) : (
                  <div className="flex gap-2">
                    <input
                      type="number"
                      value={heightFt}
                      onChange={(e) => updateHeightFtIn(e.target.value, heightIn)}
                      className={inp}
                      placeholder="ft"
                    />
                    <input
                      type="number"
                      value={heightIn}
                      onChange={(e) => updateHeightFtIn(heightFt, e.target.value)}
                      className={inp}
                      placeholder="in"
                    />
                  </div>
                )}
              </div>
              <div className="sm:col-span-2">
                <div className="flex items-center justify-between mb-1.5">
                  <label className={`${lbl} mb-0`}>Cân nặng</label>
                  <div className="flex rounded-lg border border-zinc-700/60 overflow-hidden text-[11px]">
                    {(["kg", "lb"] as const).map((u) => (
                      <button
                        key={u}
                        type="button"
                        onClick={() => setWeightUnit(u)}
                        className={`px-2.5 py-1 font-semibold ${weightUnit === u ? "bg-green-500 text-black" : "bg-zinc-800/60 text-zinc-400"}`}
                      >
                        {u}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[11px] text-zinc-600 mb-1 block">Hiện tại</label>
                    <input
                      type="number"
                      value={displayWeight(currentWeight)}
                      onChange={(e) => updateWeightFromDisplay(e.target.value, setCurrentWeight)}
                      className={inp}
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-zinc-600 mb-1 block">Mục tiêu (nếu có)</label>
                    <input
                      type="number"
                      value={displayWeight(targetWeight)}
                      onChange={(e) => updateWeightFromDisplay(e.target.value, setTargetWeight)}
                      className={inp}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {isLastStep && (
            <div className="space-y-3">
              <p className="text-sm text-zinc-400">Kiểm tra lại thông tin trước khi hoàn tất:</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                <ReviewRow label="Trình độ" value={experienceLevels.find((l) => l.key === experienceLevel)?.label} onEdit={() => setCurrentStep(0)} />
                <ReviewRow label="Mục tiêu" value={goalOptions.find((g) => g.key === goal)?.label} onEdit={() => setCurrentStep(0)} />
                <ReviewRow label="Ngày tập/tuần" value={`${trainingDays.length} ngày`} onEdit={() => setCurrentStep(1)} />
                <ReviewRow label="Kiểu chia lịch" value={splitMode === "manual" ? preferredSplit || "Chưa có ý kiến" : "Hệ thống tự đề xuất"} onEdit={() => setCurrentStep(1)} />
                <ReviewRow
                  label="Thiết bị"
                  value={
                    equipment.size
                      ? `${equipment.size} thiết bị đã chọn`
                      : "Phòng gym đầy đủ (mặc định)"
                  }
                  onEdit={() => setCurrentStep(2)}
                />
                <ReviewRow label="Chấn thương" value={injuriesText || "Không có"} onEdit={() => setCurrentStep(3)} />
                <ReviewRow label="Thi đấu chuyên nghiệp" value={competesInSport ? "Có" : "Không"} onEdit={() => setCurrentStep(3)} />
                <ReviewRow
                  label="Sàng lọc an toàn"
                  value={!safetyStepReached ? "Chưa thực hiện" : safetyFlags.size > 0 ? `${safetyFlags.size} lưu ý cần thận trọng` : "Không có lưu ý nào"}
                  onEdit={() => setCurrentStep(3)}
                />
                <ReviewRow label="Mức độ vận động" value={activityLevels.find((a) => a.key === activityLevel)?.label || "Chưa chọn"} onEdit={() => setCurrentStep(4)} />
                <ReviewRow label="Chỉ số cơ thể" value={[age && `${age} tuổi`, heightCm && `${heightCm}cm`, currentWeight && `${currentWeight}kg`].filter(Boolean).join(", ") || "Chưa nhập"} onEdit={() => setCurrentStep(4)} />
              </div>
            </div>
          )}
        </div>

        {/* Footer nav */}
        <div className="border-t border-zinc-800/60 p-4 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setCurrentStep((s) => Math.max(0, s - 1))}
            disabled={currentStep === 0}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold text-zinc-400 border border-zinc-700/60 disabled:opacity-40 hover:bg-zinc-800 transition-all"
          >
            <ChevronLeft className="w-4 h-4" /> Quay lại
          </button>
          <button
            type="button"
            onClick={() => submitMutation.mutate(false)}
            disabled={submitMutation.isPending}
            className="text-xs text-zinc-500 hover:text-zinc-300 underline underline-offset-2"
          >
            Bỏ qua, thiết lập sau
          </button>
          {isLastStep ? (
            <button
              type="button"
              onClick={() => submitMutation.mutate(true)}
              disabled={submitMutation.isPending}
              className="flex items-center gap-1.5 px-5 py-2 rounded-xl text-sm font-bold bg-green-500 text-black hover:bg-green-400 shadow-lg shadow-green-500/25 disabled:opacity-60 transition-all"
            >
              {submitMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              Hoàn tất
            </button>
          ) : (
            <button
              type="button"
              onClick={() => canGoNext() && setCurrentStep((s) => Math.min(steps.length - 1, s + 1))}
              disabled={!canGoNext()}
              className="flex items-center gap-1.5 px-5 py-2 rounded-xl text-sm font-bold bg-green-500 text-black hover:bg-green-400 shadow-lg shadow-green-500/25 disabled:opacity-40 transition-all"
            >
              Tiếp tục <ChevronRight className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function ReviewRow({ label, value, onEdit }: { label: string; value?: string; onEdit: () => void }) {
  return (
    <div className="flex items-center justify-between gap-2 bg-zinc-800/40 rounded-lg px-3 py-2">
      <div>
        <div className="text-[11px] text-zinc-600 uppercase tracking-wider">{label}</div>
        <div className="text-zinc-200">{value || "—"}</div>
      </div>
      <button type="button" onClick={onEdit} className="text-[11px] text-green-400 hover:text-green-300 flex-shrink-0">
        Sửa
      </button>
    </div>
  );
}
