/**
 * Tab "Hội viên": the memberships of ONE branch from the server-paged `GET /owner/gyms/:gymId/memberships` (G5: cursor, newest first,
 * `status` filter in the database). The page offers only what the API can do: a status filter that is sent to the server and
 * "Xem thêm" for the next page. No name search, plan filter or sort: on one page they would read as an answer about the whole branch.
 * Status counts come from `GET /owner/gyms/:id/stats` (`byStatus`) and are drawn only when the server returned them.
 * Owner / manager: FULL rows. Accountant: SALES rows (no name, no identity, no desk link). Row click opens the member drawer.
 * Data is drawn only when it was fetched for the scope on screen (05 section 6.7) and is never kept between two branches.
 */
import { useMemo, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { CaretRightIcon } from "@phosphor-icons/react";
import { gymService } from "../../../services/api";
import type { GymStats } from "../../../types";
import { formatVND } from "../../../utils/currency";
import { GoTag } from "../../../components/layout/gym-owner/GoTag";
import { TextStates } from "../../../components/layout/gym-owner/motion";
import { ScopeStateFrame } from "../scope/PermissionGate";
import { useGymOwnerScope, useScopeChangeEffect } from "../scope/GymOwnerScopeProvider";
import { classifyApiError, goKey } from "../scope/scopeModel";
import { byStatusOf, gymStatsKey, type StatsState } from "../stats/gymStats";
import {
  MEMBERS_PAGE_SIZE,
  SALES_MODE_NOTE,
  formatDay,
  isCurrentScopeData,
  memberDisplayName,
  memberStatusTag,
  membersModeFor,
  normalizeMemberships,
  pageSummary,
  planNameOf,
  serverSegments,
  statusLabel,
  statusParamOf,
  validityText,
  visitsText,
  type MemberRow,
} from "./membersModel";
import { useBrandPlans } from "./useBrandPlans";
import { MemberDrawer } from "./MemberDrawer";

// "Hiệu lực" keeps a fixed minimum (dd/mm/yyyy đến dd/mm/yyyy fits on one line from 1280px) so the columns do not jump with the data.
const FULL_COLS = "minmax(0, 1.8fr) minmax(0, 1.2fr) 150px minmax(236px, 1.3fr) 110px 120px";
const SALES_COLS = "minmax(0, 1.5fr) minmax(0, 1.2fr) 150px minmax(236px, 1.3fr) 90px 130px 120px";

export function MembersTab() {
  const scope = useGymOwnerScope();
  const mode = membersModeFor(scope.can);
  const gymId = scope.gymId;
  const sales = mode === "sales";
  const plans = useBrandPlans(true);
  const planRows = plans.query.data ?? [];

  const [status, setStatus] = useState("all");
  const [openId, setOpenId] = useState<string | null>(null);

  // Scope change: drawer closed, selected row dropped, filter back to "Tất cả" (05 section 6.4). Nothing here is a form with unsaved work.
  useScopeChangeEffect(() => {
    setOpenId(null);
    setStatus("all");
  });

  const scopeKey = scope.scopeKey;
  const enabled = mode !== "none" && gymId !== "ALL" && scope.status === "ready";

  const list = useInfiniteQuery({
    queryKey: goKey(scope, "members", { status }),
    queryFn: async ({ pageParam }) => ({
      scopeKey,
      ...(await gymService.listOwnedMembershipsPage(gymId, { limit: MEMBERS_PAGE_SIZE, cursor: pageParam, status: statusParamOf(status) })),
    }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.hasMore ? last.nextCursor : undefined),
    enabled,
  });

  // KPI counts (status counts for the filter). Same key as the Hôm nay branch rows. A failure is "no counts", never zeros.
  const statsQ = useQuery<GymStats>({ queryKey: gymStatsKey(scope.userId, gymId), queryFn: () => gymService.getGymStats(gymId), enabled, retry: false, staleTime: 15_000 });
  const statsState: StatsState = statsQ.data && statsQ.data.gymId === gymId ? { state: "ok", stats: statsQ.data } : statsQ.isError ? { state: "error" } : { state: "loading" };
  const segments = useMemo(() => serverSegments(byStatusOf(statsState)), [statsQ.data, statsQ.isError]); // eslint-disable-line react-hooks/exhaustive-deps

  const pages = (list.data?.pages ?? []).filter((p) => isCurrentScopeData(p.scopeKey, scopeKey));
  const rows = useMemo<MemberRow[]>(() => pages.flatMap((p) => normalizeMemberships(p.items, mode)), [list.data, scopeKey, mode]); // eslint-disable-line react-hooks/exhaustive-deps
  const hasMore = pages.length > 0 && !!list.hasNextPage;
  const nowMs = Date.now();
  const open = openId ? (rows.find((r) => r.id === openId) ?? null) : null;

  if (list.isError && !list.data) {
    const kind = classifyApiError(list.error);
    return kind === "forbidden" || kind === "out-of-scope" ? (
      <ScopeStateFrame kind={kind} />
    ) : (
      <div className="go-state" role="alert" data-testid="go-members-error">
        <h2>Không tải được danh sách hội viên</h2>
        <p>Đã có lỗi khi tải. Chưa kết luận chi nhánh này có hay không có hội viên.</p>
        <div className="go-state-actions"><button type="button" className="go-btn" data-variant="primary" onClick={() => void list.refetch()}>Thử lại</button></div>
      </div>
    );
  }

  const loading = list.isLoading || scope.status !== "ready" || (!!list.data && pages.length === 0);
  const gym = scope.gyms.find((g) => g.id === gymId);

  return (
    <div className="go-stack" data-testid="go-members-tab">
      {sales && (
        <div className="go-note go-sales-note" role="note" data-testid="go-sales-note">{SALES_MODE_NOTE}</div>
      )}
      <section className="go-panel" aria-label={sales ? "Giao dịch của chi nhánh" : "Hội viên của chi nhánh"}>
        <div className="go-toolbar-row">
          <div className="go-seg" role="group" aria-label="Lọc theo trạng thái" data-testid="go-members-seg">
            {segments.map((s) => (
              <button key={s.id} type="button" aria-pressed={status === s.id} onClick={() => setStatus(s.id)} data-seg={s.id} aria-label={s.count === null ? s.label : `${s.label}, ${s.count}`}>
                {s.label}
                {s.count !== null && <span className="go-seg-n">{s.count}</span>}
              </button>
            ))}
          </div>
        </div>

        {loading && (
          <div className="go-task-skel" aria-hidden="true" data-testid="go-members-skeleton">
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="go-task-skel-row"><span className="go-skel-bar" style={{ width: "60%" }} /><span className="go-skel-bar" style={{ width: "30%" }} /></div>
            ))}
          </div>
        )}

        {!loading && rows.length === 0 && (
          <div className="go-task-empty" data-testid="go-members-empty">
            <strong>
              {status === "all"
                ? sales ? "Chi nhánh này chưa có giao dịch gói nào" : "Chi nhánh này chưa có hội viên nào"
                : `Không có ${sales ? "giao dịch" : "hội viên"} nào ở nhóm "${statusLabel(status)}"`}
            </strong>
            <span>
              {status === "all"
                ? sales ? "Khi có người mua gói, giao dịch sẽ xuất hiện ở đây." : "Khi có người mua gói, họ sẽ xuất hiện ở đây."
                : "Chọn nhóm khác hoặc quay lại Tất cả."}
            </span>
            {status !== "all" && <div><button type="button" className="go-btn go-btn-sm" onClick={() => setStatus("all")}>Xem tất cả</button></div>}
          </div>
        )}

        {!loading && rows.length > 0 && (
          <div role="table" className="go-dt" aria-label={sales ? "Giao dịch gói" : "Hội viên"} data-testid="go-members-table" style={{ "--go-cols": sales ? SALES_COLS : FULL_COLS } as React.CSSProperties}>
            <div role="row" className="go-dt-row go-dt-head">
              {sales ? (
                <>
                  <div role="columnheader">Mã giao dịch</div>
                  <div role="columnheader">Gói</div>
                  <div role="columnheader">Trạng thái</div>
                  <div role="columnheader">Hiệu lực</div>
                  <div role="columnheader">Thời hạn</div>
                  <div role="columnheader">Giải phóng tiền</div>
                  <div role="columnheader" className="go-num">Giá lúc mua</div>
                </>
              ) : (
                <>
                  <div role="columnheader">Hội viên</div>
                  <div role="columnheader">Gói</div>
                  <div role="columnheader">Trạng thái</div>
                  <div role="columnheader">Hiệu lực</div>
                  <div role="columnheader">Lượt</div>
                  <div role="columnheader" className="go-num">Giá lúc mua</div>
                </>
              )}
            </div>
            {rows.map((r) => {
              const st = memberStatusTag(r.status);
              const v = validityText(r, nowMs);
              const selected = openId === r.id;
              const label = sales ? (r.paymentTxnId ? `Giao dịch ${r.paymentTxnId}` : "Giao dịch chưa có mã") : memberDisplayName(r);
              return (
                <div key={r.id} role="row" className="go-dt-row" data-selected={selected ? "true" : undefined} aria-current={selected ? "true" : undefined} data-testid="go-member-row" data-row-id={r.id}>
                  <div role="cell" className="go-dt-cell go-dt-first">
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <button type="button" className="go-rowlink" onClick={() => setOpenId(r.id)} aria-label={`Mở chi tiết: ${label}`} data-testid="go-member-open">
                        {sales ? (r.paymentTxnId ?? "Chưa có mã") : memberDisplayName(r)}
                      </button>
                      {!sales && r.memberCode && <span className="go-dt-sub">{r.memberCode}</span>}
                    </div>
                    <span className="go-dt-chev" aria-hidden="true"><CaretRightIcon /></span>
                  </div>
                  <div role="cell" className="go-dt-cell" data-label="Gói">{planNameOf(r.planId, planRows)}</div>
                  <div role="cell" className="go-dt-cell" data-label="Trạng thái"><GoTag tone={st.tone} text={st.text} /></div>
                  <div role="cell" className="go-dt-cell" data-label="Hiệu lực"><span className="go-validity-main">{v.main}</span>{v.sub && <span className="go-dt-sub">{v.sub}</span>}</div>
                  {sales ? (
                    <>
                      <div role="cell" className="go-dt-cell" data-label="Thời hạn">{r.durationDays != null ? `${r.durationDays} ngày` : ""}</div>
                      <div role="cell" className="go-dt-cell" data-label="Giải phóng tiền">{r.payoutReleasedAt ? formatDay(r.payoutReleasedAt) : "Chưa giải phóng"}</div>
                    </>
                  ) : (
                    <div role="cell" className="go-dt-cell" data-label="Lượt">{visitsText(r)}</div>
                  )}
                  <div role="cell" className="go-dt-cell go-money-cell" data-label="Giá lúc mua">{formatVND(r.priceAtPurchase)}</div>
                </div>
              );
            })}
          </div>
        )}

        {!loading && rows.length > 0 && (
          <div className="go-more-row go-more-row-split" data-testid="go-members-more-row">
            <p className="go-list-note go-list-note-bare" data-testid="go-members-note">{pageSummary(rows.length, hasMore, mode, status)}</p>
            {hasMore && (
              <button type="button" className="go-btn go-btn-sm" onClick={() => void list.fetchNextPage()} disabled={list.isFetchingNextPage} data-testid="go-members-more">
                <TextStates value={list.isFetchingNextPage ? "Đang tải" : "Xem thêm"} />
              </button>
            )}
          </div>
        )}
        {list.isFetchNextPageError && (
          <p className="go-field-error go-panel-pad" role="alert" data-testid="go-members-more-error">Không tải được trang tiếp theo. Danh sách đang hiện là phần đã tải, chưa phải toàn bộ.</p>
        )}
        {statsState.state === "error" && (
          <p className="go-hint-text go-panel-pad" data-testid="go-members-stats-error">Chưa tải được số đếm theo nhóm. Danh sách vẫn đúng, chỉ thiếu số.</p>
        )}
        {segments.some((s) => s.count !== null) && (
          <p className="go-hint-text go-panel-pad" data-testid="go-members-stats-note">Số đếm theo nhóm do máy chủ tính cho cả chi nhánh (chỉ thẻ thật), không suy ra từ phần đã tải.</p>
        )}
      </section>

      <MemberDrawer
        row={open}
        mode={mode}
        gymId={gymId}
        gymName={gym?.name ?? "chi nhánh"}
        plans={planRows}
        onClose={() => setOpenId(null)}
      />
    </div>
  );
}
