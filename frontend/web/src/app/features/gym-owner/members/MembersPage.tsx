/**
 * Hội viên & gói (batch G3), `/gym-owner/members`, behind VITE_GYM_OWNER_V2 (routes.tsx).
 * Two tabs (16 tabs-sliding, URL `?tab=members|plans`, `?gymId=`):
 *  - Hội viên: a BRANCH screen (the scope strip picks the branch). Owner/manager read the full list; the accountant reads the
 *    sales view (no identity). A receptionist never reaches this page.
 *  - Gói: a BRAND screen ("Áp dụng toàn thương hiệu"). Owner creates / edits / switches plans, manager and accountant read only.
 * `/gym-owner/plans` (flag on) redirects to `?tab=plans`.
 */
import { useNavigate, useSearchParams } from "react-router";
import { GoTabs } from "../../../components/layout/gym-owner/GoTabs";
import { ScopeStateFrame } from "../scope/PermissionGate";
import { useGymOwnerScope } from "../scope/GymOwnerScopeProvider";
import { ALL_BRANCHES } from "../scope/scopeModel";
import { membersSearch, membersTabsFor, resolveMembersTab, type MembersTabId } from "./membersModel";
import { MembersTab } from "./MembersTab";
import { PlansTab } from "./PlansTab";

export function MembersPage() {
  const scope = useGymOwnerScope();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const role = scope.role;
  const tabs = membersTabsFor(role);
  const tab = resolveMembersTab(params.get("tab"), role);

  if (!tab) return <ScopeStateFrame kind="forbidden" />;

  const gymParam = params.get("gymId") ?? (scope.gymId !== ALL_BRANCHES ? scope.gymId : null);
  const setTab = (next: string) => navigate({ search: membersSearch(next as MembersTabId, gymParam) });

  return (
    <div className="go-wrap go-wrap-wide" data-testid="go-members-page" data-tab={tab}>
      <header className="go-page-head">
        <div>
          <h1 data-testid="go-members-title">Hội viên & gói</h1>
          <p className="go-page-sub">
            {tab === "plans"
              ? "Gói hội viên của thương hiệu, bán và dùng được ở mọi chi nhánh."
              : role === "ACCOUNTANT"
                ? "Giao dịch gói của từng chi nhánh, dạng bán hàng."
                : "Hội viên của chi nhánh đang chọn ở thanh phạm vi."}
          </p>
        </div>
      </header>

      <GoTabs
        tabs={tabs.map((t) => ({ id: t.id, label: t.label, readOnly: t.id === "plans" && t.access === "read" }))}
        value={tab}
        onChange={setTab}
        idPrefix="go-members"
        ariaLabel="Mục của Hội viên và gói"
      />
      <div role="tabpanel" id={`go-members-panel-${tab}`} aria-labelledby={`go-members-tab-${tab}`} tabIndex={-1} className="go-tabpanel" data-tab={tab} key={tab}>
        {tab === "members" ? <MembersTab /> : <PlansTab />}
      </div>
    </div>
  );
}
