import { useLocation } from "react-router";
import { ArrowRightIcon } from "@phosphor-icons/react";
import { caseStatusLabel, caseStatusText } from "../disputeCaseLabels";
import type { DisputeCaseSummary } from "../disputeCaseTypes";
import { formatAge } from "../../withdrawals/withdrawalQueue";
import { statusTone } from "../workspace/workspaceModel";
import { CARD, DisputeLink, FOCUS, Pill, QUEUE_PATH } from "../workspace/WorkspaceParts";
import { investigatorText, isProvisionalType, typeColumnText } from "./queueModel";

/** Same template for the header row and the data rows (table from xl, card below). */
const GRID = "xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1.1fr)_minmax(0,1.2fr)_minmax(0,140px)_minmax(0,130px)]";
const CELL_LABEL = "text-[11px] font-medium text-adm-text-2 xl:hidden";

export function CaseList({ items, currentUserId, now }: { items: Array<Partial<DisputeCaseSummary> & { id: string; status: string }>; currentUserId: string | null; now: number }) {
  const location = useLocation();
  return (
    <div role="table" aria-label="Hồ sơ khiếu nại buổi tập" data-testid="d2-case-list" className={`${CARD} overflow-hidden`}>
      <div role="row" className={`hidden gap-x-4 border-b border-adm-border bg-adm-surface-2 px-4 py-2.5 text-xs font-semibold text-adm-text-2 xl:grid ${GRID}`}>
        <div role="columnheader">Loại khiếu nại</div>
        <div role="columnheader">Trạng thái</div>
        <div role="columnheader">Người phụ trách</div>
        <div role="columnheader">Đã mở</div>
        <div role="columnheader" className="text-right">
          Thao tác
        </div>
      </div>
      <div role="rowgroup">
        {items.map((c) => (
          <div
            key={c.id}
            role="row"
            data-testid="d2-case-row"
            data-case-status={c.status}
            className={`grid grid-cols-1 gap-x-4 gap-y-2 border-t border-adm-border-soft px-4 py-3 text-sm first:border-t-0 xl:items-center ${GRID}`}
          >
            <div role="cell" className="min-w-0">
              <p className={CELL_LABEL}>Loại khiếu nại</p>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-medium text-adm-text">{typeColumnText(c.type ?? "")}</span>
                {isProvisionalType(c.type ?? "") && (
                  <span data-testid="d2-provisional-chip">
                    <Pill tone="warning">Phân loại tạm</Pill>
                  </span>
                )}
              </div>
              <p className="mt-1 text-xs text-adm-text-2">{c.clientName ?? "Khách chưa có tên hiển thị"} · {c.ptName ?? "PT chưa có tên hiển thị"}</p>
            </div>
            <div role="cell">
              <p className={CELL_LABEL}>Trạng thái</p>
              <Pill tone={statusTone(c.status)}>{caseStatusText(c)}</Pill>
            </div>
            <div role="cell" className="min-w-0">
              <p className={CELL_LABEL}>Người phụ trách</p>
              <p className={`break-words ${c.investigatorId ? "text-adm-text" : "text-adm-text-2"}`} data-testid="d2-investigator">
                {c.investigatorId === currentUserId ? "Bạn phụ trách" : c.investigatorId ? (c.investigatorName ?? "Người phụ trách chưa có tên hiển thị") : investigatorText(null, currentUserId)}
              </p>
            </div>
            <div role="cell">
              <p className={CELL_LABEL}>Đã mở</p>
              <p className="tabular-nums text-adm-text">{c.createdAt ? `${formatAge(c.createdAt, now)} trước` : "—"}</p>
            </div>
            <div role="cell" className="xl:text-right">
              <DisputeLink
                to={`${QUEUE_PATH}/${encodeURIComponent(c.id)}`}
                state={{ queueSearch: location.search }}
                data-testid="d2-case-open"
                aria-label={`Mở hồ sơ: ${typeColumnText(c.type ?? "")}, ${caseStatusLabel(c.status)}`}
                className={`inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-md border border-adm-border bg-adm-surface px-3 text-sm font-medium text-adm-text hover:bg-adm-surface-2 xl:min-h-8 xl:w-auto ${FOCUS}`}
              >
                Mở hồ sơ <ArrowRightIcon className="size-4" aria-hidden />
              </DisputeLink>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
