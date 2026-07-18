import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeft,
  Loader2,
  Send,
  Store,
  TrendingUp,
  Trash2,
  Upload,
} from "lucide-react";
import { StarRating } from "../../components/StarRating";
import {
  marketplaceService,
  planService,
  type PublishedPlanListing,
} from "../../services/api";

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  DRAFT: { label: "Nháp", className: "text-zinc-400 bg-zinc-800 border-zinc-700" },
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
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${cfg.className}`}
    >
      {cfg.label}
    </span>
  );
}

function ListingCard({
  listing,
  onClick,
}: {
  listing: PublishedPlanListing;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full rounded-lg border border-zinc-800 bg-zinc-950/40 p-4 text-left transition-colors hover:border-blue-500/30 hover:bg-blue-500/5"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium text-zinc-100">{listing.title}</h3>
          <p className="mt-1 text-xs text-zinc-500">{listing.goal}</p>
        </div>
        <div className="flex items-center gap-1 text-xs text-amber-400">
          <StarRating value={listing.avgRating} readonly size={14} />
        </div>
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

function DetailPanel({
  id,
  onBack,
}: {
  id: string;
  onBack: () => void;
}) {
  const queryClient = useQueryClient();
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");

  const detailQuery = useQuery({
    queryKey: ["marketplace", "detail", id],
    queryFn: () => marketplaceService.getDetail(id),
  });

  const reviewMutation = useMutation({
    mutationFn: () => marketplaceService.submitReview(id, rating, comment || undefined),
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

  if (detailQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-zinc-500">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  const listing = detailQuery.data;
  if (!listing) return null;

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-200"
      >
        <ArrowLeft className="h-4 w-4" /> Quay lại
      </button>

      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-zinc-100">{listing.title}</h2>
            <p className="mt-1 text-sm text-zinc-500">{listing.goal}</p>
          </div>
          <StarRating value={listing.avgRating} readonly />
        </div>
        {listing.description && (
          <p className="mt-3 text-sm text-zinc-400">{listing.description}</p>
        )}
        <p className="mt-2 text-xs text-zinc-600">
          {listing.ratingCount} lượt đánh giá
        </p>
      </div>

      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
        <h3 className="mb-3 text-sm font-medium text-zinc-300">
          Đánh giá của bạn
        </h3>
        <p className="mb-3 text-xs text-zinc-600">
          Bạn cần hoàn thành một chu kỳ tập luyện theo lịch tập gốc của kế hoạch này
          trước khi có thể đánh giá.
        </p>
        <StarRating value={rating} onChange={setRating} size={24} />
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Nhận xét (không bắt buộc)..."
          rows={3}
          className="mt-3 w-full rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-blue-500/40 focus:outline-none"
        />
        <button
          type="button"
          onClick={() => reviewMutation.mutate()}
          disabled={reviewMutation.isPending}
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-50"
        >
          <Send className="h-3.5 w-3.5" />
          {reviewMutation.isPending ? "Đang gửi..." : "Gửi đánh giá"}
        </button>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-medium text-zinc-300">
          Nhận xét ({listing.reviews.length})
        </h3>
        <div className="space-y-2">
          {listing.reviews.length === 0 ? (
            <p className="text-sm text-zinc-600">Chưa có đánh giá nào.</p>
          ) : (
            listing.reviews.map((r) => (
              <div
                key={r.id}
                className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3"
              >
                <StarRating value={r.rating} readonly size={14} />
                {r.comment && (
                  <p className="mt-1.5 text-sm text-zinc-400">{r.comment}</p>
                )}
              </div>
            ))
          )}
        </div>
      </div>
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
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
      <h3 className="mb-3 text-sm font-medium text-zinc-300">
        Đăng một kế hoạch tập của bạn
      </h3>
      <div className="space-y-3">
        <select
          value={sourcePlanId}
          onChange={(e) => setSourcePlanId(e.target.value)}
          className="w-full rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5 text-sm text-zinc-200"
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
          className="w-full rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5 text-sm text-zinc-200 placeholder:text-zinc-600"
        />
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Mô tả (không bắt buộc)"
          rows={2}
          className="w-full rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5 text-sm text-zinc-200 placeholder:text-zinc-600"
        />
        <button
          type="button"
          onClick={() => publishMutation.mutate()}
          disabled={!sourcePlanId || !title || publishMutation.isPending}
          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-50"
        >
          <Upload className="h-3.5 w-3.5" />
          {publishMutation.isPending ? "Đang gửi..." : "Đăng lên chợ"}
        </button>
      </div>
    </div>
  );
}

function MineTab() {
  const queryClient = useQueryClient();
  const [showPublishForm, setShowPublishForm] = useState(false);

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
          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-500"
        >
          <Upload className="h-3.5 w-3.5" /> Đăng kế hoạch mới
        </button>
      )}

      <div className="space-y-2">
        {mineQuery.isLoading ? (
          <Loader2 className="h-5 w-5 animate-spin text-zinc-500" />
        ) : mineQuery.data && mineQuery.data.length > 0 ? (
          mineQuery.data.map((listing) => (
            <div
              key={listing.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-950/40 p-4"
            >
              <div>
                <div className="flex items-center gap-2">
                  <h4 className="text-sm text-zinc-200">{listing.title}</h4>
                  <StatusBadge status={listing.moderationStatus} />
                </div>
                {listing.moderationStatus === "REJECTED" &&
                  listing.moderationNote && (
                    <p className="mt-1 text-xs text-red-400">
                      Lý do: {listing.moderationNote}
                    </p>
                  )}
                <p className="mt-1 text-xs text-zinc-600">
                  {listing.avgRating.toFixed(1)}★ ({listing.ratingCount} đánh giá)
                </p>
              </div>
              <button
                type="button"
                onClick={() => withdrawMutation.mutate(listing.id)}
                className="rounded-lg border border-zinc-700 p-2 text-zinc-500 transition-colors hover:border-red-500/40 hover:text-red-400"
                aria-label="Gỡ kế hoạch"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))
        ) : (
          <p className="text-sm text-zinc-600">Bạn chưa đăng kế hoạch nào.</p>
        )}
      </div>
    </div>
  );
}

function BrowseTab({ onSelect }: { onSelect: (id: string) => void }) {
  const [sort, setSort] = useState<"recent" | "rating">("recent");
  const browseQuery = useQuery({
    queryKey: ["marketplace", "browse", sort],
    queryFn: () => marketplaceService.browse({ sort }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => setSort("recent")}
          className={`rounded-lg border px-3 py-1.5 text-xs ${sort === "recent" ? "border-blue-500/40 bg-blue-500/10 text-blue-400" : "border-zinc-800 text-zinc-500"}`}
        >
          Mới nhất
        </button>
        <button
          type="button"
          onClick={() => setSort("rating")}
          className={`inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs ${sort === "rating" ? "border-blue-500/40 bg-blue-500/10 text-blue-400" : "border-zinc-800 text-zinc-500"}`}
        >
          <TrendingUp className="h-3 w-3" /> Đánh giá cao
        </button>
      </div>

      {browseQuery.isLoading ? (
        <div className="flex items-center justify-center py-12 text-zinc-500">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : browseQuery.data && browseQuery.data.items.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {browseQuery.data.items.map((listing) => (
            <ListingCard
              key={listing.id}
              listing={listing}
              onClick={() => onSelect(listing.id)}
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2 py-12 text-center text-zinc-600">
          <Store className="h-8 w-8" />
          <p className="text-sm">Chưa có kế hoạch nào được duyệt.</p>
        </div>
      )}
    </div>
  );
}

export function PlanMarketplacePage() {
  const [tab, setTab] = useState<"browse" | "mine">("browse");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="text-xl font-semibold text-zinc-100">
          Chợ kế hoạch tập luyện
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          Khám phá kế hoạch được cộng đồng đánh giá cao, hoặc đăng kế hoạch của bạn.
        </p>
      </div>

      {selectedId ? (
        <DetailPanel id={selectedId} onBack={() => setSelectedId(null)} />
      ) : (
        <>
          <div className="flex gap-2 border-b border-zinc-800">
            <button
              type="button"
              onClick={() => setTab("browse")}
              className={`px-3 py-2 text-sm font-medium transition-colors ${tab === "browse" ? "border-b-2 border-blue-500 text-blue-400" : "text-zinc-500"}`}
            >
              Khám phá
            </button>
            <button
              type="button"
              onClick={() => setTab("mine")}
              className={`px-3 py-2 text-sm font-medium transition-colors ${tab === "mine" ? "border-b-2 border-blue-500 text-blue-400" : "text-zinc-500"}`}
            >
              Của tôi
            </button>
          </div>

          {tab === "browse" ? (
            <BrowseTab onSelect={setSelectedId} />
          ) : (
            <MineTab />
          )}
        </>
      )}
    </div>
  );
}
