import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CircleNotchIcon as Loader2, CheckCircleIcon as CheckCircle2, XCircleIcon as XCircle, WarningIcon as AlertTriangle } from "@phosphor-icons/react";
import { personalizedServiceApi, type PersonalizedServiceOrder } from "../../services/api";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { ErrorState } from "../../components/ui/ErrorState";
import { MoneyActionDialog } from "./shared/MoneyActionDialog";
import { describeAdminError, errorStateKind, useAdminError } from "./shared/useAdminError";
import { checkRefundAmount, hasText, moneyText } from "./shared/moneyGuards";

/**
 * Marketplace rework — admin resolution queue for refund requests on personalised PT service orders.
 * These purchases settle through payment-service's generic wallet-transfer path, which credits the seller's
 * AVAILABLE balance immediately (the pending/ESCROW mechanism is wired to PT contracts and gym memberships only).
 * So this page's job is to give the admin the REAL numbers (total paid, already refunded, refundable ceiling,
 * delivery milestones reached) and let them make an explicit, audited call — never an automatic computation the
 * system has no factual basis to make for this purchase type yet.
 * Approving really moves money through payment-service; this is not a status-only action.
 *
 * B1-MONEY: approve goes through MoneyActionDialog and is blocked client-side when the amount is not in
 * (0, refundableCeiling] (the backend stays authoritative); deny needs a note and a confirmation; the list and
 * the calculation show an error (not "empty") when they fail. Same endpoints, same payloads.
 */

const LIST_KEY = ["refund-requests"] as const;

function RefundCaseCard({ order }: { order: PersonalizedServiceOrder }) {
  const queryClient = useQueryClient();
  const { report } = useAdminError();
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [approveOpen, setApproveOpen] = useState(false);
  const [denyOpen, setDenyOpen] = useState(false);

  const calcKey = ["refund-calculation", order.id] as const;
  const calcQuery = useQuery({
    queryKey: calcKey,
    queryFn: () => personalizedServiceApi.getRefundCalculation(order.id),
    enabled: expanded,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: LIST_KEY });
    queryClient.invalidateQueries({ queryKey: calcKey });
  };

  const approveMutation = useMutation({
    mutationFn: (refundAmount: number) => personalizedServiceApi.adminResolveRefund(order.id, { decision: "APPROVE", refundAmount, note }),
    onSuccess: (resolved) => {
      toast.success(resolved.status === "REFUNDED" ? "Đã hoàn tiền đầy đủ vào ví khách hàng." : "Đã hoàn tiền một phần vào ví khách hàng — đơn hàng tiếp tục.");
      invalidate();
    },
    onError: (err) => report(err, { action: "write", toast: "stale", invalidate: [[...LIST_KEY], [...calcKey]] }),
  });

  const denyMutation = useMutation({
    mutationFn: () => personalizedServiceApi.adminResolveRefund(order.id, { decision: "DENY", note }),
    onSuccess: () => { toast.success("Đã từ chối yêu cầu hoàn tiền."); invalidate(); },
    onError: (err) => report(err, { action: "write", invalidate: [[...LIST_KEY], [...calcKey]] }),
  });

  const calc = calcQuery.data;
  const check = checkRefundAmount(amount, calc?.refundableCeiling);
  const amountProblem = !check.ok ? check.message : null;
  const canApprove = !!calc && check.ok && hasText(note) && !approveMutation.isPending && !denyMutation.isPending;
  const canDeny = hasText(note) && !approveMutation.isPending && !denyMutation.isPending;
  const orderLabel = `Đơn #${order.id.slice(0, 8)}`;

  async function runDeny() {
    try {
      await denyMutation.mutateAsync();
      setDenyOpen(false);
    } catch (err) {
      setDenyOpen(false);
      // denyMutation.onError already toasted the Vietnamese message and re-fetched.
    }
  }

  return (
    <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900 p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-zinc-100">{order.titleSnapshot}</p>
          <p className="text-xs text-zinc-500 mt-0.5">{orderLabel} · <span className="tabular-nums">{moneyText(order.priceAtPurchase)}</span></p>
          {order.disputeReason && <p className="text-xs text-amber-400 mt-1">Lý do: "{order.disputeReason}"</p>}
        </div>
        <button onClick={() => setExpanded((e) => !e)} className="text-xs text-green-400 hover:text-green-300 font-semibold whitespace-nowrap">
          {expanded ? "Thu gọn" : "Xem chi tiết & xử lý"}
        </button>
      </div>

      {expanded && (
        <div className="space-y-3 pt-2 border-t border-zinc-800/60">
          {calcQuery.isLoading && <Loader2 className="w-4 h-4 animate-spin text-green-500" aria-label="Đang tải số liệu hoàn tiền" />}
          {calcQuery.isError && !calc && (
            <div data-testid="refund-calculation-error">
              <ErrorState
                kind={errorStateKind(describeAdminError(calcQuery.error))}
                message="Không tải được số tiền đã trả / đã hoàn / mức còn có thể hoàn của đơn này nên chưa thể duyệt hoàn tiền."
                onRetry={() => calcQuery.refetch()}
                className="p-6"
              />
            </div>
          )}
          {calc && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                <div className="rounded-lg bg-zinc-800/50 p-2.5">
                  <p className="text-zinc-600">Tổng đã trả</p>
                  <p className="text-zinc-200 font-bold tabular-nums">{moneyText(calc.totalPaid)}</p>
                </div>
                <div className="rounded-lg bg-zinc-800/50 p-2.5">
                  <p className="text-zinc-600">Đã hoàn trước đó</p>
                  <p className="text-zinc-200 font-bold tabular-nums">{moneyText(calc.alreadyRefunded)}</p>
                </div>
                <div className="rounded-lg bg-green-500/10 border border-green-500/30 p-2.5">
                  <p className="text-green-500/80">Còn có thể hoàn</p>
                  <p className="text-green-400 font-bold tabular-nums">{moneyText(calc.refundableCeiling)}</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5 text-[11px]">
                <span className={`rounded px-2 py-1 ${calc.milestones.intakeSubmitted ? "bg-zinc-800 text-zinc-300" : "bg-zinc-800/40 text-zinc-600"}`}>✓ Khách đã gửi thông tin ban đầu</span>
                <span className={`rounded px-2 py-1 ${calc.milestones.draftDelivered ? "bg-zinc-800 text-zinc-300" : "bg-zinc-800/40 text-zinc-600"}`}>✓ Đã giao bản nháp</span>
                <span className={`rounded px-2 py-1 ${calc.milestones.accepted ? "bg-zinc-800 text-zinc-300" : "bg-zinc-800/40 text-zinc-600"}`}>✓ Khách đã chấp nhận</span>
              </div>
              <p className="text-[11px] text-zinc-600 flex items-start gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-amber-500/70" />
                Hệ thống không tự tính số tiền PT đã "xứng đáng nhận" cho loại giao dịch này — tiền đã chuyển thẳng vào ví PT, không giữ tạm. Bạn quyết định số tiền hoàn dựa trên các mốc trên.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
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
                    aria-describedby={amountProblem ? `refund-amount-error-${order.id}` : undefined}
                    data-testid="refund-amount-input"
                    placeholder={`Số tiền hoàn (tối đa ${moneyText(calc.refundableCeiling)})`}
                    className={`w-full px-3 py-2 bg-zinc-800/60 border rounded-lg text-sm text-zinc-200 tabular-nums ${amountProblem ? "border-red-500/60" : "border-zinc-700/60"}`}
                  />
                  {amountProblem && (
                    <p id={`refund-amount-error-${order.id}`} role="alert" data-testid="refund-amount-error" className="mt-1 text-xs text-red-400">
                      {amountProblem}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setAmount(String(calc.refundableCeiling))}
                  disabled={!(calc.refundableCeiling > 0)}
                  className="text-xs text-zinc-500 hover:text-zinc-300 text-left disabled:opacity-40"
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
                className="w-full px-3 py-2 bg-zinc-800/60 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 resize-none"
              />
              <div className="flex gap-2">
                <button
                  data-testid="approve-refund-button"
                  onClick={() => setApproveOpen(true)}
                  disabled={!canApprove}
                  className="flex-1 py-2.5 rounded-xl bg-green-500 text-black text-sm font-bold hover:bg-green-400 disabled:opacity-40 flex items-center justify-center gap-1.5"
                >
                  {approveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />} Duyệt hoàn tiền
                </button>
                <button
                  data-testid="deny-refund-button"
                  onClick={() => setDenyOpen(true)}
                  disabled={!canDeny}
                  className="flex-1 py-2.5 rounded-xl border border-red-500/40 text-red-400 text-sm font-bold hover:bg-red-500/10 disabled:opacity-40 flex items-center justify-center gap-1.5"
                >
                  {denyMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />} Từ chối
                </button>
              </div>

              <MoneyActionDialog
                testId="refund-approve-dialog"
                open={approveOpen}
                onOpenChange={setApproveOpen}
                title="Duyệt hoàn tiền dịch vụ"
                description="Tiền hoàn là tiền thật — kiểm tra kỹ số tiền trước khi xác nhận."
                parties={[
                  { label: "Đơn hàng", value: `${order.titleSnapshot} (${orderLabel})` },
                  { label: "Khách nhận hoàn", value: `mã ${order.buyerId.slice(0, 8)}…` },
                  { label: "Huấn luyện viên bị thu hồi", value: `mã ${order.sellerId.slice(0, 8)}…` },
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
                  check.ok && check.amount >= calc.refundableCeiling - 0.005
                    ? "Đây là lần hoàn cuối: đơn sẽ chuyển sang trạng thái đã hoàn tiền."
                    : "Hoàn một phần: đơn hàng tiếp tục sau khi hoàn.",
                ]}
                notice="Không thể hoàn tác sau khi xác nhận."
                confirmLabel="Xác nhận hoàn tiền"
                confirmDisabled={!check.ok}
                onConfirm={() => approveMutation.mutateAsync(check.amount as number)}
                onReload={invalidate}
              />

              <ConfirmDialog
                open={denyOpen}
                onOpenChange={setDenyOpen}
                title="Từ chối yêu cầu hoàn tiền?"
                description={`${orderLabel} sẽ quay lại trạng thái trước khi khách yêu cầu hoàn tiền. Không có khoản tiền nào được hoàn.`}
                confirmLabel="Từ chối hoàn tiền"
                confirmDisabled={!canDeny}
                onConfirm={runDeny}
              >
                <div className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-3 py-2 text-sm text-[var(--text-color)]">
                  <p className="text-xs text-muted-foreground mb-0.5">Ghi chú gửi kèm</p>
                  <p className="whitespace-pre-wrap">{note.trim()}</p>
                </div>
              </ConfirmDialog>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function PTServiceRefunds() {
  const q = useQuery({ queryKey: LIST_KEY, queryFn: () => personalizedServiceApi.listRefundRequests() });

  // Vòng "Tài chính" — moved from its own /admin/pt-service-refunds route into a tab of the
  // consolidated AdminFinancePage; the page-level heading/padding now lives there instead.
  return (
    <div className="space-y-5">
      <p className="text-zinc-500 text-sm">
        Danh sách đơn dịch vụ cá nhân hoá đang chờ xử lý hoàn tiền. Duyệt sẽ ghi có tiền thật vào ví khách hàng.
      </p>

      {q.isLoading && <div className="py-10 flex justify-center" role="status" aria-label="Đang tải"><Loader2 className="w-6 h-6 text-green-500 animate-spin" /></div>}
      {q.isError && q.data === undefined && (
        <div data-testid="refund-requests-error">
          <ErrorState
            kind={errorStateKind(describeAdminError(q.error))}
            message="Không tải được danh sách yêu cầu hoàn tiền. Đây không phải là “không có yêu cầu” — hãy thử lại trước khi kết luận."
            onRetry={() => q.refetch()}
          />
        </div>
      )}
      {q.data && q.data.length === 0 && (
        <div className="bg-zinc-900 rounded-2xl border border-zinc-800/60 py-16 text-center">
          <p className="text-sm text-zinc-500">Không có yêu cầu hoàn tiền nào đang chờ xử lý.</p>
        </div>
      )}
      <div className="space-y-3" data-testid="refund-requests-list">
        {q.data?.map((order) => <RefundCaseCard key={order.id} order={order} />)}
      </div>
    </div>
  );
}
