import { useState } from "react";
import { useMutation, useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { toast } from "sonner";
import { useBackDismissible } from "../../hooks/useBackDismissible";
import { ArrowsLeftRightIcon as GitCompare, MagnifyingGlassIcon as Search, XIcon as X, CheckIcon as Check, LinkSimpleIcon as Link2, PlusCircleIcon as PlusCircle, QuestionIcon as HelpCircle, ProhibitIcon as Ban, CircleNotchIcon as Loader2, ShieldWarningIcon as ShieldAlert, ClockCounterClockwiseIcon as History } from "@phosphor-icons/react";
import {
  exerciseReviewService,
  type ExerciseReviewCandidate,
} from "../../services/api";

/**
 * Gate 7 (exercise/anatomy data-expansion roadmap) — human review queue
 * for the LIKELY_DUPLICATE/MANUAL_REVIEW exercise candidates Gate 5/6's
 * automatic importers deliberately never act on. This page NEVER decides
 * anything on its own — every action here is one explicit admin choice,
 * recorded with a required note, never a bulk auto-merge.
 */

const STATUS_TABS: Record<string, string> = {
  PENDING: "Chờ duyệt",
  REVIEWED: "Đã duyệt",
  ALL: "Tất cả",
};

const DECISION_TIER_LABEL: Record<string, { label: string; className: string }> = {
  LIKELY_DUPLICATE: { label: "Có thể trùng", className: "text-amber-400 bg-amber-500/10 border-amber-500/30" },
  MANUAL_REVIEW: { label: "Cần xem thủ công", className: "text-sky-400 bg-sky-500/10 border-sky-500/30" },
  POSSIBLE_VARIANT: { label: "Biến thể liên quan", className: "text-purple-400 bg-purple-500/10 border-purple-500/30" },
  DISTINCT: { label: "Không trùng", className: "text-zinc-400 bg-zinc-500/10 border-zinc-500/30" },
  EXACT_SAME_SOURCE: { label: "Trùng nguồn", className: "text-green-400 bg-green-500/10 border-green-500/30" },
  EXACT_CROSS_SOURCE: { label: "Trùng chéo nguồn", className: "text-green-400 bg-green-500/10 border-green-500/30" },
};

const REVIEW_STATUS_LABEL: Record<string, string> = {
  PENDING: "Chờ duyệt",
  APPROVE_AS_NEW_STAGING: "Đã duyệt: bài mới (STAGING)",
  LINK_AS_ALIAS_OF_EXISTING: "Đã gắn làm alias của bài có sẵn",
  MARK_AS_DUPLICATE_SKIP: "Đã đánh dấu trùng, bỏ qua",
  NEEDS_MORE_INFO: "Cần xem thêm",
  REJECT_RECORD: "Đã từ chối",
};

const DECISION_OPTIONS: Array<{
  value: "APPROVE_AS_NEW_STAGING" | "LINK_AS_ALIAS_OF_EXISTING" | "MARK_AS_DUPLICATE_SKIP" | "NEEDS_MORE_INFO" | "REJECT_RECORD";
  label: string;
  icon: typeof Check;
  className: string;
  needsTarget?: boolean;
  risky?: boolean;
}> = [
  { value: "APPROVE_AS_NEW_STAGING", label: "Giữ là bài mới ở STAGING", icon: PlusCircle, className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20", risky: true },
  { value: "LINK_AS_ALIAS_OF_EXISTING", label: "Gắn làm alias của bài đã có", icon: Link2, className: "border-sky-500/30 bg-sky-500/10 text-sky-300 hover:bg-sky-500/20", needsTarget: true, risky: true },
  { value: "MARK_AS_DUPLICATE_SKIP", label: "Đánh dấu trùng và bỏ qua", icon: Ban, className: "border-amber-500/30 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20" },
  { value: "NEEDS_MORE_INFO", label: "Cần xem thêm", icon: HelpCircle, className: "border-zinc-600 bg-zinc-800/50 text-zinc-300 hover:bg-zinc-800" },
  { value: "REJECT_RECORD", label: "Từ chối record", icon: X, className: "border-red-500/30 bg-red-500/10 text-red-300 hover:bg-red-500/20", risky: true },
];

export function AdminExerciseReview() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<"PENDING" | "REVIEWED" | "ALL">("PENDING");
  const [decisionTier, setDecisionTier] = useState<string>("");
  const [search, setSearch] = useState("");
  const [selectedRef, setSelectedRef] = useState<string | null>(null);
  useBackDismissible(!!selectedRef, () => setSelectedRef(null));
  const [pendingDecision, setPendingDecision] = useState<(typeof DECISION_OPTIONS)[number] | null>(null);
  const [note, setNote] = useState("");
  const [targetExerciseId, setTargetExerciseId] = useState("");

  const summaryQuery = useQuery({
    queryKey: ["admin", "exercise-review", "summary"],
    queryFn: () => exerciseReviewService.getSummary(),
  });

  const listQuery = useQuery({
    queryKey: ["admin", "exercise-review", "list", status, decisionTier, search],
    // Keeps the current rows on screen while the new filter loads, instead of
    // dropping to undefined and flashing an empty list on every filter change.
    placeholderData: keepPreviousData,
    queryFn: () => exerciseReviewService.list({ status, decisionTier: decisionTier || undefined, search: search || undefined }),
  });

  const detailQuery = useQuery({
    queryKey: ["admin", "exercise-review", "detail", selectedRef],
    queryFn: () => exerciseReviewService.getDetail(selectedRef!),
    enabled: !!selectedRef,
  });

  const historyQuery = useQuery({
    queryKey: ["admin", "exercise-review", "history", selectedRef],
    queryFn: () => exerciseReviewService.getHistory(selectedRef!),
    enabled: !!selectedRef,
  });

  const decisionMutation = useMutation({
    mutationFn: () =>
      exerciseReviewService.submitDecision(selectedRef!, {
        decision: pendingDecision!.value,
        targetExerciseId: pendingDecision!.needsTarget ? targetExerciseId : undefined,
        note,
      }),
    onSuccess: (result) => {
      toast.success(result.alreadyDecided ? "Quyết định này đã được ghi nhận trước đó." : "Đã ghi nhận quyết định.");
      setPendingDecision(null);
      setNote("");
      setTargetExerciseId("");
      queryClient.invalidateQueries({ queryKey: ["admin", "exercise-review"] });
    },
    onError: (error: any) => {
      toast.error(error?.response?.data?.error ?? "Không thể ghi nhận quyết định.");
    },
  });

  const candidates = listQuery.data?.candidates ?? [];
  const summary = summaryQuery.data?.summary ?? listQuery.data?.summary ?? {};
  const detail = detailQuery.data;

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-zinc-100 flex items-center gap-2 text-xl font-bold">
          <GitCompare className="w-5 h-5 text-emerald-400" /> Duyệt bài tập trùng lặp (Gate 7)
        </h1>
        <p className="text-zinc-500 text-sm mt-0.5">
          Các bài tập trong catalog chờ nhập có thể trùng với bài đã có — hệ thống không tự quyết định thay bạn.
        </p>
      </div>

      <div className="flex items-start gap-2.5 rounded-xl border border-sky-500/20 bg-sky-500/8 p-3">
        <ShieldAlert className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
        <div className="text-xs text-sky-100/90 space-y-1">
          <p>Bản ghi này có thể trùng với bài đã có — hãy so sánh kỹ trước khi quyết định.</p>
          <p>Duyệt sẽ không xoá hoặc ghi đè dữ liệu cũ — bài tập cũ luôn được giữ nguyên.</p>
          <p>Bản được duyệt là "bài mới" vẫn ở trạng thái STAGING — chưa hiển thị cho người dùng thật cho đến khi được publish riêng.</p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { key: "total", label: "Tổng chờ xử lý" },
          { key: "PENDING", label: "Chưa duyệt" },
          { key: "LIKELY_DUPLICATE", label: "Có thể trùng" },
          { key: "MANUAL_REVIEW", label: "Cần xem thủ công" },
        ].map((s) => (
          <div key={s.key} className="rounded-xl border border-zinc-800/40 bg-zinc-900/40 p-3">
            <p className="text-2xl text-zinc-100 font-semibold">{summary[s.key] ?? "—"}</p>
            <p className="text-[11px] text-zinc-500 mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        {Object.entries(STATUS_TABS).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setStatus(k as any)}
            className={`px-3 py-1.5 rounded-lg text-xs border transition-colors ${
              status === k ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300" : "border-zinc-700/40 text-zinc-400 hover:bg-zinc-800/40"
            }`}
          >
            {label}
          </button>
        ))}
        <select
          value={decisionTier}
          onChange={(e) => setDecisionTier(e.target.value)}
          className="px-3 py-1.5 rounded-lg text-xs border border-zinc-700/40 bg-zinc-900/60 text-zinc-300"
        >
          <option value="">Mọi mức độ</option>
          <option value="LIKELY_DUPLICATE">Có thể trùng</option>
          <option value="MANUAL_REVIEW">Cần xem thủ công</option>
          <option value="POSSIBLE_VARIANT">Biến thể liên quan</option>
        </select>
        <div className="relative flex-1 min-w-[180px]">
          <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tìm theo tên bài tập..."
            className="w-full pl-8 pr-3 py-1.5 rounded-lg text-xs border border-zinc-700/40 bg-zinc-900/60 text-zinc-200 placeholder:text-zinc-600"
          />
        </div>
      </div>

      {listQuery.isLoading ? (
        <div className="flex items-center justify-center py-16 text-zinc-500">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Đang tải...
        </div>
      ) : candidates.length === 0 ? (
        <div className="text-center py-16 text-zinc-500 text-sm">
          Không có bản ghi nào khớp bộ lọc hiện tại.
        </div>
      ) : (
        <div className="space-y-2" data-testid="exercise-review-list">
          {candidates.map((c) => (
            <CandidateRow key={c.externalRef} candidate={c} onOpen={() => setSelectedRef(c.externalRef)} />
          ))}
        </div>
      )}

      {selectedRef && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setSelectedRef(null)}>
          <div
            className="w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-2xl border border-zinc-700/40 bg-zinc-900 p-6 space-y-5"
            onClick={(e) => e.stopPropagation()}
            data-testid="exercise-review-detail-modal"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-lg text-zinc-100 font-semibold">So sánh chi tiết</h2>
              <button onClick={() => setSelectedRef(null)} className="text-zinc-500 hover:text-zinc-300">
                <X className="w-5 h-5" />
              </button>
            </div>

            {detailQuery.isLoading || !detail ? (
              <div className="flex items-center justify-center py-16 text-zinc-500">
                <Loader2 className="w-5 h-5 animate-spin mr-2" /> Đang tải chi tiết...
              </div>
            ) : (
              <>
                <div className="grid md:grid-cols-2 gap-4">
                  <div className="rounded-xl border border-zinc-700/40 bg-zinc-800/30 p-4 space-y-2">
                    <p className="text-xs text-emerald-400 uppercase tracking-wide">Bản ghi mới (catalog)</p>
                    <p className="text-base text-zinc-100">{detail.nameEn}</p>
                    <p className="text-sm text-zinc-400">{detail.nameVi}</p>
                    <dl className="text-xs text-zinc-500 space-y-1 mt-2">
                      <div><dt className="inline text-zinc-600">Movement pattern: </dt><dd className="inline">{detail.catalogRow.movementPattern}</dd></div>
                      <div><dt className="inline text-zinc-600">Equipment: </dt><dd className="inline">{detail.catalogRow.equipment.join(", ") || "—"}</dd></div>
                      <div><dt className="inline text-zinc-600">Cơ chính: </dt><dd className="inline">{detail.catalogRow.primaryMuscles.join(", ") || "—"}</dd></div>
                      <div><dt className="inline text-zinc-600">Độ khó: </dt><dd className="inline">{detail.catalogRow.difficulty || "—"}</dd></div>
                    </dl>
                    {detail.catalogRow.executionSteps && (
                      <p className="text-xs text-zinc-400 whitespace-pre-line border-t border-zinc-700/30 pt-2 mt-2">{detail.catalogRow.executionSteps}</p>
                    )}
                  </div>

                  <div className="rounded-xl border border-zinc-700/40 bg-zinc-800/30 p-4 space-y-2">
                    <p className="text-xs text-sky-400 uppercase tracking-wide">Bản ghi cũ (đang có trong hệ thống)</p>
                    {detail.bestMatchExerciseDetail ? (
                      <>
                        <p className="text-base text-zinc-100">{detail.bestMatchExerciseDetail.exerciseName}</p>
                        <p className="text-xs text-amber-300/80">
                          Đang được tham chiếu bởi {detail.bestMatchExercise?.referenceCount ?? 0} buổi tập/chương trình thật
                        </p>
                        <dl className="text-xs text-zinc-500 space-y-1 mt-2">
                          <div><dt className="inline text-zinc-600">Equipment: </dt><dd className="inline">{detail.bestMatchExerciseDetail.typeOfEquipment}</dd></div>
                          <div><dt className="inline text-zinc-600">Body part: </dt><dd className="inline">{detail.bestMatchExerciseDetail.bodyPart}</dd></div>
                          <div><dt className="inline text-zinc-600">Cơ chính: </dt><dd className="inline">{detail.bestMatchExerciseDetail.muscleGroupsActivated.join(", ") || "—"}</dd></div>
                          <div><dt className="inline text-zinc-600">Trạng thái: </dt><dd className="inline">{detail.bestMatchExerciseDetail.status}</dd></div>
                        </dl>
                        {detail.bestMatchExerciseDetail.instructions && (
                          <p className="text-xs text-zinc-400 whitespace-pre-line border-t border-zinc-700/30 pt-2 mt-2">{detail.bestMatchExerciseDetail.instructions}</p>
                        )}
                      </>
                    ) : (
                      <p className="text-sm text-zinc-500">Không có bài tập tương tự nào trong hệ thống — không có gì để so sánh.</p>
                    )}
                  </div>
                </div>

                <div className="rounded-xl border border-zinc-700/40 bg-zinc-800/20 p-4 space-y-1.5">
                  <p className="text-xs text-zinc-500">Đánh giá tự động (không tự quyết định thay bạn):</p>
                  <p className="text-sm text-zinc-200">
                    {DECISION_TIER_LABEL[detail.duplicateDecision]?.label ?? detail.duplicateDecision} — độ tin cậy {Math.round(detail.confidence * 100)}%
                  </p>
                  {detail.matchedFields.length > 0 && <p className="text-xs text-emerald-400/80">Giống nhau: {detail.matchedFields.join(", ")}</p>}
                  {detail.conflictingFields.length > 0 && <p className="text-xs text-red-400/80">Khác nhau: {detail.conflictingFields.join(", ")}</p>}
                  <p className="text-xs text-zinc-500 italic">{detail.proposedAction}</p>
                </div>

                {historyQuery.data && historyQuery.data.history.length > 0 && (
                  <div className="rounded-xl border border-zinc-700/40 bg-zinc-800/20 p-4 space-y-2">
                    <p className="text-xs text-zinc-500 flex items-center gap-1.5"><History className="w-3.5 h-3.5" /> Lịch sử quyết định</p>
                    {historyQuery.data.history.map((h, i) => (
                      <div key={i} className="text-xs text-zinc-400 border-l-2 border-zinc-700 pl-2">
                        <span className="text-zinc-300">{REVIEW_STATUS_LABEL[h.decision] ?? h.decision}</span>
                        {h.note && <span className="text-zinc-500"> — {h.note}</span>}
                        <span className="text-zinc-600 block">{new Date(h.createdAt).toLocaleString("vi-VN")}</span>
                      </div>
                    ))}
                  </div>
                )}

                {detail.reviewStatus !== "PENDING" ? (
                  <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/8 p-3 text-sm text-emerald-300 flex items-center gap-2">
                    <Check className="w-4 h-4" /> {REVIEW_STATUS_LABEL[detail.reviewStatus] ?? detail.reviewStatus}
                  </div>
                ) : pendingDecision ? (
                  <div className="rounded-xl border border-zinc-700/40 bg-zinc-800/40 p-4 space-y-3">
                    <p className="text-sm text-zinc-200 flex items-center gap-2">
                      <pendingDecision.icon className="w-4 h-4" /> {pendingDecision.label}
                    </p>
                    {pendingDecision.needsTarget && (
                      <input
                        value={targetExerciseId}
                        onChange={(e) => setTargetExerciseId(e.target.value)}
                        placeholder={detail.bestMatchExercise ? `ID bài tập đích (mặc định: ${detail.bestMatchExercise.id})` : "ID bài tập đích"}
                        defaultValue={detail.bestMatchExercise?.id ?? ""}
                        className="w-full px-3 py-2 rounded-lg text-sm border border-zinc-700/40 bg-zinc-900/60 text-zinc-200"
                      />
                    )}
                    <textarea
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="Bắt buộc: giải thích lý do quyết định này..."
                      rows={2}
                      className="w-full px-3 py-2 rounded-lg text-sm border border-zinc-700/40 bg-zinc-900/60 text-zinc-200 placeholder:text-zinc-600"
                    />
                    <div className="flex gap-2 justify-end">
                      <button onClick={() => setPendingDecision(null)} className="px-4 py-2 rounded-lg text-xs text-zinc-400 hover:bg-zinc-800/50">
                        Huỷ
                      </button>
                      <button
                        onClick={() => {
                          if (pendingDecision.needsTarget && !targetExerciseId && detail.bestMatchExercise) {
                            setTargetExerciseId(detail.bestMatchExercise.id);
                          }
                          decisionMutation.mutate();
                        }}
                        disabled={decisionMutation.isPending || !note.trim() && (pendingDecision.risky ?? false)}
                        className="px-4 py-2 rounded-lg text-xs bg-emerald-500 text-black disabled:opacity-40 flex items-center gap-1.5"
                      >
                        {decisionMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Xác nhận
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="grid sm:grid-cols-2 gap-2" data-testid="exercise-review-decision-options">
                    {DECISION_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => {
                          setPendingDecision(opt);
                          setNote("");
                          setTargetExerciseId(detail.bestMatchExercise?.id ?? "");
                        }}
                        className={`flex items-center gap-2 px-3 py-2.5 rounded-lg text-xs border transition-colors ${opt.className}`}
                        data-testid={`decision-option-${opt.value}`}
                      >
                        <opt.icon className="w-3.5 h-3.5 shrink-0" /> {opt.label}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function CandidateRow({ candidate, onOpen }: { candidate: ExerciseReviewCandidate; onOpen: () => void }) {
  const tier = DECISION_TIER_LABEL[candidate.duplicateDecision] ?? { label: candidate.duplicateDecision, className: "text-zinc-400 bg-zinc-500/10 border-zinc-500/30" };
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-zinc-800/40 bg-zinc-900/40 p-3" data-testid="exercise-review-row">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm text-zinc-100 truncate">{candidate.nameEn}</p>
          <span className="text-xs text-zinc-500">/ {candidate.nameVi}</span>
          <span className={`text-[10px] px-2 py-0.5 rounded-full border ${tier.className}`}>{tier.label}</span>
          {candidate.reviewStatus !== "PENDING" && (
            <span className="text-[10px] px-2 py-0.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-300">
              {REVIEW_STATUS_LABEL[candidate.reviewStatus] ?? candidate.reviewStatus}
            </span>
          )}
        </div>
        {candidate.bestMatchExercise && (
          <p className="text-xs text-zinc-500 mt-1 truncate">
            Giống với: {candidate.bestMatchExercise.name} ({Math.round(candidate.confidence * 100)}% tin cậy, {candidate.bestMatchExercise.referenceCount} tham chiếu thật)
          </p>
        )}
      </div>
      <button
        onClick={onOpen}
        className="shrink-0 px-3 py-1.5 rounded-lg text-xs bg-zinc-800/60 border border-zinc-700/30 text-zinc-300 hover:bg-zinc-800"
        data-testid="exercise-review-open-detail"
      >
        Xem &amp; duyệt
      </button>
    </div>
  );
}
