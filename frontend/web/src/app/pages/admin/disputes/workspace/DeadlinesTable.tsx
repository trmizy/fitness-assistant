import { formatDateTime } from "./format";
import { Pill, EmptyBox, Muted, CARD } from "./WorkspaceParts";
import {
  DEADLINE_NOTE,
  deadlineDueText,
  deadlineKindLabel,
  deadlinePartyLabel,
  deadlineStatusLabel,
  deadlineStatusTone,
} from "./deadlinesModel";

export interface DeadlineRow {
  id?: string;
  kind: string;
  partyRole?: string;
  party?: string;
  startedAt?: string | Date;
  dueAt?: string | Date | null;
  paused?: boolean | null;
  status?: string;
}

interface DeadlinesTableProps {
  deadlines?: DeadlineRow[] | null;
}

export function DeadlinesTable({ deadlines }: DeadlinesTableProps) {
  const items = deadlines ?? [];

  return (
    <section className={`${CARD} space-y-3 p-4`} data-testid="deadlines-section">
      <div>
        <h3 className="text-sm font-semibold text-adm-text">
          Thời hạn phản hồi
        </h3>
        <Muted>{DEADLINE_NOTE}</Muted>
      </div>

      {items.length === 0 ? (
        <EmptyBox testId="deadlines-empty">
          Hồ sơ này chưa có mốc thời hạn phản hồi nào được ghi nhận.
        </EmptyBox>
      ) : (
        // Phase 3 FAIL #1 (axe scrollable-region-focusable): a scrollable region must be reachable by keyboard and named
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Bảng thời hạn phản hồi">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-adm-border-soft text-adm-text-2">
                <th className="pb-2 font-medium">Loại thời hạn</th>
                <th className="pb-2 font-medium">Bên liên quan</th>
                <th className="pb-2 font-medium">Bắt đầu</th>
                <th className="pb-2 font-medium">Hạn chót</th>
                <th className="pb-2 font-medium">Trạng thái</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-adm-border-soft">
              {items.map((d, i) => (
                <tr key={d.id ?? i} data-testid={`deadline-row-${d.id ?? i}`}>
                  <td className="py-2.5 font-medium text-adm-text">
                    {deadlineKindLabel(d.kind)}
                  </td>
                  <td className="py-2.5 text-adm-text">
                    {deadlinePartyLabel(d.partyRole ?? d.party)}
                  </td>
                  <td className="py-2.5 text-adm-text-2">
                    {d.startedAt ? formatDateTime(typeof d.startedAt === "string" ? d.startedAt : d.startedAt.toISOString()) : "—"}
                  </td>
                  <td className="py-2.5 text-adm-text-2">
                    {deadlineDueText(d.dueAt, d.paused)}
                  </td>
                  <td className="py-2.5">
                    <Pill tone={deadlineStatusTone(d.status)}>
                      {deadlineStatusLabel(d.status)}
                    </Pill>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
