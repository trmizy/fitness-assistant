import { useState } from "react";
import { Dumbbell, Check, Plus, ChevronDown, ChevronUp, Award, TrendingUp, Loader2 } from "lucide-react";
import { BarChart, Bar, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { useQuery } from "@tanstack/react-query";
import { workoutService } from "../../services/api";
import { format } from "date-fns";

// Mock data removed, now using workoutService

type View = "today" | "history" | "records";

export function WorkoutLogPage() {
  const [view, setView] = useState<View>("today");
  const [expanded, setExpanded] = useState<number | null>(null);

  const { data: historyData, isLoading: loadingHistory } = useQuery({
    queryKey: ["workout-history"],
    queryFn: () => workoutService.getHistory(1, 10)
  });

  const { data: statsData, isLoading: loadingStats } = useQuery({
    queryKey: ["workout-stats"],
    queryFn: workoutService.getStats
  });

  const { data: prData, isLoading: loadingPRs } = useQuery({
    queryKey: ["workout-prs"],
    queryFn: () => workoutService.getPRs()
  });

  if (loadingHistory || loadingStats || loadingPRs) {
    return (
      <div className="flex h-screen items-center justify-center bg-zinc-950">
        <Loader2 className="w-8 h-8 text-green-500 animate-spin" />
      </div>
    );
  }

  const workouts = historyData?.workouts || [];
  const todayWorkout = workouts[0] || null;
  const prs = (prData?.prs || []).map((p: any) => ({
    exercise: p.exerciseName,
    weight: `${p.maxWeight} kg × ${p.reps}`,
    date: format(new Date(p.date), "MMM d")
  }));

  const weeklyData = (statsData?.weeklyVolume || []).map((v: any) => ({
    day: v.day,
    volume: v.volume
  }));

  const totalSets = todayWorkout?.exercises?.reduce((a: number, e: any) => a + (e.sets?.length || 0), 0) || 0;
  const doneSets = todayWorkout?.exercises?.reduce((a: number, e: any) => a + (e.sets?.filter((s: any) => s.completed)?.length || 0), 0) || 0;
  const completedExercises = todayWorkout?.exercises?.filter((e: any) => e.sets?.every((s: any) => s.completed))?.length || 0;

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
          {todayWorkout ? (
            <>
              {/* Progress bar */}
              <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800/60">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-zinc-200">{todayWorkout.name || "Workout"}</h3>
                  <span className="text-xs text-green-400 font-bold">{doneSets}/{totalSets} sets done</span>
                </div>
                <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
                  <div className="h-full bg-green-500 rounded-full transition-all shadow-[0_0_8px_rgba(34,197,94,0.4)]" style={{ width: `${totalSets > 0 ? (doneSets / totalSets) * 100 : 0}%` }} />
                </div>
                <p className="text-xs text-zinc-600 mt-1">{completedExercises}/{todayWorkout.exercises?.length || 0} exercises completed</p>
              </div>

              {/* Exercises */}
              {todayWorkout.exercises?.map((ex: any) => (
                <div key={ex.id} className="bg-zinc-900 rounded-xl border border-zinc-800/60 overflow-hidden">
                  <button
                    onClick={() => setExpanded(expanded === ex.id ? null : ex.id)}
                    className="flex items-center justify-between w-full px-4 py-3 text-left hover:bg-zinc-800/40 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${ex.sets?.every((s: any) => s.completed) ? "bg-green-500/15 border border-green-500/20" : "bg-zinc-800 border border-zinc-700"}`}>
                        {ex.sets?.every((s: any) => s.completed) ? <Check className="w-4 h-4 text-green-400" /> : <Dumbbell className="w-4 h-4 text-zinc-500" />}
                      </div>
                      <div>
                        <div className="text-sm font-bold text-zinc-200">{ex.exerciseName || ex.name}</div>
                        <div className="text-xs text-zinc-600">{ex.muscleGroup || "Muscle"} · {ex.sets?.length || 0} sets</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-zinc-500">{ex.sets?.filter((s: any) => s.completed).length}/{ex.sets?.length}</span>
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
                            {ex.sets?.map((set: any, i: number) => (
                              <tr key={i} className={`border-t border-zinc-800/40 transition-colors ${set.completed ? "bg-green-500/5" : "hover:bg-zinc-800/30"}`}>
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
                                  <div className={`w-5 h-5 rounded border-2 flex items-center justify-center cursor-pointer transition-all ${set.completed ? "bg-green-500 border-green-500 shadow-[0_0_6px_rgba(34,197,94,0.4)]" : "border-zinc-600 hover:border-green-500/50"}`}>
                                    {set.completed && <Check className="w-3 h-3 text-black" />}
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </>
          ) : (
            <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-20 text-center">
              <Dumbbell className="w-12 h-12 text-zinc-800 mx-auto mb-3" />
              <p className="text-zinc-500">No workout logged for today yet.</p>
              <button className="mt-4 text-green-500 font-bold hover:text-green-400">Start Training Now</button>
            </div>
          )}
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
            {workouts.length > 0 ? (
              workouts.map((w: any, i: number) => (
                <div key={i} className="flex items-center justify-between px-4 py-3 border-b border-zinc-800/40 last:border-0 hover:bg-zinc-800/30 transition-colors">
                  <div>
                    <div className="text-sm font-semibold text-zinc-200">{w.name}</div>
                    <div className="text-xs text-zinc-600">
                      {format(new Date(w.date), "MMM d, yyyy")} · {w.exercises?.length || 0} exercises
                    </div>
                  </div>
                  <span className="text-sm font-bold text-green-400">{w.totalVolume?.toLocaleString() || 0} kg</span>
                </div>
              ))
            ) : (
              <div className="p-10 text-center text-zinc-600 text-sm italic">No workout history found.</div>
            )}
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
            {prs.map((pr: any) => (
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