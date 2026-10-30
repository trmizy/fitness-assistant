import { useRef, useState, type MouseEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  CaretDownIcon,
  CheckCircleIcon,
  CircleNotchIcon,
  ClockIcon,
  CopyIcon,
  InfoIcon,
  XCircleIcon,
} from "@phosphor-icons/react";
import { personalizedServiceApi } from "../../../services/api";
import { Button } from "../../../components/ui/button";
import { MoneyActionDialog } from "../shared/MoneyActionDialog";
import { describeAdminError, useAdminError } from "../shared/useAdminError";
import { checkRefundAmount, hasText, moneyText } from "../shared/moneyGuards";
import { ErrorBlock } from "./ErrorBlock";
import { formatAge, isFinalRefund, shortId, type ServiceRefundOrder } from "./refundQueue";

/**
 * B6a — one service-refund request of the worklist. It keeps every B1 money behaviour of the former
 * `RefundCaseCard`: approve goes through MoneyActionDialog (who / how much / which wallet bucket) and is blocked
 * client-side unless the amount is in (0, refundableCeiling] (the backend stays authoritative); deny needs a note and
 * a confirmation; the row owns its pending state (one POST per confirmation, no automatic retry); a 409/400 "stale"
 * answer re-fetches the list and the calculation and toasts; the calculation shows an error (not "empty") when it
 * fails. Same endpoints, same payloads, same test ids.
 *
 * Layout: one DOM tree. From `xl` it is a row of a 6-column table (ARIA table roles, header row in the parent);
 * below `xl` it stacks into a card whose cells carry their own small label. The decision panel opens under the row.
 */

export const REFUND_LIST_KEY = ["refund-requests"] as const;
/** Same template for the header row and the data rows. */
export const REFUND_ROW_GRID =
  "xl:grid-cols-[minmax(0,200px)_minmax(0,1fr)_minmax(0,128px)_minmax(0,92px)_minmax(0,148px)_minmax(0,156px)]";

const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--adm-focus)]";
const CELL_LABEL = "text-[11px] font-medium text-adm-text-2 xl:hidden";

function formatDateTime(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return (
    d.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" }) +
    " " +
    d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })
  );
}

function CopyId({ id, label }: { id: string; label: string }) {
  if (!id) return null;
  async function copy() {
    try {
      await navigator.clipboard.writeText(id);
      toast.success("Đã sao chép mã đầy đủ");
    } catch {
      toast.error("Không sao chép được — hãy chọn và sao chép thủ công.");
    }
  }
  return (
    <button
      type="button"
      onClick={copy}
      aria-label={label}
      title={`${label}: ${id}`}
      data-testid="admin-refund-copy-id"
      className={`inline-grid size-9 place-items-center rounded-md text-adm-text-2 hover:bg-adm-surface-2 hover:text-adm-text xl:size-6 ${FOCUS}`}
    >
      <CopyIcon className="size-3.5" aria-hidden />
    </button>
  );
}

function IdLine({ label, id, copyLabel }: { label: string; id: string; copyLabel: string }) {
  return (
    <p className="flex items-center gap-0.5 whitespace-nowrap text-xs text-adm-text-2">
      <span>
        {label} <span className="font-mono tabular-nums">{id ? shortId(id) : "—"}</span>
      </span>
      <CopyId id={id} label={copyLabel} />
    </p>
  );
}

export function RefundStatusPill() {
  return (
    <span
      data-testid="admin-refund-status-pill"
      className="inline-flex items-start gap-1 rounded-full border border-st-pending-border bg-st-pending-bg px-2 py-0.5 text-[11px] font-semibold leading-snug text-st-pending"
    >
      <ClockIcon className="mt-px size-3 shrink-0" weight="bold" aria-hidden />
      <span>Chờ xử lý hoàn tiền</span>
    </span>
  );
}

export function ServiceRefundRow({
  item,
  now,
  onActionDone,
}: {
  item: ServiceRefundOrder;
  now: number;
  onActionDone?: () => void;
}) {
  const queryClient = useQueryClient();
  const { report } = useAdminError();
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [approveOpen, setApproveOpen] = useState(false);
  const [denyOpen, setDenyOpen] = useState(false);

  // The dialogs are controlled (no Radix trigger), so Radix has nowhere to return focus to: do it here.
  const openerRef = useRef<HTMLElement | null>(null);
  const remember = (e: MouseEvent<HTMLElement>) => {
    openerRef.current = e.currentTarget;
  };
  const returnFocus = () => {
    window.setTimeout(() => {
      const el = openerRef.current;
      if (el && el.isConnected && !(el as HTMLButtonElement).disabled) el.focus();
    }, 0);
  };

  const calcKey = ["refund-calculation", item.id] as const;
  const calcQuery = useQuery({
    queryKey: calcKey,
    queryFn: () => personalizedServiceApi.getRefundCalculation(item.id),
    enabled: expanded,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: REFUND_LIST_KEY });
    queryClient.invalidateQueries({ queryKey: calcKey });
  };

  const approveMutation = useMutation({
    mutationFn: (refundAmount: number) => personalizedServiceApi.adminResolveRefund(item.id, { decision: "APPROVE", refundAmount, note }),
    onSuccess: (resolved) => {
      toast.success(resolved.status === "REFUNDED" ? "Đã hoàn tiền đầy đủ vào ví khách hàng." : "Đã hoàn tiền một phần vào ví khách hàng — đơn hàng tiếp tục.");
      onActionDone?.();
      invalidate();
    },
    onError: (err) => report(err, { action: "write", toast: "stale", invalidate: [[...REFUND_LIST_KEY], [...calcKey]] }),
  });

  const denyMutation = useMutation({
    mutationFn: () => personalizedServiceApi.adminResolveRefund(item.id, { decision: "DENY", note }),
    onSuccess: () => {
      toast.success("Đã từ chối yêu cầu hoàn tiền.");
      onActionDone?.();
      invalidate();
    },
    onError: (err) => report(err, { action: "write", toast: "stale", invalidate: [[...REFUND_LIST_KEY], [...calcKey]] }),
  });

  const calc = calcQuery.data;
  const check = checkRefundAmount(amount, calc?.refundableCeiling);
  const amountProblem = !check.ok ? check.message : null;
  const anyPending = approveMutation.isPending || denyMutation.isPending;
  const canApprove = !!calc && check.ok && hasText(note) && !anyPending;
  const canDeny = hasText(note) && !anyPending;
  const orderLabel = `Đơn #${item.id.slice(0, 8)}`;
  const panelId = `refund-panel-${item.id}`;

  return (
    <div
      role="row"
      data-testid="refund-request-row"
      data-order-id={item.id}
      data-price={item.price ?? ""}
      className={`grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-3 border-t border-adm-border-soft px-4 py-3.5 first:border-t-0 xl:items-center ${REFUND_ROW_GRID}`}
    >
      {/* Ai */}
      <div role="cell" className="min-w-0">
        <p className="text-sm font-semibold text-adm-text">Khách yêu cầu hoàn tiền</p>
        <IdLine label="Khách" id={item.buyerId} copyLabel="Sao chép mã đầy đủ của khách" />
        <IdLine label="PT" id={item.sellerId} copyLabel="Sao chép mã đầy đủ của huấn luyện viên" />
        <IdLine label="Đơn" id={item.id} copyLabel="Sao chép mã đầy đủ của đơn hàng" />
      </div>

      {/* Dịch vụ */}
      <div role="cell" className="col-span-2 min-w-0 xl:col-span-1">
        <p className={CELL_LABEL}>Dịch vụ</p>
        <p className="break-words text-sm font-bold text-adm-text">{item.title}</p>
        <p className="text-xs text-adm-text-2">{orderLabel}</p>
        {item.disputeReason && <p className="mt-1 break-words text-xs text-st-warning">Lý do của khách: “{item.disputeReason}”</p>}
      </div>

      {/* Giá đơn */}
      <div role="cell" className="min-w-0 text-right">
        <p className={CELL_LABEL}>Giá đơn</p>
        <p data-testid="admin-refund-price" className="text-base font-bold tabular-nums text-adm-text xl:text-sm">
          {moneyText(item.price)}
        </p>
      </div>

      {/* Tuổi yêu cầu */}
      <div role="cell" className="min-w-0">
        <p className={CELL_LABEL}>Tuổi yêu cầu</p>
        <p className="text-sm tabular-nums text-adm-text">
          {item.requestedAt ? (
            <time dateTime={item.requestedAt} title={`Yêu cầu lúc ${formatDateTime(item.requestedAt)}`}>
              {formatAge(item.requestedAt, now)}
            </time>
          ) : (
            "—"
          )}
        </p>
        {item.requestedAt && <p className="text-[11px] text-adm-text-2 xl:hidden">lúc {formatDateTime(item.requestedAt)}</p>}
      </div>

      {/* Trạng thái */}
      <div role="cell" className="flex min-w-0 justify-end xl:justify-start">
        <RefundStatusPill />
      </div>

      {/* Thao tác */}
      <div role="cell" className="col-span-2 min-w-0 xl:col-span-1 xl:justify-self-end">
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-expanded={expanded}
          aria-controls={panelId}
          data-testid="refund-row-toggle"
          onClick={() => setExpanded((e) => !e)}
          className="min-h-11 w-full xl:min-h-8 xl:w-auto"
        >
          {expanded ? "Thu gọn" : "Xem chi tiết & xử lý"}
          <CaretDownIcon className={`transition-transform motion-reduce:transition-none ${expanded ? "rotate-180" : ""}`} aria-hidden />
        </Button>
      </div>

      {expanded && (
        <div id={panelId} role="cell" className="col-span-2 min-w-0 space-y-3 border-t border-adm-border-soft pt-3 xl:col-span-full">
          {calcQuery.isLoading && (
            <div role="status" aria-label="Đang tải số liệu hoàn tiền" className="flex items-center gap-2 text-sm text-adm-text-2">
              <CircleNotchIcon className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> Đang tải số liệu hoàn tiền…
            </div>
          )}
          {calcQuery.isError && !calc && (
            <ErrorBlock
              testId="refund-calculation-error"
              view={describeAdminError(calcQuery.error)}
              message="Không tải được số tiền đã trả / đã hoàn / mức còn có thể hoàn của đơn này nên chưa thể duyệt hoàn tiền."
              onRetry={() => calcQuery.refetch()}
              className="py-6"
            />
          )}
          {calc && (
            <>
              <div className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-3">
                <div className="rounded-lg bg-adm-surface-2 p-2.5">
                  <p className="text-adm-text-2">Tổng đã trả</p>
                  <p className="font-bold tabular-nums text-adm-text">{moneyText(calc.totalPaid)}</p>
                </div>
                <div className="rounded-lg bg-adm-surface-2 p-2.5">
                  <p className="text-adm-text-2">Đã hoàn trước đó</p>
                  <p className="font-bold tabular-nums text-adm-text">{moneyText(calc.alreadyRefunded)}</p>
                </div>
                <div className="rounded-lg border border-st-success-border bg-st-success-bg p-2.5">
                  <p className="text-st-success">Còn có thể hoàn</p>
                  <p className="font-bold tabular-nums text-st-success">{moneyText(calc.refundableCeiling)}</p>
                </div>
              </div>
              <ul className="flex flex-wrap gap-1.5 text-[11px]" aria-label="Các mốc giao hàng">
                {(
                  [
                    [calc.milestones.intakeSubmitted, "Khách đã gửi thông tin ban đầu"],
                    [calc.milestones.draftDelivered, "Đã giao bản nháp"],
                    [calc.milestones.accepted, "Khách đã chấp nhận"],
                  ] as const
                ).map(([done, label]) => (
                  <li
                    key={label}
                    className={`rounded px-2 py-1 ${done ? "bg-adm-pill text-adm-text" : "bg-adm-surface-2 text-adm-text-2"}`}
                  >
                    {done ? "✓ " : "○ "}
                    {label}
                    <span className="sr-only">{done ? " — đã có" : " — chưa có"}</span>
                  </li>
                ))}
              </ul>
              <p className="flex items-start gap-1.5 text-[11px] text-adm-text-2">
                <InfoIcon className="mt-0.5 size-3.5 shrink-0 text-st-warning" aria-hidden />
                Hệ thống không tự tính số tiền PT đã "xứng đáng nhận" cho loại giao dịch này. Bạn quyết định số tiền hoàn dựa trên các mốc trên.
              </p>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div>
                  <input
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    type="number"
                    min={0}
                    max={calc.refundableCeiling}
                    inputMode="decimal"
                    aria-label="Số tiền hoàn"
                    aria-invalid={!!amountProblem}
                    aria-describedby={amountProblem ? `refund-amount-error-${item.id}` : undefined}
                    data-testid="refund-amount-input"
                    placeholder={`Số tiền hoàn (tối đa ${moneyText(calc.refundableCeiling)})`}
                    className={`min-h-11 w-full rounded-lg border bg-adm-surface-2 px-3 py-2 text-sm tabular-nums text-adm-text placeholder:text-adm-text-2 xl:min-h-9 ${FOCUS} ${amountProblem ? "border-st-danger" : "border-adm-border"}`}
                  />
                  {amountProblem && (
                    <p id={`refund-amount-error-${item.id}`} role="alert" data-testid="refund-amount-error" className="mt-1 text-xs text-st-danger">
                      {amountProblem}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setAmount(String(calc.refundableCeiling))}
                  disabled={!(calc.refundableCeiling > 0)}
                  className={`min-h-11 rounded-md px-1 text-left text-xs font-medium text-adm-text underline underline-offset-4 disabled:opacity-40 xl:min-h-9 ${FOCUS}`}
                >
                  Dùng toàn bộ số tiền còn lại
                </button>
              </div>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                aria-label="Ghi chú quyết định"
                placeholder="Ghi chú quyết định (bắt buộc — sẽ lưu vào nhật ký kiểm toán)"
                rows={2}
                className={`w-full resize-none rounded-lg border border-adm-border bg-adm-surface-2 px-3 py-2 text-sm text-adm-text placeholder:text-adm-text-2 ${FOCUS}`}
              />
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button
                  type="button"
                  data-testid="approve-refund-button"
                  onClick={(e) => {
                    remember(e);
                    setApproveOpen(true);
                  }}
                  disabled={!canApprove}
                  className="min-h-11 flex-1 bg-st-success font-bold text-adm-bg hover:bg-st-success hover:opacity-90 xl:min-h-9"
                >
                  {approveMutation.isPending ? <CircleNotchIcon className="animate-spin motion-reduce:animate-none" aria-hidden /> : <CheckCircleIcon aria-hidden />} Duyệt hoàn tiền
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  data-testid="deny-refund-button"
                  onClick={(e) => {
                    remember(e);
                    setDenyOpen(true);
                  }}
                  disabled={!canDeny}
                  className="min-h-11 flex-1 border-st-danger-border font-bold text-st-danger hover:bg-st-danger-bg xl:min-h-9"
                >
                  {denyMutation.isPending ? <CircleNotchIcon className="animate-spin motion-reduce:animate-none" aria-hidden /> : <XCircleIcon aria-hidden />} Từ chối
                </Button>
              </div>

              <MoneyActionDialog
                testId="refund-approve-dialog"
                open={approveOpen}
                onOpenChange={(o) => {
                  setApproveOpen(o);
                  if (!o) returnFocus();
                }}
                title="Duyệt hoàn tiền dịch vụ"
                description="Tiền hoàn là tiền thật — kiểm tra kỹ số tiền trước khi xác nhận."
                parties={[
                  { label: "Đơn hàng", value: `${item.title} (${orderLabel})` },
                  { label: "Khách nhận hoàn", value: `mã ${item.buyerId.slice(0, 8)}…` },
                  { label: "Huấn luyện viên bị thu hồi", value: `mã ${item.sellerId.slice(0, 8)}…` },
                  { label: "Ghi chú quyết định", value: <span className="whitespace-pre-wrap font-normal">{note.trim()}</span> },
                ]}
                amount={check.ok ? check.amount : null}
                amountLabel="Số tiền sẽ hoàn"
                facts={[
                  { label: "Tổng đã trả", value: moneyText(calc.totalPaid) },
                  { label: "Đã hoàn trước đó", value: moneyText(calc.alreadyRefunded) },
                  { label: "Còn có thể hoàn (trần)", value: moneyText(calc.refundableCeiling) },
                ]}
                effects={[
                  <>
                    <b className="tabular-nums">{check.ok ? moneyText(check.amount) : "—"}</b> được ghi có vào <b>ví khách hàng</b> (số dư khả dụng) — không hoàn về thẻ hay ngân hàng.
                  </>,
                  "Hệ thống thu hồi khoản này từ phần của huấn luyện viên và nền tảng: lấy từ số dư đang giữ trước, rồi đến số dư khả dụng; nếu huấn luyện viên đã rút quá mức còn lại thì phần thiếu được ghi thành khoản nợ của họ. Khách luôn nhận đủ.",
                  check.ok && isFinalRefund(check.amount, calc.refundableCeiling)
                    ? "Đây là lần hoàn cuối: đơn sẽ chuyển sang trạng thái đã hoàn tiền."
                    : "Hoàn một phần: đơn hàng tiếp tục sau khi hoàn.",
                ]}
                notice="Không thể hoàn tác sau khi xác nhận."
                confirmLabel="Xác nhận hoàn tiền"
                confirmDisabled={!check.ok}
                onConfirm={() => approveMutation.mutateAsync(check.amount as number)}
                onReload={invalidate}
              />

              <MoneyActionDialog
                testId="refund-deny-dialog"
                open={denyOpen}
                onOpenChange={(o) => {
                  setDenyOpen(o);
                  if (!o) returnFocus();
                }}
                title="Từ chối yêu cầu hoàn tiền?"
                description={`${orderLabel} sẽ quay lại trạng thái trước khi khách yêu cầu hoàn tiền. Không có khoản tiền nào được hoàn.`}
                parties={[
                  { label: "Đơn hàng", value: `${item.title} (${orderLabel})` },
                  { label: "Khách bị từ chối", value: `mã ${item.buyerId.slice(0, 8)}…` },
                  { label: "Ghi chú gửi kèm", value: <span className="whitespace-pre-wrap font-normal">{note.trim()}</span> },
                ]}
                effects={[
                  "Không có khoản tiền nào được ghi có vào ví khách hàng; ví của khách và của huấn luyện viên không thay đổi.",
                  "Đơn hàng quay lại trạng thái trước khi khách yêu cầu hoàn tiền; khách có thể yêu cầu lại.",
                ]}
                notice="Ghi chú được lưu vào nhật ký kiểm toán và gửi kèm quyết định."
                confirmLabel="Từ chối hoàn tiền"
                confirmDisabled={!canDeny}
                onConfirm={() => denyMutation.mutateAsync()}
                onReload={invalidate}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}
