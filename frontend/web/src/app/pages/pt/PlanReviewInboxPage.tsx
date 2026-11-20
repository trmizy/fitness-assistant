import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { planReviewErrorMessage, planReviewService, type PlanReviewItem } from "../../services/planReviewApi";

const formatDate = (iso: string) => new Date(iso).toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

/**
 * PT inbox for client-submitted workout plans. Authorization is entirely server-side: the list only contains clients with an
 * ACTIVE contract, and every action re-checks it. If the contract ended while this page is open, the server answers 403 and the
 * list is refreshed (the item disappears) — the snapshot is never kept for a revoked relationship.
 */
export function PlanReviewInboxPage() {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const inbox = useQuery({ queryKey: ["plan-reviews", "inbox"], queryFn: () => planReviewService.inbox(), retry: false, refetchOnWindowFocus: true });
  const detail = useQuery({
    queryKey: ["plan-reviews", "detail", selectedId],
    queryFn: () => planReviewService.get(selectedId!),
    enabled: !!selectedId,
    retry: false,
  });

  useEffect(() => {
    if (!selectedId && inbox.data && inbox.data.length > 0) setSelectedId(inbox.data[0].id);
    if (selectedId && inbox.data && !inbox.data.some((r) => r.id === selectedId) && !detail.data) setSelectedId(null);
  }, [inbox.data, selectedId, detail.data]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["plan-reviews"] });
  const onError = (e: unknown) => { toast.error(planReviewErrorMessage(e)); refresh(); };

  const start = useMutation({ mutationFn: (id: string) => planReviewService.start(id), onSuccess: refresh, onError });
  const decide = useMutation({
    mutationFn: (decision: "APPROVE" | "REQUEST_CHANGES" | "REJECT") =>
      planReviewService.decide(detail.data!.id, {
        decision,
        note: note.trim() || undefined,
        // Bind the decision to exactly what the PT is looking at: a newer revision/concurrent action makes the server answer 409.
        expectedRevision: detail.data!.revision,
        expectedContentHash: detail.data!.contentHash,
      }),
    onSuccess: () => { toast.success("Đã ghi nhận quyết định."); setNote(""); setSelectedId(null); refresh(); },
    onError,
  });

  const item: PlanReviewItem | undefined = detail.data;
  const canDecide = !!item && (item.status === "PENDING_REVIEW" || item.status === "IN_REVIEW");
  const noteRequired = true; // request-changes / reject need a note; approve does not (server enforces)

  if (inbox.isLoading) return <div className="p-6 text-sm text-zinc-400" aria-busy="true">Đang tải...</div>;
  if (inbox.isError) {
    return (
      <div className="p-6 space-y-2">
        <p className="text-sm text-red-300">{planReviewErrorMessage(inbox.error)}</p>
        <button type="button" onClick={() => inbox.refetch()} className="text-xs font-semibold text-red-300 underline">Thử lại</button>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 grid gap-4 md:grid-cols-[320px_1fr]">
      <aside className="space-y-2">
        <h1 className="text-base font-bold text-zinc-100">Kế hoạch chờ duyệt</h1>
        {inbox.data!.length === 0 && <p className="text-sm text-zinc-500">Chưa có kế hoạch nào đang chờ bạn duyệt.</p>}
        {inbox.data!.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => { setSelectedId(r.id); setNote(""); }}
            className={`w-full rounded-xl border p-3 text-left ${selectedId === r.id ? "border-green-500/40 bg-green-500/5" : "border-zinc-800 bg-zinc-900 hover:bg-zinc-800/60"}`}
          >
            <p className="text-sm font-semibold text-zinc-100">Học viên · {formatDate(r.submittedAt)}</p>
            <p className="text-xs text-zinc-500">{r.status === "IN_REVIEW" ? "Đang xem xét" : "Mới gửi"}</p>
          </button>
        ))}
      </aside>

      <main className="min-w-0">
        {!selectedId && <p className="text-sm text-zinc-500">Chọn một kế hoạch để xem chi tiết.</p>}
        {selectedId && detail.isLoading && <p className="text-sm text-zinc-400" aria-busy="true">Đang tải chi tiết...</p>}
        {selectedId && detail.isError && <p className="text-sm text-red-300">{planReviewErrorMessage(detail.error)}</p>}
        {item && (
          <div className="space-y-4 rounded-2xl border border-zinc-800/60 bg-zinc-900 p-4">
            {item.isOutdated && canDecide && (
              <p role="alert" className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
                Học viên đã chỉnh sửa kế hoạch sau khi gửi. Bản bạn đang xem có thể không còn là bản hiện tại — quyết định sẽ bị từ chối nếu kế hoạch đã đổi.
              </p>
            )}
            {item.clientNote && (
              <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
                <p className="text-xs font-semibold text-zinc-400 mb-1">Lời nhắn của học viên</p>
                <p className="text-sm text-zinc-200 whitespace-pre-wrap">{item.clientNote}</p>
              </div>
            )}

            <div>
              <h2 className="text-sm font-bold text-zinc-100">{item.snapshot?.name}</h2>
              <p className="text-xs text-zinc-500">{item.snapshot?.durationWeeks ?? "—"} tuần · {item.snapshot?.daysPerWeek ?? "—"} buổi/tuần</p>
            </div>
            <div className="space-y-3">
              {(item.snapshot?.days ?? []).map((d: any) => (
                <div key={d.dayNumber} className="rounded-xl border border-zinc-800 p-3">
                  <p className="text-sm font-semibold text-zinc-100">Buổi {d.dayNumber} · {d.title}</p>
                  <ul className="mt-1 space-y-0.5 text-xs text-zinc-400">
                    {d.exercises.map((ex: any) => (
                      <li key={ex.order}>{ex.name ?? "Bài tập"} — {ex.sets ?? "—"} hiệp × {ex.reps ?? ex.duration ?? "—"}{ex.restSeconds ? ` · nghỉ ${ex.restSeconds}s` : ""}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>

            {canDecide ? (
              <div className="space-y-2">
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  maxLength={1000}
                  rows={3}
                  placeholder={noteRequired ? "Nhận xét (bắt buộc khi yêu cầu chỉnh sửa hoặc từ chối)" : ""}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-950 p-2 text-sm text-zinc-100"
                />
                <div className="flex flex-wrap gap-2">
                  {item.status === "PENDING_REVIEW" && (
                    <button type="button" onClick={() => start.mutate(item.id)} disabled={start.isPending} className="rounded-lg border border-zinc-700 px-3.5 py-2 text-xs font-bold text-zinc-300 hover:bg-zinc-800">
                      Bắt đầu xem xét
                    </button>
                  )}
                  <button type="button" onClick={() => decide.mutate("APPROVE")} disabled={decide.isPending} className="rounded-lg bg-green-500 px-3.5 py-2 text-xs font-bold text-black hover:bg-green-400 disabled:opacity-60">Duyệt</button>
                  <button type="button" onClick={() => decide.mutate("REQUEST_CHANGES")} disabled={decide.isPending || note.trim().length < 3} className="rounded-lg border border-amber-500/40 px-3.5 py-2 text-xs font-bold text-amber-300 hover:bg-amber-500/10 disabled:opacity-50">Yêu cầu chỉnh sửa</button>
                  <button type="button" onClick={() => decide.mutate("REJECT")} disabled={decide.isPending || note.trim().length < 3} className="rounded-lg border border-red-500/40 px-3.5 py-2 text-xs font-bold text-red-300 hover:bg-red-500/10 disabled:opacity-50">Từ chối</button>
                </div>
              </div>
            ) : (
              <p className="text-xs text-zinc-500">Yêu cầu này đã được xử lý.</p>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
