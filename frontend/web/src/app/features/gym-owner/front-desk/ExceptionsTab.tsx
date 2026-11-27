/**
 * Tab "Ngoại lệ": today's check-in exception requests of the branch (`GET .../front-desk/exceptions`, refreshed every 8 s like the
 * legacy panel). A row opens the drawer (`?exception=<id>` in the URL, so Hôm nay can link straight to one). The receptionist's list
 * is the server's own: only their requests. "Xin ngoại lệ" starts in the check-in tab because a request needs a picked member
 * (the request itself is the legacy flow of AssistedCheckinPanel, unchanged).
 */
import { useState } from "react";
import { CaretRightIcon } from "@phosphor-icons/react";
import type { ExceptionRow } from "../../../utils/assistedCheckin";
import { GoTag } from "../../../components/layout/gym-owner/GoTag";
import { GoLink } from "../../../components/layout/gym-owner/GoLink";
import { formatStamp } from "../members/membersModel";
import { exceptionTag, exceptionsHeading, expiryText, filterExceptions, frontDeskHref, isOpenPending, pendingCount, type ExceptionFilter } from "./frontDeskModel";

const COLS = "minmax(0, 1.5fr) minmax(0, 1fr) minmax(0, 1.8fr) 120px 150px 130px";

export function ExceptionsTab({
  gymId,
  canApprove,
  rows,
  loading,
  failed,
  onRetry,
  openId,
  onOpen,
}: {
  gymId: string;
  canApprove: boolean;
  rows: ExceptionRow[];
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
  openId: string | null;
  onOpen: (id: string) => void;
}) {
  const nowMs = Date.now();
  const pend = pendingCount(rows, nowMs);
  const [filterChoice, setFilterChoice] = useState<ExceptionFilter | null>(null);
  const filter: ExceptionFilter = filterChoice ?? (pend > 0 ? "pending" : "all");
  const view = filterExceptions(rows, filter, nowMs);
  const head = exceptionsHeading(canApprove);

  return (
    <section className="go-panel" aria-labelledby="go-h-exc" data-testid="go-exceptions-tab">
      <div className="go-panel-head go-panel-head-row">
        <div>
          <h2 id="go-h-exc">{head.title}</h2>
          <p>{head.sub}</p>
        </div>
        <GoLink to={frontDeskHref(gymId, "checkin")} className="go-btn go-btn-sm" data-testid="go-exception-request">Xin ngoại lệ</GoLink>
      </div>
      <p className="go-panel-note go-muted-text">Để xin ngoại lệ, tìm hội viên ở tab Tìm &amp; check-in, chọn họ rồi chọn "Xin quản lý duyệt ngoại lệ".</p>

      {failed && (
        <div className="go-notice" data-tone="risk" role="alert" data-testid="go-exceptions-error">
          <span>Không tải được danh sách ngoại lệ. Chưa kết luận là không có yêu cầu nào.</span>
          <button type="button" className="go-btn go-btn-sm" onClick={onRetry}>Thử lại</button>
        </div>
      )}

      {loading && (
        <div className="go-task-skel" aria-hidden="true" data-testid="go-exceptions-skeleton">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="go-task-skel-row"><span className="go-skel-bar" style={{ width: "55%" }} /><span className="go-skel-bar" style={{ width: "30%" }} /></div>
          ))}
        </div>
      )}

      {!loading && !failed && rows.length === 0 && (
        <div className="go-task-empty" data-testid="go-exceptions-empty">
          <strong>Chưa có ngoại lệ nào hôm nay</strong>
          <span>Khi lễ tân hoặc quản lý xin ngoại lệ, yêu cầu sẽ hiện ở đây.</span>
        </div>
      )}

      {!loading && rows.length > 0 && (
        <>
          <div className="go-toolbar-row">
            <div className="go-seg" role="group" aria-label="Lọc ngoại lệ">
              <button type="button" aria-pressed={filter === "pending"} onClick={() => setFilterChoice("pending")}>Chờ duyệt<span className="go-seg-n">{pend}</span></button>
              <button type="button" aria-pressed={filter === "all"} onClick={() => setFilterChoice("all")}>Tất cả<span className="go-seg-n">{rows.length}</span></button>
            </div>
          </div>
          {view.length === 0 ? (
            <div className="go-task-empty"><strong>Không có ngoại lệ nào đang chờ duyệt</strong><span>Chọn "Tất cả" để xem cả các yêu cầu đã xử lý hoặc hết hạn.</span></div>
          ) : (
            <div role="table" className="go-dt" aria-label="Ngoại lệ check-in" data-testid="go-exceptions-table" style={{ "--go-cols": COLS } as React.CSSProperties}>
              <div role="row" className="go-dt-row go-dt-head">
                <div role="columnheader">Hội viên</div>
                <div role="columnheader">Người xin</div>
                <div role="columnheader">Lý do</div>
                <div role="columnheader">Tạo lúc</div>
                <div role="columnheader">Hết hạn</div>
                <div role="columnheader">Trạng thái</div>
              </div>
              {view.map((e) => {
                const tag = exceptionTag(e.status);
                const expiredPending = e.status === "PENDING" && !isOpenPending(e, nowMs);
                const selected = openId === e.id;
                return (
                  <div key={e.id} role="row" className="go-dt-row" data-selected={selected ? "true" : undefined} aria-current={selected ? "true" : undefined} data-testid="go-exception-row" data-exception-id={e.id}>
                    <div role="cell" className="go-dt-cell go-dt-first">
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <button type="button" className="go-rowlink" onClick={() => onOpen(e.id)} aria-label={`Mở ngoại lệ của ${e.displayName}`} data-testid="go-exception-open">{e.displayName}</button>
                        {e.memberCode && <span className="go-dt-sub">{e.memberCode}</span>}
                      </div>
                      <span className="go-dt-chev" aria-hidden="true"><CaretRightIcon /></span>
                    </div>
                    <div role="cell" className="go-dt-cell" data-label="Người xin">{e.requestedByName}{e.mine ? " (bạn)" : ""}</div>
                    <div role="cell" className="go-dt-cell" data-label="Lý do">{e.requestReason}</div>
                    <div role="cell" className="go-dt-cell" data-label="Tạo lúc">{formatStamp(e.createdAt)}</div>
                    <div role="cell" className="go-dt-cell" data-label="Hết hạn">{expiryText(e, nowMs)}</div>
                    <div role="cell" className="go-dt-cell" data-label="Trạng thái"><GoTag tone={expiredPending ? "neutral" : tag.tone} text={expiredPending ? "Quá hạn" : tag.text} /></div>
                  </div>
                );
              })}
            </div>
          )}
          <p className="go-list-note">Toàn bộ {rows.length} yêu cầu hôm nay máy chủ trả về cho chi nhánh. Danh sách tự cập nhật.</p>
        </>
      )}
    </section>
  );
}
