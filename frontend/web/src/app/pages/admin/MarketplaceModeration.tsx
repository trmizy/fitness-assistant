import { useState } from "react";
import { useMutation, useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckIcon as Check, CaretDownIcon as ChevronDown, FileTextIcon as FileText, CircleNotchIcon as Loader2, ShieldWarningIcon as ShieldAlert, ShieldCheckIcon as ShieldCheck, StorefrontIcon as Store, XIcon as X } from "@phosphor-icons/react";
import { marketplaceService } from "../../services/api";

const FILTERS: Record<string, string> = {
  SUBMITTED: "Chờ duyệt",
  APPROVED: "Đã duyệt",
  REJECTED: "Đã từ chối",
};

const RECOMMENDATION_CONFIG: Record<string, { label: string; className: string }> = {
  likely_safe: { label: "AI: Có vẻ ổn", className: "text-green-400 bg-green-500/10 border-green-500/30" },
  needs_review: { label: "AI: Cần xem kỹ", className: "text-amber-400 bg-amber-500/10 border-amber-500/30" },
  likely_unsafe: { label: "AI: Nguy cơ cao", className: "text-red-400 bg-red-500/10 border-red-500/30" },
};

const RULE_FLAG_LABEL: Record<string, string> = {
  NO_REST_DAY: "Không có ngày nghỉ (7/7 ngày)",
  HIGH_FREQUENCY_WITHOUT_PROGRESSION_NOTES: "Tần suất cao nhưng thiếu ghi chú tiến trình",
  EXCESSIVE_VOLUME_PER_SESSION: "Volume một buổi quá cao",
  EXCESSIVE_SETS_SINGLE_EXERCISE: "Một bài tập có quá nhiều set",
  MISSING_RECOVERY_NOTES_HIGH_FREQUENCY: "Tần suất cao nhưng thiếu ghi chú hồi phục",
  DUPLICATE_EXERCISE_SAME_SESSION: "Trùng bài tập trong cùng buổi",
  EMPTY_SCHEDULE: "Lịch tập trống",
};

export function MarketplaceModeration() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<keyof typeof FILTERS>("SUBMITTED");
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState("");

  const listQuery = useQuery({
    queryKey: ["admin", "marketplace", filter],
    // Keeps the current rows on screen while the new filter loads, instead of
    // dropping to undefined and flashing an empty list on every filter change.
    placeholderData: keepPreviousData,
    queryFn: () => marketplaceService.adminListForModeration(filter),
  });

  const reviewMutation = useMutation({
    mutationFn: ({
      id,
      action,
      note,
    }: {
      id: string;
      action: "APPROVE" | "REJECT";
      note?: string;
    }) => marketplaceService.adminReviewAction(id, action, note),
    onSuccess: () => {
      toast.success("Đã cập nhật trạng thái");
      setRejectingId(null);
      setRejectNote("");
      queryClient.invalidateQueries({ queryKey: ["admin", "marketplace"] });
    },
    onError: (error: any) => {
      toast.error(
        error?.response?.data?.error?.message ?? "Không thể cập nhật",
      );
    },
  });

  const listings = listQuery.data ?? [];
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-zinc-100 flex items-center gap-2 text-xl font-bold">
          <Store className="w-5 h-5 text-green-400" /> Duyệt kế hoạch chợ tập
          luyện
        </h1>
        <p className="text-zinc-500 text-sm mt-0.5">
          Xét duyệt các kế hoạch tập được người dùng đăng lên chợ.
        </p>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {Object.entries(FILTERS).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setFilter(k)}
            className={`whitespace-nowrap px-4 py-2 rounded-xl text-xs font-bold transition-all border ${
              filter === k
                ? "bg-green-500 text-black border-green-500"
                : "bg-zinc-900 text-zinc-500 border-zinc-800 hover:border-zinc-700"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {listQuery.isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 text-green-500 animate-spin" />
        </div>
      ) : listings.length === 0 ? (
        <div className="bg-zinc-900/50 border border-dashed border-zinc-800 rounded-2xl py-20 text-center">
          <FileText className="w-12 h-12 text-zinc-800 mx-auto mb-3" />
          <p className="text-zinc-600 text-sm">
            Không có kế hoạch nào ở trạng thái này.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {listings.map((listing) => (
            <div
              key={listing.id}
              className="bg-zinc-900 border border-zinc-800/60 rounded-2xl p-5"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-bold text-zinc-200">
                    {listing.title}
                  </h3>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    {listing.goal}
                  </p>
                </div>
              </div>
              {(() => {
                const analysis = listing.moderationAnalyses?.[0];
                if (!analysis) return null;
                const rec = RECOMMENDATION_CONFIG[analysis.aiRecommendation] ?? RECOMMENDATION_CONFIG.needs_review;
                return (
                  <div className="mt-3 space-y-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full border font-semibold ${rec.className}`}>
                        <ShieldAlert className="w-3 h-3" /> {rec.label} ({Math.round(analysis.aiConfidenceScore * 100)}% tin cậy)
                      </span>
                      {analysis.usedFallback && (
                        <span className="text-[10px] text-zinc-600 italic">AI không phản hồi được — chỉ dựa trên rule</span>
                      )}
                    </div>
                    <p className="text-[11px] text-zinc-400">{analysis.explanationForAdmin}</p>
                    {analysis.ruleFlags.length > 0 && (
                      <ul className="text-[11px] text-amber-300/80 list-disc list-inside">
                        {analysis.ruleFlags.map((f) => (
                          <li key={f}>{RULE_FLAG_LABEL[f] ?? f}</li>
                        ))}
                      </ul>
                    )}
                    {analysis.similarListings.length > 0 && (
                      <p className="text-[11px] text-red-300/80">
                        ⚠ Có thể trùng lặp với: {analysis.similarListings.map((s) => `${s.title} (${Math.round(s.similarityScore * 100)}%)`).join(", ")}
                      </p>
                    )}
                  </div>
                );
              })()}

              <button
                type="button"
                onClick={() => setExpandedId(expandedId === listing.id ? null : listing.id)}
                className="mt-3 flex items-center gap-1 text-[11px] text-zinc-400 hover:text-zinc-200"
              >
                <ChevronDown className={`w-3.5 h-3.5 transition-transform ${expandedId === listing.id ? "rotate-180" : ""}`} />
                Xem nội dung lịch tập ({listing.sourcePlan?.plan?.weeklySchedule?.length ?? 0} buổi)
              </button>
              {expandedId === listing.id && (
                <div className="mt-2 space-y-2 max-h-64 overflow-y-auto rounded-lg border border-zinc-800/60 bg-zinc-950/40 p-3">
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
                    <p className="text-[11px] text-zinc-600">Không có dữ liệu lịch tập.</p>
                  )}
                </div>
              )}

              {listing.description && (
                <p className="mt-3 text-sm text-zinc-400">
                  {listing.description}
                </p>
              )}
              <p className="mt-3 flex items-center gap-1.5 text-xs text-zinc-600">
                Người đăng: {listing.publisherId}
                {listing.publisherIsVerifiedPt ? (
                  <span className="inline-flex items-center gap-1 rounded-full border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-[10px] font-bold text-sky-400">
                    <ShieldCheck className="h-3 w-3" /> PT xác thực
                  </span>
                ) : (
                  <span className="inline-flex items-center rounded-full border border-zinc-700 bg-zinc-800/60 px-2 py-0.5 text-[10px] text-zinc-500">
                    Người dùng thường
                  </span>
                )}
              </p>
              {listing.moderationStatus === "REJECTED" &&
                listing.moderationNote && (
                  <p className="mt-2 text-xs text-red-400">
                    Lý do từ chối: {listing.moderationNote}
                  </p>
                )}

              {filter === "SUBMITTED" &&
                (rejectingId === listing.id ? (
                  <div className="mt-4 space-y-2">
                    <textarea
                      value={rejectNote}
                      onChange={(e) => setRejectNote(e.target.value)}
                      placeholder="Lý do từ chối..."
                      rows={2}
                      className="w-full rounded-lg border border-zinc-700/60 bg-zinc-800 p-2.5 text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-green-500/50"
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          reviewMutation.mutate({
                            id: listing.id,
                            action: "REJECT",
                            note: rejectNote,
                          })
                        }
                        disabled={!rejectNote || reviewMutation.isPending}
                        className="rounded-lg bg-red-500 hover:bg-red-400 disabled:opacity-50 px-3 py-1.5 text-xs font-bold text-black transition-all"
                      >
                        Xác nhận từ chối
                      </button>
                      <button
                        type="button"
                        onClick={() => setRejectingId(null)}
                        className="rounded-lg border border-zinc-700/60 px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
                      >
                        Huỷ
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-4 flex gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        reviewMutation.mutate({
                          id: listing.id,
                          action: "APPROVE",
                        })
                      }
                      disabled={reviewMutation.isPending}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-green-500 hover:bg-green-400 disabled:opacity-50 px-3 py-1.5 text-xs font-bold text-black transition-all"
                    >
                      <Check className="h-3.5 w-3.5" /> Duyệt
                    </button>
                    <button
                      type="button"
                      onClick={() => setRejectingId(listing.id)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700/60 px-3 py-1.5 text-xs text-zinc-300 hover:border-red-500/40 hover:text-red-400 transition-colors"
                    >
                      <X className="h-3.5 w-3.5" /> Từ chối
                    </button>
                  </div>
                ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
