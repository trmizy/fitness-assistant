/**
 * `/gym-owner/listings` with the flag on (batch G2). The listing editor now lives in the branch detail, tab "Tin đăng":
 *   - `?gymId=X` (every old deep link, notification links, the "Sửa ở Tin đăng" shortcuts) redirects to `/gym-owner/gyms/X?tab=listing`;
 *   - a partner with a single branch goes straight there as well;
 *   - otherwise the page lists the branches to choose from, with the same availability sentences as the legacy picker.
 * Nothing is lost: the tab embeds the legacy editor itself.
 */
import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router";
import { GoTag } from "../../../components/layout/gym-owner/GoTag";
import { GoLink } from "../../../components/layout/gym-owner/GoLink";
import { branchAvailability } from "../../../utils/gymListing";
import { useGymOwnerScope } from "../scope/GymOwnerScopeProvider";
import { ALL_BRANCHES, branchCodes } from "../scope/scopeModel";
import { addressLine, approvalTag, branchHref, listingsRedirectTarget, operationalTag } from "./branchesModel";

export function ListingsEntryPage() {
  const scope = useGymOwnerScope();
  const { search } = useLocation();
  const navigate = useNavigate();
  const target = listingsRedirectTarget(search, scope.gymId === ALL_BRANCHES ? null : scope.gymId);
  useEffect(() => {
    if (target) navigate(target, { replace: true });
  }, [target, navigate]);
  const codes = branchCodes(scope.gyms);

  if (target) return <div className="go-wrap" aria-busy="true" data-testid="go-listings-redirect" />;

  return (
    <div className="go-wrap" data-testid="go-listings-picker">
      <header className="go-page-head">
        <div>
          <h1>Tin đăng và tiện ích</h1>
          <p className="go-page-sub">Chọn chi nhánh để sửa giới thiệu, tiện ích và ảnh khách thấy. Thay đổi cần gửi duyệt.</p>
        </div>
      </header>
      <section className="go-panel" aria-label="Chọn chi nhánh">
        {scope.gyms.length === 0 ? (
          <div className="go-task-empty">
            <strong>Chưa có chi nhánh nào</strong>
            <span>Tạo chi nhánh trước, sau khi được duyệt bạn sẽ quản lý tin đăng tại đây.</span>
          </div>
        ) : (
          <ul className="go-pick-list">
            {scope.gyms.map((g) => {
              const a = branchAvailability(g);
              const ap = approvalTag(g.status);
              const op = operationalTag(g);
              return (
                <li key={g.id} className="go-pick-row" data-testid="go-listings-pick-row" data-editable={a.editable ? "true" : "false"}>
                  <span className="go-code-chip" aria-hidden="true">{codes[g.id]}</span>
                  <div className="go-pick-main">
                    <p className="go-pick-name">{g.name}</p>
                    <p className="go-pick-addr">{addressLine(g)}</p>
                    {!a.editable && <p className="go-pick-reason">{a.reason}</p>}
                  </div>
                  <span className="go-pick-tags"><GoTag tone={ap.tone} text={ap.text} />{a.editable ? <GoTag tone={op.tone} text={op.text} /> : null}</span>
                  <GoLink to={a.editable ? branchHref(g.id, "listing") : branchHref(g.id)} className="go-btn go-btn-sm" data-variant={a.editable ? "primary" : undefined}>
                    {a.editable ? "Sửa tin đăng" : "Mở chi nhánh"}
                  </GoLink>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
