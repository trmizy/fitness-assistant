import { useState } from "react";
import { FileTextIcon as FileText, MagnifyingGlassIcon as Search, CheckCircleIcon as CheckCircle, ClockIcon as Clock, XCircleIcon as XCircle, WarningIcon as AlertTriangle, UserIcon as User, CaretDownIcon as ChevronDown, CaretUpIcon as ChevronUp, CurrencyDollarIcon as DollarSign, BarbellIcon as Dumbbell, PlayCircleIcon as PlayCircle, ProhibitIcon as Ban, CircleNotchIcon as Loader2, CheckIcon as Check, XIcon as X, ChatTextIcon as MessageSquare, CalendarIcon as Calendar, WarningOctagonIcon as AlertOctagon, StarIcon as Star } from "@phosphor-icons/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { contractService, sessionService } from "../../services/api";
import { toast } from "sonner";
import type {
  Contract,
  ContractStatus,
  Session,
  SessionStatus,
} from "../../types";
import { formatVND } from "../../utils/currency";
import { Stars } from "../../components/gym/Stars";
import { useBackDismissible } from "../../hooks/useBackDismissible";

const SESSION_STATUS: Record<
  SessionStatus,
  { label: string; color: string; bg: string }
> = {
  REQUESTED: {
    label: "Pending",
    color: "text-amber-400",
    bg: "bg-amber-500/10 border-amber-500/20",
  },
  CONFIRMED: {
    label: "Confirmed",
    color: "text-green-400",
    bg: "bg-green-500/10 border-green-500/20",
  },
  COMPLETED: {
    label: "Completed",
    color: "text-blue-400",
    bg: "bg-blue-500/10 border-blue-500/20",
  },
  CANCELLED: {
    label: "Cancelled",
    color: "text-red-400",
    bg: "bg-red-500/10 border-red-500/20",
  },
  NO_SHOW: {
    label: "No Show",
    color: "text-zinc-400",
    bg: "bg-zinc-700/50 border-zinc-700",
  },
  // Merge note: these SessionStatus values exist on the payment-gateways branch's session
  // lifecycle (client-confirmation window, dispute flow, reschedule requests) but predate
  // this map — added so Record<SessionStatus, ...>'s completeness check stays meaningful.
  PENDING_CLIENT_CONFIRMATION: {
    label: "Awaiting client confirmation",
    color: "text-amber-400",
    bg: "bg-amber-500/10 border-amber-500/20",
  },
  DISPUTED: {
    label: "Disputed",
    color: "text-red-400",
    bg: "bg-red-500/10 border-red-500/20",
  },
  RESCHEDULE_PENDING: {
    label: "Reschedule pending",
    color: "text-amber-400",
    bg: "bg-amber-500/10 border-amber-500/20",
  },
};

function partyName(c: Contract) {
  const p = c.clientProfile;
  const name = `${p?.firstName ?? ""} ${p?.lastName ?? ""}`.trim();
  return name || p?.email || `${c.clientUserId.slice(0, 8)}…`;
}

function formatSessionTime(iso: string) {
  const d = new Date(iso);
  return (
    d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) +
    " " +
    d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
  );
}

const STATUS_CONFIG: Record<
  ContractStatus,
  { label: string; color: string; bg: string; icon: React.ElementType }
> = {
  PENDING_REVIEW: {
    label: "Pending Review",
    color: "text-amber-400",
    bg: "bg-amber-500/10 border-amber-500/20",
    icon: Clock,
  },
  PENDING_SIGNATURE: {
    label: "Pending Sign",
    color: "text-purple-400",
    bg: "bg-purple-500/10 border-purple-500/20",
    icon: FileText,
  },
  // Missing entirely before this fix — STATUS_CONFIG is typed Record<ContractStatus, ...>,
  // which should have made a missing key a compile error, but this project has no
  // tsconfig.json so `vite build` (esbuild) never actually type-checks it. A contract lands
  // here as soon as the PT accepts (REQUIRE_CONTRACT_ESIGN=false skips e-sign straight to
  // PENDING_PAYMENT), so this crashed on every single Accept.
  PENDING_PAYMENT: {
    label: "Payment Due",
    color: "text-orange-400",
    bg: "bg-orange-500/10 border-orange-500/20",
    icon: DollarSign,
  },
  ACTIVE: {
    label: "Active",
    color: "text-green-400",
    bg: "bg-green-500/10 border-green-500/20",
    icon: CheckCircle,
  },
  COMPLETED: {
    label: "Completed",
    color: "text-blue-400",
    bg: "bg-blue-500/10 border-blue-500/20",
    icon: CheckCircle,
  },
  EXPIRED: {
    label: "Expired",
    color: "text-zinc-400",
    bg: "bg-zinc-700/50 border-zinc-700",
    icon: AlertTriangle,
  },
  CANCELLED: {
    label: "Cancelled",
    color: "text-red-400",
    bg: "bg-red-500/10 border-red-500/20",
    icon: XCircle,
  },
  REJECTED: {
    label: "Rejected",
    color: "text-red-400",
    bg: "bg-red-500/10 border-red-500/20",
    icon: XCircle,
  },
};

const TABS: { label: string; value: string }[] = [
  { label: "All", value: "" },
  { label: "Pending", value: "PENDING_REVIEW" },
  { label: "Active", value: "ACTIVE" },
  { label: "Completed", value: "COMPLETED" },
  { label: "Cancelled", value: "CANCELLED" },
];

function formatDate(d?: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatPrice(p?: number | null) {
  if (p == null) return "—";
  return formatVND(p);
}

export function PTContractsPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState("");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [rejectId, setRejectId] = useState<string | null>(null);
  useBackDismissible(!!rejectId, () => setRejectId(null));
  const [rejectReason, setRejectReason] = useState("");
  const [cancelId, setCancelId] = useState<string | null>(null);
  useBackDismissible(!!cancelId, () => setCancelId(null));
  // Roadmap P4.1 "Notifications/reminders" (§27) — PT feedback.
  const [feedbackId, setFeedbackId] = useState<string | null>(null);
  useBackDismissible(!!feedbackId, () => setFeedbackId(null));
  const [feedbackText, setFeedbackText] = useState("");

  const { data: contracts = [], isLoading } = useQuery({
    queryKey: ["pt-contracts", tab],
    queryFn: () => contractService.getByPT(tab || undefined),
  });

  const acceptMutation = useMutation({
    mutationFn: (id: string) => contractService.acceptContract(id),
    onSuccess: () => {
      toast.success("Contract accepted!");
      queryClient.invalidateQueries({ queryKey: ["pt-contracts"] });
    },
    onError: (err: any) =>
      toast.error(err?.response?.data?.error || "Failed to accept"),
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      contractService.rejectContract(id, reason),
    onSuccess: () => {
      toast.success("Contract rejected");
      setRejectId(null);
      setRejectReason("");
      queryClient.invalidateQueries({ queryKey: ["pt-contracts"] });
    },
    onError: (err: any) =>
      toast.error(err?.response?.data?.error || "Failed to reject"),
  });

  const feedbackMutation = useMutation({
    mutationFn: ({ id, text }: { id: string; text: string }) => contractService.sendFeedback(id, text),
    onSuccess: () => {
      toast.success("Đã gửi phản hồi cho khách hàng");
      setFeedbackId(null);
      setFeedbackText("");
    },
    onError: (err: any) => toast.error(err?.response?.data?.error || "Không thể gửi phản hồi"),
  });

  // This button only ever shows for status === "ACTIVE" (real, paid money already split into
  // pending buckets) — cancelContract (a plain status flip, no money) must never be used
  // here. terminate settles everyone per PT_CANCELLED's formula: client gets 100% of the
  // unused value back, PLUS a 10% penalty charged to the PT/gym pending buckets (symmetric
  // to the client's own cancellation fee) — see docs/money-flow.md §3.5.
  const cancelMutation = useMutation({
    mutationFn: (id: string) => contractService.terminateContract(id, "PT_CANCELLED"),
    onSuccess: (result: any) => {
      const refund = Number(result?.settlement?.refund ?? 0);
      toast.success(
        refund > 0
          ? `Đã hủy hợp đồng — khách được hoàn ${refund.toLocaleString("vi-VN")}đ`
          : "Contract cancelled",
      );
      setCancelId(null);
      queryClient.invalidateQueries({ queryKey: ["pt-contracts"] });
    },
    onError: (err: any) =>
      toast.error(err?.response?.data?.error || "Failed to cancel"),
  });

  // ── Session queries & mutations ──────────────────────────────────
  const { data: expandedSessions = [] } = useQuery({
    queryKey: ["contract-sessions", expanded],
    queryFn: () =>
      expanded
        ? sessionService.getContractSessions(expanded)
        : Promise.resolve([]),
    enabled: !!expanded,
  });

  const confirmSessionMut = useMutation({
    mutationFn: (id: string) => sessionService.confirmSession(id),
    onSuccess: () => {
      toast.success("Session confirmed");
      queryClient.invalidateQueries({ queryKey: ["contract-sessions"] });
    },
    onError: (err: any) =>
      toast.error(err?.response?.data?.error || "Failed to confirm"),
  });

  const completeSessionMut = useMutation({
    mutationFn: (id: string) => sessionService.completeSession(id),
    onSuccess: () => {
      toast.success("Session marked as completed");
      queryClient.invalidateQueries({ queryKey: ["contract-sessions"] });
      queryClient.invalidateQueries({ queryKey: ["pt-contracts"] });
    },
    onError: (err: any) =>
      toast.error(err?.response?.data?.error || "Failed to complete"),
  });

  const cancelSessionMut = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      sessionService.cancelSession(id, reason),
    onSuccess: () => {
      toast.success("Session cancelled");
      queryClient.invalidateQueries({ queryKey: ["contract-sessions"] });
      queryClient.invalidateQueries({ queryKey: ["pt-contracts"] });
    },
    onError: (err: any) =>
      toast.error(err?.response?.data?.error || "Failed to cancel session"),
  });

  const noShowMut = useMutation({
    mutationFn: ({ id, noShowBy }: { id: string; noShowBy: "CLIENT" | "PT" }) =>
      sessionService.markNoShow(id, noShowBy),
    onSuccess: () => {
      toast.success("No-show recorded");
      queryClient.invalidateQueries({ queryKey: ["contract-sessions"] });
      queryClient.invalidateQueries({ queryKey: ["pt-contracts"] });
    },
    onError: (err: any) =>
      toast.error(err?.response?.data?.error || "Failed to record no-show"),
  });

  // Mirror-image of the client's session review (BookingPage.tsx) — PT rates the client
  // instead of the client rating the PT.
  const [reviewClientId, setReviewClientId] = useState<string | null>(null);
  useBackDismissible(!!reviewClientId, () => setReviewClientId(null));
  const [reviewClientRating, setReviewClientRating] = useState(5);
  const [reviewClientComment, setReviewClientComment] = useState("");
  const reviewClientMut = useMutation({
    mutationFn: () => {
      if (!reviewClientId) throw new Error("Missing data");
      return sessionService.reviewClient(
        reviewClientId,
        reviewClientRating,
        reviewClientComment,
      );
    },
    onSuccess: () => {
      toast.success("Đã gửi đánh giá về khách hàng");
      setReviewClientId(null);
      setReviewClientRating(5);
      setReviewClientComment("");
      queryClient.invalidateQueries({ queryKey: ["contract-sessions"] });
    },
    onError: (err: any) =>
      toast.error(err?.response?.data?.error || "Không gửi được đánh giá"),
  });

  const filtered = (contracts as Contract[]).filter((c) => {
    if (search) {
      const q = search.toLowerCase();
      return (
        c.packageName.toLowerCase().includes(q) ||
        c.clientUserId.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const kpis = {
    total: (contracts as Contract[]).length,
    pending: (contracts as Contract[]).filter(
      (c) => c.status === "PENDING_REVIEW",
    ).length,
    active: (contracts as Contract[]).filter((c) => c.status === "ACTIVE")
      .length,
    completed: (contracts as Contract[]).filter((c) => c.status === "COMPLETED")
      .length,
  };

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-zinc-100 flex items-center gap-2 text-xl font-bold">
          <FileText className="w-5 h-5 text-green-400" /> Contracts
        </h1>
        <p className="text-zinc-500 text-sm mt-0.5">
          Manage client coaching requests and agreements
        </p>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          {
            label: "Total",
            value: kpis.total,
            icon: FileText,
            accent: "text-zinc-300",
          },
          {
            label: "Pending",
            value: kpis.pending,
            icon: Clock,
            accent: "text-amber-400",
          },
          {
            label: "Active",
            value: kpis.active,
            icon: CheckCircle,
            accent: "text-green-400",
          },
          {
            label: "Completed",
            value: kpis.completed,
            icon: CheckCircle,
            accent: "text-blue-400",
          },
        ].map((kpi) => (
          <div
            key={kpi.label}
            className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4"
          >
            <div className="flex items-center gap-2 mb-1">
              <kpi.icon className={`w-4 h-4 ${kpi.accent}`} />
              <span className="text-xs text-zinc-500">{kpi.label}</span>
            </div>
            <div className={`text-2xl font-bold ${kpi.accent}`}>
              {kpi.value}
            </div>
          </div>
        ))}
      </div>

      {/* Search + Tabs */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex items-center gap-2 bg-zinc-900 border border-zinc-700/60 rounded-xl px-4 py-2.5 flex-1">
          <Search className="w-4 h-4 text-zinc-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by package name..."
            className="flex-1 text-sm outline-none bg-transparent text-zinc-300 placeholder-zinc-600"
          />
        </div>
        <div className="flex gap-2 overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.value}
              onClick={() => setTab(t.value)}
              className={`px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${
                tab === t.value
                  ? "bg-green-500 text-black shadow-lg shadow-green-500/20"
                  : "bg-zinc-900 border border-zinc-700/60 text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {t.label}
              {t.value === "PENDING_REVIEW" && kpis.pending > 0 && (
                <span className="ml-1.5 bg-amber-500 text-black text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                  {kpis.pending}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 text-green-500 animate-spin" />
        </div>
      )}

      {/* Empty state */}
      {!isLoading && filtered.length === 0 && (
        <div className="bg-zinc-900 rounded-2xl border border-zinc-800/60 p-20 text-center">
          <FileText className="w-12 h-12 text-zinc-800 mx-auto mb-4" />
          <h3 className="text-zinc-200 font-bold mb-1">No contracts</h3>
          <p className="text-sm text-zinc-500 max-w-xs mx-auto">
            Client coaching requests will appear here when clients request your
            services.
          </p>
        </div>
      )}

      {/* Contract list */}
      {!isLoading && filtered.length > 0 && (
        <div className="space-y-3">
          {filtered.map((c) => {
            const cfg = STATUS_CONFIG[c.status];
            const isExpanded = expanded === c.id;
            const sessionPct =
              c.totalSessions > 0
                ? Math.round((c.usedSessions / c.totalSessions) * 100)
                : 0;

            return (
              <div
                key={c.id}
                className={`bg-zinc-900 rounded-xl border overflow-hidden ${c.status === "PENDING_REVIEW" ? "border-amber-500/30" : "border-zinc-800/60"}`}
              >
                <button
                  onClick={() => setExpanded(isExpanded ? null : c.id)}
                  className="w-full text-left p-4 hover:bg-zinc-800/30 transition-colors"
                >
                  <div className="flex items-center gap-4">
                    <div
                      className={`w-10 h-10 rounded-xl flex items-center justify-center border ${cfg.bg}`}
                    >
                      <cfg.icon className={`w-5 h-5 ${cfg.color}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-bold text-zinc-200 truncate">
                          {c.packageName}
                        </span>
                        <span
                          className={`text-xs px-2 py-0.5 rounded-full font-semibold border ${cfg.bg} ${cfg.color}`}
                        >
                          {cfg.label}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-zinc-500">
                        <span className="flex items-center gap-1">
                          <User className="w-3 h-3" /> {partyName(c)}
                        </span>
                        {/* Client's rating from OTHER PTs' past sessions with them — the
                            counterpart to a client already seeing a PT's rating up front.
                            Most useful exactly on a PENDING_REVIEW request, before Accept. */}
                        {c.clientRating && c.clientRating.ratingCount > 0 && (
                          <span className="flex items-center gap-1" title={`${c.clientRating.ratingCount} đánh giá từ PT khác`}>
                            <Stars value={c.clientRating.avgRating ?? 0} size={12} />
                            <span>({c.clientRating.ratingCount})</span>
                          </span>
                        )}
                        <span className="flex items-center gap-1">
                          <Dumbbell className="w-3 h-3" /> {c.usedSessions}/
                          {c.totalSessions}
                        </span>
                        {c.price != null && (
                          <span className="flex items-center gap-1">
                            <DollarSign className="w-3 h-3" />{" "}
                            {formatPrice(c.price)}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Quick accept/reject for pending */}
                    {c.status === "PENDING_REVIEW" && (
                      <div
                        className="flex gap-2"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          onClick={() => acceptMutation.mutate(c.id)}
                          disabled={acceptMutation.isPending}
                          className="flex items-center gap-1 bg-green-500 hover:bg-green-400 text-black px-3 py-1.5 rounded-lg text-xs font-bold transition-all"
                        >
                          <Check className="w-3.5 h-3.5" /> Accept
                        </button>
                        <button
                          onClick={() => setRejectId(c.id)}
                          className="flex items-center gap-1 border border-red-500/30 text-red-400 hover:bg-red-500/10 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                        >
                          <X className="w-3.5 h-3.5" /> Reject
                        </button>
                      </div>
                    )}

                    <div className="hidden lg:block text-right">
                      <div className="text-xs text-zinc-500">
                        {formatDate(c.startDate)}
                      </div>
                      <div className="text-xs text-zinc-600">
                        {formatDate(c.endDate)}
                      </div>
                    </div>

                    {isExpanded ? (
                      <ChevronUp className="w-4 h-4 text-zinc-600" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-zinc-600" />
                    )}
                  </div>
                </button>

                {isExpanded && (
                  <div className="border-t border-zinc-800/60 p-4 space-y-4">
                    {/* Identity of the agreement — the reference a dispute is filed against. */}
                    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 bg-zinc-800/40 rounded-lg px-3 py-2">
                      <div className="min-w-0">
                        <div className="text-xs text-zinc-600 mb-0.5">
                          Contract ID
                        </div>
                        <code className="text-[11px] font-mono text-zinc-300 break-all select-all">
                          {c.id}
                        </code>
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs text-zinc-600 mb-0.5">
                          Client
                        </div>
                        <div className="text-xs text-zinc-300 truncate">
                          {partyName(c)}
                          {c.clientProfile?.email ? (
                            <span className="text-zinc-600">
                              {" "}
                              · {c.clientProfile.email}
                            </span>
                          ) : null}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-zinc-600 mb-0.5">
                          Created
                        </div>
                        <div className="text-xs text-zinc-300">
                          {formatDate(c.createdAt)}
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <div>
                        <div className="text-xs text-zinc-600 mb-0.5">
                          Package Type
                        </div>
                        <div className="text-sm text-zinc-300">
                          {c.packageType === "PER_SESSION"
                            ? "Per Session"
                            : "Package"}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-zinc-600 mb-0.5">
                          Start Date
                        </div>
                        <div className="text-sm text-zinc-300">
                          {formatDate(c.startDate)}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-zinc-600 mb-0.5">
                          End Date
                        </div>
                        <div className="text-sm text-zinc-300">
                          {formatDate(c.endDate)}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-zinc-600 mb-0.5">
                          Price
                        </div>
                        <div className="text-sm text-zinc-300 font-bold">
                          {formatPrice(c.price)}
                        </div>
                      </div>
                    </div>

                    {/* Session progress */}
                    <div>
                      <div className="text-xs text-zinc-600 mb-2">
                        Sessions: {c.usedSessions} / {c.totalSessions}
                      </div>
                      <div className="h-2.5 bg-zinc-800 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${sessionPct >= 90 ? "bg-red-500" : sessionPct >= 60 ? "bg-amber-500" : "bg-green-500"}`}
                          style={{ width: `${sessionPct}%` }}
                        />
                      </div>
                    </div>

                    {/* Sessions list for active/completed contracts */}
                    {(c.status === "ACTIVE" || c.status === "COMPLETED") &&
                      (expandedSessions as Session[]).length > 0 && (
                        <div>
                          <div className="text-xs text-zinc-500 font-semibold uppercase tracking-wider mb-2 flex items-center gap-1.5">
                            <Calendar className="w-3 h-3" /> Sessions (
                            {(expandedSessions as Session[]).length})
                          </div>
                          <div className="space-y-2">
                            {(expandedSessions as Session[]).map((s) => {
                              const scfg = SESSION_STATUS[s.status];
                              return (
                                <div
                                  key={s.id}
                                  className="bg-zinc-800/40 rounded-lg p-3 flex items-center justify-between"
                                >
                                  <div>
                                    <div className="flex items-center gap-2 mb-0.5">
                                      <span
                                        className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${scfg.bg} ${scfg.color}`}
                                      >
                                        {scfg.label}
                                      </span>
                                      <span className="text-xs text-zinc-600">
                                        {s.sessionMode === "ONLINE"
                                          ? "Online"
                                          : "In Person"}
                                      </span>
                                    </div>
                                    <div className="text-sm text-zinc-300 font-medium">
                                      {formatSessionTime(s.scheduledStartAt)}
                                    </div>
                                    {s.notes && (
                                      <p className="text-xs text-zinc-600 mt-0.5">
                                        {s.notes}
                                      </p>
                                    )}
                                  </div>
                                  <div className="flex gap-1.5">
                                    {s.status === "REQUESTED" && (
                                      <>
                                        <button
                                          onClick={() =>
                                            confirmSessionMut.mutate(s.id)
                                          }
                                          disabled={confirmSessionMut.isPending}
                                          className="flex items-center gap-1 bg-green-500 hover:bg-green-400 text-black px-2.5 py-1.5 rounded-lg text-[10px] font-bold transition-all"
                                        >
                                          <Check className="w-3 h-3" /> Confirm
                                        </button>
                                        <button
                                          onClick={() =>
                                            cancelSessionMut.mutate({
                                              id: s.id,
                                              reason: "PT declined",
                                            })
                                          }
                                          disabled={cancelSessionMut.isPending}
                                          className="flex items-center gap-1 border border-red-500/30 text-red-400 hover:bg-red-500/10 px-2.5 py-1.5 rounded-lg text-[10px] font-medium transition-colors"
                                        >
                                          <X className="w-3 h-3" /> Decline
                                        </button>
                                      </>
                                    )}
                                    {s.status === "CONFIRMED" && (
                                      <>
                                        {/* Open-room redesign: an ONLINE session's outcome
                                            is now decided automatically by the room-close
                                            sweep once its window passes — Complete/No-Show
                                            would just race that same decision by hand. Cancel
                                            stays for both modes (a different, earlier moment
                                            in the session's life). */}
                                        {s.sessionMode !== "ONLINE" && (
                                          <>
                                            <button
                                              onClick={() =>
                                                completeSessionMut.mutate(s.id)
                                              }
                                              disabled={
                                                completeSessionMut.isPending
                                              }
                                              className="flex items-center gap-1 bg-blue-500 hover:bg-blue-400 text-white px-2.5 py-1.5 rounded-lg text-[10px] font-bold transition-all"
                                            >
                                              <CheckCircle className="w-3 h-3" />{" "}
                                              Complete
                                            </button>
                                            <button
                                              onClick={() =>
                                                noShowMut.mutate({
                                                  id: s.id,
                                                  noShowBy: "CLIENT",
                                                })
                                              }
                                              disabled={noShowMut.isPending}
                                              className="flex items-center gap-1 border border-amber-500/30 text-amber-400 hover:bg-amber-500/10 px-2.5 py-1.5 rounded-lg text-[10px] font-medium transition-colors"
                                            >
                                              <AlertOctagon className="w-3 h-3" />{" "}
                                              No-Show
                                            </button>
                                          </>
                                        )}
                                        <button
                                          onClick={() =>
                                            cancelSessionMut.mutate({
                                              id: s.id,
                                              reason: "PT cancelled",
                                            })
                                          }
                                          disabled={cancelSessionMut.isPending}
                                          className="flex items-center gap-1 border border-red-500/30 text-red-400 hover:bg-red-500/10 px-2.5 py-1.5 rounded-lg text-[10px] font-medium transition-colors"
                                        >
                                          <X className="w-3 h-3" /> Cancel
                                        </button>
                                      </>
                                    )}
                                    {/* Mirror-image of the client's own post-session review
                                        (BookingPage.tsx) — PT rates the client's conduct. */}
                                    {s.status === "COMPLETED" &&
                                      !s.clientReview && (
                                        <button
                                          onClick={() =>
                                            setReviewClientId(s.id)
                                          }
                                          className="flex items-center gap-1 bg-green-500/10 border border-green-500/20 text-green-400 px-2.5 py-1.5 rounded-lg text-[10px] font-semibold hover:bg-green-500/20 transition-colors"
                                        >
                                          <Star className="w-3 h-3" /> Đánh
                                          giá khách
                                        </button>
                                      )}
                                    {s.clientReview && (
                                      <div className="flex items-center gap-0.5">
                                        {Array.from({ length: 5 }).map(
                                          (_, i) => (
                                            <Star
                                              key={i}
                                              className={`w-3 h-3 ${i < s.clientReview!.rating ? "text-amber-400 fill-amber-400" : "text-zinc-700"}`}
                                            />
                                          ),
                                        )}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                    {c.clientMessage && (
                      <div className="bg-zinc-800/30 rounded-lg p-3">
                        <div className="text-xs text-zinc-500 mb-1 flex items-center gap-1">
                          <MessageSquare className="w-3 h-3" /> Client Message
                        </div>
                        <p className="text-sm text-zinc-400">
                          {c.clientMessage}
                        </p>
                      </div>
                    )}

                    {c.rejectionReason && (
                      <div className="bg-red-500/5 border border-red-500/20 rounded-lg p-3">
                        <div className="text-xs text-red-400 mb-1">
                          Rejection Reason
                        </div>
                        <p className="text-sm text-zinc-400">
                          {c.rejectionReason}
                        </p>
                      </div>
                    )}

                    {c.cancellationReason && (
                      <div className="bg-red-500/5 border border-red-500/20 rounded-lg p-3">
                        <div className="text-xs text-red-400 mb-1">
                          Cancellation Reason
                        </div>
                        <p className="text-sm text-zinc-400">
                          {c.cancellationReason}
                        </p>
                      </div>
                    )}

                    {/* Actions */}
                    <div className="flex flex-wrap gap-2 pt-2 border-t border-zinc-800/40">
                      {c.status === "PENDING_REVIEW" && (
                        <>
                          <button
                            onClick={() => acceptMutation.mutate(c.id)}
                            disabled={acceptMutation.isPending}
                            className="flex items-center gap-1.5 bg-green-500 hover:bg-green-400 text-black px-3 py-2 rounded-lg text-xs font-bold transition-all"
                          >
                            <Check className="w-3.5 h-3.5" /> Accept
                          </button>
                          <button
                            onClick={() => setRejectId(c.id)}
                            className="flex items-center gap-1.5 border border-red-500/30 text-red-400 hover:bg-red-500/10 px-3 py-2 rounded-lg text-xs font-medium transition-colors"
                          >
                            <X className="w-3.5 h-3.5" /> Reject
                          </button>
                        </>
                      )}
                      {c.status === "ACTIVE" && (
                        <>
                          <button
                            data-testid={`send-feedback-${c.id}`}
                            onClick={() => setFeedbackId(c.id)}
                            className="flex items-center gap-1.5 border border-sky-500/30 text-sky-400 hover:bg-sky-500/10 px-3 py-2 rounded-lg text-xs font-medium transition-colors"
                          >
                            <MessageSquare className="w-3.5 h-3.5" /> Gửi phản hồi
                          </button>
                          <button
                            onClick={() => setCancelId(c.id)}
                            className="flex items-center gap-1.5 border border-red-500/30 text-red-400 hover:bg-red-500/10 px-3 py-2 rounded-lg text-xs font-medium transition-colors"
                          >
                            <Ban className="w-3.5 h-3.5" /> Cancel Contract
                          </button>
                        </>
                      )}
                      <div className="ml-auto text-xs text-zinc-600 self-center">
                        Created {formatDate(c.createdAt)}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Roadmap P4.1 "Notifications/reminders" — Send Feedback Dialog */}
      {feedbackId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-zinc-900 border border-zinc-700/60 rounded-2xl w-full max-w-md shadow-2xl">
            <div className="p-5 border-b border-zinc-800/60">
              <h3 className="text-zinc-100 font-bold">Gửi phản hồi cho khách hàng</h3>
            </div>
            <div className="p-5 space-y-4">
              <p className="text-sm text-zinc-400">
                Tin nhắn này sẽ xuất hiện trong danh sách thông báo của khách hàng.
              </p>
              <textarea
                value={feedbackText}
                onChange={(e) => setFeedbackText(e.target.value)}
                rows={4}
                maxLength={1000}
                placeholder="Ví dụ: Tuần này bạn tiến bộ rõ rệt, tiếp tục duy trì nhé!"
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-sky-500/50 resize-none"
              />
            </div>
            <div className="p-5 border-t border-zinc-800/60 flex gap-3">
              <button
                onClick={() => {
                  setFeedbackId(null);
                  setFeedbackText("");
                }}
                className="flex-1 py-2.5 border border-zinc-700/60 text-zinc-300 text-sm font-semibold rounded-lg hover:bg-zinc-800 transition-colors"
              >
                Hủy
              </button>
              <button
                data-testid="send-feedback-submit"
                onClick={() => feedbackMutation.mutate({ id: feedbackId, text: feedbackText })}
                disabled={!feedbackText.trim() || feedbackMutation.isPending}
                className="flex-1 py-2.5 bg-sky-500 text-black text-sm font-semibold rounded-lg hover:bg-sky-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {feedbackMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Gửi
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reject Dialog */}
      {rejectId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-zinc-900 border border-zinc-700/60 rounded-2xl w-full max-w-md shadow-2xl">
            <div className="p-5 border-b border-zinc-800/60">
              <h3 className="text-zinc-100 font-bold">
                Reject Coaching Request
              </h3>
            </div>
            <div className="p-5 space-y-4">
              <p className="text-sm text-zinc-400">
                Please provide a reason for declining this request. The client
                will see this.
              </p>
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                rows={3}
                placeholder="Reason for rejection..."
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-red-500/50 resize-none"
              />
            </div>
            <div className="p-5 border-t border-zinc-800/60 flex gap-3">
              <button
                onClick={() => {
                  setRejectId(null);
                  setRejectReason("");
                }}
                className="flex-1 py-2.5 border border-zinc-700/60 text-zinc-300 text-sm font-semibold rounded-lg hover:bg-zinc-800 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() =>
                  rejectMutation.mutate({ id: rejectId, reason: rejectReason })
                }
                disabled={!rejectReason.trim() || rejectMutation.isPending}
                className="flex-1 py-2.5 bg-red-500 hover:bg-red-400 disabled:bg-zinc-700 disabled:text-zinc-500 text-white text-sm font-bold rounded-lg transition-all flex items-center justify-center gap-2"
              >
                {rejectMutation.isPending && (
                  <Loader2 className="w-4 h-4 animate-spin" />
                )}
                Reject
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Review Client Dialog — mirror-image of BookingPage.tsx's client review modal */}
      {reviewClientId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-zinc-900 border border-zinc-700/60 rounded-2xl w-full max-w-md shadow-2xl">
            <div className="p-5 border-b border-zinc-800/60">
              <h3 className="text-zinc-100 font-bold">Đánh giá khách hàng</h3>
            </div>
            <div className="p-5 space-y-4">
              <div className="flex items-center justify-center gap-1">
                {Array.from({ length: 5 }).map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setReviewClientRating(i + 1)}
                  >
                    <Star
                      className={`w-8 h-8 transition-colors ${i < reviewClientRating ? "text-amber-400 fill-amber-400" : "text-zinc-700 hover:text-zinc-500"}`}
                    />
                  </button>
                ))}
              </div>
              <textarea
                value={reviewClientComment}
                onChange={(e) => setReviewClientComment(e.target.value)}
                rows={3}
                placeholder="Khách hàng này thế nào? (đúng giờ, hợp tác...) — không bắt buộc"
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-green-500/50 resize-none"
              />
            </div>
            <div className="p-5 border-t border-zinc-800/60 flex gap-3">
              <button
                onClick={() => {
                  setReviewClientId(null);
                  setReviewClientRating(5);
                  setReviewClientComment("");
                }}
                className="flex-1 py-2.5 border border-zinc-700/60 text-zinc-300 text-sm font-semibold rounded-lg hover:bg-zinc-800 transition-colors"
              >
                Bỏ qua
              </button>
              <button
                onClick={() => reviewClientMut.mutate()}
                disabled={reviewClientMut.isPending}
                className="flex-1 py-2.5 bg-green-500 hover:bg-green-400 disabled:bg-zinc-700 disabled:text-zinc-500 text-black text-sm font-bold rounded-lg transition-all flex items-center justify-center gap-2"
              >
                {reviewClientMut.isPending && (
                  <Loader2 className="w-4 h-4 animate-spin" />
                )}
                Gửi đánh giá
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cancel Dialog */}
      {cancelId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-zinc-900 border border-zinc-700/60 rounded-2xl w-full max-w-md shadow-2xl">
            <div className="p-5 border-b border-zinc-800/60">
              <h3 className="text-zinc-100 font-bold">Cancel Contract</h3>
            </div>
            <div className="p-5 space-y-4">
              <p className="text-sm text-zinc-400">
                This cannot be undone. The client is refunded 100% of the unused value —
                <span className="text-amber-400 font-semibold"> plus a 10% cancellation penalty
                charged against your (and the gym's, if any) pending balance.</span>
              </p>
            </div>
            <div className="p-5 border-t border-zinc-800/60 flex gap-3">
              <button
                onClick={() => setCancelId(null)}
                className="flex-1 py-2.5 border border-zinc-700/60 text-zinc-300 text-sm font-semibold rounded-lg hover:bg-zinc-800 transition-colors"
              >
                Keep
              </button>
              <button
                onClick={() => cancelMutation.mutate(cancelId)}
                disabled={cancelMutation.isPending}
                className="flex-1 py-2.5 bg-red-500 hover:bg-red-400 disabled:bg-zinc-700 disabled:text-zinc-500 text-white text-sm font-bold rounded-lg transition-all flex items-center justify-center gap-2"
              >
                {cancelMutation.isPending && (
                  <Loader2 className="w-4 h-4 animate-spin" />
                )}
                Cancel Contract
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
