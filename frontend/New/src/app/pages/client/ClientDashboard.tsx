import { useNavigate } from "react-router";
import {
  AreaChart, Area, LineChart, Line,
  ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid
} from "recharts";
import {
  Activity, Brain, Calendar, MessageSquare, TrendingDown,
  TrendingUp, Zap, Upload, Dumbbell, ChevronRight, Bell,
  Target, Clock, Award, Flame
} from "lucide-react";

const weightData = [
  { date: "Jan", value: 82 }, { date: "Feb", value: 80.5 }, { date: "Mar", value: 79 },
  { date: "Apr", value: 77.8 }, { date: "May", value: 76.2 }, { date: "Jun", value: 75.1 },
];
const muscleData = [
  { date: "Jan", value: 34 }, { date: "Feb", value: 34.5 }, { date: "Mar", value: 35.2 },
  { date: "Apr", value: 35.8 }, { date: "May", value: 36.1 }, { date: "Jun", value: 36.5 },
];
const calorieData = [
  { day: "Mon", cal: 2100 }, { day: "Tue", cal: 1950 }, { day: "Wed", cal: 2200 },
  { day: "Thu", cal: 1800 }, { day: "Fri", cal: 2050 }, { day: "Sat", cal: 2300 }, { day: "Sun", cal: 1900 },
];

const kpis = [
  { label: "Current Weight", value: "75.1 kg", change: "-6.9kg", icon: TrendingDown, color: "text-green-400", bg: "bg-green-500/10", iconBg: "bg-green-500/15", border: "border-green-500/20" },
  { label: "Muscle Mass", value: "36.5 kg", change: "+2.5kg", icon: TrendingUp, color: "text-blue-400", bg: "bg-blue-500/10", iconBg: "bg-blue-500/15", border: "border-blue-500/20" },
  { label: "Body Fat", value: "18.2%", change: "-3.1%", icon: Flame, color: "text-orange-400", bg: "bg-orange-500/10", iconBg: "bg-orange-500/15", border: "border-orange-500/20" },
  { label: "Workouts / Week", value: "4 / 5", change: "80%", icon: Dumbbell, color: "text-emerald-400", bg: "bg-emerald-500/10", iconBg: "bg-emerald-500/15", border: "border-emerald-500/20" },
];

const quickActions = [
  { label: "Upload InBody", icon: Upload, to: "/client/inbody", color: "bg-green-500 hover:bg-green-400 text-black shadow-green-500/25" },
  { label: "Log Workout", icon: Dumbbell, to: "/client/workout", color: "bg-zinc-800 hover:bg-zinc-700 text-zinc-100 border border-zinc-700" },
  { label: "View Plan", icon: Brain, to: "/client/plans", color: "bg-zinc-800 hover:bg-zinc-700 text-zinc-100 border border-zinc-700" },
  { label: "Message PT", icon: MessageSquare, to: "/client/chat", color: "bg-zinc-800 hover:bg-zinc-700 text-zinc-100 border border-zinc-700" },
  { label: "Book Session", icon: Calendar, to: "/client/booking", color: "bg-zinc-800 hover:bg-zinc-700 text-zinc-100 border border-zinc-700" },
];

const alerts = [
  { type: "info", text: "Your AI plan has been updated by Coach Sarah. Review recommended changes." },
  { type: "warning", text: "Upcoming session tomorrow at 10:00 AM – Video Call with Coach Sarah." },
  { type: "success", text: "InBody analysis complete — body fat reduced by 0.8% this month!" },
];

const tooltipStyle = {
  contentStyle: {
    fontSize: 12, borderRadius: 8,
    border: "1px solid #27272a",
    backgroundColor: "#111111",
    color: "#f4f4f5"
  }
};

export function ClientDashboard() {
  const navigate = useNavigate();
  const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-7xl mx-auto">
      {/* Greeting */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-zinc-100">Good morning, Alex 👋</h1>
          <p className="text-zinc-500 text-sm mt-0.5">{today} · Week 12 of your program</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="px-3 py-1 bg-green-500/10 text-green-400 text-xs font-semibold rounded-full flex items-center gap-1.5 border border-green-500/20">
            <div className="w-1.5 h-1.5 bg-green-500 rounded-full shadow-[0_0_6px_rgba(34,197,94,0.8)]" />
            Contract Active
          </span>
          <span className="px-3 py-1 bg-zinc-800 text-zinc-400 text-xs font-semibold rounded-full flex items-center gap-1.5 border border-zinc-700/50">
            <Target className="w-3 h-3" />
            Goal: Lose Fat
          </span>
        </div>
      </div>

      {/* Alerts */}
      <div className="space-y-2">
        {alerts.map((a, i) => (
          <div key={i} className={`flex items-start gap-3 px-4 py-3 rounded-xl text-sm border ${
            a.type === "info" ? "bg-blue-500/8 border-blue-500/20 text-blue-300" :
            a.type === "warning" ? "bg-amber-500/8 border-amber-500/20 text-amber-300" :
            "bg-green-500/8 border-green-500/20 text-green-300"
          }`}>
            <Bell className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <span>{a.text}</span>
          </div>
        ))}
      </div>

      {/* Quick actions */}
      <div>
        <h3 className="text-zinc-400 text-xs font-semibold uppercase tracking-wider mb-2.5">Quick Actions</h3>
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
          {quickActions.map((a) => (
            <button
              key={a.label}
              onClick={() => navigate(a.to)}
              className={`${a.color} rounded-xl p-3 flex flex-col items-center gap-2 transition-all shadow-lg`}
            >
              <a.icon className="w-5 h-5" />
              <span className="text-xs font-semibold leading-tight text-center">{a.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {kpis.map((k) => (
          <div key={k.label} className={`${k.bg} rounded-xl p-4 border ${k.border}`}>
            <div className="flex items-start justify-between mb-3">
              <div className={`w-9 h-9 ${k.iconBg} rounded-lg flex items-center justify-center`}>
                <k.icon className={`w-4 h-4 ${k.color}`} />
              </div>
              <span className={`text-xs font-bold ${k.color} bg-black/20 px-2 py-0.5 rounded-full`}>
                {k.change}
              </span>
            </div>
            <div className="text-xl font-bold text-zinc-100">{k.value}</div>
            <div className="text-xs text-zinc-500 mt-0.5">{k.label}</div>
          </div>
        ))}
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {/* Weight trend */}
        <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800/60">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-semibold text-zinc-200">Weight Trend</h4>
            <span className="text-xs text-green-400 font-bold bg-green-500/10 px-2 py-0.5 rounded-full border border-green-500/20">-6.9 kg</span>
          </div>
          <ResponsiveContainer width="100%" height={120}>
            <AreaChart data={weightData}>
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#71717a" }} axisLine={false} tickLine={false} />
              <Tooltip {...tooltipStyle} formatter={(v: number) => [`${v} kg`, "Weight"]} />
              <Area type="monotone" dataKey="value" stroke="#22c55e" strokeWidth={2} fill="#22c55e" fillOpacity={0.12} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Muscle trend */}
        <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800/60">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-semibold text-zinc-200">Muscle Mass</h4>
            <span className="text-xs text-blue-400 font-bold bg-blue-500/10 px-2 py-0.5 rounded-full border border-blue-500/20">+2.5 kg</span>
          </div>
          <ResponsiveContainer width="100%" height={120}>
            <LineChart data={muscleData}>
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#71717a" }} axisLine={false} tickLine={false} />
              <Tooltip {...tooltipStyle} formatter={(v: number) => [`${v} kg`, "Muscle"]} />
              <Line type="monotone" dataKey="value" stroke="#60a5fa" strokeWidth={2} dot={{ fill: "#60a5fa", strokeWidth: 0, r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Weekly calories */}
        <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800/60 md:col-span-2 xl:col-span-1">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-semibold text-zinc-200">Weekly Calories</h4>
            <span className="text-xs text-zinc-500">Target: 2,000 kcal</span>
          </div>
          <ResponsiveContainer width="100%" height={120}>
            <AreaChart data={calorieData}>
              <XAxis dataKey="day" tick={{ fontSize: 10, fill: "#71717a" }} axisLine={false} tickLine={false} />
              <Tooltip {...tooltipStyle} formatter={(v: number) => [`${v} kcal`]} />
              <Area type="monotone" dataKey="cal" stroke="#a78bfa" strokeWidth={2} fill="#a78bfa" fillOpacity={0.12} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Bottom row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Active plan */}
        <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800/60">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-semibold text-zinc-200">Active Plan</h4>
            <span className="text-xs bg-green-500/10 text-green-400 font-bold px-2 py-0.5 rounded-full border border-green-500/20">Active</span>
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-3 p-3 bg-green-500/8 rounded-lg border border-green-500/15">
              <Dumbbell className="w-5 h-5 text-green-400" />
              <div>
                <div className="text-sm font-semibold text-zinc-200">Fat Loss Program</div>
                <div className="text-xs text-zinc-500">5 days/week · 12 weeks</div>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 bg-zinc-800/60 rounded-lg border border-zinc-700/40">
              <Zap className="w-5 h-5 text-emerald-400" />
              <div>
                <div className="text-sm font-semibold text-zinc-200">High Protein Meal Plan</div>
                <div className="text-xs text-zinc-500">2,000 kcal · 160g protein</div>
              </div>
            </div>
          </div>
          <button onClick={() => navigate("/client/plans")} className="flex items-center gap-1 text-xs text-green-400 hover:text-green-300 mt-3 transition-colors">
            View full plan <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Next session */}
        <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800/60">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-semibold text-zinc-200">Next Session</h4>
            <span className="text-xs bg-amber-500/10 text-amber-400 font-bold px-2 py-0.5 rounded-full border border-amber-500/20">Tomorrow</span>
          </div>
          <div className="flex items-center gap-3 mb-3">
            <div className="w-12 h-12 bg-green-500/15 rounded-full flex items-center justify-center text-green-400 font-bold text-sm flex-shrink-0 border border-green-500/20">SM</div>
            <div>
              <div className="text-sm font-semibold text-zinc-200">Coach Sarah Mitchell</div>
              <div className="text-xs text-zinc-500">Online · Video Call</div>
            </div>
          </div>
          <div className="flex items-center gap-2 text-sm text-zinc-400 mb-2">
            <Clock className="w-4 h-4 text-zinc-600" />
            Tomorrow, 10:00 – 11:00 AM
          </div>
          <div className="flex items-center gap-2 text-sm text-zinc-400">
            <Activity className="w-4 h-4 text-zinc-600" />
            Session 8 of 12
          </div>
          <button
            onClick={() => navigate("/client/booking")}
            className="w-full mt-3 py-2 bg-green-500 hover:bg-green-400 text-black text-sm font-bold rounded-lg transition-all shadow-lg shadow-green-500/20"
          >
            Join Session
          </button>
        </div>

        {/* AI Insights */}
        <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800/60 relative overflow-hidden">
          <div className="absolute -top-10 -right-10 w-32 h-32 bg-green-500/5 rounded-full blur-2xl" />
          <div className="flex items-center gap-2 mb-3 relative z-10">
            <div className="w-7 h-7 bg-green-500/15 rounded-lg flex items-center justify-center border border-green-500/20">
              <Brain className="w-4 h-4 text-green-400" />
            </div>
            <h4 className="text-sm font-semibold text-zinc-200">AI Insights</h4>
            <span className="ml-auto text-xs text-green-400 font-semibold">Live</span>
          </div>
          <div className="space-y-2.5 relative z-10">
            {[
              { icon: Award, text: "Great progress! You're 15% ahead of your weight loss goal." },
              { icon: TrendingUp, text: "Muscle mass is growing. Keep your protein intake above 160g/day." },
              { icon: Target, text: "Consider increasing cardio on rest days for better fat oxidation." },
            ].map((ins, i) => (
              <div key={i} className="flex items-start gap-2.5 bg-zinc-800/60 rounded-lg p-2.5 border border-zinc-700/40">
                <ins.icon className="w-4 h-4 mt-0.5 flex-shrink-0 text-green-400" />
                <p className="text-xs text-zinc-400 leading-relaxed">{ins.text}</p>
              </div>
            ))}
          </div>
          <p className="text-xs text-zinc-600 mt-3 relative z-10">*AI insights are informational only, not medical advice.</p>
        </div>
      </div>

      {/* Recent workouts */}
      <div className="bg-zinc-900 rounded-xl border border-zinc-800/60">
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800/60">
          <h4 className="text-sm font-semibold text-zinc-200">Recent Workouts</h4>
          <button onClick={() => navigate("/client/workout")} className="text-xs text-green-400 hover:text-green-300 transition-colors">View all</button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[400px]">
            <thead>
              <tr className="text-left text-xs text-zinc-600 border-b border-zinc-800/60 bg-zinc-800/30">
                <th className="px-4 py-2 font-semibold uppercase tracking-wider">Workout</th>
                <th className="px-4 py-2 font-semibold uppercase tracking-wider">Date</th>
                <th className="px-4 py-2 font-semibold uppercase tracking-wider">Duration</th>
                <th className="px-4 py-2 font-semibold uppercase tracking-wider">Status</th>
              </tr>
            </thead>
            <tbody>
              {[
                { name: "Upper Body Strength", date: "Jun 18", dur: "55 min", status: "Completed" },
                { name: "HIIT Cardio", date: "Jun 17", dur: "35 min", status: "Completed" },
                { name: "Lower Body Power", date: "Jun 15", dur: "60 min", status: "Completed" },
                { name: "Core & Mobility", date: "Jun 14", dur: "40 min", status: "Skipped" },
              ].map((w, i) => (
                <tr key={i} className="border-b border-zinc-800/40 last:border-0 hover:bg-zinc-800/40 transition-colors">
                  <td className="px-4 py-2.5 text-sm font-semibold text-zinc-200">{w.name}</td>
                  <td className="px-4 py-2.5 text-sm text-zinc-500">{w.date}</td>
                  <td className="px-4 py-2.5 text-sm text-zinc-500">{w.dur}</td>
                  <td className="px-4 py-2.5">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${w.status === "Completed" ? "bg-green-500/10 text-green-400 border border-green-500/20" : "bg-red-500/10 text-red-400 border border-red-500/20"}`}>
                      {w.status}
                    </span>
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