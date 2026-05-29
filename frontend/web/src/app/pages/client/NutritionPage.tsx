import { useState, useEffect, useRef } from "react";
import {
  Utensils, Plus, Search, TrendingUp, Loader2, X, ChevronLeft, ChevronRight,
  Pencil, Trash2, Target, AlertTriangle, CheckCircle2, Info,
  ChevronDown, ChevronUp,
} from "lucide-react";
import {
  PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, Tooltip, CartesianGrid,
} from "recharts";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { nutritionService, foodService } from "../../services/api";
import { translateFoodQuery } from "../../utils/foodSearchSynonyms";
import { toast } from "sonner";

// ── Types ────────────────────────────────────────────────────────────────────

type MealType = "breakfast" | "lunch" | "dinner" | "snack";

/** Raw shape returned from backend (NutritionLog has `fats` plural) */
interface RawNutritionLog {
  id: string;
  date: string;
  mealType: string;
  foodName: string;
  foodId: string | null;
  calories: number;
  protein: number | null;
  carbs: number | null;
  fats: number | null;
  quantity: number | null;
  unit: string | null;
  notes: string | null;
}

/** Internal type — normalized to `fat` singular */
interface NutritionLog {
  id: string;
  date: string;
  mealType: MealType;
  foodName: string;
  foodId: string | null;
  calories: number;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  quantity: number | null;
  unit: string | null;
  notes: string | null;
}

interface FoodItem {
  id: string;
  name: string;
  calories: number;
  protein: number;
  carbs: number;
  fats: number;
  imageUrl: string | null;
}

/** id is undefined when backend returns default (user has no saved goal) */
interface NutritionGoal {
  id?: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  waterMl: number | null;
}

interface EditForm {
  mealType: MealType;
  foodName: string;
  quantity: number;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  notes: string;
}

// ── Constants ────────────────────────────────────────────────────────────────

const COLORS = ["#22c55e", "#60a5fa", "#f59e0b"];
const MEAL_TYPES: MealType[] = ["breakfast", "lunch", "dinner", "snack"];
const MEAL_LABELS: Record<MealType, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snack: "Snack",
};
const MEAL_TIMES: Record<MealType, string> = {
  breakfast: "06–10",
  lunch: "11–14",
  dinner: "18–21",
  snack: "anytime",
};
const WEEK_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Format local date as YYYY-MM-DD (timezone-safe, avoids UTC shift) */
function formatLocalDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatDisplayDate(d: Date): string {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Hôm nay";
  if (d.toDateString() === yesterday.toDateString()) return "Hôm qua";
  return d.toLocaleDateString("vi-VN", { weekday: "short", month: "short", day: "numeric" });
}

/** Normalize raw log from API: map fats (plural) → fat (singular) */
function normalizeLog(raw: RawNutritionLog): NutritionLog {
  return {
    id: raw.id,
    date: raw.date,
    mealType: raw.mealType as MealType,
    foodName: raw.foodName,
    foodId: raw.foodId ?? null,
    calories: raw.calories,
    protein: raw.protein ?? null,
    carbs: raw.carbs ?? null,
    fat: raw.fats ?? null,
    quantity: raw.quantity ?? null,
    unit: raw.unit ?? null,
    notes: raw.notes ?? null,
  };
}

function pct(consumed: number, target: number): number {
  if (!target || target <= 0) return 0;
  return Math.min(100, Math.round((consumed / target) * 100));
}

// ── Component ─────────────────────────────────────────────────────────────────

export function NutritionPage() {
  const queryClient = useQueryClient();

  // Date navigation
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const dateStr = formatLocalDate(selectedDate);
  const todayStr = formatLocalDate(new Date());
  const isToday = dateStr === todayStr;
  const weekStartStr = formatLocalDate(new Date(Date.now() - 6 * 24 * 60 * 60 * 1000));

  // Add Food modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [addMealType, setAddMealType] = useState<MealType>("breakfast");
  const [foodQuery, setFoodQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [selectedFood, setSelectedFood] = useState<FoodItem | null>(null);
  const [addQty, setAddQty] = useState("100");
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  // Edit Log modal
  const [editingLog, setEditingLog] = useState<NutritionLog | null>(null);
  const [editForm, setEditForm] = useState<EditForm>({
    mealType: "breakfast",
    foodName: "",
    quantity: 100,
    calories: 0,
    protein: 0,
    carbs: 0,
    fat: 0,
    notes: "",
  });

  // Delete confirm
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Goal modal
  const [showGoalModal, setShowGoalModal] = useState(false);
  const [goalForm, setGoalForm] = useState({
    calories: 2000,
    protein: 150,
    carbs: 200,
    fat: 65,
  });

  // Expanded meals (all open by default)
  const [expandedMeals, setExpandedMeals] = useState<Set<MealType>>(
    new Set(["breakfast", "lunch", "dinner", "snack"]),
  );

  // ── Data fetching ────────────────────────────────────────────────────────

  const { data: todayRaw, isLoading: loadingLogs } = useQuery({
    queryKey: ["nutrition-logs", dateStr],
    queryFn: () => nutritionService.getLogs(dateStr, dateStr),
  });
  const todayLogs: NutritionLog[] = Array.isArray(todayRaw)
    ? (todayRaw as RawNutritionLog[]).map(normalizeLog)
    : [];

  const { data: goalRaw, isLoading: loadingGoal } = useQuery({
    queryKey: ["nutrition-goal"],
    queryFn: () => nutritionService.getGoal(),
  });
  const goal = goalRaw as NutritionGoal | undefined;

  const { data: weeklyRaw } = useQuery({
    queryKey: ["nutrition-weekly"],
    queryFn: () => nutritionService.getLogs(weekStartStr, todayStr),
  });
  const weeklyLogs: NutritionLog[] = Array.isArray(weeklyRaw)
    ? (weeklyRaw as RawNutritionLog[]).map(normalizeLog)
    : [];

  const translation = translateFoodQuery(debouncedQuery);

  // queryKey uses translation.searchQuery intentionally:
  // "ức gà" and "uc ga" both map to "chicken breast" → shared cache entry
  const { data: foodResults = [] as FoodItem[], isFetching: searchingFood } = useQuery({
    queryKey: ["food-search", translation.searchQuery],
    queryFn: () => foodService.search(translation.searchQuery),
    enabled: translation.searchQuery.trim().length >= 2,
  });

  // ── Sync form states ────────────────────────────────────────────────────

  useEffect(() => {
    if (goal) {
      setGoalForm({
        calories: goal.calories,
        protein: goal.protein,
        carbs: goal.carbs,
        fat: goal.fat,
      });
    }
  }, [goal]);

  useEffect(() => {
    if (editingLog) {
      setEditForm({
        mealType: editingLog.mealType,
        foodName: editingLog.foodName,
        quantity: editingLog.quantity ?? 100,
        calories: editingLog.calories,
        protein: editingLog.protein ?? 0,
        carbs: editingLog.carbs ?? 0,
        fat: editingLog.fat ?? 0,
        notes: editingLog.notes ?? "",
      });
    }
  }, [editingLog]);

  // ── Derived data ─────────────────────────────────────────────────────────

  const mealGroups: Record<MealType, NutritionLog[]> = {
    breakfast: [],
    lunch: [],
    dinner: [],
    snack: [],
  };
  todayLogs.forEach((l) => {
    if (mealGroups[l.mealType]) mealGroups[l.mealType].push(l);
  });

  const totals = todayLogs.reduce(
    (acc, l) => ({
      calories: acc.calories + l.calories,
      protein: acc.protein + (l.protein ?? 0),
      carbs: acc.carbs + (l.carbs ?? 0),
      fat: acc.fat + (l.fat ?? 0),
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 },
  );

  const pieTotal = Math.round(totals.protein * 4) + Math.round(totals.carbs * 4) + Math.round(totals.fat * 9);
  const pieData = [
    { name: "Protein", value: Math.round(totals.protein * 4) },
    { name: "Carbs", value: Math.round(totals.carbs * 4) },
    { name: "Fat", value: Math.round(totals.fat * 9) },
  ];

  const weeklyHistory = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    const ds = formatLocalDate(d);
    return {
      day: WEEK_DAYS[d.getDay()],
      calories: weeklyLogs
        .filter((l) => l.date.startsWith(ds))
        .reduce((s, l) => s + l.calories, 0),
    };
  });

  // Rule-based feedback (tiếng Việt, max 2 alerts)
  const feedback: Array<{ type: "warning" | "success" | "info"; text: string }> = [];
  if (isToday && todayLogs.length === 0) {
    feedback.push({ type: "info", text: "Bạn chưa log món nào hôm nay. Hãy bắt đầu ghi lại bữa ăn!" });
  } else if (isToday && goal) {
    const calPct = totals.calories / goal.calories;
    const protPct = totals.protein / goal.protein;
    const fatPct = totals.fat / goal.fat;

    if (calPct > 1.1) {
      feedback.push({ type: "warning", text: "Bạn đã vượt mục tiêu calories hôm nay, nên cân nhắc giảm khẩu phần ở các bữa còn lại." });
    }
    if (protPct < 0.8 && feedback.length < 2) {
      feedback.push({ type: "warning", text: "Protein hôm nay còn thấp, bạn nên bổ sung thêm thực phẩm giàu protein." });
    }
    if (feedback.length === 0 && calPct < 0.8) {
      feedback.push({ type: "warning", text: "Bạn còn thiếu năng lượng so với mục tiêu hôm nay." });
    }
    if (feedback.length < 2 && fatPct > 1.1) {
      feedback.push({ type: "warning", text: "Lượng chất béo hôm nay hơi cao, nên ưu tiên món ít dầu mỡ hơn." });
    }
    if (feedback.length === 0 && calPct >= 0.8 && calPct <= 1.1 && protPct >= 0.8) {
      feedback.push({ type: "success", text: "Dinh dưỡng hôm nay khá ổn so với mục tiêu của bạn." });
    }
  }

  const isDefaultGoal = !goal?.id;

  // Add food preview
  const addQtyNum = parseFloat(addQty) || 0;
  const addScale = addQtyNum / 100;
  const addPreview = selectedFood
    ? {
        calories: Math.round(selectedFood.calories * addScale),
        protein: ((selectedFood.protein ?? 0) * addScale).toFixed(1),
        carbs: ((selectedFood.carbs ?? 0) * addScale).toFixed(1),
        fat: ((selectedFood.fats ?? 0) * addScale).toFixed(1),
      }
    : null;

  // ── Mutations ────────────────────────────────────────────────────────────

  const invalidateNutrition = () => {
    queryClient.invalidateQueries({ queryKey: ["nutrition-logs"] });
    queryClient.invalidateQueries({ queryKey: ["nutrition-weekly"] });
  };

  const createMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => nutritionService.createLog(payload),
    onSuccess: () => {
      invalidateNutrition();
      toast.success("Đã thêm món ăn");
      closeAddModal();
    },
    onError: (e: { response?: { data?: { error?: string } } }) =>
      toast.error(e.response?.data?.error ?? "Không thể thêm món ăn"),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      nutritionService.updateLog(id, data),
    onSuccess: () => {
      invalidateNutrition();
      toast.success("Cập nhật thành công");
      setEditingLog(null);
    },
    onError: (e: { response?: { data?: { error?: string } } }) =>
      toast.error(e.response?.data?.error ?? "Không thể cập nhật"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => nutritionService.deleteLog(id),
    onSuccess: () => {
      invalidateNutrition();
      toast.success("Đã xóa");
      setDeletingId(null);
    },
    onError: (e: { response?: { data?: { error?: string } } }) =>
      toast.error(e.response?.data?.error ?? "Không thể xóa"),
  });

  const goalMutation = useMutation({
    mutationFn: (data: { calories: number; protein: number; carbs: number; fat: number }) =>
      nutritionService.upsertGoal(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["nutrition-goal"] });
      toast.success("Mục tiêu đã lưu");
      setShowGoalModal(false);
    },
    onError: (e: { response?: { data?: { error?: string } } }) =>
      toast.error(e.response?.data?.error ?? "Không thể lưu mục tiêu"),
  });

  // ── Handlers ─────────────────────────────────────────────────────────────

  function openAddModal(meal: MealType) {
    setAddMealType(meal);
    setShowAddModal(true);
  }

  function closeAddModal() {
    setShowAddModal(false);
    setFoodQuery("");
    setDebouncedQuery("");
    setSelectedFood(null);
    setAddQty("100");
    clearTimeout(debounceRef.current);
  }

  function handleFoodQueryChange(value: string) {
    setFoodQuery(value);
    setSelectedFood(null);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedQuery(value), 300);
  }

  function handleAddFood() {
    if (!selectedFood) {
      toast.error("Chọn một món ăn trước");
      return;
    }
    const addQtyNum = parseFloat(addQty);
    if (isNaN(addQtyNum) || addQtyNum <= 0 || addQtyNum > 5000) {
      toast.error("Khối lượng không hợp lệ (1–5000g)");
      return;
    }
    const scale = addQtyNum / 100;
    const cal = Math.round(selectedFood.calories * scale);
    const prot = parseFloat(((selectedFood.protein ?? 0) * scale).toFixed(1));
    const carbs = parseFloat(((selectedFood.carbs ?? 0) * scale).toFixed(1));
    const fats = parseFloat(((selectedFood.fats ?? 0) * scale).toFixed(1));

    if (cal === 0 && prot === 0 && carbs === 0 && fats === 0) {
      toast.warning("Thực phẩm này có giá trị dinh dưỡng = 0, kiểm tra lại nếu cần.");
    }

    createMutation.mutate({
      date: new Date(dateStr + "T12:00:00.000Z").toISOString(),
      mealType: addMealType,
      foodId: selectedFood.id,
      foodName: selectedFood.name,
      quantity: addQtyNum,
      unit: "g",
      calories: cal,
      protein: prot,
      carbs: carbs,
      fats: fats, // backend schema uses 'fats' (plural)
    });
  }

  function handleUpdateLog() {
    if (!editingLog) return;
    if (!editForm.foodName.trim()) {
      toast.error("Tên thực phẩm không được để trống");
      return;
    }
    if (isNaN(editForm.calories) || editForm.calories < 0) {
      toast.error("Calories không hợp lệ");
      return;
    }
    if (
      isNaN(editForm.protein) || editForm.protein < 0 ||
      isNaN(editForm.carbs) || editForm.carbs < 0 ||
      isNaN(editForm.fat) || editForm.fat < 0
    ) {
      toast.error("Giá trị macro phải >= 0");
      return;
    }
    updateMutation.mutate({
      id: editingLog.id,
      data: {
        mealType: editForm.mealType,
        foodName: editForm.foodName,
        quantity: editForm.quantity,
        unit: "g",
        calories: editForm.calories,
        protein: editForm.protein,
        carbs: editForm.carbs,
        fats: editForm.fat, // internal `fat` → API `fats`
        notes: editForm.notes || undefined,
      },
    });
  }

  function handleSaveGoal() {
    const { calories, protein, carbs, fat } = goalForm;
    if ([calories, protein, carbs, fat].some((v) => !v || isNaN(v) || v <= 0)) {
      toast.error("Mục tiêu phải lớn hơn 0");
      return;
    }
    goalMutation.mutate({ calories, protein, carbs, fat });
  }

  function toggleMeal(meal: MealType) {
    setExpandedMeals((prev) => {
      const next = new Set(prev);
      if (next.has(meal)) next.delete(meal);
      else next.add(meal);
      return next;
    });
  }

  function prevDay() {
    setSelectedDate((d) => {
      const n = new Date(d);
      n.setDate(n.getDate() - 1);
      return n;
    });
  }

  function nextDay() {
    if (!isToday) {
      setSelectedDate((d) => {
        const n = new Date(d);
        n.setDate(n.getDate() + 1);
        return n;
      });
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (loadingLogs || loadingGoal) {
    return (
      <div className="flex h-screen items-center justify-center bg-zinc-950">
        <Loader2 className="w-8 h-8 text-green-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-5">

      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-zinc-100 flex items-center gap-2 text-lg font-bold">
            <Utensils className="w-5 h-5 text-orange-400" /> Nhật ký dinh dưỡng
          </h1>
          <p className="text-zinc-500 text-sm mt-0.5">Theo dõi calories và macro hàng ngày</p>
        </div>
        <div className="flex items-center gap-2 self-start sm:self-auto flex-wrap">
          <button
            onClick={() => setShowGoalModal(true)}
            className="flex items-center gap-1.5 px-3 py-2 border border-zinc-700/60 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600 text-sm rounded-xl transition-colors"
          >
            <Target className="w-4 h-4" /> Mục tiêu
          </button>
          <button
            onClick={() => openAddModal("breakfast")}
            className="flex items-center gap-2 bg-green-500 hover:bg-green-400 text-black px-4 py-2 rounded-xl text-sm font-bold transition-all shadow-lg shadow-green-500/20"
          >
            <Plus className="w-4 h-4" /> Thêm món
          </button>
        </div>
      </div>

      {/* ── Date navigation ── */}
      <div className="flex items-center gap-3">
        <button
          onClick={prevDay}
          className="p-1.5 rounded-lg border border-zinc-700/60 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600 transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span className="text-sm font-semibold text-zinc-200 min-w-[130px] text-center">
          {formatDisplayDate(selectedDate)}
          {!isToday && (
            <span className="text-xs text-zinc-500 ml-1 font-normal">
              ({selectedDate.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" })})
            </span>
          )}
        </span>
        <button
          onClick={nextDay}
          disabled={isToday}
          className="p-1.5 rounded-lg border border-zinc-700/60 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
        {!isToday && (
          <button
            onClick={() => setSelectedDate(new Date())}
            className="text-xs text-green-400 hover:text-green-300 transition-colors ml-1"
          >
            Hôm nay
          </button>
        )}
      </div>

      {/* ── Default goal banner ── */}
      {isDefaultGoal && (
        <div className="flex items-center gap-2.5 px-4 py-3 bg-zinc-800/60 border border-zinc-700/40 rounded-xl text-xs text-zinc-400">
          <Info className="w-4 h-4 text-blue-400 flex-shrink-0" />
          Đang dùng mục tiêu mặc định —{" "}
          <button
            onClick={() => setShowGoalModal(true)}
            className="text-green-400 hover:text-green-300 underline underline-offset-2"
          >
            bấm vào đây để thiết lập cá nhân hóa
          </button>
        </div>
      )}

      {/* ── Macro summary cards ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: "Calories", consumed: Math.round(totals.calories), target: goal?.calories ?? 2000, unit: "kcal", color: "#f97316", textColor: "text-orange-400" },
          { label: "Protein", consumed: +totals.protein.toFixed(1), target: goal?.protein ?? 150, unit: "g", color: "#22c55e", textColor: "text-green-400" },
          { label: "Carbs", consumed: +totals.carbs.toFixed(1), target: goal?.carbs ?? 200, unit: "g", color: "#60a5fa", textColor: "text-blue-400" },
          { label: "Fat", consumed: +totals.fat.toFixed(1), target: goal?.fat ?? 65, unit: "g", color: "#f59e0b", textColor: "text-amber-400" },
        ].map((m) => (
          <div key={m.label} className="bg-zinc-900 rounded-xl p-4 border border-zinc-800/60">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-zinc-500 uppercase tracking-wider font-semibold">{m.label}</span>
              <span className="text-xs text-zinc-600">{pct(m.consumed, m.target)}%</span>
            </div>
            <div className={`text-lg font-bold ${m.textColor}`}>
              {m.consumed}
              <span className="text-xs text-zinc-500 font-normal ml-1">{m.unit}</span>
            </div>
            <div className="text-xs text-zinc-600 mb-2">/ {m.target}{m.unit}</div>
            <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${pct(m.consumed, m.target)}%`, backgroundColor: m.color }}
              />
            </div>
          </div>
        ))}
      </div>

      {/* ── Feedback alerts ── */}
      {feedback.length > 0 && (
        <div className="space-y-2">
          {feedback.map((f, i) => (
            <div
              key={i}
              className={`flex items-start gap-2.5 px-4 py-3 rounded-xl text-sm border ${
                f.type === "warning"
                  ? "bg-amber-500/10 border-amber-500/20 text-amber-300"
                  : f.type === "success"
                  ? "bg-green-500/10 border-green-500/20 text-green-300"
                  : "bg-blue-500/10 border-blue-500/20 text-blue-300"
              }`}
            >
              {f.type === "warning" ? (
                <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              ) : f.type === "success" ? (
                <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" />
              ) : (
                <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
              )}
              <span>{f.text}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Main grid ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* Meal sections */}
        <div className="lg:col-span-2 space-y-3">
          {todayLogs.length === 0 && isToday && (
            <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-12 text-center">
              <Utensils className="w-12 h-12 text-zinc-800 mx-auto mb-3" />
              <p className="text-zinc-500 text-sm">Bạn chưa log món nào cho ngày này</p>
              <button
                onClick={() => openAddModal("breakfast")}
                className="mt-4 flex items-center gap-1.5 mx-auto text-green-400 hover:text-green-300 text-sm font-semibold transition-colors"
              >
                <Plus className="w-4 h-4" /> Thêm món đầu tiên
              </button>
            </div>
          )}

          {MEAL_TYPES.map((meal) => {
            const logs = mealGroups[meal];
            const mealCal = logs.reduce((s, l) => s + l.calories, 0);
            const expanded = expandedMeals.has(meal);
            return (
              <div key={meal} className="bg-zinc-900 rounded-xl border border-zinc-800/60 overflow-hidden">
                {/* Meal header */}
                <div className="flex items-center justify-between px-4 py-3">
                  <button
                    onClick={() => toggleMeal(meal)}
                    className="flex items-center gap-3 flex-1 text-left"
                  >
                    <span className="text-xs text-zinc-600 w-14 font-mono flex-shrink-0">
                      {MEAL_TIMES[meal]}
                    </span>
                    <span className="text-sm font-bold text-zinc-200">{MEAL_LABELS[meal]}</span>
                    {logs.length > 0 && (
                      <span className="text-xs text-zinc-600">
                        {logs.length} món
                      </span>
                    )}
                  </button>
                  <div className="flex items-center gap-2">
                    {mealCal > 0 && (
                      <span className="text-sm font-bold text-orange-400">{Math.round(mealCal)} kcal</span>
                    )}
                    <button
                      onClick={() => openAddModal(meal)}
                      className="flex items-center gap-1 text-xs text-zinc-500 hover:text-green-400 transition-colors px-2 py-1 rounded-lg hover:bg-zinc-800"
                    >
                      <Plus className="w-3.5 h-3.5" /> Thêm
                    </button>
                    <button
                      onClick={() => toggleMeal(meal)}
                      className="text-zinc-600 hover:text-zinc-400 transition-colors"
                    >
                      {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Log table */}
                {expanded && (
                  <div className="border-t border-zinc-800/60">
                    {logs.length === 0 ? (
                      <div className="px-4 py-4 text-center text-xs text-zinc-600">
                        Chưa có món nào cho {MEAL_LABELS[meal].toLowerCase()}
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[480px] text-xs">
                          <thead>
                            <tr className="text-zinc-600 bg-zinc-800/30 text-left uppercase tracking-wider">
                              <th className="px-4 py-2 font-semibold">Món ăn</th>
                              <th className="px-4 py-2 font-semibold">Lượng</th>
                              <th className="px-4 py-2 font-semibold">Kcal</th>
                              <th className="px-4 py-2 font-semibold">P</th>
                              <th className="px-4 py-2 font-semibold">C</th>
                              <th className="px-4 py-2 font-semibold">F</th>
                              <th className="px-4 py-2 w-16" />
                            </tr>
                          </thead>
                          <tbody>
                            {logs.map((log) => (
                              <tr
                                key={log.id}
                                className="border-t border-zinc-800/40 hover:bg-zinc-800/30 transition-colors group"
                              >
                                <td className="px-4 py-2.5 font-semibold text-zinc-200 max-w-[180px] truncate">
                                  {log.foodName}
                                </td>
                                <td className="px-4 py-2.5 text-zinc-500">
                                  {log.quantity != null ? `${log.quantity}g` : "—"}
                                </td>
                                <td className="px-4 py-2.5 text-orange-400 font-semibold">{log.calories}</td>
                                <td className="px-4 py-2.5 text-green-400">
                                  {log.protein != null ? `${log.protein}g` : "—"}
                                </td>
                                <td className="px-4 py-2.5 text-blue-400">
                                  {log.carbs != null ? `${log.carbs}g` : "—"}
                                </td>
                                <td className="px-4 py-2.5 text-amber-400">
                                  {log.fat != null ? `${log.fat}g` : "—"}
                                </td>
                                <td className="px-4 py-2.5">
                                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button
                                      onClick={() => setEditingLog(log)}
                                      className="p-1 text-zinc-500 hover:text-blue-400 transition-colors rounded"
                                      title="Sửa"
                                    >
                                      <Pencil className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                      onClick={() => setDeletingId(log.id)}
                                      className="p-1 text-zinc-500 hover:text-red-400 transition-colors rounded"
                                      title="Xóa"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Right panel */}
        <div className="space-y-4">
          {/* Macro pie chart */}
          <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800/60">
            <h4 className="text-sm font-bold text-zinc-200 mb-0.5">Cơ cấu macro</h4>
            <p className="text-xs text-zinc-500 mb-3">Phân bổ calories hôm nay</p>
            {pieTotal === 0 ? (
              <div className="h-[140px] flex items-center justify-center text-xs text-zinc-600">
                Chưa có dữ liệu
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={140}>
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={38}
                    outerRadius={58}
                    dataKey="value"
                    paddingAngle={2}
                  >
                    {pieData.map((entry, i) => (
                      <Cell key={entry.name} fill={COLORS[i]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      fontSize: 11,
                      borderRadius: 8,
                      border: "1px solid #27272a",
                      backgroundColor: "#111",
                      color: "#f4f4f5",
                    }}
                    formatter={(v: number) => [`${v} kcal`]}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
            <div className="space-y-1.5 mt-1">
              {[
                { name: "Protein", value: Math.round(totals.protein * 4), color: COLORS[0] },
                { name: "Carbs", value: Math.round(totals.carbs * 4), color: COLORS[1] },
                { name: "Fat", value: Math.round(totals.fat * 9), color: COLORS[2] },
              ].map((d) => (
                <div key={d.name} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: d.color }} />
                    <span className="text-zinc-500">{d.name}</span>
                  </div>
                  <span className="font-semibold text-zinc-300">{d.value} kcal</span>
                </div>
              ))}
            </div>
          </div>

          {/* Weekly calories chart */}
          <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800/60">
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp className="w-4 h-4 text-green-400" />
              <h4 className="text-sm font-bold text-zinc-200">7 ngày gần nhất</h4>
            </div>
            <ResponsiveContainer width="100%" height={120}>
              <BarChart data={weeklyHistory} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis
                  dataKey="day"
                  tick={{ fontSize: 10, fill: "#71717a" }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  contentStyle={{
                    fontSize: 11,
                    borderRadius: 8,
                    border: "1px solid #27272a",
                    backgroundColor: "#111",
                    color: "#f4f4f5",
                  }}
                  formatter={(v: number) => [`${v} kcal`]}
                />
                <Bar dataKey="calories" fill="#f97316" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
            <div className="text-xs text-center text-zinc-600 mt-1">
              Mục tiêu: {goal?.calories ?? 2000} kcal/ngày
            </div>
          </div>
        </div>
      </div>

      {/* ════════════════════════════════════════════════════════════════════
          ADD FOOD MODAL
      ════════════════════════════════════════════════════════════════════ */}
      {showAddModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={(e) => { if (e.target === e.currentTarget) closeAddModal(); }}
        >
          <div className="bg-zinc-900 border border-zinc-700/60 rounded-2xl w-full max-w-md shadow-2xl flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between p-5 border-b border-zinc-800/60">
              <h3 className="text-zinc-100 font-bold">Thêm món ăn</h3>
              <button onClick={closeAddModal} className="text-zinc-500 hover:text-zinc-300 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4 overflow-y-auto flex-1">
              {/* Meal type selector */}
              <div>
                <p className="text-xs text-zinc-500 uppercase tracking-wider mb-2 font-semibold">Bữa ăn</p>
                <div className="grid grid-cols-4 gap-2">
                  {MEAL_TYPES.map((m) => (
                    <button
                      key={m}
                      onClick={() => setAddMealType(m)}
                      className={`py-1.5 rounded-lg border text-xs font-semibold transition-all ${
                        addMealType === m
                          ? "bg-green-500/15 border-green-500/40 text-green-400"
                          : "bg-zinc-800 border-zinc-700/50 text-zinc-500 hover:border-zinc-600"
                      }`}
                    >
                      {MEAL_LABELS[m]}
                    </button>
                  ))}
                </div>
              </div>

              {/* Search */}
              <div>
                <p className="text-xs text-zinc-500 uppercase tracking-wider mb-2 font-semibold">Tìm thực phẩm</p>
                <div className="flex items-center gap-2 bg-zinc-800 border border-zinc-700/60 rounded-xl px-3 py-2.5">
                  <Search className="w-4 h-4 text-zinc-500 flex-shrink-0" />
                  <input
                    autoFocus
                    value={foodQuery}
                    onChange={(e) => handleFoodQueryChange(e.target.value)}
                    placeholder="VD: gà, cơm, trứng…"
                    className="flex-1 text-sm outline-none bg-transparent text-zinc-300 placeholder-zinc-600"
                  />
                  {searchingFood && <Loader2 className="w-4 h-4 text-zinc-500 animate-spin flex-shrink-0" />}
                </div>

                {/* Search state messages */}
                {!selectedFood && (
                  <>
                    {foodQuery.length === 0 && (
                      <p className="text-xs text-zinc-600 mt-2 text-center">Nhập tên thực phẩm để tìm kiếm</p>
                    )}
                    {foodQuery.length === 1 && (
                      <p className="text-xs text-zinc-600 mt-2 text-center">Nhập ít nhất 2 ký tự để tìm kiếm</p>
                    )}
                    {translation.translated && debouncedQuery.length >= 2 && (
                      <div className="mt-1.5 space-y-0.5">
                        <p className="text-xs text-zinc-500">
                          Đang tìm: <span className="text-zinc-300 font-medium">{translation.searchQuery}</span>
                        </p>
                        <p className="text-xs text-zinc-600">
                          Đây là kết quả gần đúng từ dữ liệu USDA — chọn món giống nhất với món bạn đã ăn.
                        </p>
                      </div>
                    )}
                    {debouncedQuery.length >= 2 && !searchingFood && foodResults.length === 0 && (
                      <p className="text-xs text-zinc-600 mt-2 text-center">
                        Không tìm thấy kết quả.{" "}
                        {!translation.translated
                          ? "Thử từ khóa tiếng Anh (VD: chicken breast, white rice)."
                          : "Thử lại với tên khác hoặc từ khóa tiếng Anh."}
                      </p>
                    )}
                    {foodResults.length > 0 && (
                      <div className="mt-2 bg-zinc-800/60 border border-zinc-700/40 rounded-xl overflow-hidden max-h-48 overflow-y-auto">
                        {foodResults.map((food) => (
                          <button
                            key={food.id}
                            onClick={() => setSelectedFood(food)}
                            className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-zinc-700/50 transition-colors text-left border-b border-zinc-700/30 last:border-0"
                          >
                            {food.imageUrl ? (
                              <img
                                src={food.imageUrl}
                                alt={food.name}
                                className="w-10 h-10 rounded-lg object-cover flex-shrink-0"
                              />
                            ) : (
                              <div className="w-10 h-10 rounded-lg bg-zinc-700 flex items-center justify-center flex-shrink-0">
                                <Utensils className="w-4 h-4 text-zinc-500" />
                              </div>
                            )}
                            <div className="min-w-0 flex-1">
                              <div className="text-sm text-zinc-200 font-medium truncate">{food.name}</div>
                              <div className="text-xs text-zinc-500">
                                P {food.protein}g · C {food.carbs}g · F {food.fats}g
                              </div>
                            </div>
                            <span className="text-xs font-bold text-orange-400 flex-shrink-0">
                              {food.calories} kcal
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Selected food + quantity */}
              {selectedFood && (
                <div className="bg-zinc-800/60 border border-green-500/20 rounded-xl p-4 space-y-3">
                  <div className="flex items-start gap-3">
                    {selectedFood.imageUrl ? (
                      <img
                        src={selectedFood.imageUrl}
                        alt={selectedFood.name}
                        className="w-14 h-14 rounded-xl object-cover flex-shrink-0"
                      />
                    ) : (
                      <div className="w-14 h-14 rounded-xl bg-zinc-700 flex items-center justify-center flex-shrink-0">
                        <Utensils className="w-5 h-5 text-zinc-500" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-zinc-200 truncate">{selectedFood.name}</p>
                      <p className="text-xs text-zinc-500">per 100g: {selectedFood.calories} kcal</p>
                    </div>
                    <button
                      onClick={() => setSelectedFood(null)}
                      className="text-zinc-600 hover:text-zinc-400 flex-shrink-0 transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <div>
                    <label className="text-xs text-zinc-500 mb-1.5 block font-semibold">
                      Khối lượng (grams)
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={5000}
                      value={addQty}
                      onChange={(e) => setAddQty(e.target.value)}
                      className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 outline-none focus:border-green-500/50"
                    />
                    <p className="text-[10px] text-zinc-600 mt-1">
                      Dinh dưỡng được tính theo 100g thực phẩm
                      {/* TODO: Future — support serving/unit when food dataset includes servingSize */}
                    </p>
                  </div>
                  {addPreview && (
                    <div className="grid grid-cols-4 gap-2 text-center text-xs">
                      {[
                        { label: "Kcal", val: addPreview.calories, color: "text-orange-400" },
                        { label: "Protein", val: addPreview.protein + "g", color: "text-green-400" },
                        { label: "Carbs", val: addPreview.carbs + "g", color: "text-blue-400" },
                        { label: "Fat", val: addPreview.fat + "g", color: "text-amber-400" },
                      ].map((m) => (
                        <div key={m.label} className="bg-zinc-900/60 rounded-lg py-2">
                          <div className={`font-bold ${m.color}`}>{m.val}</div>
                          <div className="text-zinc-600 text-[10px]">{m.label}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="p-5 border-t border-zinc-800/60 flex gap-3">
              <button
                onClick={closeAddModal}
                className="flex-1 py-2.5 border border-zinc-700/60 text-zinc-300 text-sm font-semibold rounded-lg hover:bg-zinc-800 transition-colors"
              >
                Hủy
              </button>
              <button
                onClick={handleAddFood}
                disabled={!selectedFood || createMutation.isPending}
                className="flex-1 py-2.5 bg-green-500 hover:bg-green-400 disabled:bg-zinc-700 disabled:text-zinc-500 text-black text-sm font-bold rounded-lg transition-all shadow-lg shadow-green-500/20 flex items-center justify-center gap-2"
              >
                {createMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Plus className="w-4 h-4" />
                )}
                {createMutation.isPending ? "Đang lưu…" : "Thêm vào nhật ký"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════
          EDIT LOG MODAL
      ════════════════════════════════════════════════════════════════════ */}
      {editingLog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setEditingLog(null); }}
        >
          <div className="bg-zinc-900 border border-zinc-700/60 rounded-2xl w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between p-5 border-b border-zinc-800/60">
              <h3 className="text-zinc-100 font-bold">Sửa nhật ký</h3>
              <button
                onClick={() => setEditingLog(null)}
                className="text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
              {/* Meal type */}
              <div>
                <p className="text-xs text-zinc-500 uppercase tracking-wider mb-2 font-semibold">Bữa ăn</p>
                <div className="grid grid-cols-4 gap-2">
                  {MEAL_TYPES.map((m) => (
                    <button
                      key={m}
                      onClick={() => setEditForm((f) => ({ ...f, mealType: m }))}
                      className={`py-1.5 rounded-lg border text-xs font-semibold transition-all ${
                        editForm.mealType === m
                          ? "bg-green-500/15 border-green-500/40 text-green-400"
                          : "bg-zinc-800 border-zinc-700/50 text-zinc-500 hover:border-zinc-600"
                      }`}
                    >
                      {MEAL_LABELS[m]}
                    </button>
                  ))}
                </div>
              </div>

              {/* Food name */}
              <div>
                <label className="text-xs text-zinc-500 uppercase tracking-wider mb-1.5 block font-semibold">
                  Tên thực phẩm
                </label>
                <input
                  value={editForm.foodName}
                  onChange={(e) => setEditForm((f) => ({ ...f, foodName: e.target.value }))}
                  className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 outline-none focus:border-green-500/50"
                />
              </div>

              {/* Quantity */}
              <div>
                <label className="text-xs text-zinc-500 uppercase tracking-wider mb-1.5 block font-semibold">
                  Khối lượng (g)
                </label>
                <input
                  type="number"
                  min={1}
                  max={5000}
                  value={editForm.quantity}
                  onChange={(e) => setEditForm((f) => ({ ...f, quantity: parseFloat(e.target.value) || 0 }))}
                  className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 outline-none focus:border-green-500/50"
                />
                <p className="text-[10px] text-zinc-600 mt-1">
                  Khi thay đổi khối lượng, vui lòng điều chỉnh macro thủ công bên dưới
                </p>
              </div>

              {/* Macros */}
              <div>
                <p className="text-xs text-zinc-500 uppercase tracking-wider mb-2 font-semibold">Dinh dưỡng</p>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { key: "calories", label: "Calories (kcal)", color: "text-orange-400" },
                    { key: "protein", label: "Protein (g)", color: "text-green-400" },
                    { key: "carbs", label: "Carbs (g)", color: "text-blue-400" },
                    { key: "fat", label: "Fat (g)", color: "text-amber-400" },
                  ].map(({ key, label, color }) => (
                    <div key={key}>
                      <label className={`text-xs ${color} mb-1.5 block font-semibold`}>{label}</label>
                      <input
                        type="number"
                        min={0}
                        step={key === "calories" ? 1 : 0.1}
                        value={editForm[key as keyof EditForm] as number}
                        onChange={(e) =>
                          setEditForm((f) => ({ ...f, [key]: parseFloat(e.target.value) || 0 }))
                        }
                        className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 outline-none focus:border-green-500/50"
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="text-xs text-zinc-500 uppercase tracking-wider mb-1.5 block font-semibold">
                  Ghi chú (tùy chọn)
                </label>
                <input
                  value={editForm.notes}
                  onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value }))}
                  placeholder="Ghi chú thêm…"
                  className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 outline-none focus:border-green-500/50 placeholder-zinc-600"
                />
              </div>
            </div>

            <div className="p-5 border-t border-zinc-800/60 flex gap-3">
              <button
                onClick={() => setEditingLog(null)}
                className="flex-1 py-2.5 border border-zinc-700/60 text-zinc-300 text-sm font-semibold rounded-lg hover:bg-zinc-800 transition-colors"
              >
                Hủy
              </button>
              <button
                onClick={handleUpdateLog}
                disabled={updateMutation.isPending}
                className="flex-1 py-2.5 bg-blue-500 hover:bg-blue-400 disabled:bg-zinc-700 disabled:text-zinc-500 text-white text-sm font-bold rounded-lg transition-all flex items-center justify-center gap-2"
              >
                {updateMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Pencil className="w-4 h-4" />
                )}
                {updateMutation.isPending ? "Đang lưu…" : "Lưu thay đổi"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════
          DELETE CONFIRM MODAL
      ════════════════════════════════════════════════════════════════════ */}
      {deletingId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setDeletingId(null); }}
        >
          <div className="bg-zinc-900 border border-zinc-700/60 rounded-2xl w-full max-w-sm shadow-2xl p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-red-500/15 flex items-center justify-center flex-shrink-0">
                <Trash2 className="w-5 h-5 text-red-400" />
              </div>
              <div>
                <h3 className="text-zinc-100 font-bold">Xóa log này?</h3>
                <p className="text-sm text-zinc-500 mt-0.5">Hành động này không thể hoàn tác.</p>
              </div>
            </div>
            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setDeletingId(null)}
                className="flex-1 py-2.5 border border-zinc-700/60 text-zinc-300 text-sm font-semibold rounded-lg hover:bg-zinc-800 transition-colors"
              >
                Hủy
              </button>
              <button
                onClick={() => deleteMutation.mutate(deletingId)}
                disabled={deleteMutation.isPending}
                className="flex-1 py-2.5 bg-red-500 hover:bg-red-400 disabled:bg-zinc-700 text-white text-sm font-bold rounded-lg transition-all flex items-center justify-center gap-2"
              >
                {deleteMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                {deleteMutation.isPending ? "Đang xóa…" : "Xóa"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════
          GOAL EDIT MODAL
      ════════════════════════════════════════════════════════════════════ */}
      {showGoalModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setShowGoalModal(false); }}
        >
          <div className="bg-zinc-900 border border-zinc-700/60 rounded-2xl w-full max-w-sm shadow-2xl">
            <div className="flex items-center justify-between p-5 border-b border-zinc-800/60">
              <h3 className="text-zinc-100 font-bold flex items-center gap-2">
                <Target className="w-4 h-4 text-green-400" /> Mục tiêu dinh dưỡng
              </h3>
              <button
                onClick={() => setShowGoalModal(false)}
                className="text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-3">
              {[
                { key: "calories", label: "Calories", unit: "kcal", color: "text-orange-400" },
                { key: "protein", label: "Protein", unit: "g", color: "text-green-400" },
                { key: "carbs", label: "Carbohydrate", unit: "g", color: "text-blue-400" },
                { key: "fat", label: "Fat", unit: "g", color: "text-amber-400" },
              ].map(({ key, label, unit, color }) => (
                <div key={key} className="flex items-center gap-3">
                  <label className={`text-sm font-semibold ${color} w-32 flex-shrink-0`}>
                    {label}
                  </label>
                  <div className="flex-1 relative">
                    <input
                      type="number"
                      min={1}
                      value={goalForm[key as keyof typeof goalForm]}
                      onChange={(e) =>
                        setGoalForm((f) => ({ ...f, [key]: parseFloat(e.target.value) || 0 }))
                      }
                      className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 outline-none focus:border-green-500/50 pr-10"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-zinc-500">
                      {unit}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            <div className="p-5 border-t border-zinc-800/60 flex gap-3">
              <button
                onClick={() => setShowGoalModal(false)}
                className="flex-1 py-2.5 border border-zinc-700/60 text-zinc-300 text-sm font-semibold rounded-lg hover:bg-zinc-800 transition-colors"
              >
                Hủy
              </button>
              <button
                onClick={handleSaveGoal}
                disabled={goalMutation.isPending}
                className="flex-1 py-2.5 bg-green-500 hover:bg-green-400 disabled:bg-zinc-700 disabled:text-zinc-500 text-black text-sm font-bold rounded-lg transition-all shadow-lg shadow-green-500/20 flex items-center justify-center gap-2"
              >
                {goalMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Target className="w-4 h-4" />}
                {goalMutation.isPending ? "Đang lưu…" : "Lưu mục tiêu"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
