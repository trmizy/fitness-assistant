import { useNavigate } from "react-router";
import { Users, UserCheck, FileText, Calendar, Activity, AlertTriangle, TrendingUp, Server, Loader2, RefreshCw } from "lucide-react";
import { LineChart, Line, PieChart, Pie, Cell, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { useQuery } from "@tanstack/react-query";
import axios from "axios";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3000";

const COLORS = ["#22c55e", "#60a5fa", "#a855f7", "#f59e0b"];

export function AdminDashboard() {
  const navigate = useNavigate();
  const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["admin-dashboard"],
    queryFn: async () => {
      const token = localStorage.getItem("accessToken");
      const { data } = await axios.get(`${API_BASE}/admin/dashboard`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      return data.data;
    },
  });

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-[80vh] gap-4">
        <Loader2 className="w-10 h-10 text-green-500 animate-spin" />
        <p className="text-zinc-500 animate-pulse">Loading dashboard data...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 text-center">
        <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-10 max-w-md mx-auto">
          <AlertTriangle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-zinc-100 font-bold text-xl mb-2">Dashboard Error</h2>
          <p className="text-zinc-500 mb-6">Failed to load system metrics. Please check if services are running.</p>
          <button onClick={() => refetch()} className="px-6 py-2 bg-red-500 text-white font-bold rounded-xl hover:bg-red-400 transition-all">Retry Now</button>
        </div>
      </div>
    );
  }

  const kpis = [
    { label: "Total Users", value: data?.kpis?.totalUsers || 0, change: "+0 this month", icon: Users, color: "text-green-400", bg: "bg-green-500/10", iconBg: "bg-green-500/15", border: "border-green-500/20" },
    { label: "Verified PTs", value: data?.kpis?.verifiedPTs || 0, change: `${data?.kpis?.pendingPT || 0} pending`, icon: UserCheck, color: "text-blue-400", bg: "bg-blue-500/10", iconBg: "bg-blue-500/15", border: "border-blue-500/20" },
    { label: "Active Contracts", value: data?.kpis?.activeContracts || 0, change: "System total", icon: FileText, color: "text-violet-400", bg: "bg-violet-500/10", iconBg: "bg-violet-500/15", border: "border-violet-500/20" },
    { label: "Sessions Today", value: data?.kpis?.sessionsToday || 0, change: "Activity today", icon: Calendar, color: "text-emerald-400", bg: "bg-emerald-500/10", iconBg: "bg-emerald-500/15", border: "border-emerald-500/20" },
  ];

  const userGrowth = data?.userGrowth || [];
  const roleData = data?.roleData || [];
  const systemAlerts = data?.systemAlerts || [];
  const recentUsers = data?.recentUsers || [];

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-zinc-100">Admin Dashboard</h1>
          <p className="text-zinc-500 text-sm mt-0.5">{today} · System overview</p>
        </div>
        <div className="flex gap-2 items-center">
          <button 
            onClick={() => refetch()} 
            disabled={isFetching}
            className="p-2 text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${isFetching ? 'animate-spin' : ''}`} />
          </button>
          <span className="flex items-center gap-1.5 px-3 py-1.5 bg-green-500/10 text-green-400 text-xs font-bold rounded-full border border-green-500/20">
            <div className="w-1.5 h-1.5 bg-green-500 rounded-full shadow-[0_0_6px_rgba(34,197,94,0.8)]" /> 
            {data?.monitor?.healthScore === 100 ? "All Systems Operational" : `${data?.monitor?.healthScore}% Systems Healthy`}
          </span>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {kpis.map(k => (
          <div key={k.label} className={`${k.bg} rounded-xl p-4 border ${k.border}`}>
            <div className="flex items-start justify-between mb-3">
              <div className={`w-9 h-9 ${k.iconBg} rounded-lg flex items-center justify-center`}>
                <k.icon className={`w-4 h-4 ${k.color}`} />
              </div>
              <span className={`text-xs font-bold ${k.color} bg-black/20 px-2 py-0.5 rounded-full`}>{k.change}</span>
            </div>
            <div className="text-xl font-bold text-zinc-100">{k.value.toLocaleString()}</div>
            <div className="text-xs text-zinc-500 mt-0.5">{k.label}</div>
          </div>
        ))}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="md:col-span-2 bg-zinc-900 rounded-xl p-4 border border-zinc-800/60">
          <h4 className="text-sm font-bold text-zinc-200 mb-3">User Growth</h4>
          <ResponsiveContainer width="100%" height={160}>
            <LineChart data={userGrowth}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#71717a" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: "#71717a" }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #27272a", backgroundColor: "#111111", color: "#f4f4f5" }} />
              <Line type="monotone" dataKey="users" stroke="#22c55e" strokeWidth={2.5} dot={{ fill: "#22c55e", r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800/60">
          <h4 className="text-sm font-bold text-zinc-200 mb-1">User Roles</h4>
          <p className="text-xs text-zinc-500 mb-2">Platform distribution</p>
          <ResponsiveContainer width="100%" height={120}>
            <PieChart>
              <Pie data={roleData} cx="50%" cy="50%" innerRadius={30} outerRadius={50} dataKey="value" paddingAngle={3}>
                {roleData.map((entry, i) => <Cell key={`cell-${entry.name}`} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid #27272a", backgroundColor: "#111111", color: "#f4f4f5" }} />
            </PieChart>
          </ResponsiveContainer>
          <div className="space-y-1.5 mt-1">
            {roleData.map((d, i) => (
              <div key={d.name} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                  <span className="text-zinc-500">{d.name}</span>
                </div>
                <span className="font-bold text-zinc-300">{d.value.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* OCR stats + alerts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800/60">
          <h4 className="text-sm font-bold text-zinc-200 mb-3">InBody OCR Scan Stats (7d)</h4>
          <div className="grid grid-cols-2 gap-4 h-[140px]">
            <div className="flex flex-col items-center justify-center border-r border-zinc-800/40">
              <span className="text-3xl font-bold text-zinc-100">{data?.ocrStats?.extracted || 0}</span>
              <span className="text-xs text-green-500 font-bold mt-1">AI Extracted</span>
            </div>
            <div className="flex flex-col justify-center gap-2 pl-4">
              <div className="flex justify-between items-center text-xs">
                <span className="text-zinc-500">Total Scans</span>
                <span className="text-zinc-200 font-bold">{data?.ocrStats?.total || 0}</span>
              </div>
              <div className="flex justify-between items-center text-xs">
                <span className="text-zinc-500">Manual Entry</span>
                <span className="text-zinc-200 font-bold">{data?.ocrStats?.manual || 0}</span>
              </div>
              <div className="flex justify-between items-center text-xs">
                <span className="text-zinc-500">Pending AI</span>
                <span className="text-zinc-200 font-bold">{data?.ocrStats?.pending || 0}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800/60 bg-zinc-800/20">
            <AlertTriangle className="w-4 h-4 text-amber-400" />
            <h4 className="text-sm font-bold text-zinc-200">System Alerts</h4>
          </div>
          <div className="divide-y divide-zinc-800/40 max-h-[140px] overflow-y-auto">
            {systemAlerts.length > 0 ? systemAlerts.map((a: any, i: number) => (
              <div key={i} className={`px-4 py-3 ${a.level === "error" || a.level === "critical" ? "bg-red-500/5" : a.level === "warning" ? "bg-amber-500/5" : "bg-blue-500/5"}`}>
                <div className="flex justify-between items-start gap-2">
                  <p className="text-xs text-zinc-400 leading-relaxed font-medium">{a.service}: {a.message}</p>
                  <span className="text-[10px] text-zinc-600 whitespace-nowrap">{a.time}</span>
                </div>
              </div>
            )) : (
              <div className="px-4 py-8 text-center text-xs text-zinc-600">No active system alerts</div>
            )}
          </div>
        </div>
      </div>

      {/* Recent users */}
      <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800/60">
          <h4 className="text-sm font-bold text-zinc-200">Recent Registrations</h4>
          <button onClick={() => navigate("/admin/users")} className="text-xs text-green-400 hover:text-green-300 transition-colors font-bold">View all</button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[500px]">
            <thead>
              <tr className="text-left text-xs text-zinc-600 bg-zinc-800/30 border-b border-zinc-800/60 uppercase tracking-wider">
                <th className="px-4 py-2.5 font-bold">Name</th>
                <th className="px-4 py-2.5 font-bold">Email</th>
                <th className="px-4 py-2.5 font-bold">Role</th>
                <th className="px-4 py-2.5 font-bold">Joined</th>
                <th className="px-4 py-2.5 font-bold">Status</th>
              </tr>
            </thead>
            <tbody>
              {recentUsers.length > 0 ? recentUsers.map((u: any, i: number) => (
                <tr key={i} className="border-b border-zinc-800/40 last:border-0 hover:bg-zinc-800/30 transition-colors">
                  <td className="px-4 py-3 text-sm font-semibold text-zinc-200">{u.name}</td>
                  <td className="px-4 py-3 text-sm text-zinc-500">{u.email}</td>
                  <td className="px-4 py-3">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold border ${u.role === "PT" ? "bg-blue-500/10 text-blue-400 border-blue-500/20" : "bg-zinc-700/50 text-zinc-400 border-zinc-700"}`}>{u.role}</span>
                  </td>
                  <td className="px-4 py-3 text-sm text-zinc-600">{u.joined}</td>
                  <td className="px-4 py-3">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold border ${u.status === "Active" ? "bg-green-500/10 text-green-400 border-green-500/20" : "bg-amber-500/10 text-amber-400 border-amber-500/20"}`}>{u.status}</span>
                  </td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-sm text-zinc-600">No recent registrations found</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}