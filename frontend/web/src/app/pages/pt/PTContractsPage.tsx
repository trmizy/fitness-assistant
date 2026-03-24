import { useState } from "react";
import {
  FileText, Search, CheckCircle, Clock, XCircle, AlertTriangle,
  User, ChevronDown, ChevronUp, DollarSign, Dumbbell,
  PlayCircle, Ban, Loader2, Check, X, MessageSquare, Calendar, AlertOctagon,
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { contractService, sessionService } from "../../services/api";
import { toast } from "sonner";
import type { Contract, ContractStatus, Session, SessionStatus } from "../../types";

const SESSION_STATUS: Record<SessionStatus, { label: string; color: string; bg: string }> = {
  REQUESTED: { label: "Pending", color: "text-amber-400", bg: "bg-amber-500/10 border-amber-500/20" },
  CONFIRMED: { label: "Confirmed", color: "text-green-400", bg: "bg-green-500/10 border-green-500/20" },
  COMPLETED: { label: "Completed", color: "text-blue-400", bg: "bg-blue-500/10 border-blue-500/20" },
  CANCELLED: { label: "Cancelled", color: "text-red-400", bg: "bg-red-500/10 border-red-500/20" },
  NO_SHOW: { label: "No Show", color: "text-zinc-400", bg: "bg-zinc-700/50 border-zinc-700" },
};

function formatSessionTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + " " + d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}

const STATUS_CONFIG: Record<ContractStatus, { label: string; color: string; bg: string; icon: React.ElementType }> = {
  PENDING_REVIEW: { label: "Pending Review", color: "text-amber-400", bg: "bg-amber-500/10 border-amber-500/20", icon: Clock },
  ACTIVE:         { label: "Active",         color: "text-green-400", bg: "bg-green-500/10 border-green-500/20", icon: CheckCircle },
  COMPLETED:      { label: "Completed",      color: "text-blue-400",  bg: "bg-blue-500/10 border-blue-500/20",  icon: CheckCircle },
  EXPIRED:        { label: "Expired",        color: "text-zinc-400",  bg: "bg-zinc-700/50 border-zinc-700",     icon: AlertTriangle },
  CANCELLED:      { label: "Cancelled",      color: "text-red-400",   bg: "bg-red-500/10 border-red-500/20",    icon: XCircle },
  REJECTED:       { label: "Rejected",       color: "text-red-400",   bg: "bg-red-500/10 border-red-500/20",    icon: XCircle },
};

const TABS: { label: string; value: string }[] = [
  { label: "All",      value: "" },
  { label: "Pending",  value: "PENDING_REVIEW" },
  { label: "Active",   value: "ACTIVE" },
  { label: "Completed", value: "COMPLETED" },
  { label: "Cancelled", value: "CANCELLED" },
];

function formatDate(d?: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatPrice(p?: number | null) {
  if (!p) return "—";
  return `฿${p.toLocaleString()}`;
}

export function PTContractsPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState("");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState("");

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
    onError: (err: any) => toast.error(err?.response?.data?.error || "Failed to accept"),
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => contractService.rejectContract(id, reason),
    onSuccess: () => {
      toast.success("Contract rejected");
      setRejectId(null);
      setRejectReason("");
      queryClient.invalidateQueries({ queryKey: ["pt-contracts"] });
    },
    onError: (err: any) => toast.error(err?.response?.data?.error || "Failed to reject"),
  });

  const cancelMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => contractService.cancelContract(id, reason),
    onSuccess: () => {
      toast.success("Contract cancelled");
      setCancelId(null);
      setCancelReason("");
      queryClient.invalidateQueries({ queryKey: ["pt-contracts"] });
    },
    onError: (err: any) => toast.error(err?.response?.data?.error || "Failed to cancel"),
  });

  // ── Session queries & mutations ──────────────────────────────────
  const { data: expandedSessions = [] } = useQuery({
    queryKey: ["contract-sessions", expanded],
    queryFn: () => expanded ? sessionService.getContractSessions(expanded) : Promise.resolve([]),
    enabled: !!expanded,
  });

  const confirmSessionMut = useMutation({
    mutationFn: (id: string) => sessionService.confirmSession(id),
    onSuccess: () => {
      toast.success("Session confirmed");
      queryClient.invalidateQueries({ queryKey: ["contract-sessions"] });
    },
    onError: (err: any) => toast.error(err?.response?.data?.error || "Failed to confirm"),
  });

  const completeSessionMut = useMutation({
    mutationFn: (id: string) => sessionService.completeSession(id),
    onSuccess: () => {
      toast.success("Session marked as completed");
      queryClient.invalidateQueries({ queryKey: ["contract-sessions"] });
      queryClient.invalidateQueries({ queryKey: ["pt-contracts"] });
    },
    onError: (err: any) => toast.error(err?.response?.data?.error || "Failed to complete"),
  });

  const cancelSessionMut = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => sessionService.cancelSession(id, reason),
    onSuccess: () => {
      toast.success("Session cancelled");
      queryClient.invalidateQueries({ queryKey: ["contract-sessions"] });
      queryClient.invalidateQueries({ queryKey: ["pt-contracts"] });
    },
    onError: (err: any) => toast.error(err?.response?.data?.error || "Failed to cancel session"),
  });

  const noShowMut = useMutation({
    mutationFn: ({ id, noShowBy }: { id: string; noShowBy: "CLIENT" | "PT" }) => sessionService.markNoShow(id, noShowBy),
    onSuccess: () => {
      toast.success("No-show recorded");
      queryClient.invalidateQueries({ queryKey: ["contract-sessions"] });
      queryClient.invalidateQueries({ queryKey: ["pt-contracts"] });
    },
    onError: (err: any) => toast.error(err?.response?.data?.error || "Failed to record no-show"),
  });

  const filtered = (contracts as Contract[]).filter((c) => {
    if (search) {
      const q = search.toLowerCase();
      return c.packageName.toLowerCase().includes(q) || c.clientUserId.toLowerCase().includes(q);
    }
    return true;
  });

  const kpis = {
    total: (contracts as Contract[]).length,
    pending: (contracts as Contract[]).filter((c) => c.status === "PENDING_REVIEW").length,
    active: (contracts as Contract[]).filter((c) => c.status === "ACTIVE").length,
    completed: (contracts as Contract[]).filter((c) => c.status === "COMPLETED").length,
  };

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-zinc-100 flex items-center gap-2 text-xl font-bold">
          <FileText className="w-5 h-5 text-green-400" /> Contracts
        </h1>
        <p className="text-zinc-500 text-sm mt-0.5">Manage client coaching requests and agreements</p>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Total", value: kpis.total, icon: FileText, accent: "text-zinc-300" },
          { label: "Pending", value: kpis.pending, icon: Clock, accent: "text-amber-400" },
          { label: "Active", value: kpis.active, icon: CheckCircle, accent: "text-green-400" },
          { label: "Completed", value: kpis.completed, icon: CheckCircle, accent: "text-blue-400" },
        ].map((kpi) => (
          <div key={kpi.label} className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4">
            <div className="flex items-center gap-2 mb-1">
              <kpi.icon className={`w-4 h-4 ${kpi.accent}`} />
              <span className="text-xs text-zinc-500">{kpi.label}</span>
            </div>
            <div className={`text-2xl font-bold ${kpi.accent}`}>{kpi.value}</div>
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
                <span className="ml-1.5 bg-amber-500 text-black text-[10px] font-bold px-1.5 py-0.5 rounded-full">{kpis.pending}</span>
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
            Client coaching requests will appear here when clients request your services.
          </p>
        </div>
      )}

      {/* Contract list */}
      {!isLoading && filtered.length > 0 && (
        <div className="space-y-3">
          {filtered.map((c) => {
            const cfg = STATUS_CONFIG[c.status];
            const isExpanded = expanded === c.id;
            const sessionPct = c.totalSessions > 0 ? Math.round((c.usedSessions / c.totalSessions) * 100) : 0;

            return (
              <div key={c.id} className={`bg-zinc-900 rounded-xl border overflow-hidden ${c.status === "PENDING_REVIEW" ? "border-amber-500/30" : "border-zinc-800/60"}`}>
                <button
                  onClick={() => setExpanded(isExpanded ? null : c.id)}
                  className="w-full text-left p-4 hover:bg-zinc-800/30 transition-colors"
                >
                  <div className="flex items-center gap-4">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center border ${cfg.bg}`}>
                      <cfg.icon className={`w-5 h-5 ${cfg.color}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-bold text-zinc-200 truncate">{c.packageName}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-semibold border ${cfg.bg} ${cfg.color}`}>{cfg.label}</span>
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-zinc-500">
                        <span className="flex items-center gap-1"><User className="w-3 h-3" /> {c.clientUserId.slice(0, 8)}...</span>
                        <span className="flex items-center gap-1"><Dumbbell className="w-3 h-3" /> {c.usedSessions}/{c.totalSessions}</span>
                        {c.price != null && <span className="flex items-center gap-1"><DollarSign className="w-3 h-3" /> {formatPrice(c.price)}</span>}
                      </div>
                    </div>

                    {/* Quick accept/reject for pending */}
                    {c.status === "PENDING_REVIEW" && (
                      <div className="flex gap-2" onClick={e => e.stopPropagation()}>
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
                      <div className="text-xs text-zinc-500">{formatDate(c.startDate)}</div>
                      <div className="text-xs text-zinc-600">{formatDate(c.endDate)}</div>
                    </div>

                    {isExpanded ? <ChevronUp className="w-4 h-4 text-zinc-600" /> : <ChevronDown className="w-4 h-4 text-zinc-600" />}
                  </div>
                </button>

                {isExpanded && (
                  <div className="border-t border-zinc-800/60 p-4 space-y-4">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <div>
                        <div className="text-xs text-zinc-600 mb-0.5">Package Type</div>
                        <div className="text-sm text-zinc-300">{c.packageType === "PER_SESSION" ? "Per Session" : "Package"}</div>
                      </div>
                      <div>
                        <div className="text-xs text-zinc-600 mb-0.5">Start Date</div>
                        <div className="text-sm text-zinc-300">{formatDate(c.startDate)}</div>
                      </div>
                      <div>
                        <div className="text-xs text-zinc-600 mb-0.5">End Date</div>
                        <div className="text-sm text-zinc-300">{formatDate(c.endDate)}</div>
                      </div>
                      <div>
                        <div className="text-xs text-zinc-600 mb-0.5">Price</div>
                        <div className="text-sm text-zinc-300 font-bold">{formatPrice(c.price)}</div>
                      </div>
                    </div>

                    {/* Session progress */}
                    <div>
                      <div className="text-xs text-zinc-600 mb-2">Sessions: {c.usedSessions} / {c.totalSessions}</div>
                      <div className="h-2.5 bg-zinc-800 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${sessionPct >= 90 ? "bg-red-500" : sessionPct >= 60 ? "bg-amber-500" : "bg-green-500"}`}
                          style={{ width: `${sessionPct}%` }}
                        />
                      </div>
                    </div>

                    {/* Sessions list for active/completed contracts */}
                    {(c.status === "ACTIVE" || c.status === "COMPLETED") && (expandedSessions as Session[]).length > 0 && (
                      <div>
                        <div className="text-xs text-zinc-500 font-semibold uppercase tracking-wider mb-2 flex items-center gap-1.5">
                          <Calendar className="w-3 h-3" /> Sessions ({(expandedSessions as Session[]).length})
                        </div>
                        <div className="space-y-2">
                          {(expandedSessions as Session[]).map((s) => {
                            const scfg = SESSION_STATUS[s.status];
                            return (
                              <div key={s.id} className="bg-zinc-800/40 rounded-lg p-3 flex items-center justify-between">
                                <div>
                                  <div className="flex items-center gap-2 mb-0.5">
                                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${scfg.bg} ${scfg.color}`}>{scfg.label}</span>
                                    <span className="text-xs text-zinc-600">{s.sessionMode === "ONLINE" ? "Online" : "In Person"}</span>
                                  </div>
                                  <div className="text-sm text-zinc-300 font-medium">{formatSessionTime(s.scheduledStartAt)}</div>
                                  {s.notes && <p className="text-xs text-zinc-600 mt-0.5">{s.notes}</p>}
                                </div>
                                <div className="flex gap-1.5">
                                  {s.status === "REQUESTED" && (
                                    <>
                                      <button
                                        onClick={() => confirmSessionMut.mutate(s.id)}
                                        disabled={confirmSessionMut.isPending}
                                        className="flex items-center gap-1 bg-green-500 hover:bg-green-400 text-black px-2.5 py-1.5 rounded-lg text-[10px] font-bold transition-all"
                                      >
                                        <Check className="w-3 h-3" /> Confirm
                                      </button>
                                      <button
                                        onClick={() => cancelSessionMut.mutate({ id: s.id, reason: "PT declined" })}
                                        disabled={cancelSessionMut.isPending}
                                        className="flex items-center gap-1 border border-red-500/30 text-red-400 hover:bg-red-500/10 px-2.5 py-1.5 rounded-lg text-[10px] font-medium transition-colors"
                                      >
                                        <X className="w-3 h-3" /> Decline
                                      </button>
                                    </>
                                  )}
                                  {s.status === "CONFIRMED" && (
                                    <>
                                      <button
                                        onClick={() => completeSessionMut.mutate(s.id)}
                                        disabled={completeSessionMut.isPending}
                                        className="flex items-center gap-1 bg-blue-500 hover:bg-blue-400 text-white px-2.5 py-1.5 rounded-lg text-[10px] font-bold transition-all"
                                      >
                                        <CheckCircle className="w-3 h-3" /> Complete
                                      </button>
                                      <button
                                        onClick={() => noShowMut.mutate({ id: s.id, noShowBy: "CLIENT" })}
                                        disabled={noShowMut.isPending}
                                        className="flex items-center gap-1 border border-amber-500/30 text-amber-400 hover:bg-amber-500/10 px-2.5 py-1.5 rounded-lg text-[10px] font-medium transition-colors"
                                      >
                                        <AlertOctagon className="w-3 h-3" /> No-Show
                                      </button>
                                      <button
                                        onClick={() => cancelSessionMut.mutate({ id: s.id, reason: "PT cancelled" })}
                                        disabled={cancelSessionMut.isPending}
                                        className="flex items-center gap-1 border border-red-500/30 text-red-400 hover:bg-red-500/10 px-2.5 py-1.5 rounded-lg text-[10px] font-medium transition-colors"
                                      >
                                        <X className="w-3 h-3" /> Cancel
                                      </button>
                                    </>
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
                        <div className="text-xs text-zinc-500 mb-1 flex items-center gap-1"><MessageSquare className="w-3 h-3" /> Client Message</div>
                        <p className="text-sm text-zinc-400">{c.clientMessage}</p>
                      </div>
                    )}

                    {c.rejectionReason && (
                      <div className="bg-red-500/5 border border-red-500/20 rounded-lg p-3">
                        <div className="text-xs text-red-400 mb-1">Rejection Reason</div>
                        <p className="text-sm text-zinc-400">{c.rejectionReason}</p>
                      </div>
                    )}

                    {c.cancellationReason && (
                      <div className="bg-red-500/5 border border-red-500/20 rounded-lg p-3">
                        <div className="text-xs text-red-400 mb-1">Cancellation Reason</div>
                        <p className="text-sm text-zinc-400">{c.cancellationReason}</p>
                      </div>
                    )}

                    {/* Actions */}
                    <div className="flex flex-wrap gap-2 pt-2 border-t border-zinc-800/40">
                      {c.status === "PENDING_REVIEW" && (
                        <>
                          <button onClick={() => acceptMutation.mutate(c.id)} disabled={acceptMutation.isPending} className="flex items-center gap-1.5 bg-green-500 hover:bg-green-400 text-black px-3 py-2 rounded-lg text-xs font-bold transition-all">
                            <Check className="w-3.5 h-3.5" /> Accept
                          </button>
                          <button onClick={() => setRejectId(c.id)} className="flex items-center gap-1.5 border border-red-500/30 text-red-400 hover:bg-red-500/10 px-3 py-2 rounded-lg text-xs font-medium transition-colors">
                            <X className="w-3.5 h-3.5" /> Reject
                          </button>
                        </>
                      )}
                      {c.status === "ACTIVE" && (
                        <button onClick={() => setCancelId(c.id)} className="flex items-center gap-1.5 border border-red-500/30 text-red-400 hover:bg-red-500/10 px-3 py-2 rounded-lg text-xs font-medium transition-colors">
                          <Ban className="w-3.5 h-3.5" /> Cancel Contract
                        </button>
                      )}
                      <div className="ml-auto text-xs text-zinc-600 self-center">Created {formatDate(c.createdAt)}</div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Reject Dialog */}
      {rejectId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-zinc-900 border border-zinc-700/60 rounded-2xl w-full max-w-md shadow-2xl">
            <div className="p-5 border-b border-zinc-800/60">
              <h3 className="text-zinc-100 font-bold">Reject Coaching Request</h3>
            </div>
            <div className="p-5 space-y-4">
              <p className="text-sm text-zinc-400">Please provide a reason for declining this request. The client will see this.</p>
              <textarea
                value={rejectReason}
                onChange={e => setRejectReason(e.target.value)}
                rows={3}
                placeholder="Reason for rejection..."
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-red-500/50 resize-none"
              />
            </div>
            <div className="p-5 border-t border-zinc-800/60 flex gap-3">
              <button onClick={() => { setRejectId(null); setRejectReason(""); }} className="flex-1 py-2.5 border border-zinc-700/60 text-zinc-300 text-sm font-semibold rounded-lg hover:bg-zinc-800 transition-colors">
                Cancel
              </button>
              <button
                onClick={() => rejectMutation.mutate({ id: rejectId, reason: rejectReason })}
                disabled={!rejectReason.trim() || rejectMutation.isPending}
                className="flex-1 py-2.5 bg-red-500 hover:bg-red-400 disabled:bg-zinc-700 disabled:text-zinc-500 text-white text-sm font-bold rounded-lg transition-all flex items-center justify-center gap-2"
              >
                {rejectMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                Reject
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
              <p className="text-sm text-zinc-400">Are you sure? This cannot be undone. Please provide a reason.</p>
              <textarea
                value={cancelReason}
                onChange={e => setCancelReason(e.target.value)}
                rows={3}
                placeholder="Cancellation reason..."
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700/60 rounded-lg text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-red-500/50 resize-none"
              />
            </div>
            <div className="p-5 border-t border-zinc-800/60 flex gap-3">
              <button onClick={() => { setCancelId(null); setCancelReason(""); }} className="flex-1 py-2.5 border border-zinc-700/60 text-zinc-300 text-sm font-semibold rounded-lg hover:bg-zinc-800 transition-colors">
                Keep
              </button>
              <button
                onClick={() => cancelMutation.mutate({ id: cancelId, reason: cancelReason })}
                disabled={!cancelReason.trim() || cancelMutation.isPending}
                className="flex-1 py-2.5 bg-red-500 hover:bg-red-400 disabled:bg-zinc-700 disabled:text-zinc-500 text-white text-sm font-bold rounded-lg transition-all flex items-center justify-center gap-2"
              >
                {cancelMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                Cancel Contract
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
