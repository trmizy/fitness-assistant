import { useEffect, useState } from "react";
import { WalletIcon, CheckCircleIcon as CheckCircle2, XCircleIcon as XCircle, CircleNotchIcon as Loader2, ArrowsClockwiseIcon as RefreshCw } from "@phosphor-icons/react";
import { adminService } from "../../services/api";
import { formatVND } from "../../utils/currency";

/**
 * Whole-platform money invariant (docs/money-flow.md §1.3) — extracted out of
 * SystemMonitoring.tsx into its own component when "Tài chính" was consolidated into one
 * page: this is money, not system health, and now lives in that page's "Đối soát" tab
 * instead. Self-contained (fetches its own data, own 30s auto-refresh) so it drops into
 * either place with zero props.
 */
type ReconciliationReport = {
  escrow: string;
  claims: string;
  drift: string;
  balanced: boolean;
  breakdown: {
    clientBalances: string;
    ptPending: string;
    ptAvailable: string;
    gymPending: string;
    gymAvailable: string;
    platformRevenuePending: string;
    platformRevenueAvailable: string;
  };
  negativeWallets: { id: string; ownerType: string; ownerId: string; available: string; pending: string }[];
};

export function AdminReconciliationPanel() {
  const [recon, setRecon] = useState<ReconciliationReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchRecon = async () => {
    try {
      setRefreshing(true);
      const res = await adminService.getReconciliation();
      setRecon(res?.data ?? null);
    } catch {
      setRecon(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchRecon();
    const interval = setInterval(fetchRecon, 30000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div
      className={`rounded-xl p-4 border ${
        loading
          ? "bg-zinc-900 border-zinc-800/60"
          : recon?.balanced
            ? "bg-green-500/5 border-green-500/20"
            : "bg-red-500/5 border-red-500/20"
      }`}
    >
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold text-zinc-200 flex items-center gap-2">
          <WalletIcon className="w-4 h-4 text-zinc-400" /> Đối soát toàn nền tảng
        </h3>
        <div className="flex items-center gap-3">
          {!loading &&
            (recon?.balanced ? (
              <span className="flex items-center gap-1.5 text-xs font-semibold text-green-400">
                <CheckCircle2 className="w-3.5 h-3.5" /> Cân bằng
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-xs font-semibold text-red-400">
                <XCircle className="w-3.5 h-3.5" /> Phát hiện lệch
              </span>
            ))}
          <button
            onClick={fetchRecon}
            disabled={refreshing}
            className="p-1.5 text-zinc-500 hover:text-zinc-300 transition-colors"
            title="Làm mới"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>
      {loading ? (
        <div className="flex justify-center py-4">
          <Loader2 className="w-5 h-5 text-zinc-500 animate-spin" />
        </div>
      ) : !recon ? (
        <p className="text-xs text-zinc-500">Không tải được dữ liệu đối soát.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div>
              <div className="text-zinc-500">ESCROW (giữ hộ)</div>
              <div className="text-zinc-200 font-semibold">{formatVND(Number(recon.escrow))}</div>
            </div>
            <div>
              <div className="text-zinc-500">Tổng các bên nhận quyền lợi</div>
              <div className="text-zinc-200 font-semibold">{formatVND(Number(recon.claims))}</div>
            </div>
            <div>
              <div className="text-zinc-500">Chênh lệch</div>
              <div className={`font-semibold ${Number(recon.drift) === 0 ? "text-green-400" : "text-red-400"}`}>
                {formatVND(Number(recon.drift))}
              </div>
            </div>
            <div>
              <div className="text-zinc-500">Doanh thu nền tảng</div>
              <div className="text-zinc-200 font-semibold">
                {formatVND(Number(recon.breakdown.platformRevenueAvailable))}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs mt-3 pt-3 border-t border-zinc-800/60">
            <div>
              <div className="text-zinc-500">Số dư khách hàng</div>
              <div className="text-zinc-300 font-medium">{formatVND(Number(recon.breakdown.clientBalances))}</div>
            </div>
            <div>
              <div className="text-zinc-500">PT — chờ / khả dụng</div>
              <div className="text-zinc-300 font-medium">
                {formatVND(Number(recon.breakdown.ptPending))} / {formatVND(Number(recon.breakdown.ptAvailable))}
              </div>
            </div>
            <div>
              <div className="text-zinc-500">Gym — chờ / khả dụng</div>
              <div className="text-zinc-300 font-medium">
                {formatVND(Number(recon.breakdown.gymPending))} / {formatVND(Number(recon.breakdown.gymAvailable))}
              </div>
            </div>
            <div>
              <div className="text-zinc-500">Nền tảng — chờ / khả dụng</div>
              <div className="text-zinc-300 font-medium">
                {formatVND(Number(recon.breakdown.platformRevenuePending))} /{" "}
                {formatVND(Number(recon.breakdown.platformRevenueAvailable))}
              </div>
            </div>
          </div>
          {recon.negativeWallets.length > 0 && (
            <div className="mt-3 bg-red-500/10 border border-red-500/20 rounded-lg p-3">
              <p className="text-xs text-red-400 font-semibold mb-1">
                {recon.negativeWallets.length} ví có số dư âm — luôn là lỗi
              </p>
              <ul className="text-[11px] text-red-300 space-y-0.5">
                {recon.negativeWallets.map((w) => (
                  <li key={w.id}>
                    {w.ownerType} {w.ownerId} — chờ {formatVND(Number(w.pending))}, khả dụng{" "}
                    {formatVND(Number(w.available))}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
