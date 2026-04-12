import { useEffect, useState } from "react";
import { AreaChart, Area, BarChart, Bar, LineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { Monitor, Activity, Server, Cpu, HardDrive, Wifi, AlertTriangle, RefreshCw, ExternalLink, Loader2 } from "lucide-react";
import { adminService } from "../../services/api";

type ServiceProbe = {
  key: string;
  name: string;
  status: "healthy" | "degraded" | "down";
  statusCode: number;
  latencyMs: number;
  uptimeSeconds: number | null;
  timestamp: string;
  error: string | null;
  optional?: boolean;
};

type MonitorData = {
  generatedAt: string;
  responseTimeMs: number;
  summary: {
    serviceCount: number;
    healthyCount: number;
    degradedCount: number;
    downCount: number;
    healthScore: number;
  };
  services: ServiceProbe[];
  recentErrors: Array<{ level: string; service: string; message: string; time: string }>;
};

const SERVICE_ICONS: Record<string, any> = {
  api: Server,
  auth: Server,
  user: Cpu,
  fitness: Activity,
  ai: Cpu,
  chat: Wifi,
  n8n: RefreshCw,
};

const GRAFANA_URL = "http://localhost:3100";

function formatUptime(seconds: number | null): string {
  if (seconds === null || seconds === undefined) return "—";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`;
}

export function SystemMonitoring() {
  const [data, setData] = useState<MonitorData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = async () => {
    try {
      setRefreshing(true);
      const res = await adminService.getSystemMonitoring();
      if (res.success && res.data) {
        setData(res.data);
        setError(null);
      } else {
        setError("Failed to load monitoring data");
      }
    } catch (err: any) {
      setError(err?.message || "Network error");
    } finally {
      setLoading(false);
      setRefreshing(false);
      setLastRefresh(new Date());
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000); // Auto-refresh every 30s
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 text-violet-500 animate-spin" />
        <span className="ml-2 text-zinc-400 text-sm">Loading monitoring data...</span>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 text-center">
          <AlertTriangle className="w-6 h-6 text-red-400 mx-auto mb-2" />
          <p className="text-red-400 text-sm font-semibold">{error || "No data available"}</p>
          <button onClick={fetchData} className="mt-2 text-xs text-red-300 hover:text-red-200 underline">Retry</button>
        </div>
      </div>
    );
  }

  const services = data.services;
  const summary = data.summary;

  // Build latency data for the chart from real service probes
  const latencyData = services
    .filter(s => s.latencyMs > 0)
    .map(s => ({ name: s.name.replace(" Service", "").replace("API ", ""), latency: s.latencyMs }));

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-zinc-100 flex items-center gap-2"><Monitor className="w-5 h-5 text-violet-500" /> System Monitoring</h1>
          <p className="text-zinc-500 text-sm mt-0.5">Real-time platform health via Prometheus</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={fetchData}
            disabled={refreshing}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium rounded-lg border border-zinc-700 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </button>

          <a
            href={`${GRAFANA_URL}/d/gym-platform-overview`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-1.5 bg-orange-500/10 hover:bg-orange-500/20 text-orange-400 text-xs font-medium rounded-lg border border-orange-500/20 transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Open Grafana
          </a>

          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1.5 text-xs text-zinc-500">
              <div className={`w-2 h-2 rounded-full animate-pulse ${summary.healthScore >= 80 ? "bg-green-500" : summary.healthScore >= 50 ? "bg-amber-500" : "bg-red-500"}`} />
              {summary.healthScore}% Health
            </span>
            <span className="text-xs text-zinc-600">
              {lastRefresh.toLocaleTimeString()}
            </span>
          </div>
        </div>
      </div>

      {/* Health Score Banner */}
      <div className={`rounded-xl p-4 border flex items-center justify-between ${
        summary.healthScore >= 80
          ? "bg-green-500/5 border-green-500/20"
          : summary.healthScore >= 50
          ? "bg-amber-500/5 border-amber-500/20"
          : "bg-red-500/5 border-red-500/20"
      }`}>
        <div className="flex items-center gap-3">
          <div className={`text-2xl font-bold ${
            summary.healthScore >= 80 ? "text-green-400" : summary.healthScore >= 50 ? "text-amber-400" : "text-red-400"
          }`}>
            {summary.healthScore}%
          </div>
          <div>
            <div className="text-sm font-semibold text-zinc-200">Platform Health Score</div>
            <div className="text-xs text-zinc-500">
              {summary.healthyCount}/{summary.serviceCount} services healthy
              {summary.degradedCount > 0 && ` · ${summary.degradedCount} degraded`}
              {summary.downCount > 0 && ` · ${summary.downCount} down`}
            </div>
          </div>
        </div>
        <div className="text-xs text-zinc-600">
          Response: {data.responseTimeMs}ms
        </div>
      </div>

      {/* Service Status Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-3">
        {services.map(s => {
          const IconComp = SERVICE_ICONS[s.key] || Server;
          const isHealthy = s.status === "healthy";
          const isDown = s.status === "down";
          return (
            <div key={s.key} className={`bg-zinc-900 rounded-xl border p-3 ${
              isHealthy ? "border-zinc-800/60" : isDown ? "border-red-500/30 bg-red-500/5" : "border-amber-500/30 bg-amber-500/5"
            }`}>
              <div className="flex items-center justify-between mb-2">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                  isHealthy ? "bg-green-500/10" : isDown ? "bg-red-500/10" : "bg-amber-500/10"
                }`}>
                  <IconComp className={`w-4 h-4 ${
                    isHealthy ? "text-green-400" : isDown ? "text-red-400" : "text-amber-400"
                  }`} />
                </div>
                <span className={`flex items-center gap-1 text-[10px] font-bold uppercase ${
                  isHealthy ? "text-green-400" : isDown ? "text-red-400" : "text-amber-400"
                }`}>
                  <div className={`w-1.5 h-1.5 rounded-full ${
                    isHealthy ? "bg-green-500" : isDown ? "bg-red-500" : "bg-amber-500"
                  }`} />
                  {s.status}
                </span>
              </div>
              <div className="text-xs font-semibold text-zinc-200 truncate">{s.name}</div>
              <div className="text-[10px] text-zinc-500 mt-0.5">Latency: {s.latencyMs}ms</div>
              <div className="text-[10px] text-zinc-500">Uptime: {formatUptime(s.uptimeSeconds)}</div>
              {s.optional && <div className="text-[9px] text-zinc-600 mt-0.5 italic">Optional</div>}
            </div>
          );
        })}
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Service Latency */}
        <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Activity className="w-4 h-4 text-blue-400" />
            <h4 className="text-sm font-semibold text-zinc-200">Service Response Latency (ms)</h4>
          </div>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={latencyData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#71717a" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: "#71717a" }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid #27272a", backgroundColor: "#111", color: "#f4f4f5" }}
                formatter={(v: number) => [`${v}ms`, "Latency"]}
              />
              <Bar dataKey="latency" fill="#3b82f6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Service Uptime */}
        <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-semibold text-zinc-200">Service Uptime Overview</h4>
            <span className="text-xs text-zinc-500">Since last restart</span>
          </div>
          <div className="space-y-2">
            {services.filter(s => s.uptimeSeconds !== null).map(s => {
              const uptimeHours = (s.uptimeSeconds || 0) / 3600;
              const maxHours = Math.max(...services.filter(sv => sv.uptimeSeconds).map(sv => (sv.uptimeSeconds || 0) / 3600), 1);
              const pct = Math.min((uptimeHours / maxHours) * 100, 100);
              const isHealthy = s.status === "healthy";
              return (
                <div key={s.key} className="flex items-center gap-3">
                  <div className="w-24 text-xs text-zinc-400 truncate">{s.name.replace(" Service", "")}</div>
                  <div className="flex-1 bg-zinc-800 rounded-full h-2 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${isHealthy ? "bg-green-500" : "bg-amber-500"}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="w-16 text-right text-[10px] text-zinc-500">{formatUptime(s.uptimeSeconds)}</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Grafana Embed Info + Error Log */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Grafana Quick Access */}
        <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4">
          <div className="flex items-center gap-2 mb-3">
            <img src="https://grafana.com/static/assets/img/fav32.png" className="w-4 h-4" alt="Grafana" />
            <h4 className="text-sm font-semibold text-zinc-200">Grafana Dashboards</h4>
          </div>
          <p className="text-xs text-zinc-500 mb-3">
            Deep-dive into metrics with pre-configured Grafana dashboards powered by Prometheus.
          </p>
          <div className="space-y-2">
            <a
              href={`${GRAFANA_URL}/d/gym-platform-overview`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between px-3 py-2.5 bg-zinc-800/50 hover:bg-zinc-800 border border-zinc-700/50 rounded-lg transition-colors group"
            >
              <div>
                <div className="text-xs font-semibold text-zinc-200">Platform Overview</div>
                <div className="text-[10px] text-zinc-500">Request rates, error rates, latency p50/p95</div>
              </div>
              <ExternalLink className="w-3.5 h-3.5 text-zinc-600 group-hover:text-zinc-400 transition-colors" />
            </a>
            <a
              href={`${GRAFANA_URL}/d/gym-business-metrics`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between px-3 py-2.5 bg-zinc-800/50 hover:bg-zinc-800 border border-zinc-700/50 rounded-lg transition-colors group"
            >
              <div>
                <div className="text-xs font-semibold text-zinc-200">Business Metrics</div>
                <div className="text-[10px] text-zinc-500">OCR stats, PT flow, AI coach, chat activity</div>
              </div>
              <ExternalLink className="w-3.5 h-3.5 text-zinc-600 group-hover:text-zinc-400 transition-colors" />
            </a>
            <a
              href={`${GRAFANA_URL}/explore`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between px-3 py-2.5 bg-zinc-800/50 hover:bg-zinc-800 border border-zinc-700/50 rounded-lg transition-colors group"
            >
              <div>
                <div className="text-xs font-semibold text-zinc-200">Explore Metrics</div>
                <div className="text-[10px] text-zinc-500">Ad-hoc PromQL queries</div>
              </div>
              <ExternalLink className="w-3.5 h-3.5 text-zinc-600 group-hover:text-zinc-400 transition-colors" />
            </a>
          </div>
        </div>

        {/* Error Log */}
        <div className="bg-zinc-900 rounded-xl border border-zinc-800/60">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800/60">
            <AlertTriangle className="w-4 h-4 text-amber-400" />
            <h4 className="text-sm font-semibold text-zinc-200">Active Issues</h4>
            {data.recentErrors.length === 0 && (
              <span className="ml-auto text-[10px] text-green-400 bg-green-500/10 px-2 py-0.5 rounded-full border border-green-500/20 font-semibold">
                All Clear
              </span>
            )}
          </div>
          {data.recentErrors.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <div className="text-green-400 text-sm font-semibold">No active issues</div>
              <div className="text-zinc-600 text-xs mt-1">All services are operating normally</div>
            </div>
          ) : (
            <div className="divide-y divide-zinc-800/40">
              {data.recentErrors.map((e, i) => (
                <div key={i} className={`px-4 py-3 ${e.level === "error" ? "bg-red-500/5" : "bg-amber-500/5"}`}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold uppercase ${
                      e.level === "error" ? "bg-red-500/20 text-red-400" : "bg-amber-500/20 text-amber-400"
                    }`}>
                      {e.level}
                    </span>
                    <span className="text-xs font-semibold text-zinc-300">{e.service}</span>
                    <span className="text-[10px] text-zinc-600 ml-auto">{e.time}</span>
                  </div>
                  <p className="text-xs text-zinc-400">{e.message}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="text-center text-[10px] text-zinc-700 py-2">
        Data from <code className="text-zinc-600">GET /admin/system-monitor</code> · Prometheus scrape interval: 15s · Grafana at <code className="text-zinc-600">{GRAFANA_URL}</code>
      </div>
    </div>
  );
}