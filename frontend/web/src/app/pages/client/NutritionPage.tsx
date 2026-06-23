import { useState, useEffect, useRef, useCallback } from "react";
import {
  Utensils, Plus, Search, TrendingUp, Loader2, X, ChevronLeft, ChevronRight,
  Pencil, Trash2, Target, AlertTriangle, CheckCircle2, Info,
  ChevronDown, ChevronUp, Check, SkipForward, Minus, CalendarDays, Zap,
  Calendar, Sparkles,
} from "lucide-react";
import {
  PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, Tooltip, CartesianGrid,
} from "recharts";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
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
  const navigate = useNavigate();

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
  const [prevEditingLog, setPrevEditingLog] = useState(editingLog);
  if (prevEditingLog !== editingLog) {
    setPrevEditingLog(editingLog);
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
  }

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

  // Partial meal modal (full redesign state)
  const [partialMeal, setPartialMeal] = useState<{
    mealId: string;
    mealName: string;
    plannedCal: number;
    plannedProtein: number;
    plannedCarbs: number;
    plannedFat: number;
  } | null>(null);
  const [partialMode, setPartialMode] = useState<'pct' | 'amount'>('pct');
  const [partialPct, setPartialPct] = useState("50");
  // Amount mode fields
  const [partialCal, setPartialCal] = useState("");
  const [partialPro, setPartialPro] = useState("");
  const [partialCarb, setPartialCarb] = useState("");
  const [partialFatAmt, setPartialFatAmt] = useState("");

  // Calendar state
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });

  // ── Data fetching ────────────────────────────────────────────────────────

  const { data: todayRaw, isLoading: loadingLogs } = useQuery({
    queryKey: ["nutrition-logs", dateStr],
    queryFn: () => nutritionService.getLogs(dateStr, dateStr),
  });

  // Daily nutrition task from active program
  // staleTime: 0 ensures we never serve stale plan data after actions like deactivate/stop
  const { data: dailyTask, isLoading: loadingTask, refetch: refetchDailyTask } = useQuery({
    queryKey: ["nutrition-daily-task", dateStr],
    queryFn: () => nutritionService.getDailyTask(dateStr),
    staleTime: 0,
  });

  // Monthly summary for calendar
  const calMonthStart = formatLocalDate(calendarMonth);
  const calMonthEnd   = formatLocalDate(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 0));
  const { data: monthlySummaryRaw, refetch: refetchMonthly } = useQuery({
    queryKey: ["nutrition-monthly-summary", calMonthStart],
    queryFn:  () => nutritionService.getMonthlySummary(calMonthStart, calMonthEnd),
  });
  const monthlySummary: Record<string, string> = {};
  for (const item of (monthlySummaryRaw ?? [])) {
    monthlySummary[item.date] = item.status;
  }

  const completeMealMutation = useMutation({
    mutationFn: ({ mealId, status, pct, overrideCalories, overrideProtein, overrideCarbs, overrideFat }: {
      mealId: string;
      status: 'COMPLETED' | 'PARTIAL' | 'SKIPPED' | 'PENDING';
      pct?: number;
      overrideCalories?: number;
      overrideProtein?: number;
      overrideCarbs?: number;
      overrideFat?: number;
    }) =>
      nutritionService.upsertMealCompletion(mealId, dateStr, status, { percentConsumed: pct, overrideCalories, overrideProtein, overrideCarbs, overrideFat }),
    onSuccess: () => {
      void refetchDailyTask();
      void refetchMonthly();
      void queryClient.invalidateQueries({ queryKey: ["nutrition-logs", dateStr] });
    },
    onError: () => toast.error('Không thể cập nhật trạng thái bữa ăn.'),
  });

  const undoMealMutation = useMutation({
    mutationFn: (mealId: string) => nutritionService.deleteMealCompletion(mealId, dateStr),
    onSuccess: () => { void refetchDailyTask(); void refetchMonthly(); void queryClient.invalidateQueries({ queryKey: ["nutrition-logs", dateStr] }); },
    onError: () => toast.error('Không thể hoàn tác.'),
  });

  const deletePlanMealMutation = useMutation({
    mutationFn: (mealId: string) => nutritionService.deletePlanMeal(mealId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["nutrition-daily-task", dateStr] });
      queryClient.invalidateQueries({ queryKey: ["nutrition-monthly-summary", calMonthStart] });
      toast.success('Đã xoá bữa ăn khỏi kế hoạch.');
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Không thể xoá bữa ăn.'),
  });

  const deactivateProgramMutation = useMutation({
    mutationFn: (programId: string) => nutritionService.deactivateNutritionProgram(programId),
    onSuccess: (result) => {
      // Remove from cache immediately so stale plan data never flashes in the UI
      queryClient.removeQueries({ queryKey: ['nutrition-daily-task'] });
      queryClient.removeQueries({ queryKey: ['nutrition-current-program'] });
      queryClient.removeQueries({ queryKey: ['nutrition-monthly-summary'] });
      // Then refetch to populate with fresh (null/empty) data
      void refetchDailyTask();
      void refetchMonthly();
      if (result.hadCompletedMeals) {
        toast.success('Đã dừng kế hoạch. Lịch sử bữa ăn đã hoàn thành được giữ lại.');
      } else {
        toast.success('Đã xoá toàn bộ kế hoạch dinh dưỡng.');
      }
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Không thể dừng kế hoạch.'),
  });

  // Confirm dialogs state
  const [confirmDeleteMeal, setConfirmDeleteMeal] = useState<{ mealId: string; mealName: string } | null>(null);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);

  // ── Manual edit state ─────────────────────────────────────────────────────
  // Inline quantity edit for a plan item
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editingQty, setEditingQty] = useState('');
  // Add-item modal
  const [addItemMealId, setAddItemMealId] = useState<string | null>(null);
  const [foodSearch, setFoodSearch] = useState('');
  const [foodResults, setFoodResults] = useState<any[]>([]);
  const [foodSearchLoading, setFoodSearchLoading] = useState(false);
  const [selectedFoodForAdd, setSelectedFoodForAdd] = useState<any | null>(null);
  const [addItemQty, setAddItemQty] = useState('100');

  // ── Manual edit mutations ─────────────────────────────────────────────────
  const updateItemMutation = useMutation({
    mutationFn: ({ itemId, quantity }: { itemId: string; quantity: number }) =>
      nutritionService.updateMealItem(itemId, { quantity }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["nutrition-daily-task", dateStr] }); setEditingItemId(null); toast.success('Đã cập nhật lượng.'); },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Không thể cập nhật.'),
  });

  const deleteItemMutation = useMutation({
    mutationFn: (itemId: string) => nutritionService.deleteMealItem(itemId),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["nutrition-daily-task", dateStr] }); toast.success('Đã xoá món.'); },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Không thể xoá món.'),
  });

  const addItemMutation = useMutation({
    mutationFn: ({ mealId, food, qty }: { mealId: string; food: any; qty: number }) => {
      const factor = qty / 100;
      return nutritionService.addMealItem(mealId, {
        foodId: food.id,
        quantity: qty,
        unit: 'g',
        calories: Math.round((food.calories ?? 0) * factor),
        protein: Math.round(((food.protein ?? 0) * factor) * 10) / 10,
        carbs: Math.round(((food.carbs ?? 0) * factor) * 10) / 10,
        fat: Math.round(((food.fats ?? food.fat ?? 0) * factor) * 10) / 10,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["nutrition-daily-task", dateStr] });
      setAddItemMealId(null);
      setSelectedFoodForAdd(null);
      setFoodSearch('');
      setFoodResults([]);
      toast.success('Đã thêm món vào kế hoạch.');
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Không thể thêm món.'),
  });

  // Food search handler (debounced)
  const handleFoodSearch = useCallback(async (q: string) => {
    setFoodSearch(q);
    if (q.trim().length < 2) { setFoodResults([]); return; }
    setFoodSearchLoading(true);
    try {
      const { foodService } = await import('../../services/api');
      const results = await foodService.search(q.trim());
      setFoodResults(Array.isArray(results) ? results.slice(0, 20) : []);
    } catch { setFoodResults([]); }
    finally { setFoodSearchLoading(false); }
  }, []);

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
  const { data: searchedFoods = [] as FoodItem[], isFetching: searchingFood } = useQuery({
    queryKey: ["food-search", translation.searchQuery],
    queryFn: () => foodService.search(translation.searchQuery),
    enabled: translation.searchQuery.trim().length >= 2,
  });

  // getCurrentProgram removed — plan data is already available via dailyTask (getDailyTask)
  // Using dailyTask.meals (planMeal) as the single source of truth for planned items

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


  // ── Derived data ─────────────────────────────────────────────────────────

  // mealGroups now contains ONLY actual NutritionLog entries.
  // Planned items are shown separately in the "Theo kế hoạch" section via planMeal (from dailyTask).
  // eslint-disable-next-line react-doctor/prefer-module-scope-static-value
  const mealGroups: Record<MealType, NutritionLog[]> = {
    breakfast: [],
    lunch: [],
    dinner: [],
    snack: [],
  };
  todayLogs.forEach((l) => {
    if (mealGroups[l.mealType]) mealGroups[l.mealType].push(l);
  });

  // Totals from logs are the fallback; completed plan meals take priority when available.
  const totals = { calories: 0, protein: 0, carbs: 0, fat: 0 };
  todayLogs.forEach(l => {
    totals.calories += l.calories || 0;
    totals.protein  += l.protein  || 0;
    totals.carbs    += l.carbs    || 0;
    totals.fat      += l.fat      || 0;
  });
  const hasDailyTaskItems = Array.isArray((dailyTask as any)?.meals)
    && (dailyTask as any).meals.some((meal: any) => Array.isArray(meal.items) && meal.items.length > 0);
  const hasVisibleMealItems = hasDailyTaskItems || todayLogs.length > 0;
  const actualNutrition = {
    calories: dailyTask?.actualProgress?.calories ?? totals.calories,
    protein: dailyTask?.actualProgress?.protein ?? totals.protein,
    carbs: dailyTask?.actualProgress?.carbs ?? totals.carbs,
    fat: dailyTask?.actualProgress?.fat ?? totals.fat,
  };

  const pieTotal = Math.round(actualNutrition.protein * 4) + Math.round(actualNutrition.carbs * 4) + Math.round(actualNutrition.fat * 9);
  const pieData = [
    { name: "Protein", value: Math.round(actualNutrition.protein * 4) },
    { name: "Carbs", value: Math.round(actualNutrition.carbs * 4) },
    { name: "Fat", value: Math.round(actualNutrition.fat * 9) },
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
  if (isToday && goal && todayLogs.length > 0) {
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
    queryClient.invalidateQueries({ queryKey: ["nutrition-daily-task"] });
    queryClient.invalidateQueries({ queryKey: ["nutrition-monthly-summary"] });
    queryClient.invalidateQueries({ queryKey: ["current-nutrition-program"] });
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

  function openDefaultAddModal() {
    const breakfastMeal = (dailyTask as any)?.meals?.find((meal: any) => meal.mealType === "BREAKFAST");
    if (breakfastMeal?.id) {
      setAddItemMealId(breakfastMeal.id);
      return;
    }
    openAddModal("breakfast");
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
            type="button"
            onClick={() => setShowGoalModal(true)}
            className="flex items-center gap-1.5 px-3 py-2 border border-zinc-700/60 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600 text-sm rounded-xl transition-colors"
          >
            <Target className="w-4 h-4" /> Mục tiêu
          </button>
          <button
            type="button"
            onClick={openDefaultAddModal}
            className="flex items-center gap-2 bg-green-500 hover:bg-green-400 text-black px-4 py-2 rounded-xl text-sm font-bold transition-all shadow-lg shadow-green-500/20"
          >
            <Plus className="w-4 h-4" /> Thêm món
          </button>
        </div>
      </div>

      {/* ── Nutrition Calendar ── */}
      <NutritionCalendarGrid
        month={calendarMonth}
        today={todayStr}
        selectedDate={dateStr}
        statusByDate={monthlySummary}
        onPrevMonth={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1))}
        onNextMonth={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1))}
        onDayClick={(dateString) => {
          const [y, m, d] = dateString.split('-').map(Number);
          setSelectedDate(new Date(y, m - 1, d));
        }}
        onAddClick={openDefaultAddModal}
      />

      {/* ── Date navigation (mini) ── */}
      <div className="flex items-center gap-3">
        <button
          type="button"
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
          type="button"
          onClick={nextDay}
          disabled={isToday}
          className="p-1.5 rounded-lg border border-zinc-700/60 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
        {!isToday && (
          <button
            type="button"
            onClick={() => setSelectedDate(new Date())}
            className="text-xs text-orange-400 hover:text-orange-300 transition-colors ml-1"
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
            type="button"
            onClick={() => setShowGoalModal(true)}
            className="text-green-400 hover:text-green-300 underline underline-offset-2"
          >
            bấm vào đây để thiết lập cá nhân hóa
          </button>
        </div>
      )}

      {/* ── Current Nutrition Program ── */}
      <div className="bg-zinc-900 border border-zinc-800/60 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h3 className="text-zinc-100 font-bold flex items-center gap-2 text-sm">
            <Sparkles className="w-4 h-4 text-orange-400" />
            Kế hoạch dinh dưỡng AI
          </h3>
          <p className="text-xs text-zinc-500 mt-1">
            Tạo và quản lý AI Nutrition Plan tại trang AI Plans. Trang này chỉ hiển thị kế hoạch đã lưu.
          </p>
        </div>
        <button
          type="button"
          onClick={() => navigate('/client/plans?tab=nutrition')}
          className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-orange-500 hover:bg-orange-400 text-black text-sm font-bold transition-colors"
        >
          <Sparkles className="w-4 h-4" />
          Tạo kế hoạch mới
        </button>
      </div>

      {/* ── Out-of-range banner: date is outside the 7-day plan ── */}
      {!loadingTask && dailyTask?.hasProgram && (dailyTask as any).outOfRange && (
        <div className="flex items-start gap-3 bg-zinc-800/60 border border-zinc-700/40 rounded-xl px-4 py-3">
          <Info className="w-4 h-4 text-zinc-400 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm text-zinc-300">{(dailyTask as any).message}</p>
            <p className="text-xs text-zinc-500 mt-0.5">
              Kế hoạch: <strong className="text-zinc-300">{dailyTask.program?.name}</strong>
            </p>
          </div>
          <button
            type="button"
            onClick={() => setSelectedDate(new Date())}
            className="text-xs text-orange-400 hover:text-orange-300 shrink-0 transition-colors"
          >
            Về hôm nay
          </button>
        </div>
      )}

      {/* ── Compact program summary (only when plan active for selected date) ── */}
      {!loadingTask && dailyTask?.hasProgram && dailyTask.day && !(dailyTask as any).outOfRange && (
        <div className="bg-zinc-900 border border-zinc-800/60 rounded-xl p-4">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div className="flex items-center gap-2 flex-wrap">
              <CalendarDays className="w-4 h-4 text-orange-400 shrink-0" />
              <span className="text-sm font-bold text-zinc-200">
                {dailyTask.program?.name ?? 'Kế hoạch dinh dưỡng'}
              </span>
              <span className="text-xs text-zinc-500 px-2 py-0.5 bg-zinc-800/80 rounded-full border border-zinc-700/50">
                Ngày {dailyTask.day.dayNumber}
              </span>
            </div>
            {/* Deactivate program button */}
            {dailyTask.program?.id && (
              <button
                type="button"
                onClick={() => setConfirmDeactivate(true)}
                className="text-[10px] text-red-400/70 hover:text-red-400 border border-red-500/20 hover:border-red-500/40 px-2 py-1 rounded-lg transition-colors shrink-0"
              >
                Dừng kế hoạch
              </button>
            )}
          </div>
          {/* Progress bar */}
          {dailyTask.actualProgress && (
            <>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-zinc-500">Tiến độ hôm nay</span>
                <span className="text-zinc-400 font-semibold">
                  {dailyTask.actualProgress.calories} / {dailyTask.program?.dailyCaloriesTarget ?? dailyTask.day.totalCalories ?? 0} kcal
                </span>
              </div>
              <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-orange-500 to-amber-400 rounded-full transition-all duration-500"
                  style={{ width: `${pct(dailyTask.actualProgress.calories, dailyTask.program?.dailyCaloriesTarget ?? dailyTask.day.totalCalories ?? 2000)}%` }}
                />
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Confirm: Delete plan meal ── */}
      {confirmDeleteMeal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="bg-zinc-900 border border-zinc-700/50 rounded-2xl w-full max-w-sm shadow-2xl p-5 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center shrink-0">
                <Trash2 className="w-5 h-5 text-red-400" />
              </div>
              <div>
                <h3 className="text-zinc-100 font-bold">Xoá bữa ăn?</h3>
                <p className="text-zinc-500 text-sm mt-1">
                  Xoá <strong className="text-zinc-300">{confirmDeleteMeal.mealName}</strong> khỏi kế hoạch dinh dưỡng hôm nay. Các bữa đã hoàn thành/đã ăn một phần không thể xoá.
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => setConfirmDeleteMeal(null)} className="flex-1 py-2.5 border border-zinc-700/60 text-zinc-300 text-sm rounded-xl hover:bg-zinc-800 transition-colors">Hủy</button>
              <button
                type="button"
                onClick={() => { deletePlanMealMutation.mutate(confirmDeleteMeal.mealId); setConfirmDeleteMeal(null); }}
                disabled={deletePlanMealMutation.isPending}
                className="flex-1 py-2.5 bg-red-500 hover:bg-red-400 text-white text-sm font-bold rounded-xl transition-colors disabled:opacity-50"
              >
                Xoá bữa
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Confirm: Deactivate nutrition program ── */}
      {confirmDeactivate && dailyTask?.program?.id && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="bg-zinc-900 border border-zinc-700/50 rounded-2xl w-full max-w-sm shadow-2xl p-5 space-y-4">
            <div>
              <h3 className="text-zinc-100 font-bold mb-1">Dừng kế hoạch dinh dưỡng?</h3>
              {/* Check if any completed meals exist */}
              {(() => {
                const hasAnyCompleted = (dailyTask.meals as any[]).some(
                  m => m.completion?.status === 'COMPLETED' || m.completion?.status === 'PARTIAL'
                );
                return hasAnyCompleted ? (
                  <div className="space-y-2">
                    <div className="flex items-start gap-2 bg-amber-500/10 border border-amber-500/20 rounded-xl p-3">
                      <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                      <p className="text-amber-300 text-xs">
                        Kế hoạch này đã có bữa ăn được hoàn thành. Không thể xoá hoàn toàn. Hệ thống sẽ <strong>dừng áp dụng</strong> và lưu lại lịch sử bữa đã thực hiện.
                      </p>
                    </div>
                    <p className="text-zinc-500 text-xs">Những bữa chưa thực hiện sẽ bị huỷ. Lịch sử ăn uống của bạn vẫn được giữ nguyên.</p>
                  </div>
                ) : (
                  <p className="text-zinc-500 text-sm">Toàn bộ kế hoạch dinh dưỡng sẽ bị xoá. Hành động này không thể hoàn tác.</p>
                );
              })()}
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => setConfirmDeactivate(false)} className="flex-1 py-2.5 border border-zinc-700/60 text-zinc-300 text-sm rounded-xl hover:bg-zinc-800 transition-colors">Hủy</button>
              <button
                type="button"
                onClick={() => { deactivateProgramMutation.mutate(dailyTask.program!.id); setConfirmDeactivate(false); }}
                disabled={deactivateProgramMutation.isPending}
                className="flex-1 py-2.5 bg-red-500 hover:bg-red-400 text-white text-sm font-bold rounded-xl transition-colors disabled:opacity-50"
              >
                {deactivateProgramMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : 'Xác nhận dừng'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Add Item to Meal Modal ── */}
      {addItemMealId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="bg-zinc-900 border border-zinc-700/50 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800/60">
              <h3 className="text-zinc-100 font-bold text-sm">Thêm món vào bữa</h3>
              <button type="button" onClick={() => { setAddItemMealId(null); setSelectedFoodForAdd(null); setFoodSearch(''); setFoodResults([]); }}
                className="text-zinc-500 hover:text-zinc-300"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-4 space-y-3">
              {/* Food search */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                <input
                  type="text"
                  aria-label="Tìm món ăn"
                  placeholder="Tìm món ăn (e.g. chicken breast)..."
                  value={foodSearch}
                  onChange={e => handleFoodSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-2.5 bg-zinc-800 border border-zinc-700/60 rounded-xl text-sm text-zinc-200 outline-none focus:border-orange-500/50"
                />
              </div>

              {/* Food results */}
              {foodSearchLoading && <div className="flex justify-center py-3"><Loader2 className="w-5 h-5 animate-spin text-orange-400" /></div>}
              {!foodSearchLoading && foodResults.length > 0 && !selectedFoodForAdd && (
                <div className="max-h-48 overflow-y-auto space-y-1 border border-zinc-800/60 rounded-xl p-1">
                  {foodResults.map(food => (
                    <button type="button" key={food.id} onClick={() => setSelectedFoodForAdd(food)}
                      className="w-full flex items-center justify-between px-3 py-2 rounded-lg hover:bg-zinc-800 transition-colors text-left">
                      <span className="text-sm text-zinc-200 truncate">{food.name}</span>
                      <span className="text-xs text-zinc-500 shrink-0 ml-2">{food.calories}kcal/100g</span>
                    </button>
                  ))}
                </div>
              )}

              {/* Selected food + quantity */}
              {selectedFoodForAdd && (
                <div className="bg-zinc-800/50 border border-zinc-700/40 rounded-xl p-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-zinc-200">{selectedFoodForAdd.name}</span>
                    <button type="button" onClick={() => setSelectedFoodForAdd(null)} className="text-zinc-600 hover:text-zinc-400"><X className="w-4 h-4" /></button>
                  </div>
                  <div className="text-xs text-zinc-500">Per 100g: {selectedFoodForAdd.calories}kcal · P{selectedFoodForAdd.protein}g · C{selectedFoodForAdd.carbs}g · F{selectedFoodForAdd.fats ?? selectedFoodForAdd.fat ?? 0}g</div>
                  <div className="flex items-center gap-3">
                    <label htmlFor="np-add-item-qty" className="text-xs text-zinc-500 shrink-0">Lượng (g):</label>
                    <input id="np-add-item-qty" type="number" min="1" value={addItemQty}
                      onChange={e => setAddItemQty(e.target.value)}
                      className="w-24 px-2.5 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-zinc-200 outline-none focus:border-orange-500/50" />
                    <span className="text-xs text-zinc-400">
                      = {Math.round((selectedFoodForAdd.calories ?? 0) * Number(addItemQty) / 100)} kcal
                    </span>
                  </div>
                </div>
              )}
            </div>
            <div className="px-4 pb-4 flex gap-2">
              <button type="button" onClick={() => { setAddItemMealId(null); setSelectedFoodForAdd(null); setFoodSearch(''); setFoodResults([]); }}
                className="flex-1 py-2.5 border border-zinc-700/60 text-zinc-300 text-sm rounded-xl hover:bg-zinc-800 transition-colors">Hủy</button>
              <button
                type="button"
                onClick={() => { if (selectedFoodForAdd && addItemMealId) addItemMutation.mutate({ mealId: addItemMealId, food: selectedFoodForAdd, qty: Number(addItemQty) || 100 }); }}
                disabled={!selectedFoodForAdd || addItemMutation.isPending}
                className="flex-1 py-2.5 bg-orange-500 hover:bg-orange-400 text-black text-sm font-bold rounded-xl disabled:opacity-40 transition-colors"
              >
                {addItemMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : 'Thêm vào kế hoạch'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Partial Meal Modal (redesigned) ── */}
      {partialMeal && (() => {
        const pctNum   = Math.max(1, parseFloat(partialPct) || 50);
        const calInput = parseFloat(partialCal) || 0;
        const proInput = parseFloat(partialPro)  || 0;
        const crbInput = parseFloat(partialCarb) || 0;
        const fatInput = parseFloat(partialFatAmt) || 0;

        // Preview for pct mode
        const prevCalPct  = Math.round(partialMeal.plannedCal     * pctNum / 100);
        const prevProPct  = +(partialMeal.plannedProtein           * pctNum / 100).toFixed(1);
        const prevCrbPct  = +(partialMeal.plannedCarbs             * pctNum / 100).toFixed(1);
        const prevFatPct  = +(partialMeal.plannedFat               * pctNum / 100).toFixed(1);

        // Auto-compute pct equivalent for amount mode display
        const pctEquiv = partialMeal.plannedCal > 0
          ? Math.round((calInput / partialMeal.plannedCal) * 100)
          : 0;

        const isOverPlan  = pctNum > 100;
        const isExactPlan = pctNum === 100;

        const handleConfirm = () => {
          if (partialMode === 'pct') {
            const status = isExactPlan ? 'COMPLETED' : 'PARTIAL';
            completeMealMutation.mutate({ mealId: partialMeal.mealId, status, pct: pctNum });
          } else {
            if (!calInput) return;
            const status = pctEquiv >= 100 ? 'COMPLETED' : 'PARTIAL';
            completeMealMutation.mutate({
              mealId: partialMeal.mealId, status,
              pct: pctEquiv,
              overrideCalories: calInput,
              overrideProtein:  proInput || undefined,
              overrideCarbs:    crbInput || undefined,
              overrideFat:      fatInput || undefined,
            });
          }
          setPartialMeal(null);
        };

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
            <div className="bg-zinc-900 border border-zinc-700/50 rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden">

              {/* Header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800/60">
                <div>
                  <h3 className="text-zinc-100 font-bold text-sm">Ghi nhận lượng thực ăn</h3>
                  <p className="text-xs text-zinc-500 mt-0.5">{partialMeal.mealName} · {partialMeal.plannedCal} kcal theo kế hoạch</p>
                </div>
                <button type="button" onClick={() => setPartialMeal(null)} className="text-zinc-500 hover:text-zinc-300 transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Mode tabs */}
              <div className="flex gap-1 p-3 bg-zinc-950/50">
                {([
                  { key: 'pct',    label: 'Theo phần trăm (%)' },
                  { key: 'amount', label: 'Nhập lượng thực ăn' },
                ] as const).map(tab => (
                  <button
                    type="button"
                    key={tab.key}
                    onClick={() => setPartialMode(tab.key)}
                    className={`flex-1 py-2 rounded-xl text-xs font-semibold transition-all ${
                      partialMode === tab.key
                        ? 'bg-amber-500 text-black shadow-sm'
                        : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              <div className="px-5 pb-5 space-y-4">

                {/* ── PCT MODE ── */}
                {partialMode === 'pct' && (
                  <div className="space-y-3">
                    <div>
                      <label htmlFor="np-partial-pct" className="text-xs text-zinc-500 font-semibold mb-1.5 flex items-center justify-between">
                        <span>Phần đã ăn (%)</span>
                        {isOverPlan && <span className="text-amber-400 text-[10px]">⚠ Ăn nhiều hơn kế hoạch</span>}
                        {isExactPlan && <span className="text-green-400 text-[10px]">✓ Đúng kế hoạch</span>}
                      </label>
                      <input
                        id="np-partial-pct"
                        type="number" min="1" max="500"
                        value={partialPct}
                        onChange={e => setPartialPct(e.target.value)}
                        className="w-full px-3 py-2.5 bg-zinc-800 border border-zinc-700/60 rounded-xl text-zinc-100 text-sm outline-none focus:border-amber-500/60 focus:ring-1 focus:ring-amber-500/20 transition-all"
                        placeholder="VD: 50, 75, 120..."
                      />
                    </div>

                    {/* Quick presets */}
                    <div className="grid grid-cols-5 gap-1.5">
                      {[25, 50, 75, 100, 125].map(p => (
                        <button
                          type="button"
                          key={p}
                          onClick={() => setPartialPct(String(p))}
                          className={`py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                            parseInt(partialPct) === p
                              ? 'bg-amber-500 border-amber-500 text-black'
                              : p > 100
                              ? 'border-orange-500/30 text-orange-400 hover:bg-orange-500/10'
                              : p === 100
                              ? 'border-green-500/30 text-green-400 hover:bg-green-500/10'
                              : 'border-zinc-700/50 text-zinc-400 hover:bg-zinc-800'
                          }`}
                        >
                          {p}%
                        </button>
                      ))}
                    </div>

                    {/* Preview */}
                    <div className="bg-zinc-800/50 rounded-xl p-3 grid grid-cols-4 gap-2 text-center text-xs">
                      {[
                        { label: 'Kcal',    val: prevCalPct, color: 'text-orange-400' },
                        { label: 'Protein', val: `${prevProPct}g`, color: 'text-green-400' },
                        { label: 'Carbs',   val: `${prevCrbPct}g`, color: 'text-blue-400' },
                        { label: 'Fat',     val: `${prevFatPct}g`, color: 'text-amber-400' },
                      ].map(m => (
                        <div key={m.label}>
                          <div className={`font-bold ${m.color}`}>{m.val}</div>
                          <div className="text-zinc-600">{m.label}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* ── AMOUNT MODE ── */}
                {partialMode === 'amount' && (
                  <div className="space-y-3">
                    <p className="text-xs text-zinc-500">
                      Nhập calories thực tế đã ăn. Hữu ích khi ăn thêm hoặc ăn món khác ngoài kế hoạch.
                    </p>

                    {/* Calories — primary */}
                    <div>
                      <label htmlFor="np-partial-cal" className="text-xs text-zinc-500 font-semibold mb-1.5 flex items-center justify-between">
                        <span>Calories thực tế (kcal) <span className="text-red-400">*</span></span>
                        {calInput > 0 && (
                          <span className={`text-[10px] font-bold ${pctEquiv > 100 ? 'text-orange-400' : pctEquiv === 100 ? 'text-green-400' : 'text-amber-400'}`}>
                            ≈ {pctEquiv}% kế hoạch
                          </span>
                        )}
                      </label>
                      <input
                        id="np-partial-cal"
                        type="number" min="0"
                        value={partialCal}
                        onChange={e => setPartialCal(e.target.value)}
                        className="w-full px-3 py-2.5 bg-zinc-800 border border-zinc-700/60 rounded-xl text-zinc-100 text-sm outline-none focus:border-amber-500/60 focus:ring-1 focus:ring-amber-500/20 transition-all"
                        placeholder={`Kế hoạch: ${partialMeal.plannedCal} kcal`}
                      />
                    </div>

                    {/* Macros — optional */}
                    <div>
                      <p className="text-xs text-zinc-500 font-semibold mb-1.5">Macros chi tiết (tùy chọn, đơn vị: g)</p>
                      <div className="grid grid-cols-3 gap-2">
                        {[
                          { label: 'Protein', id: 'np-partial-pro',  val: partialPro,    set: setPartialPro,    ph: String(partialMeal.plannedProtein.toFixed(0)), color: 'focus:border-green-500/60' },
                          { label: 'Carbs',   id: 'np-partial-carb', val: partialCarb,   set: setPartialCarb,   ph: String(partialMeal.plannedCarbs.toFixed(0)),   color: 'focus:border-blue-500/60' },
                          { label: 'Fat',     id: 'np-partial-fat',  val: partialFatAmt, set: setPartialFatAmt, ph: String(partialMeal.plannedFat.toFixed(0)),     color: 'focus:border-amber-500/60' },
                        ].map(f => (
                          <div key={f.label}>
                            <label htmlFor={f.id} className="text-[10px] text-zinc-600 mb-1 block">{f.label}</label>
                            <input
                              id={f.id}
                              type="number" min="0"
                              value={f.val}
                              aria-label={f.label}
                              onChange={e => f.set(e.target.value)}
                              className={`w-full px-2.5 py-2 bg-zinc-800 border border-zinc-700/60 rounded-lg text-zinc-100 text-xs outline-none ${f.color} transition-all`}
                              placeholder={`~${f.ph}g`}
                            />
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Hint line */}
                    <div className="flex items-center gap-1.5 text-[10px] text-zinc-600">
                      <Info className="w-3 h-3 shrink-0" />
                      Nếu ăn thêm ngoài kế hoạch, nhập tổng cả phần đã ăn. VD: kế hoạch 400 kcal + ăn thêm 200 kcal → nhập 600.
                    </div>
                  </div>
                )}

                {/* Confirm/Cancel */}
                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setPartialMeal(null)}
                    className="flex-1 py-2.5 border border-zinc-700/60 text-zinc-300 text-sm font-semibold rounded-xl hover:bg-zinc-800 transition-colors"
                  >
                    Hủy
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirm}
                    disabled={completeMealMutation.isPending || (partialMode === 'amount' && !calInput)}
                    className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-400 text-black text-sm font-bold rounded-xl transition-all shadow-sm shadow-amber-500/20 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {completeMealMutation.isPending
                      ? <Loader2 className="w-4 h-4 animate-spin mx-auto" />
                      : isExactPlan && partialMode === 'pct' ? 'Hoàn thành' : 'Xác nhận'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Macro summary cards ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: "Calories", consumed: Math.round(dailyTask?.actualProgress?.calories ?? totals.calories), target: dailyTask?.program?.dailyCaloriesTarget ?? goal?.calories ?? 2000, unit: "kcal", color: "#f97316", textColor: "text-orange-400" },
          { label: "Protein", consumed: +(dailyTask?.actualProgress?.protein ?? totals.protein).toFixed(1), target: dailyTask?.program?.proteinTargetGrams ?? goal?.protein ?? 150, unit: "g", color: "#22c55e", textColor: "text-green-400" },
          { label: "Carbs", consumed: +(dailyTask?.actualProgress?.carbs ?? totals.carbs).toFixed(1), target: dailyTask?.program?.carbTargetGrams ?? goal?.carbs ?? 200, unit: "g", color: "#60a5fa", textColor: "text-blue-400" },
          { label: "Fat", consumed: +(dailyTask?.actualProgress?.fat ?? totals.fat).toFixed(1), target: dailyTask?.program?.fatTargetGrams ?? goal?.fat ?? 65, unit: "g", color: "#f59e0b", textColor: "text-amber-400" },
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
          {feedback.map((f) => (
            <div
              key={f.text}
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
          {!hasVisibleMealItems && isToday && (
            <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-12 text-center">
              <Utensils className="w-12 h-12 text-zinc-800 mx-auto mb-3" />
              <p className="text-zinc-500 text-sm">Bạn chưa log món nào cho ngày này</p>
              <button
                type="button"
                onClick={openDefaultAddModal}
                className="mt-4 flex items-center gap-1.5 mx-auto text-green-400 hover:text-green-300 text-sm font-semibold transition-colors"
              >
                <Plus className="w-4 h-4" /> Thêm món đầu tiên
              </button>
            </div>
          )}

          {MEAL_TYPES.map((meal) => {
            const expanded = expandedMeals.has(meal);

            // ── Plan meal integration ──
            // Don't show plan meals when date is out of plan range or plan not active
            const planIsActiveForDate = dailyTask?.hasProgram && !!(dailyTask as any).day && !(dailyTask as any).outOfRange;
            const PLAN_MEAL_TYPE: Record<MealType, string> = {
              breakfast: 'BREAKFAST', lunch: 'LUNCH', dinner: 'DINNER', snack: 'SNACK',
            };
            const planMeal = planIsActiveForDate
              ? (dailyTask.meals as any[]).find(m => m.mealType?.toUpperCase() === PLAN_MEAL_TYPE[meal])
              : null;
            const logs = mealGroups[meal];
            const logItems = logs.map((log) => ({
              ...log,
              sourceType: 'LOG_ITEM',
              logItemId: log.id,
              foodName: log.foodName,
              customFoodName: log.foodName,
              proteinGrams: log.protein ?? 0,
              carbGrams: log.carbs ?? 0,
              fatGrams: log.fat ?? 0,
            }));
            const tableItems = (planMeal?.items && Array.isArray(planMeal.items) ? planMeal.items : logItems) as any[];
            const mealCal = tableItems.reduce((s, item) => s + Number(item.calories ?? 0), 0);
            const mealProtein = tableItems.reduce((s, item) => s + Number(item.proteinGrams ?? item.protein ?? 0), 0);
            const mealCarbs = tableItems.reduce((s, item) => s + Number(item.carbGrams ?? item.carbs ?? 0), 0);
            const mealFat = tableItems.reduce((s, item) => s + Number(item.fatGrams ?? item.fat ?? item.fats ?? 0), 0);
            const completion = planMeal?.completion ?? null;
            const mealStatus: string = completion?.status ?? 'PENDING';
            const isCompleted = mealStatus === 'COMPLETED';
            const isPartial   = mealStatus === 'PARTIAL';
            const isSkipped   = mealStatus === 'SKIPPED';
            const isPending   = mealStatus === 'PENDING';
            // Rules: COMPLETED/PARTIAL → cannot delete (has real data). PENDING/SKIPPED → can delete.
            const canDeletePlanMeal = planMeal && !isCompleted && !isPartial;

            const MEAL_VI: Record<MealType, string> = {
              breakfast: 'Bữa sáng', lunch: 'Bữa trưa', dinner: 'Bữa tối', snack: 'Bữa phụ',
            };

            return (
              <div key={meal} className={`bg-zinc-900 rounded-xl border overflow-hidden transition-all ${
                isCompleted ? 'border-green-500/30 bg-green-500/[0.02]' :
                isPartial   ? 'border-amber-500/30 bg-amber-500/[0.02]' :
                isSkipped   ? 'border-zinc-700/30 opacity-70' :
                'border-zinc-800/60'
              }`}>
                {/* Meal header */}
                <div className="flex items-center justify-between px-4 py-3 gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() => toggleMeal(meal)}
                    className="flex items-center gap-2 flex-1 text-left min-w-0"
                  >
                    <span className="text-xs text-zinc-600 w-12 font-mono flex-shrink-0">{MEAL_TIMES[meal]}</span>
                    <span className="text-sm font-bold text-zinc-200">{MEAL_LABELS[meal]}</span>
                    {/* Status badge */}
                    {isCompleted && <span className="text-[10px] px-1.5 py-0.5 bg-green-500/15 text-green-400 border border-green-500/25 rounded-full shrink-0">✓ Hoàn thành</span>}
                    {isPartial   && <span className="text-[10px] px-1.5 py-0.5 bg-amber-500/15 text-amber-400 border border-amber-500/25 rounded-full shrink-0">½ {completion.percentConsumed}%</span>}
                    {isSkipped   && <span className="text-[10px] px-1.5 py-0.5 bg-zinc-700/40 text-zinc-500 border border-zinc-700/30 rounded-full shrink-0">⊘ Bỏ qua</span>}
                    <span className="text-xs text-zinc-600 shrink-0">{tableItems.length} món</span>
                  </button>

                  <div className="flex items-center gap-1.5 flex-wrap">
                    {mealCal > 0 && (
                      <span className="text-xs font-semibold text-orange-400">{Math.round(mealCal)} kcal</span>
                    )}

                    {/* Plan completion actions — only shown when plan day is active */}
                    {planMeal && isPending && (
                      <>
                        <button
                          type="button"
                          onClick={() => completeMealMutation.mutate({ mealId: planMeal.id, status: 'COMPLETED' })}
                          disabled={completeMealMutation.isPending}
                          className="flex items-center gap-0.5 px-2 py-1 bg-green-500/10 border border-green-500/25 text-green-400 text-[11px] rounded-lg hover:bg-green-500/20 transition-colors disabled:opacity-40"
                        >
                          <Check className="w-3 h-3" /> Hoàn thành
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setPartialMeal({ mealId: planMeal.id, mealName: MEAL_VI[meal], plannedCal: Math.round(mealCal), plannedProtein: mealProtein, plannedCarbs: mealCarbs, plannedFat: mealFat });
                            setPartialMode('pct'); setPartialPct("50");
                            setPartialCal(""); setPartialPro(""); setPartialCarb(""); setPartialFatAmt("");
                          }}
                          className="flex items-center gap-0.5 px-2 py-1 bg-amber-500/10 border border-amber-500/25 text-amber-400 text-[11px] rounded-lg hover:bg-amber-500/20 transition-colors"
                        >
                          <Minus className="w-3 h-3" /> Một phần
                        </button>
                        <button
                          type="button"
                          onClick={() => completeMealMutation.mutate({ mealId: planMeal.id, status: 'SKIPPED' })}
                          disabled={completeMealMutation.isPending}
                          className="flex items-center gap-0.5 px-2 py-1 bg-zinc-800 border border-zinc-700/40 text-zinc-500 text-[11px] rounded-lg hover:bg-zinc-700 transition-colors disabled:opacity-40"
                        >
                          <SkipForward className="w-3 h-3" /> Bỏ qua
                        </button>
                      </>
                    )}
                    {planMeal && !isPending && (
                      <button
                        type="button"
                        onClick={() => undoMealMutation.mutate(planMeal.id)}
                        disabled={undoMealMutation.isPending}
                        className="px-2 py-1 bg-zinc-800 border border-zinc-700/40 text-zinc-500 text-[11px] rounded-lg hover:bg-zinc-700 transition-colors disabled:opacity-40"
                      >
                        Hoàn tác
                      </button>
                    )}

                    {/* Delete plan meal */}
                    {canDeletePlanMeal && (
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteMeal({ mealId: planMeal.id, mealName: MEAL_VI[meal] })}
                        className="p-1 text-white hover:text-red-400 transition-colors rounded-lg hover:bg-red-500/10"
                        title="Xoá bữa ăn này khỏi kế hoạch"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}

                    {isCompleted || isPartial ? (
                      <span
                        className="flex items-center gap-1 text-[11px] text-zinc-600 px-2 py-1 cursor-not-allowed"
                        title="Không thể thêm món sau khi bữa đã hoàn thành"
                      >
                        🔒 Đã khoá
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          if (planMeal?.id) setAddItemMealId(planMeal.id);
                          else openAddModal(meal);
                        }}
                        className="flex items-center gap-1 text-xs text-zinc-500 hover:text-green-400 transition-colors px-2 py-1 rounded-lg hover:bg-zinc-800"
                      >
                        <Plus className="w-3.5 h-3.5" /> Thêm
                      </button>
                    )}
                    <button type="button" onClick={() => toggleMeal(meal)} className="text-zinc-600 hover:text-zinc-400 transition-colors">
                      {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {false && expanded && planMeal && (
                  <div className="border-t border-zinc-800/40 bg-zinc-800/20 px-4 py-2.5">
                    <div className="flex items-center justify-between mb-1.5">
                      <p className="text-[10px] text-zinc-600 uppercase tracking-wider font-semibold">Theo kế hoạch</p>
                      {(isCompleted || isPartial) && (
                        <span className="text-[10px] text-zinc-600 flex items-center gap-1">🔒 Đã hoàn thành</span>
                      )}
                    </div>
                    <div className="space-y-1">
                      {(planMeal.items as any[]).map((item: any, idx: number) => {
                        const isEditing = editingItemId === item.id;
                        return (
                          <div key={item.id ?? idx} className="group flex items-center gap-2 text-xs py-0.5">
                            <span className="w-1 h-1 rounded-full bg-orange-400/50 shrink-0" />
                            <span className="flex-1 truncate text-zinc-400">{item.customFoodName || item.food?.name || 'Món ăn'}</span>
                            {isEditing ? (
                              <div className="flex items-center gap-1 shrink-0">
                                <input
                                  type="number" min="1"
                                  aria-label="Khối lượng (g)"
                                  value={editingQty}
                                  onChange={e => setEditingQty(e.target.value)}
                                  className="w-16 px-1.5 py-0.5 bg-zinc-800 border border-zinc-700 rounded text-zinc-200 outline-none focus:border-orange-500/50 text-[11px]"
                                />
                                <span className="text-zinc-600">{item.unit ?? 'g'}</span>
                                <button type="button" onClick={() => { if (item.id && editingQty) updateItemMutation.mutate({ itemId: item.id, quantity: Number(editingQty) }); }}
                                  className="text-green-400 hover:text-green-300 transition-colors"><Check className="w-3 h-3" /></button>
                                <button type="button" onClick={() => setEditingItemId(null)} className="text-zinc-600 hover:text-zinc-400"><X className="w-3 h-3" /></button>
                              </div>
                            ) : (
                              <>
                                <span className="text-zinc-600 shrink-0">{item.quantity}{item.unit ?? 'g'}</span>
                                <span className="text-zinc-500 shrink-0">{item.calories ?? 0}kcal</span>
                                {!isCompleted && !isPartial && item.id && (
                                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                                    <button type="button" onClick={() => { setEditingItemId(item.id); setEditingQty(String(item.quantity ?? 100)); }}
                                      className="text-zinc-600 hover:text-orange-400 transition-colors"><Pencil className="w-3 h-3" /></button>
                                    <button type="button" onClick={() => deleteItemMutation.mutate(item.id)}
                                      disabled={deleteItemMutation.isPending}
                                      className="text-zinc-600 hover:text-red-400 transition-colors disabled:opacity-40"><Trash2 className="w-3 h-3" /></button>
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                        );
                      })}
                      {(planMeal.items || []).length === 0 && (
                        <p className="text-xs text-zinc-600 italic">Chưa có món nào. Bấm "Thêm món" để bổ sung.</p>
                      )}
                    </div>
                  </div>
                )}

                {/* Unified item table */}
                {expanded && (
                  <div className="border-t border-zinc-800/60">
                    {tableItems.length === 0 ? (
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
                              <th className="px-4 py-2 w-16" aria-label="Actions" />
                            </tr>
                          </thead>
                          <tbody>
                            {tableItems.map((log: any) => (
                              <tr
                                key={`${log.sourceType || 'ITEM'}-${log.programMealItemId || log.logItemId || log.id}`}
                                className="border-t border-zinc-800/40 hover:bg-zinc-800/30 transition-colors group"
                              >
                                <td className="px-4 py-2.5 font-semibold text-zinc-200 max-w-[180px] truncate">
                                  {log.foodName || log.customFoodName || log.food?.name || 'Món ăn'}
                                </td>
                                <td className="px-4 py-2.5 text-zinc-500">
                                  {log.sourceType === 'PLAN_ITEM' && editingItemId === (log.programMealItemId || log.id) ? (
                                    <>
                                      <input
                                        type="number"
                                        min="1"
                                        aria-label="Khối lượng (g)"
                                        value={editingQty}
                                        onChange={e => setEditingQty(e.target.value)}
                                        className="w-16 px-1.5 py-0.5 bg-zinc-800 border border-zinc-700 rounded text-zinc-200 outline-none focus:border-orange-500/50 text-[11px]"
                                      />
                                      <span className="ml-1">{log.unit ?? 'g'}</span>
                                    </>
                                  ) : log.quantity != null ? `${log.quantity}${log.unit ?? 'g'}` : "-"}
                                </td>
                                <td className="px-4 py-2.5 text-orange-400 font-semibold">{log.calories}</td>
                                <td className="px-4 py-2.5 text-green-400">
                                  {(log.proteinGrams ?? log.protein) != null ? `${log.proteinGrams ?? log.protein}g` : "-"}
                                </td>
                                <td className="px-4 py-2.5 text-blue-400">
                                  {(log.carbGrams ?? log.carbs) != null ? `${log.carbGrams ?? log.carbs}g` : "-"}
                                </td>
                                <td className="px-4 py-2.5 text-amber-400">
                                  {(log.fatGrams ?? log.fat ?? log.fats) != null ? `${log.fatGrams ?? log.fat ?? log.fats}g` : "-"}
                                </td>
                                <td className="px-4 py-2.5">
                                  {!isCompleted && !isPartial && (
                                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                      <button
                                        type="button"
                                        onClick={() => {
                                          const itemId = log.programMealItemId || log.id;
                                          if (log.sourceType === 'PLAN_ITEM' && editingItemId === itemId) {
                                            updateItemMutation.mutate({ itemId, quantity: Number(editingQty) || Number(log.quantity) || 100 });
                                            return;
                                          }
                                          if (log.sourceType === 'PLAN_ITEM') {
                                            setEditingItemId(itemId);
                                            setEditingQty(String(log.quantity ?? 100));
                                          } else {
                                            setEditingLog(log as any);
                                          }
                                        }}
                                        className="p-1 text-zinc-500 hover:text-blue-400 transition-colors rounded"
                                        title="Sửa"
                                      >
                                        {log.sourceType === 'PLAN_ITEM' && editingItemId === (log.programMealItemId || log.id) ? (
                                          updateItemMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />
                                        ) : (
                                          <Pencil className="w-3.5 h-3.5" />
                                        )}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          const itemId = log.programMealItemId || log.id;
                                          if (log.sourceType === 'PLAN_ITEM' && editingItemId === itemId) {
                                            setEditingItemId(null);
                                            return;
                                          }
                                          if (log.sourceType === 'PLAN_ITEM') deleteItemMutation.mutate(itemId);
                                          else setDeletingId(log.id);
                                        }}
                                        disabled={deleteItemMutation.isPending}
                                        className="p-1 text-zinc-500 hover:text-red-400 transition-colors rounded"
                                        title="Xóa"
                                      >
                                        {log.sourceType === 'PLAN_ITEM' && editingItemId === (log.programMealItemId || log.id) ? (
                                          <X className="w-3.5 h-3.5" />
                                        ) : (
                                          <Trash2 className="w-3.5 h-3.5" />
                                        )}
                                      </button>
                                    </div>
                                  )}
                                  {(isCompleted || isPartial) && (
                                    <span className="text-zinc-700 text-[10px]" title="Không thể sửa/xóa sau khi bữa đã hoàn thành">🔒</span>
                                  )}
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
                { name: "Protein", value: Math.round(actualNutrition.protein * 4), color: COLORS[0] },
                { name: "Carbs", value: Math.round(actualNutrition.carbs * 4), color: COLORS[1] },
                { name: "Fat", value: Math.round(actualNutrition.fat * 9), color: COLORS[2] },
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
          aria-hidden="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={(e) => { if (e.target === e.currentTarget) closeAddModal(); }}
        >
          <div className="bg-zinc-900 border border-zinc-700/60 rounded-2xl w-full max-w-md shadow-2xl flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between p-5 border-b border-zinc-800/60">
              <h3 className="text-zinc-100 font-bold">Thêm món ăn</h3>
              <button type="button" onClick={closeAddModal} className="text-zinc-500 hover:text-zinc-300 transition-colors">
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
                      type="button"
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
                    aria-label="Tìm thực phẩm"
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
                    {debouncedQuery.length >= 2 && !searchingFood && searchedFoods.length === 0 && (
                      <p className="text-xs text-zinc-600 mt-2 text-center">
                        Không tìm thấy kết quả.{" "}
                        {!translation.translated
                          ? "Thử từ khóa tiếng Anh (VD: chicken breast, white rice)."
                          : "Thử lại với tên khác hoặc từ khóa tiếng Anh."}
                      </p>
                    )}
                    {searchedFoods.length > 0 && (
                      <div className="mt-2 bg-zinc-800/60 border border-zinc-700/40 rounded-xl overflow-hidden max-h-48 overflow-y-auto">
                        {searchedFoods.map((food) => (
                          <button
                            type="button"
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
                      type="button"
                      onClick={() => setSelectedFood(null)}
                      className="text-zinc-600 hover:text-zinc-400 flex-shrink-0 transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <div>
                    <label htmlFor="np-add-qty" className="text-xs text-zinc-500 mb-1.5 block font-semibold">
                      Khối lượng (grams)
                    </label>
                    <input
                      id="np-add-qty"
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
                type="button"
                onClick={closeAddModal}
                className="flex-1 py-2.5 border border-zinc-700/60 text-white text-sm font-semibold rounded-lg hover:bg-zinc-800 transition-colors"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={handleAddFood}
                disabled={!selectedFood || createMutation.isPending}
                className="flex-1 py-2.5 bg-green-500 hover:bg-green-400 disabled:bg-zinc-700 disabled:text-white text-black text-sm font-bold rounded-lg transition-all shadow-lg shadow-green-500/20 flex items-center justify-center gap-2"
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
          aria-hidden="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setEditingLog(null); }}
        >
          <div className="bg-zinc-900 border border-zinc-700/60 rounded-2xl w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between p-5 border-b border-zinc-800/60">
              <h3 className="text-zinc-100 font-bold">Sửa nhật ký</h3>
              <button
                type="button"
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
                      type="button"
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
                <label htmlFor="np-edit-food-name" className="text-xs text-zinc-500 uppercase tracking-wider mb-1.5 block font-semibold">
                  Tên thực phẩm
                </label>
                <input
                  id="np-edit-food-name"
                  value={editForm.foodName}
                  onChange={(e) => setEditForm((f) => ({ ...f, foodName: e.target.value }))}
                  className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 outline-none focus:border-green-500/50"
                />
              </div>

              {/* Quantity */}
              <div>
                <label htmlFor="np-edit-qty" className="text-xs text-zinc-500 uppercase tracking-wider mb-1.5 block font-semibold">
                  Khối lượng (g)
                </label>
                <input
                  id="np-edit-qty"
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
                      <label htmlFor={`np-edit-${key}`} className={`text-xs ${color} mb-1.5 block font-semibold`}>{label}</label>
                      <input
                        id={`np-edit-${key}`}
                        type="number"
                        min={0}
                        step={key === "calories" ? 1 : 0.1}
                        aria-label={label}
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
                <label htmlFor="np-edit-notes" className="text-xs text-zinc-500 uppercase tracking-wider mb-1.5 block font-semibold">
                  Ghi chú (tùy chọn)
                </label>
                <input
                  id="np-edit-notes"
                  value={editForm.notes}
                  onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value }))}
                  placeholder="Ghi chú thêm…"
                  className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 outline-none focus:border-green-500/50 placeholder-zinc-600"
                />
              </div>
            </div>

            <div className="p-5 border-t border-zinc-800/60 flex gap-3">
              <button
                type="button"
                onClick={() => setEditingLog(null)}
                className="flex-1 py-2.5 border border-zinc-700/60 text-white text-sm font-semibold rounded-lg hover:bg-zinc-800 transition-colors"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={handleUpdateLog}
                disabled={updateMutation.isPending}
                className="flex-1 py-2.5 bg-blue-500 hover:bg-blue-400 disabled:bg-zinc-700 disabled:text-white text-white text-sm font-bold rounded-lg transition-all flex items-center justify-center gap-2"
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
          aria-hidden="true"
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
                type="button"
                onClick={() => setDeletingId(null)}
                className="flex-1 py-2.5 border border-zinc-700/60 text-zinc-300 text-sm font-semibold rounded-lg hover:bg-zinc-800 transition-colors"
              >
                Hủy
              </button>
              <button
                type="button"
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
          aria-hidden="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setShowGoalModal(false); }}
        >
          <div className="bg-zinc-900 border border-zinc-700/60 rounded-2xl w-full max-w-sm shadow-2xl">
            <div className="flex items-center justify-between p-5 border-b border-zinc-800/60">
              <h3 className="text-zinc-100 font-bold flex items-center gap-2">
                <Target className="w-4 h-4 text-green-400" /> Mục tiêu dinh dưỡng
              </h3>
              <button
                type="button"
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
                  <label htmlFor={`np-goal-${key}`} className={`text-sm font-semibold ${color} w-32 flex-shrink-0`}>
                    {label}
                  </label>
                  <div className="flex-1 relative">
                    <input
                      id={`np-goal-${key}`}
                      type="number"
                      min={1}
                      aria-label={label}
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
                type="button"
                onClick={() => setShowGoalModal(false)}
                className="flex-1 py-2.5 border border-zinc-700/60 text-white text-sm font-semibold rounded-lg hover:bg-zinc-800 transition-colors"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={handleSaveGoal}
                disabled={goalMutation.isPending}
                className="flex-1 py-2.5 bg-green-500 hover:bg-green-400 disabled:bg-zinc-700 disabled:text-white text-black text-sm font-bold rounded-lg transition-all shadow-lg shadow-green-500/20 flex items-center justify-center gap-2"
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

/* ── NutritionCalendarGrid ───────────────────────────────────────────────── */

const STATUS_DOT: Record<string, string> = {
  completed:   'bg-green-400 shadow-[0_0_6px_rgba(34,197,94,0.6)]',
  partial:     'bg-amber-400',
  in_progress: 'bg-orange-400',
  skipped:     'bg-zinc-600',
  pending:     'bg-zinc-700',
};

const STATUS_CELL: Record<string, string> = {
  completed:   'bg-green-500/10 border-green-500/25 text-green-300',
  partial:     'bg-amber-500/10 border-amber-500/25 text-amber-300',
  in_progress: 'bg-orange-500/10 border-orange-500/25 text-orange-300',
  skipped:     'bg-zinc-800/40 border-zinc-700/30 text-zinc-500',
};

const DAY_LABELS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];

function NutritionCalendarGrid({
  month,
  today,
  selectedDate,
  statusByDate,
  onPrevMonth,
  onNextMonth,
  onDayClick,
  onAddClick,
}: {
  month: Date;
  today: string;
  selectedDate: string;
  statusByDate: Record<string, string>;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  onDayClick: (date: string) => void;
  onAddClick: () => void;
}) {
  const year = month.getFullYear();
  const monthIdx = month.getMonth();
  const daysInMonth = new Date(year, monthIdx + 1, 0).getDate();
  const firstDow = new Date(year, monthIdx, 1).getDay(); // 0=Sun
  const offset = firstDow === 0 ? 6 : firstDow - 1;     // Mon-first

  const cells: (number | null)[] = [];
  for (let i = 0; i < offset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const monthLabel = month.toLocaleString('vi-VN', { month: 'long', year: 'numeric' });

  function dateStr(d: number) {
    return `${year}-${String(monthIdx + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  return (
    <div className="bg-zinc-900 rounded-2xl border border-zinc-800/60 p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-orange-500/10 border border-orange-500/20 rounded-xl flex items-center justify-center">
            <Calendar className="w-4 h-4 text-orange-400" />
          </div>
          <span className="text-sm font-bold text-zinc-200">Lịch tập</span>
        </div>
        <button
          type="button"
          onClick={onAddClick}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-green-500 hover:bg-green-400 text-black text-xs font-bold rounded-xl transition-all shadow-sm shadow-green-500/20"
        >
          <Plus className="w-3.5 h-3.5" /> Thêm
        </button>
      </div>

      {/* Month navigation */}
      <div className="flex items-center justify-center gap-5 mb-4">
        <button
          type="button"
          onClick={onPrevMonth}
          className="w-8 h-8 rounded-lg bg-zinc-800/50 border border-zinc-700/40 flex items-center justify-center text-zinc-400 hover:text-zinc-200 hover:border-zinc-600 transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span className="text-sm font-semibold text-zinc-200 capitalize min-w-[140px] text-center">
          {monthLabel}
        </span>
        <button
          type="button"
          onClick={onNextMonth}
          className="w-8 h-8 rounded-lg bg-zinc-800/50 border border-zinc-700/40 flex items-center justify-center text-zinc-400 hover:text-zinc-200 hover:border-zinc-600 transition-colors"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* Day labels */}
      <div className="grid grid-cols-7 mb-1">
        {DAY_LABELS.map(d => (
          <span key={d} className="text-[10px] text-zinc-600 text-center py-1 uppercase tracking-wider font-semibold">
            {d}
          </span>
        ))}
      </div>

      {/* Day cells */}
      <div className="grid grid-cols-7 gap-1">
        {cells.map((day, i) => {
          if (!day) return <span key={`e-${i}`} />;

          const ds = dateStr(day);
          const isToday = ds === today;
          const isSelected = ds === selectedDate && !isToday;
          const status = statusByDate[ds];

          return (
            <button
              type="button"
              key={ds}
              onClick={() => onDayClick(ds)}
              className={`
                relative flex flex-col items-center justify-center rounded-xl text-xs font-semibold
                min-h-[48px] transition-all duration-150 border
                ${isToday
                  ? 'bg-green-500 text-black shadow-[0_0_14px_rgba(34,197,94,0.35)] border-transparent'
                  : isSelected
                  ? 'bg-zinc-700 text-zinc-100 border-zinc-600'
                  : status && STATUS_CELL[status]
                  ? STATUS_CELL[status] + ' hover:opacity-80'
                  : 'text-zinc-400 border-transparent hover:bg-zinc-800/50 hover:text-zinc-200'
                }
              `}
            >
              <span className="text-sm leading-none">{day}</span>
              {/* Status dot */}
              {!isToday && status && status !== 'pending' && (
                <span className={`absolute bottom-1.5 w-1.5 h-1.5 rounded-full ${STATUS_DOT[status] ?? 'bg-zinc-600'}`} />
              )}
            </button>
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-3 mt-4 pt-3 border-t border-zinc-800/60">
        {[
          { label: 'Hoàn thành', cls: 'bg-green-400' },
          { label: 'Một phần', cls: 'bg-amber-400' },
          { label: 'Đang làm', cls: 'bg-orange-400' },
          { label: 'Bỏ qua', cls: 'bg-zinc-600' },
        ].map(({ label, cls }) => (
          <div key={label} className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${cls}`} />
            <span className="text-[10px] text-zinc-500">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
