/**
 * "Hôm nay" (batch G1) - the Gym Owner home for OWNER and MANAGER, behind VITE_GYM_OWNER_V2 (routes.tsx).
 * Left: the work list ("Việc cần xử lý") built from real endpoints; right: the branch list. Sources and honesty rules are in
 * todayModel.ts. Reads only; every button navigates to an EXISTING screen in the right context.
 *
 * Roles: OWNER reads everything; MANAGER reads front-desk exceptions + complaints of the assigned branches (sourcesForRole).
 * RECEPTIONIST / ACCOUNTANT never reach this page (RequireStaffFeature sends them to their own home).
 */
import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useIsFetching, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowsClockwiseIcon, CaretRightIcon, ClipboardTextIcon, HandshakeIcon, IdentificationCardIcon, ScalesIcon, WalletIcon, type Icon } from "@phosphor-icons/react";
import { collaborationService, gymService, profileService } from "../../../services/api";
import { gymCaseApi } from "../../../pages/admin/complaints/gymCaseApi";
import { GYM_QUERY_OPTIONS } from "../../../pages/admin/complaints/gymCaseQueryKeys";
import { buildPartnershipSections, ptDisplayName } from "../../../utils/brandPartnership";
import type { GymStats } from "../../../types";
import { GoTag } from "../../../components/layout/gym-owner/GoTag";
import { SubtleNumber, TextStates } from "../../../components/layout/gym-owner/motion";
import { useGymOwnerScope } from "../scope/GymOwnerScopeProvider";
import { branchCodes, branchStatusText, goKey, pickableGyms } from "../scope/scopeModel";
import { GYM_STATS_KEY, gymStatsKey, invalidateGymStats, type StatsState } from "../stats/gymStats";
import { CheckinTrendPanel } from "../charts/CheckinTrendPanel";
import { HeatmapPanel } from "../charts/HeatmapPanel";
import { RenewalPanel } from "../charts/RenewalPanel";
import { MembershipStatusPanel } from "../charts/MembershipStatusPanel";
import { chartAccess } from "../charts/chartsModel";
import {
  LOADING,
  MAX_ROWS,
  branchRows,
  brandLevelVisible,
  buildToday,
  coverageNotice,
  fansOutTo,
  freshnessLine,
  limitRows,
  relativeAge,
  shortDate,
  sourcesForRole,
  targetGyms,
  todayTitle,
  type Source,
  type TaskKind,
  type TodayGym,
  type TodayTask,
} from "./todayModel";

const KIND_ICON: Record<TaskKind, Icon> = {
  exception: IdentificationCardIcon,
  complaint: ScalesIcon,
  collaboration: HandshakeIcon,
  withdrawal: WalletIcon,
  branch: ClipboardTextIcon,
};

/** A plain anchor that navigates through the router (same approach as the sidebar: react-router's Link has the duplicate @types/react typing error). */
function TodayLink({ to, children, ...rest }: { to: string; children: React.ReactNode } & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href">) {
  const navigate = useNavigate();
  return (
    <a
      {...rest}
      href={to}
      onClick={(e) => {
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}

function toSource<T>(q: { isError: boolean; data: T | undefined; dataUpdatedAt: number }): Source<T> {
  if (q.isError) return { state: "error" };
  if (q.data === undefined) return LOADING;
  return { state: "ok", data: q.data, at: q.dataUpdatedAt };
}

const QUERY_OPTS = { retry: false, staleTime: 30_000, refetchOnWindowFocus: false } as const;

export function TodayPage() {
  const scope = useGymOwnerScope();
  const { role, gymId, scopeKey } = scope;
  const queryClient = useQueryClient();
  const read = sourcesForRole(scope.can, role);

  // The branch list answer of the scope provider (same key): it carries activeMemberCount / rating that ScopeGym drops.
  const ownedQuery = useQuery<TodayGym[]>({ queryKey: ["owned-gyms"], queryFn: () => gymService.listOwnedGyms(), enabled: !!role });
  const all = (ownedQuery.data ?? []) as (TodayGym & { address?: string | null })[];
  const gyms = useMemo(() => pickableGyms(all), [all]);
  const drafts = useMemo(() => (scope.can("branch.write") ? all.filter((g) => g.status === "DRAFT") : []), [all, scope.can]);
  const view = useMemo(() => targetGyms(gyms, gymId), [gyms, gymId]);
  const live = useMemo(() => view.filter(fansOutTo), [view]);
  const brandVisible = brandLevelVisible(gymId, gyms.length);
  const codes = useMemo(() => branchCodes(scope.gyms), [scope.gyms]);

  const key = (resource: string, params?: unknown) => goKey(scope, `today:${resource}`, params);

  const exceptionQs = useQueries({
    queries: (read.exceptions ? live : []).map((g) => ({
      queryKey: key("exceptions", { gymId: g.id }),
      queryFn: () => gymService.listCheckinExceptions(g.id),
      ...QUERY_OPTS,
    })),
  });
  const withdrawalQs = useQueries({
    queries: (read.withdrawals ? live : []).map((g) => ({
      queryKey: key("withdrawals", { gymId: g.id }),
      queryFn: () => gymService.listGymWithdrawals(g.id),
      ...QUERY_OPTS,
    })),
  });
  const draftQs = useQueries({
    queries: (read.reviewIssues && brandVisible ? drafts : []).map((g) => ({
      queryKey: key("review-issues", { gymId: g.id }),
      queryFn: () => gymService.listOpenReviewIssues(g.id),
      ...QUERY_OPTS,
    })),
  });
  // G5: KPI counts per branch (check-ins by Vietnam day, running / expiring memberships). One request per approved branch in view; a branch
  // whose request fails says so on its own row (never a 0), and no branch total is added up.
  const readsStats = scope.can("checkin.list") || scope.can("membership.full") || scope.can("membership.sales");
  const statsQs = useQueries({
    queries: (readsStats ? live : []).map((g) => ({
      queryKey: gymStatsKey(scope.userId, g.id),
      queryFn: () => gymService.getGymStats(g.id) as Promise<GymStats>,
      retry: false,
      staleTime: 15_000,
      refetchOnWindowFocus: false,
    })),
  });
  const statsById: Record<string, StatsState> = {};
  (readsStats ? live : []).forEach((g, i) => {
    const q = statsQs[i];
    if (!q) return;
    statsById[g.id] = q.data && q.data.gymId === g.id ? { state: "ok", stats: q.data } : q.isError ? { state: "error" } : { state: "loading" };
  });
  const complaintsQ = useQuery({
    queryKey: key("complaints"),
    queryFn: () => gymCaseApi.listOwner(),
    enabled: read.complaints,
    ...GYM_QUERY_OPTIONS,
  });
  const collabQ = useQuery({
    queryKey: key("collaborations"),
    queryFn: () => collaborationService.listForOwner(),
    enabled: read.collaborations && brandVisible,
    ...QUERY_OPTS,
  });

  const ptIds = useMemo(() => {
    if (!collabQ.data) return [] as string[];
    return [...new Set(buildPartnershipSections(collabQ.data, "GYM").needsReply.map((c) => c.ptUserId).filter(Boolean))];
  }, [collabQ.data]);
  const ptQs = useQueries({
    queries: ptIds.map((id) => ({
      queryKey: key("pt-name", { id }),
      queryFn: async () => ptDisplayName(await profileService.getPTDetail(id)),
      ...QUERY_OPTS,
    })),
  });

  const nowMs = Date.now();
  const mapBy = (list: readonly { id: string }[], qs: readonly { isError: boolean; data: unknown; dataUpdatedAt: number }[]) => {
    const out: Record<string, Source<unknown>> = {};
    list.forEach((g, i) => {
      if (qs[i]) out[g.id] = toSource(qs[i]);
    });
    return out;
  };
  const ptNames: Record<string, string> = {};
  ptIds.forEach((id, i) => {
    const n = ptQs[i]?.data as string | undefined;
    if (n && n !== "Huấn luyện viên") ptNames[id] = n;
  });

  const model = buildToday({
    role,
    can: scope.can,
    nowMs,
    gyms,
    drafts,
    scopeGymId: gymId,
    codes,
    exceptions: mapBy(read.exceptions ? live : [], exceptionQs),
    withdrawals: mapBy(read.withdrawals ? live : [], withdrawalQs),
    reviewIssues: mapBy(read.reviewIssues && brandVisible ? drafts : [], draftQs),
    complaints: read.complaints ? toSource({ isError: complaintsQ.isError, data: complaintsQ.data?.items, dataUpdatedAt: complaintsQ.dataUpdatedAt }) : null,
    collaborations: read.collaborations && brandVisible ? toSource(collabQ) : null,
    ptNames,
  });

  const fetching = useIsFetching({
    predicate: (q) =>
      (q.queryKey[0] === "gym-owner" && q.queryKey[1] === scope.userId && typeof q.queryKey[5] === "string" && (q.queryKey[5] as string).startsWith("today:")) ||
      (q.queryKey[0] === GYM_STATS_KEY && q.queryKey[1] === scope.userId),
  });
  const reloadAll = () => {
    void invalidateGymStats(queryClient, scope.userId);
    return queryClient.invalidateQueries({
      predicate: (q) => q.queryKey[0] === "gym-owner" && q.queryKey[1] === scope.userId && typeof q.queryKey[5] === "string" && (q.queryKey[5] as string).startsWith("today:"),
    });
  };
  const retryFailed = () => {
    const all = [...exceptionQs, ...withdrawalQs, ...draftQs, ...statsQs, complaintsQ, collabQ];
    for (const q of all) if (q.isError) void q.refetch();
  };

  const retryStats = () => {
    for (const q of statsQs) if (q.isError) void q.refetch();
  };

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  if (!role) return null;

  const single = gyms.length === 1 || gymId !== "ALL";
  const access = chartAccess(scope.can);
  const notice = coverageNotice(model, codes);
  const rows = branchRows(view, model, codes, (g) => branchStatusText(g).text, statsById);
  const empty = model.complete && model.tasks.length === 0;
  const waitingFirstData = model.loading && model.tasks.length === 0 && !notice;
  const now = Date.now();

  return (
    <div className="go-today" data-testid="go-today">
      <header className="go-page-head">
        <div>
          <h1 data-testid="go-today-title">{todayTitle(now)}</h1>
          <p className="go-page-sub" data-testid="go-today-fresh">{freshnessLine(model, single)}</p>
        </div>
        <button type="button" className="go-btn" onClick={() => void reloadAll()} disabled={fetching > 0 || scope.scopeChanging} data-testid="go-today-reload">
          <ArrowsClockwiseIcon aria-hidden="true" width={16} height={16} />
          <TextStates value={fetching > 0 ? "Đang tải" : "Tải lại"} />
        </button>
      </header>

      {notice && (
        <div className="go-notice" data-tone="risk" role="alert" data-testid="go-today-coverage">
          <span>{notice.text}. Chưa có tổng số việc vì chưa đủ nguồn.</span>
          <button type="button" className="go-btn go-btn-sm" onClick={retryFailed}>Thử lại</button>
        </div>
      )}

      <div className="go-today-grid">
        <section className="go-panel go-today-tasks" aria-labelledby="go-h-tasks">
          <div className="go-panel-head">
            <h2 id="go-h-tasks">Việc cần xử lý</h2>
            {model.counts && !empty && (
              <p data-testid="go-today-summary">
                <SubtleNumber value={model.counts.decide} /> việc cần bạn quyết định, <SubtleNumber value={model.counts.wait} /> việc đang chờ bên khác
              </p>
            )}
          </div>

          {waitingFirstData && <TaskSkeleton />}

          {empty && (
            <div className="go-task-empty" data-testid="go-today-empty">
              <strong>Không có việc nào cần bạn xử lý hôm nay</strong>
              {/* G1 redline: the freshness line under the title already says "Cập nhật hh:mm", so it is not repeated here. */}
            </div>
          )}

          {!empty && !waitingFirstData && model.tasks.length === 0 && notice && (
            <div className="go-task-empty">
              <strong>Chưa tải đủ dữ liệu để kết luận</strong>
              <span>Bấm Thử lại để tải lại các phần bị lỗi.</span>
            </div>
          )}

          <TaskGroup id="decide" title="Cần bạn quyết định" tasks={model.decide} codes={codes} now={now} expanded={!!expanded.decide} onExpand={() => setExpanded((e) => ({ ...e, decide: true }))} />
          <TaskGroup id="wait" title="Đang chờ bên khác" tasks={model.wait} codes={codes} now={now} expanded={!!expanded.wait} onExpand={() => setExpanded((e) => ({ ...e, wait: true }))} />

          {read.collaborations && !brandVisible && <p className="go-panel-foot">Việc cấp thương hiệu, như thỏa thuận PT, chỉ hiện khi xem tất cả chi nhánh.</p>}
        </section>

        <section className="go-panel go-today-branches" aria-labelledby="go-h-branches">
          <div className="go-panel-head">
            <h2 id="go-h-branches">{gymId === "ALL" && gyms.length > 1 ? "Chi nhánh" : "Chi nhánh đang xem"}</h2>
            <p>Bấm vào một chi nhánh để mở</p>
          </div>
          {ownedQuery.isLoading && <TaskSkeleton rows={3} />}
          {!ownedQuery.isLoading && rows.length === 0 && <p className="go-task-empty">Chưa có chi nhánh trong phạm vi của bạn.</p>}
          <ul className="go-br-list" data-testid="go-today-branches">
            {rows.map((r, i) => {
              const g = view[i];
              const st = branchStatusText(g);
              const reopen = g.operationalStatus === "TEMPORARILY_CLOSED" && g.expectedReopenAt ? `Mở lại dự kiến ${shortDate(g.expectedReopenAt)}` : null;
              return (
                <li key={r.id} className="go-br-row">
                  <TodayLink to={r.href} className="go-br-link" aria-label={`Mở chi nhánh ${r.name}`}>
                    <span className="go-br-top">
                      <span className="go-code-chip" aria-hidden="true">{r.code}</span>
                      <span className="go-br-name" title={r.name}>{r.name}</span>
                      <GoTag tone={st.tone} text={st.text} />
                    </span>
                    <span className="go-br-line">
                      <span>{r.running !== null ? `${r.running} thẻ đang chạy` : r.members === null ? "Chưa có số hội viên" : `${r.members} hội viên đang hoạt động`}</span>
                      {r.statsLines.map((t) => <span key={t} data-testid="go-today-stat">{t}</span>)}
                      <span>{r.rating}</span>
                      <span>{r.openTasks === null ? (model.loading ? "Đang tải việc" : "Việc mở: không tải được") : `${r.openTasks} việc mở`}</span>
                    </span>
                    {reopen && <span className="go-br-note">{reopen}</span>}
                  </TodayLink>
                </li>
              );
            })}
          </ul>
        </section>
      </div>

      {/* Charts (phase 1): trends of the branches in view. Each panel draws only when the role may read its data (chartAccess, from permissions[]). */}
      {live.length > 0 && (access.checkins || access.members) && (
        <div className="go-today-trends" data-testid="go-today-trends">
          <CheckinTrendPanel gyms={live} codes={codes} />
          <MembershipStatusPanel gymIds={live.map((g) => g.id)} statsById={statsById} scopeLabel={live.length > 1 ? `Tất cả ${live.length} chi nhánh cộng lại` : live[0].name} onRetry={retryStats} />
        </div>
      )}

      {/* Charts (phase 2): peak hours + renewal, from /analytics. Same fail-closed gating: heatmap needs checkin.list, renewal membership.full | membership.sales. */}
      {live.length > 0 && (access.heatmap || access.renewal) && (
        <div className="go-today-trends" data-kind="insight" data-testid="go-today-insights">
          <HeatmapPanel gyms={live} />
          <RenewalPanel gyms={live} />
        </div>
      )}
    </div>
  );
}

function TaskSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="go-task-skel" aria-hidden="true" data-testid="go-today-skeleton">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="go-task-skel-row">
          <span className="go-skel-bar" style={{ width: "70%" }} />
          <span className="go-skel-bar" style={{ width: "35%" }} />
        </div>
      ))}
    </div>
  );
}

function TaskGroup({ id, title, tasks, codes, now, expanded, onExpand }: { id: string; title: string; tasks: TodayTask[]; codes: Record<string, string>; now: number; expanded: boolean; onExpand: () => void }) {
  if (tasks.length === 0) return null;
  const { shown, hidden } = limitRows(tasks, MAX_ROWS, expanded);
  return (
    <div className="go-task-group" data-testid={`go-today-group-${id}`}>
      <h3 id={`go-tg-${id}`}>{title}</h3>
      <ul aria-labelledby={`go-tg-${id}`}>
        {shown.map((t, i) => (
          <TaskRow key={t.id} t={t} index={i} code={t.gymId ? (codes[t.gymId] ?? null) : null} now={now} />
        ))}
      </ul>
      {hidden > 0 && (
        <div className="go-more-row">
          <button type="button" className="go-btn go-btn-link" onClick={onExpand} data-testid={`go-today-more-${id}`}>Xem tất cả ({tasks.length})</button>
        </div>
      )}
    </div>
  );
}

function TaskRow({ t, index, code, now }: { t: TodayTask; index: number; code: string | null; now: number }) {
  const Icon = KIND_ICON[t.kind];
  return (
    <li className="go-task" style={{ "--i": Math.min(index, 5) } as React.CSSProperties} data-testid="go-today-task" data-kind={t.kind}>
      <span className="go-task-ico"><Icon aria-hidden="true" /></span>
      <div className="go-task-body">
        <p className="go-task-text" title={t.text}>{t.text}</p>
        <p className="go-task-sub"><span className="go-task-sub-text">{t.sub}</span><span className="go-task-sub-age">{relativeAge(t.at, now)}</span></p>
      </div>
      {code ? <span className="go-code-chip" title="Chi nhánh">{code}</span> : <span className="go-task-brand" title="Việc cấp thương hiệu">Chung</span>}
      <span className="go-task-age">{relativeAge(t.at, now)}</span>
      <TodayLink to={t.href} className="go-btn go-task-btn" aria-label={`${t.actionLabel}: ${t.text}`}>{t.actionLabel}</TodayLink>
      <span className="go-task-chev" aria-hidden="true"><CaretRightIcon /></span>
    </li>
  );
}
