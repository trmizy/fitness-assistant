import { useState } from "react";
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
} from "lucide-react";
import { StarRating } from "../../components/StarRating";
import {
  marketplaceService,
  planService,
  trainingPackageService,
  type PublishedPlanListing,
  type TrainingPackage,
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
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-bold ${cfg.className}`}
    >
      {cfg.label}
    </span>
  );
}

const TABS = [
  { value: "browse", label: "Khám phá" },
  { value: "mine", label: "Kế hoạch của tôi" },
  { value: "buy-packages", label: "Mua gói tập" },
  { value: "sell-packages", label: "Bán gói tập" },
] as const;
type TabValue = (typeof TABS)[number]["value"];

function ListingCard({
  listing,
  selected,
  onClick,
}: {
  listing: PublishedPlanListing;
  selected: boolean;
  onClick: () => void;
}) {
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
          <h3 className="text-sm font-bold text-zinc-200 truncate">
            {listing.title}
          </h3>
          <p className="text-xs text-zinc-500 mt-0.5">{listing.goal}</p>
        </div>
        <div className="flex items-center gap-1 text-xs font-bold text-amber-400 flex-shrink-0">
          <Star className="h-3.5 w-3.5 fill-amber-400" />
          {listing.avgRating.toFixed(1)}
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

function DetailPanel({ id }: { id: string }) {
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
      <div className="flex-1 flex items-center justify-center py-20 bg-zinc-900 rounded-2xl border border-zinc-800/60">
        <Loader2 className="h-6 w-6 text-green-500 animate-spin" />
      </div>
    );
  }

  const listing = detailQuery.data;
  if (!listing) return null;

  return (
    <div className="flex-1 space-y-4 min-w-0">
      <div className="bg-zinc-900 rounded-2xl border border-zinc-800/60 p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-zinc-100">{listing.title}</h2>
            <p className="mt-0.5 text-sm text-zinc-500">{listing.goal}</p>
          </div>
          <div className="flex items-center gap-1 text-sm font-bold text-amber-400 flex-shrink-0">
            <Star className="h-4 w-4 fill-amber-400" />
            {listing.avgRating.toFixed(1)}
          </div>
        </div>
        {listing.description && (
          <p className="mt-3 text-sm text-zinc-400">{listing.description}</p>
        )}
        <p className="mt-2 text-xs text-zinc-600">
          {listing.ratingCount} lượt đánh giá
        </p>
      </div>

      <div className="bg-zinc-900 rounded-2xl border border-zinc-800/60 p-6">
        <h3 className="mb-1 text-sm font-bold text-zinc-300">
          Đánh giá của bạn
        </h3>
        <p className="mb-3 text-xs text-zinc-600">
          Bạn cần hoàn thành một chu kỳ tập luyện theo lịch tập gốc của kế
          hoạch này trước khi có thể đánh giá.
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
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function BrowseTab() {
  const [sort, setSort] = useState<"recent" | "rating">("recent");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const browseQuery = useQuery({
    queryKey: ["marketplace", "browse", sort],
    queryFn: () => marketplaceService.browse({ sort }),
  });

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setSort("recent")}
          className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all border ${sort === "recent" ? "bg-green-500 text-black border-green-500" : "bg-zinc-900 border-zinc-700/60 text-zinc-400 hover:border-green-500/40"}`}
        >
          Mới nhất
        </button>
        <button
          type="button"
          onClick={() => setSort("rating")}
          className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold transition-all border ${sort === "rating" ? "bg-green-500 text-black border-green-500" : "bg-zinc-900 border-zinc-700/60 text-zinc-400 hover:border-green-500/40"}`}
        >
          <TrendingUp className="h-3 w-3" /> Đánh giá cao
        </button>
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
              className="flex items-center justify-between gap-3 bg-zinc-900 rounded-xl border border-zinc-800/60 p-4"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h4 className="text-sm font-bold text-zinc-200 truncate">
                    {listing.title}
                  </h4>
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
                className="p-2 rounded-lg text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition-colors flex-shrink-0"
                aria-label="Gỡ kế hoạch"
              >
                <Trash2 className="h-4 w-4" />
              </button>
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
  const queryClient = useQueryClient();
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
        <button
          type="button"
          onClick={() => purchaseMutation.mutate()}
          disabled={purchaseMutation.isPending}
          className="inline-flex items-center gap-1.5 bg-green-500 hover:bg-green-400 disabled:opacity-60 text-black px-3 py-1.5 rounded-lg text-xs font-bold transition-all"
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

export function PlanMarketplacePage() {
  const [tab, setTab] = useState<TabValue>("browse");

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
        {TABS.map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => setTab(t.value)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all border ${tab === t.value ? "bg-green-500 text-black border-green-500" : "bg-zinc-900 border-zinc-700/60 text-zinc-400 hover:border-green-500/40"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "browse" && <BrowseTab />}
      {tab === "mine" && <MineTab />}
      {tab === "buy-packages" && <BuyPackagesTab />}
      {tab === "sell-packages" && <SellPackagesTab />}
    </div>
  );
}
