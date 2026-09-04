import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { MoneyIcon as Banknote, CheckIcon as Check, CircleNotchIcon as Loader2, XIcon as X } from "@phosphor-icons/react";
import { adminService } from "../../services/api";
import { formatVND } from "../../utils/currency";

/**
 * Money-flow redesign plan item 5.3 — "luồng rút tiền bán thủ công". Deliberately minimal, per
 * the plan's explicit scope: no payout-API integration — markPaid only records that an admin
 * already made a real bank/e-wallet transfer outside this system, it never sends one.
 */

const OWNER_LABEL: Record<string, string> = { PT: "Huấn luyện viên", GYM: "Phòng gym", CLIENT: "Khách hàng" };

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

export function AdminWithdrawals() {
  const queryClient = useQueryClient();
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [payingId, setPayingId] = useState<string | null>(null);
  const [bankReference, setBankReference] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["admin", "pending-withdrawals"],
    queryFn: () => adminService.listPendingWithdrawals(),
  });
  const requests: WithdrawalRequest[] = data ?? [];

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["admin", "pending-withdrawals"] });

  const approveMutation = useMutation({
    mutationFn: (id: string) => adminService.approveWithdrawal(id),
    onSuccess: () => {
      toast.success("Đã duyệt yêu cầu rút tiền");
      invalidate();
    },
    onError: (error: any) => toast.error(error?.response?.data?.error?.message || "Không thể duyệt"),
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => adminService.rejectWithdrawal(id, reason),
    onSuccess: () => {
      toast.success("Đã từ chối yêu cầu");
      setRejectingId(null);
      setRejectReason("");
      invalidate();
    },
    onError: (error: any) => toast.error(error?.response?.data?.error?.message || "Không thể từ chối"),
  });

  const markPaidMutation = useMutation({
    mutationFn: ({ id, bankReference }: { id: string; bankReference: string }) => adminService.markWithdrawalPaid(id, bankReference),
    onSuccess: () => {
      toast.success("Đã ghi nhận chi trả");
      setPayingId(null);
      setBankReference("");
      invalidate();
    },
    onError: (error: any) => toast.error(error?.response?.data?.error?.message || "Không thể ghi nhận chi trả"),
  });

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-zinc-100 flex items-center gap-2 text-xl font-bold">
          <Banknote className="w-5 h-5 text-green-400" /> Yêu cầu rút tiền
        </h1>
        <p className="text-zinc-500 text-sm mt-0.5">
          Số dư đã đủ điều kiện rút ngay khi tạo yêu cầu — không có bước "duyệt xem có được rút
          hay không" nào cả. "Duyệt" chỉ là bước giữ chỗ tuỳ chọn (khoá số tiền lại) khi việc
          chuyển khoản thật sẽ mất thời gian; nếu chuyển được ngay, có thể bấm thẳng "Đã chi trả"
          mà không cần Duyệt trước. Chuyển khoản thủ công bên ngoài hệ thống xong thì nhập mã
          tham chiếu — tiền chỉ thực sự bị trừ khỏi ví ở bước "Đã chi trả".
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 text-green-500 animate-spin" />
        </div>
      ) : requests.length === 0 ? (
        <div className="bg-zinc-900/50 border border-dashed border-zinc-800 rounded-2xl py-20 text-center">
          <Banknote className="w-12 h-12 text-zinc-800 mx-auto mb-3" />
          <p className="text-zinc-600 text-sm">Không có yêu cầu rút tiền nào đang chờ xử lý.</p>
        </div>
      ) : (
        <div data-testid="admin-withdrawal-requests-list" className="space-y-4">
          {requests.map((r) => (
            <div key={r.id} data-testid="admin-withdrawal-request-card" data-request-id={r.id} data-status={r.status} data-owner-type={r.ownerType} data-amount={r.amount} className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-5">
              <div className="flex items-start justify-between gap-3 mb-3">
                <div>
                  <p className="text-sm font-semibold text-zinc-200">
                    {OWNER_LABEL[r.ownerType] ?? r.ownerType} · {formatVND(Number(r.amount))}
                  </p>
                  <p className="text-xs text-zinc-600 mt-0.5">
                    {r.ownerId.slice(0, 8)}... · yêu cầu lúc {formatDateTime(r.createdAt)}
                  </p>
                </div>
                <span
                  className={`text-[10px] font-bold px-2 py-0.5 rounded-full border whitespace-nowrap ${
                    r.status === "APPROVED"
                      ? "bg-blue-500/10 border-blue-500/20 text-blue-400"
                      : "bg-amber-500/10 border-amber-500/20 text-amber-400"
                  }`}
                >
                  {r.status === "APPROVED" ? "Đã duyệt" : "Đang chờ"}
                </span>
              </div>

              <div className="bg-zinc-800/40 border border-zinc-700/40 rounded-lg p-3 mb-4">
                <p className="text-[10px] font-bold text-zinc-600 uppercase tracking-wider mb-1">
                  Thông tin nhận tiền
                </p>
                <p className="text-xs text-zinc-400">{r.payoutInfo}</p>
              </div>

              {payingId === r.id ? (
                <div className="bg-zinc-800/60 border border-zinc-700/60 rounded-lg p-3">
                  <p className="text-xs text-zinc-400 mb-2">
                    Xác nhận đã chuyển khoản <span className="text-green-400 font-bold">{formatVND(Number(r.amount))}</span> thủ công, nhập mã tham chiếu ngân hàng:
                  </p>
                  <input
                    data-testid="admin-withdrawal-bank-reference-input"
                    value={bankReference}
                    onChange={(e) => setBankReference(e.target.value)}
                    placeholder="VD: VCB-TXN-20260824-001"
                    className="w-full bg-zinc-900 border border-zinc-700/60 rounded-lg px-3 py-2 text-sm text-zinc-200 mb-2"
                  />
                  <div className="flex gap-2 justify-end">
                    <button
                      onClick={() => { setPayingId(null); setBankReference(""); }}
                      className="px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200"
                    >
                      Huỷ
                    </button>
                    <button
                      data-testid="admin-withdrawal-confirm-paid-button"
                      onClick={() => markPaidMutation.mutate({ id: r.id, bankReference })}
                      disabled={!bankReference.trim() || markPaidMutation.isPending}
                      className="px-4 py-1.5 bg-green-500 hover:bg-green-400 disabled:opacity-40 disabled:cursor-not-allowed text-black text-xs font-bold rounded-lg transition-all"
                    >
                      Xác nhận đã chi trả
                    </button>
                  </div>
                </div>
              ) : rejectingId === r.id ? (
                <div className="bg-zinc-800/60 border border-zinc-700/60 rounded-lg p-3">
                  <textarea
                    data-testid="admin-withdrawal-reject-reason-input"
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    placeholder="Lý do từ chối..."
                    className="w-full bg-zinc-900 border border-zinc-700/60 rounded-lg px-3 py-2 text-sm text-zinc-200 mb-2 min-h-[60px]"
                  />
                  <div className="flex gap-2 justify-end">
                    <button
                      onClick={() => { setRejectingId(null); setRejectReason(""); }}
                      className="px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200"
                    >
                      Huỷ
                    </button>
                    <button
                      data-testid="admin-withdrawal-confirm-reject-button"
                      onClick={() => rejectMutation.mutate({ id: r.id, reason: rejectReason })}
                      disabled={!rejectReason.trim() || rejectMutation.isPending}
                      className="px-4 py-1.5 bg-red-500 hover:bg-red-400 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold rounded-lg transition-all"
                    >
                      Xác nhận từ chối
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-2 flex-wrap">
                  {r.status === "PENDING" && (
                    <button
                      data-testid="admin-withdrawal-approve-button"
                      onClick={() => approveMutation.mutate(r.id)}
                      disabled={approveMutation.isPending}
                      title="Tuỳ chọn: khoá số tiền này lại trước, để việc chuyển khoản có mất thời gian cũng không bị nghiệp vụ khác ăn vào số dư. Không bấm cũng được — bấm thẳng &quot;Đã chi trả&quot; khi chuyển khoản xong."
                      className="flex items-center gap-1 border border-blue-500/30 text-blue-400 hover:bg-blue-500/10 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                    >
                      <Check className="w-3.5 h-3.5" /> Duyệt (giữ chỗ trước, không bắt buộc)
                    </button>
                  )}
                  <button
                    data-testid="admin-withdrawal-mark-paid-toggle"
                    onClick={() => setPayingId(r.id)}
                    className="flex items-center gap-1 bg-green-500 hover:bg-green-400 text-black px-3 py-1.5 rounded-lg text-xs font-bold transition-all"
                  >
                    <Banknote className="w-3.5 h-3.5" /> Đã chi trả
                  </button>
                  <button
                    data-testid="admin-withdrawal-reject-toggle"
                    onClick={() => setRejectingId(r.id)}
                    className="flex items-center gap-1 border border-red-500/30 text-red-400 hover:bg-red-500/10 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                  >
                    <X className="w-3.5 h-3.5" /> Từ chối
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
