import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { ownerAmenityService } from "../../services/gymListingApi";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { ProposeAmenityDialog } from "./AmenityEditor";
import {
  gymListingErrorMessage,
  interpretProposeResponse,
  proposeOutcomeMessage,
  type DisabledAmenityNotice,
  type OwnerProposal,
  type ProposeOutcome,
} from "../../utils/gymListing";

/**
 * The proposal calls of the amenity block, shared by the listing page and the add-branch wizard (plan §12.3):
 * propose (matched → select it; new / REENABLE / already-mine → a proposal), edit and cancel the owner's own PENDING proposal,
 * "Đề xuất bật lại". The parent decides what an outcome means for ITS selection (`onOutcome`, `onCancelled`) and how to refresh.
 */
export function useProposalFlow({
  gymId,
  onOutcome,
  onCancelled,
  onRefresh,
}: {
  gymId: string;
  onOutcome: (o: ProposeOutcome) => void | Promise<void>;
  onCancelled: (p: OwnerProposal) => void | Promise<void>;
  onRefresh: () => void;
}): {
  busy: boolean;
  openCreate: () => void;
  openEdit: (p: OwnerProposal) => void;
  askCancel: (p: OwnerProposal) => void;
  reenable: (n: DisabledAmenityNotice) => Promise<void>;
  dialogs: ReactNode;
} {
  const [dialog, setDialog] = useState<{ mode: "create" } | { mode: "edit"; proposal: OwnerProposal } | null>(null);
  const [cancelTarget, setCancelTarget] = useState<OwnerProposal | null>(null);
  const [pending, setPending] = useState(false);

  async function send(v: { name: string; suggestedCategory: OwnerProposal["suggestedCategory"]; note?: string }): Promise<boolean> {
    setPending(true);
    try {
      const res = await ownerAmenityService.propose({ gymId, name: v.name, suggestedCategory: v.suggestedCategory, ...(v.note ? { note: v.note } : {}) });
      const outcome = interpretProposeResponse(res);
      if (!outcome) throw new Error("Phản hồi không hợp lệ");
      await onOutcome(outcome);
      toast.success(proposeOutcomeMessage(outcome));
      onRefresh();
      return true;
    } catch (e) {
      toast.error(gymListingErrorMessage(e, "Không gửi được đề xuất"));
      onRefresh();
      return false;
    } finally {
      setPending(false);
    }
  }

  async function submitDialog(v: { name: string; suggestedCategory: OwnerProposal["suggestedCategory"]; note: string }) {
    if (dialog?.mode === "edit") {
      const p = dialog.proposal;
      setPending(true);
      try {
        await ownerAmenityService.updateProposal(p.id, { name: v.name, suggestedCategory: v.suggestedCategory, note: v.note || null });
        toast.success("Đã cập nhật đề xuất");
        setDialog(null);
      } catch (e) {
        toast.error(gymListingErrorMessage(e, "Không sửa được đề xuất"));
      } finally {
        setPending(false);
        onRefresh();
      }
      return;
    }
    if (await send(v)) setDialog(null);
  }

  async function doCancel(p: OwnerProposal) {
    setPending(true);
    try {
      await ownerAmenityService.cancelProposal(p.id);
      await onCancelled(p);
      toast.success("Đã huỷ đề xuất");
    } catch (e) {
      toast.error(gymListingErrorMessage(e, "Không huỷ được đề xuất"));
    } finally {
      setPending(false);
      onRefresh();
    }
  }

  const dialogs = (
    <>
      <ProposeAmenityDialog
        open={dialog !== null}
        onOpenChange={(o) => !o && setDialog(null)}
        title={dialog?.mode === "edit" ? "Sửa đề xuất tiện ích" : "Đề xuất tiện ích mới"}
        submitLabel={dialog?.mode === "edit" ? "Lưu đề xuất" : "Gửi đề xuất"}
        initial={dialog?.mode === "edit" ? { name: dialog.proposal.name, suggestedCategory: dialog.proposal.suggestedCategory, note: dialog.proposal.note ?? "" } : undefined}
        pending={pending}
        onSubmit={submitDialog}
      />
      <ConfirmDialog
        open={cancelTarget !== null}
        onOpenChange={(o) => !o && setCancelTarget(null)}
        title="Huỷ đề xuất?"
        description={cancelTarget ? `Đề xuất "${cancelTarget.name}" sẽ bị huỷ và bỏ khỏi bản nháp.` : undefined}
        confirmLabel="Huỷ đề xuất"
        onConfirm={async () => {
          const p = cancelTarget;
          setCancelTarget(null);
          if (p) await doCancel(p);
        }}
      />
    </>
  );

  return {
    busy: pending,
    openCreate: () => setDialog({ mode: "create" }),
    openEdit: (p) => setDialog({ mode: "edit", proposal: p }),
    askCancel: (p) => setCancelTarget(p),
    reenable: async (n) => {
      await send({ name: n.name, suggestedCategory: n.category });
    },
    dialogs,
  };
}
