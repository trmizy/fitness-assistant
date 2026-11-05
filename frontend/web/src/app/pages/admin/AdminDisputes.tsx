import { useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { ArrowClockwiseIcon, CaretLeftIcon, CaretRightIcon, GavelIcon } from "@phosphor-icons/react";
import { Button } from "../../components/ui/button";
import { disputeCaseApi } from "./disputes/disputeCaseApi";
import { parseDisputeError } from "./disputes/disputeCaseErrors";
import { CASE_STATUS_LABEL, CASE_TYPE_LABEL, DISPUTE_PAGE_PENDING_SENTENCE, EXEC_STATUS_LABEL } from "./disputes/disputeCaseLabels";
import { CASE_STATUSES, CASE_TYPES, EXEC_STATUSES, type CaseStatus, type CaseType, type ExecStatus } from "./disputes/disputeCaseTypes";
import { DISPUTE_QUERY_OPTIONS, useDisputeQueryKeys } from "./disputes/disputeQueryKeys";
import { CaseList } from "./disputes/queue/CaseList";
import { SessionList } from "./disputes/queue/SessionList";
import {
  CASES_NOTE_NO_POLLING,
  PAGE_SIZE,
  QUEUE_VIEWS,
  SESSIONS_NOTE_OPEN_EXISTING,
  describeListFailure,
  normalizeCaseItems,
  normalizeQueueItems,
  offsetOfPage,
  pageCountOf,
  parsePage,
  parseQueueState,
  parseStatus,
  rangeText,
  type QueueView,
} from "./disputes/queue/queueModel";
import { FOCUS, FailurePanel, LoadingSkeleton, Muted, Notice } from "./disputes/workspace/WorkspaceParts";
import { listAdminOptions } from "./disputes/actions/adminDirectory";
import { formatDateTime } from "./disputes/workspace/format";
import { ContractPolicyLookup } from "./disputes/actions/ContractPolicyPanel";

/**
 * D2 / M1 - "Xử lý khiếu nại buổi tập": the dispute queue. One surface, two chips kept in the URL (`?view=cases|sessions&status=&page=`):
 *  - `cases`    A2 - the cases, offset paging (50 per page, the server's real `total`), filter by status only. No names (the list has none),
 *               no client-side search (it would only search one page), no "escalated" chip (the flag is never written), no polling.
 *  - `sessions` C1 + the SLA of C2 - disputed sessions without a case yet; "Mở hồ sơ" (A1) from the list, plus the old one-admin ruling
 *               behind a secondary disclosure.
 * Every read of A2 writes an access-log row per case, so reload is always a click.
 */

const CHIP_LABEL: Record<QueueView, string> = { cases: "Hồ sơ", sessions: "Buổi chưa xử lý" };
const dateBound = (value: string, end: boolean): string | undefined => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const d = new Date(`${value}T${end ? "23:59:59.999" : "00:00:00"}`);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
};

export function AdminDisputes() {
  const [searchParams, setSearchParams] = useSearchParams();
  const state = parseQueueState(searchParams);
  const { keys, userId } = useDisputeQueryKeys();
  const headingRef = useRef<HTMLHeadingElement>(null);

  const go = (next: Partial<typeof state>) => setSearchParams((old) => {
    const p = new URLSearchParams(old);
    if (next.view) {
      if (next.view === "cases") p.delete("view");
      else p.set("view", next.view);
      p.delete("page");
      p.delete("sPage");
    }
    if (next.status !== undefined) {
      if (next.status) p.set("status", next.status);
      else p.delete("status");
      p.delete("page");
    }
    if (next.page !== undefined) {
      if (next.page > 1) p.set("page", String(next.page));
      else p.delete("page");
    }
    return p;
  });
  const setFilter = (key: string, value: string) => setSearchParams((old) => {
    const p = new URLSearchParams(old);
    if (value) p.set(key, value);
    else p.delete(key);
    p.delete("page");
    if (key !== "sPage") p.delete("sPage");
    return p;
  });
  const execStatus = EXEC_STATUSES.find((v) => v === searchParams.get("execStatus")) as ExecStatus | undefined;
  const type = CASE_TYPES.find((v) => v === searchParams.get("type")) as CaseType | undefined;
  const investigator = searchParams.get("investigator") ?? "";
  const createdFrom = searchParams.get("createdFrom") ?? "";
  const createdTo = searchParams.get("createdTo") ?? "";
  const sessionPage = parsePage(searchParams.get("sPage"));
  const sessionStatus = searchParams.get("sessionStatus") === "DISPUTED" || searchParams.get("sessionStatus") === "PT_NO_SHOW_REPORTED" ? searchParams.get("sessionStatus") as "DISPUTED" | "PT_NO_SHOW_REPORTED" : undefined;
  const caseFilters = {
    status: state.status ?? undefined, execStatus, type,
    unassigned: investigator === "unassigned" ? true : undefined,
    investigatorId: investigator && investigator !== "unassigned" ? investigator : undefined,
    createdFrom: dateBound(createdFrom, false),
    createdTo: dateBound(createdTo, true),
    limit: PAGE_SIZE, offset: offsetOfPage(state.page),
  };
  const adminsQuery = useQuery({
    queryKey: keys ? [...keys.all, "admin-options"] : ["dispute-case", "disabled", "admin-options"],
    queryFn: () => listAdminOptions(userId),
    enabled: !!keys && state.view === "cases",
    ...DISPUTE_QUERY_OPTIONS,
  });

  const casesQuery = useQuery({
    queryKey: keys ? [...keys.all, "list", caseFilters] : ["dispute-case", "disabled", "list"],
    queryFn: () => disputeCaseApi.listCases(caseFilters),
    enabled: !!keys && state.view === "cases",
    ...DISPUTE_QUERY_OPTIONS,
  });
  const sessionsQuery = useQuery({
    queryKey: keys ? [...keys.all, "queue", { sessionStatus, page: sessionPage }] : ["dispute-case", "disabled", "queue"],
    queryFn: () => disputeCaseApi.getQueue({ sessionStatus, limit: PAGE_SIZE, offset: offsetOfPage(sessionPage) }),
    enabled: !!keys && state.view === "sessions",
    ...DISPUTE_QUERY_OPTIONS,
  });

  const active = state.view === "cases" ? casesQuery : sessionsQuery;
  const now = useMemo(() => Date.now(), [casesQuery.dataUpdatedAt, sessionsQuery.dataUpdatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const cases = normalizeCaseItems(casesQuery.data);
  const sessions = useMemo(() => normalizeQueueItems(sessionsQuery.data), [sessionsQuery.data]);

  const refresh = () => {
    if (state.view === "cases") void casesQuery.refetch();
    else void sessionsQuery.refetch();
  };
  const refreshSessionsAfterAction = () => {
    void sessionsQuery.refetch();
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
      <ContractPolicyLookup />
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
                  {sessions.total}
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
            <label htmlFor="d5-exec-filter" className="text-sm font-medium text-adm-text">Thực thi</label>
            <select id="d5-exec-filter" value={execStatus ?? ""} onChange={(e) => setFilter("execStatus", e.target.value)} className={`min-h-11 rounded-md border border-adm-border bg-adm-surface px-3 text-sm text-adm-text ${FOCUS}`}>
              <option value="">Tất cả</option>
              {EXEC_STATUSES.map((s) => <option key={s} value={s}>{EXEC_STATUS_LABEL[s]}</option>)}
            </select>
            <label htmlFor="d5-type-filter" className="text-sm font-medium text-adm-text">Loại</label>
            <select id="d5-type-filter" value={type ?? ""} onChange={(e) => setFilter("type", e.target.value)} className={`min-h-11 rounded-md border border-adm-border bg-adm-surface px-3 text-sm text-adm-text ${FOCUS}`}>
              <option value="">Tất cả</option>
              {CASE_TYPES.map((s) => <option key={s} value={s}>{CASE_TYPE_LABEL[s]}</option>)}
            </select>
            <label htmlFor="d5-investigator-filter" className="text-sm font-medium text-adm-text">Người phụ trách</label>
            <select id="d5-investigator-filter" value={investigator} onChange={(e) => setFilter("investigator", e.target.value)} className={`min-h-11 rounded-md border border-adm-border bg-adm-surface px-3 text-sm text-adm-text ${FOCUS}`}>
              <option value="">Tất cả</option>
              <option value="unassigned">Chưa giao</option>
              {(adminsQuery.data ?? []).map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
            </select>
            <label htmlFor="d5-created-from" className="text-sm font-medium text-adm-text">Từ ngày</label>
            <input id="d5-created-from" type="date" value={createdFrom} onChange={(e) => setFilter("createdFrom", e.target.value)} className={`min-h-11 rounded-md border border-adm-border bg-adm-surface px-3 text-sm text-adm-text ${FOCUS}`} />
            <label htmlFor="d5-created-to" className="text-sm font-medium text-adm-text">Đến ngày</label>
            <input id="d5-created-to" type="date" value={createdTo} onChange={(e) => setFilter("createdTo", e.target.value)} className={`min-h-11 rounded-md border border-adm-border bg-adm-surface px-3 text-sm text-adm-text ${FOCUS}`} />
          </div>
          <Muted testId="d2-note-no-polling">{CASES_NOTE_NO_POLLING}</Muted>
        </div>
      ) : (
        <div className="space-y-2">
          <label htmlFor="d5-session-status" className="text-sm font-medium text-adm-text">Tình trạng buổi</label>
          <select id="d5-session-status" value={sessionStatus ?? ""} onChange={(e) => setFilter("sessionStatus", e.target.value)} className={`min-h-11 rounded-md border border-adm-border bg-adm-surface px-3 text-sm text-adm-text ${FOCUS}`}>
            <option value="">Tất cả</option>
            <option value="DISPUTED">Đang khiếu nại</option>
            <option value="PT_NO_SHOW_REPORTED">Khách báo PT vắng</option>
          </select>
          <Muted>{SESSIONS_NOTE_OPEN_EXISTING}</Muted>
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
          <nav aria-label="Phân trang buổi chưa xử lý" className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-adm-text-2">{rangeText(sessionPage, sessions.total, sessions.rows.length)} · Trang {sessionPage}/{pageCountOf(sessions.total)}</p>
            <div className="flex gap-2">
              <Button type="button" variant="outline" disabled={sessionPage <= 1} onClick={() => setFilter("sPage", String(sessionPage - 1))}>Trang trước</Button>
              <Button type="button" variant="outline" disabled={!sessions.hasMore} onClick={() => setFilter("sPage", String(sessionPage + 1))}>Trang sau</Button>
            </div>
          </nav>
        </>
      )}
    </div>
  );
}
