/**
 * Tài chính (batch G5), `/gym-owner/finance`, behind VITE_GYM_OWNER_V2 (routes.tsx). OWNER and ACCOUNTANT; brand-or-branch scope
 * (`?gymId=` one branch, none = every branch in scope). Four tabs (16 tabs-sliding, `?tab=wallets|withdrawals|commission|sales`):
 *   Ví (one card per branch, no total row; one branch = a large card + Rút tiền for the OWNER), Lệnh rút (table + drawer
 *   `?withdrawal=<id>`), Hoa hồng PT (totals + by month), Doanh số (cards sold, a gross selling price, CSV).
 * Which tabs exist and which buttons exist comes from the server's permissions[] (`scope.can`), fail-closed; the accountant has no
 * withdrawal button anywhere. Everything the old Finance page and the withdrawal block of the branch page did is here (PARITY.md).
 */
import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { GoTabs } from "../../../components/layout/gym-owner/GoTabs";
import { GoTag } from "../../../components/layout/gym-owner/GoTag";
import { ScopeStateFrame } from "../scope/PermissionGate";
import { useGymOwnerScope } from "../scope/GymOwnerScopeProvider";
import { ALL_BRANCHES } from "../scope/scopeModel";
import { CommissionView } from "../partners/CommissionView";
import { WalletsTab } from "./WalletsTab";
import { WithdrawalsTab } from "./WithdrawalsTab";
import { SalesTab } from "./SalesTab";
import { financeSearch, finTabsFor, resolveFinTab, type FinTabId } from "./financeModel";

export function FinancePage() {
  const scope = useGymOwnerScope();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const tabs = finTabsFor(scope.can);
  const tab = resolveFinTab(params.get("tab"), scope.can);
  const [sent, setSent] = useState(false);
  const sentTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (sentTimer.current) clearTimeout(sentTimer.current);
    },
    [],
  );

  if (!tab) return <ScopeStateFrame kind="forbidden" />;

  const single = scope.gymId !== ALL_BRANCHES;
  const gymParam = single ? scope.gymId : null;
  const gyms = single ? scope.gyms.filter((g) => g.id === scope.gymId) : scope.gyms;
  const readOnly = !scope.can("finance.withdraw");
  const withdrawalParam = tab === "withdrawals" ? params.get("withdrawal") : null;

  const setTab = (next: string) => navigate({ search: financeSearch({ gymId: gymParam, tab: next as FinTabId }) });
  const openWithdrawal = (id: string) => navigate({ search: financeSearch({ gymId: gymParam, tab: "withdrawals", withdrawalId: id }) });
  const closeWithdrawal = () => navigate({ search: financeSearch({ gymId: gymParam, tab: "withdrawals" }) }, { replace: true });
  /** A wallet row of "all branches" opens that branch on the same tab. */
  const pickBranch = (id: string) => navigate({ search: `?gymId=${encodeURIComponent(id)}&tab=wallets` });
  const onWithdrawn = () => {
    setSent(true);
    if (sentTimer.current) clearTimeout(sentTimer.current);
    sentTimer.current = setTimeout(() => setSent(false), 6000);
  };

  return (
    <div className="go-wrap go-wrap-wide" data-testid="go-finance-page" data-tab={tab}>
      <header className="go-page-head">
        <div>
          <h1 data-testid="go-finance-title">Tài chính</h1>
          <p className="go-page-sub">
            {single ? "Ví, lệnh rút, hoa hồng PT và doanh số của chi nhánh đang chọn." : "Ví, lệnh rút, hoa hồng PT và doanh số của các chi nhánh trong phạm vi của bạn."}
          </p>
        </div>
        {readOnly && <GoTag tone="neutral" text="Chỉ xem" />}
      </header>

      <GoTabs tabs={tabs} value={tab} onChange={setTab} idPrefix="go-fin" ariaLabel="Mục của Tài chính" />
      <div role="tabpanel" id={`go-fin-panel-${tab}`} aria-labelledby={`go-fin-tab-${tab}`} tabIndex={-1} className="go-tabpanel" data-tab={tab} key={tab}>
        {tab === "wallets" && <WalletsTab gyms={gyms} onOpenWithdrawal={openWithdrawal} onPickBranch={pickBranch} sentFlag={sent} onWithdrawn={onWithdrawn} />}
        {tab === "withdrawals" && <WithdrawalsTab gyms={gyms} openId={withdrawalParam} onOpen={openWithdrawal} onClose={closeWithdrawal} />}
        {tab === "commission" && <CommissionView embedded />}
        {tab === "sales" && <SalesTab gyms={gyms} />}
      </div>
    </div>
  );
}
