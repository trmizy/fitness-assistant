import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, FileText, Loader2, Store, X } from "lucide-react";
import { marketplaceService, type PublishedPlanListing } from "../../services/api";

const FILTERS: Record<string, string> = {
  SUBMITTED: "Chờ duyệt",
  APPROVED: "Đã duyệt",
  REJECTED: "Đã từ chối",
};

export function MarketplaceModeration() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<keyof typeof FILTERS>("SUBMITTED");
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState("");

  const listQuery = useQuery({
    queryKey: ["admin", "marketplace", filter],
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

  const listings: PublishedPlanListing[] = listQuery.data ?? [];

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
              {listing.description && (
                <p className="mt-3 text-sm text-zinc-400">
                  {listing.description}
                </p>
              )}
              <p className="mt-3 text-xs text-zinc-600">
                Người đăng: {listing.publisherId}
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
