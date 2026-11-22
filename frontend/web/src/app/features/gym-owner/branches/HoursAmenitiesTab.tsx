/**
 * Tab "Giờ & tiện ích" of the branch detail (batch G2): the opening-hours editor, the amenities section and the photos section
 * of the legacy GymManagePage settings panel, in three accordions (21). Same components, same endpoints, same behaviour:
 *   - hours: StepOpeningHours -> gymService.setGymHours on every change (saved at once, as before). MANAGER reads them only
 *     (GET hours is `branch.view`, PUT is owner-only);
 *   - amenities / photos of a DRAFT branch: read-back + "Tiếp tục thiết lập" (wizard) / StepPhotos;
 *   - amenities / photos of a branch that has left DRAFT belong to the public listing: edited in the Tin đăng tab through a
 *     reviewed revision (the photo disk routes answer 410 and are NOT restored, a direct write answers 409 LISTING_REVIEW_REQUIRED).
 */
import { useQuery } from "@tanstack/react-query";
import { gymService } from "../../../services/api";
import type { Gym, GymOperatingHoursDay } from "../../../types";
import { branchAvailability, normalizeBranchSelection } from "../../../utils/gymListing";
import { hoursLabel, normalizeHours, WEEKDAY_LABEL_VI } from "../../../utils/gymHours";
import { AmenityChipGroups } from "../../../components/listing/AmenityEditor";
import { StepOpeningHours } from "../../../components/gym/AddBranchWizard/StepOpeningHours";
import { StepPhotos } from "../../../components/gym/AddBranchWizard/StepPhotos";
import { GoAccordion } from "../../../components/layout/gym-owner/GoAccordion";
import { GoLink } from "../../../components/layout/gym-owner/GoLink";
import { wizardHref, type TabAccess } from "./branchesModel";
import { useSetHours } from "./useBranchMutations";

const ALL_WEEK_DAYS = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"] as const;
function defaultHours(gymId: string): GymOperatingHoursDay[] {
  return ALL_WEEK_DAYS.map((day) => ({ id: null, gymId, day, type: "CLOSED", openMinute: null, closeMinute: null }));
}

/** Listing Management D2: description, amenities and photos of a branch that has left DRAFT are edited in the Tin đăng tab. */
function ListingManagedNote({ gym, canEdit, what }: { gym: Gym; canEdit: boolean; what: string }) {
  const a = branchAvailability(gym);
  return (
    <div data-testid="gym-listing-managed-notice" className="go-note">
      <span>
        {what} của chi nhánh đã duyệt được sửa trong tab <strong>Tin đăng</strong> và gửi duyệt trước khi hiển thị với khách.
      </span>
      {canEdit && a.editable ? (
        <GoLink to={`/gym-owner/gyms/${gym.id}?tab=listing`} className="go-btn go-btn-sm" data-variant="primary">Sửa ở tab Tin đăng</GoLink>
      ) : (
        <span className="go-muted-text">{!canEdit ? "Chỉ chủ phòng tập mới sửa được mục này." : a.reason}</span>
      )}
    </div>
  );
}

export function HoursAmenitiesTab({ gym, access }: { gym: Gym; access: TabAccess }) {
  const id = gym.id;
  const canEdit = access === "edit";
  const { data: hours, isLoading, isError, refetch } = useQuery<GymOperatingHoursDay[]>({
    queryKey: ["owned-gym-hours", id],
    queryFn: () => gymService.getGymHours(id),
  });
  const setHours = useSetHours(id);
  const isDraft = gym.status === "DRAFT";

  return (
    <div className="go-card go-card-flush" data-testid="go-branch-hours">
      <GoAccordion title="Giờ mở cửa hằng tuần" defaultOpen testId="go-acc-hours" meta={canEdit ? "Lưu ngay khi đổi" : "Chỉ xem"}>
        {isLoading && <p className="go-empty-line">Đang tải giờ hoạt động</p>}
        {isError && !hours && (
          <div className="go-notice" data-tone="risk" role="alert">
            <span>Không tải được giờ hoạt động.</span>
            <button type="button" className="go-btn go-btn-sm" onClick={() => void refetch()}>Thử lại</button>
          </div>
        )}
        {!isLoading && !(isError && !hours) &&
          (canEdit ? (
            <StepOpeningHours value={hours ?? defaultHours(id)} onChange={(next) => setHours.mutate(next)} />
          ) : (
            <ReadOnlyHours hours={hours} />
          ))}
      </GoAccordion>

      <GoAccordion title="Tiện ích và dịch vụ" testId="go-acc-amenities">
        {isDraft ? (
          <div className="go-note-block">
            {(() => {
              // The OWNER's read-back of the draft: its real amenity rows (custom ones included) + its pending proposals.
              const sel = normalizeBranchSelection(gym);
              const chosen = sel.amenities.filter((a) => a.status === "ACTIVE");
              return (
                <>
                  {chosen.length > 0 ? (
                    <AmenityChipGroups amenities={chosen} selectedIds={chosen.map((a) => a.id)} onToggle={() => {}} disabled />
                  ) : (
                    <p className="go-muted-text">Chưa chọn tiện ích nào.</p>
                  )}
                  {sel.proposals.length > 0 && <p className="go-muted-text">Đề xuất chờ Gymini duyệt: {sel.proposals.map((p) => p.name).join(", ")}</p>}
                </>
              );
            })()}
            <p className="go-muted-text">Chi nhánh còn ở bước nháp. Hãy chọn tiện ích trong trình thiết lập chi nhánh.</p>
            {canEdit && <GoLink to={wizardHref(gym.id)} className="go-btn go-btn-sm" data-variant="primary">Tiếp tục thiết lập</GoLink>}
          </div>
        ) : (
          <ListingManagedNote gym={gym} canEdit={canEdit} what="Tiện ích" />
        )}
      </GoAccordion>

      <GoAccordion title="Hình ảnh" testId="go-acc-photos">
        {isDraft && canEdit ? <StepPhotos gymId={id} /> : <ListingManagedNote gym={gym} canEdit={canEdit} what="Ảnh" />}
      </GoAccordion>
    </div>
  );
}

function ReadOnlyHours({ hours }: { hours: GymOperatingHoursDay[] | undefined }) {
  const days = normalizeHours(hours ?? []);
  if (days.length === 0) return <p className="go-empty-line">Chưa có giờ hoạt động.</p>;
  return (
    <dl className="go-dl go-dl-tight" data-testid="go-hours-readonly">
      {days.map((d) => (
        <div key={d.day}>
          <dt>{WEEKDAY_LABEL_VI[d.day]}</dt>
          <dd>{hoursLabel(d)}</dd>
        </div>
      ))}
    </dl>
  );
}
