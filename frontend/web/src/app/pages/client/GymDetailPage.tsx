import { useState } from "react";
import { useParams, useNavigate } from "react-router";
import { Dumbbell, MapPin, Loader2, ArrowLeft, CheckCircle, AlertTriangle } from "lucide-react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { gymService } from "../../services/api";
import { openPaymentGateway } from "../../services/paymentGateway";
import { toast } from "sonner";
import type { Gym, GymMembershipPlan } from "../../types";
import { formatVND } from "../../utils/currency";
import { Stars } from "../../components/gym/Stars";
import { GymReviewsSection } from "../../components/gym/GymReviewsSection";
import { PaymentMethodDialog } from "../../components/payment/PaymentMethodDialog";

export function GymDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  // The plan awaiting a gateway choice; null while the picker is closed. Buying always asks
  // which gateway first — there is no silent default (same contract as "Pay Now" on
  // GymMembershipsPage, which retries a PENDING_PAYMENT membership through this same dialog).
  const [buyTarget, setBuyTarget] = useState<GymMembershipPlan | null>(null);
  // A4 — the plan waiting on the "you already have a membership elsewhere" confirmation,
  // shown BEFORE the gateway picker when applicable. null while that dialog is closed.
  const [warningTarget, setWarningTarget] = useState<GymMembershipPlan | null>(null);
  // Optional PT referral code — applies to whichever plan is bought. Backend already
  // supports it (membership.service.ts#purchase); nothing in the UI ever collected it.
  const [referralCode, setReferralCode] = useState("");

  const { data: gym, isLoading: gymLoading } = useQuery<Gym>({
    queryKey: ["gym", id],
    queryFn: () => gymService.getGym(id!),
    enabled: !!id,
  });

  const { data: plans = [], isLoading: plansLoading } = useQuery<GymMembershipPlan[]>({
    queryKey: ["gym-plans", id],
    queryFn: () => gymService.listPlans(id!),
    enabled: !!id,
  });

  // A4 — fetched once per gym visit (cheap, read-only); checked before opening the gateway
  // picker so an already-warned client isn't asked to acknowledge on every plan click.
  const { data: multiGymWarnings = [] } = useQuery({
    queryKey: ["membership-warnings", id],
    queryFn: () => gymService.getMembershipWarnings(id!),
    enabled: !!id,
  });

  const startBuy = (plan: GymMembershipPlan) => {
    if (multiGymWarnings.length > 0) {
      setWarningTarget(plan);
    } else {
      setBuyTarget(plan);
    }
  };

  const buyMutation = useMutation({
    mutationFn: ({ planId, provider }: { planId: string; provider: string }) =>
      gymService.buyMembership(id!, planId, provider, referralCode.trim() || undefined, multiGymWarnings.length > 0),
    onSuccess: (result: any) => {
      // Purchase creates the membership AND starts a checkout with the chosen gateway in one
      // call (see membership.service.ts#purchase → attemptPayment) — the response is a
      // redirect, not a settled payment. Membership activates on the gateway's confirmation,
      // never on the browser's word (same contract as GymMembershipsPage's "Pay Now").
      const payment = result?.data?.payment ?? result?.payment;
      if (payment?.status === "PAID") {
        toast.success("Membership purchased — you're all set!");
        navigate("/client/gym-memberships");
        return;
      }
      if (payment?.redirectUrl) {
        // System browser tab in the app (React app stays alive behind it), plain navigation
        // on the web. The membership still only activates on the gateway's signed webhook.
        void openPaymentGateway({
          url: payment.redirectUrl,
          transactionId: payment.transactionId,
          navigate,
        });
        return;
      }
      // Checkout intent itself failed to start (e.g. gateway not configured) — membership
      // stays PENDING_PAYMENT, retriable from "My Memberships" with a different provider.
      toast.error(payment?.failureReason || "Không tạo được giao dịch thanh toán — thử lại từ Membership của bạn");
      setBuyTarget(null);
      navigate("/client/gym-memberships");
    },
    onError: (err: any) => {
      setBuyTarget(null);
      const code = err?.response?.data?.error?.code;
      if (code === "ALREADY_HAS_PENDING_MEMBERSHIP") {
        toast.error("You already have a pending membership at this gym — pay it off first.");
        navigate("/client/gym-memberships");
        return;
      }
      if (code === "ALREADY_HAS_OPEN_MEMBERSHIP") {
        toast.error("You already have an active membership at this gym.");
        return;
      }
      const referralMessages: Record<string, string> = {
        REFERRAL_CODE_NOT_FOUND: "Mã giới thiệu không tồn tại",
        CANNOT_REFER_YOURSELF: "Bạn không thể tự giới thiệu chính mình",
        REFERRAL_NOT_APPLICABLE_AT_THIS_GYM: "Mã giới thiệu này không áp dụng cho phòng tập bạn đang chọn",
        REFERRAL_ONLY_FOR_FIRST_MEMBERSHIP: "Mã giới thiệu chỉ áp dụng cho lần mua gói đầu tiên tại phòng gym này",
      };
      if (code in referralMessages) {
        toast.error(referralMessages[code]);
        return;
      }
      toast.error(code || "Failed to purchase membership");
    },
  });

  if (gymLoading || plansLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="w-8 h-8 text-green-500 animate-spin" />
      </div>
    );
  }

  if (!gym) {
    return (
      <div className="p-6 max-w-3xl mx-auto text-center text-zinc-500">Gym not found</div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-5">
      <button type="button" onClick={() => navigate("/client/gyms")} className="flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-300">
        <ArrowLeft className="w-4 h-4" /> Back to gyms
      </button>

      <div className="bg-zinc-900 rounded-2xl border border-zinc-800/60 p-6">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-12 h-12 rounded-xl bg-green-500/10 flex items-center justify-center">
            <Dumbbell className="w-6 h-6 text-green-400" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-zinc-100">{gym.name}</h1>
            <div className="flex items-center gap-1 text-xs text-zinc-500">
              <MapPin className="w-3 h-3" /> {gym.address}{gym.city ? `, ${gym.city}` : ""}
            </div>
            {typeof gym.reviewCount === "number" && gym.reviewCount > 0 && (
              <div className="flex items-center gap-1.5 text-xs text-zinc-400 mt-1">
                <Stars value={gym.averageRating ?? 0} /> {(gym.averageRating ?? 0).toFixed(1)} ({gym.reviewCount})
              </div>
            )}
          </div>
        </div>
        {gym.description && <p className="text-sm text-zinc-400 mt-3">{gym.description}</p>}
      </div>

      <div>
        <h2 className="text-sm font-bold text-zinc-300 mb-2">Membership Plans</h2>
        {plans.length > 0 && (
          <div className="mb-3">
            <label htmlFor="referral-code" className="text-xs font-semibold text-zinc-500 mb-1 block">
              Mã giới thiệu (không bắt buộc)
            </label>
            <input
              id="referral-code"
              type="text"
              value={referralCode}
              onChange={(e) => setReferralCode(e.target.value.toUpperCase())}
              placeholder="VD: HUY2ABC"
              maxLength={16}
              className="w-full sm:w-64 px-3 py-2 bg-zinc-900 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-green-500/50 font-mono tracking-wider"
            />
          </div>
        )}
        {plans.length === 0 ? (
          <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-8 text-center text-sm text-zinc-500">
            No plans available yet.
          </div>
        ) : (
          <div className="space-y-3">
            {plans.map((p) => (
              <div key={p.id} className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-sm font-bold text-zinc-200">{p.name}</div>
                  {p.description && <div className="text-xs text-zinc-500 mt-0.5">{p.description}</div>}
                  <div className="text-xs text-zinc-600 mt-1">
                    {p.durationDays} days{p.visitLimit ? ` · ${p.visitLimit} visits` : " · unlimited visits"}
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className="text-sm font-bold text-green-400 mb-2">{formatVND(Number(p.price))}</div>
                  <button
                    type="button"
                    onClick={() => startBuy(p)}
                    disabled={buyMutation.isPending}
                    className="flex items-center gap-1.5 bg-green-500 hover:bg-green-400 disabled:opacity-60 text-black px-3 py-2 rounded-lg text-xs font-bold transition-all"
                  >
                    {buyMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
                    Buy
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <GymReviewsSection gymId={id!} />

      {warningTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-zinc-900 border border-amber-500/30 rounded-2xl w-full max-w-sm shadow-2xl">
            <div className="p-5 border-b border-zinc-800/60 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
              <h3 className="text-zinc-100 font-bold">Bạn đang có gói ở phòng gym khác</h3>
            </div>
            <div className="p-5 space-y-2 text-sm text-zinc-300">
              <p className="text-zinc-400">Bạn hoàn toàn có thể là hội viên nhiều phòng gym cùng lúc — chỉ là một lời nhắc trước khi mua thêm:</p>
              <ul className="space-y-1.5">
                {multiGymWarnings.map((w) => (
                  <li key={w.gymId} className="rounded-lg bg-zinc-800/60 px-3 py-2">
                    <span className="font-semibold text-zinc-200">{w.gymName}</span>
                    <span className="text-zinc-500"> — còn hiệu lực đến {new Date(w.endDate).toLocaleDateString("vi-VN")}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="p-5 border-t border-zinc-800/60 flex gap-3">
              <button
                type="button"
                onClick={() => setWarningTarget(null)}
                className="flex-1 py-2.5 border border-zinc-700/60 text-zinc-300 text-sm font-semibold rounded-lg hover:bg-zinc-800 transition-colors"
              >
                Để sau
              </button>
              <button
                type="button"
                onClick={() => {
                  setBuyTarget(warningTarget);
                  setWarningTarget(null);
                }}
                className="flex-1 py-2.5 bg-green-500 hover:bg-green-400 text-black text-sm font-bold rounded-lg transition-all"
              >
                Vẫn tiếp tục mua
              </button>
            </div>
          </div>
        </div>
      )}

      {buyTarget && (
        <PaymentMethodDialog
          amount={Number(buyTarget.price)}
          title="Chọn phương thức thanh toán gói tập"
          isSubmitting={buyMutation.isPending}
          onClose={() => setBuyTarget(null)}
          onConfirm={(provider) => buyMutation.mutate({ planId: buyTarget.id, provider })}
        />
      )}
    </div>
  );
}
