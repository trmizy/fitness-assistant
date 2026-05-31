import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { nutritionService, planService } from "../../services/api";
import {
  Brain, CalendarDays, Loader2, Target, X, Plus, Sparkles,
  ChevronDown, ChevronRight, Trash2, AlertTriangle, CheckCircle,
  RefreshCw, MessageSquare, SlidersHorizontal, Eye, Archive
} from "lucide-react";
import { toast } from "sonner";

// ── Label helpers ────────────────────────────────────────────────────────────

const GOAL_LABELS: Record<string, string> = {
  FAT_LOSS: 'Giảm mỡ',
  MUSCLE_GAIN: 'Tăng cơ',
  MAINTENANCE: 'Duy trì',
  WEIGHT_GAIN: 'Tăng cân',
  WEIGHT_LOSS: 'Giảm cân',
  IMPROVE_HEALTH: 'Cải thiện sức khỏe',
};

const MEAL_TYPE_LABELS: Record<string, string> = {
  BREAKFAST: 'Bữa sáng',
  LUNCH: 'Bữa trưa',
  DINNER: 'Bữa tối',
  SNACK: 'Bữa phụ',
};

function goalLabel(goal?: string | null): string {
  if (!goal) return 'Chung';
  return GOAL_LABELS[goal.toUpperCase()] ?? goal;
}

function mealTypeLabel(mt?: string | null): string {
  if (!mt) return 'Bữa ăn';
  return MEAL_TYPE_LABELS[mt.toUpperCase()] ?? mt;
}

function statusBadge(status: string) {
  if (status === 'COMPLETED') return { label: 'Hoàn thành', cls: 'bg-green-500/10 text-green-400 border-green-500/30' };
  if (status === 'FAILED') return { label: 'Thất bại', cls: 'bg-red-500/10 text-red-400 border-red-500/30' };
  if (status === 'PROCESSING') return { label: 'Đang xử lý', cls: 'bg-blue-500/10 text-blue-400 border-blue-500/30' };
  return { label: 'Đang chờ', cls: 'bg-amber-500/10 text-amber-400 border-amber-500/30' };
}

// ── Day detail display ───────────────────────────────────────────────────────

function NutritionDayView({ day, expanded, onToggle }: { day: any; expanded: boolean; onToggle: () => void }) {
  return (
    <div className="bg-zinc-950 border border-zinc-800 rounded-lg overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-zinc-900 transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-zinc-200">
            {day.title || `Ngày ${day.dayNumber}`}
          </span>
          <span className="text-xs text-zinc-500">{day.totalCalories ?? 0} kcal</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-2 text-xs text-zinc-500">
            <span>P: {Math.round(day.protein ?? day.proteinGrams ?? 0)}g</span>
            <span>C: {Math.round(day.carbs ?? day.carbGrams ?? 0)}g</span>
            <span>F: {Math.round(day.fat ?? day.fatGrams ?? 0)}g</span>
          </div>
          {expanded ? <ChevronDown className="w-4 h-4 text-zinc-500" /> : <ChevronRight className="w-4 h-4 text-zinc-500" />}
        </div>
      </button>
      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-zinc-800">
          {(day.meals || []).map((meal: any, mi: number) => (
            <div key={meal.id ?? mi} className="mt-3">
              <div className="text-xs font-semibold text-orange-400 mb-1.5">
                {mealTypeLabel(meal.mealType)} · {meal.title || ''} · {meal.calories ?? 0} kcal
              </div>
              <div className="space-y-1">
                {(meal.items || []).map((item: any, ii: number) => (
                  <div key={item.id ?? ii} className="flex items-center justify-between text-xs text-zinc-400 py-1 border-b border-zinc-800/50 last:border-0">
                    <span className="text-zinc-300">
                      {item.customFoodName || item.food?.name || item.name || 'Thực phẩm'}
                    </span>
                    <div className="flex items-center gap-3 shrink-0">
                      <span>{item.quantity ?? 100}{item.unit ?? 'g'}</span>
                      <span className="text-orange-400">{item.calories ?? 0} kcal</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export function CurrentNutritionProgram() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [showAdjustModal, setShowAdjustModal] = useState<string | null>(null);
  const [adjustText, setAdjustText] = useState('');
  const [showExplanation, setShowExplanation] = useState<Record<string, string>>({});
  const [explanationLoading, setExplanationLoading] = useState<string | null>(null);
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set());
  const [expandedPlanId, setExpandedPlanId] = useState<string | null>(null);
  const [savedOutcome, setSavedOutcome] = useState<{ planId: string; count: number } | null>(null);
  const [prevActivePlanId, setPrevActivePlanId] = useState<string | null>(null);

  // ── Generate form state (basic + advanced) ────────────────────────────────
  const [generateForm, setGenerateForm] = useState({
    // Core
    goal: 'Giảm mỡ',
    mealsPerDay: 3,
    dailyCaloriesTarget: 2000,
    dietPreference: 'Không',
    budgetLevel: 'normal',
    // Body stats
    weightKg: '' as string | number,
    heightCm: '' as string | number,
    age: '' as string | number,
    gender: '' as string,
    // Training
    activityLevel: 'MODERATE',
    trainingDaysPerWeek: '' as string | number,
    trainingDurationMin: '' as string | number,
    trainingType: '',
    // Advanced phase
    trainingPhase: '',
    experienceLevel: '',
    primaryPriority: '',
    // Macro preferences
    proteinTargetG: '' as string | number,
    carbsAroundWorkout: false,
    preworkoutMeal: false,
    postworkoutMeal: false,
    // Restrictions
    restrictions: [] as string[],
    customRestriction: '',
    notes: '',
  });
  const [showAdvancedForm, setShowAdvancedForm] = useState(false);

  // ── Save modal state ───────────────────────────────────────────────────────
  const [showSaveModal, setShowSaveModal] = useState<string | null>(null); // planId
  const [saveDateForm, setSaveDateForm] = useState({
    startDate: new Date().toISOString().slice(0, 10),
    endDate: '',
    repeatEnabled: false,
    forceArchive: true,
  });

  // ── Restriction presets ────────────────────────────────────────────────────
  const RESTRICTION_PRESETS = [
    'Không cá biển', 'Không hải sản', 'Không sữa', 'Không đậu phộng',
    'Không trứng', 'Không thịt đỏ', 'Không gluten', 'Không đường',
  ];

  // ── Queries ────────────────────────────────────────────────────────────────

  const { data: currentProgram, isLoading: programLoading } = useQuery({
    queryKey: ['nutrition-current-program'],
    queryFn: () => nutritionService.getCurrentProgram(),
  });

  const { data: aiPlansData } = useQuery({
    queryKey: ['nutrition-ai-plans'],
    queryFn: () => planService.getCurrentNutritionAiPlans(),
    refetchInterval: 3000,
  });

  const plans: any[] = Array.isArray(aiPlansData) ? aiPlansData : [];
  const processingPlan = plans.find((p: any) => p.status === 'QUEUED' || p.status === 'PROCESSING');
  const completedPlans = plans.filter((p: any) => p.status === 'COMPLETED');
  const failedPlans = plans.filter((p: any) => p.status === 'FAILED');

  // Auto-open the most recent completed plan
  useEffect(() => {
    if (processingPlan) {
      setPrevActivePlanId(processingPlan.id);
    } else if (prevActivePlanId && plans.length > 0) {
      const finished = plans.find((p: any) => p.id === prevActivePlanId);
      if (finished?.status === 'COMPLETED') {
        toast.success('Đã tạo kế hoạch dinh dưỡng thành công!');
        setExpandedPlanId(finished.id);
      } else if (finished?.status === 'FAILED') {
        toast.error(finished.failReason || 'Tạo kế hoạch thất bại. Vui lòng thử lại.');
      }
      setPrevActivePlanId(null);
    }
  }, [processingPlan, plans, prevActivePlanId]);

  // ── Mutations ──────────────────────────────────────────────────────────────

  const generateMutation = useMutation({
    mutationFn: (payload: any) => planService.generateNutritionPlan(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['nutrition-ai-plans'] });
      setShowGenerateModal(false);
      toast.success('Đã bắt đầu tạo kế hoạch (chạy ngầm).');
    },
    onError: (e: any) => {
      toast.error(e.response?.data?.error?.message || 'Không thể tạo kế hoạch.');
    },
  });

  const saveMutation = useMutation({
    mutationFn: ({ planId, form }: { planId: string; form: typeof saveDateForm }) =>
      planService.saveNutritionPlanToNutrition(planId, {
        startDate: form.startDate || undefined,
        endDate: form.endDate || undefined,
        repeatEnabled: form.repeatEnabled,
        forceArchive: form.forceArchive,
      }),
    onSuccess: (result, { planId }) => {
      queryClient.removeQueries({ queryKey: ['nutrition-daily-task'] });
      queryClient.removeQueries({ queryKey: ['nutrition-current-program'] });
      queryClient.removeQueries({ queryKey: ['nutrition-monthly-summary'] });
      setShowSaveModal(null);
      if (result.alreadyExists) {
        toast.info('Kế hoạch này đã được lưu trước đó.');
      } else {
        toast.success(`Đã lưu ${result.createdDayCount ?? 7} ngày, ${result.createdMealCount ?? 0} bữa vào Dinh dưỡng.`);
        setSavedOutcome({ planId, count: result.createdMealCount ?? 0 });
      }
    },
    onError: (e: any) => {
      toast.error(e.response?.data?.error || e.response?.data?.error?.message || 'Lỗi khi lưu kế hoạch.');
    },
  });

  const archiveMutation = useMutation({
    mutationFn: (planId: string) => planService.archiveNutritionPlan(planId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['nutrition-ai-plans'] });
      toast.success('Đã ẩn kế hoạch.');
    },
    onError: () => toast.error('Không thể ẩn kế hoạch.'),
  });

  const adjustMutation = useMutation({
    mutationFn: ({ planId, text }: { planId: string; text: string }) =>
      planService.adjustNutritionPlan(planId, text, generateForm.mealsPerDay),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['nutrition-ai-plans'] });
      setShowAdjustModal(null);
      setAdjustText('');
      toast.success('Đã gửi yêu cầu điều chỉnh. Kế hoạch mới đang được tạo...');
    },
    onError: (e: any) => toast.error(e.response?.data?.error?.message || 'Không thể điều chỉnh kế hoạch.'),
  });

  const handleExplain = async (planId: string) => {
    if (showExplanation[planId]) {
      setShowExplanation((prev) => { const n = { ...prev }; delete n[planId]; return n; });
      return;
    }
    setExplanationLoading(planId);
    try {
      const result = await planService.explainNutritionPlan(planId);
      setShowExplanation((prev) => ({ ...prev, [planId]: result.explanation }));
    } catch {
      toast.error('Không thể giải thích kế hoạch. Vui lòng thử lại.');
    } finally {
      setExplanationLoading(null);
    }
  };

  const handleArchive = (planId: string) => {
    if (!window.confirm('Ẩn kế hoạch AI này khỏi danh sách? Kế hoạch đã lưu trong Dinh dưỡng sẽ không bị xoá.')) return;
    archiveMutation.mutate(planId);
  };

  const toggleDay = (key: string) => {
    setExpandedDays((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  // ── Plan content renderer ──────────────────────────────────────────────────

  function renderPlanContent(plan: any) {
    const content = plan.plan as any;
    if (!content?.weeklySchedule?.length) return null;
    return (
      <div className="space-y-2">
        {content.weeklySchedule.map((day: any, i: number) => {
          const key = `${plan.id}-day-${i}`;
          return (
            <NutritionDayView
              key={key}
              day={day}
              expanded={expandedDays.has(key)}
              onToggle={() => toggleDay(key)}
            />
          );
        })}
      </div>
    );
  }

  // ── Plan card ──────────────────────────────────────────────────────────────

  function PlanCard({ plan }: { plan: any }) {
    const { label, cls } = statusBadge(plan.status);
    const content = plan.plan as any;
    const isExpanded = expandedPlanId === plan.id;
    const isSaving = saveMutation.isPending && saveMutation.variables === plan.id;
    const isArchiving = archiveMutation.isPending && archiveMutation.variables === plan.id;
    const isExplaining = explanationLoading === plan.id;
    const explanation = showExplanation[plan.id];
    const wasSaved = savedOutcome?.planId === plan.id;

    return (
      <div className="bg-zinc-900 border border-zinc-800/60 rounded-xl overflow-hidden">
        {/* Header */}
        <div className="p-4 flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold ${cls}`}>{label}</span>
              <span className="text-[10px] text-zinc-500">{new Date(plan.createdAt).toLocaleDateString('vi-VN')}</span>
            </div>
            <h4 className="text-sm font-bold text-zinc-100 truncate">
              {plan.name || `Kế hoạch dinh dưỡng - ${goalLabel(plan.goal)}`}
            </h4>
            {plan.status === 'COMPLETED' && content && (
              <div className="flex flex-wrap gap-3 mt-1.5 text-xs text-zinc-500">
                <span>{goalLabel(plan.goal)}</span>
                <span>·</span>
                <span>{content.dailyCaloriesTarget ?? 0} kcal/ngày</span>
                <span>·</span>
                <span>{plan.mealsPerDay ?? 3} bữa/ngày</span>
              </div>
            )}
            {plan.status === 'FAILED' && (
              <p className="text-xs text-red-400 mt-1 line-clamp-2">{plan.failReason || 'Tạo thất bại.'}</p>
            )}
          </div>
          <button
            onClick={() => setExpandedPlanId(isExpanded ? null : plan.id)}
            className="shrink-0 text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>
        </div>

        {/* Actions */}
        {plan.status === 'COMPLETED' && (
          <div className="px-4 pb-3 flex flex-wrap gap-2">
            {wasSaved ? (
              <button
                onClick={() => navigate('/client/nutrition')}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-green-500/10 border border-green-500/30 text-green-400 text-xs rounded-lg hover:bg-green-500/15"
              >
                <CheckCircle className="w-3.5 h-3.5" /> Đi tới Dinh dưỡng
              </button>
            ) : (
              <button
                onClick={() => { const t = new Date().toISOString().slice(0, 10); setSaveDateForm({ startDate: t, endDate: '', repeatEnabled: false, forceArchive: true }); setShowSaveModal(plan.id); }}
                disabled={isSaving}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-green-500 hover:bg-green-400 text-black text-xs font-bold rounded-lg disabled:opacity-50"
              >
                {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CalendarDays className="w-3.5 h-3.5" />}
                Lưu vào Dinh dưỡng
              </button>
            )}

            <button
              onClick={() => handleExplain(plan.id)}
              disabled={isExplaining}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 text-xs rounded-lg disabled:opacity-50"
            >
              {isExplaining ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MessageSquare className="w-3.5 h-3.5" />}
              {explanation ? 'Ẩn giải thích' : 'Giải thích'}
            </button>

            <button
              onClick={() => { setShowAdjustModal(plan.id); setAdjustText(''); }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 text-xs rounded-lg"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" /> Điều chỉnh
            </button>

            <button
              onClick={() => setExpandedPlanId(isExpanded ? null : plan.id)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 text-xs rounded-lg"
            >
              <Eye className="w-3.5 h-3.5" /> {isExpanded ? 'Ẩn thực đơn' : 'Xem thực đơn'}
            </button>

            <button
              onClick={() => handleArchive(plan.id)}
              disabled={isArchiving}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-red-500/20 text-red-400 text-xs rounded-lg disabled:opacity-50"
            >
              {isArchiving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Archive className="w-3.5 h-3.5" />}
              Ẩn
            </button>
          </div>
        )}

        {plan.status === 'FAILED' && (
          <div className="px-4 pb-3 flex gap-2">
            <button
              onClick={() => generateMutation.mutate({ ...generateForm, durationWeeks: 1, goal: plan.goal || generateForm.goal })}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs rounded-lg hover:bg-amber-500/15"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Tạo lại
            </button>
            <button onClick={() => handleArchive(plan.id)} className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 border border-zinc-700 text-zinc-400 text-xs rounded-lg hover:bg-zinc-700">
              <Archive className="w-3.5 h-3.5" /> Ẩn
            </button>
          </div>
        )}

        {/* Explanation */}
        {explanation && (
          <div className="mx-4 mb-4 bg-zinc-950 border border-zinc-800 rounded-lg p-3">
            <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-2 font-semibold">Giải thích kế hoạch</p>
            <p className="text-xs text-zinc-300 leading-relaxed whitespace-pre-line">{explanation}</p>
          </div>
        )}

        {/* 7-day detail */}
        {isExpanded && plan.status === 'COMPLETED' && (
          <div className="px-4 pb-4 space-y-2">
            <p className="text-xs text-zinc-500 font-semibold">Thực đơn 7 ngày:</p>
            {renderPlanContent(plan)}
          </div>
        )}
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="mb-6 space-y-4">
      {/* Section header */}
      <div className="flex items-center justify-between">
        <h3 className="text-zinc-100 font-bold flex items-center gap-2">
          <CalendarDays className="w-5 h-5 text-orange-400" /> AI Kế hoạch dinh dưỡng
        </h3>
        <button
          onClick={() => setShowGenerateModal(true)}
          className="flex items-center gap-2 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-400 hover:to-amber-400 text-black px-4 py-2 rounded-xl text-sm font-bold transition-all shadow-lg"
        >
          <Sparkles className="w-4 h-4" /> Tạo kế hoạch mới
        </button>
      </div>

      {/* Active nutrition program from DB */}
      {!programLoading && currentProgram && (
        <div className="bg-zinc-900 rounded-xl border border-green-500/30 p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-[10px] text-green-400 font-bold uppercase tracking-wider mb-0.5">Đang áp dụng</div>
              <h4 className="text-sm font-bold text-zinc-100">{currentProgram.name}</h4>
              <p className="text-xs text-zinc-500">{goalLabel(currentProgram.goal)} · {currentProgram.durationWeeks} tuần</p>
            </div>
            <button
              onClick={() => navigate('/client/nutrition')}
              className="text-xs px-3 py-1.5 bg-green-500/10 border border-green-500/30 text-green-400 rounded-lg hover:bg-green-500/15"
            >
              Xem chi tiết
            </button>
          </div>
          <div className="grid grid-cols-4 gap-2 text-center text-xs">
            {[
              { label: 'Kcal', val: currentProgram.dailyCaloriesTarget, color: 'text-orange-400' },
              { label: 'Protein', val: `${currentProgram.proteinTargetGrams ?? 0}g`, color: 'text-green-400' },
              { label: 'Carbs', val: `${currentProgram.carbTargetGrams ?? 0}g`, color: 'text-blue-400' },
              { label: 'Fat', val: `${currentProgram.fatTargetGrams ?? 0}g`, color: 'text-amber-400' },
            ].map((m) => (
              <div key={m.label} className="bg-zinc-950 rounded-lg py-2 border border-zinc-800">
                <div className={`font-bold ${m.color}`}>{m.val}</div>
                <div className="text-zinc-500 text-[10px] mt-0.5">{m.label}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Processing banner */}
      {processingPlan && (
        <div className="bg-orange-500/10 border border-orange-500/30 rounded-xl p-4 flex items-center gap-4">
          <Loader2 className="w-5 h-5 animate-spin text-orange-500 shrink-0" />
          <div>
            <h4 className="text-zinc-200 font-bold text-sm">AI đang tạo kế hoạch dinh dưỡng...</h4>
            <p className="text-xs text-zinc-400">Bạn có thể rời khỏi trang này. Kết quả sẽ hiện khi hoàn tất.</p>
          </div>
        </div>
      )}

      {/* Completed plans */}
      {completedPlans.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs text-zinc-500 font-semibold uppercase tracking-wider">Kế hoạch đã tạo</p>
          {completedPlans.map((plan: any) => <PlanCard key={plan.id} plan={plan} />)}
        </div>
      )}

      {/* Failed plans */}
      {failedPlans.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs text-zinc-500 font-semibold uppercase tracking-wider">Tạo thất bại</p>
          {failedPlans.map((plan: any) => <PlanCard key={plan.id} plan={plan} />)}
        </div>
      )}

      {/* Empty state */}
      {!processingPlan && plans.length === 0 && !currentProgram && (
        <div className="bg-zinc-900 rounded-xl p-6 border border-zinc-800/60 text-center">
          <Brain className="w-10 h-10 text-zinc-700 mx-auto mb-3" />
          <p className="text-zinc-400 text-sm">Bạn chưa có kế hoạch dinh dưỡng AI nào.</p>
          <p className="text-zinc-600 text-xs mt-1">Bấm "Tạo kế hoạch mới" để bắt đầu.</p>
        </div>
      )}

      {/* ── Generate modal (enhanced) ── */}
      {showGenerateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-zinc-900 border border-zinc-700/60 rounded-2xl w-full max-w-lg shadow-2xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-zinc-800/60 shrink-0">
              <h3 className="text-zinc-100 font-bold flex items-center gap-2 text-sm">
                <Sparkles className="w-4 h-4 text-orange-400" /> Tạo kế hoạch dinh dưỡng AI
              </h3>
              <button onClick={() => setShowGenerateModal(false)} className="text-zinc-500 hover:text-zinc-300"><X className="w-5 h-5" /></button>
            </div>
            <div className="overflow-y-auto flex-1 p-4 space-y-4">

              {/* Basic section */}
              <div className="space-y-3">
                <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold">Thông tin cơ bản</p>
                <div>
                  <label className="text-xs text-zinc-500 font-semibold mb-1 block">Mục tiêu</label>
                  <select value={generateForm.goal} onChange={e => setGenerateForm({...generateForm, goal: e.target.value})}
                    className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 outline-none focus:border-orange-500/50">
                    <option value="Giảm mỡ">Giảm mỡ (Fat Loss)</option>
                    <option value="Tăng cơ">Tăng cơ (Muscle Gain)</option>
                    <option value="Cutting">Cutting (siết mỡ, giữ cơ)</option>
                    <option value="Bulking">Bulking (tăng cơ, calo cao)</option>
                    <option value="Lean Bulk">Lean Bulk (tăng cơ sạch)</option>
                    <option value="Recomposition">Recomposition</option>
                    <option value="Duy trì vóc dáng">Duy trì vóc dáng</option>
                    <option value="Cải thiện sức khỏe">Cải thiện sức khỏe</option>
                    <option value="Tăng cân">Tăng cân</option>
                    <option value="Siết cân thi đấu">Siết cân thi đấu</option>
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-zinc-500 font-semibold mb-1 block">Số bữa / ngày</label>
                    <input type="number" min={2} max={6} value={generateForm.mealsPerDay}
                      onChange={e => setGenerateForm({...generateForm, mealsPerDay: Number(e.target.value)})}
                      className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 outline-none focus:border-orange-500/50" />
                  </div>
                  <div>
                    <label className="text-xs text-zinc-500 font-semibold mb-1 block">Calories (kcal/ngày)</label>
                    <input type="number" min={1000} max={6000} value={generateForm.dailyCaloriesTarget}
                      onChange={e => setGenerateForm({...generateForm, dailyCaloriesTarget: Number(e.target.value)})}
                      className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 outline-none focus:border-orange-500/50" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-zinc-500 font-semibold mb-1 block">Chế độ ăn</label>
                    <select value={generateForm.dietPreference} onChange={e => setGenerateForm({...generateForm, dietPreference: e.target.value})}
                      className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 outline-none focus:border-orange-500/50">
                      <option value="Không">Không đặc biệt</option>
                      <option value="high_protein">High protein</option>
                      <option value="low_carb">Low carb</option>
                      <option value="low_fat">Low fat</option>
                      <option value="Keto">Keto</option>
                      <option value="vegetarian">Chay</option>
                      <option value="Eat Clean">Eat Clean</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-zinc-500 font-semibold mb-1 block">Ngân sách</label>
                    <select value={generateForm.budgetLevel} onChange={e => setGenerateForm({...generateForm, budgetLevel: e.target.value})}
                      className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 outline-none focus:border-orange-500/50">
                      <option value="student">Tiết kiệm</option>
                      <option value="normal">Bình thường</option>
                      <option value="high">Cao</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Toggle advanced */}
              <button onClick={() => setShowAdvancedForm(!showAdvancedForm)}
                className="w-full flex items-center justify-between px-3 py-2 bg-zinc-800/50 border border-zinc-700/40 rounded-xl text-xs text-zinc-400 hover:text-zinc-200 transition-colors">
                <span className="font-semibold">{showAdvancedForm ? '▾' : '▸'} Thông tin nâng cao (vận động viên, body stats, macro)</span>
                <span className="text-zinc-600">{showAdvancedForm ? 'Thu gọn' : 'Mở rộng'}</span>
              </button>

              {showAdvancedForm && (
                <div className="space-y-4 border border-zinc-800/60 rounded-xl p-3">

                  {/* Body stats */}
                  <div>
                    <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold mb-2">Thông tin cơ thể</p>
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        { label: 'Cân nặng (kg)', key: 'weightKg', ph: '70' },
                        { label: 'Chiều cao (cm)', key: 'heightCm', ph: '170' },
                        { label: 'Tuổi', key: 'age', ph: '25' },
                      ].map(f => (
                        <div key={f.key}>
                          <label className="text-[10px] text-zinc-600 mb-0.5 block">{f.label}</label>
                          <input type="number" placeholder={f.ph} value={(generateForm as any)[f.key]}
                            onChange={e => setGenerateForm({...generateForm, [f.key]: e.target.value})}
                            className="w-full px-2 py-1.5 bg-zinc-800 border border-zinc-700/60 rounded-lg text-xs text-zinc-200 outline-none focus:border-orange-500/40" />
                        </div>
                      ))}
                    </div>
                    <div className="grid grid-cols-2 gap-2 mt-2">
                      <div>
                        <label className="text-[10px] text-zinc-600 mb-0.5 block">Giới tính</label>
                        <select value={generateForm.gender} onChange={e => setGenerateForm({...generateForm, gender: e.target.value})}
                          className="w-full px-2 py-1.5 bg-zinc-800 border border-zinc-700/60 rounded-lg text-xs text-zinc-200 outline-none">
                          <option value="">--</option>
                          <option value="MALE">Nam</option>
                          <option value="FEMALE">Nữ</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-[10px] text-zinc-600 mb-0.5 block">Body fat % (ước tính)</label>
                        <input type="number" placeholder="18" value={(generateForm as any).bodyFatPct ?? ''}
                          onChange={e => setGenerateForm({...generateForm, bodyFatPct: e.target.value} as any)}
                          className="w-full px-2 py-1.5 bg-zinc-800 border border-zinc-700/60 rounded-lg text-xs text-zinc-200 outline-none focus:border-orange-500/40" />
                      </div>
                    </div>
                  </div>

                  {/* Training */}
                  <div>
                    <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold mb-2">Lịch tập luyện</p>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] text-zinc-600 mb-0.5 block">Mức vận động</label>
                        <select value={generateForm.activityLevel} onChange={e => setGenerateForm({...generateForm, activityLevel: e.target.value})}
                          className="w-full px-2 py-1.5 bg-zinc-800 border border-zinc-700/60 rounded-lg text-xs text-zinc-200 outline-none">
                          <option value="SEDENTARY">Ít vận động</option>
                          <option value="LIGHT">Nhẹ</option>
                          <option value="MODERATE">Trung bình</option>
                          <option value="HIGH">Cao</option>
                          <option value="VERY_HIGH">Rất cao</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-[10px] text-zinc-600 mb-0.5 block">Buổi tập/tuần</label>
                        <input type="number" min={0} max={7} placeholder="4" value={generateForm.trainingDaysPerWeek}
                          onChange={e => setGenerateForm({...generateForm, trainingDaysPerWeek: e.target.value})}
                          className="w-full px-2 py-1.5 bg-zinc-800 border border-zinc-700/60 rounded-lg text-xs text-zinc-200 outline-none" />
                      </div>
                      <div>
                        <label className="text-[10px] text-zinc-600 mb-0.5 block">Thời gian/buổi (phút)</label>
                        <input type="number" placeholder="60" value={generateForm.trainingDurationMin}
                          onChange={e => setGenerateForm({...generateForm, trainingDurationMin: e.target.value})}
                          className="w-full px-2 py-1.5 bg-zinc-800 border border-zinc-700/60 rounded-lg text-xs text-zinc-200 outline-none" />
                      </div>
                      <div>
                        <label className="text-[10px] text-zinc-600 mb-0.5 block">Loại tập</label>
                        <select value={generateForm.trainingType} onChange={e => setGenerateForm({...generateForm, trainingType: e.target.value})}
                          className="w-full px-2 py-1.5 bg-zinc-800 border border-zinc-700/60 rounded-lg text-xs text-zinc-200 outline-none">
                          <option value="">--</option>
                          <option value="weights">Tạ kháng lực</option>
                          <option value="cardio">Cardio</option>
                          <option value="mixed">Kết hợp</option>
                          <option value="combat">Thể thao đối kháng</option>
                          <option value="endurance">Sức bền</option>
                        </select>
                      </div>
                    </div>
                  </div>

                  {/* Advanced phase */}
                  <div>
                    <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold mb-2">Giai đoạn & Kinh nghiệm</p>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] text-zinc-600 mb-0.5 block">Giai đoạn hiện tại</label>
                        <select value={generateForm.trainingPhase} onChange={e => setGenerateForm({...generateForm, trainingPhase: e.target.value})}
                          className="w-full px-2 py-1.5 bg-zinc-800 border border-zinc-700/60 rounded-lg text-xs text-zinc-200 outline-none">
                          <option value="">--</option>
                          <option value="cutting">Cutting</option>
                          <option value="bulking">Bulking</option>
                          <option value="lean_bulk">Lean Bulk</option>
                          <option value="maintenance">Maintenance</option>
                          <option value="contest_prep">Chuẩn bị thi đấu</option>
                          <option value="deload">Deload</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-[10px] text-zinc-600 mb-0.5 block">Kinh nghiệm</label>
                        <select value={generateForm.experienceLevel} onChange={e => setGenerateForm({...generateForm, experienceLevel: e.target.value})}
                          className="w-full px-2 py-1.5 bg-zinc-800 border border-zinc-700/60 rounded-lg text-xs text-zinc-200 outline-none">
                          <option value="">--</option>
                          <option value="BEGINNER">Mới bắt đầu</option>
                          <option value="INTERMEDIATE">Trung cấp</option>
                          <option value="ADVANCED">Nâng cao</option>
                          <option value="ATHLETE">Vận động viên</option>
                        </select>
                      </div>
                    </div>
                    <div className="mt-2">
                      <label className="text-[10px] text-zinc-600 mb-0.5 block">Protein target (g/ngày, để AI tự tính nếu bỏ trống)</label>
                      <input type="number" placeholder="AI tự tính" value={generateForm.proteinTargetG}
                        onChange={e => setGenerateForm({...generateForm, proteinTargetG: e.target.value})}
                        className="w-full px-2 py-1.5 bg-zinc-800 border border-zinc-700/60 rounded-lg text-xs text-zinc-200 outline-none" />
                    </div>
                    <div className="flex flex-wrap gap-2 mt-2">
                      {[
                        { key: 'carbsAroundWorkout', label: 'Carbs tập trung quanh buổi tập' },
                        { key: 'preworkoutMeal', label: 'Cần bữa trước tập' },
                        { key: 'postworkoutMeal', label: 'Cần bữa sau tập' },
                      ].map(opt => (
                        <button key={opt.key} type="button"
                          onClick={() => setGenerateForm({...generateForm, [opt.key]: !(generateForm as any)[opt.key]} as any)}
                          className={`px-2.5 py-1 text-[10px] rounded-lg border transition-all ${(generateForm as any)[opt.key] ? 'border-orange-500/40 bg-orange-500/10 text-orange-300' : 'border-zinc-700/50 text-zinc-500 hover:border-zinc-600'}`}>
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Restrictions */}
                  <div>
                    <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold mb-2">Hạn chế thực phẩm</p>
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {RESTRICTION_PRESETS.map(r => (
                        <button key={r} type="button"
                          onClick={() => setGenerateForm(f => ({...f, restrictions: f.restrictions.includes(r) ? f.restrictions.filter(x => x !== r) : [...f.restrictions, r]}))}
                          className={`px-2 py-1 text-[10px] rounded-lg border transition-all ${generateForm.restrictions.includes(r) ? 'border-red-500/40 bg-red-500/10 text-red-300' : 'border-zinc-700/50 text-zinc-500 hover:border-zinc-600'}`}>
                          {r}
                        </button>
                      ))}
                    </div>
                    <input placeholder="Ghi thêm dị ứng/hạn chế khác..." value={generateForm.customRestriction}
                      onChange={e => setGenerateForm({...generateForm, customRestriction: e.target.value})}
                      className="w-full px-2.5 py-1.5 bg-zinc-800 border border-zinc-700/60 rounded-lg text-xs text-zinc-200 outline-none focus:border-orange-500/40" />
                  </div>

                  {/* Notes */}
                  <div>
                    <label className="text-[10px] text-zinc-600 mb-0.5 block">Ghi chú thêm cho AI</label>
                    <textarea rows={2} placeholder="Ví dụ: ưu tiên thực phẩm dễ nấu, ăn được cay..."
                      value={generateForm.notes} onChange={e => setGenerateForm({...generateForm, notes: e.target.value})}
                      className="w-full px-2.5 py-1.5 bg-zinc-800 border border-zinc-700/60 rounded-lg text-xs text-zinc-200 outline-none resize-none" />
                  </div>
                </div>
              )}

              <p className="text-xs text-zinc-600">Kế hoạch 7 ngày sẽ được tạo trong vòng 2-5 phút.</p>
            </div>
            <div className="p-4 border-t border-zinc-800/60 flex gap-3 shrink-0">
              <button onClick={() => setShowGenerateModal(false)} className="flex-1 py-2.5 border border-zinc-700/60 text-zinc-300 text-sm font-semibold rounded-lg hover:bg-zinc-800">Hủy</button>
              <button
                onClick={() => {
                  const payload: any = {
                    ...generateForm,
                    durationWeeks: 1,
                    restrictions: [
                      ...generateForm.restrictions,
                      ...(generateForm.customRestriction.trim() ? [generateForm.customRestriction.trim()] : []),
                    ].filter(Boolean),
                  };
                  // Clean up empty fields
                  ['weightKg', 'heightCm', 'age', 'trainingDaysPerWeek', 'trainingDurationMin', 'proteinTargetG'].forEach(k => {
                    if (payload[k] === '' || payload[k] === undefined) delete payload[k];
                    else payload[k] = Number(payload[k]);
                  });
                  ['gender', 'trainingType', 'trainingPhase', 'experienceLevel', 'primaryPriority'].forEach(k => {
                    if (!payload[k]) delete payload[k];
                  });
                  generateMutation.mutate(payload);
                }}
                disabled={generateMutation.isPending}
                className="flex-1 py-2.5 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-400 hover:to-amber-400 text-black text-sm font-bold rounded-lg disabled:opacity-50"
              >
                {generateMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : 'Tạo kế hoạch'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Save modal (with dates) ── */}
      {showSaveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-zinc-900 border border-zinc-700/60 rounded-2xl w-full max-w-sm shadow-2xl">
            <div className="flex items-center justify-between p-4 border-b border-zinc-800/60">
              <h3 className="text-zinc-100 font-bold text-sm flex items-center gap-2">
                <CalendarDays className="w-4 h-4 text-green-400" /> Lưu kế hoạch vào Dinh dưỡng
              </h3>
              <button onClick={() => setShowSaveModal(null)} className="text-zinc-500 hover:text-zinc-300"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-4 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-zinc-500 font-semibold mb-1 block">Ngày bắt đầu <span className="text-red-400">*</span></label>
                  <input type="date" value={saveDateForm.startDate}
                    onChange={e => setSaveDateForm({...saveDateForm, startDate: e.target.value})}
                    className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 outline-none focus:border-green-500/50 [color-scheme:dark]" />
                </div>
                <div>
                  <label className="text-xs text-zinc-500 font-semibold mb-1 block">Ngày kết thúc</label>
                  <input type="date" value={saveDateForm.endDate}
                    min={saveDateForm.startDate}
                    onChange={e => setSaveDateForm({...saveDateForm, endDate: e.target.value})}
                    className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 outline-none focus:border-green-500/50 [color-scheme:dark]" />
                </div>
              </div>

              {/* Repeat toggle */}
              <div className="flex items-center justify-between px-3 py-2.5 bg-zinc-800/50 border border-zinc-700/40 rounded-xl">
                <div>
                  <p className="text-xs font-semibold text-zinc-200">Lặp lại thực đơn 7 ngày</p>
                  <p className="text-[10px] text-zinc-500 mt-0.5">Ngày thứ 8 sẽ quay lại Day 1, ngày thứ 9 → Day 2...</p>
                </div>
                <button onClick={() => setSaveDateForm(f => ({...f, repeatEnabled: !f.repeatEnabled}))}
                  className={`w-10 h-6 rounded-full transition-colors shrink-0 ${saveDateForm.repeatEnabled ? 'bg-green-500' : 'bg-zinc-700'}`}>
                  <div className={`w-4 h-4 bg-white rounded-full shadow transition-transform mx-1 ${saveDateForm.repeatEnabled ? 'translate-x-4' : 'translate-x-0'}`} />
                </button>
              </div>

              {/* Force archive */}
              <div className="flex items-center gap-2 text-xs text-zinc-400">
                <input type="checkbox" id="forceArchive" checked={saveDateForm.forceArchive}
                  onChange={e => setSaveDateForm({...saveDateForm, forceArchive: e.target.checked})}
                  className="rounded border-zinc-700" />
                <label htmlFor="forceArchive">Thay thế kế hoạch đang áp dụng (nếu có)</label>
              </div>

              <p className="text-xs text-zinc-600">Nếu không chọn ngày kết thúc, kế hoạch áp dụng đúng 7 ngày từ ngày bắt đầu.</p>
            </div>
            <div className="p-4 border-t border-zinc-800/60 flex gap-3">
              <button onClick={() => setShowSaveModal(null)} className="flex-1 py-2.5 border border-zinc-700/60 text-zinc-300 text-sm rounded-lg hover:bg-zinc-800">Hủy</button>
              <button
                onClick={() => {
                  if (!saveDateForm.startDate) { toast.error('Vui lòng chọn ngày bắt đầu.'); return; }
                  if (saveDateForm.endDate && saveDateForm.endDate < saveDateForm.startDate) { toast.error('Ngày kết thúc phải sau ngày bắt đầu.'); return; }
                  saveMutation.mutate({ planId: showSaveModal!, form: saveDateForm });
                }}
                disabled={saveMutation.isPending || !saveDateForm.startDate}
                className="flex-1 py-2.5 bg-green-500 hover:bg-green-400 text-black text-sm font-bold rounded-lg disabled:opacity-50"
              >
                {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : 'Lưu vào Dinh dưỡng'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Adjust modal */}
      {showAdjustModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-zinc-900 border border-zinc-700/60 rounded-2xl w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between p-5 border-b border-zinc-800/60">
              <h3 className="text-zinc-100 font-bold">Điều chỉnh kế hoạch</h3>
              <button onClick={() => setShowAdjustModal(null)} className="text-zinc-500 hover:text-zinc-300"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5">
              <label className="text-xs text-zinc-500 font-semibold mb-2 block">Yêu cầu điều chỉnh</label>
              <textarea
                rows={4}
                value={adjustText}
                onChange={(e) => setAdjustText(e.target.value)}
                placeholder="Ví dụ: Tăng protein, giảm carb, không dùng cá biển, thêm bữa ăn nhẹ buổi chiều..."
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 outline-none focus:border-orange-500/50 resize-none"
              />
              <p className="text-xs text-zinc-600 mt-2">Kế hoạch mới sẽ được tạo dựa trên yêu cầu của bạn.</p>
            </div>
            <div className="p-5 border-t border-zinc-800/60 flex gap-3">
              <button onClick={() => setShowAdjustModal(null)} className="flex-1 py-2.5 border border-zinc-700/60 text-zinc-300 text-sm rounded-lg hover:bg-zinc-800">Hủy</button>
              <button
                onClick={() => adjustMutation.mutate({ planId: showAdjustModal, text: adjustText })}
                disabled={adjustMutation.isPending || adjustText.trim().length < 5}
                className="flex-1 py-2.5 bg-orange-500 hover:bg-orange-400 text-black text-sm font-bold rounded-lg disabled:opacity-50"
              >
                {adjustMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : 'Điều chỉnh'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
