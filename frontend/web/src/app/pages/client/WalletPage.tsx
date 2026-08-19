import { Wallet as WalletIcon, ArrowDownCircle, ArrowUpCircle, Loader2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { walletService } from "../../services/api";
import type { Wallet, WalletLedgerEntry } from "../../types";
import { formatVND } from "../../utils/currency";

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

// Wallet top-up was removed from the product (backend commit "direct-to-gateway checkout,
// wallet top-up removed" — POST /me/wallet/topup now answers 410 TOPUP_REMOVED). Clients pay
// each gym membership / PT contract at the gateway directly; this wallet only ever receives
// refunds and no-show compensation, so there is nothing to top up here any more.
export function WalletPage() {
  const { data: wallet, isLoading: walletLoading } = useQuery<Wallet>({
    queryKey: ["client-wallet"],
    queryFn: () => walletService.getWallet(),
  });

  const { data: transactions = [], isLoading: txLoading } = useQuery<WalletLedgerEntry[]>({
    queryKey: ["client-wallet-transactions"],
    queryFn: () => walletService.getTransactions(),
  });

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
