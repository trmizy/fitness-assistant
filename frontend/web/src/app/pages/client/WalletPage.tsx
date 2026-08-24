import { useState } from "react";
import { Wallet as WalletIcon, ArrowDownCircle, ArrowUpCircle, Loader2, Banknote } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { walletService } from "../../services/api";
import type { Wallet, WalletLedgerEntry } from "../../types";
import { formatVND } from "../../utils/currency";

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

const STATUS_LABEL: Record<string, string> = {
  PENDING: "Đang chờ duyệt",
  APPROVED: "Đã duyệt — chờ chi trả",
  PAID: "Đã chi trả",
  REJECTED: "Bị từ chối",
};

// Wallet top-up was removed from the product (backend commit "direct-to-gateway checkout,
// wallet top-up removed" — POST /me/wallet/topup now answers 410 TOPUP_REMOVED). Clients pay
// each gym membership / PT contract at the gateway directly; this wallet only ever receives
// refunds and no-show compensation, so there is nothing to top up here any more.
export function WalletPage() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [amount, setAmount] = useState("");
  const [payoutInfo, setPayoutInfo] = useState("");

  const { data: wallet, isLoading: walletLoading } = useQuery<Wallet>({
    queryKey: ["client-wallet"],
    queryFn: () => walletService.getWallet(),
  });

  const { data: transactions = [], isLoading: txLoading } = useQuery<WalletLedgerEntry[]>({
    queryKey: ["client-wallet-transactions"],
    queryFn: () => walletService.getTransactions(),
  });

  // Money-flow plan 5.3 — a client wallet may only withdraw refund/compensation-sourced money
  // (enforced backend-side); requesting only creates a PENDING row, no money moves until an
  // admin confirms a real bank transfer and marks it paid.
  const { data: withdrawals = [] } = useQuery<any[]>({
    queryKey: ["client-withdrawals"],
    queryFn: () => walletService.getMyWithdrawals(),
  });

  const withdrawMutation = useMutation({
    mutationFn: () => walletService.requestWithdrawal(amount, payoutInfo),
    onSuccess: () => {
      toast.success("Đã gửi yêu cầu rút tiền");
      setShowForm(false);
      setAmount("");
      setPayoutInfo("");
      queryClient.invalidateQueries({ queryKey: ["client-withdrawals"] });
    },
    onError: (error: any) => toast.error(error?.response?.data?.error?.message || "Không thể tạo yêu cầu rút tiền"),
  });

  const openRequests = withdrawals.filter((w) => w.status === "PENDING" || w.status === "APPROVED");

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-5">
      <div>
        <h1 className="text-zinc-100 flex items-center gap-2 text-xl font-bold">
          <WalletIcon className="w-5 h-5 text-green-400" /> My Wallet
        </h1>
        <p className="text-zinc-500 text-sm mt-0.5">Refunds and no-show compensation land here</p>
      </div>

      {/* Balance card */}
      <div className="bg-gradient-to-br from-green-500/15 to-zinc-900 rounded-2xl border border-green-500/20 p-6">
        <div className="text-xs text-zinc-400 mb-1">Available Balance</div>
        {walletLoading ? (
          <Loader2 className="w-6 h-6 text-green-500 animate-spin mt-2" />
        ) : (
          <div className="text-3xl font-bold text-zinc-100">{formatVND(Number(wallet?.availableBalance ?? 0))}</div>
        )}
        <button
          onClick={() => setShowForm((v) => !v)}
          className="mt-4 flex items-center gap-1.5 bg-green-500 hover:bg-green-400 text-black px-3 py-1.5 rounded-lg text-xs font-bold transition-all"
        >
          <Banknote className="w-3.5 h-3.5" /> Yêu cầu rút tiền
        </button>

        {showForm && (
          <div className="mt-4 bg-zinc-900/60 border border-zinc-800/60 rounded-xl p-3.5 space-y-2">
            <p className="text-[11px] text-zinc-500">
              Chỉ rút được phần tiền có nguồn gốc hoàn trả / bồi thường, không phải toàn bộ số
              dư.
            </p>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Số tiền (VNĐ)"
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200"
            />
            <input
              value={payoutInfo}
              onChange={(e) => setPayoutInfo(e.target.value)}
              placeholder="Số tài khoản / ngân hàng nhận tiền"
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200"
            />
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setShowForm(false)} className="px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200">
                Huỷ
              </button>
              <button
                onClick={() => withdrawMutation.mutate()}
                disabled={!amount || !payoutInfo.trim() || withdrawMutation.isPending}
                className="px-4 py-1.5 bg-green-500 hover:bg-green-400 disabled:opacity-40 disabled:cursor-not-allowed text-black text-xs font-bold rounded-lg transition-all"
              >
                Gửi yêu cầu
              </button>
            </div>
          </div>
        )}

        {openRequests.length > 0 && (
          <div className="mt-4 space-y-1.5">
            {openRequests.map((w) => (
              <div key={w.id} className="flex items-center justify-between text-xs bg-zinc-900/60 border border-zinc-800/60 rounded-lg px-3 py-2">
                <span className="text-zinc-400">{formatVND(Number(w.amount))}</span>
                <span className="text-amber-400 font-medium">{STATUS_LABEL[w.status] ?? w.status}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Transaction history */}
      <div>
        <h2 className="text-sm font-bold text-zinc-300 mb-2">Transaction History</h2>
        {txLoading && (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="w-6 h-6 text-green-500 animate-spin" />
          </div>
        )}
        {!txLoading && transactions.length === 0 && (
          <div className="bg-zinc-900 rounded-2xl border border-zinc-800/60 p-12 text-center">
            <WalletIcon className="w-10 h-10 text-zinc-800 mx-auto mb-3" />
            <p className="text-sm text-zinc-500">No transactions yet</p>
          </div>
        )}
        {!txLoading && transactions.length > 0 && (
          <div className="space-y-2">
            {transactions.map((t) => (
              <div key={t.id} className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-3.5 flex items-center gap-3">
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${t.entryType === "CREDIT" ? "bg-green-500/10" : "bg-red-500/10"}`}>
                  {t.entryType === "CREDIT" ? (
                    <ArrowDownCircle className="w-4.5 h-4.5 text-green-400" />
                  ) : (
                    <ArrowUpCircle className="w-4.5 h-4.5 text-red-400" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-zinc-200 font-medium truncate">{t.description || (t.entryType === "CREDIT" ? "Credit" : "Debit")}</div>
                  <div className="text-xs text-zinc-600">{formatDateTime(t.createdAt)}</div>
                </div>
                <div className={`text-sm font-bold flex-shrink-0 ${t.entryType === "CREDIT" ? "text-green-400" : "text-red-400"}`}>
                  {t.entryType === "CREDIT" ? "+" : "-"}{formatVND(Number(t.amount))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
