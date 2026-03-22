import { useNavigate } from "react-router";
import { Users, UserCheck, FileText, Calendar, Activity, AlertTriangle, TrendingUp, Server } from "lucide-react";
import { BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";

const kpis = [
  { label: "Total Users", value: "1,284", change: "+48 this month", icon: Users, color: "text-green-400", bg: "bg-green-500/10", iconBg: "bg-green-500/15", border: "border-green-500/20" },
  { label: "Verified PTs", value: "87", change: "3 pending", icon: UserCheck, color: "text-blue-400", bg: "bg-blue-500/10", iconBg: "bg-blue-500/15", border: "border-blue-500/20" },
  { label: "Active Contracts", value: "342", change: "28 expiring soon", icon: FileText, color: "text-violet-400", bg: "bg-violet-500/10", iconBg: "bg-violet-500/15", border: "border-violet-500/20" },
  { label: "Sessions Today", value: "64", change: "12 in progress", icon: Calendar, color: "text-emerald-400", bg: "bg-emerald-500/10", iconBg: "bg-emerald-500/15", border: "border-emerald-500/20" },
];

const userGrowth = [
  { month: "Jan", users: 850 }, { month: "Feb", users: 920 }, { month: "Mar", users: 1020 },
  { month: "Apr", users: 1100 }, { month: "May", users: 1210 }, { month: "Jun", users: 1284 },
];

const ocrStats = [
  { day: "Mon", success: 45, fail: 3 }, { day: "Tue", success: 52, fail: 2 },
  { day: "Wed", success: 38, fail: 5 }, { day: "Thu", success: 60, fail: 2 },
  { day: "Fri", success: 48, fail: 4 }, { day: "Sat", success: 30, fail: 1 }, { day: "Sun", success: 22, fail: 1 },
];

const roleData = [
  { name: "Clients", value: 1197 }, { name: "Trainers", value: 87 },
];
const COLORS = ["#22c55e", "#60a5fa"];

const systemAlerts = [
  { level: "warning", msg: "OCR extraction failure rate spike on Wed (11.6%) — above 5% threshold", time: "2h ago" },
  { level: "info", msg: "3 new PT verification requests pending admin review", time: "4h ago" },
  { level: "warning", msg: "28 contracts expiring within 30 days — bulk notification sent", time: "1d ago" },
  { level: "success", msg: "System health check passed — all services operational", time: "2d ago" },
];

const recentUsers = [
  { name: "John Doe", email: "john@example.com", role: "Client", joined: "Jun 18", status: "Active" },
  { name: "Emma Wilson", email: "emma.pt@example.com", role: "PT", joined: "Jun 17", status: "Pending" },
  { name: "Chris Park", email: "chris@example.com", role: "Client", joined: "Jun 17", status: "Active" },
  { name: "David Kim", email: "david@example.com", role: "Client", joined: "Jun 16", status: "Active" },
];

export function AdminDashboard() {
  const navigate = useNavigate();
  const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-zinc-100">Admin Dashboard</h1>
          <p className="text-zinc-500 text-sm mt-0.5">{today} · System overview</p>
        </div>
        <div className="flex gap-2">
          <span className="flex items-center gap-1.5 px-3 py-1.5 bg-green-500/10 text-green-400 text-xs font-bold rounded-full border border-green-500/20">
            <div className="w-1.5 h-1.5 bg-green-500 rounded-full shadow-[0_0_6px_rgba(34,197,94,0.8)]" /> All Systems Operational
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
            <div className="text-xl font-bold text-zinc-100">{k.value}</div>
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
                {roleData.map((entry, i) => <Cell key={`cell-${entry.name}`} fill={COLORS[i]} />)}
              </Pie>
              <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid #27272a", backgroundColor: "#111111", color: "#f4f4f5" }} />
            </PieChart>
          </ResponsiveContainer>
          <div className="space-y-1.5 mt-1">
            {roleData.map((d, i) => (
              <div key={d.name} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: COLORS[i] }} />
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
          <h4 className="text-sm font-bold text-zinc-200 mb-3">OCR Extraction Stats (7d)</h4>
          <ResponsiveContainer width="100%" height={140}>
            <BarChart data={ocrStats}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis dataKey="day" tick={{ fontSize: 11, fill: "#71717a" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: "#71717a" }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #27272a", backgroundColor: "#111111", color: "#f4f4f5" }} itemStyle={{ color: "#f4f4f5" }} labelStyle={{ color: "#f4f4f5" }} />
              <Bar dataKey="success" fill="#22c55e" radius={[3, 3, 0, 0]} name="Success" stackId="a" />
              <Bar dataKey="fail" fill="#ef4444" radius={[3, 3, 0, 0]} name="Failed" stackId="a" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-zinc-900 rounded-xl border border-zinc-800/60">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800/60">
            <AlertTriangle className="w-4 h-4 text-amber-400" />
            <h4 className="text-sm font-bold text-zinc-200">System Alerts</h4>
          </div>
          <div className="divide-y divide-zinc-800/40">
            {systemAlerts.map((a, i) => (
              <div key={i} className={`px-4 py-3 ${a.level === "warning" ? "bg-amber-500/5" : a.level === "success" ? "bg-green-500/5" : "bg-blue-500/5"}`}>
                <p className="text-xs text-zinc-400 leading-relaxed">{a.msg}</p>
                <p className="text-xs text-zinc-600 mt-1">{a.time}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Recent users */}
      <div className="bg-zinc-900 rounded-xl border border-zinc-800/60">
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800/60">
          <h4 className="text-sm font-bold text-zinc-200">Recent Registrations</h4>
          <button onClick={() => navigate("/admin/users")} className="text-xs text-green-400 hover:text-green-300 transition-colors">View all</button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[500px]">
            <thead>
              <tr className="text-left text-xs text-zinc-600 bg-zinc-800/30 border-b border-zinc-800/60 uppercase tracking-wider">
                <th className="px-4 py-2.5">Name</th>
                <th className="px-4 py-2.5">Email</th>
                <th className="px-4 py-2.5">Role</th>
                <th className="px-4 py-2.5">Joined</th>
                <th className="px-4 py-2.5">Status</th>
              </tr>
            </thead>
            <tbody>
              {recentUsers.map((u, i) => (
                <tr key={i} className="border-b border-zinc-800/40 last:border-0 hover:bg-zinc-800/30 transition-colors">
                  <td className="px-4 py-3 text-sm font-semibold text-zinc-200">{u.name}</td>
                  <td className="px-4 py-3 text-sm text-zinc-500">{u.email}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-semibold border ${u.role === "PT" ? "bg-blue-500/10 text-blue-400 border-blue-500/20" : "bg-zinc-700/50 text-zinc-400 border-zinc-700"}`}>{u.role}</span>
                  </td>
                  <td className="px-4 py-3 text-sm text-zinc-600">{u.joined}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-semibold border ${u.status === "Active" ? "bg-green-500/10 text-green-400 border-green-500/20" : "bg-amber-500/10 text-amber-400 border-amber-500/20"}`}>{u.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}