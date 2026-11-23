/**
 * Khiếu nại (batch G6), `/gym-owner/complaint-cases` and `/gym-owner/complaint-cases/:caseId`, behind VITE_GYM_OWNER_V2 (routes.tsx).
 * Owner and manager (the case service itself checks the owner / the manager of the branch). One table of the cases the server returns for
 * this account (branch chip, type, the server's progress sentence, what the gym has to do, the response deadline when the API sends one),
 * a branch filter from the scope strip and status filters that only cut the list already loaded (said under the table). A case opens in a
 * drawer; the deep link `:caseId` opens it on load. The same route object serves both URLs, so opening / closing the drawer does not
 * remount the page or read the list again (every read writes access-log rows on the server).
 * Typing in a form and then leaving (Back, another case, another branch in the strip) asks first.
 */
import { useEffect, useRef, useState } from "react";
import { useBlocker, useNavigate, useParams, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { CaretRightIcon } from "@phosphor-icons/react";
import { gymCaseApi } from "../../../pages/admin/complaints/gymCaseApi";
import { GYM_QUERY_OPTIONS, useGymQueryKeys } from "../../../pages/admin/complaints/gymCaseQueryKeys";
import { GoModal } from "../../../components/layout/gym-owner/GoModal";
import { GoTag } from "../../../components/layout/gym-owner/GoTag";
import { TextStates } from "../../../components/layout/gym-owner/motion";
import { useGymOwnerScope } from "../scope/GymOwnerScopeProvider";
import { ScopeStateFrame } from "../scope/PermissionGate";
import { ALL_BRANCHES, branchCodes } from "../scope/scopeModel";
import { dayText } from "../finance/financeModel";
import { CaseDrawer } from "./CaseDrawer";
import {
  CASE_FILTERS,
  CASE_FILTER_LABEL,
  CASES_ROOT,
  FILTER_LIMIT_NOTE,
  caseHref,
  caseProblem,
  caseRows,
  dueOf,
  filterCounts,
  filterRows,
  hasTypedContent,
  listSummary,
  parseCaseFilter,
  rowsInScope,
  shouldAskBeforeLeaving,
  type CaseFilter,
} from "./casesModel";

const COLS = "minmax(0, 1.7fr) minmax(0, 1.6fr) minmax(0, 1.3fr) minmax(0, 1.1fr) 132px";

export function CasesPage() {
  const scope = useGymOwnerScope();
  const navigate = useNavigate();
  const { caseId } = useParams();
  const [params, setParams] = useSearchParams();
  const { keys } = useGymQueryKeys();
  const filter = parseCaseFilter(params.get("show"));
  const formsRef = useRef<HTMLDivElement>(null);
  const bypass = useRef(false);
  const gymParam = scope.gymId === ALL_BRANCHES ? null : scope.gymId;
  const codes = branchCodes(scope.gyms);

  const query = useQuery({
    queryKey: keys ? keys.ownerList() : ["gym-complaint", "disabled", "owner-list"],
    queryFn: gymCaseApi.listOwner,
    enabled: !!keys && scope.status === "ready",
    ...GYM_QUERY_OPTIONS,
    // The route is shared by the list and the drawer; do not read (and write access-log rows) again just because the drawer closed.
    staleTime: 60_000,
  });

  // Leaving with typed, unsent text asks first: Back, another case, another page, another branch in the strip.
  const blocker = useBlocker(({ currentLocation, nextLocation }) =>
    !bypass.current && shouldAskBeforeLeaving({ dirty: hasTypedContent(formsRef.current), from: { pathname: currentLocation.pathname, search: currentLocation.search }, to: { pathname: nextLocation.pathname, search: nextLocation.search } }),
  );
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (!hasTypedContent(formsRef.current)) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, []);
  // A blocked navigation that was released (Back landed somewhere else) must not leave the bypass on.
  useEffect(() => {
    bypass.current = false;
  });

  const listHref = (extra?: Record<string, string>) => {
    const sp = new URLSearchParams();
    if (gymParam) sp.set("gymId", gymParam);
    for (const [k, v] of Object.entries(extra ?? {})) sp.set(k, v);
    const s = sp.toString();
    return s ? `${CASES_ROOT}?${s}` : CASES_ROOT;
  };
  const closeDrawer = () => {
    bypass.current = true;
    navigate(listHref(filter !== "all" ? { show: filter } : undefined), { replace: true });
  };
  const setFilter = (next: CaseFilter) => {
    const sp = new URLSearchParams(params);
    if (next === "all") sp.delete("show");
    else sp.set("show", next);
    setParams(sp, { replace: true });
  };

  if (scope.status === "ready" && !scope.role) return <ScopeStateFrame kind="forbidden" />;

  const problem = query.isError && !query.data ? caseProblem(query.error, "list") : null;
  if (problem?.kind === "forbidden") {
    return (
      <div className="go-wrap" data-testid="go-cases-page">
        <header className="go-page-head"><div><h1 data-testid="go-cases-title">Khiếu nại</h1></div></header>
        <div className="go-state" role="alert" data-testid="go-cases-forbidden">
          <h2>{problem.title}</h2>
          <p>{problem.body}</p>
        </div>
      </div>
    );
  }

  const loading = query.isLoading || scope.status !== "ready";
  const all = caseRows(query.data?.items, scope.gyms);
  const inScope = rowsInScope(all, scope.gymId);
  const counts = filterCounts(inScope);
  const shown = filterRows(inScope, filter);
  const branchName = gymParam ? (scope.gyms.find((g) => g.id === gymParam)?.name ?? null) : null;
  const nowMs = Date.now();
  const stale = query.isError && !!query.data;

  return (
    <div className="go-wrap go-wrap-wide" data-testid="go-cases-page">
      <header className="go-page-head">
        <div>
          <h1 data-testid="go-cases-title">Khiếu nại</h1>
          <p className="go-page-sub" data-testid="go-cases-sub">
            Khiếu nại của hội viên về chi nhánh của bạn. Bạn giải trình và gửi bằng chứng; quyết định do Gymini.
          </p>
        </div>
        <button type="button" className="go-btn" onClick={() => void query.refetch()} disabled={query.isFetching} data-testid="go-cases-reload">
          <TextStates value={query.isFetching ? "Đang tải" : "Tải lại"} />
        </button>
      </header>

      {problem && (
        <div className="go-state" role="alert" data-testid="go-cases-error" data-kind={problem.kind}>
          <h2>{problem.title}</h2>
          <p>{problem.body}</p>
          {problem.retry && (
            <div className="go-state-actions">
              <button type="button" className="go-btn" data-variant="primary" onClick={() => void query.refetch()}>Thử lại</button>
            </div>
          )}
        </div>
      )}
      {stale && (
        <div className="go-notice" data-tone="risk" role="alert" data-testid="go-cases-stale">
          <span>Chưa tải lại được. Danh sách bên dưới là lần tải trước.</span>
          <button type="button" className="go-btn go-btn-sm" onClick={() => void query.refetch()}>Thử lại</button>
        </div>
      )}

      {!problem && (
        <section className="go-panel" aria-labelledby="go-cases-h">
          <div className="go-panel-head">
            <h2 id="go-cases-h">Hồ sơ khiếu nại</h2>
            <p data-testid="go-cases-summary">{loading ? "Đang tải danh sách" : listSummary(inScope.length, shown.length, branchName, filter)}</p>
          </div>

          <div className="go-toolbar-row">
            <div className="go-seg" role="group" aria-label="Lọc hồ sơ" data-testid="go-cases-seg">
              {CASE_FILTERS.map((f) => (
                <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)} data-filter={f}>
                  {CASE_FILTER_LABEL[f]}
                  {!loading && <span className="go-seg-n">{counts[f]}</span>}
                </button>
              ))}
            </div>
          </div>

          {loading && (
            <div className="go-task-skel" aria-hidden="true" data-testid="go-cases-skeleton">
              {Array.from({ length: 4 }, (_, i) => (
                <div key={i} className="go-task-skel-row"><span className="go-skel-bar" style={{ width: "50%" }} /><span className="go-skel-bar" style={{ width: "30%" }} /></div>
              ))}
            </div>
          )}

          {!loading && inScope.length === 0 && (
            <div className="go-task-empty" data-testid="go-cases-empty">
              <strong>{branchName ? `Chưa có khiếu nại nào về ${branchName}` : "Chưa có khiếu nại nào"}</strong>
              <span>Khi hội viên gửi khiếu nại về chi nhánh của bạn, hồ sơ sẽ hiện ở đây.</span>
            </div>
          )}
          {!loading && inScope.length > 0 && shown.length === 0 && (
            <div className="go-task-empty" data-testid="go-cases-filter-empty">
              <strong>Không có hồ sơ trong nhóm "{CASE_FILTER_LABEL[filter]}"</strong>
              <span>Chọn "Tất cả" để xem toàn bộ hồ sơ đã tải.</span>
            </div>
          )}

          {!loading && shown.length > 0 && (
            <div role="table" className="go-dt" aria-label="Hồ sơ khiếu nại" data-testid="go-cases-table" style={{ "--go-cols": COLS } as React.CSSProperties}>
              <div role="row" className="go-dt-row go-dt-head">
                <div role="columnheader">Hồ sơ</div>
                <div role="columnheader">Tiến độ</div>
                <div role="columnheader">Việc của phòng tập</div>
                <div role="columnheader">Hạn phản hồi</div>
                <div role="columnheader">Mở lúc</div>
              </div>
              {shown.map((r) => {
                const due = dueOf(r.respondBy, nowMs);
                const selected = caseId === r.id;
                return (
                  <div key={r.id} role="row" className="go-dt-row" data-selected={selected ? "true" : undefined} aria-current={selected ? "true" : undefined} data-testid="go-case-row" data-case-id={r.id} data-task={r.task.kind}>
                    <div role="cell" className="go-dt-cell go-dt-first">
                      <span className="go-code-chip" aria-hidden="true">{codes[r.gymId] ?? "--"}</span>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <button type="button" className="go-rowlink" onClick={() => navigate(caseHref(r.id, gymParam))} aria-label={`Mở hồ sơ ${r.typeText}${r.gymName ? ` của ${r.gymName}` : ""}`} data-testid="go-case-open">
                          {r.typeText}
                        </button>
                        <span className="go-dt-sub">{r.gymName ?? "Chi nhánh khác"}</span>
                      </div>
                      <span className="go-dt-chev" aria-hidden="true"><CaretRightIcon /></span>
                    </div>
                    <div role="cell" className="go-dt-cell" data-label="Tiến độ" data-testid="go-case-progress-cell">{r.progress}</div>
                    <div role="cell" className="go-dt-cell" data-label="Việc của phòng tập"><GoTag tone={r.task.tone} text={r.task.text} /></div>
                    <div role="cell" className="go-dt-cell" data-label="Hạn phản hồi">
                      {due.state === "none" ? <span className="go-muted">Không có hạn</span> : <GoTag tone={due.state === "overdue" ? "risk" : "warn"} text={due.text} />}
                    </div>
                    <div role="cell" className="go-dt-cell" data-label="Mở lúc">{dayText(r.createdAt)}</div>
                  </div>
                );
              })}
            </div>
          )}
          {!loading && inScope.length > 0 && <p className="go-list-note" data-testid="go-cases-limit">{FILTER_LIMIT_NOTE}</p>}
        </section>
      )}

      <CaseDrawer caseId={caseId ?? null} onClose={closeDrawer} forceClose={closeDrawer} formsRef={formsRef} />

      <GoModal
        open={blocker.state === "blocked"}
        onClose={() => blocker.reset?.()}
        closeOnBackdrop={false}
        testId="go-cases-leave"
        title="Rời đi khi chưa gửi?"
        description="Bạn đã gõ lời giải trình hoặc thông tin tài liệu chưa gửi. Quay lại, mở hồ sơ khác, đổi chi nhánh hay sang trang khác sẽ làm mất nội dung đó."
        footer={
          <>
            <button type="button" className="go-btn" onClick={() => blocker.reset?.()}>Ở lại</button>
            <button type="button" className="go-btn" data-variant="danger" data-testid="go-cases-leave-go" onClick={() => blocker.proceed?.()}>Rời đi</button>
          </>
        }
      />
    </div>
  );
}
