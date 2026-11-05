import { useCallback, useEffect } from "react";
import { useLocation, useParams, useSearchParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowClockwiseIcon, ArrowLeftIcon } from "@phosphor-icons/react";
import { Button } from "../../../components/ui/button";
import { onTablistKeyDown, tabProps } from "../shared/tablistKeys";
import { SlotNotes, useSlotNotes } from "./gymCaseKit";
import { gymCaseApi } from "./gymCaseApi";
import { parseGymError, parseGymErrorBody } from "./gymCaseErrors";
import { gymClassLabel, gymStatusLabel, gymStatusTone, gymWaitingNote } from "./gymCaseLabels";
import { GYM_QUERY_OPTIONS, useGymQueryKeys } from "./gymCaseQueryKeys";
import { GYM_TABS, describeMoney, gymTabCounts, gymTabLabel, gymTabParam, investigatorText, isWriteLayerOff, parseGymCaseId, parseGymTab, type GymTab } from "./gymCaseModel";
import { formatDateTimeSafe } from "./gymFormat";
import type { GymCaseDetail } from "./gymCaseTypes";
import { CASES_QUEUE_PATH, DisputeLink, FOCUS, GymFailurePanel, LoadingSkeleton, Notice, Pill, WriteOffNote, describeGymLoadFailure } from "./GymParts";
import { OverviewTab } from "./tabs/OverviewTab";
import { AssessmentsTab, EvidenceTab, StatementsTab } from "./tabs/FileTabs";
import { DecisionTab, FindingTab } from "./tabs/JudgementTabs";
import { ExecutionTab } from "./tabs/ExecutionTab";
import { HistoryTab } from "./tabs/HistoryTab";

/**
 * D6 / Slice 3 - the admin workspace of ONE gym complaint case at `/admin/complaints/cases/:caseId?tab=` (reads G3 `GET /admin/complaint-cases/:id`).
 * One read of G3, no polling and no refetch on focus (every read writes access-log rows): "Tải lại" is always a click. Every write button comes
 * from the server's `allowedActions`; when the server refuses all of them with `GYM_CASE_DISABLED` the page says so once and draws no form.
 */
export function AdminComplaintCasePage() {
  const params = useParams();
  const caseId = parseGymCaseId(params.caseId);
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const tab = parseGymTab(searchParams.get("tab"));
  const { keys, userId } = useGymQueryKeys();
  const queryClient = useQueryClient();
  const { notes, push } = useSlotNotes();

  const query = useQuery({
    queryKey: keys && caseId ? keys.detail(caseId) : ["gym-complaint", "disabled"],
    queryFn: () => gymCaseApi.getCase(caseId as string),
    enabled: !!keys && !!caseId,
    ...GYM_QUERY_OPTIONS,
  });
  const detail: GymCaseDetail | undefined = query.data;

  const onChanged = useCallback(async () => {
    if (keys) {
      void queryClient.invalidateQueries({ queryKey: keys.caseListAll() });
      if (caseId) void queryClient.invalidateQueries({ queryKey: [...keys.all, "history", caseId] });
    }
    const fresh = await query.refetch();
    if (fresh.isError) throw fresh.error;
  }, [keys, queryClient, query, caseId]);
  const reload = useCallback(() => {
    void query.refetch();
  }, [query]);

  const selectTab = (next: GymTab) => {
    setSearchParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        const v = gymTabParam(next);
        if (v) p.set("tab", v);
        else p.delete("tab");
        return p;
      },
      { replace: true },
    );
  };

  // Keep the selected tab visible in the phone scroll strip (the web font settles a moment after first paint).
  useEffect(() => {
    const show = () => document.getElementById(`d6-tab-${tab}`)?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    show();
    const strip = document.querySelector('[data-testid="d6-tablist"]');
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
  const backTo = typeof fromState === "string" && fromState.startsWith("?") ? `/admin/complaints${fromState}` : CASES_QUEUE_PATH;
  const back = (
    <DisputeLink to={backTo} data-testid="d6-back" className={`inline-flex min-h-11 items-center gap-1.5 rounded-md text-sm font-medium text-adm-text-2 hover:text-adm-text xl:min-h-8 ${FOCUS}`}>
      <ArrowLeftIcon className="size-4" aria-hidden /> Danh sách khiếu nại
    </DisputeLink>
  );
  const shell = (children: React.ReactNode) => (
    <div className="mx-auto max-w-6xl space-y-4 p-4 md:p-6" data-testid="d6-case-page">
      {back}
      {children}
    </div>
  );

  if (!caseId) return shell(<GymFailurePanel failure={describeGymLoadFailure(parseGymErrorBody(404, { success: false, error: { code: "CASE_NOT_FOUND", message: "" } }))} />);
  if (!keys || !userId || query.isLoading) return shell(<LoadingSkeleton testId="d6-loading" />);
  if (!detail || !detail.case) {
    const view = !detail && query.error ? parseGymError(query.error) : parseGymError({ response: { status: 500, data: {} } });
    return shell(<GymFailurePanel failure={describeGymLoadFailure(view)} onReload={reload} reloading={query.isFetching} />);
  }

  const c = detail.case;
  const refreshFailed = query.isError;
  const refreshView = refreshFailed ? parseGymError(query.error) : null;
  const money = describeMoney(detail.financial);
  const counts = gymTabCounts(detail);
  const writeOff = isWriteLayerOff(detail);
  const formProps = { detail, currentUserId: userId, onChanged, push };

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 md:p-6" data-testid="d6-case-page" data-case-status={c.status}>
      <div className="space-y-3 md:sticky md:top-0 md:z-10 md:-mx-1 md:bg-adm-bg md:px-1 md:pb-1" data-testid="d6-case-header">
        {back}
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            <h1 tabIndex={-1} className="text-xl font-bold text-adm-text outline-none" data-testid="d6-case-title">
              {gymClassLabel(c.caseClass)}
            </h1>
            <p className="mt-0.5 text-sm text-adm-text-2" data-testid="d6-case-investigator">
              {investigatorText(c.investigatorId, userId)} · mở {formatDateTimeSafe(c.createdAt)}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5" data-testid="d6-case-chips">
            <span data-testid="d6-status-pill">
              <Pill tone={gymStatusTone(c.status)}>{gymStatusLabel(c.status)}</Pill>
            </span>
            <span data-testid="d6-money-chip">
              <Pill tone={money.tone}>{`Tiền: ${money.chip}`}</Pill>
            </span>
          </div>
        </div>
        <p className="text-sm text-adm-text" data-testid="d6-waiting-header">
          {gymWaitingNote(c.status, c.execStatus)}
        </p>
        <div className="-mx-1 overflow-x-auto px-1">
          <div role="tablist" aria-label="Các mục của hồ sơ" onKeyDown={onTablistKeyDown} className="flex min-w-max gap-1 border-b border-adm-border" data-testid="d6-tablist">
            {GYM_TABS.map((t) => {
              const selected = t.id === tab;
              const n = counts[t.id];
              return (
                <button
                  key={t.id}
                  type="button"
                  id={`d6-tab-${t.id}`}
                  aria-controls="d6-panel"
                  data-testid={`d6-tab-btn-${t.id}`}
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
        <Notice tone="pending" role="status" testId="d6-refresh-failed">
          <span>Không làm mới được hồ sơ: {refreshView.message} Đang hiện dữ liệu lúc {formatDateTimeSafe(new Date(query.dataUpdatedAt).toISOString())}. </span>
          <Button type="button" variant="outline" size="sm" onClick={reload} disabled={query.isFetching} className="ml-1 min-h-11 xl:min-h-8" data-testid="d6-refresh-retry">
            <ArrowClockwiseIcon aria-hidden /> Thử lại
          </Button>
        </Notice>
      )}
      {writeOff && <WriteOffNote />}
      <SlotNotes notes={notes} />

      <div role="tabpanel" id="d6-panel" aria-labelledby={`d6-tab-${tab}`} tabIndex={0} className={`outline-none focus-visible:outline-2 focus-visible:outline-[var(--adm-focus)] ${query.isFetching ? "opacity-80" : ""}`} data-testid="d6-panel" data-tab={tab}>
        {tab === "overview" && <OverviewTab {...formProps} />}
        {tab === "evidence" && <EvidenceTab {...formProps} />}
        {tab === "statements" && <StatementsTab {...formProps} />}
        {tab === "assessments" && <AssessmentsTab {...formProps} />}
        {tab === "finding" && <FindingTab {...formProps} />}
        {tab === "decision" && <DecisionTab {...formProps} />}
        {tab === "execution" && <ExecutionTab {...formProps} onReload={reload} reloading={query.isFetching} />}
        {tab === "history" && <HistoryTab detail={detail} currentUserId={userId} />}
      </div>
      <span className="sr-only" aria-live="polite">
        {gymTabLabel(tab)}
      </span>
    </div>
  );
}
