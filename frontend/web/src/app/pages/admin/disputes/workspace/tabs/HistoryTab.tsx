import { caseStatusLabel } from "../../disputeCaseLabels";
import type { DisputeCaseDetail } from "../../disputeCaseTypes";
import { formatDateTime } from "../format";
import { HISTORY_LIMIT_NOTE, eventActor, eventLabel, eventNote, eventStep, sortedEvents, statusTone } from "../workspaceModel";
import { CARD, EmptyBox, Muted, Pill } from "../WorkspaceParts";

export function HistoryTab({ detail, currentUserId }: { detail: DisputeCaseDetail; currentUserId: string | null }) {
  const events = sortedEvents(detail.events);
  return (
    <div className="space-y-4" data-testid="d2-tab-history">
      <Muted testId="d2-history-limit">{HISTORY_LIMIT_NOTE}</Muted>
      {events.length === 0 ? (
        <EmptyBox testId="d2-history-empty">Hồ sơ chưa có sự kiện nào.</EmptyBox>
      ) : (
        <ol className={`${CARD} divide-y divide-adm-border-soft`} data-testid="d2-history-list">
          {events.map((e) => {
            const step = eventStep(e);
            const note = eventNote(e);
            return (
              <li key={e.id} className="space-y-1 px-4 py-3 text-sm" data-testid="d2-history-event">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-medium text-adm-text">{eventLabel(e.action)}</span>
                  {e.toStatus && <Pill tone={statusTone(e.toStatus)}>{caseStatusLabel(e.toStatus)}</Pill>}
                </div>
                {step && e.fromStatus && <p className="text-xs text-adm-text-2">{step}</p>}
                <p className="text-xs text-adm-text-2">
                  {eventActor(e, currentUserId)} · {formatDateTime(e.createdAt)}
                </p>
                {note && <p className="break-words text-adm-text">{note}</p>}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
