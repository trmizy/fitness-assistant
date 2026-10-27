import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { MoneyIcon as Banknote, CheckIcon as Check, CircleNotchIcon as Loader2, XIcon as X } from "@phosphor-icons/react";
import { adminService } from "../../services/api";
import { ErrorState } from "../../components/ui/ErrorState";
import { MoneyActionDialog } from "./shared/MoneyActionDialog";
import { describeAdminError, errorStateKind, useAdminError } from "./shared/useAdminError";
import { hasText, moneyText } from "./shared/moneyGuards";

/**
 * Money-flow redesign plan item 5.3 — "luồng rút tiền bán thủ công". Deliberately minimal, per
 * the plan's explicit scope: no payout-API integration — markPaid only records that an admin
 * already made a real bank/e-wallet transfer outside this system, it never sends one.
 *
 * B1-MONEY: approve and mark-paid go through MoneyActionDialog (who / how much / which wallet bucket),
 * each card owns its own pending state, a failed load is an error (not "empty"), and 409/stale answers
 * re-fetch the queue. Same endpoints, same payloads, one request per action.
 */

const OWNER_LABEL: Record<string, string> = { PT: "Huấn luyện viên", GYM: "Phòng gym", CLIENT: "Khách hàng" };
const QUEUE_KEY = ["admin", "pending-withdrawals"] as const;

function formatDateTime(iso: string) {
  const d = new Date(iso);
  return (
    d.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" }) +
    " " +
    d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })
  );
}

interface WithdrawalRequest {
  id: string;
  ownerType: "PT" | "GYM" | "CLIENT";
  ownerId: string;
  amount: string;
  status: "PENDING" | "APPROVED" | "PAID" | "REJECTED";
  payoutInfo: string;
  createdAt: string;
}

const APPROVE_HINT =
  "Ví của người rút có thể không đủ số dư khả dụng hoặc đang bị khoá — yêu cầu cần xem lại.";

function WithdrawalCard({ r }: { r: WithdrawalRequest }) {
  const queryClient = useQueryClient();
  const { report } = useAdminError();
  const [dialog, setDialog] = useState<"approve" | "pay" | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [bankReference, setBankReference] = useState("");

  const invalidate = () => queryClient.invalidateQueries({ queryKey: QUEUE_KEY });
  const amountText = moneyText(r.amount);
  const ownerLabel = OWNER_LABEL[r.ownerType] ?? r.ownerType;
  const isApproved = r.status === "APPROVED";

  const approveMutation = useMutation({
    mutationFn: () => adminService.approveWithdrawal(r.id),
    onSuccess: () => {
      toast.success("Đã duyệt: tiền đã được khoá trong ví, CHƯA chuyển ra ngoài.");
      invalidate();
    },
    onError: (error) => report(error, { action: "write", toast: "stale", invalidate: [[...QUEUE_KEY]], serverHint: APPROVE_HINT }),
  });

  const markPaidMutation = useMutation({
    mutationFn: (ref: string) => adminService.markWithdrawalPaid(r.id, ref),
    onSuccess: () => {
      toast.success(`Đã ghi nhận chi trả ${amountText}`);
      setBankReference("");
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
      invalidate();
    },
    onError: (error) => report(error, { action: "write", invalidate: [[...QUEUE_KEY]] }),
  });

  const anyPending = approveMutation.isPending || markPaidMutation.isPending || rejectMutation.isPending;

  const parties = [
    { label: "Người rút", value: `${ownerLabel} · mã ${r.ownerId.slice(0, 8)}…` },
    { label: "Nhận tiền vào", value: <span className="whitespace-pre-wrap font-normal">{r.payoutInfo || "—"}</span> },
  ];

  return (
    <div
      data-testid="admin-withdrawal-request-card"
      data-request-id={r.id}
      data-status={r.status}
      data-owner-type={r.ownerType}
      data-amount={r.amount}
      className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-5"
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-zinc-200">
            {ownerLabel} · <span className="tabular-nums">{amountText}</span>
          </p>
          <p className="text-xs text-zinc-600 mt-0.5">
            Mã người dùng {r.ownerId.slice(0, 8)}… · yêu cầu lúc {formatDateTime(r.createdAt)}
          </p>
        </div>
        <span
          className={`text-[10px] font-bold px-2 py-0.5 rounded-full border text-right ${
            isApproved
              ? "bg-blue-500/10 border-blue-500/20 text-blue-400"
              : "bg-amber-500/10 border-amber-500/20 text-amber-400"
          }`}
        >
          {isApproved ? "Đã duyệt – chờ chuyển khoản" : "Đang chờ"}
        </span>
      </div>

      {isApproved && (
        <p data-testid="admin-withdrawal-approved-note" className="text-xs text-blue-400/90 mb-3">
          Đã duyệt không có nghĩa là đã chuyển: tiền mới chỉ được khoá trong ví, chưa rời khỏi nền tảng. Chuyển khoản xong
          hãy bấm "Đã chi trả".
        </p>
      )}

      <div className="bg-zinc-800/40 border border-zinc-700/40 rounded-lg p-3 mb-4">
        <p className="text-[10px] font-bold text-zinc-600 uppercase tracking-wider mb-1">Thông tin nhận tiền</p>
        <p className="text-xs text-zinc-400 whitespace-pre-wrap">{r.payoutInfo}</p>
      </div>

      {rejecting ? (
        <div className="bg-zinc-800/60 border border-zinc-700/60 rounded-lg p-3">
          {isApproved && (
            <p className="text-xs text-zinc-400 mb-2">
              Từ chối yêu cầu đã duyệt sẽ mở khoá <span className="font-bold tabular-nums">{amountText}</span> và trả về số dư
              khả dụng của người rút.
            </p>
          )}
          <textarea
            data-testid="admin-withdrawal-reject-reason-input"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="Lý do từ chối..."
            aria-label="Lý do từ chối"
            className="w-full bg-zinc-900 border border-zinc-700/60 rounded-lg px-3 py-2 text-sm text-zinc-200 mb-2 min-h-[60px]"
          />
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => { setRejecting(false); setRejectReason(""); }}
              disabled={rejectMutation.isPending}
              className="px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200"
            >
              Huỷ
            </button>
            <button
              data-testid="admin-withdrawal-confirm-reject-button"
              onClick={() => rejectMutation.mutate(rejectReason)}
              disabled={!hasText(rejectReason) || rejectMutation.isPending}
              className="px-4 py-1.5 bg-red-500 hover:bg-red-400 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold rounded-lg transition-all"
            >
              {rejectMutation.isPending ? "Đang xử lý…" : "Xác nhận từ chối"}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2 flex-wrap">
          {r.status === "PENDING" && (
            <button
              data-testid="admin-withdrawal-approve-button"
              onClick={() => setDialog("approve")}
              disabled={anyPending}
              title="Tuỳ chọn: khoá số tiền này lại trước, để việc chuyển khoản có mất thời gian cũng không bị nghiệp vụ khác ăn vào số dư. Không bấm cũng được — bấm thẳng &quot;Đã chi trả&quot; khi chuyển khoản xong."
              className="flex items-center gap-1 border border-blue-500/30 text-blue-400 hover:bg-blue-500/10 disabled:opacity-40 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
            >
              <Check className="w-3.5 h-3.5" /> Duyệt (giữ chỗ trước, không bắt buộc)
            </button>
          )}
          <button
            data-testid="admin-withdrawal-mark-paid-toggle"
            onClick={() => setDialog("pay")}
            disabled={anyPending}
            className="flex items-center gap-1 bg-green-500 hover:bg-green-400 disabled:opacity-40 text-black px-3 py-1.5 rounded-lg text-xs font-bold transition-all"
          >
            <Banknote className="w-3.5 h-3.5" /> Đã chi trả
          </button>
          <button
            data-testid="admin-withdrawal-reject-toggle"
            onClick={() => setRejecting(true)}
            disabled={anyPending}
            className="flex items-center gap-1 border border-red-500/30 text-red-400 hover:bg-red-500/10 disabled:opacity-40 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
          >
            <X className="w-3.5 h-3.5" /> Từ chối
          </button>
        </div>
      )}

      <MoneyActionDialog
        testId="admin-withdrawal-approve-dialog"
        open={dialog === "approve"}
        onOpenChange={(o) => !o && setDialog(null)}
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
          if (!o) { setDialog(null); setBankReference(""); }
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

export function AdminWithdrawals() {
  const query = useQuery({
    queryKey: QUEUE_KEY,
    queryFn: () => adminService.listPendingWithdrawals(),
  });
  const requests: WithdrawalRequest[] = Array.isArray(query.data) ? query.data : [];

  // Vòng "Tài chính" — moved from its own /admin/withdrawals route into a tab of the
  // consolidated AdminFinancePage; the page-level heading/padding now lives there instead.
  return (
    <div className="space-y-6">
      <p className="text-zinc-500 text-sm">
        Số dư đã đủ điều kiện rút ngay khi tạo yêu cầu — không có bước "duyệt xem có được rút
        hay không" nào cả. "Duyệt" chỉ là bước giữ chỗ tuỳ chọn (khoá số tiền lại) khi việc
        chuyển khoản thật sẽ mất thời gian; nếu chuyển được ngay, có thể bấm thẳng "Đã chi trả"
        mà không cần Duyệt trước. Chuyển khoản thủ công bên ngoài hệ thống xong thì nhập mã
        tham chiếu — tiền chỉ thực sự bị trừ khỏi ví ở bước "Đã chi trả".
      </p>

      {query.isLoading ? (
        <div className="flex items-center justify-center py-20" role="status" aria-label="Đang tải">
          <Loader2 className="w-6 h-6 text-green-500 animate-spin" />
        </div>
      ) : query.isError && query.data === undefined ? (
        <div data-testid="admin-withdrawals-error">
          <ErrorState
            kind={errorStateKind(describeAdminError(query.error))}
            message="Không tải được hàng đợi rút tiền. Đây không phải là “không có yêu cầu” — hãy thử lại trước khi kết luận."
            onRetry={() => query.refetch()}
          />
        </div>
      ) : requests.length === 0 ? (
        <div className="bg-zinc-900/50 border border-dashed border-zinc-800 rounded-2xl py-20 text-center">
          <Banknote className="w-12 h-12 text-zinc-800 mx-auto mb-3" />
          <p className="text-zinc-600 text-sm">Không có yêu cầu rút tiền nào đang chờ xử lý.</p>
        </div>
      ) : (
        <div data-testid="admin-withdrawal-requests-list" className="space-y-4">
          {requests.map((r) => (
            <WithdrawalCard key={r.id} r={r} />
          ))}
        </div>
      )}
    </div>
  );
}
