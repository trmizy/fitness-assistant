import { useNavigate } from "react-router";
import { useApp } from "../../context/AppContext";
import {
  AreaChart, Area, LineChart, Line,
  ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid
} from "recharts";
import { useQuery } from "@tanstack/react-query";
import { profileService, inbodyService, workoutService } from "../../services/api";
import { 
  Activity, Brain, Calendar, MessageSquare, TrendingDown, 
  TrendingUp, Zap, Upload, Dumbbell, ChevronRight, Bell, 
  Target, Clock, Award, Flame, Loader2
} from "lucide-react";

const tooltipStyle = {
  contentStyle: {
    fontSize: 12, borderRadius: 8,
    border: "1px solid #27272a",
    backgroundColor: "#111111",
    color: "#f4f4f5"
  }
};

export function ClientDashboard() {
  const { user } = useApp();
  const navigate = useNavigate();
  const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  const { data: profile, isLoading: profileLoading } = useQuery({
    queryKey: ["profile"],
    queryFn: async () => {
      const res = await profileService.getProfile();
      return res.profile;
    }
  });

  const { data: inbodyHistory = [], isLoading: inbodyLoading } = useQuery({
    queryKey: ["inbody-history"],
    queryFn: inbodyService.getHistory
  });

  const { data: workoutHistory = [], isLoading: workoutLoading } = useQuery({
    queryKey: ["workout-history"],
    queryFn: () => workoutService.getHistory(1, 4)
  });

  const firstName = user?.firstName || "User";
  const isLoading = profileLoading || inbodyLoading || workoutLoading;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 text-green-500 animate-spin" />
      </div>
    );
  }

  // Derived KPIs
  const latest = inbodyHistory[0];
  const prev = inbodyHistory[1];

  const calcChange = (curr: number, old?: number) => {
    if (!old) return "---";
    const diff = curr - old;
    return (diff > 0 ? "+" : "") + diff.toFixed(1);
  };

  const kpis = [
    { 
      label: "Current Weight", 
      value: latest?.weight ? `${latest.weight} kg` : "---", 
      change: calcChange(latest?.weight, prev?.weight) + (prev ? " kg" : ""),
      icon: TrendingDown, color: "text-green-400", bg: "bg-green-500/10", iconBg: "bg-green-500/15", border: "border-green-500/20" 
    },
    { 
      label: "Muscle Mass", 
      value: latest?.muscleMass ? `${latest.muscleMass} kg` : "---", 
      change: calcChange(latest?.muscleMass, prev?.muscleMass) + (prev ? " kg" : ""),
      icon: TrendingUp, color: "text-blue-400", bg: "bg-blue-500/10", iconBg: "bg-blue-500/15", border: "border-blue-500/20" 
    },
    { 
      label: "Body Fat", 
      value: latest?.bodyFatPct ? `${latest.bodyFatPct}%` : "---", 
      change: calcChange(latest?.bodyFatPct, prev?.bodyFatPct) + (prev ? "%" : ""),
      icon: Flame, color: "text-orange-400", bg: "bg-orange-500/10", iconBg: "bg-orange-500/15", border: "border-orange-500/20" 
    },
    { 
      label: "Workouts Done", 
      value: workoutHistory.length.toString(), 
      change: "Last 30d", 
      icon: Dumbbell, color: "text-emerald-400", bg: "bg-emerald-500/10", iconBg: "bg-emerald-500/15", border: "border-emerald-500/20" 
    },
  ];

  const weightData = [...inbodyHistory].reverse().map(h => ({
    date: new Date(h.date).toLocaleDateString(undefined, { month: 'short' }),
    value: h.weight
  }));

  const muscleData = [...inbodyHistory].reverse().map(h => ({
    date: new Date(h.date).toLocaleDateString(undefined, { month: 'short' }),
    value: h.muscleMass
  }));

  const quickActions = [
    { label: "Upload InBody", icon: Upload, to: "/client/inbody", color: "bg-green-500 hover:bg-green-400 text-black shadow-green-500/25" },
    { label: "Log Workout", icon: Dumbbell, to: "/client/workout", color: "bg-zinc-800 hover:bg-zinc-700 text-zinc-100 border border-zinc-700" },
    { label: "View Plan", icon: Brain, to: "/client/plans", color: "bg-zinc-800 hover:bg-zinc-700 text-zinc-100 border border-zinc-700" },
    { label: "Message PT", icon: MessageSquare, to: "/client/chat", color: "bg-zinc-800 hover:bg-zinc-700 text-zinc-100 border border-zinc-700" },
    { label: "Book Session", icon: Calendar, to: "/client/booking", color: "bg-zinc-800 hover:bg-zinc-700 text-zinc-100 border border-zinc-700" },
  ];

  const goalLabels: any = {
    WEIGHT_LOSS: "Lose Fat",
    MUSCLE_GAIN: "Gain Muscle",
    MAINTENANCE: "Maintain Body",
    ATHLETIC_PERFORMANCE: "Improve Health"
  };

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-7xl mx-auto">
      {/* Greeting */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-zinc-100">Good morning, {firstName} 👋</h1>
          <p className="text-zinc-500 text-sm mt-0.5">{today} · Active Session</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="px-3 py-1 bg-green-500/10 text-green-400 text-xs font-semibold rounded-full flex items-center gap-1.5 border border-green-500/20">
            <div className="w-1.5 h-1.5 bg-green-500 rounded-full shadow-[0_0_6px_rgba(34,197,94,0.8)]" />
            Fitness Member
          </span>
          <span className="px-3 py-1 bg-zinc-800 text-zinc-400 text-xs font-semibold rounded-full flex items-center gap-1.5 border border-zinc-700/50">
            <Target className="w-3 h-3" />
            Goal: {profile?.goal ? goalLabels[profile.goal] : "Fitness"}
          </span>
        </div>
      </div>

      {/* Alerts - Only show if relevant data exists or empty for now */}
      {inbodyHistory.length === 0 && (
        <div className="flex items-start gap-3 px-4 py-3 rounded-xl text-sm border bg-amber-500/8 border-amber-500/20 text-amber-300">
          <Bell className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>You haven't uploaded any InBody data yet. Upload now for AI analysis!</span>
        </div>
      )}

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
            {weightData.length > 1 && (
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${parseFloat(calcChange(latest?.weight, prev?.weight)) <= 0 ? "text-green-400 bg-green-500/10 border-green-500/20" : "text-red-400 bg-red-500/10 border-red-500/20"}`}>
                {calcChange(latest?.weight, prev?.weight)} kg
              </span>
            )}
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
            {muscleData.length > 1 && (
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${parseFloat(calcChange(latest?.muscleMass, prev?.muscleMass)) >= 0 ? "text-blue-400 bg-blue-500/10 border-blue-500/20" : "text-amber-400 bg-amber-500/10 border-amber-500/20"}`}>
                {calcChange(latest?.muscleMass, prev?.muscleMass)} kg
              </span>
            )}
          </div>
          <ResponsiveContainer width="100%" height={120}>
            <LineChart data={muscleData}>
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#71717a" }} axisLine={false} tickLine={false} />
              <Tooltip {...tooltipStyle} formatter={(v: number) => [`${v} kg`, "Muscle"]} />
              <Line type="monotone" dataKey="value" stroke="#60a5fa" strokeWidth={2} dot={{ fill: "#60a5fa", strokeWidth: 0, r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Weekly calories - Empty for now */}
        <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800/60 md:col-span-2 xl:col-span-1">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-semibold text-zinc-200">Weekly Calories</h4>
            <span className="text-xs text-zinc-500">No data</span>
          </div>
          <div className="h-[120px] flex items-center justify-center border border-dashed border-zinc-800 rounded-lg">
            <p className="text-[10px] text-zinc-600 italic">Sync your fitness tracker for calorie data</p>
          </div>
        </div>
      </div>

      {/* Bottom row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Active plan */}
        <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800/60">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-semibold text-zinc-200">Active Plan</h4>
          </div>
          <div className="flex flex-col items-center justify-center h-[100px] border border-dashed border-zinc-800 rounded-lg text-center p-4">
             <Brain className="w-6 h-6 text-zinc-700 mb-2" />
             <p className="text-[10px] text-zinc-500 italic">No active AI plan. Go to AI Plans to generate one.</p>
             <button onClick={() => navigate("/client/plans")} className="mt-2 text-[10px] text-green-500 font-bold hover:underline">Get Started</button>
          </div>
        </div>

        {/* Next session - Placeholder for upcoming session logic */}
        <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800/60 flex flex-col items-center justify-center text-center">
           <Calendar className="w-8 h-8 text-zinc-700 mb-2" />
           <p className="text-sm text-zinc-500 font-medium">No upcoming sessions</p>
           <button onClick={() => navigate("/client/booking")} className="mt-3 text-xs text-green-400 hover:underline">Book your first session</button>
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
            {latest ? (
              <>
                <div className="flex items-start gap-2.5 bg-zinc-800/60 rounded-lg p-2.5 border border-zinc-700/40">
                  <Award className="w-4 h-4 mt-0.5 flex-shrink-0 text-green-400" />
                  <p className="text-xs text-zinc-400 leading-relaxed">Your latest weight is {latest.weight}kg. Keep tracking your progress!</p>
                </div>
                <div className="flex items-start gap-2.5 bg-zinc-800/60 rounded-lg p-2.5 border border-zinc-700/40">
                  <TrendingUp className="w-4 h-4 mt-0.5 flex-shrink-0 text-green-400" />
                  <p className="text-xs text-zinc-400 leading-relaxed">Your muscle mass is {latest.muscleMass}kg. Aim for high protein intake.</p>
                </div>
              </>
            ) : (
              <div className="text-center py-4">
                <p className="text-xs text-zinc-500 italic">No AI insights available yet. Upload your InBody results to get started.</p>
              </div>
            )}
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
              {workoutHistory.length > 0 ? workoutHistory.map((w: any, i: number) => (
                <tr key={i} className="border-b border-zinc-800/40 last:border-0 hover:bg-zinc-800/40 transition-colors">
                  <td className="px-4 py-2.5 text-sm font-semibold text-zinc-200">{w.title || "Workout"}</td>
                  <td className="px-4 py-2.5 text-sm text-zinc-500">{new Date(w.date).toLocaleDateString()}</td>
                  <td className="px-4 py-2.5 text-sm text-zinc-500">{w.durationMinutes || "--"} min</td>
                  <td className="px-4 py-2.5">
                    <span className="text-xs px-2 py-0.5 rounded-full font-semibold bg-green-500/10 text-green-400 border border-green-500/20">
                      Completed
                    </span>
                  </td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-xs text-zinc-600 italic">No recent workouts logged yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}