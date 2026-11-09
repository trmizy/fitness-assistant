import { useRef, useState, type MouseEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  CheckIcon,
  ClockIcon,
  CopyIcon,
  LockSimpleIcon,
  MoneyIcon,
  XIcon,
} from "@phosphor-icons/react";
import { adminService } from "../../../services/api";
import { Button } from "../../../components/ui/button";
import { MoneyActionDialog } from "../shared/MoneyActionDialog";
import { useAdminError } from "../shared/useAdminError";
import { hasText, moneyText } from "../shared/moneyGuards";
import { formatAge, shortId, type WithdrawalRequest } from "./withdrawalQueue";

/**
 * B5 — one request of the withdrawal queue. It keeps every B1 money behaviour: approve and mark-paid go through
 * MoneyActionDialog (who / how much / which wallet bucket), the row owns its own pending state, one POST per
 * confirmation, no automatic retry, 409/400 "stale" answers re-fetch the queue and toast, the bank reference
 * is mandatory, a reject needs a reason (inline), and "Đã duyệt ≠ đã chuyển".
 *
 * Layout: one DOM tree. From `xl` it is a row of a 6-column table (ARIA table roles, header row in the parent);
 * below `xl` it stacks into a card whose cells carry their own small label.
 */

export const OWNER_LABEL: Record<string, string> = { PT: "Huấn luyện viên", GYM: "Phòng gym", CLIENT: "Khách hàng" };
export const QUEUE_KEY = ["admin", "pending-withdrawals"] as const;
/** Same template for the header row and the data rows. */
export const ROW_GRID =
  "xl:grid-cols-[minmax(0,170px)_minmax(0,120px)_minmax(0,1fr)_minmax(0,92px)_minmax(0,128px)_minmax(0,236px)]";

const APPROVE_HINT =
  "Ví của người rút có thể không đủ số dư khả dụng hoặc đang bị khoá — yêu cầu cần xem lại.";

const APPROVE_TITLE =
  "Tuỳ chọn: khoá số tiền này lại trước, để việc chuyển khoản có mất thời gian cũng không bị nghiệp vụ khác ăn vào số dư. Không bấm cũng được — bấm thẳng \"Đã chi trả\" khi chuyển khoản xong.";

const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--adm-focus)]";

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
      data-testid="admin-withdrawal-copy-id"
      className={`inline-grid size-9 place-items-center rounded-md text-adm-text-2 hover:bg-adm-surface-2 hover:text-adm-text xl:size-6 ${FOCUS}`}
    >
      <CopyIcon className="size-3.5" aria-hidden />
    </button>
  );
}

export function StatusPill({ status }: { status: WithdrawalRequest["status"] }) {
  const approved = status === "APPROVED";
  const Icon = approved ? LockSimpleIcon : ClockIcon;
  return (
    <span
      data-testid="admin-withdrawal-status-pill"
      className={`inline-flex items-start gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold leading-snug ${
        approved
          ? "border-st-info-border bg-st-info-bg text-st-info"
          : "border-st-pending-border bg-st-pending-bg text-st-pending"
      }`}
    >
      <Icon className="mt-px size-3 shrink-0" weight="bold" aria-hidden />
      <span>{approved ? "Đã duyệt – chờ chuyển khoản" : "Chờ duyệt"}</span>
    </span>
  );
}

const CELL_LABEL = "text-[11px] font-medium text-adm-text-2 xl:hidden";

export function WithdrawalRow({ r, now, onActionDone }: { r: WithdrawalRequest; now: number; onActionDone?: () => void }) {
  const queryClient = useQueryClient();
  const { report } = useAdminError();
  const [dialog, setDialog] = useState<"approve" | "pay" | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [bankReference, setBankReference] = useState("");
  // The dialogs are controlled (no Radix trigger), so Radix has nowhere to return focus to: do it here.
  const openerRef = useRef<HTMLElement | null>(null);
  const openDialog = (kind: "approve" | "pay") => (e: MouseEvent<HTMLElement>) => {
    openerRef.current = e.currentTarget;
    setDialog(kind);
  };
  const returnFocus = () => {
    window.setTimeout(() => {
      const el = openerRef.current;
      if (el && el.isConnected && !(el as HTMLButtonElement).disabled) el.focus();
    }, 0);
  };

  const invalidate = () => queryClient.invalidateQueries({ queryKey: QUEUE_KEY });
  const amountText = moneyText(r.amount);
  const ownerLabel = OWNER_LABEL[r.ownerType] ?? r.ownerType;
  const isApproved = r.status === "APPROVED";

  const approveMutation = useMutation({
    mutationFn: () => adminService.approveWithdrawal(r.id),
    onSuccess: () => {
      toast.success("Đã duyệt: tiền đã được khoá trong ví, CHƯA chuyển ra ngoài.");
      onActionDone?.();
      invalidate();
    },
    onError: (error) => report(error, { action: "write", toast: "stale", invalidate: [[...QUEUE_KEY]], serverHint: APPROVE_HINT }),
  });

  const markPaidMutation = useMutation({
    mutationFn: (ref: string) => adminService.markWithdrawalPaid(r.id, ref),
    onSuccess: () => {
      toast.success(`Đã ghi nhận chi trả ${amountText}`);
      setBankReference("");
      onActionDone?.();
      invalidate();
    },
    onError: (error) => report(error, { action: "write", toast: "stale", invalidate: [[...QUEUE_KEY]] }),
  });

  const rejectMutation = useMutation({
    mutationFn: (reason: string) => adminService.rejectWithdrawal(r.id, reason),
    onSuccess: () => {
      toast.success(isApproved ? "Đã từ chối: tiền đã mở khoá, trả về số dư khả dụng." : "Đã từ chối yêu cầu");
      setRejecting(false);
      setRejectReason("");
      onActionDone?.();
      invalidate();
    },
    onError: (error) => report(error, { action: "write", invalidate: [[...QUEUE_KEY]] }),
  });

  const anyPending = approveMutation.isPending || markPaidMutation.isPending || rejectMutation.isPending;

  const parties = [
    { label: "Người rút", value: `${ownerLabel} · mã ${shortId(r.ownerId)}…` },
    { label: "Nhận tiền vào", value: <span className="whitespace-pre-wrap font-normal">{r.payoutInfo || "—"}</span> },
  ];

  return (
    <div
      role="row"
      data-testid="admin-withdrawal-request-card"
      data-request-id={r.id}
      data-status={r.status}
      data-owner-type={r.ownerType}
      data-amount={r.amount}
      className={`grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-3 border-t border-adm-border-soft px-4 py-3.5 first:border-t-0 xl:items-center ${ROW_GRID}`}
    >
      {/* Người rút */}
      <div role="cell" className="min-w-0">
        <p className="text-sm font-semibold text-adm-text">{ownerLabel}</p>
        <p className="mt-0.5 flex items-center gap-0.5 whitespace-nowrap text-xs text-adm-text-2">
          <span>
            Người dùng <span className="font-mono tabular-nums">{shortId(r.ownerId)}</span>
          </span>
          <CopyId id={r.ownerId} label="Sao chép mã đầy đủ của người rút" />
        </p>
        <p className="flex items-center gap-0.5 whitespace-nowrap text-xs text-adm-text-2">
          <span>
            Yêu cầu <span className="font-mono tabular-nums">{shortId(r.id)}</span>
          </span>
          <CopyId id={r.id} label="Sao chép mã đầy đủ của yêu cầu rút tiền" />
        </p>
      </div>

      {/* Số tiền */}
      <div role="cell" className="min-w-0 text-right">
        <p className={CELL_LABEL}>Số tiền</p>
        <p data-testid="admin-withdrawal-amount" className="text-base font-bold tabular-nums text-adm-text xl:text-sm">
          {amountText}
        </p>
      </div>

      {/* Thông tin nhận tiền */}
      <div role="cell" className="col-span-2 min-w-0 xl:col-span-1">
        <p className={CELL_LABEL}>Thông tin nhận tiền</p>
        <p className="whitespace-pre-wrap break-words text-xs text-adm-text-2 xl:text-[13px]">{r.payoutInfo || "—"}</p>
      </div>

      {/* Tuổi yêu cầu */}
      <div role="cell" className="min-w-0">
        <p className={CELL_LABEL}>Tuổi yêu cầu</p>
        <p className="text-sm tabular-nums text-adm-text">
          <time dateTime={r.createdAt} title={`Yêu cầu lúc ${formatDateTime(r.createdAt)}`}>
            {formatAge(r.createdAt, now)}
          </time>
        </p>
        <p className="text-[11px] text-adm-text-2 xl:hidden">lúc {formatDateTime(r.createdAt)}</p>
      </div>

      {/* Trạng thái */}
      <div role="cell" className="flex min-w-0 justify-end xl:justify-start">
        <StatusPill status={r.status} />
      </div>

      {/* Thao tác */}
      <div role="cell" className="col-span-2 min-w-0 xl:col-span-1 xl:justify-self-end">
        {!rejecting && (
          <div className="flex flex-wrap gap-2 xl:justify-end">
            {r.status === "PENDING" && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-testid="admin-withdrawal-approve-button"
                onClick={openDialog("approve")}
                disabled={anyPending}
                aria-label="Duyệt — giữ chỗ trước, không bắt buộc"
                title={APPROVE_TITLE}
                className="min-h-11 xl:min-h-8"
              >
                <CheckIcon aria-hidden /> Duyệt
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              data-testid="admin-withdrawal-mark-paid-toggle"
              onClick={openDialog("pay")}
              disabled={anyPending}
              className="min-h-11 bg-st-success text-adm-bg hover:bg-st-success hover:opacity-90 xl:min-h-8"
            >
              <MoneyIcon aria-hidden /> Đã chi trả
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-testid="admin-withdrawal-reject-toggle"
              onClick={() => setRejecting(true)}
              disabled={anyPending}
              className="min-h-11 border-st-danger-border text-st-danger hover:bg-st-danger-bg xl:min-h-8"
            >
              <XIcon aria-hidden /> Từ chối
            </Button>
          </div>
        )}
      </div>

      {rejecting && (
        <div role="cell" className="col-span-2 min-w-0 rounded-lg border border-adm-border bg-adm-surface-2 p-3 xl:col-span-full">
          {isApproved && (
            <p className="mb-2 text-xs text-adm-text-2">
              Từ chối yêu cầu đã duyệt sẽ mở khoá <span className="font-bold tabular-nums text-adm-text">{amountText}</span> và trả về số dư
              khả dụng của người rút.
            </p>
          )}
          <textarea
            data-testid="admin-withdrawal-reject-reason-input"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="Lý do từ chối..."
            aria-label="Lý do từ chối"
            className="mb-2 min-h-[60px] w-full rounded-lg border border-adm-border bg-adm-surface px-3 py-2 text-sm text-adm-text placeholder:text-adm-text-2"
          />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="min-h-11 xl:min-h-8"
              onClick={() => { setRejecting(false); setRejectReason(""); }}
              disabled={rejectMutation.isPending}
            >
              Huỷ
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              className="min-h-11 xl:min-h-8"
              data-testid="admin-withdrawal-confirm-reject-button"
              onClick={() => rejectMutation.mutate(rejectReason)}
              disabled={!hasText(rejectReason) || rejectMutation.isPending}
            >
              {rejectMutation.isPending ? "Đang xử lý…" : "Xác nhận từ chối"}
            </Button>
          </div>
        </div>
      )}

      <MoneyActionDialog
        testId="admin-withdrawal-approve-dialog"
        open={dialog === "approve"}
        onOpenChange={(o) => {
          if (!o) { setDialog(null); returnFocus(); }
        }}
        title="Duyệt yêu cầu rút tiền"
        description="Bước này chỉ giữ chỗ — tiền chưa được chuyển cho người nhận."
        parties={parties}
        amount={r.amount}
        amountLabel="Số tiền yêu cầu rút"
        effects={[
          <>
            <b className="tabular-nums">{amountText}</b> chuyển từ số dư <b>khả dụng</b> sang <b>đang khoá</b> trong ví của người rút.
          </>,
          "Tiền vẫn nằm trong nền tảng — chưa trừ khỏi hệ thống và chưa chuyển khoản cho ai.",
          'Sau khi chuyển khoản thủ công xong, bấm "Đã chi trả" để ghi nhận. Muốn huỷ, bấm "Từ chối" để mở khoá tiền.',
        ]}
        notice="Duyệt ≠ đã chuyển tiền."
        danger={false}
        confirmLabel="Duyệt và khoá tiền"
        onConfirm={() => approveMutation.mutateAsync()}
        onReload={invalidate}
        errorOptions={{ serverHint: APPROVE_HINT }}
      />

      <MoneyActionDialog
        testId="admin-withdrawal-pay-dialog"
        open={dialog === "pay"}
        onOpenChange={(o) => {
          if (!o) { setDialog(null); setBankReference(""); returnFocus(); }
        }}
        title="Ghi nhận đã chuyển khoản"
        description="Chỉ xác nhận sau khi bạn ĐÃ chuyển khoản thật, bên ngoài hệ thống."
        parties={parties}
        amount={r.amount}
        amountLabel="Số tiền đã chuyển"
        effects={[
          ...(isApproved
            ? []
            : [<>Yêu cầu chưa được duyệt: hệ thống tự khoá tiền rồi trừ ngay (bỏ qua bước Duyệt).</>]),
          <>
            Số dư <b>đang khoá</b> của người rút bị trừ <b className="tabular-nums">{amountText}</b>; khoản này <b>rời khỏi nền tảng</b>.
          </>,
          "Hệ thống chỉ ghi sổ, không tự chuyển tiền. Không thể hoàn tác sau khi xác nhận.",
        ]}
        notice="Nhập đúng mã tham chiếu ngân hàng của lần chuyển khoản vừa thực hiện."
        confirmLabel="Xác nhận đã chi trả"
        confirmDisabled={!hasText(bankReference)}
        onConfirm={() => markPaidMutation.mutateAsync(bankReference.trim())}
        onReload={invalidate}
      >
        <div>
          <label htmlFor={`bank-ref-${r.id}`} className="block text-xs font-semibold text-muted-foreground mb-1">
            Mã tham chiếu ngân hàng (bắt buộc)
          </label>
          <input
            id={`bank-ref-${r.id}`}
            data-testid="admin-withdrawal-bank-reference-input"
            value={bankReference}
            onChange={(e) => setBankReference(e.target.value)}
            placeholder="VD: VCB-TXN-20260824-001"
            autoComplete="off"
            className="w-full bg-[var(--card-bg)] border border-[var(--border-color)] rounded-lg px-3 py-2 text-sm text-[var(--text-color)]"
          />
        </div>
      </MoneyActionDialog>
    </div>
  );
}
