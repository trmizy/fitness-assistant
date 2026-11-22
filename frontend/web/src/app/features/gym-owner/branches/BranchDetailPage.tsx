/**
 * Branch detail (batch G2), `/gym-owner/gyms/:id`, behind VITE_GYM_OWNER_V2 (routes.tsx). One header (code chip, name, approval +
 * operational tags, address, standing notices) and five tabs (16 tabs-sliding, URL `?tab=`): Tổng quan, Giờ & tiện ích, Tin đăng,
 * Xác minh, Trạng thái. `?settings=1` (profile shortcut) opens Tổng quan already in edit mode.
 *
 * Each tab reuses the existing form / component / service of the legacy GymManagePage, GymListingsPage and wizard steps; see
 * the tab files. Which tabs a role gets, and which are read-only or locked with a reason, comes from `branchTabsFor` (branchesModel).
 * The scope strip follows the branch of the PATH (GymOwnerScopeProvider), so switching branch there keeps the tab.
 */
import { useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { CaretLeftIcon, WarningIcon as AlertTriangle } from "@phosphor-icons/react";
import { gymService } from "../../../services/api";
import type { Gym, GymReviewsResponse } from "../../../types";
import { Stars } from "../../../components/gym/Stars";
import { GoTag } from "../../../components/layout/gym-owner/GoTag";
import { GoLink } from "../../../components/layout/gym-owner/GoLink";
import { GoTabs } from "../../../components/layout/gym-owner/GoTabs";
import { ScopeStateFrame } from "../scope/PermissionGate";
import { useGymOwnerScope } from "../scope/GymOwnerScopeProvider";
import { branchCode, branchCodes, classifyApiError } from "../scope/scopeModel";
import { formatViDate } from "../../../utils/branchCheckinState";
import { addressLine, approvalTag, branchTabsFor, operationalTag, resolveBranchTab, settingsRequested, tabSearch, type BranchTabId } from "./branchesModel";
import { OverviewTab } from "./OverviewTab";
import { HoursAmenitiesTab } from "./HoursAmenitiesTab";
import { ListingTab } from "./ListingTab";
import { VerificationTab } from "./VerificationTab";
import { StatusTab } from "./StatusTab";

export function BranchDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const scope = useGymOwnerScope();
  const role = scope.role;
  const [params] = useSearchParams();
  const [listingDirty, setListingDirty] = useState(false);

  const gymQuery = useQuery<Gym>({ queryKey: ["owned-gym", id], queryFn: () => gymService.getOwnedGym(id!), enabled: !!id });
  const gym = gymQuery.data;

  // The public reviews endpoint 404s unless the branch is publicly visible.
  const { data: reviews } = useQuery<GymReviewsResponse>({
    queryKey: ["gym-reviews", id],
    queryFn: () => gymService.getGymReviews(id!),
    enabled: !!id && gym?.status === "APPROVED" && gym?.operationalStatus === "OPEN",
  });

  if (gymQuery.isLoading) {
    return (
      <div className="go-wrap" data-testid="go-branch-loading" aria-busy="true">
        <div className="go-skel-wrap" aria-hidden="true" style={{ padding: 0 }}>
          <div className="go-skel-bar" data-size="lg" />
          <div className="go-skel-bar" style={{ width: "60%" }} />
          <div className="go-skel-bar" data-size="block" />
        </div>
      </div>
    );
  }
  if (gymQuery.isError || !gym) {
    const kind = classifyApiError(gymQuery.error);
    if (gymQuery.isError && kind !== "not-found") {
      return <ScopeStateFrame kind={kind === "forbidden" ? "forbidden" : kind === "out-of-scope" ? "out-of-scope" : "error"} onRetry={() => void gymQuery.refetch()} />;
    }
    return (
      <div className="go-wrap">
        <div className="go-state" data-testid="go-branch-notfound">
          <h2>Không tìm thấy chi nhánh</h2>
          <p>Chi nhánh này không tồn tại hoặc không thuộc phạm vi của bạn.</p>
          <div className="go-state-actions"><GoLink to="/gym-owner/gyms" className="go-btn">Về danh sách chi nhánh</GoLink></div>
        </div>
      </div>
    );
  }

  const tabs = branchTabsFor(role).filter((t) => t.access !== "hidden");
  const tab: BranchTabId | null = resolveBranchTab(params.get("tab"), role);
  const spec = tabs.find((t) => t.id === tab);
  const codes = branchCodes(scope.gyms.some((g) => g.id === gym.id) ? scope.gyms : [...scope.gyms, gym]);
  const ap = approvalTag(gym.status);
  const op = operationalTag(gym);

  const setTab = (next: string) => {
    // `settings` is a one-shot shortcut: leaving the tab drops it. A push (not replace) keeps Back going to the previous tab.
    navigate({ search: tabSearch(next as BranchTabId) });
  };

  return (
    <div className="go-wrap" data-testid="go-branch-detail" data-gym-id={gym.id}>
      <GoLink to="/gym-owner/gyms" className="go-crumb" data-testid="go-branch-back">
        <CaretLeftIcon aria-hidden="true" width={14} height={14} /> Chi nhánh
      </GoLink>

      <header className="go-bhead">
        <div className="go-bhead-top">
          <span className="go-code-chip go-code-chip-lg" aria-hidden="true">{codes[gym.id] ?? branchCode(gym.name)}</span>
          <h1 data-testid="go-branch-title">{gym.name}</h1>
        </div>
        <div className="go-bhead-tags">
          <GoTag tone={ap.tone} text={ap.text} />
          <GoTag tone={op.tone} text={op.text} />
          {reviews && reviews.count > 0 && (
            <span className="go-bhead-rating">
              <Stars value={reviews.averageRating} /> {reviews.averageRating.toFixed(1).replace(".", ",")} ({reviews.count} đánh giá)
            </span>
          )}
        </div>
        <p className="go-bhead-addr" data-testid="go-branch-address">{addressLine(gym)}</p>

        {(gym.pendingName || gym.pendingAddress) && (
          <p data-testid="gym-pending-approval-hint" className="go-hint" data-tone="warn">
            {gym.pendingName && <>Tên mới đang chờ duyệt: <strong>{gym.pendingName}</strong>. </>}
            {gym.pendingAddress && <>Địa chỉ mới đang chờ duyệt: <strong>{gym.pendingAddress}</strong>.</>}
          </p>
        )}
        {gym.operationalStatus && gym.operationalStatus !== "OPEN" && (
          <p data-testid="gym-operational-status-badge" data-status={gym.operationalStatus} className="go-hint" data-tone="risk">
            <AlertTriangle aria-hidden="true" width={14} height={14} />
            {gym.operationalStatus === "TEMPORARILY_CLOSED" ? "Đang tạm đóng cửa" : "Đã đóng cửa vĩnh viễn"}
            {gym.closureReason ? `. Lý do: ${gym.closureReason}` : ""}
            {gym.operationalStatus === "TEMPORARILY_CLOSED" && gym.expectedReopenAt ? `. Dự kiến mở lại: ${formatViDate(gym.expectedReopenAt)}` : ""}
          </p>
        )}
        {(gym.pendingNameNote || gym.pendingAddressNote) && (
          <div className="go-note" data-tone="warn" data-testid="go-change-request">
            <AlertTriangle aria-hidden="true" width={16} height={16} />
            <div>
              <strong>Gymini yêu cầu chỉnh sửa</strong>
              {gym.pendingNameNote && <p>Tên: {gym.pendingNameNote}</p>}
              {gym.pendingAddressNote && <p>Địa chỉ: {gym.pendingAddressNote}</p>}
            </div>
          </div>
        )}
      </header>

      {tab && spec ? (
        <>
          <GoTabs
            tabs={tabs.map((t) => ({ id: t.id, label: t.label, readOnly: t.access === "read" || t.access === "locked", dirty: t.id === "listing" && listingDirty }))}
            value={tab}
            onChange={setTab}
            idPrefix="go-branch"
            ariaLabel="Mục của chi nhánh"
          />
          <div role="tabpanel" id={`go-branch-panel-${tab}`} aria-labelledby={`go-branch-tab-${tab}`} tabIndex={-1} className="go-tabpanel" data-tab={tab} key={tab}>
            {tab === "overview" && <OverviewTab gym={gym} role={role} access={spec.access} startEditing={settingsRequested(`?${params.toString()}`)} />}
            {tab === "hours" && <HoursAmenitiesTab gym={gym} access={spec.access} />}
            {tab === "listing" && <ListingTab gym={gym} onDirtyChange={setListingDirty} />}
            {tab === "verification" && <VerificationTab gym={gym} access={spec.access} reason={spec.reason} />}
            {tab === "status" && <StatusTab gym={gym} role={role} />}
          </div>
        </>
      ) : (
        <p className="go-card-note" role="status">Bạn không có quyền xem các mục của chi nhánh này.</p>
      )}
    </div>
  );
}
