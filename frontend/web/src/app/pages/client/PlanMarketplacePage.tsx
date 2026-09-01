import { useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Loader2,
  Package,
  Send,
  ShoppingCart,
  Star,
  Store,
  TrendingUp,
  Trash2,
  Upload,
  CalendarPlus,
  ChevronDown,
  Gauge,
  Sparkles,
  ShieldCheck,
  Briefcase,
  Plus,
  X,
  MessageCircle,
} from "lucide-react";
import { StarRating } from "../../components/StarRating";
import { PaymentMethodDialog } from "../../components/payment/PaymentMethodDialog";
import {
  marketplaceService,
  planService,
  trainingPackageService,
  personalizedServiceApi,
  type PublishedPlanListing,
  type TrainingPackage,
  type PersonalizedService,
  type PersonalizedServiceType,
} from "../../services/api";
import { openPaymentGateway } from "../../services/paymentGateway";
import { useBackDismissible } from "../../hooks/useBackDismissible";
import { useApp } from "../../context/AppContext";

const SERVICE_TYPE_LABELS: Record<PersonalizedServiceType, string> = {
  PERSONALIZED_WORKOUT: "Personalized Workout Plan",
  PERSONALIZED_NUTRITION: "Personalized Nutrition Guidance",
  WORKOUT_AND_NUTRITION: "Workout + Nutrition",
  ONLINE_COACHING: "Online Coaching",
};

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  DRAFT: {
    label: "Nháp",
    className: "text-zinc-400 bg-zinc-800 border-zinc-700",
  },
  SUBMITTED: {
    label: "Chờ duyệt",
    className: "text-blue-400 bg-blue-500/10 border-blue-500/30",
  },
  APPROVED: {
    label: "Đã duyệt",
    className: "text-green-400 bg-green-500/10 border-green-500/30",
  },
  REJECTED: {
    label: "Bị từ chối",
    className: "text-red-400 bg-red-500/10 border-red-500/30",
  },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status];
  if (!cfg) return null;
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-bold ${cfg.className}`}
    >
      {cfg.label}
    </span>
  );
}

const TABS = [
  { value: "browse", label: "Miễn phí" },
  { value: "pt-services", label: "Dịch vụ PT" },
  { value: "mine", label: "Kế hoạch của tôi" },
  { value: "buy-packages", label: "Mua gói tập" },
  // "Kế hoạch" not "gói": this marketplace sells written training plans, while a PT's
  // service package sells coaching sessions. Two different products, and the old label made
  // them read as the same one.
  { value: "sell-packages", label: "Bán kế hoạch tập" },
  { value: "my-orders", label: "Đơn dịch vụ của tôi" },
  { value: "my-services", label: "Dịch vụ tôi cung cấp" },
] as const;
type TabValue = (typeof TABS)[number]["value"];

function activePackagesOf(listing: Pick<PublishedPlanListing, "packages">) {
  return listing.packages ?? [];
}

function lowestPackagePrice(listing: Pick<PublishedPlanListing, "packages">) {
  const packages = activePackagesOf(listing);
  return packages.length > 0 ? Math.min(...packages.map((p) => p.price)) : null;
}

/** Phase 9 — "phần 2": distinguishes a publisher who's a verified PT/coach
 * from any regular user who published a plan, so browsers aren't left
 * guessing who's actually qualified behind a listing. */
function PtVerifiedBadge() {
  return (
    <span
      title="Người đăng là PT/HLV đã xác thực vai trò trên hệ thống"
      className="inline-flex items-center gap-1 rounded-full border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-[10px] font-bold text-sky-400"
    >
      <ShieldCheck className="h-3 w-3" /> PT xác thực
    </span>
  );
}

function ListingCard({
  listing,
  selected,
  onClick,
}: {
  listing: PublishedPlanListing;
  selected: boolean;
  onClick: () => void;
}) {
  const minPrice = lowestPackagePrice(listing);
  const isPaid = minPrice != null;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left bg-zinc-900 rounded-xl border-2 p-4 transition-all ${
        selected
          ? "border-green-500 bg-green-500/5"
          : "border-zinc-800/60 hover:border-zinc-700"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <h3 className="text-sm font-bold text-zinc-200 truncate">
              {listing.title}
            </h3>
            {listing.publisherIsVerifiedPt && <PtVerifiedBadge />}
          </div>
          <p className="text-xs text-zinc-500 mt-0.5">{listing.goal}</p>
        </div>
        <div className="flex items-center gap-1 text-xs font-bold text-amber-400 flex-shrink-0">
          <Star className="h-3.5 w-3.5 fill-amber-400" />
          {listing.avgRating.toFixed(1)}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold ${
            isPaid
              ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
              : "border-green-500/30 bg-green-500/10 text-green-300"
          }`}
        >
          {isPaid ? `${minPrice!.toLocaleString("vi-VN")}d` : "FREE"}
        </span>
        <span className="text-[10px] text-zinc-600">
          {listing.publisherIsVerifiedPt ? "PT publisher" : "Community publisher"}
        </span>
      </div>
      {listing.description && (
        <p className="mt-2 line-clamp-2 text-xs text-zinc-500">
          {listing.description}
        </p>
      )}
      <p className="mt-2 text-xs text-zinc-600">
        {listing.ratingCount} lượt đánh giá
      </p>
    </button>
  );
}

const WEEKDAY_LABEL = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
const COMPLAINT_TAG_LABEL: Record<string, string> = {
  too_hard: "Quá nặng",
  too_easy: "Quá dễ",
  equipment_mismatch: "Thiếu dụng cụ",
  unclear_instructions: "Hướng dẫn không rõ",
  boring: "Nhàm chán",
  time_commitment_too_high: "Tốn quá nhiều thời gian",
  not_matching_goal: "Không đúng mục tiêu",
  injury_risk: "Có nguy cơ chấn thương",
  other: "Khác",
};

/** Phase 8 of docs/SESSION_FEEDBACK_AND_PT_PLAN_AUDIT.md — a compact
 * weekday/start-date picker for adopting a marketplace plan into the
 * user's own calendar (closes the audit-identified "no adopt action"
 * gap — a paid purchase alone never used to create anything usable). */
type PreviewDay = {
  day: string;
  goal?: string;
  exercises: Array<{ exerciseId: string; name: string; sets: number; reps: string; restSeconds?: number }>;
  cardio?: string;
};

function AdoptPlanModal({
  listingId,
  daysPerWeek,
  packages,
  weeklySchedule,
  onClose,
}: {
  listingId: string;
  daysPerWeek: number;
  packages: Array<{ id: string; name: string; price: number }>;
  weeklySchedule: PreviewDay[];
  onClose: () => void;
}) {
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [selectedWeekdays, setSelectedWeekdays] = useState<number[]>(
    Array.from({ length: daysPerWeek }, (_, i) => (i * 2 + 1) % 7),
  );
  const [confirmedReplace, setConfirmedReplace] = useState(false);
  const requiresPurchase = packages.length > 0;

  // Phase 9 — "phần 4": lets the adopter trim exercises they can't do /
  // adjust sets before import instead of always getting a rigid,
  // unchangeable copy. Keyed by "dayIdx:exIdx" since the same exerciseId
  // can legitimately appear on more than one day.
  const [showCustomize, setShowCustomize] = useState(false);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [setsOverride, setSetsOverride] = useState<Record<string, number>>({});
  const hasCustomization = excluded.size > 0 || Object.keys(setsOverride).length > 0;

  const exerciseKey = (dayIdx: number, exIdx: number) => `${dayIdx}:${exIdx}`;
  const toggleExercise = (dayIdx: number, exIdx: number) => {
    const key = exerciseKey(dayIdx, exIdx);
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const setSetsFor = (dayIdx: number, exIdx: number, sets: number) => {
    const key = exerciseKey(dayIdx, exIdx);
    setSetsOverride((prev) => ({ ...prev, [key]: sets }));
  };

  const customizedDays = weeklySchedule.map((day, dayIdx) => ({
    day: day.day,
    exercises: day.exercises
      .map((ex, exIdx) => ({ ex, exIdx }))
      .filter(({ exIdx }) => !excluded.has(exerciseKey(dayIdx, exIdx)))
      .map(({ ex, exIdx }) => ({
        exerciseId: ex.exerciseId,
        name: ex.name,
        sets: setsOverride[exerciseKey(dayIdx, exIdx)] ?? ex.sets,
        reps: ex.reps,
        restSeconds: ex.restSeconds,
      })),
  }));
  const emptyDayExists = hasCustomization && customizedDays.some((d) => d.exercises.length === 0);

  const adoptMutation = useMutation({
    mutationFn: () =>
      marketplaceService.adoptPlan(listingId, {
        startDate,
        selectedWeekdays,
        replaceExisting: true,
        customizedWeeklySchedule: hasCustomization ? customizedDays : undefined,
      }),
    onSuccess: () => {
      toast.success("Đã áp dụng kế hoạch vào lịch tập của bạn");
      onClose();
    },
    onError: (error: any) => {
      const status = error?.response?.status;
      if (status === 402) {
        toast.error("Bạn cần mua gói trả phí của kế hoạch này trước khi áp dụng.");
        return;
      }
      toast.error(error?.response?.data?.error?.message ?? "Không thể áp dụng kế hoạch này");
    },
  });

  const toggleWeekday = (w: number) => {
    setSelectedWeekdays((prev) => {
      if (prev.includes(w)) return prev.filter((x) => x !== w);
      if (prev.length >= daysPerWeek) return prev;
      return [...prev, w].sort();
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="bg-zinc-900 border border-zinc-700/60 rounded-2xl w-full max-w-sm p-5 space-y-4 max-h-[90vh] overflow-y-auto">
        <h3 className="text-sm font-bold text-zinc-100">Áp dụng kế hoạch này</h3>

        {requiresPurchase && (
          <div className="rounded-lg border border-amber-700/30 bg-amber-950/20 p-2.5 text-[11px] text-amber-200/90">
            Kế hoạch này yêu cầu mua gói trước khi áp dụng:{" "}
            {packages.map((p) => `${p.name} (${p.price.toLocaleString("vi-VN")}đ)`).join(", ")}.
            Nếu bạn chưa mua, hệ thống sẽ báo lỗi khi bấm "Áp dụng".
          </div>
        )}

        <div className="rounded-lg border border-red-700/30 bg-red-950/20 p-2.5">
          <p className="text-[11px] text-red-200/90 font-semibold">⚠ Lưu ý quan trọng</p>
          <p className="mt-1 text-[11px] text-red-200/70">
            Áp dụng kế hoạch này sẽ <strong>thay thế chương trình tập đang hoạt động</strong> của bạn — các
            buổi tập đã lên lịch nhưng CHƯA hoàn thành sẽ bị huỷ. Các buổi đã tập/đã ghi nhận dữ liệu
            (lịch sử) vẫn được giữ nguyên, không bị mất.
          </p>
        </div>

        <div>
          <label className="text-xs text-zinc-500 mb-1 block">Ngày bắt đầu</label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="w-full rounded-lg bg-zinc-800/60 border border-zinc-700/60 p-2 text-sm text-zinc-200"
          />
        </div>
        <div>
          <label className="text-xs text-zinc-500 mb-1 block">Chọn {daysPerWeek} ngày tập trong tuần</label>
          <div className="grid grid-cols-7 gap-1.5">
            {WEEKDAY_LABEL.map((label, w) => (
              <button
                key={w}
                type="button"
                onClick={() => toggleWeekday(w)}
                className={`py-2 rounded-lg text-xs font-semibold border ${
                  selectedWeekdays.includes(w) ? "bg-green-500 border-green-500 text-black" : "bg-zinc-800/50 border-zinc-700/50 text-zinc-400"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {weeklySchedule.length > 0 && (
          <div>
            <button
              type="button"
              onClick={() => setShowCustomize((v) => !v)}
              className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200"
            >
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showCustomize ? "rotate-180" : ""}`} />
              Tùy chỉnh bài tập trước khi áp dụng (không bắt buộc)
            </button>
            {showCustomize && (
              <div className="mt-2 space-y-3 max-h-56 overflow-y-auto rounded-lg border border-zinc-800/60 bg-zinc-950/40 p-3">
                <p className="text-[11px] text-zinc-500">
                  Bỏ chọn bài tập bạn không thể tập, hoặc chỉnh số hiệp. Mỗi ngày phải giữ lại ít nhất 1 bài.
                </p>
                {weeklySchedule.map((day, dayIdx) => (
                  <div key={dayIdx}>
                    <p className="text-xs font-semibold text-zinc-300">{day.day}</p>
                    <div className="mt-1 space-y-1">
                      {day.exercises.map((ex, exIdx) => {
                        const key = exerciseKey(dayIdx, exIdx);
                        const isExcluded = excluded.has(key);
                        return (
                          <div key={exIdx} className="flex items-center gap-2 text-[11px]">
                            <input
                              type="checkbox"
                              checked={!isExcluded}
                              onChange={() => toggleExercise(dayIdx, exIdx)}
                              className="rounded border-zinc-700 bg-zinc-800 accent-green-500"
                            />
                            <span className={`flex-1 ${isExcluded ? "text-zinc-600 line-through" : "text-zinc-400"}`}>
                              {ex.name}
                            </span>
                            {!isExcluded && (
                              <input
                                type="number"
                                min={1}
                                value={setsOverride[key] ?? ex.sets}
                                onChange={(e) => setSetsFor(dayIdx, exIdx, Math.max(1, Number(e.target.value) || 1))}
                                className="w-12 rounded border border-zinc-700 bg-zinc-800 px-1 py-0.5 text-center text-zinc-300"
                              />
                            )}
                            {!isExcluded && <span className="text-zinc-600">hiệp</span>}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
                {emptyDayExists && (
                  <p className="text-[11px] text-red-400">Mỗi ngày cần giữ lại ít nhất 1 bài tập.</p>
                )}
              </div>
            )}
          </div>
        )}

        <label className="flex items-start gap-2 text-[11px] text-zinc-300 cursor-pointer">
          <input
            type="checkbox"
            checked={confirmedReplace}
            onChange={(e) => setConfirmedReplace(e.target.checked)}
            className="mt-0.5 rounded border-zinc-700 bg-zinc-800 accent-red-500"
          />
          Tôi hiểu rằng chương trình tập hiện tại của tôi sẽ bị thay thế.
        </label>

        <div className="flex gap-2 pt-1">
          <button onClick={onClose} className="flex-1 rounded-xl border border-zinc-700 py-2.5 text-xs font-bold text-zinc-400 hover:bg-zinc-800">
            Hủy
          </button>
          <button
            onClick={() => adoptMutation.mutate()}
            disabled={adoptMutation.isPending || selectedWeekdays.length !== daysPerWeek || !confirmedReplace || emptyDayExists}
            className="flex-1 flex items-center justify-center gap-1.5 rounded-xl bg-green-500 hover:bg-green-400 disabled:opacity-50 py-2.5 text-xs font-bold text-black"
          >
            {adoptMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Áp dụng
          </button>
        </div>
      </div>
    </div>
  );
}

function DetailPanel({ id }: { id: string }) {
  const { user } = useApp();
  const queryClient = useQueryClient();
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [showDetailedReview, setShowDetailedReview] = useState(false);
  const [wouldUseAgain, setWouldUseAgain] = useState<boolean | undefined>();
  const [difficultyFit, setDifficultyFit] = useState<"too_easy" | "just_right" | "too_hard" | undefined>();
  const [complaintTags, setComplaintTags] = useState<string[]>([]);
  const [showAdoptModal, setShowAdoptModal] = useState(false);

  const detailQuery = useQuery({
    queryKey: ["marketplace", "detail", id],
    queryFn: () => marketplaceService.getDetail(id),
  });

  const reviewMutation = useMutation({
    mutationFn: () =>
      marketplaceService.submitReview(id, rating, comment || undefined, {
        wouldUseAgain,
        difficultyFit,
        complaintTags: complaintTags.length > 0 ? complaintTags : undefined,
      }),
    onSuccess: () => {
      toast.success("Đã gửi đánh giá");
      setComment("");
      queryClient.invalidateQueries({ queryKey: ["marketplace"] });
    },
    onError: (error: any) => {
      toast.error(
        error?.response?.data?.error?.message ?? "Không thể gửi đánh giá",
      );
    },
  });

  const toggleComplaintTag = (tag: string) => {
    setComplaintTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
  };

  const [showPreview, setShowPreview] = useState(false);

  if (detailQuery.isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center py-20 bg-zinc-900 rounded-2xl border border-zinc-800/60">
        <Loader2 className="h-6 w-6 text-green-500 animate-spin" />
      </div>
    );
  }

  const listing = detailQuery.data;
  if (detailQuery.isError || !listing) {
    return (
      <div className="flex-1 flex items-center justify-center py-20 bg-zinc-900 rounded-2xl border border-zinc-800/60">
        <p className="text-sm text-zinc-500">Không thể tải chi tiết kế hoạch này. Vui lòng thử lại.</p>
      </div>
    );
  }
  const isOwnListing = user?.id === listing.publisherId;

  return (
    <div className="flex-1 space-y-4 min-w-0">
      <div className="bg-zinc-900 rounded-2xl border border-zinc-800/60 p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-1.5">
              <h2 className="text-lg font-bold text-zinc-100">{listing.title}</h2>
              {listing.publisherIsVerifiedPt && <PtVerifiedBadge />}
            </div>
            <p className="mt-0.5 text-sm text-zinc-500">{listing.goal}</p>
          </div>
          <div className="flex flex-col items-end gap-1 flex-shrink-0">
            <div className="flex items-center gap-1 text-sm font-bold text-amber-400">
              <Star className="h-4 w-4 fill-amber-400" />
              {listing.avgRating.toFixed(1)}
            </div>
            {listing.qualityScore != null && (
              <span className="flex items-center gap-1 text-[11px] text-zinc-500" title="Điểm chất lượng tính bằng rule, không phải AI">
                <Gauge className="h-3 w-3" /> {Math.round(listing.qualityScore * 100)}/100
              </span>
            )}
          </div>
        </div>
        {listing.description && (
          <p className="mt-3 text-sm text-zinc-400">{listing.description}</p>
        )}
        <p className="mt-2 text-xs text-zinc-600">
          {listing.ratingCount} lượt đánh giá{listing.version && listing.version > 1 ? ` · phiên bản ${listing.version}` : ""}
          {listing.sourcePlan && ` · ${listing.sourcePlan.daysPerWeek} buổi/tuần · ${listing.sourcePlan.duration} tuần`}
        </p>
        {listing.packages && listing.packages.length > 0 ? (
          <p className="mt-1 text-xs text-amber-400 font-semibold">
            Trả phí: {listing.packages.map((p) => `${p.name} — ${p.price.toLocaleString("vi-VN")}đ`).join(", ")}
          </p>
        ) : (
          <p className="mt-1 text-xs text-green-400 font-semibold">Miễn phí</p>
        )}

        <button
          type="button"
          onClick={() => setShowPreview((v) => !v)}
          className="mt-3 flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200"
        >
          <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showPreview ? "rotate-180" : ""}`} />
          Xem trước lịch tập ({listing.sourcePlan?.plan?.weeklySchedule?.length ?? 0} buổi)
        </button>
        {showPreview && (
          <div className="mt-2 space-y-2 max-h-72 overflow-y-auto rounded-lg border border-zinc-800/60 bg-zinc-950/40 p-3">
            {(listing.sourcePlan?.plan?.weeklySchedule ?? []).map((day, i) => (
              <div key={i}>
                <p className="text-xs font-semibold text-zinc-300">{day.day}{day.goal ? ` — ${day.goal}` : ""}</p>
                <ul className="mt-1 space-y-0.5">
                  {day.exercises.map((ex, j) => (
                    <li key={j} className="text-[11px] text-zinc-500">
                      {ex.name} — {ex.sets}×{ex.reps}
                    </li>
                  ))}
                </ul>
                {day.cardio && <p className="mt-0.5 text-[11px] text-zinc-600 italic">Cardio: {day.cardio}</p>}
              </div>
            ))}
            {(!listing.sourcePlan?.plan?.weeklySchedule || listing.sourcePlan.plan.weeklySchedule.length === 0) && (
              <p className="text-[11px] text-zinc-600">Không có dữ liệu xem trước cho kế hoạch này.</p>
            )}
          </div>
        )}

        <button
          type="button"
          title={isOwnListing ? "Dung ke hoach cua ban" : undefined}
          onClick={() => setShowAdoptModal(true)}
          className="mt-4 inline-flex items-center gap-1.5 bg-green-500 hover:bg-green-400 text-black px-4 py-2 rounded-lg text-sm font-bold transition-all"
        >
          <CalendarPlus className="h-3.5 w-3.5" /> Áp dụng kế hoạch này
        </button>
      </div>

      <div className="bg-zinc-900 rounded-2xl border border-zinc-800/60 p-6">
        <h3 className="mb-1 text-sm font-bold text-zinc-300">
          Đánh giá của bạn
        </h3>
        <p className="mb-3 text-xs text-zinc-600">
          Bạn cần hoàn thành một chu kỳ tập luyện theo lịch tập gốc của kế hoạch
          này trước khi có thể đánh giá.
        </p>
        <StarRating value={rating} onChange={setRating} size={22} />
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Nhận xét (không bắt buộc)..."
          rows={3}
          className="mt-3 w-full rounded-lg border border-zinc-700/60 bg-zinc-800 p-3 text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-green-500/50"
        />

        <button
          type="button"
          onClick={() => setShowDetailedReview((v) => !v)}
          className="mt-3 flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300"
        >
          <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showDetailedReview ? "rotate-180" : ""}`} />
          Đánh giá chi tiết hơn (không bắt buộc)
        </button>

        {showDetailedReview && (
          <div className="mt-3 space-y-3">
            <div>
              <p className="text-xs text-zinc-400 mb-1.5">Độ khó so với bạn</p>
              <div className="grid grid-cols-3 gap-1.5">
                {(["too_easy", "just_right", "too_hard"] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setDifficultyFit(v)}
                    className={`rounded-lg py-1.5 text-[11px] font-semibold border ${
                      difficultyFit === v ? "bg-green-500 border-green-500 text-black" : "bg-zinc-800/50 border-zinc-700/50 text-zinc-400"
                    }`}
                  >
                    {v === "too_easy" ? "Quá dễ" : v === "just_right" ? "Vừa sức" : "Quá nặng"}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs text-zinc-400 mb-1.5">Bạn có muốn dùng lại kế hoạch này không?</p>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() => setWouldUseAgain(true)}
                  className={`rounded-lg py-1.5 text-[11px] font-semibold border ${
                    wouldUseAgain === true ? "bg-green-500 border-green-500 text-black" : "bg-zinc-800/50 border-zinc-700/50 text-zinc-400"
                  }`}
                >
                  Có
                </button>
                <button
                  type="button"
                  onClick={() => setWouldUseAgain(false)}
                  className={`rounded-lg py-1.5 text-[11px] font-semibold border ${
                    wouldUseAgain === false ? "bg-red-500/80 border-red-500 text-black" : "bg-zinc-800/50 border-zinc-700/50 text-zinc-400"
                  }`}
                >
                  Không
                </button>
              </div>
            </div>
            <div>
              <p className="text-xs text-zinc-400 mb-1.5">Vấn đề gặp phải (nếu có)</p>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(COMPLAINT_TAG_LABEL).map(([tag, label]) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => toggleComplaintTag(tag)}
                    className={`px-2 py-1 rounded-full text-[10px] border ${
                      complaintTags.includes(tag) ? "bg-amber-500/80 border-amber-500 text-black font-semibold" : "bg-zinc-800/50 border-zinc-700/40 text-zinc-500"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={() => reviewMutation.mutate()}
          disabled={reviewMutation.isPending}
          className="mt-3 inline-flex items-center gap-1.5 bg-green-500 hover:bg-green-400 disabled:opacity-60 text-black px-4 py-2 rounded-lg text-sm font-bold transition-all"
        >
          <Send className="h-3.5 w-3.5" />
          {reviewMutation.isPending ? "Đang gửi..." : "Gửi đánh giá"}
        </button>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-bold text-zinc-300">
          Nhận xét ({listing.reviews.length})
        </h3>
        <div className="space-y-2">
          {listing.reviews.length === 0 ? (
            <p className="text-sm text-zinc-600">Chưa có đánh giá nào.</p>
          ) : (
            listing.reviews.map((r) => (
              <div
                key={r.id}
                className="rounded-xl border border-zinc-800/60 bg-zinc-900 p-3.5"
              >
                <StarRating value={r.rating} readonly size={14} />
                {r.comment && (
                  <p className="mt-1.5 text-sm text-zinc-400">{r.comment}</p>
                )}
                {(r.complaintTags?.length || r.wouldUseAgain != null) && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {r.wouldUseAgain != null && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-zinc-700/60 text-zinc-500">
                        {r.wouldUseAgain ? "Sẽ dùng lại" : "Sẽ không dùng lại"}
                      </span>
                    )}
                    {r.complaintTags?.map((tag) => (
                      <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded-full border border-amber-700/40 text-amber-400/80">
                        {COMPLAINT_TAG_LABEL[tag] ?? tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {showAdoptModal && (
        <AdoptPlanModal
          listingId={id}
          daysPerWeek={listing.sourcePlan?.daysPerWeek ?? 3}
          packages={listing.packages ?? []}
          weeklySchedule={listing.sourcePlan?.plan?.weeklySchedule ?? []}
          onClose={() => setShowAdoptModal(false)}
        />
      )}
    </div>
  );
}

const SORT_OPTIONS: Array<{ value: "recommended" | "recent" | "rating" | "quality"; label: string }> = [
  { value: "recommended", label: "Gợi ý cho bạn" },
  { value: "recent", label: "Mới nhất" },
  { value: "rating", label: "Đánh giá cao" },
  { value: "quality", label: "Điểm chất lượng" },
];

function BrowseTab() {
  const [sort, setSort] = useState<"recommended" | "recent" | "rating" | "quality">("recommended");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [daysPerWeek, setDaysPerWeek] = useState<number | undefined>(undefined);
  const [durationWeeksMax, setDurationWeeksMax] = useState<number | undefined>(undefined);
  const browseQuery = useQuery({
    queryKey: ["marketplace", "browse", sort, daysPerWeek, durationWeeksMax],
    queryFn: () => marketplaceService.browse({ sort, daysPerWeek, durationWeeksMax }),
  });

  return (
    <div className="space-y-4">
      <div className="flex gap-2 flex-wrap">
        {SORT_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => setSort(opt.value)}
            className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold transition-all border ${sort === opt.value ? "bg-green-500 text-black border-green-500" : "bg-zinc-900 border-zinc-700/60 text-zinc-400 hover:border-green-500/40"}`}
          >
            {opt.value === "rating" && <TrendingUp className="h-3 w-3" />}
            {opt.value === "recommended" && <Sparkles className="h-3 w-3" />}
            {opt.label}
          </button>
        ))}
      </div>

      <div className="flex gap-2 flex-wrap items-center">
        <select
          value={daysPerWeek ?? ""}
          onChange={(e) => setDaysPerWeek(e.target.value ? Number(e.target.value) : undefined)}
          className="px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-700/60 text-xs text-zinc-300"
        >
          <option value="">Số buổi/tuần: bất kỳ</option>
          {[1, 2, 3, 4, 5, 6, 7].map((n) => (
            <option key={n} value={n}>{n} buổi/tuần</option>
          ))}
        </select>
        <select
          value={durationWeeksMax ?? ""}
          onChange={(e) => setDurationWeeksMax(e.target.value ? Number(e.target.value) : undefined)}
          className="px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-700/60 text-xs text-zinc-300"
        >
          <option value="">Thời lượng: bất kỳ</option>
          <option value="4">Tối đa 4 tuần</option>
          <option value="8">Tối đa 8 tuần</option>
          <option value="12">Tối đa 12 tuần</option>
        </select>
        {sort === "recommended" && (
          <span className="text-[11px] text-zinc-600 italic">Xếp theo mục tiêu/điểm chất lượng phù hợp với bạn (không dùng AI đoán)</span>
        )}
      </div>

      {browseQuery.isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 text-green-500 animate-spin" />
        </div>
      ) : browseQuery.data && browseQuery.data.items.length > 0 ? (
        <div className="flex flex-col lg:flex-row gap-4">
          <div
            className={`grid gap-3 ${selectedId ? "lg:w-96 flex-shrink-0 grid-cols-1" : "flex-1 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3"}`}
          >
            {browseQuery.data.items.map((listing) => (
              <ListingCard
                key={listing.id}
                listing={listing}
                selected={selectedId === listing.id}
                onClick={() =>
                  setSelectedId(selectedId === listing.id ? null : listing.id)
                }
              />
            ))}
          </div>
          {selectedId && <DetailPanel id={selectedId} />}
        </div>
      ) : (
        <div className="bg-zinc-900 rounded-2xl border border-zinc-800/60 py-20 text-center">
          <Store className="h-12 w-12 text-zinc-800 mx-auto mb-3" />
          <p className="text-sm text-zinc-500">
            Chưa có kế hoạch nào được duyệt.
          </p>
        </div>
      )}
    </div>
  );
}

function PublishForm({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const [sourcePlanId, setSourcePlanId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  const plansQuery = useQuery({
    queryKey: ["plans", "current"],
    queryFn: () => planService.getCurrentPlans(),
  });

  const completedPlans = (plansQuery.data ?? []).filter(
    (p: any) => p.status === "COMPLETED",
  );

  const publishMutation = useMutation({
    mutationFn: () =>
      marketplaceService.publish(sourcePlanId, title, description || undefined),
    onSuccess: () => {
      toast.success("Đã gửi kế hoạch để duyệt");
      queryClient.invalidateQueries({ queryKey: ["marketplace"] });
      onDone();
    },
    onError: (error: any) => {
      toast.error(
        error?.response?.data?.error?.message ?? "Không thể đăng kế hoạch",
      );
    },
  });

  return (
    <div className="bg-zinc-900 rounded-2xl border border-zinc-800/60 p-5 space-y-3">
      <h3 className="text-sm font-bold text-zinc-300">
        Đăng một kế hoạch tập của bạn
      </h3>
      <select
        value={sourcePlanId}
        onChange={(e) => setSourcePlanId(e.target.value)}
        className="w-full px-3 py-2.5 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 outline-none focus:border-green-500/50"
      >
        <option value="">Chọn kế hoạch đã hoàn thành...</option>
        {completedPlans.map((p: any) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Tiêu đề hiển thị"
        className="w-full px-3 py-2.5 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-green-500/50"
      />
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Mô tả (không bắt buộc)"
        rows={2}
        className="w-full px-3 py-2.5 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-green-500/50"
      />
      <button
        type="button"
        onClick={() => publishMutation.mutate()}
        disabled={!sourcePlanId || !title || publishMutation.isPending}
        className="inline-flex items-center gap-1.5 bg-green-500 hover:bg-green-400 disabled:opacity-60 text-black px-4 py-2 rounded-lg text-sm font-bold transition-all"
      >
        <Upload className="h-3.5 w-3.5" />
        {publishMutation.isPending ? "Đang gửi..." : "Đăng lên chợ"}
      </button>
    </div>
  );
}

/** Phase 8 of docs/SESSION_FEEDBACK_AND_PT_PLAN_AUDIT.md — publisher-facing
 * AI improvement suggestions. Advisory only: generating a suggestion never
 * changes the listing itself — the publisher must still manually create a
 * new version (republish) to act on anything shown here. */
function ImprovementSuggestionsPanel({ listingId }: { listingId: string }) {
  const [expanded, setExpanded] = useState(false);
  const historyQuery = useQuery({
    queryKey: ["marketplace", "improvement-suggestions", listingId],
    queryFn: () => marketplaceService.listImprovementSuggestions(listingId),
    enabled: expanded,
  });
  const generateMutation = useMutation({
    mutationFn: () => marketplaceService.generateImprovementSuggestions(listingId),
    onSuccess: () => historyQuery.refetch(),
    onError: (error: any) => toast.error(error?.response?.data?.error?.message ?? "Không thể tạo gợi ý"),
  });

  return (
    <div className="mt-2">
      <button type="button" onClick={() => setExpanded((v) => !v)} className="flex items-center gap-1 text-[11px] text-violet-400 hover:text-violet-300">
        <ChevronDown className={`w-3 h-3 transition-transform ${expanded ? "rotate-180" : ""}`} />
        Gợi ý cải thiện bằng AI
      </button>
      {expanded && (
        <div className="mt-2 space-y-2 rounded-lg border border-violet-700/30 bg-violet-950/10 p-2.5">
          <button
            type="button"
            onClick={() => generateMutation.mutate()}
            disabled={generateMutation.isPending}
            className="flex items-center gap-1.5 text-[11px] font-semibold text-violet-300 disabled:opacity-50"
          >
            {generateMutation.isPending && <Loader2 className="w-3 h-3 animate-spin" />}
            Tạo gợi ý mới (dựa trên đánh giá hiện có)
          </button>
          {(historyQuery.data ?? []).slice(0, 1).map((s) => (
            <div key={s.id} className="text-[11px] text-zinc-400 space-y-1">
              <p>{s.summary}</p>
              <ul className="list-disc list-inside text-zinc-500">
                {s.suggestions.map((sug, i) => (
                  <li key={i}>{sug}</li>
                ))}
              </ul>
            </div>
          ))}
          <p className="text-[10px] text-zinc-600 italic">
            Đây chỉ là gợi ý — bạn cần tự đăng phiên bản mới nếu muốn áp dụng.
          </p>
        </div>
      )}
    </div>
  );
}

function RepublishForm({ listing, onDone }: { listing: PublishedPlanListing; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [changelog, setChangelog] = useState("");
  const [improvementReason, setImprovementReason] = useState("");

  const republishMutation = useMutation({
    mutationFn: () => marketplaceService.republish(listing.id, { changelog, improvementReason: improvementReason || undefined }),
    onSuccess: () => {
      toast.success("Đã đăng phiên bản mới để duyệt lại");
      queryClient.invalidateQueries({ queryKey: ["marketplace"] });
      onDone();
    },
    onError: (error: any) => toast.error(error?.response?.data?.error?.message ?? "Không thể đăng phiên bản mới"),
  });

  return (
    <div className="mt-2 space-y-2 rounded-lg border border-zinc-700/40 bg-zinc-800/20 p-2.5">
      <textarea
        value={changelog}
        onChange={(e) => setChangelog(e.target.value)}
        placeholder="Thay đổi gì trong phiên bản này? (bắt buộc)"
        rows={2}
        className="w-full rounded-lg bg-zinc-800/60 border border-zinc-700/60 p-2 text-[11px] text-zinc-200 placeholder:text-zinc-600"
      />
      <textarea
        value={improvementReason}
        onChange={(e) => setImprovementReason(e.target.value)}
        placeholder="Lý do cải thiện (không bắt buộc, vd: dựa trên phản hồi người dùng)"
        rows={2}
        className="w-full rounded-lg bg-zinc-800/60 border border-zinc-700/60 p-2 text-[11px] text-zinc-200 placeholder:text-zinc-600"
      />
      <div className="flex gap-2">
        <button type="button" onClick={onDone} className="text-[11px] text-zinc-500">
          Hủy
        </button>
        <button
          type="button"
          onClick={() => republishMutation.mutate()}
          disabled={republishMutation.isPending || !changelog.trim()}
          className="text-[11px] font-semibold text-green-400 disabled:opacity-50"
        >
          {republishMutation.isPending ? "Đang đăng..." : "Đăng phiên bản mới"}
        </button>
      </div>
    </div>
  );
}

function MineTab() {
  const queryClient = useQueryClient();
  const [showPublishForm, setShowPublishForm] = useState(false);
  const [republishingId, setRepublishingId] = useState<string | null>(null);

  const mineQuery = useQuery({
    queryKey: ["marketplace", "mine"],
    queryFn: marketplaceService.listMine,
  });

  const withdrawMutation = useMutation({
    mutationFn: (id: string) => marketplaceService.withdraw(id),
    onSuccess: () => {
      toast.success("Đã gỡ kế hoạch");
      queryClient.invalidateQueries({ queryKey: ["marketplace"] });
    },
  });

  return (
    <div className="space-y-4">
      {showPublishForm ? (
        <PublishForm onDone={() => setShowPublishForm(false)} />
      ) : (
        <button
          type="button"
          onClick={() => setShowPublishForm(true)}
          className="inline-flex items-center gap-2 bg-green-500 hover:bg-green-400 text-black px-4 py-2.5 rounded-xl text-sm font-bold transition-all shadow-lg shadow-green-500/20"
        >
          <Upload className="h-4 w-4" /> Đăng kế hoạch mới
        </button>
      )}

      {mineQuery.isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 text-green-500 animate-spin" />
        </div>
      ) : mineQuery.data && mineQuery.data.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {mineQuery.data.map((listing) => (
            <div
              key={listing.id}
              className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h4 className="text-sm font-bold text-zinc-200 truncate">
                      {listing.title}
                    </h4>
                    <StatusBadge status={listing.moderationStatus} />
                    {listing.version && listing.version > 1 && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-zinc-700/60 text-zinc-500">v{listing.version}</span>
                    )}
                  </div>
                  {listing.moderationStatus === "REJECTED" &&
                    listing.moderationNote && (
                      <p className="mt-1 text-xs text-red-400">
                        Lý do: {listing.moderationNote}
                      </p>
                    )}
                  <p className="mt-1 text-xs text-zinc-600">
                    {listing.avgRating.toFixed(1)}★ ({listing.ratingCount} đánh giá)
                    {listing.qualityScore != null && ` · Chất lượng ${Math.round(listing.qualityScore * 100)}/100`}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => withdrawMutation.mutate(listing.id)}
                  className="p-2 rounded-lg text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition-colors flex-shrink-0"
                  aria-label="Gỡ kế hoạch"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>

              {listing.moderationStatus === "APPROVED" && <ImprovementSuggestionsPanel listingId={listing.id} />}

              {/* Republishing (creating a new version to fix/improve) is
                  available from APPROVED (iterate on a live listing) AND
                  REJECTED (fix the issue and resubmit) — previously this
                  was APPROVED-only, leaving a rejected publisher with no
                  way to correct and resubmit through the UI at all. */}
              {(listing.moderationStatus === "APPROVED" || listing.moderationStatus === "REJECTED") && (
                <>
                  {listing.moderationStatus === "REJECTED" && (
                    <p className="mt-2 text-[11px] text-zinc-500">
                      Sửa lại nội dung rồi đăng phiên bản mới để admin duyệt lại.
                    </p>
                  )}
                  {republishingId === listing.id ? (
                    <RepublishForm listing={listing} onDone={() => setRepublishingId(null)} />
                  ) : (
                    <button
                      type="button"
                      onClick={() => setRepublishingId(listing.id)}
                      className="mt-2 text-[11px] text-zinc-500 hover:text-zinc-300"
                    >
                      {listing.moderationStatus === "REJECTED" ? "Sửa & đăng lại..." : "Đăng phiên bản mới..."}
                    </button>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-zinc-900 rounded-2xl border border-zinc-800/60 py-16 text-center">
          <Package className="h-10 w-10 text-zinc-800 mx-auto mb-3" />
          <p className="text-sm text-zinc-500">Bạn chưa đăng kế hoạch nào.</p>
        </div>
      )}
    </div>
  );
}

function CreatePackageForm({
  publishedPlanId,
  onDone,
}: {
  publishedPlanId: string;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [durationWeeks, setDurationWeeks] = useState("");
  const [description, setDescription] = useState("");

  const createMutation = useMutation({
    mutationFn: () =>
      trainingPackageService.create({
        publishedPlanId,
        name,
        price: Number(price),
        durationWeeks: durationWeeks ? Number(durationWeeks) : undefined,
        description: description || undefined,
      }),
    onSuccess: () => {
      toast.success("Đã tạo gói bán");
      queryClient.invalidateQueries({ queryKey: ["packages"] });
      onDone();
    },
    onError: (error: any) => {
      toast.error(
        error?.response?.data?.error?.message ?? "Không thể tạo gói bán",
      );
    },
  });

  return (
    <div className="mt-3 space-y-2 rounded-xl border border-zinc-700/60 bg-zinc-800/60 p-3">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Tên gói bán"
        className="w-full rounded-lg border border-zinc-700/60 bg-zinc-900 p-2 text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-green-500/50"
      />
      <div className="flex gap-2">
        <input
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          type="number"
          placeholder="Giá (VND)"
          className="w-full rounded-lg border border-zinc-700/60 bg-zinc-900 p-2 text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-green-500/50"
        />
        <input
          value={durationWeeks}
          onChange={(e) => setDurationWeeks(e.target.value)}
          type="number"
          placeholder="Số tuần"
          className="w-full rounded-lg border border-zinc-700/60 bg-zinc-900 p-2 text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-green-500/50"
        />
      </div>
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Mô tả (không bắt buộc)"
        rows={2}
        className="w-full rounded-lg border border-zinc-700/60 bg-zinc-900 p-2 text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-green-500/50"
      />
      <button
        type="button"
        onClick={() => createMutation.mutate()}
        disabled={!name || !price || createMutation.isPending}
        className="bg-green-500 hover:bg-green-400 disabled:opacity-60 text-black px-3 py-1.5 rounded-lg text-xs font-bold transition-all"
      >
        {createMutation.isPending ? "Đang tạo..." : "Tạo gói bán"}
      </button>
    </div>
  );
}

function SellPackagesTab() {
  const { isPT } = useApp();
  const queryClient = useQueryClient();
  const [creatingFor, setCreatingFor] = useState<string | null>(null);

  const myPlansQuery = useQuery({
    queryKey: ["marketplace", "mine"],
    queryFn: marketplaceService.listMine,
  });
  const myPackagesQuery = useQuery({
    queryKey: ["packages", "mine"],
    queryFn: trainingPackageService.listMine,
  });

  const archiveMutation = useMutation({
    mutationFn: (id: string) => trainingPackageService.archive(id),
    onSuccess: () => {
      toast.success("Đã gỡ gói bán");
      queryClient.invalidateQueries({ queryKey: ["packages"] });
    },
  });

  const approvedPlans = (myPlansQuery.data ?? []).filter(
    (p) => p.moderationStatus === "APPROVED",
  );

  if (!isPT) {
    return (
      <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900 p-5">
        <h3 className="text-sm font-bold text-zinc-300">Chia se mien phi</h3>
        <p className="mt-2 text-sm text-zinc-500">
          Tai khoan member co the dang ke hoach mien phi. Chi PT da duoc xac minh moi duoc tao goi tra phi va dat gia.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="bg-zinc-900 rounded-2xl border border-zinc-800/60 p-5">
        <h3 className="mb-3 text-sm font-bold text-zinc-300">
          Tạo gói bán từ kế hoạch đã duyệt
        </h3>
        {approvedPlans.length === 0 ? (
          <p className="text-sm text-zinc-500">
            Bạn cần có ít nhất một kế hoạch đã được duyệt (tab Khám phá) trước
            khi tạo gói bán.
          </p>
        ) : (
          <div className="space-y-2">
            {approvedPlans.map((plan) => (
              <div
                key={plan.id}
                className="rounded-xl border border-zinc-800/60 bg-zinc-800/30 p-3.5"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-zinc-200">
                    {plan.title}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setCreatingFor(creatingFor === plan.id ? null : plan.id)
                    }
                    className="text-xs font-bold text-green-400 hover:text-green-300"
                  >
                    {creatingFor === plan.id ? "Đóng" : "+ Tạo gói bán"}
                  </button>
                </div>
                {creatingFor === plan.id && (
                  <CreatePackageForm
                    publishedPlanId={plan.id}
                    onDone={() => setCreatingFor(null)}
                  />
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <h3 className="text-sm font-bold text-zinc-300 mb-2">
          Gói bán của tôi
        </h3>
        {myPackagesQuery.isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 text-green-500 animate-spin" />
          </div>
        ) : myPackagesQuery.data && myPackagesQuery.data.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {myPackagesQuery.data.map((pkg) => (
              <div
                key={pkg.id}
                className="flex items-center justify-between gap-3 bg-zinc-900 rounded-xl border border-zinc-800/60 p-4"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h4 className="text-sm font-bold text-zinc-200 truncate">
                      {pkg.name}
                    </h4>
                    <span
                      className={`flex-shrink-0 rounded-full border px-2 py-0.5 text-xs font-bold ${pkg.status === "ACTIVE" ? "border-green-500/30 text-green-400 bg-green-500/10" : "border-zinc-700 text-zinc-500 bg-zinc-800"}`}
                    >
                      {pkg.status === "ACTIVE" ? "Đang bán" : "Đã gỡ"}
                    </span>
                  </div>
                  <p className="mt-1 text-xs font-semibold text-green-400">
                    {pkg.price.toLocaleString("vi-VN")}đ
                    {pkg.durationWeeks ? ` · ${pkg.durationWeeks} tuần` : ""}
                  </p>
                </div>
                {pkg.status === "ACTIVE" && (
                  <button
                    type="button"
                    onClick={() => archiveMutation.mutate(pkg.id)}
                    className="p-2 rounded-lg text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition-colors flex-shrink-0"
                    aria-label="Gỡ gói bán"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-zinc-900 rounded-2xl border border-zinc-800/60 py-16 text-center">
            <Package className="h-10 w-10 text-zinc-800 mx-auto mb-3" />
            <p className="text-sm text-zinc-500">Bạn chưa có gói bán nào.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function PackageCard({ pkg }: { pkg: TrainingPackage }) {
  const { user } = useApp();
  const queryClient = useQueryClient();
  const isOwnPackage = user?.id === pkg.sellerId;
  const purchaseMutation = useMutation({
    mutationFn: () => trainingPackageService.purchase(pkg.id),
    onSuccess: () => {
      toast.success("Mua gói thành công!");
      queryClient.invalidateQueries({ queryKey: ["packages"] });
    },
    onError: (error: any) => {
      toast.error(
        error?.response?.data?.error?.message ?? "Không thể mua gói này",
      );
    },
  });

  return (
    <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4">
      <h3 className="text-sm font-bold text-zinc-200">{pkg.name}</h3>
      {pkg.publishedPlan && (
        <p className="mt-0.5 text-xs text-zinc-500">
          {pkg.publishedPlan.title} · {pkg.publishedPlan.goal}
        </p>
      )}
      {pkg.description && (
        <p className="mt-2 text-xs text-zinc-500">{pkg.description}</p>
      )}
      <div className="mt-3 flex items-center justify-between">
        <span className="text-sm font-bold text-green-400">
          {pkg.price.toLocaleString("vi-VN")}đ
        </span>
        {isOwnPackage && (
          <span className="rounded-lg border border-zinc-700/60 px-3 py-1.5 text-xs font-bold text-zinc-500">
            Goi cua ban
          </span>
        )}
        <button
          type="button"
          onClick={() => !isOwnPackage && purchaseMutation.mutate()}
          disabled={isOwnPackage || purchaseMutation.isPending}
          className={`${isOwnPackage ? "hidden" : "inline-flex"} items-center gap-1.5 bg-green-500 hover:bg-green-400 disabled:opacity-60 text-black px-3 py-1.5 rounded-lg text-xs font-bold transition-all`}
        >
          <ShoppingCart className="h-3.5 w-3.5" />
          {purchaseMutation.isPending ? "Đang mua..." : "Mua"}
        </button>
      </div>
    </div>
  );
}

function BuyPackagesTab() {
  const browseQuery = useQuery({
    queryKey: ["packages", "browse"],
    queryFn: () => trainingPackageService.browse(),
  });
  const purchasesQuery = useQuery({
    queryKey: ["packages", "purchases", "mine"],
    queryFn: trainingPackageService.listMyPurchases,
  });

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-bold text-zinc-300 mb-2">
          Gói tập đang bán
        </h3>
        {browseQuery.isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 text-green-500 animate-spin" />
          </div>
        ) : browseQuery.data && browseQuery.data.items.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {browseQuery.data.items.map((pkg) => (
              <PackageCard key={pkg.id} pkg={pkg} />
            ))}
          </div>
        ) : (
          <div className="bg-zinc-900 rounded-2xl border border-zinc-800/60 py-16 text-center">
            <ShoppingCart className="h-10 w-10 text-zinc-800 mx-auto mb-3" />
            <p className="text-sm text-zinc-500">
              Chưa có gói tập nào được bán.
            </p>
          </div>
        )}
      </div>

      <div>
        <h3 className="text-sm font-bold text-zinc-300 mb-2">Gói đã mua</h3>
        {purchasesQuery.data && purchasesQuery.data.length > 0 ? (
          <div className="space-y-2">
            {purchasesQuery.data.map((purchase) => (
              <div
                key={purchase.id}
                className="rounded-xl border border-zinc-800/60 bg-zinc-900 p-3.5"
              >
                <p className="text-sm font-semibold text-zinc-200">
                  {purchase.package?.name ?? "Gói tập"}
                </p>
                <p className="text-xs font-semibold text-green-400">
                  {purchase.priceAtPurchase.toLocaleString("vi-VN")}đ
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-zinc-600">Bạn chưa mua gói tập nào.</p>
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// Marketplace rework — Personalized PT Service (distinct product from the
// fixed-plan TrainingPackage above — see personalized-service.service.ts's
// header comment). PT sells personalization capacity; the buyer's actual
// plan is created after Intake, via Draft/Revision/Accept — never a fixed
// file handed over at purchase.
// ══════════════════════════════════════════════════════════════════════════

function ServiceCredibility({ seller }: { seller?: PersonalizedService["seller"] }) {
  if (!seller) return null;
  return (
    <div className="flex items-center gap-1.5 text-xs text-zinc-400">
      {seller.isApprovedPt && (
        <span className="inline-flex items-center gap-1 text-green-400 font-semibold">
          <ShieldCheck className="w-3.5 h-3.5" /> Verified PT
        </span>
      )}
      {seller.displayName && <span>· {seller.displayName}</span>}
    </div>
  );
}

function PersonalizedServiceCard({ svc, onOpen }: { svc: PersonalizedService; onOpen: () => void }) {
  return (
    <button
      type="button"
      data-testid="personalized-service-card"
      data-service-title={svc.title}
      onClick={onOpen}
      className="text-left rounded-2xl border border-zinc-800/60 bg-zinc-900 p-4 hover:border-green-500/40 transition-all space-y-2.5"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-[11px] font-bold text-amber-400">
          PERSONALIZED
        </span>
        {svc.supportWeeks && (
          <span className="text-[11px] text-zinc-500">{svc.supportWeeks} tuần hỗ trợ</span>
        )}
      </div>
      <h4 className="text-sm font-bold text-zinc-100 leading-snug">{svc.title}</h4>
      <ServiceCredibility seller={svc.seller} />
      <div className="flex flex-wrap gap-1">
        {svc.deliverables.slice(0, 3).map((d) => (
          <span key={d} className="text-[10px] text-zinc-500 bg-zinc-800/60 rounded px-1.5 py-0.5">
            ✓ {d}
          </span>
        ))}
      </div>
      <div className="flex items-center justify-between pt-1">
        <span className="text-[11px] text-zinc-500">
          {svc.targetLevel ?? "Mọi trình độ"} · {svc.targetGoal ?? "Mọi mục tiêu"}
        </span>
        <span className="text-sm font-bold text-green-400">{svc.price.toLocaleString("vi-VN")}đ</span>
      </div>
    </button>
  );
}

function PersonalizedServiceDetailModal({ id, onClose }: { id: string; onClose: () => void }) {
  // Android Back closes this sheet instead of leaving the marketplace behind it.
  useBackDismissible(true, onClose);
  const detailQuery = useQuery({ queryKey: ["personalized-service", id], queryFn: () => personalizedServiceApi.getDetail(id) });
  // P0 cluster C2 — purchase now starts a gateway checkout instead of an instant wallet
  // transfer; the order only activates once the gateway's webhook confirms payment, never on
  // this response. showGateway opens the same PaymentMethodDialog gym-membership/contract
  // checkout already uses, for the same reason: which gateways are usable is a server decision.
  const [showGateway, setShowGateway] = useState(false);
  const purchaseMutation = useMutation({
    mutationFn: (provider: string) => personalizedServiceApi.purchase(id, provider),
    // A genuine network-transport failure (no `error.response` at all — the request never
    // got a usable response back, as opposed to the server answering with a real 4xx/5xx) has
    // been confirmed, directly, to still leave the order created successfully server-side:
    // captured on the wire as HTTP 201 with a valid body, immediately followed by the
    // WebView's own network stack reporting the load itself as failed. The user only ever
    // saw the resulting false "purchase failed" toast, never the order that was actually
    // sitting there waiting to be paid. One silent retry closes that gap for the common case
    // without touching real business-rule rejections (self-purchase, PT not approved, service
    // no longer listed, ...), which always arrive WITH a response body and so are still
    // reported immediately, not retried.
    retry: (failureCount, error: any) => failureCount < 1 && !error?.response,
    onSuccess: (result) => {
      const url = result.payment?.redirectUrl;
      if (url) {
        // App: system browser tab with the React app still alive behind it. Web: unchanged.
        // The order still activates only on the gateway's webhook, never on this response.
        void openPaymentGateway({
          url,
          transactionId: result.payment?.transactionId,
          navigate,
        });
        return;
      }
      setShowGateway(false);
      toast.error("Cổng thanh toán không trả về liên kết — thử lại hoặc chọn cổng khác");
    },
    onError: (err: any) => toast.error(err?.response?.data?.error?.message ?? "Không thể mua dịch vụ này."),
  });
  const svc = detailQuery.data;

  // Portal to document.body, not an inline return: AppShell renders every routed page inside
  // a framer-motion <motion.div> for the page-transition animation, and that component's
  // `transform` style creates its own stacking context — z-index set on anything inside it
  // (this sheet included) can never paint above BottomNav, which AppShell renders as a
  // *sibling* of that motion.div, outside its stacking context entirely. Bumping this sheet's
  // z-index alone (tried first) changed nothing visible for exactly that reason: it only wins
  // comparisons against elements sharing the same context, and BottomNav isn't one of them.
  // Escaping via a portal sidesteps the whole problem instead of chasing z-index numbers.
  // (BottomNav sits at z-50; z-[60] here is kept anyway as a second line of defense now that
  // both are compared as ordinary document.body children.)
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/60 p-0 sm:p-4" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="bg-zinc-900 border border-zinc-700/60 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg max-h-[88vh] overflow-y-auto p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <span className="inline-flex items-center rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-[11px] font-bold text-amber-400">
            PERSONALIZED · {svc ? SERVICE_TYPE_LABELS[svc.serviceType] : ""}
          </span>
          <button onClick={onClose} className="p-1 rounded-lg text-zinc-500 hover:text-zinc-300"><X className="w-4 h-4" /></button>
        </div>

        {detailQuery.isLoading && <div className="py-10 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-green-500" /></div>}

        {svc && (
          <>
            <h3 className="text-lg font-bold text-zinc-100">{svc.title}</h3>
            <ServiceCredibility seller={svc.seller} />
            {svc.seller?.professionalBio && <p className="text-xs text-zinc-500">{svc.seller.professionalBio}</p>}
            {svc.description && <p className="text-sm text-zinc-400">{svc.description}</p>}

            <div>
              <p className="text-[11px] uppercase tracking-wider text-zinc-600 font-semibold mb-1.5">Bạn sẽ nhận</p>
              <ul className="space-y-1">
                {svc.deliverables.map((d) => (
                  <li key={d} className="text-sm text-zinc-300 flex items-center gap-2">
                    <span className="text-green-400">✓</span> {d}
                  </li>
                ))}
              </ul>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="rounded-lg bg-zinc-800/50 p-2.5">
                <p className="text-zinc-600">Giao lần đầu</p>
                <p className="text-zinc-200 font-semibold">{svc.initialDeliveryDays} ngày sau Intake</p>
              </div>
              <div className="rounded-lg bg-zinc-800/50 p-2.5">
                <p className="text-zinc-600">Chỉnh sửa</p>
                <p className="text-zinc-200 font-semibold">{svc.revisionLimit == null ? "Không giới hạn" : `${svc.revisionLimit} lần`}</p>
              </div>
            </div>

            <div className="rounded-lg border border-zinc-700/40 p-2.5 space-y-1">
              <p className="text-[11px] uppercase tracking-wider text-zinc-600 font-semibold">Buyer Protection</p>
              <p className="text-[11px] text-zinc-500">✓ PT đã xác minh · ✓ Chính sách chỉnh sửa rõ ràng · ✓ Deadline giao có hạn · ✓ Lịch sử chat · ✓ Hỗ trợ khiếu nại</p>
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-zinc-800/60">
              <span className="text-xl font-bold text-green-400">{svc.price.toLocaleString("vi-VN")}đ</span>
              <button
                data-testid="purchase-service-button"
                onClick={() => setShowGateway(true)}
                disabled={purchaseMutation.isPending}
                className="px-5 py-2.5 rounded-xl text-sm font-bold bg-green-500 text-black hover:bg-green-400 disabled:opacity-50"
              >
                {purchaseMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Mua gói"}
              </button>
            </div>
          </>
        )}

        {showGateway && svc && (
          <PaymentMethodDialog
            amount={svc.price}
            title="Chọn phương thức thanh toán dịch vụ"
            isSubmitting={purchaseMutation.isPending}
            onClose={() => setShowGateway(false)}
            onConfirm={(provider) => purchaseMutation.mutate(provider)}
          />
        )}
      </div>
    </div>,
    document.body,
  );
}

function PtServicesBrowseTab() {
  const [openId, setOpenId] = useState<string | null>(null);
  const browseQuery = useQuery({ queryKey: ["personalized-services", "browse"], queryFn: () => personalizedServiceApi.browse() });

  return (
    <div className="space-y-4">
      {browseQuery.isLoading && <div className="py-10 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-green-500" /></div>}
      {browseQuery.data && browseQuery.data.items.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {browseQuery.data.items.map((svc) => (
            <PersonalizedServiceCard key={svc.id} svc={svc} onOpen={() => setOpenId(svc.id)} />
          ))}
        </div>
      ) : (
        !browseQuery.isLoading && (
          <div className="bg-zinc-900 rounded-2xl border border-zinc-800/60 py-16 text-center">
            <Briefcase className="h-10 w-10 text-zinc-800 mx-auto mb-3" />
            <p className="text-sm text-zinc-500">Chưa có dịch vụ PT cá nhân hóa nào được đăng.</p>
          </div>
        )
      )}
      {openId && <PersonalizedServiceDetailModal id={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}

function MyOrdersTab() {
  const navigate = useNavigate();
  const ordersQuery = useQuery({ queryKey: ["personalized-service-orders", "mine"], queryFn: () => personalizedServiceApi.listMyOrders() });

  return (
    <div className="space-y-2">
      {ordersQuery.isLoading && <div className="py-10 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-green-500" /></div>}
      {ordersQuery.data && ordersQuery.data.length > 0 ? (
        ordersQuery.data.map((order) => (
          <button
            key={order.id}
            data-testid="buyer-order-row"
            onClick={() => navigate(`/client/marketplace-orders/${order.id}`)}
            className="w-full text-left rounded-xl border border-zinc-800/60 bg-zinc-900 p-3.5 hover:border-green-500/40 flex items-center justify-between gap-3"
          >
            <div>
              <p className="text-sm font-semibold text-zinc-200">{order.titleSnapshot}</p>
              <p className="text-xs text-zinc-500 mt-0.5">{order.priceAtPurchase.toLocaleString("vi-VN")}đ</p>
            </div>
            <span className="text-[11px] px-2 py-1 rounded-lg bg-zinc-800 text-zinc-300 font-semibold whitespace-nowrap">{order.status}</span>
          </button>
        ))
      ) : (
        !ordersQuery.isLoading && <p className="text-sm text-zinc-600 text-center py-10">Bạn chưa mua dịch vụ PT cá nhân hóa nào.</p>
      )}
    </div>
  );
}

function CreateServiceForm({ onCreated }: { onCreated: () => void }) {
  const [serviceType, setServiceType] = useState<PersonalizedServiceType>("PERSONALIZED_WORKOUT");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("500000");
  const [deliverablesText, setDeliverablesText] = useState("Personalized Workout Plan\nWeekly guidance\n2 Revisions");
  const [revisionLimit, setRevisionLimit] = useState("2");
  const [initialDeliveryDays, setInitialDeliveryDays] = useState("2");
  const [supportWeeks, setSupportWeeks] = useState("8");
  const [targetGoal, setTargetGoal] = useState("");
  const [targetLevel, setTargetLevel] = useState("");

  const createMutation = useMutation({
    mutationFn: () =>
      personalizedServiceApi.create({
        serviceType,
        title,
        description: description || undefined,
        price: Number(price),
        deliverables: deliverablesText.split("\n").map((s) => s.trim()).filter(Boolean),
        revisionLimit: revisionLimit ? Number(revisionLimit) : null,
        initialDeliveryDays: Number(initialDeliveryDays),
        supportWeeks: supportWeeks ? Number(supportWeeks) : null,
        targetGoal: targetGoal || undefined,
        targetLevel: targetLevel || undefined,
      }),
    onSuccess: () => {
      toast.success("Đã tạo dịch vụ cá nhân hóa");
      setTitle("");
      onCreated();
    },
    onError: (err: any) => toast.error(err?.response?.data?.error?.message ?? "Không thể tạo dịch vụ — bạn cần là PT đã được duyệt."),
  });

  return (
    <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900 p-4 space-y-3">
      <h3 className="text-sm font-bold text-zinc-200 flex items-center gap-2"><Plus className="w-4 h-4 text-green-400" /> Tạo dịch vụ mới</h3>
      <select data-testid="create-service-type-select" value={serviceType} onChange={(e) => setServiceType(e.target.value as PersonalizedServiceType)} className="w-full px-3 py-2 bg-zinc-800/60 border border-zinc-700/60 rounded-lg text-sm text-zinc-200">
        {Object.entries(SERVICE_TYPE_LABELS).map(([k, label]) => (
          <option key={k} value={k}>{label}</option>
        ))}
      </select>
      <input data-testid="create-service-title-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Tiêu đề (vd: 12-Week Muscle Gain Coaching)" className="w-full px-3 py-2 bg-zinc-800/60 border border-zinc-700/60 rounded-lg text-sm text-zinc-200" />
      <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Mô tả" rows={2} className="w-full px-3 py-2 bg-zinc-800/60 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 resize-none" />
      <textarea value={deliverablesText} onChange={(e) => setDeliverablesText(e.target.value)} placeholder="Mỗi dòng một deliverable" rows={3} className="w-full px-3 py-2 bg-zinc-800/60 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 resize-none" />
      <div className="grid grid-cols-2 gap-2">
        <input value={price} onChange={(e) => setPrice(e.target.value)} type="number" placeholder="Giá (VND)" className="px-3 py-2 bg-zinc-800/60 border border-zinc-700/60 rounded-lg text-sm text-zinc-200" />
        <input value={initialDeliveryDays} onChange={(e) => setInitialDeliveryDays(e.target.value)} type="number" placeholder="Giao lần đầu (ngày)" className="px-3 py-2 bg-zinc-800/60 border border-zinc-700/60 rounded-lg text-sm text-zinc-200" />
        <input value={revisionLimit} onChange={(e) => setRevisionLimit(e.target.value)} type="number" placeholder="Số lần chỉnh sửa (để trống = không giới hạn)" className="px-3 py-2 bg-zinc-800/60 border border-zinc-700/60 rounded-lg text-sm text-zinc-200" />
        <input value={supportWeeks} onChange={(e) => setSupportWeeks(e.target.value)} type="number" placeholder="Tuần hỗ trợ" className="px-3 py-2 bg-zinc-800/60 border border-zinc-700/60 rounded-lg text-sm text-zinc-200" />
        <input value={targetGoal} onChange={(e) => setTargetGoal(e.target.value)} placeholder="Mục tiêu phù hợp (vd: MUSCLE_GAIN)" className="px-3 py-2 bg-zinc-800/60 border border-zinc-700/60 rounded-lg text-sm text-zinc-200" />
        <input value={targetLevel} onChange={(e) => setTargetLevel(e.target.value)} placeholder="Trình độ phù hợp (vd: INTERMEDIATE)" className="px-3 py-2 bg-zinc-800/60 border border-zinc-700/60 rounded-lg text-sm text-zinc-200" />
      </div>
      <button
        data-testid="create-service-submit-button"
        onClick={() => createMutation.mutate()}
        disabled={createMutation.isPending || !title || !price}
        className="w-full py-2.5 rounded-xl bg-green-500 text-black text-sm font-bold hover:bg-green-400 disabled:opacity-40"
      >
        {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : "Đăng dịch vụ"}
      </button>
    </div>
  );
}

function MyServicesTab() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const servicesQuery = useQuery({ queryKey: ["personalized-services", "mine"], queryFn: () => personalizedServiceApi.listMine() });
  const ordersQuery = useQuery({ queryKey: ["personalized-service-orders", "selling"], queryFn: () => personalizedServiceApi.listOrdersForSeller() });
  const archiveMutation = useMutation({
    mutationFn: (id: string) => personalizedServiceApi.archive(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["personalized-services", "mine"] }),
  });

  return (
    <div className="space-y-6">
      <CreateServiceForm onCreated={() => queryClient.invalidateQueries({ queryKey: ["personalized-services", "mine"] })} />

      <div>
        <h3 className="text-sm font-bold text-zinc-300 mb-2">Dịch vụ của tôi</h3>
        <div className="space-y-2">
          {servicesQuery.data?.map((svc) => (
            <div key={svc.id} className="rounded-xl border border-zinc-800/60 bg-zinc-900 p-3.5 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-zinc-200">{svc.title}</p>
                <p className="text-xs text-zinc-500">{svc.price.toLocaleString("vi-VN")}đ · {svc.status}</p>
              </div>
              {svc.status === "ACTIVE" && (
                <button onClick={() => archiveMutation.mutate(svc.id)} className="text-xs text-zinc-500 hover:text-red-400">Ẩn</button>
              )}
            </div>
          ))}
          {servicesQuery.data?.length === 0 && <p className="text-sm text-zinc-600 text-center py-6">Chưa có dịch vụ nào.</p>}
        </div>
      </div>

      <div>
        <h3 className="text-sm font-bold text-zinc-300 mb-2">Đơn hàng khách mua</h3>
        <div className="space-y-2">
          {ordersQuery.data?.map((order) => (
            <button
              key={order.id}
              data-testid="seller-order-row"
              onClick={() => navigate(`/pt/service-orders/${order.id}`)}
              className="w-full text-left rounded-xl border border-zinc-800/60 bg-zinc-900 p-3.5 hover:border-green-500/40 flex items-center justify-between gap-3"
            >
              <div>
                <p className="text-sm font-semibold text-zinc-200">{order.titleSnapshot}</p>
                <p className="text-xs text-zinc-500 mt-0.5">{order.priceAtPurchase.toLocaleString("vi-VN")}đ</p>
              </div>
              <span className="text-[11px] px-2 py-1 rounded-lg bg-zinc-800 text-zinc-300 font-semibold whitespace-nowrap">{order.status}</span>
            </button>
          ))}
          {ordersQuery.data?.length === 0 && <p className="text-sm text-zinc-600 text-center py-6">Chưa có khách mua dịch vụ nào.</p>}
        </div>
      </div>
    </div>
  );
}

export function PlanMarketplacePage() {
  const { isPT } = useApp();
  const [tab, setTab] = useState<TabValue>("browse");
  const visibleTabs = TABS.filter((t) => isPT || (t.value !== "sell-packages" && t.value !== "my-services"));

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-5">
      <div>
        <h1 className="text-zinc-100 flex items-center gap-2 text-xl font-bold">
          <Store className="w-5 h-5 text-green-400" /> Chợ kế hoạch tập luyện
        </h1>
        <p className="text-zinc-500 text-sm mt-0.5">
          Khám phá kế hoạch được cộng đồng đánh giá cao, hoặc đăng và bán kế
          hoạch của bạn.
        </p>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {visibleTabs.map((t) => (
          <button
            key={t.value}
            type="button"
            data-testid={`marketplace-tab-${t.value}`}
            onClick={() => setTab(t.value)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all border ${tab === t.value ? "bg-green-500 text-black border-green-500" : "bg-zinc-900 border-zinc-700/60 text-zinc-400 hover:border-green-500/40"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "browse" && <BrowseTab />}
      {tab === "pt-services" && <PtServicesBrowseTab />}
      {tab === "mine" && <MineTab />}
      {tab === "buy-packages" && <BuyPackagesTab />}
      {tab === "my-orders" && <MyOrdersTab />}
      {tab === "sell-packages" && <SellPackagesTab />}
      {tab === "my-services" && <MyServicesTab />}
    </div>
  );
}
