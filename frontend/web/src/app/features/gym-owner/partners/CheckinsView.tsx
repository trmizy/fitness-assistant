/**
 * MANAGER screen of Đối tác PT: "PT check-in tại chi nhánh" (`GET /owner/gyms/:gymId/pt-checkins`, ptCheckin.list O,M). A branch
 * screen (the scope strip picks the branch). The server returns the latest 50 only and does not page, and the page says so. It never
 * calls `GET /owner/collaborations` (owner only) and shows no rate, no contract, no client.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { gymService } from "../../../services/api";
import { ScopeStateFrame } from "../scope/PermissionGate";
import { useGymOwnerScope } from "../scope/GymOwnerScopeProvider";
import { ALL_BRANCHES, classifyApiError, goKey } from "../scope/scopeModel";
import { isCurrentScopeData } from "../members/membersModel";
import { PARTNERS_SUB, PARTNERS_TITLE, PT_CHECKIN_SCAN_LABEL, PT_CHECKIN_WINDOW, ptCheckinNote, ptCheckinRows } from "./partnersModel";

const COLS = "minmax(0, 1.8fr) minmax(0, 1.4fr) 140px";

export function CheckinsView() {
  const scope = useGymOwnerScope();
  const gymId = scope.gymId;
  const scopeKey = scope.scopeKey;
  const gym = scope.gyms.find((g) => g.id === gymId);

  const query = useQuery<{ scopeKey: string; raw: unknown }>({
    queryKey: goKey(scope, "pt-checkins"),
    queryFn: async () => ({ scopeKey, raw: await gymService.listPtCheckins(gymId) }),
    enabled: scope.status === "ready" && scope.role === "MANAGER" && gymId !== ALL_BRANCHES,
  });
  const current = !!query.data && isCurrentScopeData(query.data.scopeKey, scopeKey);
  const rows = useMemo(() => (current ? ptCheckinRows(query.data?.raw) : []), [current, query.data]);

  if (query.isError && !query.data) {
    const kind = classifyApiError(query.error);
    if (kind === "forbidden" || kind === "out-of-scope") return <ScopeStateFrame kind={kind} />;
    return (
      <div className="go-state" role="alert" data-testid="go-ptc-error">
        <h2>Không tải được lượt PT check-in</h2>
        <p>Đã có lỗi khi tải. Chưa kết luận chi nhánh này có hay không có lượt PT check-in.</p>
        <div className="go-state-actions"><button type="button" className="go-btn" data-variant="primary" onClick={() => void query.refetch()}>Thử lại</button></div>
      </div>
    );
  }
  const loading = query.isLoading || scope.status !== "ready" || (!!query.data && !current);

  return (
    <div className="go-wrap go-wrap-wide" data-testid="go-pt-page" data-view="checkins">
      <header className="go-page-head">
        <div>
          <h1 data-testid="go-pt-title">{PARTNERS_TITLE.checkins}</h1>
          <p className="go-page-sub">{PARTNERS_SUB.checkins}</p>
        </div>
      </header>
      <section className="go-panel" aria-label="PT check-in tại chi nhánh">
        <div className="go-panel-head">
          <h2>{gym ? `PT đã check-in tại ${gym.name}` : "PT đã check-in tại chi nhánh"}</h2>
          <p>Mỗi dòng là một ngày PT có mặt tại quầy (quét mã QR của chi nhánh).</p>
        </div>

        {loading && (
          <div className="go-task-skel" aria-hidden="true" data-testid="go-ptc-skeleton">
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="go-task-skel-row"><span className="go-skel-bar" style={{ width: "45%" }} /><span className="go-skel-bar" style={{ width: "25%" }} /></div>
            ))}
          </div>
        )}

        {!loading && rows.length === 0 && (
          <div className="go-task-empty" data-testid="go-ptc-empty">
            <strong>Chưa có lượt PT check-in nào</strong>
            <span>PT quét mã QR tại quầy của chi nhánh sẽ hiện ở đây.</span>
          </div>
        )}

        {!loading && rows.length > 0 && (
          <div role="table" className="go-dt" aria-label="PT check-in" data-testid="go-ptc-table" style={{ "--go-cols": COLS } as React.CSSProperties}>
            <div role="row" className="go-dt-row go-dt-head">
              <div role="columnheader">PT</div>
              <div role="columnheader">Lần quét đầu</div>
              <div role="columnheader">Số lần quét</div>
            </div>
            {rows.map((r) => (
              <div key={r.id} role="row" className="go-dt-row" data-testid="go-ptc-row">
                <div role="cell" className="go-dt-cell go-dt-first"><span className="go-dt-main">{r.ptName}</span></div>
                <div role="cell" className="go-dt-cell" data-label="Lần quét đầu">{r.when}</div>
                <div role="cell" className="go-dt-cell" data-label="Số lần quét">{PT_CHECKIN_SCAN_LABEL(r.scanCount)}</div>
              </div>
            ))}
          </div>
        )}
        {!loading && rows.length > 0 && <p className="go-list-note" data-testid="go-ptc-note" data-capped={rows.length >= PT_CHECKIN_WINDOW ? "true" : "false"}>{ptCheckinNote(rows.length)}</p>}
      </section>
    </div>
  );
}
