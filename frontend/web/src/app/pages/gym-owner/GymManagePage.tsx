import { useState } from "react";
import { useParams, useNavigate } from "react-router";
import { Dumbbell, Loader2, ArrowLeft, Plus, X, Wallet as WalletIcon, Users, ListChecks } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { gymService } from "../../services/api";
import { toast } from "sonner";
import type { Gym, GymMembershipPlan, GymMembershipContract, Wallet, GymReviewsResponse } from "../../types";
import { formatVND } from "../../utils/currency";
import { Stars } from "../../components/gym/Stars";
import { GymCheckinPanel } from "../../components/gym/GymCheckinPanel";
import { CollaborationPanel } from "../../components/gym/CollaborationPanel";

/** Owner-facing label for a plan's marketing window — mirrors gym-service's isPlanOnSale
 * so the badge here always matches what the public listing would actually show. */
function saleWindowLabel(plan: GymMembershipPlan): { text: string; color: string } | null {
  if (!plan.saleStartAt && !plan.saleEndAt) return null;
  const now = new Date();
  if (plan.saleStartAt && now < new Date(plan.saleStartAt)) {
    return { text: `Mở bán từ ${new Date(plan.saleStartAt).toLocaleDateString("vi-VN")}`, color: "text-blue-400" };
  }
  if (plan.saleEndAt && now > new Date(plan.saleEndAt)) {
    return { text: "Đã hết hạn bán", color: "text-zinc-500" };
  }
  const until = plan.saleEndAt ? ` đến ${new Date(plan.saleEndAt).toLocaleDateString("vi-VN")}` : "";
  return { text: `Đang mở bán${until}`, color: "text-green-400" };
}

export function GymManagePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showCreatePlan, setShowCreatePlan] = useState(false);
  const [plan, setPlan] = useState({ name: "", price: "", durationDays: "30", visitLimit: "", saleStartAt: "", saleEndAt: "" });

  const { data: gym, isLoading: gymLoading } = useQuery<Gym>({
    queryKey: ["owned-gym", id],
    queryFn: () => gymService.getOwnedGym(id!),
    enabled: !!id,
  });

  const { data: wallet } = useQuery<Wallet>({
    queryKey: ["owned-gym-wallet", id],
    queryFn: () => gymService.getOwnedWallet(id!),
    enabled: !!id,
  });

  const { data: plans = [], isLoading: plansLoading } = useQuery<GymMembershipPlan[]>({
    queryKey: ["owned-gym-plans", id],
    queryFn: () => gymService.listOwnedPlans(id!),
    enabled: !!id,
  });

  const { data: memberships = [] } = useQuery<GymMembershipContract[]>({
    queryKey: ["owned-gym-memberships", id],
    queryFn: () => gymService.listOwnedMemberships(id!),
    enabled: !!id,
  });

  const { data: reviews } = useQuery<GymReviewsResponse>({
    queryKey: ["gym-reviews", id],
    queryFn: () => gymService.getGymReviews(id!),
    enabled: !!id,
  });

  const createPlanMutation = useMutation({
    mutationFn: () =>
      gymService.createPlan(id!, {
        name: plan.name,
        price: Number(plan.price),
        durationDays: Number(plan.durationDays),
        visitLimit: plan.visitLimit ? Number(plan.visitLimit) : undefined,
        saleStartAt: plan.saleStartAt || undefined,
        saleEndAt: plan.saleEndAt || undefined,
      }),
    onSuccess: () => {
      toast.success("Plan created");
      setShowCreatePlan(false);
      setPlan({ name: "", price: "", durationDays: "30", visitLimit: "", saleStartAt: "", saleEndAt: "" });
      queryClient.invalidateQueries({ queryKey: ["owned-gym-plans", id] });
    },
    onError: (err: any) => toast.error(err?.response?.data?.error?.message || "Failed to create plan"),
  });

  if (gymLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="w-8 h-8 text-green-500 animate-spin" />
      </div>
    );
  }

  if (!gym) {
    return <div className="p-6 max-w-3xl mx-auto text-center text-zinc-500">Gym not found</div>;
  }

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-5">
      <button type="button" onClick={() => navigate("/gym-owner/gyms")} className="flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-300">
        <ArrowLeft className="w-4 h-4" /> Back to my gyms
      </button>

      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-xl bg-green-500/10 flex items-center justify-center">
          <Dumbbell className="w-6 h-6 text-green-400" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-zinc-100">{gym.name}</h1>
          <div className="text-xs text-zinc-500">{gym.address}{gym.city ? `, ${gym.city}` : ""}</div>
          {reviews && reviews.count > 0 && (
            <div className="flex items-center gap-1.5 text-xs text-zinc-400 mt-1">
              <Stars value={reviews.averageRating} /> {reviews.averageRating.toFixed(1)} ({reviews.count} đánh giá)
            </div>
          )}
        </div>
      </div>

      {/* Wallet */}
      <div className="bg-gradient-to-br from-green-500/15 to-zinc-900 rounded-2xl border border-green-500/20 p-5 flex flex-wrap items-center gap-x-6 gap-y-2">
        <div className="flex items-center gap-3">
          <WalletIcon className="w-5 h-5 text-green-400" />
          <div>
            <div className="text-xs text-zinc-400">Có thể rút</div>
            <div className="text-xl font-bold text-zinc-100">{formatVND(Number(wallet?.availableBalance ?? 0))}</div>
          </div>
        </div>
        <div>
          <div className="text-xs text-zinc-500">Đang chờ (gói hội viên chưa kết thúc)</div>
          <div className="text-base font-semibold text-amber-400">{formatVND(Number(wallet?.pendingBalance ?? 0))}</div>
        </div>
      </div>

      {/* Check-in */}
      <GymCheckinPanel gymId={id!} />

      {/* PT collaboration — component existed, fully built, but was never mounted on any
          page: an owner had no way to reach it at all. */}
      <div className="bg-zinc-900 rounded-2xl border border-zinc-800/60 p-5">
        <CollaborationPanel as="GYM" gymId={id!} />
      </div>

      {/* Plans */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-bold text-zinc-300 flex items-center gap-1.5"><ListChecks className="w-4 h-4" /> Membership Plans</h2>
          <button
            type="button"
            onClick={() => setShowCreatePlan(true)}
            className="flex items-center gap-1.5 bg-green-500 hover:bg-green-400 text-black px-3 py-1.5 rounded-lg text-xs font-bold transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> New Plan
          </button>
        </div>
        {plansLoading ? (
          <Loader2 className="w-5 h-5 text-green-500 animate-spin" />
        ) : plans.length === 0 ? (
          <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-6 text-center text-sm text-zinc-500">No plans yet</div>
        ) : (
          <div className="space-y-2">
            {plans.map((p) => {
              const saleWindow = saleWindowLabel(p);
              return (
                <div key={p.id} className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-3.5 flex items-center justify-between">
                  <div>
                    <div className="text-sm font-bold text-zinc-200">{p.name}</div>
                    <div className="text-xs text-zinc-600">{p.durationDays} days{p.visitLimit ? ` · ${p.visitLimit} visits` : " · unlimited"}</div>
                    {saleWindow && <div className={`text-[11px] mt-0.5 ${saleWindow.color}`}>{saleWindow.text}</div>}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-semibold border ${p.status === "ACTIVE" ? "bg-green-500/10 border-green-500/20 text-green-400" : "bg-zinc-700/50 border-zinc-700 text-zinc-400"}`}>
                      {p.status}
                    </span>
                    <span className="text-sm font-bold text-green-400">{formatVND(Number(p.price))}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Memberships */}
      <div>
        <h2 className="text-sm font-bold text-zinc-300 mb-2 flex items-center gap-1.5"><Users className="w-4 h-4" /> Members ({memberships.length})</h2>
        {memberships.length === 0 ? (
          <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-6 text-center text-sm text-zinc-500">No members yet</div>
        ) : (
          <div className="space-y-2">
            {memberships.map((m) => (
              <div key={m.id} className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-3.5 flex items-center justify-between">
                <div>
                  <div className="text-xs text-zinc-500">{m.clientId.slice(0, 8)}...</div>
                  {m.status === "ACTIVE" && (
                    <div className="text-[11px] text-zinc-600 mt-0.5">
                      {m.totalVisits != null ? `Lượt: ${m.usedVisits}/${m.totalVisits}` : `Lượt đã vào: ${m.usedVisits} · không giới hạn`}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-semibold border ${
                    m.status === "ACTIVE" ? "bg-green-500/10 border-green-500/20 text-green-400"
                    : m.status === "PENDING_PAYMENT" ? "bg-orange-500/10 border-orange-500/20 text-orange-400"
                    : "bg-zinc-700/50 border-zinc-700 text-zinc-400"
                  }`}>
                    {m.status}
                  </span>
                  <span className="text-sm font-bold text-green-400">{formatVND(Number(m.priceAtPurchase))}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create plan dialog */}
      {showCreatePlan && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-zinc-900 border border-zinc-700/60 rounded-2xl w-full max-w-md shadow-2xl">
            <div className="p-5 border-b border-zinc-800/60 flex items-center justify-between">
              <h3 className="text-zinc-100 font-bold">New Membership Plan</h3>
              <button type="button" onClick={() => setShowCreatePlan(false)} className="text-zinc-500 hover:text-zinc-300">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-3">
              <input
                aria-label="Plan name"
                value={plan.name}
                onChange={(e) => setPlan({ ...plan, name: e.target.value })}
                placeholder="Plan name (e.g. Monthly)"
                className="w-full px-3 py-2.5 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-green-500/50"
              />
              <input
                aria-label="Price"
                type="number"
                value={plan.price}
                onChange={(e) => setPlan({ ...plan, price: e.target.value })}
                placeholder="Price (VND)"
                className="w-full px-3 py-2.5 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-green-500/50"
              />
              <input
                aria-label="Duration in days"
                type="number"
                value={plan.durationDays}
                onChange={(e) => setPlan({ ...plan, durationDays: e.target.value })}
                placeholder="Duration (days)"
                className="w-full px-3 py-2.5 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-green-500/50"
              />
              <input
                aria-label="Visit limit (optional)"
                type="number"
                value={plan.visitLimit}
                onChange={(e) => setPlan({ ...plan, visitLimit: e.target.value })}
                placeholder="Visit limit (blank = unlimited)"
                className="w-full px-3 py-2.5 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-green-500/50"
              />
              <div>
                <label className="text-xs text-zinc-500 mb-1.5 block">
                  Thời gian mở bán (tuỳ chọn — dùng cho gói khuyến mãi)
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    aria-label="Sale start date"
                    type="date"
                    value={plan.saleStartAt}
                    onChange={(e) => setPlan({ ...plan, saleStartAt: e.target.value })}
                    className="w-full px-3 py-2.5 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 outline-none focus:border-green-500/50"
                  />
                  <input
                    aria-label="Sale end date"
                    type="date"
                    value={plan.saleEndAt}
                    onChange={(e) => setPlan({ ...plan, saleEndAt: e.target.value })}
                    className="w-full px-3 py-2.5 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 outline-none focus:border-green-500/50"
                  />
                </div>
                <p className="text-[11px] text-zinc-600 mt-1">Để trống cả hai = luôn mở bán.</p>
              </div>
            </div>
            <div className="p-5 border-t border-zinc-800/60 flex gap-3">
              <button type="button" onClick={() => setShowCreatePlan(false)} className="flex-1 py-2.5 border border-zinc-700/60 text-zinc-300 text-sm font-semibold rounded-lg hover:bg-zinc-800 transition-colors">
                Cancel
              </button>
              <button
                type="button"
                onClick={() => createPlanMutation.mutate()}
                disabled={!plan.name.trim() || !plan.price || createPlanMutation.isPending}
                className="flex-1 py-2.5 bg-green-500 hover:bg-green-400 disabled:opacity-60 text-black text-sm font-bold rounded-lg transition-[background-color,opacity] flex items-center justify-center gap-2"
              >
                {createPlanMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
