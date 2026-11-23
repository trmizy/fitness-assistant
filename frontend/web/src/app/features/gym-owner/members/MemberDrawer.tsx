/**
 * Member drawer (07 panel-reveal). Plan and validity, visits, and the member's recent check-ins taken from the branch's latest 50
 * (`GET /owner/gyms/:gymId/checkins`, limit stated). Refunds are Gymini's: said, never a button. "Xem tại quầy" only for the roles
 * that may open the desk. Sales view (accountant): transaction facts only, no name, no check-ins, no desk link.
 */
import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { gymService } from "../../../services/api";
import { formatVND } from "../../../utils/currency";
import { GoTag } from "../../../components/layout/gym-owner/GoTag";
import { GoLink } from "../../../components/layout/gym-owner/GoLink";
import { DrawerSection, GoDrawer } from "../../../components/layout/gym-owner/GoDrawer";
import { useGymOwnerScope } from "../scope/GymOwnerScopeProvider";
import { branchCodes, goKey } from "../scope/scopeModel";
import { frontDeskHref } from "../front-desk/frontDeskModel";
import {
  CHECKIN_LIMIT_NOTE,
  canOpenFrontDesk,
  checkinSourceLabel,
  checkinsOfMember,
  formatDay,
  formatStamp,
  memberDisplayName,
  memberStatusTag,
  planNameOf,
  validityText,
  visitsText,
  type MemberRow,
  type MembersMode,
  type PlanRow,
} from "./membersModel";

export function MemberDrawer({ row, mode, gymId, gymName, plans, onClose }: { row: MemberRow | null; mode: MembersMode; gymId: string; gymName: string; plans: PlanRow[]; onClose: () => void }) {
  const scope = useGymOwnerScope();
  // Keep the last row while the closing animation runs, so the panel does not empty before it leaves.
  const last = useRef<MemberRow | null>(null);
  useEffect(() => {
    if (row) last.current = row;
  }, [row]);
  const shown = row ?? last.current;
  const sales = mode === "sales";

  const checkinsQ = useQuery<{ scopeKey: string; raw: unknown }>({
    queryKey: goKey(scope, "checkins"),
    queryFn: async () => ({ scopeKey: scope.scopeKey, raw: await gymService.listCheckins(gymId) }),
    enabled: !!row && !sales && gymId !== "ALL",
  });

  if (!shown) return null;
  const st = memberStatusTag(shown.status);
  const v = validityText(shown, Date.now());
  const code = branchCodes(scope.gyms)[gymId];
  const items = checkinsQ.data && checkinsQ.data.scopeKey === scope.scopeKey ? checkinsOfMember(checkinsQ.data.raw, shown) : [];
  const title = sales ? (shown.paymentTxnId ? `Giao dịch ${shown.paymentTxnId}` : "Giao dịch chưa có mã") : memberDisplayName(shown);

  return (
    <GoDrawer
      open={!!row}
      onClose={onClose}
      title={title}
      description={sales ? "Chi tiết một giao dịch gói, không có thông tin định danh hội viên." : "Chi tiết hội viên: gói, hiệu lực, lượt dùng và check-in gần đây."}
      testId="go-member-drawer"
      meta={
        <>
          <GoTag tone={st.tone} text={st.text} />
          {code && <span className="go-code-chip" aria-hidden="true">{code}</span>}
          <span>{gymName}</span>
          {!sales && shown.memberCode && <span className="go-muted">{shown.memberCode}</span>}
        </>
      }
      footer={
        <>
          {!sales && canOpenFrontDesk(scope.can) && (
            <GoLink to={frontDeskHref(gymId, "checkin", shown.memberCode)} className="go-btn" data-variant="primary" data-testid="go-member-desk">Xem tại quầy</GoLink>
          )}
          <p data-testid="go-member-refund-note">Hoàn tiền hội viên do Gymini xử lý.</p>
        </>
      }
    >
      <DrawerSection title="Gói và hiệu lực">
        <dl className="go-kv">
          <div><dt>Gói</dt><dd>{planNameOf(shown.planId, plans)}</dd></div>
          <div><dt>Hiệu lực</dt><dd>{v.main}{v.sub ? `, ${v.sub}` : ""}</dd></div>
          <div><dt>Giá lúc mua</dt><dd>{formatVND(shown.priceAtPurchase)}</dd></div>
          {sales && shown.durationDays != null && <div><dt>Thời hạn</dt><dd>{shown.durationDays} ngày</dd></div>}
          {sales && <div><dt>Tiền gói</dt><dd>{shown.payoutReleasedAt ? `Giải phóng ${formatDay(shown.payoutReleasedAt)}` : "Chưa giải phóng"}</dd></div>}
        </dl>
        <p className="go-dsec-note">Giá lúc mua là giá đã chụp khi mua, không đổi khi gói đổi giá.</p>
      </DrawerSection>

      {!sales && (
        <DrawerSection title="Lượt sử dụng">
          <p>{shown.totalVisits != null ? `Đã dùng ${shown.usedVisits} trên ${shown.totalVisits} lượt` : `Không giới hạn lượt, đã vào ${shown.usedVisits} lần`}</p>
          <p className="go-dsec-note">{visitsText(shown)} (dùng chung mọi chi nhánh của thương hiệu).</p>
        </DrawerSection>
      )}

      {!sales && (
        <DrawerSection title="Check-in gần đây tại chi nhánh này">
          {checkinsQ.isLoading && <p className="go-muted" data-testid="go-member-checkins-loading">Đang tải check-in…</p>}
          {checkinsQ.isError && <p className="go-field-error" role="alert">Không tải được check-in của chi nhánh. Không kết luận là chưa có lượt nào.</p>}
          {!checkinsQ.isLoading && !checkinsQ.isError && items.length === 0 && <p className="go-muted" data-testid="go-member-checkins-empty">Không có lượt nào của hội viên này trong 50 lượt gần nhất của chi nhánh.</p>}
          {items.length > 0 && (
            <ul className="go-ci-list" data-testid="go-member-checkins">
              {items.map((c) => (
                <li key={c.id}><span>{formatStamp(c.at)}</span><span>{checkinSourceLabel(c.source)}</span></li>
              ))}
            </ul>
          )}
          <p className="go-dsec-note" data-testid="go-member-checkins-limit">{CHECKIN_LIMIT_NOTE}</p>
        </DrawerSection>
      )}
    </GoDrawer>
  );
}
