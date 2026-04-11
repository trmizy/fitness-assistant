import { useState } from "react";
import {
  Dumbbell, Check, Plus, ChevronDown, ChevronUp, Award, Loader2, Save, X,
} from "lucide-react";
import { BarChart, Bar, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { workoutService } from "../../services/api";

type View = "today" | "history" | "records";

type SetPatch = {
  reps?: number;
  weight?: number;
  rpe?: number;
  completed?: boolean;
};

type WorkoutSet = {
  id: string;
  setNumber: number;
  reps: number | null;
  weight: number | null;
  rpe: number | null;
  completed: boolean;
};

type WorkoutExercise = {
  id: string;
  sets: number;
  reps: number | null;
  weight: number | null;
  notes: string | null;
  exercise: {
    exerciseName: string;
    bodyPart: string;
    muscleGroupsActivated?: string[];
  };
  workoutSets: WorkoutSet[];
};

type Workout = {
  id: string;
  name: string;
  date: string;
  duration: number | null;
  notes: string | null;
  exercises: WorkoutExercise[];
};

type ExerciseOption = {
  id: string;
  exerciseName: string;
};

type LogExerciseRow = {
  tempId: string;
  exerciseId: string;
  sets: number;
  reps: number;
  weight: number;
  duration: number;
  notes: string;
};

function makeTempId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function computeVolume(w: Workout): number {
  if (!Array.isArray(w.exercises)) return 0;
  return w.exercises.reduce((sum, ex) => {
    if (Array.isArray(ex.workoutSets) && ex.workoutSets.length > 0) {
      return sum + ex.workoutSets.reduce((s, set) => s + (set.weight || 0) * (set.reps || 0), 0);
    }
    return sum + (ex.weight || 0) * (ex.reps || 0) * (ex.sets || 0);
  }, 0);
}

function normalizeWorkouts(data: any): Workout[] {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.workouts)) return data.workouts;
  return [];
}

function normalizeExercises(data: any): ExerciseOption[] {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.exercises)) return data.exercises;
  return [];
}

export function WorkoutLogPage() {
  const queryClient = useQueryClient();
  const [view, setView] = useState<View>("today");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showLogForm, setShowLogForm] = useState(false);

  // Local set state for optimistic UI before save
  const [setEdits, setSetEdits] = useState<Record<string, SetPatch>>({});

  // Log form state
  const [logName, setLogName] = useState("Custom Workout Session");
  const [logDate, setLogDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [logDuration, setLogDuration] = useState(60);
  const [logNotes, setLogNotes] = useState("");
  const [logExercises, setLogExercises] = useState<LogExerciseRow[]>([
    { tempId: makeTempId(), exerciseId: "", sets: 3, reps: 10, weight: 0, duration: 0, notes: "" },
  ]);

  const { data: historyRaw, isLoading: loadingHistory } = useQuery({
    queryKey: ["workout-history"],
    queryFn: () => workoutService.getHistory(1, 10),
  });

  const { data: statsData, isLoading: loadingStats } = useQuery({
    queryKey: ["workout-stats"],
    queryFn: workoutService.getStats,
  });

  const { data: prRaw, isLoading: loadingPRs } = useQuery({
    queryKey: ["workout-prs"],
    queryFn: () => workoutService.getPRs(),
  });

  const { data: exercisesRaw, isLoading: loadingExercises } = useQuery({
    queryKey: ["exercise-options"],
    queryFn: workoutService.getExercises,
  });

  const updateSetMutation = useMutation({
    mutationFn: ({ setId, patch }: { setId: string; patch: SetPatch }) =>
      workoutService.updateSet(setId, patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workout-history"] });
      queryClient.invalidateQueries({ queryKey: ["workout-stats"] });
      queryClient.invalidateQueries({ queryKey: ["workout-prs"] });
    },
  });

  const logWorkoutMutation = useMutation({
    mutationFn: async () => {
      const validRows = logExercises.filter((r) => r.exerciseId);
      if (validRows.length === 0) throw new Error("Chon it nhat 1 bai tap.");
      return workoutService.logWorkout({
        name: logName.trim() || "Custom Workout Session",
        date: new Date(`${logDate}T07:00:00`).toISOString(),
        duration: logDuration > 0 ? logDuration : undefined,
        notes: logNotes || undefined,
        exercises: validRows.map((r) => ({
          exerciseId: r.exerciseId,
          sets: r.sets > 0 ? r.sets : 1,
          reps: r.reps > 0 ? r.reps : undefined,
          weight: r.weight > 0 ? r.weight : undefined,
          duration: r.duration > 0 ? r.duration : undefined,
          notes: r.notes || undefined,
        })),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workout-history"] });
      queryClient.invalidateQueries({ queryKey: ["workout-stats"] });
      queryClient.invalidateQueries({ queryKey: ["workout-prs"] });
      setShowLogForm(false);
      setView("today");
    },
  });

  if (loadingHistory || loadingStats || loadingPRs || loadingExercises) {
    return (
      <div className="flex h-screen items-center justify-center bg-zinc-950">
        <Loader2 className="w-8 h-8 text-green-500 animate-spin" />
      </div>
    );
  }

  const workouts = normalizeWorkouts(historyRaw);
  const exercises = normalizeExercises(exercisesRaw);
  const todayWorkout: Workout | null = workouts[0] || null;

  const prs = (Array.isArray(prRaw) ? prRaw : prRaw?.prs || []).map((p: any) => ({
    exercise: p.exerciseName || "Exercise",
    weight: `${p.weight || 0} kg × ${p.reps || "-"}`,
    date: p.date ? format(new Date(p.date), "MMM d") : "-",
  }));

  const weeklyData = (() => {
    const labels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const today = new Date();
    const dayOfWeek = (today.getDay() + 6) % 7; // Mon=0
    return labels.map((day, idx) => {
      const d = new Date(today);
      d.setDate(today.getDate() - dayOfWeek + idx);
      const dateStr = format(d, "yyyy-MM-dd");
      const dayWorkouts = workouts.filter(
        (w) => format(new Date(w.date), "yyyy-MM-dd") === dateStr
      );
      const volume = dayWorkouts.reduce((s, w) => s + computeVolume(w), 0);
      return { day, volume: Math.round(volume) };
    });
  })();

  const totalSets = todayWorkout?.exercises?.reduce(
    (a, e) => a + (e.workoutSets?.length || e.sets || 0), 0
  ) || 0;
  const doneSets = todayWorkout?.exercises?.reduce(
    (a, e) => a + (e.workoutSets?.filter((s) => {
      const edit = setEdits[s.id];
      return edit?.completed !== undefined ? edit.completed : s.completed;
    })?.length || 0), 0
  ) || 0;
  const completedExercises = todayWorkout?.exercises?.filter((e) =>
    e.workoutSets?.length > 0 &&
    e.workoutSets.every((s) => {
      const edit = setEdits[s.id];
      return edit?.completed !== undefined ? edit.completed : s.completed;
    })
  )?.length || 0;

  function getSetValue<K extends keyof WorkoutSet>(set: WorkoutSet, key: K): WorkoutSet[K] {
    const edit = setEdits[set.id];
    return (edit && key in edit ? edit[key] : set[key]) as WorkoutSet[K];
  }

  function patchSetLocal(setId: string, patch: SetPatch) {
    setSetEdits((prev) => ({ ...prev, [setId]: { ...prev[setId], ...patch } }));
  }

  function saveSet(setId: string) {
    const patch = setEdits[setId] as SetPatch | undefined;
    if (!patch || Object.keys(patch).length === 0) return;
    updateSetMutation.mutate({ setId, patch });
  }

  function toggleCompleted(set: WorkoutSet) {
    const newVal = !(getSetValue(set, "completed") as boolean);
    const patch: SetPatch = { completed: newVal };
    patchSetLocal(set.id, patch);
    updateSetMutation.mutate({ setId: set.id, patch });
  }

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-zinc-100 flex items-center gap-2">
            <Dumbbell className="w-5 h-5 text-green-400" /> Workout Log
          </h1>
          <p className="text-zinc-500 text-sm mt-0.5">Track your sets, reps, and performance</p>
        </div>
        <button
          onClick={() => setShowLogForm((v) => !v)}
          className="flex items-center gap-2 bg-green-500 hover:bg-green-400 text-black px-4 py-2 rounded-xl text-sm font-bold transition-all self-start sm:self-auto shadow-lg shadow-green-500/20"
        >
          <Plus className="w-4 h-4" /> Log Workout
        </button>
      </div>

      {/* Inline Log Form */}
      {showLogForm && (
        <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-zinc-200">New Workout Log</h3>
            <button onClick={() => setShowLogForm(false)}>
              <X className="w-4 h-4 text-zinc-500 hover:text-zinc-300" />
            </button>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <input
              value={logName}
              onChange={(e) => setLogName(e.target.value)}
              placeholder="Workout name"
              className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
            />
            <input
              type="date"
              value={logDate}
              onChange={(e) => setLogDate(e.target.value)}
              className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
            />
            <input
              type="number"
              min={1}
              value={logDuration}
              onChange={(e) => setLogDuration(Number(e.target.value || 0))}
              placeholder="Duration (min)"
              className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
            />
          </div>

          <textarea
            value={logNotes}
            onChange={(e) => setLogNotes(e.target.value)}
            placeholder="Session notes"
            className="min-h-16 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
          />

          <div className="space-y-2">
            {logExercises.map((row, idx) => (
              <div key={row.tempId} className="grid grid-cols-1 gap-2 rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 sm:grid-cols-7">
                <select
                  value={row.exerciseId}
                  onChange={(e) => setLogExercises((prev) => prev.map((r) => r.tempId === row.tempId ? { ...r, exerciseId: e.target.value } : r))}
                  className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100 sm:col-span-2"
                >
                  <option value="">Exercise</option>
                  {exercises.map((ex) => (
                    <option key={ex.id} value={ex.id}>{ex.exerciseName}</option>
                  ))}
                </select>
                <input type="number" min={1} value={row.sets} onChange={(e) => setLogExercises((prev) => prev.map((r) => r.tempId === row.tempId ? { ...r, sets: Number(e.target.value || 1) } : r))} className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100" placeholder="Sets" />
                <input type="number" min={0} value={row.reps} onChange={(e) => setLogExercises((prev) => prev.map((r) => r.tempId === row.tempId ? { ...r, reps: Number(e.target.value || 0) } : r))} className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100" placeholder="Reps" />
                <input type="number" min={0} value={row.weight} onChange={(e) => setLogExercises((prev) => prev.map((r) => r.tempId === row.tempId ? { ...r, weight: Number(e.target.value || 0) } : r))} className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100" placeholder="Kg" />
                <input type="number" min={0} value={row.duration} onChange={(e) => setLogExercises((prev) => prev.map((r) => r.tempId === row.tempId ? { ...r, duration: Number(e.target.value || 0) } : r))} className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100" placeholder="Sec" />
                <button
                  onClick={() => setLogExercises((prev) => prev.filter((r) => r.tempId !== row.tempId))}
                  disabled={logExercises.length === 1}
                  className="rounded border border-rose-500/30 bg-rose-500/10 px-2 py-1.5 text-sm text-rose-300 hover:bg-rose-500/20 disabled:opacity-40"
                >
                  Remove
                </button>
                <input
                  value={row.notes}
                  onChange={(e) => setLogExercises((prev) => prev.map((r) => r.tempId === row.tempId ? { ...r, notes: e.target.value } : r))}
                  className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100 sm:col-span-7"
                  placeholder={`Exercise note #${idx + 1}`}
                />
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setLogExercises((prev) => [...prev, { tempId: makeTempId(), exerciseId: "", sets: 3, reps: 10, weight: 0, duration: 0, notes: "" }])}
              className="inline-flex items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-700"
            >
              <Plus className="h-4 w-4" /> Add Exercise
            </button>
            <button
              onClick={() => logWorkoutMutation.mutate()}
              disabled={logWorkoutMutation.isPending}
              className="inline-flex items-center gap-1 rounded-lg border border-green-500/30 bg-green-500/10 px-3 py-2 text-sm font-semibold text-green-300 hover:bg-green-500/20 disabled:opacity-60"
            >
              <Save className="h-4 w-4" /> {logWorkoutMutation.isPending ? "Saving..." : "Save Workout"}
            </button>
          </div>

          {logWorkoutMutation.isError && (
            <p className="text-xs text-rose-400">{(logWorkoutMutation.error as any)?.message || "Failed to save"}</p>
          )}
        </div>
      )}

      {/* Tab switcher */}
      <div className="flex gap-1 bg-zinc-800/60 border border-zinc-700/40 p-1 rounded-xl w-full sm:w-auto sm:inline-flex">
        {(["today", "history", "records"] as View[]).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`flex-1 sm:flex-none px-4 py-1.5 rounded-lg text-sm font-semibold capitalize transition-all ${view === v ? "bg-green-500 text-black shadow-sm" : "text-zinc-500 hover:text-zinc-300"}`}
          >
            {v === "today" ? "Today" : v === "history" ? "History" : "PRs"}
          </button>
        ))}
      </div>

      {/* Today View */}
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
                  <div
                    className="h-full bg-green-500 rounded-full transition-all shadow-[0_0_8px_rgba(34,197,94,0.4)]"
                    style={{ width: `${totalSets > 0 ? (doneSets / totalSets) * 100 : 0}%` }}
                  />
                </div>
                <p className="text-xs text-zinc-600 mt-1">
                  {completedExercises}/{todayWorkout.exercises?.length || 0} exercises completed
                </p>
              </div>

              {/* Exercises */}
              {todayWorkout.exercises?.map((ex) => {
                const allDone = ex.workoutSets?.length > 0 && ex.workoutSets.every((s) => {
                  const edit = setEdits[s.id];
                  return edit?.completed !== undefined ? edit.completed : s.completed;
                });
                const doneCount = ex.workoutSets?.filter((s) => {
                  const edit = setEdits[s.id];
                  return edit?.completed !== undefined ? edit.completed : s.completed;
                }).length || 0;

                return (
                  <div key={ex.id} className="bg-zinc-900 rounded-xl border border-zinc-800/60 overflow-hidden">
                    <button
                      onClick={() => setExpanded(expanded === ex.id ? null : ex.id)}
                      className="flex items-center justify-between w-full px-4 py-3 text-left hover:bg-zinc-800/40 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${allDone ? "bg-green-500/15 border border-green-500/20" : "bg-zinc-800 border border-zinc-700"}`}>
                          {allDone ? <Check className="w-4 h-4 text-green-400" /> : <Dumbbell className="w-4 h-4 text-zinc-500" />}
                        </div>
                        <div>
                          <div className="text-sm font-bold text-zinc-200">{ex.exercise?.exerciseName || "Exercise"}</div>
                          <div className="text-xs text-zinc-600">
                            {ex.exercise?.bodyPart?.replace("_", " ") || "Muscle"} · {ex.workoutSets?.length || ex.sets} sets
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-zinc-500">{doneCount}/{ex.workoutSets?.length || ex.sets}</span>
                        {expanded === ex.id ? <ChevronUp className="w-4 h-4 text-zinc-500" /> : <ChevronDown className="w-4 h-4 text-zinc-500" />}
                      </div>
                    </button>

                    {expanded === ex.id && ex.workoutSets?.length > 0 && (
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
                              {ex.workoutSets.map((set, i) => {
                                const isCompleted = getSetValue(set, "completed") as boolean;
                                return (
                                  <tr
                                    key={set.id}
                                    className={`border-t border-zinc-800/40 transition-colors ${isCompleted ? "bg-green-500/5" : "hover:bg-zinc-800/30"}`}
                                  >
                                    <td className="px-4 py-2.5 text-zinc-500">{i + 1}</td>
                                    <td className="px-4 py-2.5">
                                      <input
                                        defaultValue={getSetValue(set, "reps") ?? ""}
                                        placeholder="—"
                                        onChange={(e) => patchSetLocal(set.id, { reps: e.target.value ? Number(e.target.value) : undefined })}
                                        onBlur={() => saveSet(set.id)}
                                        className="w-14 px-2 py-1 border border-zinc-700/60 rounded text-xs focus:outline-none focus:ring-1 focus:ring-green-500/50 bg-zinc-800/60 text-zinc-200"
                                      />
                                    </td>
                                    <td className="px-4 py-2.5">
                                      <input
                                        defaultValue={getSetValue(set, "weight") ?? ""}
                                        placeholder="—"
                                        onChange={(e) => patchSetLocal(set.id, { weight: e.target.value ? Number(e.target.value) : undefined })}
                                        onBlur={() => saveSet(set.id)}
                                        className="w-16 px-2 py-1 border border-zinc-700/60 rounded text-xs focus:outline-none focus:ring-1 focus:ring-green-500/50 bg-zinc-800/60 text-zinc-200"
                                      />
                                    </td>
                                    <td className="px-4 py-2.5">
                                      <input
                                        defaultValue={getSetValue(set, "rpe") ?? ""}
                                        placeholder="—"
                                        onChange={(e) => patchSetLocal(set.id, { rpe: e.target.value ? Number(e.target.value) : undefined })}
                                        onBlur={() => saveSet(set.id)}
                                        className="w-12 px-2 py-1 border border-zinc-700/60 rounded text-xs focus:outline-none focus:ring-1 focus:ring-green-500/50 bg-zinc-800/60 text-zinc-200"
                                      />
                                    </td>
                                    <td className="px-4 py-2.5">
                                      <button
                                        onClick={() => toggleCompleted(set)}
                                        className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${isCompleted ? "bg-green-500 border-green-500 shadow-[0_0_6px_rgba(34,197,94,0.4)]" : "border-zinc-600 hover:border-green-500/50"}`}
                                      >
                                        {isCompleted && <Check className="w-3 h-3 text-black" />}
                                      </button>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          ) : (
            <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-20 text-center">
              <Dumbbell className="w-12 h-12 text-zinc-800 mx-auto mb-3" />
              <p className="text-zinc-500">No workout logged yet.</p>
              <button
                onClick={() => setShowLogForm(true)}
                className="mt-4 text-green-500 font-bold hover:text-green-400"
              >
                Start Training Now
              </button>
            </div>
          )}
        </div>
      )}

      {/* History View */}
      {view === "history" && (
        <div className="space-y-4">
          <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800/60">
            <h4 className="text-sm font-bold text-zinc-200 mb-3">Weekly Volume (kg)</h4>
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={weeklyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis dataKey="day" tick={{ fontSize: 11, fill: "#71717a" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "#71717a" }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #27272a", backgroundColor: "#111111", color: "#f4f4f5" }}
                  formatter={(v: number) => [`${v} kg`, "Volume"]}
                />
                <Bar dataKey="volume" fill="#22c55e" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 overflow-hidden">
            <div className="px-4 py-3 border-b border-zinc-800/60">
              <h4 className="text-sm font-bold text-zinc-200">Recent Workouts</h4>
            </div>
            {workouts.length > 0 ? (
              workouts.map((w, i) => (
                <div key={w.id || i} className="flex items-center justify-between px-4 py-3 border-b border-zinc-800/40 last:border-0 hover:bg-zinc-800/30 transition-colors">
                  <div>
                    <div className="text-sm font-semibold text-zinc-200">{w.name}</div>
                    <div className="text-xs text-zinc-600">
                      {format(new Date(w.date), "MMM d, yyyy")} · {w.exercises?.length || 0} exercises
                    </div>
                  </div>
                  <span className="text-sm font-bold text-green-400">{Math.round(computeVolume(w)).toLocaleString()} kg</span>
                </div>
              ))
            ) : (
              <div className="p-10 text-center text-zinc-600 text-sm italic">No workout history found.</div>
            )}
          </div>
        </div>
      )}

      {/* Records View */}
      {view === "records" && (
        <div className="space-y-3">
          <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 overflow-hidden">
            <div className="px-4 py-3 border-b border-zinc-800/60 flex items-center gap-2">
              <Award className="w-4 h-4 text-amber-400" />
              <h4 className="text-sm font-bold text-zinc-200">Personal Records</h4>
            </div>
            {prs.length === 0 && (
              <div className="p-10 text-center text-zinc-600 text-sm italic">No PR data yet.</div>
            )}
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
