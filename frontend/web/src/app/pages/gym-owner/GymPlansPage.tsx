import { useState } from "react";
import { useNavigate } from "react-router";
import { ListChecksIcon as ListChecks, PlusIcon as Plus, XIcon as X, CircleNotchIcon as Loader2, BuildingsIcon as Building2, LockIcon as Lock, LockOpenIcon as Unlock } from "@phosphor-icons/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { gymService } from "../../services/api";
import { toast } from "sonner";
import type { GymBrand, GymMembershipPlan } from "../../types";
import { formatVND } from "../../utils/currency";
import { useBackDismissible } from "../../hooks/useBackDismissible";

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

/**
 * One owner, one brand — a plan is sold BY THE BRAND now, not any one branch: buy it once,
 * check in (and draw down the shared visit limit) at any of the owner's gyms. Moved out of
 * GymManagePage (which used to create a plan per-gym, before that was even true) into its own
 * top-level page for exactly that reason — there is nothing gym-specific left to pick.
 */
export function GymPlansPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showCreatePlan, setShowCreatePlan] = useState(false);
  useBackDismissible(!!showCreatePlan, () => setShowCreatePlan(false));
  const [plan, setPlan] = useState({ name: "", price: "", durationDays: "30", visitLimit: "", saleStartAt: "", saleEndAt: "" });

  const { data: brands = [], isLoading: brandsLoading } = useQuery<GymBrand[]>({
    queryKey: ["owned-brands"],
    queryFn: () => gymService.listOwnedBrands(),
  });
  const brand = brands[0];

  const { data: plans = [], isLoading: plansLoading } = useQuery<GymMembershipPlan[]>({
    queryKey: ["owned-brand-plans", brand?.id],
    queryFn: () => gymService.listOwnedPlans(brand!.id),
    enabled: !!brand,
  });

  const createPlanMutation = useMutation({
    mutationFn: () =>
      gymService.createPlan(brand!.id, {
        name: plan.name,
        price: Number(plan.price),
        durationDays: Number(plan.durationDays),
        visitLimit: plan.visitLimit ? Number(plan.visitLimit) : undefined,
        saleStartAt: plan.saleStartAt || undefined,
        saleEndAt: plan.saleEndAt || undefined,
      }),
    onSuccess: () => {
      toast.success("Đã tạo gói hội viên");
      setShowCreatePlan(false);
      setPlan({ name: "", price: "", durationDays: "30", visitLimit: "", saleStartAt: "", saleEndAt: "" });
      queryClient.invalidateQueries({ queryKey: ["owned-brand-plans", brand?.id] });
    },
    onError: (err: any) => toast.error(err?.response?.data?.error?.message || "Không thể tạo gói"),
  });

  const toggleStatusMutation = useMutation({
    mutationFn: ({ planId, status }: { planId: string; status: "ACTIVE" | "INACTIVE" }) =>
      gymService.updatePlan(brand!.id, planId, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["owned-brand-plans", brand?.id] });
    },
    onError: (err: any) => toast.error(err?.response?.data?.error?.message || "Không thể cập nhật"),
  });

  if (brandsLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="w-8 h-8 text-green-500 animate-spin" />
      </div>
    );
  }

  if (!brand) {
    return (
      <div className="p-4 md:p-6 max-w-4xl mx-auto">
        <div className="bg-zinc-900 rounded-2xl border border-zinc-800/60 p-10 text-center">
          <Building2 className="w-10 h-10 text-zinc-700 mx-auto mb-3" />
          <h3 className="text-zinc-200 font-bold mb-1">Chưa có thương hiệu</h3>
          <p className="text-sm text-zinc-500 mb-5">
            Đặt tên thương hiệu của bạn trước — mọi gói hội viên đều bán dưới tên thương hiệu, dùng
            được ở tất cả chi nhánh.
          </p>
          <button
            type="button"
            onClick={() => navigate("/gym-owner/gyms")}
            className="px-4 py-2.5 bg-green-500 hover:bg-green-400 text-black text-sm font-bold rounded-xl transition-colors"
          >
            Đi tới Phòng gym của tôi
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-zinc-100 flex items-center gap-2 text-xl font-bold">
            <ListChecks className="w-5 h-5 text-green-400" /> Quản lý gói
          </h1>
          <p className="text-zinc-500 text-sm mt-0.5">
            Gói hội viên của <span className="text-zinc-300 font-semibold">{brand.approvedName ?? brand.name}</span> — áp
            dụng cho mọi chi nhánh, khách check-in ở đâu cũng trừ chung một hạn mức.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreatePlan(true)}
          className="flex items-center gap-2 bg-green-500 hover:bg-green-400 text-black px-4 py-2.5 rounded-xl text-sm font-bold transition-[transform,background-color] active:scale-[0.98] shadow-lg shadow-green-500/25 shrink-0"
        >
          <Plus className="w-4 h-4" /> Gói mới
        </button>
      </div>

      {plansLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 text-green-500 animate-spin" />
        </div>
      ) : plans.length === 0 ? (
        <div className="bg-zinc-900 rounded-2xl border border-zinc-800/60 p-16 text-center">
          <ListChecks className="w-10 h-10 text-zinc-700 mx-auto mb-3" />
          <h3 className="text-zinc-200 font-bold mb-1">Chưa có gói nào</h3>
          <p className="text-sm text-zinc-500">Tạo gói đầu tiên để khách bắt đầu đăng ký hội viên.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {plans.map((p) => {
            const saleWindow = saleWindowLabel(p);
            return (
              <div key={p.id} className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-3.5 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-bold text-zinc-200">{p.name}</div>
                  <div className="text-xs text-zinc-600">
                    {p.durationDays} ngày{p.visitLimit ? ` · ${p.visitLimit} lượt (dùng chung mọi chi nhánh)` : " · không giới hạn lượt"}
                  </div>
                  {saleWindow && <div className={`text-[11px] mt-0.5 ${saleWindow.color}`}>{saleWindow.text}</div>}
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-sm font-bold text-green-400">{formatVND(Number(p.price))}</span>
                  <button
                    type="button"
                    onClick={() =>
                      toggleStatusMutation.mutate({
                        planId: p.id,
                        status: p.status === "ACTIVE" ? "INACTIVE" : "ACTIVE",
                      })
                    }
                    disabled={toggleStatusMutation.isPending}
                    title={p.status === "ACTIVE" ? "Ngừng bán gói này" : "Mở bán lại gói này"}
                    className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-full font-semibold border transition-colors ${
                      p.status === "ACTIVE"
                        ? "bg-green-500/10 border-green-500/20 text-green-400 hover:bg-green-500/20"
                        : "bg-zinc-700/50 border-zinc-700 text-zinc-400 hover:bg-zinc-700"
                    }`}
                  >
                    {p.status === "ACTIVE" ? <Unlock className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
                    {p.status === "ACTIVE" ? "Đang bán" : "Đã ngừng"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create plan dialog */}
      {showCreatePlan && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-zinc-900 border border-zinc-700/60 rounded-2xl w-full max-w-md shadow-2xl">
            <div className="p-5 border-b border-zinc-800/60 flex items-center justify-between">
              <h3 className="text-zinc-100 font-bold">Gói hội viên mới</h3>
              <button type="button" aria-label="Đóng" onClick={() => setShowCreatePlan(false)} className="text-zinc-500 hover:text-zinc-300">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-3">
              <input
                aria-label="Plan name"
                value={plan.name}
                onChange={(e) => setPlan({ ...plan, name: e.target.value })}
                placeholder="Tên gói (VD: Gói tháng)"
                className="w-full px-3 py-2.5 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-green-500/50"
              />
              <input
                aria-label="Price"
                type="number"
                value={plan.price}
                onChange={(e) => setPlan({ ...plan, price: e.target.value })}
                placeholder="Giá (VND)"
                className="w-full px-3 py-2.5 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-green-500/50"
              />
              <input
                aria-label="Duration in days"
                type="number"
                value={plan.durationDays}
                onChange={(e) => setPlan({ ...plan, durationDays: e.target.value })}
                placeholder="Thời hạn (ngày)"
                className="w-full px-3 py-2.5 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-green-500/50"
              />
              <input
                aria-label="Visit limit (optional)"
                type="number"
                value={plan.visitLimit}
                onChange={(e) => setPlan({ ...plan, visitLimit: e.target.value })}
                placeholder="Giới hạn lượt vào (để trống = không giới hạn)"
                className="w-full px-3 py-2.5 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-green-500/50"
              />
              <p className="text-[11px] text-zinc-600">
                Hạn mức lượt vào dùng chung cho tất cả chi nhánh của thương hiệu — khách check-in
                ở bất kỳ đâu cũng trừ vào cùng một con số này.
              </p>
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
                Huỷ
              </button>
              <button
                type="button"
                onClick={() => createPlanMutation.mutate()}
                disabled={!plan.name.trim() || !plan.price || createPlanMutation.isPending}
                className="flex-1 py-2.5 bg-green-500 hover:bg-green-400 disabled:opacity-60 text-black text-sm font-bold rounded-lg transition-[background-color,opacity] flex items-center justify-center gap-2"
              >
                {createPlanMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                Tạo gói
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
