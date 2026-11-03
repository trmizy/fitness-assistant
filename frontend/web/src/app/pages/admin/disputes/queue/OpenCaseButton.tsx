import { useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CircleNotchIcon } from "@phosphor-icons/react";
import { Button } from "../../../../components/ui/button";
import { disputeCaseApi } from "../disputeCaseApi";
import { parseDisputeError, type DisputeErrorView } from "../disputeCaseErrors";
import { useDisputeQueryKeys } from "../disputeQueryKeys";
import { useIdempotentAction } from "../useIdempotentAction";
import type { OpenCaseResult } from "../disputeCaseTypes";
import { parseCaseIdParam } from "../workspace/workspaceModel";
import { DisputeLink, FOCUS, QUEUE_PATH } from "../workspace/WorkspaceParts";
import { readOpenCaseResult } from "./queueModel";

/**
 * A1. The session is CHOSEN from the list (no typed id). One idempotency key per mounted button, kept across retries of the same body:
 * a double click sends one request, a retry after an unknown outcome replays instead of duplicating.
 * `created:false` (the session already has an open case) is NOT an error: the admin simply lands in that case.
 */
export function OpenCaseButton({ sessionId, onRefreshList }: { sessionId: string; onRefreshList: () => void }) {
  const action = useIdempotentAction<{ sessionId: string }, OpenCaseResult>();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { keys } = useDisputeQueryKeys();
  const [error, setError] = useState<DisputeErrorView | null>(null);

  async function open() {
    setError(null);
    const out = await action.run({ sessionId }, (key, body) => disputeCaseApi.openCase(body.sessionId, key));
    if (out.status === "busy") return;
    if (out.status === "error") {
      setError(parseDisputeError(out.error, { action: "write" }));
      return;
    }
    const result = readOpenCaseResult(out.value);
    if (!result) {
      setError(parseDisputeError({ response: { status: 500, data: {} } }, { action: "write" }));
      return;
    }
    if (keys) void queryClient.invalidateQueries({ queryKey: [...keys.all, "list"] });
    if (!result.created) toast.info("Buổi này đã có hồ sơ đang mở. Đã đưa bạn vào hồ sơ đó.");
    navigate(`${QUEUE_PATH}/${encodeURIComponent(result.caseId)}`, { state: { queueSearch: location.search } });
  }

  const pendingCaseId = error?.code === "CASE_DECISION_PENDING_EXECUTION" ? parseCaseIdParam(typeof error.details?.caseId === "string" ? error.details.caseId : null) : null;
  const staleList = error?.code === "SESSION_NOT_DISPUTED";

  return (
    <div className="space-y-2" data-testid="d2-open-case">
      <Button type="button" onClick={open} disabled={action.pending} aria-busy={action.pending} className="min-h-11 w-full bg-st-success text-adm-bg hover:bg-st-success hover:opacity-90 sm:w-auto xl:min-h-9" data-testid="d2-open-case-btn">
        {action.pending && <CircleNotchIcon className="size-4 animate-spin" aria-hidden />}
        {action.pending ? "Đang mở hồ sơ…" : error?.outcomeUnknown ? "Mở hồ sơ (thử lại)" : "Mở hồ sơ"}
      </Button>
      {error && (
        <div role="alert" data-testid="d2-open-case-error" data-error-code={error.code ?? ""} className="rounded-lg border border-st-danger-border bg-st-danger-bg px-3 py-2.5 text-sm text-st-danger">
          <p>{error.message}</p>
          {error.outcomeUnknown && <p className="mt-1 text-adm-text">Bấm «Mở hồ sơ» lần nữa để kiểm tra: hệ thống không tạo hồ sơ trùng.</p>}
          {pendingCaseId && (
            <DisputeLink
              to={`${QUEUE_PATH}/${encodeURIComponent(pendingCaseId)}`}
              state={{ queueSearch: location.search }}
              data-testid="d2-open-case-pending-link"
              className={`mt-2 inline-flex min-h-11 items-center rounded-md border border-adm-border bg-adm-surface px-3 text-sm font-medium text-adm-text hover:bg-adm-surface-2 xl:min-h-8 ${FOCUS}`}
            >
              Xem hồ sơ đã duyệt
            </DisputeLink>
          )}
          {staleList && (
            <Button type="button" variant="outline" size="sm" onClick={onRefreshList} className="mt-2 min-h-11 xl:min-h-8" data-testid="d2-open-case-refresh">
              Làm mới danh sách
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
