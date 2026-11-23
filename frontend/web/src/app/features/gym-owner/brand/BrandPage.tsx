/**
 * Thương hiệu & nhân sự (batch G6), `/gym-owner/brand` (and `/gym-owner/managers`, which redirects to `?tab=staff`), behind VITE_GYM_OWNER_V2.
 * Two tabs (16 tabs-sliding, `?tab=info|staff`), each shown only when the server's permissions[] says so (fail-closed, no role-name test):
 *   Thông tin thương hiệu : `brand.view` (owner, manager, accountant read it); only `brand.write` (owner) edits.
 *   Nhân sự               : `staff.manage` (owner): accounts, pending invitations, invite, resend, revoke.
 * Typing in either tab and then leaving (another page, the other tab) asks first.
 */
import { useEffect, useRef } from "react";
import { useBlocker, useNavigate, useSearchParams } from "react-router";
import { GoTabs } from "../../../components/layout/gym-owner/GoTabs";
import { GoModal } from "../../../components/layout/gym-owner/GoModal";
import { ScopeStateFrame } from "../scope/PermissionGate";
import { useGymOwnerScope } from "../scope/GymOwnerScopeProvider";
import { BrandInfoTab } from "./BrandInfoTab";
import { StaffTab } from "./StaffTab";
import { brandHref, brandTabsFor, resolveBrandTab, shouldAskBeforeLeaving, type BrandTabId } from "./brandModel";

export function BrandPage() {
  const scope = useGymOwnerScope();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const tabs = brandTabsFor(scope.can);
  const tab = resolveBrandTab(params.get("tab"), scope.can);
  const dirty = useRef({ info: false, staff: false });

  const blocker = useBlocker(({ currentLocation, nextLocation }) =>
    shouldAskBeforeLeaving({ dirty: dirty.current.info || dirty.current.staff, from: { pathname: currentLocation.pathname, search: currentLocation.search }, to: { pathname: nextLocation.pathname, search: nextLocation.search } }),
  );
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (!(dirty.current.info || dirty.current.staff)) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, []);

  if (!tab) return <ScopeStateFrame kind="forbidden" />;
  const canEdit = scope.can("brand.write");

  return (
    <div className="go-wrap go-wrap-wide" data-testid="go-brand-page" data-tab={tab}>
      <header className="go-page-head">
        <div>
          <h1 data-testid="go-brand-title">Thương hiệu</h1>
          <p className="go-page-sub" data-testid="go-brand-sub">
            {tab === "staff"
              ? "Tài khoản nhân sự và lời mời của thương hiệu. Mỗi người một tài khoản đăng nhập riêng, chỉ làm đúng việc của vai trò."
              : canEdit
                ? "Thông tin khách thấy khi xem các phòng tập của bạn."
                : "Thông tin khách thấy khi xem các phòng tập. Chỉ chủ phòng tập sửa được."}
          </p>
        </div>
      </header>

      {tabs.length > 1 && <GoTabs tabs={tabs} value={tab} onChange={(next) => navigate(brandHref(next as BrandTabId))} idPrefix="go-brand" ariaLabel="Mục của Thương hiệu" />}
      <div role="tabpanel" id={`go-brand-panel-${tab}`} aria-labelledby={tabs.length > 1 ? `go-brand-tab-${tab}` : undefined} tabIndex={-1} className="go-tabpanel" data-tab={tab} key={tab}>
        {tab === "info" && <BrandInfoTab onDirty={(v) => (dirty.current.info = v)} />}
        {tab === "staff" && <StaffTab onDirty={(v) => (dirty.current.staff = v)} />}
      </div>

      <GoModal
        open={blocker.state === "blocked"}
        onClose={() => blocker.reset?.()}
        closeOnBackdrop={false}
        testId="go-brand-leave"
        title="Rời đi khi chưa lưu?"
        description="Bạn đã nhập thông tin chưa lưu hoặc chưa gửi. Sang trang hoặc mục khác sẽ làm mất những gì đã nhập."
        footer={
          <>
            <button type="button" className="go-btn" onClick={() => blocker.reset?.()}>Ở lại</button>
            <button
              type="button"
              className="go-btn"
              data-variant="danger"
              data-testid="go-brand-leave-go"
              onClick={() => {
                dirty.current = { info: false, staff: false };
                blocker.proceed?.();
              }}
            >
              Rời đi
            </button>
          </>
        }
      />
    </div>
  );
}
