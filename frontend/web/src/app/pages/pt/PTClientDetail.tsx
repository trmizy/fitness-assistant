import { useNavigate } from "react-router";
import { ChevronLeft, MessageSquare, Calendar, Activity, TrendingDown, TrendingUp, Brain, FileText, Edit3 } from "lucide-react";
import { LineChart, Line, AreaChart, Area, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";

const weightData = [
  { date: "Jan", weight: 82 }, { date: "Feb", weight: 80.5 }, { date: "Mar", weight: 79 },
  { date: "Apr", weight: 77.8 }, { date: "May", weight: 76.2 }, { date: "Jun", weight: 75.1 },
];

const adherenceData = [
  { week: "W1", workout: 80, nutrition: 75 }, { week: "W2", workout: 100, nutrition: 80 },
  { week: "W3", workout: 80, nutrition: 90 }, { week: "W4", workout: 60, nutrition: 70 },
  { week: "W5", workout: 100, nutrition: 85 }, { week: "W6", workout: 80, nutrition: 90 },
];

const tooltipStyle = {
  contentStyle: {
    fontSize: 12, borderRadius: 8,
    border: "1px solid #27272a",
    backgroundColor: "#111111",
    color: "#f4f4f5",
  }
};

export function PTClientDetail() {
  const navigate = useNavigate();

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-5">
      {/* Back */}
      <button
        onClick={() => navigate("/pt/clients")}
        className="flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-200 transition-colors"
      >
        <ChevronLeft className="w-4 h-4" /> All Clients
      </button>

      {/* Client header */}
      <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-5">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 bg-green-500/15 border border-green-500/20 rounded-2xl flex items-center justify-center text-xl font-bold text-green-400 flex-shrink-0 shadow-lg shadow-green-500/10">
              AJ
            </div>
            <div>
              <h1 className="text-zinc-100">Alex Johnson</h1>
              <div className="flex flex-wrap gap-2 mt-1.5">
                <span className="text-xs bg-blue-500/10 text-blue-400 border border-blue-500/20 px-2 py-0.5 rounded-full">Goal: Lose Fat</span>
                <span className="text-xs bg-green-500/10 text-green-400 border border-green-500/20 px-2 py-0.5 rounded-full">Contract Active</span>
                <span className="text-xs bg-violet-500/10 text-violet-400 border border-violet-500/20 px-2 py-0.5 rounded-full">Week 12</span>
              </div>
              <p className="text-sm text-zinc-500 mt-1.5">28 years · Male · 178 cm · Active since Jan 2025</p>
            </div>
          </div>
          <div className="flex gap-2 flex-wrap sm:flex-nowrap">
            <button onClick={() => navigate("/pt/chat")} className="flex items-center gap-1.5 px-3 py-2 bg-zinc-800 border border-zinc-700/60 text-zinc-300 rounded-xl text-sm font-medium hover:bg-zinc-700 transition-colors">
              <MessageSquare className="w-4 h-4" /> Chat
            </button>
            <button onClick={() => navigate("/pt/schedule")} className="flex items-center gap-1.5 px-3 py-2 bg-blue-500/10 border border-blue-500/20 text-blue-400 rounded-xl text-sm font-medium hover:bg-blue-500/15 transition-colors">
              <Calendar className="w-4 h-4" /> Schedule
            </button>
            <button onClick={() => navigate("/pt/plans")} className="flex items-center gap-1.5 px-3 py-2 bg-green-500 text-black rounded-xl text-sm font-bold hover:bg-green-400 transition-all shadow-md shadow-green-500/20">
              <Brain className="w-4 h-4" /> Review Plan
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left: metrics + charts */}
        <div className="lg:col-span-2 space-y-4">
          {/* Latest InBody */}
          <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-green-400" />
                <h4 className="text-sm font-semibold text-zinc-200">Latest InBody</h4>
              </div>
              <span className="text-xs text-zinc-500">Jun 15, 2025</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: "Weight",    value: "75.1 kg", change: "-6.9",  color: "text-green-400", bg: "bg-green-500/10",  border: "border-green-500/15",  trend: "down" },
                { label: "Muscle",    value: "36.5 kg", change: "+2.5",  color: "text-blue-400",  bg: "bg-blue-500/10",   border: "border-blue-500/15",   trend: "up"   },
                { label: "Body Fat",  value: "13.7 kg", change: "-6.4",  color: "text-orange-400",bg: "bg-orange-500/10", border: "border-orange-500/15", trend: "down" },
                { label: "Body Fat %",value: "18.2%",   change: "-6.3%", color: "text-rose-400",  bg: "bg-rose-500/10",   border: "border-rose-500/15",   trend: "down" },
              ].map(m => (
                <div key={m.label} className={`${m.bg} border ${m.border} rounded-xl p-3`}>
                  <div className="text-xs text-zinc-500 mb-0.5">{m.label}</div>
                  <div className={`text-base font-bold ${m.color}`}>{m.value}</div>
                  <div className={`text-xs flex items-center gap-0.5 mt-0.5 ${m.trend === "down" ? "text-green-400" : "text-blue-400"}`}>
                    {m.trend === "down" ? <TrendingDown className="w-3 h-3" /> : <TrendingUp className="w-3 h-3" />}
                    {m.change} overall
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Weight trend */}
          <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4">
            <h4 className="text-sm font-semibold text-zinc-200 mb-3">Weight Progress</h4>
            <ResponsiveContainer width="100%" height={160}>
              <AreaChart data={weightData}>
                <defs>
                  <linearGradient id="ptDetailWeightGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#22c55e" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#22c55e" stopOpacity={0}   />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#71717a" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "#71717a" }} domain={[73, 84]} axisLine={false} tickLine={false} />
                <Tooltip {...tooltipStyle} formatter={(v: number) => [`${v} kg`, "Weight"]} />
                <Area key="area-weight-detail" type="monotone" dataKey="weight" stroke="#22c55e" fill="url(#ptDetailWeightGrad)" strokeWidth={2.5} dot={{ fill: "#22c55e", r: 3 }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* Adherence chart */}
          <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4">
            <h4 className="text-sm font-semibold text-zinc-200 mb-3">Workout & Nutrition Adherence</h4>
            <ResponsiveContainer width="100%" height={140}>
              <LineChart data={adherenceData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis dataKey="week" tick={{ fontSize: 11, fill: "#71717a" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "#71717a" }} domain={[0, 100]} axisLine={false} tickLine={false} />
                <Tooltip {...tooltipStyle} formatter={(v: number) => [`${v}%`]} />
                <Line key="line-workout"   type="monotone" dataKey="workout"   stroke="#22c55e" strokeWidth={2} name="Workout"   dot={{ fill: "#22c55e",  r: 3 }} />
                <Line key="line-nutrition" type="monotone" dataKey="nutrition" stroke="#60a5fa" strokeWidth={2} name="Nutrition" dot={{ fill: "#60a5fa",  r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
            <div className="flex gap-4 mt-2 text-xs">
              <div className="flex items-center gap-1.5"><div className="w-3 h-0.5 bg-green-500 rounded" /><span className="text-zinc-500">Workout</span></div>
              <div className="flex items-center gap-1.5"><div className="w-3 h-0.5 bg-blue-400 rounded" /><span className="text-zinc-500">Nutrition</span></div>
            </div>
          </div>
        </div>

        {/* Right: summary panels */}
        <div className="space-y-4">
          {/* Contract */}
          <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4">
            <div className="flex items-center gap-2 mb-3">
              <FileText className="w-4 h-4 text-green-400" />
              <h4 className="text-sm font-semibold text-zinc-200">Contract</h4>
            </div>
            <div className="space-y-2 text-sm">
              {[
                { label: "Status",       value: "Active",               valueClass: "text-green-400 font-semibold" },
                { label: "Package",      value: "Premium (12 sessions)", valueClass: "text-zinc-300" },
                { label: "Sessions Used",value: "7 / 12",               valueClass: "text-zinc-300" },
                { label: "Expires",      value: "Aug 31, 2025",         valueClass: "text-zinc-300" },
              ].map(r => (
                <div key={r.label} className="flex justify-between">
                  <span className="text-zinc-500">{r.label}</span>
                  <span className={r.valueClass}>{r.value}</span>
                </div>
              ))}
            </div>
            <div className="mt-3 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
              <div className="h-full bg-green-500 rounded-full shadow-[0_0_8px_rgba(34,197,94,0.4)]" style={{ width: "58%" }} />
            </div>
            <div className="text-xs text-zinc-600 mt-1">5 sessions remaining</div>
          </div>

          {/* AI Plan */}
          <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4">
            <div className="flex items-center gap-2 mb-3">
              <Brain className="w-4 h-4 text-violet-400" />
              <h4 className="text-sm font-semibold text-zinc-200">AI Plan</h4>
            </div>
            <div className="space-y-2 text-sm">
              {[
                { label: "Workout Plan", status: "Active" },
                { label: "Meal Plan",    status: "Active" },
              ].map(p => (
                <div key={p.label} className="flex justify-between items-center">
                  <span className="text-zinc-500">{p.label}</span>
                  <span className="text-xs bg-green-500/10 text-green-400 border border-green-500/20 px-2 py-0.5 rounded-full font-semibold">{p.status}</span>
                </div>
              ))}
            </div>
            <button
              onClick={() => navigate("/pt/plans")}
              className="w-full mt-3 py-2.5 bg-violet-500/10 text-violet-400 border border-violet-500/20 text-sm font-semibold rounded-lg hover:bg-violet-500/15 flex items-center justify-center gap-1.5 transition-colors"
            >
              <Edit3 className="w-3.5 h-3.5" /> Adjust Plan
            </button>
          </div>

          {/* Session notes */}
          <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4">
            <h4 className="text-sm font-semibold text-zinc-200 mb-3">Last Session Notes</h4>
            <div className="space-y-2.5 text-xs text-zinc-500 leading-relaxed">
              <div><span className="font-semibold text-zinc-300">Progress: </span>New bench PR — 90kg × 5. Great upper body strength gains.</div>
              <div><span className="font-semibold text-zinc-300">Concern: </span>Sleep quality declining — averaging 6h vs recommended 8h.</div>
              <div><span className="font-semibold text-zinc-300">Next focus: </span>Lower body compound lifts and sleep hygiene habits.</div>
              <div><span className="font-semibold text-zinc-300">Homework: </span>Log meals daily and aim for 7:30 PM sleep start.</div>
            </div>
            <button className="w-full mt-3 py-2.5 border border-zinc-700/60 text-zinc-500 text-sm font-medium rounded-lg hover:bg-zinc-800 hover:text-zinc-300 transition-colors">
              Add Session Notes
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
