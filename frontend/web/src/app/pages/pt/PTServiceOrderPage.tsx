import { useState } from "react";
import { useParams, useNavigate } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, ArrowLeft, Sparkles, Plus, Trash2, Search, AlertTriangle, Send, MessageSquare, Star } from "lucide-react";
import {
  personalizedServiceApi,
  ptCoachService,
  workoutService,
  chatService,
  CONSENT_CATEGORY_LABELS,
  type PersonalizedServiceOrderStatus,
} from "../../services/api";

/**
 * Marketplace rework — PT-side order workspace (§XV/§XVII-XX). Reuses the
 * SAME draft-building UX as AssignPlanModal.tsx (AI-assist + exercise
 * search + manual editing) — the only difference is the submit action:
 * this calls personalizedServiceApi.deliverDraft (stores the draft for the
 * CLIENT to review/Accept) instead of ptCoachService.createAndAssignPlan
 * (which commits directly) — Personalized Service orders always go through
 * an explicit client Accept before anything is scheduled.
 */

const WEEKDAY_LABEL = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];

const STATUS_LABEL: Record<PersonalizedServiceOrderStatus, string> = {
  PURCHASED: "Đã mua",
  INTAKE_PENDING: "Chờ khách điền Intake",
  INTAKE_SUBMITTED: "Khách đã gửi Intake",
  PT_REVIEWING: "Đang phân tích",
  IN_PROGRESS: "Đang soạn kế hoạch",
  DRAFT_DELIVERED: "Đã gửi bản nháp — chờ khách phản hồi",
  REVISION_REQUESTED: "Khách yêu cầu chỉnh sửa",
  REVISION_IN_PROGRESS: "Đang chỉnh sửa",
  ACCEPTED: "Khách đã chấp nhận",
  ACTIVE: "Đang huấn luyện",
  COMPLETED: "Hoàn thành",
  CANCELLED: "Đã huỷ",
  REFUND_REQUESTED: "Khách yêu cầu hoàn tiền",
  REFUNDED: "Đã hoàn tiền",
  DISPUTED: "Đang khiếu nại",
};

interface DayExerciseDraft { exerciseId: string; name: string; sets: number; reps: number; restSeconds: number }
interface DayDraft { dayNumber: number; title: string; weekday: number; exercises: DayExerciseDraft[] }
function emptyDay(dayNumber: number, weekday: number): DayDraft {
  return { dayNumber, title: `Buổi ${dayNumber}`, weekday, exercises: [] };
}

function DraftBuilder({ order, onDelivered }: { order: any; onDelivered: () => void }) {
  const [name, setName] = useState(order.titleSnapshot);
  const [durationWeeks, setDurationWeeks] = useState(4);
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [days, setDays] = useState<DayDraft[]>([emptyDay(1, 1)]);
  const [exerciseSearch, setExerciseSearch] = useState("");
  const [activeDayIndex, setActiveDayIndex] = useState<number | null>(null);
  const [ptNotes, setPtNotes] = useState("");
  const [aiInfo, setAiInfo] = useState<{ dataGaps: string[]; warnings: string[]; summaryForPt: string } | null>(null);

  const clientUserId = order.buyerId;
  const draftMutation = useMutation({
    mutationFn: () => ptCoachService.generatePlanDraft(clientUserId, { ptNotes: ptNotes.trim() || undefined, daysPerWeek: days.length, durationWeeks }),
    onSuccess: (result) => {
      setAiInfo({ dataGaps: result.dataGaps, warnings: result.warnings, summaryForPt: result.summaryForPt });
      if (result.days.length === 0) {
        toast.error("AI không tạo được bài tập gợi ý — vui lòng tự chọn bài tập.");
        return;
      }
      setDays((prev) =>
        result.days.map((d, i) => ({
          dayNumber: d.dayNumber,
          title: d.title || `Buổi ${d.dayNumber}`,
          weekday: prev[i]?.weekday ?? i,
          exercises: d.exercises.map((e) => ({ exerciseId: e.exerciseId, name: e.exerciseName, sets: e.sets, reps: e.reps, restSeconds: 90 })),
        })),
      );
      toast.success("Đã tạo bản nháp bằng AI — hãy xem lại trước khi giao.");
    },
    onError: (err: any) => toast.error(err?.response?.data?.error || "Không thể tạo bản nháp AI lúc này."),
  });

  const exercisesQuery = useQuery({
    queryKey: ["pt-service-order-exercises", exerciseSearch],
    queryFn: () => workoutService.getExercises({ search: exerciseSearch || undefined, limit: 20 }),
    enabled: activeDayIndex !== null,
  });

  const usedWeekdays = new Set(days.map((d) => d.weekday));
  const addDay = () => days.length < 7 && setDays((prev) => [...prev, emptyDay(prev.length + 1, [0, 1, 2, 3, 4, 5, 6].find((w) => !usedWeekdays.has(w)) ?? 0)]);
  const removeDay = (idx: number) => days.length > 1 && setDays((prev) => prev.filter((_, i) => i !== idx).map((d, i) => ({ ...d, dayNumber: i + 1 })));
  const updateDay = (idx: number, patch: Partial<DayDraft>) => setDays((prev) => prev.map((d, i) => (i === idx ? { ...d, ...patch } : d)));
  const addExerciseToDay = (idx: number, exerciseId: string, exerciseName: string) =>
    setDays((prev) => prev.map((d, i) => (i === idx ? { ...d, exercises: [...d.exercises, { exerciseId, name: exerciseName, sets: 3, reps: 10, restSeconds: 90 }] } : d)));
  const removeExerciseFromDay = (dayIdx: number, exIdx: number) =>
    setDays((prev) => prev.map((d, i) => (i === dayIdx ? { ...d, exercises: d.exercises.filter((_, j) => j !== exIdx) } : d)));

  const deliverMutation = useMutation({
    mutationFn: () => {
      if (!name.trim()) throw new Error("Tên kế hoạch không được để trống");
      if (days.some((d) => d.exercises.length === 0)) throw new Error("Mỗi buổi tập cần có ít nhất 1 bài tập");
      return personalizedServiceApi.deliverDraft(order.id, {
        name: name.trim(),
        goal: order.intakeData?.goal ?? undefined,
        durationWeeks,
        daysPerWeek: days.length,
        startDate,
        selectedWeekdays: days.map((d) => d.weekday),
        days: days.map((d) => ({
          dayNumber: d.dayNumber,
          title: d.title.trim() || `Buổi ${d.dayNumber}`,
          exercises: d.exercises.map((e, order2) => ({ exerciseId: e.exerciseId, order: order2 + 1, sets: e.sets, reps: e.reps, restSeconds: e.restSeconds })),
        })),
      });
    },
    onSuccess: () => {
      toast.success("Đã gửi bản nháp cho khách hàng xem xét.");
      onDelivered();
    },
    onError: (err: any) => toast.error(err?.response?.data?.error?.message ?? err?.message ?? "Không thể gửi bản nháp"),
  });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        <input data-testid="draft-name-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Tên kế hoạch" className="col-span-2 px-3 py-2 bg-zinc-800/60 border border-zinc-700/60 rounded-lg text-sm text-zinc-200" />
        <input type="number" min={1} max={52} value={durationWeeks} onChange={(e) => setDurationWeeks(Number(e.target.value) || 1)} placeholder="Số tuần" className="px-3 py-2 bg-zinc-800/60 border border-zinc-700/60 rounded-lg text-sm text-zinc-200" />
        <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="px-3 py-2 bg-zinc-800/60 border border-zinc-700/60 rounded-lg text-sm text-zinc-200" />
      </div>

      <div className="rounded-xl border border-violet-700/30 bg-violet-950/10 p-3 space-y-2">
        <div className="flex items-center gap-1.5 text-xs text-violet-300 font-semibold"><Sparkles className="w-3.5 h-3.5" /> Gợi ý bằng AI (bản nháp advisory — bạn vẫn chỉnh sửa và chịu trách nhiệm)</div>
        <textarea value={ptNotes} onChange={(e) => setPtNotes(e.target.value)} placeholder="Ghi chú cho AI" rows={2} className="w-full rounded-lg bg-zinc-800/60 border border-zinc-700/60 p-2 text-xs text-zinc-200" />
        <button type="button" onClick={() => draftMutation.mutate()} disabled={draftMutation.isPending} className="flex items-center justify-center gap-1.5 w-full rounded-lg bg-violet-500/15 border border-violet-500/30 text-violet-300 text-xs font-semibold py-2 hover:bg-violet-500/25 disabled:opacity-50">
          {draftMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />} Tạo bản nháp AI cho {days.length} buổi/tuần
        </button>
        {aiInfo && (
          <div className="space-y-1.5 pt-1">
            <p className="text-[11px] text-zinc-400">{aiInfo.summaryForPt}</p>
            {aiInfo.warnings.length > 0 && (
              <div className="flex items-start gap-1.5 rounded-lg border border-amber-700/30 bg-amber-950/20 p-2">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-500/80 flex-shrink-0 mt-0.5" />
                <p className="text-[11px] text-amber-200/80">{aiInfo.warnings.join("; ")}</p>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs text-zinc-300 font-semibold">Các buổi tập ({days.length})</p>
          <button type="button" onClick={addDay} disabled={days.length >= 7} className="flex items-center gap-1 text-xs text-green-400 hover:text-green-300 disabled:opacity-40">
            <Plus className="w-3.5 h-3.5" /> Thêm buổi
          </button>
        </div>
        {days.map((day, dayIdx) => (
          <div key={dayIdx} className="rounded-xl border border-zinc-700/40 bg-zinc-800/20 p-3 space-y-2">
            <div className="flex items-center gap-2">
              <input value={day.title} onChange={(e) => updateDay(dayIdx, { title: e.target.value })} className="flex-1 rounded-lg bg-zinc-800/60 border border-zinc-700/60 p-1.5 text-xs text-zinc-200" />
              <select value={day.weekday} onChange={(e) => updateDay(dayIdx, { weekday: Number(e.target.value) })} className="rounded-lg bg-zinc-800/60 border border-zinc-700/60 p-1.5 text-xs text-zinc-200">
                {WEEKDAY_LABEL.map((label, w) => (
                  <option key={w} value={w} disabled={usedWeekdays.has(w) && w !== day.weekday}>{label}</option>
                ))}
              </select>
              {days.length > 1 && <button onClick={() => removeDay(dayIdx)} className="text-zinc-600 hover:text-red-400"><Trash2 className="w-3.5 h-3.5" /></button>}
            </div>
            <div className="space-y-1">
              {day.exercises.map((ex, exIdx) => (
                <div key={exIdx} className="flex items-center gap-2 text-[11px] bg-zinc-900/40 rounded-lg px-2 py-1.5">
                  <span className="flex-1 text-zinc-300">{ex.name}</span>
                  <input type="number" min={1} max={10} value={ex.sets} onChange={(e) => setDays((prev) => prev.map((d, i) => (i === dayIdx ? { ...d, exercises: d.exercises.map((x, j) => (j === exIdx ? { ...x, sets: Number(e.target.value) || 1 } : x)) } : d)))} className="w-10 rounded bg-zinc-800 border border-zinc-700/60 p-1 text-center" />
                  <span className="text-zinc-600">×</span>
                  <input type="number" min={1} max={50} value={ex.reps} onChange={(e) => setDays((prev) => prev.map((d, i) => (i === dayIdx ? { ...d, exercises: d.exercises.map((x, j) => (j === exIdx ? { ...x, reps: Number(e.target.value) || 1 } : x)) } : d)))} className="w-10 rounded bg-zinc-800 border border-zinc-700/60 p-1 text-center" />
                  <span className="text-zinc-600">reps</span>
                  <button onClick={() => removeExerciseFromDay(dayIdx, exIdx)} className="text-zinc-600 hover:text-red-400"><Trash2 className="w-3 h-3" /></button>
                </div>
              ))}
              {day.exercises.length === 0 && <p className="text-[11px] text-zinc-600 italic">Chưa có bài tập nào</p>}
            </div>
            <button type="button" data-testid={`add-exercise-toggle-${dayIdx}`} onClick={() => setActiveDayIndex(activeDayIndex === dayIdx ? null : dayIdx)} className="flex items-center gap-1 text-[11px] text-zinc-400 hover:text-zinc-200">
              <Search className="w-3 h-3" /> {activeDayIndex === dayIdx ? "Đóng tìm kiếm" : "Thêm bài tập"}
            </button>
            {activeDayIndex === dayIdx && (
              <div className="rounded-lg border border-zinc-700/40 bg-zinc-900/60 p-2">
                <input data-testid="exercise-search-input" value={exerciseSearch} onChange={(e) => setExerciseSearch(e.target.value)} placeholder="Tìm bài tập..." className="w-full rounded-lg bg-zinc-800/60 border border-zinc-700/60 p-1.5 text-xs text-zinc-200 mb-2" />
                <div className="max-h-40 overflow-y-auto space-y-1" data-testid="exercise-search-results">
                  {(exercisesQuery.data ?? []).map((ex: any) => (
                    <button key={ex.id} data-testid="exercise-search-result-item" onClick={() => addExerciseToDay(dayIdx, ex.id, ex.exerciseName)} className="w-full text-left text-[11px] text-zinc-300 hover:bg-zinc-800/60 rounded px-2 py-1">
                      {ex.exerciseName}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      <button data-testid="deliver-draft-button" onClick={() => deliverMutation.mutate()} disabled={deliverMutation.isPending} className="w-full flex items-center justify-center gap-2 rounded-xl bg-green-500 hover:bg-green-400 disabled:opacity-60 py-2.5 text-sm font-bold text-black">
        {deliverMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Gửi bản nháp cho khách hàng
      </button>
    </div>
  );
}

function ChatWithBuyerButton({ buyerId }: { buyerId: string }) {
  const navigate = useNavigate();
  const mutation = useMutation({
    mutationFn: () => chatService.createDirectConversation(buyerId),
    onSuccess: (conv: any) => navigate(`/pt/chat?conversationId=${conv.id ?? conv.data?.id}`),
    onError: (err: any) => toast.error(err?.response?.data?.error ?? "Không thể mở đoạn chat."),
  });
  return (
    <button
      data-testid="chat-with-buyer-button"
      onClick={() => mutation.mutate()}
      disabled={mutation.isPending}
      className="w-full py-2.5 rounded-xl border border-zinc-700 text-zinc-300 text-sm font-semibold hover:bg-zinc-800 flex items-center justify-center gap-1.5 disabled:opacity-50"
    >
      {mutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <MessageSquare className="w-4 h-4" />} Nhắn tin với khách hàng
    </button>
  );
}

function PtCheckInHistory({ orderId }: { orderId: string }) {
  const q = useQuery({ queryKey: ["personalized-service-checkins", orderId], queryFn: () => personalizedServiceApi.listCheckIns(orderId) });
  if (!q.data || q.data.length === 0) return <p className="text-xs text-zinc-600">Khách hàng chưa gửi check-in nào.</p>;
  return (
    <div className="space-y-2">
      {q.data.map((c) => (
        <div key={c.id} className={`rounded-lg p-2.5 text-xs flex items-center justify-between gap-2 ${c.requiresAttention ? "bg-amber-500/10 border border-amber-500/30" : "bg-zinc-800/40"}`}>
          <span className="text-zinc-300">
            {new Date(c.createdAt).toLocaleDateString("vi-VN")} · Năng lượng {c.energyLevel}/5 · Ngủ {c.sleepQuality}/5 · RPE {c.overallRpe} · Tuân thủ tập {c.workoutAdherence}%
            {c.notes ? ` — "${c.notes}"` : ""}
          </span>
          {c.requiresAttention && <span className="text-amber-400 font-bold whitespace-nowrap">⚠ Đau {c.painOrDiscomfort}/10</span>}
        </div>
      ))}
    </div>
  );
}

export function PTServiceOrderPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const orderQuery = useQuery({
    queryKey: ["personalized-service-order", id],
    queryFn: () => personalizedServiceApi.getOrder(id!),
    enabled: !!id,
  });

  const startReviewMutation = useMutation({
    mutationFn: () => personalizedServiceApi.startReview(id!),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["personalized-service-order", id] }),
  });
  const startRevisionMutation = useMutation({
    mutationFn: () => personalizedServiceApi.startRevisionWork(id!),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["personalized-service-order", id] }),
  });

  if (orderQuery.isLoading) return <div className="flex items-center justify-center min-h-[400px]"><Loader2 className="w-8 h-8 text-green-500 animate-spin" /></div>;
  const order = orderQuery.data;
  if (!order) return null;

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto space-y-5">
      <button onClick={() => navigate("/pt/dashboard")} className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300">
        <ArrowLeft className="w-3.5 h-3.5" /> Quay lại
      </button>

      <div>
        <h1 className="text-zinc-100 text-xl font-bold">{order.titleSnapshot}</h1>
        <span data-testid="pt-order-status-badge" data-status={order.status} className="inline-flex items-center gap-1.5 mt-2 px-2.5 py-1 rounded-lg bg-zinc-800 text-xs font-semibold text-zinc-300">{STATUS_LABEL[order.status]}</span>
      </div>

      {order.status === "INTAKE_SUBMITTED" && (
        <>
          <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900 p-4 space-y-3">
            <h2 className="text-sm font-bold text-zinc-200">Thông tin Intake khách hàng đã chia sẻ</h2>
            <p className="text-[11px] text-zinc-600">Chỉ hiển thị các mục khách hàng đã đồng ý chia sẻ.</p>
            <div className="grid grid-cols-2 gap-2 text-xs">
              {Object.entries(order.intakeData ?? {}).map(([key, value]) => (
                <div key={key} className="rounded-lg bg-zinc-800/50 p-2">
                  <p className="text-zinc-600">{key}</p>
                  <p className="text-zinc-200">{Array.isArray(value) ? value.join(", ") : String(value)}</p>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-1 pt-1">
              {(order.consentCategories ?? []).map((c) => (
                <span key={c} className="text-[10px] text-green-400 bg-green-500/10 rounded px-1.5 py-0.5">✓ {CONSENT_CATEGORY_LABELS[c] ?? c}</span>
              ))}
            </div>
          </div>
          <button data-testid="start-review-button" onClick={() => startReviewMutation.mutate()} disabled={startReviewMutation.isPending} className="w-full py-2.5 rounded-xl bg-green-500 text-black text-sm font-bold hover:bg-green-400 disabled:opacity-40">
            Bắt đầu phân tích & soạn kế hoạch
          </button>
        </>
      )}

      {["PT_REVIEWING", "IN_PROGRESS"].includes(order.status) && (
        <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900 p-4">
          <h2 className="text-sm font-bold text-zinc-200 mb-3">Soạn kế hoạch cá nhân hóa</h2>
          <DraftBuilder order={order} onDelivered={() => queryClient.invalidateQueries({ queryKey: ["personalized-service-order", id] })} />
        </div>
      )}

      {order.status === "DRAFT_DELIVERED" && (
        <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900 p-6 text-center">
          <p className="text-sm text-zinc-300">Đã gửi bản nháp — đang chờ khách hàng xem xét.</p>
        </div>
      )}

      {order.status === "REVISION_REQUESTED" && (
        <>
          <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 space-y-2">
            <h2 className="text-sm font-bold text-amber-300">Khách hàng yêu cầu chỉnh sửa</h2>
            {(order.revisionRequests ?? []).slice(0, 1).map((r: any) => (
              <p key={r.id} className="text-sm text-zinc-300">[{r.category}] {r.comment}</p>
            ))}
          </div>
          <button onClick={() => startRevisionMutation.mutate()} disabled={startRevisionMutation.isPending} className="w-full py-2.5 rounded-xl bg-green-500 text-black text-sm font-bold hover:bg-green-400 disabled:opacity-40">
            Bắt đầu chỉnh sửa
          </button>
        </>
      )}

      {order.status === "REVISION_IN_PROGRESS" && (
        <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900 p-4">
          <h2 className="text-sm font-bold text-zinc-200 mb-3">Chỉnh sửa kế hoạch</h2>
          <DraftBuilder order={order} onDelivered={() => queryClient.invalidateQueries({ queryKey: ["personalized-service-order", id] })} />
        </div>
      )}

      {["ACCEPTED", "ACTIVE", "COMPLETED"].includes(order.status) && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-green-500/30 bg-green-500/5 p-6 text-center space-y-3">
            <p className="text-sm text-zinc-200 font-semibold">Khách hàng đã chấp nhận kế hoạch — đã bắt đầu training cycle thật.</p>
            <ChatWithBuyerButton buyerId={order.buyerId} />
          </div>

          {order.status === "ACTIVE" && (
            <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900 p-4 space-y-3">
              <h2 className="text-sm font-bold text-zinc-200">Check-in của khách hàng</h2>
              <PtCheckInHistory orderId={order.id} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
