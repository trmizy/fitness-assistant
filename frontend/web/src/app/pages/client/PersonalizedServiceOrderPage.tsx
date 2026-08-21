import { useState } from "react";
import { useParams, useNavigate } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, ShieldCheck, CheckCircle, MessageSquare, ArrowLeft, ThumbsUp, Send, History, Star } from "lucide-react";
import {
  personalizedServiceApi,
  workoutService,
  chatService,
  CONSENT_CATEGORY_LABELS,
  type PersonalizedServiceOrderStatus,
} from "../../services/api";
import { StarRating } from "../../components/StarRating";

/**
 * Marketplace rework — buyer-side order workspace for a Personalized PT
 * Service (§XII-XXVI). Handles the ENTIRE lifecycle in one page since it's
 * fundamentally one continuous flow the buyer revisits at each stage:
 * Intake -> waiting -> Draft review -> Revision/Accept -> Active/Complete.
 */

const STATUS_LABEL: Record<PersonalizedServiceOrderStatus, string> = {
  PURCHASED: "Đã mua",
  INTAKE_PENDING: "Chờ điền Intake",
  INTAKE_SUBMITTED: "Đã gửi Intake — chờ PT xem xét",
  PT_REVIEWING: "PT đang phân tích",
  IN_PROGRESS: "PT đang soạn kế hoạch",
  DRAFT_DELIVERED: "PT đã gửi bản nháp",
  REVISION_REQUESTED: "Đã yêu cầu chỉnh sửa",
  REVISION_IN_PROGRESS: "PT đang chỉnh sửa",
  ACCEPTED: "Đã chấp nhận",
  ACTIVE: "Đang huấn luyện",
  COMPLETED: "Hoàn thành",
  CANCELLED: "Đã huỷ",
  REFUND_REQUESTED: "Đã yêu cầu hoàn tiền",
  REFUNDED: "Đã hoàn tiền",
  DISPUTED: "Đang khiếu nại",
};

function IntakeForm({ orderId }: { orderId: string }) {
  const queryClient = useQueryClient();
  const [age, setAge] = useState("");
  const [gender, setGender] = useState("");
  const [heightCm, setHeightCm] = useState("");
  const [weight, setWeight] = useState("");
  const [targetWeight, setTargetWeight] = useState("");
  const [goal, setGoal] = useState("MUSCLE_GAIN");
  const [experienceLevel, setExperienceLevel] = useState("INTERMEDIATE");
  const [daysPerWeek, setDaysPerWeek] = useState("4");
  const [trainingLocation, setTrainingLocation] = useState("GYM");
  const [injuries, setInjuries] = useState("");
  const [notes, setNotes] = useState("");
  const [consent, setConsent] = useState<Set<string>>(new Set(["basic_info", "training_goals", "experience"]));

  const toggleConsent = (key: string) => {
    setConsent((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const submitMutation = useMutation({
    mutationFn: () =>
      personalizedServiceApi.submitIntake(orderId, {
        intakeData: {
          age: age ? Number(age) : undefined,
          gender: gender || undefined,
          heightCm: heightCm ? Number(heightCm) : undefined,
          weight: weight ? Number(weight) : undefined,
          targetWeight: targetWeight ? Number(targetWeight) : undefined,
          goal,
          experienceLevel,
          daysPerWeek: Number(daysPerWeek),
          trainingLocation,
          injuries: injuries ? injuries.split(",").map((s) => s.trim()).filter(Boolean) : [],
          notes: notes || undefined,
        },
        consentCategories: [...consent],
      }),
    onSuccess: () => {
      toast.success("Đã gửi Intake — PT sẽ bắt đầu phân tích và cá nhân hóa.");
      queryClient.invalidateQueries({ queryKey: ["personalized-service-order", orderId] });
    },
    onError: (err: any) => toast.error(err?.response?.data?.error?.message ?? "Không thể gửi Intake."),
  });

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-bold text-zinc-200 mb-2">Cơ thể</h3>
        <div className="grid grid-cols-2 gap-2">
          <input value={age} onChange={(e) => setAge(e.target.value)} type="number" placeholder="Tuổi" className="px-3 py-2 bg-zinc-800/60 border border-zinc-700/60 rounded-lg text-sm text-zinc-200" />
          <select value={gender} onChange={(e) => setGender(e.target.value)} className="px-3 py-2 bg-zinc-800/60 border border-zinc-700/60 rounded-lg text-sm text-zinc-200">
            <option value="">Giới tính</option>
            <option value="MALE">Nam</option>
            <option value="FEMALE">Nữ</option>
            <option value="OTHER">Khác</option>
          </select>
          <input value={heightCm} onChange={(e) => setHeightCm(e.target.value)} type="number" placeholder="Chiều cao (cm)" className="px-3 py-2 bg-zinc-800/60 border border-zinc-700/60 rounded-lg text-sm text-zinc-200" />
          <input value={weight} onChange={(e) => setWeight(e.target.value)} type="number" placeholder="Cân nặng (kg)" className="px-3 py-2 bg-zinc-800/60 border border-zinc-700/60 rounded-lg text-sm text-zinc-200" />
          <input value={targetWeight} onChange={(e) => setTargetWeight(e.target.value)} type="number" placeholder="Cân nặng mục tiêu (kg)" className="px-3 py-2 bg-zinc-800/60 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 col-span-2" />
        </div>
      </div>

      <div>
        <h3 className="text-sm font-bold text-zinc-200 mb-2">Mục tiêu & Trình độ</h3>
        <div className="grid grid-cols-2 gap-2">
          <select value={goal} onChange={(e) => setGoal(e.target.value)} className="px-3 py-2 bg-zinc-800/60 border border-zinc-700/60 rounded-lg text-sm text-zinc-200">
            <option value="MUSCLE_GAIN">Tăng cơ</option>
            <option value="WEIGHT_LOSS">Giảm mỡ</option>
            <option value="MAINTENANCE">Duy trì</option>
            <option value="ATHLETIC_PERFORMANCE">Hiệu suất thể thao</option>
          </select>
          <select value={experienceLevel} onChange={(e) => setExperienceLevel(e.target.value)} className="px-3 py-2 bg-zinc-800/60 border border-zinc-700/60 rounded-lg text-sm text-zinc-200">
            <option value="BEGINNER">Mới bắt đầu</option>
            <option value="INTERMEDIATE">Đã biết tập</option>
            <option value="ADVANCED">Nâng cao</option>
          </select>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-bold text-zinc-200 mb-2">Tập luyện</h3>
        <div className="grid grid-cols-2 gap-2">
          <input value={daysPerWeek} onChange={(e) => setDaysPerWeek(e.target.value)} type="number" min={1} max={7} placeholder="Ngày/tuần" className="px-3 py-2 bg-zinc-800/60 border border-zinc-700/60 rounded-lg text-sm text-zinc-200" />
          <select value={trainingLocation} onChange={(e) => setTrainingLocation(e.target.value)} className="px-3 py-2 bg-zinc-800/60 border border-zinc-700/60 rounded-lg text-sm text-zinc-200">
            <option value="GYM">Phòng gym</option>
            <option value="HOME">Tại nhà</option>
            <option value="BOTH">Cả hai</option>
          </select>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-bold text-zinc-200 mb-2">Sức khỏe & Hạn chế</h3>
        <input value={injuries} onChange={(e) => setInjuries(e.target.value)} placeholder="Chấn thương (cách nhau bằng dấu phẩy)" className="w-full px-3 py-2 bg-zinc-800/60 border border-zinc-700/60 rounded-lg text-sm text-zinc-200" />
      </div>

      <div>
        <h3 className="text-sm font-bold text-zinc-200 mb-2">Ghi chú thêm</h3>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="w-full px-3 py-2 bg-zinc-800/60 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 resize-none" />
      </div>

      <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3.5 space-y-2">
        <p className="text-xs font-semibold text-amber-300">
          Dữ liệu sẽ được chia sẻ với PT để cá nhân hóa dịch vụ. Chọn những mục bạn đồng ý chia sẻ:
        </p>
        <div className="grid grid-cols-2 gap-1.5">
          {Object.entries(CONSENT_CATEGORY_LABELS).map(([key, label]) => (
            <label key={key} className="flex items-center gap-1.5 text-xs text-zinc-300">
              <input type="checkbox" checked={consent.has(key)} onChange={() => toggleConsent(key)} className="accent-green-500" />
              {label}
            </label>
          ))}
        </div>
      </div>

      <button
        data-testid="intake-submit-button"
        onClick={() => submitMutation.mutate()}
        disabled={submitMutation.isPending || consent.size === 0}
        className="w-full py-3 rounded-xl bg-green-500 text-black text-sm font-bold hover:bg-green-400 disabled:opacity-40"
      >
        {submitMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : "Đồng ý chia sẻ & Gửi Intake"}
      </button>
    </div>
  );
}

function DraftView({ draft }: { draft: Awaited<ReturnType<typeof personalizedServiceApi.getOrder>>["draftContent"] }) {
  // draftContent stores exercises as {exerciseId, sets, reps, ...} only (the
  // exact shape fitness-service's createManualProgramSchema expects — see
  // personalized-service.service.ts's header comment) — never a display
  // name, so it must be resolved from the catalog here, the same way
  // AI-generated plan content resolves names elsewhere in the app (see
  // workoutService.getExercisesByIds's doc comment).
  const allIds = draft ? [...new Set(draft.days.flatMap((d: any) => d.exercises.map((e: any) => e.exerciseId)))] : [];
  const namesQuery = useQuery({
    queryKey: ["exercise-names", allIds],
    queryFn: () => workoutService.getExercisesByIds(allIds as string[]),
    enabled: allIds.length > 0,
  });
  const nameById = new Map((namesQuery.data ?? []).map((ex: any) => [ex.id, ex.exerciseName]));

  if (!draft) return null;
  return (
    <div className="space-y-3" data-testid="draft-view">
      <p className="text-sm font-semibold text-zinc-200">{draft.name}</p>
      {draft.days.map((day: any) => (
        <div key={day.dayNumber} className="rounded-xl border border-zinc-800/60 bg-zinc-900 p-3">
          <p className="text-xs font-bold text-green-400 mb-1.5">Ngày {day.dayNumber} — {day.title}</p>
          <div className="space-y-1">
            {day.exercises.map((ex: any, i: number) => (
              <p key={i} className="text-xs text-zinc-400">
                {nameById.get(ex.exerciseId) ?? (namesQuery.isLoading ? "Đang tải…" : ex.exerciseId)} · {ex.sets}×{ex.reps} · nghỉ {ex.restSeconds}s{ex.notes ? ` — ${ex.notes}` : ""}
              </p>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function RevisionForm({ orderId, onDone }: { orderId: string; onDone: () => void }) {
  const [category, setCategory] = useState("EXERCISE");
  const [comment, setComment] = useState("");
  const mutation = useMutation({
    mutationFn: () => personalizedServiceApi.requestRevision(orderId, { category, comment }),
    onSuccess: () => {
      toast.success("Đã gửi yêu cầu chỉnh sửa cho PT.");
      onDone();
    },
    onError: (err: any) => toast.error(err?.response?.data?.error?.message ?? "Không thể gửi yêu cầu chỉnh sửa."),
  });
  return (
    <div className="space-y-2 rounded-xl border border-zinc-700/60 p-3">
      <select value={category} onChange={(e) => setCategory(e.target.value)} className="w-full px-3 py-2 bg-zinc-800/60 border border-zinc-700/60 rounded-lg text-sm text-zinc-200">
        <option value="EXERCISE">Bài tập</option>
        <option value="SCHEDULE">Lịch tập</option>
        <option value="DIFFICULTY">Độ khó</option>
        <option value="EQUIPMENT">Thiết bị</option>
        <option value="NUTRITION">Dinh dưỡng</option>
        <option value="OTHER">Khác</option>
      </select>
      <textarea data-testid="revision-comment-input" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Bạn muốn thay đổi điều gì?" rows={2} className="w-full px-3 py-2 bg-zinc-800/60 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 resize-none" />
      <button data-testid="submit-revision-button" onClick={() => mutation.mutate()} disabled={mutation.isPending || !comment} className="w-full py-2 rounded-lg bg-zinc-700 text-zinc-200 text-sm font-semibold hover:bg-zinc-600 disabled:opacity-40">
        {mutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : "Gửi yêu cầu chỉnh sửa"}
      </button>
    </div>
  );
}

function ChatWithPtButton({ sellerId }: { sellerId: string }) {
  const navigate = useNavigate();
  const mutation = useMutation({
    mutationFn: () => chatService.createDirectConversation(sellerId),
    onSuccess: (conv: any) => navigate(`/client/chat?conversationId=${conv.id ?? conv.data?.id}`),
    onError: (err: any) => toast.error(err?.response?.data?.error ?? "Không thể mở đoạn chat."),
  });
  return (
    <button
      data-testid="chat-with-pt-button"
      onClick={() => mutation.mutate()}
      disabled={mutation.isPending}
      className="flex-1 py-2.5 rounded-xl border border-zinc-700 text-zinc-300 text-sm font-semibold hover:bg-zinc-800 flex items-center justify-center gap-1.5 disabled:opacity-50"
    >
      {mutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <MessageSquare className="w-4 h-4" />} Nhắn tin với PT
    </button>
  );
}

function CheckInForm({ orderId, onDone }: { orderId: string; onDone: () => void }) {
  const [energyLevel, setEnergyLevel] = useState(3);
  const [sleepQuality, setSleepQuality] = useState(3);
  const [stressLevel, setStressLevel] = useState(3);
  const [overallRpe, setOverallRpe] = useState("7");
  const [workoutAdherence, setWorkoutAdherence] = useState("100");
  const [nutritionAdherence, setNutritionAdherence] = useState("100");
  const [painOrDiscomfort, setPainOrDiscomfort] = useState(0);
  const [notes, setNotes] = useState("");

  const mutation = useMutation({
    mutationFn: () =>
      personalizedServiceApi.submitCheckIn(orderId, {
        energyLevel, sleepQuality, stressLevel,
        overallRpe: Number(overallRpe), workoutAdherence: Number(workoutAdherence), nutritionAdherence: Number(nutritionAdherence),
        painOrDiscomfort, notes: notes || undefined,
      }),
    onSuccess: (checkIn) => {
      toast.success(checkIn.requiresAttention ? "Đã gửi check-in — PT sẽ chú ý mức đau bạn báo cáo." : "Đã gửi check-in tuần này.");
      onDone();
    },
    onError: (err: any) => toast.error(err?.response?.data?.error?.message ?? "Không thể gửi check-in."),
  });

  const scale5 = (label: string, value: number, setValue: (n: number) => void) => (
    <div>
      <p className="text-xs text-zinc-400 mb-1">{label}: <span className="text-zinc-200 font-semibold">{value}/5</span></p>
      <input type="range" min={1} max={5} value={value} onChange={(e) => setValue(Number(e.target.value))} className="w-full accent-green-500" />
    </div>
  );

  return (
    <div className="space-y-3 rounded-xl border border-zinc-700/60 p-3.5">
      {scale5("Năng lượng", energyLevel, setEnergyLevel)}
      {scale5("Chất lượng giấc ngủ", sleepQuality, setSleepQuality)}
      {scale5("Mức độ căng thẳng", stressLevel, setStressLevel)}
      <div>
        <p className="text-xs text-zinc-400 mb-1">Đau/khó chịu (0 = không, 10 = rất đau): <span className="text-zinc-200 font-semibold">{painOrDiscomfort}/10</span></p>
        <input type="range" min={0} max={10} value={painOrDiscomfort} onChange={(e) => setPainOrDiscomfort(Number(e.target.value))} className="w-full accent-amber-500" />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <input value={overallRpe} onChange={(e) => setOverallRpe(e.target.value)} type="number" min={1} max={10} placeholder="RPE" className="px-2 py-2 bg-zinc-800/60 border border-zinc-700/60 rounded-lg text-xs text-zinc-200" />
        <input value={workoutAdherence} onChange={(e) => setWorkoutAdherence(e.target.value)} type="number" min={0} max={100} placeholder="% Tuân thủ tập" className="px-2 py-2 bg-zinc-800/60 border border-zinc-700/60 rounded-lg text-xs text-zinc-200" />
        <input value={nutritionAdherence} onChange={(e) => setNutritionAdherence(e.target.value)} type="number" min={0} max={100} placeholder="% Tuân thủ ăn" className="px-2 py-2 bg-zinc-800/60 border border-zinc-700/60 rounded-lg text-xs text-zinc-200" />
      </div>
      <textarea data-testid="checkin-notes-input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ghi chú thêm cho PT..." rows={2} className="w-full px-3 py-2 bg-zinc-800/60 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 resize-none" />
      <button data-testid="submit-checkin-button" onClick={() => mutation.mutate()} disabled={mutation.isPending} className="w-full py-2.5 rounded-xl bg-green-500 text-black text-sm font-bold hover:bg-green-400 disabled:opacity-40 flex items-center justify-center gap-1.5">
        {mutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Gửi check-in tuần này
      </button>
    </div>
  );
}

function CheckInHistory({ orderId }: { orderId: string }) {
  const q = useQuery({ queryKey: ["personalized-service-checkins", orderId], queryFn: () => personalizedServiceApi.listCheckIns(orderId) });
  if (!q.data || q.data.length === 0) return null;
  return (
    <div className="space-y-2" data-testid="checkin-history">
      {q.data.map((c) => (
        <div key={c.id} className="rounded-lg bg-zinc-800/40 p-2.5 text-xs text-zinc-400 flex items-center justify-between gap-2">
          <span>{new Date(c.createdAt).toLocaleDateString("vi-VN")} · Năng lượng {c.energyLevel}/5 · RPE {c.overallRpe} · Đau {c.painOrDiscomfort ?? 0}/10</span>
          {c.requiresAttention && <span className="text-amber-400 font-semibold whitespace-nowrap">⚠ Cần chú ý</span>}
        </div>
      ))}
    </div>
  );
}

function PlanHistory({ orderId }: { orderId: string }) {
  const q = useQuery({ queryKey: ["personalized-service-versions", orderId], queryFn: () => personalizedServiceApi.listVersions(orderId) });
  if (!q.data || q.data.length <= 1) return null; // only show history once there's more than one version
  return (
    <div className="space-y-1.5" data-testid="plan-history">
      <p className="text-xs font-semibold text-zinc-400 flex items-center gap-1"><History className="w-3.5 h-3.5" /> Lịch sử phiên bản</p>
      {q.data.map((v) => (
        <div key={v.id} className="rounded-lg bg-zinc-800/40 p-2 text-[11px] text-zinc-500 flex items-center justify-between">
          <span>Phiên bản {v.version}{v.changeReason ? ` — "${v.changeReason}"` : ""}</span>
          <span className={v.status === "ACCEPTED" ? "text-green-400 font-semibold" : "text-zinc-600"}>{v.status}</span>
        </div>
      ))}
    </div>
  );
}

function ReviewForm({ orderId }: { orderId: string }) {
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const mutation = useMutation({
    mutationFn: () => personalizedServiceApi.submitReview(orderId, { overallRating: rating, comment: comment || undefined }),
    onSuccess: () => { toast.success("Cảm ơn bạn đã đánh giá!"); setSubmitted(true); },
    onError: (err: any) => {
      if (err?.response?.data?.error?.code === "PERSONALIZED_SERVICE_REVIEW_ALREADY_EXISTS") { setSubmitted(true); return; }
      toast.error(err?.response?.data?.error?.message ?? "Không thể gửi đánh giá.");
    },
  });
  if (submitted) return <p className="text-xs text-zinc-500 text-center">Bạn đã đánh giá dịch vụ này. Cảm ơn!</p>;
  return (
    <div className="rounded-xl border border-zinc-700/60 p-3.5 space-y-2.5">
      <p className="text-sm font-semibold text-zinc-200">Đánh giá PT & dịch vụ này</p>
      <StarRating value={rating} onChange={setRating} size={24} />
      <textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Nhận xét (không bắt buộc)..." rows={2} className="w-full px-3 py-2 bg-zinc-800/60 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 resize-none" />
      <button data-testid="submit-review-button" onClick={() => mutation.mutate()} disabled={mutation.isPending} className="w-full py-2 rounded-lg bg-green-500 text-black text-sm font-bold hover:bg-green-400 disabled:opacity-40 flex items-center justify-center gap-1.5">
        {mutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Star className="w-4 h-4" />} Gửi đánh giá
      </button>
    </div>
  );
}

export function PersonalizedServiceOrderPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showRevisionForm, setShowRevisionForm] = useState(false);

  const orderQuery = useQuery({
    queryKey: ["personalized-service-order", id],
    queryFn: () => personalizedServiceApi.getOrder(id!),
    enabled: !!id,
    refetchInterval: 8000,
  });

  const acceptMutation = useMutation({
    mutationFn: () => personalizedServiceApi.accept(id!),
    onSuccess: () => {
      toast.success("Đã chấp nhận kế hoạch! Buổi tập của bạn đã sẵn sàng.");
      queryClient.invalidateQueries({ queryKey: ["personalized-service-order", id] });
    },
    onError: (err: any) => toast.error(err?.response?.data?.error?.message ?? "Không thể chấp nhận kế hoạch."),
  });

  const cancelMutation = useMutation({
    mutationFn: () => personalizedServiceApi.cancel(id!, "Khách hàng huỷ đơn"),
    onSuccess: () => {
      toast.success("Đã huỷ đơn.");
      queryClient.invalidateQueries({ queryKey: ["personalized-service-order", id] });
    },
    onError: (err: any) => toast.error(err?.response?.data?.error?.message ?? "Không thể huỷ đơn."),
  });

  const refundMutation = useMutation({
    mutationFn: () => personalizedServiceApi.requestRefund(id!, "Khách hàng yêu cầu hoàn tiền"),
    onSuccess: () => {
      toast.success("Đã gửi yêu cầu hoàn tiền.");
      queryClient.invalidateQueries({ queryKey: ["personalized-service-order", id] });
    },
  });

  const completeMutation = useMutation({
    mutationFn: () => personalizedServiceApi.complete(id!),
    onSuccess: () => {
      toast.success("Đã đánh dấu dịch vụ hoàn thành.");
      queryClient.invalidateQueries({ queryKey: ["personalized-service-order", id] });
    },
    onError: (err: any) => toast.error(err?.response?.data?.error?.message ?? "Không thể hoàn thành dịch vụ."),
  });

  if (orderQuery.isLoading) {
    return <div className="flex items-center justify-center min-h-[400px]"><Loader2 className="w-8 h-8 text-green-500 animate-spin" /></div>;
  }
  const order = orderQuery.data;
  if (!order) return null;

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto space-y-5">
      <button onClick={() => navigate("/client/plans")} className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300">
        <ArrowLeft className="w-3.5 h-3.5" /> Quay lại Chợ kế hoạch
      </button>

      <div>
        <h1 className="text-zinc-100 text-xl font-bold">{order.titleSnapshot}</h1>
        <p className="text-sm text-zinc-500 mt-0.5">{order.priceAtPurchase.toLocaleString("vi-VN")}đ</p>
        <span data-testid="order-status-badge" data-status={order.status} className="inline-flex items-center gap-1.5 mt-2 px-2.5 py-1 rounded-lg bg-zinc-800 text-xs font-semibold text-zinc-300">
          <ShieldCheck className="w-3.5 h-3.5 text-green-400" /> {STATUS_LABEL[order.status]}
        </span>
      </div>

      {order.status === "INTAKE_PENDING" && (
        <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900 p-4">
          <h2 className="text-sm font-bold text-zinc-200 mb-3">Điền thông tin Intake để PT bắt đầu cá nhân hóa</h2>
          <IntakeForm orderId={order.id} />
        </div>
      )}

      {["INTAKE_SUBMITTED", "PT_REVIEWING", "IN_PROGRESS", "REVISION_REQUESTED", "REVISION_IN_PROGRESS"].includes(order.status) && (
        <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900 p-6 text-center space-y-2">
          <Loader2 className="w-8 h-8 text-green-500 animate-spin mx-auto" />
          <p className="text-sm text-zinc-300">PT đang xử lý yêu cầu của bạn.</p>
          <p className="text-xs text-zinc-600">Deadline giao lần đầu: {order.initialDeliveryDeadline ? new Date(order.initialDeliveryDeadline).toLocaleString("vi-VN") : "—"}</p>
        </div>
      )}

      {order.status === "DRAFT_DELIVERED" && order.draftContent && (
        <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900 p-4 space-y-4">
          <h2 className="text-sm font-bold text-zinc-200">PT đã gửi bản nháp — xem lại kế hoạch của bạn</h2>
          <DraftView draft={order.draftContent} />
          {!showRevisionForm ? (
            <div className="flex gap-2">
              <button data-testid="accept-order-button" onClick={() => acceptMutation.mutate()} disabled={acceptMutation.isPending} className="flex-1 py-2.5 rounded-xl bg-green-500 text-black text-sm font-bold hover:bg-green-400 disabled:opacity-40 flex items-center justify-center gap-1.5">
                <ThumbsUp className="w-4 h-4" /> Chấp nhận kế hoạch
              </button>
              <button data-testid="open-revision-form-button" onClick={() => setShowRevisionForm(true)} className="flex-1 py-2.5 rounded-xl border border-zinc-700 text-zinc-300 text-sm font-semibold hover:bg-zinc-800 flex items-center justify-center gap-1.5">
                <MessageSquare className="w-4 h-4" /> Yêu cầu chỉnh sửa
              </button>
            </div>
          ) : (
            <RevisionForm orderId={order.id} onDone={() => setShowRevisionForm(false)} />
          )}
          <p className="text-[11px] text-zinc-600 text-center">
            {order.revisionLimitSnapshot == null ? "Chỉnh sửa không giới hạn" : `Đã dùng ${order.revisionCount}/${order.revisionLimitSnapshot} lần chỉnh sửa`}
          </p>
        </div>
      )}

      {["ACCEPTED", "ACTIVE"].includes(order.status) && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-green-500/30 bg-green-500/5 p-6 text-center space-y-2">
            <CheckCircle className="w-10 h-10 text-green-400 mx-auto" />
            <p className="text-sm text-zinc-200 font-semibold">Kế hoạch cá nhân hóa của bạn đã sẵn sàng!</p>
            <div className="flex gap-2 pt-2">
              <button onClick={() => navigate("/client/workout")} className="flex-1 px-5 py-2.5 rounded-xl bg-green-500 text-black text-sm font-bold hover:bg-green-400">
                Bắt đầu tập luyện
              </button>
              <ChatWithPtButton sellerId={order.sellerId} />
            </div>
          </div>

          {order.status === "ACTIVE" && (
            <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900 p-4 space-y-3">
              <h2 className="text-sm font-bold text-zinc-200">Check-in hàng tuần</h2>
              <CheckInForm orderId={order.id} onDone={() => queryClient.invalidateQueries({ queryKey: ["personalized-service-checkins", order.id] })} />
              <CheckInHistory orderId={order.id} />
            </div>
          )}

          <PlanHistory orderId={order.id} />

          <button data-testid="complete-order-button" onClick={() => completeMutation.mutate()} disabled={completeMutation.isPending} className="w-full py-2 rounded-lg text-xs text-zinc-500 hover:text-green-400">
            Đánh dấu dịch vụ đã hoàn thành
          </button>
        </div>
      )}

      {order.status === "COMPLETED" && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900 p-6 text-center">
            <p className="text-sm text-zinc-300">Dịch vụ đã hoàn thành. Cảm ơn bạn đã sử dụng!</p>
          </div>
          <ReviewForm orderId={order.id} />
          <PlanHistory orderId={order.id} />
        </div>
      )}

      {["PURCHASED", "INTAKE_PENDING"].includes(order.status) && (
        <button onClick={() => cancelMutation.mutate()} disabled={cancelMutation.isPending} className="w-full py-2 rounded-lg text-xs text-zinc-500 hover:text-red-400">
          Huỷ đơn
        </button>
      )}
      {!["CANCELLED", "REFUNDED", "COMPLETED"].includes(order.status) && order.status !== "PURCHASED" && order.status !== "INTAKE_PENDING" && (
        <button onClick={() => refundMutation.mutate()} disabled={refundMutation.isPending} className="w-full py-2 rounded-lg text-xs text-zinc-500 hover:text-amber-400">
          Yêu cầu hoàn tiền / Khiếu nại
        </button>
      )}
    </div>
  );
}
