import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeftIcon as ArrowLeft,
  ArrowRightIcon as ArrowRight,
  CaretDownIcon as CaretDown,
  CheckCircleIcon as CheckCircle2,
  CircleNotchIcon as Loader2,
  FlameIcon as Flame,
  ScanIcon as Scan,
  SparkleIcon as Sparkles,
  WarningIcon as AlertTriangle,
} from "@phosphor-icons/react";
import {
  fitnessRoadmapService,
  profileService,
  inbodyService,
  type FitnessDiagnosisInput,
  type FitnessDiagnosisResult,
  type PhaseForecastResult,
  type RoadmapAiDraft,
  type RoadmapPhaseForecastResult,
  type RoadmapPhaseType,
  type StrategyBucket,
} from "../../services/api";
import { fitnessAgentService } from "../../services/fitnessAgent";
import { focusLabels } from "../../components/agent/FitnessAgentBlocks";

/**
 * Gymini Guided Roadmap Creation — the 4-visible-step wizard replacing the
 * old two-flat-button ("Tạo bằng AI" / "Tạo thủ công") entry point. See
 * docs/GYMINI_GUIDED_ROADMAP_CREATION_DESIGN.md. One continuous flow, not
 * four separate pages — everything lives in this single component's step
 * state. Never a competing source of truth: every number either comes from
 * the user's real stored profile/InBody, the one authoritative
 * computeInitialNutritionPrescription (via GET-equivalent
 * POST /fitness-roadmaps/diagnosis, read-only), or the existing AI roadmap
 * draft/accept/activate endpoints — nothing here invents its own formula.
 */

type Gender = "MALE" | "FEMALE" | "OTHER";
type ActivityLevel = "SEDENTARY" | "LIGHTLY_ACTIVE" | "MODERATELY_ACTIVE" | "VERY_ACTIVE" | "EXTREMELY_ACTIVE";
type BodyFatMethod = "manual" | "visual_reference" | "inbody";
type GoalKey = "WEIGHT_LOSS" | "MUSCLE_GAIN" | "MAINTENANCE" | "ATHLETIC_PERFORMANCE";

const ACTIVITY_OPTIONS: Array<{ key: ActivityLevel; label: string; hint: string }> = [
  { key: "SEDENTARY", label: "Ít vận động", hint: "Công việc bàn giấy, gần như không tập" },
  { key: "LIGHTLY_ACTIVE", label: "Vận động nhẹ", hint: "Tập 1-3 buổi/tuần" },
  { key: "MODERATELY_ACTIVE", label: "Vận động vừa", hint: "Tập 3-5 buổi/tuần" },
  { key: "VERY_ACTIVE", label: "Năng động", hint: "Tập 6-7 buổi/tuần" },
  { key: "EXTREMELY_ACTIVE", label: "Cực kỳ năng động", hint: "Vận động viên, lao động chân tay nặng" },
];

const GOAL_OPTIONS: Array<{ key: GoalKey; label: string; emoji: string; desc: string }> = [
  { key: "WEIGHT_LOSS", label: "Giảm mỡ", emoji: "🔥", desc: "Giảm tỷ lệ mỡ cơ thể, giữ khối cơ" },
  { key: "MUSCLE_GAIN", label: "Tăng cơ", emoji: "💪", desc: "Tăng khối cơ có kiểm soát" },
  { key: "MAINTENANCE", label: "Duy trì vóc dáng", emoji: "⚖️", desc: "Giữ ổn định hình thể hiện tại" },
  { key: "ATHLETIC_PERFORMANCE", label: "Hiệu suất thể thao", emoji: "🏆", desc: "Ưu tiên sức mạnh/hiệu suất tập luyện" },
];

const VISUAL_REFERENCE_OPTIONS: Array<{ pct: number; label: string; desc: string }> = [
  { pct: 12, label: "Săn chắc, thấy rõ cơ bụng", desc: "~10-14%" },
  { pct: 18, label: "Thon gọn, cơ bắp mờ", desc: "~16-20%" },
  { pct: 25, label: "Trung bình, chưa rõ cơ bắp", desc: "~23-27%" },
  { pct: 32, label: "Đầy đặn, tích mỡ rõ", desc: "~30-35%" },
];

const PHASE_TYPE_LABEL: Record<RoadmapPhaseType, string> = {
  FAT_LOSS: "Giảm mỡ",
  DIET_BREAK: "Nghỉ giữa kỳ",
  MAINTENANCE: "Duy trì",
  LEAN_GAIN: "Tăng cơ nạc",
  MINI_CUT: "Cắt ngắn",
  RECOMPOSITION: "Tái cấu trúc cơ thể",
  PERFORMANCE: "Hiệu suất",
  RECOVERY: "Hồi phục",
};

// Gymini Roadmap Projection & Strategy Report Hardening (design doc §11) —
// K1/K2/K3 strategy grouping is now computed SERVER-SIDE
// (fitness-roadmap-forecast.engine.ts's deriveStrategyGroups, context-aware:
// a diet break/maintenance/recovery bridge phase joins whichever campaign
// it actually belongs to, not just its own isolated phaseType bucket) — see
// fitnessRoadmapService.getPhaseForecast. This file only renders the
// server's already-computed strategyGroups/phaseForecasts.
export const STRATEGY_BUCKET_LABEL: Record<StrategyBucket, string> = {
  CUT: "Giảm mỡ",
  BUILD: "Tăng cơ / Hiệu suất",
  STABILIZE: "Chuyển tiếp / Duy trì",
};

function fmtKcal(n: number) {
  return `${Math.round(n).toLocaleString("vi-VN")} kcal`;
}
function fmtKg(n: number) {
  return `${n.toLocaleString("vi-VN", { maximumFractionDigits: 1 })} kg`;
}
function fmtPct(n: number) {
  return `${n.toLocaleString("vi-VN", { maximumFractionDigits: 1 })}%`;
}

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });
}

type GoalVisualAttributes = {
  muscularity: string | null;
  relativeLeanness: string | null;
  focusMuscles: string[];
  confidence: number;
  usable: boolean;
};

// Same wording FitnessAgentBlocks.tsx uses for the AI Coach chat's own
// GOAL_ANALYSIS block, so a user sees identical labels whether the photo
// was analyzed here or in AI Coach chat.
const MUSCULARITY_LABEL: Record<string, string> = { LOW: "Nhẹ", MODERATE: "Vừa", HIGH: "Rõ nét" };
const LEANNESS_LABEL: Record<string, string> = {
  MODERATE: "Cân đối",
  LEAN_APPEARANCE: "Gọn, rõ nét",
  VERY_LEAN_APPEARANCE: "Rất rõ nét (cần chuyên gia tư vấn)",
};

const STEP_LABELS = ["Thông tin cơ bản", "Tập luyện & Hoạt động", "Mục tiêu", "Báo cáo & Lộ trình"];

const inputClass =
  "w-full rounded-lg border border-zinc-700/60 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-green-500 focus:outline-none";
const labelClass = "mb-1.5 block text-xs text-zinc-400";
const cardClass = "rounded-2xl border border-zinc-700/60 bg-zinc-900/60 p-5 space-y-4";

export function GuidedRoadmapWizard({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [step, setStep] = useState(1);

  // ── Step 1: Thông tin cơ bản ─────────────────────────────────────────
  const [weightKg, setWeightKg] = useState("");
  const [heightCm, setHeightCm] = useState("");
  const [age, setAge] = useState("");
  const [gender, setGender] = useState<Gender | "">("");
  const [bodyFatMethod, setBodyFatMethod] = useState<BodyFatMethod>("manual");
  const [bodyFatPct, setBodyFatPct] = useState("");
  const [inbodyBodyFatPct, setInbodyBodyFatPct] = useState<number | null>(null);
  const [inbodyDate, setInbodyDate] = useState<string | null>(null);
  const prefilledRef = useRef(false);

  // Cross-System Fitness Journey Integration phase — real bug found live:
  // profileService.getProfile() resolves to the API's raw {profile: {...}}
  // envelope, not the profile object itself (confirmed against
  // profile.controller.ts's res.json({ profile }) and OnboardingWizardPage.
  // tsx's own correct `.then((r) => r.profile)` convention). Without
  // unwrapping, every `p.age`/`p.gender`/... check below silently no-oped
  // forever — onboarding data never reached this wizard for any user.
  const profileQuery = useQuery({
    queryKey: ["profile", "me"],
    queryFn: () => profileService.getProfile().then((r: any) => r.profile),
    retry: false,
  });
  const inbodyHistoryQuery = useQuery({
    queryKey: ["inbody", "history", "roadmap-wizard"],
    queryFn: inbodyService.getHistory,
    retry: false,
  });

  useEffect(() => {
    if (prefilledRef.current) return;
    if (!profileQuery.data && !inbodyHistoryQuery.data) return;
    prefilledRef.current = true;
    const p = profileQuery.data ?? {};
    if (p.age) setAge(String(p.age));
    if (p.gender) setGender(p.gender);
    if (p.heightCm) setHeightCm(String(p.heightCm));
    if (p.currentWeight) setWeightKg(String(p.currentWeight));

    const history = Array.isArray(inbodyHistoryQuery.data) ? inbodyHistoryQuery.data : [];
    const latest = history[0];
    if (latest?.bodyFatPct != null) {
      setInbodyBodyFatPct(latest.bodyFatPct);
      setInbodyDate(latest.date ?? latest.dateOnly ?? null);
      setBodyFatMethod("inbody");
      // InBody's own real measured weight always outranks a possibly-stale
      // stored profile weight — same priority used server-side.
      if (latest.weight) setWeightKg(String(latest.weight));
    }
  }, [profileQuery.data, inbodyHistoryQuery.data]);

  // ── Step 2: Tập luyện & Hoạt động ────────────────────────────────────
  const [activityLevel, setActivityLevel] = useState<ActivityLevel | "">("");
  const [trainingDaysPerWeek, setTrainingDaysPerWeek] = useState(3);
  const [dailyGoalSteps, setDailyGoalSteps] = useState(8000);

  // ── Step 3: Mục tiêu ─────────────────────────────────────────────────
  const [goal, setGoal] = useState<GoalKey>("WEIGHT_LOSS");
  const [targetWeightKg, setTargetWeightKg] = useState("");
  const [targetBodyFatPercent, setTargetBodyFatPercent] = useState("");
  const [timeframeWeeks, setTimeframeWeeks] = useState(24);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [goalImageAttrs, setGoalImageAttrs] = useState<GoalVisualAttributes | null>(null);
  const [goalImageNote, setGoalImageNote] = useState<string | null>(null);
  const [goalImageStatus, setGoalImageStatus] = useState<"idle" | "analyzing" | "unusable">("idle");
  const [roadmapName, setRoadmapName] = useState("Lộ trình của tôi");

  async function handleGoalImage(file: File) {
    setGoalImageStatus("analyzing");
    try {
      const reply = await fitnessAgentService.image(file);
      const attrs = reply.block?.attributes as GoalVisualAttributes | undefined;
      setGoalImageNote(reply.block?.note ?? null);
      if (!attrs || attrs.usable === false) {
        setGoalImageStatus("unusable");
        setGoalImageAttrs(null);
        return;
      }
      setGoalImageAttrs(attrs);
      setGoalImageStatus("idle");
    } catch (error: any) {
      setGoalImageStatus("unusable");
      setGoalImageAttrs(null);
      setGoalImageNote(null);
      toast.error(error?.message ?? "Không thể phân tích ảnh — bạn vẫn có thể tiếp tục không cần ảnh.");
    }
  }

  // ── Shared diagnosis payload (Step 2 energy breakdown + Step 4 report) ──
  const effectiveBodyFatPct =
    bodyFatMethod === "inbody" && inbodyBodyFatPct != null
      ? inbodyBodyFatPct
      : bodyFatPct
        ? Number(bodyFatPct)
        : undefined;

  const diagnosisInput: FitnessDiagnosisInput = useMemo(() => {
    const input: FitnessDiagnosisInput = {};
    if (weightKg) input.weightKg = Number(weightKg);
    if (heightCm) input.heightCm = Number(heightCm);
    if (age) input.age = Number(age);
    if (gender) input.gender = gender;
    if (effectiveBodyFatPct != null && !Number.isNaN(effectiveBodyFatPct)) {
      input.bodyFatPct = effectiveBodyFatPct;
      input.bodyFatMethod = bodyFatMethod;
    }
    if (activityLevel) input.activityLevel = activityLevel;
    input.trainingDaysPerWeek = trainingDaysPerWeek;
    input.dailyGoalSteps = dailyGoalSteps;
    input.goal = goal;
    if (targetWeightKg) input.targetWeightKg = Number(targetWeightKg);
    if (targetBodyFatPercent) input.targetBodyFatPercent = Number(targetBodyFatPercent);
    input.timeframeWeeks = timeframeWeeks;
    return input;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    weightKg, heightCm, age, gender, effectiveBodyFatPct, bodyFatMethod,
    activityLevel, trainingDaysPerWeek, dailyGoalSteps, goal,
    targetWeightKg, targetBodyFatPercent, timeframeWeeks,
  ]);

  const hasMinimumEnergyInputs = Boolean(weightKg && heightCm && age && gender && activityLevel);

  const diagnosisQuery = useQuery<FitnessDiagnosisResult>({
    queryKey: ["fitness-roadmap", "wizard-diagnosis", JSON.stringify(diagnosisInput)],
    queryFn: () => fitnessRoadmapService.getDiagnosis(diagnosisInput),
    enabled: hasMinimumEnergyInputs && step >= 2,
    staleTime: 15_000,
    retry: false,
  });

  // ── Step 4: AI roadmap draft (reuses the existing, already-verified
  // generateAiDraft/acceptAiDraft/activate contract — no new lifecycle) ──
  const [draft, setDraft] = useState<RoadmapAiDraft | null>(null);
  const draftMutation = useMutation({
    mutationFn: () =>
      fitnessRoadmapService.generateAiDraft({
        goalType: goal,
        timeframeWeeks,
        goalVisualAttributes: goalImageAttrs
          ? { muscularity: goalImageAttrs.muscularity, relativeLeanness: goalImageAttrs.relativeLeanness, focusMuscles: goalImageAttrs.focusMuscles }
          : undefined,
        targetWeightKg: targetWeightKg ? Number(targetWeightKg) : undefined,
        targetBodyFatPercent: targetBodyFatPercent ? Number(targetBodyFatPercent) : undefined,
        trainingDaysPerWeek,
      }),
    onSuccess: (data) => setDraft(data),
    onError: (error: any) => {
      toast.error(error?.response?.data?.error ?? "Không thể tạo báo cáo lộ trình");
    },
  });

  useEffect(() => {
    if (step === 4 && !draft && !draftMutation.isPending) {
      draftMutation.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // ── Roadmap Projection & Strategy Report Hardening — the phase-by-phase
  // forecast (deterministic numbers, zero AI) for whatever phase sequence
  // the AI draft just proposed. Reuses the exact same current-state inputs
  // diagnosisInput already carries. ──
  const forecastPhasesInput = draft
    ? draft.phases.map((p, i) => ({
        phaseIndex: i + 1,
        phaseType: p.phaseType,
        name: p.name,
        plannedStartAt: p.plannedStartAt,
        plannedEndAt: p.plannedEndAt,
      }))
    : null;

  const forecastQuery = useQuery<RoadmapPhaseForecastResult>({
    queryKey: ["fitness-roadmap", "wizard-forecast", JSON.stringify(diagnosisInput), JSON.stringify(forecastPhasesInput)],
    queryFn: () =>
      fitnessRoadmapService.getPhaseForecast({
        weightKg: diagnosisInput.weightKg,
        heightCm: diagnosisInput.heightCm,
        age: diagnosisInput.age,
        gender: diagnosisInput.gender,
        bodyFatPct: diagnosisInput.bodyFatPct,
        bodyFatMethod: diagnosisInput.bodyFatMethod,
        activityLevel: diagnosisInput.activityLevel,
        phases: forecastPhasesInput!,
      }),
    enabled: Boolean(forecastPhasesInput) && hasMinimumEnergyInputs,
    staleTime: 15_000,
    retry: false,
  });

  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  useEffect(() => {
    // Default: first (current) strategy group expanded, the rest collapsed
    // — design doc §15, avoids a permanently 3-meter-long mobile page.
    if (forecastQuery.data && expandedGroups.size === 0 && forecastQuery.data.strategyGroups.length > 0) {
      setExpandedGroups(new Set([forecastQuery.data.strategyGroups[0].key]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forecastQuery.data]);
  function toggleGroup(key: string) {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function buildAcceptPayload() {
    if (!draft) throw new Error("no draft");
    return {
      name: roadmapName.trim() || "Lộ trình của tôi",
      goalType: draft.goalType,
      plannedStartAt: draft.plannedStartAt,
      phases: draft.phases,
      configuration: {
        aiDraft: {
          summary: draft.summary,
          reasoningSummary: draft.reasoningSummary,
          confidence: draft.confidence,
          warnings: draft.warnings,
          assumptions: draft.assumptions,
        },
        // Additive sibling keys next to aiDraft — never competing
        // authoritative fields, purely a snapshot of what the wizard showed
        // the user at creation time (design doc §12), so a reopened DRAFT
        // can still show the same rich report (fixes the prior phase's
        // write-only diagnosisSnapshot gap).
        diagnosisSnapshot: diagnosisQuery.data ?? null,
        roadmapProjectionSnapshot: forecastQuery.data ?? null,
      },
    };
  }

  const saveDraftMutation = useMutation({
    mutationFn: () => fitnessRoadmapService.acceptAiDraft(buildAcceptPayload()),
    onSuccess: () => {
      toast.success("Đã lưu lộ trình — xem lại và bắt đầu khi bạn sẵn sàng");
      onCreated();
    },
    onError: (error: any) => {
      toast.error(error?.response?.data?.error ?? "Không thể lưu lộ trình");
    },
  });

  const startRoadmapMutation = useMutation({
    mutationFn: async () => {
      const accepted = await fitnessRoadmapService.acceptAiDraft(buildAcceptPayload());
      return fitnessRoadmapService.activate(accepted.roadmap.id);
    },
    onSuccess: () => {
      toast.success("Đã bắt đầu lộ trình!");
      onCreated();
    },
    onError: (error: any) => {
      toast.error(error?.response?.data?.error ?? "Không thể bắt đầu lộ trình");
    },
  });

  const canGoNextFromStep1 = Boolean(weightKg && heightCm && age && gender);
  const canGoNextFromStep2 = Boolean(activityLevel);

  function goNext() {
    if (step === 1 && !canGoNextFromStep1) {
      toast.error("Vui lòng nhập đủ cân nặng, chiều cao, tuổi và giới tính");
      return;
    }
    if (step === 2 && !canGoNextFromStep2) {
      toast.error("Vui lòng chọn mức độ vận động");
      return;
    }
    setStep((s) => Math.min(4, s + 1));
  }
  function goBack() {
    setStep((s) => Math.max(1, s - 1));
  }

  return (
    <div className={cardClass}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
          <Sparkles className="h-4 w-4 text-green-400" />
          Tạo lộ trình cùng Gymini
        </div>
        <button type="button" onClick={onClose} className="text-xs text-zinc-500 hover:text-zinc-300">
          Đóng
        </button>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-1.5">
        {STEP_LABELS.map((label, i) => {
          const idx = i + 1;
          const isActive = idx === step;
          const isDone = idx < step;
          return (
            <div key={label} className="flex flex-1 items-center gap-1.5">
              <div
                className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                  isActive
                    ? "bg-green-500 text-black"
                    : isDone
                      ? "bg-green-500/20 text-green-400"
                      : "bg-zinc-800 text-zinc-500"
                }`}
              >
                {isDone ? <CheckCircle2 className="h-3.5 w-3.5" /> : idx}
              </div>
              {idx < 4 && <div className={`h-px flex-1 ${isDone ? "bg-green-500/40" : "bg-zinc-800"}`} />}
            </div>
          );
        })}
      </div>
      <p className="text-xs font-semibold text-zinc-300">
        Bước {step}/4 · {STEP_LABELS[step - 1]}
      </p>

      {step === 1 && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="wizard-weightKg" className={labelClass}>Cân nặng (kg)</label>
              <input id="wizard-weightKg" type="number" value={weightKg} onChange={(e) => setWeightKg(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label htmlFor="wizard-heightCm" className={labelClass}>Chiều cao (cm)</label>
              <input id="wizard-heightCm" type="number" value={heightCm} onChange={(e) => setHeightCm(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label htmlFor="wizard-age" className={labelClass}>Tuổi</label>
              <input id="wizard-age" type="number" value={age} onChange={(e) => setAge(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label htmlFor="wizard-gender" className={labelClass}>Giới tính</label>
              <select id="wizard-gender" value={gender} onChange={(e) => setGender(e.target.value as Gender)} className={inputClass}>
                <option value="">Chọn giới tính</option>
                <option value="MALE">Nam</option>
                <option value="FEMALE">Nữ</option>
                <option value="OTHER">Khác</option>
              </select>
            </div>
          </div>

          <div>
            <label className={labelClass}>Tỷ lệ mỡ cơ thể (không bắt buộc)</label>
            {bodyFatMethod === "inbody" && inbodyBodyFatPct != null ? (
              <div className="flex items-center justify-between rounded-lg border border-green-500/30 bg-green-500/5 p-3">
                <div>
                  <p className="text-sm font-semibold text-zinc-100">{inbodyBodyFatPct}% (từ InBody)</p>
                  <p className="text-xs text-zinc-500">Đo lúc {formatDate(inbodyDate)} — dữ liệu đo thật, ưu tiên hơn ước lượng</p>
                </div>
                <button
                  type="button"
                  onClick={() => setBodyFatMethod("manual")}
                  className="text-xs font-semibold text-green-300 underline"
                >
                  Nhập khác
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setBodyFatMethod("manual")}
                    className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-all ${
                      bodyFatMethod === "manual" ? "border-green-500 bg-green-500 text-black" : "border-zinc-700/60 bg-zinc-900 text-zinc-400"
                    }`}
                  >
                    Nhập số liệu
                  </button>
                  <button
                    type="button"
                    onClick={() => setBodyFatMethod("visual_reference")}
                    className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-all ${
                      bodyFatMethod === "visual_reference" ? "border-green-500 bg-green-500 text-black" : "border-zinc-700/60 bg-zinc-900 text-zinc-400"
                    }`}
                  >
                    Ước lượng qua hình ảnh tham khảo
                  </button>
                  <button
                    type="button"
                    disabled
                    title="Chưa có dịch vụ quét AI an toàn cho số đo cơ thể — sẽ ra mắt sau"
                    className="flex items-center gap-1 rounded-full border border-zinc-800 bg-zinc-900/50 px-3 py-1.5 text-xs font-semibold text-zinc-600 cursor-not-allowed"
                  >
                    <Scan className="h-3 w-3" /> Quét bằng AI · Sắp ra mắt
                  </button>
                  {inbodyBodyFatPct != null && (
                    <button
                      type="button"
                      onClick={() => setBodyFatMethod("inbody")}
                      className="rounded-full border border-zinc-700/60 bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-zinc-400"
                    >
                      Dùng lại số liệu InBody
                    </button>
                  )}
                </div>

                {bodyFatMethod === "manual" && (
                  <input
                    type="number"
                    placeholder="VD: 20"
                    value={bodyFatPct}
                    onChange={(e) => setBodyFatPct(e.target.value)}
                    className={`${inputClass} w-32`}
                  />
                )}

                {bodyFatMethod === "visual_reference" && (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {VISUAL_REFERENCE_OPTIONS.map((opt) => (
                      <button
                        key={opt.pct}
                        type="button"
                        onClick={() => setBodyFatPct(String(opt.pct))}
                        className={`rounded-lg border p-2.5 text-left transition-all ${
                          Number(bodyFatPct) === opt.pct ? "border-green-500 bg-green-500/10" : "border-zinc-700/60 bg-zinc-900"
                        }`}
                      >
                        <p className="text-xs font-semibold text-zinc-200">{opt.label}</p>
                        <p className="text-xs text-zinc-500">{opt.desc}</p>
                      </button>
                    ))}
                  </div>
                )}
                {bodyFatMethod === "visual_reference" && (
                  <p className="text-xs text-zinc-600">Chỉ là ước lượng tham khảo, không thay thế đo InBody hoặc thiết bị chuyên dụng.</p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <div>
            <label className={labelClass}>Mức độ vận động hằng ngày</label>
            <div className="space-y-1.5">
              {ACTIVITY_OPTIONS.map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setActivityLevel(opt.key)}
                  className={`flex w-full items-center justify-between rounded-lg border p-2.5 text-left transition-all ${
                    activityLevel === opt.key ? "border-green-500 bg-green-500/10" : "border-zinc-700/60 bg-zinc-900"
                  }`}
                >
                  <div>
                    <p className="text-sm font-semibold text-zinc-200">{opt.label}</p>
                    <p className="text-xs text-zinc-500">{opt.hint}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Số ngày tập/tuần</label>
              <input
                type="number"
                min={0}
                max={7}
                value={trainingDaysPerWeek}
                onChange={(e) => setTrainingDaysPerWeek(Math.max(0, Math.min(7, Number(e.target.value) || 0)))}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Mục tiêu bước chân/ngày</label>
              <input
                type="number"
                min={0}
                step={500}
                value={dailyGoalSteps}
                onChange={(e) => setDailyGoalSteps(Math.max(0, Number(e.target.value) || 0))}
                className={inputClass}
              />
            </div>
          </div>

          <EnergyBreakdownCard
            breakdown={diagnosisQuery.data?.energyBreakdown ?? null}
            insufficientInputs={!hasMinimumEnergyInputs}
            loading={hasMinimumEnergyInputs && diagnosisQuery.isLoading}
          />
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4">
          <div>
            <label className={labelClass}>Mục tiêu của bạn</label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {GOAL_OPTIONS.map((g) => (
                <button
                  key={g.key}
                  type="button"
                  onClick={() => setGoal(g.key)}
                  className={`rounded-lg border p-3 text-left transition-all ${
                    goal === g.key ? "border-green-500 bg-green-500/10" : "border-zinc-700/60 bg-zinc-900"
                  }`}
                >
                  <p className="text-sm font-semibold text-zinc-200">
                    {g.emoji} {g.label}
                  </p>
                  <p className="text-xs text-zinc-500">{g.desc}</p>
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="wizard-targetWeightKg" className={labelClass}>Cân nặng mục tiêu (kg, không bắt buộc)</label>
              <input id="wizard-targetWeightKg" type="number" value={targetWeightKg} onChange={(e) => setTargetWeightKg(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label htmlFor="wizard-timeframeWeeks" className={labelClass}>Thời gian mong muốn (tuần)</label>
              <input
                id="wizard-timeframeWeeks"
                type="number"
                min={1}
                max={104}
                value={timeframeWeeks}
                onChange={(e) => setTimeframeWeeks(Number(e.target.value) || 24)}
                className={inputClass}
              />
            </div>
          </div>

          <button
            type="button"
            onClick={() => setShowAdvanced((s) => !s)}
            className="flex items-center gap-1 text-xs font-semibold text-zinc-400 hover:text-zinc-200"
          >
            <CaretDown className={`h-3.5 w-3.5 transition-transform ${showAdvanced ? "rotate-180" : ""}`} />
            Tuỳ chọn nâng cao (tỷ lệ mỡ mục tiêu, FFMI)
          </button>
          {showAdvanced && (
            <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
              <div>
                <label className={labelClass}>Tỷ lệ mỡ mục tiêu (%)</label>
                <input
                  type="number"
                  value={targetBodyFatPercent}
                  onChange={(e) => setTargetBodyFatPercent(e.target.value)}
                  className={`${inputClass} w-32`}
                />
              </div>
              {diagnosisQuery.data?.current.ffmi && (
                <p className="text-xs text-zinc-500">
                  FFMI hiện tại (ước tính khối cơ nạc theo chiều cao): <span className="text-zinc-300">{diagnosisQuery.data.current.ffmi.normalizedFfmi}</span>
                </p>
              )}
              {diagnosisQuery.data?.target.ffmi && (
                <p className="text-xs text-zinc-500">
                  FFMI mục tiêu (nếu đạt tỷ lệ mỡ trên): <span className="text-zinc-300">{diagnosisQuery.data.target.ffmi.normalizedFfmi}</span>
                </p>
              )}
            </div>
          )}

          <div>
            <label className={labelClass}>Ảnh mục tiêu (không bắt buộc)</label>
            <input
              type="file"
              accept="image/jpeg,image/png"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleGoalImage(file);
              }}
              className="block w-full text-xs text-zinc-400"
            />
            <p className="mt-1 text-xs text-zinc-600">
              Ảnh chỉ dùng để gợi ý phong cách hình ảnh mong muốn (mức độ cơ bắp, độ săn chắc tổng thể) — KHÔNG phải một phép đo cơ thể
              chính xác, không được dùng để chẩn đoán hay so sánh với người khác.
            </p>
            {goalImageStatus === "analyzing" && (
              <p className="mt-1 flex items-center gap-1.5 text-xs text-zinc-500">
                <Loader2 className="h-3 w-3 animate-spin" /> Đang phân tích ảnh...
              </p>
            )}
            {goalImageStatus === "unusable" && <p className="mt-1 text-xs text-amber-400">Ảnh không dùng được — bạn vẫn có thể tiếp tục không cần ảnh.</p>}
            {goalImageAttrs && (
              <div className="mt-2 space-y-2 rounded-lg border border-green-500/20 bg-green-500/5 p-3">
                <p className="text-xs font-semibold text-green-300">Đã phân tích ảnh mục tiêu</p>
                <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
                  <div>
                    <p className="text-zinc-500">Mức cơ bắp</p>
                    <p className="font-semibold text-zinc-200">
                      {goalImageAttrs.muscularity ? MUSCULARITY_LABEL[goalImageAttrs.muscularity] ?? goalImageAttrs.muscularity : "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-zinc-500">Độ săn chắc</p>
                    <p className="font-semibold text-zinc-200">
                      {goalImageAttrs.relativeLeanness ? LEANNESS_LABEL[goalImageAttrs.relativeLeanness] ?? goalImageAttrs.relativeLeanness : "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-zinc-500">Độ tin cậy</p>
                    <p className="font-semibold text-zinc-200">{Math.round(goalImageAttrs.confidence * 100)}%</p>
                  </div>
                </div>
                {goalImageAttrs.focusMuscles.length > 0 && (
                  <div className="text-xs">
                    <p className="text-zinc-500">Nhóm cơ nổi bật</p>
                    <p className="font-semibold text-zinc-200">
                      {goalImageAttrs.focusMuscles.map((m) => focusLabels[m] ?? m).join(", ")}
                    </p>
                  </div>
                )}
                {goalImageNote && <p className="text-xs text-zinc-500">{goalImageNote}</p>}
              </div>
            )}
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="space-y-4">
          {/* Fitness Diagnosis */}
          <div className="rounded-xl border border-zinc-700/60 bg-zinc-900/50 p-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Chẩn đoán thể trạng</p>
            {!diagnosisQuery.data ? (
              <Loader2 className="h-4 w-4 animate-spin text-zinc-500" />
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <MetricCard
                  label="Cân nặng"
                  current={diagnosisQuery.data.current.weightKg != null ? `${diagnosisQuery.data.current.weightKg} kg` : null}
                  target={diagnosisQuery.data.target.weightKg != null ? `${diagnosisQuery.data.target.weightKg} kg` : null}
                />
                <MetricCard
                  label="Tỷ lệ mỡ"
                  current={diagnosisQuery.data.current.bodyFatPct != null ? `${diagnosisQuery.data.current.bodyFatPct}%` : null}
                  target={diagnosisQuery.data.target.bodyFatPct != null ? `${diagnosisQuery.data.target.bodyFatPct}%` : null}
                />
                <MetricCard
                  label="Khối nạc (FFMI)"
                  current={diagnosisQuery.data.current.ffmi ? String(diagnosisQuery.data.current.ffmi.normalizedFfmi) : null}
                  target={diagnosisQuery.data.target.ffmi ? String(diagnosisQuery.data.target.ffmi.normalizedFfmi) : null}
                />
                <MetricCard
                  label="TDEE hiện tại"
                  current={diagnosisQuery.data.energyBreakdown ? `${diagnosisQuery.data.energyBreakdown.tdee.toLocaleString("vi-VN")} kcal` : null}
                  target={null}
                />
              </div>
            )}
            {diagnosisQuery.data?.targetRealism.warnings.map((w, i) => (
              <div key={i} className="mt-2 flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-2.5">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-amber-400" />
                <p className="text-xs text-amber-200">{w}</p>
              </div>
            ))}
            {diagnosisQuery.data?.reasoning && (
              <div className="mt-3 rounded-lg border border-green-500/20 bg-green-500/5 p-3">
                <p className="mb-1 text-xs font-semibold text-green-300">Nhận định lộ trình</p>
                <p className="text-xs text-zinc-300">{diagnosisQuery.data.reasoning}</p>
              </div>
            )}
          </div>

          {/* Roadmap Report */}
          <div className="rounded-xl border border-green-500/20 bg-gradient-to-br from-green-500/10 to-zinc-900 p-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-green-400">Báo cáo lộ trình</p>
            {draftMutation.isPending && (
              <p className="flex items-center gap-2 text-sm text-zinc-400">
                <Loader2 className="h-4 w-4 animate-spin" /> Gymini đang soạn lộ trình...
              </p>
            )}
            {draft && (
              <div className="space-y-3">
                <p className="text-sm text-zinc-200">{draft.summary}</p>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="rounded-lg border border-zinc-700/60 bg-zinc-900/50 p-2.5">
                    <p className="text-zinc-500">Tổng thời gian</p>
                    <p className="font-semibold text-zinc-200">
                      {draft.phases.reduce((sum, p) => sum + Math.round((new Date(p.plannedEndAt).getTime() - new Date(p.plannedStartAt).getTime()) / (7 * 86_400_000)), 0)}{" "}
                      tuần
                    </p>
                  </div>
                  <div className="rounded-lg border border-zinc-700/60 bg-zinc-900/50 p-2.5">
                    <p className="text-zinc-500">Dự kiến kết thúc</p>
                    <p className="font-semibold text-zinc-200">{formatDate(draft.phases[draft.phases.length - 1]?.plannedEndAt)}</p>
                  </div>
                </div>

                {forecastQuery.isLoading && (
                  <p className="flex items-center gap-2 text-xs text-zinc-500">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Đang tính toán dự kiến từng giai đoạn...
                  </p>
                )}
                {forecastQuery.data && (
                  <div className="space-y-2">
                    {forecastQuery.data.strategyGroups.map((group) => {
                      const groupForecasts = forecastQuery.data!.phaseForecasts.filter((f) =>
                        group.phaseIndexes.includes(f.phaseIndex),
                      );
                      const totalWeeks = groupForecasts.reduce((s, f) => s + f.durationWeeks, 0);
                      const isExpanded = expandedGroups.has(group.key);
                      const kcalRange = groupForecasts.length
                        ? Math.round(groupForecasts.reduce((s, f) => s + f.projectedCalories, 0) / groupForecasts.length)
                        : null;
                      return (
                        <div key={group.key} className="rounded-lg border border-zinc-700/60 bg-zinc-900/40 overflow-hidden">
                          <button
                            type="button"
                            onClick={() => toggleGroup(group.key)}
                            className="flex w-full items-center justify-between p-2.5 text-left"
                          >
                            <div>
                              <p className="text-xs font-semibold text-zinc-200">
                                {group.key} · {STRATEGY_BUCKET_LABEL[group.bucket]}
                              </p>
                              <p className="text-xs text-zinc-500">
                                {groupForecasts.length} giai đoạn · {totalWeeks} tuần
                                {kcalRange ? ` · ~${kcalRange.toLocaleString("vi-VN")} kcal/ngày` : ""}
                              </p>
                            </div>
                            <CaretDown className={`h-4 w-4 flex-shrink-0 text-zinc-500 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                          </button>
                          {isExpanded && (
                            <div className="space-y-2 border-t border-zinc-800 p-2.5 pt-2">
                              {groupForecasts.map((f) => (
                                <PhaseForecastCard key={f.phaseIndex} forecast={f} />
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {draft.warnings.length > 0 && (
                  <div className="space-y-1.5">
                    {draft.warnings.map((w, i) => (
                      <div key={i} className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-2.5">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-amber-400" />
                        <p className="text-xs text-amber-200">{w}</p>
                      </div>
                    ))}
                  </div>
                )}

                <div className="rounded-lg border border-zinc-700/60 bg-zinc-900/30 p-2.5 text-xs text-zinc-500">
                  Lộ trình này không cố định — sau mỗi chu kỳ tập luyện, Gymini sẽ đánh giá lại dữ liệu thực tế và có thể điều chỉnh
                  giai đoạn, thời lượng, tập luyện và dinh dưỡng của bạn.
                </div>

                <div>
                  <label className={labelClass}>Tên lộ trình</label>
                  <input value={roadmapName} onChange={(e) => setRoadmapName(e.target.value)} className={inputClass} />
                </div>

                <div className="flex flex-col gap-2 sm:flex-row">
                  <button
                    type="button"
                    onClick={() => startRoadmapMutation.mutate()}
                    disabled={startRoadmapMutation.isPending || saveDraftMutation.isPending}
                    className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-green-500 px-4 py-2.5 text-sm font-bold text-black shadow-lg shadow-green-500/20 transition-all hover:bg-green-400 disabled:opacity-60"
                  >
                    {startRoadmapMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                    Bắt đầu lộ trình
                  </button>
                  <button
                    type="button"
                    onClick={() => saveDraftMutation.mutate()}
                    disabled={saveDraftMutation.isPending || startRoadmapMutation.isPending}
                    className="rounded-xl border border-zinc-700/60 px-4 py-2.5 text-sm font-semibold text-zinc-300 hover:border-green-500/40 disabled:opacity-60"
                  >
                    {saveDraftMutation.isPending && <Loader2 className="mr-1 inline h-4 w-4 animate-spin" />}
                    Lưu để xem sau
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Step navigation — hidden on step 4 (uses its own Save/Start CTAs instead) */}
      {step < 4 && (
        <div className="flex items-center justify-between pt-2">
          <button
            type="button"
            onClick={goBack}
            disabled={step === 1}
            className="flex items-center gap-1.5 rounded-lg border border-zinc-700/60 px-3 py-2 text-xs font-semibold text-zinc-400 hover:border-zinc-500 disabled:opacity-40"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Quay lại
          </button>
          <button
            type="button"
            onClick={goNext}
            className="flex items-center gap-1.5 rounded-lg bg-green-500 px-4 py-2 text-xs font-bold text-black hover:bg-green-400"
          >
            Tiếp tục <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      {step === 4 && (
        <button
          type="button"
          onClick={goBack}
          className="flex items-center gap-1.5 text-xs font-semibold text-zinc-500 hover:text-zinc-300"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Quay lại chỉnh sửa mục tiêu
        </button>
      )}
    </div>
  );
}

function MetricCard({ label, current, target }: { label: string; current: string | null; target: string | null }) {
  return (
    <div className="rounded-lg border border-zinc-700/60 bg-zinc-900/50 p-2.5">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="text-sm font-semibold text-zinc-200">
        {current ?? "Không đủ dữ liệu"}
        {target && <span className="text-zinc-500"> → {target}</span>}
      </p>
    </div>
  );
}

/** BMR/TDEE breakdown card — reused by GuidedRoadmapWizard's Step 2 AND
 * RoadmapJourneyPage's ActivePhaseDetail (via the saved diagnosisSnapshot)
 * so the two never diverge on how the same energyBreakdown data is shown.
 * Extracted during the Roadmap ACTIVE-journey refactor specifically so this
 * breakdown — previously only ever visible during creation — stays reachable
 * after activation too. */
export function EnergyBreakdownCard({
  breakdown,
  insufficientInputs,
  loading,
}: {
  breakdown: FitnessDiagnosisResult["energyBreakdown"] | null | undefined;
  insufficientInputs?: boolean;
  loading?: boolean;
}) {
  return (
    <div className="rounded-xl border border-zinc-700/60 bg-zinc-900/50 p-4">
      <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-500">
        <Flame className="h-3.5 w-3.5 text-orange-400" /> Tiêu hao năng lượng hiện tại
      </p>
      {insufficientInputs && (
        <p className="text-xs text-zinc-500">Không đủ dữ liệu — vui lòng hoàn thành Bước 1 và chọn mức độ vận động.</p>
      )}
      {!insufficientInputs && loading && <Loader2 className="h-4 w-4 animate-spin text-zinc-500" />}
      {!insufficientInputs && breakdown && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-sm">
            <span className="text-zinc-400">
              BMR ({breakdown.bmrFormula === "inbody_measured" ? "đo InBody" : "công thức Mifflin-St Jeor"})
            </span>
            <span className="font-semibold text-zinc-100">{breakdown.bmr.toLocaleString("vi-VN")} kcal</span>
          </div>
          {breakdown.components.map((c) => (
            <div key={c.label} className="flex items-center justify-between text-sm">
              <span className="text-zinc-400">{c.label}</span>
              <span className="font-semibold text-zinc-300">+{c.kcal.toLocaleString("vi-VN")} kcal</span>
            </div>
          ))}
          <div className="mt-1.5 flex items-center justify-between border-t border-zinc-800 pt-1.5 text-sm">
            <span className="font-semibold text-zinc-200">Tổng tiêu hao (TDEE)</span>
            <span className="font-bold text-green-400">{breakdown.tdee.toLocaleString("vi-VN")} kcal</span>
          </div>
          <p className="pt-1 text-xs text-zinc-600">
            Các dòng bước chân/tập luyện/TEF/hoạt động khác là ước lượng minh hoạ, luôn cộng đúng bằng tổng TDEE thật ở trên —
            không phải một công thức tính riêng.
          </p>
        </div>
      )}
    </div>
  );
}

/** One phase's quantitative forecast card — reused by GuidedRoadmapWizard's
 * Step 4 AND RoadmapJourneyPage's DraftRoadmapDetail (reopened draft) so
 * the two never show a different rendering of the same
 * roadmapProjectionSnapshot data. Every number is explicitly labeled an
 * estimate (design doc §15) — never presented as an authoritative
 * TrainingCycle/NutritionGoal/InBody value. */
export function PhaseForecastCard({ forecast: f }: { forecast: PhaseForecastResult }) {
  const deficitLabel =
    f.projectedDeficitOrSurplusPercent == null
      ? null
      : f.projectedDeficitOrSurplusPercent < 0
        ? `Thâm hụt ~${Math.round(Math.abs(f.projectedDeficitOrSurplusPercent) * 100)}%`
        : f.projectedDeficitOrSurplusPercent > 0
          ? `Thặng dư ~${Math.round(f.projectedDeficitOrSurplusPercent * 100)}%`
          : "Mức duy trì";

  return (
    <div className="rounded-lg border border-zinc-700/60 bg-zinc-900/60 p-3 text-xs">
      <div className="mb-2 flex items-center justify-between">
        <p className="font-semibold text-zinc-100">
          {f.name} <span className="text-zinc-500">· {PHASE_TYPE_LABEL[f.phaseType]}</span>
        </p>
        <p className="text-zinc-500">
          {formatDate(f.plannedStartAt)} → {formatDate(f.plannedEndAt)} · {f.durationWeeks} tuần
        </p>
      </div>

      {deficitLabel && (
        <p className="mb-1.5 inline-block rounded-full border border-green-500/30 bg-green-500/10 px-2 py-0.5 font-semibold text-green-300">
          {deficitLabel}
        </p>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <div>
          <p className="text-zinc-500">Mức ăn ước tính</p>
          <p className="font-semibold text-zinc-200">{fmtKcal(f.projectedCalories)}/ngày</p>
        </div>
        <div>
          <p className="text-zinc-500">Cân nặng</p>
          <p className="font-semibold text-zinc-200">
            {fmtKg(f.projectedStartWeightKg)} → {fmtKg(f.projectedEndWeightKg)}
          </p>
        </div>
        {f.projectedStartBodyFatPct != null && f.projectedEndBodyFatPct != null && (
          <div>
            <p className="text-zinc-500">Tỷ lệ mỡ</p>
            <p className="font-semibold text-zinc-200">
              {fmtPct(f.projectedStartBodyFatPct)} → {fmtPct(f.projectedEndBodyFatPct)}
            </p>
          </div>
        )}
        {f.projectedStartFfmi && f.projectedEndFfmi && (
          <div>
            <p className="text-zinc-500">FFMI</p>
            <p className="font-semibold text-zinc-200">
              {f.projectedStartFfmi.normalizedFfmi} → {f.projectedEndFfmi.normalizedFfmi}
            </p>
          </div>
        )}
        <div>
          <p className="text-zinc-500">TDEE</p>
          <p className="font-semibold text-zinc-200">
            {fmtKcal(f.estimatedStartTdee)} → {fmtKcal(f.estimatedEndTdee)}
          </p>
        </div>
        <div>
          <p className="text-zinc-500">Đạm / Tinh bột / Béo</p>
          <p className="font-semibold text-zinc-200">
            {f.projectedMacros.proteinGrams}g / {f.projectedMacros.carbGrams}g / {f.projectedMacros.fatGrams}g
          </p>
        </div>
      </div>

      {f.assumptions.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-zinc-600">
          {f.assumptions.map((a, i) => (
            <li key={i}>• {a}</li>
          ))}
        </ul>
      )}

      <p className="mt-2 text-zinc-600">Ước tính khi tạo lộ trình — sẽ điều chỉnh theo dữ liệu thực tế.</p>
    </div>
  );
}
