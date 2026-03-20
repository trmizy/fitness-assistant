import React, { useEffect, useState } from 'react';
import { Dumbbell, Plus, X, ChevronDown, ChevronUp, Clock } from 'lucide-react';
import { workoutService } from '../services/api';
import { useAuth } from '../contexts/AuthContext';

type WorkoutItem = {
  id: string;
  name: string;
  date: string;
  duration?: number | null;
  notes?: string | null;
  exercises: Array<{
    id: string;
    sets?: number;
    reps?: number | null;
    weight?: number | null;
    exercise?: {
      exerciseName?: string;
    };
  }>;
};

export default function Workouts() {
  const { user } = useAuth();
  const [workouts, setWorkouts] = useState<WorkoutItem[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ name: '', date: '', duration: '', notes: '' });

  useEffect(() => {
    if (!user?.id) {
      setWorkouts([]);
      setExpanded(null);
      setLoading(false);
      return;
    }

    const load = async () => {
      setLoading(true);
      try {
        setError('');
        const data = await workoutService.getHistory(1, 50);
        const items = Array.isArray(data) ? (data as WorkoutItem[]) : [];
        setWorkouts(items);
        setExpanded(items[0]?.id ?? null);
      } catch {
        setError('Failed to load workouts');
        setWorkouts([]);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [user?.id]);

  const toggle = (id: string) => setExpanded((e) => (e === id ? null : id));

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const created = await workoutService.logWorkout({
        name: form.name,
        date: form.date ? new Date(form.date).toISOString() : new Date().toISOString(),
        duration: Number(form.duration) || undefined,
        notes: form.notes || undefined,
        exercises: [],
      });

      setWorkouts((ws) => [created as WorkoutItem, ...ws]);
      setExpanded((created as WorkoutItem).id);
      setShowForm(false);
      setForm({ name: '', date: '', duration: '', notes: '' });
    } catch {
      setError('Failed to create workout');
    }
  };

  const set =
    (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white">Workout Log</h2>
          <p className="text-sm text-zinc-400">{workouts.length} sessions recorded</p>
        </div>
        <button onClick={() => setShowForm(true)} className="btn-primary flex items-center gap-2">
          <Plus className="w-4 h-4" />
          Log Workout
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {showForm && (
        <div className="card border border-zinc-700">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-white">New Workout</h3>
            <button onClick={() => setShowForm(false)}>
              <X className="w-4 h-4 text-zinc-400" />
            </button>
          </div>
          <form onSubmit={handleAdd} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="sm:col-span-1">
                <label className="label">Workout Name</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={set('name')}
                  className="input"
                  placeholder="Upper Body Power"
                  required
                />
              </div>
              <div>
                <label className="label">Date</label>
                <input type="date" value={form.date} onChange={set('date')} className="input" required />
              </div>
              <div>
                <label className="label">Duration (min)</label>
                <input
                  type="number"
                  value={form.duration}
                  onChange={set('duration')}
                  className="input"
                  placeholder="60"
                  required
                />
              </div>
            </div>
            <div>
              <label className="label">Notes (optional)</label>
              <textarea
                value={form.notes}
                onChange={set('notes')}
                className="input resize-none h-16"
                placeholder="How did it feel?"
              />
            </div>
            <div className="flex justify-end gap-3">
              <button type="button" onClick={() => setShowForm(false)} className="btn-ghost">
                Cancel
              </button>
              <button type="submit" className="btn-primary">
                Save Workout
              </button>
            </div>
          </form>
        </div>
      )}

      {!loading && workouts.length === 0 && (
        <div className="card text-sm text-zinc-500">No workout data yet. Create your first log to start tracking.</div>
      )}

      {workouts.map((w) => (
        <div key={w.id} className="card">
          <button className="w-full flex items-center justify-between" onClick={() => toggle(w.id)}>
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-lg bg-zinc-800 flex items-center justify-center flex-shrink-0">
                <Dumbbell className="w-5 h-5 text-emerald-400" />
              </div>
              <div className="text-left">
                <p className="font-semibold text-white">{w.name}</p>
                <div className="flex items-center gap-3 mt-0.5">
                  <span className="text-xs text-zinc-500">{new Date(w.date).toLocaleDateString()}</span>
                  <span className="flex items-center gap-1 text-xs text-zinc-500">
                    <Clock className="w-3 h-3" />
                    {w.duration ?? 0} min
                  </span>
                  <span className="badge badge-blue">{w.exercises.length} exercises</span>
                </div>
              </div>
            </div>
            {expanded === w.id ? (
              <ChevronUp className="w-4 h-4 text-zinc-500 flex-shrink-0" />
            ) : (
              <ChevronDown className="w-4 h-4 text-zinc-500 flex-shrink-0" />
            )}
          </button>

          {expanded === w.id && w.exercises.length > 0 && (
            <div className="mt-4 space-y-4 border-t border-zinc-800 pt-4">
              {w.exercises.map((ex) => (
                <div key={ex.id}>
                  <p className="text-sm font-medium text-white mb-2">{ex.exercise?.exerciseName || 'Exercise'}</p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-zinc-800">
                          <th className="text-left py-1.5 px-2 text-zinc-500 first:pl-0">Set</th>
                          <th className="text-left py-1.5 px-2 text-zinc-500">Reps</th>
                          <th className="text-left py-1.5 px-2 text-zinc-500">Weight</th>
                          <th className="text-left py-1.5 px-2 text-zinc-500">Sets</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr className="border-b border-zinc-800/50 last:border-0">
                          <td className="py-2 px-2 first:pl-0 text-zinc-400">1</td>
                          <td className="py-2 px-2 text-white">{ex.reps ?? '-'}</td>
                          <td className="py-2 px-2 text-emerald-400">
                            {typeof ex.weight === 'number' ? `${ex.weight} kg` : 'BW'}
                          </td>
                          <td className="py-2 px-2 text-zinc-400">{ex.sets ?? '-'}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
              {w.notes && <p className="text-xs text-zinc-500 italic border-t border-zinc-800 pt-3">{w.notes}</p>}
            </div>
          )}

          {expanded === w.id && w.exercises.length === 0 && (
            <p className="mt-4 text-sm text-zinc-500 border-t border-zinc-800 pt-4">No exercises recorded yet.</p>
          )}
        </div>
      ))}
    </div>
  );
}
