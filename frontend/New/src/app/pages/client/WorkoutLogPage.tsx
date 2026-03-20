import { useState } from "react";
import { Dumbbell, Check, Plus, ChevronDown, ChevronUp, Award, TrendingUp } from "lucide-react";
import { BarChart, Bar, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";

const todayWorkout = {
  name: "Upper Body Strength",
  exercises: [
    { id: 1, name: "Bench Press", muscle: "Chest", sets: [
      { reps: 8, weight: 87.5, rpe: 7, done: true },
      { reps: 8, weight: 87.5, rpe: 8, done: true },
      { reps: 7, weight: 87.5, rpe: 9, done: true },
      { reps: 0, weight: 87.5, rpe: null, done: false },
    ]},
    { id: 2, name: "Incline DB Press", muscle: "Chest", sets: [
      { reps: 10, weight: 32.5, rpe: 7, done: true },
      { reps: 10, weight: 32.5, rpe: 8, done: false },
      { reps: 0, weight: 32.5, rpe: null, done: false },
    ]},
    { id: 3, name: "OHP", muscle: "Shoulders", sets: [
      { reps: 0, weight: 55, rpe: null, done: false },
      { reps: 0, weight: 55, rpe: null, done: false },
      { reps: 0, weight: 55, rpe: null, done: false },
    ]},
    { id: 4, name: "Tricep Pushdown", muscle: "Triceps", sets: [
      { reps: 0, weight: 35, rpe: null, done: false },
      { reps: 0, weight: 35, rpe: null, done: false },
      { reps: 0, weight: 35, rpe: null, done: false },
    ]},
  ]
};

const weeklyData = [
  { day: "Mon", volume: 4200 },
  { day: "Tue", volume: 5100 },
  { day: "Wed", volume: 0 },
  { day: "Thu", volume: 3800 },
  { day: "Fri", volume: 4700 },
  { day: "Sat", volume: 0 },
  { day: "Sun", volume: 2800 },
];

const prs = [
  { exercise: "Bench Press", weight: "90 kg × 5", date: "Jun 5" },
  { exercise: "Squat", weight: "120 kg × 3", date: "Jun 3" },
  { exercise: "Deadlift", weight: "140 kg × 3", date: "May 28" },
];

type View = "today" | "history" | "records";

export function WorkoutLogPage() {
  const [view, setView] = useState<View>("today");
  const [expanded, setExpanded] = useState<number | null>(1);

  const completedExercises = todayWorkout.exercises.filter(e => e.sets.every(s => s.done)).length;
  const totalSets = todayWorkout.exercises.reduce((a, e) => a + e.sets.length, 0);
  const doneSets = todayWorkout.exercises.reduce((a, e) => a + e.sets.filter(s => s.done).length, 0);

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-zinc-100 flex items-center gap-2"><Dumbbell className="w-5 h-5 text-green-400" /> Workout Log</h1>
          <p className="text-zinc-500 text-sm mt-0.5">Track your sets, reps, and performance</p>
        </div>
        <button className="flex items-center gap-2 bg-green-500 hover:bg-green-400 text-black px-4 py-2 rounded-xl text-sm font-bold transition-all self-start sm:self-auto shadow-lg shadow-green-500/20">
          <Plus className="w-4 h-4" /> Log Workout
        </button>
      </div>

      <div className="flex gap-1 bg-zinc-800/60 border border-zinc-700/40 p-1 rounded-xl w-full sm:w-auto sm:inline-flex">
        {(["today", "history", "records"] as View[]).map((v) => (
          <button key={v} onClick={() => setView(v)} className={`flex-1 sm:flex-none px-4 py-1.5 rounded-lg text-sm font-semibold capitalize transition-all ${view === v ? "bg-green-500 text-black shadow-sm" : "text-zinc-500 hover:text-zinc-300"}`}>
            {v === "today" ? "Today" : v === "history" ? "History" : "PRs"}
          </button>
        ))}
      </div>

      {view === "today" && (
        <div className="space-y-4">
          {/* Progress bar */}
          <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800/60">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-zinc-200">{todayWorkout.name}</h3>
              <span className="text-xs text-green-400 font-bold">{doneSets}/{totalSets} sets done</span>
            </div>
            <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
              <div className="h-full bg-green-500 rounded-full transition-all shadow-[0_0_8px_rgba(34,197,94,0.4)]" style={{ width: `${(doneSets / totalSets) * 100}%` }} />
            </div>
            <p className="text-xs text-zinc-600 mt-1">{completedExercises}/{todayWorkout.exercises.length} exercises completed</p>
          </div>

          {/* Exercises */}
          {todayWorkout.exercises.map((ex) => (
            <div key={ex.id} className="bg-zinc-900 rounded-xl border border-zinc-800/60 overflow-hidden">
              <button
                onClick={() => setExpanded(expanded === ex.id ? null : ex.id)}
                className="flex items-center justify-between w-full px-4 py-3 text-left hover:bg-zinc-800/40 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${ex.sets.every(s => s.done) ? "bg-green-500/15 border border-green-500/20" : "bg-zinc-800 border border-zinc-700"}`}>
                    {ex.sets.every(s => s.done) ? <Check className="w-4 h-4 text-green-400" /> : <Dumbbell className="w-4 h-4 text-zinc-500" />}
                  </div>
                  <div>
                    <div className="text-sm font-bold text-zinc-200">{ex.name}</div>
                    <div className="text-xs text-zinc-600">{ex.muscle} · {ex.sets.length} sets</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-zinc-500">{ex.sets.filter(s => s.done).length}/{ex.sets.length}</span>
                  {expanded === ex.id ? <ChevronUp className="w-4 h-4 text-zinc-500" /> : <ChevronDown className="w-4 h-4 text-zinc-500" />}
                </div>
              </button>

              {expanded === ex.id && (
                <div className="border-t border-zinc-800/60">
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[350px] text-sm">
                      <thead>
                        <tr className="text-left text-xs text-zinc-600 bg-zinc-800/30 uppercase tracking-wider">
                          <th className="px-4 py-2">Set</th>
                          <th className="px-4 py-2">Reps</th>
                          <th className="px-4 py-2">Weight (kg)</th>
                          <th className="px-4 py-2">RPE</th>
                          <th className="px-4 py-2">Done</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ex.sets.map((set, i) => (
                          <tr key={i} className={`border-t border-zinc-800/40 transition-colors ${set.done ? "bg-green-500/5" : "hover:bg-zinc-800/30"}`}>
                            <td className="px-4 py-2.5 text-zinc-500">{i + 1}</td>
                            <td className="px-4 py-2.5">
                              <input defaultValue={set.reps || ""} placeholder="—" className="w-14 px-2 py-1 border border-zinc-700/60 rounded text-xs focus:outline-none focus:ring-1 focus:ring-green-500/50 bg-zinc-800/60 text-zinc-200" />
                            </td>
                            <td className="px-4 py-2.5">
                              <input defaultValue={set.weight} className="w-16 px-2 py-1 border border-zinc-700/60 rounded text-xs focus:outline-none focus:ring-1 focus:ring-green-500/50 bg-zinc-800/60 text-zinc-200" />
                            </td>
                            <td className="px-4 py-2.5">
                              <input defaultValue={set.rpe || ""} placeholder="—" className="w-12 px-2 py-1 border border-zinc-700/60 rounded text-xs focus:outline-none focus:ring-1 focus:ring-green-500/50 bg-zinc-800/60 text-zinc-200" />
                            </td>
                            <td className="px-4 py-2.5">
                              <div className={`w-5 h-5 rounded border-2 flex items-center justify-center cursor-pointer transition-all ${set.done ? "bg-green-500 border-green-500 shadow-[0_0_6px_rgba(34,197,94,0.4)]" : "border-zinc-600 hover:border-green-500/50"}`}>
                                {set.done && <Check className="w-3 h-3 text-black" />}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="px-4 py-2 border-t border-zinc-800/40">
                    <button className="flex items-center gap-1 text-xs text-green-400 hover:text-green-300 transition-colors">
                      <Plus className="w-3.5 h-3.5" /> Add set
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {view === "history" && (
        <div className="space-y-4">
          <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800/60">
            <h4 className="text-sm font-bold text-zinc-200 mb-3">Weekly Volume (kg)</h4>
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={weeklyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis dataKey="day" tick={{ fontSize: 11, fill: "#71717a" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "#71717a" }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #27272a", backgroundColor: "#111111", color: "#f4f4f5" }} formatter={(v: number) => [`${v} kg`, "Volume"]} />
                <Bar dataKey="volume" fill="#22c55e" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 overflow-hidden">
            <div className="px-4 py-3 border-b border-zinc-800/60">
              <h4 className="text-sm font-bold text-zinc-200">Recent Workouts</h4>
            </div>
            {[
              { name: "Upper Body Strength", date: "Jun 18", sets: 16, volume: "4,720 kg" },
              { name: "HIIT Cardio", date: "Jun 17", sets: 0, volume: "35 min" },
              { name: "Lower Body Power", date: "Jun 15", sets: 18, volume: "5,800 kg" },
              { name: "Core & Mobility", date: "Jun 14", sets: 12, volume: "2,100 kg" },
            ].map((w, i) => (
              <div key={i} className="flex items-center justify-between px-4 py-3 border-b border-zinc-800/40 last:border-0 hover:bg-zinc-800/30 transition-colors">
                <div>
                  <div className="text-sm font-semibold text-zinc-200">{w.name}</div>
                  <div className="text-xs text-zinc-600">{w.date} · {w.sets > 0 ? `${w.sets} sets` : "Cardio"}</div>
                </div>
                <span className="text-sm font-bold text-green-400">{w.volume}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {view === "records" && (
        <div className="space-y-3">
          <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 overflow-hidden">
            <div className="px-4 py-3 border-b border-zinc-800/60 flex items-center gap-2">
              <Award className="w-4 h-4 text-amber-400" />
              <h4 className="text-sm font-bold text-zinc-200">Personal Records</h4>
            </div>
            {prs.map((pr) => (
              <div key={pr.exercise} className="flex items-center justify-between px-4 py-3 border-b border-zinc-800/40 last:border-0 hover:bg-zinc-800/30 transition-colors">
                <div>
                  <div className="text-sm font-bold text-zinc-200">{pr.exercise}</div>
                  <div className="text-xs text-zinc-600">{pr.date}</div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-amber-400">{pr.weight}</span>
                  <Award className="w-4 h-4 text-amber-400" />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}