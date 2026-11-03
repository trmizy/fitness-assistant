import { ArrowClockwiseIcon, ArrowSquareOutIcon } from "@phosphor-icons/react";
import { Button } from "../../../../../components/ui/button";
import type { DisputeCaseDetail } from "../../disputeCaseTypes";
import { formatDateTime } from "../format";
import { NO_SETTLEMENT_TEXT, describeMoneyTab } from "../workspaceModel";
import { CARD, DisputeLink, EmptyBox, FOCUS, Muted, Notice, Pill } from "../WorkspaceParts";

const RECONCILIATION_PATH = "/admin/finance/reconciliation";

/** M5. The only actions are "Tải lại" and a link to the reconciliation report: no refund, no payout, no arithmetic. */
export function MoneyTab({ detail, onReload, reloading }: { detail: DisputeCaseDetail; onReload: () => void; reloading: boolean }) {
  const view = describeMoneyTab(detail);
  return (
    <div className="space-y-4" data-testid="d2-tab-money">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {view && (
            <span data-testid="d2-money-group">
              <Pill tone={view.group.tone}>{view.group.label}</Pill>
            </span>
          )}
          {view?.observedAt && <span className="text-xs text-adm-text-2">Đọc sổ cái lúc {formatDateTime(view.observedAt)}</span>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onReload} disabled={reloading} aria-busy={reloading} className="min-h-11 xl:min-h-8" data-testid="d2-money-reload">
            <ArrowClockwiseIcon aria-hidden className={reloading ? "animate-spin" : ""} /> Tải lại
          </Button>
          <DisputeLink
            to={RECONCILIATION_PATH}
            data-testid="d2-money-recon-link"
            className={`inline-flex min-h-11 items-center gap-1.5 rounded-md border border-adm-border bg-adm-surface px-3 text-sm font-medium text-adm-text hover:bg-adm-surface-2 xl:min-h-8 ${FOCUS}`}
          >
            Xem báo cáo đối soát <ArrowSquareOutIcon className="size-4" aria-hidden />
          </DisputeLink>
        </div>
      </div>

      <Muted>
        Đây là cách đọc từ sổ cái, không lưu trong hồ sơ. «Đã ghi vào ví Gymini» là bút toán ví nội bộ, không phải chuyển khoản ngân hàng. Hồ sơ xong không có nghĩa là tiền đã chuyển.
      </Muted>

      {!view ? (
        <Notice tone="danger" role="alert" testId="d2-money-missing">
          Chưa đọc được thông tin tiền của hồ sơ này. Bấm «Tải lại» để đọc lại.
        </Notice>
      ) : (
        <>
          {view.unavailableGroup && (
            <Notice tone="danger" role="alert" testId="d2-money-unavailable">
              Chưa đọc được sổ cái nên chưa biết tiền của buổi này đã ghi tới đâu. Đây không phải 0 đ. Bấm «Tải lại» để đọc lại.
            </Notice>
          )}
          {view.noRecordedSettlement && (
            <Notice tone="info" testId="d2-money-no-settlement">
              {NO_SETTLEMENT_TEXT}
            </Notice>
          )}
          {view.items.length === 0 && !view.noRecordedSettlement && !view.unavailableGroup && <EmptyBox>Chưa có bước tiền nào để hiển thị.</EmptyBox>}
          <ul className="space-y-3">
            {view.items.map((item) => (
              <li key={item.key} className={`${CARD} space-y-2 p-4`} data-testid="d2-money-item" data-money-group={item.description.group}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-adm-text">{item.title}</h3>
                  <Pill tone={item.description.tone}>{item.description.label}</Pill>
                </div>
                {item.description.detail && <p className="text-sm text-adm-text">{item.description.detail}</p>}
                {item.amounts.length > 0 && (
                  <dl className="grid grid-cols-3 gap-3 text-sm" data-testid="d2-money-amounts">
                    {item.amounts.map((a) => (
                      <div key={a.label} className="min-w-0">
                        <dt className="text-xs text-adm-text-2">{a.label}</dt>
                        <dd className="break-words font-semibold tabular-nums text-adm-text">{a.value}</dd>
                      </div>
                    ))}
                  </dl>
                )}
                {item.unavailableText && <p className="text-sm text-st-danger">{item.unavailableText}</p>}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
