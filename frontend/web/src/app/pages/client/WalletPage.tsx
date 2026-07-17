import { useState } from "react";
import { Wallet as WalletIcon, ArrowDownCircle, ArrowUpCircle, Loader2, Plus, X } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { walletService } from "../../services/api";
import { toast } from "sonner";
import type { Wallet, WalletLedgerEntry } from "../../types";
import { formatVND } from "../../utils/currency";

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function WalletPage() {
  const queryClient = useQueryClient();
  const [showTopup, setShowTopup] = useState(false);
  const [amount, setAmount] = useState("");
  const [provider, setProvider] = useState("MOCK");

  const { data: wallet, isLoading: walletLoading } = useQuery<Wallet>({
    queryKey: ["client-wallet"],
    queryFn: () => walletService.getWallet(),
  });

  const { data: transactions = [], isLoading: txLoading } = useQuery<WalletLedgerEntry[]>({
    queryKey: ["client-wallet-transactions"],
    queryFn: () => walletService.getTransactions(),
  });

  const topupMutation = useMutation({
    // clientRequestId generated once per submission — reused on any retry of *this*
    // submission so a double-click dedupes to one top-up (see payment-service plan §1.3).
    mutationFn: ({ value, clientRequestId }: { value: number; clientRequestId: string }) =>
      walletService.topup(value, clientRequestId, provider),
    onSuccess: (result: any) => {
      // External gateways (VNPay, ...) return a redirectUrl — send the browser to the
      // hosted checkout. The wallet is only credited after the gateway confirms
      // (return/IPN/sync), so we do NOT optimistically refetch here.
      if (result?.redirectUrl) {
        window.location.href = result.redirectUrl;
        return;
      }
      toast.success("Top-up submitted — balance will update shortly");
      setShowTopup(false);
      setAmount("");
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["client-wallet"] });
        queryClient.invalidateQueries({ queryKey: ["client-wallet-transactions"] });
      }, 800);
    },
    onError: (err: any) =>
      toast.error(err?.response?.data?.error?.message || err?.response?.data?.error?.code || "Top-up failed"),
  });

  const handleTopup = () => {
    const value = Number(amount);
    if (!value || value <= 0) {
      toast.error("Enter a valid amount");
      return;
    }
    topupMutation.mutate({ value, clientRequestId: crypto.randomUUID() });
  };

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-5">
      <div>
        <h1 className="text-zinc-100 flex items-center gap-2 text-xl font-bold">
          <WalletIcon className="w-5 h-5 text-green-400" /> My Wallet
        </h1>
        <p className="text-zinc-500 text-sm mt-0.5">Top up and pay for gym memberships and PT contracts</p>
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
          type="button"
          onClick={() => setShowTopup(true)}
          className="mt-4 flex items-center gap-2 bg-green-500 hover:bg-green-400 text-black px-4 py-2.5 rounded-xl text-sm font-bold transition-all shadow-lg shadow-green-500/20"
        >
          <Plus className="w-4 h-4" /> Top Up
        </button>
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

      {/* Top-up dialog */}
      {showTopup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-zinc-900 border border-zinc-700/60 rounded-2xl w-full max-w-sm shadow-2xl">
            <div className="p-5 border-b border-zinc-800/60 flex items-center justify-between">
              <h3 className="text-zinc-100 font-bold">Top Up Wallet</h3>
              <button type="button" onClick={() => setShowTopup(false)} className="text-zinc-500 hover:text-zinc-300">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-3">
              <label htmlFor="topup-provider" className="text-xs font-semibold text-zinc-400 block">Phương thức</label>
              <select
                id="topup-provider"
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
                className="w-full px-3 py-2.5 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 outline-none focus:border-green-500/50"
              >
                <option value="MOCK">Mô phỏng (Mock)</option>
                <option value="VNPAY">VNPay</option>
                <option value="ZALOPAY">ZaloPay</option>
                {/* PayOS ẩn tạm khỏi UI (VietQR — cần tiền thật, không có sandbox tiền giả).
                    Backend vẫn giữ nguyên PayOSProvider + factory + guard; thêm lại option này
                    là bật lại được khi có PAYOS_CLIENT_ID/API_KEY/CHECKSUM_KEY trong .env. */}
              </select>
              <label htmlFor="topup-amount" className="text-xs font-semibold text-zinc-400 block">Amount (VND)</label>
              <input
                id="topup-amount"
                type="number"
                min={1}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="500000"
                className="w-full px-3 py-2.5 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-green-500/50"
              />
              <div className="flex gap-2">
                {[200000, 500000, 1000000].map((v) => (
                  <button
                    type="button"
                    key={v}
                    onClick={() => setAmount(String(v))}
                    className="flex-1 py-2 rounded-lg border border-zinc-700/60 text-xs text-zinc-400 hover:border-green-500/40 hover:text-green-400 transition-colors"
                  >
                    {formatVND(v)}
                  </button>
                ))}
              </div>
            </div>
            <div className="p-5 border-t border-zinc-800/60 flex gap-3">
              <button type="button" onClick={() => setShowTopup(false)} className="flex-1 py-2.5 border border-zinc-700/60 text-zinc-300 text-sm font-semibold rounded-lg hover:bg-zinc-800 transition-colors">
                Cancel
              </button>
              <button
                type="button"
                onClick={handleTopup}
                disabled={topupMutation.isPending}
                className="flex-1 py-2.5 bg-green-500 hover:bg-green-400 disabled:opacity-60 text-black text-sm font-bold rounded-lg transition-all flex items-center justify-center gap-2"
              >
                {topupMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
