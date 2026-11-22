/**
 * Tab "Hội viên": the memberships of ONE branch (`GET /owner/gyms/:gymId/memberships`, no pagination). Search by name, status
 * segments with counts, plan filter and sort all run on the loaded list and the note under the table says so.
 * Owner / manager: FULL rows. Accountant: SALES rows (no name, no identity, no desk link). Row click opens the member drawer.
 * Data is drawn only when it was fetched for the scope on screen (05 section 6.7) and is never kept between two branches.
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CaretRightIcon } from "@phosphor-icons/react";
import { gymService } from "../../../services/api";
import { formatVND } from "../../../utils/currency";
import { GoTag } from "../../../components/layout/gym-owner/GoTag";
import { GoSearch } from "../../../components/layout/gym-owner/GoSearch";
import { ScopeStateFrame } from "../scope/PermissionGate";
import { useGymOwnerScope, useScopeChangeEffect } from "../scope/GymOwnerScopeProvider";
import { classifyApiError, goKey } from "../scope/scopeModel";
import {
  DEFAULT_MEMBER_FILTERS,
  MEMBER_SORTS,
  SALES_MODE_NOTE,
  applyMemberView,
  formatDay,
  hasActiveFilters,
  isCurrentScopeData,
  listSummary,
  memberDisplayName,
  memberStatusTag,
  membersModeFor,
  normalizeMemberships,
  parseMemberSort,
  statusSegments,
  validityText,
  visitsText,
  planNameOf,
  type MemberFilters,
  type MemberRow,
} from "./membersModel";
import { useBrandPlans } from "./useBrandPlans";
import { MemberDrawer } from "./MemberDrawer";

/** The value follows the input after `ms` of quiet; an empty value applies at once (clearing must not lag behind the dissolve). */
function useDebounced(value: string, ms: number): string {
  const [v, setV] = useState(value);
  useEffect(() => {
    if (value === "") {
      setV("");
      return;
    }
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

const FULL_COLS = "minmax(0, 2fr) minmax(0, 1.3fr) 150px minmax(0, 1.2fr) 160px 130px";
const SALES_COLS = "minmax(0, 1.6fr) minmax(0, 1.3fr) 150px minmax(0, 1.4fr) 100px 130px 130px";

export function MembersTab() {
  const scope = useGymOwnerScope();
  const mode = membersModeFor(scope.role);
  const gymId = scope.gymId;
  const sales = mode === "sales";
  const plans = useBrandPlans(true);
  const planRows = plans.query.data ?? [];

  const [filters, setFilters] = useState<MemberFilters>(DEFAULT_MEMBER_FILTERS);
  const [typed, setTyped] = useState("");
  const q = useDebounced(typed, 250);
  const [openId, setOpenId] = useState<string | null>(null);

  // Scope change: drawer closed, selected row dropped, typed input cleared (05 section 6.4). Nothing here is a form with unsaved work.
  useScopeChangeEffect(() => {
    setOpenId(null);
    setTyped("");
    setFilters(DEFAULT_MEMBER_FILTERS);
  });

  const scopeKey = scope.scopeKey;
  const query = useQuery<{ scopeKey: string; raw: unknown }>({
    queryKey: goKey(scope, "members"),
    queryFn: async () => ({ scopeKey, raw: await gymService.listOwnedMemberships(gymId) }),
    enabled: mode !== "none" && gymId !== "ALL" && scope.status === "ready",
  });

  const rows = useMemo<MemberRow[]>(() => (query.data && isCurrentScopeData(query.data.scopeKey, scopeKey) ? normalizeMemberships(query.data.raw, mode) : []), [query.data, scopeKey, mode]);
  const view = useMemo(() => applyMemberView(rows, { ...filters, q }, mode), [rows, filters, q, mode]);
  const segs = useMemo(() => statusSegments(rows), [rows]);
  const nowMs = Date.now();
  const open = openId ? (rows.find((r) => r.id === openId) ?? null) : null;

  if (query.isError && !query.data) {
    const kind = classifyApiError(query.error);
    return kind === "forbidden" || kind === "out-of-scope" ? (
      <ScopeStateFrame kind={kind} />
    ) : (
      <div className="go-state" role="alert" data-testid="go-members-error">
        <h2>Không tải được danh sách hội viên</h2>
        <p>Đã có lỗi khi tải. Chưa kết luận chi nhánh này có hay không có hội viên.</p>
        <div className="go-state-actions"><button type="button" className="go-btn" data-variant="primary" onClick={() => void query.refetch()}>Thử lại</button></div>
      </div>
    );
  }

  const loading = query.isLoading || scope.status !== "ready" || (!!query.data && !isCurrentScopeData(query.data.scopeKey, scopeKey));
  const gym = scope.gyms.find((g) => g.id === gymId);

  return (
    <div className="go-stack" data-testid="go-members-tab">
      {sales && (
        <div className="go-note go-sales-note" role="note" data-testid="go-sales-note">{SALES_MODE_NOTE}</div>
      )}
      <section className="go-panel" aria-label={sales ? "Giao dịch của chi nhánh" : "Hội viên của chi nhánh"}>
        <div className="go-toolbar">
          <GoSearch value={typed} onChange={setTyped} placeholder={sales ? "Tìm mã giao dịch" : "Tìm hội viên theo tên"} ariaLabel={sales ? "Tìm theo mã giao dịch" : "Tìm hội viên theo tên"} testId="go-members-search" />
          <div className="go-toolbar-end">
            <select className="go-select" aria-label="Lọc theo gói" value={filters.planId} onChange={(e) => setFilters((f) => ({ ...f, planId: e.target.value }))} data-testid="go-members-plan">
              <option value="all">Tất cả gói</option>
              {planRows.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <select className="go-select" aria-label="Sắp xếp" value={filters.sort} onChange={(e) => setFilters((f) => ({ ...f, sort: parseMemberSort(e.target.value) }))} data-testid="go-members-sort">
              {MEMBER_SORTS.map((s) => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="go-toolbar-row">
          <div className="go-seg" role="group" aria-label="Lọc theo trạng thái" data-testid="go-members-seg">
            {segs.map((s) => (
              <button key={s.id} type="button" aria-pressed={filters.status === s.id} onClick={() => setFilters((f) => ({ ...f, status: s.id }))} data-seg={s.id}>
                {s.label}
                <span className="go-seg-n">{s.count}</span>
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
            <strong>{sales ? "Chi nhánh này chưa có giao dịch gói nào" : "Chi nhánh này chưa có hội viên nào"}</strong>
            <span>{sales ? "Khi có người mua gói, giao dịch sẽ xuất hiện ở đây." : "Khi có người mua gói, họ sẽ xuất hiện ở đây."}</span>
          </div>
        )}

        {!loading && rows.length > 0 && view.length === 0 && (
          <div className="go-task-empty" data-testid="go-members-nomatch">
            <strong>Không có {sales ? "giao dịch" : "hội viên"} nào khớp bộ lọc</strong>
            <span>Thử bỏ bớt bộ lọc hoặc đổi từ khoá tìm kiếm.</span>
            {hasActiveFilters({ ...filters, q }) && (
              <div><button type="button" className="go-btn go-btn-sm" onClick={() => { setTyped(""); setFilters(DEFAULT_MEMBER_FILTERS); }}>Xoá bộ lọc</button></div>
            )}
          </div>
        )}

        {!loading && view.length > 0 && (
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
            {view.map((r) => {
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
                  <div role="cell" className="go-dt-cell" data-label="Hiệu lực">{v.main}{v.sub && <span className="go-dt-sub">{v.sub}</span>}</div>
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

        {!loading && rows.length > 0 && <p className="go-list-note" data-testid="go-members-note">{listSummary(view.length, rows.length, mode)}</p>}
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
