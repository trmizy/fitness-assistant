import { useState } from "react";
import { Dumbbell, Loader2, CheckCircle, Clock, XCircle, AlertTriangle, QrCode, RotateCcw } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { gymService } from "../../services/api";
import { toast } from "sonner";
import type { GymMembershipContract, GymMembershipContractStatus } from "../../types";
import { formatVND } from "../../utils/currency";
import { CheckinQrModal } from "../../components/gym/CheckinQrModal";

/** Client-side preview of the prorated refund (backend recomputes the authoritative amount). */
function proratedEstimate(m: GymMembershipContract): { amount: number; days: number } {
  const now = Date.now();
  const total = m.durationDaysSnapshot * 86_400_000;
  const end = m.endDate ? new Date(m.endDate).getTime() : now;
  const remaining = Math.max(0, end - now);
  const frac = total > 0 ? Math.min(1, remaining / total) : 0;
  return { amount: Math.round(Number(m.priceAtPurchase) * frac * 100) / 100, days: Math.ceil(remaining / 86_400_000) };
}

const STATUS_CONFIG: Record<GymMembershipContractStatus, { label: string; color: string; bg: string; icon: React.ElementType }> = {
  PENDING_PAYMENT: { label: "Payment Due", color: "text-orange-400", bg: "bg-orange-500/10 border-orange-500/20", icon: Clock },
  ACTIVE:          { label: "Active",      color: "text-green-400",  bg: "bg-green-500/10 border-green-500/20",   icon: CheckCircle },
  EXPIRED:         { label: "Expired",     color: "text-zinc-400",   bg: "bg-zinc-700/50 border-zinc-700",        icon: AlertTriangle },
  CANCELLED:       { label: "Cancelled",   color: "text-red-400",    bg: "bg-red-500/10 border-red-500/20",       icon: XCircle },
};

function formatDate(d?: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function GymMembershipsPage() {
  const queryClient = useQueryClient();
  const [qrMembershipId, setQrMembershipId] = useState<string | null>(null);
  const [refundTarget, setRefundTarget] = useState<GymMembershipContract | null>(null);

  const { data: memberships = [], isLoading } = useQuery<GymMembershipContract[]>({
    queryKey: ["client-gym-memberships"],
    queryFn: () => gymService.listMyMemberships(),
  });

  const payMutation = useMutation({
    mutationFn: (id: string) => gymService.payMembership(id),
    onSuccess: (result: any) => {
      if (result?.payment?.status === "PAID") {
        toast.success("Payment successful — membership is now active!");
      } else {
        toast.error(result?.payment?.failureReason || "Payment failed — check your wallet balance");
      }
      queryClient.invalidateQueries({ queryKey: ["client-gym-memberships"] });
    },
    onError: (err: any) => toast.error(err?.response?.data?.error?.code || "Failed to pay"),
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => gymService.cancelMembership(id),
    onSuccess: () => {
      toast.success("Membership cancelled");
      queryClient.invalidateQueries({ queryKey: ["client-gym-memberships"] });
    },
    onError: (err: any) => toast.error(err?.response?.data?.error?.code || "Failed to cancel"),
  });

  const refundMutation = useMutation({
    mutationFn: (id: string) => gymService.refundMembership(id),
    onSuccess: (result: any) => {
      const amount = Number(result?.refundAmount ?? 0);
      toast.success(`Đã hủy & hoàn ${formatVND(amount)} vào ví của bạn`);
      setRefundTarget(null);
      queryClient.invalidateQueries({ queryKey: ["client-gym-memberships"] });
      queryClient.invalidateQueries({ queryKey: ["wallet"] });
    },
    onError: (err: any) => {
      const code = err?.response?.data?.error?.code;
      if (code === "INSUFFICIENT_REFUND_FUNDS") toast.error("Ví phòng gym không đủ số dư để hoàn — liên hệ quản trị viên.");
      else toast.error(code || err?.response?.data?.error?.message || "Hoàn tiền thất bại");
    },
  });

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-5">
      <div>
        <h1 className="text-zinc-100 flex items-center gap-2 text-xl font-bold">
          <Dumbbell className="w-5 h-5 text-green-400" /> My Gym Memberships
        </h1>
        <p className="text-zinc-500 text-sm mt-0.5">Track and manage your gym memberships</p>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 text-green-500 animate-spin" />
        </div>
      )}

      {!isLoading && memberships.length === 0 && (
        <div className="bg-zinc-900 rounded-2xl border border-zinc-800/60 p-16 text-center">
          <Dumbbell className="w-12 h-12 text-zinc-800 mx-auto mb-4" />
          <h3 className="text-zinc-200 font-bold mb-1">No memberships yet</h3>
          <p className="text-sm text-zinc-500">Browse gyms to buy your first membership.</p>
        </div>
      )}

      {!isLoading && memberships.length > 0 && (
        <div className="space-y-3">
          {memberships.map((m) => {
            const cfg = STATUS_CONFIG[m.status];
            return (
              <div key={m.id} className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-semibold border ${cfg.bg} ${cfg.color}`}>
                    <cfg.icon className="w-3.5 h-3.5" /> {cfg.label}
                  </span>
                  <span className="text-sm font-bold text-green-400">{formatVND(Number(m.priceAtPurchase))}</span>
                </div>
                <div className="text-xs text-zinc-500">
                  {m.startDate ? `${formatDate(m.startDate)} – ${formatDate(m.endDate)}` : `${m.durationDaysSnapshot} days`}
                  {m.totalVisits ? ` · ${m.usedVisits}/${m.totalVisits} visits` : ""}
                </div>
                {m.status === "ACTIVE" && (
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      onClick={() => setQrMembershipId(m.id)}
                      className="flex items-center gap-1.5 bg-green-500 hover:bg-green-400 text-black px-3 py-2 rounded-lg text-xs font-bold transition-all"
                    >
                      <QrCode className="w-3.5 h-3.5" /> Mã check-in
                    </button>
                    <button
                      type="button"
                      onClick={() => setRefundTarget(m)}
                      className="flex items-center gap-1.5 border border-red-500/30 text-red-400 hover:bg-red-500/10 px-3 py-2 rounded-lg text-xs font-medium transition-colors"
                    >
                      <RotateCcw className="w-3.5 h-3.5" /> Hủy & hoàn tiền
                    </button>
                  </div>
                )}
                {m.status === "PENDING_PAYMENT" && (
                  <div className="flex gap-2 mt-3">
                    <button
                      type="button"
                      onClick={() => payMutation.mutate(m.id)}
                      disabled={payMutation.isPending}
                      className="flex items-center gap-1.5 bg-orange-500 hover:bg-orange-400 disabled:opacity-60 text-black px-3 py-2 rounded-lg text-xs font-bold transition-all"
                    >
                      {payMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                      Pay Now
                    </button>
                    <button
                      type="button"
                      onClick={() => cancelMutation.mutate(m.id)}
                      disabled={cancelMutation.isPending}
                      className="flex items-center gap-1.5 border border-red-500/30 text-red-400 hover:bg-red-500/10 px-3 py-2 rounded-lg text-xs font-medium transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {qrMembershipId && <CheckinQrModal membershipId={qrMembershipId} onClose={() => setQrMembershipId(null)} />}

      {refundTarget && (() => {
        const est = proratedEstimate(refundTarget);
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
            <div className="bg-zinc-900 border border-zinc-700/60 rounded-2xl w-full max-w-sm shadow-2xl">
              <div className="p-5 border-b border-zinc-800/60">
                <h3 className="text-zinc-100 font-bold">Hủy membership & hoàn tiền</h3>
              </div>
              <div className="p-5 space-y-3 text-sm text-zinc-300">
                <p>Bạn sẽ hủy gói và được hoàn tiền <span className="font-semibold">theo số ngày còn lại</span>:</p>
                <div className="bg-zinc-800/50 rounded-lg p-3 space-y-1 text-xs">
                  <div className="flex justify-between"><span className="text-zinc-500">Giá gói</span><span>{formatVND(Number(refundTarget.priceAtPurchase))}</span></div>
                  <div className="flex justify-between"><span className="text-zinc-500">Còn lại (ước tính)</span><span>{est.days} ngày / {refundTarget.durationDaysSnapshot} ngày</span></div>
                  <div className="flex justify-between text-green-400 font-bold pt-1 border-t border-zinc-700/50"><span>Hoàn về ví (ước tính)</span><span>{formatVND(est.amount)}</span></div>
                </div>
                <p className="text-[11px] text-zinc-500">Phần đã sử dụng sẽ không được hoàn. Số tiền cuối cùng do hệ thống tính lại. Sau khi hoàn, membership chuyển sang Cancelled.</p>
              </div>
              <div className="p-5 border-t border-zinc-800/60 flex gap-3">
                <button
                  type="button"
                  onClick={() => setRefundTarget(null)}
                  className="flex-1 py-2.5 border border-zinc-700/60 text-zinc-300 text-sm font-semibold rounded-lg hover:bg-zinc-800 transition-colors"
                >
                  Giữ lại
                </button>
                <button
                  type="button"
                  onClick={() => refundMutation.mutate(refundTarget.id)}
                  disabled={refundMutation.isPending}
                  className="flex-1 py-2.5 bg-red-500 hover:bg-red-400 disabled:opacity-60 text-white text-sm font-bold rounded-lg transition-all flex items-center justify-center gap-2"
                >
                  {refundMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                  Xác nhận hoàn
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
