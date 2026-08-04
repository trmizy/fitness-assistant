import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Brain,
  Loader2,
  RefreshCw,
  Sparkles,
  Clock3,
  CircleCheck,
  CircleX,
  Plus,
  Wand2,
  SlidersHorizontal,
  CalendarDays,
  Dumbbell,
  Target,
  ChevronDown,
  ChevronRight,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../../components/ui/alert-dialog";
import {
  planService,
  workoutService,
  type PlanContent,
  type PlanExplanationResponse,
  type PlanStatusBackend,
  type WeeklyScheduleItem,
  type WorkoutPlanRecord,
  type ExerciseItem,
  type LlmHealthStatus,
} from "../../services/api";

import { useApp } from "../../context/AppContext";
import {
  acknowledgeTask,
  enqueuePlanTask,
  usePendingAiTasks,
} from "../../stores/pendingAiTasks";
import { CurrentNutritionProgram as NutritionAiPlansPanel } from "./CurrentNutritionProgram";

const QUERY_GOAL_LABELS: Record<string, string> = {
  WEIGHT_LOSS: "Giam mo",
  MUSCLE_GAIN: "Tang co",
  MAINTENANCE: "Duy tri voc dang",
  ATHLETIC_PERFORMANCE: "Cai thien suc khoe",
};

type JobActionType = "generate" | "adjust";
type AiPlanTab = "workout" | "nutrition";

type SaveOutcome = {
  alreadyExists: boolean;
  createdScheduleCount: number;
  createdProgramId?: string;
  selectedWeekdays?: number[];
  schedulePreview?: unknown[];
  message: string;
};

type ExplanationResult = PlanExplanationResponse;

type PlanFilter = "all" | "active" | "completed" | "failed";

type UnknownRecord = Record<string, unknown>;
type PlanEvidenceItem = {
  title?: string;
  source_url?: string;
  source_type?: string;
  category?: string;
  summary?: string;
};

type PlanAdjustmentItem = {
  metric?: string;
  observed_value?: string | number;
  interpretation?: string;
  plan_adjustment?: string;
};

const LLM_NOT_READY_MESSAGE =
  "AI model chưa sẵn sàng. Vui lòng bật Ollama hoặc thử lại sau.";
const LLM_TIMEOUT_MESSAGE =
  "AI model đang quá tải hoặc phản hồi chưa kịp. Vui lòng thử tạo lại sau.";

const WEEKDAY_OPTIONS = [
  { value: 1, short: "T2", label: "Thứ 2" },
  { value: 2, short: "T3", label: "Thứ 3" },
  { value: 3, short: "T4", label: "Thứ 4" },
  { value: 4, short: "T5", label: "Thứ 5" },
  { value: 5, short: "T6", label: "Thứ 6" },
  { value: 6, short: "T7", label: "Thứ 7" },
  { value: 0, short: "CN", label: "Chủ nhật" },
];

const WEEKDAY_LABEL_BY_VALUE = WEEKDAY_OPTIONS.reduce<Record<number, string>>(
  (acc, option) => {
    acc[option.value] = option.label;
    return acc;
  },
  {},
);

const WEEKDAY_SUGGESTIONS: Record<number, number[]> = {
  1: [1],
  2: [1, 4],
  3: [1, 3, 5],
  4: [1, 3, 5, 0],
  5: [1, 2, 3, 5, 6],
  6: [1, 2, 3, 4, 5, 6],
  7: [1, 2, 3, 4, 5, 6, 0],
};

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function getPlanEvidence(content?: PlanContent | null) {
  const record = content as any;
  const adjustmentReason = Array.isArray(record?.adjustment_reason)
    ? record.adjustment_reason
    : Array.isArray(record?.adjustmentReasons)
      ? record.adjustmentReasons
      : [];
  const evidenceUsed = Array.isArray(record?.evidence_used)
    ? record.evidence_used
    : Array.isArray(record?.evidenceUsed)
      ? record.evidenceUsed
      : [];
  const safetyNotes = Array.isArray(record?.safety_notes)
    ? record.safety_notes
    : Array.isArray(record?.safetyNotes)
      ? record.safetyNotes
      : [];

  return {
    adjustmentReason: adjustmentReason as PlanAdjustmentItem[],
    evidenceUsed: evidenceUsed as PlanEvidenceItem[],
    safetyNotes: safetyNotes as string[],
  };
}

function formatEvidenceSourceType(value?: string) {
  if (!value) return "Evidence";
  if (value === "curated_summary") return "Curated summary";
  if (value === "guideline") return "Guideline";
  if (value === "paper") return "Paper";
  if (value === "dataset") return "Dataset";
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function toTimestamp(value?: string): number {
  if (!value) return 0;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? 0 : ms;
}

function toLocalDateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isDateInputValue(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function statusLabel(status: PlanStatusBackend): string {
  if (status === "QUEUED") return "Đang chờ";
  if (status === "PROCESSING") return "Đang xử lý";
  if (status === "COMPLETED") return "Hoàn thành";
  return "Thất bại";
}

function statusClass(status: PlanStatusBackend): string {
  if (status === "COMPLETED")
    return "bg-green-500/10 text-green-400 border-green-500/30";
  if (status === "FAILED")
    return "bg-red-500/10 text-red-400 border-red-500/30";
  if (status === "PROCESSING")
    return "bg-blue-500/10 text-blue-400 border-blue-500/30";
  return "bg-amber-500/10 text-amber-300 border-amber-500/30";
}

function chooseLatestPlan(
  plans: WorkoutPlanRecord[],
): WorkoutPlanRecord | null {
  if (!plans.length) return null;

  const completed = plans.filter((p) => p.status === "COMPLETED");
  const source = completed.length > 0 ? completed : plans;

  const sorted = [...source].sort((a, b) => {
    const tsA = Math.max(toTimestamp(a.updatedAt), toTimestamp(a.createdAt));
    const tsB = Math.max(toTimestamp(b.updatedAt), toTimestamp(b.createdAt));
    if (tsA !== tsB) return tsB - tsA;

    const verA = a.version ?? 0;
    const verB = b.version ?? 0;
    if (verA !== verB) return verB - verA;

    return (b.id || "").localeCompare(a.id || "");
  });

  return sorted[0] ?? null;
}

function toPlanContent(value: unknown): PlanContent | null {
  if (!isRecord(value)) return null;
  return value as PlanContent;
}

function toExerciseList(value: unknown): ExerciseItem[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => isRecord(item)) as ExerciseItem[];
}

function toWeeklySchedule(value: unknown): WeeklyScheduleItem[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter((item) => isRecord(item)) as WeeklyScheduleItem[];
}

function asExplanationText(value: string | UnknownRecord): string {
  if (typeof value === "string") return value;
  if (typeof value.explanation === "string") return value.explanation;
  return JSON.stringify(value, null, 2);
}

function summarizeApiError(error: unknown, fallback: string): string {
  if (
    isRecord(error) &&
    isRecord(error.response) &&
    isRecord(error.response.data)
  ) {
    const responseData = error.response.data;
    if (typeof responseData.error === "string") {
      return responseData.error;
    }
    if (
      isRecord(responseData.error) &&
      typeof responseData.error.message === "string"
    ) {
      return responseData.error.message;
    }
    if (typeof responseData.message === "string") {
      return responseData.message;
    }
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
}

function isLlmUnavailableMessage(message: string | null | undefined): boolean {
  return (
    !!message &&
    /LLM|Ollama|ollama|AI model|timed out|unreachable|LLM_UNAVAILABLE/i.test(
      message,
    )
  );
}

function friendlyPlanFailReason(reason?: string | null): string {
  if (reason && /timed out|timeout/i.test(reason)) return LLM_TIMEOUT_MESSAGE;
  if (isLlmUnavailableMessage(reason)) return LLM_NOT_READY_MESSAGE;
  return reason || "Không có fail reason từ backend.";
}

function formatLlmTechnicalDetails(
  health?: LlmHealthStatus | null,
  fallback?: string,
): string {
  if (!health) return fallback || "Không đọc được trạng thái LLM.";
  return [
    `provider=${health.llmProvider || "unknown"}`,
    `url=${health.llmUrl || "unknown"}`,
    `model=${health.model || "unknown"}`,
    `embeddingModel=${health.embeddingModel || "unknown"}`,
    `checkedAt=${health.checkedAt || "unknown"}`,
    health.error ? `error=${health.error}` : null,
    fallback ? `detail=${fallback}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

function formatDate(dateValue?: string): string {
  if (!dateValue) return "--";
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return "--";
  return date.toLocaleString("vi-VN");
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function extractPlanWarnings(planContent: PlanContent | null): string[] {
  if (!planContent) return [];
  const metadata = (planContent as PlanContent & { _metadata?: unknown })
    ._metadata;
  if (!isRecord(metadata)) return [];

  const warnings = (metadata as UnknownRecord).aiWarnings;
  if (!Array.isArray(warnings)) return [];

  return warnings
    .map((warning) =>
      typeof warning === "string" ? warning : JSON.stringify(warning),
    )
    .map((warning) => warning.trim())
    .filter(Boolean);
}

function formatExplanationText(
  value: ExplanationResult | string | UnknownRecord,
): string {
  if (typeof value === "string") return value;
  if (typeof value.explanation === "string") return value.explanation;
  return JSON.stringify(value, null, 2);
}

function formatExplanationWarnings(
  value: ExplanationResult | string | UnknownRecord | null,
): string[] {
  if (!value || typeof value === "string") return [];
  if (Array.isArray(value.warnings)) {
    return value.warnings.map((warning) => warning.trim()).filter(Boolean);
  }
  return [];
}

function localizePlanNoteForDisplay(value: string): string {
  const trimmed = value.trim();
  const key = trimmed.toLowerCase().replace(/[–—]/g, "-").replace(/\s+/g, " ");
  if (
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u0370-\u04FF\u0E00-\u0E7F\u0E80-\u0EFF]|[ƷƵƳƪǍǭȸ½¿]|\uFFFD|\?|Āng|ᬺ|ǈi|ī|ǉ|ĝ|Âng|Ñ|Ȃ|ӣ/.test(
      trimmed,
    )
  ) {
    if (/7-9|giờ|phục hồi|hồi/i.test(trimmed)) {
      return "Ngủ 7-9 giờ mỗi ngày và duy trì ít nhất một ngày phục hồi mỗi tuần.";
    }
    if (/đau|nhức|kéo dài|khối lượng|nghỉ/i.test(trimmed)) {
      return "Nếu đau nhức kéo dài, hãy giảm khối lượng tập hoặc nghỉ thêm.";
    }
    if (/form|chuẩn|cường độ/i.test(trimmed)) {
      return "Giữ form chuẩn trước khi tăng cường độ.";
    }
    if (/protein|calo|nước/i.test(trimmed)) {
      return "Ưu tiên đủ protein, kiểm soát tổng calo theo mục tiêu và uống đủ nước.";
    }
    return "Tập trung vào kỹ thuật chuẩn, kiểm soát nhịp tập và tăng tiến từ từ.";
  }
  const map: Record<string, string> = {
    "add load or reps gradually when all sets feel controlled.":
      "Tăng dần mức tạ hoặc số lần lặp khi bạn hoàn thành đủ các hiệp với kỹ thuật tốt.",
    "sleep 7-9 hours and keep at least one recovery day weekly.":
      "Ngủ 7-9 giờ mỗi ngày và duy trì ít nhất một ngày phục hồi mỗi tuần.",
    "protein 1.8-2.2 g/kg/day and calories aligned with the goal.":
      "Ưu tiên đủ protein, kiểm soát tổng calo theo mục tiêu và uống đủ nước.",
  };
  if (map[key]) return map[key];
  if (/add .*load|add .*reps|progress/i.test(trimmed)) {
    return "Tăng dần mức tạ hoặc số lần lặp khi bạn hoàn thành đủ các hiệp với kỹ thuật tốt.";
  }
  if (/sleep|recovery|stretch/i.test(trimmed)) {
    return "Ngủ 7-9 giờ mỗi ngày, giãn cơ nhẹ sau buổi tập và giữ ít nhất một ngày phục hồi mỗi tuần.";
  }
  if (/protein|calorie|caloric|nutrition/i.test(trimmed)) {
    return "Ưu tiên đủ protein, kiểm soát tổng calo theo mục tiêu và uống đủ nước.";
  }
  return trimmed;
}

function localizeDayGoalForDisplay(value: unknown, dayIndex: number): string {
  if (typeof value !== "string" || !value.trim())
    return `Buổi tập ${dayIndex + 1}`;
  const trimmed = value.trim();
  if (
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u0370-\u04FF\u0E00-\u0E7F\u0E80-\u0EFF]|[ƷƵƳƪǍǭȸ½¿]|\uFFFD|\?|Āng|ᬺ|ǈi|ī|ǉ|ĝ|Âng|Ñ|Ȃ|ӣ/.test(
      trimmed,
    )
  ) {
    if (/tay trước/i.test(trimmed)) return "Lưng + Tay trước";
    if (/tay sau/i.test(trimmed)) return "Ngực + Vai + Tay sau";
    if (/vai/i.test(trimmed)) return "Vai + Tay";
    if (/chân|mong|mông/i.test(trimmed)) return "Chân + Mông";
    return `Buổi tập ${dayIndex + 1}`;
  }
  return trimmed;
}

function countInvalidExerciseIds(
  schedule: WeeklyScheduleItem[] | null,
): number {
  if (!schedule) return 0;

  let missingCount = 0;
  for (const day of schedule) {
    const exercises = toExerciseList(day.exercises);
    for (const exercise of exercises) {
      if (
        !exercise.exerciseId ||
        typeof exercise.exerciseId !== "string" ||
        !exercise.exerciseId.trim() ||
        !UUID_PATTERN.test(exercise.exerciseId.trim())
      ) {
        missingCount += 1;
      }
    }
  }

  return missingCount;
}

export function AIPlansPage() {
  const { user } = useApp();
  const queryClient = useQueryClient();
  const userScopeId = user?.id ?? "guest";
  const { tasks: pendingAiTasks } = usePendingAiTasks(userScopeId);

  const [goal, setGoal] = useState("Giảm mỡ tăng cơ");
  const [durationWeeks, setDurationWeeks] = useState(8);
  const [daysPerWeek, setDaysPerWeek] = useState(4);
  const [exercisesPerDay, setExercisesPerDay] = useState(4);
  const [trainingLocation, setTrainingLocation] = useState<"HOME" | "GYM">(
    "GYM",
  );
  const [equipmentPreference, setEquipmentPreference] = useState<
    "MACHINE_ONLY" | "MIXED_GYM"
  >("MIXED_GYM");
  const [activePlanTab, setActivePlanTab] = useState<AiPlanTab>(() => {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get("tab") || params.get("type");
    return tab === "nutrition" ? "nutrition" : "workout";
  });

  useEffect(() => {
    const queryGoal = new URLSearchParams(window.location.search).get("goal");
    if (!queryGoal) return;
    setGoal(QUERY_GOAL_LABELS[queryGoal] || queryGoal);
  }, []);

  function selectPlanTab(tab: AiPlanTab) {
    setActivePlanTab(tab);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", tab);
    window.history.replaceState(
      null,
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
  }

  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [planFilter, setPlanFilter] = useState<PlanFilter>("completed");

  const [explanationResult, setExplanationResult] =
    useState<ExplanationResult | null>(null);
  const [isExplanationStreaming, setIsExplanationStreaming] = useState(false);
  const [explanationStatus, setExplanationStatus] = useState<string | null>(
    null,
  );
  const explanationAbortRef = useRef<(() => void) | null>(null);

  const [showAdjustPanel, setShowAdjustPanel] = useState(false);
  const [adjustments, setAdjustments] = useState("");
  const [adjustDaysPerWeekInput, setAdjustDaysPerWeekInput] = useState("");
  const [adjustExercisesPerDayInput, setAdjustExercisesPerDayInput] =
    useState("");

  const [showSavePanel, setShowSavePanel] = useState(false);
  const [saveStartDate, setSaveStartDate] = useState(() =>
    toLocalDateInputValue(new Date()),
  );
  const [saveRepeatWeeksInput, setSaveRepeatWeeksInput] = useState("");
  const [selectedWeekdays, setSelectedWeekdays] = useState<number[]>(
    WEEKDAY_SUGGESTIONS[4],
  );
  const [weekdayWarning, setWeekdayWarning] = useState<string | null>(null);
  const [replaceExisting, setReplaceExisting] = useState(true);
  const [saveOutcome, setSaveOutcome] = useState<SaveOutcome | null>(null);
  const [checkingCurrentProgram, setCheckingCurrentProgram] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<WorkoutPlanRecord | null>(
    null,
  );
  const [llmTechnicalDetails, setLlmTechnicalDetails] = useState<string | null>(
    null,
  );

  const [expandedDayKey, setExpandedDayKey] = useState<string | null>(null);
  const appliedInitialFilter = useRef(false);
  const handledTaskIdsRef = useRef(new Set<string>());

  const {
    data: plans,
    isLoading: loadingPlans,
    isFetching: fetchingPlans,
    isError: loadPlansError,
    error: plansError,
    refetch: refetchPlans,
  } = useQuery<WorkoutPlanRecord[]>({
    queryKey: ["ai-plans", "current", userScopeId],
    queryFn: () => planService.getCurrentPlans(),
    enabled: Boolean(user?.id),
  });

  const {
    data: llmHealth,
    isFetching: checkingLlmHealth,
    refetch: refetchLlmHealth,
  } = useQuery<LlmHealthStatus>({
    queryKey: ["ai-plans", "llm-health"],
    queryFn: () => planService.getLlmHealth(),
    retry: false,
    refetchInterval: 15000,
  });

  const sortedPlans = useMemo(() => {
    const list = plans ?? [];
    return [...list].sort((a, b) => {
      const tsA = Math.max(toTimestamp(a.updatedAt), toTimestamp(a.createdAt));
      const tsB = Math.max(toTimestamp(b.updatedAt), toTimestamp(b.createdAt));
      if (tsA !== tsB) return tsB - tsA;
      return (b.version ?? 0) - (a.version ?? 0);
    });
  }, [plans]);

  const completedPlans = useMemo(
    () => sortedPlans.filter((plan) => plan.status === "COMPLETED"),
    [sortedPlans],
  );
  const activePlans = useMemo(
    () =>
      sortedPlans.filter(
        (plan) => plan.status === "QUEUED" || plan.status === "PROCESSING",
      ),
    [sortedPlans],
  );
  const failedPlans = useMemo(
    () => sortedPlans.filter((plan) => plan.status === "FAILED"),
    [sortedPlans],
  );
  const visiblePlans = useMemo(() => {
    if (planFilter === "all") return sortedPlans;
    if (planFilter === "active") return activePlans;
    if (planFilter === "completed") return completedPlans;
    return failedPlans;
  }, [activePlans, completedPlans, failedPlans, planFilter, sortedPlans]);

  const defaultPlan = useMemo(
    () => chooseLatestPlan(visiblePlans),
    [visiblePlans],
  );

  useEffect(() => {
    if (appliedInitialFilter.current) return;
    if (!plans) return;

    if (activePlans.length > 0) {
      setPlanFilter("active");
    } else if (completedPlans.length > 0) {
      setPlanFilter("completed");
    } else if (failedPlans.length > 0) {
      setPlanFilter("failed");
    } else {
      setPlanFilter("all");
    }
    appliedInitialFilter.current = true;
  }, [activePlans.length, completedPlans.length, failedPlans.length, plans]);

  useEffect(() => {
    if (
      planFilter === "active" &&
      activePlans.length === 0 &&
      completedPlans.length > 0
    ) {
      setPlanFilter("completed");
    }
  }, [activePlans.length, completedPlans.length, planFilter]);

  useEffect(() => {
    if (!visiblePlans.length) {
      setSelectedPlanId(null);
      return;
    }

    if (
      selectedPlanId &&
      visiblePlans.some((plan) => plan.id === selectedPlanId)
    ) {
      return;
    }

    setSelectedPlanId(defaultPlan?.id ?? visiblePlans[0]?.id ?? null);
  }, [defaultPlan, selectedPlanId, visiblePlans]);

  const currentPlan = useMemo(() => {
    if (!visiblePlans.length) return null;
    if (!selectedPlanId) return defaultPlan;
    return (
      visiblePlans.find((plan) => plan.id === selectedPlanId) ?? defaultPlan
    );
  }, [defaultPlan, selectedPlanId, visiblePlans]);

  const currentContent = useMemo(
    () => toPlanContent(currentPlan?.plan),
    [currentPlan],
  );
  const saveDaysPerWeek = useMemo(() => {
    const rawDays = Number(
      currentContent?.daysPerWeek ?? currentPlan?.daysPerWeek ?? daysPerWeek,
    );
    if (!Number.isFinite(rawDays)) return 1;
    return Math.min(7, Math.max(1, Math.trunc(rawDays)));
  }, [currentContent?.daysPerWeek, currentPlan?.daysPerWeek, daysPerWeek]);
  const weeklySchedule = useMemo(
    () => toWeeklySchedule(currentContent?.weeklySchedule),
    [currentContent],
  );
  const planWarnings = useMemo(
    () => extractPlanWarnings(currentContent),
    [currentContent],
  );
  const planEvidence = useMemo(
    () => getPlanEvidence(currentContent),
    [currentContent],
  );
  const missingExerciseIdCount = useMemo(
    () => countInvalidExerciseIds(weeklySchedule),
    [weeklySchedule],
  );
  const hasMissingExerciseIds = missingExerciseIdCount > 0;

  // Plan content only ever stores {exerciseId, order, name, sets, reps,
  // restSeconds, note} — never muscle group/equipment. Resolve those by
  // batch-fetching the referenced exercises from the catalog once per plan,
  // rather than baking catalog fields into plan content (which would go
  // stale the moment the catalog entry is edited).
  const planExerciseIds = useMemo(() => {
    const ids = new Set<string>();
    for (const day of weeklySchedule ?? []) {
      for (const exercise of day?.exercises ?? []) {
        const id = exercise?.exerciseId;
        if (typeof id === "string" && UUID_PATTERN.test(id.trim())) {
          ids.add(id.trim());
        }
      }
    }
    return Array.from(ids);
  }, [weeklySchedule]);

  const { data: planExerciseCatalog } = useQuery({
    queryKey: ["exercises-by-ids", planExerciseIds],
    queryFn: () => workoutService.getExercisesByIds(planExerciseIds),
    enabled: planExerciseIds.length > 0,
    staleTime: 5 * 60 * 1000,
  });

  const exerciseCatalogById = useMemo(() => {
    const map = new Map<string, { muscleGroupsActivated?: string[]; typeOfEquipment?: string }>();
    for (const ex of planExerciseCatalog ?? []) {
      if (ex?.id) map.set(ex.id, ex);
    }
    return map;
  }, [planExerciseCatalog]);

  useEffect(() => {
    setSaveOutcome(null);
    setShowSavePanel(false);
    setExplanationResult(null);
    setExplanationStatus(null);
    setIsExplanationStreaming(false);
    explanationAbortRef.current?.();
    explanationAbortRef.current = null;
  }, [currentPlan?.id]);

  useEffect(
    () => () => {
      explanationAbortRef.current?.();
    },
    [],
  );

  useEffect(() => {
    setSelectedWeekdays(
      WEEKDAY_SUGGESTIONS[saveDaysPerWeek] ??
        WEEKDAY_OPTIONS.slice(0, saveDaysPerWeek).map((day) => day.value),
    );
    setWeekdayWarning(null);
  }, [currentPlan?.id, saveDaysPerWeek]);

  const generateMutation = useMutation({
    mutationFn: (payload: {
      goal: string;
      durationWeeks: number;
      daysPerWeek: number;
      exercisesPerDay: number;
      trainingLocation: "HOME" | "GYM";
      equipmentPreference: "MACHINE_ONLY" | "MIXED_GYM";
    }) => planService.generateWorkoutPlan(payload),
    onSuccess: (result) => {
      enqueuePlanTask(userScopeId, {
        jobId: result.jobId,
        planId: result.planId,
        type: "generate",
        status: result.status,
        goal,
        daysPerWeek,
        durationWeeks,
      });
      toast.success("Đã gửi yêu cầu tạo kế hoạch AI");
    },
    onError: (error: unknown) => {
      toast.error(summarizeApiError(error, "Không thể tạo kế hoạch AI"));
    },
  });

  const explainMutation = useMutation({
    mutationFn: (planId: string) => planService.explainPlan(planId, "vi"),
    onSuccess: (result) => {
      setExplanationResult(result);
      setExplanationStatus(null);
      toast.success(
        result.source === "fallback"
          ? "Đã tạo giải thích kế hoạch bằng chế độ tự động"
          : "Đã tạo giải thích kế hoạch",
      );
    },
    onError: (error: unknown) => {
      setExplanationStatus(null);
      toast.error(summarizeApiError(error, "Không thể giải thích kế hoạch"));
    },
  });

  const archiveMutation = useMutation({
    mutationFn: (planId: string) => planService.archivePlan(planId),
    onSuccess: async () => {
      setArchiveTarget(null);
      toast.success("Đã ẩn kế hoạch khỏi danh sách");
      await queryClient.invalidateQueries({
        queryKey: ["ai-plans", "current", userScopeId],
      });
      await refetchPlans();
    },
    onError: (error: unknown) => {
      toast.error(summarizeApiError(error, "Không thể ẩn kế hoạch"));
    },
  });

  const adjustMutation = useMutation({
    mutationFn: (payload: {
      planId: string;
      adjustments: string;
      daysPerWeek?: number;
      exercisesPerDay?: number;
    }) =>
      planService.adjustPlan(
        payload.planId,
        payload.adjustments,
        payload.daysPerWeek,
        payload.exercisesPerDay,
      ),
    onSuccess: (result) => {
      enqueuePlanTask(userScopeId, {
        jobId: result.jobId,
        planId: result.planId,
        type: "adjust",
        status: result.status,
        goal: currentPlan?.goal || goal,
        daysPerWeek: adjustDaysPerWeekInput
          ? Number(adjustDaysPerWeekInput)
          : currentPlan?.daysPerWeek || daysPerWeek,
        durationWeeks: currentPlan?.duration || durationWeeks,
      });
      setShowAdjustPanel(false);
      setAdjustments("");
      setAdjustDaysPerWeekInput("");
      setAdjustExercisesPerDayInput("");
      toast.success("Đã gửi yêu cầu điều chỉnh kế hoạch");
    },
    onError: (error: unknown) => {
      toast.error(summarizeApiError(error, "Không thể điều chỉnh kế hoạch"));
    },
  });

  const saveMutation = useMutation({
    mutationFn: (payload: {
      planId: string;
      startDate?: string;
      repeatWeeks?: number;
      selectedWeekdays?: number[];
      replaceExisting?: boolean;
    }) =>
      planService.savePlanToWorkoutLog(payload.planId, {
        startDate: payload.startDate,
        repeatWeeks: payload.repeatWeeks,
        selectedWeekdays: payload.selectedWeekdays,
        replaceExisting: payload.replaceExisting,
      }),
    onSuccess: (result) => {
      setShowSavePanel(false);
      setSaveRepeatWeeksInput("");
      void queryClient.invalidateQueries({
        queryKey: ["current-workout-program"],
      });
      void queryClient.invalidateQueries({ queryKey: ["workout-schedules"] });
      void queryClient.invalidateQueries({ queryKey: ["workout-stats"] });
      const alreadyExists = Boolean(result.alreadyExists);
      setSaveOutcome({
        alreadyExists,
        createdScheduleCount: result.createdScheduleCount,
        createdProgramId: result.createdProgramId,
        selectedWeekdays: result.selectedWeekdays,
        schedulePreview: result.schedulePreview,
        message: alreadyExists
          ? "Kế hoạch này đã được lưu vào lịch tập trước đó."
          : "Đã lưu kế hoạch vào lịch tập.",
      });
      toast.success(
        alreadyExists
          ? "Kế hoạch này đã được lưu vào lịch tập trước đó."
          : "Đã lưu kế hoạch vào lịch tập.",
      );
    },
    onError: (error: unknown) => {
      toast.error(
        summarizeApiError(error, "Không thể lưu kế hoạch vào lịch tập"),
      );
    },
  });

  useEffect(() => {
    const pendingTasks = pendingAiTasks.filter(
      (task) => task.status === "QUEUED" || task.status === "PROCESSING",
    );
    const resolvedTasks = pendingAiTasks.filter(
      (task) => task.status === "COMPLETED" || task.status === "FAILED",
    );

    for (const task of resolvedTasks) {
      if (handledTaskIdsRef.current.has(task.id)) continue;
      handledTaskIdsRef.current.add(task.id);
      if (task.status === "COMPLETED") {
        if (task.planId) {
          setSelectedPlanId(task.planId);
        }
        setPlanFilter("completed");
        void queryClient.invalidateQueries({
          queryKey: ["ai-plans", "current", userScopeId],
        });
        void refetchPlans();
        toast.success(
          task.kind === "plan-adjust"
            ? "Đã tạo phiên bản kế hoạch mới"
            : "Kế hoạch AI đã tạo xong",
        );
        acknowledgeTask(userScopeId, task.id);
      } else {
        setPlanFilter("failed");
        void queryClient.invalidateQueries({
          queryKey: ["ai-plans", "current", userScopeId],
        });
        void refetchPlans();
        toast.error(task.error || "Job tạo kế hoạch thất bại");
        acknowledgeTask(userScopeId, task.id);
      }
    }
  }, [pendingAiTasks, queryClient, refetchPlans, userScopeId]);

  const isBusy =
    generateMutation.isPending ||
    explainMutation.isPending ||
    isExplanationStreaming ||
    adjustMutation.isPending ||
    saveMutation.isPending ||
    archiveMutation.isPending ||
    pendingAiTasks.some(
      (task) => task.status === "QUEUED" || task.status === "PROCESSING",
    );
  const pendingPlanTasks = pendingAiTasks.filter(
    (task) =>
      task.kind !== "chat-ask" &&
      (task.status === "QUEUED" || task.status === "PROCESSING"),
  );
  const llmUnavailable = Boolean(llmHealth && !llmHealth.llmAvailable);
  const blockLlmActions = llmUnavailable || checkingLlmHealth;

  const ensureLlmReady = async () => {
    const result = await refetchLlmHealth();
    const health = result.data;

    if (result.isError || !health?.llmAvailable) {
      const fallback =
        result.error instanceof Error ? result.error.message : undefined;
      setLlmTechnicalDetails(formatLlmTechnicalDetails(health, fallback));
      toast.error(LLM_NOT_READY_MESSAGE);
      return false;
    }

    setLlmTechnicalDetails(null);
    return true;
  };

  const handleGenerate = async () => {
    const trimmedGoal = goal.trim();
    if (!trimmedGoal) {
      toast.error("Mục tiêu không được để trống");
      return;
    }
    if (
      !Number.isFinite(durationWeeks) ||
      durationWeeks < 1 ||
      durationWeeks > 52
    ) {
      toast.error("durationWeeks phải trong khoảng 1-52");
      return;
    }
    if (!Number.isFinite(daysPerWeek) || daysPerWeek < 1 || daysPerWeek > 7) {
      toast.error("daysPerWeek phải trong khoảng 1-7");
      return;
    }
    if (
      !Number.isFinite(exercisesPerDay) ||
      exercisesPerDay < 1 ||
      exercisesPerDay > 8
    ) {
      toast.error("exercisesPerDay phải trong khoảng 1-8");
      return;
    }
    if (!(await ensureLlmReady())) return;

    generateMutation.mutate({
      goal: trimmedGoal,
      durationWeeks,
      daysPerWeek,
      exercisesPerDay,
      trainingLocation,
      equipmentPreference,
    });
  };

  const handleExplain = async () => {
    if (!currentPlan?.id || currentPlan.status !== "COMPLETED") {
      toast.error("Chỉ có thể giải thích plan đã hoàn thành");
      return;
    }
    if (isExplanationStreaming || explainMutation.isPending) return;

    explanationAbortRef.current?.();
    setExplanationResult({
      planId: currentPlan.id,
      explanation: "",
      source: "llm",
      warnings: [],
    });
    setExplanationStatus("AI đang giải thích kế hoạch...");
    setIsExplanationStreaming(true);

    explanationAbortRef.current = planService.explainPlanStream(
      currentPlan.id,
      {
        onStatus: (status) => {
          setExplanationStatus(status || "AI đang giải thích kế hoạch...");
        },
        onToken: (token) => {
          setExplanationResult((previous) => ({
            planId: currentPlan.id,
            explanation: `${previous?.explanation ?? ""}${token}`,
            source: previous?.source ?? "llm",
            warnings: previous?.warnings ?? [],
          }));
        },
        onDone: (meta) => {
          setIsExplanationStreaming(false);
          setExplanationStatus(null);
          explanationAbortRef.current = null;
          setExplanationResult((previous) => ({
            planId: currentPlan.id,
            explanation: previous?.explanation ?? "",
            source: meta.source,
            warnings: meta.warnings,
          }));
          toast.success(
            meta.source === "fallback"
              ? "Đã tạo giải thích tự động bằng tiếng Việt"
              : "Đã tạo giải thích kế hoạch",
          );
        },
        onError: (message) => {
          setIsExplanationStreaming(false);
          setExplanationStatus(null);
          explanationAbortRef.current = null;
          toast.error(
            message ||
              "Không thể giải thích kế hoạch lúc này. Vui lòng thử lại.",
          );
          explainMutation.mutate(currentPlan.id);
        },
      },
      { lang: "vi" },
    );
  };

  const handleArchive = (plan: WorkoutPlanRecord) => {
    if (!plan.id) return;
    if (plan.status === "PROCESSING") {
      toast.error("Không thể ẩn kế hoạch đang xử lý");
      return;
    }
    setArchiveTarget(plan);
  };

  const handleRetryFailedPlan = async (plan: WorkoutPlanRecord) => {
    if (!plan.goal || !plan.duration || !plan.daysPerWeek) {
      toast.error("Kế hoạch thiếu dữ liệu để tạo lại");
      return;
    }
    if (!(await ensureLlmReady())) return;
    setGoal(plan.goal);
    setDurationWeeks(plan.duration);
    setDaysPerWeek(plan.daysPerWeek);
    const retryExercisesPerDay =
      toPlanContent(plan.plan)?.exercisesPerDay ?? exercisesPerDay;
    setExercisesPerDay(retryExercisesPerDay);
    setPlanFilter("all");
    generateMutation.mutate({
      goal: plan.goal,
      durationWeeks: plan.duration,
      daysPerWeek: plan.daysPerWeek,
      exercisesPerDay: retryExercisesPerDay,
      trainingLocation,
      equipmentPreference,
    });
  };

  const handleAdjust = async () => {
    if (!currentPlan?.id || currentPlan.status !== "COMPLETED") {
      toast.error("Chỉ có thể điều chỉnh plan đã hoàn thành");
      return;
    }

    const trimmedAdjustments = adjustments.trim();
    if (!trimmedAdjustments) {
      toast.error("Nội dung điều chỉnh không được để trống");
      return;
    }

    let nextDaysPerWeek: number | undefined;
    if (adjustDaysPerWeekInput.trim()) {
      const parsed = Number(adjustDaysPerWeekInput);
      if (!Number.isFinite(parsed) || parsed < 1 || parsed > 7) {
        toast.error("daysPerWeek mới phải trong khoảng 1-7");
        return;
      }
      nextDaysPerWeek = parsed;
    }
    let nextExercisesPerDay: number | undefined;
    if (adjustExercisesPerDayInput.trim()) {
      const parsed = Number(adjustExercisesPerDayInput);
      if (!Number.isFinite(parsed) || parsed < 1 || parsed > 8) {
        toast.error("exercisesPerDay mới phải trong khoảng 1-8");
        return;
      }
      nextExercisesPerDay = parsed;
    }
    if (!(await ensureLlmReady())) return;

    adjustMutation.mutate({
      planId: currentPlan.id,
      adjustments: trimmedAdjustments,
      daysPerWeek: nextDaysPerWeek,
      exercisesPerDay: nextExercisesPerDay,
    });
  };

  const toggleSaveWeekday = (weekday: number) => {
    setSelectedWeekdays((previous) => {
      if (previous.includes(weekday)) {
        setWeekdayWarning(null);
        return previous.filter((value) => value !== weekday);
      }

      if (previous.length >= saveDaysPerWeek) {
        setWeekdayWarning(
          `Kế hoạch này có ${saveDaysPerWeek} buổi/tuần, bạn chỉ được chọn tối đa ${saveDaysPerWeek} ngày.`,
        );
        return previous;
      }

      setWeekdayWarning(null);
      return WEEKDAY_OPTIONS.map((option) => option.value).filter((value) =>
        [...previous, weekday].includes(value),
      );
    });
  };

  const handleSaveToWorkoutLog = async () => {
    if (!currentPlan?.id || currentPlan.status !== "COMPLETED") {
      toast.error("Chỉ có thể lưu plan đã hoàn thành");
      return;
    }
    if (hasMissingExerciseIds) {
      toast.error(
        "Kế hoạch này còn bài tập chưa có exerciseId. Hãy tạo lại plan trước khi lưu.",
      );
      return;
    }

    const trimmedRepeatWeeks = saveRepeatWeeksInput.trim();
    const parsedRepeatWeeks = trimmedRepeatWeeks
      ? Number(trimmedRepeatWeeks)
      : undefined;
    if (
      trimmedRepeatWeeks &&
      (!Number.isFinite(parsedRepeatWeeks) ||
        parsedRepeatWeeks < 1 ||
        parsedRepeatWeeks > 52)
    ) {
      toast.error("repeatWeeks phải trong khoảng 1-52");
      return;
    }
    if (saveStartDate && !isDateInputValue(saveStartDate)) {
      toast.error("Ngày bắt đầu không hợp lệ");
      return;
    }
    if (selectedWeekdays.length !== saveDaysPerWeek) {
      toast.error(`Vui lòng chọn đủ ${saveDaysPerWeek} ngày tập trong tuần.`);
      return;
    }

    setCheckingCurrentProgram(true);
    try {
      const activeProgram = await workoutService.getCurrentProgram();
      const activeSourcePlanId =
        typeof activeProgram?.sourcePlanId === "string"
          ? activeProgram.sourcePlanId
          : null;
      const isDifferentActiveProgram = Boolean(
        activeProgram?.id && activeSourcePlanId !== currentPlan.id,
      );

      if (isDifferentActiveProgram) {
        const activeProgramName =
          typeof activeProgram.name === "string"
            ? activeProgram.name
            : "chương trình hiện tại";
        const shouldReplace = window.confirm(
          `Bạn đang có "${activeProgramName}" trong nhật ký tập. Lưu plan AI mới sẽ ẩn chương trình cũ và dùng plan này làm chương trình hiện tại. Bạn có muốn thay thế không?`,
        );
        if (!shouldReplace) return;
      }
    } catch (error) {
      toast.error(
        summarizeApiError(error, "Không thể kiểm tra chương trình hiện tại"),
      );
      return;
    } finally {
      setCheckingCurrentProgram(false);
    }

    saveMutation.mutate({
      planId: currentPlan.id,
      startDate: saveStartDate || undefined,
      repeatWeeks: parsedRepeatWeeks,
      selectedWeekdays,
      replaceExisting,
    });
  };

  const headerGoal = currentPlan?.goal || currentContent?.goal || "--";
  const headerDuration =
    currentContent?.durationWeeks ?? currentPlan?.duration ?? "--";
  const headerDays =
    currentContent?.daysPerWeek ?? currentPlan?.daysPerWeek ?? "--";
  const headerExercisesPerDay = currentContent?.exercisesPerDay ?? "--";
  const headerLocation =
    (currentPlan?.plan as any)?._metadata?.trainingLocation ??
    (currentContent as any)?._metadata?.trainingLocation ??
    null;

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-5">
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
        <div>
          <h1 className="text-zinc-100 text-xl font-bold flex items-center gap-2">
            <Brain className="w-5 h-5 text-green-400" />
            AI Plans
          </h1>
          <p className="text-zinc-500 text-sm mt-1">
            Tạo và quản lý kế hoạch tập luyện bằng AI, theo dõi job, giải thích
            và điều chỉnh theo nhu cầu.
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            void refetchPlans();
          }}
          disabled={fetchingPlans}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-zinc-700 bg-zinc-900 text-zinc-200 hover:bg-zinc-800 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {fetchingPlans ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <RefreshCw className="w-4 h-4" />
          )}
          Refresh
        </button>
      </div>

      {(llmUnavailable || llmTechnicalDetails) && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-100 space-y-2">
          <div className="font-semibold">{LLM_NOT_READY_MESSAGE}</div>
          <details className="rounded-lg border border-amber-500/20 bg-zinc-950/50 px-3 py-2">
            <summary className="cursor-pointer text-xs font-medium text-amber-200">
              Chi tiết kỹ thuật
            </summary>
            <pre className="mt-2 whitespace-pre-wrap break-words text-xs text-amber-100/80">
              {llmTechnicalDetails || formatLlmTechnicalDetails(llmHealth)}
            </pre>
          </details>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {(
          [
            { key: "workout", label: "Kế hoạch tập luyện", icon: Dumbbell },
            {
              key: "nutrition",
              label: "Kế hoạch dinh dưỡng",
              icon: CalendarDays,
            },
          ] as const
        ).map((tab) => {
          const Icon = tab.icon;
          const active = activePlanTab === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => selectPlanTab(tab.key)}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl border text-sm font-semibold transition-colors ${
                active
                  ? "border-green-500/40 bg-green-500/10 text-green-300"
                  : "border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700"
              }`}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {activePlanTab === "nutrition" ? (
        <NutritionAiPlansPanel />
      ) : (
        <>
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 md:p-5 space-y-4">
            <div className="flex items-center gap-2 text-zinc-200 font-semibold">
              <Sparkles className="w-4 h-4 text-green-400" />
              Tạo kế hoạch mới
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div className="space-y-2">
                <label className="text-xs font-semibold text-zinc-400">
                  Mục tiêu
                </label>
                <input
                  value={goal}
                  onChange={(e) => setGoal(e.target.value)}
                  placeholder="Ví dụ: giảm mỡ tăng cơ"
                  className="w-full rounded-xl bg-zinc-950 border border-zinc-800 px-3 py-2 text-zinc-100 outline-none focus:border-green-500/50"
                />
                <div className="flex flex-wrap gap-1.5">
                  {[
                    "Giảm mỡ",
                    "Tăng cơ",
                    "Giảm mỡ tăng cơ",
                    "Duy trì sức khỏe",
                    "Tăng sức bền",
                  ].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setGoal(preset)}
                      className="px-2 py-1 text-[11px] rounded-full border border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600"
                    >
                      {preset}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-semibold text-zinc-400">
                  Số tuần (1-52)
                </label>
                <input
                  type="number"
                  min={1}
                  max={52}
                  value={durationWeeks}
                  onChange={(e) => setDurationWeeks(Number(e.target.value))}
                  className="w-full rounded-xl bg-zinc-950 border border-zinc-800 px-3 py-2 text-zinc-100 outline-none focus:border-green-500/50"
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-semibold text-zinc-400">
                  Buổi/tuần (1-7)
                </label>
                <input
                  type="number"
                  min={1}
                  max={7}
                  value={daysPerWeek}
                  onChange={(e) => setDaysPerWeek(Number(e.target.value))}
                  className="w-full rounded-xl bg-zinc-950 border border-zinc-800 px-3 py-2 text-zinc-100 outline-none focus:border-green-500/50"
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-semibold text-zinc-400">
                  Số bài / buổi (1-8)
                </label>
                <input
                  type="number"
                  min={1}
                  max={8}
                  value={exercisesPerDay}
                  onChange={(e) => setExercisesPerDay(Number(e.target.value))}
                  className="w-full rounded-xl bg-zinc-950 border border-zinc-800 px-3 py-2 text-zinc-100 outline-none focus:border-green-500/50"
                />
              </div>
            </div>

            {/* Training location */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-zinc-400">
                Nơi tập
              </label>
              <div className="flex gap-2">
                {(
                  [
                    {
                      value: "GYM",
                      label: "Phòng gym",
                      desc: "Máy, tạ, cable",
                    },
                    {
                      value: "HOME",
                      label: "Ở nhà",
                      desc: "Bodyweight, tạ đôi, band",
                    },
                  ] as const
                ).map(({ value, label, desc }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setTrainingLocation(value)}
                    className={`flex-1 px-4 py-2.5 rounded-xl border text-left transition-all ${
                      trainingLocation === value
                        ? "border-green-500/50 bg-green-500/10 text-green-300"
                        : "border-zinc-700 bg-zinc-900 text-zinc-400 hover:border-zinc-600 hover:text-zinc-300"
                    }`}
                  >
                    <div className="text-sm font-semibold">{label}</div>
                    <div className="text-[11px] opacity-70">{desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Equipment preference (only for GYM) */}
            {trainingLocation === "GYM" && (
              <div className="space-y-2">
                <label className="text-xs font-semibold text-zinc-400">
                  Nguồn thiết bị
                </label>
                <div className="flex gap-2">
                  {(
                    [
                      {
                        value: "MACHINE_ONLY",
                        label: "Tập hoàn toàn bằng máy",
                        desc: "Chỉ machine/cable/smith",
                      },
                      {
                        value: "MIXED_GYM",
                        label: "Kết hợp máy và bài thường",
                        desc: "Machine + tạ + barbell",
                      },
                    ] as const
                  ).map(({ value, label, desc }) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setEquipmentPreference(value)}
                      className={`flex-1 px-4 py-2.5 rounded-xl border text-left transition-all ${
                        equipmentPreference === value
                          ? "border-green-500/50 bg-green-500/10 text-green-300"
                          : "border-zinc-700 bg-zinc-900 text-zinc-400 hover:border-zinc-600 hover:text-zinc-300"
                      }`}
                    >
                      <div className="text-sm font-semibold">{label}</div>
                      <div className="text-[11px] opacity-70">{desc}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleGenerate}
                disabled={isBusy || blockLlmActions}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-green-500 text-black font-semibold hover:bg-green-400 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {generateMutation.isPending ||
                pendingPlanTasks.some(
                  (task) => task.kind === "plan-generate",
                ) ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Plus className="w-4 h-4" />
                )}
                Tạo kế hoạch tập luyện bằng AI
              </button>

              {pendingPlanTasks.length > 0 && (
                <div className="inline-flex items-center gap-2 text-xs px-3 py-1.5 rounded-full border border-blue-500/30 bg-blue-500/10 text-blue-300">
                  <Clock3 className="w-3.5 h-3.5" />
                  Đang tiếp tục kiểm tra kế hoạch đang xử lý...
                </div>
              )}
            </div>
          </div>

          {pendingPlanTasks.length > 0 && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-100 p-3 text-sm">
              <div className="font-semibold">
                Đang tạo kế hoạch AI... Bạn có thể chuyển trang, hệ thống sẽ
                tiếp tục xử lý.
              </div>
              <div className="mt-1 text-xs text-amber-200/80">
                {pendingPlanTasks
                  .map(
                    (task) =>
                      `${task.title} • ${task.goal || "đang xử lý"} • ${task.status}`,
                  )
                  .join(" | ")}
              </div>
            </div>
          )}

          {loadPlansError && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 text-red-300 p-3 text-sm">
              Không thể tải danh sách kế hoạch:{" "}
              {summarizeApiError(plansError, "Lỗi không xác định")}
            </div>
          )}

          {plans && plans.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {(
                [
                  {
                    key: "active",
                    label: `Đang xử lý (${activePlans.length})`,
                  },
                  {
                    key: "completed",
                    label: `Hoàn thành (${completedPlans.length})`,
                  },
                  { key: "failed", label: `Thất bại (${failedPlans.length})` },
                  { key: "all", label: `Tất cả (${sortedPlans.length})` },
                ] as const
              ).map((tab) => {
                const active = planFilter === tab.key;
                return (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setPlanFilter(tab.key)}
                    className={`px-3 py-2 rounded-xl border text-sm transition-colors ${
                      active
                        ? "border-green-500/40 bg-green-500/10 text-green-300"
                        : "border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700"
                    }`}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>
          )}

          {loadingPlans ? (
            <div className="flex items-center justify-center min-h-[220px] bg-zinc-900/50 border border-zinc-800 rounded-2xl">
              <Loader2 className="w-7 h-7 text-green-500 animate-spin" />
            </div>
          ) : !plans || plans.length === 0 ? (
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-8 text-center">
              <p className="text-zinc-300 font-semibold">
                Chưa có kế hoạch nào.
              </p>
              <p className="text-zinc-500 text-sm mt-1">
                Hãy tạo kế hoạch đầu tiên bằng form phía trên.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {visiblePlans.length === 0 && (
                <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 text-sm text-zinc-400">
                  {planFilter === "active" &&
                  (completedPlans.length > 0 || failedPlans.length > 0)
                    ? "Không có kế hoạch nào đang xử lý. Chuyển sang tab Hoàn thành hoặc Thất bại để xem kế hoạch đã có."
                    : planFilter === "completed" && failedPlans.length > 0
                      ? "Hiện chưa có kế hoạch hoàn thành. Chuyển sang tab Thất bại để tạo lại hoặc ẩn các kế hoạch lỗi."
                      : planFilter === "failed" && completedPlans.length > 0
                        ? "Không có kế hoạch thất bại trong bộ lọc hiện tại."
                        : "Không có kế hoạch nào phù hợp với bộ lọc hiện tại."}
                </div>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                <aside className="lg:col-span-4 bg-zinc-900 border border-zinc-800 rounded-2xl p-3 space-y-2 h-fit">
                  <div className="text-sm font-semibold text-zinc-200 px-1">
                    Danh sách plans
                  </div>
                  {visiblePlans.map((plan) => {
                    const selected = plan.id === currentPlan?.id;
                    return (
                      <div
                        key={plan.id}
                        onClick={() => setSelectedPlanId(plan.id)}
                        className={`w-full text-left rounded-xl border p-3 transition-all ${
                          selected
                            ? "border-green-500/50 bg-green-500/10"
                            : "border-zinc-800 bg-zinc-950 hover:border-zinc-700"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-sm font-semibold text-zinc-100 truncate">
                            {plan.name || "Workout Plan"}
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span
                              className={`text-[11px] px-2 py-0.5 rounded-full border ${statusClass(plan.status)}`}
                            >
                              {statusLabel(plan.status)}
                            </span>
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                handleArchive(plan);
                              }}
                              className="inline-flex items-center justify-center w-7 h-7 rounded-lg border border-zinc-700 text-zinc-400 hover:text-red-300 hover:border-red-500/40 hover:bg-red-500/10"
                              title="Ẩn kế hoạch"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                        <div className="text-xs text-zinc-500 mt-1 truncate">
                          Goal: {plan.goal || "--"} | v{plan.version ?? 1}
                        </div>
                        <div className="text-[11px] text-zinc-600 mt-1">
                          {formatDate(plan.updatedAt || plan.createdAt)}
                        </div>
                        {plan.status === "FAILED" && (
                          <div className="flex flex-wrap gap-2 mt-3">
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                handleRetryFailedPlan(plan);
                              }}
                              disabled={
                                blockLlmActions ||
                                generateMutation.isPending ||
                                pendingPlanTasks.length > 0
                              }
                              className="px-2.5 py-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-300 text-xs hover:bg-amber-500/20 disabled:opacity-60 disabled:cursor-not-allowed"
                            >
                              Tạo lại
                            </button>
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                handleArchive(plan);
                              }}
                              className="px-2.5 py-1.5 rounded-lg border border-zinc-700 text-zinc-300 text-xs hover:bg-zinc-800"
                            >
                              Ẩn
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </aside>

                <section className="lg:col-span-8 space-y-4">
                  {currentPlan && (
                    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 md:p-5 space-y-4">
                      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                        <div>
                          <h2 className="text-zinc-100 text-lg font-bold">
                            {currentPlan.name || "Workout Plan"}
                          </h2>
                          <p className="text-zinc-500 text-sm">
                            {currentPlan.description ||
                              "Kế hoạch được tạo bởi AI"}
                          </p>
                        </div>
                        <span
                          className={`text-xs px-2.5 py-1 rounded-full border h-fit ${statusClass(currentPlan.status)}`}
                        >
                          {statusLabel(currentPlan.status)}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-3">
                          <div className="text-[11px] text-zinc-500">Goal</div>
                          <div className="text-sm text-zinc-100 mt-1">
                            {headerGoal}
                          </div>
                        </div>
                        <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-3">
                          <div className="text-[11px] text-zinc-500">
                            Duration
                          </div>
                          <div className="text-sm text-zinc-100 mt-1">
                            {String(headerDuration)} tuần
                          </div>
                        </div>
                        <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-3">
                          <div className="text-[11px] text-zinc-500">
                            Days / Week
                          </div>
                          <div className="text-sm text-zinc-100 mt-1">
                            {String(headerDays)} buổi
                          </div>
                        </div>
                        <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-3">
                          <div className="text-[11px] text-zinc-500">
                            Exercises / Day
                          </div>
                          <div className="text-sm text-zinc-100 mt-1">
                            {String(headerExercisesPerDay)} bài
                          </div>
                        </div>
                        <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-3">
                          <div className="text-[11px] text-zinc-500">
                            Nơi tập
                          </div>
                          <div className="text-sm text-zinc-100 mt-1">
                            {headerLocation === "HOME"
                              ? "Ở nhà"
                              : headerLocation === "GYM"
                                ? "Phòng gym"
                                : "Chưa xác định"}
                          </div>
                        </div>
                        <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-3">
                          <div className="text-[11px] text-zinc-500">
                            Version
                          </div>
                          <div className="text-sm text-zinc-100 mt-1">
                            v{currentPlan.version ?? 1}
                          </div>
                        </div>
                        <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-3">
                          <div className="text-[11px] text-zinc-500">
                            Created
                          </div>
                          <div className="text-sm text-zinc-100 mt-1">
                            {formatDate(currentPlan.createdAt)}
                          </div>
                        </div>
                        <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-3">
                          <div className="text-[11px] text-zinc-500">
                            Updated
                          </div>
                          <div className="text-sm text-zinc-100 mt-1">
                            {formatDate(currentPlan.updatedAt)}
                          </div>
                        </div>
                      </div>

                      {planWarnings.length > 0 && (
                        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200 space-y-2">
                          <div className="font-semibold">Cảnh báo từ AI</div>
                          <ul className="list-disc pl-5 space-y-1">
                            {planWarnings.map((warning, index) => (
                              <li key={`${warning}-${index}`}>{warning}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {(planEvidence.adjustmentReason.length > 0 ||
                        planEvidence.evidenceUsed.length > 0 ||
                        planEvidence.safetyNotes.length > 0) && (
                        <details className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-3 text-sm text-zinc-300">
                          <summary className="cursor-pointer text-cyan-200 font-semibold">
                            Vì sao AI điều chỉnh kế hoạch
                          </summary>
                          <div className="mt-3 space-y-3">
                            {planEvidence.adjustmentReason.length > 0 && (
                              <div>
                                <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500 mb-1">
                                  Điều chỉnh theo chỉ số
                                </div>
                                <ul className="space-y-2">
                                  {planEvidence.adjustmentReason.map(
                                    (item, index) => (
                                      <li
                                        key={`${item.metric}-${index}`}
                                        className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-2"
                                      >
                                        <div className="text-zinc-100 font-semibold">
                                          {item.metric || "Chỉ số"}:{" "}
                                          {String(item.observed_value ?? "--")}
                                        </div>
                                        {item.interpretation && (
                                          <div className="text-xs text-zinc-400 mt-1">
                                            {item.interpretation}
                                          </div>
                                        )}
                                        {item.plan_adjustment && (
                                          <div className="text-xs text-green-300 mt-1">
                                            {item.plan_adjustment}
                                          </div>
                                        )}
                                      </li>
                                    ),
                                  )}
                                </ul>
                              </div>
                            )}

                            {planEvidence.evidenceUsed.length > 0 && (
                              <div>
                                <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500 mb-1">
                                  Evidence used
                                </div>
                                <ul className="space-y-2">
                                  {planEvidence.evidenceUsed.map(
                                    (item, index) => (
                                      <li
                                        key={`${item.source_url}-${index}`}
                                        className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-2"
                                      >
                                        <div className="flex flex-wrap items-center gap-2">
                                          <span className="text-zinc-100 font-semibold">
                                            {item.title || "Nguồn tham khảo"}
                                          </span>
                                          {item.source_type && (
                                            <span className="text-[10px] px-2 py-0.5 rounded-full border border-cyan-500/30 text-cyan-300">
                                              {formatEvidenceSourceType(
                                                item.source_type,
                                              )}
                                            </span>
                                          )}
                                        </div>
                                        {item.summary && (
                                          <div className="text-xs text-zinc-400 mt-1">
                                            {item.summary}
                                          </div>
                                        )}
                                        {item.source_url && (
                                          <a
                                            className="text-xs text-cyan-300 hover:underline mt-1 inline-block"
                                            href={item.source_url}
                                            target="_blank"
                                            rel="noreferrer"
                                          >
                                            {item.source_url}
                                          </a>
                                        )}
                                      </li>
                                    ),
                                  )}
                                </ul>
                              </div>
                            )}

                            {planEvidence.safetyNotes.length > 0 && (
                              <div>
                                <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500 mb-1">
                                  Safety notes
                                </div>
                                <ul className="list-disc pl-5 space-y-1 text-xs text-zinc-400">
                                  {planEvidence.safetyNotes.map(
                                    (note, index) => (
                                      <li key={`${note}-${index}`}>{note}</li>
                                    ),
                                  )}
                                </ul>
                              </div>
                            )}
                          </div>
                        </details>
                      )}

                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={handleExplain}
                          disabled={
                            explainMutation.isPending ||
                            isExplanationStreaming ||
                            !currentPlan.id ||
                            currentPlan.status !== "COMPLETED"
                          }
                          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl border border-blue-500/30 bg-blue-500/10 text-blue-300 hover:bg-blue-500/20 disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                          {explainMutation.isPending ||
                          isExplanationStreaming ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Wand2 className="w-4 h-4" />
                          )}
                          {isExplanationStreaming
                            ? "AI đang giải thích..."
                            : "Giải thích kế hoạch"}
                        </button>

                        <button
                          type="button"
                          onClick={() => setShowAdjustPanel((v) => !v)}
                          disabled={
                            !currentPlan.id ||
                            currentPlan.status !== "COMPLETED" ||
                            adjustMutation.isPending ||
                            blockLlmActions
                          }
                          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                          <SlidersHorizontal className="w-4 h-4" />
                          Điều chỉnh kế hoạch
                        </button>

                        <button
                          type="button"
                          onClick={() => handleArchive(currentPlan)}
                          disabled={
                            archiveMutation.isPending ||
                            currentPlan.status === "PROCESSING"
                          }
                          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl border border-red-500/30 bg-red-500/10 text-red-300 hover:bg-red-500/20 disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                          <Trash2 className="w-4 h-4" />
                          Ẩn kế hoạch
                        </button>

                        <button
                          type="button"
                          onClick={() => setShowSavePanel((v) => !v)}
                          disabled={
                            !currentPlan.id ||
                            currentPlan.status !== "COMPLETED" ||
                            saveMutation.isPending
                          }
                          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                          <CalendarDays className="w-4 h-4" />
                          Lưu vào lịch tập
                        </button>
                      </div>

                      {showSavePanel && (
                        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 space-y-3">
                          {hasMissingExerciseIds && (
                            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-200">
                              Kế hoạch này còn {missingExerciseIdCount} bài tập
                              chưa có exerciseId. Hãy tạo lại plan trước khi lưu
                              vào lịch tập.
                            </div>
                          )}

                          {/* Replace vs Append mode */}
                          <div className="space-y-1.5">
                            <label className="block text-xs font-semibold text-zinc-400">
                              Lịch tập hiện tại
                            </label>
                            <div className="flex gap-2">
                              {(
                                [
                                  {
                                    value: true,
                                    label: "Thay thế lịch cũ",
                                    desc: "Xóa lịch cũ chưa hoàn thành",
                                  },
                                  {
                                    value: false,
                                    label: "Thêm vào lịch hiện tại",
                                    desc: "Giữ lịch cũ, thêm mới",
                                  },
                                ] as const
                              ).map(({ value, label, desc }) => (
                                <button
                                  key={String(value)}
                                  type="button"
                                  onClick={() => setReplaceExisting(value)}
                                  className={`flex-1 px-3 py-2 rounded-xl border text-left transition-all ${
                                    replaceExisting === value
                                      ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-200"
                                      : "border-zinc-700 bg-zinc-900 text-zinc-400 hover:border-zinc-600"
                                  }`}
                                >
                                  <div className="text-xs font-semibold">
                                    {label}
                                  </div>
                                  <div className="text-[10px] opacity-70 mt-0.5">
                                    {desc}
                                  </div>
                                </button>
                              ))}
                            </div>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <div className="space-y-1">
                              <label className="block text-xs font-semibold text-zinc-400">
                                Ngày bắt đầu
                              </label>
                              <input
                                type="date"
                                value={saveStartDate}
                                onChange={(e) =>
                                  setSaveStartDate(e.target.value)
                                }
                                className="w-full rounded-xl bg-zinc-950 border border-zinc-800 px-3 py-2 text-zinc-100 outline-none focus:border-emerald-500/50"
                              />
                            </div>
                            <div className="space-y-1">
                              <label className="block text-xs font-semibold text-zinc-400">
                                Số tuần áp dụng (optional)
                              </label>
                              <input
                                type="number"
                                min={1}
                                max={52}
                                value={saveRepeatWeeksInput}
                                onChange={(e) =>
                                  setSaveRepeatWeeksInput(e.target.value)
                                }
                                placeholder={String(
                                  currentContent?.durationWeeks ??
                                    currentPlan.duration ??
                                    1,
                                )}
                                className="w-full rounded-xl bg-zinc-950 border border-zinc-800 px-3 py-2 text-zinc-100 outline-none focus:border-emerald-500/50"
                              />
                            </div>
                          </div>
                          <div className="space-y-2">
                            <div className="flex items-center justify-between gap-3">
                              <label className="block text-xs font-semibold text-zinc-400">
                                Chọn ngày tập trong tuần
                              </label>
                              <span className="text-xs text-zinc-500">
                                Đã chọn {selectedWeekdays.length}/
                                {saveDaysPerWeek} ngày
                              </span>
                            </div>
                            <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
                              {WEEKDAY_OPTIONS.map((option) => {
                                const isSelected = selectedWeekdays.includes(
                                  option.value,
                                );
                                const isAtLimit =
                                  selectedWeekdays.length >= saveDaysPerWeek;
                                return (
                                  <button
                                    key={option.value}
                                    type="button"
                                    onClick={() =>
                                      toggleSaveWeekday(option.value)
                                    }
                                    className={[
                                      "min-h-12 rounded-xl border px-2 py-2 text-center transition-colors",
                                      isSelected
                                        ? "border-emerald-400 bg-emerald-400 text-black"
                                        : "border-zinc-800 bg-zinc-950 text-zinc-300 hover:border-emerald-500/50 hover:text-emerald-200",
                                      !isSelected && isAtLimit
                                        ? "opacity-50"
                                        : "",
                                    ].join(" ")}
                                  >
                                    <span className="block text-sm font-bold">
                                      {option.short}
                                    </span>
                                    <span className="block text-[10px] leading-tight">
                                      {option.label}
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                            <div className="text-xs text-zinc-500">
                              Day 1 đến Day {saveDaysPerWeek} sẽ được xếp theo
                              thứ tự ngày đã chọn.
                            </div>
                            {weekdayWarning && (
                              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-200">
                                {weekdayWarning}
                              </div>
                            )}
                          </div>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={handleSaveToWorkoutLog}
                              disabled={
                                saveMutation.isPending ||
                                checkingCurrentProgram ||
                                hasMissingExerciseIds ||
                                selectedWeekdays.length !== saveDaysPerWeek
                              }
                              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-emerald-400 text-black font-semibold hover:bg-emerald-300 disabled:opacity-60 disabled:cursor-not-allowed"
                            >
                              {saveMutation.isPending ||
                              checkingCurrentProgram ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <CalendarDays className="w-4 h-4" />
                              )}
                              {checkingCurrentProgram
                                ? "Đang kiểm tra"
                                : "Lưu lịch tập"}
                            </button>
                            <button
                              type="button"
                              onClick={() => setShowSavePanel(false)}
                              className="px-3.5 py-2 rounded-xl border border-zinc-700 text-zinc-300 hover:bg-zinc-800"
                            >
                              Đóng
                            </button>
                          </div>
                        </div>
                      )}

                      {saveOutcome && (
                        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-100 space-y-3">
                          <div className="font-semibold">
                            {saveOutcome.message}
                          </div>
                          <div className="text-emerald-200/90">
                            {saveOutcome.createdScheduleCount > 0
                              ? `Tạo/đồng bộ ${saveOutcome.createdScheduleCount} lịch tập.`
                              : "Không có lịch tập mới được tạo thêm."}
                          </div>
                          {saveOutcome.selectedWeekdays?.length ? (
                            <div className="text-xs text-emerald-200/80">
                              Lịch tập:{" "}
                              {saveOutcome.selectedWeekdays
                                .map(
                                  (day) =>
                                    WEEKDAY_LABEL_BY_VALUE[day] ??
                                    `Ngày ${day}`,
                                )
                                .join(", ")}
                            </div>
                          ) : null}
                          {saveOutcome.createdProgramId && (
                            <div className="text-xs text-emerald-200/80 break-all">
                              Program ID: {saveOutcome.createdProgramId}
                            </div>
                          )}
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                window.location.assign("/client/workout")
                              }
                              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-emerald-400 text-black font-semibold hover:bg-emerald-300"
                            >
                              Đi tới lịch tập
                            </button>
                          </div>
                        </div>
                      )}

                      {showAdjustPanel && (
                        <div className="rounded-xl border border-zinc-700 bg-zinc-950 p-3 space-y-3">
                          <label className="block text-xs font-semibold text-zinc-400">
                            Yêu cầu điều chỉnh
                          </label>
                          <textarea
                            value={adjustments}
                            onChange={(e) => setAdjustments(e.target.value)}
                            rows={4}
                            placeholder="Ví dụ: Tăng bài chân, giảm cardio, ưu tiên ngực vai tay sau"
                            className="w-full rounded-xl bg-zinc-900 border border-zinc-800 px-3 py-2 text-zinc-100 outline-none focus:border-amber-500/50"
                          />
                          <div className="w-full md:w-48 space-y-1">
                            <label className="block text-xs font-semibold text-zinc-400">
                              daysPerWeek mới (optional)
                            </label>
                            <input
                              type="number"
                              min={1}
                              max={7}
                              value={adjustDaysPerWeekInput}
                              onChange={(e) =>
                                setAdjustDaysPerWeekInput(e.target.value)
                              }
                              className="w-full rounded-xl bg-zinc-900 border border-zinc-800 px-3 py-2 text-zinc-100 outline-none focus:border-amber-500/50"
                            />
                          </div>
                          <div className="w-full md:w-48 space-y-1">
                            <label className="block text-xs font-semibold text-zinc-400">
                              Số bài / buổi mới (optional)
                            </label>
                            <input
                              type="number"
                              min={1}
                              max={8}
                              value={adjustExercisesPerDayInput}
                              onChange={(e) =>
                                setAdjustExercisesPerDayInput(e.target.value)
                              }
                              className="w-full rounded-xl bg-zinc-900 border border-zinc-800 px-3 py-2 text-zinc-100 outline-none focus:border-amber-500/50"
                            />
                          </div>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={handleAdjust}
                              disabled={
                                adjustMutation.isPending || blockLlmActions
                              }
                              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-amber-400 text-black font-semibold hover:bg-amber-300 disabled:opacity-60 disabled:cursor-not-allowed"
                            >
                              {adjustMutation.isPending ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <Target className="w-4 h-4" />
                              )}
                              Gửi điều chỉnh
                            </button>
                            <button
                              type="button"
                              onClick={() => setShowAdjustPanel(false)}
                              className="px-3.5 py-2 rounded-xl border border-zinc-700 text-zinc-300 hover:bg-zinc-800"
                            >
                              Đóng
                            </button>
                          </div>
                        </div>
                      )}

                      {explanationResult && (
                        <div className="rounded-xl border border-blue-500/30 bg-blue-500/5 p-3 space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="text-xs font-semibold text-blue-300">
                              Giải thích kế hoạch
                            </div>
                            <span className="text-[11px] px-2 py-0.5 rounded-full border border-zinc-700 text-zinc-300 bg-zinc-950/60">
                              {isExplanationStreaming
                                ? "Đang chạy"
                                : explanationResult.source === "fallback"
                                  ? "Tự động"
                                  : "AI"}
                            </span>
                            {!isExplanationStreaming && currentPlan?.id && (
                              <button
                                type="button"
                                onClick={handleExplain}
                                disabled={explainMutation.isPending}
                                className="ml-auto text-[11px] px-2 py-1 rounded-lg border border-blue-500/30 text-blue-200 hover:bg-blue-500/10 disabled:opacity-60"
                              >
                                Tạo lại giải thích
                              </button>
                            )}
                          </div>
                          {isExplanationStreaming && (
                            <div className="text-xs text-blue-200 rounded-lg border border-blue-500/30 bg-blue-500/10 px-2.5 py-2">
                              {explanationStatus ||
                                "AI đang giải thích kế hoạch..."}
                            </div>
                          )}
                          {explanationResult.source === "fallback" && (
                            <div className="text-xs text-amber-200 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-2">
                              Đang dùng giải thích tự động vì AI phản hồi chậm.
                            </div>
                          )}
                          <pre className="whitespace-pre-wrap text-sm text-zinc-200 leading-relaxed">
                            {formatExplanationText(explanationResult)}
                            {isExplanationStreaming ? (
                              <span className="text-blue-300 animate-pulse">
                                ▍
                              </span>
                            ) : null}
                          </pre>
                          {formatExplanationWarnings(explanationResult).length >
                            0 && (
                            <details className="rounded-lg border border-zinc-800 bg-zinc-950/70 px-3 py-2">
                              <summary className="cursor-pointer text-xs font-medium text-zinc-300">
                                Chi tiết kỹ thuật
                              </summary>
                              <ul className="mt-2 list-disc pl-5 text-xs text-zinc-500 space-y-1">
                                {formatExplanationWarnings(
                                  explanationResult,
                                ).map((warning, index) => (
                                  <li key={`${warning}-${index}`}>{warning}</li>
                                ))}
                              </ul>
                            </details>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 md:p-5 space-y-3">
                    <div className="text-zinc-100 font-semibold flex items-center gap-2">
                      <CalendarDays className="w-4 h-4 text-green-400" />
                      Lịch tập theo tuần
                    </div>

                    {currentPlan &&
                    (currentPlan.status === "QUEUED" ||
                      currentPlan.status === "PROCESSING") ? (
                      <div className="rounded-xl border border-blue-500/30 bg-blue-500/10 text-blue-200 text-sm p-3">
                        AI plan đang được xử lý. UI sẽ tự động cập nhật khi job
                        hoàn tất.
                      </div>
                    ) : !weeklySchedule ? (
                      <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-200 text-sm p-3">
                        Kế hoạch đã được tạo nhưng dữ liệu lịch tập chưa đúng
                        định dạng.
                      </div>
                    ) : weeklySchedule.length === 0 ? (
                      <div className="rounded-xl border border-zinc-800 bg-zinc-950 text-zinc-400 text-sm p-3">
                        Chưa có buổi tập trong weeklySchedule.
                      </div>
                    ) : (
                      weeklySchedule.map((day, dayIndex) => {
                        const key = `${day.day ?? dayIndex}`;
                        const expanded = expandedDayKey === key;
                        const exercises = toExerciseList(day.exercises);
                        const invalidExercises = exercises.filter(
                          (exercise) =>
                            !exercise.exerciseId ||
                            typeof exercise.exerciseId !== "string" ||
                            !exercise.exerciseId.trim() ||
                            !UUID_PATTERN.test(exercise.exerciseId.trim()),
                        );
                        const hasInvalidExerciseIds =
                          invalidExercises.length > 0;
                        const title = localizeDayGoalForDisplay(
                          day.goal || day.focus,
                          dayIndex,
                        );

                        return (
                          <div
                            key={key}
                            className={`rounded-xl border overflow-hidden ${hasInvalidExerciseIds ? "border-amber-500/30" : "border-zinc-800"}`}
                          >
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedDayKey((prev) =>
                                  prev === key ? null : key,
                                )
                              }
                              className="w-full flex items-center justify-between gap-3 p-3 bg-zinc-950 hover:bg-zinc-900"
                            >
                              <div className="flex items-center gap-3 text-left">
                                <span className="w-9 h-9 rounded-lg bg-green-500/10 border border-green-500/20 text-green-300 flex items-center justify-center text-xs font-bold">
                                  {String(day.day ?? dayIndex + 1)}
                                </span>
                                <div>
                                  <div className="text-sm text-zinc-100 font-semibold">
                                    {title}
                                  </div>
                                  <div className="text-xs text-zinc-500">
                                    {exercises.length} bài tập
                                    {hasInvalidExerciseIds
                                      ? ` • ${invalidExercises.length} thiếu exerciseId`
                                      : ""}
                                  </div>
                                </div>
                              </div>
                              {expanded ? (
                                <ChevronDown className="w-4 h-4 text-zinc-500" />
                              ) : (
                                <ChevronRight className="w-4 h-4 text-zinc-500" />
                              )}
                            </button>

                            {expanded && (
                              <div className="p-3 bg-zinc-900 border-t border-zinc-800 space-y-2">
                                {day.notes && (
                                  <div className="text-xs text-zinc-400 rounded-lg bg-zinc-950 border border-zinc-800 p-2">
                                    Ghi chú ngày tập:{" "}
                                    {localizePlanNoteForDisplay(day.notes)}
                                  </div>
                                )}
                                {day.cardio && (
                                  <div className="text-xs text-zinc-400 rounded-lg bg-zinc-950 border border-zinc-800 p-2">
                                    Cardio:{" "}
                                    {localizePlanNoteForDisplay(day.cardio)}
                                  </div>
                                )}

                                {hasInvalidExerciseIds && (
                                  <div className="text-xs text-amber-200 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2">
                                    Một số bài tập trong ngày này chưa có
                                    exerciseId hợp lệ. Hệ thống sẽ cố gắng tìm
                                    kiếm tên bài tập trong cơ sở dữ liệu. Nếu
                                    không tìm thấy, bài tập này sẽ bị bỏ qua khi
                                    lưu.
                                  </div>
                                )}

                                {exercises.length === 0 ? (
                                  <div className="text-xs text-zinc-500">
                                    Không có dữ liệu bài tập.
                                  </div>
                                ) : (
                                  <div className="space-y-2">
                                    {exercises.map((exercise, index) => {
                                      const catalogEntry = exercise.exerciseId
                                        ? exerciseCatalogById.get(exercise.exerciseId)
                                        : undefined;
                                      const muscleGroup = catalogEntry?.muscleGroupsActivated?.length
                                        ? catalogEntry.muscleGroupsActivated.join(", ")
                                        : "--";
                                      const equipment = catalogEntry?.typeOfEquipment ?? "--";
                                      return (
                                      <div
                                        key={`${exercise.name ?? "ex"}-${index}`}
                                        className="rounded-lg border border-zinc-800 bg-zinc-950 p-2.5"
                                      >
                                        <div className="flex items-center gap-2 text-sm text-zinc-100 font-medium">
                                          <Dumbbell className="w-4 h-4 text-green-400" />
                                          <span>
                                            {exercise.order ?? index + 1}.
                                          </span>
                                          <span>
                                            {exercise.name ?? "Exercise"}
                                          </span>
                                        </div>
                                        <div className="mt-1.5 text-xs text-zinc-400 grid grid-cols-2 md:grid-cols-4 gap-y-1">
                                          <div>
                                            Sets: {exercise.sets ?? "--"}
                                          </div>
                                          <div>
                                            Reps: {exercise.reps ?? "--"}
                                          </div>
                                          <div>
                                            Rest: {exercise.restSeconds ?? "--"}
                                            s
                                          </div>
                                          <div>
                                            Muscle: {muscleGroup}
                                          </div>
                                          <div>
                                            Equipment: {equipment}
                                          </div>
                                          <div className="md:col-span-2">
                                            Note:{" "}
                                            {exercise.note
                                              ? localizePlanNoteForDisplay(
                                                  exercise.note,
                                                )
                                              : "--"}
                                          </div>
                                        </div>
                                      </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>

                  <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 md:p-5 space-y-3">
                    <div className="text-zinc-100 font-semibold">
                      Ghi chú kế hoạch
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-3">
                        <div className="text-xs font-semibold text-zinc-400 mb-1">
                          Ghi chú tăng tiến
                        </div>
                        {(currentContent?.progressionNotes ?? []).length > 0 ? (
                          <ul className="text-sm text-zinc-300 space-y-1">
                            {(currentContent?.progressionNotes ?? []).map(
                              (note, i) => (
                                <li key={`prog-${i}`} className="flex gap-2">
                                  <CircleCheck className="w-4 h-4 text-green-400 mt-0.5" />
                                  <span>
                                    {localizePlanNoteForDisplay(note)}
                                  </span>
                                </li>
                              ),
                            )}
                          </ul>
                        ) : (
                          <p className="text-sm text-zinc-500">
                            Chưa có ghi chú tăng tiến.
                          </p>
                        )}
                      </div>

                      <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-3">
                        <div className="text-xs font-semibold text-zinc-400 mb-1">
                          Ghi chú phục hồi
                        </div>
                        {(currentContent?.recoveryNotes ?? []).length > 0 ? (
                          <ul className="text-sm text-zinc-300 space-y-1">
                            {(currentContent?.recoveryNotes ?? []).map(
                              (note, i) => (
                                <li key={`rec-${i}`} className="flex gap-2">
                                  <CircleCheck className="w-4 h-4 text-blue-400 mt-0.5" />
                                  <span>
                                    {localizePlanNoteForDisplay(note)}
                                  </span>
                                </li>
                              ),
                            )}
                          </ul>
                        ) : (
                          <p className="text-sm text-zinc-500">
                            Chưa có ghi chú phục hồi.
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-3">
                      <div className="text-xs font-semibold text-zinc-400 mb-1">
                        Tóm tắt dinh dưỡng
                      </div>
                      <p className="text-sm text-zinc-300">
                        {currentContent?.nutritionSummary
                          ? localizePlanNoteForDisplay(
                              currentContent.nutritionSummary,
                            )
                          : "Chưa có tóm tắt dinh dưỡng."}
                      </p>
                    </div>
                  </div>
                </section>
              </div>
            </div>
          )}

          {currentPlan && currentPlan.status === "FAILED" && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300 flex items-start gap-2">
              <CircleX className="w-4 h-4 mt-0.5" />
              <div>
                <div className="font-semibold">
                  Plan hiện tại đang ở trạng thái thất bại
                </div>
                <div>{friendlyPlanFailReason(currentPlan.failReason)}</div>
                {currentPlan.failReason && (
                  <details className="mt-2 rounded-lg border border-red-500/20 bg-zinc-950/50 px-3 py-2">
                    <summary className="cursor-pointer text-xs font-medium text-red-200">
                      Chi tiết kỹ thuật
                    </summary>
                    <pre className="mt-2 whitespace-pre-wrap break-words text-xs text-red-100/80">
                      {currentPlan.failReason}
                    </pre>
                  </details>
                )}
                <div className="flex flex-wrap gap-2 mt-3">
                  <button
                    type="button"
                    onClick={() => handleRetryFailedPlan(currentPlan)}
                    disabled={
                      blockLlmActions ||
                      generateMutation.isPending ||
                      pendingPlanTasks.length > 0
                    }
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20 disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    <Plus className="w-4 h-4" />
                    Tạo lại
                  </button>
                  <button
                    type="button"
                    onClick={() => handleArchive(currentPlan)}
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-red-500/30 bg-red-500/10 text-red-200 hover:bg-red-500/20"
                  >
                    <Trash2 className="w-4 h-4" />
                    Ẩn kế hoạch
                  </button>
                </div>
              </div>
            </div>
          )}

          <AlertDialog
            open={Boolean(archiveTarget)}
            onOpenChange={(open) => {
              if (!open) setArchiveTarget(null);
            }}
          >
            <AlertDialogContent className="bg-zinc-950 border-zinc-800 text-zinc-100">
              <AlertDialogHeader>
                <AlertDialogTitle>Ẩn kế hoạch?</AlertDialogTitle>
                <AlertDialogDescription className="text-zinc-400">
                  Bạn muốn ẩn kế hoạch này khỏi danh sách? Lịch tập đã lưu sẽ
                  không bị xoá.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel className="border-zinc-700 text-zinc-200 hover:bg-zinc-900">
                  Huỷ
                </AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    if (archiveTarget?.id) {
                      archiveMutation.mutate(archiveTarget.id);
                    }
                  }}
                  className="bg-red-500 text-white hover:bg-red-400"
                >
                  Ẩn kế hoạch
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}
    </div>
  );
}
