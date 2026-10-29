import { useRef, useState, type MouseEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircleIcon } from "@phosphor-icons/react";
import { adminService } from "../../../services/api";
import { formatVND } from "../../../utils/currency";
import { MoneyActionDialog } from "../shared/MoneyActionDialog";
import { checkMembershipId } from "../shared/moneyGuards";

/**
 * Exceptional gym-membership refund (money-flow §2.4) — ONE component used by both the "Tổng quan" dashboard card
 * (it used to live inline in AdminDashboard) and "Tài chính › Hoàn tiền › Gói hội viên".
 *
 * Same endpoint, same payload (`POST /admin/gym-memberships/:id/refund` with `{ reason }`), same B1-MONEY behaviour:
 * no membership-browsing or membership-by-id endpoint exists (gym-service admin routes: only POST refund + the
 * pending-issues list), so the admin pastes the id — but never refunds from a pasted id without a confirmation
 * that echoes the exact id + reason, one POST per confirmation, a failure stays in the dialog. The refund amount
 * is computed by the server (prorated by remaining days) and CANNOT be previewed; it is never estimated here.
 */

export const MEMBERSHIP_REFUND_REASONS: { value: "GYM_VIOLATION_SUSPENDED" | "GYM_CLOSED" | "TRANSACTION_ERROR"; label: string }[] = [
  { value: "GYM_VIOLATION_SUSPENDED", label: "Phòng tập vi phạm và bị khóa" },
  { value: "GYM_CLOSED", label: "Phòng tập ngừng hoạt động / đóng cửa" },
  { value: "TRANSACTION_ERROR", label: "Lỗi giao dịch" },
];

type Reason = (typeof MEMBERSHIP_REFUND_REASONS)[number]["value"];

interface Receipt {
  membershipId: string;
  /** Amount the SERVER reported; null when the response did not carry one. */
  amount: number | null;
}

const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--adm-focus)]";

export function MembershipRefundCard() {
  const [membershipId, setMembershipId] = useState("");
  const [reason, setReason] = useState<Reason | "">("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const idCheck = checkMembershipId(membershipId);
  const reasonLabel = MEMBERSHIP_REFUND_REASONS.find((r) => r.value === reason)?.label ?? "";

  // The dialog is controlled (no Radix trigger), so Radix cannot return focus: do it here.
  const openerRef = useRef<HTMLElement | null>(null);
  const idInputRef = useRef<HTMLInputElement | null>(null);
  const returnFocus = () => {
    window.setTimeout(() => {
      const el = openerRef.current;
      if (el && el.isConnected && !(el as HTMLButtonElement).disabled) el.focus();
      else idInputRef.current?.focus();
    }, 0);
  };

  const refundMutation = useMutation({
    mutationFn: (v: { id: string; reason: Reason }) => adminService.refundGymMembership(v.id, v.reason),
    onSuccess: (result: any, v) => {
      const raw = Number(result?.data?.refundAmount ?? result?.refundAmount ?? 0);
      const amount = Number.isFinite(raw) && raw > 0 ? raw : null;
      toast.success(amount !== null ? `Đã hoàn ${formatVND(amount)} vào ví khách hàng` : "Đã hoàn tiền");
      setReceipt({ membershipId: v.id, amount });
      setMembershipId("");
      setReason("");
    },
  });

  const openDialog = (e: MouseEvent<HTMLElement>) => {
    openerRef.current = e.currentTarget;
    setConfirmOpen(true);
  };

  return (
    <div className="rounded-2xl border border-adm-border bg-adm-surface p-5 shadow-adm-card" data-testid="membership-refund-card">
      <h3 className="mb-1 flex items-center gap-2 font-bold text-adm-text">Hoàn tiền gói hội viên (ngoại lệ)</h3>
      <p className="mb-4 text-xs text-adm-text-2">
        Chỉ dùng khi phòng tập vi phạm/đóng cửa hoặc lỗi giao dịch — khách tự hủy không được hoàn tiền và không đi qua form này.
      </p>
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="flex-1">
          <input
            ref={idInputRef}
            type="text"
            value={membershipId}
            onChange={(e) => setMembershipId(e.target.value)}
            placeholder="ID gói hội viên (UUID)"
            aria-label="ID gói hội viên"
            aria-invalid={!idCheck.ok && !!idCheck.message}
            aria-describedby={!idCheck.ok && idCheck.message ? "membership-id-error" : undefined}
            data-testid="membership-refund-id-input"
            autoComplete="off"
            spellCheck={false}
            className={`min-h-11 w-full rounded-lg border border-adm-border bg-adm-surface-2 px-3 py-2 font-mono text-sm text-adm-text placeholder:text-adm-text-2 xl:min-h-9 ${FOCUS}`}
          />
          {!idCheck.ok && idCheck.message && (
            <p id="membership-id-error" role="alert" data-testid="membership-refund-id-error" className="mt-1 text-xs text-st-danger">
              {idCheck.message}
            </p>
          )}
        </div>
        <select
          value={reason}
          onChange={(e) => setReason(e.target.value as Reason | "")}
          aria-label="Lý do hoàn tiền"
          data-testid="membership-refund-reason-select"
          className={`min-h-11 rounded-lg border border-adm-border bg-adm-surface-2 px-3 py-2 text-sm text-adm-text xl:min-h-9 ${FOCUS}`}
        >
          <option value="">-- Chọn lý do --</option>
          {MEMBERSHIP_REFUND_REASONS.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={openDialog}
          disabled={!idCheck.ok || !reason || refundMutation.isPending}
          data-testid="membership-refund-open-button"
          className={`flex min-h-11 items-center justify-center gap-1.5 rounded-lg bg-st-danger px-4 py-2 text-sm font-bold text-adm-bg transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:bg-adm-pill disabled:text-adm-text-2 xl:min-h-9 ${FOCUS}`}
        >
          Xem lại và hoàn tiền
        </button>
      </div>

      {receipt && (
        <p
          role="status"
          data-testid="membership-refund-last-result"
          className="mt-4 flex items-start gap-2 rounded-lg border border-st-success-border bg-st-success-bg px-3 py-2 text-sm text-st-success"
        >
          <CheckCircleIcon className="mt-0.5 size-4 shrink-0" weight="fill" aria-hidden />
          <span>
            Máy chủ đã xác nhận hoàn
            {receipt.amount !== null ? (
              <>
                {" "}
                <b className="tabular-nums">{formatVND(receipt.amount)}</b>
              </>
            ) : (
              " (không trả về số tiền)"
            )}{" "}
            vào ví khách hàng cho gói <span className="break-all font-mono text-xs">{receipt.membershipId}</span>.
          </span>
        </p>
      )}

      <MoneyActionDialog
        testId="membership-refund-dialog"
        open={confirmOpen}
        onOpenChange={(o) => {
          setConfirmOpen(o);
          if (!o) returnFocus();
        }}
        title="Xác nhận hoàn tiền gói hội viên"
        description="Hệ thống chưa cho xem thông tin gói theo mã, nên hãy đối chiếu lại mã dưới đây với nguồn bạn lấy trước khi xác nhận."
        parties={[
          { label: "Mã gói hội viên", value: <span className="break-all font-mono text-xs" data-testid="membership-refund-dialog-id">{idCheck.id}</span> },
          { label: "Lý do", value: reasonLabel },
        ]}
        effects={[
          "Số tiền hoàn do hệ thống tự tính theo số ngày còn lại của gói (theo tỷ lệ) — bạn không nhập số tiền và hộp thoại này chưa biết trước con số đó.",
          "Tiền hoàn được ghi có vào ví khách hàng (số dư khả dụng), không hoàn về thẻ hay ngân hàng. Gói chuyển sang đã huỷ.",
          "Phần đã chia cho phòng gym và huấn luyện viên giới thiệu được thu hồi tương ứng.",
          "Chỉ áp dụng cho gói đang hoạt động; gói đã huỷ hoặc hết hạn sẽ bị từ chối.",
        ]}
        notice="Không thể hoàn tác sau khi xác nhận."
        confirmLabel="Xác nhận hoàn tiền"
        confirmDisabled={!idCheck.ok || !reason}
        onConfirm={() => refundMutation.mutateAsync({ id: idCheck.id, reason: reason as Reason })}
      />
    </div>
  );
}
