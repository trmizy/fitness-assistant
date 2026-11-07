import { useCallback, useEffect, useRef } from "react";
import { useLocation, useParams, useSearchParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftIcon, ArrowClockwiseIcon } from "@phosphor-icons/react";
import { Button } from "../../../../components/ui/button";
import { onTablistKeyDown, tabProps } from "../../shared/tablistKeys";
import { disputeCaseApi } from "../disputeCaseApi";
import { parseDisputeError, parseDisputeErrorBody } from "../disputeCaseErrors";
import { caseStatusLabel, caseTypeLabel } from "../disputeCaseLabels";
import { describeMoneyGroup } from "../disputeFinancial";
import { DISPUTE_QUERY_OPTIONS, useDisputeQueryKeys } from "../disputeQueryKeys";
import type { DisputeCaseDetail } from "../disputeCaseTypes";
import { investigatorText } from "../queue/queueModel";
import { formatDateTime } from "./format";
import {
  WORKSPACE_TABS,
  blockedBanner,
  describeLoadFailure,
  parseCaseIdParam,
  parseTab,
  statusTone,
  tabCounts,
  tabParamOf,
  tabLabel,
  waitingNoteFor,
  type WorkspaceTab,
} from "./workspaceModel";
import { DisputeLink, FOCUS, FailurePanel, LoadingSkeleton, Notice, Pill, QUEUE_PATH } from "./WorkspaceParts";
import { OverviewTab } from "./tabs/OverviewTab";
import { EvidenceTab } from "./tabs/EvidenceTab";
import { StatementsTab } from "./tabs/StatementsTab";
import { AssessmentsTab } from "./tabs/AssessmentsTab";
import { FindingsTab } from "./tabs/FindingsTab";
import { ApprovalsTab } from "./tabs/ApprovalsTab";
import { AppealTab } from "./tabs/AppealTab";
import { MoneyTab } from "./tabs/MoneyTab";
import { ExecutionTab } from "./tabs/ExecutionTab";
import { HistoryTab } from "./tabs/HistoryTab";

/**
 * D2 / M2 - Case Workspace shell at the UI route `/admin/disputes/:caseId?tab=` (reads A3 `GET /admin/dispute-cases/:id`).
 *
 * READ ONLY in this batch: every tab shows what A3 returned; the write-capable tabs render a named slot (`actionSlots.tsx`) that is
 * `null` for now. One read of A3 (40 s timeout, slow because it asks the ledger for every money step); no polling and no refetch on focus
 * (every read writes access-log rows): "Tải lại" is always a click.
 */
export function AdminDisputeCasePage() {
  const params = useParams();
  const caseId = parseCaseIdParam(params.caseId);
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const tab = parseTab(searchParams.get("tab"));
  const { keys, userId } = useDisputeQueryKeys();
  const queryClient = useQueryClient();
  const headingRef = useRef<HTMLHeadingElement>(null);

  const query = useQuery({
    queryKey: keys && caseId ? keys.detail(caseId) : ["dispute-case", "disabled"],
    queryFn: () => disputeCaseApi.getCase(caseId as string),
    enabled: !!keys && !!caseId,
    ...DISPUTE_QUERY_OPTIONS,
  });
  const capabilitiesQuery = useQuery({
    queryKey: keys ? [...keys.all, "capabilities"] : ["dispute-case", "disabled", "capabilities"],
    queryFn: disputeCaseApi.getCapabilities,
    enabled: !!keys,
    ...DISPUTE_QUERY_OPTIONS,
  });
  const detail: DisputeCaseDetail | undefined = query.data;

  const onChanged = useCallback(async () => {
    if (keys) void queryClient.invalidateQueries({ queryKey: [...keys.all, "list"] });
    const fresh = await query.refetch();
    if (fresh.isError) throw fresh.error;
  }, [keys, queryClient, query]);

  const reload = useCallback(() => {
    void query.refetch();
  }, [query]);

  const selectTab = (next: WorkspaceTab) => {
    setSearchParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        const v = tabParamOf(next);
        if (v) p.set("tab", v);
        else p.delete("tab");
        return p;
      },
      { replace: true },
    );
  };

  // Keep the selected tab visible in the phone scroll strip. The web font settles a moment after first paint and changes the tab widths,
  // so the strip is re-aligned whenever it resizes during the first 2 s after the tab (or the data) changed.
  useEffect(() => {
    const show = () => document.getElementById(`d2-tab-${tab}`)?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    show();
    const strip = document.querySelector('[data-testid="d2-tablist"]');
    let ro: ResizeObserver | null = null;
    if (strip && typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(show);
      ro.observe(strip);
    }
    const stop = window.setTimeout(() => ro?.disconnect(), 2000);
    return () => {
      window.clearTimeout(stop);
      ro?.disconnect();
    };
  }, [tab, !!detail]); // eslint-disable-line react-hooks/exhaustive-deps

  const fromState = (location.state as { queueSearch?: unknown } | null)?.queueSearch;
  const backTo = `${QUEUE_PATH}${typeof fromState === "string" && fromState.startsWith("?") ? fromState : ""}`;

  const back = (
    <DisputeLink to={backTo} data-testid="d2-back" className={`inline-flex min-h-11 items-center gap-1.5 rounded-md text-sm font-medium text-adm-text-2 hover:text-adm-text xl:min-h-8 ${FOCUS}`}>
      <ArrowLeftIcon className="size-4" aria-hidden /> Danh sách khiếu nại
    </DisputeLink>
  );

  // ── states ──
  if (!caseId) {
    return (
      <div className="mx-auto max-w-6xl space-y-4 p-4 md:p-6" data-testid="d2-case-page">
        {back}
        <FailurePanel failure={describeLoadFailure(parseDisputeErrorBody(404, { error: "", code: "CASE_NOT_FOUND" }))} />
      </div>
    );
  }
  if (!keys || !userId) {
    return (
      <div className="mx-auto max-w-6xl space-y-4 p-4 md:p-6" data-testid="d2-case-page">
        {back}
        <LoadingSkeleton />
      </div>
    );
  }
  if (query.isLoading) {
    return (
      <div className="mx-auto max-w-6xl space-y-4 p-4 md:p-6" data-testid="d2-case-page">
        {back}
        <LoadingSkeleton />
      </div>
    );
  }
  if (!detail) {
    const view = parseDisputeError(query.error);
    return (
      <div className="mx-auto max-w-6xl space-y-4 p-4 md:p-6" data-testid="d2-case-page">
        {back}
        <FailurePanel failure={describeLoadFailure(view)} onReload={reload} reloading={query.isFetching} />
      </div>
    );
  }

  // ── loaded ──
  if (!detail.case) {
    return (
      <div className="mx-auto max-w-6xl space-y-4 p-4 md:p-6" data-testid="d2-case-page">
        {back}
        <FailurePanel failure={describeLoadFailure(parseDisputeError({ response: { status: 500, data: {} } }))} onReload={reload} reloading={query.isFetching} />
      </div>
    );
  }
  const refreshFailed = query.isError;
  const refreshView = refreshFailed ? parseDisputeError(query.error) : null;
  const c = detail.case;
  const banner = blockedBanner(detail);
  const money = describeMoneyGroup(detail.financial ?? { group: "UNAVAILABLE", groupLabel: "Chưa đọc được thông tin tiền" });
  const counts = tabCounts(detail);
  const slotProps = { detail, currentUserId: userId, onChanged, capabilities: capabilitiesQuery.data ?? null };

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 md:p-6" data-testid="d2-case-page" data-case-status={c.status}>
      <div className="space-y-3 md:sticky md:top-0 md:z-10 md:-mx-1 md:bg-adm-bg md:px-1 md:pb-1" data-testid="d2-case-header">
        {back}
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            <h1 ref={headingRef} tabIndex={-1} className="text-xl font-bold text-adm-text outline-none" data-testid="d2-case-title">
              {caseTypeLabel(c.type)}
            </h1>
            <p className="mt-0.5 text-sm text-adm-text-2" data-testid="d2-case-investigator">
              {investigatorText(c.investigatorId, userId)} · mở {formatDateTime(c.createdAt)}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5" data-testid="d2-case-chips">
            <span data-testid="d2-status-pill">
              <Pill tone={statusTone(c.status)}>{caseStatusLabel(c.status)}</Pill>
            </span>
            <span data-testid="d2-money-chip">
              <Pill tone={money.tone}>{`Tiền: ${money.label}`}</Pill>
            </span>
            {/* B5: the money axis reads the ledger only; an appeal consequence still open is shown next to it, never folded into "xong". */}
            {detail.closure && detail.closure.fullyResolved === false && (detail.closure.pendingAppeals > 0 || detail.closure.moneyAxisSettled === false || (detail.closure.unresolved?.length ?? 0) > 0) && (
              <span data-testid="d2-closure-chip">
                <Pill tone="warning">Còn việc sau xem xét lại chưa xong</Pill>
              </span>
            )}
          </div>
        </div>
        <p className="text-sm text-adm-text" data-testid="d2-waiting-note">
          {waitingNoteFor(c)}
        </p>

        {/* tab strip: scrolls sideways on phones, arrow keys move between tabs */}
        <div className="-mx-1 overflow-x-auto px-1">
          <div role="tablist" aria-label="Các mục của hồ sơ" onKeyDown={onTablistKeyDown} className="flex min-w-max gap-1 border-b border-adm-border" data-testid="d2-tablist">
            {WORKSPACE_TABS.map((t) => {
              const selected = t.id === tab;
              const n = counts[t.id];
              return (
                <button
                  key={t.id}
                  type="button"
                  id={`d2-tab-${t.id}`}
                  aria-controls="d2-panel"
                  data-testid={`d2-tab-btn-${t.id}`}
                  onClick={() => selectTab(t.id)}
                  {...tabProps(selected)}
                  className={`-mb-px inline-flex min-h-11 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 text-sm font-medium transition-colors motion-reduce:transition-none xl:min-h-10 ${FOCUS} ${
                    selected ? "border-adm-text text-adm-text" : "border-transparent text-adm-text-2 hover:text-adm-text"
                  }`}
                >
                  {t.label}
                  {typeof n === "number" && n > 0 && <span className="rounded-full bg-adm-pill px-1.5 py-px text-xs tabular-nums text-adm-text">{n}</span>}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {refreshFailed && refreshView && (
        <Notice tone="pending" role="status" testId="d2-refresh-failed">
          <span>Không làm mới được hồ sơ: {refreshView.message} Đang hiện dữ liệu lúc {formatDateTime(new Date(query.dataUpdatedAt).toISOString())}. </span>
          <Button type="button" variant="outline" size="sm" onClick={reload} disabled={query.isFetching} className="ml-1 min-h-11 xl:min-h-8" data-testid="d2-refresh-retry">
            <ArrowClockwiseIcon aria-hidden /> Thử lại
          </Button>
        </Notice>
      )}

      {banner && (
        <Notice tone="warning" testId="d2-blocked-banner" role="note">
          {banner}
        </Notice>
      )}

      <div role="tabpanel" id="d2-panel" aria-labelledby={`d2-tab-${tab}`} tabIndex={0} className={`outline-none focus-visible:outline-2 focus-visible:outline-[var(--adm-focus)] ${query.isFetching ? "opacity-80" : ""}`} data-testid="d2-panel" data-tab={tab}>
        {tab === "overview" && <OverviewTab {...slotProps} onGoTab={selectTab} />}
        {tab === "evidence" && <EvidenceTab {...slotProps} />}
        {tab === "statements" && <StatementsTab {...slotProps} />}
        {tab === "assessments" && <AssessmentsTab {...slotProps} />}
        {tab === "findings" && <FindingsTab {...slotProps} />}
        {tab === "approvals" && <ApprovalsTab {...slotProps} />}
        {tab === "appeals" && <AppealTab {...slotProps} />}
        {tab === "money" && <MoneyTab detail={detail} onReload={reload} reloading={query.isFetching} />}
        {tab === "execution" && <ExecutionTab {...slotProps} />}
        {tab === "history" && <HistoryTab detail={detail} currentUserId={userId} />}
      </div>
      <span className="sr-only" aria-live="polite">
        {tabLabel(tab)}
      </span>
    </div>
  );
}
