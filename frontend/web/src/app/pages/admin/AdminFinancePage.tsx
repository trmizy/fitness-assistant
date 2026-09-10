import { useState } from "react";
import { CurrencyCircleDollarIcon as CircleDollarSign } from "@phosphor-icons/react";
import { AdminFinanceOverviewTab } from "./AdminFinanceOverviewTab";
import { AdminReconciliationPanel } from "./AdminReconciliationPanel";
import { AdminWithdrawals } from "./AdminWithdrawals";
import { PTServiceRefunds } from "./PTServiceRefunds";

/**
 * "Tài chính" — mọi chức năng liên quan đến tiền của admin gom về một trang, thay cho các route
 * rời rạc trước đó (/admin/withdrawals, /admin/pt-service-refunds) và bảng đối soát vốn nằm lẫn
 * trong "Giám sát hệ thống" (trang đó giờ chỉ còn sức khoẻ hệ thống, không còn tiền).
 */
type Tab = "overview" | "reconciliation" | "withdrawals" | "refunds";

const TABS: { key: Tab; label: string }[] = [
  { key: "overview", label: "Tổng quan" },
  { key: "reconciliation", label: "Đối soát" },
  { key: "withdrawals", label: "Rút tiền" },
  { key: "refunds", label: "Hoàn tiền" },
];

export function AdminFinancePage() {
  const [tab, setTab] = useState<Tab>("overview");

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-zinc-100 flex items-center gap-2 text-xl font-bold">
          <CircleDollarSign className="w-5 h-5 text-green-400" /> Tài chính
        </h1>
        <p className="text-zinc-500 text-sm mt-0.5">
          Toàn bộ số tiền thu, chi, đối soát và các yêu cầu rút/hoàn tiền của nền tảng, ở một chỗ.
        </p>
      </div>

      <div data-testid="admin-finance-tabs" className="flex gap-1.5 flex-wrap border-b border-zinc-800/60 pb-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            data-testid={`admin-finance-tab-${t.key}`}
            onClick={() => setTab(t.key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              tab === t.key ? "bg-green-500 text-black" : "text-zinc-400 hover:bg-zinc-800/60"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "overview" && <AdminFinanceOverviewTab />}
      {tab === "reconciliation" && <AdminReconciliationPanel />}
      {tab === "withdrawals" && <AdminWithdrawals />}
      {tab === "refunds" && <PTServiceRefunds />}
    </div>
  );
}
