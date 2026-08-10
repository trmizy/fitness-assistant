import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Star, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { gymService } from "../../services/api";
import type { GymReviewsResponse } from "../../types";
import { Stars } from "./Stars";

function currentUserId(): string {
  try {
    return JSON.parse(localStorage.getItem("user") || "{}")?.id ?? "";
  } catch {
    return "";
  }
}

const shortId = (id: string) => `${id.slice(0, 8)}…`;

export function GymReviewsSection({ gymId }: { gymId: string }) {
  const queryClient = useQueryClient();
  const userId = currentUserId();
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");

  const { data, isLoading } = useQuery<GymReviewsResponse>({
    queryKey: ["gym-reviews", gymId],
    queryFn: () => gymService.getGymReviews(gymId),
  });

  // Only someone who has bought a membership here may rate the gym; everyone else can read
  // the reviews but gets no form. The server enforces this too (403 NOT_A_MEMBER) — showing
  // the form to a non-member just invited a click that was always going to be rejected.
  const { data: myMemberships = [] } = useQuery<any[]>({
    queryKey: ["client-gym-memberships"],
    queryFn: () => gymService.listMyMemberships(),
  });
  // ACTIVE = current member, EXPIRED = used to be one. Both count; a CANCELLED (refunded)
  // membership does not, matching the server's rule.
  const canReview = myMemberships.some(
    (m) => m.gymId === gymId && ["ACTIVE", "EXPIRED"].includes(String(m.status)),
  );

  const myReview = data?.reviews.find((r) => r.clientId === userId);

  // Prefill the form from an existing review once loaded.
  useEffect(() => {
    if (myReview) {
      setRating(myReview.rating);
      setComment(myReview.comment ?? "");
    }
  }, [myReview?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["gym-reviews", gymId] });
    queryClient.invalidateQueries({ queryKey: ["gym", gymId] });
    queryClient.invalidateQueries({ queryKey: ["gyms"] });
  };

  const submitMutation = useMutation({
    mutationFn: () => gymService.submitGymReview(gymId, { rating, comment: comment.trim() || undefined }),
    onSuccess: () => {
      toast.success(myReview ? "Đã cập nhật đánh giá" : "Cảm ơn bạn đã đánh giá!");
      invalidate();
    },
    onError: (err: any) => {
      const code = err?.response?.data?.error?.code;
      if (code === "NOT_A_MEMBER") toast.error("Chỉ hội viên đã mua gói tại phòng gym này mới được đánh giá.");
      else toast.error(err?.response?.data?.error?.message || "Không gửi được đánh giá");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => gymService.deleteGymReview(gymId),
    onSuccess: () => {
      toast.success("Đã xoá đánh giá");
      setRating(5);
      setComment("");
      invalidate();
    },
    onError: () => toast.error("Không xoá được đánh giá"),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-bold text-zinc-300">Đánh giá</h2>
        {data && data.count > 0 && (
          <span className="flex items-center gap-1.5 text-xs text-zinc-400">
            <Stars value={data.averageRating} /> {data.averageRating.toFixed(1)} ({data.count})
          </span>
        )}
      </div>

      {/* Write / edit form — members only; everyone else just reads. */}
      {!canReview ? (
        <div className="bg-zinc-900/60 rounded-xl border border-zinc-800/60 p-3">
          <p className="text-xs text-zinc-500">
            Chỉ hội viên đã mua gói tại phòng gym này mới được đánh giá. Bạn vẫn có thể xem
            các đánh giá bên dưới.
          </p>
        </div>
      ) : (
      <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4 space-y-3">
        <div className="text-xs text-zinc-500">{myReview ? "Chỉnh sửa đánh giá của bạn" : "Viết đánh giá"}</div>
        <div className="flex items-center gap-1.5">
          {Array.from({ length: 5 }).map((_, i) => (
            <button key={i} type="button" onClick={() => setRating(i + 1)}>
              <Star className={`w-6 h-6 transition-colors ${i < rating ? "text-amber-400 fill-amber-400" : "text-zinc-700 hover:text-zinc-500"}`} />
            </button>
          ))}
        </div>
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={2}
          placeholder="Cảm nhận của bạn về phòng gym (không bắt buộc)"
          className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-green-500/50 resize-none"
        />
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => submitMutation.mutate()}
            disabled={submitMutation.isPending}
            className="flex items-center gap-1.5 bg-green-500 hover:bg-green-400 disabled:opacity-60 text-black px-3 py-2 rounded-lg text-xs font-bold transition-all"
          >
            {submitMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {myReview ? "Cập nhật" : "Gửi đánh giá"}
          </button>
          {myReview && (
            <button
              type="button"
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
              className="flex items-center gap-1.5 border border-red-500/30 text-red-400 hover:bg-red-500/10 px-3 py-2 rounded-lg text-xs font-medium transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" /> Xoá
            </button>
          )}
        </div>
      </div>
      )}

      {/* Reviews list */}
      {isLoading ? (
        <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 text-green-500 animate-spin" /></div>
      ) : data && data.reviews.length > 0 ? (
        <div className="space-y-2">
          {data.reviews.map((r) => (
            <div key={r.id} className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-zinc-300">
                  {r.clientId === userId ? "Bạn" : shortId(r.clientId)}
                </span>
                <Stars value={r.rating} />
              </div>
              {r.comment && <p className="text-sm text-zinc-400 mt-1.5">{r.comment}</p>}
            </div>
          ))}
        </div>
      ) : (
        <div className="text-xs text-zinc-600">Chưa có đánh giá nào.</div>
      )}
    </div>
  );
}
