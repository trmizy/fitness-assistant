import { EXEC_STATUS_LABEL } from "../../disputeCaseLabels";
import { ExecutionActionsSlot, type ActionSlotProps } from "../actionSlots";
import { EXEC_TABLE, describeExecution } from "../workspaceModel";
import { CARD, Notice, Pill } from "../WorkspaceParts";

/** M6, read only. Never derives anything from `decision.execution`; no execute button. */
export function ExecutionTab({ detail, currentUserId, onChanged }: ActionSlotProps) {
  const view = describeExecution(detail);
  return (
    <div className="space-y-4" data-testid="d2-tab-execution" data-exec-readable={view.readable ? "yes" : "no"}>
      <Notice tone={view.readable ? "info" : "warning"} testId="d2-exec-headline" role="note">
        <p className="font-semibold" data-testid="d2-exec-title">
          {view.headline}
        </p>
        {view.lines.map((l, i) => (
          <p key={i} className="mt-1" data-testid="d2-exec-line">
            {l}
          </p>
        ))}
      </Notice>

      {view.showTable && (
        <section className="space-y-2" aria-labelledby="d2-exec-table-title" data-testid="d2-exec-table">
          <h3 id="d2-exec-table-title" className="text-sm font-semibold text-adm-text">
            Các trạng thái thực thi
          </h3>
          <ul className={`${CARD} divide-y divide-adm-border-soft`}>
            {EXEC_TABLE.map((row) => {
              const current = row.status === view.status;
              return (
                <li key={row.status} className={`space-y-1 px-4 py-3 text-sm ${current ? "bg-adm-surface-2" : ""}`} aria-current={current ? "true" : undefined} data-testid="d2-exec-row" data-current={current ? "yes" : "no"}>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-medium text-adm-text">{EXEC_STATUS_LABEL[row.status]}</span>
                    {current && <Pill tone="info">Hiện tại</Pill>}
                  </div>
                  <p className="text-adm-text">{row.meaning}</p>
                  <p className="text-xs text-adm-text-2">Bước tiếp theo: {row.next}</p>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <ExecutionActionsSlot detail={detail} currentUserId={currentUserId} onChanged={onChanged} />
    </div>
  );
}
