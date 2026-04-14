/**
 * AdminAIObservability — real-time AI request observability dashboard.
 *
 * All data comes from live backend endpoints:
 *   GET /admin/ai/overview  → totals, latency, fallback rate, intent distribution
 *   GET /admin/ai/requests  → paginated conversation list with filters
 *   GET /admin/ai/requests/:id → trace detail drawer
 *   GET /admin/ai/queue     → plan job queue + BullMQ live counts
 *   GET /admin/ai/errors    → failed plans + high-warning conversations
 *
 * NO static data, NO mock cards, NO placeholder charts.
 */
import { useCallback, useEffect, useState } from "react";
import {
  BarChart, Bar, PieChart, Pie, Cell,
  ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";
import {
  Brain, AlertTriangle, Activity, RefreshCw, Clock, Loader2,
  ChevronRight, X, Layers, CheckCircle2, XCircle, Zap, Languages,
  Filter, Search, ArrowLeft, ArrowRight,
} from "lucide-react";
import { adminService } from "../../services/api";

// ─── Types ────────────────────────────────────────────────────────────────────

type OverviewData = {
  generatedAt: string;
  conversations: {
    total: number;
    last24h: number;
    fallbackRate: number;
    deterministicFallbackRate: number;
    warningRate: number;
    avgLatencySeconds: number | null;
    p95LatencySeconds: number | null;
    slowCount: number;
  };
  intents: Array<{ intent: string; count: number }>;
  languages: Array<{ language: string; count: number }>;
  plans: {
    queued: number;
    processing: number;
    completed: number;
    failed: number;
    queue: {
      waiting: number | null;
      active: number | null;
      completed: number | null;
      failed: number | null;
      delayed: number | null;
    };
  };
};

type RequestItem = {
  id: string;
  userId: string | null;
  question: string;
  modelUsed: string;
  responseTime: number;
  responseLanguage: string | null;
  routeIntent: string | null;
  usedFallback: boolean;
  usedDeterministicFallback: boolean;
  warningCount: number;
  traceId: string | null;
  totalTokens: number;
  feedback: number | null;
  relevance: string | null;
  createdAt: string;
};

type RequestsData = {
  items: RequestItem[];
  total: number;
  page: number;
  limit: number;
  pages: number;
};

type RequestDetail = {
  id: string;
  userId: string | null;
  question: string;
  answer: string;
  modelUsed: string;
  responseTime: number;
  responseLanguage: string | null;
  routeIntent: string | null;
  usedFallback: boolean;
  usedDeterministicFallback: boolean;
  warningCount: number;
  traceId: string | null;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  feedback: number | null;
  relevance: string | null;
  relevanceExplanation: string | null;
  createdAt: string;
};

type QueueData = {
  generatedAt: string;
  queue: {
    waiting: number | null;
    active: number | null;
    completed: number | null;
    failed: number | null;
    delayed: number | null;
  };
  plans: Array<{
    id: string;
    userId: string;
    name: string;
    goal: string;
    status: string;
    version: number;
    jobId: string | null;
    failReason: string | null;
    createdAt: string;
    updatedAt: string;
    duration: number;
    daysPerWeek: number;
  }>;
};

type ErrorsData = {
  failedPlans: Array<{
    id: string;
    userId: string;
    name: string;
    goal: string;
    failReason: string | null;
    updatedAt: string;
    jobId: string | null;
    version: number;
  }>;
  highWarnConversations: Array<{
    id: string;
    userId: string | null;
    question: string;
    routeIntent: string | null;
    warningCount: number;
    responseTime: number;
    createdAt: string;
    traceId: string | null;
  }>;
};

type FilterType = "all" | "fallback" | "slow" | "warnings";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatLatency(seconds: number | null): string {
  if (seconds === null) return "—";
  if (seconds < 1) return `${Math.round(seconds * 1000)}ms`;
  return `${seconds.toFixed(1)}s`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}

function truncate(text: string, max = 60): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

const STATUS_COLORS: Record<string, string> = {
  QUEUED:     "text-zinc-400 bg-zinc-800",
  PROCESSING: "text-blue-400 bg-blue-500/10",
  COMPLETED:  "text-green-400 bg-green-500/10",
  FAILED:     "text-red-400 bg-red-500/10",
};

const INTENT_COLORS = [
  "#6366f1","#8b5cf6","#ec4899","#f97316","#22c55e","#14b8a6","#0ea5e9","#f59e0b",
];

// ─── Sub-components ───────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, accent }: {
  label: string; value: string | number; sub?: string; accent?: string;
}) {
  return (
    <div className="bg-zinc-900 border border-zinc-800/60 rounded-xl p-4">
      <div className="text-xs text-zinc-500 mb-1">{label}</div>
      <div className={`text-2xl font-bold ${accent ?? "text-zinc-100"}`}>{value}</div>
      {sub && <div className="text-[10px] text-zinc-600 mt-0.5">{sub}</div>}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cls = STATUS_COLORS[status] ?? "text-zinc-400 bg-zinc-800";
  return (
    <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${cls}`}>
      {status}
    </span>
  );
}

function FallbackBadge({ used }: { used: boolean }) {
  if (!used) return null;
  return (
    <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full text-amber-400 bg-amber-500/10">
      fallback
    </span>
  );
}

// ─── Trace detail drawer ──────────────────────────────────────────────────────

function TraceDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const [detail, setDetail] = useState<RequestDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    adminService.getAIRequestDetail(id)
      .then((res) => {
        if (res.success) setDetail(res.data.conversation);
        else setError("Failed to load detail");
      })
      .catch((err: unknown) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, [id]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      {/* Drawer */}
      <div className="relative w-full max-w-2xl bg-zinc-950 border-l border-zinc-800 overflow-y-auto flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800 sticky top-0 bg-zinc-950 z-10">
          <div className="flex items-center gap-2">
            <Brain className="w-4 h-4 text-violet-400" />
            <span className="text-sm font-semibold text-zinc-200">Request Trace</span>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 flex-1">
          {loading && (
            <div className="flex items-center gap-2 text-zinc-500 text-sm">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading trace…
            </div>
          )}
          {error && <div className="text-red-400 text-sm">{error}</div>}
          {detail && (
            <div className="space-y-5">
              {/* Metadata row */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div className="bg-zinc-900 rounded-lg p-3 border border-zinc-800/60">
                  <div className="text-[10px] text-zinc-600 mb-1">Latency</div>
                  <div className={`text-sm font-bold ${detail.responseTime > 10 ? "text-amber-400" : "text-green-400"}`}>
                    {formatLatency(detail.responseTime)}
                  </div>
                </div>
                <div className="bg-zinc-900 rounded-lg p-3 border border-zinc-800/60">
                  <div className="text-[10px] text-zinc-600 mb-1">Tokens</div>
                  <div className="text-sm font-bold text-zinc-200">
                    {detail.totalTokens.toLocaleString()}
                  </div>
                  <div className="text-[10px] text-zinc-600">
                    {detail.promptTokens}↑ {detail.completionTokens}↓
                  </div>
                </div>
                <div className="bg-zinc-900 rounded-lg p-3 border border-zinc-800/60">
                  <div className="text-[10px] text-zinc-600 mb-1">Language</div>
                  <div className="text-sm font-bold text-zinc-200 uppercase">
                    {detail.responseLanguage ?? "—"}
                  </div>
                </div>
                <div className="bg-zinc-900 rounded-lg p-3 border border-zinc-800/60">
                  <div className="text-[10px] text-zinc-600 mb-1">Intent</div>
                  <div className="text-xs text-violet-400 font-medium truncate">
                    {detail.routeIntent ?? "—"}
                  </div>
                </div>
                <div className="bg-zinc-900 rounded-lg p-3 border border-zinc-800/60">
                  <div className="text-[10px] text-zinc-600 mb-1">Warnings</div>
                  <div className={`text-sm font-bold ${detail.warningCount > 0 ? "text-amber-400" : "text-green-400"}`}>
                    {detail.warningCount}
                  </div>
                </div>
                <div className="bg-zinc-900 rounded-lg p-3 border border-zinc-800/60">
                  <div className="text-[10px] text-zinc-600 mb-1">Feedback</div>
                  <div className="text-sm font-bold text-zinc-200">
                    {detail.feedback === 1 ? "👍" : detail.feedback === -1 ? "👎" : "—"}
                  </div>
                </div>
              </div>

              {/* Flags */}
              <div className="flex flex-wrap gap-2">
                {detail.usedFallback && (
                  <span className="flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
                    <AlertTriangle className="w-3 h-3" /> Qdrant retrieval empty (fallback)
                  </span>
                )}
                {detail.usedDeterministicFallback && (
                  <span className="flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-orange-500/10 text-orange-400 border border-orange-500/20">
                    <AlertTriangle className="w-3 h-3" /> Validation rejected LLM answer (deterministic used)
                  </span>
                )}
                {detail.relevance && (
                  <span className={`text-xs px-2 py-1 rounded-full border font-medium ${
                    detail.relevance === "RELEVANT"
                      ? "bg-green-500/10 text-green-400 border-green-500/20"
                      : detail.relevance === "PARTLY_RELEVANT"
                      ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
                      : "bg-red-500/10 text-red-400 border-red-500/20"
                  }`}>
                    Relevance: {detail.relevance}
                  </span>
                )}
              </div>

              {/* Trace ID + timestamp */}
              {detail.traceId && (
                <div className="text-[10px] text-zinc-600 font-mono">
                  Trace: {detail.traceId} · {formatTime(detail.createdAt)}
                </div>
              )}

              {/* Question */}
              <div>
                <div className="text-xs font-semibold text-zinc-400 mb-2 uppercase tracking-wider">Question</div>
                <div className="bg-zinc-900 border border-zinc-800/60 rounded-lg p-3 text-sm text-zinc-300 leading-relaxed whitespace-pre-wrap">
                  {detail.question}
                </div>
              </div>

              {/* Answer */}
              <div>
                <div className="text-xs font-semibold text-zinc-400 mb-2 uppercase tracking-wider">Answer</div>
                <div className="bg-zinc-900 border border-zinc-800/60 rounded-lg p-3 text-sm text-zinc-300 leading-relaxed whitespace-pre-wrap max-h-80 overflow-y-auto">
                  {detail.answer}
                </div>
              </div>

              {/* Relevance explanation */}
              {detail.relevanceExplanation && (
                <div>
                  <div className="text-xs font-semibold text-zinc-400 mb-2 uppercase tracking-wider">Relevance Explanation</div>
                  <div className="bg-zinc-900 border border-zinc-800/60 rounded-lg p-3 text-xs text-zinc-400">
                    {detail.relevanceExplanation}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main page component ──────────────────────────────────────────────────────

export function AdminAIObservability() {
  const [overview, setOverview]       = useState<OverviewData | null>(null);
  const [requests, setRequests]       = useState<RequestsData | null>(null);
  const [queue, setQueue]             = useState<QueueData | null>(null);
  const [errors, setErrors]           = useState<ErrorsData | null>(null);
  const [loading, setLoading]         = useState(true);
  const [refreshing, setRefreshing]   = useState(false);
  const [apiError, setApiError]       = useState<string | null>(null);
  const [activeTab, setActiveTab]     = useState<"requests" | "queue" | "errors">("requests");
  const [filter, setFilter]           = useState<FilterType>("all");
  const [page, setPage]               = useState(1);
  const [selectedId, setSelectedId]   = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState(new Date());

  const fetchAll = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);

    try {
      const [ovRes, rqRes, qRes, erRes] = await Promise.all([
        adminService.getAIOverview(),
        adminService.getAIRequests({ filter: filter === "all" ? undefined : filter, page, limit: 20 }),
        adminService.getAIQueue(),
        adminService.getAIErrors(),
      ]);
      if (ovRes.success) setOverview(ovRes.data);
      if (rqRes.success) setRequests(rqRes.data);
      if (qRes.success)  setQueue(qRes.data);
      if (erRes.success) setErrors(erRes.data);
      setApiError(null);
    } catch (err: unknown) {
      setApiError((err as Error).message || "Failed to load observability data");
    } finally {
      setLoading(false);
      setRefreshing(false);
      setLastRefresh(new Date());
    }
  }, [filter, page]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Auto-refresh every 30s
  useEffect(() => {
    const t = setInterval(() => fetchAll(true), 30_000);
    return () => clearInterval(t);
  }, [fetchAll]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 text-violet-500 animate-spin" />
        <span className="ml-2 text-zinc-400 text-sm">Loading AI observability data…</span>
      </div>
    );
  }

  if (apiError) {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-5 text-center">
          <AlertTriangle className="w-6 h-6 text-red-400 mx-auto mb-2" />
          <p className="text-red-400 text-sm font-semibold">{apiError}</p>
          <button onClick={() => fetchAll()} className="mt-3 text-xs text-red-300 hover:text-red-200 underline">
            Retry
          </button>
        </div>
      </div>
    );
  }

  const ov = overview;
  const convStats = ov?.conversations;

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-zinc-100 flex items-center gap-2 text-lg font-semibold">
            <Brain className="w-5 h-5 text-violet-400" />
            AI Request Observability
          </h1>
          <p className="text-zinc-500 text-sm mt-0.5">
            Live view of AI coach requests, plan queue, and failure analysis
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => fetchAll(true)}
            disabled={refreshing}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium rounded-lg border border-zinc-700 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </button>
          <span className="text-xs text-zinc-600">{lastRefresh.toLocaleTimeString()}</span>
        </div>
      </div>

      {/* KPI cards */}
      {convStats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
          <KpiCard
            label="Total Requests"
            value={convStats.total.toLocaleString()}
            sub={`${convStats.last24h} in last 24h`}
          />
          <KpiCard
            label="Avg Latency"
            value={formatLatency(convStats.avgLatencySeconds)}
            sub={`p95: ${formatLatency(convStats.p95LatencySeconds)}`}
            accent={
              convStats.avgLatencySeconds !== null && convStats.avgLatencySeconds > 10
                ? "text-amber-400"
                : "text-zinc-100"
            }
          />
          <KpiCard
            label="Fallback Rate"
            value={`${convStats.fallbackRate}%`}
            sub="Qdrant retrieval empty"
            accent={convStats.fallbackRate > 20 ? "text-amber-400" : "text-zinc-100"}
          />
          <KpiCard
            label="Det. Fallback Rate"
            value={`${convStats.deterministicFallbackRate}%`}
            sub="Validation rejected LLM"
            accent={convStats.deterministicFallbackRate > 10 ? "text-red-400" : "text-zinc-100"}
          />
          <KpiCard
            label="Warning Rate"
            value={`${convStats.warningRate}%`}
            sub="Responses with issues"
            accent={convStats.warningRate > 15 ? "text-amber-400" : "text-zinc-100"}
          />
          <KpiCard
            label="Slow Requests"
            value={convStats.slowCount}
            sub="> 10s (last 7d)"
            accent={convStats.slowCount > 5 ? "text-amber-400" : "text-zinc-100"}
          />
        </div>
      )}

      {/* Charts row */}
      {ov && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Intent distribution */}
          <div className="bg-zinc-900 border border-zinc-800/60 rounded-xl p-4 md:col-span-2">
            <div className="flex items-center gap-2 mb-3">
              <Zap className="w-4 h-4 text-violet-400" />
              <h3 className="text-sm font-semibold text-zinc-200">Intent Distribution (7d)</h3>
            </div>
            {ov.intents.length === 0 ? (
              <div className="text-xs text-zinc-600 text-center py-8">No intent data yet</div>
            ) : (
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={ov.intents} layout="vertical" margin={{ left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 10, fill: "#71717a" }} axisLine={false} tickLine={false} />
                  <YAxis
                    dataKey="intent"
                    type="category"
                    width={170}
                    tick={{ fontSize: 9, fill: "#71717a" }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v: string) => v.replace(/_/g, " ")}
                  />
                  <Tooltip
                    contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid #27272a", backgroundColor: "#111", color: "#f4f4f5" }}
                    formatter={(v: number) => [v, "requests"]}
                    labelFormatter={(v: string) => v.replace(/_/g, " ")}
                  />
                  <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                    {ov.intents.map((_, i) => (
                      <Cell key={i} fill={INTENT_COLORS[i % INTENT_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Language split + plan status */}
          <div className="space-y-3">
            {/* Language */}
            <div className="bg-zinc-900 border border-zinc-800/60 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <Languages className="w-4 h-4 text-blue-400" />
                <h3 className="text-xs font-semibold text-zinc-200">Response Language (7d)</h3>
              </div>
              {ov.languages.length === 0 ? (
                <div className="text-xs text-zinc-600 text-center py-4">No data yet</div>
              ) : (
                <div className="flex items-center gap-3">
                  <ResponsiveContainer width={80} height={80}>
                    <PieChart>
                      <Pie data={ov.languages} dataKey="count" cx="50%" cy="50%" innerRadius={20} outerRadius={38}>
                        {ov.languages.map((_, i) => (
                          <Cell key={i} fill={i === 0 ? "#6366f1" : "#22c55e"} />
                        ))}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="space-y-1">
                    {ov.languages.map((l, i) => (
                      <div key={l.language} className="flex items-center gap-2 text-xs">
                        <div
                          className="w-2 h-2 rounded-full"
                          style={{ backgroundColor: i === 0 ? "#6366f1" : "#22c55e" }}
                        />
                        <span className="text-zinc-400 uppercase font-mono">{l.language}</span>
                        <span className="text-zinc-600 ml-auto">{l.count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Plan status */}
            <div className="bg-zinc-900 border border-zinc-800/60 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <Layers className="w-4 h-4 text-green-400" />
                <h3 className="text-xs font-semibold text-zinc-200">Plan Job Status</h3>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: "Completed", value: ov.plans.completed, color: "text-green-400" },
                  { label: "Failed", value: ov.plans.failed, color: "text-red-400" },
                  { label: "Processing", value: ov.plans.processing, color: "text-blue-400" },
                  { label: "Queued", value: ov.plans.queued, color: "text-zinc-400" },
                ].map((s) => (
                  <div key={s.label} className="text-center">
                    <div className={`text-lg font-bold ${s.color}`}>{s.value}</div>
                    <div className="text-[10px] text-zinc-600">{s.label}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 bg-zinc-900/60 rounded-lg p-1 w-fit border border-zinc-800/60">
        {(["requests", "queue", "errors"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-1.5 text-xs font-medium rounded-md transition-colors capitalize ${
              activeTab === tab
                ? "bg-violet-500/20 text-violet-300 border border-violet-500/30"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {tab === "errors"
              ? `Errors${errors ? ` (${errors.failedPlans.length + errors.highWarnConversations.length})` : ""}`
              : tab === "queue"
              ? `Plan Queue${queue ? ` (${queue.plans.length})` : ""}`
              : "Requests"}
          </button>
        ))}
      </div>

      {/* ── REQUESTS tab ── */}
      {activeTab === "requests" && (
        <div className="bg-zinc-900 border border-zinc-800/60 rounded-xl overflow-hidden">
          {/* Filter bar */}
          <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-zinc-800/60">
            <Filter className="w-4 h-4 text-zinc-500" />
            {(["all", "fallback", "slow", "warnings"] as FilterType[]).map((f) => (
              <button
                key={f}
                onClick={() => { setFilter(f); setPage(1); }}
                className={`px-3 py-1 text-xs font-medium rounded-full border transition-colors ${
                  filter === f
                    ? "bg-violet-500/20 text-violet-300 border-violet-500/30"
                    : "text-zinc-500 border-zinc-700 hover:border-zinc-600 hover:text-zinc-300"
                }`}
              >
                {f === "all" ? "All" : f === "slow" ? "Slow (>10s)" : f === "fallback" ? "Fallback" : "Warnings"}
              </button>
            ))}
            {requests && (
              <span className="ml-auto text-xs text-zinc-600">
                {requests.total.toLocaleString()} total
              </span>
            )}
          </div>

          {/* Table */}
          {!requests || requests.items.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-zinc-600">
              <Search className="w-5 h-5 mx-auto mb-2 opacity-50" />
              No requests found for this filter.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-zinc-800/60">
                    {["Time", "Question", "Intent", "Lang", "Latency", "Tokens", "Flags", ""].map((h) => (
                      <th key={h} className="px-4 py-2.5 text-left text-zinc-600 font-medium">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/40">
                  {requests.items.map((r) => (
                    <tr
                      key={r.id}
                      className="hover:bg-zinc-800/30 transition-colors cursor-pointer"
                      onClick={() => setSelectedId(r.id)}
                    >
                      <td className="px-4 py-2.5 text-zinc-500 whitespace-nowrap">
                        {formatTime(r.createdAt)}
                      </td>
                      <td className="px-4 py-2.5 text-zinc-300 max-w-xs">
                        {truncate(r.question, 70)}
                      </td>
                      <td className="px-4 py-2.5 text-violet-400 whitespace-nowrap">
                        {r.routeIntent?.replace(/_/g, " ") ?? "—"}
                      </td>
                      <td className="px-4 py-2.5 text-zinc-400 uppercase font-mono">
                        {r.responseLanguage ?? "—"}
                      </td>
                      <td className={`px-4 py-2.5 whitespace-nowrap font-mono ${
                        r.responseTime > 10 ? "text-amber-400" : "text-green-400"
                      }`}>
                        {formatLatency(r.responseTime)}
                      </td>
                      <td className="px-4 py-2.5 text-zinc-500 font-mono">
                        {r.totalTokens.toLocaleString()}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex flex-wrap gap-1">
                          {r.usedFallback && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] bg-amber-500/10 text-amber-400 font-bold uppercase">
                              FB
                            </span>
                          )}
                          {r.usedDeterministicFallback && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] bg-orange-500/10 text-orange-400 font-bold uppercase">
                              DFB
                            </span>
                          )}
                          {r.warningCount > 0 && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] bg-yellow-500/10 text-yellow-400 font-bold">
                              W:{r.warningCount}
                            </span>
                          )}
                          {r.feedback === 1 && <span className="text-green-400">👍</span>}
                          {r.feedback === -1 && <span className="text-red-400">👎</span>}
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        <ChevronRight className="w-3.5 h-3.5 text-zinc-600" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {requests && requests.pages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-zinc-800/60">
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300 disabled:opacity-30"
              >
                <ArrowLeft className="w-3.5 h-3.5" /> Prev
              </button>
              <span className="text-xs text-zinc-600">
                Page {requests.page} / {requests.pages}
              </span>
              <button
                disabled={page >= requests.pages}
                onClick={() => setPage((p) => p + 1)}
                className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300 disabled:opacity-30"
              >
                Next <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── QUEUE tab ── */}
      {activeTab === "queue" && queue && (
        <div className="space-y-4">
          {/* BullMQ live counts */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {[
              { label: "Waiting",   value: queue.queue.waiting,   color: "text-zinc-400" },
              { label: "Active",    value: queue.queue.active,    color: "text-blue-400" },
              { label: "Delayed",   value: queue.queue.delayed,   color: "text-amber-400" },
              { label: "Completed", value: queue.queue.completed, color: "text-green-400" },
              { label: "Failed",    value: queue.queue.failed,    color: "text-red-400" },
            ].map((s) => (
              <div key={s.label} className="bg-zinc-900 border border-zinc-800/60 rounded-xl p-4 text-center">
                <div className={`text-2xl font-bold ${s.color}`}>
                  {s.value !== null ? s.value.toLocaleString() : "—"}
                </div>
                <div className="text-xs text-zinc-500 mt-0.5">{s.label}</div>
              </div>
            ))}
          </div>

          {/* Plan table */}
          <div className="bg-zinc-900 border border-zinc-800/60 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-zinc-800/60 flex items-center gap-2">
              <Layers className="w-4 h-4 text-green-400" />
              <span className="text-sm font-semibold text-zinc-200">Recent Plan Jobs</span>
              <span className="ml-auto text-xs text-zinc-600">{queue.plans.length} shown</span>
            </div>
            {queue.plans.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-zinc-600">No plan jobs yet.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-zinc-800/60">
                      {["Status", "Name / Goal", "Duration", "Days/Wk", "Version", "Job ID", "Created", "Updated"].map((h) => (
                        <th key={h} className="px-4 py-2.5 text-left text-zinc-600 font-medium whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/40">
                    {queue.plans.map((p) => (
                      <tr key={p.id} className="hover:bg-zinc-800/20">
                        <td className="px-4 py-2.5">
                          <StatusBadge status={p.status} />
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="text-zinc-300 font-medium">{truncate(p.name, 40)}</div>
                          <div className="text-zinc-600">{truncate(p.goal, 40)}</div>
                          {p.failReason && (
                            <div className="text-red-400 text-[10px] mt-0.5">{truncate(p.failReason, 60)}</div>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-zinc-500">{p.duration}w</td>
                        <td className="px-4 py-2.5 text-zinc-500">{p.daysPerWeek}d</td>
                        <td className="px-4 py-2.5 text-zinc-500">v{p.version}</td>
                        <td className="px-4 py-2.5 text-zinc-600 font-mono">
                          {p.jobId ? truncate(p.jobId, 14) : "—"}
                        </td>
                        <td className="px-4 py-2.5 text-zinc-600 whitespace-nowrap">{formatTime(p.createdAt)}</td>
                        <td className="px-4 py-2.5 text-zinc-600 whitespace-nowrap">{formatTime(p.updatedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── ERRORS tab ── */}
      {activeTab === "errors" && errors && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Failed plans */}
          <div className="bg-zinc-900 border border-zinc-800/60 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-zinc-800/60 flex items-center gap-2">
              <XCircle className="w-4 h-4 text-red-400" />
              <span className="text-sm font-semibold text-zinc-200">Failed Plan Jobs</span>
              <span className="ml-auto text-xs text-zinc-600">{errors.failedPlans.length}</span>
            </div>
            {errors.failedPlans.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <CheckCircle2 className="w-5 h-5 text-green-400 mx-auto mb-1" />
                <div className="text-xs text-zinc-600">No failed plan jobs.</div>
              </div>
            ) : (
              <div className="divide-y divide-zinc-800/40">
                {errors.failedPlans.map((p) => (
                  <div key={p.id} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <span className="text-xs font-semibold text-zinc-300">{p.name}</span>
                      <span className="text-[10px] text-zinc-600 whitespace-nowrap">{formatTime(p.updatedAt)}</span>
                    </div>
                    <div className="text-[10px] text-zinc-500">{p.goal}</div>
                    {p.failReason && (
                      <div className="mt-1.5 bg-red-500/5 border border-red-500/20 rounded p-2 text-[10px] text-red-300">
                        {p.failReason}
                      </div>
                    )}
                    {p.jobId && (
                      <div className="text-[10px] text-zinc-700 font-mono mt-1">Job: {p.jobId}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* High-warning conversations */}
          <div className="bg-zinc-900 border border-zinc-800/60 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-zinc-800/60 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-400" />
              <span className="text-sm font-semibold text-zinc-200">High-Warning Requests</span>
              <span className="text-xs text-zinc-600 ml-1">(last 7d)</span>
              <span className="ml-auto text-xs text-zinc-600">{errors.highWarnConversations.length}</span>
            </div>
            {errors.highWarnConversations.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <CheckCircle2 className="w-5 h-5 text-green-400 mx-auto mb-1" />
                <div className="text-xs text-zinc-600">No validation issues in the last 7 days.</div>
              </div>
            ) : (
              <div className="divide-y divide-zinc-800/40">
                {errors.highWarnConversations.map((c) => (
                  <div
                    key={c.id}
                    className="px-4 py-3 cursor-pointer hover:bg-zinc-800/30 transition-colors"
                    onClick={() => setSelectedId(c.id)}
                  >
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <span className="text-[10px] text-amber-400 font-bold bg-amber-500/10 px-1.5 py-0.5 rounded">
                        {c.warningCount} warning{c.warningCount !== 1 ? "s" : ""}
                      </span>
                      <span className="text-[10px] text-zinc-600 whitespace-nowrap">
                        {formatTime(c.createdAt)}
                      </span>
                    </div>
                    <div className="text-xs text-zinc-300 mb-0.5">{truncate(c.question, 80)}</div>
                    <div className="flex items-center gap-3 text-[10px] text-zinc-600">
                      <span>{c.routeIntent?.replace(/_/g, " ") ?? "—"}</span>
                      <span className={c.responseTime > 10 ? "text-amber-400" : ""}>
                        {formatLatency(c.responseTime)}
                      </span>
                      <span className="ml-auto text-zinc-700">→ click for trace</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Performance note */}
      <div className="text-center text-[10px] text-zinc-700 py-2">
        Data from{" "}
        <code className="text-zinc-600">GET /admin/ai/{"{overview,requests,queue,errors}"}</code>{" "}
        · Auto-refresh every 30s · Fallback = Qdrant retrieval empty · DFB = deterministic fallback used
      </div>

      {/* Trace detail drawer */}
      {selectedId && (
        <TraceDrawer id={selectedId} onClose={() => setSelectedId(null)} />
      )}
    </div>
  );
}
