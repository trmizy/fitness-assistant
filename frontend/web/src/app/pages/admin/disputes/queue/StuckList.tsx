import { ArrowRightIcon } from "@phosphor-icons/react";
import type { StuckItem } from "../disputeCaseTypes";
import { CARD, DisputeLink, EmptyBox, FOCUS, Pill } from "../workspace/WorkspaceParts";
import { formatDateTime, shortRef } from "../workspace/format";
import { eventLabel } from "../workspace/workspaceModel";
import { stuckKindLabel, stuckKindTone } from "./queueModel";

const GRID = "xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1.1fr)_minmax(0,1.2fr)_minmax(0,1.2fr)_minmax(0,110px)_minmax(0,120px)]";
const CELL_LABEL = "text-[11px] font-medium text-adm-text-2 xl:hidden";

interface StuckListProps {
  items: StuckItem[];
}

export function StuckList({ items }: StuckListProps) {
  if (items.length === 0) {
    return (
      <EmptyBox testId="d2-stuck-empty">
        Không có hồ sơ nào đang bị tắc quy trình hoặc cần người xử lý.
      </EmptyBox>
    );
  }

  return (
    <div
      role="table"
      aria-label="Danh sách hồ sơ cần người xử lý"
      data-testid="d2-stuck-list"
      className={`${CARD} overflow-hidden`}
    >
      <div
        role="row"
        className={`hidden gap-x-4 border-b border-adm-border bg-adm-surface-2 px-4 py-2.5 text-xs font-semibold text-adm-text-2 xl:grid ${GRID}`}
      >
        <div role="columnheader">Hồ sơ / Buổi tập</div>
        <div role="columnheader">Loại tắc</div>
        <div role="columnheader">Người phụ trách</div>
        <div role="columnheader">Nhật ký gần nhất</div>
        <div role="columnheader">Thời gian kẹt</div>
        <div role="columnheader" className="text-right">
          Thao tác
        </div>
      </div>
      <div role="rowgroup">
        {items.map((item) => {
          const owner = item.ownerName ?? (item.ownerId ? `Mã ${shortRef(item.ownerId)}` : "Chưa giao");
          return (
            <div
              key={item.caseId}
              role="row"
              data-testid={`d2-stuck-row-${item.caseId}`}
              className={`grid grid-cols-1 gap-x-4 gap-y-2 border-t border-adm-border-soft px-4 py-3 text-sm first:border-t-0 xl:items-center ${GRID}`}
            >
              <div role="cell" className="min-w-0">
                <p className={CELL_LABEL}>Hồ sơ / Buổi tập</p>
                <div className="font-medium text-adm-text">
                  <DisputeLink
                    to={`/admin/disputes/${item.caseId}`}
                    className={`font-semibold underline-offset-2 hover:underline ${FOCUS}`}
                  >
                    Hồ sơ #{shortRef(item.caseId)}
                  </DisputeLink>
                </div>
                <p className="mt-0.5 text-xs text-adm-text-2">
                  Buổi tập #{shortRef(item.sessionId)}
                </p>
              </div>

              <div role="cell">
                <p className={CELL_LABEL}>Loại tắc</p>
                <Pill tone={stuckKindTone(item.kind)}>
                  {stuckKindLabel(item.kind)}
                </Pill>
              </div>

              <div role="cell">
                <p className={CELL_LABEL}>Người phụ trách</p>
                <span className="text-xs text-adm-text">{owner}</span>
              </div>

              <div role="cell" className="min-w-0">
                <p className={CELL_LABEL}>Nhật ký gần nhất</p>
                {item.lastAudit ? (
                  <p className="text-xs text-adm-text-2">
                    <span className="text-adm-text">{eventLabel(item.lastAudit.action)}</span>
                    <br />
                    <span>{formatDateTime(item.lastAudit.at)}</span>
                  </p>
                ) : (
                  <span className="text-xs text-adm-text-2">—</span>
                )}
              </div>

              <div role="cell">
                <p className={CELL_LABEL}>Thời gian kẹt</p>
                <span className="text-xs font-semibold tabular-nums text-adm-text">
                  {item.ageDays} ngày
                </span>
              </div>

              <div role="cell" className="flex justify-end">
                <DisputeLink
                  to={`/admin/disputes/${item.caseId}`}
                  className={`inline-flex min-h-11 items-center gap-1 text-xs font-medium text-adm-text underline-offset-2 hover:underline xl:min-h-8 ${FOCUS}`}
                >
                  Mở hồ sơ
                  <ArrowRightIcon className="size-3.5" aria-hidden />
                </DisputeLink>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

