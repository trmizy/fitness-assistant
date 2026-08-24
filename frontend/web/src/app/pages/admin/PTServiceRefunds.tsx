import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Banknote, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import { personalizedServiceApi, type PersonalizedServiceOrder } from "../../services/api";

/**
 * Marketplace rework — admin resolution queue for Personalized PT Service
 * refund requests. Personalized Service purchases settle through
 * payment-service's generic wallet-transfer path, which credits the seller's
 * AVAILABLE balance immediately — payment-service DOES have a real
 * pending-balance/ESCROW mechanism, it's just wired to PT_CONTRACT/
 * GYM_MEMBERSHIP specifically (see contract-ledger.service.ts /
 * membership-ledger.service.ts), not this purchase type. So this page's job
 * is to give the admin the REAL numbers (total paid, already refunded,
 * refundable ceiling, delivery milestones reached) and let them make an
 * explicit, audited call — never an automatic release computation the
 * system has no factual basis to make for this purchase type yet.
 * Approving actually moves money through
 * payment-service's existing generic refund endpoint; this is not a
 * status-only action.
 */

function RefundCaseCard({ order }: { order: PersonalizedServiceOrder }) {
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [expanded, setExpanded] = useState(false);

  const calcQuery = useQuery({
    queryKey: ["refund-calculation", order.id],
    queryFn: () => personalizedServiceApi.getRefundCalculation(order.id),
    enabled: expanded,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["refund-requests"] });
    queryClient.invalidateQueries({ queryKey: ["refund-calculation", order.id] });
  };

  const approveMutation = useMutation({
    mutationFn: () => personalizedServiceApi.adminResolveRefund(order.id, { decision: "APPROVE", refundAmount: Number(amount), note }),
    onSuccess: (resolved) => {
      toast.success(resolved.status === "REFUNDED" ? "Đã hoàn tiền đầy đủ." : "Đã hoàn tiền một phần — đơn hàng tiếp tục.");
      invalidate();
    },
    onError: (err: any) => toast.error(err?.response?.data?.error?.message ?? "Không thể xử lý hoàn tiền."),
  });

  const denyMutation = useMutation({
    mutationFn: () => personalizedServiceApi.adminResolveRefund(order.id, { decision: "DENY", note }),
    onSuccess: () => { toast.success("Đã từ chối yêu cầu hoàn tiền."); invalidate(); },
    onError: (err: any) => toast.error(err?.response?.data?.error?.message ?? "Không thể từ chối."),
  });

  const calc = calcQuery.data;

  return (
    <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900 p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-zinc-100">{order.titleSnapshot}</p>
          <p className="text-xs text-zinc-500 mt-0.5">Đơn #{order.id.slice(0, 8)} · {order.priceAtPurchase.toLocaleString("vi-VN")}đ</p>
          {order.disputeReason && <p className="text-xs text-amber-400 mt-1">Lý do: "{order.disputeReason}"</p>}
        </div>
        <button onClick={() => setExpanded((e) => !e)} className="text-xs text-green-400 hover:text-green-300 font-semibold whitespace-nowrap">
          {expanded ? "Thu gọn" : "Xem chi tiết & xử lý"}
        </button>
      </div>

      {expanded && (
        <div className="space-y-3 pt-2 border-t border-zinc-800/60">
          {calcQuery.isLoading && <Loader2 className="w-4 h-4 animate-spin text-green-500" />}
          {calc && (
            <>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div className="rounded-lg bg-zinc-800/50 p-2.5">
                  <p className="text-zinc-600">Tổng đã trả</p>
                  <p className="text-zinc-200 font-bold tabular-nums">{calc.totalPaid.toLocaleString("vi-VN")}đ</p>
                </div>
                <div className="rounded-lg bg-zinc-800/50 p-2.5">
                  <p className="text-zinc-600">Đã hoàn trước đó</p>
                  <p className="text-zinc-200 font-bold tabular-nums">{calc.alreadyRefunded.toLocaleString("vi-VN")}đ</p>
                </div>
                <div className="rounded-lg bg-green-500/10 border border-green-500/30 p-2.5">
                  <p className="text-green-500/80">Còn có thể hoàn</p>
                  <p className="text-green-400 font-bold tabular-nums">{calc.refundableCeiling.toLocaleString("vi-VN")}đ</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5 text-[11px]">
                <span className={`rounded px-2 py-1 ${calc.milestones.intakeSubmitted ? "bg-zinc-800 text-zinc-300" : "bg-zinc-800/40 text-zinc-600"}`}>✓ Intake đã gửi</span>
                <span className={`rounded px-2 py-1 ${calc.milestones.draftDelivered ? "bg-zinc-800 text-zinc-300" : "bg-zinc-800/40 text-zinc-600"}`}>✓ Đã giao bản nháp</span>
                <span className={`rounded px-2 py-1 ${calc.milestones.accepted ? "bg-zinc-800 text-zinc-300" : "bg-zinc-800/40 text-zinc-600"}`}>✓ Khách đã chấp nhận</span>
              </div>
              <p className="text-[11px] text-zinc-600 flex items-start gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-amber-500/70" />
                Hệ thống không tự tính số tiền PT đã "xứng đáng nhận" cho loại giao dịch này — tiền đã chuyển thẳng vào ví PT, không giữ tạm. Bạn quyết định số tiền hoàn dựa trên các mốc trên.
              </p>

              <div className="grid grid-cols-2 gap-2">
                <input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  type="number"
                  min={0}
                  max={calc.refundableCeiling}
                  placeholder={`Số tiền hoàn (tối đa ${calc.refundableCeiling.toLocaleString("vi-VN")}đ)`}
                  className="px-3 py-2 bg-zinc-800/60 border border-zinc-700/60 rounded-lg text-sm text-zinc-200"
                />
                <button onClick={() => setAmount(String(calc.refundableCeiling))} className="text-xs text-zinc-500 hover:text-zinc-300 text-left">
                  Dùng toàn bộ số tiền còn lại
                </button>
              </div>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Ghi chú quyết định (bắt buộc — sẽ lưu vào audit log)"
                rows={2}
                className="w-full px-3 py-2 bg-zinc-800/60 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 resize-none"
              />
              <div className="flex gap-2">
                <button
                  data-testid="approve-refund-button"
                  onClick={() => approveMutation.mutate()}
                  disabled={approveMutation.isPending || !note || !amount || Number(amount) <= 0}
                  className="flex-1 py-2.5 rounded-xl bg-green-500 text-black text-sm font-bold hover:bg-green-400 disabled:opacity-40 flex items-center justify-center gap-1.5"
                >
                  {approveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />} Duyệt hoàn tiền
                </button>
                <button
                  data-testid="deny-refund-button"
                  onClick={() => denyMutation.mutate()}
                  disabled={denyMutation.isPending || !note}
                  className="flex-1 py-2.5 rounded-xl border border-red-500/40 text-red-400 text-sm font-bold hover:bg-red-500/10 disabled:opacity-40 flex items-center justify-center gap-1.5"
                >
                  {denyMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />} Từ chối
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function PTServiceRefunds() {
  const q = useQuery({ queryKey: ["refund-requests"], queryFn: () => personalizedServiceApi.listRefundRequests() });

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-5">
      <div>
        <h1 className="text-zinc-100 flex items-center gap-2 text-xl font-bold">
          <Banknote className="w-5 h-5 text-green-400" /> Hoàn tiền dịch vụ PT cá nhân hóa
        </h1>
        <p className="text-zinc-500 text-sm mt-0.5">
          Danh sách đơn hàng Personalized Service đang chờ xử lý hoàn tiền. Duyệt sẽ chuyển tiền thật qua payment-service.
        </p>
      </div>

      {q.isLoading && <div className="py-10 flex justify-center"><Loader2 className="w-6 h-6 text-green-500 animate-spin" /></div>}
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
