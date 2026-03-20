import { useNavigate } from "react-router";
import { Users, Calendar, FileText, ClipboardList, TrendingUp, AlertCircle, ChevronRight, Clock, CheckCircle } from "lucide-react";
import { BarChart, Bar, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid, LineChart, Line } from "recharts";

const kpis = [
  { label: "Active Clients", value: "14", change: "+2", icon: Users, color: "text-green-400", bg: "bg-green-500/10", iconBg: "bg-green-500/15", border: "border-green-500/20" },
  { label: "Upcoming Sessions", value: "6", change: "This week", icon: Calendar, color: "text-blue-400", bg: "bg-blue-500/10", iconBg: "bg-blue-500/15", border: "border-blue-500/20" },
  { label: "Active Contracts", value: "14", change: "2 expiring", icon: FileText, color: "text-violet-400", bg: "bg-violet-500/10", iconBg: "bg-violet-500/15", border: "border-violet-500/20" },
  { label: "Plans to Review", value: "3", change: "Pending", icon: ClipboardList, color: "text-amber-400", bg: "bg-amber-500/10", iconBg: "bg-amber-500/15", border: "border-amber-500/20" },
];

const weeklyRevenue = [
  { week: "W1", revenue: 12000 }, { week: "W2", revenue: 15000 },
  { week: "W3", revenue: 11000 }, { week: "W4", revenue: 18000 },
];

const sessionTrend = [
  { day: "Mon", sessions: 3 }, { day: "Tue", sessions: 2 }, { day: "Wed", sessions: 4 },
  { day: "Thu", sessions: 1 }, { day: "Fri", sessions: 3 }, { day: "Sat", sessions: 2 }, { day: "Sun", sessions: 0 },
];

const upcoming = [
  { client: "Alex Johnson", time: "Tomorrow, 10:00 AM", type: "Video", session: 8, avatar: "AJ" },
  { client: "Maria Chen", time: "Tomorrow, 2:00 PM", type: "Video", session: 3, avatar: "MC" },
  { client: "Ryan Park", time: "Jun 20, 9:00 AM", type: "Video", session: 5, avatar: "RP" },
];

const alerts = [
  { type: "warning", client: "Tom Wallace", text: "No workout logged for 7 days — check in recommended" },
  { type: "info", client: "Alex Johnson", text: "InBody uploaded — review before next session" },
  { type: "warning", client: "Lisa Morgan", text: "Contract expires in 5 days — renewal needed" },
];

const pendingPlans = [
  { client: "Alex Johnson", plan: "Fat Loss Program", created: "Jun 15", avatar: "AJ" },
  { client: "Maria Chen", plan: "Muscle Gain Plan", created: "Jun 16", avatar: "MC" },
  { client: "Ryan Park", plan: "Strength Program", created: "Jun 17", avatar: "RP" },
];

export function PTDashboard() {
  const navigate = useNavigate();
  const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-zinc-100">Good morning, Sarah 👋</h1>
          <p className="text-zinc-500 text-sm mt-0.5">{today}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => navigate("/pt/clients")} className="flex items-center gap-2 bg-green-500 hover:bg-green-400 text-black px-4 py-2.5 rounded-xl text-sm font-bold transition-all shadow-lg shadow-green-500/20">
            <Users className="w-4 h-4" /> View Clients
          </button>
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
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800/60">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-bold text-zinc-200">Monthly Revenue</h4>
            <span className="text-xs font-bold text-green-400 bg-green-500/10 px-2 py-0.5 rounded-full border border-green-500/20">+18%</span>
          </div>
          <ResponsiveContainer width="100%" height={140}>
            <BarChart data={weeklyRevenue}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis dataKey="week" tick={{ fontSize: 11, fill: "#71717a" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: "#71717a" }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #27272a", backgroundColor: "#111111", color: "#f4f4f5" }} formatter={(v: number) => [`฿${v.toLocaleString()}`]} />
              <Bar dataKey="revenue" fill="#22c55e" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800/60">
          <h4 className="text-sm font-bold text-zinc-200 mb-3">Sessions This Week</h4>
          <ResponsiveContainer width="100%" height={140}>
            <LineChart data={sessionTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis dataKey="day" tick={{ fontSize: 11, fill: "#71717a" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: "#71717a" }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #27272a", backgroundColor: "#111111", color: "#f4f4f5" }} />
              <Line type="monotone" dataKey="sessions" stroke="#22c55e" strokeWidth={2} dot={{ fill: "#22c55e", r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Main content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Upcoming sessions */}
        <div className="lg:col-span-2 bg-zinc-900 rounded-xl border border-zinc-800/60">
          <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800/60">
            <h4 className="text-sm font-bold text-zinc-200">Upcoming Sessions</h4>
            <button onClick={() => navigate("/pt/schedule")} className="text-xs text-green-400 hover:text-green-300 transition-colors">View all</button>
          </div>
          <div className="divide-y divide-zinc-800/40">
            {upcoming.map((s, i) => (
              <div key={i} className="flex items-center justify-between px-4 py-3 hover:bg-zinc-800/30 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 bg-green-500/15 border border-green-500/20 rounded-full flex items-center justify-center text-xs font-bold text-green-400">{s.avatar}</div>
                  <div>
                    <div className="text-sm font-bold text-zinc-200">{s.client}</div>
                    <div className="text-xs text-zinc-600 flex items-center gap-1"><Clock className="w-3 h-3" /> {s.time}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-zinc-600">Session #{s.session}</span>
                  <button className="text-xs bg-green-500 hover:bg-green-400 text-black px-2.5 py-1 rounded-lg font-bold transition-all shadow-sm shadow-green-500/20">Join</button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Alerts */}
        <div className="bg-zinc-900 rounded-xl border border-zinc-800/60">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800/60">
            <AlertCircle className="w-4 h-4 text-amber-400" />
            <h4 className="text-sm font-bold text-zinc-200">Client Alerts</h4>
          </div>
          <div className="divide-y divide-zinc-800/40">
            {alerts.map((a, i) => (
              <div key={i} className={`px-4 py-3 ${a.type === "warning" ? "bg-amber-500/5" : "bg-blue-500/5"}`}>
                <div className="text-xs font-bold text-zinc-200 mb-0.5">{a.client}</div>
                <p className="text-xs text-zinc-500 leading-relaxed">{a.text}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Pending plan reviews */}
      <div className="bg-zinc-900 rounded-xl border border-zinc-800/60">
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800/60">
          <div className="flex items-center gap-2">
            <ClipboardList className="w-4 h-4 text-violet-400" />
            <h4 className="text-sm font-bold text-zinc-200">Plans Awaiting Review</h4>
          </div>
          <button onClick={() => navigate("/pt/plans")} className="text-xs text-green-400 hover:text-green-300 transition-colors">View all</button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[400px]">
            <thead>
              <tr className="text-left text-xs text-zinc-600 border-b border-zinc-800/60 bg-zinc-800/30 uppercase tracking-wider">
                <th className="px-4 py-2">Client</th>
                <th className="px-4 py-2">Plan</th>
                <th className="px-4 py-2">Submitted</th>
                <th className="px-4 py-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {pendingPlans.map((p, i) => (
                <tr key={i} className="border-b border-zinc-800/40 last:border-0 hover:bg-zinc-800/30 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 bg-green-500/15 border border-green-500/20 rounded-full flex items-center justify-center text-xs font-bold text-green-400">{p.avatar}</div>
                      <span className="text-sm font-semibold text-zinc-200">{p.client}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-zinc-400">{p.plan}</td>
                  <td className="px-4 py-3 text-sm text-zinc-600">{p.created}</td>
                  <td className="px-4 py-3">
                    <button onClick={() => navigate("/pt/plans")} className="flex items-center gap-1 text-xs text-violet-400 bg-violet-500/10 border border-violet-500/20 px-2.5 py-1 rounded-lg hover:bg-violet-500/15 transition-colors">
                      Review <ChevronRight className="w-3.5 h-3.5" />
                    </button>
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