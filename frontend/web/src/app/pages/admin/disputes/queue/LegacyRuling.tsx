import { useState } from "react";
import { useLocation } from "react-router";
import { toast } from "sonner";
import { adminService } from "../../../../services/api";
import { Button } from "../../../../components/ui/button";
import { useRestoreFocus } from "../../shared/b9aReturnFocus";
import { MoneyActionDialog } from "../../shared/MoneyActionDialog";
import { parseDisputeError } from "../disputeCaseErrors";
import { formatDateTime } from "../workspace/format";
import { DisputeLink, FOCUS, Notice, QUEUE_PATH } from "../workspace/WorkspaceParts";
import {
  LEGACY_BUTTON_LABEL,
  LEGACY_DIALOG_TITLE,
  LEGACY_DISCLOSURE_LABEL,
  LEGACY_NOTICE,
  LEGACY_RESOLUTIONS,
  LEGACY_WARNING,
  legacyEffects,
  toDialogError,
  type LegacyResolution,
  type SessionRowModel,
} from "./queueModel";

/**
 * C3 - the pre-case ruling, kept (Ngài's pending recommendation R-06) but demoted: one secondary disclosure per session, a warning,
 * and a confirmation with a required note. SAME endpoint and body as before (`POST /admin/sessions/:id/resolve {resolution, note}`).
 * It does not read the case and needs one admin only; the page says so. Nothing here computes or sends an amount.
 */
/** `onDone` re-reads the session list (after a success, or when the dialog asks to reload a stale state). */
export function LegacyRuling({ session, onDone }: { session: SessionRowModel; onDone: () => void }) {
  const [resolution, setResolution] = useState<LegacyResolution | null>(null);
  const [note, setNote] = useState("");
  const [caseExistsId, setCaseExistsId] = useState<string | null>(null);
  const location = useLocation();
  // the dialog has no Trigger, so Radix would drop focus on <body> after Esc: give it back to the button that opened it
  useRestoreFocus(resolution !== null);

  async function confirm() {
    if (!resolution) return;
    try {
      await adminService.resolveSessionDispute(session.id, resolution, note.trim());
    } catch (e) {
      const view = parseDisputeError(e, { action: "write" });
      if (view.code === "CASE_EXISTS" && typeof view.details?.caseId === "string") setCaseExistsId(view.details.caseId);
      throw toDialogError(e);
    }
    toast.success("Đã phân xử khiếu nại");
    setNote("");
    onDone();
  }

  return (
    <details className="rounded-lg border border-adm-border-soft" data-testid="d2-legacy-ruling">
      <summary className="flex min-h-11 cursor-pointer items-center px-3 text-sm font-medium text-adm-text-2 xl:min-h-9">{LEGACY_DISCLOSURE_LABEL}</summary>
      <div className="space-y-3 border-t border-adm-border-soft p-3">
        <Notice tone="warning" testId="d2-legacy-warning">
          {LEGACY_WARNING}
        </Notice>
        {caseExistsId && <DisputeLink to={`${QUEUE_PATH}/${encodeURIComponent(caseExistsId)}`} state={{ queueSearch: location.search }} className={`inline-flex min-h-11 items-center rounded-md border border-adm-border px-3 text-sm text-adm-text ${FOCUS}`}>Xem hồ sơ đã có</DisputeLink>}
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {LEGACY_RESOLUTIONS.map((r) => (
            <Button
              key={r}
              type="button"
              variant="outline"
              onClick={() => {
                setNote("");
                setResolution(r);
              }}
              className="min-h-11 xl:min-h-9"
              data-testid={`d2-legacy-${r}`}
            >
              {LEGACY_BUTTON_LABEL[r]}
            </Button>
          ))}
        </div>
      </div>

      <MoneyActionDialog
        open={resolution !== null}
        onOpenChange={(open) => {
          if (!open) setResolution(null);
        }}
        testId="d2-legacy-dialog"
        title={resolution ? LEGACY_DIALOG_TITLE[resolution] : "Kết luận"}
        description="Ghi rõ căn cứ phân xử rồi xác nhận. Đây là đường cũ, một người duyệt."
        parties={[
          { label: "Buổi tập lúc", value: formatDateTime(session.scheduledStartAt) },
          { label: "Hợp đồng", value: session.packageName ?? "Chưa có tên gói" },
        ]}
        effects={resolution ? legacyEffects(resolution) : []}
        notice={LEGACY_NOTICE}
        confirmLabel="Xác nhận kết luận"
        pendingLabel="Đang ghi kết luận…"
        confirmDisabled={!note.trim()}
        onConfirm={confirm}
        onReload={onDone}
      >
        <div>
          <label htmlFor={`d2-legacy-note-${session.id}`} className="mb-1 block text-xs font-semibold text-muted-foreground">
            Căn cứ phân xử (bắt buộc)
          </label>
          <textarea
            id={`d2-legacy-note-${session.id}`}
            data-testid="d2-legacy-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder="Ghi rõ căn cứ phân xử…"
            className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] px-3 py-2 text-sm text-[var(--text-color)]"
          />
        </div>
      </MoneyActionDialog>
    </details>
  );
}
