/** D6 - history of a gym case: the 200 newest events of G3, and on request the full append-only log of G4 (oldest first). */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowClockwiseIcon } from "@phosphor-icons/react";
import { Button } from "../../../../components/ui/button";
import { gymCaseApi } from "../gymCaseApi";
import { parseGymError } from "../gymCaseErrors";
import { gymEventLabel } from "../gymCaseLabels";
import { GYM_QUERY_OPTIONS, useGymQueryKeys } from "../gymCaseQueryKeys";
import { HISTORY_LIMIT_NOTE, eventActor, eventNote, eventStep, sortedEvents } from "../gymCaseModel";
import { formatDateTimeSafe } from "../gymFormat";
import type { GymCaseDetail, GymEvent } from "../gymCaseTypes";
import { EmptyBox, FOCUS, Muted, Section } from "../GymParts";

const FULL_PAGE = 100;

function EventList({ events, userId, testId }: { events: GymEvent[]; userId: string | null; testId: string }) {
  return (
    <ol className="space-y-2" data-testid={testId}>
      {events.map((e) => {
        const step = eventStep(e);
        const note = eventNote(e);
        return (
          <li key={e.id} className="rounded-lg border border-adm-border-soft bg-adm-surface-2 p-3 text-sm" data-testid="d6-event-row">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <span className="font-medium text-adm-text">{gymEventLabel(e.action)}</span>
              <span className="text-xs text-adm-text-2">{formatDateTimeSafe(e.createdAt)}</span>
            </div>
            <p className="text-xs text-adm-text-2">{eventActor(e, userId)}</p>
            {step && <p className="mt-0.5 text-xs text-adm-text">{step}</p>}
            {note && <p className="mt-1 whitespace-pre-wrap break-words text-adm-text">{note}</p>}
          </li>
        );
      })}
    </ol>
  );
}

export function HistoryTab({ detail, currentUserId }: { detail: GymCaseDetail; currentUserId: string | null }) {
  const events = sortedEvents(detail.events);
  const { keys } = useGymQueryKeys();
  const [full, setFull] = useState(false);
  const [page, setPage] = useState(0);
  const caseId = detail.case.id;
  const q = useQuery({
    queryKey: keys ? keys.history(caseId, page) : ["gym-complaint", "disabled"],
    queryFn: () => gymCaseApi.history(caseId, { limit: FULL_PAGE, offset: page * FULL_PAGE }),
    enabled: !!keys && full,
    ...GYM_QUERY_OPTIONS,
  });
  const truncated = events.length >= 200;
  const failure = q.isError ? parseGymError(q.error) : null;
  const pages = q.data ? Math.max(1, Math.ceil(q.data.total / FULL_PAGE)) : 1;

  return (
    <div className="space-y-4" data-testid="d6-tab-history">
      <Section title="Lịch sử hồ sơ" testId="d6-history">
        {events.length === 0 ? <EmptyBox testId="d6-history-empty">Chưa có sự kiện nào.</EmptyBox> : <EventList events={events} userId={currentUserId} testId="d6-events" />}
        <Muted testId="d6-history-limit">{truncated ? `${HISTORY_LIMIT_NOTE} Xem nhật ký đầy đủ bên dưới.` : "Nhật ký chỉ thêm, không sửa được."}</Muted>
      </Section>
      <Section title="Nhật ký đầy đủ (cũ → mới)" testId="d6-history-full">
        {!full ? (
          <Button type="button" variant="outline" size="sm" onClick={() => setFull(true)} className="min-h-11 xl:min-h-8" data-testid="d6-history-full-open">
            Xem nhật ký đầy đủ
          </Button>
        ) : q.isLoading ? (
          <p role="status" className="text-sm text-adm-text-2" data-testid="d6-history-full-loading">
            Đang tải…
          </p>
        ) : failure && !q.data ? (
          <div role="alert" className="space-y-2 rounded-lg border border-st-danger-border bg-st-danger-bg px-3 py-2.5 text-sm text-st-danger" data-testid="d6-history-full-error">
            <p>{failure.message}</p>
            <Button type="button" variant="outline" size="sm" onClick={() => void q.refetch()} className="min-h-11 xl:min-h-8">
              <ArrowClockwiseIcon aria-hidden /> Thử lại
            </Button>
          </div>
        ) : q.data ? (
          <>
            <EventList events={q.data.items} userId={currentUserId} testId="d6-events-full" />
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-adm-text-2">
              <span>
                Trang {page + 1}/{pages} · tổng {q.data.total} sự kiện
              </span>
              <span className="flex gap-2">
                <button type="button" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))} className={`min-h-11 rounded-md border border-adm-border px-3 text-adm-text disabled:opacity-50 xl:min-h-8 ${FOCUS}`} data-testid="d6-history-prev">
                  Trang trước
                </button>
                <button type="button" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)} className={`min-h-11 rounded-md border border-adm-border px-3 text-adm-text disabled:opacity-50 xl:min-h-8 ${FOCUS}`} data-testid="d6-history-next">
                  Trang sau
                </button>
              </span>
            </div>
          </>
        ) : null}
      </Section>
    </div>
  );
}
