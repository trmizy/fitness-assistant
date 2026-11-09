import { EXEC_STATUS_LABEL } from "../../disputeCaseLabels";
import { ExecutionActionsSlot, type ActionSlotProps } from "../actionSlots";
import { formatDateTime } from "../format";
import { EXEC_TABLE, describeExecution } from "../workspaceModel";
import { CARD, Notice, Pill } from "../WorkspaceParts";

/**
 * M6. Reads `execution` / `case.execStatus` of the detail: state, reason, the conditions in the way right now, the append-only history and the
 * acknowledgements. `BUSINESS_DONE` never says money arrived. Never reads `decision.execution` (gone from the server). The execute / reconcile /
 * acknowledge controls live in the slot below and exist only behind the `execution` capability and the server's `allowedActions`.
 */
export function ExecutionTab({ detail, currentUserId, onChanged, capabilities }: ActionSlotProps) {
  const view = describeExecution(detail, currentUserId);
  return (
    <div className="space-y-4" data-testid="d2-tab-execution" data-exec-readable={view.readable ? "yes" : "no"} data-exec-status={view.status ?? ""} data-exec-applicable={view.applicable ? "yes" : "no"}>
      <Notice tone={view.readable ? (view.status === "EXEC_BLOCKED" || view.status === "NEEDS_HUMAN" ? "warning" : "info") : "warning"} testId="d2-exec-headline" role="note">
        <p className="font-semibold" data-testid="d2-exec-title">
          {view.headline}
        </p>
        {view.lines.map((l, i) => (
          <p key={i} className="mt-1" data-testid="d2-exec-line">
            {l}
          </p>
        ))}
      </Notice>

      {view.blockers.length > 0 && view.status !== "BUSINESS_DONE" && (
        <section className={`${CARD} space-y-2 p-4`} aria-labelledby="d5-exec-blockers-title" data-testid="d5-exec-blockers">
          <h3 id="d5-exec-blockers-title" className="text-sm font-semibold text-adm-text">
            Điều kiện đang cản trở việc thực thi
          </h3>
          <ul className="list-disc space-y-1 pl-5 text-sm text-adm-text">
            {view.blockers.map((b) => (
              <li key={b.code} data-testid="d5-exec-blocker">
                {b.text}
              </li>
            ))}
          </ul>
          <p className="text-xs text-adm-text-2">Chỉ để đọc trước. Khi thực thi, máy chủ tự kiểm lại tất cả.</p>
        </section>
      )}

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

      {view.history.length > 0 && (
        <section className="space-y-2" aria-labelledby="d5-exec-history-title" data-testid="d5-exec-history">
          <h3 id="d5-exec-history-title" className="text-sm font-semibold text-adm-text">
            Lịch sử thực thi
          </h3>
          <ol className={`${CARD} divide-y divide-adm-border-soft`}>
            {view.history.map((h) => (
              <li key={h.id} className="space-y-0.5 px-4 py-3 text-sm" data-testid="d5-exec-history-row">
                <p className="font-medium text-adm-text">{h.title}</p>
                {h.detail && <p className="break-words text-adm-text">{h.detail}</p>}
                <p className="text-xs text-adm-text-2">
                  {h.actor} · {formatDateTime(h.at)}
                </p>
              </li>
            ))}
          </ol>
        </section>
      )}

      {view.acknowledgements.length > 0 && (
        <section className="space-y-2" aria-labelledby="d5-exec-acks-title" data-testid="d5-exec-acks">
          <h3 id="d5-exec-acks-title" className="text-sm font-semibold text-adm-text">
            Lần xác nhận của người xem xét
          </h3>
          <p className="text-xs text-adm-text-2">Các lần xác nhận này không chuyển tiền.</p>
          <ul className={`${CARD} divide-y divide-adm-border-soft`}>
            {view.acknowledgements.map((a, i) => (
              <li key={`${a.at}-${i}`} className="space-y-0.5 px-4 py-3 text-sm" data-testid="d5-exec-ack">
                {a.note && <p className="break-words text-adm-text">{a.note}</p>}
                <p className="text-xs text-adm-text-2">
                  {a.actor} · {formatDateTime(a.at)}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <ExecutionActionsSlot detail={detail} currentUserId={currentUserId} onChanged={onChanged} capabilities={capabilities} />
    </div>
  );
}
