import { useRef } from "react";
import { AmenityEditor } from "../../listing/AmenityEditor";
import { useProposalFlow } from "../../listing/useProposalFlow";
import {
  applyProposeOutcome,
  toggleId,
  type CatalogAmenity,
  type OwnerProposal,
} from "../../../utils/gymListing";

// Kept for the files that still show the legacy `facilities` mirror (BranchReviewDetail, admin gym views).
export { FACILITY_LABEL } from "../../../utils/facilityLabels";

export interface AmenitySelectionState {
  amenityIds: string[];
  /** The owner's own PENDING proposals that stay on this branch. */
  proposalIds: string[];
}

/**
 * Step 4 "Tiện ích & Dịch vụ" of the add-branch wizard. The amenity CATALOGUE replaces the old fixed 18-value list: pick from the
 * catalogue (grouped by Cơ sở vật chất / Khu tập luyện / Dịch vụ / Phục hồi) or propose a new one for Gymini to approve.
 * The page owns the selection and saves it with the draft PATCH (amenityIds + proposalIds); at least one is required to submit.
 */
export function StepFacilities({
  gymId,
  catalog,
  proposals,
  loading,
  error,
  onRetry,
  value,
  onChange,
  onRefresh,
  saving,
}: {
  gymId: string;
  catalog: CatalogAmenity[];
  /** This branch's proposals (any status). */
  proposals: OwnerProposal[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  value: AmenitySelectionState;
  onChange: (next: AmenitySelectionState) => void;
  onRefresh: () => void;
  saving?: boolean;
}) {
  // The proposal calls are async: read the LATEST selection when they finish, not the one of the render that started them.
  const latest = useRef(value);
  latest.current = value;
  const flow = useProposalFlow({
    gymId,
    onOutcome: (o) => onChange(applyProposeOutcome(latest.current, o)),
    onCancelled: (p) => onChange({ ...latest.current, proposalIds: latest.current.proposalIds.filter((x) => x !== p.id) }),
    onRefresh,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-zinc-100">Tiện ích & Dịch vụ</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Chọn những tiện ích chi nhánh này thực sự có — khách sẽ thấy danh sách này khi tìm phòng gym. Cần chọn ít nhất một tiện ích để gửi duyệt.
        </p>
      </div>

      <AmenityEditor
        amenities={catalog.filter((a) => a.status === "ACTIVE")}
        selectedIds={value.amenityIds}
        onToggle={(id) => onChange({ ...value, amenityIds: toggleId(value.amenityIds, id) })}
        proposals={proposals}
        attachedProposalIds={value.proposalIds}
        onProposeClick={flow.openCreate}
        onEditProposal={flow.openEdit}
        onCancelProposal={flow.askCancel}
        busy={flow.busy}
        loading={loading}
        error={error}
        onRetry={onRetry}
      />
      {saving && <p className="text-[11px] text-zinc-600">Đang lưu lựa chọn…</p>}
      {flow.dialogs}
    </div>
  );
}
