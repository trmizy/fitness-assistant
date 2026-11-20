import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { contractService } from "../../services/api";
import { newIdempotencyKey, planReviewErrorMessage, planReviewService, type PlanReviewItem } from "../../services/planReviewApi";

const STATUS_LABEL: Record<string, { label: string; className: string }> = {
  PENDING_REVIEW: { label: "Đang chờ PT duyệt", className: "border-amber-500/30 bg-amber-500/10 text-amber-400" },
  IN_REVIEW: { label: "PT đang xem xét", className: "border-sky-500/30 bg-sky-500/10 text-sky-400" },
  APPROVED: { label: "PT đã duyệt", className: "border-green-500/30 bg-green-500/10 text-green-400" },
  CHANGES_REQUESTED: { label: "PT yêu cầu chỉnh sửa", className: "border-amber-500/30 bg-amber-500/10 text-amber-400" },
  REJECTED: { label: "PT đã từ chối", className: "border-red-500/30 bg-red-500/10 text-red-400" },
  CANCELLED: { label: "Đã huỷ", className: "border-zinc-700 bg-zinc-800 text-zinc-400" },
  SUPERSEDED: { label: "Đã được thay bằng bản mới", className: "border-zinc-700 bg-zinc-800 text-zinc-400" },
  ACCESS_REVOKED: { label: "Hợp đồng PT đã kết thúc", className: "border-zinc-700 bg-zinc-800 text-zinc-400" },
};

/**
 * Client-side "Gửi PT duyệt" panel for the CURRENT workout program. Server state is the only source of truth (refetched on mount
 * and after every action), so web and mobile always agree. The confirmation step shows exactly what the PT will receive.
 */
export function PlanReviewPanel({ programId, programName, programVersion }: { programId: string; programName: string; programVersion?: number }) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [ptUserId, setPtUserId] = useState("");
  const [note, setNote] = useState("");
  // One key per confirmed attempt: a double click or retry re-sends the SAME key, so the server returns the same request.
  const attemptKey = useRef<string>(newIdempotencyKey());

  // `programVersion` is part of the key: any edit to the plan bumps it server-side, which refetches the review state so an approval
  // that no longer applies is never shown as current.
  const reviews = useQuery({ queryKey: ["plan-reviews", "mine", programId, programVersion ?? null], queryFn: () => planReviewService.mine(programId), retry: false });
  const contracts = useQuery({ queryKey: ["contracts", "client", "active"], queryFn: () => contractService.getByClient("ACTIVE") });

  const pts = useMemo(
    () =>
      ((contracts.data ?? []) as any[]).map((c) => ({
        userId: c.ptUserId as string,
        name: `${c.ptProfile?.firstName ?? ""} ${c.ptProfile?.lastName ?? ""}`.trim() || "PT của bạn",
      })),
    [contracts.data],
  );

  const latest: PlanReviewItem | undefined = reviews.data?.[0];
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["plan-reviews"] });

  const submit = useMutation({
    mutationFn: () => planReviewService.submit({ ptUserId: ptUserId || pts[0]?.userId, clientNote: note.trim() || undefined, idempotencyKey: attemptKey.current }),
    onSuccess: () => {
      toast.success("Đã gửi kế hoạch cho PT.");
      setConfirming(false);
      setNote("");
      attemptKey.current = newIdempotencyKey();
      refresh();
    },
    onError: (e) => toast.error(planReviewErrorMessage(e)),
  });
  const cancel = useMutation({
    mutationFn: (id: string) => planReviewService.cancel(id),
    onSuccess: () => { toast.success("Đã huỷ yêu cầu."); refresh(); },
    onError: (e) => { toast.error(planReviewErrorMessage(e)); refresh(); },
  });

  const open = latest && (latest.status === "PENDING_REVIEW" || latest.status === "IN_REVIEW");
  // An approval that no longer applies (plan edited since, incl. A -> B -> A) must not read as a plain green "approved" badge.
  const status = latest
    ? latest.status === "APPROVED" && latest.effectiveState === "APPROVED_OUTDATED"
      ? { label: "Đã duyệt bản cũ — cần gửi lại", className: "border-amber-500/30 bg-amber-500/10 text-amber-400" }
      : STATUS_LABEL[latest.status]
    : null;

  if (reviews.isLoading || contracts.isLoading) return <div className="h-16 animate-pulse rounded-xl bg-zinc-900" aria-busy="true" />;
  if (pts.length === 0 && !latest) return null; // no active PT contract => the feature simply is not offered

  return (
    <section className="rounded-2xl border border-zinc-800/60 bg-zinc-900 p-4 space-y-3" aria-label="Gửi PT duyệt kế hoạch">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-sm font-bold text-zinc-100">PT duyệt kế hoạch</h3>
        {status && <span className={`rounded-full border px-2.5 py-1 text-xs font-bold ${status.className}`}>{status.label}</span>}
      </div>

      {latest?.effectiveState === "APPROVED_OUTDATED" && (
        <p role="alert" className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
          Bạn đã chỉnh sửa kế hoạch sau khi PT duyệt — lần duyệt trước <b>không còn áp dụng</b> cho bản hiện tại. Hãy gửi lại để PT duyệt bản mới.
        </p>
      )}
      {latest?.decisionNote && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
          <p className="text-xs font-semibold text-zinc-400 mb-1">Phản hồi của PT</p>
          <p className="text-sm text-zinc-200 whitespace-pre-wrap">{latest.decisionNote}</p>
        </div>
      )}

      {open ? (
        <button
          type="button"
          onClick={() => cancel.mutate(latest!.id)}
          disabled={cancel.isPending}
          className="rounded-lg border border-zinc-700 px-3.5 py-2 text-xs font-bold text-zinc-300 hover:bg-zinc-800 disabled:opacity-60"
        >
          {cancel.isPending ? "Đang huỷ..." : "Huỷ yêu cầu"}
        </button>
      ) : !confirming ? (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="rounded-lg bg-green-500 px-3.5 py-2 text-xs font-bold text-black hover:bg-green-400"
        >
          {latest ? "Gửi lại cho PT" : "Gửi PT duyệt"}
        </button>
      ) : (
        <div className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-950/40 p-3" role="dialog" aria-label="Xác nhận gửi kế hoạch">
          <p className="text-xs text-zinc-300">
            PT sẽ nhận một <b>bản sao cố định</b> của kế hoạch “{programName}” (các ngày tập, bài tập, số hiệp/lần). Chỉ nội dung kế hoạch được chia sẻ —
            <b> không</b> kèm chỉ số InBody, hồ sơ sức khoẻ hay nhật ký tập.
          </p>
          {pts.length > 1 && (
            <select value={ptUserId || pts[0].userId} onChange={(e) => setPtUserId(e.target.value)} className="w-full rounded-lg border border-zinc-700 bg-zinc-900 p-2 text-sm text-zinc-100">
              {pts.map((p) => <option key={p.userId} value={p.userId}>{p.name}</option>)}
            </select>
          )}
          {pts.length === 1 && <p className="text-xs text-zinc-400">Gửi tới: <b className="text-zinc-200">{pts[0].name}</b></p>}
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={1000}
            rows={2}
            placeholder="Lời nhắn cho PT (không bắt buộc)"
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 p-2 text-sm text-zinc-100"
          />
          <div className="flex gap-2">
            <button type="button" onClick={() => submit.mutate()} disabled={submit.isPending} className="rounded-lg bg-green-500 px-3.5 py-2 text-xs font-bold text-black hover:bg-green-400 disabled:opacity-60">
              {submit.isPending ? "Đang gửi..." : "Xác nhận gửi"}
            </button>
            <button type="button" onClick={() => setConfirming(false)} disabled={submit.isPending} className="rounded-lg border border-zinc-700 px-3.5 py-2 text-xs font-bold text-zinc-300 hover:bg-zinc-800">
              Quay lại
            </button>
          </div>
        </div>
      )}
      {reviews.isError && <p className="text-xs text-red-300">{planReviewErrorMessage(reviews.error)}</p>}
    </section>
  );
}
