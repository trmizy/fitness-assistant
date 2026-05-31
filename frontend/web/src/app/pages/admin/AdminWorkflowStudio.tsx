import { useCallback, useEffect, useState } from "react";
import { API_URL, adminService } from "../../services/api";
import {
  RefreshCw, Workflow, ExternalLink, CircleCheck, CircleX,
  KeyRound, Play, ChevronRight, ChevronDown, Clock, Zap,
  AlertTriangle, CheckCircle2, XCircle, Loader2, Info, LogIn, UserPlus,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

type WorkflowMeta = {
  studioPath: string;
  apiEnabled: boolean;
  status: "healthy" | "degraded";
  healthStatusCode: number;
};

type StudioAuthState = {
  n8nReachable: boolean;
  authenticated: boolean;
  requiresSignIn: boolean;
  supportsSignUp: boolean;
  authMode: "owner-setup" | "sign-in" | "unknown";
  signUpReason: string | null;
  studioUrl: string;
  signInUrl: string;
  signUpUrl: string;
  proxiedStudioUrl?: string;
  proxiedSignInUrl?: string;
  proxiedSignUpUrl?: string;
  healthStatusCode?: number;
  sessionProbeStatusCode?: number;
};

type WorkflowItem = {
  id: string;
  name: string;
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
  tags?: Array<{ id: string; name: string }>;
};

type Execution = {
  id: string;
  workflowId: string;
  finished: boolean;
  mode: string;
  status: string;
  startedAt: string;
  stoppedAt?: string;
  workflowData?: { name: string };
};

type SmokeResult = {
  passed: boolean;
  statusCode?: number;
  durationMs: number;
  responseBody?: unknown;
  testedAt: string;
};

type SubResult = {
  passed: boolean;
  step: string;
  statusCode: number;
  details: string;
  durationMs: number;
  checks: Array<{ name: string; ok: boolean; detail: string }>;
};

type E2EResult = {
  passed: boolean;
  summary: { total: number; passed: number; failed: number };
  results: SubResult[];
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  testedAt: string;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtDate(v?: string) {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("vi-VN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function fmtDuration(start?: string, stop?: string) {
  if (!start || !stop) return "—";
  const ms = new Date(stop).getTime() - new Date(start).getTime();
  if (ms < 0) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function statusColor(s: string): string {
  switch (s) {
    case "success":  return "bg-emerald-500/10 text-emerald-300 border-emerald-500/30";
    case "error":
    case "crashed":  return "bg-red-500/10 text-red-300 border-red-500/30";
    case "running":  return "bg-blue-500/10 text-blue-300 border-blue-500/30";
    case "waiting":  return "bg-yellow-500/10 text-yellow-300 border-yellow-500/30";
    case "canceled": return "bg-zinc-700/40 text-zinc-400 border-zinc-600/40";
    default:         return "bg-zinc-700/30 text-zinc-400 border-zinc-700/60";
  }
}

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case "success":  return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />;
    case "error":
    case "crashed":  return <XCircle className="w-3.5 h-3.5 text-red-400" />;
    case "running":  return <Loader2 className="w-3.5 h-3.5 text-blue-400 animate-spin" />;
    case "waiting":  return <Clock className="w-3.5 h-3.5 text-yellow-400" />;
    default:         return <Info className="w-3.5 h-3.5 text-zinc-500" />;
  }
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function AdminWorkflowStudio() {
  const [loading, setLoading]           = useState(true);
  const [refreshing, setRefreshing]     = useState(false);
  const [meta, setMeta]                 = useState<WorkflowMeta | null>(null);
  const [studioAuthState, setStudioAuthState] = useState<StudioAuthState | null>(null);
  const [workflows, setWorkflows]       = useState<WorkflowItem[]>([]);
  const [error, setError]               = useState<string | null>(null);

  // Execution panel state
  const [selectedWf, setSelectedWf]         = useState<WorkflowItem | null>(null);
  const [executions, setExecutions]         = useState<Execution[]>([]);
  const [execLoading, setExecLoading]       = useState(false);
  const [execError, setExecError]           = useState<string | null>(null);
  const [expandedExec, setExpandedExec]     = useState<string | null>(null);
  const [execDetail, setExecDetail]         = useState<Record<string, Execution>>({});
  const [detailLoading, setDetailLoading]   = useState<string | null>(null);

  // Smoke test state
  const [smokeRunning, setSmokeRunning] = useState(false);
  const [smokeResult, setSmokeResult]   = useState<SmokeResult | null>(null);
  const [smokeError, setSmokeError]     = useState<string | null>(null);

  // Setup sample workflows state
  const [setupLoading, setSetupLoading] = useState(false);
  const [setupMsg, setSetupMsg]         = useState<{ ok: boolean; text: string } | null>(null);

  // Full system E2E test state
  const [e2eRunning, setE2eRunning]     = useState(false);
  const [e2eResult, setE2eResult]       = useState<E2EResult | null>(null);
  const [e2eError, setE2eError]         = useState<string | null>(null);

  // ── Data loading ─────────────────────────────────────────────────────────

  const loadData = async () => {
    try {
      setError(null);
      const [metaRes, wfRes, authStateRes] = await Promise.all([
        adminService.getWorkflowMeta(),
        adminService.listWorkflows(),
        adminService.getStudioAuthState(),
      ]);
      setMeta(metaRes?.data ?? null);
      setWorkflows(wfRes?.data?.workflows ?? []);
      setStudioAuthState(authStateRes?.data ?? null);
    } catch (err: any) {
      setError(err?.response?.data?.error?.message ?? "Không thể tải dữ liệu n8n");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    setSelectedWf(null);
    setExecutions([]);
    await loadData();
  };

  // ── Execution list ────────────────────────────────────────────────────────

  const loadExecutions = async (wf: WorkflowItem) => {
    setSelectedWf(wf);
    setExecutions([]);
    setExecError(null);
    setExpandedExec(null);
    setExecLoading(true);
    try {
      const res = await adminService.getWorkflowExecutions(wf.id, 20);
      setExecutions(res?.data?.executions ?? []);
    } catch (err: any) {
      const status = err?.response?.status;
      const message = err?.response?.data?.error?.message ?? "Không thể tải execution list";

      // n8n API keys may not have executions scope even when workflow listing works.
      // Fallback to native n8n Studio page so admins can inspect executions there.
      if (status === 502 && /403|forbidden/i.test(String(message))) {
        const nativeWorkflowUrl = `${studioBasePath}/workflow/${encodeURIComponent(wf.id)}`;
        window.open(nativeWorkflowUrl, "_blank", "noopener,noreferrer");
        setExecError("API executions bị chặn quyền (403). Đã mở workflow trong n8n Studio để xem executions trực tiếp.");
        return;
      }

      setExecError(message);
    } finally {
      setExecLoading(false);
    }
  };

  const toggleExecDetail = useCallback(async (exec: Execution) => {
    if (expandedExec === exec.id) {
      setExpandedExec(null);
      return;
    }
    setExpandedExec(exec.id);

    // Use functional setState to read current cache without adding execDetail to deps.
    setExecDetail((prev) => {
      if (prev[exec.id]) return prev; // already cached — no fetch needed

      // Kick off fetch outside the setState call (setState callback must be synchronous).
      adminService.getExecutionDetail(exec.id).then((res) => {
        setExecDetail((p) => ({ ...p, [exec.id]: res?.data?.execution }));
      }).catch(() => {
        // Swallow — partial data from list is sufficient.
      }).finally(() => {
        setDetailLoading(null);
      });

      setDetailLoading(exec.id);
      return prev;
    });
  }, [expandedExec]);

  // ── Setup sample workflows ───────────────────────────────────────────────

  const runSetup = async () => {
    setSetupLoading(true);
    setSetupMsg(null);
    try {
      const res = await adminService.setupSampleWorkflows();
      const msg = res?.data?.message ?? "Đã tạo sample workflows thành công.";
      setSetupMsg({ ok: true, text: msg });
      await loadData(); // reload workflow list
    } catch (err: any) {
      const msg = err?.response?.data?.error?.message ?? "Tạo sample workflows thất bại.";
      setSetupMsg({ ok: false, text: msg });
    } finally {
      setSetupLoading(false);
    }
  };

  // ── Full system E2E test ─────────────────────────────────────────────────

  const runE2eTest = async () => {
    setE2eRunning(true);
    setE2eResult(null);
    setE2eError(null);
    try {
      const res = await adminService.runFullSystemTest();
      setE2eResult(res?.data ?? null);
    } catch (err: any) {
      const errPayload = err?.response?.data?.error;
      setE2eError(errPayload?.message ?? err?.message ?? "Full system test thất bại");
    } finally {
      setE2eRunning(false);
    }
  };

  // ── Smoke test ────────────────────────────────────────────────────────────

  const runSmokeTest = async () => {
    setSmokeRunning(true);
    setSmokeResult(null);
    setSmokeError(null);
    try {
      const res = await adminService.runSmokeTest();
      setSmokeResult(res?.data ?? null);
    } catch (err: any) {
      const errPayload = err?.response?.data?.error;
      // Backend now puts durationMs/testedAt inside the error object on failure.
      if (errPayload?.durationMs !== undefined) {
        setSmokeResult({ passed: false, durationMs: errPayload.durationMs, testedAt: errPayload.testedAt });
      }
      setSmokeError(errPayload?.message ?? err?.message ?? "Smoke test thất bại");
    } finally {
      setSmokeRunning(false);
    }
  };

  // ── Derived ──────────────────────────────────────────────────────────────

  const activeCount   = workflows.filter((w) => w.active).length;
  const inactiveCount = workflows.length - activeCount;
  const studioBasePath = (studioAuthState?.studioUrl ?? `${API_URL}${meta?.studioPath ?? "/admin/workflows/studio"}`).replace(/\/+$/, "");
  const signInBasePath = (studioAuthState?.signInUrl ?? `${studioBasePath}/signin`).replace(/\/+$/, "");
  const signUpBasePath = (studioAuthState?.signUpUrl ?? `${studioBasePath}/signup`).replace(/\/+$/, "");
  const accessToken = localStorage.getItem("accessToken");
  const studioQuery = accessToken && studioBasePath.includes('/admin/workflows/studio')
    ? `?access_token=${encodeURIComponent(accessToken)}`
    : "";
  const studioHref = `${studioBasePath}${studioQuery}`;
  const studioLoginHref = signInBasePath;
  const studioRegisterHref = signUpBasePath;

  const isN8nAuthenticated = !!studioAuthState?.authenticated;
  const shouldShowAuthButtons = !isN8nAuthenticated;
  const canSignUp = !!studioAuthState?.supportsSignUp;
  const canOpenStudio = isN8nAuthenticated;

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-7xl mx-auto">

      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-zinc-100 flex items-center gap-2 text-lg font-semibold">
            <Workflow className="w-5 h-5 text-emerald-400" />
            n8n Admin Console
          </h1>
          <p className="text-zinc-500 text-sm mt-0.5">
            Kiểm tra runtime, xem executions và chạy smoke test trực tiếp từ Admin Portal
          </p>
        </div>
        <div className="flex items-center gap-2">
          {shouldShowAuthButtons && (
            <a
              href={studioLoginHref}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-zinc-800 text-zinc-200 hover:bg-zinc-700 border border-zinc-700 transition-colors"
            >
              <LogIn className="w-3.5 h-3.5" />
              Đăng nhập n8n
            </a>
          )}

          {shouldShowAuthButtons && canSignUp && (
            <a
              href={studioRegisterHref}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-zinc-800 text-zinc-200 hover:bg-zinc-700 border border-zinc-700 transition-colors"
            >
              <UserPlus className="w-3.5 h-3.5" />
              Đăng ký n8n
            </a>
          )}

          {shouldShowAuthButtons && !canSignUp && (
            <button
              type="button"
              disabled
              title={studioAuthState?.signUpReason ?? "Đăng ký hiện không khả dụng"}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-zinc-900 text-zinc-500 border border-zinc-700/80 cursor-not-allowed"
            >
              <UserPlus className="w-3.5 h-3.5" />
              Đăng ký n8n
            </button>
          )}

          {canOpenStudio && (
            <a
              href={studioHref}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-zinc-800 text-zinc-200 hover:bg-zinc-700 border border-zinc-700 transition-colors"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Mở Studio
            </a>
          )}

          <button
            onClick={onRefresh}
            disabled={refreshing || loading}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/25 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
            Làm mới
          </button>
        </div>
      </div>

      {studioAuthState && shouldShowAuthButtons && !canSignUp && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200 flex items-center gap-2">
          <Info className="w-4 h-4 flex-shrink-0" />
          {studioAuthState.signUpReason ?? "Đăng ký n8n hiện không khả dụng. Hãy dùng đăng nhập hoặc invite user."}
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* ── PANEL 1: Overview ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {/* n8n Connection */}
        <div className="rounded-xl border border-zinc-800/70 bg-zinc-900 p-4">
          <div className="text-xs text-zinc-500 mb-2">Kết nối n8n</div>
          <div className="flex items-center gap-2 text-sm font-semibold">
            {loading ? (
              <Loader2 className="w-4 h-4 text-zinc-500 animate-spin" />
            ) : meta?.status === "healthy" ? (
              <CircleCheck className="w-4 h-4 text-emerald-400" />
            ) : (
              <CircleX className="w-4 h-4 text-red-400" />
            )}
            <span className="text-zinc-200">
              {loading ? "Đang kiểm tra…" : meta?.status === "healthy" ? "Healthy" : "Degraded"}
            </span>
          </div>
          <div className="text-xs text-zinc-600 mt-1.5">
            HTTP {meta?.healthStatusCode ?? "—"}
          </div>
        </div>

        {/* API Key */}
        <div className="rounded-xl border border-zinc-800/70 bg-zinc-900 p-4">
          <div className="text-xs text-zinc-500 mb-2">Public API Key</div>
          <div className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
            <KeyRound className={`w-4 h-4 ${meta?.apiEnabled ? "text-emerald-400" : "text-amber-400"}`} />
            {meta?.apiEnabled ? "Đã cấu hình" : "Chưa có key"}
          </div>
          <div className="text-xs text-zinc-600 mt-1.5">
            {meta?.apiEnabled ? "Workflow listing enabled" : "Tạo key trong n8n Studio"}
          </div>
        </div>

        {/* Workflow Count */}
        <div className="rounded-xl border border-zinc-800/70 bg-zinc-900 p-4">
          <div className="text-xs text-zinc-500 mb-2">Workflows</div>
          <div className="text-2xl font-bold text-zinc-100">
            {loading ? "…" : workflows.length}
          </div>
          <div className="text-xs text-zinc-600 mt-1.5">
            <span className="text-emerald-400">{activeCount} active</span>
            {" / "}
            <span className="text-zinc-500">{inactiveCount} inactive</span>
          </div>
        </div>

        {/* Smoke Test Quick Status */}
        <div className="rounded-xl border border-zinc-800/70 bg-zinc-900 p-4">
          <div className="text-xs text-zinc-500 mb-2">Last Smoke Test</div>
          {smokeResult ? (
            <>
              <div className="flex items-center gap-2 text-sm font-semibold">
                {smokeResult.passed
                  ? <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  : <XCircle className="w-4 h-4 text-red-400" />}
                <span className={smokeResult.passed ? "text-emerald-300" : "text-red-300"}>
                  {smokeResult.passed ? "Passed" : "Failed"}
                </span>
              </div>
              <div className="text-xs text-zinc-600 mt-1.5">{smokeResult.durationMs}ms · {fmtDate(smokeResult.testedAt)}</div>
            </>
          ) : (
            <>
              <div className="text-sm font-semibold text-zinc-500">Chưa chạy</div>
              <div className="text-xs text-zinc-600 mt-1.5">Xem panel bên dưới</div>
            </>
          )}
        </div>
      </div>

      {/* ── PANEL 2: Workflow List ── */}
      <div className="rounded-xl border border-zinc-800/70 bg-zinc-900 overflow-hidden">
        <div className="px-4 py-3 border-b border-zinc-800/60 flex items-center justify-between">
          <span className="text-sm font-semibold text-zinc-200">Danh sách Workflow</span>
          {!meta?.apiEnabled && !loading && (
            <span className="text-xs text-amber-400 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" /> Cần API key để xem
            </span>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px]">
            <thead>
              <tr className="text-left text-xs text-zinc-500 bg-zinc-900/60 border-b border-zinc-800/60">
                <th className="px-4 py-2.5">Name</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5">Tags</th>
                <th className="px-4 py-2.5">Updated</th>
                <th className="px-4 py-2.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-sm text-zinc-500 text-center">
                    <Loader2 className="w-4 h-4 animate-spin inline mr-2" />Đang tải…
                  </td>
                </tr>
              ) : workflows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center">
                    {meta?.apiEnabled ? (
                      <div className="flex flex-col items-center gap-3">
                        <p className="text-sm text-zinc-500">Chưa có workflow nào trong n8n.</p>
                        <button
                          onClick={runSetup}
                          disabled={setupLoading}
                          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                          {setupLoading
                            ? <><Loader2 className="w-4 h-4 animate-spin" />Đang tạo…</>
                            : <><Zap className="w-4 h-4" />Tạo sample workflows</>}
                        </button>
                        {setupMsg && (
                          <p className={`text-xs ${setupMsg.ok ? "text-emerald-400" : "text-red-400"}`}>
                            {setupMsg.text}
                          </p>
                        )}
                      </div>
                    ) : (
                      <p className="text-sm text-zinc-500">
                        Cần cấu hình N8N_PUBLIC_API_KEY để xem danh sách workflow.
                      </p>
                    )}
                  </td>
                </tr>
              ) : (
                workflows.map((wf) => (
                  <tr
                    key={wf.id}
                    className={`border-b border-zinc-800/40 last:border-0 transition-colors ${
                      selectedWf?.id === wf.id ? "bg-zinc-800/50" : "hover:bg-zinc-800/20"
                    }`}
                  >
                    <td className="px-4 py-3 text-sm text-zinc-200 font-medium">{wf.name}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full border font-semibold ${
                        wf.active
                          ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/30"
                          : "bg-zinc-700/30 text-zinc-400 border-zinc-700/60"
                      }`}>
                        {wf.active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {(wf.tags ?? []).map((t) => (
                          <span key={t.id} className="text-xs bg-zinc-800 text-zinc-400 px-1.5 py-0.5 rounded border border-zinc-700/50">
                            {t.name}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-zinc-500">{fmtDate(wf.updatedAt)}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex items-center gap-2">
                        <button
                          onClick={() => loadExecutions(wf)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium bg-zinc-800 text-zinc-300 hover:bg-zinc-700 border border-zinc-700/50 transition-colors"
                        >
                          <Clock className="w-3 h-3" />
                          Executions
                        </button>
                        <a
                          href={`${studioBasePath}/workflow/${encodeURIComponent(wf.id)}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium bg-zinc-900 text-zinc-300 hover:bg-zinc-800 border border-zinc-700/50 transition-colors"
                          title="Mở workflow trong n8n Studio (UI native giống n8n.io)"
                        >
                          <ExternalLink className="w-3 h-3" />
                          Mở n8n
                        </a>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── PANEL 3: Execution Monitor (conditional) ── */}
      {selectedWf && (
        <div className="rounded-xl border border-zinc-800/70 bg-zinc-900 overflow-hidden">
          <div className="px-4 py-3 border-b border-zinc-800/60 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-amber-400" />
              <span className="text-sm font-semibold text-zinc-200">
                Executions — <span className="text-zinc-400 font-normal">{selectedWf.name}</span>
              </span>
            </div>
            <button
              onClick={() => { setSelectedWf(null); setExecutions([]); }}
              className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              Đóng
            </button>
          </div>

          {execLoading ? (
            <div className="px-4 py-8 text-sm text-zinc-500 text-center">
              <Loader2 className="w-4 h-4 animate-spin inline mr-2" />Đang tải executions…
            </div>
          ) : execError ? (
            <div className="px-4 py-4 text-sm text-red-300 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />{execError}
            </div>
          ) : executions.length === 0 ? (
            <div className="px-4 py-8 text-sm text-zinc-500 text-center">
              Workflow này chưa có execution nào.
            </div>
          ) : (
            <div className="divide-y divide-zinc-800/50">
              {executions.map((exec) => {
                const isExpanded = expandedExec === exec.id;
                const detail     = execDetail[exec.id];
                const isLoading  = detailLoading === exec.id;

                return (
                  <div key={exec.id}>
                    <button
                      onClick={() => toggleExecDetail(exec)}
                      className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-zinc-800/30 transition-colors"
                    >
                      <StatusIcon status={exec.status} />
                      <span className={`text-xs px-2 py-0.5 rounded-full border font-semibold ${statusColor(exec.status)}`}>
                        {exec.status}
                      </span>
                      <span className="text-xs text-zinc-400 font-mono flex-shrink-0">#{exec.id.slice(0, 8)}</span>
                      <span className="text-xs text-zinc-500 flex-1 text-right">{fmtDate(exec.startedAt)}</span>
                      <span className="text-xs text-zinc-600 flex-shrink-0 w-14 text-right">
                        {fmtDuration(exec.startedAt, exec.stoppedAt)}
                      </span>
                      <span className="text-xs text-zinc-600 flex-shrink-0 w-16 text-right">{exec.mode}</span>
                      {isExpanded
                        ? <ChevronDown className="w-3.5 h-3.5 text-zinc-500 flex-shrink-0" />
                        : <ChevronRight className="w-3.5 h-3.5 text-zinc-500 flex-shrink-0" />
                      }
                    </button>

                    {isExpanded && (
                      <div className="px-4 pb-4 bg-zinc-950/50">
                        {isLoading ? (
                          <div className="text-xs text-zinc-500 py-2">
                            <Loader2 className="w-3 h-3 animate-spin inline mr-1" />Đang tải chi tiết…
                          </div>
                        ) : (
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pt-2 text-xs">
                            <div>
                              <div className="text-zinc-600 mb-0.5">Execution ID</div>
                              <div className="font-mono text-zinc-300">{exec.id}</div>
                            </div>
                            <div>
                              <div className="text-zinc-600 mb-0.5">Started</div>
                              <div className="text-zinc-300">{fmtDate(exec.startedAt)}</div>
                            </div>
                            <div>
                              <div className="text-zinc-600 mb-0.5">Finished</div>
                              <div className="text-zinc-300">{fmtDate(exec.stoppedAt)}</div>
                            </div>
                            <div>
                              <div className="text-zinc-600 mb-0.5">Duration</div>
                              <div className="text-zinc-300">{fmtDuration(exec.startedAt, exec.stoppedAt)}</div>
                            </div>
                            <div>
                              <div className="text-zinc-600 mb-0.5">Mode</div>
                              <div className="text-zinc-300">{detail?.mode ?? exec.mode}</div>
                            </div>
                            <div>
                              <div className="text-zinc-600 mb-0.5">Finished</div>
                              <div className="text-zinc-300">{String(detail?.finished ?? exec.finished)}</div>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── PANEL 5: Full System E2E Test ── */}
      <div className="rounded-xl border border-zinc-800/70 bg-zinc-900 overflow-hidden">
        <div className="px-4 py-3 border-b border-zinc-800/60 flex items-center gap-2">
          <Zap className="w-4 h-4 text-amber-400" />
          <span className="text-sm font-semibold text-zinc-200">Full System E2E Test</span>
          <span className="text-xs text-zinc-500 ml-1">— chạy 5 sub-workflows song song, tổng hợp kết quả</span>
        </div>

        <div className="p-4 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <button
              onClick={runE2eTest}
              disabled={e2eRunning}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold bg-amber-600 text-white hover:bg-amber-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {e2eRunning
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Đang chạy E2E…</>
                : <><Play className="w-4 h-4" /> Chạy Full System Test</>
              }
            </button>
            <p className="text-xs text-zinc-500">
              Trigger orchestrator <code className="text-zinc-400 bg-zinc-800 px-1 rounded">gym-e2e-run</code> →
              fan-out 5 sub-workflows (Auth, Profile, Fitness, AI, PT Review) → aggregate.
              Cần import và activate <code className="text-zinc-400 bg-zinc-800 px-1 rounded">01–06</code> trong n8n Studio.
            </p>
          </div>

          {e2eError && !e2eResult && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-3 text-xs text-red-300 font-mono">
              {e2eError}
            </div>
          )}

          {e2eResult && (
            <div className={`rounded-lg border p-4 space-y-4 ${
              e2eResult.passed
                ? "border-emerald-500/30 bg-emerald-500/5"
                : "border-red-500/30 bg-red-500/5"
            }`}>
              {/* Summary header */}
              <div className="flex items-center gap-3 flex-wrap">
                {e2eResult.passed
                  ? <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0" />
                  : <XCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
                }
                <span className={`text-sm font-bold ${e2eResult.passed ? "text-emerald-300" : "text-red-300"}`}>
                  {e2eResult.passed ? "ALL PASSED" : "SOME FAILED"}
                </span>
                <span className="text-xs text-zinc-500">
                  {e2eResult.summary.passed}/{e2eResult.summary.total} steps passed
                </span>
                <span className="text-xs text-zinc-500 ml-auto">{e2eResult.durationMs}ms total</span>
              </div>

              {/* Per-step results */}
              <div className="space-y-2">
                {(e2eResult.results ?? []).map((r) => (
                  <div
                    key={r.step}
                    className={`rounded-lg border px-3 py-2.5 flex items-start gap-3 ${
                      r.passed
                        ? "border-emerald-500/20 bg-emerald-500/5"
                        : "border-red-500/20 bg-red-500/5"
                    }`}
                  >
                    <div className="mt-0.5 flex-shrink-0">
                      {r.passed
                        ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                        : <XCircle className="w-3.5 h-3.5 text-red-400" />
                      }
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-semibold text-zinc-200">{r.step}</span>
                        <span className="text-xs text-zinc-500">{r.durationMs}ms</span>
                        <span className={`text-xs px-1.5 py-0.5 rounded border font-mono ${
                          r.passed
                            ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/30"
                            : "bg-red-500/10 text-red-300 border-red-500/30"
                        }`}>
                          {r.statusCode}
                        </span>
                      </div>
                      <div className="text-xs text-zinc-500 mt-1 truncate">{r.details}</div>
                      {r.checks?.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-1.5">
                          {r.checks.map((c) => (
                            <span
                              key={c.name}
                              className={`text-xs px-2 py-0.5 rounded border ${
                                c.ok
                                  ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                                  : "bg-red-500/10 text-red-400 border-red-500/20"
                              }`}
                            >
                              {c.name}: {c.ok ? "OK" : c.detail}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Timing footer */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs pt-1">
                <div>
                  <div className="text-zinc-500 mb-0.5">Started at</div>
                  <div className="text-zinc-300">{fmtDate(e2eResult.startedAt)}</div>
                </div>
                <div>
                  <div className="text-zinc-500 mb-0.5">Finished at</div>
                  <div className="text-zinc-300">{fmtDate(e2eResult.finishedAt)}</div>
                </div>
                <div>
                  <div className="text-zinc-500 mb-0.5">Total duration</div>
                  <div className="text-zinc-300">{e2eResult.durationMs}ms</div>
                </div>
              </div>
            </div>
          )}

          {!e2eRunning && !e2eResult && !e2eError && (
            <div className="rounded-lg border border-zinc-800/60 bg-zinc-950/40 p-4 text-xs space-y-2">
              <div className="text-zinc-400 font-semibold">Cách thiết lập Full System Test:</div>
              <ol className="text-zinc-500 space-y-1 list-decimal list-inside">
                <li>Import 5 sub-workflows <code className="text-zinc-400">01–05</code> và activate từng cái</li>
                <li>Import orchestrator <code className="text-zinc-400">06-gym-e2e-orchestrator.json</code> và activate</li>
                <li>Thêm vào <code className="text-zinc-400">.env</code>: <code className="text-zinc-400">N8N_E2E_WEBHOOK_URL=http://n8n:5678/webhook/gym-e2e-run</code></li>
                <li>Restart gateway: <code className="text-zinc-400">docker-compose restart api-gateway</code></li>
                <li>Bấm "Chạy Full System Test"</li>
              </ol>
            </div>
          )}
        </div>
      </div>

      {/* ── PANEL 4: Smoke Test ── */}
      <div className="rounded-xl border border-zinc-800/70 bg-zinc-900 overflow-hidden">
        <div className="px-4 py-3 border-b border-zinc-800/60 flex items-center gap-2">
          <Play className="w-4 h-4 text-emerald-400" />
          <span className="text-sm font-semibold text-zinc-200">Smoke Test</span>
          <span className="text-xs text-zinc-500 ml-1">— kiểm tra n8n có nhận và xử lý request được không</span>
        </div>

        <div className="p-4 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <button
              onClick={runSmokeTest}
              disabled={smokeRunning}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {smokeRunning
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Đang chạy…</>
                : <><Zap className="w-4 h-4" /> Chạy Smoke Test</>
              }
            </button>
            <p className="text-xs text-zinc-500">
              Gọi webhook <code className="text-zinc-400 bg-zinc-800 px-1 rounded">gym-smoke-test</code> → n8n ping gateway /health → trả kết quả.
              Cần import <code className="text-zinc-400 bg-zinc-800 px-1 rounded">infra/n8n/workflows/smoke-test-ping.json</code> và kích hoạt workflow.
            </p>
          </div>

          {/* Smoke test result */}
          {(smokeResult || smokeError) && (
            <div className={`rounded-lg border p-4 space-y-3 ${
              smokeResult?.passed
                ? "border-emerald-500/30 bg-emerald-500/5"
                : "border-red-500/30 bg-red-500/5"
            }`}>
              {/* Header */}
              <div className="flex items-center gap-2">
                {smokeResult?.passed
                  ? <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                  : <XCircle className="w-5 h-5 text-red-400" />
                }
                <span className={`text-sm font-bold ${smokeResult?.passed ? "text-emerald-300" : "text-red-300"}`}>
                  {smokeResult?.passed ? "PASSED" : "FAILED"}
                </span>
                {smokeResult?.durationMs !== undefined && (
                  <span className="text-xs text-zinc-500 ml-auto">{smokeResult.durationMs}ms</span>
                )}
              </div>

              {/* Error message */}
              {smokeError && (
                <div className="text-xs text-red-300 bg-red-500/10 rounded px-3 py-2 font-mono">
                  {smokeError}
                </div>
              )}

              {/* Details grid */}
              {smokeResult && (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                  {smokeResult.statusCode !== undefined && (
                    <div>
                      <div className="text-zinc-500 mb-0.5">HTTP Status</div>
                      <div className="text-zinc-300 font-mono">{smokeResult.statusCode}</div>
                    </div>
                  )}
                  <div>
                    <div className="text-zinc-500 mb-0.5">Duration</div>
                    <div className="text-zinc-300">{smokeResult.durationMs}ms</div>
                  </div>
                  <div>
                    <div className="text-zinc-500 mb-0.5">Tested at</div>
                    <div className="text-zinc-300">{fmtDate(smokeResult.testedAt)}</div>
                  </div>
                </div>
              )}

              {/* Response body */}
              {smokeResult?.responseBody !== undefined && (
                <div>
                  <div className="text-xs text-zinc-500 mb-1">Response body</div>
                  <pre className="text-xs bg-zinc-950 text-zinc-300 rounded p-3 overflow-x-auto max-h-40 scrollbar-thin scrollbar-thumb-zinc-700">
                    {typeof smokeResult.responseBody === "string"
                      ? smokeResult.responseBody
                      : JSON.stringify(smokeResult.responseBody, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}

          {/* Setup guide when not configured */}
          {!smokeRunning && !smokeResult && !smokeError && (
            <div className="rounded-lg border border-zinc-800/60 bg-zinc-950/40 p-4 text-xs space-y-2">
              <div className="text-zinc-400 font-semibold">Cách thiết lập Smoke Test:</div>
              <ol className="text-zinc-500 space-y-1 list-decimal list-inside">
                <li>Vào n8n Studio → Import workflow từ <code className="text-zinc-400">infra/n8n/workflows/smoke-test-ping.json</code></li>
                <li>Activate workflow "Gym Coach - Smoke Test"</li>
                <li>Thêm vào <code className="text-zinc-400">.env</code>: <code className="text-zinc-400">N8N_SMOKE_TEST_WEBHOOK_URL=http://n8n:5678/webhook/gym-smoke-test</code></li>
                <li>Restart gateway: <code className="text-zinc-400">docker-compose restart api-gateway</code></li>
                <li>Bấm "Chạy Smoke Test"</li>
              </ol>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
