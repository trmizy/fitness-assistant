/**
 * ACCOUNTANT screen of Đối tác PT: "Hoa hồng PT" (`GET /owner/brands/:brandId/pt-commission?from&gymId`, finance.ptCommission.view O,A).
 * Brand-or-branch: "all branches in scope" sends no `gymId`, one branch narrows it (the server also filters to the accountant's scope).
 * The API returns TOTALS only: expected / recorded / paid (released to the PT's available balance, NOT a bank transfer, audit/03 row 13) /
 * clawed back / referral count, in total and by month. No PT name, no rate: none is drawn. Money digits are never animated.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { gymService } from "../../../services/api";
import { formatVND } from "../../../utils/currency";
import { COMMISSION_PRESET_LABEL, commissionRangeFor, monthLabel, normalizePtCommission, type CommissionPreset, type PtCommissionSummary } from "../../../utils/ptCommission";
import { ScopeStateFrame } from "../scope/PermissionGate";
import { useGymOwnerScope } from "../scope/GymOwnerScopeProvider";
import { ALL_BRANCHES, classifyApiError, goKey } from "../scope/scopeModel";
import { isCurrentScopeData } from "../members/membersModel";
import { COMMISSION_FIELDS, COMMISSION_NOTE, PARTNERS_SUB, PARTNERS_TITLE, isEmptyCommission } from "./partnersModel";

const COLS = "minmax(0, 1.2fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1.1fr) minmax(0, 1fr) 110px";
const PRESETS = Object.keys(COMMISSION_PRESET_LABEL) as CommissionPreset[];

export function CommissionView() {
  const scope = useGymOwnerScope();
  const scopeKey = scope.scopeKey;
  const gymId = scope.gymId;
  const brandId = scope.brandId;
  const [preset, setPreset] = useState<CommissionPreset>("LAST_6");
  const gym = scope.gyms.find((g) => g.id === gymId);

  const query = useQuery<{ scopeKey: string; data: PtCommissionSummary }>({
    queryKey: goKey(scope, "pt-commission", { preset }),
    queryFn: async () => ({
      scopeKey,
      data: normalizePtCommission(await gymService.getPtCommissionSummary(brandId!, { ...commissionRangeFor(preset), ...(gymId === ALL_BRANCHES ? {} : { gymId }) })),
    }),
    enabled: scope.status === "ready" && scope.role === "ACCOUNTANT" && !!brandId,
  });
  const current = !!query.data && isCurrentScopeData(query.data.scopeKey, scopeKey);
  const data = useMemo(() => (current ? query.data!.data : null), [current, query.data]);

  if (query.isError && !query.data) {
    const kind = classifyApiError(query.error);
    if (kind === "forbidden" || kind === "out-of-scope") return <ScopeStateFrame kind={kind} />;
    return (
      <div className="go-state" role="alert" data-testid="go-cm-error">
        <h2>Không tải được hoa hồng PT</h2>
        <p>Đã có lỗi khi tải. Chưa kết luận kỳ này có hay không có hoa hồng.</p>
        <div className="go-state-actions"><button type="button" className="go-btn" data-variant="primary" onClick={() => void query.refetch()}>Thử lại</button></div>
      </div>
    );
  }
  const noBrand = scope.status === "ready" && !brandId;
  const loading = !noBrand && (query.isLoading || scope.status !== "ready" || (!!query.data && !current));

  return (
    <div className="go-wrap go-wrap-wide" data-testid="go-pt-page" data-view="commission">
      <header className="go-page-head">
        <div>
          <h1 data-testid="go-pt-title">{PARTNERS_TITLE.commission}</h1>
          <p className="go-page-sub">{PARTNERS_SUB.commission}</p>
        </div>
      </header>

      <section className="go-panel" aria-label="Hoa hồng giới thiệu PT">
        <div className="go-toolbar">
          <label className="go-field" style={{ flexDirection: "row", alignItems: "center", display: "inline-flex", gap: "var(--go-s2)" }}>
            <span className="go-label">Kỳ</span>
            <select className="go-select" aria-label="Kỳ hoa hồng" value={preset} onChange={(e) => setPreset(e.target.value as CommissionPreset)} data-testid="go-cm-preset">
              {PRESETS.map((k) => <option key={k} value={k}>{COMMISSION_PRESET_LABEL[k]}</option>)}
            </select>
          </label>
          <span className="go-muted-text" data-testid="go-cm-scope">
            {gymId === ALL_BRANCHES ? (scope.gyms.length > 1 ? "Tất cả chi nhánh trong phạm vi của bạn" : "Chi nhánh trong phạm vi của bạn") : `Chi nhánh ${gym?.name ?? ""}`}
          </span>
        </div>

        {noBrand && (
          <div className="go-task-empty" data-testid="go-cm-nobrand">
            <strong>Chưa xác định được thương hiệu</strong>
            <span>Hoa hồng PT tính theo thương hiệu. Liên hệ chủ phòng tập nếu bạn nghĩ đây là nhầm lẫn.</span>
          </div>
        )}

        {loading && (
          <div className="go-task-skel" aria-hidden="true" data-testid="go-cm-skeleton">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="go-task-skel-row"><span className="go-skel-bar" style={{ width: "40%" }} /><span className="go-skel-bar" style={{ width: "30%" }} /></div>
            ))}
          </div>
        )}

        {!loading && data && isEmptyCommission(data) && (
          <div className="go-task-empty" data-testid="go-cm-empty">
            <strong>Chưa có hoa hồng PT</strong>
            <span>Khi hội viên mua gói qua mã giới thiệu của PT, hoa hồng sẽ hiện theo tháng. Chưa có dữ liệu cho kỳ và phạm vi này.</span>
          </div>
        )}

        {!loading && data && !isEmptyCommission(data) && (
          <>
            <div className="go-cm-totals" data-testid="go-cm-totals">
              {COMMISSION_FIELDS.map((f) => (
                <div key={f.key} className="go-cm-total" data-testid={`go-cm-total-${f.key}`}>
                  <span className="go-label">{f.label}</span>
                  <span className="go-money-num">{formatVND(data.totals[f.key])}</span>
                  <span className="go-hint-text">{f.hint}</span>
                </div>
              ))}
              <div className="go-cm-total" data-testid="go-cm-total-referralCount">
                <span className="go-label">Lượt giới thiệu</span>
                <span className="go-money-num">{data.totals.referralCount}</span>
                <span className="go-hint-text">{data.branchCount > 0 ? `Từ ${data.branchCount} chi nhánh` : "Trong kỳ"}</span>
              </div>
            </div>

            {data.byMonth.length === 0 ? (
              <p className="go-list-note">Chưa có hoa hồng theo tháng trong kỳ này.</p>
            ) : (
              <div role="table" className="go-dt" aria-label="Hoa hồng PT theo tháng" data-testid="go-cm-table" style={{ "--go-cols": COLS } as React.CSSProperties}>
                <div role="row" className="go-dt-row go-dt-head">
                  <div role="columnheader">Tháng</div>
                  <div role="columnheader" className="go-num">Dự kiến</div>
                  <div role="columnheader" className="go-num">Đã ghi nhận</div>
                  <div role="columnheader" className="go-num">Đã giải phóng cho PT</div>
                  <div role="columnheader" className="go-num">Đã thu hồi</div>
                  <div role="columnheader" className="go-num">Lượt giới thiệu</div>
                </div>
                {data.byMonth.map((m) => (
                  <div key={m.month} role="row" className="go-dt-row" data-testid="go-cm-row">
                    <div role="cell" className="go-dt-cell go-dt-first"><span className="go-dt-main">{monthLabel(m.month)}</span></div>
                    <div role="cell" className="go-dt-cell go-money-cell" data-label="Dự kiến">{formatVND(m.expected)}</div>
                    <div role="cell" className="go-dt-cell go-money-cell" data-label="Đã ghi nhận">{formatVND(m.recorded)}</div>
                    <div role="cell" className="go-dt-cell go-money-cell" data-label="Đã giải phóng cho PT">{formatVND(m.paid)}</div>
                    <div role="cell" className="go-dt-cell go-money-cell" data-label="Đã thu hồi">{formatVND(m.clawedBack)}</div>
                    <div role="cell" className="go-dt-cell go-money-cell" data-label="Lượt giới thiệu">{m.referralCount}</div>
                  </div>
                ))}
              </div>
            )}

            <details className="go-cm-defs" data-testid="go-cm-defs">
              <summary>Các con số được tính thế nào</summary>
              <ul className="go-rule-list">
                {data.definitions.expected && <li><strong>Dự kiến:</strong> {data.definitions.expected}</li>}
                {data.definitions.recorded && <li><strong>Đã ghi nhận:</strong> {data.definitions.recorded}</li>}
                {data.definitions.paid && <li><strong>Đã giải phóng cho PT:</strong> {data.definitions.paid}</li>}
                {data.definitions.clawedBack && <li><strong>Đã thu hồi:</strong> {data.definitions.clawedBack}</li>}
                {data.definitions.period && <li><strong>Kỳ:</strong> {data.definitions.period}</li>}
              </ul>
            </details>
            <p className="go-list-note" data-testid="go-cm-note">{COMMISSION_NOTE} Khi tiền sang số dư khả dụng của PT thì chưa phải đã chuyển vào ngân hàng.</p>
          </>
        )}
      </section>
    </div>
  );
}
