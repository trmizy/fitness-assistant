import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { CheckCircleIcon as CheckCircle2, XCircleIcon as XCircle, CircleNotchIcon as Loader2, ClockIcon as Clock, ArrowRightIcon as ArrowRight } from "@phosphor-icons/react";
import { paymentService } from "../../services/api";
import { clearPaymentReturn, peekPaymentReturn } from "../../utils/paymentReturn";

type Phase = "checking" | "paid" | "pending" | "failed" | "error";
type RelatedEntityType = "GYM_MEMBERSHIP" | "PT_CONTRACT" | string | null;

/** Where the purchased thing actually lives — never the wallet, no purchase touches it any more. */
function destinationFor(relatedEntityType: RelatedEntityType): { path: string; label: string } {
  if (relatedEntityType === "GYM_MEMBERSHIP") return { path: "/client/gym-memberships", label: "Xem gói tập" };
  if (relatedEntityType === "PT_CONTRACT") return { path: "/client/contracts", label: "Xem hợp đồng" };
  return { path: "/client/wallet", label: "Về Ví" };
}

/**
 * N13C-12 = N11B-01: after a cancelled / failed / unconfirmed payment the only button was "Về Ví" — but no purchase touches the
 * wallet, so the user was stranded away from the contract or membership they were paying. The retry lives on that item
 * (the contract's / membership's own "Thanh toán" action), so the primary button goes back there; the wallet stays secondary.
 */
function retryDestinationFor(relatedEntityType: RelatedEntityType): { path: string; label: string } | null {
  if (relatedEntityType === "GYM_MEMBERSHIP") return { path: "/client/gym-memberships", label: "Về gói tập để thanh toán lại" };
  if (relatedEntityType === "PT_CONTRACT") return { path: "/client/contracts", label: "Về hợp đồng để thanh toán lại" };
  return null;
}

/**
 * Landing page for gateway return-URLs (VNPay, ZaloPay — every provider's checkout
 * redirect ends up here: gym membership purchases, PT contract payments, not just the old
 * wallet top-up). The `status` query param from the gateway is DISPLAY-ONLY and never
 * trusted: we ALWAYS call the server sync endpoint and only show success when the server
 * itself reports PAID.
 */
export function PaymentResultPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const txnId = params.get("txnId") ?? "";
  const [phase, setPhase] = useState<Phase>("checking");
  const [relatedEntityType, setRelatedEntityType] = useState<RelatedEntityType>(null);

  const confirm = async () => {
    setPhase("checking");
    if (!txnId) {
      setPhase("error");
      return;
    }
    try {
      const result = await paymentService.syncTransaction(txnId);
      setRelatedEntityType(result?.relatedEntityType ?? null);
      const status = result?.status;
      if (status === "PAID") setPhase("paid");
      else if (status === "FAILED") setPhase("failed");
      else setPhase("pending");
    } catch {
      setPhase("error");
    }
  };

  useEffect(() => {
    void confirm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [txnId]);

  // Bought from inside a PT contract request: a way back to that request (same trainer / package / branch). Only ever an
  // in-app path remembered by this tab before the gateway trip; navigation only - the verdict above still comes from the server.
  const returnTarget = phase === "checking" ? null : peekPaymentReturn(txnId);
  const goBackToRequest = () => {
    if (!returnTarget) return;
    clearPaymentReturn(txnId);
    navigate(returnTarget.path);
  };
  const dest = destinationFor(relatedEntityType);
  const retryDest = retryDestinationFor(relatedEntityType);

  const view = {
    checking: { icon: <Loader2 className="w-12 h-12 text-green-500 animate-spin" />, title: "Đang xác nhận thanh toán…", desc: "Đang kiểm tra với cổng thanh toán, vui lòng đợi." },
    paid: { icon: <CheckCircle2 className="w-12 h-12 text-green-500" />, title: "Thanh toán thành công", desc: "Giao dịch của bạn đã được kích hoạt." },
    pending: { icon: <Clock className="w-12 h-12 text-amber-400" />, title: "Đang chờ xác nhận", desc: "Cổng thanh toán chưa xác nhận xong. Bạn có thể thử kiểm tra lại." },
    failed: { icon: <XCircle className="w-12 h-12 text-red-400" />, title: "Thanh toán thất bại", desc: "Giao dịch không thành công. Bạn chưa bị trừ tiền." },
    error: { icon: <XCircle className="w-12 h-12 text-red-400" />, title: "Không xác nhận được", desc: "Có lỗi khi kiểm tra trạng thái giao dịch." },
  }[phase];

  return (
    <div className="p-4 md:p-6 max-w-md mx-auto">
      <div className="bg-zinc-900 border border-zinc-800/60 rounded-2xl p-8 text-center space-y-4 mt-8">
        <div className="flex justify-center">{view.icon}</div>
        <h1 className="text-xl font-bold text-zinc-100">{view.title}</h1>
        <p className="text-sm text-zinc-500">{view.desc}</p>
        {txnId && <p className="text-xs text-zinc-700 break-all">Mã giao dịch: {txnId}</p>}

        <div className="flex flex-col sm:flex-row gap-3 pt-2" data-testid="payment-result-actions">
          {(phase === "pending" || phase === "error") && (
            <button
              onClick={() => void confirm()}
              className="flex-1 min-h-11 py-2.5 border border-zinc-700/60 text-zinc-300 text-sm font-semibold rounded-lg hover:bg-zinc-800 transition-colors"
            >
              Kiểm tra lại
            </button>
          )}
          {returnTarget && (
            <button
              data-testid="payment-result-return"
              onClick={goBackToRequest}
              className="flex-1 min-h-11 py-2.5 bg-green-500 hover:bg-green-400 text-black text-sm font-bold rounded-lg transition-all flex items-center justify-center gap-2"
            >
              {returnTarget.label} <ArrowRight className="w-4 h-4" />
            </button>
          )}
          {phase !== "paid" && phase !== "checking" && retryDest ? (
            <>
              <button
                data-testid="payment-result-primary"
                onClick={() => navigate(retryDest.path)}
                className="flex-1 min-h-11 py-2.5 bg-green-500 hover:bg-green-400 text-black text-sm font-bold rounded-lg transition-all flex items-center justify-center gap-2"
              >
                {retryDest.label} <ArrowRight className="w-4 h-4" />
              </button>
              <button
                data-testid="payment-result-wallet"
                onClick={() => navigate("/client/wallet")}
                className="flex-1 min-h-11 py-2.5 border border-zinc-700/60 text-zinc-300 text-sm font-semibold rounded-lg hover:bg-zinc-800 transition-colors"
              >
                Về Ví
              </button>
            </>
          ) : (
            <button
              data-testid="payment-result-primary"
              onClick={() => navigate(phase === "paid" ? dest.path : "/client/wallet")}
              className={`flex-1 min-h-11 py-2.5 text-sm rounded-lg transition-all flex items-center justify-center gap-2 ${
                returnTarget
                  ? "border border-zinc-700/60 text-zinc-300 font-semibold hover:bg-zinc-800"
                  : "bg-green-500 hover:bg-green-400 text-black font-bold"
              }`}
            >
              {phase === "paid" ? dest.label : "Về Ví"} <ArrowRight className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
