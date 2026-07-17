import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { CheckCircle2, XCircle, Loader2, Clock, Wallet as WalletIcon } from "lucide-react";
import { walletService } from "../../services/api";

type Phase = "checking" | "paid" | "pending" | "failed" | "error";

/**
 * Landing page for gateway return-URLs (VNPay, ...). The `status` query param from the
 * gateway is DISPLAY-ONLY and never trusted: we ALWAYS call the server sync endpoint and
 * only show success when the server itself reports PAID.
 */
export function PaymentResultPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const txnId = params.get("txnId") ?? "";
  const [phase, setPhase] = useState<Phase>("checking");

  const confirm = async () => {
    setPhase("checking");
    if (!txnId) {
      setPhase("error");
      return;
    }
    try {
      const result = await walletService.syncTopup(txnId);
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

  const view = {
    checking: { icon: <Loader2 className="w-12 h-12 text-green-500 animate-spin" />, title: "Đang xác nhận thanh toán…", desc: "Đang kiểm tra với cổng thanh toán, vui lòng đợi." },
    paid: { icon: <CheckCircle2 className="w-12 h-12 text-green-500" />, title: "Thanh toán thành công", desc: "Số dư ví của bạn đã được cộng tiền." },
    pending: { icon: <Clock className="w-12 h-12 text-amber-400" />, title: "Đang chờ xác nhận", desc: "Cổng thanh toán chưa xác nhận xong. Bạn có thể thử kiểm tra lại." },
    failed: { icon: <XCircle className="w-12 h-12 text-red-400" />, title: "Thanh toán thất bại", desc: "Giao dịch không thành công. Ví của bạn không bị trừ/cộng." },
    error: { icon: <XCircle className="w-12 h-12 text-red-400" />, title: "Không xác nhận được", desc: "Có lỗi khi kiểm tra trạng thái giao dịch." },
  }[phase];

  return (
    <div className="p-4 md:p-6 max-w-md mx-auto">
      <div className="bg-zinc-900 border border-zinc-800/60 rounded-2xl p-8 text-center space-y-4 mt-8">
        <div className="flex justify-center">{view.icon}</div>
        <h1 className="text-xl font-bold text-zinc-100">{view.title}</h1>
        <p className="text-sm text-zinc-500">{view.desc}</p>
        {txnId && <p className="text-xs text-zinc-700 break-all">Mã giao dịch: {txnId}</p>}

        <div className="flex gap-3 pt-2">
          {phase === "pending" && (
            <button
              onClick={() => void confirm()}
              className="flex-1 py-2.5 border border-zinc-700/60 text-zinc-300 text-sm font-semibold rounded-lg hover:bg-zinc-800 transition-colors"
            >
              Kiểm tra lại
            </button>
          )}
          <button
            onClick={() => navigate("/client/wallet")}
            className="flex-1 py-2.5 bg-green-500 hover:bg-green-400 text-black text-sm font-bold rounded-lg transition-all flex items-center justify-center gap-2"
          >
            <WalletIcon className="w-4 h-4" /> Về Ví
          </button>
        </div>
      </div>
    </div>
  );
}
