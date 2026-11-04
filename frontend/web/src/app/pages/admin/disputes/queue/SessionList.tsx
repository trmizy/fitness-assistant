import { formatAge } from "../../withdrawals/withdrawalQueue";
import { formatDateTime } from "../workspace/format";
import { CARD, DisputeLink, FOCUS, Pill, QUEUE_PATH } from "../workspace/WorkspaceParts";
import { LegacyRuling } from "./LegacyRuling";
import { OpenCaseButton } from "./OpenCaseButton";
import { SLA_LABEL, SLA_TONE, type SessionRowModel } from "./queueModel";

/** One card per session: the reason and age first, then the primary action, then the demoted legacy ruling. */
export function SessionList({ rows, now, onRefresh }: { rows: SessionRowModel[]; now: number; onRefresh: () => void }) {
  return (
    <ul className="space-y-3" data-testid="d2-session-list" aria-label="Buổi tập đang bị khiếu nại">
      {rows.map((s) => (
        <li key={s.id} className={`${CARD} space-y-3 p-4`} data-testid="d2-session-row" data-session-id={s.id}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-adm-text">Buổi tập lúc {formatDateTime(s.scheduledStartAt)}</p>
              <p className="mt-0.5 text-xs text-adm-text-2">
                {s.clientName ?? "Khách chưa có tên hiển thị"} · {s.ptName ?? "PT chưa có tên hiển thị"}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span data-testid="dispute-type-badge" data-dispute-type={s.disputeType ?? ""}>
                <Pill tone="neutral">{s.typeLabel}</Pill>
              </span>
              {s.sla && (
                <span data-testid="d2-sla-chip" data-sla={s.sla}>
                  <Pill tone={SLA_TONE[s.sla]}>{SLA_LABEL[s.sla]}</Pill>
                </span>
              )}
            </div>
          </div>

          <p className="text-xs text-adm-text-2" data-testid="d2-session-age">
            {s.disputedAt ? `Bị khiếu nại ${formatAge(s.disputedAt, now)} trước (${formatDateTime(s.disputedAt)})` : "Chưa rõ thời điểm khiếu nại"}
          </p>

          {(s.clientReason || s.ptNotes) && <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-adm-border-soft bg-adm-surface-2 p-3">
              <p className="mb-1 text-xs font-semibold text-adm-text-2">PT báo cáo</p>
              <p className="whitespace-pre-wrap break-words text-sm text-adm-text">{s.ptNotes || "(không có ghi chú)"}</p>
            </div>
            <div className="rounded-lg border border-adm-border-soft bg-adm-surface-2 p-3">
              <p className="mb-1 text-xs font-semibold text-adm-text-2">Lý do khách khiếu nại</p>
              <p className="whitespace-pre-wrap break-words text-sm text-adm-text" data-testid="d2-session-reason">
                {s.clientReason || "(không có lý do)"}
              </p>
            </div>
          </div>}

          {s.hasCase && s.caseId ? (
            <DisputeLink to={`${QUEUE_PATH}/${encodeURIComponent(s.caseId)}`} className={`inline-flex min-h-11 items-center rounded-md border border-adm-border bg-adm-surface px-4 text-sm font-medium text-adm-text ${FOCUS}`}>
              Xem hồ sơ đang xử lý
            </DisputeLink>
          ) : s.needsCase !== false ? <OpenCaseButton sessionId={s.id} onRefreshList={onRefresh} /> : <p className="text-sm text-adm-text-2">Buổi này chưa thể mở hồ sơ. Hãy tải lại danh sách.</p>}
          {!s.hasCase && s.sessionStatus !== "PT_NO_SHOW_REPORTED" && <LegacyRuling session={s} onDone={onRefresh} />}
        </li>
      ))}
    </ul>
  );
}
