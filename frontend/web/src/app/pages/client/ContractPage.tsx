import { useState, useEffect } from "react";
import {
  FileText,
  CheckCircle,
  Clock,
  XCircle,
  AlertCircle,
  Calendar,
  User,
  Loader2,
  ChevronRight,
  X,
  Copy,
  Check,
  MessageSquare,
  Hash,
} from "lucide-react";
import { useNavigate } from "react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { contractService } from "../../services/api";
import { openPaymentGateway } from "../../services/paymentGateway";
import { toast } from "sonner";
import type {
  Contract,
  ContractPartyProfile,
  ContractStatus,
} from "../../types";
import { formatVND } from "../../utils/currency";
import { PaymentMethodDialog } from "../../components/payment/PaymentMethodDialog";
import { useBackDismissible } from "../../hooks/useBackDismissible";

const statusConfig: Record<
  ContractStatus,
  { label: string; color: string; dot: string }
> = {
  PENDING_REVIEW: {
    label: "Pending Review",
    color: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    dot: "bg-amber-500",
  },
  PENDING_SIGNATURE: {
    label: "Awaiting Sign",
    color: "bg-purple-500/10 text-purple-400 border-purple-500/20",
    dot: "bg-purple-500",
  },
  PENDING_PAYMENT: {
    label: "Payment Due",
    color: "bg-orange-500/10 text-orange-400 border-orange-500/20",
    dot: "bg-orange-500",
  },
  ACTIVE: {
    label: "Active",
    color: "bg-green-500/10 text-green-400 border-green-500/20",
    dot: "bg-green-500",
  },
  COMPLETED: {
    label: "Completed",
    color: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    dot: "bg-blue-500",
  },
  EXPIRED: {
    label: "Expired",
    color: "bg-zinc-700/50 text-zinc-400 border-zinc-700",
    dot: "bg-zinc-500",
  },
  CANCELLED: {
    label: "Cancelled",
    color: "bg-red-500/10 text-red-400 border-red-500/20",
    dot: "bg-red-400",
  },
  REJECTED: {
    label: "Rejected",
    color: "bg-red-500/10 text-red-400 border-red-500/20",
    dot: "bg-red-400",
  },
};

const tabs: { label: string; value: string }[] = [
  { label: "All", value: "" },
  { label: "Pending", value: "PENDING_REVIEW" },
  { label: "Active", value: "ACTIVE" },
  { label: "Completed", value: "COMPLETED" },
];

function formatDate(d?: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatPrice(price?: number | null) {
  if (price == null) return "—";
  return formatVND(price);
}

function formatDateTime(d?: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function partyName(p?: ContractPartyProfile | null, fallback?: string) {
  const name = `${p?.firstName ?? ""} ${p?.lastName ?? ""}`.trim();
  return name || p?.email || fallback || "—";
}

function partyInitials(p?: ContractPartyProfile | null) {
  const letters = `${p?.firstName?.[0] ?? ""}${p?.lastName?.[0] ?? ""}`.trim();
  return (letters || p?.email?.[0] || "?").toUpperCase();
}

const SESSION_MODE_LABEL: Record<string, string> = {
  ONLINE: "Online",
  OFFLINE: "In person",
  HYBRID: "Hybrid",
};

export function ContractPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  useBackDismissible(!!showCancelDialog, () => setShowCancelDialog(false));
  const [copiedId, setCopiedId] = useState(false);
  // The contract awaiting a gateway choice; null while the picker is closed.
  const [payTarget, setPayTarget] = useState<Contract | null>(null);

  // The contract id is the reference number a client has to quote when reporting a problem,
  // so it needs to leave the page intact — no hand-transcribing a UUID.
  const copyContractId = async (id: string) => {
    try {
      await navigator.clipboard.writeText(id);
      setCopiedId(true);
      toast.success("Copied contract ID");
      setTimeout(() => setCopiedId(false), 2000);
    } catch {
      toast.error("Could not copy — select the ID manually");
    }
  };

  const { data: contracts = [], isLoading } = useQuery({
    queryKey: ["client-contracts", activeTab],
    queryFn: () => contractService.getByClient(activeTab || undefined),
  });

  const cancelMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      contractService.cancelContract(id, reason),
    onSuccess: () => {
      toast.success("Contract cancelled");
      setShowCancelDialog(false);
      setCancelReason("");
      queryClient.invalidateQueries({ queryKey: ["client-contracts"] });
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.error || "Failed to cancel");
    },
  });

  // ACTIVE contracts have real money already split into PT/gym/platform pending buckets —
  // cancelMutation above (a plain status flip) must never be used here. This settles
  // everyone per money-flow.md §3.3: client gets 90% of the unused value back, the rest is
  // the cancellation penalty.
  const terminateMutation = useMutation({
    mutationFn: (id: string) => contractService.terminateContract(id, "CLIENT_CANCELLED"),
    onSuccess: (result: any) => {
      const refund = Number(result?.settlement?.refund ?? 0);
      toast.success(
        refund > 0
          ? `Đã hủy hợp đồng — hoàn ${formatVND(refund)} vào ví của bạn`
          : "Đã hủy hợp đồng",
      );
      setShowCancelDialog(false);
      queryClient.invalidateQueries({ queryKey: ["client-contracts"] });
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.error || "Failed to cancel");
    },
  });

  /**
   * Pay a PENDING_PAYMENT contract at the gateway the client picked.
   *
   * The response is a redirect, not a completed payment — the contract activates only once
   * the gateway's signed webhook reaches payment-service. Showing success here would be
   * taking the browser's word for whether money moved.
   */
  const payMutation = useMutation({
    mutationFn: ({ id, provider }: { id: string; provider: string }) =>
      contractService.pay(id, provider),
    onSuccess: (result: any) => {
      const url = result?.payment?.redirectUrl;
      if (url) {
        // In the app this opens a system browser tab and leaves the React app running
        // underneath; on the web it behaves exactly as before. Either way the result is
        // confirmed against the server, never inferred from the return URL.
        void openPaymentGateway({
          url,
          transactionId: result?.payment?.transactionId,
          navigate,
        });
        return;
      }
      setPayTarget(null);
      toast.error(
        result?.payment?.failureReason ||
          "Cổng thanh toán không trả về liên kết — thử lại hoặc chọn cổng khác",
      );
      queryClient.invalidateQueries({ queryKey: ["client-contracts"] });
    },
    onError: (err: any) => {
      toast.error(
        err?.response?.data?.error || err?.response?.data?.code || "Không tạo được giao dịch",
      );
    },
  });

  const selected = contracts.find((c: Contract) => c.id === selectedId);

  const { data: breakdown } = useQuery({
    queryKey: ["contract-money-breakdown", selectedId],
    queryFn: () => contractService.getMoneyBreakdown(selectedId!),
    enabled: showCancelDialog && !!selectedId && selected?.status === "ACTIVE",
  });

  // Vòng 4 / Phase E2 — the client's own right to terminate after a 3rd confirmed PT no-show.
  // Never automatic: this only ever shows a banner with a choice, never terminates on its own.
  // The contract LIST (getByClient) has no per-session data — fetch the detail (which does)
  // only for the selected ACTIVE contract, same lazy-load shape as `breakdown` above.
  const { data: contractDetail } = useQuery({
    queryKey: ["contract-detail", selectedId],
    queryFn: () => contractService.getById(selectedId!),
    enabled: !!selectedId && selected?.status === "ACTIVE",
  });
  const ptNoShowCount = (contractDetail?.sessions ?? []).filter((s: any) => s.ptAtFault).length;
  const repeatedNoShowEligible = ptNoShowCount >= 3;
  const [continuedPastNoShowWarning, setContinuedPastNoShowWarning] = useState(false);

  // Re-show the banner every time a different contract is selected — "continue" only ever
  // dismisses it for THIS viewing, never records a permanent "stop asking".
  useEffect(() => {
    setContinuedPastNoShowWarning(false);
  }, [selectedId]);

  const terminateForRepeatedNoShowMutation = useMutation({
    mutationFn: (id: string) => contractService.terminateContract(id, "PT_REPEATED_NO_SHOW"),
    onSuccess: (result: any) => {
      const refund = Number(result?.settlement?.refund ?? 0);
      toast.success(
        refund > 0
          ? `Đã chấm dứt hợp đồng — hoàn ${formatVND(refund)} (100% giá trị chưa dùng) vào ví của bạn`
          : "Đã chấm dứt hợp đồng",
      );
      setShowTerminateForNoShowDialog(false);
      queryClient.invalidateQueries({ queryKey: ["client-contracts"] });
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.error || "Không thể chấm dứt hợp đồng");
    },
  });

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="w-8 h-8 text-green-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-zinc-100 flex items-center gap-2 text-xl font-bold">
            <FileText className="w-5 h-5 text-green-400" /> My Contracts
          </h1>
          <p className="text-zinc-500 text-sm mt-0.5">
            Your coaching agreements and service packages
          </p>
        </div>
        <button
          onClick={() => navigate("/client/coaches")}
          className="flex items-center gap-2 bg-green-500 hover:bg-green-400 text-black px-4 py-2.5 rounded-xl text-sm font-bold transition-all shadow-lg shadow-green-500/25"
        >
          Find a Coach
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {tabs.map((t) => (
          <button
            key={t.value}
            onClick={() => {
              setActiveTab(t.value);
              setSelectedId(null);
            }}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all border ${activeTab === t.value ? "bg-green-500 text-black border-green-500" : "bg-zinc-900 border-zinc-700/60 text-zinc-400 hover:border-green-500/40"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {contracts.length === 0 ? (
        <div className="bg-zinc-900 rounded-2xl border border-zinc-800/60 p-20 text-center">
          <FileText className="w-12 h-12 text-zinc-800 mx-auto mb-4" />
          <h3 className="text-zinc-200 font-bold mb-1">No contracts yet</h3>
          <p className="text-sm text-zinc-500 max-w-xs mx-auto mb-6">
            Browse our trainers to get started with coaching!
          </p>
          <button
            onClick={() => navigate("/client/coaches")}
            className="px-6 py-2.5 bg-green-500 hover:bg-green-400 text-black text-sm font-bold rounded-xl transition-all shadow-lg shadow-green-500/20"
          >
            Find a Coach
          </button>
        </div>
      ) : (
        <div className="flex flex-col lg:flex-row gap-4">
          {/* Contract list */}
          <div
            className={`space-y-2 ${selectedId ? "lg:w-80 flex-shrink-0" : "flex-1"}`}
          >
            {contracts.map((c: Contract) => {
              const cfg = statusConfig[c.status];
              return (
                <button
                  key={c.id}
                  onClick={() =>
                    setSelectedId(selectedId === c.id ? null : c.id)
                  }
                  className={`w-full text-left p-4 rounded-xl border-2 transition-all ${selectedId === c.id ? "border-green-500 bg-green-500/8" : "border-zinc-800/60 bg-zinc-900 hover:border-zinc-700"}`}
                >
                  <div className="flex items-start justify-between mb-2">
                    <span className="text-sm font-bold text-zinc-200">
                      {c.packageName}
                    </span>
                    <span
                      className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${cfg.color}`}
                    >
                      <span
                        className={`inline-block w-1.5 h-1.5 rounded-full mr-1 ${cfg.dot}`}
                      />
                      {cfg.label}
                    </span>
                  </div>
                  <div className="text-xs text-zinc-500">
                    {c.packageType === "PER_SESSION"
                      ? "Per Session"
                      : "Package"}
                  </div>
                  <div className="flex justify-between items-center mt-2">
                    <span className="text-xs text-zinc-600">
                      {formatDate(c.startDate)} – {formatDate(c.endDate)}
                    </span>
                    <span className="text-xs font-bold text-green-400">
                      {c.usedSessions}/{c.totalSessions} sessions
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Contract detail */}
          {selected && (
            <div className="flex-1 space-y-4">
              <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-5">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h2 className="text-zinc-100 text-lg font-bold">
                      {selected.packageName}
                    </h2>
                    <span
                      className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-semibold border mt-1 ${statusConfig[selected.status].color}`}
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${statusConfig[selected.status].dot}`}
                      />
                      {statusConfig[selected.status].label}
                    </span>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="text-lg font-bold text-green-400">
                      {formatPrice(selected.price)}
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedId(null)}
                      className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors flex-shrink-0"
                      aria-label="Đóng"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Vòng 4 / Phase E2 — a RIGHT the client exercises, never an automatic
                    termination: shown as an explicit two-button choice every time this
                    contract is opened while eligible, until the client actually acts on it. */}
                {repeatedNoShowEligible && !continuedPastNoShowWarning && (
                  <div
                    data-testid="pt-repeated-no-show-banner"
                    data-pt-no-show-count={ptNoShowCount}
                    className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 mb-3 space-y-2"
                  >
                    <div className="flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                      <p className="text-sm text-amber-200">
                        Huấn luyện viên đã vắng mặt <strong>{ptNoShowCount} lần</strong> được xác
                        nhận ở hợp đồng này. Ngài có quyền chấm dứt hợp đồng ngay và nhận lại{" "}
                        <strong>100% giá trị chưa dùng</strong>, hoặc tiếp tục hợp đồng như bình
                        thường — tuỳ Ngài chọn, hệ thống không tự động chấm dứt.
                      </p>
                    </div>
                    <div className="flex gap-2 justify-end">
                      <button
                        type="button"
                        data-testid="pt-repeated-no-show-continue-button"
                        onClick={() => setContinuedPastNoShowWarning(true)}
                        className="px-3 py-1.5 text-xs font-semibold text-zinc-300 hover:text-zinc-100 border border-zinc-700/60 rounded-lg hover:bg-zinc-800 transition-colors"
                      >
                        Tiếp tục
                      </button>
                      <button
                        type="button"
                        data-testid="pt-repeated-no-show-terminate-button"
                        onClick={() => terminateForRepeatedNoShowMutation.mutate(selected.id)}
                        disabled={terminateForRepeatedNoShowMutation.isPending}
                        className="px-3 py-1.5 text-xs font-bold text-white bg-red-500 hover:bg-red-400 disabled:bg-zinc-700 disabled:text-zinc-500 rounded-lg transition-colors flex items-center gap-1.5"
                      >
                        {terminateForRepeatedNoShowMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                        Chấm dứt hợp đồng
                      </button>
                    </div>
                  </div>
                )}

                {/* Who + which contract — everything a support ticket or dispute has to
                    reference. Without this the client can only point at "my contract". */}
                <div className="grid gap-3 sm:grid-cols-2 mb-3">
                  <div className="bg-zinc-800/50 rounded-lg p-3">
                    <div className="text-xs text-zinc-500 mb-2 flex items-center gap-1.5">
                      <User className="w-3.5 h-3.5" /> Trainer
                    </div>
                    <div className="flex items-center gap-3">
                      {selected.ptProfile?.photoUrl ? (
                        <img
                          src={selected.ptProfile.photoUrl}
                          alt=""
                          className="w-10 h-10 rounded-full object-cover flex-shrink-0"
                        />
                      ) : (
                        <div className="w-10 h-10 rounded-full bg-green-500/15 border border-green-500/25 text-green-400 text-sm font-bold flex items-center justify-center flex-shrink-0">
                          {partyInitials(selected.ptProfile)}
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="text-sm font-bold text-zinc-200 truncate">
                          {partyName(selected.ptProfile, "Trainer")}
                        </div>
                        {selected.ptProfile?.email && (
                          <div className="text-xs text-zinc-500 truncate">
                            {selected.ptProfile.email}
                          </div>
                        )}
                        <div className="text-[11px] text-zinc-600 font-mono truncate">
                          ID: {selected.ptUserId}
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => navigate("/client/chat")}
                      className="mt-3 w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg border border-zinc-700/60 text-zinc-300 text-xs font-semibold hover:bg-zinc-800 transition-colors"
                    >
                      <MessageSquare className="w-3.5 h-3.5" /> Message trainer
                    </button>
                  </div>

                  <div className="bg-zinc-800/50 rounded-lg p-3 space-y-2">
                    <div>
                      <div className="text-xs text-zinc-500 mb-1 flex items-center gap-1.5">
                        <Hash className="w-3.5 h-3.5" /> Contract ID
                      </div>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 min-w-0 text-[11px] font-mono text-zinc-300 break-all select-all">
                          {selected.id}
                        </code>
                        <button
                          type="button"
                          onClick={() => copyContractId(selected.id)}
                          className="p-1.5 rounded-lg text-zinc-500 hover:text-green-400 hover:bg-zinc-800 transition-colors flex-shrink-0"
                          aria-label="Copy contract ID"
                        >
                          {copiedId ? (
                            <Check className="w-3.5 h-3.5 text-green-400" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2 pt-1 border-t border-zinc-700/40">
                      <div>
                        <div className="text-[11px] text-zinc-500">Created</div>
                        <div className="text-xs text-zinc-300">
                          {formatDateTime(selected.createdAt)}
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px] text-zinc-500">Type</div>
                        <div className="text-xs text-zinc-300">
                          {selected.packageType === "PER_SESSION"
                            ? "Per Session"
                            : "Package"}
                          {selected.sessionMode
                            ? ` · ${SESSION_MODE_LABEL[selected.sessionMode] ?? selected.sessionMode}`
                            : ""}
                        </div>
                      </div>
                    </div>
                    <p className="text-[11px] text-zinc-600 leading-snug">
                      Quote this contract ID when you report a problem — it
                      identifies the agreement, both parties and every session
                      under it.
                    </p>
                  </div>
                </div>

                {/* Key metrics */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <div className="bg-zinc-800/50 rounded-lg p-3">
                    <div className="text-xs text-zinc-500 mb-1">Start Date</div>
                    <div className="text-sm font-bold text-zinc-200">
                      {formatDate(selected.startDate)}
                    </div>
                  </div>
                  <div className="bg-zinc-800/50 rounded-lg p-3">
                    <div className="text-xs text-zinc-500 mb-1">End Date</div>
                    <div className="text-sm font-bold text-zinc-200">
                      {formatDate(selected.endDate)}
                    </div>
                  </div>
                  <div className="bg-zinc-800/50 rounded-lg p-3 col-span-2 sm:col-span-1">
                    <div className="text-xs text-zinc-500 mb-1">Sessions</div>
                    <div className="flex items-end gap-1">
                      <span className="text-lg font-bold text-zinc-100">
                        {selected.usedSessions}
                      </span>
                      <span className="text-sm text-zinc-500 mb-0.5">
                        / {selected.totalSessions}
                      </span>
                    </div>
                    <div className="h-1.5 bg-zinc-800 rounded-full mt-1 overflow-hidden">
                      <div
                        className="h-full bg-green-500 rounded-full transition-all"
                        style={{
                          width: `${Math.min(100, (selected.usedSessions / selected.totalSessions) * 100)}%`,
                        }}
                      />
                    </div>
                  </div>
                </div>

                {selected.clientMessage && (
                  <div className="mt-4 bg-zinc-800/30 rounded-lg p-3">
                    <div className="text-xs text-zinc-500 mb-1">
                      Your Message
                    </div>
                    <p className="text-sm text-zinc-400">
                      {selected.clientMessage}
                    </p>
                  </div>
                )}

                {selected.rejectionReason && (
                  <div className="mt-4 bg-red-500/5 border border-red-500/20 rounded-lg p-3">
                    <div className="text-xs text-red-400 mb-1">
                      Rejection Reason
                    </div>
                    <p className="text-sm text-zinc-400">
                      {selected.rejectionReason}
                    </p>
                  </div>
                )}

                {selected.cancellationReason && (
                  <div className="mt-4 bg-red-500/5 border border-red-500/20 rounded-lg p-3">
                    <div className="text-xs text-red-400 mb-1">
                      Cancellation Reason
                    </div>
                    <p className="text-sm text-zinc-400">
                      {selected.cancellationReason}
                    </p>
                  </div>
                )}
              </div>

              {/* Terms */}
              <div className="bg-zinc-800/40 border border-zinc-700/40 rounded-xl p-4">
                <h4 className="text-sm font-semibold text-zinc-400 mb-2 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-zinc-500" /> Terms
                </h4>
                <ul className="space-y-1 text-xs text-zinc-600">
                  <li>
                    • Sessions must be booked at least 24 hours in advance
                  </li>
                  <li>
                    • Cancellations within 24 hours will count as a used session
                  </li>
                  <li>
                    • Contract auto-expires on end date. Unused sessions are
                    forfeited.
                  </li>
                </ul>
              </div>

              {/* Actions */}
              <div className="flex flex-wrap gap-2">
                {selected.status === "PENDING_PAYMENT" && (
                  <button
                    onClick={() => setPayTarget(selected)}
                    disabled={payMutation.isPending}
                    className="flex items-center gap-2 bg-orange-500 hover:bg-orange-400 disabled:opacity-60 text-black px-4 py-2.5 rounded-xl text-sm font-bold transition-all shadow-lg shadow-orange-500/20"
                  >
                    {payMutation.isPending ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : null}
                    Pay Now ({formatPrice(selected.price)})
                  </button>
                )}
                {selected.status === "ACTIVE" && (
                  <button
                    onClick={() => navigate("/client/booking")}
                    className="flex items-center gap-2 bg-green-500 hover:bg-green-400 text-black px-4 py-2.5 rounded-xl text-sm font-bold transition-all shadow-lg shadow-green-500/20"
                  >
                    <Calendar className="w-4 h-4" /> Book Session
                  </button>
                )}
                {(selected.status === "ACTIVE" ||
                  selected.status === "PENDING_REVIEW" ||
                  selected.status === "PENDING_PAYMENT") && (
                  <button
                    onClick={() => setShowCancelDialog(true)}
                    className="flex items-center gap-2 border border-red-500/30 text-red-400 hover:bg-red-500/10 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors"
                  >
                    <XCircle className="w-4 h-4" />
                    {selected.status === "PENDING_REVIEW"
                      ? "Withdraw Request"
                      : "Cancel Contract"}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {payTarget && (
        <PaymentMethodDialog
          amount={Number(payTarget.price ?? 0)}
          isSubmitting={payMutation.isPending}
          onClose={() => setPayTarget(null)}
          onConfirm={(provider) => payMutation.mutate({ id: payTarget.id, provider })}
        />
      )}

      {/* Cancel Dialog */}
      {showCancelDialog && selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-zinc-900 border border-zinc-700/60 rounded-2xl w-full max-w-md shadow-2xl">
            <div className="p-5 border-b border-zinc-800/60">
              <h3 className="text-zinc-100 font-bold">
                {selected.status === "PENDING_REVIEW"
                  ? "Withdraw Request"
                  : "Cancel Contract"}
              </h3>
            </div>
            <div className="p-5 space-y-4">
              {selected.status === "ACTIVE" ? (
                <>
                  <p className="text-sm text-zinc-400">
                    Hợp đồng đã thanh toán và đang hoạt động. Hủy sẽ áp dụng phí hủy 10% trên
                    phần chưa dùng — bạn nhận lại phần còn lại vào ví.
                  </p>
                  {breakdown ? (
                    <div className="bg-zinc-800/50 rounded-lg p-3 space-y-1 text-xs">
                      <div className="flex justify-between">
                        <span className="text-zinc-500">Giá hợp đồng</span>
                        <span>{formatVND(Number(breakdown.price))}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-zinc-500">Đã dùng</span>
                        <span>{breakdown.usedSessions}/{breakdown.totalSessions} buổi</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-zinc-500">Giá trị chưa dùng</span>
                        <span>{formatVND(Number(breakdown.remaining))}</span>
                      </div>
                      <div className="flex justify-between text-green-400 font-bold pt-1 border-t border-zinc-700/50">
                        <span>Hoàn về ví (90%)</span>
                        <span>{formatVND(Number(breakdown.refundIfCancelledNow))}</span>
                      </div>
                    </div>
                  ) : (
                    <div className="flex justify-center py-3">
                      <Loader2 className="w-4 h-4 text-zinc-500 animate-spin" />
                    </div>
                  )}
                </>
              ) : (
                <>
                  <p className="text-sm text-zinc-400">
                    {selected.status === "PENDING_REVIEW"
                      ? "Are you sure you want to withdraw this coaching request?"
                      : "Are you sure you want to cancel this contract? This action cannot be undone."}
                  </p>
                  <div>
                    <label className="text-xs font-semibold text-zinc-400 mb-1.5 block">
                      Reason
                    </label>
                    <textarea
                      value={cancelReason}
                      onChange={(e) => setCancelReason(e.target.value)}
                      rows={3}
                      placeholder="Please provide a reason..."
                      className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-red-500/50 resize-none"
                    />
                  </div>
                </>
              )}
            </div>
            <div className="p-5 border-t border-zinc-800/60 flex gap-3">
              <button
                onClick={() => {
                  setShowCancelDialog(false);
                  setCancelReason("");
                }}
                className="flex-1 py-2.5 border border-zinc-700/60 text-zinc-300 text-sm font-semibold rounded-lg hover:bg-zinc-800 transition-colors"
              >
                Keep
              </button>
              {selected.status === "ACTIVE" ? (
                <button
                  onClick={() => terminateMutation.mutate(selected.id)}
                  disabled={terminateMutation.isPending}
                  className="flex-1 py-2.5 bg-red-500 hover:bg-red-400 disabled:bg-zinc-700 disabled:text-zinc-500 text-white text-sm font-bold rounded-lg transition-all flex items-center justify-center gap-2"
                >
                  {terminateMutation.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : null}
                  Xác nhận hủy
                </button>
              ) : (
                <button
                  onClick={() =>
                    cancelMutation.mutate({
                      id: selected.id,
                      reason: cancelReason,
                    })
                  }
                  disabled={!cancelReason.trim() || cancelMutation.isPending}
                  className="flex-1 py-2.5 bg-red-500 hover:bg-red-400 disabled:bg-zinc-700 disabled:text-zinc-500 text-white text-sm font-bold rounded-lg transition-all flex items-center justify-center gap-2"
                >
                  {cancelMutation.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : null}
                  {selected.status === "PENDING_REVIEW" ? "Withdraw" : "Cancel"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
