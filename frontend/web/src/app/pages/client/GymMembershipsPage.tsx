import { useState } from "react";
import { useNavigate } from "react-router";
import { Dumbbell, Loader2, CheckCircle, Clock, XCircle, AlertTriangle, QrCode, RotateCcw } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { gymService } from "../../services/api";
import { openPaymentGateway } from "../../services/paymentGateway";
import { toast } from "sonner";
import type { GymMembershipContract, GymMembershipContractStatus } from "../../types";
import { formatVND } from "../../utils/currency";
import { CheckinScanModal } from "../../components/gym/CheckinScanModal";
import { PaymentMethodDialog } from "../../components/payment/PaymentMethodDialog";
import { useBackDismissible } from "../../hooks/useBackDismissible";

/** Days left on an ACTIVE membership, for the cancel-warning copy (no refund is computed —
 * money-flow plan §2.4: self-cancel forfeits the unused portion, it is not estimated). */
function daysRemaining(m: GymMembershipContract): number {
  const now = Date.now();
  const end = m.endDate ? new Date(m.endDate).getTime() : now;
  return Math.max(0, Math.ceil((end - now) / 86_400_000));
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
  const navigate = useNavigate();
  // The gym shows the QR; the member scans it. One scanner sheet serves every membership.
  const [scanning, setScanning] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<GymMembershipContract | null>(null);
  useBackDismissible(!!cancelTarget, () => setCancelTarget(null));
  // The membership awaiting a gateway choice; null while the picker is closed.
  const [payTarget, setPayTarget] = useState<GymMembershipContract | null>(null);

  const { data: memberships = [], isLoading } = useQuery<GymMembershipContract[]>({
    queryKey: ["client-gym-memberships"],
    queryFn: () => gymService.listMyMemberships(),
  });

  /**
   * Pay at the chosen gateway. The response is a redirect, not a completed payment — the
   * membership activates on the gateway's signed webhook, never on the browser's word.
   */
  const payMutation = useMutation({
    mutationFn: ({ id, provider }: { id: string; provider: string }) =>
      gymService.payMembership(id, provider),
    onSuccess: (result: any) => {
      const url = result?.payment?.redirectUrl;
      if (url) {
        // App: system browser tab, React app kept alive. Web: unchanged. The membership
        // still activates only on the gateway's signed webhook, never on the browser's word.
        void openPaymentGateway({
          url,
          transactionId: result?.payment?.transactionId,
          navigate,
        });
        return;
      }
      setPayTarget(null);
      toast.error(
        result?.payment?.failureReason ||
          "Cổng thanh toán không trả về liên kết — thử lại hoặc chọn cổng khác",
      );
      queryClient.invalidateQueries({ queryKey: ["client-gym-memberships"] });
    },
    onError: (err: any) =>
      toast.error(err?.response?.data?.error?.code || "Không tạo được giao dịch"),
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => gymService.cancelMembership(id),
    onSuccess: () => {
      toast.success("Membership cancelled");
      queryClient.invalidateQueries({ queryKey: ["client-gym-memberships"] });
    },
    onError: (err: any) => toast.error(err?.response?.data?.error?.code || "Failed to cancel"),
  });

  const cancelActiveMutation = useMutation({
    mutationFn: (id: string) => gymService.cancelActiveMembership(id),
    onSuccess: () => {
      toast.success("Đã hủy membership");
      setCancelTarget(null);
      queryClient.invalidateQueries({ queryKey: ["client-gym-memberships"] });
    },
    onError: (err: any) => {
      const code = err?.response?.data?.error?.code;
      toast.error(code || err?.response?.data?.error?.message || "Hủy membership thất bại");
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
                      onClick={() => setScanning(true)}
                      className="flex items-center gap-1.5 bg-green-500 hover:bg-green-400 text-black px-3 py-2 rounded-lg text-xs font-bold transition-all"
                    >
                      <QrCode className="w-3.5 h-3.5" /> Quét mã check-in
                    </button>
                    <button
                      type="button"
                      onClick={() => setCancelTarget(m)}
                      className="flex items-center gap-1.5 border border-red-500/30 text-red-400 hover:bg-red-500/10 px-3 py-2 rounded-lg text-xs font-medium transition-colors"
                    >
                      <RotateCcw className="w-3.5 h-3.5" /> Hủy membership
                    </button>
                  </div>
                )}
                {m.status === "PENDING_PAYMENT" && (
                  <div className="flex gap-2 mt-3">
                    <button
                      type="button"
                      onClick={() => setPayTarget(m)}
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

      {scanning && <CheckinScanModal onClose={() => setScanning(false)} />}

      {payTarget && (
        <PaymentMethodDialog
          amount={Number(payTarget.priceAtPurchase)}
          title="Chọn phương thức thanh toán gói tập"
          isSubmitting={payMutation.isPending}
          onClose={() => setPayTarget(null)}
          onConfirm={(provider) => payMutation.mutate({ id: payTarget.id, provider })}
        />
      )}

      {cancelTarget && (() => {
        const days = daysRemaining(cancelTarget);
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
            <div className="bg-zinc-900 border border-zinc-700/60 rounded-2xl w-full max-w-sm shadow-2xl">
              <div className="p-5 border-b border-zinc-800/60">
                <h3 className="text-zinc-100 font-bold">Hủy membership</h3>
              </div>
              <div className="p-5 space-y-3 text-sm text-zinc-300">
                <p>Bạn sắp hủy gói còn <span className="font-semibold">{days} ngày / {cancelTarget.durationDaysSnapshot} ngày</span>.</p>
                <div className="flex items-start gap-2 text-sm text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  Bạn sẽ <span className="font-semibold">không được hoàn lại</span> số tiền của phần thời gian chưa sử dụng.
                </div>
              </div>
              <div className="p-5 border-t border-zinc-800/60 flex gap-3">
                <button
                  type="button"
                  onClick={() => setCancelTarget(null)}
                  className="flex-1 py-2.5 border border-zinc-700/60 text-zinc-300 text-sm font-semibold rounded-lg hover:bg-zinc-800 transition-colors"
                >
                  Giữ lại
                </button>
                <button
                  type="button"
                  onClick={() => cancelActiveMutation.mutate(cancelTarget.id)}
                  disabled={cancelActiveMutation.isPending}
                  className="flex-1 py-2.5 bg-red-500 hover:bg-red-400 disabled:opacity-60 text-white text-sm font-bold rounded-lg transition-all flex items-center justify-center gap-2"
                >
                  {cancelActiveMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                  Xác nhận hủy
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
