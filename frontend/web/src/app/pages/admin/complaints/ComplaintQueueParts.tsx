import { useLocation } from "react-router";
import { ArrowRightIcon, BuildingsIcon, CaretLeftIcon, CaretRightIcon } from "@phosphor-icons/react";
import type { GymComplaint } from "../../../types";
import { Button } from "../../../components/ui/button";
import { CARD, DisputeLink, FOCUS, Pill } from "./GymParts";
import { casePath, caseRow, pageText, type PageInfo } from "./gymCaseModel";
import { complaintStatusLabel, issueLabel, type Tone } from "./gymCaseLabels";
import { formatDateSafe, shortRefSafe } from "./gymFormat";
import type { GymCaseListItem } from "./gymCaseTypes";

const SOURCE: Record<string, string> = {
  SELF_DETECTED: "Admin tự phát hiện",
  MEMBER_REPORT: "Hội viên báo cáo",
  PT_REPORT: "PT phản ánh",
  PARTNER_DISCLOSED: "Đối tác tự khai báo",
};
export const complaintTone = (status: string): Tone => (status === "OPEN" ? "info" : status === "IN_PROGRESS" ? "warning" : "success");

export function Pager({ info, onPrev, onNext, testId }: { info: PageInfo; onPrev: () => void; onNext: () => void; testId: string }) {
  return (
    <nav aria-label="Phân trang" data-testid={testId} className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm tabular-nums text-adm-text-2" data-testid={`${testId}-range`}>
        {pageText(info)}
      </p>
      <div className="flex gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onPrev} disabled={!info.hasPrev} className="min-h-11 xl:min-h-8" data-testid={`${testId}-prev`}>
          <CaretLeftIcon aria-hidden /> Trang trước
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onNext} disabled={!info.hasNext} className="min-h-11 xl:min-h-8" data-testid={`${testId}-next`}>
          Trang sau <CaretRightIcon aria-hidden />
        </Button>
      </div>
    </nav>
  );
}

/** The old complaint queue (H1). The whole card is one button that opens the detail dialog. */
export function ComplaintCards({ items, gymNameById, onOpen }: { items: GymComplaint[]; gymNameById: Map<string, string>; onOpen: (c: GymComplaint, opener: HTMLElement) => void }) {
  return (
    <ul className="space-y-2" data-testid="complaint-list" aria-label="Danh sách khiếu nại">
      {items.map((c) => (
        <li key={c.id}>
          <button
            type="button"
            data-testid="complaint-row"
            data-complaint-status={c.status}
            onClick={(e) => onOpen(c, e.currentTarget)}
            className={`${CARD} w-full p-4 text-left transition-colors hover:bg-adm-surface-2 motion-reduce:transition-none ${FOCUS}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-adm-text">{issueLabel(c.issueType)}</span>
                  <Pill tone={complaintTone(c.status)}>{complaintStatusLabel(c.status)}</Pill>
                </div>
                <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-adm-text-2">
                  <span className="inline-flex items-center gap-1">
                    <BuildingsIcon className="size-3.5" aria-hidden /> {gymNameById.get(c.gymId) ?? `Phòng tập mã ${shortRefSafe(c.gymId)}`}
                  </span>
                  <span aria-hidden>·</span>
                  <span>{SOURCE[c.source] ?? "Nguồn khác"}</span>
                </p>
                <p className="mt-1.5 line-clamp-2 break-words text-xs text-adm-text">{c.description}</p>
              </div>
              <span className="shrink-0 text-[11px] tabular-nums text-adm-text-2">{formatDateSafe(c.createdAt)}</span>
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** G2: the case queue. Table from xl, cards below. */
const GRID = "xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1.1fr)_minmax(0,1.2fr)_minmax(0,110px)_minmax(0,130px)]";
const CELL_LABEL = "text-[11px] font-medium text-adm-text-2 xl:hidden";

export function CaseQueue({ items, userId }: { items: GymCaseListItem[]; userId: string | null }) {
  const location = useLocation();
  return (
    <div role="table" aria-label="Hồ sơ xử lý khiếu nại phòng gym" data-testid="gym-case-list" className={`${CARD} overflow-hidden`}>
      <div role="row" className={`hidden gap-x-4 border-b border-adm-border bg-adm-surface-2 px-4 py-2.5 text-xs font-semibold text-adm-text-2 xl:grid ${GRID}`}>
        <div role="columnheader">Hồ sơ</div>
        <div role="columnheader">Bước hiện tại</div>
        <div role="columnheader">Người phụ trách</div>
        <div role="columnheader">Đã mở</div>
        <div role="columnheader" className="text-right">
          Thao tác
        </div>
      </div>
      <div role="rowgroup">
        {items.map((it) => {
          const r = caseRow(it, userId);
          return (
            <div key={r.id} role="row" data-testid="gym-case-row" data-case-status={r.status} className={`grid grid-cols-1 gap-x-4 gap-y-2 border-t border-adm-border-soft px-4 py-3 text-sm first:border-t-0 xl:items-center ${GRID}`}>
              <div role="cell" className="min-w-0">
                <p className={CELL_LABEL}>Hồ sơ</p>
                <p className="font-medium text-adm-text">{r.title}</p>
                {r.preview && <p className="mt-0.5 line-clamp-2 break-words text-xs text-adm-text-2">{r.preview}</p>}
              </div>
              <div role="cell">
                <p className={CELL_LABEL}>Bước hiện tại</p>
                <Pill tone={r.tone}>{r.statusLabel}</Pill>
              </div>
              <div role="cell" className="min-w-0">
                <p className={CELL_LABEL}>Người phụ trách</p>
                <p className={`break-words ${it.investigatorId ? "text-adm-text" : "text-adm-text-2"}`}>{r.investigator}</p>
              </div>
              <div role="cell">
                <p className={CELL_LABEL}>Đã mở</p>
                <p className="tabular-nums text-adm-text">{formatDateSafe(it.createdAt)}</p>
              </div>
              <div role="cell" className="xl:text-right">
                <DisputeLink
                  to={casePath(r.id)}
                  state={{ queueSearch: location.search }}
                  data-testid="gym-case-open"
                  aria-label={`Mở hồ sơ: ${r.title}, ${r.statusLabel}`}
                  className={`inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-md border border-adm-border bg-adm-surface px-3 text-sm font-medium text-adm-text hover:bg-adm-surface-2 xl:min-h-8 xl:w-auto ${FOCUS}`}
                >
                  Mở hồ sơ <ArrowRightIcon className="size-4" aria-hidden />
                </DisputeLink>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
