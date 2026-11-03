import { useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { ArrowClockwiseIcon, CaretLeftIcon, CaretRightIcon, GavelIcon } from "@phosphor-icons/react";
import { adminService } from "../../services/api";
import { Button } from "../../components/ui/button";
import { disputeCaseApi, listDisputedSessions } from "./disputes/disputeCaseApi";
import { parseDisputeError } from "./disputes/disputeCaseErrors";
import { CASE_STATUS_LABEL, DISPUTE_PAGE_PENDING_SENTENCE } from "./disputes/disputeCaseLabels";
import { CASE_STATUSES, type CaseStatus } from "./disputes/disputeCaseTypes";
import { DISPUTE_QUERY_OPTIONS, useDisputeQueryKeys } from "./disputes/disputeQueryKeys";
import { CaseList } from "./disputes/queue/CaseList";
import { SessionList } from "./disputes/queue/SessionList";
import {
  CASES_NOTE_NO_NAMES,
  CASES_NOTE_NO_POLLING,
  PAGE_SIZE,
  QUEUE_VIEWS,
  SESSIONS_NOTE_NO_PT_ABSENT,
  SESSIONS_NOTE_OPEN_EXISTING,
  buildQueueParams,
  buildSlaIndex,
  describeListFailure,
  joinSla,
  normalizeCaseItems,
  normalizeDisputedSessions,
  offsetOfPage,
  pageCountOf,
  parseQueueState,
  parseStatus,
  rangeText,
  type QueueView,
} from "./disputes/queue/queueModel";
import { FOCUS, FailurePanel, LoadingSkeleton, Muted, Notice } from "./disputes/workspace/WorkspaceParts";
import { formatDateTime } from "./disputes/workspace/format";

/**
 * D2 / M1 - "Xử lý khiếu nại buổi tập": the dispute queue. One surface, two chips kept in the URL (`?view=cases|sessions&status=&page=`):
 *  - `cases`    A2 - the cases, offset paging (50 per page, the server's real `total`), filter by status only. No names (the list has none),
 *               no client-side search (it would only search one page), no "escalated" chip (the flag is never written), no polling.
 *  - `sessions` C1 + the SLA of C2 - disputed sessions without a case yet; "Mở hồ sơ" (A1) from the list, plus the old one-admin ruling
 *               behind a secondary disclosure.
 * Every read of A2 writes an access-log row per case, so reload is always a click.
 */

const CHIP_LABEL: Record<QueueView, string> = { cases: "Hồ sơ", sessions: "Buổi chưa xử lý" };

export function AdminDisputes() {
  const [searchParams, setSearchParams] = useSearchParams();
  const state = parseQueueState(searchParams);
  const { keys, userId } = useDisputeQueryKeys();
  const headingRef = useRef<HTMLHeadingElement>(null);

  const go = (next: Partial<typeof state>) => setSearchParams(buildQueueParams({ ...state, page: 1, ...next }));

  const casesQuery = useQuery({
    queryKey: keys ? keys.list({ status: state.status ?? undefined, limit: PAGE_SIZE, offset: offsetOfPage(state.page) }) : ["dispute-case", "disabled", "list"],
    queryFn: () => disputeCaseApi.listCases({ status: state.status ?? undefined, limit: PAGE_SIZE, offset: offsetOfPage(state.page) }),
    enabled: !!keys && state.view === "cases",
    ...DISPUTE_QUERY_OPTIONS,
  });
  const sessionsQuery = useQuery({
    queryKey: keys ? keys.disputedSessions() : ["dispute-case", "disabled", "sessions"],
    queryFn: () => listDisputedSessions(),
    enabled: !!keys && state.view === "sessions",
    ...DISPUTE_QUERY_OPTIONS,
  });
  // SLA of the same sessions (C2). Optional: when it fails the sessions still show, just without the chip.
  const slaQuery = useQuery({
    queryKey: keys ? [...keys.all, "sla"] : ["dispute-case", "disabled", "sla"],
    queryFn: () => adminService.getSessionsReconciliation({ limit: 200 }),
    enabled: !!keys && state.view === "sessions",
    ...DISPUTE_QUERY_OPTIONS,
  });

  const active = state.view === "cases" ? casesQuery : sessionsQuery;
  const now = useMemo(() => Date.now(), [casesQuery.dataUpdatedAt, sessionsQuery.dataUpdatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const cases = normalizeCaseItems(casesQuery.data);
  const sessions = useMemo(() => {
    const { rows, ignored } = normalizeDisputedSessions(sessionsQuery.data);
    const index = slaQuery.data ? buildSlaIndex(slaQuery.data) : null;
    return { rows: joinSla(rows, index), ignored, slaReadable: !!index, slaTruncated: !!index?.truncated };
  }, [sessionsQuery.data, slaQuery.data]);

  const refresh = () => {
    if (state.view === "cases") void casesQuery.refetch();
    else {
      void sessionsQuery.refetch();
      void slaQuery.refetch();
    }
  };
  const refreshSessionsAfterAction = () => {
    void sessionsQuery.refetch();
    void slaQuery.refetch();
    headingRef.current?.focus();
  };

  const hasData = active.data !== undefined;
  const loading = !keys || (active.isLoading && !hasData);
  const error = active.error;
  const failure = active.isError && !hasData ? describeListFailure(parseDisputeError(error), state.view) : null;
  const staleView = active.isError && hasData ? parseDisputeError(error) : null;

  const pageCount = pageCountOf(cases.total);

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 md:p-6" data-testid="d2-queue-page">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 ref={headingRef} tabIndex={-1} className="flex items-center gap-2 text-xl font-bold text-adm-text outline-none">
            <GavelIcon className="size-5 shrink-0 text-adm-text-2" aria-hidden /> Xử lý khiếu nại buổi tập
          </h1>
          <p className="mt-0.5 text-sm text-adm-text-2">{DISPUTE_PAGE_PENDING_SENTENCE}</p>
        </div>
        <div className="flex items-center gap-3">
          {hasData && active.dataUpdatedAt > 0 && <span className="text-xs tabular-nums text-adm-text-2">Cập nhật lúc {formatDateTime(new Date(active.dataUpdatedAt).toISOString())}</span>}
          <Button type="button" variant="outline" size="sm" onClick={refresh} disabled={!keys || active.isFetching} aria-busy={active.isFetching} className="min-h-11 xl:min-h-8" data-testid="d2-queue-reload">
            <ArrowClockwiseIcon aria-hidden className={active.isFetching ? "animate-spin" : ""} /> Tải lại
          </Button>
        </div>
      </div>

      {/* chips (URL: ?view=) */}
      <div role="group" aria-label="Chọn danh sách" className="flex flex-wrap gap-2" data-testid="d2-chips">
        {QUEUE_VIEWS.map((v) => {
          const selected = v === state.view;
          return (
            <button
              key={v}
              type="button"
              aria-pressed={selected}
              data-testid={`d2-chip-${v}`}
              onClick={() => go({ view: v, status: null })}
              className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm font-medium transition-colors motion-reduce:transition-none xl:min-h-10 ${FOCUS} ${
                selected ? "border-adm-text bg-adm-text text-adm-bg" : "border-adm-border bg-adm-surface text-adm-text hover:bg-adm-surface-2"
              }`}
            >
              {CHIP_LABEL[v]}
              {v === "cases" && selected && hasData && (
                <span className="rounded-full bg-adm-bg/20 px-2 py-px text-xs font-semibold tabular-nums" data-testid="d2-chip-count-cases">
                  {cases.total}
                </span>
              )}
              {v === "sessions" && selected && hasData && (
                <span className="rounded-full bg-adm-bg/20 px-2 py-px text-xs font-semibold tabular-nums" data-testid="d2-chip-count-sessions">
                  {sessions.rows.length}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {state.view === "cases" ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="d2-status-filter" className="text-sm font-medium text-adm-text">
              Trạng thái hồ sơ
            </label>
            <select
              id="d2-status-filter"
              data-testid="d2-status-filter"
              value={state.status ?? ""}
              onChange={(e) => go({ status: parseStatus(e.target.value) })}
              className={`min-h-11 rounded-md border border-adm-border bg-adm-surface px-3 text-sm text-adm-text xl:min-h-9 ${FOCUS}`}
            >
              <option value="">Tất cả trạng thái</option>
              {CASE_STATUSES.map((s: CaseStatus) => (
                <option key={s} value={s}>
                  {CASE_STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </div>
          <Muted testId="d2-note-no-names">{CASES_NOTE_NO_NAMES}</Muted>
          <Muted testId="d2-note-no-polling">{CASES_NOTE_NO_POLLING}</Muted>
        </div>
      ) : (
        <div className="space-y-2">
          <Muted testId="d2-note-pt-absent">{SESSIONS_NOTE_NO_PT_ABSENT}</Muted>
          <Muted>{SESSIONS_NOTE_OPEN_EXISTING}</Muted>
          {hasData && !sessions.slaReadable && <Muted testId="d2-note-sla-missing">Chưa đọc được hạn xử lý của các buổi nên chưa hiện nhãn «trong hạn / quá hạn».</Muted>}
          {hasData && sessions.slaReadable && sessions.slaTruncated && <Muted testId="d2-note-sla-truncated">Báo cáo hạn xử lý bị cắt bớt, nên một số buổi không có nhãn hạn.</Muted>}
        </div>
      )}

      {staleView && (
        <Notice tone="pending" role="status" testId="d2-queue-refresh-failed">
          Không làm mới được: {staleView.message} Đang hiện dữ liệu cũ.
        </Notice>
      )}

      {loading ? (
        <LoadingSkeleton testId="d2-queue-loading" />
      ) : failure ? (
        <FailurePanel failure={failure} onReload={refresh} reloading={active.isFetching} testId="d2-queue-failure" />
      ) : state.view === "cases" ? (
        cases.items.length === 0 ? (
          <div data-testid="d2-cases-empty" className="rounded-xl border border-dashed border-adm-border bg-adm-surface py-14 text-center">
            <GavelIcon className="mx-auto mb-3 size-10 text-adm-text-2" aria-hidden />
            <p className="text-sm text-adm-text">{state.page > 1 ? "Không còn hồ sơ ở trang này." : state.status ? "Không có hồ sơ nào ở trạng thái này." : "Chưa có hồ sơ khiếu nại nào."}</p>
            {state.page > 1 && (
              <Button type="button" variant="outline" size="sm" className="mt-3 min-h-11 xl:min-h-8" onClick={() => go({ page: 1 })}>
                Về trang đầu
              </Button>
            )}
          </div>
        ) : (
          <>
            {cases.ignored > 0 && <p className="text-xs text-adm-text-2">Có {cases.ignored} hồ sơ không đọc được trong phản hồi nên không hiển thị.</p>}
            <CaseList items={cases.items as never} currentUserId={userId} now={now} />
            <nav aria-label="Phân trang" className="flex flex-wrap items-center justify-between gap-3" data-testid="d2-pager">
              <p className="text-sm tabular-nums text-adm-text-2" data-testid="d2-range">
                {rangeText(state.page, cases.total, cases.items.length)} · Trang {state.page}/{pageCount}
              </p>
              <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm" className="min-h-11 xl:min-h-8" disabled={state.page <= 1} onClick={() => go({ page: state.page - 1 })} data-testid="d2-page-prev">
                  <CaretLeftIcon aria-hidden /> Trang trước
                </Button>
                <Button type="button" variant="outline" size="sm" className="min-h-11 xl:min-h-8" disabled={state.page >= pageCount} onClick={() => go({ page: state.page + 1 })} data-testid="d2-page-next">
                  Trang sau <CaretRightIcon aria-hidden />
                </Button>
              </div>
            </nav>
          </>
        )
      ) : sessions.rows.length === 0 ? (
        <div data-testid="d2-sessions-empty" className="rounded-xl border border-dashed border-adm-border bg-adm-surface py-14 text-center">
          <GavelIcon className="mx-auto mb-3 size-10 text-adm-text-2" aria-hidden />
          <p className="text-sm text-adm-text">Không có khiếu nại nào đang chờ xử lý.</p>
        </div>
      ) : (
        <>
          {sessions.ignored > 0 && <p className="text-xs text-adm-text-2">Có {sessions.ignored} buổi không đọc được trong phản hồi nên không hiển thị.</p>}
          <SessionList rows={sessions.rows} now={now} onRefresh={refreshSessionsAfterAction} />
        </>
      )}
    </div>
  );
}
