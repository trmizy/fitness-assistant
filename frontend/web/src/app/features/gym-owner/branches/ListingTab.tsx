/**
 * Tab "Tin đăng" of the branch detail (batch G2): the listing revision editor of the legacy GymListingsPage, embedded for THIS
 * branch. `GymListingEditor` is the legacy component itself (exported, not copied): draft -> preview -> submit for review, the
 * `expectedDraftVersion` concurrency rules, photo upload through the reviewed-revision routes, and its own `useBlocker` that
 * asks before leaving with unsaved edits (a tab switch, another branch in the scope strip, any navigation).
 * A branch that has no listing to revise yet says why (the same sentences as the legacy branch picker).
 */
import { ArrowsClockwiseIcon } from "@phosphor-icons/react";
import { useApp } from "../../../context/AppContext";
import type { Gym } from "../../../types";
import { branchAvailability } from "../../../utils/gymListing";
import { GoLink } from "../../../components/layout/gym-owner/GoLink";
import { GymListingEditor } from "../../../pages/gym-owner/GymListingsPage";
import { wizardHref } from "./branchesModel";

export function ListingTab({ gym, onDirtyChange }: { gym: Gym; onDirtyChange: (dirty: boolean) => void }) {
  const { user } = useApp();
  const uid = user?.id ?? "guest";
  const a = branchAvailability(gym);

  if (!a.editable) {
    return (
      <section className="go-card" data-testid="go-listing-unavailable">
        <div className="go-card-head"><h2>Tin đăng chưa sửa được</h2></div>
        <p className="go-card-note" role="status">{a.reason}</p>
        {gym.status === "DRAFT" && (
          <div className="go-form-actions go-pad">
            <GoLink to={wizardHref(gym.id)} className="go-btn go-btn-sm" data-variant="primary">Tiếp tục thiết lập</GoLink>
          </div>
        )}
      </section>
    );
  }

  return (
    <div className="go-listing" data-testid="go-branch-listing">
      <p className="go-listing-lead">
        <ArrowsClockwiseIcon aria-hidden="true" width={16} height={16} />
        Nội dung khách thấy khi xem chi nhánh: giới thiệu, tiện ích và ảnh. Thay đổi cần gửi duyệt.
      </p>
      <GymListingEditor key={`${uid}:${gym.id}`} gymId={gym.id} uid={uid} onDirtyChange={onDirtyChange} />
    </div>
  );
}
