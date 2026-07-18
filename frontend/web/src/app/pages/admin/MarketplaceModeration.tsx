import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Loader2, Store, X } from "lucide-react";
import { marketplaceService } from "../../services/api";

export function MarketplaceModeration() {
  const queryClient = useQueryClient();
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState("");

  const pendingQuery = useQuery({
    queryKey: ["admin", "marketplace", "SUBMITTED"],
    queryFn: () => marketplaceService.adminListForModeration("SUBMITTED"),
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

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
      <div className="flex items-center gap-2">
        <Store className="h-5 w-5 text-zinc-400" />
        <h1 className="text-xl font-semibold text-zinc-100">
          Duyệt kế hoạch chợ tập luyện
        </h1>
      </div>

      {pendingQuery.isLoading ? (
        <div className="flex items-center justify-center py-12 text-zinc-500">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : pendingQuery.data && pendingQuery.data.length > 0 ? (
        <div className="space-y-3">
          {pendingQuery.data.map((listing) => (
            <div
              key={listing.id}
              className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4"
            >
              <h3 className="text-sm font-medium text-zinc-100">
                {listing.title}
              </h3>
              <p className="mt-1 text-xs text-zinc-500">{listing.goal}</p>
              {listing.description && (
                <p className="mt-2 text-sm text-zinc-400">
                  {listing.description}
                </p>
              )}
              <p className="mt-2 text-xs text-zinc-600">
                Người đăng: {listing.publisherId}
              </p>

              {rejectingId === listing.id ? (
                <div className="mt-3 space-y-2">
                  <textarea
                    value={rejectNote}
                    onChange={(e) => setRejectNote(e.target.value)}
                    placeholder="Lý do từ chối..."
                    rows={2}
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5 text-sm text-zinc-200 placeholder:text-zinc-600"
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
                      className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                    >
                      Xác nhận từ chối
                    </button>
                    <button
                      type="button"
                      onClick={() => setRejectingId(null)}
                      className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400"
                    >
                      Huỷ
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      reviewMutation.mutate({ id: listing.id, action: "APPROVE" })
                    }
                    disabled={reviewMutation.isPending}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-green-500 disabled:opacity-50"
                  >
                    <Check className="h-3.5 w-3.5" /> Duyệt
                  </button>
                  <button
                    type="button"
                    onClick={() => setRejectingId(listing.id)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 transition-colors hover:border-red-500/40 hover:text-red-400"
                  >
                    <X className="h-3.5 w-3.5" /> Từ chối
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-zinc-600">
          Không có kế hoạch nào đang chờ duyệt.
        </p>
      )}
    </div>
  );
}
