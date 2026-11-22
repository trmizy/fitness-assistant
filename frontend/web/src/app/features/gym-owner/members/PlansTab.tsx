/**
 * Tab "Gói": plans of the BRAND (`GET /owner/brands/:brandId/plans`, brand-wide on purpose, never filtered by branch).
 * Owner: create in a drawer (no edit: the legacy page has none either) and switch a plan on or off in one click (same `updatePlan(brandId, id, {status})` as before).
 * Manager and accountant: read only, with the reason. No other role reaches this tab.
 */
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ListChecksIcon, PlusIcon } from "@phosphor-icons/react";
import { gymService } from "../../../services/api";
import { formatVND } from "../../../utils/currency";
import { GoTag } from "../../../components/layout/gym-owner/GoTag";
import { GoLink } from "../../../components/layout/gym-owner/GoLink";
import { TextStates } from "../../../components/layout/gym-owner/motion";
import { ScopeStateFrame } from "../scope/PermissionGate";
import { useGymOwnerScope, useScopeChangeEffect } from "../scope/GymOwnerScopeProvider";
import { classifyApiError } from "../scope/scopeModel";
import { PLANS_READONLY_NOTE, planErrorMessage, planLimitText, planStatusTag, plansAccessFor, saleWindowLabel, type PlanRow } from "./membersModel";
import { useBrandPlans } from "./useBrandPlans";
import { PlanDrawer } from "./PlanDrawer";

const COLS = "minmax(0, 1.6fr) 110px minmax(0, 1.4fr) 130px 120px minmax(0, 1.3fr) 140px";

export function PlansTab() {
  const scope = useGymOwnerScope();
  const queryClient = useQueryClient();
  const access = plansAccessFor(scope.role);
  const canEdit = access === "edit";
  const { query, key } = useBrandPlans(true);
  const plans = query.data ?? [];
  const [drawer, setDrawer] = useState(false);
  useScopeChangeEffect(() => setDrawer(false));

  const toggle = useMutation({
    mutationFn: ({ planId, status }: { planId: string; status: "ACTIVE" | "INACTIVE" }) => gymService.updatePlan(scope.brandId!, planId, { status }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: key }),
    onError: (err) => toast.error(planErrorMessage(err, "Không thể cập nhật")),
  });

  if (scope.status === "ready" && !scope.brandId) {
    return (
      <div className="go-state" data-testid="go-plans-nobrand">
        <h2>Chưa có thương hiệu</h2>
        <p>Đặt tên thương hiệu của bạn trước. Mọi gói hội viên đều bán dưới tên thương hiệu và dùng được ở tất cả chi nhánh.</p>
        <div className="go-state-actions"><GoLink to="/gym-owner/gyms" className="go-btn" data-variant="primary">Đi tới Chi nhánh</GoLink></div>
      </div>
    );
  }
  if (query.isError && !query.data) {
    const kind = classifyApiError(query.error);
    return kind === "forbidden" ? (
      <ScopeStateFrame kind="forbidden" />
    ) : (
      <div className="go-state" role="alert" data-testid="go-plans-error">
        <h2>Không tải được danh sách gói</h2>
        <p>Đã có lỗi khi tải. Chưa kết luận thương hiệu có hay không có gói.</p>
        <div className="go-state-actions"><button type="button" className="go-btn" data-variant="primary" onClick={() => void query.refetch()}>Thử lại</button></div>
      </div>
    );
  }
  const loading = query.isLoading || scope.status !== "ready";
  const now = new Date();

  return (
    <div className="go-stack" data-testid="go-plans-tab">
      {!canEdit && <div className="go-note" role="note" data-testid="go-plans-readonly">{PLANS_READONLY_NOTE}</div>}
      <section className="go-panel" aria-label="Gói hội viên của thương hiệu">
        <div className="go-panel-head go-panel-head-row">
          <div>
            <h2>Gói hội viên của thương hiệu</h2>
            <p>Áp dụng toàn thương hiệu, không theo chi nhánh. Khách check-in ở đâu cũng trừ chung một hạn mức lượt.</p>
          </div>
          {canEdit && (
            <button type="button" className="go-btn" data-variant="primary" onClick={() => setDrawer(true)} data-testid="go-plan-add">
              <PlusIcon aria-hidden="true" width={16} height={16} /> Thêm gói
            </button>
          )}
        </div>

        {loading && (
          <div className="go-task-skel" aria-hidden="true" data-testid="go-plans-skeleton">
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="go-task-skel-row"><span className="go-skel-bar" style={{ width: "50%" }} /><span className="go-skel-bar" style={{ width: "30%" }} /></div>
            ))}
          </div>
        )}

        {!loading && plans.length === 0 && (
          <div className="go-task-empty" data-testid="go-plans-empty">
            <ListChecksIcon aria-hidden="true" width={24} height={24} />
            <strong>Thương hiệu chưa có gói nào</strong>
            <span>{canEdit ? 'Chọn "Thêm gói" để tạo gói đầu tiên, khách mới bắt đầu đăng ký hội viên được.' : "Chủ phòng tập cần tạo gói trước."}</span>
          </div>
        )}

        {!loading && plans.length > 0 && (
          <div role="table" className="go-dt" aria-label="Gói hội viên" data-testid="go-plans-table" style={{ "--go-cols": canEdit ? COLS : "minmax(0, 1.6fr) 110px minmax(0, 1.4fr) 130px 120px minmax(0, 1.3fr)" } as React.CSSProperties}>
            <div role="row" className="go-dt-row go-dt-head">
              <div role="columnheader">Tên gói</div>
              <div role="columnheader">Thời hạn</div>
              <div role="columnheader">Giới hạn lượt</div>
              <div role="columnheader" className="go-num">Giá</div>
              <div role="columnheader">Trạng thái</div>
              <div role="columnheader">Khung bán</div>
              {canEdit && <div role="columnheader"><span className="sr-only">Thao tác</span></div>}
            </div>
            {plans.map((p: PlanRow) => {
              const st = planStatusTag(p.status);
              const sale = saleWindowLabel(p, now);
              return (
                <div key={p.id} role="row" className="go-dt-row" data-testid="go-plan-row" data-plan-id={p.id}>
                  <div role="cell" className="go-dt-cell go-dt-first"><span className="go-dt-main">{p.name}</span></div>
                  <div role="cell" className="go-dt-cell" data-label="Thời hạn">{p.durationDays} ngày</div>
                  <div role="cell" className="go-dt-cell" data-label="Giới hạn lượt">{planLimitText(p.visitLimit)}</div>
                  <div role="cell" className="go-dt-cell go-money-cell" data-label="Giá">{formatVND(p.price)}</div>
                  <div role="cell" className="go-dt-cell" data-label="Trạng thái"><GoTag tone={st.tone} text={st.text} /></div>
                  <div role="cell" className="go-dt-cell" data-label="Khung bán">{sale ? <GoTag tone={sale.tone} text={sale.text} /> : <span className="go-muted">Luôn mở bán</span>}</div>
                  {canEdit && (
                    <div role="cell" className="go-dt-cell go-dt-actions">
                      <button
                        type="button"
                        className="go-btn go-btn-sm"
                        onClick={() => toggle.mutate({ planId: p.id, status: p.status === "ACTIVE" ? "INACTIVE" : "ACTIVE" })}
                        disabled={toggle.isPending}
                        aria-label={`${p.status === "ACTIVE" ? "Ngừng bán" : "Mở bán lại"} gói ${p.name}`}
                        data-testid="go-plan-toggle"
                      >
                        <TextStates value={p.status === "ACTIVE" ? "Ngừng bán" : "Mở bán lại"} />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {!loading && plans.length > 0 && <p className="go-list-note">Toàn bộ {plans.length} gói của thương hiệu, không phân trang.</p>}
      </section>

      {canEdit && scope.brandId && (
        <PlanDrawer
          open={drawer}
          brandId={scope.brandId}
          onClose={() => setDrawer(false)}
          onSaved={() => void queryClient.invalidateQueries({ queryKey: key })}
        />
      )}
    </div>
  );
}
